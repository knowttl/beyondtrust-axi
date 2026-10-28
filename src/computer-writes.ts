import { AxiError } from "axi-sdk-js";
import { z } from "zod";
import { prepareResourceRead, resourceReadDefinition } from "./resource-reads.js";

export const computerWrites: Record<string, string[]> = {
  "computer authorise": ["/v3/Computers/Authorise"],
  "computer reject": ["/v3/Computers/Reject"],
  "computer archive": ["/v3/Computers/{computerId}/archive", "/v3/Computers/archive"],
  "computer unarchive": ["/v3/Computers/{computerId}/Unarchive", "/v3/Computers/Unarchive"],
  "computer logs request": ["/v3/Computers/Logs/Request"],
  "computer details request": ["/v3/Computers/Details/Request"],
};
const uuid = z.string().regex(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i);
const definition = resourceReadDefinition("computer list", "/v3/Computers");
export const computerWriteFilters = Object.fromEntries(Object.entries(definition.flags).filter(([flag]) => !["limit", "all", "cursor", "sort"].includes(flag)));
function invalid(message: string): never { throw new AxiError(message, "VALIDATION_ERROR", ["Run the command with --help"]); }

export function prepareComputerWrite(command: string, inputIds: string[], flags: Map<string, string>) {
  const paths = computerWrites[command];
  if (!paths) return undefined;
  const ids = inputIds.map((id) => id.toLowerCase());
  const single = command.endsWith(" request");
  const filterFlags = new Map([...flags].filter(([flag]) => Object.hasOwn(computerWriteFilters, flag.slice(2))));
  const filtered = filterFlags.size > 0;
  if ([...filterFlags.values()].some((value) => !value.trim())) invalid("Filter values must not be blank");
  if (filtered && (command !== "computer authorise" || ids.length)) invalid("Filters are supported only for authorise and cannot be combined with IDs");
  if (!filtered && (!ids.length || ids.length > (single ? 1 : 20) || new Set(ids).size !== ids.length || ids.some((id) => !uuid.safeParse(id).success))) invalid(single ? "Provide exactly one computer UUID" : "Provide 1 to 20 distinct computer UUIDs or an authorise filter selection");
  const group = flags.get("--group")?.toLowerCase();
  if (group !== undefined && !uuid.safeParse(group).success) invalid("--group must be a UUID");
  if (!flags.has("--execute") && flags.has("--confirm")) invalid("--confirm requires --execute");
  const query = filtered ? prepareResourceRead("computer list", filterFlags, definition)!.query : undefined;
  const filter: Record<string, unknown> = {};
  if (query) for (const parameter of definition.filters) {
    const values = query.getAll(parameter.name);
    if (!values.length) continue;
    const parts = parameter.name.slice(7).split(".").map((part) => part === "OS" ? "os" : part[0]!.toLowerCase() + part.slice(1));
    let target = filter;
    for (const part of parts.slice(0, -1)) target = (target[part] ??= {}) as Record<string, unknown>;
    const schema = parameter.schema;
    target[parts.at(-1)!] = schema.type === "array" ? values : schema.type === "integer" ? Number(values[0]) : schema.type === "boolean" ? values[0] === "true" : values[0];
  }
  const operation = command.replaceAll(" ", ".");
  return {
    operation,
    async prepare(client: { get: (path: string) => Promise<unknown> }) {
      if (group) {
        const data = await client.get(`/v3/Groups/${group}`);
        if (!z.object({ id: uuid }).safeParse(data).success || (data as { id: string }).id.toLowerCase() !== group) throw new AxiError("Invalid group re-read", "API_RESPONSE_INVALID");
      }
      let count = ids.length;
      const hosts: string[] = [];
      if (query) {
        query.set("Pagination.PageSize", "20"); query.set("Pagination.PageNumber", "1");
        const parsed = z.object({ pageNumber: z.literal(1), pageSize: z.literal(20), totalRecordCount: z.number().int().nonnegative().safe(), data: z.array(z.object({ id: uuid, host: z.string().nullable().optional() })).max(20).nullable() }).safeParse(await client.get(`/v3/Computers?${query}`));
        if (!parsed.success || (parsed.data.data?.length ?? 0) !== Math.min(20, parsed.data.totalRecordCount)) throw new AxiError("Invalid filter count response", "API_RESPONSE_INVALID");
        count = parsed.data.totalRecordCount;
        hosts.push(...(parsed.data.data ?? []).map((row) => row.host ?? row.id));
        if (!count) invalid("Filter selection matches no computers");
      } else for (const id of ids) {
        const parsed = z.object({ id: uuid, endpointInformation: z.object({ systemDnsHostName: z.string().nullable().optional() }).nullable().optional() }).safeParse(await client.get(`/v3/Computers/${id}`));
        if (!parsed.success || parsed.data.id.toLowerCase() !== id) throw new AxiError("Invalid computer re-read", "API_RESPONSE_INVALID");
        hosts.push(parsed.data.endpointInformation?.systemDnsHostName ?? id);
      }
      let path = paths[0]!;
      let body: unknown = single ? { computerId: ids[0] } : { computerIds: ids };
      if (paths.length > 1) {
        path = ids.length === 1 ? path.replace("{computerId}", ids[0]!) : paths[1]!;
        if (ids.length === 1) body = undefined;
      }
      if (command === "computer authorise" || command === "computer reject") body = { ...(query ? { filter, allComputers: true } : { computerIds: ids, allComputers: false }), ...(group ? { groupId: group } : {}) };
      const selection = query ? `filter ${count} computers ${JSON.stringify(filter)}` : ids.join(" ");
      return { path, body, confirmation: `${operation} ${selection}${group ? ` group ${group}` : ""}`, preview: { count, hosts, ...(query ? { filter, warning: "The server re-applies this filter at execution; membership can change after this count. No maximum count is imposed." } : { ids }), ...(group ? { group } : {}) } };
    },
  };
}
