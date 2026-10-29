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

  validationFailed(data: unknown, issues: readonly { path: readonly PropertyKey[] }[]): void {
    this.details = { ...this.details, ...this.shape(data, issues) };
  }

  private shape(data: unknown, issues: readonly { path: readonly PropertyKey[] }[] = []): Record<string, unknown> {
    const shape: { path: string; type: string }[] = [];
    let truncated = false;
    let characters = 0;
    const visit = (value: unknown, path: string, depth: number, descend = true): void => {
      if (shape.length >= 64 || path.length > 256 || characters + path.length > 4096) { truncated = true; return; }
      characters += path.length;
      const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
      shape.push({ path, type });
      if (!descend || value === null || typeof value !== "object") return;
      for (const key in value) {
        if (!Object.hasOwn(value, key)) continue;
        if (depth >= 4 || shape.length >= 64) { truncated = true; break; }
        const segment = Array.isArray(value) && /^(0|[1-9][0-9]*)$/.test(key) ? `[${key}]` : keySegment(key, this.redactor);
        visit((value as Record<string, unknown>)[key], path + segment, depth + 1);
        if (truncated) break;
      }
    };
    if (!issues.length || issues.some(({ path }) => !path.length)) visit(data, "$", 0);
    else for (const issue of issues) {
      let path = "$", value = data, depth = 0;
      for (const key of issue.path) {
        if (depth >= 4) { truncated = true; break; }
        path += typeof key === "number" && Number.isSafeInteger(key) && key >= 0 ? `[${key}]` : keySegment(String(key), this.redactor);
        value = value !== null && typeof value === "object" && Object.hasOwn(value, key) ? (value as Record<PropertyKey, unknown>)[key] : undefined;
        depth++;
      }
      visit(value, path, depth, false);
      if (truncated) break;
    }
    return { shape, shapeTruncated: truncated };
  }

  forError(error: unknown): Record<string, unknown> {
    return error instanceof AxiError && error.code === "API_RESPONSE_INVALID" ? this.details : {};
  }
}
