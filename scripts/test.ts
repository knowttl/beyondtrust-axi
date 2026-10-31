import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const guard = fileURLToPath(new URL("../test/support/deny-network.ts", import.meta.url));
for (const args of [["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], ["node_modules/vitest/vitest.mjs", "run"]]) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit", env: { ...process.env, NODE_OPTIONS: `--import=${guard}` } });
  if (result.error) throw result.error;
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
}
