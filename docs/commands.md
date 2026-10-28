# Commands

Inspect BeyondTrust PM Cloud Endpoint Privilege Management through guarded AXI commands.

B2 adds doctor, about and task status API reads.
B3 adds bounded computer, group and policy reads.
Local discovery commands remain offline.
Lists default to 50 rows; --all caps at 1000 rows within shared request, time and byte budgets.
Resume a non-null cursor with the same profile, command, ID, filters and sort.

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
beyondtrust-axi
beyondtrust-axi home --profile <name>
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
beyondtrust-axi auth status
beyondtrust-axi auth status --profile <name>
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
beyondtrust-axi profile list
beyondtrust-axi profile list --config <path>
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
beyondtrust-axi config path
beyondtrust-axi config path --config <path>
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
beyondtrust-axi doctor
beyondtrust-axi doctor --profile <name>
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
beyondtrust-axi about
beyondtrust-axi about --profile <name>
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
beyondtrust-axi task status --id <uuid>
beyondtrust-axi task status --id <uuid> --fields task
```

## computer authorise

Preview computer authorise; provide 1-20 explicit computer UUIDs or a non-empty computer-list filter selection; filter preview counts matches and shows the first 20 hosts with no maximum count; filter execution requires exact count-bearing confirmation; POST /v3/Computers/Authorise; requires file-profile permission for computer.authorise; sends once without retries.

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --execute | Send after re-read, exact confirmation and durable private intent |
| --confirm | Exact confirmation from preview; re-read must still match |
| --group | Optional target group UUID |
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
beyondtrust-axi computer authorise <uuid>
beyondtrust-axi computer authorise <uuid> --execute --confirm '<exact confirmation>'
beyondtrust-axi computer authorise --host example
```

## computer reject

Preview computer reject; positional computer UUIDs required (maximum 20); POST /v3/Computers/Reject; requires file-profile permission for computer.reject; sends once without retries.

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --execute | Send after re-read, exact confirmation and durable private intent |
| --confirm | Exact confirmation from preview; re-read must still match |

```sh
beyondtrust-axi computer reject <uuid>
beyondtrust-axi computer reject <uuid> --execute --confirm '<exact confirmation>'
```

## computer archive

Preview computer archive; positional computer UUIDs required (maximum 20); POST /v3/Computers/{computerId}/archive or /v3/Computers/archive; requires file-profile permission for computer.archive; sends once without retries.

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --execute | Send after re-read, exact confirmation and durable private intent |
| --confirm | Exact confirmation from preview; re-read must still match |

```sh
beyondtrust-axi computer archive <uuid>
beyondtrust-axi computer archive <uuid> --execute --confirm '<exact confirmation>'
```

## computer unarchive

Preview computer unarchive; positional computer UUIDs required (maximum 20); POST /v3/Computers/{computerId}/Unarchive or /v3/Computers/Unarchive; requires file-profile permission for computer.unarchive; sends once without retries.

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --execute | Send after re-read, exact confirmation and durable private intent |
| --confirm | Exact confirmation from preview; re-read must still match |

```sh
beyondtrust-axi computer unarchive <uuid>
beyondtrust-axi computer unarchive <uuid> --execute --confirm '<exact confirmation>'
```

## computer logs request

Preview computer logs request; positional computer UUIDs required (maximum 1); POST /v3/Computers/Logs/Request; requires file-profile permission for computer.logs.request; sends once without retries.

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --execute | Send after re-read, exact confirmation and durable private intent |
| --confirm | Exact confirmation from preview; re-read must still match |

```sh
beyondtrust-axi computer logs request <uuid>
beyondtrust-axi computer logs request <uuid> --execute --confirm '<exact confirmation>'
```

## computer details request

Preview computer details request; positional computer UUIDs required (maximum 1); POST /v3/Computers/Details/Request; requires file-profile permission for computer.details.request; sends once without retries.

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --execute | Send after re-read, exact confirmation and durable private intent |
| --confirm | Exact confirmation from preview; re-read must still match |

```sh
beyondtrust-axi computer details request <uuid>
beyondtrust-axi computer details request <uuid> --execute --confirm '<exact confirmation>'
```

## computer log download

Download raw bytes (GET /v3/Computers/Logs/{id}/Content); requires file-profile downloads.allow; new 0600 file only, maximum 50 MiB.

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --out | Required new destination file; never overwritten |

```sh
beyondtrust-axi computer log download <uuid> --out <file>
beyondtrust-axi computer log download --help
```

## policy download

Download raw bytes (GET /v3/Policies/{id}/Content); requires file-profile downloads.allow; new 0600 file only, maximum 50 MiB.

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --out | Required new destination file; never overwritten |

```sh
beyondtrust-axi policy download <uuid> --out <file>
beyondtrust-axi policy download --help
```

## policy revision download

Download raw bytes (GET /v3/Policies/PolicyRevision/{policyRevisionId}/Content); requires file-profile downloads.allow; new 0600 file only, maximum 50 MiB.

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --out | Required new destination file; never overwritten |

```sh
beyondtrust-axi policy revision download <uuid> --out <file>
beyondtrust-axi policy revision download --help
```

## api-definition download

Download raw bytes (GET /v3/File/download/GetYamlApiDefinitionFile); requires file-profile downloads.allow; new 0600 file only, maximum 50 MiB.

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --out | Required new destination file; never overwritten |

```sh
beyondtrust-axi api-definition download --out <file>
beyondtrust-axi api-definition download --help
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
beyondtrust-axi computer list
beyondtrust-axi computer list --help
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
beyondtrust-axi computer view --id <uuid>
beyondtrust-axi computer view --help
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
beyondtrust-axi computer command-log --id <uuid>
beyondtrust-axi computer command-log --help
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
beyondtrust-axi computer logs --id <uuid>
beyondtrust-axi computer logs --help
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
beyondtrust-axi group list
beyondtrust-axi group list --help
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
beyondtrust-axi group view --id <uuid>
beyondtrust-axi group view --help
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
beyondtrust-axi policy list
beyondtrust-axi policy list --help
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
beyondtrust-axi policy view --id <uuid>
beyondtrust-axi policy view --help
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
beyondtrust-axi policy revisions --id <uuid>
beyondtrust-axi policy revisions --help
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
beyondtrust-axi policy assigned-groups --id <uuid>
beyondtrust-axi policy assigned-groups --help
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
beyondtrust-axi policy windows-application-groups --id <uuid>
beyondtrust-axi policy windows-application-groups --help
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
beyondtrust-axi policy macos-application-groups --id <uuid>
beyondtrust-axi policy macos-application-groups --help
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
beyondtrust-axi user list
beyondtrust-axi user list --help
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
beyondtrust-axi user show --id <uuid>
beyondtrust-axi user show --help
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
beyondtrust-axi role list
beyondtrust-axi role list --help
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
beyondtrust-axi role show --id <uuid>
beyondtrust-axi role show --help
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
beyondtrust-axi global-role list
beyondtrust-axi global-role list --help
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
beyondtrust-axi global-role show --id <uuid>
beyondtrust-axi global-role show --help
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
beyondtrust-axi domain list
beyondtrust-axi domain list --help
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
beyondtrust-axi domain show --id <uuid>
beyondtrust-axi domain show --help
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
beyondtrust-axi api-account list
beyondtrust-axi api-account list --help
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
beyondtrust-axi auth-provider show
beyondtrust-axi auth-provider show --help
```

## scim resource-types

Read scim resource types; optional positional type: user|role (default: list all resource types) (GET /scim/v3/ResourceTypes[/User|/Role]).

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
beyondtrust-axi scim resource-types
beyondtrust-axi scim resource-types user
beyondtrust-axi scim resource-types role
beyondtrust-axi scim resource-types --help
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
beyondtrust-axi scim schemas
beyondtrust-axi scim schemas --help
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
beyondtrust-axi scim config
beyondtrust-axi scim config --help
```

## scim role list

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
beyondtrust-axi scim role list
beyondtrust-axi scim role list --help
```

## scim user list

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
beyondtrust-axi scim user list
beyondtrust-axi scim user list --help
```

## scim user show

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
beyondtrust-axi scim user show --id <uuid>
beyondtrust-axi scim user show --help
```

## event list

Read event list (GET /v3/Events/FromStartDate).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete redacted ECS event objects instead of compact columns |
| --help | Show command help |
| --limit | Maximum rows, 1-1000 (default: 50) |
| --all | Read up to 1000 rows within 10 requests, 60 seconds and 8 MiB |
| --cursor | Resume an opaque cursor with the same profile, command and filters |
| --since | UTC start time (default: 24 hours before end; maximum window: 31 days) |

```sh
beyondtrust-axi event list
beyondtrust-axi event list --help
```

## event search

Read event search (GET /v3/Events/search).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete redacted ECS event objects instead of compact columns |
| --help | Show command help |
| --limit | Maximum rows, 1-1000 (default: 50) |
| --all | Read up to 1000 rows within 10 requests, 60 seconds and 8 MiB |
| --cursor | Resume an opaque cursor with the same profile, command and filters |
| --since | UTC start time (default: 24 hours before end; maximum window: 31 days) |
| --until | UTC end time (default: now) |
| --group | ComputerGroups; arrays use comma-separated values |
| --os | OperatingSystem (required); arrays use comma-separated values |
| --action | Events EventAction; arrays use comma-separated values |
| --code | Events EventCode; arrays use comma-separated values |
| --type | Events EventType; arrays use comma-separated values |
| --app-type | Application ApplicationType; arrays use comma-separated values |
| --host | Computers HostName; arrays use comma-separated values |
| --domain | Computers HostDomain; arrays use comma-separated values |
| --user | Users UserName; arrays use comma-separated values |
| --workstyle | Policies WorkstyleName; arrays use comma-separated values |
| --app-group | Policies ApplicationGroupName; arrays use comma-separated values |
| --on-demand | Policies OnDemandRule; arrays use comma-separated values |

```sh
beyondtrust-axi event search --os Windows
beyondtrust-axi event search --help
```

## audit activity list

Read audit activity list (GET /v3/ActivityAudits).

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
| --user | Filter User (string) |
| --details | Filter Details (string) |
| --created-dates | Filter Created Dates (array; comma-separated) |
| --created-selection-mode | Filter Created SelectionMode (Single|Multiple|Range) |
| --entity | Filter Entity (string) |
| --audit-type | Filter AuditType (string) |
| --changed-by | Filter ChangedBy (API|Portal|ManagementRule|Pathfinder) |

```sh
beyondtrust-axi audit activity list
beyondtrust-axi audit activity list --help
```

## audit activity show

Read audit activity show (GET /v3/ActivityAudits/{id}).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --id | Required resource int64 |
| --limit | Maximum rows, 1-1000 (default: 50) |
| --all | Read up to 1000 rows within 10 requests, 60 seconds and 8 MiB |
| --cursor | Resume an opaque cursor with the same profile, command and filters |

```sh
beyondtrust-axi audit activity show --id <int64>
beyondtrust-axi audit activity show --help
```

## audit activity details

Read audit activity details (GET /v3/ActivityAudits/Details).

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
| --user | Filter User (string) |
| --details | Filter Details (string) |
| --created-dates | Filter Created Dates (array; comma-separated) |
| --created-selection-mode | Filter Created SelectionMode (Single|Multiple|Range) |
| --entity | Filter Entity (string) |
| --audit-type | Filter AuditType (string) |
| --changed-by | Filter ChangedBy (API|Portal|ManagementRule|Pathfinder) |

```sh
beyondtrust-axi audit activity details
beyondtrust-axi audit activity details --help
```

## audit auth-request list

Read audit auth request list (GET /v3/AuthorizationRequestAudits).

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
| --ticket-id | Filter TicketId (string) |
| --user | Filter User (string) |
| --computer-name | Filter ComputerName (string) |
| --product-name | Filter ProductName (string) |
| --reason | Filter Reason (string) |
| --decision-performed-by-user | Filter DecisionPerformedByUser (string) |
| --decision | Filter Decision (string) |
| --time-of-request-dates | Filter TimeOfRequest Dates (array; comma-separated) |
| --time-of-request-selection-mode | Filter TimeOfRequest SelectionMode (Single|Multiple|Range) |
| --decision-time-dates | Filter DecisionTime Dates (array; comma-separated) |
| --decision-time-selection-mode | Filter DecisionTime SelectionMode (Single|Multiple|Range) |
| --start-time-dates | Filter StartTime Dates (array; comma-separated) |
| --start-time-selection-mode | Filter StartTime SelectionMode (Single|Multiple|Range) |
| --duration | Filter Duration (string) |

```sh
beyondtrust-axi audit auth-request list
beyondtrust-axi audit auth-request list --help
```

## audit auth-request show

Read audit auth request show (GET /v3/AuthorizationRequestAudits/{id}).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --id | Required resource int64 |
| --limit | Maximum rows, 1-1000 (default: 50) |
| --all | Read up to 1000 rows within 10 requests, 60 seconds and 8 MiB |
| --cursor | Resume an opaque cursor with the same profile, command and filters |

```sh
beyondtrust-axi audit auth-request show --id <int64>
beyondtrust-axi audit auth-request show --help
```

## admin-request list

Read admin request list (GET /v3/AdminAccessRequest).

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
| --decision | Filter Decision (string) |
| --created-on | Filter CreatedOn (string) |
| --active-only | Filter ActiveOnly (boolean) |
| --modified-on | Filter ModifiedOn (string) |
| --computer-id | Filter ComputerId (string) |
| --endpoint-user-id | Filter EndpointUserId (string) |
| --endpoint-user-name | Filter EndpointUserName (string) |

```sh
beyondtrust-axi admin-request list
beyondtrust-axi admin-request list --help
```

## admin-request show

Read admin request show (GET /v3/AdminAccessRequest/{requestId}).

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
beyondtrust-axi admin-request show --id <uuid>
beyondtrust-axi admin-request show --help
```

## auth-request list

Read auth request list (GET /v3/AuthorizationRequest).

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
| --decision | Filter Decision (string) |
| --created-on | Filter CreatedOn (string) |
| --active-only | Filter ActiveOnly (boolean) |
| --modified-on | Filter ModifiedOn (string) |

```sh
beyondtrust-axi auth-request list
beyondtrust-axi auth-request list --help
```

## auth-request show

Read auth request show (GET /v3/AuthorizationRequest/{systemId}).

| Flag | Meaning |
|---|---|
| --config | Configuration file path (default: platform config directory) |
| --profile | Named file profile (default: selection precedence) |
| --fields | Comma-separated output fields (default: all) |
| --full | Show complete strings |
| --help | Show command help |
| --id | Required resource string |
| --limit | Maximum rows, 1-1000 (default: 50) |
| --all | Read up to 1000 rows within 10 requests, 60 seconds and 8 MiB |
| --cursor | Resume an opaque cursor with the same profile, command and filters |

```sh
beyondtrust-axi auth-request show --id <string>
beyondtrust-axi auth-request show --help
```
