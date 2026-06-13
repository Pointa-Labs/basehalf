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
subdirectory (badges are a sparse overlay created lazily on first annotation —
there is no eager materialization). **Folder identity is the path**: re-adding
a registered folder returns the existing entry instead of erroring (the
desktop's Open Folder then just switches to it), and a derived-name collision
with a different folder auto-suffixes (`notes`, `notes-2`, …; an explicit
`--name` collision still errors). Removing only unregisters — it never deletes
user files — and removing the *current* workspace leaves none current (the
app shows its welcome state; it never auto-promotes another workspace).

```bash
bh init                                      # register cwd as workspace + setup (.gitignore + agent hints)
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
and appends the same workspace-hint section to `CLAUDE.md` and `AGENTS.md` —
between them the filenames today's coding agents read (Claude Code →
`CLAUDE.md`; Codex / Cursor / Windsurf / Cline / the Copilot coding agent / …
→ `AGENTS.md`), so whatever agent the user runs now or installs later picks up
the curated brief with no per-tool setup. (The old third target,
`.github/copilot-instructions.md`, was retired once Copilot's agent learned to
read `AGENTS.md` natively.) Both writes are non-destructive — marker-detected
to be idempotent, existing content preserved, a symlinked target refused
rather than clobbered. In the desktop UI these two files are scaffolding, not
content: the canvas skips them; the sidebar shows them dimmed with an `AI`
tag.

Set `BH_CONFIG_DIR=/some/path` to point `bh` at a non-default config directory
(useful for tests / sandboxed runs). Default is OS-conventional:
`~/Library/Application Support/basehalf` on macOS, `$XDG_CONFIG_HOME/basehalf`
on Linux, `%APPDATA%/basehalf` on Windows.

## Badges, references, inbound, focus (the v0 agent protocol)

A *badge* is a file (or folder) plus a "backpack" — prompt, references to
other files, and a canvas position. Badges live at
`<workspace>/.bh/badges/<rel-path>.json` (`.bh/badges/<folder>/.badge.json`
for folder kind). They are a **sparse overlay created lazily on first
annotation** — there is no eager materialization (a fresh workspace has zero
badge files; the canvas reads the filesystem and overlays only the badges that
exist). On workspace open, `badge.pruneDangling` marks any badge whose file is
gone as orphan so the graph stays as live as the brief.

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
bh focus set-intent <text>   # set/clear the turn intent (the user's question) — active set untouched
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
bh search <query> [--maxFiles <n>] [--maxPerFile <n>] [--brief] [--json]
```

`--brief` assembles the matches into a paste-ready **context brief** (same
spirit as `.bh/focus.md`, but retrieval-sourced instead of hand-curated): each
matching file is inlined with its badge prompt, reference notes, and noted
inbound links. The on-ramp for "I know what I want to ask, not which files
matter." Core command: `search.brief`.

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
- **Maintainers (including agents working for them) push `main` directly —
  no PR.** `maintainer-fastlane.yml` auto-greens the `CLAAssistant` check on
  direct pushes by allowlisted logins, so the old "CLAAssistant stuck on
  Expected" problem is gone. The quality gate moved EARLIER: lint, typecheck
  and the full test suite must be green BEFORE every push (CI still runs on
  main but a red run won't block an already-landed push), and substantive
  changes get an in-session adversarial review (there's no PR-time codex
  review on this path). External contributors are unchanged: branch → PR →
  CLA + checks → merge (see [CONTRIBUTING.md](CONTRIBUTING.md)).

<!-- bh:workspace-hint -->
## BaseHalf workspace

This folder is a BaseHalf workspace. **At the start of every turn, read
`.bh/focus.md`** — a self-contained turn brief the app keeps fresh (it never points
at a deleted file). It carries an optional `intent:` (what the user is doing this
turn) and an `active:` list of the files they're focused on, each with its
`prompt:` (what they want you to know) and `refs:` (which files connect, and why).
One read gives you the user's curated attention — grep can't recover those
human-written notes.

Need more than the brief? The full graph is under `.bh/`:
`.bh/badges/<rel-path>.json` is any file's backpack (prompt + references), and
`.bh/index/inbound.json` is who points AT a file. Follow these on your own budget.

While working, if you discover a file relationship or a key fact that no badge
note records (e.g. "touching X breaks Y's test"), append one line to
`.bh/cache/proposals.md`: `[file] -> [target or fact]: [reason]`. The user
triages these into real notes.

MD is the truth; `.bh/` is derived — edit user files with your own tools,
never `.bh/*` (the app and `bh` CLI own it; the proposals file above is the ONE
exception). `.bh/cache/` is gitignored; it is rebuildable EXCEPT the proposals
file, which holds your observations. `bh` CLI reads accept `--json`.
