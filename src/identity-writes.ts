import { createHash } from "node:crypto";
import { AxiError } from "axi-sdk-js";
import { z } from "zod";
import { readPrivateBytes } from "./private-file.js";
import { documentedSchema, withoutCredentials } from "./resource-reads.js";
import type { SecretRedactor } from "./redact.js";

export const identityWrites: Record<string, { method: "POST" | "PUT" | "PATCH"; path: string; schema?: string; operation?: string }> = {
  "user create": { method: "POST", path: "/v3/Users", schema: "V3CreateUserRequest" },
  "user update": { method: "PUT", path: "/v3/Users/{id}", schema: "ModifyUserRequest" },
  "user preferences set": { method: "PUT", path: "/v3/Users/{id}/ModifyUserPreferences", schema: "ModifyUserPreferencesRequest", operation: "user.preferences" },
  "user assign-roles": { method: "POST", path: "/v3/Users/{id}/AssignRoles", schema: "V3AssignUserToRolesRequest" },
  "user disable": { method: "PATCH", path: "/v3/Users/{id}/Disable" },
  "user enable": { method: "PATCH", path: "/v3/Users/{id}/Enable" },
  "user resend-invite": { method: "PATCH", path: "/v3/Users/{id}/ResendInvite" },
  "domain create": { method: "POST", path: "/v3/AcceptedDomains" },
  "domain update": { method: "PUT", path: "/v3/AcceptedDomains/{id}" },
  "scim user create": { method: "POST", path: "/scim/v3/users", schema: "ScimUserModelV3" },
  "scim user replace": { method: "PUT", path: "/scim/v3/users/{userID}", schema: "ScimUserModelV3" },
  "scim user patch": { method: "PATCH", path: "/scim/v3/users/{userID}", schema: "ScimUserPatchRequest" },
};
const uuid = z.string().regex(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i);
function invalid(message: string): never { throw new AxiError(message, "VALIDATION_ERROR", ["Run the command with --help"]); }
function badRead(): never { throw new AxiError("Invalid identity re-read", "API_RESPONSE_INVALID"); }

export function prepareIdentityWrite(command: string, args: string[], flags: Map<string, string>, redactor: SecretRedactor) {
  const route = identityWrites[command];
  if (!route) return undefined;
  const domain = command.startsWith("domain ");
  const scim = command.startsWith("scim ");
  const create = command.endsWith(" create");
  const id = create ? undefined : args[0]?.toLowerCase();
  if (args.length !== (create ? 0 : 1) + (domain ? 1 : 0) || (!create && !uuid.safeParse(id).success)) invalid("Provide the documented positional arguments and a valid target UUID");
  const domainName = domain ? args.at(-1) : undefined;
  if (domain && !domainName?.trim()) invalid("Provide a non-blank domain");
  if (route.schema && !flags.has("--file")) invalid("--file is required");
  if (flags.has("--confirm") && !flags.has("--execute")) invalid("--confirm requires --execute");
  const operation = route.operation ?? command.replaceAll(" ", ".");
  return {
    operation,
    async prepare(client: { get: (path: string) => Promise<unknown> }) {
      let body: Record<string, unknown> | undefined;
      let file: { size: number; sha256: string } | undefined;
      if (route.schema) {
        let bytes: Buffer;
        let data: unknown;
        try {
          bytes = readPrivateBytes(flags.get("--file")!, false, true, { maxBytes: 10 * 1024 * 1024 });
          data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        } catch { invalid("Provide a secure UTF-8 JSON file of at most 10 MiB"); }
        const parsed = documentedSchema(route.schema).safeParse(data);
        if (!parsed.success) invalid("Input must match the committed request schema");
        body = parsed.data as Record<string, unknown>;
        file = { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
        withoutCredentials(body, redactor);
        if (Array.isArray(body.operations)) for (const op of body.operations) {
          if (typeof op.path === "string" && op.path.toLowerCase() === "password" && Array.isArray(op.value)) for (const value of op.value) if (typeof value.value === "string") redactor.add(value.value);
        }
      }
      if (domain) body = { domainName };
      const path = route.path.replace("{id}", id ?? "").replace("{userID}", id ?? "");
      let current: unknown;
      if (create) {
        const readPath = domain ? "/v3/AcceptedDomains" : scim ? `/scim/v3/users?${new URLSearchParams({ count: "1", startIndex: "1", ...(typeof body?.userName === "string" ? { filter: `userName eq ${JSON.stringify(body.userName)}` } : {}) })}` : `/v3/Users?${new URLSearchParams({ "Pagination.PageSize": "1", "Pagination.PageNumber": "1", ...(typeof body?.emailAddress === "string" ? { "Filter.EmailAddress": body.emailAddress } : {}) })}`;
        current = await client.get(readPath);
        const schema = domain ? z.array(documentedSchema("AcceptedDomainListItemModel")) : scim ? z.object({ totalResults: z.number().int().nonnegative() }) : z.object({ totalRecordCount: z.number().int().nonnegative(), data: z.array(documentedSchema("V3UserListItemModel")).nullable() });
        if (!schema.safeParse(current).success) badRead();
      } else {
        current = await client.get(domain ? `/v3/AcceptedDomains/${id}` : scim ? `/scim/v3/users/${id}` : `/v3/Users/${id}`);
        const parsed = documentedSchema(domain ? "AcceptedDomainDetailModel" : scim ? "ScimUserModelV3" : "V3UserDetailModel").and(z.object({ id: uuid })).safeParse(current);
        if (!parsed.success || parsed.data.id.toLowerCase() !== id) badRead();
        current = parsed.data;
      }
      withoutCredentials(current, redactor);
      const deactivates = scim && (body?.active === false || (Array.isArray(body?.operations) && body.operations.some((op) => Array.isArray(op.value) && op.value.some((value: Record<string, unknown>) => value.active === false || (typeof op.path === "string" && op.path.toLowerCase() === "active" && (value.valueBoolean === false || value.value === "false"))))));
      const preview = { current, ...(body ? { request: body } : {}), ...(file ? { file } : {}), ...(command === "user create" ? { roles: { roleResource: body?.roleResource ?? [], globalRolesIds: body?.globalRolesIds ?? [], groupRoles: body?.groupRoles ?? [], policyRoles: body?.policyRoles ?? [] }, admin: body?.admin ?? false } : {}), ...(deactivates ? { warning: "deactivates user" } : command === "user resend-invite" ? { warning: "sends an invitation email" } : {}) };
      // Digest the unredacted state so secret changes still invalidate confirmation.
      const digest = createHash("sha256").update(JSON.stringify(preview)).digest("hex");
      return { path, method: route.method, body, preview, confirmation: `${operation} ${id ?? ""}${file ? ` sha256 ${file.sha256}` : ""} state ${digest}` };
    },
  };
}
