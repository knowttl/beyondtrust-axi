---
name: beyondtrust-axi
description: Inspect BeyondTrust PM Cloud Endpoint Privilege Management local profiles and credential readiness.
---

# BeyondTrust AXI

Inspect BeyondTrust PM Cloud Endpoint Privilege Management through guarded AXI commands.

B1 supports local commands only.
Use a configured session hook for ambient local context or this skill for on-demand guidance.
The 0.0.0 scaffold is unpublished; use a built checkout until release.
Never put secrets in argv or contact a live tenant during automated verification.

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
