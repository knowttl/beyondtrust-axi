import { AxiError } from "axi-sdk-js";
import type { SecretRedactor } from "./redact.js";

// Retain structure only, never the response body or validation-library errors.
export class ResponseDiagnostics {
  private details: Record<string, unknown> = {};

  constructor(private readonly redactor: SecretRedactor) {}

  record(status: number, headers: Headers, data: unknown): void {
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
        const segment = Array.isArray(value) ? `[${key}]` : `[${JSON.stringify(this.redactor.text(key))}]`;
        visit((value as Record<string, unknown>)[key], path + segment, depth + 1);
        if (truncated) break;
      }
    };
    visit(data, "$", 0);
    // Parameters can contain arbitrary server text; report only the bounded media type.
    const mediaType = headers.get("content-type")?.split(";", 1)[0]?.trim();
    const contentType = mediaType && mediaType.length <= 128 && /^[a-z0-9!#$&^_.+\-]+\/[a-z0-9!#$&^_.+\-]+$/i.test(mediaType)
      ? this.redactor.text(mediaType) : null;
    this.details = { status, contentType, shape, shapeTruncated: truncated };
  }

  forError(error: unknown): Record<string, unknown> {
    return error instanceof AxiError && error.code === "API_RESPONSE_INVALID" ? this.details : {};
  }
}
