# Contributing

Use strict ESM TypeScript, Node.js 22.12 or later and pnpm through Corepack.
Keep changes focused.
Read [AGENTS.md](AGENTS.md) and [the design](docs/design.md) for boundaries.

## Checks

```sh
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm run build
corepack pnpm run lint
corepack pnpm test
corepack pnpm run spec:check
corepack pnpm run docs:check
corepack pnpm run identifiers:check
```

The full B1 suite runs under scripts/isolated.mjs with isolated HOME, XDG and agent configuration.
It always exercises the packaged CLI and profile, network and identifier safety baselines.
Follow the Test quality rules in [AGENTS.md](AGENTS.md) when writing or reviewing tests.
Use synthetic tenant example and never a live tenant.
The export is committed byte-for-byte from the approved sanitized artifact, with both hashes and the one organization-label substitution in inventory/specs.json.
Do not fetch the specification during tests.
After catalogue changes, build and run docs:generate followed by docs:check.
Keep process notes out of git and never hand-edit generated docs or changelogs.

## Delivery and releases

Use conventional commits and describe the problem, consequence, fix, scope and checks in the PR.
The repository has no hosted pull-request test CI; no-mistakes declares no_ci: true.
Release-please is the only workflow, and publication requires the owner's npm reservation and trusted publisher setup.
Publication builds and verifies a tarball, then uses npm OIDC with provenance and no publishing token.
