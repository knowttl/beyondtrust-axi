# Contributing agents

Use Node.js 22.12 or later and pnpm through Corepack.
Run build, lint, test, spec:check, docs:check and identifiers:check from package.json before review.
The repository declares no hosted test CI; release-please is the only hosted workflow.

## Boundaries

src/catalogue.ts owns the executable command catalogue and generated discovery documentation.
src/profiles.ts owns strict profile selection and SecretRefs; src/private-file.ts owns file security.
inventory/specs.json records both export hashes and the single organization-label substitution.
inventory/capabilities.json accounts for 94 operations by method and path; planned coverage never enables execution.
Only lowercase DNS hosts ending .beyondtrustcloud.com are allowed, over verified HTTPS without redirects.
Never change hosts automatically or expose secret-derived strings in argv, output, errors or journals.
Writes require forced-read-only precedence, file-profile permission, exact operation, validation/re-read, preview, exact confirmation and durable redacted intent before one send.
Deletes additionally require writes.allowDeletes and exact --confirm-delete.
Never replay ambiguous writes or mix application additions and removals.

## Verification and hygiene

Tests must remain offline with the network-deny guard and synthetic tenant example.
scripts/isolated.mjs isolates user configuration; the full B1 suite includes packaged CLI, profiles and identifier/network guard baselines.
Later API fixtures cite method and path from the committed export.
Never contact a real tenant; commissioning follows the complete build through artium-axi.
Keep secrets, customer identifiers, internal hosts and process notes outside git.
Generate docs/commands.md and skills/beyondtrust-axi/SKILL.md through scripts/generate-docs.mjs.
Never hand-edit generated artifacts or CHANGELOG.md.
Use plain dashes and one full sentence per line in long Markdown files.
