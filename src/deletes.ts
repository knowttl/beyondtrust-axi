import { createHash } from "node:crypto";
import { AxiError } from "axi-sdk-js";
import { z } from "zod";
import { prepareComputerSelection } from "./computer-writes.js";
import { documentedSchema } from "./resource-reads.js";

export const deletes: Record<string, { method: "DELETE" | "POST" | "PATCH"; path: string }[]> = {
  "computer delete": [{ method: "DELETE", path: "/v3/Computers" }],
  "computer deactivate": [{ method: "POST", path: "/v3/Computers/Deactivate" }],
  "group delete": [{ method: "DELETE", path: "/v3/Groups/{id}" }],
  "domain delete": [{ method: "DELETE", path: "/v3/AcceptedDomains/{id}" }],
  "policy delete": [{ method: "DELETE", path: "/v3/Policies/{id}" }],
  "policy discard-draft": [{ method: "PATCH", path: "/v3/Policies/{id}/DiscardDraft" }],
  "policy app remove": ["Windows", "MacOS"].map((os) => ({ method: "POST", path: `/PolicyEditor/v3/Policy/{policyId}/${os}/ApplicationGroups/Applications` })),
};
const uuid = z.string().regex(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i);
function invalid(message: string): never { throw new AxiError(message, "VALIDATION_ERROR", ["Run the command with --help"]); }
function badRead(): never { throw new AxiError("Invalid delete target re-read", "API_RESPONSE_INVALID"); }

export function prepareDelete(command: string, args: string[], flags: Map<string, string>) {
  const routes = deletes[command];
  if (!routes) return undefined;
  const operation = command.replaceAll(" ", ".");
  const computer = command.startsWith("computer ");
  const apps = command === "policy app remove";
  const ids = args.map((id) => id.toLowerCase());
  const id = ids[0]!;
  const appIds = ids.slice(1);
  const selection = computer ? prepareComputerSelection(ids, flags) : undefined;
  if (!computer && (ids.length < 1 || ids.length > (apps ? 21 : 1) || ids.some((value) => !uuid.safeParse(value).success) || (apps && (!appIds.length || new Set(appIds).size !== appIds.length)))) invalid("Provide a target UUID and, for app removal, 1 to 20 distinct application UUIDs");
  const os = flags.get("--os");
  const appGroup = flags.get("--app-group")?.toLowerCase();
  if (apps && ((os !== "windows" && os !== "macos") || !uuid.safeParse(appGroup).success)) invalid("Provide --os windows|macos and --app-group <uuid>");
  if (!flags.has("--execute") && (flags.has("--confirm") || flags.has("--confirm-delete"))) invalid("Confirmation flags require --execute");
  return {
    operation,
    async prepare(client: { get: (path: string) => Promise<unknown> }) {
      const route = routes[apps && os === "macos" ? 1 : 0]!;
      let path = route.path.replace("{id}", id ?? "").replace("{policyId}", id ?? "");
      let body: unknown;
      let preview: Record<string, unknown>;
      let count = apps ? appIds.length : 1;
      let targets: string;
      if (selection) {
        const current = await selection.prepare(client);
        preview = current.preview;
        count = current.preview.count;
        targets = `${current.confirmation} hosts ${JSON.stringify(preview.hosts)}`;
        body = selection.query ? { filter: selection.filter, allComputers: true } : { computerIds: ids, allComputers: false };
        if (command === "computer deactivate") preview.warning = [preview.warning, "Archives and deletes the selected computers"].filter(Boolean).join(" ");
      } else {
        const readPath = command.startsWith("group ") ? `/v3/Groups/${id}` : command.startsWith("domain ") ? `/v3/AcceptedDomains/${id}` : `/v3/Policies/${id}`;
        const current = await client.get(readPath);
        const nameField = command === "domain delete" ? "domain" : "name";
        const parsed = z.object({ [nameField]: z.string().nullable().optional() }).passthrough().and(z.object({ id: uuid })).safeParse(current);
        if (!parsed.success || parsed.data.id.toLowerCase() !== id) badRead();
        preview = { current };
        targets = `${id} ${JSON.stringify(parsed.data[nameField] ?? id)}`;
        if (command === "policy delete") {
          const groups = await client.get(`/v3/Policies/${id}/AssignedGroups`);
          if (!z.array(documentedSchema("PolicyGroupsListItemModel").and(z.object({ id: uuid }))).safeParse(groups).success) badRead();
          preview.groups = groups;
          preview.force = flags.has("--force");
          path += `?forceDelete=${flags.has("--force")}`;
        }
        if (command === "policy discard-draft") preview.warning = "Irreversibly discards policy draft changes";
        if (apps) {
          const groups = await client.get(`${path.slice(0, -"/Applications".length)}?Filter.ApplicationGroupId=${appGroup}`);
          const parsedGroups = z.array(documentedSchema(os === "windows" ? "PolicyApplicationGroupModel" : "MacPolicyApplicationGroupModel").and(z.object({ id: uuid, applications: z.array(z.object({ id: uuid, description: z.string().nullable().optional() })).nullable() }))).safeParse(groups);
          if (!parsedGroups.success || parsedGroups.data.length !== 1 || parsedGroups.data[0]!.id.toLowerCase() !== appGroup) badRead();
          const applications = parsedGroups.data[0]!.applications ?? [];
          if (appIds.some((appId) => applications.filter((app) => app.id.toLowerCase() === appId).length !== 1)) invalid("Every application must belong to the selected application group");
          preview.applicationGroups = groups;
          targets = `${id} ${os} group ${appGroup} applications ${JSON.stringify(appIds.map((appId) => ({ id: appId, name: applications.find((app) => app.id.toLowerCase() === appId)!.description ?? appId })))}`;
          body = { applicationData: { applicationGroups: { edit: [{ id: appGroup, applications: { delete: appIds } }] } } };
        }
      }
      preview.request = { method: route.method, path, body };
      const digest = createHash("sha256").update(JSON.stringify(preview)).digest("hex");
      return { path, method: route.method, body, preview, confirmation: `${operation} ${count} state ${digest}`, deleteConfirmation: `DELETE ${operation} ${count} ${targets}` };
    },
  };
}
