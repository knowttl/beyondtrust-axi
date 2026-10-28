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
  if (s.enum) result = z.enum(s.enum as [string, ...string[]]);
  else if (s.type === "object") {
    const shape = Object.fromEntries(Object.entries(s.properties ?? {}).map(([key, value]) => [key, validator(value).optional()]));
    result = s.additionalProperties === false ? z.strictObject(shape) : z.object(shape);
  }
  else if (s.type === "array") result = z.array(validator(s.items!));
  else if (s.type === "integer") result = z.number().int().min(s.minimum ?? -2147483648).max(s.maximum ?? 2147483647);
  else if (s.type === "number") result = z.number().finite();
  else if (s.type === "boolean") result = z.boolean();
  else result = s.format === "uuid" ? z.string().regex(uuid) : z.string();
  return s.nullable ? result.nullable() : result;
}
function filterFlag(name: string): string { return name.slice(7).replace(/([a-z0-9])([A-Z])/g, "$1-$2").replaceAll(".", "-").toLowerCase(); }
export function resourceReadDefinition(command: string, path: string) {
  const operation = spec.paths[path]!.get!;
  const paged = command.endsWith(" list");
  const list = paged || !command.endsWith(" view");
  const filters = (operation.parameters ?? []).filter((p) => p.name.startsWith("Filter."));
  const flags: Record<string, string> = {};
  if (path.includes("{")) flags.id = "Required resource UUID";
  if (list) Object.assign(flags, { limit: "Maximum rows, 1-1000 (default: 50)", all: "Read up to 1000 rows within 10 requests, 60 seconds and 8 MiB", cursor: "Resume an opaque cursor with the same profile, command and filters" });
  if (paged && command !== "computer list") flags.sort = "Sort property and order, e.g. name:asc (default: created:asc)";
  for (const p of filters) flags[filterFlag(p.name)] = `Filter ${p.name.slice(7).replaceAll(".", " ")} (${resolved(p.schema).enum?.join("|") ?? resolved(p.schema).type}${resolved(p.schema).type === "array" ? "; comma-separated" : ""})`;
  return { path, paged, list, filters, flags, description: `Read ${command.replaceAll("-", " ")} (GET ${path})`, examples: [`beyondtrust-axi ${command}${path.includes("{") ? " --id <uuid>" : ""}`, `beyondtrust-axi ${command} --help`] };
}

function invalid(message: string): never { throw new AxiError(message, "VALIDATION_ERROR", ["Repeat the command with --help; resume cursors with the original profile, command and filters"]); }
function badResponse(): never { throw new AxiError("API response does not match the documented schema", "API_RESPONSE_INVALID", ["Check API compatibility"]); }
const cursorSchema = z.strictObject({ version: z.literal(1), binding: z.string(), page: z.number().int().min(1).max(2147483647), size: z.number().int().min(1).max(200), offset: z.number().int().nonnegative().max(2147483647) });

// Validation runs before credential resolution; cursors carry only positions and a context digest.
export function prepareResourceRead(command: string, flags: Map<string, string>, definition?: ReturnType<typeof resourceReadDefinition>) {
  if (!definition) return undefined;
  const id = flags.get("--id");
  if (definition.path.includes("{") && !uuid.test(id ?? "")) invalid("This command requires --id <uuid>");
  if (flags.has("--all") && flags.has("--limit")) invalid("Use either --limit or --all");
  const rawLimit = flags.get("--limit") ?? "50";
  if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 1000) invalid("--limit must be an integer from 1 to 1000");
  const limit = flags.has("--all") ? 1000 : Number(rawLimit);
  const query = new URLSearchParams();
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
  for (const prefix of ["Created", "LastConnected"]) {
    const dates = query.getAll(`Filter.${prefix}.Dates`);
    const mode = query.get(`Filter.${prefix}.SelectionMode`);
    if ((dates.length > 0) !== (mode !== null) || (mode === "Single" && dates.length !== 1) || (mode === "Range" && (dates.length !== 2 || Date.parse(dates[0]!) > Date.parse(dates[1]!)))) invalid("Date filters require dates and a matching selection mode");
  }
  const min = query.get("Filter.DuplicateCount.Min"), max = query.get("Filter.DuplicateCount.Max");
  if (min !== null && max !== null && Number(min) > Number(max)) invalid("Duplicate count minimum exceeds maximum");
  if (definition.paged) {
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
  const path = definition.path.replace(/\{[^}]+\}/, id ?? "");
  return {
    fields: definition.list ? ["data", "count", "total", "cursor", "help"] : ["data"],
    async run(client: { get: (path: string) => Promise<unknown> }, context: string, redactor: SecretRedactor) {
      const binding = createHash("sha256").update(JSON.stringify([context, command, path, query.toString()])).digest("hex");
      if (cursor && cursor.binding !== binding) invalid("Cursor does not match this profile, command or filters");
      let page = cursor?.page ?? 1, offset = cursor?.offset ?? 0;
      const size = cursor?.size ?? Math.min(limit, 200);
      const data: unknown[] = [];
      let total = 0, more = false;
      for (;;) {
        const params = new URLSearchParams(query);
        if (definition.paged) { params.set("Pagination.PageSize", String(size)); params.set("Pagination.PageNumber", String(page)); }
        let raw: unknown;
        try { raw = await client.get(`${path}${params.size ? `?${params}` : ""}`); }
        catch (error) { if (data.length && error instanceof AxiError && error.code === "LIMIT_EXCEEDED") { more = true; break; } throw error; }
        const schema = spec.paths[definition.path]!.get!.responses["200"]?.content?.["application/json"]?.schema;
        const parsed = schema ? validator(schema).safeParse(raw) : undefined;
        if (parsed && !parsed.success) badResponse();
        const value = parsed?.success ? parsed.data : raw;
        if (!definition.list) {
          if (!value || typeof value !== "object" || Array.isArray(value)) badResponse();
          return { data: value };
        }
        let rows: unknown[];
        if (definition.paged) {
          const p = z.object({ pageNumber: z.literal(page), pageSize: z.literal(size), totalRecordCount: z.number().int().nonnegative(), pageCount: z.number().int().nonnegative(), data: z.array(z.unknown()).nullable() }).safeParse(value);
          if (!p.success || (p.data.data?.length ?? 0) > size) badResponse();
          rows = p.data.data ?? [];
          total = p.data.totalRecordCount;
          more = page < p.data.pageCount;
          if (more && !rows.length) badResponse();
        } else {
          if (!Array.isArray(value)) badResponse();
          rows = value; total = rows.length; more = false;
        }
        if (offset > rows.length) badResponse();
        const taken = rows.slice(offset, offset + limit - data.length);
        data.push(...taken); offset += taken.length;
        if (offset < rows.length) { more = true; break; }
        offset = 0; page++;
        if (!more || data.length >= limit) break;
      }
      const next = more ? Buffer.from(JSON.stringify({ version: 1, binding, page, size, offset })).toString("base64url") : null;
      const continuation = [...flags].filter(([flag]) => !["--cursor", "--all", "--limit", "--fields", "--full"].includes(flag))
        .map(([flag, value]) => `${flag} '${redactor.text(value).replaceAll("'", "'\\''")}'`).join(" ");
      return { data, count: data.length, total, cursor: next, help: [next ? `Run beyondtrust-axi ${command}${continuation ? ` ${continuation}` : ""} --cursor <cursor> to continue with the same profile` : `Run beyondtrust-axi ${command} --help for related read options`] };
    },
  };
}
