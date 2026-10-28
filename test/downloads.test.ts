import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import * as fsPromises from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { windowsAcl } from "../src/private-file.js";
import { localFixture } from "./support/local-cli.js";
import { fakeCloud, response, token } from "./support/fake-pm-cloud.js";
import type { HttpResponse } from "../src/transport.js";

const id = "00000000-0000-0000-0000-000000000001";
const fixtures: ReturnType<typeof localFixture>[] = [];
function fixture(allow = true) {
  const f = localFixture();
  f.profile.profiles.example.downloads = { allow };
  f.save();
  fixtures.push(f);
  return { ...f, out: join(f.directory, "download.bin") };
}
afterEach(() => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) f.cleanup(); });
function raw(...chunks: Uint8Array[]): HttpResponse {
  return { status: 200, headers: new Headers({ "content-type": "application/octet-stream" }), body: (async function* () { yield* chunks; })() };
}

// inventory/swagger.json: these four GET routes return downloaded bytes; Content routes omit success schemas.
test.each([
  [["computer", "log", "download", id], `/v3/Computers/Logs/${id}/Content`],
  [["policy", "download", id], `/v3/Policies/${id}/Content`],
  [["policy", "revision", "download", id], `/v3/Policies/PolicyRevision/${id}/Content`],
  [["api-definition", "download"], "/v3/File/download/GetYamlApiDefinitionFile"],
])("downloads raw bytes through the CLI: %j", async (args, path) => {
  const f = fixture();
  const bytes = Buffer.from([0, 255, 128, 10, 13, 42]);
  const cloud = fakeCloud(response(token), raw(bytes.subarray(0, 2), bytes.subarray(2)));
  const result = await f.run([...args, "--out", f.out], {}, cloud);
  expect(result.code).toBe(0);
  expect(result.data).toEqual({ path: f.out, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), contentType: "application/octet-stream" });
  expect(readFileSync(f.out)).toEqual(bytes);
  if (process.platform !== "win32") expect(statSync(f.out).mode & 0o777).toBe(0o600);
  else expect(() => windowsAcl(f.out, true)).not.toThrow();
  expect(cloud.calls[1]!.url.pathname).toBe(`/management-api${path}`);
  expect(result.output).not.toContain(token.access_token);
});

test.each([false, "env"])("refuses downloads without file-profile permission: %s", async (allow) => {
  const f = fixture(false);
  if (allow === "env") Object.assign(f.env, { BEYONDTRUST_AXI_HOST: "example.pm.beyondtrustcloud.com", BEYONDTRUST_AXI_CLIENT_ID: "synthetic-client", BEYONDTRUST_AXI_CLIENT_SECRET: "synthetic-secret" });
  const cloud = fakeCloud();
  const result = await f.run(["api-definition", "download", "--out", f.out], {}, cloud);
  expect(result.data).toMatchObject({ error: { code: "DOWNLOADS_DISABLED" } });
  expect(cloud.calls).toHaveLength(0);
  expect(existsSync(f.out)).toBe(false);
});

test.each([
  ["policy", "download", "--out", "unused"],
  ["policy", "download", "../About", "--out", "unused"],
  ["api-definition", "download"],
  ["api-definition", "download", "unexpected", "--out", "unused"],
  ["api-definition", "download", "--out", "unused", "--out", "duplicate"],
])("validates download arguments before configuration: %j", async (...args) => {
  const f = fixture();
  f.env.BEYONDTRUST_AXI_CONFIG = "/missing/config.json";
  const cloud = fakeCloud();
  expect((await f.run(args, {}, cloud)).code).toBe(2);
  expect(cloud.calls).toHaveLength(0);
});

test.each(["file", "symlink"])("never overwrites an existing %s", async (kind) => {
  const f = fixture();
  const target = join(f.directory, "target");
  writeFileSync(target, "original");
  if (kind === "symlink") symlinkSync(target, f.out);
  else writeFileSync(f.out, "original");
  const cloud = fakeCloud();
  const result = await f.run(["api-definition", "download", "--out", f.out], {}, cloud);
  expect(result.data).toMatchObject({ error: { code: "DOWNLOAD_FILE_ERROR" } });
  expect(readFileSync(target, "utf8")).toBe("original");
  expect(readFileSync(f.out, "utf8")).toBe("original");
  expect(cloud.calls).toHaveLength(0);
});

test.each([50, 51])("enforces the 50 MiB streaming boundary at %i MiB", async (mib) => {
  const f = fixture();
  const chunk = Buffer.alloc(1024 * 1024, 42);
  const cloud = fakeCloud(response(token), raw(...Array<Buffer>(mib).fill(chunk)));
  const result = await f.run(["api-definition", "download", "--out", f.out], {}, cloud);
  expect(result.code).toBe(mib === 50 ? 0 : 1);
  expect(existsSync(f.out)).toBe(mib === 50);
  if (mib === 50) expect(statSync(f.out).size).toBe(50 * 1024 * 1024);
  else expect(result.data).toMatchObject({ error: { code: "LIMIT_EXCEEDED" } });
});

test.each([302, 403, 404, 409, 500])("removes output on HTTP %i without leaking response text", async (status) => {
  const f = fixture();
  const cloud = fakeCloud(response(token), response({ title: f.env.SYNTHETIC_SECRET }, status, { location: "https://example.pm.beyondtrustcloud.com/redirect" }));
  const result = await f.run(["api-definition", "download", "--out", f.out], {}, cloud);
  expect(result.code).toBe(1);
  expect(existsSync(f.out)).toBe(false);
  expect(cloud.calls).toHaveLength(2);
  expect(result.output).not.toContain(f.env.SYNTHETIC_SECRET);
});

test("removes partially streamed output after transport failure", async () => {
  const f = fixture();
  const stream: HttpResponse = { status: 200, headers: new Headers(), body: (async function* () { yield Buffer.from("partial"); throw new Error(f.env.SYNTHETIC_SECRET); })() };
  const result = await f.run(["api-definition", "download", "--out", f.out], {}, fakeCloud(response(token), stream));
  expect(result.data).toMatchObject({ error: { code: "TRANSPORT_ERROR" } });
  expect(existsSync(f.out)).toBe(false);
  expect(result.output).not.toContain(f.env.SYNTHETIC_SECRET);
});

test.each([
  ["computer", "log", "download", id],
  ["policy", "download", id],
  ["policy", "revision", "download", id],
  ["api-definition", "download"],
])("reports destination write failure and removes partial output: %j", async (...args) => {
  const f = fixture();
  const open = fsPromises.open;
  vi.spyOn(fsPromises, "open").mockImplementationOnce(async (...parameters) => {
    const file = await open(...parameters);
    vi.spyOn(file, "writeFile").mockImplementationOnce(async () => {
      await file.write(Buffer.from("partial"));
      throw new Error(f.env.SYNTHETIC_SECRET);
    });
    return file;
  });
  const cloud = fakeCloud(response(token), raw(Buffer.from("complete")));
  const result = await f.run([...args, "--out", f.out], {}, cloud);
  expect(result.code).toBe(1);
  expect(result.data).toMatchObject({ error: { code: "DOWNLOAD_FILE_ERROR" } });
  expect(existsSync(f.out)).toBe(false);
  expect(result.output).not.toContain(f.env.SYNTHETIC_SECRET);
});

test("refreshes read authentication and honors bounded 429 retry before downloading", async () => {
  const f = fixture();
  const cloud = fakeCloud(response(token), response({}, 401), response(token), response({}, 429, { "retry-after": "0" }), raw(Buffer.from("complete")));
  const result = await f.run(["api-definition", "download", "--out", f.out], {}, cloud);
  expect(result.code).toBe(0);
  expect(readFileSync(f.out, "utf8")).toBe("complete");
  expect(cloud.calls).toHaveLength(5);
});
