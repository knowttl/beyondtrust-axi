import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { catalogue, DESCRIPTION } from "../dist/src/catalogue.js";

const root = new URL("../", import.meta.url);
const reference = Object.entries(catalogue).map(([name, entry]) => `## ${name}\n\n${entry.description}.\n\n| Flag | Meaning |\n|---|---|\n${Object.entries(entry.flags).map(([flag, description]) => `| --${flag} | ${description} |`).join("\n")}\n\n\`\`\`sh\n${entry.examples.join("\n")}\n\`\`\`\n`).join("\n");
const outputs = {
  "docs/commands.md": `# Commands\n\n${DESCRIPTION}.\n\nB2 adds doctor, about and task status API reads.\nOther commands remain local and offline.\n\n${reference}`,
  "skills/beyondtrust-axi/SKILL.md": `---\nname: beyondtrust-axi\ndescription: Inspect BeyondTrust PM Cloud Endpoint Privilege Management profiles, API readiness, versions and task status.\n---\n\n# BeyondTrust AXI\n\n${DESCRIPTION}.\n\nB2 supports local discovery, doctor, about and task status.\nUse a configured session hook for ambient local context or this skill for on-demand guidance.\nThe 0.0.0 scaffold is unpublished; use a built checkout until release.\nNever put secrets in argv or contact a live tenant during automated verification.\nToken lifetime, rate limits and live compatibility remain unverified until commissioning through artium-axi.\n\n${reference.replaceAll("beyondtrust-axi", "npx -y @knowttl/beyondtrust-axi")}`,
};
if (process.argv.slice(2).some((arg) => arg !== "--check")) throw new Error("Use --check or no arguments");
for (const [path, content] of Object.entries(outputs)) {
  const url = new URL(path, root);
  if (process.argv.includes("--check")) {
    if (readFileSync(url, "utf8") !== content) throw new Error(`Generated documentation is stale: ${path}`);
  } else { mkdirSync(new URL("./", url), { recursive: true }); writeFileSync(url, content); }
}
console.log(process.argv.includes("--check") ? "Verified generated command reference and skill" : "Generated command reference and skill");
