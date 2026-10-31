import { afterEach, expect, test, vi } from "vitest";
import { PassThrough } from "node:stream";
import { resourceReads } from "../src/catalogue.js";
import { localFixture } from "./support/local-cli.js";
import { fakeCloud, response, token } from "./support/fake-pm-cloud.js";

const id = "00000000-0000-0000-0000-000000000001";
const page = (data: unknown[]) => ({ pageNumber: 1, pageSize: 50, totalRecordCount: data.length, pageCount: 1, data });
const scim = (Resources: unknown[]) => ({ totalResults: Resources.length, startIndex: 1, itemsPerPage: Resources.length, Resources });
const row = { id, errorInfo: null };
// Synthetic fixtures cite GET paths through the catalogue, with live deviations from issue #26.
const bodies: Record<string, unknown> = {
  "computer list": page([row]), "computer view": { id, endpointInformation: null },
  "computer command-log": [{ command: "example" }], "computer logs": [{ id, returned: null }],
  "group list": page([row]), "group view": { id, name: "example" },
  "policy list": page([row]), "policy view": { id, name: "example" },
  "policy revisions": [{ id, revision: 1 }], "policy assigned-groups": [{ id, isDefault: false }],
  "policy windows-application-groups": [{ id, applications: null }], "policy macos-application-groups": [{ id, applications: null }],
  "user list": page([row]), "user show": { id }, "role list": [{ id }], "role show": { id },
  "global-role list": page([{ id }]), "global-role show": { id },
  "domain list": [row], "domain show": { id }, "api-account list": [row],
  "auth-provider show": { provider: "example" }, "scim resource-types": scim([{ name: "User" }]), "scim schemas": scim([{ id: "example" }]), "scim config": { patch: { supported: true } },
  "scim role list": scim([{}]), "scim user list": scim([{}]), "scim user show": {},
  "event list": { events: [], totalRecordsReturned: 0 }, "event search": { events: [], totalRecordsReturned: 0 },
  "audit activity list": page([{ id: 1, errorInfo: null }]),
  "audit activity show": page([{ id: 1 }]), "audit activity details": page([{ id: 1 }]),
  "audit auth-request list": page([]), "audit auth-request show": page([{ id: 1 }]),
  "admin-request list": page([{ notes: null }]), "admin-request show": [{ notes: null }],
  "auth-request list": page([{ requestInfo: null, accessDecision: null, serviceTicket: null }]), "auth-request show": [{ notes: null }],
};
const fixtures: ReturnType<typeof localFixture>[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); for (const f of fixtures.splice(0)) f.cleanup(); });

test.each(Object.entries(resourceReads).map(([command, definition]) => ({
  command, path: definition.path,
  args: [...command.split(" "), ...(definition.pathParameter ? ["--id", definition.pathParameter.schema.type === "integer" ? "1" : id] : []), ...(command === "event search" ? ["--os", "Windows"] : [])],
  body: bodies[command],
  expected: definition.list ? (Array.isArray(bodies[command]) ? bodies[command] : (bodies[command] as Record<string, unknown>).data ?? (bodies[command] as Record<string, unknown>).Resources ?? []) : bodies[command],
})))("accepts synthetic live-shaped GET $path ($command)", async ({ args, body, expected }) => {
  const f = localFixture(); fixtures.push(f);
  const result = await f.run(args, {}, fakeCloud(response(token), response(body)));
  expect(result.code).toBe(0);
  expect(result.data.data).toEqual(expected);
});

test.each(["about", "doctor"])("%s accepts the live About object", async (command) => {
  const f = localFixture(); fixtures.push(f);
  const result = await f.run([command], {}, fakeCloud(response(token), response({ consoleVersion: "1.2", reportingDatabaseVersion: "1.2", policyEditorVersion: "1.2" })));
  expect(result.code).toBe(0);
});

// Issue #28: GET /v3/AuthorizationRequestAudits and GET /v3/AuthorizationRequest
// return zero paging metadata for an empty result, regardless of the request.
test.each(["audit auth-request list", "auth-request list"])("%s accepts empty zero-based paging metadata", async (command) => {
  const f = localFixture(); fixtures.push(f);
  const cloud = fakeCloud(response(token), response({ pageNumber: 0, pageSize: 0, totalRecordCount: 0, pageCount: 0, data: [] }));
  const result = await f.run([...command.split(" "), "--limit", "1"], {}, cloud);
  expect(result.code).toBe(0);
  expect(result.data).toMatchObject({ data: [], count: 0, total: 0, cursor: null });
  expect(cloud.calls).toHaveLength(2);
});

// Issue #28: GET /PolicyEditor/v3/Policy/{policyId}/Windows/ApplicationGroups
// includes application types absent from the committed export.
test("Windows application groups retain unknown application types", async () => {
  const f = localFixture(); fixtures.push(f);
  const groups = [{ id, applications: Array.from({ length: 200 }, (_, index) => ({ id, type: index < 10 ? "future-type" : "exe", disabled: false })) }];
  const result = await f.run(["policy", "windows-application-groups", "--id", id, "--limit", "1"], {}, fakeCloud(response(token), response(groups)));
  expect(result.code).toBe(0);
  expect(result.data).toMatchObject({ data: groups, count: 1, cursor: null });
});

test.each([123, false, {}])("Windows application groups reject non-string type %j", async (type) => {
  const f = localFixture(); fixtures.push(f);
  const result = await f.run(["policy", "windows-application-groups", "--id", id], {}, fakeCloud(response(token), response([{ id, applications: [{ type }] }])));
  expect(result.code).toBe(1);
  expect(result.data.error).toMatchObject({ code: "API_RESPONSE_INVALID", issues: [{ code: "invalid_type" }] });
});

test("authorization request envelopes preserve totals and resume at the next page", async () => {
  const f = localFixture(); fixtures.push(f);
  const first = await f.run(["auth-request", "list", "--limit", "1"], {}, fakeCloud(response(token), response({ ...page([{ requestInfo: null }]), pageNumber: 0, pageSize: 0, totalRecordCount: 2, pageCount: 2 })));
  expect(first.data).toMatchObject({ data: [{ requestInfo: null }], total: 2, cursor: expect.any(String) });
  const cloud = fakeCloud(response(token), response({ ...page([{ accessDecision: null }]), pageNumber: 2, pageSize: 1, totalRecordCount: 2, pageCount: 2 }));
  const next = await f.run(["auth-request", "list", "--cursor", String(first.data.cursor)], {}, cloud);
  expect(next.data).toMatchObject({ data: [{ accessDecision: null }], total: 2, cursor: null });
  expect(cloud.calls[1]!.url.searchParams.get("Pagination.PageNumber")).toBe("2");
});

test("authorization request overrides still validate row fields", async () => {
  const f = localFixture(); fixtures.push(f);
  const result = await f.run(["auth-request", "list"], {}, fakeCloud(response(token), response(page([{ requestInfo: 123 }]))));
  expect(result.data.error).toMatchObject({ code: "API_RESPONSE_INVALID", issues: [{ path: '$["data"][*]["requestInfo"]', code: "invalid_type" }] });
});

test("invalid live About fields retain their original object path in diagnostics", async () => {
  const f = localFixture(); fixtures.push(f);
  const result = await f.run(["about"], {}, fakeCloud(response(token), response({ consoleVersion: 123 })));
  expect(result.data.error).toMatchObject({ code: "API_RESPONSE_INVALID", issues: [{ path: '$["consoleVersion"]', received: "number", expected: "string", code: "invalid_type" }] });
});

test.each([
  { value: "50", issue: { code: "invalid_type", received: "string" } },
  { value: 2147483648, issue: { code: "too_big", received: "number", receivedValue: 2147483648 } },
  { value: 1.5, issue: { code: "invalid_type", received: "number", receivedValue: 1.5 } },
])("audit pagination reports invalid value $value with only numeric values", async ({ value, issue }) => {
  const f = localFixture(); fixtures.push(f);
  const result = await f.run(["audit", "auth-request", "list"], {}, fakeCloud(response(token), response({ ...page([]), pageNumber: value, pageSize: value })));
  expect(result.data.error).toMatchObject({ code: "API_RESPONSE_INVALID", issues: [
    { path: '$["pageNumber"]', ...issue }, { path: '$["pageSize"]', ...issue },
  ] });
});

test("event permission denial completes without waiting for its stalled body", async () => {
  const f = localFixture(); fixtures.push(f);
  const body = new PassThrough();
  try {
    const result = await f.run(["event", "list"], {}, fakeCloud(response(token), { status: 403, headers: new Headers(), body }));
    expect(result.code).toBe(1);
    expect(result.data.error).toMatchObject({ code: "API_FORBIDDEN" });
  } finally { body.destroy(); }
});

test("a slow event request returns a bounded read error", async () => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  });
  const f = localFixture(); fixtures.push(f);
  const cloud = fakeCloud(response(token));
  const result = f.run(["event", "list"], {}, { request: (url, options) => url.pathname === "/oauth/connect/token" ? cloud.request(url, options) : new Promise((_, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("synthetic network timeout")), { once: true });
  }) });
  await vi.advanceTimersByTimeAsync(60_000);
  expect((await result).data.error).toMatchObject({ code: "LIMIT_EXCEEDED", message: "Read time limit reached" });
});

test.each([
  ["user", undefined, null], ["global-role", undefined, null],
  ["user", "emailAddress:desc", "emailAddress"], ["global-role", "name:asc", "name"],
])("%s sorting preserves the caller's choice %s", async (resource, sort, expected) => {
  const f = localFixture(); fixtures.push(f);
  const cloud = fakeCloud(response(token), response(page([])));
  expect((await f.run([resource!, "list", ...(sort ? ["--sort", sort] : [])], {}, cloud)).code).toBe(0);
  expect(cloud.calls[1]!.url.searchParams.get("Sorts[0].by")).toBe(expected);
});
