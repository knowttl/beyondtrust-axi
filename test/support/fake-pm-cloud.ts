import type { HttpRequest, HttpResponse } from "../../src/transport.js";

export const token = { access_token: "synthetic-access-token", token_type: "Bearer", expires_in: 3600, scope: "urn:management:api" };
export function response(data: unknown, status = 200, headers: Record<string, string> = {}): HttpResponse {
  return { status, headers: new Headers(headers), body: (async function* () { yield Buffer.from(JSON.stringify(data)); })() };
}
export function fakeCloud(...responses: HttpResponse[]) {
  const calls: { url: URL; options: Parameters<HttpRequest>[1] }[] = [];
  const request: HttpRequest = async (url, options) => {
    calls.push({ url, options });
    const next = responses.shift();
    if (!next) throw new Error("Unexpected request");
    return next;
  };
  return { request, calls };
}
