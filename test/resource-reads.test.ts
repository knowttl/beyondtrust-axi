import { afterEach, expect, test } from "vitest";
import { localFixture } from "./support/local-cli.js";
import { fakeCloud, response, token } from "./support/fake-pm-cloud.js";

const id = "00000000-0000-0000-0000-000000000001";
const fixtures: ReturnType<typeof localFixture>[] = [];
function fixture() { const f = localFixture(); fixtures.push(f); return f; }
afterEach(() => { for (const f of fixtures.splice(0)) f.cleanup(); });
const page = (data: unknown[], pageNumber = 1, pageSize = 50, totalRecordCount = data.length, pageCount = 1) => ({ data, pageNumber, pageSize, totalRecordCount, pageCount });

test.each([
  "computer list", "computer view", "computer command-log", "computer logs",
  "group list", "group view", "policy list", "policy view", "policy revisions",
  "policy assigned-groups", "policy windows-application-groups", "policy macos-application-groups",
])("%s help exposes only the public command reference", async (command) => {
  const f = fixture();
  f.env.BEYONDTRUST_AXI_CONFIG = "/missing/config.json";
  const cloud = fakeCloud();
  const result = await f.run([...command.split(" "), "--help"], {}, cloud);
  expect(result.code).toBe(0);
  expect(result.data).toEqual({
    command, description: expect.any(String),
    flags: expect.objectContaining({ help: "Show command help", profile: expect.any(String) }),
    examples: expect.arrayContaining([`beyondtrust-axi ${command} --help`]),
  });
  expect(cloud.calls).toHaveLength(0);
});

// Each case cites GET plus the exact path in inventory/swagger.json; omitted model fields are optional.
test.each([
  ["computer list", "/v3/Computers", page([{ id, host: "example" }]), [{ id, host: "example" }]],
  ["computer view", `/v3/Computers/${id}`, { id, connected: true }, { id, connected: true }],
  ["computer command-log", `/v3/Computers/${id}/CommandLog`, [{ command: "example" }], [{ command: "example" }]],
  ["computer logs", `/v3/Computers/${id}/Logs`, [{ id, returned: null }], [{ id, returned: null }]],
  ["group list", "/v3/Groups", page([{ id, name: "example" }]), [{ id, name: "example" }]],
  ["group view", `/v3/Groups/${id}`, { id, name: "example" }, { id, name: "example" }],
  ["policy list", "/v3/Policies", page([{ id, name: "example" }]), [{ id, name: "example" }]],
  ["policy view", `/v3/Policies/${id}`, { id, name: "example" }, { id, name: "example" }],
  ["policy revisions", `/v3/Policies/${id}/Revisions`, [{ id, revision: 1 }], [{ id, revision: 1 }]],
  ["policy assigned-groups", `/v3/Policies/${id}/AssignedGroups`, [{ id, isDefault: false }], [{ id, isDefault: false }]],
  ["policy windows-application-groups", `/PolicyEditor/v3/Policy/${id}/Windows/ApplicationGroups`, [{ id, applications: [{ id, description: "example" }] }], [{ id, applications: [{ id, description: "example" }] }]],
  ["policy macos-application-groups", `/PolicyEditor/v3/Policy/${id}/MacOS/ApplicationGroups`, [{ id, applications: null }], [{ id, applications: null }]],
])("reads %s through the CLI", async (command, path, body, expected) => {
  const f = fixture();
  const cloud = fakeCloud(response(token), response(body));
  const args = (command as string).split(" ");
  if (!command.endsWith(" list")) args.push("--id", id);
  const result = await f.run(args, {}, cloud);
  expect(result.code).toBe(0);
  expect(result.data.data).toEqual(expected);
  expect(cloud.calls[1]!.url.pathname).toBe(`/management-api${path}`);
  expect(cloud.calls.every((call) => call.options.method === "GET" || call.url.pathname === "/oauth/connect/token")).toBe(true);
});

test("computer filters use encoded query parameters and created ascending sorting", async () => {
  const f = fixture();
  const cloud = fakeCloud(response(token), response(page([])));
  const result = await f.run(["computer", "list", "--host", "example & value", "--host-type", "Linux", "--connection-status", "Connected,Disconnected", "--group-id", id], {}, cloud);
  expect(result.code).toBe(0);
  const query = cloud.calls[1]!.url.searchParams;
  expect(query.get("Filter.Host")).toBe("example & value");
  expect(query.get("Filter.HostType")).toBe("Linux");
  expect(query.getAll("Filter.ConnectionStatus")).toEqual(["Connected", "Disconnected"]);
  expect(query.get("Filter.GroupId")).toBe(id);
  expect(query.get("Sorts[0].by")).toBe("created");
  expect(query.get("Sorts[0].order")).toBe("asc");
});

test.each([
  ["computer list", "host", "Filter.Host", page([])],
  ["group list", "description", "Filter.Description", page([])],
  ["policy list", "name", "Filter.Name", page([])],
  ["policy windows-application-groups", "application-description", "Filter.ApplicationDescription", []],
  ["policy macos-application-groups", "application-description", "Filter.ApplicationDescription", []],
])("preserves literal asterisks in %s filters", async (command, flag, parameter, body) => {
  const f = fixture();
  const cloud = fakeCloud(response(token), response(body));
  const args = command.split(" ");
  if (!command.endsWith(" list")) args.push("--id", id);
  const result = await f.run([...args, `--${flag}`, "example *"], {}, cloud);
  expect(result.code).toBe(0);
  expect(result.data.data).toEqual([]);
  expect(cloud.calls[1]!.url.searchParams.get(parameter)).toBe("example *");
});

test("all stops at 1000 rows and resumes without skipping a partial page", async () => {
  const f = fixture();
  const rows = Array.from({ length: 200 }, (_, index) => ({ name: `example-${index}` }));
  const cloud = fakeCloud(response(token), ...[1, 2, 3, 4, 5].map((n) => response(page(rows, n, 200, 1200, 6))));
  const result = await f.run(["group", "list", "--all"], {}, cloud);
  expect(result.code).toBe(0);
  expect(result.data.count).toBe(1000);
  expect(cloud.calls).toHaveLength(6);
  const next = fakeCloud(response(token), response(page(rows, 6, 200, 1200, 6)));
  const resumed = await f.run(["group", "list", "--limit", "3", "--cursor", String(result.data.cursor)], {}, next);
  expect(resumed.data.data).toEqual(rows.slice(0, 3));
  expect(next.calls[1]!.url.searchParams.get("Pagination.PageNumber")).toBe("6");
  const final = await f.run(["group", "list", "--cursor", String(resumed.data.cursor)], {}, fakeCloud(response(token), response(page(rows, 6, 200, 1200, 6))));
  expect(final.data.data).toEqual(rows.slice(3, 53));
});

test("unpaged arrays use bounded rows and resumable offsets", async () => {
  const f = fixture();
  const rows = [{ id, revision: 1 }, { id, revision: 2 }, { id, revision: 3 }];
  const first = await f.run(["policy", "revisions", "--id", id, "--limit", "2"], {}, fakeCloud(response(token), response(rows)));
  expect(first.data.count).toBe(2);
  const next = await f.run(["policy", "revisions", "--id", id, "--cursor", String(first.data.cursor)], {}, fakeCloud(response(token), response(rows)));
  expect(next.data.data).toEqual([rows[2]]);
  expect(next.data.cursor).toBe(null);
});

test.each([
  ["computer", "view", "--id", "../About"], ["computer", "list", "--host-type", "Other"],
  ["group", "list", "--default", "yes"], ["policy", "list", "--revision", "1.5"],
  ["computer", "list", "--limit", "1001"], ["computer", "list", "--all", "--limit", "1"],
  ["computer", "list", "--sort", "host:desc"], ["group", "list", "--sort", "name:sideways"],
  ["computer", "list", "--created-dates", "2026-01-01"], ["group", "list", "--cursor", "bad"],
  ["policy", "windows-application-groups", "--id", id, "--application-id", "bad"],
])("rejects invalid input before credentials or network: %j", async (...args) => {
  const f = fixture(); f.env.BEYONDTRUST_AXI_CONFIG = "/missing/config.json";
  const cloud = fakeCloud();
  expect((await f.run(args, {}, cloud)).code).toBe(2);
  expect(cloud.calls).toHaveLength(0);
});

test.each(["command", "filters", "host", "account", "profile"])("cursor is bound to %s", async (change) => {
  const f = fixture();
  const first = await f.run(["computer", "list", "--host", "example", "--limit", "1"], {}, fakeCloud(response(token), response(page([{ id }], 1, 1, 2, 2))));
  expect(first.code).toBe(0);
  expect(first.data.cursor).toEqual(expect.any(String));
  if (change === "host") f.profile.profiles.example.host = "other.pm.beyondtrustcloud.com";
  if (change === "account") f.profile.profiles.example.clientId = "other-synthetic-client";
  if (change === "profile") { f.profile.profiles.other = f.profile.profiles.example; delete f.profile.profiles.example; f.profile.defaultProfile = "other"; }
  f.save();
  const cloud = fakeCloud();
  const result = await f.run([change === "command" ? "group" : "computer", "list", change === "command" ? "--name" : "--host", change === "filters" ? "other" : "example", "--cursor", String(first.data.cursor)], {}, cloud);
  expect(result.code).toBe(2);
  expect(cloud.calls).toHaveLength(0);
});

test("resource values and continuation hints redact secrets and token variants", async () => {
  const f = fixture();
  const raw = f.env.SYNTHETIC_SECRET!;
  const result = await f.run(["computer", "list", "--host", raw, "--limit", "1"], {}, fakeCloud(response(token), response(page([{ id, host: `${raw} ${token.access_token}` }], 1, 1, 2, 2))));
  expect(result.code).toBe(0);
  expect(result.output).toContain("***redacted***");
  expect(result.output).not.toContain(raw);
  expect(result.output).not.toContain(token.access_token);
  expect(result.output).not.toContain(Buffer.from(raw).toString("base64"));
});

test.each([
  ["computer list", "host", page([{ id }], 1, 1, 2, 2)],
  ["group list", "name", page([{ id }], 1, 1, 2, 2)],
  ["policy list", "name", page([{ id }], 1, 1, 2, 2)],
  ["policy windows-application-groups", "application-description", [{ id }, { id }]],
  ["policy macos-application-groups", "application-description", [{ id }, { id }]],
])("redacts apostrophe-containing credentials before quoting %s continuation flags", async (command, flag, body) => {
  const f = fixture();
  f.env.SYNTHETIC_SECRET = "synthetic'secret";
  const accessToken = "synthetic'token";
  const filter = `${f.env.SYNTHETIC_SECRET} ${accessToken} example's`;
  const args = command.split(" ");
  if (!command.endsWith(" list")) args.push("--id", id);
  const result = await f.run([...args, `--${flag}`, filter, "--limit", "1"], {}, fakeCloud(response({ ...token, access_token: accessToken }), response(body)));
  expect(result.code).toBe(0);
  expect(result.data.cursor).toEqual(expect.any(String));
  expect(result.data.help).toEqual([`Run beyondtrust-axi ${command}${command.endsWith(" list") ? "" : ` --id '${id}'`} --${flag} '***redacted*** ***redacted*** example'\\''s' --cursor <cursor> to continue with the same profile`]);
});

test.each([
  ["computer list", page([{ host: 42 }])], ["group list", page([], 2)],
  ["policy list", page([], 1, 50, 100, 2)], ["computer view", []],
  ["policy revisions", [{ revision: "bad" }]], ["computer command-log", {}],
  ["computer list", { ...page([]), unexpected: true }],
  ["computer list", page([{ id, Host: "example" }])],
  ["group list", page([{ id, Name: "example" }])],
  ["policy list", page([{ id, Name: "example" }])],
  ["computer view", { id, endpointInformation: { SystemName: "example" } }],
  ["computer logs", [{ id, Returned: null }]],
  ["policy revisions", [{ id, Revision: 1 }]],
  ["policy assigned-groups", [{ id, IsDefault: false }]],
  ["policy windows-application-groups", [{ Id: id, Name: "example", Description: "example", Hidden: false, Applications: [] }]],
  ["policy macos-application-groups", [{ Id: id, Name: "example", Description: "example", Hidden: false, Applications: [] }]],
  ["policy windows-application-groups", [{ id, applications: [{ Id: id, Description: "example", Type: "exe", Disabled: false }] }]],
  ["policy macos-application-groups", [{ id, applications: [{ Id: id, Description: "example", Type: "sudo", Disabled: false }] }]],
])("rejects malformed successful resource responses: %s", async (command, body) => {
  const f = fixture();
  const args = command.split(" "); if (!command.endsWith(" list")) args.push("--id", id);
  const result = await f.run(args, {}, fakeCloud(response(token), response(body)));
  expect(result.data).toMatchObject({ error: { code: "API_RESPONSE_INVALID" } });
});

test("a request budget interruption returns the next unread page", async () => {
  const f = fixture();
  const pages = Array.from({ length: 9 }, (_, n) => response(page([{ id }], n + 1, 50, 20, 20)));
  const result = await f.run(["computer", "list", "--limit", "50"], {}, fakeCloud(response(token), ...pages));
  expect(result.code).toBe(0);
  expect(result.data.count).toBe(9);
  const next = fakeCloud(response(token), response(page([{ id }], 10, 50, 20, 20)));
  const resumed = await f.run(["computer", "list", "--limit", "1", "--cursor", String(result.data.cursor)], {}, next);
  expect(resumed.data.count).toBe(1);
  expect(next.calls[1]!.url.searchParams.get("Pagination.PageNumber")).toBe("10");
});
