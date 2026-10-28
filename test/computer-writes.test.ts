import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { localFixture } from "./support/local-cli.js";
import { fakeCloud, response, token } from "./support/fake-pm-cloud.js";
import type { HttpRequest, HttpResponse } from "../src/transport.js";

const id = "00000000-0000-0000-0000-000000000001";
const other = "00000000-0000-0000-0000-000000000002";
const fixtures: ReturnType<typeof localFixture>[] = [];
function fixture(operation = "computer.authorise") {
  const f = localFixture();
  f.env.XDG_STATE_HOME = f.directory;
  f.profile.profiles.example.writes = { allowWrites: true, allowDeletes: false, operations: [operation] };
  f.save(); fixtures.push(f);
  return { ...f, journal: join(f.directory, "beyondtrust-axi", "writes") };
}
afterEach(() => { for (const f of fixtures.splice(0)) f.cleanup(); });
// Synthetic fixtures cite inventory/swagger.json: GET /v3/Computers/{id}, GET /v3/Computers and the POST routes below.
const detail = () => response({ id, endpointInformation: { systemDnsHostName: "example" } });
function page(count: number) { return response({ pageNumber: 1, pageSize: 20, totalRecordCount: count, pageCount: Math.ceil(count / 20), data: Array.from({ length: Math.min(count, 20) }, () => ({ id, host: "example" })) }); }

test.each(["forced", "disabled", "operation", "env"])("denies %s writes before authentication", async (gate) => {
  const f = fixture();
  if (gate === "forced") f.env.BEYONDTRUST_AXI_READ_ONLY = "true";
  if (gate === "disabled") f.profile.profiles.example.writes.allowWrites = false;
  if (gate === "operation") f.profile.profiles.example.writes.operations = ["computer.authorise.extra"];
  if (gate === "env") Object.assign(f.env, { BEYONDTRUST_AXI_HOST: "example.pm.beyondtrustcloud.com", BEYONDTRUST_AXI_CLIENT_ID: "example", BEYONDTRUST_AXI_CLIENT_SECRET: "example-secret" });
  f.save();
  const cloud = fakeCloud();
  expect((await f.run(["computer", "authorise", id], {}, cloud)).data).toMatchObject({ error: { code: "WRITES_DISABLED" } });
  expect(cloud.calls).toHaveLength(0);
});

test.each([
  ["authorise", [id], "/v3/Computers/Authorise", { computerIds: [id], allComputers: false }],
  ["reject", [id], "/v3/Computers/Reject", { computerIds: [id], allComputers: false }],
  ["archive", [id], `/v3/Computers/${id}/archive`, undefined],
  ["archive", [id, other], "/v3/Computers/archive", { computerIds: [id, other] }],
  ["unarchive", [id], `/v3/Computers/${id}/Unarchive`, undefined],
  ["unarchive", [id, other], "/v3/Computers/Unarchive", { computerIds: [id, other] }],
  ["logs request", [id], "/v3/Computers/Logs/Request", { computerId: id }],
  ["details request", [id], "/v3/Computers/Details/Request", { computerId: id }],
] as const)("previews and executes %s with documented body", async (command, ids, path, body) => {
  const f = fixture(`computer.${command.replaceAll(" ", ".")}`);
  const reads = () => ids.map((value) => response({ id: value }));
  const args = ["computer", ...command.split(" "), ...ids];
  const previewCloud = fakeCloud(response(token), ...reads());
  const preview = await f.run(args, {}, previewCloud);
  expect(preview.data.status).toBe("preview");
  expect(previewCloud.calls.every((call) => call.options.method === "GET" || call.url.pathname === "/oauth/connect/token")).toBe(true);
  expect(existsSync(f.journal)).toBe(false);
  const cloud = fakeCloud(response(token), ...reads(), response(other, 201));
  const result = await f.run([...args, "--execute", "--confirm", preview.data.confirmation as string], {}, cloud);
  expect(result.data).toMatchObject({ status: "sent", result: other });
  expect(cloud.calls.at(-1)!.url.pathname).toBe(`/management-api${path}`);
  expect(cloud.calls.at(-1)!.options.body).toBe(body === undefined ? undefined : JSON.stringify(body));
  const journal = join(f.journal, readdirSync(f.journal)[0]!);
  expect(JSON.parse(readFileSync(journal, "utf8"))).toMatchObject({ state: "intent", auditId: result.data.auditId, request: { path, ...(body === undefined ? {} : { body }) } });
  if (process.platform !== "win32") expect(statSync(journal).mode & 0o777).toBe(0o600);
});

test.each([
  { groupArgs: [], groupReads: () => [], groupBody: {}, readCount: 2 },
  { groupArgs: ["--group", other], groupReads: () => [response({ id: other })], groupBody: { groupId: other }, readCount: 3 },
])("counts an unbounded authorise filter and binds its selection into confirmation: $groupArgs", async ({ groupArgs, groupReads, groupBody, readCount }) => {
  const f = fixture();
  const args = ["computer", "authorise", "--host", "example", "--os", "Windows", "--days-disconnected", "12", ...groupArgs];
  const preview = await f.run(args, {}, fakeCloud(response(token), ...groupReads(), page(100001)));
  expect(preview.data).toMatchObject({ status: "preview", preview: { count: 100001, filter: { host: "example", os: "Windows", daysDisconnected: 12 } } });
  expect((preview.data.preview as { hosts: string[] }).hosts).toHaveLength(20);
  expect(preview.data.confirmation).toContain("filter 100001 computers");
  const cloud = fakeCloud(response(token), ...groupReads(), page(100001), response(other, 201));
  const executed = await f.run([...args, "--execute", "--confirm", preview.data.confirmation as string], {}, cloud);
  expect(executed.data.status).toBe("sent");
  expect(JSON.parse(cloud.calls.at(-1)!.options.body!)).toEqual({ filter: { host: "example", os: "Windows", daysDisconnected: 12 }, allComputers: true, ...groupBody });
  expect(cloud.calls.at(-2)!.url.searchParams.get("Filter.Host")).toBe("example");
  const changed = fakeCloud(response(token), ...groupReads(), page(100002));
  expect((await f.run([...args, "--execute", "--confirm", preview.data.confirmation as string], {}, changed)).data).toMatchObject({ error: { code: "CONFIRMATION_REQUIRED" } });
  expect(changed.calls).toHaveLength(readCount);
});

test.each([
  [], ["--all"], ["--host", " "],
  ["--execute", "--confirm", "computer.authorise"],
  ["--all", "--execute", "--confirm", "computer.authorise"],
  ["--host", " ", "--execute", "--confirm", "computer.authorise"],
])("refuses unfiltered authorise selections before any request: %j", async (...args) => {
  const f = fixture();
  const cloud = fakeCloud();
  const result = await f.run(["computer", "authorise", ...args], {}, cloud);
  expect(result.data).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  expect(result.code).toBe(2);
  expect(cloud.calls).toHaveLength(0);
  expect(existsSync(f.journal)).toBe(false);
});

test("authorise re-reads the group and binds it into confirmation", async () => {
  const f = fixture();
  const cloud = fakeCloud(response(token), response({ id: other }), detail());
  const preview = await f.run(["computer", "authorise", id, "--group", other], {}, cloud);
  expect(preview.data.confirmation).toContain(`group ${other}`);
  expect(cloud.calls[1]!.url.pathname).toBe(`/management-api/v3/Groups/${other}`);
});

test("refuses execute without exact confirmation before creating intent", async () => {
  const f = fixture();
  const cloud = fakeCloud(response(token), detail());
  const result = await f.run(["computer", "authorise", id, "--execute"], {}, cloud);
  expect(result.data).toMatchObject({ error: { code: "CONFIRMATION_REQUIRED" } });
  expect(existsSync(f.journal)).toBe(false);
  expect(cloud.calls).toHaveLength(2);
});

test("refuses an empty filter result before sending", async () => {
  const f = fixture();
  const cloud = fakeCloud(response(token), page(0));
  expect((await f.run(["computer", "authorise", "--host", "example"], {}, cloud)).code).toBe(2);
  expect(existsSync(f.journal)).toBe(false);
  expect(cloud.calls).toHaveLength(2);
});

test.each([
  ["authorise"], ["authorise", "../About"], ["authorise", id, id], ["authorise", id, "--host", "example"],
  ["archive", "--host", "example"], ["unarchive", "--host", "example"], ["reject", "--host", "example"],
  ["authorise", "--all"], ["authorise", "--host", " "], ["logs", "request", id, other], ["authorise", id, "--confirm", "anything"],
])("validates arguments before credentials: %j", async (...args) => {
  const f = fixture();
  f.env.BEYONDTRUST_AXI_CONFIG = "/missing";
  const cloud = fakeCloud();
  expect((await f.run(["computer", ...args], {}, cloud)).code).toBe(2);
  expect(cloud.calls).toHaveLength(0);
});

test("supports the full twenty-ID re-read within the write preparation budget", async () => {
  const f = fixture("computer.archive");
  const ids = Array.from({ length: 20 }, (_, index) => `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`);
  expect((await f.run(["computer", "archive", ...ids], {}, fakeCloud(response(token), ...ids.map((id) => response({ id }))))).data.status).toBe("preview");
});

test("refuses a write when durable intent cannot be created", async () => {
  const f = fixture();
  writeFileSync(join(f.directory, "beyondtrust-axi"), "blocked");
  const cloud = fakeCloud(response(token), detail());
  expect((await f.run(["computer", "authorise", id, "--execute", "--confirm", `computer.authorise ${id}`], {}, cloud)).data).toMatchObject({ error: { code: "JOURNAL_ERROR" } });
  expect(cloud.calls).toHaveLength(2);
});

test.each([401, 409, 423, 429, 500, "network", "body"])("never retries write failure %s", async (failure) => {
  const f = fixture();
  const brokenBody: HttpResponse = { status: 201, headers: new Headers(), body: (async function* () { throw new Error(f.env.SYNTHETIC_SECRET); })() };
  const cloud = fakeCloud(response(token), detail(), failure === "body" ? brokenBody : response({ title: f.env.SYNTHETIC_SECRET }, typeof failure === "number" ? failure : 500));
  let sent = 0;
  const request: HttpRequest = async (url, options) => {
    if (url.pathname === "/management-api/v3/Computers/Authorise") {
      sent++;
      expect(readdirSync(f.journal)).toHaveLength(1);
      if (failure === "network") throw new Error(f.env.SYNTHETIC_SECRET);
    }
    return cloud.request(url, options);
  };
  const result = await f.run(["computer", "authorise", id, "--execute", "--confirm", `computer.authorise ${id}`], {}, { request });
  expect(sent).toBe(1);
  expect(result.code).toBe(1);
  expect(result.output).not.toContain(f.env.SYNTHETIC_SECRET);
  expect(result.output).not.toContain(token.access_token);
  if (typeof failure === "string" || failure >= 500) {
    expect(result.data.error).toMatchObject({ code: "OUTCOME_UNKNOWN", auditId: expect.any(String) });
    expect(readdirSync(f.journal)).toEqual([`${(result.data.error as { auditId: string }).auditId}.json`]);
  }
});
