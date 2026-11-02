import { afterEach, expect, test, vi } from "vitest";
import { localFixture } from "./support/local-cli.js";
import { fakeCloud, response, token } from "./support/fake-pm-cloud.js";

const id = "00000000-0000-0000-0000-000000000001";
const since = "2026-01-01T00:00:00.000Z", until = "2026-01-02T00:00:00.000Z";
const fixtures: ReturnType<typeof localFixture>[] = [];
function fixture() { const f = localFixture(); fixtures.push(f); return f; }
afterEach(() => { vi.useRealTimers(); for (const f of fixtures.splice(0)) f.cleanup(); });
const page = (data: unknown[]) => ({ data, pageNumber: 1, pageSize: 50, totalRecordCount: data.length, pageCount: 1 });
const event = { "@timestamp": since, host: { name: "example" }, user: { name: "example" }, event: { action: "allowed", code: "1" }, process: { name: "example", command_line: "synthetic-secret-sentinel" }, rule: { name: "example" } };
const events = (rows: unknown[]) => ({ events: rows, totalRecordsReturned: rows.length });
// Live GET /v3/Events/search returns a paged envelope, unlike GET /v3/Events/FromStartDate.
const searchPage = (rows: unknown[], paging: Record<string, number> = {}) => ({ pageNumber: 1, pageSize: 50, pageCount: rows.length ? 1 : 0, totalRecordCount: rows.length, ...paging, events: rows });
const eventBody = (action: string, rows: unknown[]) => action === "search" ? searchPage(rows) : events(rows);

// Each fixture cites GET and its exact route in inventory/swagger.json.
test.each([
  ["audit activity list", "/v3/ActivityAudits", [], page([{ id: 1, user: "example" }]), [{ id: 1, user: "example" }]],
  ["audit activity show", "/v3/ActivityAudits/9223372036854775807", ["--id", "9223372036854775807"], { id: 1, details: "example" }, { id: 1, details: "example" }],
  ["audit activity details", "/v3/ActivityAudits/Details", [], page([{ id: 1, details: "example" }]), [{ id: 1, details: "example" }]],
  ["audit auth-request list", "/v3/AuthorizationRequestAudits", [], page([{ id: 1, user: "example" }]), [{ id: 1, user: "example" }]],
  ["audit auth-request show", "/v3/AuthorizationRequestAudits/1", ["--id", "1"], page([{}]), [{}]],
  ["admin-request list", "/v3/AdminAccessRequest", [], page([{ notes: [] }]), [{ notes: [] }]],
  ["admin-request show", `/v3/AdminAccessRequest/${id}`, ["--id", id], [{ notes: [] }], [{ notes: [] }]],
  ["auth-request list", "/v3/AuthorizationRequest", [], [{}], [{}]],
  ["auth-request show", "/v3/AuthorizationRequest/example%20%26%20system", ["--id", "example & system"], [{ notes: [] }], [{ notes: [] }]],
  ["event list", "/v3/Events/FromStartDate", ["--since", since, "--full"], events([event]), [{ ...event, process: { name: "example", command_line: "***redacted***" } }]],
  ["event search", "/v3/Events/search", ["--since", since, "--until", until, "--os", "Windows"], searchPage([event]), [{ time: since, host: "example", user: "example", action: "allowed", code: "1", application: "example", rule: "example" }]],
])("reads %s at %s", async (command, path, args, body, expected) => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(until));
  const cloud = fakeCloud(response(token), response(body));
  const result = await fixture().run([...command.split(" "), ...args as string[]], {}, cloud);
  expect(result.code).toBe(0);
  expect(result.data.data).toEqual(expected);
  expect(cloud.calls[1]!.url.pathname).toBe(`/management-api${path}`);
  expect(cloud.calls[1]!.options.method).toBe("GET");
});

test("event search freezes the default 24 hour window across paged cursors", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(until));
  const f = fixture(), cloud = fakeCloud(response(token), response(searchPage([event], { pageSize: 1, pageCount: 2, totalRecordCount: 2 })));
  const first = await f.run(["event", "search", "--os", "Windows", "--limit", "1"], {}, cloud);
  expect(first.code).toBe(0);
  expect(cloud.calls[1]!.url.searchParams.get("TimePeriod.StartDate")).toBe(since);
  expect(cloud.calls[1]!.url.searchParams.get("TimePeriod.EndDate")).toBe(until);
  expect(first.data).toMatchObject({ count: 1, total: 2, cursor: expect.any(String) });
  vi.setSystemTime(new Date("2026-01-03T00:00:00Z"));
  const next = fakeCloud(response(token), response(searchPage([], { pageNumber: 2, pageSize: 1, pageCount: 2, totalRecordCount: 2 })));
  const result = await f.run(["event", "search", "--os", "Windows", "--cursor", String(first.data.cursor)], {}, next);
  expect(result.code).toBe(0);
  expect(next.calls[1]!.url.searchParams.get("Pagination.PageNumber")).toBe("2");
  expect(next.calls[1]!.url.searchParams.get("TimePeriod.EndDate")).toBe(until);
  expect(result.data).toMatchObject({ count: 0, cursor: null });
});

test("event search maps the live paged envelope and marks the 10000 cap as a lower bound", async () => {
  const live = { "@timestamp": "2026-11-01T23:56:29+00:00", host: { name: "HOST-0001" }, user: { name: "jdoe" }, event: { code: "106", action: "process-start-no-change" } };
  const result = await fixture().run(["event", "search", "--os", "Windows", "--limit", "1"], {}, fakeCloud(response(token), response(searchPage([live], { pageSize: 3, pageCount: 3334, totalRecordCount: 10000 }))));
  expect(result.code).toBe(0);
  expect(result.data).toMatchObject({ count: 1, total: 10000, cursor: expect.any(String) });
  expect(result.data.data).toEqual([{ time: "2026-11-01T23:56:29+00:00", host: "HOST-0001", user: "jdoe", action: "process-start-no-change", code: "106", application: null, rule: null }]);
  expect(result.data.help).toContain("total is capped at 10000 by the API and is a lower bound");
});

test.each([
  { label: "continuation hint", args: ["--group", Array(20).fill(id).join(",")], row: event },
  { label: "compact event field", args: [], row: { ...event, host: { name: "x".repeat(501) } } },
])("event search preserves the capped-total warning when truncating a $label", async ({ args, row }) => {
  const result = await fixture().run(["event", "search", "--os", "Windows", "--limit", "1", ...args], {}, fakeCloud(response(token), response(searchPage([row], { pageSize: 1, pageCount: 10000, totalRecordCount: 10000 }))));
  expect(result.code).toBe(0);
  expect(result.data).toMatchObject({ count: 1, total: 10000, cursor: expect.any(String) });
  expect(result.data.help).toEqual(expect.arrayContaining([
    "total is capped at 10000 by the API and is a lower bound",
    "Repeat the command with --full to see complete strings",
  ]));
});

test("event search follows pageCount until the last page", async () => {
  const cloud = fakeCloud(response(token), response(searchPage([event], { pageSize: 1, pageCount: 2, totalRecordCount: 2 })), response(searchPage([event], { pageNumber: 2, pageSize: 1, pageCount: 2, totalRecordCount: 2 })));
  const result = await fixture().run(["event", "search", "--os", "Windows", "--limit", "2"], {}, cloud);
  expect(result.code).toBe(0);
  expect(cloud.calls[2]!.url.searchParams.get("Pagination.PageNumber")).toBe("2");
  expect(result.data).toMatchObject({ count: 2, total: 2, cursor: null });
});

test("event search with no matches returns an empty page without a cursor", async () => {
  const result = await fixture().run(["event", "search", "--os", "Windows"], {}, fakeCloud(response(token), response(searchPage([]))));
  expect(result.code).toBe(0);
  expect(result.data).toMatchObject({ count: 0, total: 0, cursor: null });
});

test("event search rejects the FromStartDate response shape", async () => {
  const result = await fixture().run(["event", "search", "--os", "Windows"], {}, fakeCloud(response(token), response(events([event]))));
  expect(result.code).toBe(1);
  expect(result.data.error).toMatchObject({ code: "API_RESPONSE_INVALID" });
});

test("event search sends --user-domain as Users.UserDomain", async () => {
  const cloud = fakeCloud(response(token), response(searchPage([])));
  const result = await fixture().run(["event", "search", "--os", "Windows", "--user-domain", "EXAMPLE"], {}, cloud);
  expect(result.code).toBe(0);
  expect(cloud.calls[1]!.url.searchParams.get("Users.UserDomain")).toBe("EXAMPLE");
});

test("auth-request list reads subsequent array pages without claiming an overall total", async () => {
  const cloud = fakeCloud(response(token), response(Array(200).fill({})), response(Array(50).fill({})));
  const result = await fixture().run(["auth-request", "list", "--all"], {}, cloud);
  expect(result.code).toBe(0);
  expect(result.data).toMatchObject({ count: 250, total: null, cursor: null });
  expect(cloud.calls[2]!.url.searchParams.get("Pagination.PageNumber")).toBe("2");
});

test("auth-request list resumes within an array page and checks the next page", async () => {
  const f = fixture(), rows = Array(200).fill({});
  const first = await f.run(["auth-request", "list", "--limit", "250"], {}, fakeCloud(response(token), response(rows), response(rows)));
  expect(first.code).toBe(0);
  expect(first.data).toMatchObject({ count: 250, total: null, cursor: expect.any(String) });
  const cloud = fakeCloud(response(token), response(rows), response([]));
  const next = await f.run(["auth-request", "list", "--all", "--cursor", String(first.data.cursor)], {}, cloud);
  expect(next.code).toBe(0);
  expect(next.data).toMatchObject({ count: 150, total: null, cursor: null });
  expect(cloud.calls[1]!.url.searchParams.get("Pagination.PageNumber")).toBe("2");
  expect(cloud.calls[2]!.url.searchParams.get("Pagination.PageNumber")).toBe("3");
});

test("auth-request list rejects arrays larger than the requested page size", async () => {
  const result = await fixture().run(["auth-request", "list", "--all"], {}, fakeCloud(response(token), response(Array(201).fill({}))));
  expect(result.code).toBe(1);
  expect(result.data.error).toMatchObject({ code: "API_RESPONSE_INVALID" });
});

test.each([
  ["example!system", "example%21system"],
  ["example'system", "example%27system"],
  ["example(system)", "example%28system%29"],
  ["example~system", "example%7Esystem"],
  ["example/system?%#", "example%2Fsystem%3F%25%23"],
])("auth-request show encodes the opaque system identifier %s", async (systemId, segment) => {
  const cloud = fakeCloud(response(token), response([{}]));
  const result = await fixture().run(["auth-request", "show", "--id", systemId], {}, cloud);
  expect(result.code).toBe(0);
  expect(result.data.data).toEqual([{}]);
  expect(cloud.calls[1]!.url.pathname).toBe(`/management-api/v3/AuthorizationRequest/${segment}`);
});

test("event list sorts the returned events newest first before applying limits", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(until));
  const at = (time: string) => ({ ...event, "@timestamp": time });
  const [t1, t2, t3] = ["2026-01-01T01:00:00.000Z", "2026-01-01T02:00:00.000Z", "2026-01-01T03:00:00.000Z"];
  const cloud = fakeCloud(response(token), response(events([at(t2), at(t1), at(t3)])));
  const result = await fixture().run(["event", "list", "--since", since], {}, cloud);
  expect((result.data.data as { time: string }[]).map((row) => row.time)).toEqual([t3, t2, t1]);
});

test.each([
  ["a date-only --since", ["--since", "2026-01-01"], "2026-10-30T00:00:00Z"],
  ["a --since in the future", ["--since", "2026-01-03T00:00:00Z"], "event search"],
])("event list rejects %s without mentioning --until", async (_name, args, hint) => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(until));
  const result = await fixture().run(["event", "list", ...args], {}, fakeCloud(response(token)));
  const { message } = (result.data as { error: { message: string } }).error;
  expect(result.data.error).toMatchObject({ code: "VALIDATION_ERROR" });
  expect(message).toContain(hint);
  expect(message).not.toContain("--until");
});

test("event list resumes within the endpoint's bounded 1000 row response", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(until));
  const f = fixture(), cloud = fakeCloud(response(token), response(events([event, event])));
  const first = await f.run(["event", "list", "--limit", "1"], {}, cloud);
  expect(first.code).toBe(0);
  expect(cloud.calls[1]!.url.searchParams.get("RecordSize")).toBe("1000");
  const next = fakeCloud(response(token), response(events([event, event])));
  const result = await f.run(["event", "list", "--cursor", String(first.data.cursor)], {}, next);
  expect(result.data).toMatchObject({ count: 1, cursor: null });
  expect(next.calls[1]!.url.searchParams.get("StartDate")).toBe(since);
});

test.each([
  ["list", [], "@timestamp", { "@timestamp": since }],
  ["list", [], "host", { host: { name: "example" } }],
  ["search", ["--os", "Windows"], "@timestamp", { "@timestamp": since }],
  ["search", ["--os", "Windows"], "host", { host: { name: "example" } }],
] as const)("event %s continuation preserves full %s columns", async (action, filters, field, expected) => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(until));
  const f = fixture();
  const args = ["event", action, ...filters, "--full", "--fields", field];
  const rows = action === "list" ? [event, event] : [event];
  const first = await f.run([...args, "--limit", "1"], {}, fakeCloud(response(token), response(events(rows))));
  expect(first.code).toBe(0);
  expect(first.data.data).toEqual([expected]);
  expect((first.data.help as string[])[0]).toBe(`Run beyondtrust-axi event ${action}${action === "search" ? " --os 'Windows'" : ""} --full --fields '${field}' --cursor <cursor> to continue with the same profile`);
  const next = await f.run([...args, "--cursor", String(first.data.cursor)], {}, fakeCloud(response(token), response(events(rows)), response(events([]))));
  expect(next.code).toBe(0);
  expect(next.data.data).toEqual([expected]);
});

test("event search sends literal filters and accepts an exact 31 day window", async () => {
  const cloud = fakeCloud(response(token), response(searchPage([])));
  const result = await fixture().run(["event", "search", "--since", since, "--until", "2026-02-01T00:00:00.000Z", "--os", "Windows", "--group", id, "--action", "allowed,blocked", "--host", "example & *", "--on-demand", "false"], {}, cloud);
  expect(result.code).toBe(0);
  expect(cloud.calls[1]!.url.searchParams.getAll("Events.EventAction")).toEqual(["allowed", "blocked"]);
  expect(cloud.calls[1]!.url.searchParams.get("ComputerGroups")).toBe(id);
  expect(cloud.calls[1]!.url.searchParams.get("Computers.HostName")).toBe("example & *");
  expect(cloud.calls[1]!.url.searchParams.get("Policies.OnDemandRule")).toBe("false");
});

test.each([
  ["list", []],
  ["search", ["--os", "Windows"]],
])("event %s redacts duplicate credentials in full URL representations", async (action, args) => {
  const url = { password: "synthetic-url+/password", full: "https://user:synthetic-url%2B%2Fpassword@example.test/", original: "https://user:synthetic-url+/password@example.test/" };
  const indicatorUrl = { password: "synthetic-indicator-password", full: "https://user:synthetic-indicator-password@example.test/", original: "https://user:synthetic-indicator-password@example.test/" };
  const result = await fixture().run(["event", action as string, ...args as string[], "--full"], {}, fakeCloud(response(token), response(eventBody(action as string, [
    { url: { full: url.full } },
    { url, threat: { indicator: { url: indicatorUrl } } },
  ]))));
  expect(result.code).toBe(0);
  expect(result.data.data).toEqual([
    { url: { full: "https://user:***redacted***@example.test/" } },
    {
      url: { full: "https://user:***redacted***@example.test/", original: "https://user:***redacted***@example.test/" },
      threat: { indicator: { url: { full: "https://user:***redacted***@example.test/", original: "https://user:***redacted***@example.test/" } } },
    },
  ]);
});

test.each([
  ["list", []],
  ["search", ["--os", "Windows"]],
])("event %s redacts compact copies before truncation using omitted credential fields", async (action, args) => {
  const result = await fixture().run(["event", action as string, ...args as string[], "--limit", "2"], {}, fakeCloud(response(token), response(eventBody(action as string, [
    { process: { name: `${"x".repeat(490)}synthetic-compact-password` } },
    { threat: { indicator: { url: { password: "synthetic-compact-password" } } } },
  ]))));
  expect(result.code).toBe(0);
  expect(result.data.data).toEqual([
    { time: null, host: null, user: null, action: null, code: null, application: `${"x".repeat(490)}***redacte... (truncated, 504 chars total)`, rule: null },
    { time: null, host: null, user: null, action: null, code: null, application: null, rule: null },
  ]);
});

test.each([
  ["list", []],
  ["search", ["--os", "Windows"]],
])("event %s discovers URL passwords without separate credential fields", async (action, args) => {
  const result = await fixture().run(["event", action as string, ...args as string[], "--full"], {}, fakeCloud(response(token), response(eventBody(action as string, [
    { process: { name: "synthetic-full-password synthetic-original+/password synthetic-threat-full-password synthetic-threat-original-password" } },
    { url: { full: "https://user:synthetic-full-password@example.test/" } },
    { url: { original: "https://user:synthetic-original%2b%2fpassword@example.test/" } },
    { threat: { indicator: { url: { full: "https://user:synthetic-threat-full-password@example.test/" } } } },
    { threat: { indicator: { url: { original: "//user:synthetic-threat-original-password@example.test/" } } } },
  ]))));
  expect(result.code).toBe(0);
  expect(result.data.data).toEqual([
    { process: { name: "***redacted*** ***redacted*** ***redacted*** ***redacted***" } },
    { url: { full: "https://user:***redacted***@example.test/" } },
    { url: { original: "https://user:***redacted***@example.test/" } },
    { threat: { indicator: { url: { full: "https://user:***redacted***@example.test/" } } } },
    { threat: { indicator: { url: { original: "//user:***redacted***@example.test/" } } } },
  ]);
});

test("event list discovers URL credentials beyond the selected rows before compact truncation", async () => {
  const result = await fixture().run(["event", "list", "--limit", "1"], {}, fakeCloud(response(token), response(events([
    { process: { name: `${"x".repeat(490)}synthetic-sliced-password` } },
    { url: { original: "https://user:synthetic-sliced-password@example.test/" } },
  ]))));
  expect(result.code).toBe(0);
  expect(result.data.data).toEqual([
    { time: null, host: null, user: null, action: null, code: null, application: `${"x".repeat(490)}***redacte... (truncated, 504 chars total)`, rule: null },
  ]);
});

test("event search redacts URL credential copies before compact truncation", async () => {
  const result = await fixture().run(["event", "search", "--os", "Windows"], {}, fakeCloud(response(token), response(searchPage([
    { process: { name: `${"x".repeat(490)}synthetic-search-password` }, threat: { indicator: { url: { full: "https://user:synthetic-search-password@example.test/" } } } },
  ]))));
  expect(result.code).toBe(0);
  expect(result.data.data).toEqual([
    { time: null, host: null, user: null, action: null, code: null, application: `${"x".repeat(490)}***redacte... (truncated, 504 chars total)`, rule: null },
  ]);
});

test.each([
  ["show", []],
  ["show", ["--full"]],
  ["details", []],
  ["details", ["--full"]],
])("activity audit %s omits integration credentials with flags %j", async (action, flags) => {
  const row = {
    id: 1,
    azureADIntegrationDataAuditing: { oldAzureAdClientSecret: "synthetic-old-azure-secret", azureAdClientSecret: "synthetic-azure-secret", azureAdIntegrationEnabled: true },
    authorizationRequestDataAuditing: {
      oldAuthRequestClientSecret: "synthetic-old-auth-secret", oldAuthRequestPassword: "synthetic-old-auth-password", oldAuthRequestApiClientSecret: "synthetic-old-api-secret",
      authRequestClientSecret: "synthetic-auth-secret", authRequestPassword: "synthetic-auth-password", authRequestApiClientSecret: "synthetic-api-secret", authRequestIntegrationEnabled: true,
    },
    reputationSettingsDataAuditing: { oldReputationIntegrationApiKey: "synthetic-old-reputation-key", reputationIntegrationApiKey: "synthetic-reputation-key", reputationIntegrationEnabled: true },
  };
  const copies = { id: 2, details: Object.values(row.azureADIntegrationDataAuditing).concat(Object.values(row.authorizationRequestDataAuditing), Object.values(row.reputationSettingsDataAuditing)).join(" ") };
  const args = action === "show" ? ["--id", "1"] : [];
  const result = await fixture().run(["audit", "activity", action as string, ...args, ...flags as string[]], {}, fakeCloud(response(token), response(action === "show" ? row : page([copies, row]))));
  expect(result.code).toBe(0);
  const redactedRow = {
    id: 1,
    azureADIntegrationDataAuditing: { azureAdIntegrationEnabled: true },
    authorizationRequestDataAuditing: { authRequestIntegrationEnabled: true },
    reputationSettingsDataAuditing: { reputationIntegrationEnabled: true },
  };
  expect(result.data.data).toEqual(action === "show" ? redactedRow : [{ id: 2, details: "***redacted*** ***redacted*** true ***redacted*** ***redacted*** ***redacted*** ***redacted*** ***redacted*** ***redacted*** true ***redacted*** ***redacted*** true" }, redactedRow]);
  expect(result.output).not.toContain("synthetic-");
});

test.each([
  ["event", "search", "--os", "Windows", "--since", since, "--until", "2026-02-01T00:00:00.001Z"],
  ["event", "search", "--os", "Windows", "--since", until, "--until", since],
  ["event", "search", "--os", "Windows", "--until", "invalid"],
  ["event", "search", "--os", "Windows", "--since", "2026-02-30T00:00:00Z", "--until", "2026-03-03T00:00:00Z"],
  ["event", "search"],
  ["event", "search", "--os", "Windows", "--group", "invalid"],
  ["event", "search", "--os", "Windows", "--on-demand", "yes"],
  ["audit", "activity", "show", "--id", id],
  ["audit", "activity", "show", "--id", "9223372036854775808"],
  ["admin-request", "show", "--id", "invalid"],
  ["auth-request", "show", "--id", ".."],
  ["audit", "auth-request", "list", "--decision-time-dates", "2026-01-02,2026-01-01", "--decision-time-selection-mode", "Range"],
])("rejects invalid B5 input before authentication: %j", async (...args) => {
  const cloud = fakeCloud();
  const f = fixture(); f.env.BEYONDTRUST_AXI_CONFIG = "/missing/config.json";
  expect((await f.run(args, {}, cloud)).code).toBe(2);
  expect(cloud.calls).toHaveLength(0);
});

test.each([
  { events: [{}], totalRecordsReturned: 2 },
  { events: [{ event: { code: 1 } }], totalRecordsReturned: 1 },
])("rejects malformed ECS event responses", async (body) => {
  const result = await fixture().run(["event", "search", "--os", "Windows"], {}, fakeCloud(response(token), response(body)));
  expect(result.code).toBe(1);
  expect(result.data.error).toMatchObject({ code: "API_RESPONSE_INVALID" });
});

// Issue #40: GET /v3/ActivityAudits/{id} returns one ActivityAuditDetailModel, not the documented paged envelope.
const liveAudit = { id: 8, details: "User user@example.com was created.", user: "admin@example.com", entity: "User", auditType: "Create", created: "2025-03-03T18:46:19.4242789+00:00", changedBy: "Portal", computerDataAuditing: null, userDataAuditing: { newEmailAddress: "user@example.com", oldEmailAddress: "", newDisabled: false, roles: [] } };

test("audit activity show reads the live single-object shape", async () => {
  const result = await fixture().run(["audit", "activity", "show", "--id", "8"], {}, fakeCloud(response(token), response(liveAudit)));
  expect(result.code).toBe(0);
  expect(result.data.data).toMatchObject({ id: 8, userDataAuditing: { newEmailAddress: "user@example.com" } });
});

test("audit activity show rejects the documented paged shape", async () => {
  const result = await fixture().run(["audit", "activity", "show", "--id", "8"], {}, fakeCloud(response(token), response(page([liveAudit]))));
  expect(result.code).toBe(1);
  expect(result.data.error).toMatchObject({ code: "API_RESPONSE_INVALID" });
});

test.each([["list", "/v3/ActivityAudits"], ["details", "/v3/ActivityAudits/Details"]])("audit activity %s defaults to newest first", async (action, path) => {
  const cloud = fakeCloud(response(token), response(page([])));
  const result = await fixture().run(["audit", "activity", action as string], {}, cloud);
  expect(result.code).toBe(0);
  expect(cloud.calls[1]!.url.pathname).toBe(`/management-api${path}`);
  expect(cloud.calls[1]!.url.searchParams.get("Sorts[0].by")).toBe("created");
  expect(cloud.calls[1]!.url.searchParams.get("Sorts[0].order")).toBe("desc");
});

test("a read 400 surfaces the API message", async () => {
  const cloud = fakeCloud(response(token), response({ message: "id is not correct sorting field", exceptionType: null, stackTrace: null }, 400));
  const result = await fixture().run(["audit", "activity", "list", "--sort", "id:desc"], {}, cloud);
  expect(result.code).toBe(1);
  expect(result.data.error).toMatchObject({ code: "API_BAD_REQUEST", message: expect.stringContaining("id is not correct sorting field") });
});

test.each([
  [["--created-dates", "2026-10-01T00:00:00Z"], "--created-selection-mode"],
  [["--created-dates", "2026-11-01T00:00:00Z,2026-10-01T00:00:00Z", "--created-selection-mode", "Range"], "reversed"],
  [["--changed-by", "portal"], "API, Portal, ManagementRule, Pathfinder"],
])("audit activity list %j explains the invalid filter", async (args, message) => {
  const cloud = fakeCloud();
  const result = await fixture().run(["audit", "activity", "list", ...args], {}, cloud);
  expect(result.code).toBe(2);
  expect(result.data.error).toMatchObject({ code: "VALIDATION_ERROR", message: expect.stringContaining(message) });
  expect(cloud.calls).toHaveLength(0);
});

test("event list --fields selects compact columns", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(until));
  const result = await fixture().run(["event", "list", "--since", since, "--fields", "time,host"], {}, fakeCloud(response(token), response(events([event]))));
  expect(result.data.data).toEqual([{ time: since, host: "example" }]);
});
