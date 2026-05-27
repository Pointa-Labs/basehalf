<!-- Thanks for contributing to BaseHalf! -->

> New here? Please skim [CONTRIBUTING.md](../CONTRIBUTING.md) — the architecture invariants and the [dependency/license rules](../docs/dependency-policy.md) — and **open an issue first** for non-trivial changes.

## What & why

<!-- What does this change do, and what problem does it solve? Link any related issue. -->

Closes #

## Architecture invariants (must not break)

Confirm your change preserves the core invariants (see [CONTRIBUTING.md](../CONTRIBUTING.md) and [docs/decisions.md](../docs/decisions.md)):

- [ ] **One door** — all operations go through `@basehalf/core`'s `run(command, args)`. CLI / desktop / MCP are thin shells.
- [ ] **MD = content truth** — modules that touch user files are **observers** (watcher + reconcile), never owners. `.bh/` is the only writable domain.
- [ ] **bh never writes user files unprompted** — only explicit user edits through the BaseHalf UI write back to MD.
- [ ] **Dependencies point only inward** — `cli` / `desktop` may depend on `core`; reverse forbidden. Modules coordinate via `ctx.run`, not direct imports.
- [ ] **Primitives, not tasks** — small composable commands (`badge.add-ref`, `view.create`), not task-specific ones (`arrange-into-heart`).
- [ ] **Publish, don't inject** — agent-facing surfaces write files to `.bh/`; no system-prompt injection.

## Checklist

- [ ] `pnpm -r test` passes.
- [ ] `pnpm -r typecheck` is clean.
- [ ] `pnpm -r --if-present lint` is clean (Biome).
- [ ] I have signed the [CLA](../CLA.md) (the bot will prompt on first PR — required before merge).
