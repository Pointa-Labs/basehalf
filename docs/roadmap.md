# Roadmap

Goal of the early game is **evidence of developer pull** — people install it, use
it daily, ask for more — not revenue and not a finished product.

## Principle: ship a vertical slice, not horizontal layers

Don't build "all of storage, then all of the editor, then all of the agent
stuff." Build one thin end-to-end thread that touches every part, get it in
front of real users, then widen. The reference implementation in this repo is
that first thread for the agent path: `add (grounded) → search → move → log → undo`.

## Product form, over time

The center of gravity moves from *infrastructure* to *application*:

- **v0 (wedge)** — agent memory/knowledge layer + CLI (+ later MCP) + a minimal
  inspector UI. Primary user is the **agent**; the human reviews/curates.
- **v1** — the human app gets good enough to read/write/organize in directly.
  Human and agent are both first-class authors.
- **v2** — source-grounded research workbench (import lots of sources, ask, the
  agent does research tasks). NotebookLM-shaped.
- **v3** — spatial/graph/canvas (tldraw) + collaboration (the paid cloud layer).

## Phases

**Phase 1 — Kernel (this repo is the seed).**
Core (Block/command/event), CLI, grounded search, undo, attribution. Agents can
only change things through commands. Port to TS + SQLite when stable.

**Phase 2 — RAG / source-grounding.**
Source import + chunking, embeddings, hybrid retrieval, citation trace, agent-run
trace. Decide the Chinese tokenizer/analyzer strategy **on day one** (it's a
core quality lever, not a "later" item).

**Phase 3 — Canvas / graph.**
Self-built graph/canvas model; tldraw as the renderer. Agent arranges via
primitive `move`/`link` commands.

**Phase 4 — Collaboration & sync.**
Introduce Yjs for in-block text concurrency (wrapped as Tier-B events, see
[decisions D7](decisions.md)); tombstones/orderKey/logical-clock/sync-cursor;
cloud Postgres + object storage. Pick the structural-conflict policy here.

**Phase 5 — Ecosystem.**
Plugin SDK; MCP client/server; sandboxed permissions; external-tool audit.

## Deliberately NOT doing yet

- The paid/cloud layer (nothing to gate yet).
- Collaboration / Yjs (keep seams only — D6).
- Self-building what BlockSuite / tldraw / Yjs already give you.
- Optimizing for GitHub stars or a big launch *before* dogfooding.
- Raising / hiring before there's pull.
