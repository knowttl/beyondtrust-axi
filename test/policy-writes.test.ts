import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { localFixture } from "./support/local-cli.js";
import { fakeCloud, response, token } from "./support/fake-pm-cloud.js";

const id = "00000000-0000-0000-0000-000000000001";
const groupId = "00000000-0000-0000-0000-000000000002";
const revisionId = "00000000-0000-0000-0000-000000000003";
const fixtures: ReturnType<typeof localFixture>[] = [];
function fixture(command: string) {
  const f = localFixture();
  f.env.XDG_STATE_HOME = f.directory;
  f.profile.profiles.example.writes = { allowWrites: true, allowDeletes: false, operations: [`policy.${command.replaceAll(" ", ".")}`] };
  f.save(); fixtures.push(f);
  const file = join(f.directory, "input.xml");
  writeFileSync(file, "<?xml version=\"1.0\"?><Policy>example</Policy>\r\n", { mode: 0o600 });
  return { ...f, file, journal: join(f.directory, "beyondtrust-axi", "writes") };
}
afterEach(() => { for (const f of fixtures.splice(0)) f.cleanup(); });
// Synthetic fixtures: inventory/swagger.json GET /v3/Policies, GET /v3/Policies/{id},
// GET /v3/Policies/{id}/AssignedGroups, GET /v3/Policies/{id}/Revisions,
// GET /PolicyEditor/v3/Policy/{policyId}/Windows|MacOS/ApplicationGroups,
// and the six write method/path pairs exercised below.
const policy = (name = "example") => response({ id, name, description: "example description", revision: 1, lastModified: "2026-01-01T00:00:00Z" });
const groups = () => response([{ id: groupId, name: "example", policyId: id, policyRevisionId: revisionId }]);
const revisions = () => response([{ id: revisionId, revision: 1 }]);
const applications = () => response([{ id: groupId, name: "example", applications: [] }]);

test.each([
  ["create", "POST", "/v3/Policies"],
  ["update", "PUT", `/v3/Policies/${id}`],
  ["upload", "POST", `/v3/Policies/${id}/Upload`],
  ["auto-assign", "POST", "/v3/Groups/AutoAssignPolicyRevision"],
] as const)("previews and executes policy %s using %s %s", async (command, method, path) => {
  const f = fixture(command);
  const args = ["policy", command, ...(command === "create" ? ["--name", "example", "--description", "example description", "--file", f.file] : command === "update" ? [id, "--name", "changed"] : command === "upload" ? [id, "--file", f.file, "--auto-assign"] : [id, "--revision", revisionId])];
  const reads = () => command === "create" ? [response({ totalRecordCount: 0, data: [] })] : command === "auto-assign" ? [policy(), groups(), revisions()] : command === "upload" ? [policy(), groups()] : [policy()];
  const previewCloud = fakeCloud(response(token), ...reads());
  const preview = await f.run(args, {}, previewCloud);
  expect(preview.data.status).toBe("preview");
  expect(previewCloud.calls.slice(1).every((call) => call.options.method === "GET")).toBe(true);
  expect(existsSync(f.journal)).toBe(false);
  const cloud = fakeCloud(response(token), ...reads(), response(command === "update" ? null : revisionId, command === "update" ? 204 : command === "auto-assign" ? 200 : 201));
  const request: typeof cloud.request = async (url, options) => {
    if (options.method === method && url.pathname === `/management-api${path}`) expect(readdirSync(f.journal)).toHaveLength(1);
    return cloud.request(url, options);
  };
  const result = await f.run([...args, "--execute", "--confirm", preview.data.confirmation as string], {}, { request });
  expect(result.data.status).toBe("sent");
  const call = cloud.calls.at(-1)!;
  expect(call.url.pathname).toBe(`/management-api${path}`);
  expect(call.options.method).toBe(method);
  if (command === "create" || command === "upload") {
    const sha256 = createHash("sha256").update(readFileSync(f.file)).digest("hex");
    expect(preview.data.confirmation).toContain(`sha256 ${sha256}`);
    const form = await new Response(call.options.body, { headers: { "content-type": call.options.headers["content-type"]! } }).formData();
    const file = form.get("PolicyFile") as File;
    expect(file.name).toBe("policy.xml");
    expect(Buffer.from(await file.arrayBuffer())).toEqual(readFileSync(f.file));
    expect([...form.keys()].sort()).toEqual(command === "create" ? ["Description", "Name", "PolicyFile"] : ["AutoAssignToGroup", "PolicyFile"]);
    if (command === "create") { expect(form.get("Name")).toBe("example"); expect(form.get("Description")).toBe("example description"); }
    else expect(form.get("AutoAssignToGroup")).toBe("true");
    const journal = readFileSync(join(f.journal, readdirSync(f.journal)[0]!), "utf8");
    expect(JSON.parse(journal)).toMatchObject({ request: { method, path, body: { PolicyFile: { sha256 } } } });
    expect(journal).not.toContain("<?xml");
  } else expect(JSON.parse(call.options.body!.toString())).toEqual(command === "update" ? { name: "changed", description: "example description" } : { policyId: id, policyRevisionId: revisionId });
});

test.each(["create", "upload"])("sends UTF-16 XML byte-identically for policy %s", async (command) => {
  const f = fixture(command);
  const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<?xml version="1.0" encoding="UTF-16"?><Policy>example</Policy>\r\n', "utf16le")]);
  writeFileSync(f.file, bytes);
  const args = ["policy", command, ...(command === "create" ? ["--name", "example"] : [id]), "--file", f.file];
  const reads = () => command === "create" ? response({ totalRecordCount: 0, data: [] }) : policy();
  const preview = await f.run(args, {}, fakeCloud(response(token), reads()));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  expect(preview.data).toMatchObject({ status: "preview", preview: { file: { size: bytes.length, sha256 } } });
  expect(preview.data.confirmation).toContain(`sha256 ${sha256}`);
  const cloud = fakeCloud(response(token), reads(), response(revisionId, 201));
  const result = await f.run([...args, "--execute", "--confirm", preview.data.confirmation as string], {}, cloud);
  expect(result.data.status).toBe("sent");
  const call = cloud.calls.at(-1)!;
  const form = await new Response(call.options.body, { headers: { "content-type": call.options.headers["content-type"]! } }).formData();
  expect(Buffer.from(await (form.get("PolicyFile") as File).arrayBuffer())).toEqual(bytes);
});

test.each(["windows", "macos"])("adds only %s applications with the documented envelope and response", async (os) => {
  const f = fixture("app add");
  const additions = [{ type: os === "windows" ? "exe" : "bin", description: f.env.SYNTHETIC_SECRET, fileName: { matchType: "Exact", value: "example" } }];
  writeFileSync(f.file, JSON.stringify(additions));
  const args = ["policy", "app", "add", id, "--os", os, "--app-group", groupId, "--file", f.file];
  const preview = await f.run(args, {}, fakeCloud(response(token), policy(), applications()));
  expect(preview.data.status).toBe("preview");
  const cloud = fakeCloud(response(token), policy(), applications(), response({ revisionId, created: [id], deleted: [] }, 201));
  const result = await f.run([...args, "--execute", "--confirm", preview.data.confirmation as string], {}, cloud);
  expect(result.data).toMatchObject({ status: "sent", result: { revisionId, created: [id], deleted: [] } });
  expect(cloud.calls[2]!.url.searchParams.get("Filter.ApplicationGroupId")).toBe(groupId);
  expect(cloud.calls.at(-1)!.url.pathname).toBe(`/management-api/PolicyEditor/v3/Policy/${id}/${os === "windows" ? "Windows" : "MacOS"}/ApplicationGroups/Applications`);
  expect(JSON.parse(cloud.calls.at(-1)!.options.body!.toString())).toEqual({ applicationData: { applicationGroups: { edit: [{ id: groupId, applications: { add: additions } }] } } });
  expect(preview.output + result.output + readFileSync(join(f.journal, readdirSync(f.journal)[0]!), "utf8")).not.toContain(f.env.SYNTHETIC_SECRET);
});

test.each([
  ["windows", [{ type: "dll" }]], ["windows", [{ type: "future-type" }]], ["macos", [{ type: "exe" }]], ["windows", [{}]],
  ["windows", [{ type: "exe", activeXCodebase: { value: "example" } }]],
  ["windows", [{ type: "exe", fileName: { matchType: "anything" } }]],
  ["windows", [{ type: "exe", delete: [id] }]],
  ["windows", { add: [{ type: "exe" }], delete: [id] }],
  ["windows", []], ["windows", [{ type: "exe", fileName: { unexpected: true } }]],
] as const)("rejects unsupported or mixed %s app inputs %j before authentication", async (os, data) => {
  const f = fixture("app add");
  writeFileSync(f.file, JSON.stringify(data));
  const cloud = fakeCloud();
  expect((await f.run(["policy", "app", "add", id, "--os", os, "--app-group", groupId, "--file", f.file], {}, cloud)).data).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  expect(cloud.calls).toHaveLength(0);
});

test("application additions reject unknown types in the prerequisite read", async () => {
  const f = fixture("app add");
  writeFileSync(f.file, '[{"type":"exe"}]');
  const cloud = fakeCloud(response(token), policy(), response([{ id: groupId, applications: [{ id, type: "future-type" }] }]));
  const result = await f.run(["policy", "app", "add", id, "--os", "windows", "--app-group", groupId, "--file", f.file], {}, cloud);
  expect(result.code).toBe(1);
  expect(result.data.error).toMatchObject({ code: "API_RESPONSE_INVALID" });
  expect(existsSync(f.journal)).toBe(false);
});

test.each(["file", "policy", "groups", "revision", "app-group"])("refuses execution when %s changes after preview", async (change) => {
  const command = change === "app-group" ? "app add" : change === "groups" || change === "revision" ? "auto-assign" : "upload";
  const f = fixture(command);
  if (change === "app-group") writeFileSync(f.file, '[{"type":"exe"}]');
  const args = ["policy", ...command.split(" "), id, ...(command === "auto-assign" ? ["--revision", revisionId] : ["--file", f.file]), ...(change === "app-group" ? ["--os", "windows", "--app-group", groupId] : [])];
  const extra = () => command === "auto-assign" ? [groups(), revisions()] : change === "app-group" ? [applications()] : [];
  const preview = await f.run(args, {}, fakeCloud(response(token), policy(), ...extra()));
  if (change === "file") writeFileSync(f.file, "<Policy>changed</Policy>");
  const cloud = fakeCloud(response(token), policy(change === "policy" ? "changed" : "example"), ...(change === "groups" ? [response([]), revisions()] : change === "revision" ? [groups(), response([{ id: revisionId, revision: 2 }])] : change === "app-group" ? [response([{ id: groupId, name: "changed", applications: [] }])] : extra()));
  expect((await f.run([...args, "--execute", "--confirm", preview.data.confirmation as string], {}, cloud)).data).toMatchObject({ error: { code: "CONFIRMATION_REQUIRED" } });
  expect(cloud.calls.slice(1).every((call) => call.options.method === "GET")).toBe(true);
  expect(existsSync(f.journal)).toBe(false);
});

test.each(["empty", "oversized", "symlink"])("refuses %s policy files before authentication", async (kind) => {
  const f = fixture("upload");
  const file = join(f.directory, "unsafe.xml");
  if (kind === "symlink") symlinkSync(f.file, file);
  else writeFileSync(file, kind === "empty" ? "" : Buffer.alloc(10 * 1024 * 1024 + 1), { mode: 0o600 });
  const cloud = fakeCloud();
  expect((await f.run(["policy", "upload", id, "--file", file], {}, cloud)).code).not.toBe(0);
  expect(cloud.calls).toHaveLength(0);
});

test("accepts exactly 10 MiB and defaults upload auto assignment to false", async () => {
  const f = fixture("upload");
  const bytes = Buffer.from(`<Policy>${"x".repeat(10 * 1024 * 1024 - 17)}</Policy>`);
  expect(bytes.length).toBe(10 * 1024 * 1024);
  writeFileSync(f.file, bytes);
  const result = await f.run(["policy", "upload", id, "--file", f.file], {}, fakeCloud(response(token), policy()));
  expect(result.data).toMatchObject({ status: "preview", preview: { request: { AutoAssignToGroup: false }, file: { size: bytes.length } } });
});

test.each(["forced", "operation", "disabled", "env"])("denies %s policy writes before authentication", async (gate) => {
  const f = fixture("update");
  if (gate === "forced") f.env.BEYONDTRUST_AXI_READ_ONLY = "true";
  if (gate === "operation") f.profile.profiles.example.writes.operations = ["policy.update.extra"];
  if (gate === "disabled") f.profile.profiles.example.writes.allowWrites = false;
  if (gate === "env") Object.assign(f.env, { BEYONDTRUST_AXI_HOST: "example.pm.beyondtrustcloud.com", BEYONDTRUST_AXI_CLIENT_ID: "example", BEYONDTRUST_AXI_CLIENT_SECRET: "example-secret" });
  f.save();
  const cloud = fakeCloud();
  expect((await f.run(["policy", "update", id, "--name", "changed"], {}, cloud)).data).toMatchObject({ error: { code: "WRITES_DISABLED" } });
  expect(cloud.calls).toHaveLength(0);
});

test.each([401, 409, 423, 429, 500, "network", "invalid-response"])("never replays policy app additions after %s", async (failure) => {
  const f = fixture("app add");
  writeFileSync(f.file, '[{"type":"exe"}]');
  const args = ["policy", "app", "add", id, "--os", "windows", "--app-group", groupId, "--file", f.file];
  const preview = await f.run(args, {}, fakeCloud(response(token), policy(), applications()));
  const cloud = fakeCloud(response(token), policy(), applications(), response({ title: f.env.SYNTHETIC_SECRET }, typeof failure === "number" ? failure : 201));
  let sends = 0;
  const request: typeof cloud.request = async (url, options) => {
    if (url.pathname.endsWith("/Applications") && options.method === "POST") {
      sends++;
      expect(readdirSync(f.journal)).toHaveLength(1);
      if (failure === "network") throw new Error(f.env.SYNTHETIC_SECRET);
    }
    return cloud.request(url, options);
  };
  const result = await f.run([...args, "--execute", "--confirm", preview.data.confirmation as string], {}, { request });
  expect(sends).toBe(1);
  expect(result.code).toBe(1);
  expect(result.output).not.toContain(f.env.SYNTHETIC_SECRET);
  expect(result.output).not.toContain(token.access_token);
  if (typeof failure === "string" || failure === 500) expect(result.data.error).toMatchObject({ code: "OUTCOME_UNKNOWN", auditId: expect.any(String) });
});

test("auto-assign refuses a revision from another policy", async () => {
  const f = fixture("auto-assign");
  const cloud = fakeCloud(response(token), policy(), groups(), response([{ id: groupId, revision: 1 }]));
  expect((await f.run(["policy", "auto-assign", id, "--revision", revisionId], {}, cloud)).data).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  expect(existsSync(f.journal)).toBe(false);
});
