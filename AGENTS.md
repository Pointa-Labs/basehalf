# Using BaseHalf (instructions for coding agents)

> **Status:** `bh` has two real modules — `workspace` and `decision`. The old
> `node src/cli.mjs` reference impl was deleted (clean slate); that path no
> longer exists.

`bh` is the CLI; while developing, invoke it as
`node packages/cli/dist/bin.js <cmd>` (or `pnpm --filter @basehalf/cli build`
first if you haven't built). Once installed, it's `bh <cmd>`.

Always prefer `--json` on reads — output stays stable across versions.
**Put `--json` after the subcommand** (e.g. `bh decision recall --json`),
not at the root.

## Decisions — record & recall design choices

The single most useful thing for keeping context across sessions. **Before
answering any non-trivial design question, look at recorded decisions first:**

```bash
bh decision recall --json                # all decisions, newest first
bh decision recall <query> --json        # substring match on title/rationale/sources/tags
bh decision recall --tag <t> --json      # filter by tag (repeatable, AND semantics)
bh decision recall --status active --json
```

When the user makes a non-trivial design choice — architecture, library pick,
"X over Y because Z" — record it (only with rationale; otherwise it's noise):

```bash
bh decision add "<title>" \
  --because "<rationale>" \
  --source <ref> --source <ref> \
  --tag <topic> --tag <topic>
```

Sources are free-form strings; common forms: `meeting:<date>`, `<file>:<line>`,
`<url>`, `chat:<id>`.

Other commands:

```bash
bh decision list                         # same as `recall` with no query
bh decision show <slug>                  # full decision
bh decision update <slug> --status superseded --superseded-by <new-slug>
bh decision update <slug> --add-source <ref> --add-tag <t>
```

**Decisions cannot be silently rewritten.** `update` can change status, append
sources/tags, or mark superseded — but title and rationale are immutable. To
change direction, add a new decision and mark the old one superseded.

Decisions live in `<workspace>/.bh/decisions/<slug>.json` (one file each,
git-trackable, hand-editable if you really need to).

## Workspaces — which folder is "active"

A *workspace* is a folder you've registered as a BaseHalf root. Files stay in
place; `bh` tracks which folder is "active" so other commands (decisions, future
modules) know which root to operate on. Adding one creates a `.bh/`
subdirectory; removing only unregisters — it never deletes user files.

```bash
bh workspace add <path> [--name <name>]
bh workspace list
bh workspace use <name>
bh workspace current
bh workspace remove <name>
```

Set `BH_CONFIG_DIR=/some/path` to point `bh` at a non-default config directory
(useful for tests / sandboxed runs). Default is OS-conventional:
`~/Library/Application Support/basehalf` on macOS, `$XDG_CONFIG_HOME/basehalf`
on Linux, `%APPDATA%/basehalf` on Windows.

## Rules (carry into future modules)

- **One door.** All operations go through `@basehalf/core`'s `run(command, args)`.
  CLI / MCP / desktop UI are thin shells — never put business logic in them.
- **Module isolation.** A module lives under `packages/core/src/modules/<name>/`,
  registers its commands via `core.register`, and touches core only through
  the `Context` it's given. **Modules calling other modules use `ctx.run`,
  never imports of another module's internals** (decisions calls
  `ctx.run('workspace.current')` — that's the pattern).
- **Use `ctx.fs`, never `node:fs` directly.** So tests can swap a mock.
- **MD = content truth, `.bh/` = derived cache, git = history.** Per the
  architecture constitution. Modules that touch user files must be observers
  (chokidar + reconcile), never owners.
- **Don't restore the deleted event-log impl.** It was overturned by the
  constitution; if you need to read it, it's in git history at `c441f79`.
