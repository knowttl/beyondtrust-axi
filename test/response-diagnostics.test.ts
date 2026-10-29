import { afterEach, expect, test } from "vitest";
import { resourceReads } from "../src/catalogue.js";
import { localFixture } from "./support/local-cli.js";
import { fakeCloud, response, token } from "./support/fake-pm-cloud.js";
import { ResponseDiagnostics } from "../src/response-diagnostics.js";
import { SecretRedactor } from "../src/redact.js";
import { AxiError } from "axi-sdk-js";

const id = "00000000-0000-0000-0000-000000000001";
const fixtures: ReturnType<typeof localFixture>[] = [];
function fixture() { const f = localFixture(); fixtures.push(f); return f; }
afterEach(() => { for (const f of fixtures.splice(0)) f.cleanup(); });

test.each(["token", "API"])("reports an HTML login page from the %s endpoint without echoing it", async (endpoint) => {
  const html = { status: 200, headers: new Headers({ "content-type": "text/html; charset=utf-8" }), body: (async function* () { yield Buffer.from("<html>synthetic-private-login</html>"); })() };
  const cloud = endpoint === "token" ? fakeCloud(html) : fakeCloud(response(token), html);
  const result = await fixture().run(["about"], {}, cloud);
  expect(result.code).toBe(1);
  expect(result.data.error).toMatchObject({
    code: endpoint === "token" ? "AUTH_RESPONSE_INVALID" : "API_RESPONSE_INVALID",
    status: 200, contentType: "text/html", shape: [{ path: "$", type: "undefined" }],
  });
  expect(result.output).not.toContain("synthetic-private-login");
  expect(cloud.calls).toHaveLength(endpoint === "token" ? 1 : 2);
});

test("adds diagnostics to a wrong-shaped token response without echoing values", async () => {
  const result = await fixture().run(["about"], {}, fakeCloud(response({ access_token: "synthetic-private-token", token_type: 123, expires_in: 3600 })));
  expect(result.code).toBe(1);
  expect(result.data.error).toMatchObject({ code: "AUTH_RESPONSE_INVALID", status: 200, issuePaths: ['$["token_type"]'], shape: expect.arrayContaining([{ path: '$["token_type"]', type: "number", expected: "string" }]) });
  expect(result.output).not.toContain("synthetic-private-token");
});

test("leaves a healthy API response unchanged", async () => {
  const result = await fixture().run(["about"], {}, fakeCloud(response(token), response([{ consoleVersion: "1.2.3" }])));
  expect(result.code).toBe(0);
  expect(result.data).toEqual({ versions: [{ consoleVersion: "1.2.3" }] });
});

test.each(["tenant-01.example.com", "ops@example.com", "3f2504e0-4f89-11d3-9a0c-0305e82c3301"])("hides data-shaped keys at every level: %s", async (key) => {
  const result = await fixture().run(["about"], {}, fakeCloud(response(token), response({
    [key]: "synthetic-private-value", nested: { [key]: "synthetic-private-value", consoleVersion: 1 },
  })));
  expect(result.data.error).toMatchObject({ shape: [
    { path: "$", type: "object" }, { path: '$["<key>"]', type: "string" },
    { path: '$["nested"]', type: "object" }, { path: '$["nested"]["<key>"]', type: "string" },
    { path: '$["nested"]["consoleVersion"]', type: "number" },
  ] });
  expect(result.output).not.toContain(key);
  expect(result.output).not.toContain("synthetic-private-value");
});

// GET routes and path-parameter types come from inventory/swagger.json through the catalogue.
const endpoints = [
  { args: ["doctor"], path: "/v3/About" },
  { args: ["about"], path: "/v3/About" },
  { args: ["task", "status", "--id", id], path: `/v3/Tasks/${id}` },
  ...Object.entries(resourceReads).flatMap(([command, definition]) => {
    const parameter = definition.pathParameter?.schema;
    const args = [...command.split(" "), ...(parameter ? ["--id", parameter.type === "integer" ? "1" : id] : []), ...(command === "event search" ? ["--os", "Windows"] : [])];
    return [
      { args, path: definition.path.replace(/\{[^}]+\}/, parameter?.type === "integer" ? "1" : id) },
      ...Object.entries(definition.variants ?? {}).map(([type, path]) => ({ args: [...command.split(" "), type], path })),
    ];
  }),
].map((endpoint) => ({
  ...endpoint,
  // These export routes have no response schema; their structural checks provide no validator paths.
  issueDetails: ["computer command-log", "group view", "policy view"].includes(endpoint.args.slice(0, 2).join(" "))
    ? {} : { issuePaths: ["$"], issuePathsTruncated: false },
}));

test.each(endpoints)("reports schema failure metadata for GET $path ($args)", async ({ args, path, issueDetails }) => {
  const cloud = fakeCloud(response(token), response("synthetic-private-value", 200, { "content-type": "application/json; charset=utf-8" }));
  const result = await fixture().run(args, {}, cloud);
  expect(result.code).toBe(1);
  expect(result.data.error).toMatchObject({
    code: "API_RESPONSE_INVALID", message: "API response does not match the documented schema",
    status: 200, contentType: "application/json", shape: [{ path: "$", type: "string" }], shapeTruncated: false,
    ...issueDetails,
  });
  expect(cloud.calls[1]!.url.pathname).toBe(`/management-api${path}`);
  expect(result.output).not.toContain("synthetic-private-value");
});

const values = { text: "synthetic-private-text", number: 8675309, token: token.access_token, host: "synthetic-host.example.test", id };
test.each([
  { name: "object instead of array", args: ["about"], body: values, shape: [{ path: "$", type: "object" }, ...Object.keys(values).map((key) => ({ path: `$["${key}"]`, type: key === "number" ? "number" : "string" }))] },
  { name: "wrapper envelope", args: ["doctor"], body: { items: [values], total: 8675309 }, shape: [
    { path: "$", type: "object" }, { path: '$["items"]', type: "array", count: 1 }, { path: '$["items"][*]', type: "object" },
    ...Object.keys(values).map((key) => ({ path: `$["items"][*]["${key}"]`, type: key === "number" ? "number" : "string" })), { path: '$["total"]', type: "number" },
  ] },
  { name: "nested arrays", args: ["group", "list"], body: [[Object.values(values), null, true]], shape: [
    { path: "$", type: "array", count: 1 }, { path: "$[*]", type: "array", count: 3 }, { path: "$[*][*]", type: "array", count: 5 },
    { path: "$[*][*][*]", type: "string" },
  ] },
])("reports only paths and types for $name", async ({ args, body, shape }) => {
  const result = await fixture().run(args, {}, fakeCloud(response(token), response(body, 202, { "content-type": "application/problem+json" })));
  expect(result.code).toBe(1);
  expect(result.data.error).toMatchObject({ code: "API_RESPONSE_INVALID", status: 202, contentType: "application/problem+json", shape, shapeTruncated: false });
  for (const value of Object.values(values)) expect(result.output).not.toContain(String(value));
});

test.each([
  { args: ["about"], body: [{ consoleVersion: 1 }], issuePaths: ['$[*]["consoleVersion"]'], shape: [
    { path: "$", type: "array", count: 1 }, { path: "$[*]", type: "object" }, { path: '$[*]["consoleVersion"]', type: "number", expected: "string" },
  ] },
  { args: ["task", "status", "--id", id], body: {}, issuePaths: ['$["id"]'], shape: [{ path: "$", type: "object" }] },
])("adds validator paths alongside the response shape for $args", async ({ args, body, issuePaths, shape }) => {
  const result = await fixture().run(args, {}, fakeCloud(response(token), response(body)));
  expect(result.code).toBe(1);
  expect(result.data.error).toMatchObject({ code: "API_RESPONSE_INVALID", shape, shapeTruncated: false, issuePaths, issuePathsTruncated: false });
});

test.each([
  { name: "width", body: Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`field${i}`, "synthetic-private-value"])), count: 64 },
  { name: "depth", body: { nested: [[[["synthetic-private-value"]]]] }, count: 5 },
  { name: "total path characters", body: { ["x".repeat(40)]: { ["y".repeat(40)]: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`field${i}`, null])) } }, count: 42 },
])("bounds report $name", async ({ body, count }) => {
  const result = await fixture().run(["about"], {}, fakeCloud(response(token), response(body)));
  const error = result.data.error as { shape: { path: string; type: string }[]; shapeTruncated: boolean };
  expect(error.shapeTruncated).toBe(true);
  expect(error.shape).toHaveLength(count);
  expect(JSON.stringify(error.shape).length).toBeLessThan(7000);
  expect(error.shape.every(({ path }) => path.length <= 256)).toBe(true);
  expect(result.output).not.toContain("synthetic-private-value");
});

test("hides keys containing escapes and known secrets", async () => {
  const f = fixture();
  const key = `quote"\n[0].${f.env.SYNTHETIC_SECRET}.${token.access_token}`;
  const result = await f.run(["about"], {}, fakeCloud(response(token), response({ [key]: "synthetic-private-value" })));
  expect(result.data.error).toMatchObject({ shape: [{ path: "$", type: "object" }, { path: '$["<key>"]', type: "string" }] });
  expect(result.output).not.toContain(f.env.SYNTHETIC_SECRET);
  expect(result.output).not.toContain(token.access_token);
  expect(result.output).not.toContain("synthetic-private-value");
});

test.each(["tenant-01.example.com", "ops@example.com", "3f2504e0-4f89-11d3-9a0c-0305e82c3301"])("hides data-shaped validation issue paths: %s", (key) => {
  const diagnostics = new ResponseDiagnostics(new SecretRedactor());
  const body = { [key]: "synthetic-private-value", nested: { [key]: "synthetic-private-value" }, consoleVersion: 1 };
  diagnostics.record(200, new Headers({ "content-type": "application/json" }), body);
  diagnostics.validationFailed([{ path: [key] }, { path: ["nested", key] }, { path: ["consoleVersion"] }]);
  const details = diagnostics.forError(new AxiError("Invalid response", "API_RESPONSE_INVALID"));
  expect(details).toMatchObject({ shape: [
    { path: "$", type: "object" }, { path: '$["<key>"]', type: "string" },
    { path: '$["nested"]', type: "object" }, { path: '$["nested"]["<key>"]', type: "string" },
    { path: '$["consoleVersion"]', type: "number" },
  ], shapeTruncated: false, issuePaths: ['$["<key>"]', '$["nested"]["<key>"]', '$["consoleVersion"]'], issuePathsTruncated: false });
  expect(JSON.stringify(details)).not.toContain(key);
  expect(JSON.stringify(details)).not.toContain("synthetic-private-value");
});

test.each([
  { key: "a".repeat(40), displayed: "a".repeat(40) },
  { key: "a".repeat(41), displayed: "<key>" },
  { key: "af2504e04f8911d39a0c0305e82c3301", displayed: "<key>" },
  { key: "a3f2504e_4f89_11d3_9a0c_0305e82c3301", displayed: "<key>" },
])("filters identifier boundary $key", async ({ key, displayed }) => {
  const result = await fixture().run(["about"], {}, fakeCloud(response(token), response({ [key]: null })));
  expect(result.data.error).toMatchObject({ shape: [{ path: "$", type: "object" }, { path: `$["${displayed}"]`, type: "null" }] });
  const diagnostics = new ResponseDiagnostics(new SecretRedactor());
  diagnostics.record(200, new Headers(), { [key]: null });
  diagnostics.validationFailed([{ path: [key] }]);
  expect(diagnostics.forError(new AxiError("Invalid response", "API_RESPONSE_INVALID"))).toMatchObject({ issuePaths: [`$["${displayed}"]`] });
});

test.each([
  { name: "root and field", paths: [[], ["field"]], expected: ["$", '$["field"]'], truncated: false },
  { name: "width", paths: Array.from({ length: 65 }, () => ["field"]), expected: Array(64).fill('$["field"]'), truncated: true },
  { name: "depth", paths: [["a", "b", "c", "d", "e"]], expected: ['$["a"]["b"]["c"]["d"]'], truncated: true },
  { name: "characters", paths: Array.from({ length: 64 }, () => ["a".repeat(40), "b".repeat(40)]), expected: Array(46).fill(`$["${"a".repeat(40)}"]["${"b".repeat(40)}"]`), truncated: true },
])("bounds issue paths independently of shape: $name", ({ paths, expected, truncated }) => {
  const diagnostics = new ResponseDiagnostics(new SecretRedactor());
  diagnostics.record(200, new Headers(), { field: null });
  diagnostics.validationFailed(paths.map((path) => ({ path })));
  expect(diagnostics.forError(new AxiError("Invalid response", "API_RESPONSE_INVALID"))).toMatchObject({
    shape: [{ path: "$", type: "object" }, { path: '$["field"]', type: "null" }], shapeTruncated: false,
    issuePaths: expected, issuePathsTruncated: truncated,
  });
});

test.each<Record<string, string>>([
  {},
  { "content-type": "invalid synthetic-private-header" },
  { "content-type": `application/${"x".repeat(128)}` },
])("reports absent or invalid content types as null: %j", async (headers) => {
  const result = await fixture().run(["about"], {}, fakeCloud(response(token), response({}, 200, headers)));
  expect(result.data.error).toMatchObject({ contentType: null });
  expect(result.output).not.toContain("synthetic-private-header");
});

test("omits arbitrary content-type parameters", async () => {
  const result = await fixture().run(["about"], {}, fakeCloud(response(token), response({}, 200, { "content-type": 'application/json; secret="synthetic-private-header"' })));
  expect(result.data.error).toMatchObject({ contentType: "application/json" });
  expect(result.output).not.toContain("synthetic-private-header");
});

test("redacts credentials in the content type without changing their case first", async () => {
  const f = fixture();
  f.env.SYNTHETIC_SECRET = "SYNTHETIC_SECRET";
  const result = await f.run(["about"], {}, fakeCloud(response(token), response({}, 200, { "content-type": "application/SYNTHETIC_SECRET" })));
  expect(result.data.error).toMatchObject({ contentType: "application/***redacted***" });
  expect(result.output).not.toContain("SYNTHETIC_SECRET");
  expect(result.output).not.toContain("synthetic_secret");
});

test("uses the failing page's shape and metadata", async () => {
  const cloud = fakeCloud(response(token), response(Array(200).fill({})), response({ items: values }, 202, { "content-type": "application/problem+json" }));
  const result = await fixture().run(["auth-request", "list", "--all"], {}, cloud);
  expect(result.data.error).toMatchObject({ status: 202, contentType: "application/problem+json", shape: expect.arrayContaining([{ path: '$["items"]', type: "object" }]) });
  expect(cloud.calls).toHaveLength(3);
});

// GET re-reads from inventory/swagger.json must fail before any mutation is sent.
test.each([
  { args: ["computer", "authorise", id], operation: "computer.authorise", path: `/v3/Computers/${id}` },
  { args: ["group", "set-default", id], operation: "group.set-default", path: `/v3/Groups/${id}` },
  { args: ["policy", "update", id, "--name", "example"], operation: "policy.update", path: `/v3/Policies/${id}` },
  { args: ["user", "disable", id], operation: "user.disable", path: `/v3/Users/${id}` },
  { args: ["admin-request", "create", "--computer", id, "--user", "example"], operation: "admin-request.create", path: `/v3/Computers/${id}` },
  { args: ["group", "delete", id], operation: "group.delete", path: `/v3/Groups/${id}` },
])("reports schema failures during $operation preparation", async ({ args, operation, path }) => {
  const f = fixture();
  f.profile.profiles.example.writes = { allowWrites: true, allowDeletes: true, operations: [operation] };
  f.save();
  const cloud = fakeCloud(response(token), response("synthetic-private-value", 200, { "content-type": "application/json" }));
  const result = await f.run(args, {}, cloud);
  expect(result.code).toBe(1);
  expect(result.data.error).toMatchObject({ code: "API_RESPONSE_INVALID", status: 200, contentType: "application/json", shape: [{ path: "$", type: "string" }] });
  expect(cloud.calls.map(({ options }) => options.method)).toEqual(["POST", "GET"]);
  expect(cloud.calls[1]!.url.pathname).toBe(`/management-api${path}`);
  expect(result.output).not.toContain("synthetic-private-value");
});
