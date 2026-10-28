import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { request } from "node:https";
import { expect, test, vi } from "vitest";
import { readClient } from "../src/transport.js";
import { SecretRedactor } from "../src/redact.js";
import { token } from "./support/fake-pm-cloud.js";

vi.mock("node:https", () => ({ request: vi.fn() }));

test("the real HTTPS adapter verifies TLS and carries the shared abort deadline", async () => {
  const responses = [token, []];
  vi.mocked(request).mockImplementation(((_url: URL, _options: unknown, callback: (response: Readable) => void) => {
    const req = new EventEmitter();
    return Object.assign(req, { end() { callback(Object.assign(Readable.from([Buffer.from(JSON.stringify(responses.shift()))]), { statusCode: 200, headers: { "content-type": "application/json" } })); } });
  }) as unknown as typeof request);
  const api = readClient({ host: "example.pm.beyondtrustcloud.com" } as Parameters<typeof readClient>[0], { clientId: "synthetic-client", clientSecret: "synthetic-secret" }, new SecretRedactor());
  await api.get("/v3/About");
  expect(vi.mocked(request).mock.calls).toHaveLength(2);
  expect(vi.mocked(request).mock.calls[0]![1]).toMatchObject({ rejectUnauthorized: true, method: "POST", signal: expect.any(AbortSignal) });
  expect(vi.mocked(request).mock.calls[1]![1]).toMatchObject({ rejectUnauthorized: true, method: "GET", signal: vi.mocked(request).mock.calls[0]![1]!.signal });
});
