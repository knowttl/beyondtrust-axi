import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resourceReads } from "../dist/src/catalogue.js";
import { downloads } from "../dist/src/downloads.js";
import { computerWrites } from "../dist/src/computer-writes.js";
import { groupWrites } from "../dist/src/group-writes.js";
import { policyWrites } from "../dist/src/policy-writes.js";
import { identityWrites } from "../dist/src/identity-writes.js";
import { jitWrites } from "../dist/src/jit-writes.js";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const pin = JSON.parse(read("inventory/specs.json"));
const bytes = read(pin.file);
const spec = JSON.parse(bytes);
const { coverage } = JSON.parse(read("inventory/capabilities.json"));
const operations = Object.entries(spec.paths).flatMap(([path, methods]) => Object.keys(methods)
  .filter((method) => ["get", "post", "put", "patch", "delete"].includes(method))
  .map((method) => `${method.toUpperCase()} ${path}`)).sort();
const recorded = coverage.map(({ method, path }) => `${method} ${path}`).sort();
const counts = Object.fromEntries(["read", "download", "write", "delete", "not-built"].map((kind) => [kind, coverage.filter((row) => row.classification === kind).length]));
const implemented = ["/v3/About", "/v3/Tasks/{id}", ...Object.values(resourceReads).flatMap(({ path, variants }) => [path, ...Object.values(variants ?? {})]), ...Object.values(downloads)];
const implementedWrites = [...Object.values(computerWrites).flat().map((path) => `POST ${path}`), ...[...Object.values(groupWrites), ...Object.values(policyWrites), ...Object.values(identityWrites), ...Object.values(jitWrites)].flat().map(({ method, path }) => `${method} ${path}`)];
if (process.argv.slice(2).some((arg) => arg !== "--check")
  || createHash("sha256").update(bytes).digest("hex") !== pin.sha256
  || pin.originalSha256 !== "02e50021358738930d6f009c78e8330f67a37a4bfd761e182f870b592cfe042f"
  || pin.operationCount !== 94 || operations.length !== 94 || JSON.stringify(operations) !== JSON.stringify(recorded)
  || JSON.stringify(counts) !== JSON.stringify({ read: 43, download: 4, write: 40, delete: 6, "not-built": 1 })
  || coverage.some((row) => !["planned", "implemented", "not-built"].includes(row.status)
    || (row.status === "implemented" && !(row.method === "GET" && implemented.includes(row.path)) && !implementedWrites.includes(`${row.method} ${row.path}`)))
  || coverage.filter((row) => row.status === "implemented").length !== implemented.length + implementedWrites.length
  || coverage.filter((row) => row.sharedDelete).length !== 2
  || spec.components.securitySchemes.oauth2.flows.clientCredentials.tokenUrl !== pin.substitution.replacement
  || pin.substitution.replacement !== "https://example-services.pm.beyondtrustcloud.com/oauth/connect/token") {
  throw new Error("Specification pin, operation coverage or disposition mismatch");
}
console.log(`Verified pinned export and 94 operations (${implemented.length} implemented reads, ${implementedWrites.length} implemented writes; 43 reads, 4 downloads, 40 writes, 6 deletes, 1 not built; 2 shared Policy Editor deletes)`);
