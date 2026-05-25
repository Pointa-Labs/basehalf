# BaseHalf

> **Composable, portable memory for your coding agent.**
> A local-first context layer that Claude Code & Codex read and write through plain commands — every change grounded in a source, attributed, and reversible. Local. Zero-config. Yours.

> Built by [Pointa Labs, Inc.](https://basehalf.com) · Open source (Apache-2.0). The name and logo are trademarks — see [docs/trademark-policy.md](docs/trademark-policy.md).
> **Status: early** — a runnable reference implementation of the core idea. See [Status](#status).

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

Those five rules *are* the architecture. The trick that makes them work: keep
the **ledger** (every change as an event), not just the **balance** (current
state). Current state is just the ledger added up — so you can always see the
history and undo anything. (Full plain-language explanation:
[docs/architecture.md](docs/architecture.md).)

## Try it (zero install — needs Node ≥ 18)

```bash
npm run demo     # 60-second narrated tour
npm test         # the architecture, as an executable spec (9 tests)
```

Use the CLI (creates a `.bh/` store in the current folder, like `git`):

```bash
node src/cli.mjs add "We chose Postgres for the cloud DB" --source docs/decisions.md
node src/cli.mjs context "database" --json    # grounded context bundle for the agent
node src/cli.mjs link <id> --source docs/decisions.md
node src/cli.mjs log
node src/cli.mjs undo <eventId|commandId>
node src/cli.mjs help
```

An agent passes `--json` and `--actor agent` (so the ledger records who acted).
A repo-local [CLAUDE.md](CLAUDE.md) tells coding agents how to drive it.

> 📹 **Demo video coming.** For now, `npm run demo` is the fastest way to see it.

## What an agent gets — three drawers

| Drawer | Purpose | Commands |
|---|---|---|
| 👁 Eyes (read) | see current state, grounded | `search` · `context` · `get` · `list` |
| ✋ Hands (write, recorded) | change things via primitives | `add` · `edit` · `move` · `link` · `rm` |
| 📒 Ledger (history) | audit & undo | `log` · `undo` |

Full spec: [docs/agent-interface.md](docs/agent-interface.md).

## Why not just…

| Instead of | The catch | BaseHalf |
|---|---|---|
| a folder of `.md` / `CLAUDE.md` | bricks; per-project; not composable or queryable | a composable reference graph, reusable across projects |
| Notion + MCP | paid; MCP is a chore; data on their cloud | local, zero-config CLI; the files are yours |
| Obsidian + MCP | local & yours, but "documents" not composable fragments; agent writes aren't audited | reference graph + grounded / auditable / reversible writes |
| AI-memory APIs (mem0, Letta…) | black-box auto-memory you can't edit | user-owned, human- **and** AI-editable, composable |
| ChatGPT / Claude built-in memory | siloed per vendor; not portable | portable — any agent can read/write |

## Repo layout

```
src/core/        the one door + the ledger (all logic lives here)
  events.mjs       append-only event log (the source of truth)
  projection.mjs   fold events -> current state (a rebuildable cache)
  index.mjs        the commands: add/edit/move/link/rm/undo + reads
src/cli.mjs      thin CLI handle over core (humans + local agents)
src/mcp.mjs      thin MCP handle over the SAME core (stub + wiring notes)
test/            executable spec
scripts/demo.mjs narrated tour
docs/            architecture · agent-interface · decisions · roadmap · business
```

## Status

Earliest stage. This repo is the **design + a runnable reference implementation**
of the core idea. The reference impl is intentionally zero-dependency JavaScript
(JSONL store) so it runs instantly; the production target is TypeScript + SQLite —
the design doesn't change, because nothing outside `events.mjs` knows how events
are stored. See [docs/roadmap.md](docs/roadmap.md).

## Contributing

Contributions are welcome — but this is a deliberately narrow *substrate*, so
**please open an issue before sending a non-trivial PR** to align on scope first.
Then:

1. Read [CONTRIBUTING.md](CONTRIBUTING.md) — the six invariants, how to run/test, and the dependency rules.
2. Open a PR; the template walks you through the checklist and CI runs the spec.
3. Sign the [CLA](CLA.md) when the bot prompts (required before merge); keep contributions original and [permissively licensed](docs/dependency-policy.md).

By participating you agree to our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[Apache-2.0](LICENSE). Contributions require a signed [CLA](CLA.md) — see [CONTRIBUTING.md](CONTRIBUTING.md).
The "BaseHalf" name and logo are trademarks of Pointa Labs, Inc. ([trademark policy](docs/trademark-policy.md)).
