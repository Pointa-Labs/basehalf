# Using BaseHalf (instructions for coding agents)

> **Status:** `bh` ships five user-facing modules: `workspace`, `badge`,
> `inbound`, `focus`, `search` (plus an internal `watcher`). The desktop app
> (v0) has shipped (PRs 9–16; see
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
search modules know which root to operate on. Adding one creates a `.bh/`
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
bh workspace rename <from> <to>              # change a workspace's name; path + .bh/ untouched
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

## Badges, references, inbound, focus (the v0 agent protocol)

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
bh badge rename <from> <to> [--kind file|folder] [--json]   # atomic move + cascade refs + focus
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
list inside MD, written by the desktop UI as the user curates context — an
explicit focus action, or a canvas **multi-selection (≥2 file badges)** that
mirrors in automatically (debounced; a single selection stays UI-only). Editing a
focused file's badge (`badge.set/addRef/removeRef`) auto-reconciles focus.md so
its inlined prompt/refs stay fresh — and preserves the `intent:` line — via an
internal `focus.resync` (no manual re-focus needed, CLI/agent edits included).

```bash
bh focus set --files <csv>   # or --folder <path>
bh focus get
bh focus brief               # print .bh/focus.md verbatim — the brief the agent reads
bh focus clear
```

`bh focus brief` (and the desktop focus chip's **Copy brief** button) hand back
the turn brief verbatim so it can be pasted into any AI chat — making the
curated context portable beyond the Claude-Code-auto-read-in-repo path.

A **folder is the grouping unit** (the old saved-"views" feature was removed in
favour of this). Focus a whole folder and the agent reads its files as a group;
the folder badge's prompt becomes the turn `intent:`, and the brief records a
`# source-folder:` provenance marker so editing that folder prompt refreshes the
brief by exact identity.

```bash
bh focus set --folder <path>   # focus every supported file under <path>
```

Full-text **content search** across the current workspace's text files — the
"find the note where I wrote about X" retrieval leg (badge/file matching is by
path + prompt only). Case-insensitive substring; skips binary files and tooling
dirs (`.bh/`, `node_modules`, …); reads each file under a bounded cap. In the
desktop it's wired into the ⌘K palette (debounced, below the name matches).
Read-only — it walks via the already-hardened `workspace.listFiles` +
`workspace.readFile`, so path containment is inherited, not re-implemented.

```bash
bh search <query> [--maxFiles <n>] [--maxPerFile <n>] [--json]
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
- **Land changes through a PR; never push `main` directly.** Push to a
  feature branch and open a PR — that's where CI runs. `main`'s branch
  protection requires the `CLAAssistant` check, which only fires on a pull
  request; a direct push to `main` (even a clean fast-forward) still passes
  `licenses` + `ci-summary`, but leaves `CLAAssistant` stuck on "Expected"
  forever, so the commit never turns green. Flow: branch → PR → checks green
  → merge on GitHub. (Human-contributor specifics live in
  [CONTRIBUTING.md](CONTRIBUTING.md).)
