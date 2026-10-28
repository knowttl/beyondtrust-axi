import { expect, test } from "vitest";
import { readClient, type TransportOptions } from "../src/transport.js";
import { SecretRedactor } from "../src/redact.js";
import { fakeCloud, response, token } from "./support/fake-pm-cloud.js";

const profile = { name: "example", source: "sole" as const, host: "example.pm.beyondtrustcloud.com", clientId: "synthetic-client", clientSecret: { env: "SYNTHETIC_SECRET" }, downloads: { allow: false }, writes: { allowWrites: false, allowDeletes: false, operations: [] } };
const credentials = { clientId: "synthetic-client&value", clientSecret: "synthetic secret&value" };
const client = (options: TransportOptions) => readClient(profile, credentials, new SecretRedactor(), options);

test("form-encodes credentials only in the token body and reuses the in-memory token", async () => {
  const cloud = fakeCloud(response(token), response([]), response([]));
  const api = client(cloud);
  await api.get("/v3/About");
  await api.get("/v3/About");
  const [auth, first, second] = cloud.calls;
  expect(auth!.options.method).toBe("POST");
  expect(auth!.options.headers["content-type"]).toBe("application/x-www-form-urlencoded");
  expect(Object.fromEntries(new URLSearchParams(auth!.options.body))).toEqual({ grant_type: "client_credentials", client_id: credentials.clientId, client_secret: credentials.clientSecret });
  expect(auth!.url.search).toBe("");
  expect(first!.options).toMatchObject({ method: "GET", headers: { authorization: `Bearer ${token.access_token}` } });
  expect(second!.options.headers).toEqual(first!.options.headers);
  expect(cloud.calls).toHaveLength(3);
});

test("re-exchanges only once on read 401", async () => {
  const cloud = fakeCloud(response(token), response({}, 401), response({ ...token, access_token: "synthetic-replacement-token" }), response({}, 401));
  await expect(client(cloud).get("/v3/About")).rejects.toMatchObject({ code: "AUTH_FAILED" });
  expect(cloud.calls.map((call) => call.options.method)).toEqual(["POST", "GET", "POST", "GET"]);
  expect(cloud.calls[3]!.options.headers.authorization).toBe("Bearer synthetic-replacement-token");
});

test("near-expiry re-exchange consumes the same single refresh allowance", async () => {
  const shortCloud = fakeCloud(response({ ...token, expires_in: 20 }), response(token), response({}, 401));
  await expect(client(shortCloud).get("/v3/About")).rejects.toMatchObject({ code: "AUTH_FAILED" });
  expect(shortCloud.calls.map((call) => call.options.method)).toEqual(["POST", "POST", "GET"]);
});

test("refreshes before a later read when a short token approaches expiry", async () => {
  let time = 0;
  const cloud = fakeCloud(response({ ...token, expires_in: 40 }), response([]), response(token), response([]));
  const api = client({ ...cloud, now: () => time });
  await api.get("/v3/About");
  time = 11_000;
  await api.get("/v3/About");
  expect(cloud.calls.map((call) => call.options.method)).toEqual(["POST", "GET", "POST", "GET"]);
});

test("new runs exchange independently", async () => {
  const cloud = fakeCloud(response(token), response([]), response(token), response([]));
  await client(cloud).get("/v3/About");
  await client(cloud).get("/v3/About");
  expect(cloud.calls.map((call) => call.options.method)).toEqual(["POST", "GET", "POST", "GET"]);
});

test.each([null, {}, { ...token, expires_in: 0 }, { ...token, expires_in: "3600" }, { ...token, token_type: "Basic" }, { ...token, access_token: "bad\r\ntoken" }])("rejects invalid token response: %j", async (data) => {
  const cloud = fakeCloud(response(data));
  await expect(client(cloud).get("/v3/About")).rejects.toMatchObject({ code: "AUTH_RESPONSE_INVALID" });
  expect(cloud.calls).toHaveLength(1);
});

test.each(["https://example.pm.beyondtrustcloud.com", "Example.pm.beyondtrustcloud.com", "example.pm.beyondtrustcloud.com/", "example.pm.beyondtrustcloud.com:443", "example.pm.beyondtrustcloud.com.evil.test", "127.0.0.1"]) ("rejects unsafe hosts at the transport boundary: %s", (host) => {
  expect(() => readClient({ ...profile, host }, credentials, new SecretRedactor())).toThrowError("Invalid HTTPS host");
});

test.each(["//evil.test/v3/About", "https://evil.test", "/v3/../About", "/oauth/connect/token"]) ("refuses non-API paths before authentication: %s", async (path) => {
  const cloud = fakeCloud();
  await expect(client(cloud).get(path)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  expect(cloud.calls).toHaveLength(0);
});

test.each([301, 302, 307, 308])("refuses token redirects without following: %i", async (status) => {
  const cloud = fakeCloud(response({}, status, { location: "https://example-services.pm.beyondtrustcloud.com/oauth/connect/token" }));
  await expect(client(cloud).get("/v3/About")).rejects.toMatchObject({ code: "REDIRECT_REFUSED" });
  expect(cloud.calls).toHaveLength(1);
});

test("refuses API redirects without forwarding the bearer", async () => {
  const cloud = fakeCloud(response(token), response({}, 302, { location: "https://example-services.pm.beyondtrustcloud.com/management-api/v3/About" }));
  await expect(client(cloud).get("/v3/About")).rejects.toMatchObject({ code: "REDIRECT_REFUSED" });
  expect(cloud.calls).toHaveLength(2);
});

test("read 429 honors Retry-After and retries at most twice", async () => {
  const waits: number[] = [];
  const cloud = fakeCloud(response(token), response({}, 429, { "retry-after": "2" }), response({}, 429, { "retry-after": "10" }), response({}, 429));
  await expect(client({ ...cloud, wait: async (ms) => { waits.push(ms); } }).get("/v3/About")).rejects.toMatchObject({ code: "RATE_LIMITED" });
  expect(waits).toEqual([2000, 10_000]);
  expect(cloud.calls).toHaveLength(4);
});

test.each([[0, 3000], [3000, 0], [3500, 0]])("read 429 supports HTTP dates at elapsed %i ms", async (elapsed, delay) => {
  const waits: number[] = [];
  const time = Date.parse("2026-01-01T00:00:00Z") + elapsed;
  const cloud = fakeCloud(response(token), response({}, 429, { "retry-after": "Thu, 01 Jan 2026 00:00:03 GMT" }), response([]));
  await client({ ...cloud, now: () => time, wait: async (ms) => { waits.push(ms); } }).get("/v3/About");
  expect(waits).toEqual([delay]);
  expect(cloud.calls).toHaveLength(3);
});

test.each(["11", "Thu, 01 Jan 2026 00:00:11 GMT", "invalid", "-1"]) ("refuses unbounded or malformed Retry-After: %s", async (retry) => {
  const cloud = fakeCloud(response(token), response({}, 429, { "retry-after": retry }));
  await expect(client({ ...cloud, now: () => Date.parse("2026-01-01T00:00:00Z") }).get("/v3/About")).rejects.toMatchObject({ code: "RATE_LIMITED" });
  expect(cloud.calls).toHaveLength(2);
});

test("never retries a rejected token exchange", async () => {
  const cloud = fakeCloud(response({}, 429, { "retry-after": "0" }));
  await expect(client(cloud).get("/v3/About")).rejects.toMatchObject({ code: "RATE_LIMITED" });
  expect(cloud.calls).toHaveLength(1);
});

// inventory/swagger.json: ProblemDetails error responses on GET /v3/Tasks/{id} and GET /v3/About.
test.each([[400, "API_BAD_REQUEST"], [403, "API_FORBIDDEN"], [404, "NOT_FOUND"], [409, "API_CONFLICT"], [410, "API_GONE"], [423, "API_LOCKED"], [500, "API_UNAVAILABLE"]])("maps HTTP %i to stable errors without echoing ProblemDetails", async (status, code) => {
  const cloud = fakeCloud(response(token), response({ status: 200, title: credentials.clientSecret, detail: token.access_token, instance: "private-data" }, status));
  await expect(client(cloud).get("/v3/About")).rejects.toMatchObject({ code });
  await expect(client(fakeCloud(response(token), response({}, status))).get("/v3/About")).rejects.not.toThrow(credentials.clientSecret);
});

test("caps the shared request budget including authentication", async () => {
  const cloud = fakeCloud(response(token), ...Array.from({ length: 10 }, () => response([])));
  const api = client(cloud);
  for (let index = 0; index < 9; index++) await api.get("/v3/About");
  await expect(api.get("/v3/About")).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  expect(cloud.calls).toHaveLength(10);
});

test("enforces the byte budget across reads", async () => {
  const cloud = fakeCloud(response(token), response("x".repeat(4 * 1024 * 1024)), response("x".repeat(4 * 1024 * 1024)));
  const api = client(cloud);
  await api.get("/v3/About");
  await expect(api.get("/v3/About")).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
});

test("enforces elapsed time before another request", async () => {
  let time = 0;
  const cloud = fakeCloud(response(token), response([]));
  const api = client({ ...cloud, now: () => time });
  await api.get("/v3/About");
  time = 60_000;
  await expect(api.get("/v3/About")).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  expect(cloud.calls).toHaveLength(2);
});

test("transport errors never expose dependency messages", async () => {
  await expect(client({ request: async () => { throw new Error(credentials.clientSecret); } }).get("/v3/About")).rejects.toMatchObject({ code: "TRANSPORT_ERROR", message: "HTTPS request failed" });
});
