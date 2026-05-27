# Key decisions (with the reasoning)

Short ADR-style record of the calls that shaped this project, and *why* — so we
(and contributors) don't relitigate them by accident.

> **2026-05-27 architecture pivot**: D2 / D3 / D7 (event-log as source of truth)
> were **overturned** when the team replaced the event-log model with **MD =
> content truth + `.bh/` = derived cache + git = history**. D8's library picks
> have also evolved (see notes inline). D12–D17 below capture the new direction.
>
> The full reasoning for the pivot lives in `private-docs/` (internal: IR-v2,
> SR-v0, 架构宪法). This file keeps a one-paragraph summary per decision plus
> superseded markers so the historical thread stays readable.

## D1 — We are a substrate, not an agent (still active)

**Decision.** Build the storage + write-path + retrieval layer. Do **not**
build agent orchestration: no planning, no model calls, no agent loop, no
task-specific features ("arrange into a heart").

**Why.** The agent is Claude Code / Codex / Cursor. Their reasoning improves
every month; re-building it means perpetually trailing the frontier and
competing with our own distribution channel. We provide capability primitives;
the agent provides intelligence.

**Consequences.** No Vercel AI SDK / OpenAI Agents SDK / LangGraph in core. The
agent-facing surface is a **published file protocol** (see D14), not an
embedded runtime.

## D2 — ~~One write path: the Command Bus → Event Log~~ (superseded by D12)

**Original decision.** Every change (user, agent, import, future sync) goes
through one fixed set of commands, each producing an event. No second write
path.

**Why it was overturned.** The "Command Bus → Event Log → Reducer → Projection"
loop was a heavy invariant to enforce against agents that already have their
own file tools (`Edit`, `Write`, `Bash`). Asking agents to route every MD edit
through `bh` was friction we couldn't justify. **D12** simplifies: MD is the
truth; agents edit it directly; bh is a passive observer with one writable
domain (`.bh/`).

## D3 — ~~The event log is the source of truth~~ (superseded by D12)

**Original decision.** The append-only event log is canonical; SQLite tables,
search indexes, editor state — all derived and rebuildable.

**Why it was overturned.** Event-log-as-truth was a second source of truth
parallel to the user's actual files. When the user's MD file says X and the
log says Y, the user trusts the file, not the log — by Hyrum's law on disk.
**D12** makes MD the truth (Obsidian-style) and `.bh/` derived. Git provides
history/undo (D13).

## D4 — Grounded + auditable + reversible (re-scoped by D12 / D13)

**Original decision.** The substrate enforces provenance, sources, audit, and
undo at the write contract.

**What changed.** The "agent literally can't write an un-attributed fact" line
was tied to D2/D3. Now that agents edit MD directly, **audit comes from git**
(every commit is signed work, with author + timestamp + diff); **grounding** is
optional metadata (badge.references) that the agent can read and use. We don't
*enforce* grounding at write time anymore — we make it cheap and obvious.

## D5 — Interface: CLI-first, MCP as a thin wrapper later (still active)

**Decision.** Ship a CLI first. Add an MCP server later. Both are thin
adapters over one `core`.

**Why.** Every local coding agent has a shell → the CLI reaches all of them
with zero config, and doubles as the human tool + test harness. The desktop
app (D15) is another thin adapter over the same core.

## D6 — Local-first now; collaboration deferred but pre-wired (still active)

**Decision.** No real-time collaboration / Yjs / sync server in v0/v1. Pre-wire
the seams that make it possible later: globally-unique IDs, soft-delete
tombstones (in `.bh/`), git as the conflict-resolution layer.

## D7 — ~~Event tiering + compaction~~ (no longer applicable — no event log)

**Why it was dropped.** D2/D3 overturn (D12) means no append-only event log at
all. Storage stays naturally bounded by the size of MD files + `.bh/` JSON.
High-frequency events (e.g., per-keystroke text) don't apply — the editor
writes to MD on save, not per-keystroke.

## D8 — Stack: TS + SQLite-when-needed; build on existing OSS (updated)

**Decision.** TypeScript + Node + Electron for the production stack. Start
with **flat JSON files** in `.bh/`; swap to SQLite (+ FTS5) only when search /
list performance demands it (rough trigger: > 5k files in a workspace).

**Library picks** (the ones we actually use):

- **Block editor:** **BlockNote** — closest to Notion experience; React-native; MIT
- **Canvas:** **React Flow** (`@xyflow/react`) — free-position + edges, MIT
- **PDF:** **pdf.js** — the de-facto in-browser PDF renderer
- **File watcher:** **chokidar** — wraps FSEvents on macOS
- **Renderer state:** **Zustand**

**Library picks that did *not* survive vetting:**

- ~~tldraw~~ — source-available, requires commercial license (see
  [dependency-policy.md](dependency-policy.md))
- ~~BlockSuite~~ — MPL-2.0 weak copyleft + complexity overhead vs BlockNote for
  our use case
- ~~ProseMirror + Tiptap from scratch~~ — too much UI to build vs picking
  BlockNote which is already Notion-shaped

Rust sidecars (Tantivy / notify-rs) are deferred per the architecture
constitution — only profile-driven, not pre-built.

## D9 — License & IP: Apache-2.0 + CLA + (long-term) open-core (still active, with timing note)

**Decision.** Apache-2.0 core; require a CLA; monetize via a cloud/team layer
(open-core); trademark the product name.

**Timing (added 2026-05-27).** **v0 and v1 are fully open source + free** —
no paid tier, no feature gating, no commercial editions. The open-core paid
layer (cloud sync / team / SSO) is a v1+ option that we'll decide on when the
product is mature. The CLA is set up now because it keeps the option open;
nothing is being commercialized today.

## D10 — Naming & brand: single brand "BaseHalf" + edition words + trademark policy (still active)

**Decision.** The product is **BaseHalf** (by Pointa Labs, Inc.;
basehalf.com). Use **one brand** across editions, distinguished by *edition
words* — **BaseHalf** (open, Apache-2.0) — rather than separate brands.
Protect with a trademark policy ([trademark-policy.md](trademark-policy.md))
rather than a second product name.

## D11 — Contribution intake: CLA gate before publish (still active)

**Decision.** Stand up the full CLA gate before the repo opens for
contributions: `CLA.md`, the CLA Assistant bot, branch protection requiring
the CLA check + review.

## D12 — MD = content truth; `.bh/` = derived cache; git = history (NEW, overturns D2/D3)

**Decision.** Markdown files on disk are the source of truth for content.
Anything BaseHalf adds (badge metadata, canvas positions, references) lives
under `.bh/<workspace-root>/`. Git provides history and undo.

**Why.** Two reasons:

1. **Agents already edit MD directly.** Trying to route every agent edit
   through `bh` was friction we couldn't enforce. Treating MD as the truth and
   bh as an observer matches reality.
2. **Obsidian vault model.** Users can open the same folder with Obsidian /
   VSCode / any editor. bh adds a layer; bh's absence doesn't lock users out.

**Consequences.** The watcher (chokidar + reconcile-on-launch) is how bh stays
in sync with external edits. Modules that touch user files must be
**observers**, never owners.

## D13 — bh never modifies user files unprompted (NEW, scope clarification)

**Decision.** bh's own code never writes to user files (`.md`, `.pdf`,
`.docx`, etc.) in the background. The only writes to user files happen when
the user explicitly edits something through the BaseHalf UI (block editor,
rename in file tree, etc.) — at which point bh is the editor, doing the
user's bidding.

**Why.** The Apache-2.0 / Obsidian-vault promise is "your files are yours." A
silent rewrite of frontmatter, formatting normalization, or auto-tagging
violates that. The agent edits MD with its own tools — that's a separate path
bh doesn't gate.

## D14 — Agent protocol = publish, not inject (NEW)

**Decision.** bh publishes the workspace graph to known paths in `.bh/`:

- `.bh/focus.md` — what the user is currently looking at
- `.bh/badges/<file>.json` — per-file metadata (prompt + references)
- `.bh/index/inbound.json` — reverse-reference index

The agent reads these files (instructed via the CLAUDE.md hint installed by
`bh init`) and navigates the graph itself, deciding what to load and how
deep based on its own token budget.

**Why.** bh runs on the right screen; the agent runs on the left screen
(Claude Code / Codex). bh has no access to the agent's system prompt or
context window. The publish model works for **any** agent that can read
files — no MCP server required.

**Contrast with inject-style designs.** Some products build a context graph
server-side and inject the assembled result into the agent's system prompt.
That model doesn't fit here — bh runs alongside an external agent it has no
control over, so we can't (and shouldn't) try to dictate token budget or
traversal depth on the agent's behalf.

## D15 — Electron desktop app, Mac first, cross-platform target (NEW)

**Decision.** The production product is an Electron desktop app. Mac is the
first platform; Windows follows; Linux comes when there's pull. The CLI
remains the agent-facing surface; the desktop app is the human-facing one.

**Why.** Electron because we want to reuse React + BlockNote + React Flow on
the renderer and a Node main process for filesystem + chokidar (same model as
Obsidian / VSCode). Mac first because the team dogfoods on Mac and target
users (curious learners using AI tools) over-index on Mac.

## D16 — Target user = curious learners using AI to learn (NEW)

**Decision.** The primary user is **someone who learns new things with AI**
— students cramming, PMs ramping on a new domain, anyone teaching themselves
a field by chatting with Claude / Codex. The product is *not* scope-locked
to one persona; the affordances are generic.

**Why.** This user feels the pain BaseHalf solves: chat context evaporates,
files are scattered, Notion / Obsidian don't fit AI workflows, and the right
screen is empty space waiting to be useful. They're the natural beachhead.

## D17 — Compound thinking = the product form (NEW, overturns earlier "memory layer" framing)

**Decision.** BaseHalf is a **compound thinking workspace** — a place to
recombine fragments (files + notes + references) into new views, repeatedly,
without copying. Earlier framing as a "memory layer for coding agents" was a
narrower wedge that didn't match what users actually do with the product.

**Why.** Eight-question interview with the founder (2026-05-27) clarified
that the killer use case isn't "agent recall" — it's "I have a folder of
stuff, help me think with it." The agent makes this 10x better but isn't
the *point*. The point is the right screen being usable for thought.
