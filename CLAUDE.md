# Using BaseHalf (instructions for coding agents)

> **Status:** `bh` ships five modules: `workspace`, `badge`, `inbound`,
> `focus`, `view`. The desktop app (v0) has shipped (PRs 9–16; see
> [docs/roadmap.md](docs/roadmap.md)); `bh init` now installs the full
> **agent protocol** hint pointing agents at `.bh/focus.md` +
> `.bh/badges/<file>.json` + `.bh/index/inbound.json` (see
> [docs/decisions.md D14](docs/decisions.md)).
>
> The old `node src/cli.mjs` reference impl was deleted (clean slate); that
> path no longer exists. A short-lived `bh decision` subcommand has also been
> retired — see [docs/decisions.md D18](docs/decisions.md). Internal product
> decisions for the BaseHalf project itself live in `private-docs/decisions/`
> (private repo).

`bh` is the CLI. Invoke it as `bh <cmd>` (linked globally via `npm link` in
`packages/cli/`). If `bh` is missing on this machine, rebuild + relink:
`pnpm -r build && (cd packages/cli && npm link)`.

Always prefer `--json` on reads — output stays stable across versions.
**Put `--json` after the subcommand** (e.g. `bh workspace list --json`),
not at the root.

## Workspaces — which folder is "active"

A *workspace* is a folder you've registered as a BaseHalf root. Files stay in
place; `bh` tracks which folder is "active" so the badge / focus / inbound /
view modules know which root to operate on. Adding one creates a `.bh/`
subdirectory and **eagerly materializes a default badge for every supported
file and subfolder** (idempotent — re-using the workspace later picks up any
files added externally). Removing only unregisters — it never deletes user
files.

```bash
bh init                                      # register cwd as workspace + setup (.gitignore + CLAUDE.md hint)
bh workspace add <path> [--name <name>] [--setup]
bh workspace list
bh workspace use <name>
bh workspace current
bh workspace remove <name>
```

`bh init` is the one-shot for a new project: registers the current directory,
appends `.bh/cache/` to `.gitignore` (the rest of `.bh/` stays in git so
canvas positions / metadata travel with the folder, per the architecture),
and appends a workspace-hint section to `CLAUDE.md` (non-destructive —
marker-detected to be idempotent).

Set `BH_CONFIG_DIR=/some/path` to point `bh` at a non-default config directory
(useful for tests / sandboxed runs). Default is OS-conventional:
`~/Library/Application Support/basehalf` on macOS, `$XDG_CONFIG_HOME/basehalf`
on Linux, `%APPDATA%/basehalf` on Windows.

## Badges, references, inbound, focus, views (the v0 agent protocol)

A *badge* is a file (or folder) plus a "backpack" — prompt, references to
other files, and a canvas position. Badges live at
`<workspace>/.bh/badges/<rel-path>.json` (`.bh/badges/<folder>/.badge.json`
for folder kind). Materialized eagerly on workspace open.

```bash
bh badge list [--kind file|folder] [--query <substr>] [--json]
bh badge get <file> [--kind file|folder] [--json]
bh badge set <file> [--kind file|folder] [--prompt <text>] [--json]
bh badge addRef <file> <to> [--note <text>] [--json]
bh badge removeRef <file> <to> [--json]
```

The reverse index lives at `.bh/index/inbound.json` and is maintained
incrementally on `badge.addRef/removeRef`. `bh inbound rebuild` re-derives
from all badges if it ever drifts.

```bash
bh inbound get <file> [--json]      # who points at this file?
bh inbound rebuild [--json]
```

The agent's "what do I read this turn?" signal is `<workspace>/.bh/focus.md`
(Markdown so it pastes naturally into context). It's a YAML-style `active:`
list inside MD, written by the desktop UI as the user clicks badges.

```bash
bh focus set --files <csv>   # or --view <id>
bh focus get
bh focus clear
```

A *saved view* is a named, free-position grouping of badges that need to
sit together in one canvas even if they live in different workspace
folders — references, not copies.

```bash
bh view create <name> [--id <id>] [--prompt <text>]
bh view list
bh view get <id>
bh view addMember <id> <file> [--x <n>] [--y <n>]
bh view removeMember <id> <file>
bh view delete <id>                 # member badges + user files untouched
```

## Recording why decisions were made (internal team workflow)

This project's own architecture / product decisions are kept as MD files
under `private-docs/decisions/<slug>.md` (one decision per file, with a
YAML frontmatter block plus a rationale body). Grep / read them directly;
there's no CLI wrapper.

For agents helping us build BaseHalf: when you encounter "why did we…"
questions about architecture or product direction, look in
`private-docs/decisions/` first. The corpus README at
`private-docs/decisions/README.md` explains the conventions.

## Rules (carry into future modules)

- **One door.** All operations go through `@basehalf/core`'s `run(command, args)`.
  CLI / MCP / desktop UI are thin shells — never put business logic in them.
- **Module isolation.** A module lives under `packages/core/src/modules/<name>/`,
  registers its commands via `core.register`, and touches core only through
  the `Context` it's given. **Modules calling other modules use `ctx.run`,
  never imports of another module's internals.**
- **Use `ctx.fs`, never `node:fs` directly.** So tests can swap a mock.
- **MD = content truth, `.bh/` = derived cache, git = history.** Per the
  architecture constitution. Modules that touch user files must be observers
  (chokidar + reconcile), never owners.
- **bh never writes user files unprompted.** Only explicit user edits
  through the BaseHalf UI write back to MD. Agents edit user files with
  their own tools — bh stays out of that path.
- **Don't restore the deleted event-log impl.** It was overturned by the
  architecture; if you need to read it, it's in git history at `c441f79`.
- **Don't restore the deleted decisions module.** It served the old
  AI-coding wedge as a dogfood tool; the corpus lives as MD in
  `private-docs/decisions/` now. See [docs/decisions.md D18](docs/decisions.md).
