import { request } from "node:https";
import { AxiError } from "axi-sdk-js";
import { z } from "zod";
import { profileOrigin, type SelectedProfile } from "./profiles.js";
import type { SecretRedactor } from "./redact.js";

export type HttpResponse = { status: number; headers: Headers; body: AsyncIterable<Uint8Array> };
export type HttpRequest = (url: URL, options: { method: "GET" | "POST"; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<HttpResponse>;
export type TransportOptions = { request?: HttpRequest; now?: () => number; wait?: (ms: number, signal: AbortSignal) => Promise<void> };

const httpsRequest: HttpRequest = (url, options) => new Promise((resolve, reject) => {
  const req = request(url, { method: options.method, headers: options.headers, signal: options.signal, rejectUnauthorized: true }, (response) => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(response.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    resolve({ status: response.statusCode ?? 0, headers, body: response });
  });
  req.on("error", reject);
  req.end(options.body);
});

const tokenSchema = z.object({ access_token: z.string().min(1).regex(/^[\x21-\x7e]+$/), token_type: z.string().regex(/^Bearer$/i), expires_in: z.number().positive().finite() });
const failures: Record<number, [string, string]> = {
  400: ["API_BAD_REQUEST", "The API rejected the request"],
  401: ["AUTH_FAILED", "The API rejected authentication"],
  403: ["API_FORBIDDEN", "The API account lacks permission"],
  404: ["NOT_FOUND", "The requested resource was not found"],
  409: ["API_CONFLICT", "The resource conflicts with the request"],
  410: ["API_GONE", "The API operation is no longer available"],
  423: ["API_LOCKED", "The resource is locked"],
  429: ["RATE_LIMITED", "The API rate limit was reached"],
};

// One client belongs to one CLI invocation; authentication and all reads share these budgets.
export function readClient(profile: SelectedProfile, credentials: { clientId: string; clientSecret: string }, redactor: SecretRedactor, options: TransportOptions = {}) {
  const origin = profileOrigin(profile.host);
  const now = options.now ?? Date.now;
  const started = now();
  const deadline = AbortSignal.timeout(60_000);
  const send = options.request ?? httpsRequest;
  const wait = options.wait ?? ((ms, signal) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() { signal.removeEventListener("abort", aborted); resolve(); }
    function aborted() { clearTimeout(timer); reject(new Error("Deadline reached")); }
    if (signal.aborted) aborted();
    else signal.addEventListener("abort", aborted, { once: true });
  }));
  let requests = 0;
  let bytes = 0;
  let token: { value: string; expires: number } | undefined;
  let refreshed = false;
  redactor.add(credentials.clientSecret);
  const form = new URLSearchParams({ grant_type: "client_credentials", client_id: credentials.clientId, client_secret: credentials.clientSecret }).toString();
  redactor.add(form);

  function budget() {
    if (deadline.aborted || now() - started >= 60_000) throw new AxiError("Read time limit reached", "LIMIT_EXCEEDED", ["Run the command again"]);
  }
  async function exchange(path: string, method: "GET" | "POST", headers: Record<string, string>, body?: string) {
    budget();
    if (requests >= 10) throw new AxiError("Read request limit reached", "LIMIT_EXCEEDED", ["Use a smaller selection"]);
    requests++;
    try {
      const response = await send(new URL(path, origin), { method, headers, body, signal: deadline });
      const chunks: Buffer[] = [];
      for await (const chunk of response.body) {
        budget();
        bytes += chunk.byteLength;
        if (bytes > 8 * 1024 * 1024) throw new AxiError("Read response byte limit reached", "LIMIT_EXCEEDED", ["Use a smaller selection"]);
        chunks.push(Buffer.from(chunk));
      }
      budget();
      if (response.status >= 300 && response.status < 400) throw new AxiError("HTTPS redirects are refused", "REDIRECT_REFUSED", ["Check the configured host; hosts are never changed automatically"]);
      let data: unknown;
      try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { data = undefined; }
      return { ...response, data };
    } catch (error) {
      if (error instanceof AxiError) throw error;
      budget();
      throw new AxiError("HTTPS request failed", "TRANSPORT_ERROR", ["Check connectivity and the configured host; run beyondtrust-axi doctor"]);
    }
  }
  function failure(status: number, auth = false): never {
    if (auth && status === 404) throw new AxiError("Token endpoint was not found", "AUTH_ENDPOINT_NOT_FOUND", ["Check the configured host against the documented <organization>-services.pm.beyondtrustcloud.com form; the host was not changed"]);
    const [code, message] = failures[status] ?? [status >= 500 ? "API_UNAVAILABLE" : "API_ERROR", "The API request failed"];
    // ProblemDetails text is untrusted and can echo credentials or tenant data; status owns the stable mapping.
    throw new AxiError(message, code, [status === 403 ? "Check the API account permissions" : "Check the profile and request; run beyondtrust-axi doctor"]);
  }
  async function authenticate() {
    const requested = now();
    const response = await exchange("/oauth/connect/token", "POST", { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, form);
    if (response.data && typeof response.data === "object" && "access_token" in response.data && typeof response.data.access_token === "string") redactor.add(response.data.access_token);
    if (response.status !== 200) failure(response.status, true);
    const parsed = tokenSchema.safeParse(response.data);
    if (!parsed.success) throw new AxiError("Invalid token response", "AUTH_RESPONSE_INVALID", ["Check API compatibility; token lifetime remains unverified until commissioning"]);
    token = { value: parsed.data.access_token, expires: requested + parsed.data.expires_in * 1000 };
  }
  return {
    async get(path: string): Promise<unknown> {
      const url = new URL(path, origin);
      if (!/^\/v3\/[A-Za-z0-9/{}?=&%_.-]+$/.test(path) || url.origin !== origin || url.pathname !== path.split("?")[0]) throw new AxiError("Invalid API path", "VALIDATION_ERROR", ["Use a supported read command"]);
      if (!token) await authenticate();
      if (token!.expires - now() <= 30_000 && !refreshed) { refreshed = true; await authenticate(); }
      if (token!.expires <= now()) throw new AxiError("Token expired within this run", "AUTH_EXPIRED", ["Run the read command again"]);
      let retries = 0;
      for (;;) {
        const response = await exchange(`/management-api${path}`, "GET", { authorization: `Bearer ${token!.value}`, accept: "application/json" });
        if (response.status === 401 && !refreshed) { refreshed = true; await authenticate(); continue; }
        if (response.status === 429 && retries < 2) {
          const retry = response.headers.get("retry-after");
          const delay = retry === null ? 1000 : /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - now();
          if (!Number.isFinite(delay) || delay < 0 || delay > 10_000) failure(429);
          retries++;
          try { await wait(delay, deadline); } catch { budget(); throw new AxiError("Retry wait failed", "TRANSPORT_ERROR", ["Run the command again"]); }
          continue;
        }
        if (response.status < 200 || response.status >= 300) failure(response.status);
        if (response.data === undefined) throw new AxiError("Invalid JSON response", "API_RESPONSE_INVALID", ["Check API compatibility"]);
        return redactor.value(response.data);
      }
    },
  };
}
