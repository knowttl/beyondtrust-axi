import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { ResponseDiagnostics } from "../src/response-diagnostics.js";
import vectors from "./fixtures/response-diagnostics-vectors.json" with { type: "json" };
import hashes from "./fixtures/response-diagnostics-sha256.json" with { type: "json" };

test.each(vectors)("shared diagnostics vector: $name", (vector) => {
  const redactor = { text: (text: string) => (vector.secrets ?? []).reduce((text, secret) => text.replaceAll(secret, "***redacted***"), text) };
  const diagnostics = new ResponseDiagnostics(redactor);
  diagnostics.record(vector.status, new Headers(vector.contentType ? { "content-type": vector.contentType } : {}), vector.data);
  if (vector.issues) diagnostics.validationFailed(vector.issues);
  expect(diagnostics.forError({ code: "API_RESPONSE_INVALID" })).toEqual(vector.expected);
  expect(diagnostics.forError({ code: "AUTH_RESPONSE_INVALID" })).toEqual(vector.expected);
  expect(diagnostics.forError({ code: "TRANSPORT_ERROR" })).toEqual({});
});

// These bytes are the distribution interface consumed by copies and language ports.
test.each(Object.entries(hashes))("canonical copy SHA-256: %s", (path, hash) => {
  const bytes = readFileSync(new URL(`../${path}`, import.meta.url));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
});
