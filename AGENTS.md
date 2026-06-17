# Using BaseHalf (instructions for coding agents)

> **This mirrors [`CLAUDE.md`](CLAUDE.md).** BaseHalf keeps ONE maintained agent
> guide — `CLAUDE.md` in the repo root — so the two can't drift. Read it for the
> full reference: the `workspace`, `badges`, `canvas`, `focus`, `adhd`, and
> `search` modules (plus an internal `watcher`), and the `.bh/mirror/` agent
> protocol (`.bh/current_focus.yaml` symlink + per-node `badge.yaml` /
> `canvas.yaml` / `focus.yaml` / `adhd.yaml`). The load-bearing invariants are
> repeated below so they hold even if this is the only file you read.
>
> A `2026-06` refactor aligned the code to `private-docs/focus_mode_spec/`: the
> `bh` CLI package, the `inbound` module, the `proposals` write-back module, and
> the old `.bh/focus.md` curated-brief machinery were all deleted; the `.bh/`
> layout is now a per-node mirror tree of YAML files (see
> [docs/decisions.md D19](docs/decisions.md)). The old `node src/cli.mjs`
> reference impl was deleted long before that (clean slate). A short-lived
> `bh decision` subcommand was also retired — see
> [docs/decisions.md D18](docs/decisions.md). Internal product decisions for the
> BaseHalf project itself live in `private-docs/decisions/` (private repo).

`@basehalf/core` is the **one door**: every operation is `run(command, args)`.
There is no `bh <cmd>` binary anymore — the desktop app, the watcher, and any
future MCP/CLI shell all go through that single registry. The command surface is
defined by the modules registered in `packages/core/src/index.ts`; read a
module's `commands.ts` + `types.ts` for exact args/results. Set
`BH_CONFIG_DIR=/some/path` to point core at a non-default config directory
(useful for tests / sandboxed runs).

## The `.bh/mirror/` agent protocol (what to read each turn)

`.bh/` is the derived mirror of the user's attention. **At the start of every
turn, read `.bh/current_focus.yaml`** — a symlink to the `focus.yaml` of the
node the user is looking at right now:

- `kind: file` → use the file content together with its `badge.yaml`, plus
  `visible_lines.start` and `cursor` (where they are in it).
- `kind: folder` → use that folder's `badge.yaml` and `canvas.yaml`, plus
  `viewport_center` and `zoom`.

Per node, up to four sparse YAML files live under `.bh/mirror/<relative-path>/`:

- `badge.yaml` — a node's one-line `description`, outbound `references` (plain
  paths), and inbound `referenced_by` (the reverse index, embedded here instead
  of a separate `inbound.json`).
- `canvas.yaml` (per folder) — child card positions and `edges` (anchors +
  labels) between them.
- `focus.yaml` — the node's viewport (`current_focus` symlinks the active one).
- `adhd.yaml` (per file) — `highlight_keywords` + read line-ranges
  (`read_paragraphs`).

To answer or edit, start from the focused node, then follow its `references` /
`referenced_by` and the `canvas.yaml` structure for context. Only modify the
user's own files when they explicitly ask. When asked, you can generate or
update these `.bh/` YAMLs — match the existing shape, read the latest first so
you don't clobber the app's writes, don't store anything derivable from paths /
line numbers / the reference graph, and never replace the `current_focus.yaml`
symlink with a regular file.

## Recording why decisions were made (internal team workflow)

This project's own architecture / product decisions are kept as MD files under
`private-docs/decisions/<slug>.md` (one decision per file, with a YAML
frontmatter block plus a rationale body). Grep / read them directly; there's no
CLI wrapper. When you encounter "why did we…" questions about architecture or
product direction, look in `private-docs/decisions/` first. The corpus README at
`private-docs/decisions/README.md` explains the conventions. The authoritative
spec for the current `.bh/mirror/` model is `private-docs/focus_mode_spec/`.

## Rules (carry into future modules)

- **One door.** All operations go through `@basehalf/core`'s `run(command, args)`.
  Desktop UI / watcher / any future MCP or CLI shell are thin shells — never put
  business logic in them.
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
  (kernel) or it loses updates under concurrent writers.
- **core never writes user files unprompted.** Only explicit user edits
  through the BaseHalf UI write back to disk. Agents edit user files with
  their own tools — core stays out of that path.
- **Don't restore the deleted event-log impl.** It was overturned by the
  architecture; if you need to read it, it's in git history at `c441f79`.
- **Don't restore the deleted decisions module.** It served the old
  AI-coding wedge as a dogfood tool; the corpus lives as MD in
  `private-docs/decisions/` now. See [docs/decisions.md D18](docs/decisions.md).
- **Don't restore the deleted CLI / `inbound` / `proposals` / `focus.md`.** The
  CLI package is gone; the reverse index is embedded in `badge.referenced_by`;
  agent write-back was overturned; the curated focus brief was replaced by the
  `focus.yaml` viewport mirror. See [docs/decisions.md D19](docs/decisions.md).
- **Maintainers (including agents working for them) push `main` directly —
  no PR.** `maintainer-fastlane.yml` auto-greens the `CLAAssistant` check on
  direct pushes by allowlisted logins, so the old "CLAAssistant stuck on
  Expected" problem is gone. The quality gate moved EARLIER: lint + typecheck
  + the full test suite must be green BEFORE every push (CI still runs on
  main but a red run won't block an already-landed push), and substantive
  changes get an in-session adversarial review (there's no PR-time codex
  review on this path). External contributors are unchanged: branch → PR →
  CLA + checks → merge (see [CONTRIBUTING.md](CONTRIBUTING.md)).

<!-- bh:workspace-hint -->
## BaseHalf workspace

> Added by [BaseHalf](https://github.com/Pointa-Labs/basehalf) when this folder
> was opened as a workspace — it tells AI coding agents what the user is looking
> at. Your own content above/below is untouched; delete this section if you don't
> want agents reading that context.

This folder is a BaseHalf workspace: BaseHalf mirrors what the user is currently
viewing into `.bh/` so you stay in sync with their attention.

**At the start of every turn, read `.bh/current_focus.yaml`** — a symlink to the
focus file of the node the user is looking at right now:
- `kind: file` → they're reading a file. Use the file's content together with its
  `badge.yaml`, plus `visible_lines.start` and `cursor` (where they are in it).
- `kind: folder` → they're on a folder's canvas. Use that folder's `badge.yaml`
  and `canvas.yaml`, plus `viewport_center` and `zoom`.

The `.bh/mirror/` tree holds up to four YAML files per node (sparse — only what's
been annotated):
- `.bh/mirror/<path>/badge.yaml` — a node's one-line `description`, outbound
  `references` (paths) and inbound `referenced_by` (paths).
- `.bh/mirror/<folder>/canvas.yaml` — a folder's canvas: child card positions and
  `edges` (connections with anchors + labels) between them.
- `.bh/mirror/<path>/focus.yaml` — a node's viewport (`current_focus` points at
  the live one).
- `.bh/mirror/<file>/adhd.yaml` — per-file reading aids: `highlight_keywords` and
  read line-ranges (`read_paragraphs`).

To answer or edit, start from the focused node, then follow its `references` /
`referenced_by` and the `canvas.yaml` structure for context. Only modify the
user's own files when they explicitly ask.

When asked, you can GENERATE or update these `.bh/` files from content (a
badge.yaml/canvas.yaml for a folder, an adhd.yaml for a file). Match the existing
YAML shape; read the latest version before editing so you don't overwrite what the
app or the user just wrote; don't store anything derivable from paths, line numbers,
or the reference graph. `.bh/current_focus.yaml` is a symlink — never replace it
with a regular file.

The user's files are the source of truth; `.bh/` is derived. Edit user files with
your own tools; the app owns `.bh/`. `.bh/cache/` is gitignored and rebuildable;
the rest of `.bh/` stays in git so the map travels with the folder.
<!-- /bh:workspace-hint -->
