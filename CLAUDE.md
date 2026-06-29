# Using BaseHalf (instructions for coding agents)

> **Status:** `@basehalf/core` ships seven modules: `workspace`, `badges`,
> `canvas`, `focus`, `adhd`, `search` (plus an internal `watcher`). The desktop
> app drives core over IPC (see [docs/roadmap.md](docs/roadmap.md)); there is no
> standalone CLI. `workspace.add` with `setup` (and the desktop's Open Folder)
> installs the **agent protocol** hint pointing agents at
> `.bh/current_focus.yaml` + the per-node mirror YAMLs under `.bh/mirror/<path>/`
> (see `packages/core/src/modules/workspace/setup.ts`).
>
> A `2026-06` refactor aligned the code to `private-docs/focus_mode_spec/`: the
> `bh` CLI package, the `inbound` module, the `proposals` write-back module, and
> the old `.bh/focus.md` curated-brief machinery were all deleted; the `.bh/`
> layout is now a per-node **mirror tree** of YAML files (see
> [docs/decisions.md D19](docs/decisions.md)). The old `node src/cli.mjs`
> reference impl was deleted long before that (clean slate); that path no longer
> exists. A short-lived `bh decision` subcommand was also retired — see
> [docs/decisions.md D18](docs/decisions.md). Internal product decisions for the
> BaseHalf project itself live in `private-docs/decisions/` (private repo).

Migration baseline: this branch starts from commit
`41639435d6510d3d87a195f5498e88cd8ea80600` (`feat(editor): code files
first-class — Monaco code editor + canvas cards`). Treat that commit and earlier
history as the source of BaseHalf's original product/business logic. The later
hand-rolled VS Code-like Git/SCM/GitHub/workbench refactor commits are sunk cost
and should not be preserved for their own sake. The current strategy is to
develop on a real VS Code base (`vscode-base/`, also reachable through
`reference/vscode` when present) and port only BaseHalf's own product layer onto
it. Git, SCM, GitHub auth, quick input, terminal, workbench chrome, and
source-control UI should prefer VS Code's native implementation; keep only
BaseHalf-specific integration points such as the `.bh` mirror protocol,
workspace setup/hints, canvas, focus/ADHD state, badge/reference graph, and
agent-oriented search/brief logic.

`@basehalf/core` is the **one door**: every operation is `run(command, args)`.
The desktop app, the watcher, and any future MCP/CLI shell all go through that
single registry — there is no `bh <cmd>` binary anymore. The command surface is
defined by the modules registered in `packages/core/src/index.ts`; read a
module's `commands.ts` + `types.ts` for exact args/results (they're the stable
contract). When this doc and the code disagree, the code wins.

Set `BH_CONFIG_DIR=/some/path` to point core at a non-default config directory
(useful for tests / sandboxed runs). Default is OS-conventional:
`~/Library/Application Support/basehalf` on macOS, `$XDG_CONFIG_HOME/basehalf`
on Linux, `%APPDATA%/basehalf` on Windows.

## Workspaces — which folder is "active"

A *workspace* is a folder you've registered as a BaseHalf root. Files stay in
place; core tracks which folder is "active" so the badge / canvas / focus /
adhd / search modules know which root to operate on. Adding one creates a `.bh/`
subdirectory (the mirror tree is a sparse overlay created lazily on first
annotation — there is no eager materialization). **Folder identity is the
path**: re-adding a registered folder returns the existing entry instead of
erroring (the desktop's Open Folder then just switches to it), and a
derived-name collision with a different folder auto-suffixes (`notes`,
`notes-2`, …; an explicit name collision still errors). Removing only
unregisters — it never deletes user files — and removing the *current* workspace
leaves none current (the app shows its welcome state; it never auto-promotes
another workspace).

Workspace commands (call via `core.run(name, args)`):

- `workspace.add` — register a folder (`{ path, name?, setup? }`); `setup` runs
  the `.gitignore` + agent-hint installer described below.
- `workspace.list` / `workspace.current` / `workspace.use` / `workspace.remove`
  / `workspace.rename` — registry management; `rename` changes the name only
  (path + `.bh/` untouched).
- `workspace.listCanvas` — one folder level of children for the canvas (the
  filesystem-as-tree read the mirror overlays onto).
- `workspace.readFile` / `workspace.writeFile` / `workspace.createFile` /
  `workspace.createFolder` / `workspace.renameEntry` / `workspace.deleteEntry`
  / `workspace.importFile` — hardened, path-contained file access.
- `workspace.createDemo` — generate a demo workspace.

There is no `bh init` binary; the desktop app's Open Folder is the one-shot for
a new project. It registers the directory, appends `.bh/cache/` to `.gitignore`
(the rest of `.bh/` stays in git so the mirror tree / canvas positions / badge
metadata travel with the folder, per the architecture), and appends the same
workspace-hint section to `CLAUDE.md` and `AGENTS.md` — between them the
filenames today's coding agents read (Claude Code → `CLAUDE.md`; Codex / Cursor
/ Windsurf / Cline / the Copilot coding agent / … → `AGENTS.md`), so whatever
agent the user runs now or installs later picks up the curated brief with no
per-tool setup. (The old third target, `.github/copilot-instructions.md`, was
retired once Copilot's agent learned to read `AGENTS.md` natively.) Both writes
are non-destructive — marker-detected to be idempotent, existing content
preserved, a symlinked target refused rather than clobbered. In the desktop UI
these two files are scaffolding, not content: the canvas skips them; the sidebar
shows them dimmed with an `AI` tag.

## The `.bh/mirror/` model (the v0 agent protocol)

`.bh/` is the **derived mirror** of the user's attention and annotations.
Everything except `.bh/cache/` stays in git so the map travels with the folder.
Per node (file or folder), up to four YAML files live under
`.bh/mirror/<relative-path>/`, plus a single workspace-level symlink. The mirror
is **sparse** — only annotated nodes have files; a fresh workspace has none, and
the canvas reads the filesystem directly and overlays only what exists.

```text
.bh/current_focus.yaml                     # symlink → the active node's focus.yaml
.bh/mirror/<path>/badge.yaml               # semantic layer: description + references
.bh/mirror/<folder>/canvas.yaml            # visual layer: card positions + edges
.bh/mirror/<path>/focus.yaml               # viewport mirror (file or folder)
.bh/mirror/<file>/adhd.yaml                # per-file reading aids
```

### badge.yaml — the semantic layer

A *badge* is a node's identity, a one-line `description`, and the reference
graph. Folder and file badges both land at `<rel>/badge.yaml` (the kind is a
field, not the path). References are **plain paths** — the visual edge (anchors +
label) is a canvas concern, not a badge one. The reverse index that used to live
in `.bh/index/inbound.json` is now **embedded** as `referenced_by`, maintained on
the *target* badge by `badge.addRef` / `badge.removeRef` / `badge.rename`.

```yaml
path: docs/chapter-01.md
kind: file
description: "第一章正文，介绍核心概念。"
references:
  - docs/chapter-02.md
referenced_by:
  - docs/summary.md
```

Badge commands: `badge.get`, `badge.set` (description only — reference edits go
through addRef/removeRef so the bidirectional `referenced_by` invariant holds),
`badge.list` (`{ kind?, query? }`), `badge.addRef`, `badge.removeRef`,
`badge.rename` (atomic move + cascade refs + remap focus; `ifExists` tolerates a
missing source badge for the sparse common case), `badge.delete`,
`badge.markOrphan`, `badge.pruneDangling` (sweep on open — marks any badge whose
file is gone as `orphan`), `badge.revision` (cheap count+mtime signature a UI
poll compares to detect external `.bh/mirror/` edits).

### canvas.yaml — the visual layer

Per *folder*, the canvas records child card positions and the `edges` between
children (anchors `north` / `east` / `south` / `west` + a label). Splitting this
out of the badge keeps the badge purely semantic.

```yaml
path: docs
size: { width: 2400, height: 1600 }
cards:
  - { path: docs/chapter-01.md, kind: file, x: 120, y: 80, width: 260, height: 140 }
edges:
  - { from: docs/chapter-01.md, from_anchor: east, to: docs/chapter-02.md, to_anchor: west, label: "概念延伸" }
```

Canvas commands: `canvas.get`, `canvas.setCard`, `canvas.removeCard`,
`canvas.setSize`, `canvas.connect` / `canvas.disconnect` / `canvas.reconnect`
(edges), `canvas.revision`.

### focus.yaml + current_focus.yaml — the viewport mirror

Focus *flipped* from a hand-curated active-file list (the deleted
`.bh/focus.md`) to a **real-time viewport mirror**: whatever node the user is
looking at IS the focus. Each node owns a `focus.yaml`; `.bh/current_focus.yaml`
is a **symlink** to the active node's one — the agent's single per-turn entry
point. The desktop repoints the symlink as the user switches nodes.

```yaml
# file node
path: docs/chapter-01.md
kind: file
visible_lines: { start: 12 }
cursor: { line: 28, column: 6 }

# folder node
path: docs
kind: folder
viewport_center: { x: 800, y: 420 }
zoom: 1.2
```

The live fields (`visible_lines` / `cursor` / `viewport_center` / `zoom`) are
optional in this structural-first round — a node switch may write just
`path` + `kind`. Focus commands: `focus.set` (write the active node's
focus.yaml + repoint the symlink; takes an optional `workspace` guard against an
in-flight workspace switch), `focus.get` (resolve the symlink → the node, or
`null`), `focus.clear`, `focus.pruneDangling`.

### adhd.yaml — per-file reading aids

Per *file*, ADHD-mode tracks keywords to highlight and which line-ranges the
user has already read. Unread paragraphs are everything outside the ranges; the
front end can style read vs unread (no per-paragraph IDs needed).

```yaml
path: docs/chapter-01.md
kind: file
highlight_keywords: ["供需均衡", "边际成本"]
read_paragraphs:
  - [12, 24]
  - [31, 38]
```

ADHD commands: `adhd.get`, `adhd.set`, `adhd.addKeyword` / `adhd.removeKeyword`,
`adhd.markRead` / `adhd.markUnread`, `adhd.revision`.

### What a fresh agent reads each turn

The protocol an installed hint teaches: **at the start of every turn, read
`.bh/current_focus.yaml`.** If `kind: file`, combine the file content with its
`badge.yaml` and the `visible_lines` / `cursor` where the user is. If
`kind: folder`, use that folder's `badge.yaml` + `canvas.yaml` and the
`viewport_center` / `zoom`. From the focused node, follow `references` /
`referenced_by` and the canvas structure for more context. Only modify the
user's own files when they explicitly ask; when asked, you can also generate or
update the `.bh/` YAMLs (match the shape, read the latest first, don't store
anything derivable from paths / line numbers / the reference graph, and never
replace the `current_focus.yaml` symlink with a regular file). The canonical
hint text lives in `HINT_BODY` in
`packages/core/src/modules/workspace/setup.ts` — that file is the source of
truth, not this paragraph.

## Content search

Full-text **content search** across the current workspace's text files — the
"find the note where I wrote about X" retrieval leg (badge/file matching is by
path + description only). Case-insensitive substring; skips binary files and
tooling dirs (`.bh/`, `node_modules`, …); reads each file under a bounded cap.
In the desktop it's wired into the ⌘K palette (debounced, below the name
matches). Read-only — it walks via the already-hardened `workspace.listFiles` +
`workspace.readFile`, so path containment is inherited, not re-implemented.

```text
search.query  { query, maxFiles?, maxMatchesPerFile? }   # ranked file hits
search.brief  { query, maxFiles?, maxMatchesPerFile? }   # paste-ready context brief
```

`search.brief` assembles the matches into a paste-ready **context brief**: each
matching file is inlined with its badge description and noted references. The
on-ramp for "I know what I want to ask, not which files matter."

## Recording why decisions were made (internal team workflow)

This project's own architecture / product decisions are kept as MD files
under `private-docs/decisions/<slug>.md` (one decision per file, with a
YAML frontmatter block plus a rationale body). Grep / read them directly;
there's no CLI wrapper.

For agents helping us build BaseHalf: when you encounter "why did we…"
questions about architecture or product direction, look in
`private-docs/decisions/` first. The corpus README at
`private-docs/decisions/README.md` explains the conventions. The authoritative
spec for the current `.bh/mirror/` model is `private-docs/focus_mode_spec/`.

## Rules (carry into future modules)

- **One door.** All operations go through `@basehalf/core`'s `run(command, args)`.
  The desktop UI / watcher / any future MCP or CLI shell are thin shells — never
  put business logic in them.
- **Module isolation.** A module lives under `packages/core/src/modules/<name>/`,
  registers its commands via `core.register`, and touches core only through
  the `Context` it's given. **Modules calling other modules use `ctx.run`,
  never imports of another module's internals.**
- **Use `ctx.fs`, never `node:fs` directly.** So tests can swap a mock.
- **User files = content truth, `.bh/` = derived mirror, git = history.** Per the
  architecture constitution. Modules that touch user files must be observers
  (chokidar + reconcile), never owners.
- **Any RMW on a `.bh/` YAML needs a mutex.** A read-modify-write on a mirror
  file (badge / canvas / focus / adhd) must serialize through `createKeyedMutex`
  (kernel) or it loses updates under concurrent writers (the watcher + an in-app
  edit). New stores need the same treatment.
- **core never writes user files unprompted.** Only explicit user edits
  through the BaseHalf UI write back to disk. Agents edit user files with
  their own tools — core stays out of that path.
- **Don't restore the deleted event-log impl.** It was overturned by the
  architecture; if you need to read it, it's in git history at `c441f79`.
- **Don't restore the deleted decisions module.** It served the old
  AI-coding wedge as a dogfood tool; the corpus lives as MD in
  `private-docs/decisions/` now. See [docs/decisions.md D18](docs/decisions.md).
- **Don't restore the deleted CLI / `inbound` / `proposals` / `focus.md`.** The
  CLI package is gone (core drives everything); the reverse index is embedded in
  `badge.referenced_by`; agent write-back was overturned; the curated focus brief
  was replaced by the `focus.yaml` viewport mirror. See
  [docs/decisions.md D19](docs/decisions.md).
- **Maintainers (including agents working for them) push `main` directly —
  no PR.** `maintainer-fastlane.yml` auto-greens the `CLAAssistant` check on
  direct pushes by allowlisted logins, so the old "CLAAssistant stuck on
  Expected" problem is gone. The quality gate moved EARLIER: lint, typecheck
  and the full test suite must be green BEFORE every push (CI still runs on
  main but a red run won't block an already-landed push), and substantive
  changes get an in-session adversarial review (there's no PR-time codex
  review on this path). External contributors are unchanged: branch → PR →
  CLA + checks → merge (see [CONTRIBUTING.md](CONTRIBUTING.md)).
