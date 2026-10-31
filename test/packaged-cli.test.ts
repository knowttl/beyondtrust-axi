import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseToml } from "smol-toml";
import { decode } from "@toon-format/toon";
import { afterAll, beforeAll, expect, test } from "vitest";

let directory: string;
let entry: string;
let packageRoot: string;
let version: string;
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "beyondtrust-axi-package-"));
  const packed = spawnSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", directory], { encoding: "utf8" });
  expect(packed.status, packed.stderr).toBe(0);
  const [metadata] = JSON.parse(packed.stdout) as { filename: string; version: string }[];
  version = metadata!.version;
  const tarballs = [join(directory, metadata!.filename)];
  for (const dependency of ["axi-sdk-js", "@toon-format/toon", "zod", "smol-toml"]) {
    // Copy first to break pnpm hardlinks before repacking for offline installation.
    const source = join(directory, "dependencies", dependency);
    cpSync(realpathSync(resolve("node_modules", dependency)), source, { recursive: true });
    const result = spawnSync("npm", ["pack", "--force", "--ignore-scripts", "--json", "--pack-destination", directory], { cwd: source, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    tarballs.push(join(directory, JSON.parse(result.stdout)[0].filename));
  }
  const prefix = join(directory, "Agent's $Tools");
  mkdirSync(prefix);
  // Bind nested dependency requests to the pinned local tarballs without registry metadata.
  writeFileSync(join(prefix, "package.json"), JSON.stringify({ private: true, overrides: {
    "@toon-format/toon": "$@toon-format/toon", "axi-sdk-js": "$axi-sdk-js", "zod": "$zod", "smol-toml": "$smol-toml",
  } }));
  const installed = spawnSync("npm", ["install", "--prefer-offline", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", prefix, ...tarballs], { encoding: "utf8", timeout: 15_000 });
  expect(installed.status, installed.stderr).toBe(0);
  packageRoot = join(prefix, "node_modules/@knowttl/beyondtrust-axi");
  entry = join(packageRoot, "bin/beyondtrust-axi.js");
}, 30_000);
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

function cli(args: string[], env: NodeJS.ProcessEnv = {}, bin = entry) {
  return spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", cwd: directory, timeout: 10_000, env: { ...process.env, ...env } });
}

test("installed CLI shows an explicit empty local home without creating integrations", () => {
  const result = cli([]);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(decode(result.stdout)).toMatchObject({ status: "not configured", count: 0, profiles: [] });
  for (const name of [".claude", ".codex", ".opencode"]) expect(existsSync(join(directory, name))).toBe(false);
});

test("installed profile status is offline and never exposes secret source details", () => {
  const config = join(directory, "profile.json");
  writeFileSync(config, readFileSync(new URL("./fixtures/profile.json", import.meta.url)), { mode: 0o600 });
  const result = cli(["auth", "status"], { BEYONDTRUST_AXI_CONFIG: config, SYNTHETIC_SECRET: "synthetic-packaged-secret" });
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(decode(result.stdout)).toMatchObject({ profile: "example", host: "example.pm.beyondtrustcloud.com", clientSecret: "env", readOnly: true });
  expect(result.stdout + result.stderr).not.toMatch(/synthetic-packaged-secret|SYNTHETIC_SECRET|synthetic-client/);
});

test("installed hook emits local context and command help works offline", () => {
  const hook = join(packageRoot, "bin/beyondtrust-axi-hook.js");
  const result = cli([], {}, hook);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(decode(result.stdout)).toMatchObject({ status: "not configured" });
  const doctor = cli(["auth", "status", "--help"]);
  expect(doctor.status).toBe(0);
  expect(decode(doctor.stdout)).toMatchObject({ command: "auth status" });
});

test.each([
  ["configured", 0, "complete", 1, 1],
  ["empty", 0, "complete", 0, 0],
  ["partial", 0, "partial", 3, 8],
  ["denied", 1, "failed", undefined, undefined],
  ["unavailable", 1, "failed", undefined, undefined],
  ["authentication", 1, "failed", undefined, undefined],
  ["oversized", 1, "failed", undefined, undefined],
])("installed home reports %s without inventing totals", (mode, code, status, count, total) => {
  const config = join(directory, `home-${mode}.json`);
  const log = join(directory, `home-${mode}.log`);
  writeFileSync(config, readFileSync(new URL("./fixtures/profile.json", import.meta.url)), { mode: 0o600 });
  const fake = fileURLToPath(new URL("./support/fake-home-api.mjs", import.meta.url));
  const result = cli([], { BEYONDTRUST_AXI_CONFIG: config, SYNTHETIC_SECRET: "synthetic-home-secret", SYNTHETIC_HOME_MODE: mode,
    SYNTHETIC_REQUEST_LOG: log, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${fake}` });
  expect(result.status, result.stdout + result.stderr).toBe(code);
  const value = decode(result.stdout) as { summary: Record<string, unknown>[] };
  expect(value.summary).toHaveLength(3);
  expect(value.summary).toEqual(["computer", "group", "policy"].map((resource) => expect.objectContaining({ resource, status, ...(count === undefined ? {} : { count, total }) })));
  if (count) expect(value.summary[0]).toMatchObject({ data: expect.arrayContaining([{ id: "00000000-0000-4000-8000-000000000001", host: "example" }]), help: expect.stringContaining("computer list --profile example --config") });
  if (count === undefined) for (const row of value.summary) { expect(row).not.toHaveProperty("count"); expect(row).not.toHaveProperty("total"); }
  expect(readFileSync(log, "utf8").trim().split("\n").length).toBeLessThanOrEqual(5);
  expect(result.stdout + result.stderr).not.toMatch(/synthetic-home-secret|synthetic-startup-token|synthetic-client/);
});

test("installed home enforces its deadline when the service never responds", () => {
  const config = join(directory, "timeout.json");
  writeFileSync(config, readFileSync(new URL("./fixtures/profile.json", import.meta.url)), { mode: 0o600 });
  const result = cli([], { BEYONDTRUST_AXI_CONFIG: config, SYNTHETIC_SECRET: "synthetic-secret", SYNTHETIC_HOME_MODE: "timeout", SYNTHETIC_REQUEST_LOG: join(directory, "timeout.log"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${fileURLToPath(new URL("./support/fake-home-api.mjs", import.meta.url))}` });
  expect(result.signal).toBeNull();
  expect(result.status, result.stdout + result.stderr).toBe(1);
  expect(decode(result.stdout)).toMatchObject({ summary: [{ error: "LIMIT_EXCEEDED" }, { error: "LIMIT_EXCEEDED" }, { error: "LIMIT_EXCEEDED" }] });
}, 12_000);

test("installed list command recovers the rows omitted from the home sample", () => {
  const config = join(directory, "continuation.json");
  writeFileSync(config, readFileSync(new URL("./fixtures/profile.json", import.meta.url)), { mode: 0o600 });
  const result = cli(["computer", "list", "--profile", "example", "--config", config, "--all"], { SYNTHETIC_SECRET: "synthetic-secret", SYNTHETIC_HOME_MODE: "partial", SYNTHETIC_REQUEST_LOG: join(directory, "continuation.log"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${fileURLToPath(new URL("./support/fake-home-api.mjs", import.meta.url))}` });
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(decode(result.stdout)).toMatchObject({ count: 8, total: 8, cursor: null, data: expect.arrayContaining([{ id: "00000000-0000-4000-8000-000000000008", host: "example-8" }]) });
});

test.each([false, true])("installed env home recovery commands retain environment selection with a file config: %s", (fileConfig) => {
  const config = join(directory, "env-home.json");
  if (fileConfig) writeFileSync(config, readFileSync(new URL("./fixtures/profile.json", import.meta.url)), { mode: 0o600 });
  const env = {
    BEYONDTRUST_AXI_CONFIG: fileConfig ? config : undefined,
    BEYONDTRUST_AXI_HOST: "example.pm.beyondtrustcloud.com", BEYONDTRUST_AXI_CLIENT_ID: "synthetic-client",
    BEYONDTRUST_AXI_CLIENT_SECRET: "synthetic-secret", SYNTHETIC_HOME_MODE: "partial",
    SYNTHETIC_REQUEST_LOG: join(directory, `env-home-${fileConfig}.log`),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${fileURLToPath(new URL("./support/fake-home-api.mjs", import.meta.url))}`,
  };
  const home = cli([], env);
  expect(home.status, home.stdout + home.stderr).toBe(0);
  const value = decode(home.stdout) as { summary: { resource: string; help: string }[] };
  expect(value.summary.map((row) => row.resource)).toEqual(["computer", "group", "policy"]);
  for (const row of value.summary) {
    expect(row.help).toBe(`Run beyondtrust-axi ${row.resource} list --all`);
    const recovered = cli(row.help.slice("Run beyondtrust-axi ".length).split(" "), env);
    expect(recovered.status, recovered.stdout + recovered.stderr).toBe(0);
    expect(decode(recovered.stdout)).toMatchObject({ count: 8, total: 8, cursor: null });
  }
});

test("installed home retains successful reads when another resource is denied", () => {
  const config = join(directory, "mixed.json");
  writeFileSync(config, readFileSync(new URL("./fixtures/profile.json", import.meta.url)), { mode: 0o600 });
  const result = cli([], { BEYONDTRUST_AXI_CONFIG: config, SYNTHETIC_SECRET: "synthetic-secret", SYNTHETIC_HOME_MODE: "mixed", SYNTHETIC_REQUEST_LOG: join(directory, "mixed.log"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${fileURLToPath(new URL("./support/fake-home-api.mjs", import.meta.url))}` });
  expect(result.status, result.stdout + result.stderr).toBe(1);
  expect(decode(result.stdout)).toMatchObject({ status: "live: incomplete; see resource errors", summary: [
    { resource: "computer", count: 1, total: 1 }, { resource: "group", status: "failed", error: "API_FORBIDDEN" }, { resource: "policy", count: 1, total: 1 },
  ] });
});

test("installed offline home and hook do not resolve secrets or authenticate; unknown flags fail first", () => {
  const config = join(directory, "offline.json");
  const profile = JSON.parse(readFileSync(new URL("./fixtures/profile.json", import.meta.url), "utf8"));
  profile.profiles.example.clientSecret = { file: join(directory, "missing-secret") };
  writeFileSync(config, JSON.stringify(profile), { mode: 0o600 });
  for (const [args, bin] of [[["home", "--offline"], entry], [[], join(packageRoot, "bin/beyondtrust-axi-hook.js")]] as const) {
    const result = cli([...args], { BEYONDTRUST_AXI_CONFIG: config }, bin);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(decode(result.stdout)).toMatchObject({ status: "configured: example (example.pm.beyondtrustcloud.com); offline, API not checked" });
    expect(result.stdout.length).toBeLessThan(2500);
  }
  const invalid = cli(["home", "--unknown"], { BEYONDTRUST_AXI_CONFIG: config });
  expect(invalid.status).toBe(2);
  expect(decode(invalid.stdout)).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
});

test("installed setup preserves settings, repeats without changes and repairs moved hook paths", () => {
  const home = join(directory, "Agent's $Home");
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(join(home, ".codex"), { recursive: true });
  const unrelated = { type: "command", command: "echo beyondtrust-axi-hook.js" };
  const stale = { type: "command", command: "node '/old/install/beyondtrust-axi-hook.js'" };
  const settings = { theme: "preserve", hooks: { Stop: [{ hooks: [unrelated] }], SessionStart: [{ matcher: "startup", hooks: [unrelated, stale] }] } };
  const claude = join(home, ".claude/settings.json"), codex = join(home, ".codex/hooks.json"), toml = join(home, ".codex/config.toml");
  writeFileSync(claude, JSON.stringify(settings));
  writeFileSync(codex, JSON.stringify(settings));
  writeFileSync(toml, '# preserved comment\nmodel = "example"\n[features]\nhooks = false\nother = true\n[profiles.example]\nmodel = "example"\n');
  const args = ["setup", "hooks", "--directory", home];
  const result = cli(args);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(decode(result.stdout)).toMatchObject({ integrations: [
    { agent: "claude", status: "installed" }, { agent: "codex", status: "installed" }, { agent: "opencode", status: "installed" },
  ] });
  const saved = JSON.parse(readFileSync(claude, "utf8"));
  expect(saved).toMatchObject({ theme: "preserve", hooks: { Stop: settings.hooks.Stop, SessionStart: [{ matcher: "startup", hooks: [unrelated] }, { hooks: [{ type: "command", timeout: 3 }] }] } });
  const command = saved.hooks.SessionStart[1].hooks[0].command;
  const launched = spawnSync(command, { shell: true, encoding: "utf8", timeout: 5000, env: process.env });
  expect(launched.status, launched.stdout + launched.stderr).toBe(0);
  expect(decode(launched.stdout)).toMatchObject({ status: "not configured" });
  expect(parseToml(readFileSync(toml, "utf8"))).toEqual({ model: "example", features: { hooks: true, other: true }, profiles: { example: { model: "example" } } });
  expect(readFileSync(toml, "utf8")).toContain("# preserved comment");
  const before = [claude, codex, toml].map((path) => readFileSync(path, "utf8"));
  const repeated = cli(args);
  expect(repeated.status, repeated.stdout).toBe(0);
  expect(decode(repeated.stdout)).toMatchObject({ integrations: [{ status: "unchanged" }, { status: "unchanged" }, { status: "unchanged" }] });
  expect([claude, codex, toml].map((path) => readFileSync(path, "utf8"))).toEqual(before);
  const plugin = join(home, ".config/opencode/plugins/beyondtrust-axi.js");
  const invoke = `const { BeyondTrustAXI } = await import(${JSON.stringify(pathToFileURL(plugin).href)}); const hooks = await BeyondTrustAXI(); const output = { system: ["existing"] }; await hooks["experimental.chat.system.transform"]({}, output); console.log(JSON.stringify(output));`;
  const opencode = spawnSync(process.execPath, ["--input-type=module", "-e", invoke], { encoding: "utf8", env: process.env });
  expect(opencode.status, opencode.stderr).toBe(0);
  const system = JSON.parse(opencode.stdout).system;
  expect(system[0]).toBe("existing");
  expect(decode(system[1])).toMatchObject({ status: "not configured" });
});

test.each(["claude", "codex", "opencode"])("installed setup reports real %s failures without replacing unrelated files", (agent) => {
  const home = mkdtempSync(join(directory, "failure-"));
  const path = agent === "opencode" ? join(home, ".config/opencode/plugins/beyondtrust-axi.js") : join(home, `.${agent}`, agent === "codex" ? "hooks.json" : "settings.json");
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, "unrelated invalid config");
  const result = cli(["setup", "hooks", "--agent", agent, "--directory", home]);
  expect(result.status, result.stdout).toBe(1);
  expect(decode(result.stdout)).toMatchObject({ integrations: [{ agent, status: "failed" }] });
  expect(readFileSync(path, "utf8")).toBe("unrelated invalid config");
});

test("installed setup reports filesystem failures for every requested agent", () => {
  const home = join(directory, "blocked-home");
  writeFileSync(home, "preserve");
  const result = cli(["setup", "hooks", "--directory", home]);
  expect(result.status, result.stdout).toBe(1);
  expect(decode(result.stdout)).toMatchObject({ integrations: [{ agent: "claude", status: "failed" }, { agent: "codex", status: "failed" }, { agent: "opencode", status: "failed" }] });
  expect(readFileSync(home, "utf8")).toBe("preserve");
});

test("installed setup uses agent config overrides and a PATH-verified hook binary", () => {
  const config = join(directory, "claude-override");
  const result = cli(["setup", "hooks", "--agent", "claude"], { CLAUDE_CONFIG_DIR: config,
    PATH: `${resolve(packageRoot, "../../.bin")}${delimiter}${process.env.PATH}` });
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(JSON.parse(readFileSync(join(config, "settings.json"), "utf8"))).toMatchObject({ hooks: { SessionStart: [{ hooks: [{ command: "beyondtrust-axi-hook" }] }] } });
});

test.each(["claude", "codex"])("installed %s hook bypasses an earlier installation on PATH", (agent) => {
  const home = join(directory, `shadowed-${agent}`);
  const oldBin = join(home, "old-bin");
  mkdirSync(oldBin, { recursive: true });
  writeFileSync(join(oldBin, "beyondtrust-axi-hook"), "#!/bin/sh\nprintf 'old installation\\n'\n", { mode: 0o755 });
  const env = { ...process.env, PATH: `${oldBin}${delimiter}${resolve(packageRoot, "../../.bin")}${delimiter}${process.env.PATH}` };
  const result = cli(["setup", "hooks", "--agent", agent, "--directory", home], env);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  const path = join(home, `.${agent}`, agent === "claude" ? "settings.json" : "hooks.json");
  const command = JSON.parse(readFileSync(path, "utf8")).hooks.SessionStart[0].hooks[0].command;
  const launched = spawnSync(command, { shell: true, encoding: "utf8", timeout: 5000, env });
  expect(launched.status, launched.stdout + launched.stderr).toBe(0);
  expect(decode(launched.stdout)).toMatchObject({ status: "not configured" });
});

test("published metadata includes credential schema, inventory and generated discovery", () => {
  expect(JSON.parse(readFileSync(join(packageRoot, "axi-credential.schema.json"), "utf8")).properties.clientSecret["x-secret"]).toBe(true);
  expect(existsSync(join(packageRoot, "skills/beyondtrust-axi/SKILL.md"))).toBe(true);
  expect(existsSync(join(packageRoot, "docs/commands.md"))).toBe(true);
  for (const guide of ["configuration", "design"]) {
    expect(existsSync(join(packageRoot, `docs/${guide}.md`))).toBe(true);
  }
  expect(JSON.parse(readFileSync(join(packageRoot, "inventory/capabilities.json"), "utf8")).coverage).toHaveLength(94);
});

test("installed resource commands expose their read filters without credentials or network", () => {
  const result = cli(["computer", "list", "--help"]);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(decode(result.stdout)).toMatchObject({ command: "computer list", flags: { limit: expect.any(String), cursor: expect.any(String), "host-type": expect.stringContaining("Linux") } });
  const policy = cli(["policy", "macos-application-groups", "--help"]);
  expect(policy.status).toBe(0);
  expect(decode(policy.stdout)).toMatchObject({ command: "policy macos-application-groups", flags: { "application-id": expect.any(String) } });
});

test.each([
  [["home", "--help"], "home", "offline"],
  [["setup", "hooks", "--help"], "setup hooks", "agent"],
])("installed startup commands document their supported flags: %j", (args, command, flag) => {
  const result = cli(args);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(decode(result.stdout)).toMatchObject({ command, flags: { [flag]: expect.any(String) } });
});

test("installed event reads finish within a 128 MiB heap instead of dying by signal", () => {
  const config = join(directory, "event-profile.json");
  writeFileSync(config, readFileSync(new URL("./fixtures/profile.json", import.meta.url)), { mode: 0o600 });
  const source = `
    import { main } from ${JSON.stringify(new URL(`file://${join(packageRoot, "dist/src/cli.js")}`).href)};
    const values = [
      { access_token: "synthetic-token", token_type: "Bearer", expires_in: 3600 },
      { events: [{ event: { action: "allowed" } }], totalRecordsReturned: 1 }
    ];
    await main(["event", "list"], { transport: { request: async () => ({
      status: 200, headers: new Headers(),
      body: (async function* () { yield Buffer.from(JSON.stringify(values.shift())); })()
    }) } });
  `;
  const result = spawnSync(process.execPath, ["--max-old-space-size=128", "--input-type=module", "-e", source], {
    encoding: "utf8", timeout: 10_000, cwd: directory,
    env: { ...process.env, BEYONDTRUST_AXI_CONFIG: config, SYNTHETIC_SECRET: "synthetic-event-secret" },
  });
  expect(result.signal, result.stderr).toBeNull();
  expect(result.status, result.stderr).toBe(0);
  expect(decode(result.stdout)).toMatchObject({ count: 1, data: [{ action: "allowed" }] });
});

test("all version aliases work without the compiled command graph", () => {
  const dist = join(packageRoot, "dist");
  renameSync(dist, `${dist}-hidden`);
  try {
    for (const alias of ["--version", "-v", "-V"]) {
      const result = cli([alias]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe(`${version}\n`);
    }
  } finally { renameSync(`${dist}-hidden`, dist); }
});

test("version startup stays close to the same machine's Node process floor", () => {
  const measure = (args: string[]) => {
    const start = performance.now();
    expect(spawnSync(process.execPath, args, { encoding: "utf8", timeout: 5_000 }).status).toBe(0);
    return performance.now() - start;
  };
  const floor = Array.from({ length: 5 }, () => measure(["-e", "console.log(1)"])).sort((a, b) => a - b)[2]!;
  const probe = Array.from({ length: 5 }, () => measure([entry, "--version"])).sort((a, b) => a - b)[2]!;
  expect(probe / floor).toBeLessThan(5);
});
