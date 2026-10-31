import { accessSync, constants, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { parse } from "smol-toml";
import { z } from "zod";
import { AxiError } from "axi-sdk-js";

const object = z.record(z.string(), z.unknown());
const handler = object.and(z.object({ type: z.string(), command: z.string().optional() }));
const group = object.and(z.object({ hooks: z.array(handler) }));
const configuration = object.and(z.object({ hooks: object.and(z.object({ SessionStart: z.array(group).optional() })).optional() }));

// Parse executable positions only; a marker passed to an unrelated command is never ownership.
function owned(command: string): boolean {
  const words: string[] = [];
  let word = "", quote = "", escaped = false;
  for (let index = 0; index < command.length; index++) {
    const character = command[index]!;
    if (escaped) { word += character; escaped = false; }
    else if (character === "\\" && quote !== "'" && (quote !== '"' || /["\\$`]/.test(command[index + 1] ?? ""))) escaped = true;
    else if (quote) { if (character === quote) quote = ""; else word += character; }
    else if (character === "'" || character === '"') quote = character;
    else if (/\s/.test(character)) { if (word) { words.push(word); word = ""; } }
    else if (/[;&|<>`$()]/.test(character)) return false;
    else word += character;
  }
  if (quote || escaped) return false;
  if (word) words.push(word);
  const name = (value = "") => basename(value.replaceAll("\\", "/"));
  return ["beyondtrust-axi-hook", "beyondtrust-axi-hook.js"].includes(name(words[0])) ||
    (/^node(?:\.exe)?$/.test(name(words[0])) && name(words[1]) === "beyondtrust-axi-hook.js");
}

function read(path: string): string { return existsSync(path) ? readFileSync(path, "utf8") : ""; }
function save(path: string, content: string): boolean {
  if (read(path) === content) return false;
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { writeFileSync(temporary, content, { mode: 0o600, flag: "wx" }); renameSync(temporary, path); }
  finally { rmSync(temporary, { force: true }); }
  return true;
}

export function setupHooks(agent = "all", directory?: string): Record<string, unknown> {
  if (!["all", "claude", "codex", "opencode"].includes(agent) || directory === "") throw new AxiError("Use --agent claude|codex|opencode|all and a non-empty --directory", "VALIDATION_ERROR", ["Run beyondtrust-axi setup hooks --help"]);
  const home = resolve(directory ?? homedir());
  const hook = fileURLToPath(new URL("../../bin/beyondtrust-axi-hook.js", import.meta.url));
  const executable = (process.env.PATH ?? "").split(delimiter).map((path) => join(path, "beyondtrust-axi-hook")).find((path) => {
    try { accessSync(path, constants.X_OK); return realpathSync(path) === realpathSync(hook); } catch { return false; }
  });
  const quote = (value: string) => process.platform === "win32" ? `"${value.replaceAll('"', '""')}"` : `'${value.replaceAll("'", "'\\''")}'`;
  const command = executable ? "beyondtrust-axi-hook" : `${quote(process.execPath)} ${quote(hook)}`;
  const integrations = [];
  for (const target of agent === "all" ? ["claude", "codex", "opencode"] : [agent]) {
    try {
      let changed: boolean;
      if (target === "opencode") {
        const base = directory ? join(home, ".config/opencode") : process.env.OPENCODE_CONFIG_DIR ?? join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "opencode");
        const path = join(base, "plugins/beyondtrust-axi.js");
        if (existsSync(path) && !read(path).startsWith("// Managed by beyondtrust-axi setup hooks\n")) throw new Error("Plugin path is already owned by another file");
        const program = `// Managed by beyondtrust-axi setup hooks\nimport { execFile } from "node:child_process";\nimport { promisify } from "node:util";\nexport const BeyondTrustAXI = async () => ({\n  "experimental.chat.system.transform": async (_input, output) => {\n    const { stdout } = await promisify(execFile)(${JSON.stringify(process.execPath)}, [${JSON.stringify(hook)}], { timeout: 3000, maxBuffer: 16384 });\n    output.system.push(stdout);\n  },\n});\n`;
        changed = save(path, program);
      } else {
        const base = directory ? join(home, `.${target}`) : target === "codex" ? process.env.CODEX_HOME ?? join(home, ".codex") : process.env.CLAUDE_CONFIG_DIR ?? join(home, ".claude");
        const path = join(base, target === "codex" ? "hooks.json" : "settings.json");
        const original = read(path);
        const data = configuration.parse(original ? JSON.parse(original) : {});
        const groups = data.hooks?.SessionStart ?? [];
        const desired = { type: "command", command, timeout: 3 };
        const retained = groups.flatMap((entry) => {
          const hooks = entry.hooks.filter((item) => item.type !== "command" || !owned(item.command ?? ""));
          return hooks.length ? [{ ...entry, hooks }] : [];
        });
        const hooks = { ...data.hooks, SessionStart: [...retained, { hooks: [desired] }] };
        const content = JSON.stringify({ ...data, hooks }, null, 2) + "\n";
        let toml: { path: string; content: string } | undefined;
        if (target === "codex") {
          const config = join(base, "config.toml");
          const source = read(config);
          const parsed = parse(source);
          if (parsed.features !== undefined && (!parsed.features || typeof parsed.features !== "object" || Array.isArray(parsed.features))) throw new Error("Invalid features table");
          const features = parsed.features as Record<string, unknown> | undefined;
          if (features?.hooks !== true) {
            const lines = source.split("\n");
            const start = lines.findIndex((line) => /^\s*\[features\]\s*(?:#.*)?$/.test(line));
            if (start === -1) {
              if (features !== undefined) throw new Error("Use a [features] table to enable hooks");
              toml = { path: config, content: `${source}\n[features]\nhooks = true\n` };
            } else {
              let end = start + 1;
              while (end < lines.length && !/^\s*\[/.test(lines[end]!)) end++;
              const key = lines.findIndex((line, index) => index > start && index < end && /^\s*hooks\s*=/.test(line));
              if (features?.hooks !== undefined && key === -1) throw new Error("Use an unquoted hooks key to enable hooks");
              if (key !== -1) lines[key] = "hooks = true"; else lines.splice(start + 1, 0, "hooks = true");
              toml = { path: config, content: lines.join("\n") };
            }
            parse(toml.content);
          }
        }
        changed = save(path, content);
        if (toml) changed = save(toml.path, toml.content) || changed;
      }
      integrations.push({ agent: target, status: changed ? "installed" : "unchanged", mode: "offline" });
    } catch {
      process.exitCode = 1;
      integrations.push({ agent: target, status: "failed", help: "Check agent configuration syntax, file ownership and write permissions; repeat beyondtrust-axi setup hooks" });
    }
  }
  return { integrations, help: ["Session context is offline; run beyondtrust-axi for live reads", "Restart the agent to load its integration; Codex may require hook trust approval", "Remove the beyondtrust-axi-hook SessionStart handler or managed OpenCode plugin to uninstall"] };
}
