# BaseHalf

> **Composable, portable memory for your coding agent.**
> A local-first context layer that Claude Code & Codex read and write through plain commands — every change grounded in a source, attributed, and reversible. Local. Zero-config. Yours.

> Built by [Pointa Labs, Inc.](https://basehalf.com) · Open source (Apache-2.0). The name and logo are trademarks — see [docs/trademark-policy.md](docs/trademark-policy.md).
> **Status: rebuild in progress** — the original reference impl has been replaced by a new monorepo skeleton. See [Status](#status).

---

## Why

Coding agents are amnesiac. Every Claude Code / Codex session starts from zero:
context is re-gathered, decisions re-derived, and the *why* evaporates when the
window resets. The usual patches don't fit:

- **`CLAUDE.md`** is a single brick — one file, one project, not composable.
- **Notion-via-MCP** is paid, and the MCP setup is a chore.
- **Vendor memory** (ChatGPT / Claude built-in) is siloed per tool, not portable.

BaseHalf is **a memory your agent operates and you own**: small fragments you
recombine on demand, not documents you stack. Context becomes *liquid* — pulled
apart and reassembled per task — instead of bricked into files.

## What it is (and isn't)

- It **is** the *substrate*: a local store + one write-path + grounded retrieval
  + audit/undo, driven by any agent through a plain CLI (MCP later).
- It is **not** an agent. No planning, no model calls, no orchestration. The
  agent (Claude Code / Codex / …) brings the brain; BaseHalf gives it eyes,
  hands, and a ledger. **Works with any agent — vendor-neutral by design.**

## The one idea

Design the app as if you've hired a fast but fallible assistant who edits your
stuff while you sleep. What would you insist on?

1. **A log of everything it did** — who, when, what, why.
2. **The ability to undo any of it.**
3. **It can only use approved actions, not rewire the place.**
4. **It cites where each fact came from.**
5. **It uses the same actions you do.**

Those five rules *are* the architecture. The current direction: **Markdown
files are the content truth**, a `.bh/` cache holds derived metadata (links,
search index, attribution), and git provides history/undo. Agents edit MD
directly with their native tools; structured operations (linking, composing,
canvas layout) go through the `bh` CLI — the one door.

## Status

**Skeleton only.** PR 1 (this commit) replaced the original event-log reference
implementation with a new monorepo skeleton aligned to the locked architecture:

- `packages/core/` — kernel (registry + context). `createCore()` is the one door.
- `packages/cli/` — thin `bh` shell over core. **Built but no commands wired yet.**

Real commands land in PR 2+, starting with workspace-root management
(`bh workspace add/list/use`) — the wedge-independent foundation every feature
needs.

The earlier event-log reference impl lives in git history at commit `c441f79`.

## Build it

```bash
pnpm install
pnpm -r build         # @basehalf/core, then @basehalf/cli
pnpm -r test
pnpm -r --if-present lint
node packages/cli/dist/bin.js   # scaffold banner (no commands yet)
```

Requirements: Node ≥ 18.17, pnpm 9.

## Repo layout

```text
packages/
  core/             kernel (registry + context) + modules (one per feature)
    src/
      index.ts        createCore() — the one door
      kernel/         registry, context, types
      modules/        functions register here (empty in PR 1)
  cli/              bh — thin shell over core
docs/             decisions · dependency-policy · roadmap · trademark-policy
```

## Why not just…

| Instead of | The catch | BaseHalf |
|---|---|---|
| a folder of `.md` / `CLAUDE.md` | bricks; per-project; not composable or queryable | a composable reference graph, reusable across projects |
| Notion + MCP | paid; MCP is a chore; data on their cloud | local, zero-config CLI; the files are yours |
| Obsidian + MCP | local & yours, but "documents" not composable fragments; agent writes aren't audited | reference graph + grounded / auditable / reversible writes |
| AI-memory APIs (mem0, Letta…) | black-box auto-memory you can't edit | user-owned, human- **and** AI-editable, composable |
| ChatGPT / Claude built-in memory | siloed per vendor; not portable | portable — any agent can read/write |

## Contributing

Contributions are welcome — but this is a deliberately narrow *substrate*, so
**please open an issue before sending a non-trivial PR** to align on scope first.
Then:

1. Read [CONTRIBUTING.md](CONTRIBUTING.md) — how to build/test and the dependency rules.
2. Open a PR; the template walks you through the checklist and CI runs the spec.
3. Sign the [CLA](CLA.md) when the bot prompts (required before merge); keep contributions original and [permissively licensed](docs/dependency-policy.md).

By participating you agree to our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[Apache-2.0](LICENSE). Contributions require a signed [CLA](CLA.md) — see [CONTRIBUTING.md](CONTRIBUTING.md).
The "BaseHalf" name and logo are trademarks of Pointa Labs, Inc. ([trademark policy](docs/trademark-policy.md)).
