import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { request } from "node:https";
import { beforeEach, expect, test, vi } from "vitest";
import { readClient } from "../src/transport.js";
import { SecretRedactor } from "../src/redact.js";
import { token } from "./support/fake-pm-cloud.js";

vi.mock("node:https", () => ({ request: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

test("the real HTTPS adapter verifies TLS and preserves bodyless requests with the shared abort deadline", async () => {
  const responses = [token, [], null, null];
  vi.mocked(request).mockImplementation(((_url: URL, _options: unknown, callback: (response: Readable) => void) => {
    const req = new EventEmitter();
    return Object.assign(req, { end() { callback(Object.assign(Readable.from([Buffer.from(JSON.stringify(responses.shift()))]), { statusCode: 200, headers: { "content-type": "application/json" } })); } });
  }) as unknown as typeof request);
  const api = readClient({ host: "example.pm.beyondtrustcloud.com" } as Parameters<typeof readClient>[0], { clientId: "synthetic-client", clientSecret: "synthetic-secret" }, new SecretRedactor());
  await api.get("/v3/About");
  await api.write("/v3/Groups/00000000-0000-4000-8000-000000000001", undefined, { method: "DELETE" });
  await api.write("/v3/Policies/00000000-0000-4000-8000-000000000001/DiscardDraft", undefined, { method: "PATCH" });
  expect(vi.mocked(request).mock.calls).toHaveLength(4);
  expect(vi.mocked(request).mock.calls[0]![1]).toMatchObject({ rejectUnauthorized: true, method: "POST", signal: expect.any(AbortSignal) });
  expect(vi.mocked(request).mock.calls[1]![1]).toMatchObject({ rejectUnauthorized: true, method: "GET", signal: vi.mocked(request).mock.calls[0]![1]!.signal });
  expect(vi.mocked(request).mock.calls[1]![1]!.headers).not.toHaveProperty("content-length");
  expect(vi.mocked(request).mock.calls[2]![1]!.headers).not.toHaveProperty("content-length");
  expect(vi.mocked(request).mock.calls[3]![1]!.headers).not.toHaveProperty("content-length");
});

test.each([
  { path: "/v3/Computers", body: { computerIds: ["00000000-0000-4000-8000-000000000001"], allComputers: false }, options: { method: "DELETE" as const } },
  { path: "/v3/Computers", body: { filter: { hostName: "example" }, allComputers: true }, options: { method: "DELETE" as const } },
  { path: "/v3/Computers/Deactivate", body: { computerIds: ["00000000-0000-4000-8000-000000000001"], allComputers: false }, options: { method: "POST" as const } },
  { path: "/v3/Groups", body: { name: "exämple" }, options: { method: "PUT" as const } },
  { path: "/v3/Policies", body: { name: "example" }, options: { policyFile: Buffer.from([0, 128, 255]) } },
  { path: "/v3/Groups/00000000-0000-4000-8000-000000000001/AssignComputersByCsv", body: undefined, options: { csv: Buffer.from("host\nexämple\n") } },
])("frames supplied payloads by byte length for $path with $options", async ({ path, body, options }) => {
  const responses = [token, [], null];
  const payloads: (string | Buffer | undefined)[] = [];
  vi.mocked(request).mockImplementation(((_url: URL, _options: unknown, callback: (response: Readable) => void) => {
    const req = new EventEmitter();
    return Object.assign(req, { end(payload?: string | Buffer) {
      payloads.push(payload);
      callback(Object.assign(Readable.from([Buffer.from(JSON.stringify(responses.shift()))]), { statusCode: 200, headers: { "content-type": "application/json" } }));
    } });
  }) as unknown as typeof request);
  const api = readClient({ host: "example.pm.beyondtrustcloud.com" } as Parameters<typeof readClient>[0], { clientId: "synthetic-client", clientSecret: "synthetic-secret" }, new SecretRedactor());
  await api.get("/v3/About");
  await api.write(path, body, options);
  expect(vi.mocked(request).mock.calls).toHaveLength(3);
  expect(vi.mocked(request).mock.calls[0]![1]!.headers).toMatchObject({ "content-length": String(Buffer.byteLength(payloads[0]!)) });
  expect(vi.mocked(request).mock.calls[1]![1]!.headers).not.toHaveProperty("content-length");
  expect(vi.mocked(request).mock.calls[2]![1]).toMatchObject({ method: options.method ?? "POST" });
  const headers = vi.mocked(request).mock.calls[2]![1]!.headers;
  expect(headers).toMatchObject({ "content-length": String(Buffer.byteLength(payloads[2]!)) });
});
