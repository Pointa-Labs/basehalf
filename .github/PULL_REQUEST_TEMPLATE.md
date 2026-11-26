<!-- Thanks for contributing to BaseHalf! -->

> New here? Please skim [CONTRIBUTING.md](../CONTRIBUTING.md), how a change is made and the [dependency/license rules](../docs/dependency-policy.md), and **open an issue first** for non-trivial changes.

## What & why

<!-- What does this change do, and what problem does it solve? Link any related issue. -->

Closes #

## How it was made

- [ ] The owning specification in [docs/specs/](../docs/specs/) says what this change does, updated in this pull request or before it.
- [ ] It keeps the [architecture invariants](../docs/harness/architecture-invariants.md), and new files are where [code organization](../docs/harness/code-organization.md) puts them.
- [ ] The build was tried on a disposable folder outside this repository, never on the repository itself.

## Checklist

- [ ] `npm run typecheck-client` is clean.
- [ ] `./scripts/test.sh` passes.
- [ ] `npm run basehalf:smoke` passes, for a change to what the window shows.
- [ ] I have signed the [CLA](../CLA.md) (the bot will prompt on first PR — required before merge).
