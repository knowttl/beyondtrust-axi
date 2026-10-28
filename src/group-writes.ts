import { createHash } from "node:crypto";
import { AxiError } from "axi-sdk-js";
import { z } from "zod";
import { prepareComputerSelection } from "./computer-writes.js";
import { readPrivateBytes } from "./private-file.js";

export const groupWrites: Record<string, { method: "POST" | "PUT" | "PATCH"; path: string }[]> = {
  "group create": [{ method: "POST", path: "/v3/Groups" }],
  "group update": [{ method: "PUT", path: "/v3/Groups" }],
  "group set-default": [{ method: "PATCH", path: "/v3/Groups/{id}/MarkAsDefault" }],
  "group assign-policy": [{ method: "POST", path: "/v3/Groups/{id}/AssignPolicyRevision" }, { method: "POST", path: "/v3/Groups/AssignPolicyToMultipleGroups" }],
  "group clear-policy": [{ method: "PATCH", path: "/v3/Groups/{id}/ClearPolicy" }, { method: "POST", path: "/v3/Groups/bulkclearpolicy" }],
  "group add-computers": [{ method: "POST", path: "/v3/Groups/{id}/AssignComputers" }],
  "group import-computers": [{ method: "POST", path: "/v3/Groups/{id}/AssignComputersByCsv" }],
  "group remove-computers": [{ method: "POST", path: "/v3/Groups/UnassignComputers" }],
};
const uuid = z.string().regex(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i);
const text = z.string().nullable();
const groupSchema = z.object({ id: uuid, name: text.optional(), description: text.optional(), policyId: uuid.nullable().optional(), policyRevisionId: uuid.nullable().optional(), policyName: text.optional() });
function invalid(message: string): never { throw new AxiError(message, "VALIDATION_ERROR", ["Run the command with --help"]); }
function badRead(): never { throw new AxiError("Invalid group re-read", "API_RESPONSE_INVALID"); }

export function prepareGroupWrite(command: string, inputIds: string[], flags: Map<string, string>) {
  const routes = groupWrites[command];
  if (!routes) return undefined;
  const ids = inputIds.map((id) => id.toLowerCase());
  const create = command === "group create";
  const membership = command === "group add-computers" || command === "group remove-computers";
  const remove = command === "group remove-computers";
  const groupIds = create || remove ? [] : membership ? ids.slice(0, 1) : ids;
  if (groupIds.some((id) => !uuid.safeParse(id).success) || new Set(groupIds).size !== groupIds.length || groupIds.length > 20) invalid("Provide 1 to 20 distinct group UUIDs");
  if (create ? ids.length !== 0 : !remove && (!groupIds.length || (routes.length === 1 && groupIds.length !== 1))) invalid("Invalid number of group UUIDs");
  const selection = membership ? prepareComputerSelection(remove ? ids : ids.slice(1), flags) : undefined;
  const name = flags.get("--name");
  const description = flags.get("--description");
  if ((create && name === undefined) || (name !== undefined && !name.trim())) invalid("Provide a non-blank --name");
  if (command === "group update" && name === undefined && description === undefined) invalid("Provide --name or --description");
  const revision = flags.get("--revision")?.toLowerCase();
  if (command === "group assign-policy" && !uuid.safeParse(revision).success) invalid("--revision must be a UUID");
  const file = flags.get("--file");
  if (command === "group import-computers" && !file) invalid("--file is required");
  if (flags.has("--confirm") && !flags.has("--execute")) invalid("--confirm requires --execute");
  const operation = command.replaceAll(" ", ".");
  return {
    operation,
    async prepare(client: { get: (path: string) => Promise<unknown> }) {
      let csv: Buffer | undefined;
      let upload: { size: number; sha256: string } | undefined;
      if (file) {
        try {
          csv = readPrivateBytes(file, false, true, { maxBytes: 10 * 1024 * 1024 });
          if (!csv.length || !new TextDecoder("utf-8", { fatal: true }).decode(csv).trim() || csv.includes(0)) invalid("Provide a non-empty UTF-8 CSV file");
        } catch (error) {
          if (error instanceof AxiError) throw error;
          invalid("Cannot read a secure UTF-8 CSV file");
        }
        upload = { size: csv.length, sha256: createHash("sha256").update(csv).digest("hex") };
      }
      const groups: z.infer<typeof groupSchema>[] = [];
      for (const id of groupIds) {
        const parsed = groupSchema.safeParse(await client.get(`/v3/Groups/${id}`));
        if (!parsed.success || parsed.data.id.toLowerCase() !== id) badRead();
        groups.push(parsed.data);
      }
      if (create) {
        // Creation has no target ID; read the scoped group collection before preview or send.
        const existing = z.object({ totalRecordCount: z.number().int().nonnegative(), data: z.array(z.object({ id: uuid })).nullable() }).safeParse(await client.get(`/v3/Groups?Filter.Name=${encodeURIComponent(name!)}&Pagination.PageSize=20&Pagination.PageNumber=1`));
        if (!existing.success) badRead();
      }
      const selected = await selection?.prepare(client);
      const route = routes[groupIds.length > 1 ? 1 : 0]!;
      const path = route.path.replace("{id}", groupIds[0] ?? "");
      let body: unknown;
      let diff: Record<string, unknown> | undefined;
      if (create) body = { name, ...(description !== undefined ? { description } : {}), isDefault: flags.has("--default") };
      if (command === "group update") {
        const current = groups[0]!;
        if (current.name === undefined || current.description === undefined) badRead();
        body = { id: groupIds[0], name: name ?? current.name, description: description ?? current.description };
        diff = { before: { name: current.name, description: current.description }, after: body };
      }
      if (command === "group assign-policy") body = { policyRevisionId: revision, ...(groupIds.length > 1 ? { groupIds } : {}) };
      if (command === "group clear-policy") {
        if (groups.some((group) => group.policyRevisionId === undefined || (group.policyRevisionId !== null && !group.policyName))) badRead();
        if (groupIds.length > 1) body = { groupIds };
      }
      if (selection) body = selection.query ? { allComputers: true, filter: selection.filter } : { allComputers: false, [remove ? "selectionComputerIds" : "computerIds"]: selection.ids };
      if (upload) body = { csvFile: upload };
      const preview = { groups, ...(body !== undefined ? { request: body } : {}), ...(diff ? { diff } : {}), ...(selected ? { computers: selected.preview } : {}), ...(command === "group clear-policy" ? { warning: "Endpoints in these groups lose their assigned policy." } : {}) };
      // Bind the current group state, intended change and counted selection to the confirmation.
      const digest = createHash("sha256").update(JSON.stringify(preview)).digest("hex");
      return { path, method: route.method, body, csv, preview, confirmation: `${operation} ${groupIds.join(" ")}${selected ? ` ${selected.confirmation}` : ""}${upload ? ` sha256 ${upload.sha256}` : ""} state ${digest}` };
    },
  };
}
