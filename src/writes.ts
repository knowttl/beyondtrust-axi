import { randomUUID } from "node:crypto";
import { lstat, mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AxiError } from "axi-sdk-js";
import { newPrivateFile } from "./private-file.js";
import type { SelectedProfile } from "./profiles.js";
import type { SecretRedactor } from "./redact.js";

export class UnknownWriteOutcome extends AxiError {
  constructor(readonly auditId: string) {
    super("Write outcome is unknown; do not replay the request", "OUTCOME_UNKNOWN", [`Reconcile the remote state and auditId ${auditId} before taking further action`]);
  }
}

export function requireWritePermission(profile: SelectedProfile, forcedReadOnly: boolean, operation: string): void {
  if (forcedReadOnly || profile.source === "env-profile" || !profile.writes.allowWrites || !profile.writes.operations.includes(operation)) {
    throw new AxiError("Write operation is disabled for this profile", "WRITES_DISABLED", ["Use a named file profile with writes.allowWrites and the exact operation enabled; forced read-only takes precedence"]);
  }
}

export async function coordinateWrite(options: {
  operation: string; execute: boolean; confirm?: string; statePath: string; redactor: SecretRedactor;
  prepare: () => Promise<{ path: string; body?: unknown; confirmation: string; preview: Record<string, unknown> }>;
  send: (path: string, body?: unknown) => Promise<unknown>;
}): Promise<Record<string, unknown>> {
  const plan = await options.prepare();
  const preview = options.redactor.value(plan.preview);
  if (!options.execute) return { status: "preview", operation: options.operation, preview, confirmation: options.redactor.text(plan.confirmation), help: ["Repeat with --execute --confirm '<exact confirmation>' to send once"] };
  if (options.confirm !== plan.confirmation || options.redactor.text(plan.confirmation) !== plan.confirmation) throw new AxiError("Exact write confirmation is required", "CONFIRMATION_REQUIRED", ["Run a preview again and copy its confirmation exactly"]);
  const auditId = randomUUID();
  const directory = join(options.statePath, "writes");
  try {
    const firstCreated = await mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Invalid journal directory");
    if (process.platform !== "win32" && (stat.uid !== process.getuid!() || (stat.mode & 0o077) !== 0)) throw new Error("Insecure journal directory");
    // Persist the intended request without API response text or credentials.
    await newPrivateFile(join(directory, `${auditId}.json`), async (file) => {
      await file.writeFile(Buffer.from(JSON.stringify(options.redactor.value({ auditId, operation: options.operation, state: "intent", time: new Date().toISOString(), request: { path: plan.path, body: plan.body } }))));
    });
    if (process.platform !== "win32") {
      // Persist newly created ancestor entries as well as the journal entry itself.
      const lastDirectory = firstCreated ? dirname(firstCreated) : directory;
      for (let current = directory; ; current = dirname(current)) {
        const handle = await open(current, "r");
        try { await handle.sync(); } finally { await handle.close(); }
        if (current === lastDirectory) break;
      }
    }
  } catch { throw new AxiError("Cannot persist a private durable write intent", "JOURNAL_ERROR", ["Check the state directory permissions and storage; no write was sent"]); }
  try {
    const result = await options.send(plan.path, plan.body);
    return { status: "sent", operation: options.operation, auditId, result, help: ["The response is not assumed to be a task ID; verify the remote state before further changes"] };
  } catch (error) {
    // A definite API rejection is safe to report. Network, server and response failures may follow a committed write.
    if (error instanceof AxiError && ["API_BAD_REQUEST", "AUTH_FAILED", "API_FORBIDDEN", "NOT_FOUND", "API_CONFLICT", "API_GONE", "API_LOCKED", "RATE_LIMITED", "AUTH_EXPIRED", "VALIDATION_ERROR"].includes(error.code)) throw error;
    throw new UnknownWriteOutcome(auditId);
  }
}
