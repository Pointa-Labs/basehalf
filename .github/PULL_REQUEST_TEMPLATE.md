<!-- Thanks for contributing to BaseHalf! -->

> New here? Please skim [CONTRIBUTING.md](../CONTRIBUTING.md) — the six invariants and the [dependency/license rules](../docs/dependency-policy.md) — and **open an issue first** for non-trivial changes.

## What & why

<!-- What does this change do, and what problem does it solve? Link any related issue. -->

Closes #

## The invariants (must not break)

Confirm your change preserves the six product invariants (see [CONTRIBUTING.md](../CONTRIBUTING.md)):

- [ ] **One write path** — all changes go through a `core` command → an event.
- [ ] **The ledger is the truth** — `events.mjs` stays append-only; no past event mutated/deleted.
- [ ] **Projections are disposable** — anything derived is rebuildable from the log.
- [ ] **Attribute every change** — events carry an `actor`.
- [ ] **Ground facts** — writes can carry a source; retrieval returns sources.
- [ ] **Primitives, not tasks** — added small composable actions, not task-specific ones.

## Checklist

- [ ] `npm test` passes.
- [ ] I have signed the [CLA](../CLA.md) (the bot will prompt on first PR — required before merge).
