# Using BaseHalf (instructions for coding agents)

> **Status (PR 1 scaffold):** the monorepo skeleton is in place. The CLI binary
> (`bh`) is built but has **no commands wired yet**. The old `node src/cli.mjs`
> reference impl was deleted (clean slate) — that path no longer exists. If
> you find an instruction telling you to invoke it, the instruction is stale.

## What's here right now

- `packages/core/` — kernel: registry + context. `createCore()` returns the one
  door. Modules will register commands under `packages/core/src/modules/<name>/`.
- `packages/cli/` — thin shell over core. Built at `packages/cli/dist/bin.js`.
  Today it just prints a scaffold banner; PR 2+ wires real argv parsing.

## What to run

```bash
pnpm install
pnpm -r build         # builds @basehalf/core then @basehalf/cli
pnpm -r test          # core sanity tests
pnpm -r --if-present lint
node packages/cli/dist/bin.js   # prints scaffold banner (no commands yet)
```

## Rules (carry into PR 2+)

- **One door.** All operations go through `@basehalf/core`'s `run(command, args)`.
  CLI / MCP / desktop UI are thin shells — never put business logic in them.
- **Module isolation.** A module lives under `packages/core/src/modules/<name>/`,
  registers its commands via the kernel registry, and touches core only through
  the `Context` it's given. Don't reach into kernel internals.
- **MD = content truth, `.bh/` = derived cache, git = history.** Per the
  architecture constitution (private repo: `private-docs/架构宪法.md`). Modules
  that touch user files must be observers (chokidar + reconcile), never owners.
- **Don't restore the deleted event-log impl.** It was overturned by the
  constitution; if you need to read it, it's in git history at `c441f79`.
