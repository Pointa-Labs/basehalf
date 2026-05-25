# Architecture (in plain language)

You don't need to know "CQRS", "event sourcing", or "CRDT" to understand this.
Those are just names for the ideas below.

## The frame: you hired an assistant

You're not really designing a note app. You're designing for a **fast but
fallible assistant that edits your stuff, sometimes while you're not watching**
(that assistant is Claude Code / Codex). Everything follows from one question —
what would you insist on?

1. A **log of everything it did** (who, when, what, why).
2. The ability to **undo** any of it.
3. It can only use **a fixed set of approved actions**, not rewire the place.
4. It **cites the source** of each fact.
5. It uses **the same actions you do**.

## The one core idea: keep the ledger, not just the balance

A bank doesn't store "your balance = ¥500." It stores a list of transactions
(+100, −30, +50…) and **computes** the balance by adding them up. That's why it
can show you history and reverse any transaction.

BaseHalf is a knowledge bank:

- The **ledger** = an append-only list of events ("note created", "note moved",
  "source linked"). **This is the only source of truth.**
- The **current picture** you read (notes, positions, search results) is just
  the ledger added up. It's a cache — throw it away and recompute it anytime.
- **Undo** = append a "revert" marker; we never erase history.

A normal app only stores the balance (it overwrites data, keeps no history).
Fine for a human who sees their own mistakes instantly — **dangerous for an
agent** that changes many things, fast, unattended. Agent-first = keep the ledger.

## The shape: the app does just two things

- **Write** (you *or* an agent change something): it always goes through **one
  door** → can only pick from a fixed list of actions → the app records the event
  → the picture updates. Recorded, attributed, reversible — automatically.
- **Read** (you *or* an agent look something up): just read the current picture;
  answers carry their sources.

Write always goes through the door and gets logged; read is free. That's it.

## Eyes, hands, brain

- **Eyes** = the read commands (let the agent see current state, grounded).
- **Hands** = the small set of write commands (the primitives it can do).
- **Brain** = *not ours*. Planning, "what shape", model calls — that's the
  agent's job. We give eyes and hands; the agent brings the brain. (This is why
  there is no `arrange-into-heart` command — see [decisions](decisions.md).)

## Jargon → plain words

| You'll see this word | It means |
|---|---|
| Command Bus | the one door / the fixed list of actions (`src/core/index.mjs`) |
| Event / Event Log | the ledger — the real truth (`src/core/events.mjs`) |
| Projection | the picture computed for you to read (`src/core/projection.mjs`) |
| source-grounding | every fact carries where it came from |
| provenance / actor | who made a change (`user` or `agent`) |
| tombstone | a delete that's recoverable (a marker, not erasure) |
| CLI / MCP | the handles an agent grabs the door by (`src/cli.mjs`, `src/mcp.mjs`) |

## How the code maps to this

```
                 ┌─────────────────────────────────────────────┐
  you (CLI) ───► │  src/core  — THE DOOR                        │
  agent (CLI) ─► │  add · edit · move · link · rm · undo        │
  agent (MCP) ─► │  + reads: search · context · get · list · log│
                 └───────────────┬─────────────────────────────┘
                                 │ every write appends an event
                                 ▼
                 src/core/events.mjs  — THE LEDGER (append-only, the truth)
                                 │ read all events, fold them
                                 ▼
                 src/core/projection.mjs  — THE PICTURE (rebuildable cache)
```

- `events.mjs` — append/read the ledger. Today a JSONL file; tomorrow SQLite.
  Nothing else knows or cares which.
- `projection.mjs` — fold events into current state; skips reverted events.
- `index.mjs` — the commands. The **only** place knowledge changes.
- `cli.mjs`, `mcp.mjs` — thin handles. They parse input and call `index.mjs`.
  No logic of their own.

## The invariants (don't break these — they *are* the product)

1. One write path: everything → a `core` command → an event.
2. The ledger is append-only and is the truth.
3. Projections are disposable / rebuildable.
4. Every change is attributed (`actor`).
5. Facts carry sources; reads return sources.
6. Actions are primitives; the agent composes them.

If you keep these six, you can swap the storage, the editor, the canvas library,
or the agent — and the product still holds.
