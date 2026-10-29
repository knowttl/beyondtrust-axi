import { createHash } from "node:crypto";
import { AxiError } from "axi-sdk-js";
import { z } from "zod";
import { readPrivateBytes } from "./private-file.js";
import { documentedSchema, withoutCredentials } from "./resource-reads.js";
import type { SecretRedactor } from "./redact.js";

export const jitWrites: Record<string, { path: string; schema: string; file?: boolean; method: "POST" }> = {
  "admin-request create": { method: "POST", path: "/v3/AdminAccessRequest", schema: "ExternalAdminRequestModel" },
  "admin-request decide": { method: "POST", path: "/v3/AdminAccessRequest/approval", schema: "AdminRequestDecisionModel" },
  "auth-request notify": { method: "POST", path: "/v3/AuthorizationRequest/notification", schema: "AuthorizationRequestNotificationModel", file: true },
  "app-switcher connect": { method: "POST", path: "/v3/AppSwitcher/connector", schema: "AppSwitcherRequest", file: true },
};
const uuid = z.string().regex(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i);
const notificationFields = ["decision", "decisionPerformedByUser", "decisionTime", "duration", "itsmRequestId", "message", "status", "systemId", "ticketId", "ticketUrl"];
function invalid(message: string): never { throw new AxiError(message, "VALIDATION_ERROR", ["Run the command with --help"]); }
function badRead(): never { throw new AxiError("Invalid JIT re-read", "API_RESPONSE_INVALID"); }

export function prepareJitWrite(command: string, args: string[], flags: Map<string, string>, redactor: SecretRedactor) {
  const route = jitWrites[command];
  if (!route) return undefined;
  const decide = command === "admin-request decide";
  if (args.length !== (decide ? 1 : 0) || (decide && !uuid.safeParse(args[0]).success)) invalid("Provide the documented positional request UUID");
  if (flags.has("--confirm") && !flags.has("--execute")) invalid("--confirm requires --execute");
  if (route.file && !flags.has("--file")) invalid("--file is required");
  const decision = flags.get("--decision");
  if ((decide && !decision) || (decision !== undefined && !(decide ? ["approve", "deny"] : ["approve"]).includes(decision))) invalid(decide ? "--decision must be approve or deny" : "--decision must be approve");
  if ((decision !== undefined) !== flags.has("--by")) invalid("--decision and --by must be provided together");
  if (flags.has("--by") && !flags.get("--by")!.trim()) invalid("--by requires a decision maker");
  if (command === "admin-request create" && (!uuid.safeParse(flags.get("--computer")).success || !flags.get("--user")?.trim())) invalid("--computer UUID and --user are required");
  const operation = command.replaceAll(" ", ".");
  return {
    operation,
    async prepare(client: { get: (path: string) => Promise<unknown> }) {
      let body: Record<string, unknown> = {};
      let file: { size: number; sha256: string } | undefined;
      if (route.file) {
        let bytes: Buffer;
        try {
          bytes = readPrivateBytes(flags.get("--file")!, false, true, { maxBytes: 10 * 1024 * 1024 });
          body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        } catch { invalid("Provide a secure UTF-8 JSON file of at most 10 MiB"); }
        file = { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
      } else {
        body = decide ? { requestId: args[0]!.toLowerCase() } : { computerId: flags.get("--computer")!.toLowerCase(), userId: flags.get("--user") };
        for (const [flag, field] of Object.entries({ by: "decisionPerformedByUser", ...(decide ? { duration: "duration", message: "message" } : {}) })) {
          if (flags.has(`--${flag}`)) body[field] = flags.get(`--${flag}`);
        }
        if (decision) body.decision = decision === "approve" ? "Approved" : "Denied";
      }
      const parsed = documentedSchema(route.schema).safeParse(body);
      if (!parsed.success) invalid("Input must match the committed request schema");
      body = parsed.data as Record<string, unknown>;
      if (command === "auth-request notify" && notificationFields.some((field) => typeof body[field] !== "string" || !(body[field] as string).length)) invalid("All ten notification fields are required non-empty strings");
      withoutCredentials(body, redactor);
      let current: unknown;
      let warning: string | undefined;
      if (command === "admin-request create") {
        current = await client.get(`/v3/Computers/${body.computerId}`);
        const read = documentedSchema("ComputerDetailModel").and(z.object({ id: uuid })).safeParse(current);
        if (!read.success || read.data.id.toLowerCase() !== body.computerId) badRead();
      } else if (decide) {
        current = await client.get(`/v3/AdminAccessRequest/${body.requestId}`);
        const read = z.array(documentedSchema("AdminAccessRequestModel").and(z.object({ requestInfo: z.object({ requestId: uuid }) }))).nonempty().safeParse(current);
        if (!read.success || read.data.some((item) => item.requestInfo.requestId.toLowerCase() !== body.requestId)) badRead();
      } else if (command === "auth-request notify") {
        current = await client.get(`/v3/AuthorizationRequest/${encodeURIComponent(body.systemId as string)}`);
        if (!z.array(documentedSchema("AuthorizationRequestDetailsModel")).nonempty().safeParse(current).success) badRead();
      } else {
        current = await client.get("/v3/About");
        if (!z.array(documentedSchema("AboutModel")).nonempty().safeParse(current).success) badRead();
        warning = "The export has no connector read endpoint; API access was checked, existing connector state cannot be re-read";
      }
      if ((command === "admin-request create" || decide) && body.decision === "Approved") warning = command === "admin-request create" ? "Creates a pre-approved request and grants admin rights" : "Approves the request and grants admin rights";
      withoutCredentials(current, redactor);
      const preview = { current, request: body, ...(file ? { file } : {}), ...(warning ? { warning } : {}) };
      const digest = createHash("sha256").update(JSON.stringify(preview)).digest("hex");
      return { path: route.path, method: route.method, body, preview, confirmation: `${operation}${file ? ` sha256 ${file.sha256}` : ""} state ${digest}` };
    },
  };
}
