import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { AxiError } from "axi-sdk-js";
import { z } from "zod";
import type { SecretRedactor } from "./redact.js";

// The committed export owns parameter types and response shapes, including nullable fields.
export type Schema = { $ref?: string; type?: string; format?: string; enum?: string[]; nullable?: boolean; properties?: Record<string, Schema>; additionalProperties?: boolean; items?: Schema; minimum?: number; maximum?: number };
const spec = JSON.parse(readFileSync(join(dirname(createRequire(import.meta.url).resolve("@knowttl/beyondtrust-axi/inventory")), "swagger.json"), "utf8")) as {
  paths: Record<string, { get?: { parameters?: { name: string; in: string; schema: Schema }[]; responses: Record<string, { content?: Record<string, { schema: Schema }> }> } }>;
  components: { schemas: Record<string, Schema> };
};
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function resolved(schema: Schema): Schema { return schema.$ref ? spec.components.schemas[schema.$ref.split("/").at(-1)!]! : schema; }
function validator(input: Schema): z.ZodType {
  const s = resolved(input);
  let result: z.ZodType;
  if (!Object.keys(s).length) result = z.unknown();
  else if (s.enum) result = z.enum(s.enum as [string, ...string[]]);
  else if (s.type === "object") {
    const shape = Object.fromEntries(Object.entries(s.properties ?? {}).map(([key, value]) => [key, validator(value).optional()]));
    result = s.additionalProperties === false ? z.strictObject(shape) : z.object(shape);
  }
  else if (s.type === "array") result = z.array(validator(s.items!));
  else if (s.type === "integer") result = z.number().int().min(s.minimum ?? (s.format === "int64" ? Number.MIN_SAFE_INTEGER : -2147483648)).max(s.maximum ?? (s.format === "int64" ? Number.MAX_SAFE_INTEGER : 2147483647));
  else if (s.type === "number") result = z.number().finite();
  else if (s.type === "boolean") result = z.boolean();
  else result = s.format === "uuid" ? z.string().regex(uuid) : z.string();
  return s.nullable ? result.nullable() : result;
}
function filterFlag(name: string): string { return name.slice(7).replace(/([a-z0-9])([A-Z])/g, "$1-$2").replaceAll(".", "-").toLowerCase(); }
const eventFilters: Record<string, string> = { group: "ComputerGroups", os: "OperatingSystem", action: "Events.EventAction", code: "Events.EventCode", type: "Events.EventType", "app-type": "Application.ApplicationType", host: "Computers.HostName", domain: "Computers.HostDomain", user: "Users.UserName", workstyle: "Policies.WorkstyleName", "app-group": "Policies.ApplicationGroupName", "on-demand": "Policies.OnDemandRule" };
export function resourceReadDefinition(command: string, path: string) {
  const operation = spec.paths[path]!.get!;
  const events = command.startsWith("event ");
  const pathParameter = (operation.parameters ?? []).find((p) => p.in === "path");
  const paged = (operation.parameters ?? []).some((p) => p.name === "Pagination.PageNumber");
  const scimPaged = (operation.parameters ?? []).some((p) => p.name === "startIndex");
  const responseSchema = Object.values(operation.responses["200"]?.content ?? {})[0]?.schema;
  const response = responseSchema ? resolved(responseSchema) : undefined;
  const scimList = !!response?.properties?.Resources;
  const envelope = !!response?.properties?.pageNumber;
  const list = events || paged || envelope || scimList || response?.type === "array" || (!response && !command.endsWith(" view") && !command.endsWith(" show"));
  const filters = (operation.parameters ?? []).filter((p) => p.name.startsWith("Filter."));
  const flags: Record<string, string> = {};
  if (pathParameter) flags.id = `Required resource ${pathParameter.schema.format === "uuid" ? "UUID" : pathParameter.schema.format ?? pathParameter.schema.type}`;
  if (list) Object.assign(flags, { limit: "Maximum rows, 1-1000 (default: 50)", all: "Read up to 1000 rows within 10 requests, 60 seconds and 8 MiB", cursor: "Resume an opaque cursor with the same profile, command and filters" });
  if (paged && !events && command !== "computer list") flags.sort = "Sort property and order, e.g. name:asc (default: created:asc)";
  if (events) {
    flags.since = "UTC start time (default: 24 hours before end; maximum window: 31 days)";
    if (command === "event search") {
      flags.until = "UTC end time (default: now)";
      for (const [flag, name] of Object.entries(eventFilters)) flags[flag] = `${name.replaceAll(".", " ")}${flag === "os" ? " (required)" : ""}; arrays use comma-separated values`;
    }
    flags.full = "Show complete redacted ECS event objects instead of compact columns";
  }
  if (scimPaged) flags.filter = "SCIM filter expression (sent literally)";
  const variants = command === "scim resource-types" ? { user: `${path}/User`, role: `${path}/Role` } : undefined;
  for (const p of filters) flags[filterFlag(p.name)] = `Filter ${p.name.slice(7).replaceAll(".", " ")} (${resolved(p.schema).enum?.join("|") ?? resolved(p.schema).type}${resolved(p.schema).type === "array" ? "; comma-separated" : ""})`;
  return { path, variants, paged, envelope, events, pathParameter, scimPaged, scimList, list, filters, flags, description: `Read ${command.replaceAll("-", " ")}${variants ? "; optional positional type: user|role (default: list all resource types)" : ""} (GET ${path}${variants ? "[/User|/Role]" : ""})`, examples: [`beyondtrust-axi ${command}${pathParameter ? ` --id <${pathParameter.schema.format ?? pathParameter.schema.type}>` : ""}${command === "event search" ? " --os Windows" : ""}`, ...(variants ? [`beyondtrust-axi ${command} user`, `beyondtrust-axi ${command} role`] : []), `beyondtrust-axi ${command} --help`] };
}

function invalid(message: string): never { throw new AxiError(message, "VALIDATION_ERROR", ["Repeat the command with --help; resume cursors with the original profile, command and filters"]); }
function badResponse(): never { throw new AxiError("API response does not match the documented schema", "API_RESPONSE_INVALID", ["Check API compatibility"]); }
const credentialFields = new Set(["password", "oldAzureAdClientSecret", "azureAdClientSecret", "oldAuthRequestClientSecret", "oldAuthRequestPassword", "oldAuthRequestApiClientSecret", "authRequestClientSecret", "authRequestPassword", "authRequestApiClientSecret", "oldReputationIntegrationApiKey", "reputationIntegrationApiKey"]);
function withoutCredentials(value: unknown, redactor: SecretRedactor): unknown {
  if (Array.isArray(value)) return value.map((child) => withoutCredentials(child, redactor));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key, child]) => {
    if (!credentialFields.has(key)) return true;
    if (typeof child === "string") redactor.add(child);
    return false;
  }).map(([key, child]) => [key, withoutCredentials(child, redactor)]));
  return value;
}
const cursorSchema = z.strictObject({ version: z.literal(1), binding: z.string(), page: z.number().int().min(1).max(2147483647), size: z.number().int().min(1).max(200), offset: z.number().int().nonnegative().max(2147483647), since: z.string().optional(), until: z.string().optional() });

// Validation runs before credential resolution; cursors carry only positions and a context digest.
export function prepareResourceRead(command: string, flags: Map<string, string>, definition?: ReturnType<typeof resourceReadDefinition>, type?: "user" | "role") {
  if (!definition) return undefined;
  const selectedPath = type && definition.variants ? definition.variants[type] : definition.path;
  const list = definition.list && !type;
  const id = flags.get("--id");
  if (definition.pathParameter) {
    const s = definition.pathParameter.schema;
    if (s.type === "integer" ? !/^[0-9]+$/.test(id ?? "") || BigInt(id!) > 9223372036854775807n : s.format === "uuid" ? !uuid.test(id ?? "") : !id || id.length > 1024 || [".", ".."].includes(id)) invalid(`This command requires --id <${s.format ?? s.type}>`);
  }
  if (flags.has("--all") && flags.has("--limit")) invalid("Use either --limit or --all");
  const rawLimit = flags.get("--limit") ?? "50";
  if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 1000) invalid("--limit must be an integer from 1 to 1000");
  const limit = flags.has("--all") ? 1000 : Number(rawLimit);
  const query = new URLSearchParams();
  if (flags.has("--filter")) query.set("filter", flags.get("--filter")!);
  for (const p of definition.filters) {
    const raw = flags.get(`--${filterFlag(p.name)}`);
    if (raw === undefined) continue;
    const s = resolved(p.schema);
    let value: unknown = raw;
    if (s.type === "integer") value = /^-?\d+$/.test(raw) ? Number(raw) : NaN;
    if (s.type === "boolean") value = raw === "true" ? true : raw === "false" ? false : raw;
    if (s.type === "array") value = raw.split(",");
    if (!validator(p.schema).safeParse(value).success) invalid(`Invalid --${filterFlag(p.name)}`);
    if (p.name.endsWith(".Dates") && (value as string[]).some((date) => !Number.isFinite(Date.parse(date)))) invalid(`Invalid --${filterFlag(p.name)}`);
    for (const item of Array.isArray(value) ? value : [value]) query.append(p.name, String(item));
  }
  for (const prefix of ["Created", "LastConnected", "LastSignedIn", "TimeOfRequest", "DecisionTime", "StartTime"]) {
    const dates = query.getAll(`Filter.${prefix}.Dates`);
    const mode = query.get(`Filter.${prefix}.SelectionMode`);
    if ((dates.length > 0) !== (mode !== null) || (mode === "Single" && dates.length !== 1) || (mode === "Range" && (dates.length !== 2 || Date.parse(dates[0]!) > Date.parse(dates[1]!)))) invalid("Date filters require dates and a matching selection mode");
  }
  const min = query.get("Filter.DuplicateCount.Min"), max = query.get("Filter.DuplicateCount.Max");
  if (min !== null && max !== null && Number(min) > Number(max)) invalid("Duplicate count minimum exceeds maximum");
  if (definition.paged && !definition.events) {
    const sort = flags.get("--sort") ?? "created:asc";
    if (!/^[A-Za-z][A-Za-z0-9]*:(asc|desc)$/.test(sort)) invalid("--sort must be property:asc or property:desc");
    const [by, order] = sort.split(":");
    query.append("Sorts[0].by", by!); query.append("Sorts[0].order", order!);
  }
  let cursor: z.infer<typeof cursorSchema> | undefined;
  if (flags.has("--cursor")) {
    try {
      const raw = flags.get("--cursor")!;
      if (raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw)) invalid("Invalid cursor");
      cursor = cursorSchema.parse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    } catch { invalid("Invalid cursor"); }
  }
  if (definition.events) {
    const timestamp = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
    const until = flags.get("--until") ?? cursor?.until ?? new Date().toISOString();
    if (!timestamp(until)) invalid("Event windows require UTC timestamps");
    const since = flags.get("--since") ?? cursor?.since ?? new Date(Date.parse(until) - 86400000).toISOString();
    if (!timestamp(since) || !timestamp(until) || Date.parse(since) >= Date.parse(until) || Date.parse(until) - Date.parse(since) > 31 * 86400000) invalid("Event windows require UTC --since before --until and at most 31 days");
    if (command === "event list" && (Date.parse(since) >= Date.now() || Date.now() - Date.parse(since) > 31 * 86400000)) invalid("event list requires --since within the last 31 days; use event search for historical windows");
    query.set(command === "event list" ? "StartDate" : "TimePeriod.StartDate", since);
    if (command === "event search") {
      query.set("TimePeriod.EndDate", until);
      for (const [flag, name] of Object.entries(eventFilters)) {
        const raw = flags.get(`--${flag}`);
        if (raw === undefined) { if (flag === "os") invalid("event search requires --os <name>"); continue; }
        const p = spec.paths[selectedPath]!.get!.parameters!.find((p) => p.name === name)!;
        const value = p.schema.type === "array" ? raw.split(",") : p.schema.type === "boolean" ? raw === "true" ? true : raw === "false" ? false : raw : raw;
        if (!validator(p.schema).safeParse(value).success) invalid(`Invalid --${flag}`);
        for (const item of Array.isArray(value) ? value : [value]) query.append(name, String(item));
      }
    }
    // Freeze relative defaults across cursor resumes.
    if (!cursor) cursor = { version: 1, binding: "", page: 1, size: Math.min(limit, 200), offset: 0, since, until };
  }
  const path = selectedPath.replace(/\{[^}]+\}/, encodeURIComponent(id ?? "").replace(/[!'()~]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`));
  return {
    fields: list ? ["data", "count", "total", "cursor", "help"] : ["data"],
    async run(client: { get: (path: string) => Promise<unknown> }, context: string, redactor: SecretRedactor) {
      const binding = createHash("sha256").update(JSON.stringify([context, command, path, query.toString()])).digest("hex");
      if (flags.has("--cursor") && cursor?.binding !== binding) invalid("Cursor does not match this profile, command or filters");
      let page = cursor?.page ?? 1, offset = cursor?.offset ?? 0;
      const size = cursor?.size ?? Math.min(limit, 200);
      const data: unknown[] = [];
      let total: number | null = 0, more = false;
      for (;;) {
        const params = new URLSearchParams(query);
        if (definition.paged) { params.set("Pagination.PageSize", String(size)); params.set("Pagination.PageNumber", String(page)); }
        if (definition.scimPaged) { params.set("startIndex", String(page)); params.set("count", String(size)); }
        if (command === "event list") params.set("RecordSize", "1000");
        let raw: unknown;
        try { raw = await client.get(`${path}${params.size ? `?${params}` : ""}`); }
        catch (error) { if (data.length && error instanceof AxiError && error.code === "LIMIT_EXCEEDED") { more = true; break; } throw error; }
        const schema = Object.values(spec.paths[selectedPath]!.get!.responses["200"]?.content ?? {})[0]?.schema;
        const parsed = schema ? validator(schema).safeParse(raw) : undefined;
        if (parsed && !parsed.success) badResponse();
        const value = withoutCredentials(parsed?.success ? parsed.data : raw, redactor);
        if (!list) {
          if (!value || typeof value !== "object" || Array.isArray(value)) badResponse();
          return { data: value };
        }
        let rows: unknown[];
        if (definition.events) {
          const p = z.object({ totalRecordsReturned: z.number().int().nonnegative(), events: z.array(z.unknown()).nullable() }).safeParse(value);
          if (!p.success || p.data.totalRecordsReturned !== (p.data.events?.length ?? 0)) badResponse();
          rows = p.data.events ?? [];
          if (rows.length > (definition.paged ? size : 1000)) badResponse();
          total = null;
          more = definition.paged && rows.length === size;
        } else if (definition.envelope && !definition.paged) {
          const p = z.object({ totalRecordCount: z.number().int().nonnegative(), data: z.array(z.unknown()).nullable() }).safeParse(value);
          if (!p.success) badResponse();
          rows = p.data.data ?? []; total = p.data.totalRecordCount; more = false;
        } else if (definition.paged && !Array.isArray(value)) {
          const p = z.object({ pageNumber: z.literal(page), pageSize: z.literal(size), totalRecordCount: z.number().int().nonnegative(), pageCount: z.number().int().nonnegative(), data: z.array(z.unknown()).nullable() }).safeParse(value);
          if (!p.success || (p.data.data?.length ?? 0) > size) badResponse();
          rows = p.data.data ?? [];
          total = p.data.totalRecordCount;
          more = page < p.data.pageCount;
          if (more && !rows.length) badResponse();
        } else if (definition.scimList) {
          const p = z.object({ totalResults: z.number().int().nonnegative(), startIndex: z.number().int().min(1), itemsPerPage: z.number().int().nonnegative(), Resources: z.array(z.unknown()).nullable() }).safeParse(value);
          if (!p.success) badResponse();
          rows = p.data.Resources ?? [];
          if (p.data.itemsPerPage !== rows.length || (rows.length > 0 && p.data.startIndex + rows.length - 1 > p.data.totalResults) || (definition.scimPaged && (p.data.startIndex !== page || rows.length > size))) badResponse();
          total = p.data.totalResults;
          more = definition.scimPaged && page + rows.length - 1 < total;
          if (more && !rows.length) badResponse();
        } else {
          if (!Array.isArray(value)) badResponse();
          rows = value;
          if (definition.paged && rows.length > size) badResponse();
          total = definition.paged ? null : rows.length;
          more = definition.paged && rows.length === size;
        }
        if (offset > rows.length) badResponse();
        const taken = rows.slice(offset, offset + limit - data.length);
        data.push(...taken.map((row) => {
          if (!definition.events || flags.has("--full")) return row;
          const e = row as { "@timestamp"?: string; host?: { name?: string }; user?: { name?: string }; event?: { action?: string; code?: string }; process?: { name?: string }; file?: { name?: string }; rule?: { name?: string } };
          return { time: e["@timestamp"] ?? null, host: e.host?.name ?? null, user: e.user?.name ?? null, action: e.event?.action ?? null, code: e.event?.code ?? null, application: e.process?.name ?? e.file?.name ?? null, rule: e.rule?.name ?? null };
        })); offset += taken.length;
        if (offset < rows.length) { more = true; break; }
        offset = 0; page += definition.scimPaged ? rows.length : 1;
        if (!more || data.length >= limit) break;
      }
      const next = more ? Buffer.from(JSON.stringify({ version: 1, binding, page, size, offset, ...(definition.events ? { since: cursor?.since, until: cursor?.until } : {}) })).toString("base64url") : null;
      const continuation = [...flags].filter(([flag]) => !["--cursor", "--all", "--limit", "--fields", "--full"].includes(flag))
        .map(([flag, value]) => `${flag} '${redactor.text(value).replaceAll("'", "'\\''")}'`).join(" ");
      return { data, count: data.length, total, cursor: next, help: [next ? `Run beyondtrust-axi ${command}${continuation ? ` ${continuation}` : ""} --cursor <cursor> to continue with the same profile` : `Run beyondtrust-axi ${command} --help for related read options`, ...(definition.events ? ["Repeat with --full for complete redacted ECS events; the API reports returned counts, not a total", ...(command === "event list" ? ["This endpoint returns at most 1000 events from the start date without server pagination; use event search for bounded windows and paging"] : [])] : [])] };
    },
  };
}
