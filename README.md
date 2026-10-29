# beyondtrust-axi

Inspect BeyondTrust PM Cloud Endpoint Privilege Management through compact, guarded AXI commands.

[![npm](https://img.shields.io/npm/v/@knowttl/beyondtrust-axi)](https://www.npmjs.com/package/@knowttl/beyondtrust-axi) [![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE) [![Node](https://img.shields.io/badge/node-%3E%3D22.12-blue)](package.json) [![Provenance](https://img.shields.io/badge/npm-provenance-blue)](https://www.npmjs.com/package/@knowttl/beyondtrust-axi#provenance) [![AXI](https://img.shields.io/badge/AXI-agent%20experience-blue)](https://github.com/knowttl)

[Why](#why-this-exists) | [Quickstart](#quickstart) | [Agents](#use-with-your-agent) | [Coverage](#what-it-covers) | [Safety](#safety) | [Configuration](#configuration) | [Output](#output-and-exit-codes) | [Troubleshooting](#troubleshooting) | [Contributing](#contributing) | [Security](#security) | [License](#license)

## Why this exists

Agents need compact, predictable access to BeyondTrust PM Cloud Endpoint Privilege Management without guessing routes or replaying disruptive requests.
This project pins the vendor OpenAPI contract and builds bounded reads, explicit write gates and redacted output in separate slices.
B2 supplies local discovery, credential readiness, API diagnostics, versions and task status.
B3 adds 12 computer, group and policy reads, including Windows and macOS application groups.
B4 adds 18 user, role, domain, account, authentication-provider and SCIM reads.
B5 adds 11 event, audit and JIT request reads.
B6 adds four raw-byte downloads for computer logs, policies, policy revisions and the API definition.
B7 adds the write coordinator and computer authorise, reject, archive, unarchive, logs request and details request commands, covering eight POST operations.
B8 adds group create, update, set-default, assign-policy, clear-policy, add-computers, import-computers and remove-computers through the coordinator, covering ten operations.
B9 adds policy create, update, upload, auto-assign and Windows/macOS app add through the coordinator, covering six operations.
B10 adds twelve user, accepted-domain and SCIM write operations through the coordinator.
B11 adds admin-request create/decide, auth-request notify and app-switcher connect through the coordinator, covering four operations.
B12 completes six delete operations and Windows/macOS application removal with separate delete permission and confirmation, and prepares the initial 0.1.0 release.
The [94-operation ledger](inventory/capabilities.json) describes planned coverage and never enables execution.

## Quickstart

Requires Node.js 22.12 or later and Corepack.
Run the published package:

```sh
npx -y @knowttl/beyondtrust-axi
npx -y @knowttl/beyondtrust-axi config path
```

To run from a checkout:

```sh
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm run build
node bin/beyondtrust-axi.js
node bin/beyondtrust-axi.js config path
```

A fresh home prints status: not configured and count: 0 without network access.
For local readiness, supply BEYONDTRUST_AXI_CLIENT_SECRET through a secret manager or private environment, then run:

```sh
export BEYONDTRUST_AXI_HOST=example-services.pm.beyondtrustcloud.com
export BEYONDTRUST_AXI_CLIENT_ID=synthetic-client
node bin/beyondtrust-axi.js auth status
```

Replace the synthetic host and client ID with your API account metadata.
See the [configuration guide](docs/configuration.md) for the PM Cloud API host format.
auth status validates local credentials and makes no token exchange or API request.

## Use with your agent

beyondtrust-axi-hook is the session entry point and emits the local home view without resolving secrets or contacting the API.
Configure an agent session-start hook explicitly to run node with the absolute bin/beyondtrust-axi-hook.js path from your built checkout.
No command installs integrations automatically; remove the hook entry to uninstall it.
The generated [skill](skills/beyondtrust-axi/SKILL.md) provides on-demand discovery and grants no credentials or permissions.
Use the hook, the skill or both; neither is required for normal CLI use.
Skill commands use npx as shown in [Quickstart](#quickstart).

## What it covers

| Group | Purpose | Access | Reference |
|---|---|---|---|
| home | Local profile context | Local read | [Commands](docs/commands.md) |
| auth | Local credential readiness | Local read | [Configuration](docs/configuration.md) |
| profile | Named profile list | Local read | [Configuration](docs/configuration.md) |
| config | Effective config and state paths | Local read | [Configuration](docs/configuration.md) |
| doctor | Authenticate and verify About access | API read | [Commands](docs/commands.md) |
| about | Console, reporting database and policy editor versions | API read | [Commands](docs/commands.md) |
| task status | Task detail by --id UUID | API read | [Commands](docs/commands.md) |
| computer | List, detail, command logs and agent log metadata | API read | [Commands](docs/commands.md) |
| computer authorise, reject, archive, unarchive, logs request, details request | Preview or send a computer action once | Gated write | [Commands](docs/commands.md) |
| group | List and detail | API read | [Commands](docs/commands.md) |
| group create, update, set-default, assign-policy, clear-policy, add-computers, import-computers, remove-computers | Preview or send a group change once | Gated write | [Commands](docs/commands.md) |
| policy | List, detail, revisions, assigned groups and platform application groups | API read | [Commands](docs/commands.md) |
| policy create, update, upload, auto-assign, app add | Preview or send a policy change once | Gated write | [Commands](docs/commands.md) |
| user, role, global-role, domain | List and show identity and access metadata | API read | [Commands](docs/commands.md) |
| user create, update, preferences set, assign-roles, disable, enable, resend-invite; domain create, update; scim user create, replace, patch | Preview or send an identity change once | Gated write | [Commands](docs/commands.md) |
| api-account, auth-provider | List API accounts and show authentication provider configuration | API read | [Commands](docs/commands.md) |
| scim | Resource types, schemas, service configuration, users and roles | API read | [Commands](docs/commands.md) |
| event | Compact ECS events from a start date or filtered window | API read | [Commands](docs/commands.md) |
| audit activity, audit auth-request | Vendor activity and authorization request audits | API read | [Commands](docs/commands.md) |
| admin-request, auth-request | List and show JIT requests | API read | [Commands](docs/commands.md) |
| admin-request create, decide; auth-request notify | Preview or send an admin request, decision or ITSM ticket callback once | Gated write | [Commands](docs/commands.md) |
| app-switcher connect | Preview or register Insight connectors once | Gated write | [Commands](docs/commands.md) |
| computer delete, deactivate; group delete; domain delete; policy delete, discard-draft, app remove | Preview or send a deletion once | Gated delete | [Commands](docs/commands.md) |
| computer log download, policy download, policy revision download, api-definition download | Save raw bytes to a new private file | Gated download | [Downloads](docs/downloads.md) |

Run `beyondtrust-axi <command> --help` for flags and examples.
The [design](docs/design.md) records planned API behavior and B1-B13 slices.
Local commands never contact BeyondTrust; doctor, about, task status and the resource commands explicitly make API requests.
Offline tests do not establish live compatibility.
Token lifetime and the documented rate limit remain unverified until commissioning through artium-axi.

```sh
node bin/beyondtrust-axi.js doctor
node bin/beyondtrust-axi.js about
node bin/beyondtrust-axi.js task status --id <uuid>
```

Only use an actual task ID with task status; undocumented write result UUIDs are not assumed to be task IDs.
About reads accept either a version object or the export's array shape; about returns versions as an array in either case.

Resource lists default to 50 rows; use --limit 1-1000 or --all for up to 1000 rows.
Paged API requests use at most 200 rows per page, with computers sorted by created date ascending to reduce duplicates.
Filters map to the committed API parameters; run each command with --help for the available filter flags.
Array filter values are comma-separated; date filters require matching dates and selection mode.
For commands supporting --sort property:asc or property:desc, see the [command reference](docs/commands.md) for each default.
SCIM user and role lists accept literal --filter expressions and translate bounded reads to startIndex/count pagination.
Use scim resource-types user or scim resource-types role for resource-type detail; omit the type for the list.
Use scim role list, scim user list and scim user show for SCIM roles and users.
For server-supplied credential handling, see [Safety](#safety).
Event windows default to the last 24 hours and accept at most 31 days, using UTC --since and event search --until timestamps.
Event search requires --os as documented by the export, and supports group, action, code, type, application, host, domain, user and policy filters.
Events default to time, host, user, action, code, application and rule columns; --full returns complete redacted ECS objects.
Event total is null because totalRecordsReturned counts only the returned page; a full search page offers a cursor until an incomplete or empty page is read.
Event list fetches at most 1000 records with RecordSize and applies row limits and cursor offsets locally; the endpoint has no server pagination or end-time parameter.
Event list requires --since within the last 31 days; use event search for historical windows, explicit end times and server pagination.
Audit show IDs are decimal int64 identifiers; admin-request show takes a UUID and auth-request show takes an opaque system identifier via --id.
Audit show endpoints return documented paged envelopes without request paging parameters, so their returned rows are bounded locally.
Every list returns data, count, total and cursor, including audit show and auth-request show; object detail reads return data.
When cursor is non-null, repeat the command with --cursor <cursor>, retaining the same configuration, profile, account, resource ID, filters and sort.
Cursors encode positions, a context digest and, for events, frozen window timestamps; they contain no credentials and are not authorization tokens or a server snapshot.
Unpaged lists, including roles, domains, API accounts and SCIM discovery, apply row limits client-side and fetch the response again when resumed, so changes to the source may move rows.
The shared request, time or byte budget can return a partial list with a cursor after at least one completed page; other failures remain errors.
The export omits success schemas for group detail, policy detail and computer command logs; these commands validate the JSON container and preserve its fields.
Response validation accepts null errorInfo fields and optional object references even when the export omits nullable.
Auth-request list accepts both the export's array and a paged envelope containing pageNumber, pageSize, totalRecordCount, pageCount and data; envelopes retain totals and support page cursors.
For modeled responses, schemas marked additionalProperties:false reject unexpected fields with API_RESPONSE_INVALID, including differently cased property names.
The export's Policy Editor application-group examples use PascalCase keys that conflict with its camelCase schemas; responses matching those examples are rejected.

## Safety

Secrets use env/file SecretRefs, never inline config or argv; output redacts secret-derived strings before truncation.
Read responses omit password properties and documented audit integration credential fields, including with --full.
Credential values discovered in those fields or URL passwords, including percent-encoded passwords, are redacted wherever repeated in the validated response before row selection, event projection and truncation.
Hosts must be lowercase DNS names ending .beyondtrustcloud.com, without scheme, port, path, userinfo or IP; origins are HTTPS only.
TLS certificate verification is always enabled and redirects are refused.
Tokens stay in memory for one command, using OAuth2 client credentials with form-encoded `grant_type=client_credentials`, `client_id`, `client_secret` and the fixed Management API `scope=urn:management:api`.
Reads share a budget of 10 requests including authentication and 60 seconds; JSON responses share an 8 MiB cap.
Downloads require a named file profile with downloads.allow enabled and a new --out path.
They stream raw bytes without parsing or printing the body, with a separate 50 MiB content cap and the same request and time budgets.
The destination is created exclusively with mode 0600 on POSIX; existing files and symlinks are refused.
For failure cleanup, Windows file protections and platform verification limits, see [Downloads](docs/downloads.md).
Success reports path, size in bytes, sha256 and contentType.
The three resource downloads take a positional UUID; api-definition download needs only --out.
One token re-exchange is permitted on read 401 or within 30 seconds of expiry.
Read 429 retries at most twice, honoring valid Retry-After delays up to 10 seconds and refusing longer or malformed values; a missing header uses one second.
Token exchanges are not retried.
Non-success HTTP responses are handled from status and headers without waiting for or parsing their bodies.
Environment profiles cannot enable writes, deletes or downloads.
File profile permissions default to deny: downloads.allow, writes.allowWrites and writes.allowDeletes are false, with an empty operation list.
BEYONDTRUST_AXI_READ_ONLY=1 or true overrides write permissions; invalid values fail closed.
Computer writes require a named file profile with writes.allowWrites and the exact operation in its operations list, for example `computer.authorise`.
They validate locally, re-read the targets and preview by default; preview makes no mutation and creates no journal.
Repeat the command with --execute and the exact --confirm phrase to persist a private durable intent and send once.
Authorise accepts the same filter flags as computer list instead of IDs, for example --host example or --group-id <uuid>; --group <uuid> selects the destination group.
Filter previews count matching computers and show the first 20 hosts, with no maximum count.
Confirmation binds the count, filter fields and destination group; the server re-applies filters when executing, so membership can change after the count.
Unfiltered all-computer selections are refused; reject, archive and unarchive accept only IDs, and logs/details request require exactly one ID.
Explicit selections accept at most 20 distinct UUIDs; write preparation allows up to 26 total requests to accommodate 20 target re-reads, an optional group re-read, authentication and bounded read recovery, within the same 60 seconds and 8 MiB.
Group writes require the exact group operation in the file profile and use the same preview, confirmation and durable intent gates.
Group update previews the diff and preserves fields not supplied; clear-policy names the policy that endpoints lose.
Add-computers and remove-computers also accept computer-list filters with counted, unbounded selections.
Remove-computers changes only group membership; the computers remain and this operation does not require delete permission.
Import-computers accepts a non-empty UTF-8 CSV file without NUL bytes up to 10 MiB, binds its SHA-256 into confirmation and sends its captured bytes as multipart csvFile; see the [file protection requirements](docs/configuration.md).
Group confirmations bind the intended change and re-read state of existing target groups, so a changed target group or input file requires a new preview.
Create reads the group collection filtered by the requested name because it has no existing target group.
Policy writes use the same gates with exact operation names derived by replacing command spaces with dots.
Policy and application-addition files follow the [file protection requirements](docs/configuration.md).
Create and upload capture a secure non-empty policy file up to 10 MiB and bind its SHA-256 into confirmation; the journal records size and digest, and the multipart request sends the captured bytes unchanged under PolicyFile with a fixed filename, including UTF-16 XML.
Policy update preserves omitted name or description fields and previews the diff.
Auto-assign requires a revision belonging to the policy and binds its revision and assigned-group re-reads into confirmation; upload --auto-assign also previews assigned groups.
App add requires --os windows|macos, --app-group and --file containing a non-empty UTF-8 JSON array of application payloads using the committed export's lowercase field names, for example `[{"type":"exe","description":"example","fileName":{"matchType":"Exact","value":"<executable-name>"}}]` for Windows.
Application types and matcher schemas are validated locally; unsupported Windows matchers and any unknown fields or delete payloads are refused.
The app request wraps these additions in the documented applicationData envelope for the selected group, and binds the file digest, policy and application-group re-reads into confirmation.
No mutation is retried or reauthenticated, including 401 or 429 responses.
Identity writes use the same gates and positional target UUIDs; creation reads the corresponding collection before preview or send.
User and SCIM payloads come from secure UTF-8 JSON files up to 10 MiB and must match the committed request schemas, including their lowercase property names.
For example, user assign-roles accepts `{"globalRolesIds":["<role-uuid>"]}` and scim user patch accepts `{"operations":[{"op":"replace","path":"active","value":[{"valueBoolean":false}]}]}`.
File digests and re-read state are bound into confirmation; SCIM passwords are redacted from previews, results and durable intent.
User create previews the roles and admin flag; resend-invite warns that it sends email, and SCIM deactivation warns that it deactivates the user.
The operation for user preferences set is `user.preferences`; other identity operation names replace command spaces with dots.
JIT and integration writes use exact operations `admin-request.create`, `admin-request.decide`, `auth-request.notify` and `app-switcher.connect`.
Admin-request create requires --computer and --user, with only optional --decision approve paired with --by; creation-time denial is not supported.
A pre-approved request grants admin rights, and the preview warns about this effect.
Admin-request decide takes a request UUID, --decision approve|deny and --by, with optional --duration in seconds and --message.
Notification files require all ten documented fields; connector files follow AppSwitcherRequest in the committed export.
Both files use the same private file checks, 10 MiB limit and SHA-256 confirmation binding as other JSON writes.
JIT commands re-read the computer or request; App Switcher has no connector read endpoint in the export, so it checks About access and warns that existing connector state cannot be re-read.
Domain create takes a domain argument, and domain update takes a UUID followed by the new domain; both send the documented domainName property.
The journal stores an auditId, operation, time and redacted request in a new private file under the state directory's writes subdirectory.
Journal contents are flushed before sending; POSIX also flushes the directory, and Windows uses the existing handle-bound protected-file writer.
On OUTCOME_UNKNOWN, reconcile remote state using the returned auditId before any further action; never replay an ambiguous write.
Deletes additionally require writes.allowDeletes and exact --confirm-delete.
See the [command overview](#what-it-covers) for delete commands.
Preview returns confirmation and deleteConfirmation; execution requires both --confirm and --confirm-delete exactly as returned after re-reading current targets.
Policy delete previews assigned groups; --force additionally requires the policy.delete.force operation.
Policy app remove accepts a policy UUID, --os windows|macos, --app-group and 1-20 application UUIDs, verifies group membership and sends only the documented delete array.
Computer delete and deactivate support explicit UUIDs or computer-list filters with a count-bearing confirmation and no maximum filter count.
Deactivate archives and deletes computers; discard-draft irreversibly loses policy draft changes.
The owner commissions the complete build through artium-axi afterwards.

## Configuration

No command writes configuration or discovers it from the current directory.
Run beyondtrust-axi config path to locate the effective paths.

| Platform | Config | State |
|---|---|---|
| Linux/macOS | ~/.config/beyondtrust-axi/config.json | ~/.local/state/beyondtrust-axi |
| Windows | APPDATA/beyondtrust-axi/config.json | LOCALAPPDATA/beyondtrust-axi |

Config precedence is --config, BEYONDTRUST_AXI_CONFIG, then platform path.
Profile precedence is --profile, BEYONDTRUST_AXI_PROFILE, complete environment profile, config defaultProfile, then sole file profile.
The [configuration guide](docs/configuration.md) lists every environment variable, SecretRef format and file protection requirement.
The [credential schema](axi-credential.schema.json) describes host, clientId, clientSecret, downloads and write permissions for integration consumers.

## Output and exit codes

All data, errors and next-step hints use TOON on stdout.
Strings truncate at 500 characters by default except for write previews, confirmations and results, and [download success metadata](docs/downloads.md); --full restores complete strings and --fields selects top-level fields.
Bare --version, -v and -V print the package version without loading the command graph.

| Exit | Meaning |
|---|---|
| 0 | Success |
| 1 | Configuration, credential, transport or API error |
| 2 | Invalid command, argument or flag |

## Troubleshooting

| Code | Action |
|---|---|
| PROFILE_REQUIRED | Configure a complete environment profile or named file profile. |
| PROFILE_AMBIGUOUS | Pass --profile or set defaultProfile. |
| CONFIG_INVALID | Check host, unknown fields, SecretRefs and complete env metadata. |
| CONFIG_INSECURE | Apply the private file protections in the configuration guide. |
| AUTH_REQUIRED | Supply the selected secret source; never put it in argv. |
| AUTH_ENDPOINT_NOT_FOUND | Check the configured host against the documented -services form; the tool never changes hosts. |
| AUTH_FAILED | Check API account credentials and secret rotation. |
| API_FORBIDDEN | Check API account permissions. |
| REDIRECT_REFUSED | Verify the configured host; redirects are never followed. |
| RATE_LIMITED | Retry later; automatic read retries are bounded. |
| LIMIT_EXCEEDED | Reduce the selection or run the command again. |
| TRANSPORT_ERROR | Check HTTPS connectivity and the configured host. |
| API_RESPONSE_INVALID, AUTH_RESPONSE_INVALID | Check API compatibility with the committed export using the bounded response diagnostics. |
| DOWNLOADS_DISABLED | Enable downloads.allow in a named file profile. |
| DOWNLOAD_FILE_ERROR | Check destination permissions and free space; follow [partial-file cleanup guidance](docs/downloads.md) before retrying with a new --out path. |
| WRITES_DISABLED | Check forced read-only, named file profile permission and the exact operation allow-list. |
| CONFIRMATION_REQUIRED | Preview again and copy the exact confirmation after checking the targets and count. |
| DELETES_DISABLED | Enable writes.allowDeletes in a named file profile with the exact delete operation allowed. |
| DELETE_CONFIRM_REQUIRED | Preview again and copy deleteConfirmation exactly into --confirm-delete. |
| JOURNAL_ERROR | Repair private state directory permissions or storage; no write was sent. |
| OUTCOME_UNKNOWN | Use auditId to reconcile remote state; do not replay the request. |
| VALIDATION_ERROR | Follow the returned valid command/flag list. |

API and token response validation failures include structured diagnostics beside the stable error message.
See the [response diagnostics contract](docs/response-diagnostics.md) for HTTP metadata, sampled response shapes, issue-level received and expected types, key redaction and truncation limits.
Use this evidence to investigate compatibility; it does not establish the cause of a live mismatch.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for offline checks and release mechanics, and [AGENTS.md](AGENTS.md) for repository boundaries.

## Security

Report vulnerabilities privately using the repository's GitHub security advisory reporting if enabled, or contact the maintainer privately.
Never post credentials or tenant responses in an issue.

## License

[MIT](LICENSE), knowttl and beyondtrust-axi contributors.
