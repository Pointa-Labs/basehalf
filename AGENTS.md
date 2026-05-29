# Using BaseHalf (instructions for coding agents)

> **Status:** `bh` has one real module today — `workspace`. The desktop app
> (v0) is in development; once it ships, the CLAUDE.md hint installed by
> `bh init` will switch to the **agent protocol** model
> (`.bh/focus.md` + `.bh/badges/<file>.json` + `.bh/index/inbound.json` — see
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
place; `bh` tracks which folder is "active" so future modules (badges, focus,
inbound — landing in v0) know which root to operate on. Adding one creates a
`.bh/` subdirectory; removing only unregisters — it never deletes user files.

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
