import { AxiError, runAxiCli } from "axi-sdk-js";
import { encode } from "@toon-format/toon";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { catalogue, DESCRIPTION, help, resourceReads } from "./catalogue.js";
import { credentialStore, type CredentialContext } from "./profiles.js";
import { readClient, type TransportOptions } from "./transport.js";
import { z } from "zod";
import { aboutResponse, prepareResourceRead } from "./resource-reads.js";
import { downloads, prepareDownload } from "./downloads.js";
import { computerWrites, prepareComputerWrite } from "./computer-writes.js";
import { groupWrites, prepareGroupWrite } from "./group-writes.js";
import { policyWrites, preparePolicyWrite } from "./policy-writes.js";
import { identityWrites, prepareIdentityWrite } from "./identity-writes.js";
import { jitWrites, prepareJitWrite } from "./jit-writes.js";
import { deletes, prepareDelete } from "./deletes.js";
import { coordinateWrite, requireDeletePermission, requireWritePermission, UnknownWriteOutcome } from "./writes.js";
import { ResponseDiagnostics } from "./response-diagnostics.js";
import { setupHooks } from "./hooks.js";

export async function main(argv = process.argv.slice(2), options: { credentials?: CredentialContext; transport?: TransportOptions; stdout?: { write: (chunk: string) => unknown } } = {}): Promise<void> {
  const store = credentialStore(options.credentials);
  const diagnostics = new ResponseDiagnostics(store.redactor);
  await runAxiCli({
    description: DESCRIPTION, argv: ["local"], topLevelHelp: "", home: help,
    stdout: { write: (chunk) => (options.stdout ?? process.stdout).write(store.redactor.text(chunk)) },
    formatError: (error) => ({
      output: `${encode(store.redactor.value(error instanceof AxiError
        ? { error: { code: error.code, message: error.message, ...diagnostics.forError(error), ...(error instanceof UnknownWriteOutcome ? { auditId: error.auditId } : {}) }, help: error.suggestions }
        : { error: { code: "CONFIG_INVALID", message: "Command could not complete" }, help: ["Check local configuration; run beyondtrust-axi config path"] }))}\n`,
      exitCode: error instanceof AxiError && error.code === "VALIDATION_ERROR" ? 2 : 1,
    }),
    commands: { local: () => localCommand(argv, store, { ...options.transport, diagnostics }) },
  });
}

async function localCommand(argv: string[], store: ReturnType<typeof credentialStore>, transport?: TransportOptions): Promise<Record<string, unknown>> {
  if (argv.length === 1 && argv[0] === "--help") return help();
  const implicitHome = !argv.length || argv[0]?.startsWith("--");
  const name = implicitHome ? "home" : Object.keys(catalogue).sort((a, b) => b.length - a.length).find((command) => command.split(" ").every((word, index) => argv[index] === word)) ?? "";
  const entry = Object.hasOwn(catalogue, name) ? catalogue[name as keyof typeof catalogue] : undefined;
  const usage = (message = "Unknown command, argument, duplicate or invalid flag"): never => { throw new AxiError(message, "VALIDATION_ERROR", [
    `Valid commands: ${Object.keys(catalogue).join(", ")}; valid flags: ${Object.keys(entry?.flags ?? catalogue.home.flags).map((flag) => `--${flag}`).join(", ")}`,
  ]); };
  if (!entry) return usage();
  let index = implicitHome ? 0 : name.split(" ").length;
  const definition = resourceReads[name];
  const writeIds: string[] = [];
  if (computerWrites[name] || groupWrites[name] || policyWrites[name] || identityWrites[name] || jitWrites[name] || deletes[name]) while (argv[index] !== undefined && !argv[index]!.startsWith("--")) writeIds.push(argv[index++]!);
  const downloadTemplate = downloads[name];
  const downloadId = downloadTemplate?.includes("{") && argv[index] !== undefined && !argv[index]!.startsWith("--") ? argv[index++] : undefined;
  let type: "user" | "role" | undefined;
  if (definition?.variants && argv[index] !== undefined && !argv[index]!.startsWith("--")) {
    const value = argv[index++];
    if (value !== "user" && value !== "role") return usage("Resource type must be user or role");
    type = value;
  }
  const flags = new Map<string, string>();
  for (; index < argv.length; index++) {
    const flag = argv[index]!;
    if (!flag.startsWith("--")) {
      if (name === "policy app remove") { writeIds.push(flag); continue; }
      usage();
    }
    if (!Object.hasOwn(entry.flags, flag.slice(2)) || flags.has(flag)) {
      const label = flag.split("=")[0]!;
      usage(/^--[A-Za-z][A-Za-z0-9-]*$/.test(label) ? `Unknown or duplicate flag ${label}` : undefined);
    }
    if (["--help", "--offline", "--full", "--all", "--execute", "--auto-assign", "--force", ...(name === "group create" ? ["--default"] : [])].includes(flag)) flags.set(flag, "true");
    else {
      const value = argv[++index];
      if (!value || value.startsWith("--")) usage();
      flags.set(flag, value!);
    }
  }
  if (flags.has("--help")) return { command: name, ...entry };
  const download = downloadTemplate ? prepareDownload(downloadTemplate, downloadId, flags.get("--out")) : undefined;
  const resourceRead = prepareResourceRead(name, flags, definition, type);
  const write = prepareDelete(name, writeIds, flags) ?? prepareComputerWrite(name, writeIds, flags) ?? prepareGroupWrite(name, writeIds, flags) ?? preparePolicyWrite(name, writeIds, flags) ?? prepareIdentityWrite(name, writeIds, flags, store.redactor) ?? prepareJitWrite(name, writeIds, flags, store.redactor);
  const available = name === "setup hooks" ? ["integrations", "help"] : name === "auth status" ? ["profile", "source", "host", "origin", "clientSecret", "readOnly"]
    : name === "profile list" ? ["profiles", "count", "config"] : name === "config path" ? ["config", "state"]
      : name === "about" ? ["versions"] : name === "task status" ? ["task"] : name === "doctor" ? ["profile", "host", "authentication", "api", "unverified"]
      : download ? ["path", "size", "sha256", "contentType"] : write ? ["status", "operation", "preview", "confirmation", ...(deletes[name] ? ["deleteConfirmation"] : []), "auditId", "result", "help"] : resourceRead?.fields ?? ["bin", "description", "status", "profiles", "count", "summary", "help"];
  const fields = flags.get("--fields")?.split(",") ?? available;
  if (fields.some((field) => !available.includes(field)) || new Set(fields).size !== fields.length) usage();
  if (name === "task status" && !z.string().regex(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i).safeParse(flags.get("--id")).success) usage("task status requires --id <uuid>");
  const config = flags.get("--config");
  let result: Record<string, unknown>;
  if (name === "setup hooks") result = setupHooks(flags.get("--agent"), flags.get("--directory"));
  else if (name === "auth status") result = store.status(config, flags.get("--profile"));
  else if (name === "profile list") result = store.list(config);
  else if (name === "config path") result = { config: store.configPath(config), state: store.statePath() };
  else if (write) {
    const forcedReadOnly = store.readOnly();
    const profile = store.select(store.load(config, true).config, flags.get("--profile"));
    requireWritePermission(profile, forcedReadOnly, write.operation);
    if (deletes[name]) requireDeletePermission(profile);
    if (name === "policy delete" && flags.has("--force")) requireWritePermission(profile, forcedReadOnly, "policy.delete.force");
    const client = readClient(profile, store.credentials(profile, true), store.redactor, transport, true);
    result = await coordinateWrite({ operation: write.operation, execute: flags.has("--execute"), confirm: flags.get("--confirm"), confirmDelete: flags.get("--confirm-delete"), statePath: store.statePath(), redactor: store.redactor, prepare: () => write.prepare(client), send: client.write });
  }
  else if (download) {
    store.readOnly();
    const profile = store.select(store.load(config, true).config, flags.get("--profile"));
    if (profile.source === "env-profile" || !profile.downloads.allow) throw new AxiError("Downloads are disabled for this profile", "DOWNLOADS_DISABLED", ["Enable downloads.allow in a named file profile"]);
    const client = readClient(profile, store.credentials(profile, true), store.redactor, transport);
    result = await download(client);
  }
  else if (resourceRead) {
    store.readOnly();
    const profile = store.select(store.load(config, true).config, flags.get("--profile"));
    const client = readClient(profile, store.credentials(profile, true), store.redactor, transport);
    result = await resourceRead.run(client, JSON.stringify([store.configPath(config), profile.name, profile.host, profile.clientId]), store.redactor, transport?.diagnostics);
  }
  else if (["doctor", "about", "task status"].includes(name)) {
    store.readOnly();
    const profile = store.select(store.load(config, true).config, flags.get("--profile"));
    const client = readClient(profile, store.credentials(profile, true), store.redactor, transport);
    const data = await client.get(name === "task status" ? `/v3/Tasks/${flags.get("--id")}` : "/v3/About");
    const text = z.string().nullable().optional();
    const task = z.object({ id: z.string(), name: text, state: z.number().int().optional(), stateName: text, initiated: text, completed: text, completedWithErrors: z.boolean().nullable().optional() });
    const parsed = (name === "task status" ? task : aboutResponse).safeParse(data);
    if (!parsed.success) {
      transport?.diagnostics?.validationFailed(name !== "task status" && data && typeof data === "object" && !Array.isArray(data)
        ? parsed.error.issues.map((issue) => ({ ...issue, path: issue.path.slice(1) })) : parsed.error.issues);
      throw new AxiError("API response does not match the documented schema", "API_RESPONSE_INVALID", ["Check API compatibility"]);
    }
    result = name === "doctor" ? { profile: profile.name, host: profile.host, authentication: "verified for this run", api: "GET /v3/About succeeded",
      unverified: ["Token lifetime and rate limits are guide-only facts", "Live tenant compatibility requires commissioning through artium-axi"] }
      : name === "about" ? { versions: parsed.data } : { task: parsed.data };
  }
  else {
    const listed = store.list(config);
    let status = "not configured";
    let selected: ReturnType<typeof store.select> | undefined;
    try {
      selected = store.select(store.load(config, !flags.has("--offline")).config, flags.get("--profile"));
      status = `configured: ${selected.name} (${selected.host}); offline, API not checked`;
    } catch (error) { if (!(error instanceof AxiError) || error.code !== "PROFILE_REQUIRED") throw error; }
    const summary: Record<string, unknown>[] = [];
    if (selected && !flags.has("--offline")) {
      const client = readClient(selected, store.credentials(selected, true), store.redactor, { ...transport, startup: true });
      for (const command of ["computer list", "group list", "policy list"]) {
        try {
          const read = prepareResourceRead(command, new Map([["--limit", "3"]]), resourceReads[command])!;
          const value = await read.run(client, JSON.stringify([store.configPath(config), selected.name, selected.host, selected.clientId]), store.redactor, transport?.diagnostics);
          summary.push({ resource: command.split(" ")[0], status: value.cursor ? "partial" : "complete", count: value.count, total: value.total,
            data: (value.data as Record<string, unknown>[]).map((row) => Object.fromEntries(["id", "name", "host"].filter((key) => row[key] !== undefined).map((key) => [key, row[key]]))),
            help: `Run beyondtrust-axi ${command} --profile ${selected.name} --config '${store.configPath(config).replaceAll("'", "'\\''")}' --all` });
        } catch (error) {
          if (!(error instanceof AxiError)) throw error;
          summary.push({ resource: command.split(" ")[0], status: "failed", error: error.code, help: error.suggestions });
          process.exitCode = 1;
        }
      }
      status = summary.some((row) => row.status === "failed") ? "live: incomplete; see resource errors" : "live: read-only summary";
    }
    const executable = resolve(process.argv[1] ?? "bin/beyondtrust-axi.js");
    const home = homedir();
    result = { bin: executable.startsWith(`${home}/`) ? `~${executable.slice(home.length)}` : executable,
      description: DESCRIPTION, status, profiles: listed.profiles, count: listed.count, summary,
      help: ["Run beyondtrust-axi home --offline for local context without API access", "Run beyondtrust-axi auth status to validate local credentials", "Run beyondtrust-axi setup hooks to opt in to offline session context"] };
  }
  let truncated = false;
  const preview = (value: unknown): unknown => {
    if (typeof value === "string" && value.length > 500 && !flags.has("--full")) { truncated = true; return `${value.slice(0, 500)}... (truncated, ${value.length} chars total)`; }
    if (Array.isArray(value)) return value.map(preview);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, preview(child)]));
    return value;
  };
  const projected = Object.fromEntries(fields.map((field) => [field, download || write ? store.redactor.value(result[field]) : preview(store.redactor.value(result[field]))]));
  if (truncated) projected.help = ["Repeat the command with --full to see complete strings"];
  return projected;
}
