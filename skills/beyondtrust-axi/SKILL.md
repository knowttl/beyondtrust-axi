---
name: beyondtrust-axi
description: Inspect BeyondTrust PM Cloud Endpoint Privilege Management profiles, API readiness, versions and task status.
---

# BeyondTrust AXI

Inspect BeyondTrust PM Cloud Endpoint Privilege Management through guarded AXI commands.

B2 supports local discovery, doctor, about and task status.
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
