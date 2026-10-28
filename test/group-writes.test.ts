import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { localFixture } from "./support/local-cli.js";
import { fakeCloud, response, token } from "./support/fake-pm-cloud.js";

const id = "00000000-0000-0000-0000-000000000001";
const other = "00000000-0000-0000-0000-000000000002";
const revision = "00000000-0000-0000-0000-000000000003";
const fixtures: ReturnType<typeof localFixture>[] = [];
function fixture(command: string) {
  const f = localFixture();
  f.env.XDG_STATE_HOME = f.directory;
  f.profile.profiles.example.writes = { allowWrites: true, allowDeletes: false, operations: [`group.${command}`] };
  f.save(); fixtures.push(f);
  return { ...f, journal: join(f.directory, "beyondtrust-axi", "writes") };
}
afterEach(() => { for (const f of fixtures.splice(0)) f.cleanup(); });
// Synthetic fixtures cite inventory/swagger.json: GET /v3/Groups/{id}, GET /v3/Groups,
// GET /v3/Computers/{id}, GET /v3/Computers, and the ten write method/path pairs below.
const group = (value = id, name = "example") => response({ id: value, name, description: "example description", policyRevisionId: revision, policyName: "example policy" });
const computer = (value = other) => response({ id: value, endpointInformation: { systemDnsHostName: "example" } });
const count = (total: number) => response({ pageNumber: 1, pageSize: 20, totalRecordCount: total, pageCount: Math.ceil(total / 20), data: Array.from({ length: Math.min(20, total) }, () => ({ id: other, host: "example" })) });

test.each([
  ["create", ["--name", "example", "--description", "example description", "--default"], "POST", "/v3/Groups", { name: "example", description: "example description", isDefault: true }, () => [response({ totalRecordCount: 0, data: [] })]],
  ["update", [id, "--name", "example changed"], "PUT", "/v3/Groups", { id, name: "example changed", description: "example description" }, () => [group()]],
  ["set-default", [id], "PATCH", `/v3/Groups/${id}/MarkAsDefault`, undefined, () => [group()]],
  ["assign-policy", [id, "--revision", revision], "POST", `/v3/Groups/${id}/AssignPolicyRevision`, { policyRevisionId: revision }, () => [group()]],
  ["assign-policy", [id, other, "--revision", revision], "POST", "/v3/Groups/AssignPolicyToMultipleGroups", { groupIds: [id, other], policyRevisionId: revision }, () => [group(), group(other)]],
  ["clear-policy", [id], "PATCH", `/v3/Groups/${id}/ClearPolicy`, undefined, () => [group()]],
  ["clear-policy", [id, other], "POST", "/v3/Groups/bulkclearpolicy", { groupIds: [id, other] }, () => [group(), group(other)]],
  ["add-computers", [id, other], "POST", `/v3/Groups/${id}/AssignComputers`, { computerIds: [other], allComputers: false }, () => [group(), computer()]],
  ["remove-computers", [other], "POST", "/v3/Groups/UnassignComputers", { selectionComputerIds: [other], allComputers: false }, () => [computer()]],
] as const)("previews and executes %s via %s %s", async (command, args, method, path, body, reads) => {
  const f = fixture(command);
  const previewCloud = fakeCloud(response(token), ...reads());
  const preview = await f.run(["group", command, ...args], {}, previewCloud);
  expect(preview.data.status).toBe("preview");
  expect(previewCloud.calls.slice(1).every((call) => call.options.method === "GET")).toBe(true);
  expect(existsSync(f.journal)).toBe(false);
  const cloud = fakeCloud(response(token), ...reads(), response(other, 201));
  const result = await f.run(["group", command, ...args, "--execute", "--confirm", preview.data.confirmation as string], {}, cloud);
  expect(result.data.status).toBe("sent");
  expect(cloud.calls.at(-1)!.url.pathname).toBe(`/management-api${path}`);
  expect(cloud.calls.at(-1)!.options.method).toBe(method);
  expect(cloud.calls.at(-1)!.options.body === undefined ? undefined : JSON.parse(cloud.calls.at(-1)!.options.body!.toString())).toEqual(body);
  expect(JSON.parse(readFileSync(join(f.journal, readdirSync(f.journal)[0]!), "utf8"))).toMatchObject({ state: "intent", request: { method, path, ...(body === undefined ? {} : { body }) } });
});

test("update previews the diff and preserves the untouched group name", async () => {
  const f = fixture("update");
  const result = await f.run(["group", "update", id, "--description", "changed"], {}, fakeCloud(response(token), group()));
  expect(result.data.preview).toMatchObject({ diff: { before: { name: "example", description: "example description" }, after: { id, name: "example", description: "changed" } } });
});

test.each([
  ["name", "--description", "synthetic-secret-sentinel"],
  ["description", "--name", "synthetic-secret-sentinel"],
  ["name", "--description", token.access_token],
  ["description", "--name", token.access_token],
])("update preserves secret-bearing %s while changing %s (%s)", async (field, flag, secret) => {
  const f = fixture("update");
  const current = { id, name: "example", description: "example description", [field!]: `before ${secret} after` };
  const args = ["group", "update", id, flag!, "changed"];
  const preview = await f.run(args, {}, fakeCloud(response(token), response(current)));
  expect(preview.data.status).toBe("preview");
  expect(preview.output).not.toContain(secret);
  const cloud = fakeCloud(response(token), response(current), response(null, 204));
  const result = await f.run([...args, "--execute", "--confirm", preview.data.confirmation as string], {}, cloud);
  expect(result.data.status).toBe("sent");
  expect(JSON.parse(cloud.calls.at(-1)!.options.body!.toString())).toMatchObject({ [field!]: current[field!] });
  expect(result.output).not.toContain(secret);
  expect(readFileSync(join(f.journal, readdirSync(f.journal)[0]!), "utf8")).not.toContain(secret);
});

test.each(["Operations (Windows)", "example's group", "example!", "example~", "example*", "example & + %"])("creates a group with query punctuation: %s", async (name) => {
  const f = fixture("create");
  const args = ["group", "create", "--name", name];
  const collection = () => response({ totalRecordCount: 0, data: [] });
  const previewCloud = fakeCloud(response(token), collection());
  const preview = await f.run(args, {}, previewCloud);
  expect(preview.data.status).toBe("preview");
  expect(previewCloud.calls[1]!.url.searchParams.get("Filter.Name")).toBe(name);
  const cloud = fakeCloud(response(token), collection(), response(id, 201));
  expect((await f.run([...args, "--execute", "--confirm", preview.data.confirmation as string], {}, cloud)).data.status).toBe("sent");
  expect(cloud.calls[1]!.url.searchParams.get("Filter.Name")).toBe(name);
  expect(JSON.parse(cloud.calls.at(-1)!.options.body!.toString())).toMatchObject({ name });
});

test.each([
  ["assign-policy", [id, "--revision", revision], 200, other, "sent"],
  ["assign-policy", [id, other, "--revision", revision], 200, other, "sent"],
  ["remove-computers", [other], 202, [id, other], "sent"],
  ["remove-computers", [other], 202, [], "sent"],
  ["remove-computers", [other], 204, undefined, "sent"],
  ["assign-policy", [id, "--revision", revision], 200, undefined, "unknown"],
  ["assign-policy", [id, "--revision", revision], 200, "invalid", "unknown"],
  ["assign-policy", [id, "--revision", revision], 200, {}, "unknown"],
  ["assign-policy", [id, other, "--revision", revision], 200, undefined, "unknown"],
  ["assign-policy", [id, other, "--revision", revision], 200, "invalid", "unknown"],
  ["assign-policy", [id, other, "--revision", revision], 200, {}, "unknown"],
  ["remove-computers", [other], 202, undefined, "unknown"],
  ["remove-computers", [other], 202, other, "unknown"],
  ["remove-computers", [other], 202, [id, "invalid"], "unknown"],
  ["remove-computers", [other], 202, [null], "unknown"],
] as const)("validates %s %j response %i %j as %s", async (command, args, status, data, outcome) => {
  const f = fixture(command);
  const reads = () => command === "remove-computers" ? [computer()] : args.length === 3 ? [group()] : [group(), group(other)];
  const preview = await f.run(["group", command, ...args], {}, fakeCloud(response(token), ...reads()));
  const reply = { status, headers: new Headers(), body: (async function* () { yield Buffer.from(data === undefined ? "" : JSON.stringify(data)); })() };
  const cloud = fakeCloud(response(token), ...reads(), reply);
  const result = await f.run(["group", command, ...args, "--execute", "--confirm", preview.data.confirmation as string], {}, cloud);
  expect(cloud.calls.filter((call) => call.options.method !== "GET")).toHaveLength(2);
  expect(readdirSync(f.journal)).toHaveLength(1);
  if (outcome === "sent") expect(result.data).toMatchObject({ status: "sent", result: data ?? null });
  else expect(result.data.error).toMatchObject({ code: "OUTCOME_UNKNOWN", auditId: expect.any(String) });
});

test("clear-policy names the policy lost by endpoints", async () => {
  const f = fixture("clear-policy");
  const result = await f.run(["group", "clear-policy", id], {}, fakeCloud(response(token), group()));
  expect(result.data.preview).toMatchObject({ groups: [{ policyName: "example policy", policyRevisionId: revision }], warning: expect.stringContaining("lose") });
});

test.each(["update", "set-default", "assign-policy", "clear-policy"])("refuses %s when group state changes after preview", async (command) => {
  const f = fixture(command);
  const extra: Record<string, string[]> = { update: ["--name", "changed"], "assign-policy": ["--revision", revision] };
  const args = ["group", command, id, ...(extra[command] ?? [])];
  const preview = await f.run(args, {}, fakeCloud(response(token), group()));
  const cloud = fakeCloud(response(token), group(id, "changed elsewhere"));
  expect((await f.run([...args, "--execute", "--confirm", preview.data.confirmation as string], {}, cloud)).data).toMatchObject({ error: { code: "CONFIRMATION_REQUIRED" } });
  expect(cloud.calls).toHaveLength(2);
  expect(existsSync(f.journal)).toBe(false);
});

test.each(["add-computers", "remove-computers"])("counts unbounded %s filters and binds the count", async (command) => {
  const f = fixture(command);
  const args = ["group", command, ...(command === "add-computers" ? [id] : []), "--host", "example", "--os", "Windows"];
  const groups = () => command === "add-computers" ? [group()] : [];
  const preview = await f.run(args, {}, fakeCloud(response(token), ...groups(), count(100001)));
  expect(preview.data.preview).toMatchObject({ computers: { count: 100001, hosts: Array(20).fill("example"), filter: { host: "example", os: "Windows" } } });
  expect(preview.data.confirmation).toContain("filter 100001 computers");
  const cloud = fakeCloud(response(token), ...groups(), count(100001), response(other, 201));
  expect((await f.run([...args, "--execute", "--confirm", preview.data.confirmation as string], {}, cloud)).data.status).toBe("sent");
  expect(JSON.parse(cloud.calls.at(-1)!.options.body!.toString())).toEqual({ allComputers: true, filter: { host: "example", os: "Windows" } });
  expect(cloud.calls.at(-2)!.url.searchParams.get("Filter.Host")).toBe("example");
  const changed = fakeCloud(response(token), ...groups(), count(100002));
  expect((await f.run([...args, "--execute", "--confirm", preview.data.confirmation as string], {}, changed)).data).toMatchObject({ error: { code: "CONFIRMATION_REQUIRED" } });
});

test("imports the exact CSV bytes as csvFile after persisting its digest", async () => {
  const f = fixture("import-computers");
  const file = join(f.directory, "input.csv");
  const csv = "HostName\r\nexample\r\n";
  const sha256 = createHash("sha256").update(csv).digest("hex");
  writeFileSync(file, csv, { mode: 0o600 });
  const args = ["group", "import-computers", id, "--file", file];
  const preview = await f.run(args, {}, fakeCloud(response(token), group()));
  expect(preview.data.confirmation).toContain(`sha256 ${sha256}`);
  const cloud = fakeCloud(response(token), group(), response(other, 201));
  const request: typeof cloud.request = async (url, options) => {
    if (url.pathname.endsWith("/AssignComputersByCsv")) {
      const journal = readFileSync(join(f.journal, readdirSync(f.journal)[0]!), "utf8");
      expect(JSON.parse(journal)).toMatchObject({ request: { body: { csvFile: { size: Buffer.byteLength(csv), sha256 } } } });
      expect(journal).not.toContain("HostName");
    }
    return cloud.request(url, options);
  };
  expect((await f.run([...args, "--execute", "--confirm", preview.data.confirmation as string], {}, { request })).data.status).toBe("sent");
  const call = cloud.calls.at(-1)!;
  expect(call.options.method).toBe("POST");
  expect(call.options.headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
  const form = await new Response(call.options.body, { headers: { "content-type": call.options.headers["content-type"]! } }).formData();
  const upload = form.get("csvFile") as File;
  expect(upload.name).toBe("computers.csv");
  expect(await upload.text()).toBe(csv);
  writeFileSync(file, "HostName\r\nchanged\r\n");
  const changed = fakeCloud(response(token), group());
  expect((await f.run([...args, "--execute", "--confirm", preview.data.confirmation as string], {}, changed)).data).toMatchObject({ error: { code: "CONFIRMATION_REQUIRED" } });
  expect(changed.calls).toHaveLength(2);
});

test.each(["empty", "oversized", "symlink", "utf8"])("refuses %s CSV files before authentication", async (kind) => {
  const f = fixture("import-computers");
  const file = join(f.directory, "input.csv");
  const target = join(f.directory, "target.csv");
  writeFileSync(target, "example", { mode: 0o600 });
  if (kind === "symlink") symlinkSync(target, file);
  else writeFileSync(file, kind === "empty" ? "" : kind === "oversized" ? Buffer.alloc(10 * 1024 * 1024 + 1) : Buffer.from([0xff]), { mode: 0o600 });
  const cloud = fakeCloud();
  expect((await f.run(["group", "import-computers", id, "--file", file], {}, cloud)).code).not.toBe(0);
  expect(cloud.calls).toHaveLength(0);
});

test.each([
  ["create"], ["create", id, "--name", "example"], ["create", "--name", " "],
  ["update", id], ["update", id, other, "--name", "example"], ["set-default", "../About"],
  ["assign-policy", id], ["assign-policy", id, id, "--revision", revision],
  ["add-computers", id], ["add-computers", id, other, "--host", "example"],
  ["remove-computers"], ["remove-computers", "--all"], ["remove-computers", "--host", " "],
  ["import-computers", id], ["clear-policy", id, "--confirm", "anything"],
])("validates arguments before credentials: %j", async (...args) => {
  const f = fixture(args[0]!);
  f.env.BEYONDTRUST_AXI_CONFIG = "/missing";
  const cloud = fakeCloud();
  expect((await f.run(["group", ...args], {}, cloud)).code).toBe(2);
  expect(cloud.calls).toHaveLength(0);
});

test.each(["forced", "operation", "disabled", "env"])("denies %s group writes before authentication", async (gate) => {
  const f = fixture("set-default");
  if (gate === "forced") f.env.BEYONDTRUST_AXI_READ_ONLY = "true";
  if (gate === "operation") f.profile.profiles.example.writes.operations = ["group.set-default.extra"];
  if (gate === "disabled") f.profile.profiles.example.writes.allowWrites = false;
  if (gate === "env") Object.assign(f.env, { BEYONDTRUST_AXI_HOST: "example.pm.beyondtrustcloud.com", BEYONDTRUST_AXI_CLIENT_ID: "example", BEYONDTRUST_AXI_CLIENT_SECRET: "example-secret" });
  f.save();
  const cloud = fakeCloud();
  expect((await f.run(["group", "set-default", id], {}, cloud)).data).toMatchObject({ error: { code: "WRITES_DISABLED" } });
  expect(cloud.calls).toHaveLength(0);
});

test.each(["group", "missing-policy-name", "update-fields"])("rejects invalid re-read: %s", async (kind) => {
  const command = kind === "update-fields" ? "update" : "clear-policy";
  const f = fixture(command);
  const detail = kind === "group" ? { id: other } : { id, policyRevisionId: revision };
  const cloud = fakeCloud(response(token), response(detail));
  expect((await f.run(["group", command, id, ...(command === "update" ? ["--name", "changed"] : [])], {}, cloud)).data).toMatchObject({ error: { code: "API_RESPONSE_INVALID" } });
  expect(cloud.calls).toHaveLength(2);
});

test.each([401, 409, 423, 429, 500, "network"])("never replays a group PATCH after %s", async (failure) => {
  const f = fixture("set-default");
  const preview = await f.run(["group", "set-default", id], {}, fakeCloud(response(token), group()));
  const cloud = fakeCloud(response(token), group(), response({ title: f.env.SYNTHETIC_SECRET }, typeof failure === "number" ? failure : 500));
  let sends = 0;
  const request: typeof cloud.request = async (url, options) => {
    if (options.method === "PATCH") {
      sends++;
      expect(readdirSync(f.journal)).toHaveLength(1);
      if (failure === "network") throw new Error(f.env.SYNTHETIC_SECRET);
    }
    return cloud.request(url, options);
  };
  const result = await f.run(["group", "set-default", id, "--execute", "--confirm", preview.data.confirmation as string], {}, { request });
  expect(sends).toBe(1);
  expect(result.code).toBe(1);
  expect(result.output).not.toContain(f.env.SYNTHETIC_SECRET);
  expect(result.output).not.toContain(token.access_token);
  if (failure === "network" || failure === 500) expect(result.data.error).toMatchObject({ code: "OUTCOME_UNKNOWN", auditId: expect.any(String) });
});
