// Controlled HTTPS boundary for packaged startup tests; no sockets or real tenant.
// Fixtures follow GET /v3/Computers, /v3/Groups and /v3/Policies in inventory/swagger.json.
import https from "node:https";
import type { IncomingMessage, RequestOptions } from "node:http";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { MessageChannel } from "node:worker_threads";

https.request = ((url: URL, options: RequestOptions & { signal: AbortSignal }, callback: (response: IncomingMessage) => void) => {
  appendFileSync(process.env.SYNTHETIC_REQUEST_LOG!, `${options.method} ${url.pathname}${url.search}\n`);
  const request = new EventEmitter() as EventEmitter & { end: () => void };
  request.end = () => queueMicrotask(() => {
    const mode = process.env.SYNTHETIC_HOME_MODE;
    if (mode === "timeout") {
      const { port1, port2 } = new MessageChannel();
      port1.on("message", () => {});
      options.signal.addEventListener("abort", () => {
        port1.close(); port2.close();
        request.emit("error", new Error("Synthetic service stalled"));
      }, { once: true });
      return;
    }
    let status = 200;
    let value: unknown;
    if (mode === "unavailable") status = 503;
    else if (url.pathname === "/oauth/connect/token") {
      if (mode === "authentication") status = 401;
      value = { access_token: "synthetic-startup-token", token_type: "Bearer", expires_in: 3600 };
    } else if (mode === "denied" || mode === "mixed" && url.pathname.endsWith("/Groups")) status = 403;
    else {
      const label = url.pathname.endsWith("/Computers") ? "host" : "name";
      const size = Number(url.searchParams.get("Pagination.PageSize"));
      const count = mode === "empty" ? 0 : mode === "partial" ? 8 : 1;
      const data = Array.from({ length: Math.min(count, size) }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, [label]: index ? `example-${index + 1}` : "example" }));
      value = { pageNumber: 1, pageSize: size, totalRecordCount: count, pageCount: Math.ceil(count / size), data };
      if (mode === "oversized") value = { padding: "x".repeat(256 * 1024) };
    }
    const response = Readable.from([Buffer.from(JSON.stringify(value ?? {}))]) as IncomingMessage;
    response.statusCode = status;
    response.headers = {};
    callback(response);
  });
  return request;
}) as typeof https.request;
syncBuiltinESMExports();
