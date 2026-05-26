# Using BaseHalf (instructions for coding agents)

> **Status:** `bh` is alive with its first module (`workspace`). More land in
> subsequent PRs. The old `node src/cli.mjs` reference impl was deleted (clean
> slate) — that path no longer exists. If you find an instruction telling you
> to invoke it, the instruction is stale.

`bh` is the CLI; while developing, invoke it as
`node packages/cli/dist/bin.js <cmd>` (or `pnpm --filter @basehalf/cli build`
first if you haven't built). Once installed, it's `bh <cmd>`.

Always prefer `--json` on reads — output stays stable across versions.

## Workspaces (the only commands available today)

A *workspace* is a folder you've registered as a BaseHalf root. Files stay in
place; `bh` tracks which folder is "active" so other commands know which root
to operate on. Adding one creates a `.bh/` subdirectory (the derived cache);
removing only unregisters — it never deletes user files.

```bash
bh workspace add <path> [--name <name>]     # register; creates .bh/; first becomes current
bh workspace list                            # all workspaces, * marks current
bh workspace use <name>                      # switch current
bh workspace current                         # show current
bh workspace remove <name>                   # unregister (does NOT delete files)
```

Each command supports `--json` for machine-readable output (put `--json`
**after** the subcommand: `bh workspace list --json`).

Set `BH_CONFIG_DIR=/some/path` to point `bh` at a non-default config directory
(useful for tests / sandboxed runs). Default is OS-conventional:
`~/Library/Application Support/basehalf` on macOS, `$XDG_CONFIG_HOME/basehalf`
on Linux, `%APPDATA%/basehalf` on Windows.

## Rules (carry into future modules)

- **One door.** All operations go through `@basehalf/core`'s `run(command, args)`.
  CLI / MCP / desktop UI are thin shells — never put business logic in them.
- **Module isolation.** A module lives under `packages/core/src/modules/<name>/`,
  registers its commands via `core.register`, and touches core only through
  the `Context` it's given. Don't reach into kernel internals.
- **Use `ctx.fs`, never `node:fs` directly.** So tests can swap a mock and
  modules don't drift apart on FS semantics.
- **MD = content truth, `.bh/` = derived cache, git = history.** Per the
  architecture constitution. Modules that touch user files must be observers
  (chokidar + reconcile), never owners.
- **Don't restore the deleted event-log impl.** It was overturned by the
  constitution; if you need to read it, it's in git history at `c441f79`.
