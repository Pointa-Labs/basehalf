# Key decisions (with the reasoning)

Short ADR-style record of the calls that shaped this project, and *why* — so we
(and contributors) don't relitigate them by accident.

## D1 — We are a substrate, not an agent

**Decision.** Build the storage + write-path + retrieval + audit layer. Do **not**
build agent orchestration: no planning, no model calls, no agent loop, no
task-specific features ("arrange into a heart").

**Why.** The agent is Claude Code / Codex. Their reasoning improves every month;
re-building it means perpetually trailing the frontier and competing with our own
distribution channel. We provide capability primitives; the agent provides
intelligence.

**Consequences.** No Vercel AI SDK / OpenAI Agents SDK / LangGraph in core. The
old "Agent Runtime" shrinks to a *contract layer*: tool registry, permission,
attribution, audit, undo, source-grounding — no brain.

## D2 — One write path: the Command Bus → Event Log

**Decision.** Every change (user, agent, import, future sync) goes through one
fixed set of commands, each producing an event. No second write path.

**Why.** The one door is where we record, attribute, validate, and can say no.
A side door that skips it = lost control and lost audit.

## D3 — The event log is the source of truth; everything else is a projection

**Decision.** The append-only event log is canonical. SQLite tables, search
indexes, the editor/canvas state — all derived and rebuildable.

**Why.** Audit, undo, and (later) sync all need the history, not just the latest
state. Keeping one authoritative store and treating the rest as caches kills a
whole class of "which copy is right?" bugs.

## D4 — The differentiator is grounded + auditable + reversible

**Decision.** Don't ship a "dumb" memory store (save text / return text). The
write contract enforces provenance, sources, audit, and undo.

**Why.** Plain "memory MCP servers" are becoming a commodity. Our moat is that
*the substrate itself* guarantees these properties — an agent literally can't
write an un-attributed, un-grounded, un-reversible fact.

## D5 — Interface: CLI-first, MCP as a thin wrapper later

**Decision.** Ship a CLI first. Add an MCP server later. Both are thin adapters
over one `core`.

**Why.** Every local coding agent has a shell → the CLI reaches all of them with
zero config, and doubles as the human tool + test harness. MCP's extra reach
(remote / no-shell / cross-host / host-approval UI) is worth adding once we need
beyond local coding agents — and it's cheap once `core` exists. Don't adopt MCP
as a marketing checkbox. (See [agent-interface.md](agent-interface.md).)

## D6 — Local-first now; collaboration deferred but pre-wired

**Decision.** No real-time collaboration / Yjs / sync server in v1. But keep the
cheap seams that make it possible later: globally-unique IDs, soft-delete
tombstones, the append-only event log, and `actor` on every change.

**Why.** Those seams are ~free (we build them for agent-audit anyway) and brutal
to retrofit. Adopting Yjs now would fight the single-write-path model before we
have a single collaboration user. Pre-wire the architecture; don't pre-buy the
stack.

## D7 — Event tiering + compaction (planned, not yet built)

**Decision.** When high-frequency events arrive (e.g. per-keystroke text or CRDT
deltas), split events into **Tier A semantic** (kept long, the audit trail) and
**Tier B deltas** (compactable to snapshots past a safety window). Never compact
below the smallest sync cursor or the undo window.

**Why.** "Every change is a permanent event" + high-frequency editing = an
unbounded log. Tiering keeps audit cheap while bounding storage and rebuild time.
Not needed at reference-impl scale; required before real text/CRDT editing.

## D8 — Stack: TypeScript + SQLite in production; build on existing OSS

**Decision.** Production core: TypeScript + SQLite. Build the app shell and
editing on existing open source (BlockSuite / tldraw / ProseMirror / Yjs) rather
than from scratch. Defer Rust / Tantivy until search quality demands them. The
**reference impl here is zero-dependency JS + JSONL** purely so it runs instantly.

**Why.** Our scarce effort should go into the differentiator (D4), not into
re-inventing editors, canvases, or CRDTs. The storage swap (JSONL → SQLite) is
isolated behind `events.mjs`.

**License caveat.** Vet each candidate library's license before adopting — see
[dependency-policy.md](dependency-policy.md). In particular **tldraw is
source-available and requires a commercial license**, so the canvas must use a
permissively-licensed library instead (e.g. **React Flow** or **Excalidraw**,
both MIT). We'd switch libraries before taking on a commercialization blocker.

## D9 — License & IP: Apache-2.0 + CLA + open-core + trademark

**Decision.** Apache-2.0 core; require a CLA; monetize via a cloud/team layer
(open-core); trademark the product name.

**Why (short).** The CLA keeps the license choice *reversible*. Local-first means
no "cloud reseller" threat, so we don't need defensive copyleft (AGPL/BSL) — and
permissive maximizes the agent-embedding adoption that is our distribution.

## D10 — Naming & brand: single brand "BaseHalf" + edition words + trademark policy

**Decision.** The product is **BaseHalf** (by Pointa Labs, Inc.; basehalf.com).
Use **one brand** across the open local edition and the paid layer, distinguished
by *edition words* — **BaseHalf** (open, Apache-2.0) and **BaseHalf Cloud** /
**BaseHalf for Teams** (paid) — rather than separate brands. Protect the brand
with a **trademark policy** (code is forkable; distributed builds must rename),
not a second product name. Replaces the `agent-kb` placeholder. See
[trademark-policy.md](trademark-policy.md).

**Why.** Our distribution is adoption + agent-embedding (D1/D4), so a single
brand compounds all recognition into one name; splitting brands dilutes it. The
same-domain precedents (Obsidian + Sync, Logseq, SiYuan) all do this. A trademark
policy gives the brand protection of a Chromium/VSCodium split **without** the
cost of maintaining a second brand — the right trade for a 2–3 person team.

## D11 — Contribution intake: CLA gate before publish

**Decision.** Stand up the full CLA gate — `CLA.md` (license-type, grants
relicense to Pointa Labs, Inc.), the CLA Assistant bot, and branch protection
requiring the CLA check + review — **before** the repo opens for contributions.

**Why.** The legal risk appears the moment a third party's copyright enters the
tree, i.e. the **first external merge** — not when code is made visible (reading
and forking Apache code is fine). But the publish→first-PR gap is unpredictable
and the gate is ~an hour to set up, so we install it up front. Retrofitting
consent from already-merged contributors is the "brutal to retrofit" trap (D6):
without a signed CLA, a merged contribution is licensed to us under Apache-2.0
but carries **no relicense right**, breaking the reversibility D9 depends on.
