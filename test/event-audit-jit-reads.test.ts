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

// Each fixture cites GET and its exact route in inventory/swagger.json.
test.each([
  ["audit activity list", "/v3/ActivityAudits", [], page([{ id: 1, user: "example" }]), [{ id: 1, user: "example" }]],
  ["audit activity show", "/v3/ActivityAudits/9223372036854775807", ["--id", "9223372036854775807"], page([{ id: 1, details: "example" }]), [{ id: 1, details: "example" }]],
  ["audit activity details", "/v3/ActivityAudits/Details", [], page([{ id: 1, details: "example" }]), [{ id: 1, details: "example" }]],
  ["audit auth-request list", "/v3/AuthorizationRequestAudits", [], page([{ id: 1, user: "example" }]), [{ id: 1, user: "example" }]],
  ["audit auth-request show", "/v3/AuthorizationRequestAudits/1", ["--id", "1"], page([{}]), [{}]],
  ["admin-request list", "/v3/AdminAccessRequest", [], page([{ notes: [] }]), [{ notes: [] }]],
  ["admin-request show", `/v3/AdminAccessRequest/${id}`, ["--id", id], [{ notes: [] }], [{ notes: [] }]],
  ["auth-request list", "/v3/AuthorizationRequest", [], [{}], [{}]],
  ["auth-request show", "/v3/AuthorizationRequest/example%20%26%20system", ["--id", "example & system"], [{ notes: [] }], [{ notes: [] }]],
  ["event list", "/v3/Events/FromStartDate", ["--since", since, "--full"], events([event]), [{ ...event, process: { name: "example", command_line: "***redacted***" } }]],
  ["event search", "/v3/Events/search", ["--since", since, "--until", until, "--os", "Windows"], events([event]), [{ time: since, host: "example", user: "example", action: "allowed", code: "1", application: "example", rule: "example" }]],
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
  const f = fixture(), cloud = fakeCloud(response(token), response(events([event])));
  const first = await f.run(["event", "search", "--os", "Windows", "--limit", "1"], {}, cloud);
  expect(first.code).toBe(0);
  expect(cloud.calls[1]!.url.searchParams.get("TimePeriod.StartDate")).toBe(since);
  expect(cloud.calls[1]!.url.searchParams.get("TimePeriod.EndDate")).toBe(until);
  expect(first.data).toMatchObject({ count: 1, total: null, cursor: expect.any(String) });
  vi.setSystemTime(new Date("2026-01-03T00:00:00Z"));
  const next = fakeCloud(response(token), response(events([])));
  const result = await f.run(["event", "search", "--os", "Windows", "--cursor", String(first.data.cursor)], {}, next);
  expect(result.code).toBe(0);
  expect(next.calls[1]!.url.searchParams.get("Pagination.PageNumber")).toBe("2");
  expect(next.calls[1]!.url.searchParams.get("TimePeriod.EndDate")).toBe(until);
  expect(result.data).toMatchObject({ count: 0, cursor: null });
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

test("event search sends literal filters and accepts an exact 31 day window", async () => {
  const cloud = fakeCloud(response(token), response(events([])));
  const result = await fixture().run(["event", "search", "--since", since, "--until", "2026-02-01T00:00:00.000Z", "--os", "Windows", "--group", id, "--action", "allowed,blocked", "--host", "example & *", "--on-demand", "false"], {}, cloud);
  expect(result.code).toBe(0);
  expect(cloud.calls[1]!.url.searchParams.getAll("Events.EventAction")).toEqual(["allowed", "blocked"]);
  expect(cloud.calls[1]!.url.searchParams.get("ComputerGroups")).toBe(id);
  expect(cloud.calls[1]!.url.searchParams.get("Computers.HostName")).toBe("example & *");
  expect(cloud.calls[1]!.url.searchParams.get("Policies.OnDemandRule")).toBe("false");
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
