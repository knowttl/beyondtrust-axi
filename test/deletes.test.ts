import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { localFixture } from "./support/local-cli.js";
import { fakeCloud, response, token } from "./support/fake-pm-cloud.js";

const id = "00000000-0000-0000-0000-000000000001";
const groupId = "00000000-0000-0000-0000-000000000002";
const appId = "00000000-0000-0000-0000-000000000003";
const fixtures: ReturnType<typeof localFixture>[] = [];
function fixture(command: string) {
  const f = localFixture();
  f.env.XDG_STATE_HOME = f.directory;
  f.profile.profiles.example.writes = { allowWrites: true, allowDeletes: true, operations: [command.replaceAll(" ", ".")] };
  f.save(); fixtures.push(f);
  return { ...f, journal: join(f.directory, "beyondtrust-axi", "writes") };
}
afterEach(() => { for (const f of fixtures.splice(0)) f.cleanup(); });
// Synthetic fixtures cite inventory/swagger.json: GET /v3/Computers/{id},
// GET /v3/Groups/{id}, GET /v3/AcceptedDomains/{id}, GET /v3/Policies/{id},
// GET /v3/Policies/{id}/AssignedGroups, GET /v3/Computers,
// GET /PolicyEditor/v3/Policy/{policyId}/Windows|MacOS/ApplicationGroups,
// and the six delete method/path pairs plus two shared Policy Editor POSTs below.
const current = (name = "example") => response({ id, name, domainName: name, endpointInformation: { systemDnsHostName: name } });
const groups = () => response([]);
const applications = (description = "example application") => response([{ id: groupId, name: "example", applications: [{ id: appId, description }] }]);
const confirmed = (data: Record<string, unknown>) => ["--execute", "--confirm", data.confirmation as string, "--confirm-delete", data.deleteConfirmation as string];

test.each([
  ["computer delete", "DELETE", "/v3/Computers", 201],
  ["computer deactivate", "POST", "/v3/Computers/Deactivate", 200],
  ["group delete", "DELETE", `/v3/Groups/${id}`, 204],
  ["domain delete", "DELETE", `/v3/AcceptedDomains/${id}`, 204],
  ["policy delete", "DELETE", `/v3/Policies/${id}?forceDelete=false`, 201],
  ["policy discard-draft", "PATCH", `/v3/Policies/${id}/DiscardDraft`, 204],
] as const)("previews and sends %s once through %s %s", async (command, method, path, status) => {
  const f = fixture(command);
  const args = [...command.split(" "), id];
  const reads = () => command === "policy delete" ? [current(), groups()] : [current()];
  const previewCloud = fakeCloud(response(token), ...reads());
  const preview = await f.run(args, {}, previewCloud);
  expect(preview.data).toMatchObject({ status: "preview", deleteConfirmation: expect.stringContaining(`DELETE ${command.replaceAll(" ", ".")} 1`) });
  expect(preview.data.deleteConfirmation).toContain("example");
  expect(previewCloud.calls.slice(1).every((call) => call.options.method === "GET")).toBe(true);
  expect(existsSync(f.journal)).toBe(false);
  const cloud = fakeCloud(response(token), ...reads(), response(status === 201 ? id : null, status));
  const request: typeof cloud.request = async (url, options) => {
    if (options.method === method && `${url.pathname}${url.search}` === `/management-api${path}`) expect(readdirSync(f.journal)).toHaveLength(1);
    return cloud.request(url, options);
  };
  const result = await f.run([...args, ...confirmed(preview.data)], {}, { request });
  expect(result.data.status).toBe("sent");
  expect(`${cloud.calls.at(-1)!.url.pathname}${cloud.calls.at(-1)!.url.search}`).toBe(`/management-api${path}`);
  expect(cloud.calls.at(-1)!.options.method).toBe(method);
  if (command.startsWith("computer ")) expect(JSON.parse(cloud.calls.at(-1)!.options.body!.toString())).toEqual({ computerIds: [id], allComputers: false });
  else expect(cloud.calls.at(-1)!.options.body).toBeUndefined();
  expect(JSON.parse(readFileSync(join(f.journal, readdirSync(f.journal)[0]!), "utf8"))).toMatchObject({ operation: command.replaceAll(" ", "."), request: { method, path } });
});

test.each(["windows", "macos"])("removes only selected %s applications", async (os) => {
  const f = fixture("policy app remove");
  const args = ["policy", "app", "remove", id, "--os", os, "--app-group", groupId, appId];
  const preview = await f.run(args, {}, fakeCloud(response(token), current(), applications()));
  expect(preview.data).toMatchObject({ status: "preview", deleteConfirmation: expect.stringContaining("example application") });
  const cloud = fakeCloud(response(token), current(), applications(), response({ revisionId: id, deleted: [appId], created: [] }, 201));
  expect((await f.run([...args, ...confirmed(preview.data)], {}, cloud)).data.status).toBe("sent");
  expect(cloud.calls.at(-1)!.url.pathname).toBe(`/management-api/PolicyEditor/v3/Policy/${id}/${os === "windows" ? "Windows" : "MacOS"}/ApplicationGroups/Applications`);
  expect(JSON.parse(cloud.calls.at(-1)!.options.body!.toString())).toEqual({ applicationData: { applicationGroups: { edit: [{ id: groupId, applications: { delete: [appId] } }] } } });
});

test.each(["forced", "operation", "writes", "deletes", "default-deletes", "env"])("denies %s before network access", async (gate) => {
  const f = fixture("group delete");
  if (gate === "forced") f.env.BEYONDTRUST_AXI_READ_ONLY = "true";
  if (gate === "operation") f.profile.profiles.example.writes.operations = ["group.delete.extra"];
  if (gate === "writes") f.profile.profiles.example.writes.allowWrites = false;
  if (gate === "deletes") f.profile.profiles.example.writes.allowDeletes = false;
  if (gate === "default-deletes") delete f.profile.profiles.example.writes.allowDeletes;
  if (gate === "env") Object.assign(f.env, { BEYONDTRUST_AXI_HOST: "example.pm.beyondtrustcloud.com", BEYONDTRUST_AXI_CLIENT_ID: "example", BEYONDTRUST_AXI_CLIENT_SECRET: "example", BEYONDTRUST_AXI_ALLOW_DELETES: "true" });
  f.save();
  const cloud = fakeCloud();
  expect((await f.run(["group", "delete", id], {}, cloud)).data).toMatchObject({ error: { code: gate === "deletes" || gate === "default-deletes" ? "DELETES_DISABLED" : "WRITES_DISABLED" } });
  expect(cloud.calls).toHaveLength(0);
});

test.each([undefined, "wrong"])("requires exact delete confirmation (%s) before journaling", async (confirmation) => {
  const f = fixture("group delete");
  const args = ["group", "delete", id];
  const preview = await f.run(args, {}, fakeCloud(response(token), current()));
  const cloud = fakeCloud(response(token), current());
  const result = await f.run([...args, "--execute", "--confirm", preview.data.confirmation as string, ...(confirmation ? ["--confirm-delete", confirmation] : [])], {}, cloud);
  expect(result.data).toMatchObject({ error: { code: "DELETE_CONFIRM_REQUIRED" } });
  expect(cloud.calls).toHaveLength(2);
  expect(existsSync(f.journal)).toBe(false);
});

test("force delete requires both operation permissions and previews assigned groups", async () => {
  const f = fixture("policy delete");
  const args = ["policy", "delete", id, "--force"];
  const denied = fakeCloud();
  expect((await f.run(args, {}, denied)).data).toMatchObject({ error: { code: "WRITES_DISABLED" } });
  expect(denied.calls).toHaveLength(0);
  f.profile.profiles.example.writes.operations.push("policy.delete.force"); f.save();
  const assigned = () => response([{ id: groupId, name: "example" }]);
  const preview = await f.run(args, {}, fakeCloud(response(token), current(), assigned()));
  expect(preview.data).toMatchObject({ preview: { force: true, groups: [{ id: groupId }] } });
  const cloud = fakeCloud(response(token), current(), assigned(), response(id, 201));
  expect((await f.run([...args, ...confirmed(preview.data)], {}, cloud)).data.status).toBe("sent");
  expect(cloud.calls.at(-1)!.url.searchParams.get("forceDelete")).toBe("true");
});

test.each(["computer delete", "computer deactivate"])("counts unbounded filtered %s selections", async (command) => {
  const f = fixture(command);
  const args = [...command.split(" "), "--host", "example"];
  const count = () => response({ pageNumber: 1, pageSize: 20, totalRecordCount: 10001, data: Array.from({ length: 20 }, () => ({ id, host: "example" })) });
  const preview = await f.run(args, {}, fakeCloud(response(token), count()));
  expect(preview.data).toMatchObject({ status: "preview", deleteConfirmation: expect.stringContaining("10001"), preview: { count: 10001, hosts: Array(20).fill("example") } });
  const cloud = fakeCloud(response(token), count(), response(id, 201));
  expect((await f.run([...args, ...confirmed(preview.data)], {}, cloud)).data.status).toBe("sent");
  expect(JSON.parse(cloud.calls.at(-1)!.options.body!.toString())).toEqual({ allComputers: true, filter: { host: "example" } });
});

test.each(["name", "applications", "assigned-groups", "count"])("refuses stale %s confirmation", async (change) => {
  const command = change === "applications" ? "policy app remove" : change === "assigned-groups" ? "policy delete" : change === "count" ? "computer delete" : "group delete";
  const f = fixture(command);
  const args = [...command.split(" "), ...(change === "count" ? ["--host", "example"] : [id]), ...(change === "applications" ? ["--os", "macos", "--app-group", groupId, appId] : [])];
  const count = (n: number) => response({ pageNumber: 1, pageSize: 20, totalRecordCount: n, data: Array.from({ length: n }, () => ({ id, host: "example" })) });
  const reads = (changed: boolean) => change === "count" ? [count(changed ? 2 : 1)] : [current(changed && change === "name" ? "changed" : "example"), ...(change === "applications" ? [applications(changed ? "changed" : "example application")] : change === "assigned-groups" ? [response(changed ? [{ id: groupId, name: "example" }] : [])] : [])];
  const preview = await f.run(args, {}, fakeCloud(response(token), ...reads(false)));
  const cloud = fakeCloud(response(token), ...reads(true));
  expect((await f.run([...args, ...confirmed(preview.data)], {}, cloud)).data).toMatchObject({ error: { code: "CONFIRMATION_REQUIRED" } });
  expect(existsSync(f.journal)).toBe(false);
});

test("refuses applications outside the selected group", async () => {
  const f = fixture("policy app remove");
  const result = await f.run(["policy", "app", "remove", id, "--os", "macos", "--app-group", groupId, groupId], {}, fakeCloud(response(token), current(), applications()));
  expect(result.data).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  expect(existsSync(f.journal)).toBe(false);
});

test.each([
  ["computer", "delete"],
  ["computer", "delete", "--all"],
  ["computer", "deactivate", id, "--host", "example"],
  ["computer", "delete", ...Array(21).fill(id)],
  ["group", "delete", id, groupId],
  ["domain", "delete", "invalid"],
  ["policy", "app", "remove", id, "--os", "linux", "--app-group", groupId, appId],
  ["policy", "app", "remove", id, "--os", "macos", "--app-group", groupId, appId, appId],
  ["policy", "app", "remove", id, "--os", "macos", "--app-group", groupId, appId, "--file", "input.json"],
])("rejects invalid delete selection %j before authentication", async (...args) => {
  const f = fixture("computer delete");
  const cloud = fakeCloud();
  expect((await f.run(args, {}, cloud)).data).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  expect(cloud.calls).toHaveLength(0);
});

test.each([401, 429, 500, "network", "invalid-response"])("does not replay an ambiguous or rejected delete after %s", async (failure) => {
  const f = fixture("group delete");
  const args = ["group", "delete", id];
  const preview = await f.run(args, {}, fakeCloud(response(token), current()));
  const cloud = fakeCloud(response(token), current(), response({ title: f.env.SYNTHETIC_SECRET }, typeof failure === "number" ? failure : 201));
  let sends = 0;
  const request: typeof cloud.request = async (url, options) => {
    if (options.method === "DELETE") { sends++; if (failure === "network") throw new Error(f.env.SYNTHETIC_SECRET); }
    return cloud.request(url, options);
  };
  const result = await f.run([...args, ...confirmed(preview.data)], {}, { request });
  expect(sends).toBe(1);
  expect(result.code).toBe(1);
  expect(result.output).not.toContain(f.env.SYNTHETIC_SECRET);
  expect(result.output).not.toContain(token.access_token);
  if (typeof failure === "string" || failure === 500) expect(result.data.error).toMatchObject({ code: "OUTCOME_UNKNOWN", auditId: expect.any(String) });
});

test("does not send when durable intent cannot be created", async () => {
  const f = fixture("group delete");
  const args = ["group", "delete", id];
  const preview = await f.run(args, {}, fakeCloud(response(token), current()));
  writeFileSync(join(f.directory, "beyondtrust-axi"), "blocked", { mode: 0o600 });
  const cloud = fakeCloud(response(token), current());
  expect((await f.run([...args, ...confirmed(preview.data)], {}, cloud)).data).toMatchObject({ error: { code: "JOURNAL_ERROR" } });
  expect(cloud.calls).toHaveLength(2);
});

test("redacts secret-derived target names and refuses a redacted confirmation", async () => {
  const f = fixture("group delete");
  const args = ["group", "delete", id];
  const preview = await f.run(args, {}, fakeCloud(response(token), current(f.env.SYNTHETIC_SECRET)));
  expect(preview.output).not.toContain(f.env.SYNTHETIC_SECRET);
  const result = await f.run([...args, ...confirmed(preview.data)], {}, fakeCloud(response(token), current(f.env.SYNTHETIC_SECRET)));
  expect(result.data).toMatchObject({ error: { code: "DELETE_CONFIRM_REQUIRED" } });
  expect(existsSync(f.journal)).toBe(false);
});
