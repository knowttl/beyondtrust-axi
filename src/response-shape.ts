import { AxiError } from "axi-sdk-js";

const maxKeys = 20;
const maxDepth = 3;
const maxLength = 400;
// Key names come from the tenant and may be data, so only identifier-like names are echoed.
const safeKey = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

function shape(value: unknown, depth: number): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return value.length ? `array[${value.length}]<${depth ? shape(value[0], depth - 1) : "..."}>` : "array[0]";
  if (typeof value !== "object") return typeof value;
  if (!depth) return "object{...}";
  const entries = Object.entries(value);
  const shown = entries.slice(0, maxKeys).map(([key, child]) => `${safeKey.test(key) ? key : "<key>"}:${shape(child, depth - 1)}`);
  return `object{${shown.join(",")}${entries.length > maxKeys ? `,+${entries.length - maxKeys} more` : ""}}`;
}

// Reports JSON types only, never values, so an operator can see why a live response failed validation.
export function invalidApiResponse(value: unknown): AxiError {
  return new AxiError("API response does not match the documented schema", "API_RESPONSE_INVALID", [
    "Check API compatibility",
    `Response shape (types only, no values; arrays show their first element): ${shape(value, maxDepth).slice(0, maxLength)}`,
  ]);
}
