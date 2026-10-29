import { readFileSync } from "node:fs";
import { afterEach, expect, test } from "vitest";
import { localFixture } from "./support/local-cli.js";
import { fakeCloud, response, token } from "./support/fake-pm-cloud.js";

// inventory/swagger.json: GET /v3/About -> AboutModel[]; GET /v3/Tasks/{id} -> TaskDetailModel.
const about = JSON.parse(readFileSync(new URL("./fixtures/about.json", import.meta.url), "utf8"));
const task = JSON.parse(readFileSync(new URL("./fixtures/task.json", import.meta.url), "utf8"));
const fixtures: ReturnType<typeof localFixture>[] = [];
function fixture() { const f = localFixture(); fixtures.push(f); return f; }
afterEach(() => { for (const f of fixtures.splice(0)) f.cleanup(); });

test.each([
  [["about"], "/v3/About", about, { versions: about }],
  [["task", "status", "--id", task.id], `/v3/Tasks/${task.id}`, task, { task: { id: task.id, stateName: "Completed", completedWithErrors: false } }],
  [["doctor"], "/v3/About", about, { authentication: "verified for this run", api: "GET /v3/About succeeded" }],
])("reads through the CLI: %j", async (args, path, data, expected) => {
  const f = fixture();
  const cloud = fakeCloud(response(token), response(data));
  const result = await f.run(args, {}, cloud);
  expect(result.code).toBe(0);
  expect(result.data).toMatchObject(expected);
  expect(cloud.calls.map((call) => call.url.href)).toEqual(["https://example.pm.beyondtrustcloud.com/oauth/connect/token", `https://example.pm.beyondtrustcloud.com/management-api${path}`]);
  expect(result.output).not.toContain(token.access_token);
  expect(result.output).not.toContain(f.env.SYNTHETIC_SECRET);
});

test("doctor diagnoses token 404 without changing hosts", async () => {
  const f = fixture();
  const cloud = fakeCloud(response({ title: "Not Found" }, 404));
  const result = await f.run(["doctor"], {}, cloud);
  expect(result.code).toBe(1);
  expect(result.data).toMatchObject({ error: { code: "AUTH_ENDPOINT_NOT_FOUND" } });
  expect(result.output).toContain("-services.pm.beyondtrustcloud.com");
  expect(cloud.calls).toHaveLength(1);
});

test.each([["task", "status"], ["task", "status", "--id", "../About"], ["about", "--fields", "token"], ["doctor", "--unknown"], ["task", "status", "--id", task.id, "--id", task.id]])("rejects input before credentials and network: %j", async (...args) => {
  const f = fixture();
  f.env.BEYONDTRUST_AXI_CONFIG = "/missing/config.json";
  const cloud = fakeCloud();
  const result = await f.run(args, {}, cloud);
  expect(result.code).toBe(2);
  expect(cloud.calls).toHaveLength(0);
});

test("redacts encoded secrets and tokens before truncation", async () => {
  const f = fixture();
  f.env.SYNTHETIC_SECRET = "synthetic secret&value";
  const cloud = fakeCloud(response(token), response([{ consoleVersion: `synthetic secret&value ${new URLSearchParams({ s: f.env.SYNTHETIC_SECRET }).toString().slice(2)} ${token.access_token} ${"x".repeat(600)}` }]));
  const result = await f.run(["about"], {}, cloud);
  expect(result.code).toBe(0);
  expect(result.output).toContain("***redacted***");
  expect(result.output).toContain("truncated");
  expect(result.output).not.toContain("synthetic");
});

test.each([null, {}, [{ consoleVersion: 42 }]])("rejects malformed successful About responses: %j", async (data) => {
  const f = fixture();
  const result = await f.run(["about"], {}, fakeCloud(response(token), response(data)));
  expect(result.data).toMatchObject({ error: { code: "API_RESPONSE_INVALID" } });
});

test.each([
  ["a single object", { consoleVersion: "synthetic-value-sentinel", versions: [{ id: 1 }] }, "object{consoleVersion:string,versions:array[1]<object{id:number}>}"],
  ["a bare string", "synthetic-value-sentinel", "string"],
  ["null", null, "null"],
  ["tenant-controlled key names", { "synthetic-host.example.test": true, ok: false }, "object{<key>:boolean,ok:boolean}"],
  ["more keys than the cap", Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`k${index}`, index])), `object{${Array.from({ length: 20 }, (_, index) => `k${index}:number`).join(",")},+5 more}`],
  ["nesting past the depth cap", { a: { b: { c: { d: 1 } } } }, "object{a:object{b:object{c:object{...}}}}"],
])("About API_RESPONSE_INVALID reports the types of %s without values", async (_name, data, shape) => {
  const f = fixture();
  const result = await f.run(["about"], {}, fakeCloud(response(token), response(data)));
  expect(result.data).toMatchObject({ error: { code: "API_RESPONSE_INVALID" } });
  expect((result.data as { help: string[] }).help).toEqual([
    "Check API compatibility",
    `Response shape (types only, no values; arrays show their first element): ${shape}`,
  ]);
  expect(result.output).not.toContain("synthetic-value-sentinel");
  expect(result.output).not.toContain("synthetic-host");
});

test("API help remains offline without configuration", async () => {
  const f = fixture();
  f.env.BEYONDTRUST_AXI_CONFIG = "/missing/config.json";
  expect((await f.run(["task", "status", "--help"])).data).toMatchObject({ command: "task status" });
});
