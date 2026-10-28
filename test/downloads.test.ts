import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import * as fsPromises from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { newPrivateFile, windowsAcl } from "../src/private-file.js";
import { localFixture } from "./support/local-cli.js";
import { fakeCloud, response, token } from "./support/fake-pm-cloud.js";
import type { HttpResponse } from "../src/transport.js";

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs/promises")>(),
}));

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

test.each([false, true])("path substitution cannot redirect bytes or delete a replacement (failure: %s)", async (fail) => {
  const f = fixture();
  const moved = join(f.directory, "moved.bin");
  const bytes = Buffer.from([0, 255, 128]);
  const download = newPrivateFile(f.out, async (file) => {
    if (process.platform === "win32") expect(() => renameSync(f.out, moved)).toThrow();
    else {
      renameSync(f.out, moved);
      writeFileSync(f.out, "replacement");
    }
    await file.writeFile(bytes);
    if (fail) throw new Error("synthetic failure");
  });
  if (fail) await expect(download).rejects.toMatchObject({ code: "DOWNLOAD_FILE_ERROR" });
  else await download;
  if (process.platform === "win32") {
    expect(readFileSync(f.out)).toEqual(fail ? Buffer.alloc(0) : bytes);
  } else {
    expect(readFileSync(f.out, "utf8")).toBe("replacement");
    expect(readFileSync(moved)).toEqual(fail ? Buffer.alloc(0) : bytes);
  }
});

test.skipIf(process.platform === "win32")("cleanup truncates the original file when the path is replaced at cleanup", async () => {
  const f = fixture();
  const moved = join(f.directory, "moved.bin");
  const open = fsPromises.open;
  vi.spyOn(fsPromises, "open").mockImplementationOnce(async (...parameters) => {
    const file = await open(...parameters);
    const truncate = file.truncate.bind(file);
    vi.spyOn(file, "truncate").mockImplementationOnce(async (length) => {
      renameSync(f.out, moved);
      writeFileSync(f.out, "replacement");
      await truncate(length);
    });
    return file;
  });
  await expect(newPrivateFile(f.out, async (file) => {
    await file.writeFile(Buffer.from("partial"));
    throw new Error("synthetic failure");
  })).rejects.toMatchObject({ code: "DOWNLOAD_FILE_ERROR" });
  expect(readFileSync(f.out, "utf8")).toBe("replacement");
  expect(statSync(moved).size).toBe(0);
});

test.skipIf(process.platform === "win32").each([
  ["computer", "log", "download", id],
  ["policy", "download", id],
  ["policy", "revision", "download", id],
  ["api-definition", "download"],
])("returns the complete long destination path: %j", async (...args) => {
  const f = fixture();
  const directory = join(f.directory, "a".repeat(180), "b".repeat(180), "c".repeat(180));
  mkdirSync(directory, { recursive: true });
  const out = join(directory, "download.bin");
  const result = await f.run([...args, "--out", out], {}, fakeCloud(response(token), raw(Buffer.from("complete"))));
  expect(result.code).toBe(0);
  expect(result.data.path).toBe(out);
  expect(result.data.help).toBeUndefined();
  expect(readFileSync(out, "utf8")).toBe("complete");
});

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
  expect(existsSync(f.out)).toBe(true);
  if (mib === 50) expect(statSync(f.out).size).toBe(50 * 1024 * 1024);
  else {
    expect(result.data).toMatchObject({ error: { code: "LIMIT_EXCEEDED" } });
    expect(statSync(f.out).size).toBe(0);
    expect(result.output).toContain(f.out);
  }
});

test.each([302, 403, 404, 409, 500])("leaves empty output on HTTP %i without leaking response text", async (status) => {
  const f = fixture();
  const cloud = fakeCloud(response(token), response({ title: f.env.SYNTHETIC_SECRET }, status, { location: "https://example.pm.beyondtrustcloud.com/redirect" }));
  const result = await f.run(["api-definition", "download", "--out", f.out], {}, cloud);
  expect(result.code).toBe(1);
  expect(statSync(f.out).size).toBe(0);
  expect(result.output).toContain(f.out);
  expect(cloud.calls).toHaveLength(2);
  expect(result.output).not.toContain(f.env.SYNTHETIC_SECRET);
});

test("truncates partially streamed output after transport failure", async () => {
  const f = fixture();
  const stream: HttpResponse = { status: 200, headers: new Headers(), body: (async function* () { yield Buffer.from("partial"); throw new Error(f.env.SYNTHETIC_SECRET); })() };
  const result = await f.run(["api-definition", "download", "--out", f.out], {}, fakeCloud(response(token), stream));
  expect(result.data).toMatchObject({ error: { code: "TRANSPORT_ERROR" } });
  expect(statSync(f.out).size).toBe(0);
  expect(result.output).toContain(f.out);
  expect(result.output).not.toContain(f.env.SYNTHETIC_SECRET);
});

test.skipIf(process.platform === "win32")("reports a redacted partial path when truncation fails", async () => {
  const f = fixture();
  const out = join(f.directory, `${f.env.SYNTHETIC_SECRET}.bin`);
  const open = fsPromises.open;
  vi.spyOn(fsPromises, "open").mockImplementationOnce(async (...parameters) => {
    const file = await open(...parameters);
    vi.spyOn(file, "truncate").mockRejectedValueOnce(new Error(f.env.SYNTHETIC_SECRET));
    return file;
  });
  const stream: HttpResponse = { status: 200, headers: new Headers(), body: (async function* () { yield Buffer.from("partial"); throw new Error(f.env.SYNTHETIC_SECRET); })() };
  const result = await f.run(["api-definition", "download", "--out", out], {}, fakeCloud(response(token), stream));
  expect(result.data).toMatchObject({ error: { code: "TRANSPORT_ERROR" } });
  expect(readFileSync(out, "utf8")).toBe("partial");
  expect(result.output).toContain(join(f.directory, "***redacted***.bin"));
  expect(result.output).not.toContain(f.env.SYNTHETIC_SECRET);
});

test.skipIf(process.platform === "win32").each([
  ["computer", "log", "download", id],
  ["policy", "download", id],
  ["policy", "revision", "download", id],
  ["api-definition", "download"],
])("reports destination write failure and truncates partial output: %j", async (...args) => {
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
  expect(statSync(f.out).size).toBe(0);
  expect(result.output).toContain(f.out);
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
