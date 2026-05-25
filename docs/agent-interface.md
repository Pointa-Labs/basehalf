# The agent interface

What the software gives an agent. Think of it as a toolbox with **three drawers**:
look, do, check/undo. It's deliberately small.

## Drawer 1 — Eyes (read; safe; no approval needed)

| Command | Does | Notes |
|---|---|---|
| `search "<q>"` | find notes whose text matches | results carry their **sources** |
| `context "<task>"` | grounded bundle for a task | what an agent pulls before working |
| `get <id>` | read one item | |
| `list [--all]` | list items | `--all` includes soft-deleted |

## Drawer 2 — Hands (write; through the door; recorded & reversible)

A small set of **primitive** actions. Pass `--actor agent` so the ledger records
who acted. Add a `--source` to ground any factual claim.

| Command | Does | Emits event |
|---|---|---|
| `add "<text>" [--source s] [--type note\|canvas] [--x n --y n]` | create | `NoteCreated` (+`SourceLinked`) |
| `edit <id> "<text>"` | change text | `NoteEdited` |
| `move <id> --x n --y n` | reposition (canvas) | `NoteMoved` |
| `link <id> --source s` | attach a source | `SourceLinked` |
| `rm <id>` | soft-delete (recoverable) | `NoteDeleted` |

## Drawer 3 — Ledger (history & undo; the safety net)

| Command | Does |
|---|---|
| `log [--limit n]` | the audit trail: who changed what, when |
| `undo <eventId\|commandId>` | undo one change, or a whole action / agent run |

## The most important design rule: primitives, not tasks

You will be tempted to add `arrange-into-heart`, `summarize`, `group-by-topic`.
**Don't.** You can't predict the next request, and the agent is smart enough to
decompose any high-level intent into primitives. So:

- You ship `move`, not `arrange-into-heart`.
- The **shape lives in the agent's head**, never in your code.
- Result: your software stays tiny, and "it can do anything" comes for free.

### Worked example: "arrange these canvas items into a heart"

1. **Agent looks** — `context`/`list` → gets each item's id, position, and the
   canvas bounds.
2. **Agent thinks** — it computes where each item goes to form a heart. *Your
   software has no idea what a heart is, and doesn't need to.*
3. **Agent acts** — it calls `move <id> --x .. --y ..` once per item (each goes
   through the door).
4. **You record + redraw** — every move is logged (by `agent`); the canvas
   re-renders from the data.
5. **Ugly? Undo** — one step, because the moves share a run you can revert.

The agent never touches the canvas renderer directly — it goes through the door,
so audit + undo + attribution come for nothing. ("The canvas is just a picture of
your data.")

## How an agent discovers all this

- **Local coding agents** (Claude Code / Codex): a repo-local
  [`CLAUDE.md`](../CLAUDE.md) / `AGENTS.md` snippet + good `--help`. They read it
  and use it like any CLI — no protocol needed.
- That's the whole integration for v1.

## Two handles, one door: CLI first, MCP later

The CLI and MCP are both thin skins over the same `core`. Pick the handle by
**where the agent is**:

- **CLI** — works for any agent that has a shell **on the same machine**. Zero
  config, natural for coding agents, doubles as your human tool + test harness.
  Start here.
- **MCP** — adds: works **remotely / for agents with no shell**, one server works
  across **every** MCP host, typed/discoverable tools, and per-tool approval in
  the host UI. Add it when you need to reach beyond local coding agents.

You don't choose one forever. Build the CLI; wrap MCP later.

### Wrapping: keep the core single

`src/mcp.mjs` is a stub that calls the **same `core`** as the CLI. Two valid ways
to wrap:

- **A — MCP shells out to the CLI** (fast shortcut; needs `--json` + exit codes;
  same machine only).
- **B — both CLI and MCP call a shared `core` library directly** (cleaner, no
  subprocess; what this repo does).

Either way: **the door — writes → events → audit — is written exactly once in
`core`.** Never re-implement it in an adapter.

> ⚠️ Never expose a single generic `run_command("…")` MCP tool. That hands the
> agent raw shell access and throws away MCP's per-tool typing and approval.
> Expose each action as its own typed tool (see the `tools` list in `src/mcp.mjs`).
