# Endpoint Privilege Management scope

This tool targets BeyondTrust PM Cloud Endpoint Privilege Management only.
The committed OpenAPI export is the operation contract, supplemented by the [API guide](https://docs.beyondtrust.com/epm-wm/docs/api) and [reference](https://docs.beyondtrust.com/epm-wm/reference).
There are 78 paths and 94 operations with no operationId; inventory/capabilities.json cites method and path.
The ledger records 43 JSON reads, four downloads, 40 writes, six deletes and one operation not built.
Two Policy Editor application write routes also support separately gated removal.
See [the operation ledger](../inventory/capabilities.json) for implemented and planned coverage, independent of executable commands in src/catalogue.ts.

## Safety contract

For the implemented authentication flow and Management API scope, see [Safety](../README.md#safety).
The API base is HTTPS on the selected host with /management-api; redirects are errors.
On token 404, doctor reports AUTH_ENDPOINT_NOT_FOUND and hints the documented -services host form without switching hosts.
For the implemented read budgets, token renewal and retry behavior, see [Safety](../README.md#safety).
For implemented write gates and retry protections, see [Safety](../README.md#safety).
Default lists return 50 rows; --all caps at 1000 rows, 10 requests, 60 seconds and 8 MiB with bound opaque cursors.
Paged requests cap page size at 200; event windows default to 24 hours and cap at 31 days.
Writes require forced-read-only precedence, allowWrites, exact operation permission, validation and re-read, preview, --execute with exact --confirm, then durable redacted intent before one send.
Deletes also require file-profile writes.allowDeletes and exact --confirm-delete.
Explicit IDs cap at 20; bulk filters have no maximum, count matches with GET /v3/Computers, preview count and first 20 hosts, and bind count into confirmation.
Bulk previews warn that the server re-applies filters at execution; an unfiltered all-computers selection is refused.
Inputs cap at 10 MiB with SHA-256 bound into confirmation.
Policy Editor addition and deletion arrays must never be mixed.
Pre-approved AdminAccessRequest grants admin rights and requires write gates.
Ambiguous outcomes return OUTCOME_UNKNOWN with auditId and must never be replayed automatically.
For implemented download gates, limits and output, see [Safety](../README.md#safety); [Downloads](downloads.md) owns failure cleanup and platform protections.
Computer Deactivate archives and deletes; certificate renewal documents only 410 and is not built.
All verification is offline; commissioning follows B1-B13 through artium-axi.

## Build slices

| Slice | Scope |
|---|---|
| B1 | Package, local commands, profiles, inventory and offline harness |
| B2 | Auth, transport, doctor, about and task (2 operations) |
| B3 | Computer, group and policy reads (12) |
| B4 | User, role, domain, account and SCIM reads (18) |
| B5 | Events, audits and JIT reads (11) |
| B6 | Downloads (4) |
| B7 | Coordinator and computer writes (8) |
| B8 | Group writes (10) |
| B9 | Policy writes (6) |
| B10 | User, domain and SCIM writes (12) |
| B11 | JIT and integration writes (4) |
| B12 | Deletes (6 plus 2 shared) and 0.1.0 release |
| B13 | artium adapter, credentials, inventory and Allow deletes toggle |

No live compatibility claim follows from offline fixtures.
The token response's expires_in drives expiry.
Token lifetime and the guide's 1000 requests per 100 seconds remain unverified live-only facts.
