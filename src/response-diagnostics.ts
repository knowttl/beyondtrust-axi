import { AxiError } from "axi-sdk-js";
import type { SecretRedactor } from "./redact.js";

function keySegment(key: string, redactor: SecretRedactor): string {
  const identifier = /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key);
  const guid = /^(?:[0-9a-f]{32}|[0-9a-f]{8}(?:[-_][0-9a-f]{4}){3}[-_][0-9a-f]{12})$/i.test(key);
  return `[${JSON.stringify(identifier && !guid ? redactor.text(key) : "<key>")}]`;
}

// Retain structure only, never the response body or validation-library errors.
export class ResponseDiagnostics {
  private details: Record<string, unknown> = {};

  constructor(private readonly redactor: SecretRedactor) {}

  record(status: number, headers: Headers, data: unknown): void {
    // Parameters can contain arbitrary server text; report only the bounded media type.
    const mediaType = headers.get("content-type")?.split(";", 1)[0]?.trim();
    const contentType = mediaType && mediaType.length <= 128 && /^[a-z0-9!#$&^_.+\-]+\/[a-z0-9!#$&^_.+\-]+$/i.test(mediaType)
      ? this.redactor.text(mediaType) : null;
    this.details = { status, contentType, ...this.shape(data) };
  }

  validationFailed(issues: readonly { path: readonly PropertyKey[] }[]): void {
    const issuePaths: string[] = [];
    let truncated = false;
    let characters = 0;
    for (const issue of issues) {
      let path = "$";
      for (const [depth, key] of issue.path.entries()) {
        if (depth >= 4) { truncated = true; break; }
        path += typeof key === "number" && Number.isSafeInteger(key) && key >= 0 ? `[${key}]` : keySegment(String(key), this.redactor);
      }
      if (issuePaths.length >= 64 || path.length > 256 || characters + path.length > 4096) { truncated = true; break; }
      characters += path.length;
      issuePaths.push(path);
      if (truncated) break;
    }
    this.details = { ...this.details, issuePaths, issuePathsTruncated: truncated };
  }

  private shape(data: unknown): Record<string, unknown> {
    const shape: { path: string; type: string }[] = [];
    let truncated = false;
    let characters = 0;
    const visit = (value: unknown, path: string, depth: number): void => {
      if (shape.length >= 64 || path.length > 256 || characters + path.length > 4096) { truncated = true; return; }
      characters += path.length;
      const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
      shape.push({ path, type });
      if (value === null || typeof value !== "object") return;
      for (const key in value) {
        if (!Object.hasOwn(value, key)) continue;
        if (depth >= 4 || shape.length >= 64) { truncated = true; break; }
        const segment = Array.isArray(value) && /^(0|[1-9][0-9]*)$/.test(key) ? `[${key}]` : keySegment(key, this.redactor);
        visit((value as Record<string, unknown>)[key], path + segment, depth + 1);
        if (truncated) break;
      }
    };
    visit(data, "$", 0);
    return { shape, shapeTruncated: truncated };
  }

  forError(error: unknown): Record<string, unknown> {
    return error instanceof AxiError && error.code === "API_RESPONSE_INVALID" ? this.details : {};
  }
}
