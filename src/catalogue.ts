import { resourceReadDefinition } from "./resource-reads.js";
export const DESCRIPTION = "Inspect BeyondTrust PM Cloud Endpoint Privilege Management through guarded AXI commands";
const flags = { config: "Configuration file path (default: platform config directory)", profile: "Named file profile (default: selection precedence)", fields: "Comma-separated output fields (default: all)", full: "Show complete strings", help: "Show command help" };
export const resourceReads = Object.fromEntries(Object.entries({
  "computer list": "/v3/Computers",
  "computer view": "/v3/Computers/{id}",
  "computer command-log": "/v3/Computers/{id}/CommandLog",
  "computer logs": "/v3/Computers/{id}/Logs",
  "group list": "/v3/Groups",
  "group view": "/v3/Groups/{id}",
  "policy list": "/v3/Policies",
  "policy view": "/v3/Policies/{id}",
  "policy revisions": "/v3/Policies/{id}/Revisions",
  "policy assigned-groups": "/v3/Policies/{id}/AssignedGroups",
  "policy windows-application-groups": "/PolicyEditor/v3/Policy/{policyId}/Windows/ApplicationGroups",
  "policy macos-application-groups": "/PolicyEditor/v3/Policy/{policyId}/MacOS/ApplicationGroups",
}).map(([command, path]) => [command, resourceReadDefinition(command, path)]));
export const catalogue = {
  home: { description: "Show local context without resolving secrets or making API calls", flags, examples: ["beyondtrust-axi", "beyondtrust-axi home --profile <name>"] },
  "auth status": { description: "Validate local credential readiness without API calls", flags, examples: ["beyondtrust-axi auth status", "beyondtrust-axi auth status --profile <name>"] },
  "profile list": { description: "List named file profiles without resolving secrets", flags, examples: ["beyondtrust-axi profile list", "beyondtrust-axi profile list --config <path>"] },
  "config path": { description: "Show effective configuration and state paths", flags, examples: ["beyondtrust-axi config path", "beyondtrust-axi config path --config <path>"] },
  doctor: { description: "Verify credentials and API access with a bounded About read", flags, examples: ["beyondtrust-axi doctor", "beyondtrust-axi doctor --profile <name>"] },
  about: { description: "Read API versions (GET /v3/About)", flags, examples: ["beyondtrust-axi about", "beyondtrust-axi about --profile <name>"] },
  "task status": { description: "Read task detail (GET /v3/Tasks/{id}); a write result is not assumed to be a task ID", flags: { ...flags, id: "Required task UUID" }, examples: ["beyondtrust-axi task status --id <uuid>", "beyondtrust-axi task status --id <uuid> --fields task"] },
  ...Object.fromEntries(Object.entries(resourceReads).map(([name, entry]) => [name, { description: entry.description, flags: { ...flags, ...entry.flags }, examples: entry.examples }])),
};
export function help() { return { description: DESCRIPTION, commands: Object.entries(catalogue).map(([command, entry]) => ({ command, description: entry.description })), help: ["Run beyondtrust-axi <command> --help for flags and examples"] }; }
