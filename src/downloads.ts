import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { AxiError } from "axi-sdk-js";
import { newPrivateFile } from "./private-file.js";
import type { readClient } from "./transport.js";

export const downloads: Record<string, string> = {
  "computer log download": "/v3/Computers/Logs/{id}/Content",
  "policy download": "/v3/Policies/{id}/Content",
  "policy revision download": "/v3/Policies/PolicyRevision/{policyRevisionId}/Content",
  "api-definition download": "/v3/File/download/GetYamlApiDefinitionFile",
};

export function prepareDownload(template: string, id: string | undefined, out: string | undefined) {
  if (!out?.trim() || out.includes("\0") || (template.includes("{") && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id ?? ""))) {
    throw new AxiError("Download requires a resource UUID where shown and --out <file>", "VALIDATION_ERROR", ["Run the download command with --help"]);
  }
  const path = resolve(out);
  const route = template.replace(/\{[^}]+\}/, id ?? "");
  return async (client: ReturnType<typeof readClient>) => {
    const hash = createHash("sha256");
    let size = 0;
    const contentType = await client.download(route, async (body) => {
      // The destination is created only once the first chunk (or the end of an empty body) has arrived,
      // so API errors and streams that fail before any byte leave nothing behind to block a retry.
      const chunks = body[Symbol.asyncIterator]();
      try {
        const first = await chunks.next();
        await newPrivateFile(path, async (file) => {
          for (let next = first; !next.done; next = await chunks.next()) {
            try { await file.writeFile(next.value); }
            catch { throw new AxiError("Download file could not be completed", "DOWNLOAD_FILE_ERROR", ["Check destination permissions and free space"]); }
            hash.update(next.value);
            size += next.value.byteLength;
          }
        });
      } finally { await chunks.return?.(); }
    });
    return { path, size, sha256: hash.digest("hex"), contentType };
  };
}
