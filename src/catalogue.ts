export const DESCRIPTION = "Inspect BeyondTrust PM Cloud Endpoint Privilege Management through guarded AXI commands";
const flags = { config: "Configuration file path (default: platform config directory)", profile: "Named file profile (default: selection precedence)", fields: "Comma-separated output fields (default: all)", full: "Show complete strings", help: "Show command help" };
export const catalogue = {
  home: { description: "Show local context without resolving secrets or making API calls", flags, examples: ["beyondtrust-axi", "beyondtrust-axi home --profile <name>"] },
  "auth status": { description: "Validate local credential readiness without API calls", flags, examples: ["beyondtrust-axi auth status", "beyondtrust-axi auth status --profile <name>"] },
  "profile list": { description: "List named file profiles without resolving secrets", flags, examples: ["beyondtrust-axi profile list", "beyondtrust-axi profile list --config <path>"] },
  "config path": { description: "Show effective configuration and state paths", flags, examples: ["beyondtrust-axi config path", "beyondtrust-axi config path --config <path>"] },
};
export function help() { return { description: DESCRIPTION, commands: Object.entries(catalogue).map(([command, entry]) => ({ command, description: entry.description })), help: ["Run beyondtrust-axi <command> --help for flags and examples"] }; }
