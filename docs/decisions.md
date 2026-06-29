# Key decisions (with the reasoning)

Short ADR-style record of the calls that shaped this project, and *why* — so we
(and contributors) don't relitigate them by accident.

> **2026-05-27+ architecture pivots**: D2 / D3 / D7 (event-log as source of
> truth) were **overturned** when the team replaced the event-log model with
> **MD = content truth + `.bh/` = derived cache + git = history**. D5
> (CLI-first over one core) was later superseded by the Electron desktop path
> and the 2026-06 VS Code-base migration. D8's library picks have also evolved
> (see notes inline). D12–D22 capture the current direction.
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

## D5 — ~~Interface: CLI-first, MCP as a thin wrapper later~~ (superseded by D15 / D19 / D20)

**Original decision.** Ship a CLI first. Add an MCP server later. Both are thin
adapters over one `core`.

**Why it was overturned.** The product became an Electron desktop app first
(D15), then the old CLI package was deleted with the `.bh/mirror/` refactor
(D19), and the 2026-06 migration moved the desktop architecture toward a real
VS Code base rather than one `@basehalf/core` door (D20). Do not restore the
old `bh <cmd>` product path as current architecture.

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

## D14 — Agent protocol = publish, not inject (NEW; file shapes updated by D19)

> **Note (2026-06).** The *principle* (publish a file protocol, don't inject)
> still holds. The specific file shapes below were replaced by the
> `.bh/mirror/` YAML tree — see [D19](#d19--bhmirror-yaml-model-cli--inbound--proposals--focusmd-deleted-new-2026-06).

**Decision.** bh publishes the workspace graph to known paths in `.bh/`:

- `.bh/focus.md` — what the user is currently looking at
- `.bh/badges/<file>.json` — per-file metadata (prompt + references)
- `.bh/index/inbound.json` — reverse-reference index

The agent reads these files (instructed via the CLAUDE.md hint installed at
workspace setup) and navigates the graph itself, deciding what to load and how
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

## D18 — Decisions module retired; corpus moved to MD in private docs (NEW, 2026-05-28)

**Decision.** Remove the `decisions` module from `@basehalf/core` and the
`bh decision` subcommands from the CLI. The team's product / architecture
decisions corpus moves to MD files under `private-docs/decisions/<slug>.md`
(one file per decision, frontmatter + rationale body), grepped and read
directly without a CLI wrapper.

**Why.** The `decisions` module was built for the original v0 wedge ("memory
layer for coding agents" — see [D17](#d17--compound-thinking--the-product-form-new-overturns-earlier-memory-layer-framing)),
where decision provenance was the product's first aha loop. After the pivot
to compound thinking (D17), the target user is no longer a programmer
tracking architecture decisions; it's a curious learner organizing files
([D16](#d16--target-user--curious-learners-using-ai-to-learn-new)). Keeping
`bh decision` as a user-facing feature would misadvertise the product as
"for engineers."

The module's reasonable remaining role — **internal dogfood tool** for the
BaseHalf team to track its own decisions — fits better as plain MD files
alongside the rest of `private-docs/` (which is already MD: IR, SR,
architecture constitution, product vision). MD makes the corpus
human-readable, greppable, and (once the v0 desktop app ships) navigable on
canvas as native badges — without a separate storage format.

**Consequences.** `bh decision *` subcommands no longer exist. The earlier
46-decision JSON corpus has been migrated to `private-docs/decisions/`
(private repo); the new corpus convention is in `private-docs/decisions/README.md`.
The deleted module lives in git history if you ever need to reference its
schema or commands.

## D19 — `.bh/mirror/` YAML model; CLI / inbound / proposals / focus.md deleted (NEW, 2026-06)

**Decision.** Align the code to `private-docs/focus_mode_spec/`. `.bh/` becomes a
per-node **mirror tree** of YAML files instead of the old mix of JSON badges,
a Markdown focus brief, and a separate reverse index:

- `.bh/mirror/<path>/badge.yaml` — a node's `description`, outbound `references`
  (plain paths), and the **embedded** `referenced_by` reverse index.
- `.bh/mirror/<folder>/canvas.yaml` — the visual layer split out of the badge:
  child card positions + `edges` (anchors + labels).
- `.bh/mirror/<path>/focus.yaml` + `.bh/current_focus.yaml` (a symlink) — focus
  flips from a hand-curated active-file list to a **real-time viewport mirror**:
  whatever node the user is looking at IS the focus, and the symlink is the
  agent's single per-turn entry point.
- `.bh/mirror/<file>/adhd.yaml` — per-file reading aids (`highlight_keywords` +
  already-read line-ranges).

**What was deleted.** The `bh` CLI package (the desktop app drives
`@basehalf/core` over IPC — `run(command, args)` is the only door now), the
`inbound` module (the reverse index moved *into* `badge.referenced_by`,
maintained on the target badge), the `proposals` write-back module (overturning
the short-lived agent-write-back experiment), and the `.bh/focus.md`
curated-brief / turn-intent / `# source-folder:` provenance / "Copy brief"
machinery (replaced by the `focus.yaml` viewport mirror). New module: `adhd`.

**Why.** The hand-curated focus brief asked the user to translate what was
already obvious on their screen ("which files, what I'm looking at") into a list.
A viewport mirror removes that step — the agent reads the same node the user is
looking at, with zero bridge-building (this realizes the
[agent-bridge-design](agent-bridge-design.md) "shared attention is free" north
star at the file-protocol level). Splitting `canvas.yaml` out of the badge keeps
the badge a pure semantic layer (plain-path references) and the canvas a pure
visual layer. Embedding `referenced_by` makes "who points at me?" one read.

**Consequences.** This was a **clean break** — no migration of old `.bh/`
layouts (the spec assumes a fresh mirror). Everything except `.bh/cache/` stays
in git so the mirror travels with the folder. The canonical agent-hint text now
lives in `HINT_BODY` in `packages/core/src/modules/workspace/setup.ts`. This
decision supersedes D14's specific file shapes (`.bh/focus.md` /
`.bh/badges/<file>.json` / `.bh/index/inbound.json`) while keeping its principle
intact: **publish a file protocol any file-reading agent can navigate, don't
inject into the agent's context.**

## D20 — VS Code as substrate, BaseHalf as canvas-first product (NEW, 2026-06-30)

**Decision.** The migration uses VS Code as the lower application substrate,
not as the final product shape. Reuse VS Code's native capabilities for files,
working copies, Git/SCM, GitHub auth, quick input, search, editor
infrastructure, workbench services, terminal process/profile APIs, menus,
keybindings, notifications, progress, and dialogs. Keep BaseHalf's own product
layer for the `.bh` mirror protocol, canvas, focus/ADHD state, badge/reference
graph, agent-oriented search/brief logic, canvas-first navigation, and the
right-side Agent Area.

**Why.** The previous hand-rolled VS Code-like Git/SCM/GitHub/workbench refactor
was sunk cost: it tried to chase mature VS Code systems from the outside. Using
VS Code as the base lets BaseHalf inherit those systems while still preserving
what makes the product different: folders are AI-native canvases, the canvas is
the background, opening a card enters a BaseHalf card-detail surface, and
standard VS Code editor groups are fallback/advanced capability rather than the
primary open model.

**Consequences.** `@basehalf/core` becomes historical migration material for the
original product semantics, not the required desktop architecture center. For
Markdown, the text file / VS Code `TextDocument` / working copy is the single
source of truth, with BaseHalf projections inside card detail: rich editable
Markdown by default, raw source editing, and rendered preview. The rich
projection keeps BaseHalf's original BlockNote + per-file YJS live document +
byte-preserving splice-save model.

## D21 — Right side is Agent Area, not Terminal panel (NEW, 2026-06-30)

**Decision.** The right side of the app is an **Agent Area**. Terminal is one
renderer/session type inside it, not the product concept. Agent Area sessions
can be TUI agents (Codex CLI, Claude Code CLI, other shell/TUI agents through
BaseHalf's xterm/pty surface), VS Code-extension agents (through extension host,
webviews, commands, auth/secrets, and terminal APIs), or plain shell sessions.

**Why.** BaseHalf's terminal work already carries important interaction
quality: tabbed sessions, split panes, focus routing, zoom, soft close, and a
TUI-friendly xterm/pty surface. At the same time, VS Code compatibility is how
Codex/Claude-style extensions and the broader extension ecosystem can
participate. The right abstraction is therefore not "use VS Code's terminal UI"
or "keep only a custom terminal", but "route both TUI and extension-backed
agents into one BaseHalf-owned Agent Area."

**Consequences.** New right-side work should model agent sessions, not a generic
terminal panel. Extension calls such as `vscode.window.createTerminal()` should
open or attach to Agent Area sessions rather than reviving the default VS Code
terminal panel as the primary UI. VS Code's native Agent/Chat/Copilot/Sessions
product surfaces should be hidden or removed from BaseHalf: no default agent
views, chat panels, sessions welcome surfaces, status items, or commands should
ship unless they are intentionally remapped into BaseHalf's Agent Area. Their
services and APIs can remain as compatibility plumbing for extensions.

## D22 — Sidebar, extension allowlist, and file-open remapping (NEW, 2026-06-30)

**Decision.** BaseHalf's left sidebar has exactly three product areas: Files,
Git, and Search. Reuse VS Code's Explorer/Search/SCM view containers and their
mature interaction model where possible, including context menus, tree state,
drag/drop, and SCM behavior. Do not add Agent to the sidebar. File activation
from Explorer/Search must remap into BaseHalf navigation: folders open canvases,
files open card detail, and VS Code editor tabs remain fallback/advanced
behavior.

The first VS Code-base migration phase uses a curated extension allowlist, not
the full marketplace. The allowed extension families are Git, GitHub, GitHub
authentication, Codex, and Claude.

**Why.** VS Code's sidebar infrastructure is better than BaseHalf's hand-rolled
sidebar for Files, Git, Search, and right-click workflows, so reusing it reduces
product risk. But BaseHalf's differentiator is the folder-as-canvas model, not
VS Code's generic editor workspace. Similarly, VS Code extension compatibility
is valuable for GitHub auth and Codex/Claude, but exposing the whole marketplace
would force product and trust decisions before the BaseHalf shell is ready.

**Consequences.** Implement a BaseHalf window/contribution profile instead of
importing the stock VS Code desktop workbench wholesale. Keep Explorer/Search/SCM
visible, hide generic Extensions/Marketplace and VS Code-native Agent/Chat
surfaces, and route `open`/file-selection commands through BaseHalf's
folder/canvas/card-detail state machine.
