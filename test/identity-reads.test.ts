import { afterEach, expect, test } from "vitest";
import { localFixture } from "./support/local-cli.js";
import { fakeCloud, response, token } from "./support/fake-pm-cloud.js";

const id = "00000000-0000-0000-0000-000000000001";
const fixtures: ReturnType<typeof localFixture>[] = [];
function fixture() { const f = localFixture(); fixtures.push(f); return f; }
afterEach(() => { for (const f of fixtures.splice(0)) f.cleanup(); });
const page = (data: unknown[]) => ({ data, pageNumber: 1, pageSize: 50, totalRecordCount: data.length, pageCount: 1 });
const scim = (Resources: unknown[], startIndex = 1, totalResults = Resources.length) => ({ Resources, startIndex, totalResults, itemsPerPage: Resources.length });

// Fixtures cite GET and the exact path from inventory/swagger.json; omitted fields are optional.
test.each([
  ["user list", "/v3/Users", [], page([{ id, accountName: "example" }]), [{ id, accountName: "example" }]],
  ["user show", `/v3/Users/${id}`, ["--id", id], { id, roles: null }, { id, roles: null }],
  ["role list", "/v3/Roles", [], [{ id, name: "example" }], [{ id, name: "example" }]],
  ["role show", `/v3/Roles/${id}`, ["--id", id], { id, allowPermissions: [] }, { id, allowPermissions: [] }],
  ["global-role list", "/v3/GlobalRoles", [], page([{ id, isBuiltIn: true }]), [{ id, isBuiltIn: true }]],
  ["global-role show", `/v3/GlobalRoles/${id}`, ["--id", id], { id, users: [] }, { id, users: [] }],
  ["domain list", "/v3/AcceptedDomains", [], [{ id, domain: "example" }], [{ id, domain: "example" }]],
  ["domain show", `/v3/AcceptedDomains/${id}`, ["--id", id], { id, domain: "example" }, { id, domain: "example" }],
  ["api-account list", "/v3/ApiAccounts", [], [{ id, name: "example", managementAccess: 1 }], [{ id, name: "example", managementAccess: 1 }]],
  ["auth-provider show", "/v3/AuthenticationProvider", [], { provider: "example" }, { provider: "example" }],
  ["scim resource-types", "/scim/v3/ResourceTypes", [], scim([{ name: "example" }]), [{ name: "example" }]],
  ["scim resource-types", "/scim/v3/ResourceTypes/User", ["--type", "user"], { name: "User" }, { name: "User" }],
  ["scim resource-types", "/scim/v3/ResourceTypes/Role", ["--type", "role"], { name: "Role" }, { name: "Role" }],
  ["scim schemas", "/scim/v3/Schemas", [], scim([{ id: "example", attributes: [{ name: "example", subAttributes: [] }] }]), [{ id: "example", attributes: [{ name: "example", subAttributes: [] }] }]],
  ["scim config", "/scim/v3/ServiceProviderConfig", [], { patch: { supported: true } }, { patch: { supported: true } }],
  ["scim-role list", "/scim/v3/Roles", [], scim([{ value: "example", enabled: true }]), [{ value: "example", enabled: true }]],
  ["scim-user list", "/scim/v3/users", [], scim([{ id, userName: "example", groups: [{ value: "example" }] }]), [{ id, userName: "example", groups: [{ value: "example" }] }]],
  ["scim-user show", `/scim/v3/users/${id}`, ["--id", id], { id, active: true }, { id, active: true }],
])("reads %s at %s", async (command, path, args, body, expected) => {
  const f = fixture();
  const cloud = fakeCloud(response(token), response(body));
  const result = await f.run([...command.split(" "), ...args as string[]], {}, cloud);
  expect(result.code).toBe(0);
  expect(result.data.data).toEqual(expected);
  expect(cloud.calls[1]!.url.pathname).toBe(`/management-api${path}`);
  expect(cloud.calls[1]!.options.method).toBe("GET");
  expect(cloud.calls[1]!.options.headers.accept).toBe(path.startsWith("/scim/") ? "application/scim+json" : "application/json");
});

test.each([
  "user list", "user show", "role list", "role show", "global-role list", "global-role show",
  "domain list", "domain show", "api-account list", "auth-provider show", "scim resource-types",
  "scim schemas", "scim config", "scim-role list", "scim-user list", "scim-user show",
])("%s help works without credentials", async (command) => {
  const f = fixture(); f.env.BEYONDTRUST_AXI_CONFIG = "/missing/config.json";
  const cloud = fakeCloud();
  const result = await f.run([...command.split(" "), "--help"], {}, cloud);
  expect(result.code).toBe(0);
  expect(result.data).toMatchObject({ command, flags: { help: "Show command help" } });
  expect(cloud.calls).toHaveLength(0);
});

test("user filters retain literal values and validate last sign-in ranges", async () => {
  const f = fixture();
  const cloud = fakeCloud(response(token), response(page([])));
  const result = await f.run(["user", "list", "--email-address", "example & *", "--disabled", "false", "--role-id", id, "--last-signed-in-dates", "2026-01-01,2026-02-01", "--last-signed-in-selection-mode", "Range"], {}, cloud);
  expect(result.code).toBe(0);
  expect(cloud.calls[1]!.url.searchParams.get("Filter.EmailAddress")).toBe("example & *");
  expect(cloud.calls[1]!.url.searchParams.get("Filter.Disabled")).toBe("false");
  expect(cloud.calls[1]!.url.searchParams.getAll("Filter.LastSignedIn.Dates")).toEqual(["2026-01-01", "2026-02-01"]);
});

test("SCIM pagination advances by returned rows and preserves filter across cursors", async () => {
  const f = fixture();
  const filter = 'userName eq "example & *"';
  const cloud = fakeCloud(response(token), response(scim([{ id }], 1, 3)), response(scim([{ id }], 2, 3)));
  const result = await f.run(["scim-user", "list", "--filter", filter, "--limit", "2"], {}, cloud);
  expect(result.code).toBe(0);
  expect(result.data).toMatchObject({ count: 2, total: 3, cursor: expect.any(String) });
  expect(cloud.calls[2]!.url.searchParams.get("startIndex")).toBe("2");
  expect(cloud.calls[2]!.url.searchParams.get("count")).toBe("2");
  expect(cloud.calls[2]!.url.searchParams.get("filter")).toBe(filter);
  const next = fakeCloud(response(token), response(scim([{ id }], 3, 3)));
  const resumed = await f.run(["scim-user", "list", "--filter", filter, "--cursor", String(result.data.cursor)], {}, next);
  expect(resumed.data).toMatchObject({ count: 1, total: 3, cursor: null });
  expect(next.calls[1]!.url.searchParams.get("startIndex")).toBe("3");
  const mismatch = fakeCloud();
  expect((await f.run(["scim-user", "list", "--filter", "other", "--cursor", String(result.data.cursor)], {}, mismatch)).code).toBe(2);
  expect(mismatch.calls).toHaveLength(0);
});

test("SCIM discovery lists resume client-side offsets", async () => {
  const f = fixture();
  const body = scim([{ name: "User" }, { name: "Role" }]);
  const first = await f.run(["scim", "resource-types", "--limit", "1"], {}, fakeCloud(response(token), response(body)));
  const next = await f.run(["scim", "resource-types", "--cursor", String(first.data.cursor)], {}, fakeCloud(response(token), response(body)));
  expect(next.data).toMatchObject({ data: [{ name: "Role" }], count: 1, total: 2, cursor: null });
});

test("SCIM all caps rows and resumes at the next start index", async () => {
  const f = fixture();
  const rows = Array.from({ length: 200 }, () => ({ id }));
  const cloud = fakeCloud(response(token), ...[1, 201, 401, 601, 801].map((start) => response(scim(rows, start, 1200))));
  const first = await f.run(["scim-user", "list", "--all"], {}, cloud);
  expect(first.data).toMatchObject({ count: 1000, total: 1200, cursor: expect.any(String) });
  const next = fakeCloud(response(token), response(scim(rows, 1001, 1200)));
  const last = await f.run(["scim-user", "list", "--all", "--cursor", String(first.data.cursor)], {}, next);
  expect(last.data).toMatchObject({ count: 200, cursor: null });
  expect(next.calls[1]!.url.searchParams.get("startIndex")).toBe("1001");
});

test("SCIM passwords never appear in list or detail output", async () => {
  const f = fixture();
  const user = { id, password: "synthetic-response-password" };
  const list = await f.run(["scim-user", "list", "--full"], {}, fakeCloud(response(token), response(scim([user]))));
  const detail = await f.run(["scim-user", "show", "--id", id, "--full"], {}, fakeCloud(response(token), response(user)));
  expect(list.data.data).toEqual([{ id }]);
  expect(detail.data.data).toEqual({ id });
});

test.each([
  ["user", "show", "--id", "../About"], ["user", "list", "--role-id", "bad"],
  ["user", "list", "--last-signed-in-dates", "2026-01-01"],
  ["user", "list", "--last-signed-in-dates", "2026-02-01,2026-01-01", "--last-signed-in-selection-mode", "Range"],
  ["global-role", "list", "--is-built-in", "yes"], ["scim", "resource-types", "--type", "other"],
  ["scim-user", "list", "--start-index", "0"], ["domain", "list", "--sort", "name:asc"],
])("rejects invalid identity read before credentials: %j", async (...args) => {
  const f = fixture(); f.env.BEYONDTRUST_AXI_CONFIG = "/missing/config.json";
  const cloud = fakeCloud();
  expect((await f.run(args, {}, cloud)).code).toBe(2);
  expect(cloud.calls).toHaveLength(0);
});

test.each([
  ["user list", page([{ disabled: "false" }])], ["role list", [{ Name: "example" }]],
  ["scim-user list", scim([{ active: "true" }])], ["scim-user list", scim([], 1, 2)],
  ["scim-user list", scim([{ id }], 2, 2)], ["scim-user list", { ...scim([{ id }]), itemsPerPage: 2 }],
  ["scim schemas", { ...scim([]), resources: [] }], ["auth-provider show", []],
])("rejects malformed %s responses", async (command, body) => {
  const f = fixture();
  const result = await f.run(command.split(" "), {}, fakeCloud(response(token), response(body)));
  expect(result.data).toMatchObject({ error: { code: "API_RESPONSE_INVALID" } });
});
