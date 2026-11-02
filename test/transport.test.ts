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
  expect(Object.fromEntries(new URLSearchParams(auth!.options.body?.toString()))).toEqual({ grant_type: "client_credentials", client_id: credentials.clientId, client_secret: credentials.clientSecret, scope: "urn:management:api" });
  expect(auth!.url.search).toBe("");
  expect(first!.options).toMatchObject({ method: "GET", headers: { authorization: `Bearer ${token.access_token}` } });
  expect(second!.options.headers).toEqual(first!.options.headers);
  expect(cloud.calls).toHaveLength(3);
});

test("requests exactly the Management API scope when authenticating", async () => {
  const cloud = fakeCloud(response(token), response([]));
  await client(cloud).get("/v3/About");
  expect(new URLSearchParams(cloud.calls[0]!.options.body?.toString()).getAll("scope")).toEqual(["urn:management:api"]);
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

const id = "22222222-2222-4222-8222-222222222222";

test.each([[400], [401]])("a token %i with error invalid_client reports the client credentials", async (status) => {
  await expect(client(fakeCloud(response({ error: "invalid_client" }, status))).get("/v3/About")).rejects.toMatchObject({ code: "AUTH_FAILED", suggestions: [expect.stringContaining("clientSecret")] });
});

test("a 401 after a successful token exchange and refresh names the missing API access", async () => {
  const cloud = fakeCloud(response(token), response({}, 401), response(token), response({}, 401));
  await expect(client(cloud).get("/scim/v3/users")).rejects.toMatchObject({ code: "AUTH_FAILED", message: expect.stringContaining("SCIM API"), suggestions: [expect.not.stringContaining("doctor")] });
});

test("a 400 includes the API reason, redacted and capped", async () => {
  await expect(client(fakeCloud(response(token), response({ message: "id is not correct sorting field", exceptionType: null, stackTrace: null }, 400))).get("/v3/ActivityAudits")).rejects.toMatchObject({ code: "API_BAD_REQUEST", message: expect.stringContaining("id is not correct sorting field"), suggestions: [expect.not.stringContaining("doctor")] });
  const secret = await client(fakeCloud(response(token), response({ title: `bad ${credentials.clientSecret} ${"x".repeat(1000)}` }, 400))).get("/v3/ActivityAudits").then(() => "", (caught: Error) => caught.message);
  expect(secret).not.toContain(credentials.clientSecret);
  expect(secret).toContain("***redacted***");
  expect(secret.length).toBeLessThan(400);
});

test.each([
  [`/v3/Computers/${id}`, `Computer ${id}`, "computer list"],
  [`/v3/Computers/${id}/CommandLog`, `Computer ${id}`, "computer list"],
  [`/v3/Computers/Logs/${id}/Content`, `Computer log ${id}`, "computer logs --id <computer-id>"],
  [`/v3/Groups/${id}`, `Group ${id}`, "group list"],
  [`/v3/Policies/${id}`, `Policy ${id}`, "policy list"],
  [`/v3/Policies/${id}/Revisions`, `Policy ${id}`, "policy list"],
  [`/PolicyEditor/v3/Policy/${id}/Windows/ApplicationGroups`, `Policy ${id}`, "policy list"],
  [`/PolicyEditor/v3/Policy/${id}/MacOS/ApplicationGroups`, `Policy ${id}`, "policy list"],
  [`/v3/Users/${id}`, `User ${id}`, "user list"],
  [`/scim/v3/users/${id}`, `SCIM user ${id}`, "scim user list"],
  [`/v3/Roles/${id}`, `Role ${id}`, "role list"],
  [`/v3/GlobalRoles/${id}`, `Global role ${id}`, "global-role list"],
  [`/v3/AcceptedDomains/${id}`, `Domain ${id}`, "domain list"],
  ["/v3/ActivityAudits/42", "Activity audit 42", "audit activity list"],
  ["/v3/AuthorizationRequestAudits/42", "Authorization request audit 42", "audit auth-request list"],
  [`/v3/AdminAccessRequest/${id}`, `Admin request ${id}`, "admin-request list"],
  ["/v3/AuthorizationRequest/endpoint-name", "Authorization request endpoint-name", "auth-request list"],
  ["/v3/AuthorizationRequest/endpoint%2Fname%2B1?ignored=42", "Authorization request endpoint/name+1", "auth-request list"],
])("a 404 identifies the requested resource at %s and its list command", async (path, resource, list) => {
  await expect(client(fakeCloud(response(token), response({}, 404))).get(path!)).rejects.toMatchObject({ code: "NOT_FOUND", message: `${resource} was not found`, suggestions: [`Run beyondtrust-axi ${list} to find valid IDs`] });
});

test.each(["", "{", "{}", '{"message":" ","detail":"\\t","title":""}'])("a resource 400 without a usable reason gives parameter guidance: %j", async (body) => {
  const cloud = fakeCloud(response(token), { status: 400, headers: new Headers(), body: (async function* () { yield Buffer.from(body); })() });
  await expect(client(cloud).get("/v3/About")).rejects.toMatchObject({ code: "API_BAD_REQUEST", message: "The API rejected the request", suggestions: ["Check the command options and values"] });
});

test("an unreadable resource 400 body retains parameter guidance", async () => {
  const cloud = fakeCloud(response(token), { status: 400, headers: new Headers(), body: (async function* () { yield Buffer.from('{"message":"partial"}'); throw new Error("connection closed"); })() });
  await expect(client(cloud).get("/v3/About")).rejects.toMatchObject({ code: "API_BAD_REQUEST", message: "The API rejected the request", suggestions: ["Check the command options and values"] });
});

test.each([
  [400, { code: "API_BAD_REQUEST", suggestions: ["Check the command options and values"] }],
  [404, { code: "NOT_FOUND", message: `Policy revision ${id} was not found`, suggestions: ["Run beyondtrust-axi policy revisions --id <policy-id> to find valid IDs"] }],
] as const)("download failures identify the policy revision or rejected parameters: %i", async (status, expected) => {
  const cloud = fakeCloud(response(token), response({}, status));
  await expect(client(cloud).download(`/v3/Policies/PolicyRevision/${id}/Content`, async () => {})).rejects.toMatchObject(expected);
});

test.each([
  [400, { code: "API_BAD_REQUEST", suggestions: ["Check the command options and values"] }],
  [404, { code: "NOT_FOUND", message: `Policy ${id} was not found`, suggestions: ["Run beyondtrust-axi policy list to find valid IDs"] }],
] as const)("write failures identify the policy or rejected parameters: %i", async (status, expected) => {
  const api = client(fakeCloud(response(token), response([]), response({}, status)));
  await api.get(`/v3/Policies/${id}`);
  await expect(api.write(`/v3/Policies/${id}`, {}, { method: "PUT" })).rejects.toMatchObject(expected);
});

test("a task 404 identifies the task without suggesting a nonexistent list command", async () => {
  await expect(client(fakeCloud(response(token), response({}, 404))).get(`/v3/Tasks/${id}`)).rejects.toMatchObject({ code: "NOT_FOUND", message: `Task ${id} was not found`, suggestions: ["Check the task ID returned by the API"] });
});

test("a notification endpoint 404 is not mistaken for an authorization request ID", async () => {
  const api = client(fakeCloud(response(token), response([]), response({}, 404)));
  await api.get("/v3/About");
  await expect(api.write("/v3/AuthorizationRequest/notification", {})).rejects.toMatchObject({ code: "NOT_FOUND", message: "The requested resource was not found" });
});

test.each([1024, 4096, 65536, 131072])("a chunked 400 retains its redacted API reason with %i-byte chunks", async (chunkSize) => {
  const body = Buffer.from(JSON.stringify({ message: `Invalid field ${credentials.clientSecret}`, stackTrace: "x".repeat(64 * 1024) }));
  const cloud = fakeCloud(response(token), { status: 400, headers: new Headers(), body: (async function* () { for (let offset = 0; offset < body.length; offset += chunkSize) yield body.subarray(offset, offset + chunkSize); })() });
  await expect(client(cloud).get("/v3/About")).rejects.toMatchObject({ code: "API_BAD_REQUEST", message: "The API rejected the request: Invalid field ***redacted***" });
});

test.each([400, 401])("a chunked token %i retains invalid_client classification", async (status) => {
  const cloud = fakeCloud({ status, headers: new Headers(), body: (async function* () { yield Buffer.from('{"error":"invalid_client","padding":"'); yield Buffer.from("x".repeat(64 * 1024)); yield Buffer.from('"}'); })() });
  await expect(client(cloud).get("/v3/About")).rejects.toMatchObject({ code: "AUTH_FAILED", suggestions: ["Check the profile clientId and clientSecret; the API account secret may have been regenerated"] });
});

test("an oversized error body keeps the resource status and parameter guidance", async () => {
  const cloud = fakeCloud(response(token), response({ message: "x".repeat(1024 * 1024) }, 400));
  await expect(client(cloud).get("/v3/About")).rejects.toMatchObject({ code: "API_BAD_REQUEST", message: "The API rejected the request", suggestions: ["Check the command options and values"] });
});
