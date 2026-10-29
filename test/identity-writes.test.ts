import { existsSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { localFixture } from "./support/local-cli.js";
import { fakeCloud, response, token } from "./support/fake-pm-cloud.js";

const id = "00000000-0000-0000-0000-000000000001";
const other = "00000000-0000-0000-0000-000000000002";
const fixtures: ReturnType<typeof localFixture>[] = [];
function fixture(operation: string) {
  const f = localFixture();
  f.env.XDG_STATE_HOME = f.directory;
  f.profile.profiles.example.writes = { allowWrites: true, allowDeletes: false, operations: [operation] };
  f.save(); fixtures.push(f);
  return { ...f, file: join(f.directory, "input.json"), journal: join(f.directory, "beyondtrust-axi", "writes") };
}
afterEach(() => { for (const f of fixtures.splice(0)) f.cleanup(); });
// Synthetic fixtures cite inventory/swagger.json: the twelve write method/path pairs
// below and GET /v3/Users[/{id}], /v3/AcceptedDomains[/{id}], /scim/v3/users[/{userID}].
const cases = [
  { command: "user create", method: "POST", path: "/v3/Users", body: { emailAddress: "example@example.com", admin: true, globalRolesIds: [other] }, read: { totalRecordCount: 0, data: [] }, readPath: "/v3/Users", status: 201 },
  { command: "user update", method: "PUT", path: `/v3/Users/${id}`, body: { emailAddress: "example@example.com" }, read: { id, emailAddress: "before@example.com" }, readPath: `/v3/Users/${id}`, status: 204 },
  { command: "user preferences set", method: "PUT", path: `/v3/Users/${id}/ModifyUserPreferences`, body: { preferredLanguage: "en" }, read: { id, language: "en" }, readPath: `/v3/Users/${id}`, status: 204 },
  { command: "user assign-roles", method: "POST", path: `/v3/Users/${id}/AssignRoles`, body: { roleResource: [{ resourceType: "Group", resourceId: other, roleId: other }], globalRolesIds: [other] }, read: { id, roles: [] }, readPath: `/v3/Users/${id}`, status: 204 },
  ...["disable", "enable", "resend-invite"].map((action) => ({ command: `user ${action}`, method: "PATCH", path: `/v3/Users/${id}/${action === "disable" ? "Disable" : action === "enable" ? "Enable" : "ResendInvite"}`, body: undefined, read: { id, disabled: false }, readPath: `/v3/Users/${id}`, status: 204 })),
  { command: "domain create", method: "POST", path: "/v3/AcceptedDomains", body: { domainName: "example.com" }, read: [], readPath: "/v3/AcceptedDomains", status: 201 },
  { command: "domain update", method: "PUT", path: `/v3/AcceptedDomains/${id}`, body: { domainName: "example.com" }, read: { id, domain: "before.example.com" }, readPath: `/v3/AcceptedDomains/${id}`, status: 204 },
  { command: "scim user create", method: "POST", path: "/scim/v3/users", body: { userName: "example", active: true }, read: { totalResults: 0, Resources: [] }, readPath: "/scim/v3/users", status: 201 },
  { command: "scim user replace", method: "PUT", path: `/scim/v3/users/${id}`, body: { userName: "example", active: false }, read: { id, userName: "before", active: true }, readPath: `/scim/v3/users/${id}`, status: 200 },
  { command: "scim user patch", method: "PATCH", path: `/scim/v3/users/${id}`, body: { operations: [{ op: "replace", path: "active", value: [{ valueBoolean: false }] }] }, read: { id, active: true }, readPath: `/scim/v3/users/${id}`, status: 200 },
];
function operation(command: string) { return command === "user preferences set" ? "user.preferences" : command.replaceAll(" ", "."); }
function argsFor(c: typeof cases[number], f: ReturnType<typeof fixture>) {
  if (c.body) writeFileSync(f.file, JSON.stringify(c.body), { mode: 0o600 });
  return [...c.command.split(" "), ...(c.command.endsWith(" create") ? [] : [id]), ...(c.command.startsWith("domain ") ? ["example.com"] : c.body ? ["--file", f.file] : [])];
}

test.each(cases)("previews and sends $command with the documented $method $path payload", async (c) => {
  const f = fixture(operation(c.command));
  const args = argsFor(c, f);
  const previewCloud = fakeCloud(response(token), response(c.read));
  const preview = await f.run(args, {}, previewCloud);
  expect(preview.data.status).toBe("preview");
  expect(previewCloud.calls[1]!.url.pathname).toBe(`/management-api${c.readPath}`);
  expect(previewCloud.calls).toHaveLength(2);
  expect(existsSync(f.journal)).toBe(false);
  if (c.command === "user create") expect(preview.data.preview).toMatchObject({ admin: true, roles: { globalRolesIds: [other] } });
  if (c.command === "scim user patch" || c.command === "scim user replace") expect(preview.data.preview).toMatchObject({ warning: "deactivates user" });
  if (c.command === "user resend-invite") expect(preview.data.preview).toMatchObject({ warning: "sends an invitation email" });
  const cloud = fakeCloud(response(token), response(c.read), response(c.path.startsWith("/scim/") ? null : c.status === 201 ? id : null, c.status));
  const request: typeof cloud.request = async (url, options) => {
    if (options.method === c.method && url.pathname === `/management-api${c.path}`) expect(readdirSync(f.journal)).toHaveLength(1);
    return cloud.request(url, options);
  };
  const sent = await f.run([...args, "--execute", "--confirm", preview.data.confirmation as string], {}, { request });
  expect(sent.data.status).toBe("sent");
  expect(cloud.calls.at(-1)!.options.method).toBe(c.method);
  expect(cloud.calls.at(-1)!.url.pathname).toBe(`/management-api${c.path}`);
  expect(cloud.calls.at(-1)!.options.body === undefined ? undefined : JSON.parse(cloud.calls.at(-1)!.options.body!.toString())).toEqual(c.body);
});

test.each(["forced", "operation", "disabled", "env"])("denies %s identity writes before authentication", async (gate) => {
  const f = fixture("user.enable");
  if (gate === "forced") f.env.BEYONDTRUST_AXI_READ_ONLY = "true";
  if (gate === "operation") f.profile.profiles.example.writes.operations = ["user.enable.extra"];
  if (gate === "disabled") f.profile.profiles.example.writes.allowWrites = false;
  if (gate === "env") Object.assign(f.env, { BEYONDTRUST_AXI_HOST: "example.pm.beyondtrustcloud.com", BEYONDTRUST_AXI_CLIENT_ID: "example", BEYONDTRUST_AXI_CLIENT_SECRET: "example-secret" });
  f.save();
  const cloud = fakeCloud();
  expect((await f.run(["user", "enable", id], {}, cloud)).data).toMatchObject({ error: { code: "WRITES_DISABLED" } });
  expect(cloud.calls).toHaveLength(0);
});

test.each(["json", "unknown", "uuid", "type", "oversized", "symlink"])("refuses %s identity file before authentication", async (kind) => {
  const f = fixture("user.assign-roles");
  writeFileSync(f.file, kind === "json" ? "{" : kind === "unknown" ? '{"roles":[]}' : kind === "uuid" ? '{"globalRolesIds":["invalid"]}' : kind === "type" ? '{"roleResource":true}' : kind === "oversized" ? Buffer.alloc(10 * 1024 * 1024 + 1) : "{}", { mode: 0o600 });
  const link = join(f.directory, "link.json");
  if (kind === "symlink") symlinkSync(f.file, link);
  const cloud = fakeCloud();
  expect((await f.run(["user", "assign-roles", id, "--file", kind === "symlink" ? link : f.file], {}, cloud)).data).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  expect(cloud.calls).toHaveLength(0);
});

test.each(["state", "file", "wrong-target", "invalid-read"])("refuses changed or invalid %s before execution", async (change) => {
  const f = fixture("user.update");
  writeFileSync(f.file, '{"language":"en"}', { mode: 0o600 });
  const args = ["user", "update", id, "--file", f.file];
  const preview = await f.run(args, {}, fakeCloud(response(token), response({ id, language: "en" })));
  if (change === "file") writeFileSync(f.file, '{"language":"fr"}');
  const cloud = fakeCloud(response(token), response(change === "invalid-read" ? {} : { id: change === "wrong-target" ? other : id, language: change === "state" ? "fr" : "en" }));
  expect((await f.run([...args, "--execute", "--confirm", preview.data.confirmation as string], {}, cloud)).data).toMatchObject({ error: { code: change === "wrong-target" || change === "invalid-read" ? "API_RESPONSE_INVALID" : "CONFIRMATION_REQUIRED" } });
  expect(cloud.calls).toHaveLength(2);
  expect(existsSync(f.journal)).toBe(false);
});

test.each([401, 409, 423, 429, 500, "network"])("never retries identity write after %s", async (failure) => {
  const f = fixture("user.enable");
  const args = ["user", "enable", id];
  const preview = await f.run(args, {}, fakeCloud(response(token), response({ id })));
  const cloud = fakeCloud(response(token), response({ id }), response({ title: f.env.SYNTHETIC_SECRET }, typeof failure === "number" ? failure : 500));
  let sends = 0;
  const request: typeof cloud.request = async (url, options) => {
    if (options.method === "PATCH") { sends++; if (failure === "network") throw new Error(f.env.SYNTHETIC_SECRET); }
    return cloud.request(url, options);
  };
  const result = await f.run([...args, "--execute", "--confirm", preview.data.confirmation as string], {}, { request });
  expect(result.code).toBe(1);
  expect(sends).toBe(1);
  expect(result.output).not.toContain(f.env.SYNTHETIC_SECRET);
  if (failure === 500 || failure === "network") expect(result.data.error).toMatchObject({ code: "OUTCOME_UNKNOWN", auditId: expect.any(String) });
});

test("redacts SCIM passwords from preview, result and durable intent", async () => {
  const f = fixture("scim.user.replace");
  const password = "example-password-private";
  writeFileSync(f.file, JSON.stringify({ userName: "example", password }), { mode: 0o600 });
  const args = ["scim", "user", "replace", id, "--file", f.file];
  const preview = await f.run(args, {}, fakeCloud(response(token), response({ id, password: "example-prior-password", displayName: "example-prior-password" })));
  expect(preview.data.status).toBe("preview");
  const cloud = fakeCloud(response(token), response({ id, password: "example-prior-password", displayName: "example-prior-password" }), response({ id, password: "example-returned-password", displayName: "example-returned-password" }));
  const sent = await f.run([...args, "--execute", "--confirm", preview.data.confirmation as string], {}, cloud);
  expect(sent.data.status).toBe("sent");
  expect(JSON.parse(cloud.calls.at(-1)!.options.body!.toString()).password).toBe(password);
  expect(preview.output + sent.output + readFileSync(join(f.journal, readdirSync(f.journal)[0]!), "utf8")).not.toContain(password);
  expect(preview.output + sent.output).not.toContain("example-prior-password");
  expect(sent.output).not.toContain("example-returned-password");
});
