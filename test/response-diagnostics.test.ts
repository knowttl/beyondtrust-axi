import { afterEach, expect, test } from "vitest";
import { resourceReads } from "../src/catalogue.js";
import { localFixture } from "./support/local-cli.js";
import { fakeCloud, response, token } from "./support/fake-pm-cloud.js";

const id = "00000000-0000-0000-0000-000000000001";
const fixtures: ReturnType<typeof localFixture>[] = [];
function fixture() { const f = localFixture(); fixtures.push(f); return f; }
afterEach(() => { for (const f of fixtures.splice(0)) f.cleanup(); });

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
];

test.each(endpoints)("reports schema failure metadata for GET $path ($args)", async ({ args, path }) => {
  const cloud = fakeCloud(response(token), response("synthetic-private-value", 200, { "content-type": "application/json; charset=utf-8" }));
  const result = await fixture().run(args, {}, cloud);
  expect(result.code).toBe(1);
  expect(result.data.error).toEqual({
    code: "API_RESPONSE_INVALID", message: "API response does not match the documented schema",
    status: 200, contentType: "application/json", shape: [{ path: "$", type: "string" }], shapeTruncated: false,
  });
  expect(cloud.calls[1]!.url.pathname).toBe(`/management-api${path}`);
  expect(result.output).not.toContain("synthetic-private-value");
});

const values = { text: "synthetic-private-text", number: 8675309, token: token.access_token, host: "synthetic-host.example.test", id };
test.each([
  { name: "object instead of array", args: ["about"], body: values, shape: [{ path: "$", type: "object" }, ...Object.keys(values).map((key) => ({ path: `$["${key}"]`, type: key === "number" ? "number" : "string" }))] },
  { name: "wrapper envelope", args: ["doctor"], body: { items: [values], total: 8675309 }, shape: [
    { path: "$", type: "object" }, { path: '$["items"]', type: "array" }, { path: '$["items"][0]', type: "object" },
    ...Object.keys(values).map((key) => ({ path: `$["items"][0]["${key}"]`, type: key === "number" ? "number" : "string" })), { path: '$["total"]', type: "number" },
  ] },
  { name: "missing fields", args: ["task", "status", "--id", id], body: {}, shape: [{ path: "$", type: "object" }] },
  { name: "wrong field type", args: ["about"], body: [{ consoleVersion: 8675309 }], shape: [{ path: "$", type: "array" }, { path: "$[0]", type: "object" }, { path: '$[0]["consoleVersion"]', type: "number" }] },
  { name: "nested arrays", args: ["group", "list"], body: [[Object.values(values), null, true]], shape: [
    { path: "$", type: "array" }, { path: "$[0]", type: "array" }, { path: "$[0][0]", type: "array" },
    ...Object.keys(values).map((key, index) => ({ path: `$[0][0][${index}]`, type: key === "number" ? "number" : "string" })),
    { path: "$[0][1]", type: "null" }, { path: "$[0][2]", type: "boolean" },
  ] },
])("reports only paths and types for $name", async ({ args, body, shape }) => {
  const result = await fixture().run(args, {}, fakeCloud(response(token), response(body, 202, { "content-type": "application/problem+json" })));
  expect(result.code).toBe(1);
  expect(result.data.error).toMatchObject({ code: "API_RESPONSE_INVALID", status: 202, contentType: "application/problem+json", shape, shapeTruncated: false });
  for (const value of Object.values(values)) expect(result.output).not.toContain(String(value));
});

test.each([
  { name: "width", body: Array(1000).fill("synthetic-private-value"), count: 64 },
  { name: "depth", body: [[[[["synthetic-private-value"]]]]], count: 5 },
  { name: "path length", body: { ["x".repeat(257)]: "synthetic-private-value" }, count: 1 },
  { name: "total path characters", body: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`${"x".repeat(200)}${i}`, null])), count: 20 },
])("bounds report $name", async ({ body, count }) => {
  const result = await fixture().run(["task", "status", "--id", id], {}, fakeCloud(response(token), response(body)));
  const error = result.data.error as { shape: { path: string; type: string }[]; shapeTruncated: boolean };
  expect(error.shapeTruncated).toBe(true);
  expect(error.shape).toHaveLength(count);
  expect(JSON.stringify(error.shape).length).toBeLessThan(7000);
  expect(error.shape.every(({ path }) => path.length <= 256)).toBe(true);
  expect(result.output).not.toContain("synthetic-private-value");
});

test("escapes path segments and redacts known secrets in response keys", async () => {
  const f = fixture();
  const key = `quote"\n[0].${f.env.SYNTHETIC_SECRET}.${token.access_token}`;
  const result = await f.run(["about"], {}, fakeCloud(response(token), response({ [key]: "synthetic-private-value" })));
  expect(result.data.error).toMatchObject({ shape: [{ path: "$", type: "object" }, { path: `$[${JSON.stringify('quote"\n[0].***redacted***.***redacted***')}]`, type: "string" }] });
  expect(result.output).not.toContain(f.env.SYNTHETIC_SECRET);
  expect(result.output).not.toContain(token.access_token);
  expect(result.output).not.toContain("synthetic-private-value");
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
