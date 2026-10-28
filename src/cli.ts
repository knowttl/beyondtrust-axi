import { AxiError, runAxiCli } from "axi-sdk-js";
import { encode } from "@toon-format/toon";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { catalogue, DESCRIPTION, help } from "./catalogue.js";
import { credentialStore, type CredentialContext } from "./profiles.js";

export async function main(argv = process.argv.slice(2), options: { credentials?: CredentialContext; stdout?: { write: (chunk: string) => unknown } } = {}): Promise<void> {
  const store = credentialStore(options.credentials);
  await runAxiCli({
    description: DESCRIPTION, argv: ["local"], topLevelHelp: "", home: help,
    stdout: { write: (chunk) => (options.stdout ?? process.stdout).write(store.redactor.text(chunk)) },
    formatError: (error) => ({
      output: `${encode(store.redactor.value(error instanceof AxiError
        ? { error: { code: error.code, message: error.message }, help: error.suggestions }
        : { error: { code: "CONFIG_INVALID", message: "Command could not complete" }, help: ["Check local configuration; run beyondtrust-axi config path"] }))}\n`,
      exitCode: error instanceof AxiError && error.code === "VALIDATION_ERROR" ? 2 : 1,
    }),
    commands: { local: () => localCommand(argv, store) },
  });
}

function localCommand(argv: string[], store: ReturnType<typeof credentialStore>): Record<string, unknown> {
  if (argv.length === 1 && argv[0] === "--help") return help();
  const name = !argv.length || argv[0]?.startsWith("--") ? "home" : argv[0] === "home" ? "home" : argv.slice(0, 2).join(" ");
  const entry = Object.hasOwn(catalogue, name) ? catalogue[name as keyof typeof catalogue] : undefined;
  const usage = (message = "Unknown command, argument, duplicate or invalid flag"): never => { throw new AxiError(message, "VALIDATION_ERROR", [
    `Valid commands: ${Object.keys(catalogue).join(", ")}; valid flags: ${Object.keys(entry?.flags ?? catalogue.home.flags).map((flag) => `--${flag}`).join(", ")}`,
  ]); };
  if (!entry) return usage();
  const flags = new Map<string, string>();
  for (let index = name === "home" ? (argv[0] === "home" ? 1 : 0) : 2; index < argv.length; index++) {
    const flag = argv[index]!;
    if (!flag.startsWith("--")) usage();
    if (!Object.hasOwn(entry.flags, flag.slice(2)) || flags.has(flag)) {
      const label = flag.split("=")[0]!;
      usage(/^--[A-Za-z][A-Za-z0-9-]*$/.test(label) ? `Unknown or duplicate flag ${label}` : undefined);
    }
    if (["--help", "--full"].includes(flag)) flags.set(flag, "true");
    else {
      const value = argv[++index];
      if (!value || value.startsWith("--")) usage();
      flags.set(flag, value!);
    }
  }
  if (flags.has("--help")) return { command: name, ...entry };
  const available = name === "auth status" ? ["profile", "source", "host", "origin", "clientSecret", "readOnly"]
    : name === "profile list" ? ["profiles", "count", "config"] : name === "config path" ? ["config", "state"]
      : ["bin", "description", "status", "profiles", "count", "help"];
  const fields = flags.get("--fields")?.split(",") ?? available;
  if (fields.some((field) => !available.includes(field)) || new Set(fields).size !== fields.length) usage();
  const config = flags.get("--config");
  let result: Record<string, unknown>;
  if (name === "auth status") result = store.status(config, flags.get("--profile"));
  else if (name === "profile list") result = store.list(config);
  else if (name === "config path") result = { config: store.configPath(config), state: store.statePath() };
  else {
    const listed = store.list(config);
    let status = "not configured";
    try {
      const selected = store.select(store.load(config).config, flags.get("--profile"));
      status = `configured: ${selected.name} (${selected.host}); not verified with the API`;
    } catch (error) { if (!(error instanceof AxiError) || error.code !== "PROFILE_REQUIRED") throw error; }
    const executable = resolve(process.argv[1] ?? "bin/beyondtrust-axi.js");
    const home = homedir();
    result = { bin: executable.startsWith(`${home}/`) ? `~${executable.slice(home.length)}` : executable,
      description: DESCRIPTION, status, profiles: listed.profiles, count: listed.count,
      help: ["Run beyondtrust-axi config path to locate configuration", "Run beyondtrust-axi auth status to validate local credentials", "Run beyondtrust-axi profile list to inspect configured profiles"] };
  }
  let truncated = false;
  const preview = (value: unknown): unknown => {
    if (typeof value === "string" && value.length > 500 && !flags.has("--full")) { truncated = true; return `${value.slice(0, 500)}... (truncated, ${value.length} chars total)`; }
    if (Array.isArray(value)) return value.map(preview);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, preview(child)]));
    return value;
  };
  const projected = Object.fromEntries(fields.map((field) => [field, preview(store.redactor.value(result[field]))]));
  if (truncated) projected.help = ["Repeat the command with --full to see complete strings"];
  return projected;
}
