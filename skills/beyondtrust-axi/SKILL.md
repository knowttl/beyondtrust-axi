---
name: beyondtrust-axi
description: Inspect BeyondTrust PM Cloud Endpoint Privilege Management profiles, API readiness, computers, groups, policies, versions and task status.
---

# BeyondTrust AXI

Inspect BeyondTrust PM Cloud Endpoint Privilege Management through guarded AXI commands.

B2 supports local discovery, doctor, about and task status.
B3 supports 12 bounded computer, group and policy reads, including Windows and macOS application groups.
Lists default to 50 rows; --all caps at 1000 rows within shared request, time and byte budgets.
Resume a non-null cursor with the same profile, command, ID, filters and sort.
Use a configured session hook for ambient local context or this skill for on-demand guidance.
The 0.0.0 scaffold is unpublished; use a built checkout until release.
Never put secrets in argv or contact a live tenant during automated verification.
Token lifetime, rate limits and live compatibility remain unverified until commissioning through artium-axi.

## home

Show local context without resolving secrets or making API calls.

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |

```sh
npx -y @knowttl/beyondtrust-axi
npx -y @knowttl/beyondtrust-axi home --profile <name>
```

## auth status

Validate local credential readiness without API calls.

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |

```sh
npx -y @knowttl/beyondtrust-axi auth status
npx -y @knowttl/beyondtrust-axi auth status --profile <name>
```

## profile list

List named file profiles without resolving secrets.

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |

```sh
npx -y @knowttl/beyondtrust-axi profile list
npx -y @knowttl/beyondtrust-axi profile list --config <path>
```

## config path

Show effective configuration and state paths.

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |

```sh
npx -y @knowttl/beyondtrust-axi config path
npx -y @knowttl/beyondtrust-axi config path --config <path>
```

## doctor

Verify credentials and API access with a bounded About read.

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |

```sh
npx -y @knowttl/beyondtrust-axi doctor
npx -y @knowttl/beyondtrust-axi doctor --profile <name>
```

## about

Read API versions (GET /v3/About).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |

```sh
npx -y @knowttl/beyondtrust-axi about
npx -y @knowttl/beyondtrust-axi about --profile <name>
```

## task status

Read task detail (GET /v3/Tasks/{id}); a write result is not assumed to be a task ID.

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --id | Required task UUID |

```sh
npx -y @knowttl/beyondtrust-axi task status --id <uuid>
npx -y @knowttl/beyondtrust-axi task status --id <uuid> --fields task
```

## computer list

Read computer list (GET /v3/Computers).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --limit | Maximum rows, 1-1000 (default: 50) |
| --all | Read up to 1000 rows within 10 requests, 60 seconds and 8 MiB |
| --cursor | Resume an opaque cursor with the same profile, command and filters |
| --computer-id | Filter ComputerId (string) |
| --host | Filter Host (string) |
| --host-type | Filter HostType (Undefined|MicrosoftWindows|AppleMacOS|Linux) |
| --agent-version | Filter AgentVersion (string) |
| --adapter-version | Filter AdapterVersion (string) |
| --package-manager-version | Filter PackageManagerVersion (string) |
| --authorisation-state | Filter AuthorisationState (string) |
| --last-connected-dates | Filter LastConnected Dates (array; comma-separated) |
| --last-connected-selection-mode | Filter LastConnected SelectionMode (Single|Multiple|Range) |
| --policy-revision-status | Filter PolicyRevisionStatus (string) |
| --policy-id | Filter PolicyId (string) |
| --policy-name | Filter PolicyName (string) |
| --host-policy-name | Filter HostPolicyName (string) |
| --group-id | Filter GroupId (string) |
| --group-name | Filter GroupName (string) |
| --os | Filter OS (Windows|Mac) |
| --domain | Filter Domain (string) |
| --created-dates | Filter Created Dates (array; comma-separated) |
| --created-selection-mode | Filter Created SelectionMode (Single|Multiple|Range) |
| --duplicate-count-min | Filter DuplicateCount Min (integer) |
| --duplicate-count-max | Filter DuplicateCount Max (integer) |
| --connection-status | Filter ConnectionStatus (array; comma-separated) |
| --days-disconnected | Filter DaysDisconnected (integer) |
| --days-since-archived | Filter DaysSinceArchived (integer) |

```sh
npx -y @knowttl/beyondtrust-axi computer list
npx -y @knowttl/beyondtrust-axi computer list --help
```

## computer view

Read computer view (GET /v3/Computers/{id}).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --id | Required resource UUID |

```sh
npx -y @knowttl/beyondtrust-axi computer view --id <uuid>
npx -y @knowttl/beyondtrust-axi computer view --help
```

## computer command-log

Read computer command log (GET /v3/Computers/{id}/CommandLog).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --id | Required resource UUID |
| --limit | Maximum rows, 1-1000 (default: 50) |
| --all | Read up to 1000 rows within 10 requests, 60 seconds and 8 MiB |
| --cursor | Resume an opaque cursor with the same profile, command and filters |

```sh
npx -y @knowttl/beyondtrust-axi computer command-log --id <uuid>
npx -y @knowttl/beyondtrust-axi computer command-log --help
```

## computer logs

Read computer logs (GET /v3/Computers/{id}/Logs).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --id | Required resource UUID |
| --limit | Maximum rows, 1-1000 (default: 50) |
| --all | Read up to 1000 rows within 10 requests, 60 seconds and 8 MiB |
| --cursor | Resume an opaque cursor with the same profile, command and filters |

```sh
npx -y @knowttl/beyondtrust-axi computer logs --id <uuid>
npx -y @knowttl/beyondtrust-axi computer logs --help
```

## group list

Read group list (GET /v3/Groups).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --limit | Maximum rows, 1-1000 (default: 50) |
| --all | Read up to 1000 rows within 10 requests, 60 seconds and 8 MiB |
| --cursor | Resume an opaque cursor with the same profile, command and filters |
| --sort | Sort property and order, e.g. name:asc (default: created:asc) |
| --id | Filter Id (string) |
| --name | Filter Name (string) |
| --description | Filter Description (string) |
| --policy-name | Filter PolicyName (string) |
| --policy-revision-status | Filter PolicyRevisionStatus (OnAssignedPolicy|AwaitingPolicyUpdate|NoPolicy) |
| --computer-count | Filter ComputerCount (integer) |
| --active-computers-value | Filter ActiveComputers Value (integer) |
| --active-computers-operator | Filter ActiveComputers Operator (EqualTo|LessThan|GreaterThan|LessThanOrEqualTo|GreaterThanOrEqualTo) |
| --created-dates | Filter Created Dates (array; comma-separated) |
| --created-selection-mode | Filter Created SelectionMode (Single|Multiple|Range) |
| --default | Filter Default (boolean) |

```sh
npx -y @knowttl/beyondtrust-axi group list
npx -y @knowttl/beyondtrust-axi group list --help
```

## group view

Read group view (GET /v3/Groups/{id}).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --id | Required resource UUID |

```sh
npx -y @knowttl/beyondtrust-axi group view --id <uuid>
npx -y @knowttl/beyondtrust-axi group view --help
```

## policy list

Read policy list (GET /v3/Policies).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --limit | Maximum rows, 1-1000 (default: 50) |
| --all | Read up to 1000 rows within 10 requests, 60 seconds and 8 MiB |
| --cursor | Resume an opaque cursor with the same profile, command and filters |
| --sort | Sort property and order, e.g. name:asc (default: created:asc) |
| --name | Filter Name (string) |
| --size | Filter Size (integer) |
| --revision | Filter Revision (integer) |
| --total-assigned-revisions | Filter TotalAssignedRevisions (integer) |
| --created-dates | Filter Created Dates (array; comma-separated) |
| --created-selection-mode | Filter Created SelectionMode (Single|Multiple|Range) |
| --draft-user | Filter DraftUser (string) |

```sh
npx -y @knowttl/beyondtrust-axi policy list
npx -y @knowttl/beyondtrust-axi policy list --help
```

## policy view

Read policy view (GET /v3/Policies/{id}).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --id | Required resource UUID |

```sh
npx -y @knowttl/beyondtrust-axi policy view --id <uuid>
npx -y @knowttl/beyondtrust-axi policy view --help
```

## policy revisions

Read policy revisions (GET /v3/Policies/{id}/Revisions).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --id | Required resource UUID |
| --limit | Maximum rows, 1-1000 (default: 50) |
| --all | Read up to 1000 rows within 10 requests, 60 seconds and 8 MiB |
| --cursor | Resume an opaque cursor with the same profile, command and filters |

```sh
npx -y @knowttl/beyondtrust-axi policy revisions --id <uuid>
npx -y @knowttl/beyondtrust-axi policy revisions --help
```

## policy assigned-groups

Read policy assigned groups (GET /v3/Policies/{id}/AssignedGroups).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --id | Required resource UUID |
| --limit | Maximum rows, 1-1000 (default: 50) |
| --all | Read up to 1000 rows within 10 requests, 60 seconds and 8 MiB |
| --cursor | Resume an opaque cursor with the same profile, command and filters |

```sh
npx -y @knowttl/beyondtrust-axi policy assigned-groups --id <uuid>
npx -y @knowttl/beyondtrust-axi policy assigned-groups --help
```

## policy windows-application-groups

Read policy windows application groups (GET /PolicyEditor/v3/Policy/{policyId}/Windows/ApplicationGroups).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --id | Required resource UUID |
| --limit | Maximum rows, 1-1000 (default: 50) |
| --all | Read up to 1000 rows within 10 requests, 60 seconds and 8 MiB |
| --cursor | Resume an opaque cursor with the same profile, command and filters |
| --application-group-name | Filter ApplicationGroupName (string) |
| --application-group-id | Filter ApplicationGroupId (string) |
| --application-description | Filter ApplicationDescription (string) |
| --application-id | Filter ApplicationId (string) |

```sh
npx -y @knowttl/beyondtrust-axi policy windows-application-groups --id <uuid>
npx -y @knowttl/beyondtrust-axi policy windows-application-groups --help
```

## policy macos-application-groups

Read policy macos application groups (GET /PolicyEditor/v3/Policy/{policyId}/MacOS/ApplicationGroups).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --id | Required resource UUID |
| --limit | Maximum rows, 1-1000 (default: 50) |
| --all | Read up to 1000 rows within 10 requests, 60 seconds and 8 MiB |
| --cursor | Resume an opaque cursor with the same profile, command and filters |
| --application-group-name | Filter ApplicationGroupName (string) |
| --application-group-id | Filter ApplicationGroupId (string) |
| --application-description | Filter ApplicationDescription (string) |
| --application-id | Filter ApplicationId (string) |

```sh
npx -y @knowttl/beyondtrust-axi policy macos-application-groups --id <uuid>
npx -y @knowttl/beyondtrust-axi policy macos-application-groups --help
```

## user list

Read user list (GET /v3/Users).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --limit | Maximum rows, 1-1000 (default: 50) |
| --all | Read up to 1000 rows within 10 requests, 60 seconds and 8 MiB |
| --cursor | Resume an opaque cursor with the same profile, command and filters |
| --sort | Sort property and order, e.g. name:asc (default: created:asc) |
| --email-address | Filter EmailAddress (string) |
| --role-id | Filter RoleId (string) |
| --permission-id | Filter PermissionId (string) |
| --last-signed-in-dates | Filter LastSignedIn Dates (array; comma-separated) |
| --last-signed-in-selection-mode | Filter LastSignedIn SelectionMode (Single|Multiple|Range) |
| --disabled | Filter Disabled (boolean) |
| --language | Filter Language (string) |

```sh
npx -y @knowttl/beyondtrust-axi user list
npx -y @knowttl/beyondtrust-axi user list --help
```

## user show

Read user show (GET /v3/Users/{id}).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --id | Required resource UUID |

```sh
npx -y @knowttl/beyondtrust-axi user show --id <uuid>
npx -y @knowttl/beyondtrust-axi user show --help
```

## role list

Read role list (GET /v3/Roles).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --limit | Maximum rows, 1-1000 (default: 50) |
| --all | Read up to 1000 rows within 10 requests, 60 seconds and 8 MiB |
| --cursor | Resume an opaque cursor with the same profile, command and filters |

```sh
npx -y @knowttl/beyondtrust-axi role list
npx -y @knowttl/beyondtrust-axi role list --help
```

## role show

Read role show (GET /v3/Roles/{id}).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --id | Required resource UUID |

```sh
npx -y @knowttl/beyondtrust-axi role show --id <uuid>
npx -y @knowttl/beyondtrust-axi role show --help
```

## global-role list

Read global role list (GET /v3/GlobalRoles).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --limit | Maximum rows, 1-1000 (default: 50) |
| --all | Read up to 1000 rows within 10 requests, 60 seconds and 8 MiB |
| --cursor | Resume an opaque cursor with the same profile, command and filters |
| --sort | Sort property and order, e.g. name:asc (default: created:asc) |
| --id | Filter Id (string) |
| --name | Filter Name (string) |
| --description | Filter Description (string) |
| --is-built-in | Filter IsBuiltIn (boolean) |

```sh
npx -y @knowttl/beyondtrust-axi global-role list
npx -y @knowttl/beyondtrust-axi global-role list --help
```

## global-role show

Read global role show (GET /v3/GlobalRoles/{id}).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --id | Required resource UUID |

```sh
npx -y @knowttl/beyondtrust-axi global-role show --id <uuid>
npx -y @knowttl/beyondtrust-axi global-role show --help
```

## domain list

Read domain list (GET /v3/AcceptedDomains).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --limit | Maximum rows, 1-1000 (default: 50) |
| --all | Read up to 1000 rows within 10 requests, 60 seconds and 8 MiB |
| --cursor | Resume an opaque cursor with the same profile, command and filters |

```sh
npx -y @knowttl/beyondtrust-axi domain list
npx -y @knowttl/beyondtrust-axi domain list --help
```

## domain show

Read domain show (GET /v3/AcceptedDomains/{id}).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --id | Required resource UUID |

```sh
npx -y @knowttl/beyondtrust-axi domain show --id <uuid>
npx -y @knowttl/beyondtrust-axi domain show --help
```

## api-account list

Read api account list (GET /v3/ApiAccounts).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --limit | Maximum rows, 1-1000 (default: 50) |
| --all | Read up to 1000 rows within 10 requests, 60 seconds and 8 MiB |
| --cursor | Resume an opaque cursor with the same profile, command and filters |

```sh
npx -y @knowttl/beyondtrust-axi api-account list
npx -y @knowttl/beyondtrust-axi api-account list --help
```

## auth-provider show

Read auth provider show (GET /v3/AuthenticationProvider).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |

```sh
npx -y @knowttl/beyondtrust-axi auth-provider show
npx -y @knowttl/beyondtrust-axi auth-provider show --help
```

## scim resource-types

Read scim resource types (GET /scim/v3/ResourceTypes[/User|/Role]).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --limit | Maximum rows, 1-1000 (default: 50) |
| --all | Read up to 1000 rows within 10 requests, 60 seconds and 8 MiB |
| --cursor | Resume an opaque cursor with the same profile, command and filters |
| --type | Resource type detail: user|role (default: list all resource types) |

```sh
npx -y @knowttl/beyondtrust-axi scim resource-types
npx -y @knowttl/beyondtrust-axi scim resource-types --help
```

## scim schemas

Read scim schemas (GET /scim/v3/Schemas).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --limit | Maximum rows, 1-1000 (default: 50) |
| --all | Read up to 1000 rows within 10 requests, 60 seconds and 8 MiB |
| --cursor | Resume an opaque cursor with the same profile, command and filters |

```sh
npx -y @knowttl/beyondtrust-axi scim schemas
npx -y @knowttl/beyondtrust-axi scim schemas --help
```

## scim config

Read scim config (GET /scim/v3/ServiceProviderConfig).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |

```sh
npx -y @knowttl/beyondtrust-axi scim config
npx -y @knowttl/beyondtrust-axi scim config --help
```

## scim-role list

Read scim role list (GET /scim/v3/Roles).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --limit | Maximum rows, 1-1000 (default: 50) |
| --all | Read up to 1000 rows within 10 requests, 60 seconds and 8 MiB |
| --cursor | Resume an opaque cursor with the same profile, command and filters |
| --filter | SCIM filter expression (sent literally) |

```sh
npx -y @knowttl/beyondtrust-axi scim-role list
npx -y @knowttl/beyondtrust-axi scim-role list --help
```

## scim-user list

Read scim user list (GET /scim/v3/users).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --limit | Maximum rows, 1-1000 (default: 50) |
| --all | Read up to 1000 rows within 10 requests, 60 seconds and 8 MiB |
| --cursor | Resume an opaque cursor with the same profile, command and filters |
| --filter | SCIM filter expression (sent literally) |

```sh
npx -y @knowttl/beyondtrust-axi scim-user list
npx -y @knowttl/beyondtrust-axi scim-user list --help
```

## scim-user show

Read scim user show (GET /scim/v3/users/{userID}).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --id | Required resource UUID |

```sh
npx -y @knowttl/beyondtrust-axi scim-user show --id <uuid>
npx -y @knowttl/beyondtrust-axi scim-user show --help
```
