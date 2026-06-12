# Using BaseHalf (instructions for coding agents)

> **This mirrors [`CLAUDE.md`](CLAUDE.md).** BaseHalf keeps ONE maintained agent
> guide — `CLAUDE.md` in the repo root — so the two can't drift. Read it for the
> full command reference: the `workspace`, `badge`, `inbound`, `focus`, and
> `search` modules (plus an internal `watcher`), and the `.bh/` agent protocol
> (`.bh/focus.md` + `.bh/badges/<file>.json` + `.bh/index/inbound.json`). The
> load-bearing invariants are repeated below so they hold even if this is the
> only file you read.
>
> The old `node src/cli.mjs` reference impl was deleted (clean slate); that path
> no longer exists. A short-lived `bh decision` subcommand has also been retired
> — see [docs/decisions.md D18](docs/decisions.md). Internal product decisions
> for the BaseHalf project itself live in `private-docs/decisions/` (private repo).

`bh` is the CLI. Invoke it as `bh <cmd>` (linked globally via `npm link` in
`packages/cli/`). If `bh` is missing on this machine, rebuild + relink:
`pnpm -r build && (cd packages/cli && npm link)`. Always prefer `--json` on
reads — output stays stable across versions — placed **after** the subcommand
(e.g. `bh workspace list --json`), not at the root. Set `BH_CONFIG_DIR=/some/path`
to point `bh` at a non-default config directory (useful for tests / sandboxed
runs).

## Recording why decisions were made (internal team workflow)

This project's own architecture / product decisions are kept as MD files under
`private-docs/decisions/<slug>.md` (one decision per file, with a YAML
frontmatter block plus a rationale body). Grep / read them directly; there's no
CLI wrapper. When you encounter "why did we…" questions about architecture or
product direction, look in `private-docs/decisions/` first. The corpus README at
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
  Expected" problem is gone. The quality gate moved EARLIER: lint + typecheck
  + the full test suite must be green BEFORE every push (CI still runs on
  main but a red run won't block an already-landed push), and substantive
  changes get an in-session adversarial review (there's no PR-time codex
  review on this path). External contributors are unchanged: branch → PR →
  CLA + checks → merge (see [CONTRIBUTING.md](CONTRIBUTING.md)).
