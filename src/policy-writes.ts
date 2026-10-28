import { createHash } from "node:crypto";
import { AxiError } from "axi-sdk-js";
import { z } from "zod";
import { readPrivateBytes } from "./private-file.js";
import { documentedSchema } from "./resource-reads.js";

export const policyWrites: Record<string, { method: "POST" | "PUT"; path: string }[]> = {
  "policy create": [{ method: "POST", path: "/v3/Policies" }],
  "policy update": [{ method: "PUT", path: "/v3/Policies/{id}" }],
  "policy upload": [{ method: "POST", path: "/v3/Policies/{id}/Upload" }],
  "policy auto-assign": [{ method: "POST", path: "/v3/Groups/AutoAssignPolicyRevision" }],
  "policy app add": ["Windows", "MacOS"].map((os) => ({ method: "POST", path: `/PolicyEditor/v3/Policy/{policyId}/${os}/ApplicationGroups/Applications` })),
};
const uuid = z.string().regex(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i);
const policySchema = z.object({ id: uuid, name: z.string().nullable(), description: z.string().nullable() }).passthrough();
function invalid(message: string): never { throw new AxiError(message, "VALIDATION_ERROR", ["Run the command with --help"]); }
function badRead(): never { throw new AxiError("Invalid policy re-read", "API_RESPONSE_INVALID"); }

export function preparePolicyWrite(command: string, ids: string[], flags: Map<string, string>) {
  const routes = policyWrites[command];
  if (!routes) return undefined;
  const create = command === "policy create";
  const apps = command === "policy app add";
  const autoAssign = command === "policy auto-assign";
  const id = ids[0]?.toLowerCase();
  if (create ? ids.length !== 0 : ids.length !== 1 || !uuid.safeParse(id).success) invalid("Provide exactly one policy UUID, or no UUID for create");
  const name = flags.get("--name");
  const description = flags.get("--description");
  if ((create && name === undefined) || (name !== undefined && !name.trim())) invalid("Provide a non-blank --name");
  if (command === "policy update" && name === undefined && description === undefined) invalid("Provide --name or --description");
  const revision = flags.get("--revision")?.toLowerCase();
  if (autoAssign && !uuid.safeParse(revision).success) invalid("--revision must be a UUID");
  const os = flags.get("--os");
  const appGroup = flags.get("--app-group")?.toLowerCase();
  if (apps && ((os !== "windows" && os !== "macos") || !uuid.safeParse(appGroup).success)) invalid("Provide --os windows|macos and --app-group <uuid>");
  const file = flags.get("--file");
  if ((create || apps || command === "policy upload") && !file) invalid("--file is required");
  if (flags.has("--confirm") && !flags.has("--execute")) invalid("--confirm requires --execute");
  const operation = command.replaceAll(" ", ".");
  return {
    operation,
    async prepare(client: { get: (path: string) => Promise<unknown> }) {
      let policyFile: Buffer | undefined;
      let additions: unknown[] | undefined;
      let upload: { size: number; sha256: string } | undefined;
      if (file) {
        let bytes: Buffer;
        try {
          bytes = readPrivateBytes(file, false, true, { maxBytes: 10 * 1024 * 1024 });
          if (!bytes.length) invalid("Provide a non-empty input file");
        } catch (error) {
          if (error instanceof AxiError) throw error;
          invalid("Cannot read a secure input file");
        }
        upload = { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
        if (apps) {
          let data: unknown;
          try { data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { invalid("Provide a JSON array of application additions"); }
          const parsed = z.array(documentedSchema(os === "windows" ? "WinApplicationPayload" : "MacApplicationPayload")).min(1).safeParse(data);
          if (!parsed.success) invalid("Applications must match the documented OS payload schema; only additions are accepted");
          additions = parsed.data;
          const unsupported = ["activeXCodebase", "maxVersion", "minVersion", "serviceConfigure", "serviceDisplayName", "serviceName", "windowsStorePackageName", "windowsStorePublisher"];
          if (additions.some((app) => !app || typeof app !== "object" || !("type" in app) || !app.type || (os === "windows" && unsupported.some((key) => Object.hasOwn(app, key))))) invalid("Provide a supported application type and supported matchers");
        } else policyFile = bytes;
      }
      let policy: z.infer<typeof policySchema> | undefined;
      if (create) {
        const query = new URLSearchParams({ "Filter.Name": name!, "Pagination.PageSize": "20", "Pagination.PageNumber": "1" });
        if (!z.object({ totalRecordCount: z.number().int().nonnegative(), data: z.array(z.object({ id: uuid })).nullable() }).safeParse(await client.get(`/v3/Policies?${query}`)).success) badRead();
      } else {
        const parsed = policySchema.safeParse(await client.get(`/v3/Policies/${id}`));
        if (!parsed.success || parsed.data.id.toLowerCase() !== id) badRead();
        policy = parsed.data;
      }
      let groups: unknown;
      if (autoAssign || flags.has("--auto-assign")) {
        const parsed = z.array(documentedSchema("PolicyGroupsListItemModel").and(z.object({ id: uuid }))).safeParse(await client.get(`/v3/Policies/${id}/AssignedGroups`));
        if (!parsed.success) badRead();
        groups = parsed.data;
      }
      let revisions: unknown;
      if (autoAssign) {
        const parsed = z.array(documentedSchema("PolicyRevisionModel").and(z.object({ id: uuid }))).safeParse(await client.get(`/v3/Policies/${id}/Revisions`));
        if (!parsed.success) badRead();
        if (!parsed.data.some((item) => item.id.toLowerCase() === revision)) invalid("The revision must belong to the selected policy");
        revisions = parsed.data;
      }
      const route = routes[apps && os === "macos" ? 1 : 0]!;
      const path = route.path.replace("{id}", id ?? "").replace("{policyId}", id ?? "");
      let applicationGroups: unknown;
      if (apps) {
        const parsed = z.array(documentedSchema(os === "windows" ? "PolicyApplicationGroupModel" : "MacPolicyApplicationGroupModel").and(z.object({ id: uuid }))).safeParse(await client.get(`${path.slice(0, -"/Applications".length)}?Filter.ApplicationGroupId=${appGroup}`));
        if (!parsed.success || parsed.data.length !== 1 || parsed.data[0]!.id.toLowerCase() !== appGroup) badRead();
        applicationGroups = parsed.data;
      }
      const body = create ? { Name: name, ...(description !== undefined ? { Description: description } : {}), PolicyFile: upload }
        : command === "policy upload" ? { PolicyFile: upload, AutoAssignToGroup: flags.has("--auto-assign") }
          : command === "policy update" ? { name: name ?? policy!.name, description: description ?? policy!.description }
            : autoAssign ? { policyId: id, policyRevisionId: revision }
              : { applicationData: { applicationGroups: { edit: [{ id: appGroup, applications: { add: additions } }] } } };
      const preview = { ...(policy ? { policy } : {}), request: body, ...(upload ? { file: upload } : {}), ...(groups ? { groups } : {}), ...(revisions ? { revisions } : {}), ...(applicationGroups ? { applicationGroups } : {}), ...(command === "policy update" ? { diff: { before: { name: policy!.name, description: policy!.description }, after: body } } : {}) };
      const digest = createHash("sha256").update(JSON.stringify(preview)).digest("hex");
      return { path, method: route.method, body, policyFile, preview, confirmation: `${operation} ${id ?? ""}${upload ? ` sha256 ${upload.sha256}` : ""} state ${digest}` };
    },
  };
}
