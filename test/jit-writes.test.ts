import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { localFixture } from "./support/local-cli.js";
import { fakeCloud, response, token } from "./support/fake-pm-cloud.js";

const id = "00000000-0000-0000-0000-000000000001";
const fixtures: ReturnType<typeof localFixture>[] = [];
function fixture(operation: string) {
  const f = localFixture();
  f.env.XDG_STATE_HOME = f.directory;
  f.profile.profiles.example.writes = { allowWrites: true, allowDeletes: false, operations: [operation] };
  f.save(); fixtures.push(f);
  return { ...f, file: join(f.directory, "input.json"), journal: join(f.directory, "beyondtrust-axi", "writes") };
}
afterEach(() => { for (const f of fixtures.splice(0)) f.cleanup(); });
// Synthetic fixtures cite inventory/swagger.json: POST /v3/AdminAccessRequest,
// POST /v3/AdminAccessRequest/approval, POST /v3/AuthorizationRequest/notification,
// POST /v3/AppSwitcher/connector and their GET re-reads below.
const notification = { status: "closed", decision: "Approved", decisionPerformedByUser: "example", decisionTime: "2026-10-28T00:00:00Z", duration: "300", itsmRequestId: "example", message: "example", systemId: "example/ticket", ticketId: "example", ticketUrl: "https://example.com/ticket" };
const cases = [
  { command: "admin-request create", args: ["--computer", id, "--user", "example", "--decision", "approve", "--by", "example"], path: "/v3/AdminAccessRequest", body: { computerId: id, userId: "example", decision: "Approved", decisionPerformedByUser: "example" }, readPath: `/v3/Computers/${id}`, read: { id }, file: false },
  { command: "admin-request decide", args: [id, "--decision", "deny", "--by", "example", "--duration", "300", "--message", "example"], path: "/v3/AdminAccessRequest/approval", body: { requestId: id, decision: "Denied", decisionPerformedByUser: "example", duration: "300", message: "example" }, readPath: `/v3/AdminAccessRequest/${id}`, read: [{ requestInfo: { requestId: id } }], file: false },
  { command: "auth-request notify", args: [], path: "/v3/AuthorizationRequest/notification", body: notification, readPath: "/v3/AuthorizationRequest/example%2Fticket", read: [{ requestInfo: { user: "example" } }], file: true },
  { command: "app-switcher connect", args: [], path: "/v3/AppSwitcher/connector", body: { organizationId: id, connectorList: [{ connectorName: "example", connectorType: "Insight", url: "https://example.com", connectorId: id, tenantId: id }] }, readPath: "/v3/About", read: [{ consoleVersion: "26.3" }], file: true },
];
function argsFor(c: typeof cases[number], f: ReturnType<typeof fixture>) {
  if (c.file) writeFileSync(f.file, JSON.stringify(c.body), { mode: 0o600 });
  return [...c.command.split(" "), ...c.args, ...(c.file ? ["--file", f.file] : [])];
}

test.each(cases)("previews and sends $command through the gated coordinator", async (c) => {
  const f = fixture(c.command.replaceAll(" ", "."));
  const args = argsFor(c, f);
  const previewCloud = fakeCloud(response(token), response(c.read));
  const preview = await f.run(args, {}, previewCloud);
  expect(preview.data.status).toBe("preview");
  expect(previewCloud.calls[1]!.url.pathname).toBe(`/management-api${c.readPath}`);
  expect(previewCloud.calls).toHaveLength(2);
  expect(existsSync(f.journal)).toBe(false);
  if (c.command === "admin-request create") expect(preview.data.preview).toMatchObject({ warning: "Creates a pre-approved request and grants admin rights" });
  if (c.command === "auth-request notify") expect(preview.data.preview).not.toHaveProperty("warning");
  const cloud = fakeCloud(response(token), response(c.read), response(c.command === "app-switcher connect" ? id : null));
  const request: typeof cloud.request = async (url, options) => {
    if (url.pathname === `/management-api${c.path}` && options.method === "POST") expect(readdirSync(f.journal)).toHaveLength(1);
    return cloud.request(url, options);
  };
  const sent = await f.run([...args, "--execute", "--confirm", preview.data.confirmation as string], {}, { request });
  expect(sent.data, sent.output).toMatchObject({ status: "sent" });
  expect(cloud.calls.at(-1)!.options.method).toBe("POST");
  expect(cloud.calls.at(-1)!.url.pathname).toBe(`/management-api${c.path}`);
  expect(JSON.parse(cloud.calls.at(-1)!.options.body!.toString())).toEqual(c.body);
});

test.each([
  { decision: "approve", warning: "Approves the request and grants admin rights" },
  { decision: "deny", warning: undefined },
])("previews admin decision $decision with the appropriate warning", async ({ decision, warning }) => {
  const f = fixture("admin-request.decide");
  const cloud = fakeCloud(response(token), response([{ requestInfo: { requestId: id } }]));
  const result = await f.run(["admin-request", "decide", id, "--decision", decision, "--by", "example"], {}, cloud);
  expect(result.data.status).toBe("preview");
  expect((result.data.preview as Record<string, unknown>).warning).toBe(warning);
});

test.each(["forced", "operation", "disabled", "env"])("denies %s JIT writes before authentication", async (gate) => {
  const f = fixture("admin-request.create");
  if (gate === "forced") f.env.BEYONDTRUST_AXI_READ_ONLY = "true";
  if (gate === "operation") f.profile.profiles.example.writes.operations = ["admin-request.create.extra"];
  if (gate === "disabled") f.profile.profiles.example.writes.allowWrites = false;
  if (gate === "env") Object.assign(f.env, { BEYONDTRUST_AXI_HOST: "example.pm.beyondtrustcloud.com", BEYONDTRUST_AXI_CLIENT_ID: "example", BEYONDTRUST_AXI_CLIENT_SECRET: "example-secret" });
  f.save();
  const cloud = fakeCloud();
  expect((await f.run(argsFor(cases[0]!, f), {}, cloud)).data).toMatchObject({ error: { code: "WRITES_DISABLED" } });
  expect(cloud.calls).toHaveLength(0);
});

test("rejects creation-time denial before authentication", async () => {
  const f = fixture("admin-request.create");
  const cloud = fakeCloud();
  const result = await f.run(["admin-request", "create", "--computer", id, "--user", "example", "--decision", "deny", "--by", "example"], {}, cloud);
  expect(result.data).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  expect(cloud.calls).toHaveLength(0);
});

test("previews creation without a decision", async () => {
  const f = fixture("admin-request.create");
  const cloud = fakeCloud(response(token), response({ id }));
  const result = await f.run(["admin-request", "create", "--computer", id, "--user", "example"], {}, cloud);
  expect(result.data).toMatchObject({ status: "preview", preview: { request: { computerId: id, userId: "example" } } });
  expect(result.data.preview).not.toHaveProperty("request.decision");
});

test.each([
  { action: "create", flag: "--duration" },
  { action: "create", flag: "--message" },
  { action: "create", flag: "--user-name" },
  { action: "create", flag: "--reason" },
  { action: "create", flag: "--system-id" },
  { action: "create", flag: "--ticket-id" },
  { action: "create", flag: "--ticket-url" },
  { action: "decide", flag: "--system-id" },
  { action: "decide", flag: "--ticket-id" },
  { action: "decide", flag: "--ticket-url" },
])("rejects removed $action flag $flag before authentication", async ({ action, flag }) => {
  const f = fixture(`admin-request.${action}`);
  const cloud = fakeCloud();
  const result = await f.run(["admin-request", action, flag, "example"], {}, cloud);
  expect(result.data).toMatchObject({ error: { code: "VALIDATION_ERROR", message: `Unknown or duplicate flag ${flag}` } });
  expect(cloud.calls).toHaveLength(0);
});

test.each(["decision", "by", "computer", "user"])("requires valid create %s before authentication", async (field) => {
  const f = fixture("admin-request.create");
  const args = ["admin-request", "create", "--computer", id, "--user", "example", "--decision", "approve", "--by", "example"];
  args[args.indexOf(`--${field}`) + 1] = field === "decision" ? "Approved" : field === "computer" ? "invalid" : " ";
  const cloud = fakeCloud();
  expect((await f.run(args, {}, cloud)).data).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  expect(cloud.calls).toHaveLength(0);
});

test.each(Object.keys(notification))("requires notification field %s before authentication", async (field) => {
  const f = fixture("auth-request.notify");
  const body: Record<string, unknown> = { ...notification };
  delete body[field];
  writeFileSync(f.file, JSON.stringify(body), { mode: 0o600 });
  const cloud = fakeCloud();
  expect((await f.run(["auth-request", "notify", "--file", f.file], {}, cloud)).data).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  expect(cloud.calls).toHaveLength(0);
});

test.each(["state", "file", "invalid-read", "confirmation"])("refuses changed or invalid %s before sending", async (change) => {
  const f = fixture("auth-request.notify");
  const args = argsFor(cases[2]!, f);
  const preview = await f.run(args, {}, fakeCloud(response(token), response(cases[2]!.read)));
  if (change === "file") writeFileSync(f.file, JSON.stringify({ ...notification, message: "changed" }));
  const cloud = fakeCloud(response(token), response(change === "invalid-read" ? {} : change === "state" ? [{ requestInfo: { user: "changed" } }] : cases[2]!.read));
  const result = await f.run([...args, "--execute", "--confirm", change === "confirmation" ? "wrong" : preview.data.confirmation as string], {}, cloud);
  expect(result.data).toMatchObject({ error: { code: change === "invalid-read" ? "API_RESPONSE_INVALID" : "CONFIRMATION_REQUIRED" } });
  expect(cloud.calls).toHaveLength(2);
  expect(existsSync(f.journal)).toBe(false);
});

test.each([401, 409, 423, 429, 500, "network"])("never retries a JIT send after %s", async (failure) => {
  const f = fixture("admin-request.create");
  const args = argsFor(cases[0]!, f);
  const preview = await f.run(args, {}, fakeCloud(response(token), response({ id })));
  const cloud = fakeCloud(response(token), response({ id }), response({ title: f.env.SYNTHETIC_SECRET }, typeof failure === "number" ? failure : 500));
  let sends = 0;
  const request: typeof cloud.request = async (url, options) => {
    if (url.pathname.endsWith("/AdminAccessRequest") && options.method === "POST") { sends++; if (failure === "network") throw new Error(f.env.SYNTHETIC_SECRET); }
    return cloud.request(url, options);
  };
  const result = await f.run([...args, "--execute", "--confirm", preview.data.confirmation as string], {}, { request });
  expect(result.code).toBe(1);
  expect(sends).toBe(1);
  expect(result.output + readFileSync(join(f.journal, readdirSync(f.journal)[0]!), "utf8")).not.toContain(f.env.SYNTHETIC_SECRET);
  if (failure === 500 || failure === "network") expect(result.data.error).toMatchObject({ code: "OUTCOME_UNKNOWN", auditId: expect.any(String) });
});
