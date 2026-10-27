# Key decisions (with the reasoning)

Short ADR-style record of the calls that shaped this project, and *why* — so we
(and contributors) don't relitigate them by accident.

> **2026-05-27+ architecture pivots**: D2 / D3 / D7 (event-log as source of
> truth) were **overturned** when the team replaced the event-log model with
> **MD = content truth + `.bh/` = local derived mirror + git = user-file history**. D5
> (CLI-first over one core) was later superseded by the Electron desktop path
> and the 2026-06 VS Code-base migration. D8's library picks have also evolved
> (see notes inline). D12–D44 capture the current direction; D35–D38
> (2026-09) revise parts of D12, D13, D14, D19, D24, D36, and D37 as noted inline,
> D39 (2026-10) refines D21, D40 (2026-10) refines D12 and D19, D41
> (2026-10) refines D37 and D40, D42 (2026-10) refines D37, D43
> (2026-10) refines D36, and D44 (2026-10) refines D37, D40, and D43.
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

**Decision.** No multi-user real-time collaboration or sync server in v0/v1.
The rich Markdown projection may use one local, per-file YJS document so edits
merge incrementally and the collaboration seam exists without making YJS a
second content truth. Markdown files remain truth and git remains the external
conflict-resolution layer.

## D7 — ~~Event tiering + compaction~~ (no longer applicable — no event log)

**Why it was dropped.** D2/D3 overturn (D12) means no append-only event log at
all. Storage stays naturally bounded by the size of MD files plus local `.bh/`
YAML mirror state.
High-frequency events (e.g., per-keystroke text) don't apply — the editor
writes to MD on save, not per-keystroke.

## D8 — Stack: TS + SQLite-when-needed; build on existing OSS (updated)

**Decision.** TypeScript + Node + Electron for the production stack, with VS
Code as the desktop substrate. User files hold content truth and sparse YAML
under `.bh/mirror/` holds derived product metadata. Add SQLite (+ FTS5) only
when a measured local index or search workload demands it.

**Library picks** (the ones we actually use):

- **Block editor:** **BlockNote** — closest to Notion experience; React-native; MIT
- **Canvas:** **React Flow** (`@xyflow/react`) — free-position + edges, MIT
- **PDF:** **EmbedPDF** (`@embedpdf/snippet`) — ready viewer UI on self-hosted PDFium WASM; MIT
- **Rich projection:** **YJS** — local per-file live document; Markdown stays truth; MIT
- **Files, watching, workbench state:** VS Code-native services

**Library picks that did *not* survive vetting:**

- ~~tldraw~~ — source-available, requires commercial license (see
  [dependency-policy.md](dependency-policy.md))
- ~~BlockSuite~~ — MPL-2.0 weak copyleft + complexity overhead vs BlockNote for
  our use case
- ~~ProseMirror + Tiptap from scratch~~ — too much UI to build vs picking
  BlockNote which is already Notion-shaped
- ~~pdf.js with a hand-built viewer shell~~ — excellent low-level renderer, but
  recreating search, outline, selection, zoom, virtualization, and accessibility
  is unnecessary while EmbedPDF provides a permissive ready-made viewer
- ~~standalone chokidar / Zustand desktop orchestration~~ — superseded by the
  real VS Code workbench, file, working-copy, and contribution services

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

## D12 — MD = content truth; `.bh/` = local derived mirror; git = user-file history (NEW, overturns D2/D3; references revised by D37)

> **Note (2026-09, D37).** References are no longer BaseHalf-added metadata
> under `.bh/`: each is stored once by its downstream node, in Markdown
> frontmatter or `.bhnode` for those kinds. BaseHalf no longer ignores `.bh/`
> in git; see [workspace state](specs/workspace-state-and-legacy-cleanup.md).

**Decision.** Markdown files on disk are the source of truth for content.
Anything BaseHalf adds (badge metadata, canvas positions, references) lives
under `.bh/` as local derived mirror/runtime state. Git provides history and
undo for user-authored files; `.bh/` itself is ignored.

**Why.** Two reasons:

1. **Agents already edit MD directly.** Trying to route every agent edit
   through `bh` was friction we couldn't enforce. Treating MD as the truth and
   bh as an observer matches reality.
2. **Obsidian vault model.** Users can open the same folder with Obsidian /
   VSCode / any editor. bh adds a layer; bh's absence doesn't lock users out.

**Consequences.** The watcher (chokidar + reconcile-on-launch) is how bh stays
in sync with external edits. Modules that touch user files must be
**observers**, never owners.

## D13 — bh never modifies user files unprompted (NEW, scope clarification; revised for references by D37)

> **Note (2026-09, D37).** Explicit reference operations, a confirmed or
> opted-in rename refactor, and a confirmed migration may edit the `upstream`
> frontmatter key (see [reference graph](specs/reference-graph.md#invariants)).
> Nothing else changes: background services still never write user files.

**Decision.** bh's own code never writes to user files (`.md`, `.pdf`,
`.docx`, etc.) in the background. The only writes to user files happen when
the user explicitly edits something through the BaseHalf UI (block editor,
rename in file tree, etc.) — at which point bh is the editor, doing the
user's bidding.

**Why.** The Apache-2.0 / Obsidian-vault promise is "your files are yours." A
silent rewrite of frontmatter, formatting normalization, or auto-tagging
violates that. The agent edits MD with its own tools — that's a separate path
bh doesn't gate.

## D14 — Agent protocol = publish, not inject (NEW; file shapes updated by D19; delivery refined by D36)

> **Note (2026-09, D36).** BaseHalf no longer writes a hint into `CLAUDE.md`.
> Agent Area Claude Code sessions receive a static, workspace-independent
> instruction at launch; BaseHalf still never injects workspace content.

> **Note (2026-06).** The *principle* (publish a file protocol, don't inject)
> still holds. The specific file shapes below were replaced by the
> `.bh/mirror/` YAML tree — see [D19](#d19--bhmirror-yaml-model-cli--inbound--proposals--focusmd-deleted-new-2026-06-focus-superseded-by-d35-references-by-d37-hint-and-git-policy-by-d36).

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

> **Revised by D95 (2026-10-27).** BaseHalf has no single main user: learners
> are among the people it is for, with creators of AI media, people who think
> in maps, and people who review code. The rest of D16 stands.

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

## D19 — `.bh/mirror/` YAML model; CLI / inbound / proposals / focus.md deleted (NEW, 2026-06; focus superseded by D35, references by D37, hint and git policy by D36)

> **Note (2026-09).** `focus.yaml` and `current_focus.yaml` are removed (D35).
> Badge `references`/`referenced_by` are replaced by downstream `upstream`
> lists (D37). The `HINT_BODY` workspace hint and the claim that all of `.bh/`
> is git-ignored no longer hold (D36,
> [workspace state](specs/workspace-state-and-legacy-cleanup.md)).

**Decision.** Align the code to `private-docs/focus_mode_spec/`. `.bh/` becomes a
per-node **mirror tree** of YAML files instead of the old mix of JSON badges,
a Markdown focus brief, and a separate reverse index:

- `.bh/mirror/<path>/badge.yaml` — a node's `description`, outbound `references`
  (plain paths), and the **embedded** `referenced_by` reverse index.
- `.bh/mirror/<folder>/canvas.yaml` — the visual layer split out of the badge:
  child card positions + `edges` (endpoints + anchors).
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
layouts (the spec assumes a fresh mirror). The whole `.bh/` tree is local
derived runtime state and is ignored by git. The canonical agent-hint text now
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

## D22 — Sidebar, extension allowlist, and file-open remapping (REVISED, 2026-07-13)

*Narrowed by D45: the Plugins library is removed and the sidebar has three
areas.*

*Extended by D51: the default themes extension is an allowed family too.*

**Decision.** BaseHalf's left sidebar has exactly four product areas: Files,
Git, Search, and a BaseHalf-owned Plugins library. Reuse VS Code's native
Activity Bar/view-container lifecycle, Explorer/Search/SCM mechanics, the
native extension-row renderer and ActionBar, context menus, settings, tree
state, drag/drop, and SCM behavior. Plugins is a curated BaseHalf catalog, not
the stock Extensions Marketplace. Do not add Agent or
plugin-defined global sidebars. File activation from Explorer/Search must remap
into BaseHalf navigation: folders open canvases, files open card detail, and VS
Code editor tabs remain fallback/advanced behavior.

The initial BaseHalf product profile uses a curated extension allowlist, not the
full marketplace. The allowed extension families are Git, GitHub, GitHub
authentication, Codex, and Claude.

**Why.** VS Code's sidebar infrastructure is better than BaseHalf's hand-rolled
sidebar for Files, Git, Search, Plugins, and right-click workflows, so reusing it reduces
product risk. But BaseHalf's differentiator is the folder-as-canvas model, not
VS Code's generic editor workspace. Similarly, VS Code extension compatibility
is valuable for GitHub auth and Codex/Claude, but exposing the whole marketplace
would force product and trust decisions before the BaseHalf product surface is
ready.

**Consequences.** Implement a BaseHalf window/contribution profile instead of
importing the stock VS Code desktop workbench wholesale. Keep
Explorer/Search/SCM and the BaseHalf Plugins container visible, hide generic
Extensions/Marketplace and VS Code-native Agent/Chat surfaces, and route
`open`/file-selection commands through BaseHalf's folder/canvas/card-detail
state machine. The Plugins container may reuse native menus, settings, and
extension-management services, but only the signed client-admitted catalog is
shown or installable.

## D23 — Module-complete migration, not MVP or intermediate shell (NEW, 2026-06-30)

**Decision.** The VS Code-base migration is not an MVP, spike, or temporary
shell. BaseHalf should be rebuilt as a complete product on top of VS Code's
architecture, module by module. Work may be sequenced and committed in pieces,
but a module is not considered done until it reaches product quality.

Each module's definition of done must include the relevant VS Code source
comparison, the chosen keep/delete boundary against old BaseHalf code, complete
expected UI states, interaction behavior, error/empty/loading states, and tests
or explicit verification. Temporary scaffolding is allowed only as local
construction support; it should not become a named product milestone or the
target state. A module cannot exit with placeholder UI, disconnected command
handlers, TODO-only integration seams, or behavior that is merely demonstrated
instead of usable.

When a large module must be split, each commit should name the smaller coherent
submodule it completes, such as routing, document ownership, preview rendering,
or focus mirror write-back. Those slices must still be complete for their stated
scope. Do not land user-visible dead ends, disabled controls, fake data, or
detached UI that exists only to reserve space for a later pass. The product can
be incomplete across modules, but a shipped path should not be intentionally
half-working inside the module currently being claimed.

**Why.** The failed hand-rolled Git/SCM/GitHub refactor showed that partial
reimplementations accumulate subtle UI and behavior mismatches. The new
strategy is valuable only if each module is carried far enough to replace old
BaseHalf behavior with a durable VS Code-aligned implementation. A "minimal
shell first" framing would invite half-built surfaces and defer the hard
integration questions until they are harder to fix.

**Consequences.** Planning should use module tracks rather than MVP stages:
workbench/window profile, Explorer/files/navigation/canvas, Git/SCM/GitHub,
search/quick input, Markdown/rich editor, Agent Area/terminal/extension agents,
extension allowlist/auth/secrets, `.bh` mirror integration, theming/layout, and
packaging/dev loop. Each track can be parallelized, but it should exit only
when the module is coherent enough to be kept, not merely demonstrated.

## D24 — References are explicit directed context flow; Markdown links only navigate (NEW, 2026-07-11; storage superseded by D37)

> **Note (2026-09, D37).** The semantics below stand. The two-endpoint
> storage, the "complete only when both endpoints agree" rule, and
> Repair/Discard are superseded: each reference is stored once by its
> downstream node.

**Decision.** BaseHalf's reference graph is a general directed context-flow
graph. `A → B` means that A's context flows into B: A's outbound `references`
contains B, and B's `referenced_by` contains A. This is not a containment tree.
Many-to-many relationships and directed cycles are valid; self-references are
not. A relationship is complete only when both mirror endpoints agree.

References are created only by an explicit user or Agent action. A Markdown
link is ordinary document navigation and does not create, remove, or otherwise
mutate a BaseHalf reference. Users and Agents may explicitly create cards and
reference relationships independently of the links inside those files.

`canvas.yaml` is only the visual projection of that semantic graph. Its edge
rows store endpoints and anchors, with no relationship `label`, `note`, or type.
If explanatory prose is useful, it belongs in an authored document, not in a
second hidden metadata field on the edge.

**Why.** Giving every edge one stable meaning makes the graph legible to people
and Agents without asking either to interpret free-form edge copy. It also keeps
Markdown content, navigation links, semantic context flow, and canvas geometry
as separate concerns instead of allowing one representation to silently create
or duplicate another.

**Consequences.** Relationship-label input, display, editing, APIs, and
persistence are removed. This is a clean break: legacy label-bearing mirror
data and label-specific fixtures are not compatibility contracts, and no
migration runs for them. Readers ignore retired label fields; canonical future
writes contain only endpoints and anchors. A one-sided external mirror write
fails closed: BaseHalf does not draw it or list it as a live relationship. The
Badge surface instead marks the incomplete pair and offers explicit Repair and
Discard actions. If the other endpoint cannot be read, BaseHalf reports that
metadata problem without guessing whether the pair is incomplete. Automated
services do not silently rewrite either case.

## D25 — Plugin platform: fixed shell, open center (NEW, 2026-07-12)

*Frozen by D45: the product has no plugin surface and admits only its
built-in AI Video.*

**Decision.** BaseHalf is a general AI-native file manager with a formal plugin
ecosystem. Its product shell stays fixed: Files/Git/Search/Plugins on the left,
BaseHalf-owned navigation around the center, and Agent Area on the right.
The Plugins entry is the BaseHalf-owned manager for that ecosystem; individual
plugins cannot add Activity Bar entries. D33 narrows the original “open center”
language: plugins add domain Recipes and Templates to the main canvas, plus card
previews and file-specific Card Detail Projections inside that shell; they do
not add a parallel canvas, project mode, or execution lifecycle. They may not
add competing global product areas, restore tab-first navigation, or change
BaseHalf reference semantics.

**Why.** A plugin can add substantial domain capability inside a protected
engine contract without rewriting the launcher, save system, main canvas, or
global controls. This keeps BaseHalf extensible without dissolving its product
identity into a generic VS Code distribution.

**Consequences.** The plugin system reuses VS Code's extension host and
extension lifecycle beneath BaseHalf-specific provider APIs. The first code
plugins are first-party and curated; the generic Marketplace remains hidden.
Reviewed domain-plugin payloads are installed into the user's extension profile
on demand instead of being pre-scanned system extensions. Disabling a plugin
falls back to ordinary BaseHalf folder/file surfaces.

## D26 — Code plugins are trusted local software (NEW, 2026-07-12)

**Decision.** BaseHalf follows VS Code's trust model for executable plugins:
publisher identity, allowlists, workspace trust, package verification,
enablement, and lifecycle management. A Node extension is honestly treated as
trusted local software, not presented as a finely sandboxed capability.

**Why.** Rebuilding an extension runtime would duplicate mature VS Code
infrastructure without removing the fundamental authority of executable local
code. BaseHalf can be stricter at admission instead: only official code plugins
initially, then curated/reviewed third-party plugins when the ecosystem is
ready. Declarative content packs can open earlier.

**Consequences.** BaseHalf core remains passive and contains no embedded LLM or
agent loop. A plugin's use of AI is its own disclosed product policy. Arbitrary
Marketplace extensions are not enabled merely because the underlying VS Code
extension host can run them.

## D27 — Plugin workflow output is local user-owned data (NEW, 2026-07-12)

> **Revised by D63 (2026-10-22).** What made a generated file, and a draft
> before its file exists, are card information in `.bh/mirror/`; the
> generated content itself stays an ordinary file in the user's folder. The
> rest of D27 stands.

**Decision.** Users and their Agents may explicitly execute plugin workflows.
Workflow definitions, project files, and generated artifacts are ordinary
local user files. BaseHalf and official plugins do not retain a BaseHalf-cloud
copy of project content; external providers receive the inputs submitted to
their operations.

**Why.** An open-center plugin surface is useful only if it can produce real
work, while BaseHalf's local-first promise requires that work to remain in the
user's project instead of an opaque service or extension database.

**Consequences.** Domain content truth never lives in `.bh/mirror`; `.bh/`
remains derived mirror/cache state. Explicit workflow execution is compatible
with D13's prohibition on unprompted automated writes. Uninstalling a plugin
does not remove or lock the files it produced.

## D28 — AI Video is the first official domain plugin (NEW, 2026-07-12)

*Changed by D45: AI Video is built in, not installed as a plugin. Its domain
boundary stands.*

**Decision.** After the plugin platform is ready, AI Video is the first official
domain plugin. It covers scripts, characters/scenes, storyboards and shot tasks,
Agent-assisted authoring, and connections to user-chosen video and voice
providers. Generated media returns to the local project.

**Why.** AI video work exposes the exact cross-tool, local-asset, workflow, and
Agent-context problems the plugin platform is intended to solve, while keeping
the general BaseHalf product independent of one vertical.

**Consequences.** The plugin stays provider-neutral and does not become a
timeline editor, compositor, grading tool, or final-cut application. Those jobs
remain with mature external editing products. The initial official plugin is
free and open source; connector packaging and automation policy remain
plugin-level decisions.

## D29 — Official plugin distribution uses a signed static catalog (NEW, 2026-07-13)

*Frozen by D45: the client fetches no catalog. The registry stays online for
builds that are already distributed.*

**Decision.** BaseHalf distributes its initial official plugins through a
product-owned, ECDSA P-256/SHA-256 signed catalog and immutable VSIX objects in
private S3 behind CloudFront. Client code owns admission: a server catalog may
publish versions only for extension IDs already allowed by that client build.
The generic Marketplace and arbitrary VSIX installation remain hidden.

**Why.** This keeps the first distribution plane small, cacheable, auditable,
and independent of the existing web application servers. VS Code already owns
profile installation, scanning, enablement, Extension Host lifecycle, and
uninstall; BaseHalf needs only authenticated discovery and package delivery,
not a second extension runtime or a premature Open VSX deployment.

**Consequences.** A single short-cache index points to one immutable
catalog/signature pair under `catalogs/<sequence>/`, preventing CDN publication
tearing. The client verifies exact catalog bytes, index/sequence agreement,
monotonic sequence, allowlist, compatibility, SHA-256, VSIX identity/version,
and HTTPS origin in that order. Verified catalog cache is usable offline; code
updates remain an explicit user action. Production packaging fails unless a
pinned P-256 public key is stamped into the client. CI signs through a
non-exportable AWS KMS key and never overwrites a VSIX. Rollback and withdrawal
publish a higher catalog sequence.
Open VSX, third-party publishing, payment, ratings, and the current EC2 stack
remain outside this decision.

## D30 — Curated community publishing uses one Basehalf account and a signer-separated pipeline (NEW, 2026-07-14)

*Frozen by D45, together with D31 and D32: community publishing is closed.*

**Decision.** Community developers use their existing Basehalf account and one
Publisher identity; there is no separate developer account. Publication is
curated: the CLI uploads an immutable candidate to private quarantine, the
server independently validates it, a human reviewer approves or rejects the
exact artifact, and a separately authorized worker promotes approved jobs into
the KMS-signed catalog. A reviewed Publisher identity in that catalog is a
dynamic client trust grant; it cannot impersonate a compiled official ID.

**Why.** Reusing the product account removes needless identity friction, while
separating upload, review, and signing prevents a compromised web process or
reviewer session from publishing arbitrary executable code. Dynamic signed
admission lets the ecosystem grow without shipping a new desktop build for each
reviewed plugin.

**Consequences.** Publishers must accept the current CLA and publishing terms.
CLI tokens are expiring, Publisher-scoped, revocable, and stored hashed on the
server. Quarantine is private and is never a CDN origin. Structural VSIX checks,
source disclosure, and human review are required, but executable plugins remain
honestly described as trusted local software rather than sandboxed code. The
generic Marketplace, arbitrary VSIX installation, instant self-publication,
payments, ratings, and reviews are still not product surfaces.

## D31 — Plugin portal and signed registry use separate subdomains (NEW, 2026-07-14)

**Decision.** `plugins.basehalf.com` is the human-facing publishing and review
portal, implemented and deployed independently from the main web product.
`registry.basehalf.com` is the machine-facing signed catalog and immutable VSIX
origin. Both use the existing Basehalf account, but the portal receives its own
host-scoped browser session through a short-lived, one-use handoff from
`basehalf.com`; refresh cookies and browser storage are never shared across the
two product origins.

**Why.** Publishing is an ecosystem workflow with a different information
architecture, release cadence, and security boundary from the main product.
Likewise, a static code-distribution origin should not also serve account UI or
dynamic APIs. Separating all three surfaces makes their responsibilities clear
without imposing a second developer account.

**Consequences.** New desktop builds fetch only from the registry origin. The
portal host exposes only identity and plugin APIs. Old registry paths on the
portal hostname remain a read-only compatibility proxy for already shipped
clients during a bounded migration window. The one-time handoff is random,
stored only as a hash, consumed atomically, and fails closed when its transient
store is unavailable.

## D32 — Publishing is one front-stage action; VS Code owns installed lifecycle (NEW, 2026-07-16)

**Decision.** The supported developer path is `bh-plugin publish` from a local
plugin project. The first run opens one browser confirmation that can accept
current agreements, create the manifest-declared personal Publisher namespace,
and authorize the machine. The portal shows release status and revocable
machine access; it does not duplicate scaffolding, plugin registration, or VSIX
upload. BaseHalf keeps its signed catalog and verified download path, then
delegates installed extension lifecycle and runtime-state actions to VS Code.

**Why.** Publisher identities, device authorization, quarantine, review,
signing, and catalog publication are necessary security controls, but they do
not need to become separate developer tasks. VS Code already provides mature
profile installation, enablement, settings, context menus, Extension Host
restart, uninstall, and product-update restart behavior.

**Consequences.** `login` and `status` remain advanced CLI commands rather than
happy-path prerequisites. Publisher scope remains an enforceable backend trust
boundary even when personal Publisher creation is folded into first
authorization. The website never becomes an alternate package builder or
installer. Plugin updates remain explicit and use BaseHalf's signed metadata
instead of the generic Marketplace.

## D33 — The main canvas unifies content and optional execution; domain plugins contribute recipes (NEW, 2026-07-18)

**Decision.** BaseHalf has one primary canvas node model. Ordinary text, code,
files, images, video, and audio remain user-owned local content. File, image,
video, audio, PDF, and presentation result containers may also carry an
optional Recipe, explicit Run lifecycle, selected Current result, and immutable
History. The existing reference edge keeps one meaning: `A → B`
provides A as direct context to B. It never becomes an automatic execution edge
or recursively runs upstream nodes.

Text and code remain ordinary editable file cards and can be direct Recipe
inputs. They are not `.bhnode` result containers. Executable result containers
use `file`, `image`, `video`, `audio`, `pdf`, or `presentation`, preventing one
piece of authored text or source code from acquiring two competing interaction
models.

Domain plugins extend this model by contributing reviewed recipes, templates,
input roles, parameter validation, and executors. They do not own a parallel
canvas engine, duplicate node/edge persistence, or replace host Run, Current,
History, media preview, and failure recovery. Plugin project truth remains
ordinary readable local files, never `.bh/mirror` or extension-private storage.

**Why.** A second domain canvas makes the same Text/Image/Video/Audio object,
reference, selection, and history concepts behave differently depending on
where the user opened them. One host model gives users and Agents a stable
grammar while preserving plugin-level domain expertise.

**Consequences.** AI Video remains the first official domain capability pack,
but no longer registers a separate workflow canvas or creates new `.aivideo`
projects. It contributes shot/sequence conventions, video-domain recipes,
templates, input binding choices, and executors. Existing `.aivideo` files stay
readable as ordinary JSON; the prototype format receives no long-lived
compatibility layer. The general plugin ecosystem and its signed distribution
remain unchanged. Visual Group/Ungroup is not simulated with folder moves or
private canvas rows: it remains absent until a portable, user-owned grouping
document and its delete/undo semantics are defined. Selection UI exposes only
structural actions that have a complete persisted meaning today.

## D34 — Executable media nodes seal one local result after immutable attempts (NEW, 2026-08-13)

**Decision.** Executable media nodes use a `Draft → Attempt → Result`
lifecycle. A Draft owns editable Recipe settings. Every explicit submission
freezes one immutable Attempt. The first successful Attempt seals the same
canvas node as a Result bound to exactly one ordinary local file. A sealed
Result cannot edit its generation Recipe, replace its media, run again, or
switch between successful files. A failed, cancelled, or interrupted Attempt
may retry on the same node only when its model and input snapshot finished
freezing; Retry must reproduce that exact configuration. If preparation stopped
before the snapshot was complete, or if model, parameters, or inputs changed,
the user copies the settings into a new Draft instead.

The node owns one host-level `prompt` independently of any installed Recipe.
It remains editable and persistable before a Recipe is chosen, then freezes
into each Attempt beside the Recipe, model, and direct-input snapshots.
Executors receive it as a dedicated request field; Recipe parameters do not
duplicate it.

Attempt is durable audit data, not another canvas card. Copying settings creates
a new Draft without a context edge. Using an existing result as provider input
creates a named input binding and the ordinary explicit `A → B` context edge.
Task status is host-owned node state and does not depend on an Agent renderer or
conversation remaining open. This lifecycle supersedes D33's `Current` selector
and multi-success History behavior while preserving its single-canvas, Recipe,
executor, local-file, and reference-edge boundaries.

**Why.** A local file has an identity users can play, move, reference, diff,
and delete. Letting one card silently point at different successful files makes
that identity unstable and makes a context edge ambiguous. Sealing one file per
result keeps the graph truthful while immutable Attempts retain cost, provider,
input, and failure evidence.

**Consequences.** `.bhnode` takes a clean schema-version break; the previous
multi-version format is rejected rather than migrated. One node submission
accepts exactly one output file. A future multi-output control must pre-create
one result slot per requested file and share batch provenance; until that host
orchestration exists, recipes that return multiple files are rejected. A batch
is not a referenceable canvas node or a simulated persistent Group.

## D35 — The focus mirror is removed (NEW, 2026-09-27; its non-goal of a live signal revised by D57)

**Decision.** BaseHalf no longer mirrors the user's live position into
`.bh/current_focus.yaml` or `.bh/mirror/**/focus.yaml`. The per-folder canvas
viewport, the only focus data BaseHalf itself read back, moves to per-machine
VS Code workspace storage. Earlier focus artifacts are removed by the legacy
cleanup in
[workspace state and legacy cleanup](specs/workspace-state-and-legacy-cleanup.md).

**Why.** The mirror depended on every agent voluntarily reading a file each
turn, which none did reliably. It went stale when the user returned from Card
Detail to a canvas or left the app, and it gave no freshness signal. It
reported rendered-text columns as source columns and lacked selection ranges.
It churned git on every cursor move. Meanwhile, agents' own `@` file mentions
and IDE integrations already let people point at a location explicitly.
Pointing belongs to the agent's interface; BaseHalf's value is the map, not a
second copy of the cursor.

**Consequences.** Supersedes the focus half of D19 and the live-attention part
of the [agent bridge design](agent-bridge-design.md). Viewports no longer
travel with the folder.

## D36 — BaseHalf stops writing agent guides into workspaces (NEW, 2026-09-27)

**Decision.** Opening a folder no longer writes a section into `CLAUDE.md` or
`AGENTS.md`, no longer installs `.bh/agent-harness/`, and no longer edits
`.gitignore`. BaseHalf-owned `.bh/` artifacts from earlier releases are removed
automatically. Sections in user-owned root files are removed only after the
user confirms. Claude Code TUI sessions launched by Agent Area instead receive
a short BaseHalf instruction through `--append-system-prompt`, as specified in
[agent launch context](specs/agent-launch-context.md).

**Why.** The hint was an unprompted write to user files, in tension with D13.
It kept steering agents toward the focus mirror even when BaseHalf was not
running. D14 chose file publishing because BaseHalf could not reach an
external agent's prompt. Agent Area now launches the agent, so launch-time
context reaches it without touching the user's files.

**Consequences.** Refines D14 and D19's "don't inject" restatement. The
principle "publish data, never dictate traversal" stands; BaseHalf injects only
a static, workspace-independent instruction and never workspace content. Codex
TUI, extension agents, and agents outside Agent Area receive no BaseHalf
instruction. They see the `upstream` lists of Markdown files and `.bhnode`
documents in the files themselves, but do not learn canvas workflows, card
descriptions, or the upstream lists of non-Markdown nodes, which live under
`.bh/`. Refined by D38: the launch instruction now tells agents to move files
through `basehalf.workspace.move`.

## D37 — References are stored once, by the downstream node (NEW, 2026-09-27)

> **Revised by D63 (2026-10-22).** No `.bhnode` holds an upstream list any
> more: every node that is not a Markdown note, a draft included, keeps its
> list in `.bh/mirror/<path>/upstream.yaml`. The rest of D37 stands.

**Decision.** A reference `A → B` is stored only by B, as B's `upstream` list.
- A Markdown file keeps the list in YAML frontmatter.
- A `.bhnode` document keeps it in its own `upstream` field.
- Every other node keeps it in `.bh/mirror/<path>/upstream.yaml`.

The reverse direction is derived by an in-memory index and never stored.
BaseHalf changes these lists only through reference operations the user
starts. Markdown edits go through the document's working copy; `.bhnode` and
sidecar edits use compare-and-swap writers. People and agents edit the lists as
ordinary text. Existing two-sided badge pairs migrate after confirmation. The
full contract is [reference graph](specs/reference-graph.md).

**Why.** BaseHalf exists to keep a many-branched learning domain in one place.
Each branch should carry the trunk it grows from, visible wherever the note is
read. Storing the edge in the consuming file, like a source file's imports,
makes the structure part of the text agents already read. For Markdown and
`.bhnode`, the list stays with the downstream file when it moves, even outside
BaseHalf; moving an upstream file outside the workbench leaves visible
dangling entries that can be relinked. It is also portable to other tools.
Storing it once removes one-sided pairs and the multi-file transaction and
Repair/Discard machinery built to reconcile them.

**Consequences.**
- Supersedes D24's two-endpoint model and the badge `references`/`referenced_by`
  storage of D19.
- Revises D12 and D13 for references: a relationship the user creates is user
  content and lives in the downstream store, while BaseHalf still never writes
  in the background. Amends the private IR-v2-13 record for the `upstream` key
  only.
- Supersedes D12's and D19's statement that `.bh/` is ignored by git. Sidecar
  `upstream.yaml` files are reference truth; users who ignore `.bh/` do not
  share the upstream lists of non-Markdown nodes.
- The badge `description` stays in `.bh/`. A sidecar list follows its node only
  through workbench moves.
- `.bhnode` moves to version 4.
- Reviewed plugins may not change `upstream` values.
- Amended by D38: the rename refactor of an agent move also changes these
  lists, without the user's confirmation.

## D38 — Agents move files through BaseHalf (NEW, 2026-09-27)

**Decision.** The host operation `basehalf.workspace.move` moves or renames a
file or folder as the Explorer does, from any Agent Area terminal that has the
node command bridge. The mirror cascade carries the item's description,
appearance, reading aids, canvas layout, and sidecar upstream list, and the
rename refactor updates the entries that name it without prompting unless the
user chose `never`. Claude Code sessions that receive the launch context are
told to use it instead of `mv`, never to fall back to a plain move when it
refuses, and to fall back only when it is unavailable. See
[reference graph](specs/reference-graph.md#agent-moves).

**Why.** Testing the D36 launch context against real Claude Code sessions
showed that agents kept upstream entries correct on a terminal move, but the
metadata under `.bh/mirror/` stayed at the old path. Several of those files
record their own path, and the parent folder's canvas layout names the item,
so asking agents to rewrite them by hand is fragile. BaseHalf already owns that
bookkeeping for Explorer moves.

**Consequences.**
- Refines D36: agents now receive one operation they may run without
  discovery.
- Amends D37 and reference graph Invariant 4: the rename refactor of an agent
  move rewrites entries without the user's confirmation. It rewrites only
  entries the agent could also edit as ordinary text, in the session the user
  opened.
- Codex TUI sessions in Agent Area are not told about the operation, and
  Codex's default sandbox denies the bridge socket, so their moves, like
  terminal moves and agents outside Agent Area, still leave metadata behind.
- The operation is refused in marked source-tree folders.

## D39 — Agent Area terminals identify as BaseHalf and scroll like Ghostty (NEW, 2026-10-09)

**Decision.** Every integrated terminal, which in BaseHalf is always an Agent
Area terminal, reports `TERM_PROGRAM=BaseHalf` with BaseHalf's version and
answers XTVERSION as `BaseHalf(<version>)`. It turns the mouse wheel into
input with Ghostty's semantics: one wheel report, or one cursor key in the
alternate buffer, per row of accumulated scroll. Because Claude Code no longer
applies its xterm.js-only glyph-atlas reset, the terminal clears its WebGL
glyph atlas itself before the atlas starts merging pages. See
[Agent Area terminal](specs/agent-area-terminal.md).

**Why.** Scrolling Claude Code's fullscreen renderer in Agent Area stuttered,
and measurement put the cause at the terminal boundary, not in rendering.
xterm.js sends at most one damped report per wheel event, and agents that
recognize xterm.js compensate with velocity guesses. Claude Code's curve
produced 3-row steps with stalls of more than 300 ms on slow swipes and jumps of
up to 69 rows on medium ones. Fixing only the reports made it worse, because
the curve read standard reports as very fast scrolling. Fixing only the
identity made scrolling far too slow. Together they put Claude Code on the
model it uses in Ghostty, one frame per report. Matching a native terminal at
this boundary works for every TUI and does not depend on any agent's internal
heuristics.

**Consequences.**
- Refines D21: Agent Area terminals are BaseHalf's own terminal, not VS Code's
  terminal, toward the programs that run in them.
- Tools treat the terminal as an unknown truecolor `xterm-256color` terminal.
  Their xterm.js- and VS Code-specific behaviors stop. TUI agents no longer
  auto-connect to their VS Code companion extensions.
- VS Code behaviors keyed on `TERM_PROGRAM=vscode` (CLI window reuse,
  `--wait` refocus, fish shell integration, Python environment activation)
  recognize `BaseHalf` instead.
- The terminal reaches into xterm.js internals to encode wheel reports. A test
  pins them, and a missing internal falls back to xterm.js's own reports.
- Refined 2026-10-12: a trackpad delta counts one row per cell height of
  finger travel on every display. That is the reference terminal's amount on
  a display with a scale factor of 2; on other displays its amount differs,
  and BaseHalf's does not. See the specification for the measurement.
- Refined 2026-10-12: being a terminal that agents do not know by name has a
  cost at their output. Claude Code chooses how to scroll from the terminal's
  name before it has asked the terminal, and under an unknown name it sends
  every row again for each row scrolled. Agent Area terminals therefore set
  the variable that Claude Code documents for a terminal with synchronized
  output that it does not detect. The terminal host also sends output that
  follows a quiet period without its 5 ms wait. The identity stays BaseHalf.
- Refined 2026-10-13: measured against the reference terminal itself, with
  the same gestures posted to both, BaseHalf still sent up to 1.7 times its
  wheel reports. The reference terminal's rows are 17 points high where
  BaseHalf's were 14 px, and it drops the fraction of a row whenever it sends
  rows. BaseHalf takes both: the default font size and line height of the
  Agent Area terminal give rows of 17 px, and the fraction is dropped.
- Refined 2026-10-27 by D86: the terminal keeps no width for its scrollbar,
  and the space around its grid takes the background of the nearest cell, so
  a program that paints its own background reaches the edges of its pane.

## D40 — Mirror metadata never blocks the user (NEW, 2026-10-10)

**Decision.** What BaseHalf keeps under `.bh/mirror/` annotates the user's
files; it is not their truth. Content there that BaseHalf cannot read never
blocks a card move, a file operation, or any other user action, and is never
destroyed. Three rules follow. BaseHalf reads back every mirror file it
writes, and checks that before each commit. Canvas layout that cannot be read
is skipped row by row, and a write over it first saves the old bytes as a
recovery copy under `.bh/cache/recovered/`. A metadata update that fails after
a file operation offers Skip next to Retry, so the workspace is never locked.
See [mirror file resilience](specs/mirror-file-resilience.md).

**Why.** A folder named `09` made BaseHalf read its own `canvas.yaml` as
corrupt, because the reader guessed types from text and ignored quotes. The
canvas then refused every card move, the delete cascade stopped at a stage
that Retry could not pass, and the workspace stayed locked until reload. The
reader bug was one line, but the architecture let one unreadable value stop
the product: layout reads were all-or-nothing, every write began with such a
read, and a failed required stage held the workspace lease with no way out.
A note-taking product must not put its bookkeeping ahead of the user's work.

**Consequences.**
- Refines D12 and D19: `.bh/mirror/` files are read by schema through one
  shared grammar.
- BaseHalf assumes users never open or edit files under `.bh/`. No recovery
  step asks them to. An unreadable `badge.yaml` or `adhd.yaml` reads as no
  description or no reading aids, and the next save replaces it after a
  recovery copy is kept. BaseHalf replaces such a file only as part of a
  write the user asked for.
- Reference truth is unchanged. Unreadable `upstream` values stay visible
  issues that only the user repairs (D37).
- `.bh/cache/recovered/` joins the machine-local state under `.bh/cache/`.
  BaseHalf never deletes recovery copies.
- After Skip, metadata stays at its old mirror path, the state a move or
  delete outside BaseHalf already leaves.
- A mirror file whose stored path differs from its node's only in letter
  case or Unicode normalization is the node's own. A rename made outside
  BaseHalf on a file system that ignores those differences would otherwise
  make the saved layout, descriptions, and reading aids read as missing and
  be replaced on the next save.
- Recovery copies are a safety net for support, not a feature: nothing in the
  product reads them back yet. A way to restore from them is an open item.

## D41 — Users are not expected to read code or open hidden files (NEW, 2026-10-10)

**Decision.** BaseHalf assumes its users do not read YAML, frontmatter, or
JSON, and never open the hidden `.bh/` folder. No message, button, or repair
step sends a user to a file's source or to a file under `.bh/`. The **Open
Metadata** action of the badge editor and every **Open File** action of the
reference interface (issue rows, the Upstream Issues list, refusal notices,
and the save-failure notice) are removed. A repair that BaseHalf offers is an
action in its own interface. See
[mirror file resilience](specs/mirror-file-resilience.md) and
[reference graph](specs/reference-graph.md#badge-editor).

**Why.** D37 keeps each reference in the downstream file, where BaseHalf makes
only minimal edits. Where BaseHalf would not edit a value itself, the design
handed the file to the user with Open File. That helps only someone who can
read and fix YAML. For the learners BaseHalf is built for (D16) it is a way
out that leads nowhere, and it puts the file's bookkeeping in front of people
who came to take notes.

**Consequences.**
- Refines D37 and D40. Where references are stored does not change: the lists
  stay in the downstream file, and agents and other tools still read them
  there.
- An upstream list that BaseHalf cannot read, or will not edit in place, gets
  a confirmed **Rebuild List** action that writes it again in BaseHalf's own
  form and keeps the connections it can read. A document BaseHalf cannot edit
  safely still has no repair in the product.
- The reference interface states every reason in plain words. No notice or
  issue row names `upstream` as code, frontmatter, YAML, TOML, `.bh/`, or
  "metadata", and none tells the user to fix a file. The **Show in File**
  action of the first-connection notice is removed. Format detail goes to the
  log. The rules are in
  [reference graph](specs/reference-graph.md#wording).
- **Move into File** no longer refuses a sidecar it cannot fully use. It moves
  what it can read and keeps the sidecar as a recovery copy.
- The same wording applies outside the reference interface: the notice for
  removed legacy files, the canvas setup prompts, the settings text, and the
  release notes do not name `.bh/`, file formats, or "metadata". A file system
  error is shown as a plain reason and its own text is logged
  ([mirror file resilience](specs/mirror-file-resilience.md#failure-reasons-in-messages)).
  Two kinds of text keep their terms on purpose: the release-note line
  addressed to people who keep their notes in git, and errors returned to a
  command's caller rather than shown as a notice.

## D42 — A note that cannot hold its upstream list keeps it with BaseHalf (NEW, 2026-10-10)

**Decision.** A Markdown note's upstream list lives in the note, as D37
decided, with one exception. While the note has no `upstream` key of its own,
its list lives in its sidecar `upstream.yaml` when the note cannot take the
key (TOML frontmatter, a leading block BaseHalf does not recognize, a
frontmatter mapping BaseHalf cannot edit, frontmatter beyond the size window)
or when the sidecar already holds a list for it. The sidecar is then the
note's store exactly as it is for a PDF or a folder, and connecting into the
note is not refused. See
[reference graph](specs/reference-graph.md#a-note-that-cannot-hold-its-list).

**Why.** D37 refuses to write into a document it cannot edit safely, and D41
removed the exit that handed the file to the user. What was left is a refusal
with no way out for an ordinary action, and it reaches ordinary notes: one
that starts with a horizontal rule is enough. Writing into the unrecognized
block would mean guessing what the block is, and a wrong guess damages the
note. Keeping the list beside the note never touches the file.

**Consequences.**
- Refines D37. Where a note's list lives now depends on the note's content as
  well as on its kind. The index and the edit service decide it with one
  shared rule.
- An agent that reads such a note does not find the list in it. The launch
  instructions say where to look, and the badge says "BaseHalf keeps this
  list for this file."
- A sidecar that holds a note's only list stays in use when the note becomes
  able to take a list, so connections never disappear because the top of a
  note was edited. The badge then offers **Move into File**. As before, a
  sidecar is ignored only when the note has an `upstream` key of its own.
- A block BaseHalf does not recognize can still list connections, for
  example frontmatter that another tool made invalid. BaseHalf reads those
  entries and carries them into the sidecar on the first write or on
  **Rebuild List**, so the row that reports them always has an action.
- Still without a repair: a note whose frontmatter is a flow mapping that
  already holds `upstream`, which is read but cannot be edited, and an
  unreadable `.bhnode`, which is a node-document matter.

## D43 — Agents learn a BaseHalf workspace from a skill the user installs (NEW, 2026-10-11)

**Decision.** BaseHalf ships one agent skill, `basehalf`, in the open Agent
Skills format. It tells an agent where a card's badge is (its description and
its upstream and downstream connections) and how to move files without losing
it. BaseHalf offers the skill when a workspace opens, and the user installs
it. It goes into the agents' own skill folders in the user's home folder, for
Claude Code and for agents that read the shared location, such as Codex.
Where BaseHalf stores a badge does not change: a note's upstream list stays in
the note, and descriptions and the other upstream lists stay under `.bh/`.
See [agent skill](specs/agent-skill.md).

**Why.** BaseHalf is the container that intelligence flows through, not an
intelligence layer. D36 reached one agent, Claude Code started from Agent
Area, by adding to its system prompt. Every other agent learned nothing about
descriptions or the lists under `.bh/`. Moving that data into visible files
was considered and set aside: it either removes connections into PDFs and
folders or adds files to the user's folders. A skill needs neither. It is a
format the agents share, the user chooses to install it, and it works for an
agent started anywhere.

**Consequences.**
- Refines D36. BaseHalf still writes nothing into a workspace for agents and
  nothing into `AGENTS.md` or `CLAUDE.md`. Its one write outside the workspace
  is the skill, and only when the user asks for it.
- An agent uses a skill when it judges that the task matches. The skill makes
  the badge reachable; it does not guarantee that an agent reads it.
- "Publish data, never dictate traversal" stands. The skill says where things
  are and what they mean, not what to read first.
- A Claude Code session started from Agent Area with the skill installed gets
  a short pointer to the skill instead of the full launch instruction.
- A badge that changes is not announced to a running session. The skill says
  to read it from disk again.


## D44 — A card's information follows its item, whoever moved it (NEW, 2026-10-11)

> **Revised by D63 (2026-10-22).** A card's `generation.yaml` and `made.yaml`
> are card information, and a draft is an item with card information and no
> file, which follows a folder that is moved outside BaseHalf. A card that
> generates is no longer held back from following a move. The rest of D44
> stands.

**Decision.** An item that anyone renames or moves with ordinary tools keeps
its card, with no command for agents, no background program, and no question
to the user. BaseHalf does what git does. It keeps a snapshot of what it last
saw in a workspace folder, compares it with what is there now, and pairs an
item that disappeared with one that appeared when their content is the same
or mostly the same. A folder follows its files. A paired item's card
information is moved to the new path. What is not paired is a deletion, and
BaseHalf asks nothing. There is one method for every kind of item, and card
information stays where it is. See
[following items moved outside BaseHalf](specs/following-moved-items.md).

**Why.** Card information is stored under the item's path, and a path is the
one thing every tool changes. Only a move through the workbench kept the two
together. The move operation for agents, the instruction to use it instead
of `mv`, and the orphan mark all worked around that, and they covered only
sessions started in Agent Area while BaseHalf runs. In the trials of the
agent skill (D43), Claude Code and Codex each renamed a described file from
outside Agent Area, and the description stayed behind every time. A
container cannot require what flows through it to use its own door.

Git solved this long ago by not tracking renames at all and inferring them
from content, and it trusts that inference when it merges. Content is also
the only evidence that survives what agents do. Measured: Claude Code's edit
tools replace the file, and Codex's patch tool renames by writing a new
file, so the file system's identity for a file is lost either way. With
content, the result no longer depends on which tool moved the item or on
whether BaseHalf was running, which a user could not have known.

**What was set aside.**
- A program that runs all the time and watches the folders. It guesses from
  the same evidence, runs on days the user does not use BaseHalf, and fails
  without anyone noticing.
- Making the move operation reachable from every terminal. It needs BaseHalf
  to be running and every agent to know and follow the instruction.
- Telling agents to move the files under `.bh/` themselves. It makes a
  hidden format something agents edit, and it helps only agents that read
  the skill.
- The file system's identity for a file as evidence. Earlier drafts used it.
  It needs a service of its own, and the tools above break it.
- Asking the user when the evidence is unclear. An earlier draft had a
  question, a review list, and a command for it. They served cases that are
  rare, and the cost was new buttons in the product for everyone.
- Putting a note's description into the note. Notes would then be handled
  one way and every other item another. One general method was preferred.
- Storing card information under a hash of the content, as git stores
  objects. An agent finds a description by the item's path, and every edit
  would move it.
- An identifier written into every file. BaseHalf would have to change files
  the user only looked at, and it cannot write into a PDF or a folder.

**Consequences.**
- Refines D37, D40, and D43: a move outside the workbench is no longer left
  to the user; "following files that are moved outside BaseHalf" stops being
  a non-goal of the mirror; and the skill and the launch instruction no
  longer tell agents how to move files.
- Where a description, an upstream list, and a layout are stored does not
  change. A note's upstream list stays in the note, as D37 decided.
- Entries that name a moved item are rewritten without asking after every
  move, also a move through the workbench. The setting
  `basehalf.references.updateOnFileMove` and its prompt are removed. Two
  rules stand behind this: whatever BaseHalf can update by itself, it
  updates by itself, and what the canvas shows is what is stored.
- The snapshot is kept in application storage on this machine, not in the
  workspace. A machine that never saw the old state cannot recognize the
  move.
- Two different notes made from one template can be paired when one is
  deleted and the other is created between two comparisons. This is accepted
  in place of a question, as git accepts it. The share of content that has
  to match is checked against real notes before it ships.
- A file that is renamed and rewritten by more than half, an empty file, and
  a folder without files are not recognized.
- Following a move never replaces what is at the new path. It is a
  relocation of its own that can be run twice, not the workbench's move
  cascade.
- `basehalf.workspace.move` becomes unnecessary. It is removed in the last
  step of this work, once the smoke shows that following works.
- Open questions of this work are settled by what git does: nothing is
  overwritten silently, every step can be run again, what is not recognized
  is left as it is and never deleted, and limits come from measurement.

## D45 — AI Video is built in and the plugin platform is frozen (NEW, 2026-10-11)

**Decision.** AI Video is a built-in part of BaseHalf. It ships inside the
application, works from the first start, and needs no install step. Its
version is the application's version. The left sidebar is again exactly
Files, Git, and Search: the Plugins library, the Manage Plugins command, and
plugin links leave the product. The plugin platform is frozen. BaseHalf
fetches no plugin catalog, installs no plugin, and admits no extension other
than its own built-in AI Video. Community publishing is closed: the job that
promotes reviewed plugins no longer runs on a schedule, and the publishing
portal and its API are taken out of service. The signed registry, the signing
key, the stored submissions, and the platform's code stay as they are, so the
freeze can be lifted. See
[built-in AI Video and no plugins](specs/built-in-ai-video-and-no-plugins.md).

**Why.** The platform was built for an ecosystem that does not exist yet.
Three months after community publishing opened, the catalog held no plugin
from anyone outside BaseHalf. The one real plugin, AI Video, had become the
product's main capability, yet a new user had to find the Plugins library and
install it first. BaseHalf had stopped using its own channel: the registry
stopped at AI Video 0.4.0 while the source moved on to 0.6.0. Client builds
made after 2026-07-20 rejected the published catalog and showed an error in
the Plugins library, and that stayed unrepaired for almost three months. A
channel that nobody uses breaks without anyone seeing why. A publishing
pipeline that nobody watches is worse: its hourly job could still sign code
that clients trust.

What extends BaseHalf falls into two layers. What an agent can do is extended
by the agent's own skills and tool connections, which have their own
communities; BaseHalf adds its skill there (D43) and builds nothing beside
them. What the container shows and does with files is BaseHalf's own work
today, so it is built in. A platform drawn from a single tenant guesses where
its boundaries are. A second real domain is the evidence that shows them.

**What was set aside.**
- Keeping the Plugins library with AI Video already installed. A library with
  one entry that is already installed says that the ecosystem is empty, and it
  keeps a surface that can fail.
- Repairing the catalog and keeping a channel for official plugins only. It
  stays alive only if BaseHalf ships a second, optional capability through it
  with every release, and there is none yet.
- Deleting the platform. Nothing was promised outside, but removing a signing
  key and a registry that distributed builds read is hard to undo, and keeping
  static files costs little.
- Opening a public repository for community templates and skills now.
  A template is a plain folder that can be shared anywhere already, and skills
  travel through the agents' own channels.
- A switch that turns AI Video off. It adds states to the main capability
  before anyone has asked for them.

**Consequences.**
- Narrows D22: the sidebar has three areas, not four. The extension allowlist
  is unchanged.
- Replaces the product surface of D25 and the distribution and publishing
  surfaces of D29–D32 for as long as the freeze lasts. Their text now
  describes the frozen platform, not what the product does.
- Replaces how D28 packages AI Video: it is no longer a plugin that a user
  installs. Its domain boundary stays as D28, D33, and D34 set it. It
  contributes recipes, a template, the Sequence view, and executors to the one
  canvas, and the host owns the node lifecycle.
- D26 and D27 stand. AI Video is trusted because it is part of the
  application, and what it produces is ordinary local user data.
- The host keeps the boundary between the canvas and AI Video's domain code.
  It is engineering discipline, not a contract with third parties, so both
  sides may change together.
- The platform's code stays in the repository, compiles, and keeps its tests,
  with nothing registering it. This is a recorded exception to D23's rule
  against detached interface code.
- Extensions that an earlier build's plugin installer put into a profile stop
  running and stay on disk unused. The product is not launched, so nothing is
  migrated or cleaned up.
- Builds that are already distributed keep reading the registry and keep
  showing their catalog error until they are updated. The registry stays in
  place so that nothing else changes for them.
- The freeze is reviewed when a second domain is ready to be built, or when
  someone outside BaseHalf asks to build something for the container. If the
  platform reopens, contributions that run no code, such as templates as plain
  folders and agent skills, come before code plugins, and review is automated
  before it is staffed.

## D46 — Every card has a saved place, and places stay out of git (NEW, 2026-10-11)

**Decision.** Every card on a canvas has a place that is saved in its
folder's layout under `.bh/`. Layouts stay in the folder and are not shared
through git: BaseHalf writes an ignore file of its own inside `.bh/` that
hides them. Descriptions and connections are shared through git as before. A card gets its place when it first appears on
a canvas, and after that only the user changes it. BaseHalf chooses the place
once: the nearest place that is not taken to where the user pointed, and
the end of the canvas when nobody pointed. It saves that place at once and by
itself, in the same file as a place the user chose, and marks the row as its
own choice. There is no sorted mode, and the one way BaseHalf will change a
place the user has is a tidy command that the user runs. See
[canvas card placement](specs/canvas-card-placement.md). D50 refines where
one card goes that the user pointed at.

**Why.** A canvas had two kinds of place: saved for the cards the user had
moved, and computed at every drawing for all others. A computed place depends
on the other cards and on the list of files. So cards could lie on each
other, cards moved when a file was added or renamed, and most of what the
canvas showed was stored nowhere, against the rule of D44 that what the
canvas shows is what is stored. A first fix kept both kinds and searched for
free places. It was correct and hard to predict. A simpler rule on top of it
failed in the product, because without a saved place for every card BaseHalf
cannot tell a new card from one that has been there all along.

Ten open-source implementations were read in source: five desktop views that
show a folder as icons the user can place, and five canvas editors, formats,
and libraries. Nine store a position for every item that can be placed
freely, place an item once when it appears, and handle every case with that
alone. The tenth stores only what the user moved and lets the rest flow
around it, and a new file shifts the icons after it. That was BaseHalf's
method, and its problems came with the method.

Places are kept out of git because they change far more often than anything
else BaseHalf stores, and because BaseHalf is meant to be used by several
people on one project. With the layout in git, moving one card left the
folder changed in git all the time. Two people who moved cards in the same
folder would get a conflict in a file that neither of them ever opens (D41).
Git carries what a project means: its notes, descriptions, and connections.
Where each person puts the cards is theirs. A shared arrangement, if it is
wanted later, needs a way of its own, on purpose or live.

**What was set aside.**
- Keeping computed places and searching for free ones around the saved
  ones. This is the first version of the specification.
- Two states for a canvas: arranged by name until the user touches it, and
  saved from then on. Three of the desktop views have such a mode as a
  feature. The rule does not need it, and a canvas would change its
  character at the first drag.
- Remembering BaseHalf's own choices on this machine and writing to the
  folder only when the user arranges something. It means two places for one
  kind of fact. One place was preferred.
- Keeping all places in application storage in the user's home folder, as
  agent tools keep their own state. That storage is kept by the folder's
  path, so renaming, moving, or copying the folder would lose every
  arrangement. In the folder and hidden from git, an arrangement stays with
  its folder and git still shows nothing.
- Leaving the ignoring to the user, as for `.bh/cache/` until now. A user
  who does not read code cannot be asked to edit an ignore file.
- Filling the first free gap from the top-left corner, as three of the
  desktop views do on a screen of fixed size. On a canvas the gaps between
  the user's cards mean something, and a card put there would look as if it
  belonged to its neighbours.
- Keeping the coordinates of a card that goes to another folder. They
  belong to the canvas it left.
- Saving a place only once BaseHalf knows that the item is new and not a
  moved one. A place that waits is invisible to another window and to a
  move that writes into the same layout, and each of them could choose it
  again. A mark on the row does the same work with nothing unsaved.

**Consequences.**
- Refines D35 and D36 as [workspace state](specs/workspace-state-and-legacy-cleanup.md)
  records them: showing a folder's canvas now writes that folder's layout,
  so the first canvas shown in a workspace folder creates `.bh/` there.
  "Opening a folder writes nothing" becomes "opening a folder changes
  nothing that git shows". BaseHalf still writes no agent guides, no focus
  state, and nothing into the user's own files. It still never creates or
  edits the user's `.gitignore`; the one ignore file it writes is inside
  `.bh/`, and it also hides `.bh/cache/`, so nobody has to be told to ignore
  that.
- A layout is no longer shared through git, which earlier decisions gave as
  a reason to keep it in the folder. A clone starts with the plain grid on
  every canvas, and git history holds no arrangement. A folder that is
  copied or moved keeps its arrangement.
- Refines D43: `.bh/` is still how the agent skill recognizes a BaseHalf
  workspace. It now appears when a folder is first shown, not when the user
  first arranges or describes a card.
- Refines D44: every item whose card was shown is a followed item. A file
  renamed outside BaseHalf keeps its place also when the user never touched
  its card, and BaseHalf keeps a fingerprint for every such file. The cost
  is measured before the work is done.
- Cards are in name order only as far as they appeared together. A file
  that is added later is at the end.
- A place BaseHalf chose is never written in a marked folder, which closes
  the known gap of the source-tree guard for writes that no user action
  started.
- A row says whether BaseHalf chose its place. Only such a row gives way
  to the row that follows a moved item, and only such a row is removed when
  its item is gone. BaseHalf does neither to a place the user chose.
- The user can still put a card on another card. BaseHalf does not.

## D47 — An update is downloaded once and is there at the next start (NEW, 2026-10-12)

**Decision.** BaseHalf keeps its own update service for macOS and stays
without platform signing. What the service downloads and unpacks is kept
under the version it belongs to, not under the run that fetched it. An
interrupted download continues, a complete one is not fetched again, and an
update that is ready replaces the installed application at the latest when
BaseHalf is started the next time, whatever ended the run before. The update
interface stays the one of the VS Code base. BaseHalf's own version is shown
wherever a version is shown. See [app update](specs/app-update.md).

**Why.** On 2026-10-12 the first update of an installed application was
tried, after 0.5.0 had been published. A download of 460 MB was thrown away
because the application was quit, the next start said nothing and began
again, and after the update the application named the same version as
before, the one of the VS Code base. The service had been written when the
archive was small, and nothing had ever tested an update. The updater of the
base cannot be used: on macOS it is Electron's, which needs a signed
application. Other applications without platform signing sign their updates
with a key of their own, as BaseHalf does, and their updaters are either
bound to another application framework or replace the application while it
runs, which BaseHalf cannot do because it reads from its bundle for as long
as it runs.

**Consequences.**
- The update of an installed application is tried before a release is
  published, with the real application.
- Installed copies up to 0.5.0 keep the first version's behavior until they
  have been updated once, and they refuse an archive above 500 MiB. The
  release script refuses such an archive.
- No dialog is added and nothing is asked. A download that BaseHalf starts by
  itself stays as quiet as the base makes it.
- Platform signing stays possible later. It would replace this service with
  the updater of the base.

## D48 — Release notes are written once, on the releases page (NEW, 2026-10-12)

**Decision.** Nothing opens in BaseHalf after an update. Release notes are
written once for each release, on the releases page, and "Release Notes" in
the application opens that page in the browser. BaseHalf holds no text of its
own about what changed. See
[app update](specs/app-update.md#after-an-update).

**Why.** Until 0.5.0 the notes were written twice: on the releases page, and
as a page inside the application, whose text was part of the source and held
there by tests. That page opened by itself at the first start after an update
and took the place of the canvas. On 2026-10-12 it turned out that it had been
blank since June, behind the editor area, and that nobody had missed it. A
small card in the title bar was tried in its place and not taken: it is one
more text to write for each release, and one more thing between the user and
the canvas. Writing the notes is work that is done once, where the release
is.

**Consequences.**
- The text of the page, its tests, and its smoke step are removed.
- A specification that asks for a sentence in the release notes asks it of
  the notes on the releases page.
- What the VS Code base would show after an update, a page or a card with
  what its publisher wrote about the base, is off, and the two settings that
  choose between them are hidden.
- The update manifest keeps its notes field, which holds the same text as the
  releases page. Nothing in BaseHalf shows it.

## D49 — The state of an update is a page in Settings, not a card (NEW, 2026-10-12)

**Decision.** The entry "Update" in the title bar has no card. What the card
of the VS Code base held, the running version, the update, its progress, and
"Release Notes", is on a page of its own: Settings, BaseHalf, About, with the
one action the state calls for. See
[app update](specs/app-update.md#where-an-update-shows).

**Why.** The card appeared when the pointer rested on the entry, between the
user and the canvas, and said little that the entry does not say. The image
in it was the icon of the base and not BaseHalf's. The version and the
release notes are things a user goes to look for, and Settings is where a
user looks. Both parts were there: the base draws the state of an update in
one element that needs no card around it, and Settings already holds a page
of BaseHalf's own.

**Consequences.**
- A check that the user asked for and that fails is told in a notification,
  because the card that told it is gone.
- Choosing the entry while a download runs opens the About page.
- The About dialog of the application menu stays.

## D50 — A place the user points at is taken as it is (NEW, 2026-10-12)

**Decision.** A card that the user creates at a point of the canvas, or from
a connection line, is put exactly where the user pointed: with its top left
corner at the point, or with the side that the line enters centered on the
point where the line was released. BaseHalf does not move it for other
cards, for the edge of the window, or for a row whose item is gone. The view
stays where it is too: a card near the edge of the window is partly outside
it, and the user moves the canvas. A place that BaseHalf works out by
itself, the middle of the window for the Create button or beside a PDF's
card, still goes to the nearest open place. See
[canvas card placement](specs/canvas-card-placement.md#a-pointed-place-is-taken-as-it-is).

**Why.** D46 put a pointed card at the nearest place that is not taken, and
counted only places that the window showed. On 2026-10-12 the user reported
that cards made from connection lines came out in another direction or far
away. The search went in steps of a whole card in a fixed order, so a card
that was a little too near to another one was put 840 lower, and a card
whose line went to the left was put to the lower right. A card that would
reach past the edge of the window counted as not open, which at 100% is
every line released in the last 324 pixels of the canvas, and when nothing
in the window was open the card went to the end of the canvas, out of sight.
The place depended on the zoom and on what the window showed, which the user
does not think of when they point. A row of such a card was already the
user's and not BaseHalf's choice. With the place taken as it is, the rule
can be said in one sentence.

The user, the same day: a card should be made where the user chose. Someone
who wants it on the left means the left, and expects to move the canvas next
themselves.

**What was set aside.**
- A search for the place nearest to the point in the true sense, in small
  steps. In a crowded part of a canvas it still puts the card somewhere the
  user did not point, and the user cannot tell beforehand where.
- Keeping the card inside the window by moving it less. The place would
  still depend on the view.
- Moving the view to show the card. It was built first, as the least move
  that brings the whole card into the window, and taken back when the user
  said that moving the canvas is theirs to do.

**Consequences.**
- Refines D46: "the nearest place that is not taken to where the user
  pointed" now holds for a group of files dropped at a point and for a place
  that BaseHalf computes. One card that the user points at is where they
  pointed.
- A card that the user points at can lie on another card, as a card that the
  user drags there. BaseHalf still never puts a card on another one by its
  own choice.
- A card that is pointed at near the edge of the window is partly outside it
  until the user moves the canvas. A note opens for typing there all the
  same.

## D51 — The product shows VS Code's color theme and its card layout (NEW, 2026-10-12)

**Decision.** BaseHalf shows VS Code's default dark color theme and VS
Code's Modern UI layout, as VS Code 1.141 implements them. The built-in
default themes extension is an allowed and required extension family,
`workbench.experimental.modernUI` is on, and the files of the layout were
brought from the imported base (1.128) to their state in 1.141. BaseHalf
writes no theme and no layout rules of its own for the workbench parts. A
theme switch that the system makes by itself stays on a dark theme. See
[workbench appearance](specs/workbench-appearance.md).

**Why.** On 2026-10-12 the user compared BaseHalf with the current VS Code
release: VS Code shows the sidebar and the right side as rounded cards, and
its Git view has status colors, while BaseHalf's Git view was gray. The gray
had one cause. D22 made a curated extension allowlist with Git, GitHub,
GitHub authentication, and the agent extensions. The color theme is an
extension too, and the list left it out. So no theme was ever loaded: the
window kept the colors VS Code paints before a theme loads, and colors that
extensions contribute, the Git status colors among them, had no value.

The card layout was in the base, switched off, in an early version. With it
switched on the product had cards, but not the ones the user had seen:
wider gaps, a smaller radius, another background. The user asked for the
current VS Code source to be put under `reference/` and for the changes to
be made against it. The layout is a closed part of the workbench: helpers in
the layout service, the margins of each part, one stylesheet, and one
module. Each file was merged three ways, with the import commit as the
base, so a file that BaseHalf had not changed became the 1.141 file. After
that the computed styles of both windows were read side by side until they
agreed.

**What was set aside.**
- Giving the Git status colors a value in BaseHalf's own styles. The Git view
  is VS Code's (D22), and every other contributed color would stay without a
  value.
- Rounded corners and gaps in BaseHalf's own styles. A second set would have
  to follow every upstream change by hand.
- Keeping the early version of the base and waiting for an update of the
  whole base. It was the first proposal. The user wanted the look of the
  current release now.
- Bringing the whole editor area to 1.141 for the connected editor tabs. It
  pulled in unrelated features of thirteen releases, and BaseHalf shows no
  editor tabs.
- A light palette for the canvas, so that light themes work. It is a design
  task of its own (roadmap track 9). Until then the system cannot switch the
  product to a light theme, and a user can still choose one.
- Hiding `Preferences: Color Theme`. The command palette shows VS Code's
  commands unfiltered, and no menu of the product offers the picker.

**Consequences.**
- Extends D22: the allowed built-in families are the default themes, Git,
  GitHub, and GitHub authentication.
- The colors of the workbench parts change from the startup colors to the
  theme's: backgrounds, borders, buttons, selection, and focus.
- About seventy files of the base are now at their 1.141 state while the
  rest is at 1.128. `vscode-base/BASEHALF_UPSTREAM.md` lists them. An update of
  the whole base takes upstream's version of each.
- `reference/vscode` holds the source of VS Code 1.141.0. It was a link to
  `vscode-base` before.
- With a light theme chosen, the workbench parts are light and the canvas
  and the Agent Area terminal stay dark.
- The smoke fails when the theme is not loaded, so an allowlist change
  cannot bring the gray state back unnoticed.

## D52 — Several selected cards are one object, and the user tidies a canvas on request (NEW, 2026-10-12)

**Decision.** What is selected decides what the canvas shows, not how it was
selected. One selected card is one card, whether it was clicked or boxed by
a marquee. Two or more selected cards are a set: one box that takes the
pointer in its whole area, one toolbar, and one way to move it. A click
inside the box changes nothing, and a click on empty canvas ends the set. A
marquee selects every card it touches and no connection. BaseHalf puts cards
in order in two ways, and only when the user runs them: Arrange puts a set in
a grid, a row, or a column, and Tidy Canvas lays out the whole canvas along
its connections and then asks whether to keep or revert the result. See
[canvas selection and arrangement](specs/canvas-selection-and-arrangement.md).

**Why.** Selecting several cards had never been specified. The canvas used
the marquee of its canvas library as it comes, on top of a selection that
BaseHalf owns and that was built for one card. The two did not agree: a
marquee dropped cards that have connections, one card boxed by a marquee was
covered by a rectangle that a clicked card does not have, and a set that was
moved was no longer a set. The user also had no way to put a canvas in
order, which [D46](#d46--every-card-has-a-saved-place-and-places-stay-out-of-git-new-2026-10-11)
had left to a command that the user runs.

Two canvas products of the same kind, built on the same canvas library, were
tried in the window. They agree on almost everything about a set, and the
user judged what they agree on to be right, including that a click inside
the box changes nothing. Where they differ, BaseHalf takes the behavior that
keeps one state for one selection. Their faults, a box that stays behind
after undo and keys that select the text of the page, are not taken.

**Consequences.**
- The set box is worked out from the cards every time the canvas is drawn,
  so it cannot be anywhere but around them.
- While a marquee is drawn, the workbench is asked nothing. It is asked when
  the marquee begins and when the button is released.
- An arrangement, a tidy, and a revert are each one write of the layout and
  one step of undo. The cards they move have the user's rows afterwards.
- Tidy Canvas does not look at the selection. Arrange does not look at the
  cards outside the set, so an arranged card can lie on another card.
- Adding to a selection with a marquee, a key that selects every card, a
  context menu for a set, and groups that are kept are not part of this.
  Grouping stays out as [D33](#d33--the-main-canvas-unifies-content-and-optional-execution-domain-plugins-contribute-recipes-new-2026-07-18)
  decided.

## D53 — Screen reader mode is the user's choice, not a guess (NEW, 2026-10-13)

**Decision.** BaseHalf's default for `editor.accessibilitySupport` is `off`.
It does not enter screen reader mode because the operating system reports
assistive technology, and it does not ask whether to. A user who needs the
mode turns it on in the settings or with the command. In that mode an Agent
Area terminal keeps its live region within a fixed size. See
[screen reader mode](specs/screen-reader-mode.md).

**Why.** A dictation tool that reads the window through the accessibility
interface is assistive technology, and many more of BaseHalf's users dictate
than use a screen reader. VS Code's default then turns the mode on and asks a
question that such a user cannot judge; Yes stays in the settings for good.
In the mode, the terminal collects every printed character in a live region
that a full-screen agent scrolled with a trackpad never lets it empty.
Scrolling Claude Code went from a steady 9.5 ms a frame to a main thread
that was blocked nearly all the time within 35 seconds, and the canvas and
the Agent Area's toggle slowed with it. The limit on the live region removes
that cost for those who do need the mode.

**Consequences.**
- A screen reader user has to turn the mode on once. It is no longer
  detected.
- A profile that already holds `on` keeps it. The product is not released,
  and no setting is migrated.
- The canvas is not readable by a screen reader in either mode.

## D54 — A note is shown rendered wherever it is read (NEW, 2026-10-13)

**Decision.** A Markdown Note card shows the rendered form of its note: a
table as a grid, an image as a picture, a task as a box, and the HTML that
Markdown allows as elements. The characters of the file are for Card
Detail's Source projection. The blocks that cannot be edited on the card
stay rendered while the card is edited. See
[note rendering](specs/note-rendering.md).

**Why.** Since cards can be edited in place (2026-08-09), the card rendered
only the sixteen elements its editor can edit and printed every other
element as text. A pipe table appeared as `<table> <thead> <tr> <th>…`. The
user of BaseHalf does not read code, and notes written by agents are full of
tables. What can be edited in place and what can be shown are two questions:
the first is the editor's limit, and it must not decide the second.

**Consequences.**
- A table keeps its words whole, and a code block keeps its lines unbroken.
  One that is wider than the card is cut at the right and scrolls sideways
  in its own box, by a sideways scroll that begins on it. While it is
  scrolled a bar shows inside its lower edge, with one look; the bar takes
  no space and is hidden otherwise.
- Images of a note are loaded when its card is drawn.
- HTML outside the allowed elements is still shown as text, letter for
  letter, and never becomes an element.
- Card Detail's Preview projection draws a table with lines. In both of
  its projections a wide table shows the same bar while it is scrolled.
- Card Detail's rich projection shows a block it cannot edit rendered as
  well. The block is still not edited in place, and it is saved byte for
  byte.
- The rich projection edits a block unless writing it back would lose
  something the reader sees. A line break written as `<br>` is kept, in a
  table cell as `<br>`, so a table with line breaks in its cells is edited
  in place. A block with other HTML is not: the editor's writer drops it.
- The length of a note follows the same split (2026-10-14). The card's
  editor edits a note of up to 128 KiB; the card shows a note of up to 1 MiB.
  It builds the note in parts, as far as the card shows and two of its
  heights further, the way a notebook builds only the cells in view, so the
  cost of a card no longer grows with the length of its note.

## D55 — A note is named without its extension (NEW, 2026-10-13)

**Decision.** Where BaseHalf names an item, a Markdown note is named by its
file name without `.md`: on its card, in a folder card, in Card Detail, in
the breadcrumb, and in the Upstream and Downstream lists. Every other file
and every folder is named by its whole file name. The file is not changed.
The rename editor of a note holds the name without the extension and keeps
the extension. A path is shown as it is, and so are the Files view, Search,
and Quick Open. See [canvas card name](specs/canvas-card-name.md).

**Why.** A note is the kind of file BaseHalf is made for, and the glyph
beside its name says what it is. Users do not read code (D41), and for them
the extension is noise. In the rename editor it was worse than noise: it
could be typed away, and the note became a file that BaseHalf no longer
shows as a note. Other files are told apart by their extension alone, also
when BaseHalf comes to show code, so the rule does not have to be taken back
then. Canvas products of the same kind call a new node "Text node 1": there
a title is a label in the product's own store. A BaseHalf card is a file
that agents find by its name, so the file keeps its extension and only what
is shown changes.

**Consequences.**
- `plan.md` beside a folder or a file `plan` shows the same name twice. The
  glyphs differ.
- The Files view shows `plan.md` and the canvas shows `plan`.
- A note cannot be made into another kind of file from the canvas. That is
  done in the Files view.
- Sentences that BaseHalf says about a file, such as the question before a
  delete, still say the file name.

## D56 — A layout control is in the title bar, on the side of its part (NEW, 2026-10-13)

**Decision.** The button that shows and hides the sidebar is at the left end
of the title bar, on macOS right after the window buttons. The button of
the Agent Area stays at the right end. The header of Card Detail holds no
such button. See [layout controls](specs/layout-controls.md).

**Why.** On 2026-10-13 the user pointed at two faults. The header of an open
card had a button that hid the sidebar, and a card is the wrong place for
it: the sidebar belongs to the window, and the header of a card holds what
acts on the card. The title bar had the same control at its right end, the
far end of the window from the sidebar. The user asked for it beside the
window buttons, where macOS applications have it. The Agents window of the
VS Code base already draws its title bar this way, so the mechanism is the
base's own: a toolbar at the left end that draws the entries of a menu.

**What was set aside.**
- Moving all three layout controls to the left end. The control of the
  Agent Area would then be far from the Agent Area.
- Keeping the button in Card Detail as a second way. Two controls for one
  state in one window is the fault the user named.
- A button of BaseHalf's own. The command, its icons, its tooltip, and
  Cmd+B are VS Code's and stay.

**Consequences.**
- The title bar of the VS Code base has a toolbar at its left end,
  `MenuId.TitleBarLeft`. Upstream's title bar has none. An update of the
  whole base has to carry it over
  (`vscode-base/BASEHALF_UPSTREAM.md`).
- A user who moves the sidebar to the right finds the control of the Agent
  Area at the left end and the control of the sidebar in the right group.
- "Focus on document", the name the Card Detail button had, is gone. Hiding
  the sidebar is the same action and has one name.

## D57 — Agents can read what the user selected, and the window shows it (NEW, 2026-10-14)

**Decision.** BaseHalf records what the user last selected in a workspace:
the folder whose canvas is shown, one card, several cards, or text in a
note. It keeps the record in `.bh/cache/` of the workspace folder, where
every agent can read it, and the BaseHalf skill says where it is and what it
means. The status bar shows what is recorded, at its right end under the
Agent Area: a name, the start of the selected text, or "2 cards selected".
The rule is the one the assistant of a notes application follows: the page
you are in, unless you selected part of it. See
[the selection agents can see](specs/selection-for-agents.md).

**Why.** On 2026-10-14 the user typed a question into a new note, switched to
the Agent Area, and wanted to say only "improve this". The agent could not
know which note, nor where in it. The editor of a card and the editor of
Card Detail are BaseHalf's own, so no agent's IDE integration sees them, and
Codex and most other agents have no such integration in a terminal. A file in
the workspace reaches every agent that can read files, and the skill, which
the user installs for all of them, is how they learn of it.

D35 removed an earlier record of the user's position. Its reasons, and what
is different now:
- *Agents did not read it.* It was a file to read on every turn, announced by
  rules written into the user's files. Now the description of the skill
  names the moment it matters: a request that does not say which file or
  text it is about. An agent still decides for itself; the specification
  records trials.
- *It went stale without a sign.* Now the status bar shows the record at all
  times, so what an agent would read is what the user sees. The record is
  removed when the window closes.
- *It reported columns of rendered text as source columns.* Now the record
  holds the selected text itself and the source lines it is on, and no
  column.
- *Every cursor move changed git.* Now the record is under `.bh/cache/`,
  which BaseHalf's own ignore file keeps out of git, and it changes only
  when the selection does. A cursor in a note without selected text records
  the note.

**What was set aside.**
- The IDE integration of each agent, which pushes an editor's file and
  selection into that agent. It needs one adapter per agent, the protocols
  are not all published, and Codex in a terminal has to be told to connect.
- Showing how many lines are selected. The user selected them and knows;
  the window only has to say that agents can see them.
- A button that removes or expands the record. Selecting something else
  changes it.

**Consequences.**
- Revises D35: a live signal of what the user is looking at, its non-goal,
  is now a goal, met by a different record. D35's removal of `focus.yaml`
  and `current_focus.yaml` stands, and the legacy cleanup still deletes
  them.
- Refines D43: the skill also describes the record. BaseHalf writes the
  record, and the status bar shows it, only while the current skill is
  installed for at least one agent.
- An agent may still not read the record, and the user's own words win when
  they name something else.
- Selected text is written to disk in `.bh/cache/`. It is text of a note
  that is already in the workspace.

## D58 — A Video node is a prompt over its connections, run by the user's own providers (NEW, 2026-10-15)

> **Revised by D59 (2026-10-19).** Channels, presets, model ids typed by the
> user, the general profile, and the OpenAI-compatible format are replaced by
> built-in provider integrations and their model catalog. The rest of D58
> stands.

> **Revised by D63 (2026-10-22).** The node file, its task and result, and
> `outputs/` are replaced: a generated video is an ordinary file that is its
> card, with its prompt and settings in `generation.yaml` and the record of
> what made it in `made.yaml` ([generation cards](specs/generation-cards.md)).
> The inputs in the order of the connections, the panel, and generating again
> into a new card stand.

**Decision.** A Video node is a `.bhnode` with a prompt, settings, and its
connections. Its connections are its inputs, in the order of its `upstream`
list: in frames mode the first image is the start frame and the second the
end frame; in references mode images, videos, and audio are references;
text inputs join the prompt. One panel under the selected card holds the
inputs, the prompt, the model, the settings, and Generate. Generate runs at
once, without a confirmation, also when an agent asks for it. The models come
from channels that the user sets up with their own key: presets for
Volcengine Ark, BytePlus ModelArk, Alibaba Cloud Model Studio, MiniMax,
Google Gemini, and any relay that speaks the OpenAI `/videos` format. A
generation records its provider task id in the node's file as soon as it has
it, continues after a reload or a restart, and writes its video as an
ordinary file under `outputs/`. A node with a video never runs again:
generating from it makes a new node beside it. See
[video node](specs/generation-cards.md).

**Why.** On 2026-10-14 the user found the Video node confusing and pointed to
an open-source canvas that does the same job more simply. A study of that
canvas, of two canvas products for media work, and of our own window and code
found the cause in three places, not in single bugs. The reviewed model
catalog held eight models from three international providers and could not
reach the provider the user actually uses or any newer model. The inputs were
a second system of stored roles beside the connections, with its own state
machine, while the other three products use the connections and their order.
And the lifecycle was built for third-party plugins and paid-run safety
(Attempts with byte-equal snapshots, request fingerprints, one-use grants,
leases, a confirmation for every run) at a cost the user felt on every use: a
dialog that lost the prompt, a panel that did not open on a new node, a
confirmation sheet, a manual status check after a restart. About 29,000
lines of source served one node, and no test made a video. The user then
handed over the open choices; this decision records them.

**What was set aside.**
- Keeping the reviewed catalog and adding Seedance 2.5 to it. The next model
  would need the same work, and relays would stay out of reach.
- Stored input roles with role slots. Every product compared uses the order
  of the connections; a stored role is a second truth beside the list.
- Regenerating in place and keeping a history of videos in one node. One
  node, one video keeps a file's identity stable under its card and its
  connections, which D34 got right.
- A confirmation before a paid run, and asking the user before an agent runs
  a node. The user asked for the work, and the key is theirs.
- User-written request scripts. A relay that speaks a supported format covers
  the cases seen.

**Consequences.**
- D34's Draft, Attempt, and sealed-Result lifecycle is replaced. What stays
  of it: a node's video never changes, and a new video makes a new node.
- `.bhnode` version 5 drops `role`, `recipe`, and `attempts`. Version 4 files
  are not read; the product has not launched.
- Recipes, recipe executors, the three planning recipes, the reviewed model
  and provider connection catalogs, connection validators, model service
  access for extensions, and the paid-run authorization leave the product and
  the frozen plugin platform. D45 said that changing the platform's code
  needs its own decision; this is that decision for these parts. The rest of
  the frozen platform stays.
- D33 keeps its one canvas and one edge. Its recipe and executor model, which
  only AI Video used, is gone.
- A request that may have reached a provider is never sent again by itself.
  The user is told to check the provider's console; a lost task can cost a
  charge, which the user can see there.
- Provider requests run in the built-in AI Video extension, because
  providers refuse cross-origin requests from the window.

## D59 — Video providers are built-in integrations with each model's exact settings; users bring their own keys (NEW, 2026-10-19)

> **Revised by D61 (2026-10-21).** The estimated price and the currency of
> each region are removed: BaseHalf shows no price. The rest of D59 stands.

> **Revised by D63 (2026-10-22).** A card keeps `provider`, `model`, `mode`,
> and `params` in its `generation.yaml`, not in a `.bhnode`, and
> `host.videoCatalog` becomes `host.modelCatalog`.

> **Revised by D64 (2026-10-22).** The catalog's models have a kind, image
> or video, OpenAI joins as a provider of image models, and the Video
> Providers page becomes Providers
> ([providers and the model catalog](specs/providers.md)). The rest of D59
> stands.

**Decision.** BaseHalf ships one integration per video provider, on the
provider's own API, together with a catalog that declares each model exactly:
the regions that offer it, its modes, the inputs each mode takes and their
limits, every parameter with its kind, choices, range, and default, and how
its price is estimated. The panel, its settings, the Video Providers page,
the request, the price shown before a run, and what agents read are all drawn
from that catalog. Users bring their own credentials: one set per provider,
with a region and an optional endpoint, stored encrypted on the computer. A
`.bhnode` is version 6 and stores `provider`, `model`, `mode`, and `params`.
See [Video providers and the model catalog](specs/providers.md).

**Why.** D58 kept nine models in a table in the window and let users type any
other model id into a channel. The table decided the settings, how they
changed between models, and which inputs a mode took; the request formats
lived in the AI Video extension; a general profile guessed for every other
model. The same knowledge sat in four places that had to agree, and a new
model either needed changes in several of them or ran on a guess. A
node-graph tool for generative media solves this coordination by declaring
every model with its exact parameters next to the code that calls its
provider and drawing every control from those declarations; its catalog stays
right because one team owns it and ships it with releases. BaseHalf takes
that design and owns its catalog the same way. Users keep their own keys:
they pay their providers directly, and BaseHalf runs no service in between.

**Consequences.**
- The AI Video extension holds the catalog and the integrations. The window
  holds no knowledge of any provider or model. A new model is a change to
  one provider module and a release.
- A model that the provider offers and the catalog does not list cannot run
  until a release adds it.
- Inputs travel the provider's own way, inline or through the provider's
  upload endpoint. Inputs that a provider takes only as public URLs, with no
  upload endpoint, are not offered for that provider.
- The panel shows an estimated price from the provider's published list
  price, in the region's currency. The provider's bill is what counts.
- A relay or a private gateway that mirrors a provider's own API is used by
  entering it as that provider's endpoint. There is no general relay format
  and no user-written request script.
- Revises D58: channels, presets, typed model ids, the general profile, and
  the OpenAI-compatible format are removed. `.bhnode` version 5 files are not
  read; the product has not launched.

## D60 — BaseHalf's code is organized by feature, the way VS Code organizes its own (NEW, 2026-10-20)

**Decision.** BaseHalf's workbench code stays under its own root,
`src/vs/workbench/basehalf/`, in a folder per feature, each with VS Code's
layer folders and its own tests, as VS Code organizes `workbench/contrib/`.
The canvas is split the way VS Code splits its code editor and its terminal:
a core that hosts the view, and features that register themselves with it and
live in folders of their own, which the core never imports. Changes to VS
Code's own files are marked, and replaced by VS Code's extension points where
one exists. See [code organization](harness/code-organization.md).

**Why.** On 2026-10-20 one class held the canvas: about 10,000 lines, 40
injected services, and more than 200 methods for the badge editor, note
editing, the Video panel, selection, connections, zoom, undo, tidying, and
moved items. 40 of the 115 commits to BaseHalf's workbench code in the 30
days before touched its file. It had 6 unit tests, all of small helpers; the
rest of it was checked only by the smoke, which takes 3 to 7 minutes and
fails when the machine is busy. No agent could read its 466 KB at once, so
every change to the canvas started by searching it. VS Code has one source
file over 5,000 lines, a table of editor options; its code editor is a
2,559-line widget beside 85 registered features with a median of about 200
lines each, in folders of their own with their own tests. BaseHalf's other
files already used VS Code's layers and dependency injection and had no
import cycles, but they lay in two flat folders, and every pair of features
imported each other somewhere. 75 of VS Code's own files carried BaseHalf
changes, most of them unmarked, which every port of a VS Code subsystem had
to find again. Merge conflicts were not a reason: only 2 of the 22 merges
since 2026-09-01 conflicted in the canvas file.

**Consequences.**
- A new canvas feature is a class registered with the canvas in
  `canvasContrib/<feature>/`, not more code in the canvas view.
- BaseHalf's code is never spread into VS Code's `contrib/` or `services/`
  folders; one root lets a VS Code update tell the two apart.
- Moving the files changed no behavior. File names keep their `basehalf`
  prefix, so a name in a document or in history still finds its file.
- VS Code's files are not changed in a pass of their own. Their BaseHalf
  changes are marked, or replaced by extension points, when their subsystem
  is next ported from a newer VS Code.

## D61 — BaseHalf shows no price (NEW, 2026-10-21)

**Decision.** BaseHalf shows no price, estimate, or currency: not in the
Video panel, not on the Video Providers page, and not in what agents read of
the model catalog. What a generation costs is in the console of the user's
provider, where the user got the key. Models declare no price lists, regions
no currency, and `check` answers no price or estimate.
See [Video providers and the model catalog](specs/providers.md).

**Why.** On 2026-10-21 the user found the estimate beside Generate of little
use and decided that users look up their costs on the page where they set up
their key. BaseHalf bills nothing, so the provider's bill is the only figure
that counts, and a price list copied into BaseHalf is only as current as its
last copy. Products that show a price before every run sell credits and show
their own charge; with the user's own key, BaseHalf has no charge to show.
Keeping the price lists of 51 models in two regions right was work at every
price change of every provider.

**Consequences.**
- Revises D59: the estimate beside Generate, the price lists of the provider
  modules, the currency of each region, and `estimate` in the catalog and in
  `host.videoCatalog` are removed. The rest of D59 stands.
- `check` stays: it reports the problems of a planned generation before
  Generate, with the files the generation would send.
- An unknown outcome still asks the user to check the provider's console
  before generating again, since a second request may be charged again
  (D58).

## D62 — A card's video is the card's picture, and the pointer plays it (NEW, 2026-10-22)

> **Revised by D63 (2026-10-22).** A Video card is the card of a video file
> in the canvas's own folder, so it opens over that canvas as every file
> opens over its folder; the special rule for opening a Video card, and the
> other kinds of node, are gone. The player and its rules stand
> ([generation cards, "The player"](specs/generation-cards.md#the-player)).

**Decision.** On the canvas, the picture of a video belongs to its card, on
a Video card and on the card of a video file alike. A click selects the card
and never starts or stops the video, a drag moves the card, a double click
opens it, and the pointer over it is the card's grab hand. The pointer on the
card plays the video without sound, and leaving the card pauses it. Controls
drawn by BaseHalf, not the system's, show over the picture while the pointer
is on the card or the card is selected. Card Detail opened from a Video card
lies over the canvas the card is on. See
[Video node, "The player"](specs/generation-cards.md#the-player).

**Why.** On 2026-10-22 the user found the video card odd: with the grab hand
a click played or paused the video, and a drag sometimes did not move the
card. A selected card gave its whole picture to the system's player, so the
hand promised a drag that never came, and the second click of a double click
went to the player instead of opening the card. The canvas products for
media work that BaseHalf follows make the picture the node's, play on hover,
and draw their own control bar. Closing Card Detail opened from a Video card
also showed the folder under `outputs/` that holds the video, not the canvas
the user had been on.

**Consequences.**
- One player in the canvas draws every video on a card. One video or sound
  on the canvas plays at a time, in a note too.
- The controls scale with the canvas, as the rest of a card does, and stay
  hidden on a picture narrower than 160 screen pixels.
- Every way of opening a Video card opens its video over the node's canvas,
  which follows its folder when that moves. The file of another kind of node
  still opens over its own folder, where Card Detail actions such as a
  branch from a PDF put what they make; so does a file opened any other way.

## D63 — A generated file is its card (NEW, 2026-10-22)

**Decision.** An image or a video that BaseHalf generates is an ordinary file
in the card's folder, under the card's name, and that file is the card. What
the next generation uses (the prompt, the model, and its settings) is the
card's `.bh/mirror/<path>/generation.yaml`, and the record of the generation
that made the file is its `made.yaml`, written once; both are card
information beside its description and its upstream list, and they follow
the file wherever it moves. A card exists before its file: a draft is a
`generation.yaml` alone, shown on the canvas, and its file lands under its own
name. A card whose generated file is gone is a missing file, never a draft
again. A generation that runs is recorded on the computer that started it,
under `.bh/cache/`, and only that computer follows and settles it, one window
at a time. `.bhnode` documents and the `outputs/` tree are removed. See
[generation cards](specs/generation-cards.md).

**Why.** On 2026-10-21 the user asked why BaseHalf had invented `.bhnode` at
all: Files showed `video.bhnode` and no video, and the video lay under
`outputs/<node id>/`, which put an `outputs` folder card beside the Video
card. Renaming the card changed a title inside the JSON, and Card Detail found
what made a video by reading every node file beside it. The running task sat
in the node file, so a teammate who pulled it through git settled a task that
only the starter's computer could follow, and it failed on theirs. On
2026-10-22, asked how image generation should store its images, the user chose
to change videos and images together. The card information that D44 already
carries along with a file is where a description and an upstream list live;
a prompt and the record of what made a file are the same kind of thing, and
git's model keeps unfinished work local.

**What was set aside.**
- Keeping `.bhnode` and adding image nodes. Faster to build, but Files would
  show node files instead of images, and a later change would redo two kinds.
- Writing the prompt and the record into the image's or video's own metadata,
  as a node-graph tool does with its PNG and MP4 files. A draft has no file to
  write into, and a file sent to someone else carries its prompt.
- A placeholder file for a draft. It is another invented file in the user's
  folder.
- Keeping the running task in shared card information. Only the computer that
  started a generation can follow it.
- One file for the prompt and the record. The panel, agents, and git edit the
  prompt; a conflict or an agent's rewrite would take the record with it.
- Offering to generate again when a generated file is missing. A file deleted
  to the trash, or one a teammate's clone does not have, would look like a draft
  and be paid for twice.

**Consequences.**
- Revises D27: what made a generated file, and a draft, live in
  `.bh/mirror/`; the generated content is an ordinary file in the user's
  folder.
- Revises D37: no `.bhnode` holds an upstream list; every node that is not a
  Markdown note, drafts included, keeps its list in `upstream.yaml`.
- Revises D58 and D59: the node file, its result, its task, and `outputs/`
  are replaced. The inputs in the order of the connections, the panel, the
  catalog, and generating again into a new card stay.
- Revises D44: `generation.yaml` and `made.yaml` are card information, and a
  draft is an item with card information and no file, which follows a moved
  folder. A card that generates is no longer held back from following a move:
  the move takes its task record along.
- `made.yaml` records the paths of the notes whose text joined the prompt,
  never their text, so that git shares no note the user did not commit.
- The six New Node actions and their empty nodes are removed; a file is put on
  a canvas by putting it in the folder.
- `basehalf --run-node` becomes `basehalf --generate`, `host.videoCatalog`
  becomes `host.modelCatalog`, the extension API `inspectCanvasNode` becomes
  `inspectGenerationCard`, and Sequence items name video files.
- The product has not launched: `.bhnode` files and `outputs/` folders that
  exist are not converted.

## D64 — BaseHalf generates images with the same cards, panel, and providers (NEW, 2026-10-22)

**Decision.** An image is generated the way a video is: a generation card with
the panel under it, its inputs in the order of its connections, and a model
from the catalog that BaseHalf ships, run with the user's own key. The catalog
adds the image models of ten providers that BaseHalf integrates for video
(ByteDance, Alibaba, Kling, MiniMax, Vidu, Google, Luma, Runway, xAI, and
Black Forest Labs) and OpenAI as a new provider, and the Video Providers page
becomes Providers. A ChatGPT subscription is used through the user's own Codex
in the Agent Area: BaseHalf never reads or forwards a Codex login, and Codex
is not a model of the panel. See [generation cards](specs/generation-cards.md)
and [providers and the model catalog](specs/providers.md).

**Why.** On 2026-10-22 the user asked whether image generation should follow
the products in `reference/`: model setup, model choice, the image card, and
a Codex login. The open-source canvas sets up channels with a script per model,
guesses a model's kind from its name, and offers one quality list for every
model, which is what D59 replaced; its panel and its card follow the canvas
products for media work that BaseHalf follows. The node-graph product declares
every image model's parameters exactly, as BaseHalf's catalog does. Ten of the
twelve video providers sell image models under the same key, so a user who set
up video gets images without a new key. For the subscription, OpenAI's rules of
2026-09-29 decide: its Sign in with ChatGPT is open to local and open-source
apps but does not offer image generation; driving Codex's app-server with the
user's login is tolerated for local and open-source apps and never for
commercial ones; and reading Codex's stored login breaks its Terms of Use, and
because its refresh tokens are single use, another app that refreshes one signs
the user's Codex out. No reference product reads the login.

**What was set aside.**
- The open-source canvas's channels, per-model scripts, model kind guessed from
  the name, and one quality list for every model, for D59's reasons.
- Codex as a model of the panel through its app-server. OpenAI recommends
  against it, it makes one image of about 1.57 million pixels whose size,
  quality, and count cannot be chosen, and its protocol is marked experimental.
  It can become a provider once Sign in with ChatGPT offers image generation.
- Reading or refreshing the Codex login.
- Running a local node-graph tool as a provider. Its "model" is a workflow the
  user built, which a fixed catalog cannot declare.

**Consequences.**
- A model of the catalog has a kind, image or video, and a card offers the
  models of its kind.
- Provider requests that answer at once with the files (OpenAI, Google, Alibaba,
  ByteDance, MiniMax) run beside the ones that run as tasks.
- An image model makes its image from references, or from the prompt alone
  when it has none, and declares the format it delivers, so that a draft has
  its final name before it generates. Image parameters such as `quality`,
  `count`, `background`, and the resolutions `1K`, `2K`, and `4K` join the
  shared parameter names.
- A generation of several images makes one card per image before it sends:
  the canvas products for media work show several results of one node, but a
  file is a card, and each image is a file.
- The agent skill says how an agent puts an image it made itself, with its own
  image generation, onto the canvas.

## D65 — No system tooltips, sound that fades, and Card Detail that fades in place (NEW, 2026-10-23; the growing out of its card replaced the same day)

**Decision.** Three things about how BaseHalf feels under the pointer and in
the speakers.

- BaseHalf never shows the system's tooltip, the box of an HTML `title`. A
  hover is the workbench's own, and only where it tells what is not in view:
  the name and the key of a button that shows only an icon, why a control is
  disabled or refuses what was typed, the whole of a message that is cut
  short, and what the panel of a generation card says of its model, settings,
  and inputs. A card, a name, a path, a row, a tab, and a button that shows
  its words show nothing more.
- The sound of a video or a sound file never starts or stops at once. It
  comes up over 40 ms and goes down over 60 ms before a pause, over the last
  100 ms, and for each jump of the position. Card Detail plays a video and a
  sound in the same player as the canvas, and no sound plays in the system's
  controls.
- Card Detail fades in and out where it is, over the canvas area, and no
  frame shows it empty or draws outside the canvas area: the canvas stays
  until Card Detail is drawn, at most 250 ms. Closing it draws no picture of
  a card anew. Once open it takes the keyboard, and Escape closes it wherever
  in it the keyboard is.
- A card and Card Detail show the same files, by one list, and the window
  loads every image, sound, and video of it.

See [architecture invariants, "Product shell"](harness/architecture-invariants.md#product-shell),
[generation cards, "The player"](specs/generation-cards.md#the-player), and
[opening and closing Card Detail](specs/card-detail-opening.md).

**Why.** On 2026-10-23 the user pointed at the box "video.mp4 - click to
select; double-click to open the editor" that the system drew over a video
card, said that BaseHalf had many such boxes, and that none of them were
needed. BaseHalf set one in 51 places: on every card, on names, rows, paths,
tabs, and buttons, most of them repeating what was in view or telling how to
click. VS Code's own
buttons draw the workbench's hover instead, in the workbench's colors, and
only for what an icon cannot say.

The user also heard a pop when a video paused, as if a microphone clipped,
and asked whether that was normal. Chromium stops a sound in the middle of
its wave, and the speakers play the jump to silence as a click. The video
the user had made was loud in its second half, about 0.4 of full scale, and
its last sample stood at 0.59: every pause there, and every end, was a jump
of that size. Players that sound smooth fade; BaseHalf's paused at once.
Card Detail played the video with the system's controls, whose pause cannot
be faded, so it now uses BaseHalf's player.

Last, opening a card with a double click and closing Card Detail flashed and
felt abrupt. Recorded frame by frame: an empty Card Detail for 140 ms before
the video, and on closing every card drawn anew, the video card's picture
empty for a frame. A view transition of the window keeps the old frame until
Card Detail is drawn; an editor in a webview is left out of it, which the
browser would otherwise hold up for 2 s.

The first answer moved the card's picture into Card Detail and back. The
user found that for a frame or two the motion reached past the canvas, which
felt out of control: the browser draws such a move above the whole window,
from the card's whole rectangle, and a card partly under the sidebar, or
larger than the canvas at a high zoom, drew over the sidebar. Card Detail
now fades in place, from 98% of its size, and nothing of the canvas moves.
The user also listed, among what the first answer left, video files that
did not play on their cards (MOV, M4V, MKV) and sounds that did not (WAV):
the canvas, Card Detail, and the window's file protocol each had a list of
their own. And opening a note with Expand left the keyboard on the canvas,
and Escape in it did nothing, because keys typed in a webview do not reach
the canvas, and the editor took Escape to put its caret away.

**Consequences.**
- Buttons that show only an icon, in the canvas, Card Detail, the Agent Area,
  and the title bar's location, show their names in the workbench's hover.
  Hovering a failed generation card's error shows the whole error only when
  two lines cut it; the path of a card that cannot be shown is not shown.
- A video's sound goes through the window's audio graph once its sound is on;
  the graph runs only while such a video plays. A video without sound plays
  as before.
- Card Detail of a video starts at the frame its card showed, has the
  player's controls with Full Screen, and leaves its card at the frame where
  it stopped. A sound plays on its card and in Card Detail in the same
  player, with the glyph of a sound for its picture.
- Pages of Card Detail in webviews, the editor of a note, an image, and a
  PDF, say when Escape was typed in them and nothing of theirs used it.

## D66 — Only text cards resize; an image or a video card has its picture's shape (NEW, 2026-10-23)

**Decision.** The user resizes the card of a note, of another text or code
file, of a PDF, of another file, and of a folder. The card of an image, a
video, or a sound has no resize controls. An image or a video card, a
generation card among them, is shaped as its picture: its full shape has a
short side of 300 and a long side that follows the picture's ratio, up to
three times the short side, and a card with less room at its place is as
large as that room allows. A draft has the ratio its settings choose. A
sound card keeps the size of a file card.

See [canvas card placement, "The card of an image or a video has its
picture's shape"](specs/canvas-card-placement.md#the-card-of-an-image-or-a-video-has-its-pictures-shape)
and [canvas card resize, "Which cards resize"](specs/canvas-card-resize.md#which-cards-resize).

**Why.** On 2026-10-23 the user asked whether image and video nodes should
resize at all, since only text nodes seemed to need it. The two canvas
products for media work that BaseHalf follows agree, checked that day in the
user's own canvases: text nodes have resize handles, and image, video, and
audio nodes have none, selected or not. Their media nodes are shaped as
their picture instead, with a short side of 300 in one of them (533 × 300
for a 16:9 video, 300 × 750 for a tall image).

BaseHalf drew cards of a fixed size by kind: 720 × 405 for a video, and
300 × 220 for an image, which an image filled and was cropped to. Resizing
was the one way to see a tall or a wide image whole. Taking resizing away
alone would have left it cropped for good, so the card takes the picture's
shape.

A first build gave each card its full shape where it was. In a canvas laid
out in the earlier grid the cards then covered their neighbours, so the size
of a card takes the room at its place into account.

**Consequences.**
- BaseHalf measures each picture in the window, once for each version of the
  file, and saves the card's row with its size, so that the layout stores
  what the canvas shows. A card that appears has its full shape and is
  placed once that is known. A card on the canvas has its shape where it is,
  as large as the room at its corner allows: it comes no closer to another
  card than the grid's gaps, grows when room comes free, and keeps its size
  when a card comes near, so BaseHalf still puts no card on another. In a
  canvas of the earlier grid, picture cards are smaller than new ones until
  the cards around them move.
- The image of a card is fitted, not cropped.
- New Video draws a 16:9 draft at 533 × 300 instead of 720 × 405.

## D67 — A draft is what will be made; a generated file shows what made it (NEW, 2026-10-23)

**Decision.** Only a draft of a generation card can be changed and generated.
A card with its generated file never changes: its panel shows the inputs,
prompt, model, and settings of its `made.yaml`, nothing in it can be edited,
and its one action is **New Version**, which makes a new draft beside it with
the same prompt, model, mode, values (without the seed), and inputs, selected
and with its prompt focused, and generates nothing until the user does. A
draft's `generation.yaml` is removed when its file lands; a file without a
`made.yaml`, such as one uploaded into a draft, is an ordinary file with no
panel. Every input connected to a draft is sent: a connection the draft's
model cannot use is refused when it is made, the mode that is used follows
the inputs, and an input that becomes unusable stops Generate with the
reason. The connections of a card with its file, and of a draft while it
generates, are not added, removed, or changed. See [generation
cards](specs/generation-cards.md#the-panel-of-a-card-with-its-file),
["What is connected is sent"](specs/generation-cards.md#what-is-connected-is-sent),
and ["New Version"](specs/generation-cards.md#new-version).

**Why.** On 2026-10-23 the user found the panel confusing: after a video was
generated, its prompt could still be changed and sent, and with one video
connected into another, both prompts could be changed. D63 had made the file
the card and decided that a generated file never changes, but the panel was
still the draft's: what was typed under a generated video went into a
`generation.yaml` that only the next card beside it would use, and the
prompt under the video no longer said what had made it. In the cards the
user made that day, three of six showed a prompt that was not their
`made.yaml`'s, and three video cards connected from a video, all in Frames,
had never sent it.

The canvas products for media work keep a generated node's prompt editable
because sending there changes that same node: one of them replaces its
result and keeps earlier ones in a history, and the other adds a version
inside the node. A card that is a file cannot change that way. Their way of
keeping several versions side by side is to copy a node with its
connections and generate the copy, which is New Version. A node-graph tool
keeps its recipe apart from its results, which are files it never
overwrites, each holding the recipe that made it; a canvas app that sends
from a node with a result derives a new connected node, but for a video it
drew a connection without sending the video. What the canvas products agree
on beside that, and what BaseHalf takes: media that was uploaded has no
generation panel; one of them disables a mode that cannot use the connected
media; the other chooses the generation type from what is connected.

**What was set aside.**
- Generating a card again in place, with the earlier file kept as a version:
  the card would no longer be one file, and the earlier file would be
  renamed or hidden under `.bh/`.
- Keeping the editable prompt under a generated file with a label that says
  it is for the next card: the prompt under the file would still not be the
  one that made it.
- Typing under a generated image to make a changed copy of it, connected
  from it: the same box would mean three things for an empty card, an image,
  and a video. Connecting from the card does that, for every kind.
- Removing at landing the connections that a generation did not use: no
  background change of an upstream value (reference graph, invariant 4).
  Refusing what the model cannot use, and stopping Generate, keep every
  connection true without it.
- Recording the text of connected notes in `made.yaml`: still left out, as
  D63 decided, so that git shares no note the user did not commit.

**Consequences.**
- Revises D63: a card with its file has no `generation.yaml`, and its
  connections are the inputs that made it. Generating from a card with its
  file is New Version, then Generate on the draft; `basehalf --generate` on a
  card with its file does both. The authoring contract agents read is
  version 6, and the agent skill text version 7.
- The mode in a draft's `generation.yaml` is the one the user or an agent
  chose; the panel shows, sends, and records the mode that is used.
- Upload into a draft removes the draft's prompt, settings, and connections,
  since the uploaded file was not made from them.
- Capture Frame connects the image it makes from its video.
- The product has not launched: a `generation.yaml` that an earlier build
  left beside a generated file is not read, and nothing converts it.

## D68 — A card's references are its connections, and a name in its prompt follows its input (NEW, 2026-10-24)

**Decision.** The input row above a draft's prompt is the draft's
connections: one tile for each entry of its list, in order, with the input's
picture, the number of its name, a larger look when the pointer is on it, a
cross that removes the connection, an `@` that puts its name into the prompt,
and a drag that changes its place in the list. A connection made or removed
anywhere shows in the row at once, and the row adds and removes nothing but
connections. The names in the prompt (图片1, Video 2) show as chips with their
input's picture; what is stored and sent is still their text. Typing `@`
opens a reference menu with a search field, the connected inputs, and the
cards of the canvas by kind; choosing a card that is not connected connects
it. When BaseHalf removes, reorders, or replaces an entry of a draft's list,
from the panel, the canvas, or the badge editor, it gives the names in the
draft's prompt their inputs' new numbers and takes out the names of inputs
that are no longer connected, in the same step of undo, through a
participant of the reference edit service. See [generation
cards](specs/generation-cards.md#the-panel),
["Names follow their inputs"](specs/generation-cards.md#mentions) (since D74, "Mentions"),
and the [reference graph](specs/reference-graph.md#undo).

**Why.** On 2026-10-24 the user asked for the prompt field and its references
to work as in the two canvas products for media work: the connections and the
references above the field are one, so that what is removed or added in one
is removed or added in the other; each reference has a preview, a number, and
a cross; and `@` in the field opens a menu. In both products, the cross of a
reference removes its connection, cutting the connection removes the
reference, picking a card on the canvas connects it, and pointing at a
reference shows its picture larger above it. One of them numbers its
references and makes each mention a chip bound to its node: removing a
reference took its chips out of the prompt and renumbered the others, and
dragging a reference to the front renumbered the references and the chips
together. Its `@` menu moves the keyboard into a search field and lists the
referenced nodes and then the canvas's nodes by kind; picking one that was
not referenced connected it. The other names its chips after their nodes and
lists the connected nodes and the user's own library.

BaseHalf's names were text that meant a place in the list. Removing the
first of three images made the second name the third without a word, as the
earlier specification allowed ("keeps meaning the same input while the list
keeps its order").

**What was set aside.**
- Keeping a mention as a path in the prompt and making the names when the
  prompt is sent: the models read names, agents write them, and the prompt
  would have one form on disk and another in the request.
- Naming chips after their cards, as one of the products does: the models
  that take references read numbered names.
- Renumbering only from the panel: most connections are removed on the
  canvas, and deleting a card can remove its entries too.
- Renumbering after any change of `upstream.yaml`, by watching it: an
  agent's own list would change its prompt behind it, and undo could not
  bring back a name that was taken out.
- Notes under On This Canvas: a note has no name in a prompt; its text joins
  the prompt when it is connected.
- A double click on a reference that shows its card on the canvas, as one of
  the products has: left for later.

**Consequences.**
- The prompt is BaseHalf's own text field with chips and its own undo and
  Select All. VS Code takes only `input` and `textarea` for text fields, so
  its Undo would otherwise undo a step of the canvas while the prompt has the
  keyboard, and its Select All would select nothing.
- The reference edit service has participants (reference graph, Undo).
- The panel is at most 268 px tall instead of 260, for 48 px tiles.
- What agents read and write does not change: `generation.yaml` holds the
  prompt as text, and a list that an agent writes changes no prompt.

## D69 — Pick on Canvas stays on and shows what a click does (NEW, 2026-10-24)

**Decision.** Pick on Canvas lets the user click several cards in a row: a
click connects a card to the draft, a click on a connected card removes it,
and Escape or Done ends it. While it is on, a bar at the top of the canvas
says what a click does; the pointer and a label beside it say what a click
on the card under it does, or why the card cannot be an input; connected
cards are darkened with a check mark and cards that cannot be inputs are
faded; and the canvas itself is not edited. See [generation
cards](specs/generation-cards.md#pick-on-canvas).

**Why.** On 2026-10-24 the user found Pick on Canvas wanting: the pointer did
not change and showed the hand that moves a card over other cards, and the
mode had no whole logic for what a click does and what the user sees, such as
that a card already chosen cannot be chosen again. In the two canvas products
for media work, the first keeps picking references on until it is ended: a
bar at the top says to pick from the canvas, with a button that ends it; the
pointer is the arrow, never the hand that moves a node; a label beside the
pointer names the card a click selects, or offers to deselect a connected
one, which is darkened; a click on the blank canvas does not end it, and the
wheel moves the view. The second picks one card for a frame slot and ends:
its bar names what is picked, its pointer is the pointing hand, and only the
cards that fit the slot react. Neither says why a card cannot be used: the
first offers it and lets the click do nothing, the second leaves it as it
is.

**What was set aside.**
- Ending after one card, as the second product does for a frame slot:
  references are several, and a draft's frames come from the order of its
  list, so one way of picking serves both.
- A click on the blank canvas ending picking, as BaseHalf's first build did:
  both products keep picking, and a click that misses a card would end it.
- A button that brings the draft back into sight and ends picking, as the
  first product has: BaseHalf does not move the view for the user (D50), and
  Done ends picking where the user is.

**Consequences.**
- The panel tells the canvas, for each card, whether a click connects it,
  removes it, or cannot use it and why, by the same rule that refuses a line
  drawn on the canvas; the canvas draws the bar, the label, the pointer, and
  the cards' looks, and hands the clicks back.
- While picking, the canvas hides what would edit it, the handles that draw
  a connection and the toolbars of the selection, and opens no menu; the
  view still moves and zooms.
- Drawing the input row or the prompt again keeps the pictures of the tiles
  and chips that stay, so a connection made or removed blinks nothing, and
  an input that comes back soon, by undo or a second click, shows its
  picture at once.

## D70 — What the inputs leave room for is what the settings offer, and Generate says why it cannot run where it is (NEW, 2026-10-24)

**Decision.** A provider's rule that narrows how far a number goes for the
connected inputs, such as Wan 3.0's input videos and result being at most 30
seconds together, narrows the setting itself: its range ends there with its
reason under it, a value chosen beyond it is used as its end, shown, sent,
and recorded so, and the card keeps the value it chose. A video's and a
sound's tile shows its length, and the model menu shows each video model's
range of durations. A reason that the panel itself fixes, an input, a
setting, the model, or the prompt, dims Generate with the reason as its
tooltip and shows no line above the footer; the line stays for a reason
fixed outside the panel, with its Set Up or Providers…. See [generation
cards](specs/generation-cards.md#settings) and
[providers](specs/providers.md#requests).

**Why.** On 2026-10-24 the user found the line "The video lasts 5.0 seconds
and the result is to be 30 seconds…" abrupt: with the duration set to 30
seconds it showed for every video connected, and the settings had offered
the 30 seconds in the first place. In the two canvas products for media
work, a choice that cannot be made is not offered, or is dimmed with its
reason when pointed at ("this model does not support the connected video"),
the send button is dimmed when the user has not chosen rightly, with the
reason when pointed at in the first and none in the second, and neither
shows a warning line in the panel. The first shows a video's length on its
tile; the second lists each model with its resolution and its range of
durations. Neither narrows a duration for the input videos: the first
offers 2 to 30 seconds with a 6.8-second video connected and prices 36
seconds, a request the provider refuses.

**What was set aside.**
- Offering the declared range and reporting the problem, as BaseHalf did:
  the user is told off for a choice the panel offered.
- Offering the declared range and sending it, as the first product does: the
  provider refuses the request after the user has waited.
- Writing the fitted value into the card: the value the user chose would be
  lost when the inputs change again.

**Consequences.**
- `check` answers `limits`, a narrower range of a number parameter with its
  reason, and fits a value beyond it before the rules are checked; `submit`
  fits as `check` does, and the window sends and records the fitted value.
- The rules of Wan 3.0, Wan 2.7 References, PixVerse Extend, and Grok
  Imagine Video's References and Extend are limits now, not problems.
- A problem `check` still reports, such as a prompt that sets a value the
  settings own, shows only on Generate's tooltip.

## D71 — Adding an input is two buttons at the panel's top right, and notes are in the reference menu (NEW, 2026-10-24)

> **Revised by D91 (2026-10-27).** On an image card the two buttons are at
> the start of the panel's footer, since its panel has no input row until it
> has an input. The rest of D71 stands.

**Decision.** The plus at the end of a draft's input row gives way to two
icon buttons at the panel's top right, at the row's right end: **Pick on
Canvas**, which is highlighted with the accent while the draft picks and
ends picking when it is clicked again, and **Import File…**. While the
draft picks, the row's hint is read by assistive technology and not shown,
so the tiles keep their room. An empty frame still opens a menu of the two.
Import File… is a draft's one upload: its toolbar no longer offers Upload
Image or Upload Video, so a selected draft has no toolbar. Its icon is a
paperclip, not a cloud: nothing is uploaded anywhere, the file is copied
into the card's folder. A tile shows no number: the name of an input, such
as 图片2, is in its look, on its chip in the prompt, and in the reference
menu, and the prompt's names stay as the models expect them. The reference menu lists notes: a connected
note under Connected, and **Notes** under On This Canvas. Choosing a note
connects it; a note has no name, so the `@` is taken out and nothing takes
its place, and its text is sent after the prompt as every connected note's
is. The pointer over a tile is the arrow. The input row draws again only
when what it shows changes, and the look at a tile stays while its input
stays. See [generation cards](specs/generation-cards.md#the-panel).

**Why.** On 2026-10-24 the user asked for a Note entry in the reference
menu; found that clicking a tile's `@` made its look blink twice; said the
grab hand over a tile was wrong; and asked for the plus to become two
buttons at the top right of the input box, Pick highlighted while picking.
In the first of the two canvas products for media work, the input box has
an upload button and a canvas reference button above its tiles, and the
canvas reference button is highlighted while picking; its `@` menu lists
text beside images, videos, audio, and assets, and choosing a text puts
nothing in the prompt, where an image puts its name. Its pointer over a
tile's picture is the pointing hand, since a click there moves the view to
the card; a click on a tile does nothing in BaseHalf, where the user moves
the view ([D50](#d50--a-place-the-user-points-at-is-taken-as-it-is-new-2026-10-12)),
so the arrow. The second starts picking from an empty frame's plus, which
stays highlighted while it picks.

Later the same day the user found that the card still had Upload Video
above it, beside the panel's new button, and asked to keep only the one at
the panel's top right, and to change its icon, which looked like an upload
to a cloud. The two did different things, one put a file in the draft's
place and the other connects one to it, and read as one button twice. No
other kind of card shows an upload or a cloud.

Then the user found the numbers of the tiles wrong: in a row of videos, an
image, and notes they read 1, none, 2, 1, none, none, 3, 4. A number was the
number of the input's name by its kind, as the models count inputs, and a
note has no name. Asked whether the tiles should count every input by kind
with the kind on the badge, or count all inputs in one row with the names
following, the user answered that the tiles need no number at all, which
is also easy to take for a part of a file's name, such as `video-2.mp4`.

The blink: the row compared what it draws by a key in which a file's address
carried the fields it caches. The check reads a file's path, which adds one,
and a save reads the inputs again, which drops it: two redraws half a second
apart, each building the look anew with a picture to decode.

**What was set aside.**
- The two buttons in a line of their own above the tiles, as the first
  product has them: the panel grows by a line, and the user asked for the
  top right.
- Labels beside the icons: two labels take the room of four tiles in the
  row; the tooltip and the accessible name say them.
- A name for a note in the prompt, such as Note 1: a note's text is sent
  after the prompt, so a name there would point the provider at nothing.
- Keeping Upload above a draft, which put the chosen file in the draft's
  place: a file the user already has goes on the canvas by a drop, and the
  draft is deleted.
- Numbering the tiles by kind with the kind on the badge, or in one row with
  the prompt's names following and changed back for the models when sent:
  the user chose no number.

**Consequences.**
- The input row has no plus; the smoke starts picking with the button.
- A note can be connected from the prompt as a card is, by `@`.
- Revises D67: no file is uploaded into a draft, so the draft's toolbar,
  its Upload, and the service behind it are gone.
- Revises D68: a tile shows no number; the names in the prompt are as they
  were.

## D72 — The title bar has no control of the panel (NEW, 2026-10-24)

**Decision.** The right group of the title bar no longer shows Toggle Panel,
and the View menu's Appearance submenu no longer lists Panel. The control
of the Agent Area is the one control of the right side. Cmd+J and the
command stay. See [layout controls](specs/layout-controls.md#the-panel).

**Why.** On 2026-10-24 the user asked what to do with the two buttons at the
top right, and said that the one for the terminal below could go, since the
terminal is in the Agent Area. BaseHalf shows no panel under the canvas: its
command has opened and closed the Agent Area since
[D21](#d21--right-side-is-agent-area-not-terminal-panel-new-2026-06-30)
routed the terminal there. The two buttons did the same thing, and the
panel's icon never showed the Agent Area open. One part has one control
([D56](#d56--a-layout-control-is-in-the-title-bar-on-the-side-of-its-part-new-2026-10-13)).

**What was set aside.**
- One button that shows the panel's icon: the icon stands for a part under
  the editor, which BaseHalf does not have.
- Taking Cmd+J away: it does what VS Code users expect of it, opening the
  terminal, and is shown nowhere.

**Consequences.**
- Revises the scope of D56, which left the panel's control as it was.
- Customize Layout, in the command palette, still lists the panel.

## D73 — A click on the title bar's location opens the search (NEW, 2026-10-24)

**Decision.** In the box in the middle of the title bar, a click anywhere
opens the search, except on a folder of the path, which opens that folder's
canvas, and on "…", which lists the folders it stands for. A press on the
box leaves the keyboard where it was, and shortcuts work while the keyboard
is in the box. See [the location in the title bar](specs/title-bar-location.md).

**Why.** On 2026-10-24 the user asked whether the Quick Input at the top had
a bug, since a click on it seemed to do nothing. Since 2026-07-12 the box
took a click only on its magnifier and on the folders of its path; at the
root of a workspace that was 16 of its 600 px. Everything else about it said
it was one button: it lit up under the pointer, the pointer was the
pointing hand over all of it, and its hover said "Search …". VS Code's
command center, which the box is, opens the search on a click anywhere. A
press also moved the keyboard into the box, and the box held every key so
that Enter on a folder would not also open the search; no shortcut worked
until the user clicked somewhere else. No decision or specification had set
the box apart from the command center; the rule was in the code and in a
smoke step.

**What was set aside.**
- Keeping the box passive and taking away its button look: the box would
  still be the widest control of the window that does nothing.
- A field to type in, in the box: the search is VS Code's Quick Open, and
  it already takes the box's place when it opens.

**Consequences.**
- Revises the rule of 2026-07-12 that a click on the current place, on a
  chevron, or on the box's free room did nothing.
- A press on the box no longer takes the keyboard. Tab still reaches it.

## D74 — A prompt mentions its inputs' files, and each provider module names them as its model reads them (NEW, 2026-10-24)

**Decision.** A mention in a draft's prompt is its input's file. It is
stored as `@[<entry>]`, the entry of the card's `upstream` list that names
the input, and shows as a chip with the file's picture or glyph and its
name. Every input can be mentioned, a note too: the reference menu and the
`@` of a tile put the mention in. When a generation is sent, the window
gives AI Video the prompt's text and, for each mention of an image, a video,
or a sound, that input's place in the request; the provider module writes
it as its model reads it, counting by the order of the request, and the
check answers the prompt so written. A mention of a note is written as the
note's name in double quotes, and every note's text follows the prompt
under its name and a colon. A mention follows its input: a rename or a move of the
file, a relink, or a connection whose source moved to another card writes
the new path into it, and a removed connection takes it out, in the same
step of undo; adding and reordering change no mention. A mention of a file
that is not connected keeps Generate from running. See [generation
cards](specs/generation-cards.md#mentions) and [providers and the model
catalog](specs/providers.md#names-in-the-prompt).

**Why.** On 2026-10-24, after the tiles lost their numbers (D71), the user
asked whether a name in the prompt should simply be the file's own name, and
then, when the first answer translated the names for each provider, why
anything had to be translated at all and what the essential way was. 图片2
was a number in the list standing for a file: it told the user nothing
about which file, it had to be written again whenever the list changed
(D68), and only some models read names of that form. In their own
documentation, Kling's omni models read `<<<image_1>>>`, Runway reads
`@image1` for a reference tagged `image1`, xAI reads `<IMAGE_0>` counted
from 0, and Wan 2.6 reads `character1` across its images and videos;
BaseHalf sent the prompt as written, so a prompt named its input at one
model and nothing at another. An open canvas app for media generation
stores a mention as the node it names, shows the node on the chip, and
numbers the mentions only when it sends; a node-graph tool rewrites
`@image1` into Kling's `<<<image_1>>>` before it sends.

**What was set aside.**
- Keeping 图片1 in the prompt and translating it for each provider when
  it is sent: the name would still be a number of the list, which changes
  with the list and says nothing about the file.
- One sequence of numbers for all inputs, shown on the chips: the user
  chose no numbers on the tiles (D71), and a number reads as a part of a
  file's name.
- Sending only the inputs the prompt mentions, as the open canvas app does:
  what is connected is sent (D67), and a connection is a mention's input.
- Writing a note's text where it is mentioned: a note can be long and
  mentioned twice; its text follows the prompt under its name.
- A bare `@path` without brackets: where a path ends cannot be told from
  the text after it, as in `@a.png，然后`, and a mention of a file that is not
  connected could not be told from text.
- A path relative to the card's folder: an entry is relative to the
  workspace folder, and a mention is the same path as its entry, so that
  the rename refactor and the follower rewrite both alike.

**Consequences.**
- Revises D68: the prompt holds mentions, not names; the follower writes a
  new path into a mention or takes it out, and reordering writes nothing.
- Revises D71: a note has a name in the prompt, its file's name, and
  choosing it in the reference menu puts its chip in.
- `check` and `submit` of AI Video take the prompt in parts, each provider
  module names its inputs, and `check` answers the prompt as written; the
  task record keeps that prompt.
- The authoring contract of `generation.yaml` is version 7.
- Prompts written before name inputs as text, such as 图片1, and are sent as
  they are: the product has not launched, and nothing is converted.

## D75 — AI Video is BaseHalf's own code, not an extension (NEW, 2026-10-24)

**Decision.** AI Video stops being an extension. The provider modules and
what they share run in the shared process, the background process that the
application starts once for all of its windows, as a BaseHalf service that
every window calls directly. The Video Sequence document, its view, its
commands, and its agent capability, and the starter template, are the
workbench's own. The extension `pointa.basehalf-ai-video` and its folder
are gone, and the frozen plugin platform admits no extension, except the
one that an Extension Development Host was started with, as before.
Requests to providers are Node's own, one connection each and never sent
again by themselves, with VS Code's proxy agent, as they were in the
extension host: the system's proxy settings and certificates apply, and the
cross-origin rules of a window do not. What the user sees does not change. See
[built-in AI Video and no plugins](specs/built-in-ai-video-and-no-plugins.md),
[providers and the model catalog](specs/providers.md#requests), and
[Video Sequence](specs/video-sequence.md).

**Why.** D45 made AI Video built in but kept the package of a plugin, and no
user sees that package any more. What it left is a seam that every change
crossed twice. The window and the extension each defined the catalog and
every answer, the window read each answer again, and the two could be out of
step in a development window. AI Video was compiled and tested apart, and a
package built without its compiled extension had no AI Video at all. A
window waited for the extension host and for AI Video's activation before it
could show a model: on 2026-10-24, in a development build, AI Video
activated 2.9 seconds after the application started, 1.5 seconds after the
extension host did. And AI Video's requests, polls, and downloads shared the
one thread of the extension host with Git, GitHub, and the agents'
extensions. The extension existed for one reason: providers do not answer
cross-origin requests from a window, so the requests had to run outside it.
The shared process runs outside every window too, and VS Code already does
its own background work there.

**What was set aside.**
- Requests from the window, with cross-origin headers that the main process
  adds for each provider: that weakens what isolates the window, and a
  preflight request would still fail where a provider does not answer it.
- The main process: it carries the messages of every window, and a large
  download and its checks would share it.
- A process of AI Video's own, as the terminal has its pty host: more parts
  to start, connect, and restart, for an isolation that nothing asks for yet.
- Chromium's network stack, which the shared process's own requests use. It
  sends a request again by itself when a kept-alive connection fails before
  the answer, and a create sent twice can be charged twice: the first build
  of this change did so when the smoke's provider dropped a create on
  2026-10-24. Node's requests open a connection each and never send again;
  VS Code's proxy agent gives them the system's proxy and certificates, as
  it did in the extension host.
- Keeping the extension and only starting it earlier: the seam stays.

**Consequences.**
- Revises D45: AI Video is no built-in extension, and outside an Extension
  Development Host no extension is admitted to the frozen platform's
  contribution points, whose code and tests stay. Revises how D28 packages
  AI Video.
- The `basehalf.video.provider.*` commands are gone. The window calls the
  provider service, whose answers keep their form, `{ok: true, value}` or
  `{ok: false, error}`. The catalog and each request and answer have one
  definition, which the window and the service share.
- The ids of the Sequence commands, its view, and its agent capability stay,
  so Sequence files, agents, and the skill are unchanged.
- Messages that named AI Video as what did something name BaseHalf. "AI
  Video is not running" goes away: a call that does not reach the service
  fails as one whose service stopped while it ran.
- The log of the exchanges with providers is the shared process's log
  **BaseHalf Providers**.
- The main process resolves a proxy for a caller without a window, the
  provider service, with the session that every window uses.
- A release builds no AI Video of its own, and the check of a packaged
  layout no longer looks for it.

## D76 — The plugin platform is removed (NEW, 2026-10-25)

**Decision.** BaseHalf has no plugin platform, in the product or in the
repository. What leaves: the plugin catalog and its signature checks, the
installer and its records, the Plugins view and library, the admission of
reviewed plugins, the contribution points that extensions filled (canvas
templates, Card Detail projections, agent capabilities, and structural
cleanups), the `vscode.basehalf` extension API, the release tooling and its
checks, the workflows that published, promoted, withdrew, and rolled back
plugins, the developer packages `@basehalf/plugin-cli` and
`@basehalf/plugin-sdk` with their workflow, and the infrastructure
definitions of the registry. What BaseHalf itself uses stays and moves to the
feature it belongs to: the registries of canvas templates, Card Detail
projections, and agent capabilities, project file transitions with their
upstream guard, and the extension allowlist with its install policy. No
extension contributes to BaseHalf. VS Code's own extension system stays as
VS Code has it, its extension host, extension API, extension management, and
gallery, so that BaseHalf can build on it later: where BaseHalf changed VS
Code's files for its plugins, those parts go back to VS Code's code at the
import commit. The registry, the signing key, the storage
and the database behind it, the publishing services, and the published
packages are retired by their owner outside the repository. See
[built-in AI Video and no plugins](specs/built-in-ai-video-and-no-plugins.md).

**Why.** D45 froze the platform and kept its code so that the freeze could
be lifted without rebuilding it. Since D75 no extension is admitted at all,
and the code no longer describes a platform that could be reopened as it is:
the recipes, the Video node documents, the model catalogs that plugins
declared, and AI Video as an extension are gone (D58, D63, D75). It is still
about 12,000 lines in the application, among them tests, release tooling, and
an extension API, and about 8,500 beside it. Parts of it still ran: four
contribution points and the admission service at start, and a stage of
plugin cleanups, with no provider, in every delete. And one folder mixed what
BaseHalf uses every day with what nothing uses, so every change near it had
to tell them apart first.

**What was set aside.**
- Keeping the frozen code, as D45 decided. Reopening would rewrite it anyway,
  and git keeps it.
- Keeping the workflows that withdraw and roll back published plugins, and
  the infrastructure definitions, until the registry is shut down, for the
  builds that are already distributed. The owner chose to remove them now
  and to retire the services by hand, with the code from git history where
  it helps.
- Keeping BaseHalf's extension API, `vscode.basehalf`, for an Extension
  Development Host. No extension is written against it, and VS Code's own
  API stays for whatever BaseHalf builds on extensions later.

**Consequences.**
- Replaces what D45 kept: the platform's code, its tests, its smoke slice,
  and the recorded exception to D23. D25 to D34 now describe a platform that
  exists in neither the product nor the repository.
- D37 stands: a project file transition that is not BaseHalf's own operation,
  such as a change to a Sequence, may change no upstream value.
- Templates, projections, and agent capabilities are registered by BaseHalf's
  own features only.
- The extension allowlist is unchanged: BaseHalf runs its built-in
  extensions, the agent extensions it supports, and the extension that an
  Extension Development Host was started with, and installs nothing else.
- A link that used to open a plugin still brings BaseHalf to the front and
  does nothing else.
- Builds that are already distributed keep reading the registry for as long
  as it is online.

## D77 — New Folder makes a folder at once, and the canvas has no New File (NEW, 2026-10-25)

**Decision.** The canvas's menu offers New Note, New Image, New Video, and
New Folder. New Folder makes the folder `untitled folder`, or the first free
`untitled folder 2`, `untitled folder 3`, …, at once, with nothing to fill
in. Its card is placed and selected as any card the user creates, and one
undo on the canvas takes the folder back. The menu has no New File. See
[canvas Create menu](specs/canvas-create-menu.md).

**Why.** On 2026-10-25 the user called the box that New Folder opened ugly:
a framed field with a glyph over the canvas, empty, with a message under it
while they typed. They asked that New Folder make a folder with a default
name, and that the menu not offer New File, since a user who wants a file
makes it in Files. Since
[D55](#d55--a-note-is-named-without-its-extension-new-2026-10-13) a name is
changed on the card itself, so the box was a second name editor, there
before the item existed. New File asked for an exact file name with its
extension; the files of a canvas come from New Note, from a generation, or
from Import Files..., a drop, a paste, or an agent.

**What was set aside.**
- Opening the card's rename editor at once, as the system's file manager
  does: the user asked for the folder with its default name, and the name is
  a double click away.
- Naming a folder as a new note is named (`untitled`, `untitled-1`): a
  folder and a note would show the same name side by side.
- Undo in Files only, as before: a folder made with one click is taken back
  where it was made, as New Image and New Video are.

**Consequences.**
- Revises the internal decision of 2026-08-10 that canvas creation stays on
  the canvas, which kept a typed name for New File and New Folder. The rest
  of it holds: a create selects its card and opens nothing.
- The box for the name of a new item is gone. The rename editor on a card is
  the canvas's only name editor.
- New Note is unchanged, also in how it is undone.

## D78 — BaseHalf makes speech, music, and sound effects with the same cards, panel, and providers (NEW, 2026-10-25)

**Decision.** A sound is generated the way an image or a video is: an audio
generation card with the panel under it, its inputs in the order of its
connections, and a model from the catalog that BaseHalf ships, run with the
user's own key. The catalog's third kind, audio, has models that say what
they make: speech, music, or sound effects. The first ones are ElevenLabs'
speech and sound effects, Fish Audio's speech, and Mureka's music, from
three new providers, and MiniMax's speech and Google's Gemini speech and
Lyria music, under keys that users already set up. A speech model speaks in
a voice chosen with the panel's voice button: one of the provider's voices
or one of the user's account, which the provider lists, with its sample. A
music model that sings given lyrics takes them as its prompt in Lyrics mode.
A note connected to a speech card is what the voice says. See
[generation cards](specs/generation-cards.md) and
[providers and the model catalog](specs/providers.md).

**Why.** On 2026-10-25 the user asked for audio cards made the way image and
video cards are, with Fish Audio, MiniMax, ElevenLabs, and music models,
after research into other products and these models. A canvas product for
media work has one audio node whose panel follows the model: the prompt is
the text to speak, the description of a sound, or the lyrics; a speech
model's voice is chosen from the provider's voices, with samples, and the
account's own; and a song model chooses between a description and lyrics.
The node-graph product makes one node per task and passes voices between
them; BaseHalf keeps one card per kind drawn from the catalog's exact
declarations, as for images. MiniMax and Google sell speech under the keys
BaseHalf stores, and Google sells songs; ElevenLabs, Fish Audio, and Mureka
are reached with keys of their own, bought without a subscription to
another product. BaseHalf is a canvas of notes, so a script or lyrics
written in a note are its natural input.

**What was set aside.**
- MiniMax's music. Since 2026-08-20 its music and lyrics APIs serve only
  users who paid for them before, and its model list marks the models
  retired.
- ElevenLabs' music. Its Music Terms forbid "offering any Music Model
  alongside third-party models" as model resale, which a model menu of
  several providers does even with the user's own key; it waits until
  ElevenLabs says that such a client may offer it.
- OpenAI's speech models, which shut down on 2027-01-06; two music apps
  that offer no public API; Lyria RealTime, a stream without a file; and
  Lyria 2 and ByteDance's Seed Audio, which need credentials other than the
  key BaseHalf stores for the provider.
- Making a voice from a recording on the canvas. Cloning stores a voice at
  the provider, which some charge for at its first use and delete when it
  is not used within days, and the provider asks for the speaker's consent;
  the user makes the voice in the provider's own app, and it then is among
  the account's voices in the voice menu.
- A list of voices in the catalog for providers that list them. Their
  libraries hold hundreds to thousands of voices that change, and the
  account's own voices are only known to the provider.
- A sound's own card with a waveform. A sound keeps the card of a sound
  file and its player.
- For later: dialogue with several voices; sound made for a connected video;
  and the speech and sound effects that xAI, Kling, Vidu, and Runway sell
  under keys BaseHalf already stores.

**Consequences.**
- A model of the catalog has a kind, image, video, or audio, and an audio
  model says what it makes; a card offers the models of its kind.
- An audio model declares the format it delivers, MP3 unless the provider
  gives only WAV, so that a draft has its final name before it generates.
- New shared parameters: `voice`, `speed`, `instrumental`, and `style`;
  `duration` and `count` also measure sounds and songs, and several songs
  of one generation are one card each, as several images are.
- The provider service lists a provider's voices and the account's, and
  fetches a voice's sample for the window to play, with the requests and
  rules of a generation.
- In a prompt that is spoken or sung, a note joins as its text alone, where
  it is mentioned or after the prompt.

## D79 — Card Detail trims a video in place, and undo puts it back (NEW, 2026-10-25)

> **Revised by D84 (2026-10-26).** The trim bar is the frame viewer of Card
> Detail's edit mode, shown after Edit, and Done takes the place of Trim. The
> video before a trim is no longer kept only for undo until the window
> closes: its original stays in its card information until it is reverted,
> and every edit starts from it. `made.yaml` no longer gets `trimStart` and
> `trimEnd`; the edit record (`edit.yaml`) says how any edited file was made
> from its original. See [editing media](specs/media-editing.md).

**Decision.** Card Detail of a video has a trim bar under its player: a strip
of the video's frames, a selection with two handles, a playhead, and Trim.
Trim replaces the video with the selected part, under its name, in its
folder, on its card, with its connections: the part is encoded again by the
window's own encoders, with BaseHalf's own code for reading and writing MP4,
MOV, and WebM files, and keeps the video's container. The trim is one step of
the canvas's undo: undo puts the video back byte for byte from the kept
versions, and redo trims it again
([D82](#d82--a-delete-on-the-canvas-asks-nothing-and-undo-brings-back-exactly-what-a-step-took-new-2026-10-25)).
A generated video keeps its `made.yaml`, which then also records the part of
what was generated that the video holds. Its specification is now part of
[editing media](specs/media-editing.md).

**Why.** The user asked for simple editing in the room under the enlarged
video. The canvas products for media work trim the same way: a strip of
frames under the enlarged video, a part chosen with two handles, and a
confirmation. A first build saved the part as a new file beside the video,
connected from it, so that the video never changed; the user judged that an
edit should change what it edits and be undone as every other change is, and
D82 made the change of a file in place one step of undo. A generated video
has few key frames: the five generated videos of the development workspace
have one each, at 0 s. So a cut that copies the compressed frames can start
only at 0, and hiding the frames before the start behind an edit list keeps
them in the file, where a program that ignores edit lists shows them: what
the file holds would not be what BaseHalf shows. Encoding again is fast and
close to lossless: the window's hardware H.264 encoder took 360 frames per
second at 1080p on the development computer, and a 480p clip encoded again at
its own bitrate was 46.4 dB PSNR on average.

**What was set aside.**
- Saving the part as a new file beside the video, connected from it, as the
  first build did: the user asked for the video itself to change, with undo.
  A user who wants both duplicates the video first.
- Cutting without encoding again, at key frames or behind an edit list: it
  cannot start where a generated clip needs it to, or it keeps hidden frames.
  Re-encoding only the frames before the next key frame does not help either:
  with one key frame, that is the whole clip.
- The system's media frameworks (AVFoundation on macOS, the editing API of
  Windows): a native helper on each system, to be signed with the
  application, and macOS reads no WebM.
- A bundled FFmpeg, as a node-graph product for media work trims on its
  server: tens of MB on each system, its sources and notices to ship, and its
  common prebuilt packages are GPL.
- FFmpeg compiled to WebAssembly: its published build is GPL, 32 MB, and 10
  to 25 times slower than the system's encoders.
- An MPL-2.0 media library: it does the reading and writing, but MPL needs a
  review under the [dependency policy](dependency-policy.md), and the user
  chose BaseHalf's own code.
- Keeping only the start and the end, with the file unchanged, as editing
  programs keep a timeline: the file is the card (D63), so Files, agents, and
  providers would see the whole video where the card shows a part.
- A trimmed WebM written as MP4: a file that is replaced keeps its name, and
  with it its extension and its container.
- Treating a trimmed generated video as a file that BaseHalf did not
  generate: its frames are still what the model made, and New Version and a
  Sequence still need its record. The user chose to keep the record and note
  the trim in it.
- Trimming on the canvas, in a mode of the video's card: Card Detail already
  shows the video large and has the room.

**Consequences.**
- Revises the non-goal of [generation cards](specs/generation-cards.md#non-goals)
  that excluded trimming a video. Editing an image, upscaling, and masking
  stay out.
- Revises D63's rule that a generated file never changes: a trim changes it,
  and its `made.yaml` gets `trimStart` and `trimEnd`, the part of what was
  generated, in seconds. Its `id` stays, so that a Sequence still names it.
- The player of Card Detail gives the trim bar its time, a jump to a time,
  and the playing of a range. Every player shows a video's new content when
  its file changes. On cards it is otherwise unchanged.
- Escape on the trim bar closes Card Detail, as anywhere in it, and Cmd+Z
  there undoes a trim (D82).
- Joining clips into a movie stays out of [Video Sequence](specs/video-sequence.md).
- The code is a feature folder of its own, `videoTrim/`, in
  [code organization](harness/code-organization.md).

## D80 — A connection pulled off a card and let go on empty canvas is removed, and a marquee over connections alone selects them (NEW, 2026-10-25)

**Decision.** A connection whose end is dragged away from its card and let
go on empty canvas is removed, as Delete removes it, in one step of undo.
Let go on a side of a card it can connect to, it is reconnected there, as
before; let go anywhere else, or cancelled, it goes back. A marquee that
touches a card still selects only cards. A marquee that touches no card
selects every connection whose line it crosses, and Delete then removes all
of them in one step of undo. Cards and connections are still never selected
together. See
[canvas connection handles](specs/canvas-connection-handles.md#dragging-an-end-of-a-connection)
and [canvas selection and arrangement](specs/canvas-selection-and-arrangement.md#the-marquee).

**Why.** The user reported both on 2026-10-25. A line that was pulled off
its card came back when it was let go, so the only way to remove it was to
select it and press Delete; and no marquee could select a line, so several
lines had to be removed one by one. The user judged that a line that is let
go should disappear.

Six node editors whose behavior was read for this remove a link whose end is
let go on empty space; one of them first opens a menu and removes the link
when the menu closes without a choice. The canvas library's own example
does the same. Whiteboards keep the arrow with a free end, which a
connection cannot have: it is an entry in the downstream card's upstream
list. The two canvas products of the same kind that BaseHalf follows let no
end of a connection be dragged at all, and remove a selected line with a
button on it or with Delete.

The two products differ on the marquee. The first selects every connection
its marquee crosses when the marquee touches no card, and only cards
otherwise. The second selects a connection together with its two cards when
both are in the marquee, and nothing when only connections are. The user
chose the first: it is the only one that lets a marquee select lines, and it
keeps D52's one state for one selection.

**What was set aside.**
- Opening the Create from Connection menu when a pulled-off end is let go,
  as a new connection does. The user asked for the line to disappear, and a
  node editor that opens its menu for a new link keeps it closed for a link
  that is pulled off an input for the same reason.
- Keeping a connection when its end is let go, with a free end: an entry has
  two ends by what it is.
- Selecting a connection together with the cards at its ends.

**Consequences.**
- Revises D52: a marquee selects no connection only while it touches a card,
  and the selection holds one or more connections instead of one.
- Delete, and Disconnect in the context menu of a selected connection, act on
  every selected connection. The lines that end at one card are removed from
  its list in one write, and a connection that cannot change, such as an
  input of a generation card with its file, stays and says why while the
  others are removed.
- A connection that is pulled off and let go is a disconnect like any other:
  the same refusals, the same undo, the same kept anchor row.

## D81 — A PDF or a book shows its cover at one size, and a book opens to be read (NEW, 2026-10-25)

**Decision.** The card of a PDF and of a book in a common e-book format
(EPUB, Kindle's MOBI and AZW3, FictionBook, comic book archive) shows the
document's cover: the first page of a PDF, the cover picture of a book. It
is 300 × 400, the card of a picture whose shape is always 3:4, and the user
does not resize it. A button at the right end of its caption hides the
cover, and the card shows the grey face of a file card; the choice is the
card's, in its `appearance.yaml`. Covers are made in the window and kept in
the application's data folder, never in the workspace. A book opens in
Card Detail in a reader of BaseHalf's own, built on foliate-js: pages, its
contents, search, the size of its text, and the place where the user
stopped. Grow branch works on a book's passage as on a PDF's, and the text
selected in a PDF or a book is what agents can see. A PDF opens at the width
of Card Detail, but at most 125 %, until the user zooms. See
[PDFs and books](specs/documents-and-books.md).

**Why.** People learn from material that is mostly PDF, and from hard books
that are often e-book files. On 2026-10-25 the card of a PDF was an empty
card with a glyph, and a book showed "Binary file" with nothing to open it.
The user asked for the card to show the first page, at a fixed size that is
not resized, with the cover hidden per card into the old grey, and for the
common e-book formats to be read once imported. A card that shows its cover
makes a canvas of sources readable at a glance, and one size keeps such a
canvas in order. The selected passage is what a learner asks an agent
about; until now the agent saw only which PDF was open.

**What was set aside.**
- The page's own shape for each card: a page of slides would make a wide
  card among tall ones, and hiding the cover would change the size. One
  3:4 shape holds the common pages and covers with a narrow margin.
- Filling the card with the cover: a book's cover lost the top and bottom
  of its title, and a page of slides most of the page.
- Covers in `.bh/cache/`: a cover is a picture of a file, made again from
  it at any time, and the workspace is the user's. The application's data
  folder holds it on the one computer that made it.
- foliate-js in the window to read covers: the window's Trusted Types
  forbid the HTML parsing it does, and a worker has no HTML parser. A small
  reader of BaseHalf's own reads only a cover's picture, title, and authors.
- The npm package named foliate-js: it is published by somebody other than
  its author and is a year behind. The reader takes the author's repository
  at a fixed commit, as its author asks.
- DjVu and CBR: no library for them is under a license BaseHalf takes.
- The PDF at the full width of Card Detail: 186 % on a wide window, a page
  in two screens.

**Consequences.**
- Revises D66: the card of a PDF no longer resizes, and a book's card does
  not either.
- Revises D57's record: selected text can be in a PDF or a book, with
  `first_page` and `last_page` or `chapter`. The skill becomes version 10
  (D78 made it 9 the same day).
- `appearance.yaml` holds `cover` for a document as it holds `background`
  for a note.
- foliate-js (MIT), with the zip.js (BSD-3-Clause) and fflate (MIT) it
  carries, is a dependency of the book reader.

## D82 — A delete on the canvas asks nothing, and undo brings back exactly what a step took (NEW, 2026-10-25)

> **Extended by D89 (2026-10-27).** Undo asks nothing either: Command+Z
> and Shift+Command+Z in an editor of text leave a step of the canvas, Card
> Detail's header, Files, or a service of BaseHalf to that place, and undo
> and redo what editors did, an edit across files among it, in every file,
> where VS Code asked.

**Decision.** A delete on the canvas, by a card's Delete, the selection
toolbar, or the Delete key, happens at once and asks nothing. Every step of
the canvas that deletes, makes, or changes files keeps what it takes away
in the workspace's kept versions (`.bh/cache/kept/`), whole and with the
card's place and card information, and undo puts it back exactly; redo
takes it again. What a window kept goes to the Trash when the window
closes. BaseHalf adds no undo history of its own: its steps are steps of
VS Code's. See [exact undo](specs/exact-undo.md).

**Why.** On 2026-10-25, after New Folder began to make folders at once
([D77](#d77--new-folder-makes-a-folder-at-once-and-the-canvas-has-no-new-file-new-2026-10-25)),
the user asked whether a delete still needed its dialog, and whether
BaseHalf should work as the web canvas apps do, since this concerned undo
too. The two canvas products BaseHalf follows delete a node at once, and
one undo puts it back where it was; both were tried that day. In BaseHalf,
the undo of a delete was not to be trusted: a file of 6 MB did not come
back at all, a folder came back empty while its files stayed in the Trash,
and a note lost its description and its place. Without a dialog, these
would be losses. The user chose the canvas apps' way and said that this is
a feature of the whole product, not of the trimming of videos then in
progress, which should change the video and be undone instead of saving a
new file.

**What was set aside.**
- Sending a delete to the Trash at once and undoing from a copy, as file
  managers do: the Trash would still hold what undo brought back, and a copy
  of a large folder takes time on a disk that cannot clone files.
- Removing only the dialog: an undo that loses a file is no undo.
- An undo history of BaseHalf's own beside VS Code's: two histories would
  answer Cmd+Z in two ways.
- Files in the sidebar, for now: its delete and its undo stay VS Code's.

**Consequences.**
- Revises the undo of New Folder of D77: undo takes the folder with what it
  holds, and redo puts its card back at its place.
- The dialog's checkbox that removed a deleted item from the upstream lists
  that named it goes with the dialog. Those entries stay broken until undo
  brings the item back, or until the user removes them.
- New Note's creation becomes a step of the canvas undo.
- The trimming of a video (D79, drafted on its own branch) changes the
  video in place through the kept versions instead of saving a new clip.
- Until its window closes, what was deleted is in the kept versions, not
  yet in the Trash.
- One line of VS Code's undo service changes: an undo went on through a
  group as if it came from no source, so the second element of a group of
  the canvas asked "Would you like to undo ...?". A delete or a Duplicate
  of files with drafts is such a group. A group now goes on with the source
  of the element it undid (marked `// BaseHalf:`).

## D83 — The agent skill is a link to BaseHalf's own copy, which follows each release, and its offer stays until it is answered (NEW, 2026-10-26)

**Decision.** Installing the agent skill puts a symbolic link named
`basehalf` into Claude Code's skill folder and into the location that Codex
and other agents share. Both point at BaseHalf's own copy,
`~/.basehalf/agent-skill/basehalf/`. Each release carries its skill text in
the application bundle, and BaseHalf writes it into its own copy when a
window starts or gains focus, never over a higher version. After the
install, BaseHalf changes nothing in the agents' folders unless the user
asks. A linked skill is installed, so there is no outdated skill and no
offer to update it any more. The offer is a notification that stays until
the user answers it, and while it is unanswered the status bar entry of the
selection says that agents cannot see the selection; a click on it shows the
offer again. See [agent skill](specs/agent-skill.md#keeping-it-current) and
[the selection agents can see](specs/selection-for-agents.md#what-the-window-shows).

**Why.** On 2026-10-25 the user asked why the entry of the selection had gone
from the status bar. Main's skill text had reached version 10 that day,
while the machine held version 8, and D57 shows the entry only with the
current skill. The offer to update had hidden itself after ten seconds. The
text had changed seven times since D57 (versions 3 to 10 in eleven days),
and each change took the entry and the record away from every user, without
a word, until they found the offer. Rewriting the copies in the agents'
folders at each release was proposed and set aside: those folders are
another program's settings, and the rules that the platforms use to tell
wanted software from unwanted ask that a program change nothing after its
installation beyond what it offered then, unless the user asks (Google's
Unwanted Software Policy), and count a reinstall without consent as unwanted
(Microsoft's criteria for unwanted software). A link is made once, with the
user's consent, at a moment when the offer says that BaseHalf keeps the
skill up to date; what changes afterwards is BaseHalf's own file. Claude
Code and Codex both document that they follow a linked skill folder. The
user asked that the offer stay instead of hiding after ten seconds, and
asked for a better way if there was one: the status bar entry keeps the
unanswered offer in view after the notification is closed.

**What was set aside.**
- Rewriting an outdated copy in the agents' folders at each release: see
  above. It would also overwrite a copy that the user edited.
- The agents' own plugin systems, a Claude Code marketplace and Codex
  plugins: their versions do not follow the user's BaseHalf, Claude Code
  does not update a third-party marketplace by itself, the two systems
  differ, and the other agents that read the shared location would be left
  out.
- A command-line installer that writes a skill into every agent's folder: it needs Node and a terminal.
- Linking into the application bundle: macOS may run an application from a
  temporary path, and a development build's bundle is somewhere else.
- Showing the entry's offer after Don't Ask Again: the user answered.

**Consequences.**
- Revises D57: the record and the entry need the skill installed (linked),
  not its current bytes, and without the skill the entry says so while the
  offer is unanswered, instead of showing nothing.
- Refines D43: BaseHalf's one write outside a workspace is still the skill,
  now its own copy and the two links made at install.
- Don't Ask Again is one answer for every version. Remove Agent Skill counts
  as one, and Install Agent Skill forgets it.
- A copy that an earlier release left in an agent's folder becomes the link
  when the user chooses Update, once. The product has not launched, so there
  is no other migration.
- Moving BaseHalf to the Trash leaves the links and the copy; Remove Agent
  Skill takes them away.
- A window cannot make links, so a service of the shared process does
  (`platform/basehalfFiles/`).

## D84 — A video, an image, or a sound is edited in Card Detail, and its original is kept (NEW, 2026-10-26)

> **Revised by D85 (2026-10-26).** There is no edit mode: Card Detail shows
> the editor at once, and each change is saved as it is made, one step of the
> canvas undo that puts back choices. Edit, Cancel, Done and its menu, Save as
> New, the editor's own undo, the sound button of the frame viewer, Trim, and
> Reset are gone; Revert is Revert to Original, in the line under the editor.
> The original, the edit record, and the formats stay as D84 has them.

**Decision.** Card Detail of a video, an image, or a sound has Edit in its
header. Edit shows the editor of its kind: the frame viewer of a video, with
a yellow frame around the part kept and a sound button to mute it; the crop
view of an image, with ratios, a quarter turn, a flip, and a dial that
straightens it; and the waveform of a sound, with Trim and Delete. Done writes
the edit into the file, which keeps its name, its card, and its connections,
and keeps the file as it was before its first edit as its original,
`original.<extension>`, with an edit record, `edit.yaml`, in its card
information. Edit on an edited file starts from the whole original with the
choices of its edit, so a trim can be widened again; Revert puts the original
back at any time; Save as New writes the edit into a new file beside it and
leaves the file as it was. Each of them is one step of the canvas undo. See
[editing media](specs/media-editing.md).

**Why.** On 2026-10-26 the user asked for the editing of D79 to follow a
phone's photo editor as closely as possible, for videos, and also for
cropping images and editing sounds: after a trim, the original was lost,
while the phone keeps it. D79 kept the video before a trim only for undo,
until the window closed. A phone's photo editor keeps the original of every
edit, shows it again with the earlier choices when the edit is opened again,
and reverts to it at any time; its crop tool crops to ratios, turns, flips,
and straightens; its voice recorder trims a recording or deletes a part of it;
and both can save an edit as a new item instead. The user asked that this be
built without asking back, after research.

**What was set aside.**
- Keeping the original only until the window closes, as D79 did: an edit
  could not be widened again or reverted later.
- Keeping the file as it is and storing only the choices, drawing the edit at
  every view, as a photo library does: the file is the card (D63), so Files,
  agents, and providers would see the original where the card shows the edit.
- Keeping originals only on the computer that made them (`.bh/cache/`, or the
  application's data folder): a clone or a second computer could not revert,
  and a lost computer would lose them. An original is card information and
  travels with the file, through git too; a workspace that keeps videos with
  git's large file storage keeps their originals there as well.
- Asking at every Done whether to save in place or as new, as the phone does
  for a video: Done saves in place, which can always be reverted, and Save as
  New is in Done's menu.
- A confirmation before Revert and before Cancel: Revert is a step of undo,
  and Cancel only forgets choices.
- Perspective correction, adjusting light and color, and filters, which the
  phone's editor also has: the user asked for trimming, cropping, and editing
  sound.
- Encoding an MP3 again to cut it: the window has no MP3 encoder, and copying
  its frames keeps it as it was.
- Sending an edited file's original to the Trash with the file, as an
  ordinary file beside it: a file put back from the Trash would come back
  without its edit, while a phone's photo library brings a deleted photo back
  with its edit and its original.
- Sending the original of a file that is not there to the Trash at the next
  open: a file that is away for now, on a git branch or in a folder being
  synced, would come back without its edit. BaseHalf cannot see when the
  Trash is emptied, so it waits 30 days, as the phone's library keeps what was
  deleted and as the system offers to empty the Trash.
- Sending what Done and Revert keep for undo to the Trash when the window
  closes, as D82 does with the versions of files changed in place: the Trash
  then showed `edit.yaml`, `original.mp4`, and copies of the video under
  BaseHalf's names, whose Put Back place was a folder that is gone.

**Consequences.**
- Revises D79: the trim bar is the frame viewer of the edit mode, Done takes
  the place of Trim, the original is kept until it is reverted, and
  `made.yaml` gets no `trimStart` or `trimEnd`.
- Restores D63's rule that what made a generated file never changes:
  `made.yaml` is written once, and the edit record says how the file was
  edited.
- Revises the non-goals of [generation cards](specs/generation-cards.md#non-goals)
  that excluded editing images and sounds: trimming, cropping, turning,
  flipping, straightening, and cutting sound are BaseHalf's edits.
- The steps of [exact undo](specs/exact-undo.md#changing-files-in-place) that
  change files in place can also create and remove files, so that one step
  writes a file, its original, and its record, or takes them away.
- A copy of an edited file copies its original and its record. A window
  cannot clone a file, so a service of the shared process does
  (`platform/basehalfFiles/`); on a disk that can clone, the copy takes no
  room.
- The card information that a delete to the Trash leaves in `.bh/mirror/`
  includes the edit record and the original, so that a file put back from the
  Trash can be reverted. An original whose file was gone at every open for 30
  days goes to the Trash beside where the file was, as `shot original.mp4`;
  the notes of since when are machine-local, in
  `.bh/cache/gone-originals.json`.
- What Done and Revert keep for undo is deleted for good when the window
  closes, also with the Trash on: the original holds what the Trash would.
- In edit mode, Escape cancels the edit before it closes Card Detail, and
  Command+Z undoes the editor's last change.
- The code of D79's `videoTrim/` becomes the feature folder `mediaEdit/`
  ([code organization](harness/code-organization.md)).
- Each sound keeps its format: BaseHalf cuts a WAV in its bytes, cuts an MP3
  at its frame edges and lays its reserve of bits out again, and decodes and
  encodes a FLAC itself, without loss, since the window's decoder gives
  samples that cannot be read back as the file's whole numbers. An M4A and an
  Ogg are encoded again by the window, in AAC and in Opus. A sound longer than
  30 minutes is not edited: it is decoded whole in memory.

## D85 — Editing media is direct: a change is saved as it is made, with no edit mode (NEW, 2026-10-26)

> **Revised by D96 (2026-10-27).** Card Detail opens to view the file, and
> **Edit** in its header shows the editor, which **Done** leaves. A change
> is still saved as it is made, and Done saves nothing. The rest of D85
> stands.

**Decision.** Card Detail of a video, an image, or a sound shows its editor at
once: the player of a video with the frame viewer under it, the waveform of a
sound with Play under it, and the crop view of an image with its tools. Every
change is saved as it is made, a handle let go, a part cut out, a turn, a
flip, a ratio, an angle, a crop, and is one step of the canvas undo. There is
no Edit, Cancel, Done, Save as New, or Revert in the header: an edited file
has **Revert to Original** in the line under its editor. The editor shows a
change at once from the original; the file follows in the background, once
the choices have rested for a second, and when Card Detail or the window
closes. See [editing media](specs/media-editing.md#changes-save-themselves).
The same holds across BaseHalf: a change is the result
([architecture invariants](harness/architecture-invariants.md#product-shell)).

**Why.** On 2026-10-26, looking at the enlarged cards after D84, the user
found the editing redundant: on a phone, a trim dragged into place is saved,
while BaseHalf asked for Edit, then the change, then Done or a menu, with
Cancel, Close, and the menu beside it, two buttons more above a sound's
waveform, and a second undo inside the editor. The user saw it as a problem of
the whole product, not of the sound card. BaseHalf already saves notes and
places as they change, and D84 kept two ways back that make a confirmation
needless: undo of every step, and the original of every edited file. Counted
on D84: a trim took 3 actions, cutting a part out of a sound 5, cropping an
image to 16:9 4, and the editor of a sound had 8 buttons; now they take 1, 2,
and 2, and the editor of a sound has Play, Close, and a Delete that shows
only on a selected part.

**What was set aside.**
- Saving after every change by encoding the file at once: a video would be
  encoded again for every handle let go. The editors already draw the edit
  from the original, so the file waits until the choices rest, and a change
  made meanwhile is written after the write that runs.
- Undo by the kept versions of exact undo, as D84's Done did: undo puts back
  choices, and what BaseHalf wrote for the last choices of a file is kept
  until the window closes, so undo and redo put back the very bytes, at once.
- Keeping Save as New: Duplicate on the canvas, then a change, does the same
  in one way for every kind of card.
- Keeping the frame viewer's sound button, which saved a video without its
  sound: beside the player's own sound button, which only mutes the playing,
  one icon would have meant two things.
- A wheel over the picture that crops it, as D84's crop view did: without an
  edit mode, scrolling over an image would change the file. The wheel zooms
  the view.

**Consequences.**
- Revises D84: its edit mode, Done and its menu, Save as New, Cancel, the
  editor's own undo, Escape that cancels, the line of the last step, Trim, the
  sound button of the frame viewer, and Reset are gone; Revert is Revert to
  Original under the editor.
- [Layout controls](specs/layout-controls.md#card-detail): the header of
  Card Detail holds no control of editing.
- [Exact undo](specs/exact-undo.md): the changes of an edit are steps of the
  canvas undo that put back choices; they keep nothing in the kept versions,
  and Command+Z reaches them also in an editor.
- In Card Detail, the player of a video has no bar of its own for the time:
  the frame viewer is its timeline.
- A file BaseHalf cannot edit shows no editor, and nothing more: its image
  page or its player as before.

## D86 — A program in an Agent Area terminal reaches the edges of its pane (NEW, 2026-10-27)

**Decision.** An Agent Area terminal keeps no width for its scrollbar, which
lies over the rows, and keeps 2 px at each side of its grid, as the reference
terminal does by default. The space left around the grid, less than a cell's
width at the right and less than a row's height at the bottom, takes the
background of the nearest cell, as the reference terminal does when its
padding color is set to extend: always beside the rows, and above and under
them when the first or the last row has no cell in the default background and
no powerline glyph. See
[Agent Area terminal](specs/agent-area-terminal.md#the-grid-and-its-edges).

**Why.** On 2026-10-27 the user saw a long strip down the right side of the
Agent Area while a full-screen agent that paints its own background ran
there. The terminal counted its columns as VS Code's does, after keeping 14
px for a scrollbar, and it painted that space, the rest of a cell beside it,
and the rest of a row under the grid in the theme's terminal background: 17
px at the right and 13 px at the bottom of a pane 289 px wide, gray beside
the program's near black. VS Code 1.143.1 shows the same. In BaseHalf those
14 px served nothing: the scrollbar lies over the rows, and it never shows
for a program in the alternate buffer. Without them, what is left is less
than a cell at the right and a row at the bottom, and it still shows as a
line of another color at most sizes of the pane. The color of the nearest
cell closes it at every size and for every program, and a shell looks as
before, because its cells have the default background.

**What was set aside.**
- Only giving up the 14 px: the rest of a cell and of a row stay, up to a
  cell and 2 px at the right and a row and 2 px at the bottom.
- One color for all the edges, the program's most common one: a program with
  a side panel or a status line at an edge would get a wrong color along it.
- Wider cells, so that whole cells fill the pane: glyphs would no longer sit
  at the font's advance, and the rest of a row would stay.
- Centering the grid, as the reference terminal can: it splits the strip in
  two.
- The reference terminal's default, its background color, or a setting to
  choose it: that is the strip, only narrower, and wherever a program paints
  no background of its own the edges look as before.

**Consequences.**
- Refines D39 and D21: in the same pane, an Agent Area terminal has one or
  two columns more than VS Code's terminal at the default font size.
- While it shows over a shell's rows, the scrollbar lies over the last
  column.
- The edges read the grid's element and the terminal's current colors
  through xterm.js internals, which a test pins; without them the edges keep
  the theme's background.
- One line of a VS Code file changes: a terminal keeps no width for its
  scrollbar, in every terminal, since every terminal in BaseHalf is an Agent
  Area terminal.

## D87 — A pinch zooms a note in Card Detail, and its left margin shows its outline (NEW, 2026-10-27)

**Decision.** In Card Detail, a pinch of the trackpad, or the wheel with the
zoom key or Ctrl held, zooms a note in its Rich and its Preview projection.
The note's page is laid out larger or smaller, from 50% to 300%, around the
line under the pointer, and the level is one for every note, kept for the
user's profile on this computer. The empty margin to the left of the note's
text shows nothing at rest. With the pointer in it, a column of short ticks
fades in, one for each heading, the heading being read brighter; over the
ticks, a panel lists the headings by name, and a click on a name scrolls the
note to it. See [zoom and outline of a note](specs/note-zoom-and-outline.md).

**Why.** On 2026-10-27 the user asked that the enlarged note take a pinch of
two fingers, and that the empty area to its left hold the navigation of a
picture they gave: a column of short ticks, one of them brighter,
"平常是隐藏的，鼠标放上去有导航". Measured that day, a pinch over a note in Card
Detail reached nothing: the browser hands a pinch to the window, not to the
page that draws the note, and nothing in the window took it. The same was
true over a PDF, whose viewer zooms only on a wheel turned with Ctrl inside
it. Card Detail draws a note in a column of at most 760 pixels, which leaves
209 pixels empty to its left in a Card Detail of 1130 pixels, and 61 with
the Agent Area open, while a long note showed none of its 42 headings
unless the user scrolled to each. The look and the timing follow the outline
of a document product measured the same day: ticks of 16 by 2 pixels, 14
pixels apart, the current one at 83% of the foreground and the others at
30%, a panel of names 232 pixels wide in 13-pixel type that opens at once
under the pointer, fading in and moving 10 pixels into place in 200 ms, and
goes the same way.

**What was set aside.**
- Ticks shown at rest, with the names under the pointer, as the document
  product shows them: the user asked that the navigation be hidden at rest.
  It is one rule of the stylesheet, should the user want the ticks always.
- A level for each note, as each PDF keeps its own: a PDF is pages of a set
  size, while a note is text that the projection lays out, as a book's is,
  and the text size of the book reader is one for every book.
- The PDF's range of 25% to 500%: at 25% the text of a note is 4 pixels
  high, and at 500% a line of a narrow Card Detail holds a few words.
- Drawing the page larger as a picture for the whole gesture, as a viewer of
  pages does, and laying it out when the fingers rest: the text is blurred
  meanwhile, and its lines break anew at the end. Laying the page out in
  every frame is exact, and fast enough for notes of ordinary length; the
  picture stands in only for the frames whose layout would take too long.
- Command with `=`, `-`, and `0` for the note: they zoom the whole window
  everywhere in BaseHalf, also over a PDF, and the same keys would mean two
  things.
- A click on a name that puts the caret into its heading: the outline is
  for reading, and moving the caret would change, unasked, where typing goes
  and what agents see as the selection.
- An outline in the Source projection: its editor is the base's code editor.
- An outline only where the margin is wide enough already: the user works
  with the sidebar and the Agent Area open on a display of 1440 points, where
  Card Detail is about 834 pixels wide and its 61 empty pixels are taken by
  the editor's handles of a block. Moving those handles, or laying the ticks
  over them, was set aside too: the handles are how a block is added and
  moved. The text column gives up the room instead.

**Consequences.**
- The Rich projection takes a pinch in the window and hands it to its page;
  Preview, drawn in the window, takes it itself. Both keep the level in
  `basehalf.noteZoom` of the profile's storage, never in the workspace.
- A pinch over a PDF zooms it with its zoom of D81, and a pinch over a book
  changes its text size by the steps of Larger Text and Smaller Text: the
  window takes the pinch over the frame of the page and hands it to the page
  that it names. A pinch over an image, a sound, or a video still does
  nothing until D85 has changed their pages.
- In Card Detail the Rich projection keeps 85 pixels at each side of its text
  for the outline at the edge and the editor's handles of a block beside the
  text: in a Card Detail of 834 pixels the text column is 664 pixels wide
  instead of 712, and the handles, cut off at the edge in a narrower one
  before, show whole.

## D88 — Cards let go on a folder go into it (NEW, 2026-10-27)

> **Revised by D92 (2026-10-27).** A folder that would take a drop shows it
> by growing a little and glowing yellow, not in the canvas's intent color,
> and a folder of the path shows the same yellow. While a folder takes the
> cards, nothing snaps them. The rest of D88 stands.

**Decision.** Where the pointer is when the button is let go decides. A card,
or a set, let go with the pointer over a folder's card goes into that
folder; let go over a folder of the path in the title bar, into that folder.
While a folder would take them, its card shows the canvas's intent color and
the dragged cards are half transparent. The whole drop is one step of undo,
drafts included. A name the folder holds is kept beside it: `plan.md` moves
in as `plan 2.md`. An item dragged from Files onto a folder's card moves into
it, and a file from outside the window is copied into it. Let go outside the
canvas anywhere else, the cards go back, and the canvas no longer moves while
the pointer is outside it. A gesture on the canvas is refused only when a
change touched what it acts on, so the drag right after a drop, or after a
rename anywhere else, works. See
[dropping into a folder](specs/canvas-drop-into-folder.md) and
[canvas card interaction continuity](specs/canvas-card-interaction-continuity.md#a-change-elsewhere-in-the-workspace).

**Why.** On 2026-10-27 the user asked that the logic and the look of dragging
into a folder be designed. Measured that day: a card dragged onto a folder's
card landed on top of it and nothing moved; moving a card into a folder took
Cut, opening the folder, and Paste; Files and the path in the title bar took
no card, and a drag towards them moved the view by 790 screen pixels and left
the card out of sight. A desktop file manager and a canvas editor both let
the point under the pointer decide where dragged things go, and the file
manager draws the dragged icons translucent so that the folder shows under
them. A drop is a move, and right after any move through the workbench the
next drag on the canvas went back to its place (3 of 3) and the first click
on empty canvas was lost (3 of 3): every gesture carried the generation of
the whole workspace's structure, and any newer one refused it.

**What was set aside.**
- Letting the dragged card's center decide, as an open-source canvas for
  media work does for its groups: a folder takes its items out of sight, so
  only letting go over it should mean it. A card placed beside a folder that
  covers part of it would vanish.
- Asking about a taken name, as a desktop file manager does: a delete on the
  canvas asks nothing ([D82](#d82--a-delete-on-the-canvas-asks-nothing-and-undo-brings-back-exactly-what-a-step-took-new-2026-10-25)),
  and undo gives the move back. Naming it as a copy, `plan copy.md`: the
  item was moved, not copied. A paste of cut items, the other move into a
  folder, now names it the same way as a drop.
- Opening the folder while the pointer rests on it during a drag, to drop at
  a point of its canvas: the drag would outlive the canvas it began on. A
  later step, if it is asked for.
- Dropping cards onto a folder in Files: Files is VS Code's tree, which takes
  its own drags. The folder's card and the path cover the way in and out.
- Keeping the check of every gesture on the whole workspace and drawing the
  canvas sooner after a move: the moment between the move and the drawing
  stays, and a drag in it still fails.

**Consequences.**
- Revises [canvas card placement](specs/canvas-card-placement.md#what-the-user-changes):
  a card let go on a folder's card is no longer saved on top of it, and a
  card let go outside the canvas goes back.
- Revises [canvas selection and arrangement](specs/canvas-selection-and-arrangement.md#moving-a-set):
  the canvas moves near its edge only while the pointer is inside it, for one
  card and for a set.
- The folder buttons of the path in the title bar take dropped cards
  ([the location in the title bar](specs/title-bar-location.md#a-drop));
  [D73](#d73--a-click-on-the-title-bars-location-opens-the-search-new-2026-10-24)
  is otherwise unchanged.
- [Exact undo](specs/exact-undo.md#what-the-canvas-made): an item that moves
  keeps both names; a copy is named as before.
- The rule of the canvas scene that a rename or a delete anywhere in the
  workspace ends every gesture that began before the canvas was drawn again
  is gone.

## D89 — A Note resizes while it is edited on its card, and an editor of text leaves the steps of other places to them (NEW, 2026-10-27)

**Decision.** A Note that is being edited on its card keeps its resize
targets, and they work as they do at rest. A press on one leaves the keyboard
in the editor: the editing, the caret, the selection, an input method's
composition, the scroll position, and the editor's own undo go on through the
resize. The size is saved after pointer-up as one step of the canvas undo,
which Command+Z reaches once the keyboard is out of the editor. See
[canvas card resize, "While a Note is edited"](specs/canvas-card-resize.md#while-a-note-is-edited).

Command+Z and Shift+Command+Z in an editor of text, the editor of a note on
its card and the editors of Card Detail, undo and redo what was done in
editors. A step made outside them, by the canvas, Files, Card Detail's
header, or a service of BaseHalf, is left to that place: when it is the
file's next step, the keys do nothing there and nothing asks. A step that an
editor's own command made across files, such as a rename of a symbol or of a
heading across notes, is undone and redone from the editor in every file it
changed, and nothing asks. VS Code tells the two apart by the source of the
step: a place with an undo of its own pushes its steps with one, an editor's
commands push theirs without. See
[exact undo, "Undo in an editor of text"](specs/exact-undo.md#undo-in-an-editor-of-text).

**Why.** On 2026-10-27 the user found that a Note, once double-clicked to be
edited on its card, could not be resized any more, and asked that it could
("Note 节点双击进入卡片上的编辑时，没有办法改变卡片大小了。我们是不是也应该允许改变卡片大小？").
A note grows while it is written, and a card that is too small for its text
is found while typing. Making it larger took three steps and lost the place
of the typing: a click on the canvas to end the editing, the resize, and a
double click to edit again, which put the caret at that double click. Now it
is one drag, and the typing goes on where it was. The targets had been taken
away while editing so that structural chrome never lay over the text, but at
rest they paint nothing, and a corner's indicator shows only under the
pointer or while that corner resizes, so keeping them puts nothing over the
text.

Testing the resize found the question of the system "Would you like to undo
'Move or resize canvas cards'?" in the note's editor, and the editor waited
for an answer until the window could not close. The same question came, on
main as well, after a rename of a note on the canvas, typing in it, and
Command+Z past the typing ("Would you like to undo 'Rename Groceries.md to
Shopping.md'?"). VS Code asks when the undo of a file in an editor reaches a
step that another place made, and D82 says that nothing asks. The steps of
D82's kept versions and the connections of notes already stay out of the
history of a file the user edits; the renames and moves that VS Code's file
edits make, and the connections of files that are no notes, do not. So the
rule is kept in VS Code's undo, which knows how each step was made: an undo
from an editor leaves a step that a place with an undo of its own made. The
same undo asked whether to undo an edit across files that an editor's own
command made "across all files"; it now takes it back in every file.

**What was set aside.**
- Ending the editing when a resize begins and beginning it again after: the
  caret, the selection, a composition, and the editor's undo would not
  survive the close.
- One undo for the text and the size together: the keyboard in an editor of
  text undoes its text everywhere in BaseHalf
  ([exact undo](specs/exact-undo.md#undo-while-card-detail-is-open)), and the
  canvas undo holds the sizes and places of every card.
- Showing the corners' indicators all the time while editing, to say that
  the card resizes: they would lie over the corners of the text, and a corner
  shows its indicator under the pointer as at rest.
- Undoing a step of another place from the editor without asking: Command+Z
  in a new note's editor would then delete the note it is typed in, and in a
  renamed note's editor rename the file under the editor.
- Keeping every step out of the histories of the files it names, as the kept
  versions do: the renames and moves that VS Code's file edits make name
  their files, and the editor would still ask about the steps of Files.
- Leaving to other places every step over several files, as a first build
  on 2026-10-27 did: a rename of a symbol, or of a heading across notes,
  made in the editor, could then be undone neither there nor anywhere else,
  while main undid it after a question.
- Telling the steps apart by their codes, or by a mark that BaseHalf puts on
  its own: the moves and renames of VS Code's file edits carry the codes of
  Files, and the source of a step is what VS Code itself asks by.

**Consequences.**
- Revises [canvas card resize, "Which cards resize"](specs/canvas-card-resize.md#which-cards-resize),
  where a Note being edited had no resize controls since 2026-10-09.
- The step of a move or a resize is no part of the undo of the cards' files,
  only of the layout. It had been part of both since the canvas first had
  undo; in the window, Command+Z in the editor right after typing and a resize
  reached it, asked "Would you like to undo 'Move or resize canvas cards'?",
  and the editor waited for the answer. Text typed after a resize no longer
  keeps the canvas from undoing it either.
- Extends D82 to undo in the editors of text, with two changes to VS Code's
  undo service, marked BaseHalf: an undo or a redo by resource, which is an
  editor's, leaves an element of a source, and the undo of an element that
  can be split takes it back in every file without asking.
- The connection handles of a Note being edited stay hidden
  ([canvas connection handles](specs/canvas-connection-handles.md#scope)).

## D90 — An image card's panel shows what image models take (NEW, 2026-10-27)

> **Revised by D91 (2026-10-27).** Each kind has a panel of its own. An image
> card's has no input row until it has an input, its two buttons are at the
> start of its footer, and its count goes from 1 to as many as its model
> makes. The rest of D90 stands.

**Decision.** The panel under an image card keeps what every generation card
has, the input row with its two buttons, the prompt and its mentions, the
model, the settings, and Generate, and drops what came with the video's
panel: an image card names no mode, since every image model makes its image
from references or from the prompt alone; its count of images is a row of
buttons from 1 to 4 instead of a slider of up to 15; and its reference menu
and Import File… offer only the kinds of input an image model uses, images
and notes. The model button's tooltip goes when the model changes under the
pointer. Video and audio cards keep their panels: the models of each of those
kinds differ in their modes, and a song's count was buttons already. See
[generation cards](specs/generation-cards.md#settings).

**Why.** On 2026-10-27 the user found the image generation component odd: it
does not need to be as complex as the video one. Seen in a development window
with the catalog's 37 image models: each has exactly one mode, References, so
the settings of every image card began with "References", under "Add images
as references" in the row above and for a picture made from the prompt alone
too; a generated image's panel said "References · Adaptive · 2K · Images 4"
under "Image 1 of 4". The count of 17 of them was a slider of 230 px for 1 to
15 images, about 16 px a step, drawn as a video's Duration is, so choosing 4
meant finding the fourth of fifteen steps; it is one click now. The reference
menu offered Videos and Audio, dimmed, on every image card, since no image
model takes either, and Import File… offered videos and sounds that it then
refused. The two canvas products for media work that BaseHalf follows name
no mode on an image node, offer 1, 2, or 4 images, and sum an image's
settings up as its ratio and resolution, while their video nodes begin with
the mode. A tooltip "Choose a model to generate." stayed on the model button
after a model was chosen from its menu.

**What was set aside.**
- Naming the mode only for a model that has more than one: it would also take
  the mode from the 28 video models and the 15 audio models that have one,
  where it says something, that a video model starts from frames and not from
  references, and what an audio model makes, speech or sound effects. The
  kind decides instead: a kind whose models all have the same one mode names
  none.
- Hiding an image card's input row until it has an input: its two buttons are
  where D71 put adding an input, on every card.
- Counts of 1, 2, and 4 alone, as the two products offer: 3 is as good a count,
  and BaseHalf draws a number of so few steps as all of its buttons.
- The count beside Generate, as one of the products has it: a card's settings
  are one popover for every kind.
- Larger counts in the panel: more than four images from one click is rare,
  each is paid for, and each is a card of the row. An agent may still ask for
  as many as a model makes, and the panel then shows that count as a button
  of its own.

**Consequences.**
- Revises D64, an image made with "the same panel": the panel without what
  image models do not take. D71's two buttons and D74's mentions stay.
- [Generation cards](specs/generation-cards.md): the summary, the panel of a
  card with its file, and the reason an input is not used name the mode only
  for a kind whose models differ in it; a count is buttons from 1 to 4, and
  the model menu says "Up to 4 images"; the reference menu and Import File…
  offer the kinds the card's kind takes; the model button's tooltip.
- The same rule takes Videos from an audio card's reference menu and its
  Import File…, since no audio model takes a video; nothing else of an audio
  card changes.
- The catalog, the parameters, what is sent, and what `generation.yaml` and
  `made.yaml` store are unchanged: an image card's mode is still `reference`,
  and `basehalf --list-capabilities` still gives agents each model's count.

## D91 — Each kind of generation card has a panel of its own (NEW, 2026-10-27)

**Decision.** The panel under an image, a video, and an audio draft is its
kind's own. The three are made of the same parts, the input row, the two
buttons that add an input, the prompt with its mentions, the reason line,
the model, the voice, the settings, and Generate, which keep one set of rules
wherever a kind places them, and they show what one presentation of the
card's generation information, inputs, and catalog says. What a kind's panel
shows of the parts, and where, is that kind's, in a module of its own, so
that a change to one kind's panel changes no other. The one mechanism under
the panels stays as it is: a generated file is its card (D63), its
connections are its inputs (D68), and `check` answers the limits (D70). An
image card's panel:

- has no input row until the card has an input, and then a row of its tiles
  alone: with nothing connected it is its prompt and its footer, 132 px tall
  where it was 188 px;
- has its two buttons, Pick on Canvas and Import File…, at the start of its
  footer, before the model, where they stay when the row comes;
- offers a count from 1 to as many as the model makes, a button for each
  number, in one row up to six and in rows of five beyond six.

The panels of video and audio cards keep what they showed. See
[generation cards](specs/generation-cards.md#the-panel-of-each-kind).

**Why.** On 2026-10-27 the user was asked whether the image panel's empty
"Add images as references" row should show only once there is a reference,
for every kind. They answered that the panels should be decoupled, since one
of them cannot govern every card, and that this is why the image card had a
design it did not need. In the code, one module drew all three kinds, and
what a kind did not use was switched off by conditions on the kind: hiding
the empty row of an image card alone meant one more condition in the module
that every kind shares, and hiding it for all would also have taken a new
video card's empty Start and End frames. The generality the user asks for is
in the mechanism, the one way images, videos, and sounds are made, kept,
and sent, not in one surface for every kind. Of the count, which D90 ended
at 4 while models make up to 15, the user said it can follow the model and
be solved with the panels: Seedream 5.0 Lite makes up to 15 images in one
generation, GPT Image and Grok Imagine Image 10, Kling Image and MiniMax
Image-01 9, and Qwen-Image 6, and only an agent could ask for more than 4.

**What was set aside.**
- One panel with switches per kind, as before: it is what made the image
  card carry what the video card's row needs.
- A panel per kind that copies the parts it shares: the prompt, the menus,
  Pick on Canvas, `check`, and Generate would come to work differently for
  each kind, while what is sent must follow one set of rules.
- Hiding the empty row for every kind: a new video card's empty frames say
  how a video can start, and an audio card's row says what its models take.
- The image card's two buttons at the panel's top right with no row under
  them, beside the prompt's first line: the prompt would lose their width on
  that line, and the buttons would move when the first input brings the row.
- The two buttons at the right end of the footer, beside Generate: a box
  where text is written keeps its attachments at the start of its footer,
  and Generate stays alone at the end.
- A slider or a field for a larger count: a slider of 15 steps had 16 px a
  step (D90), and a field needs typing, while a button for each number is one
  click and shows how far the model goes.
- Counts of 1, 2, and 4 alone, as the two canvas products for media work
  offer them: the user asked that the count follow the model.

**Consequences.**
- Revises D90: an image card's count goes as far as its model makes, and its
  model menu says "Up to 15 images" for a model that makes 15. That an image
  card names no mode, and its reference menu of images and notes, stand.
- Revises D71 for image cards: their two buttons are at the start of the
  footer.
- [Generation cards](specs/generation-cards.md): the parts of the panel and
  the panel of each kind, the count, the place of Pick on Canvas, criteria 69
  and 92, and criteria 95 to 97.
- Nothing that is stored or sent changes, and agents ask for a count as
  before.

## D92 — A folder that would take a drop grows and glows yellow (NEW, 2026-10-27)

**Decision.** While what is dragged, cards of the canvas, items from Files,
or files from outside the window, would go into a folder's card, that card
grows to 108 percent of its size around its middle in 150 ms, its border
turns yellow, a ring and a soft glow of the yellow lie around it, and a light
tint of the yellow lies over its face. No words are drawn. It goes back when
the pointer leaves it or the drag ends. The yellow is the gold of a folder's
glyph made bright. A folder of the path in the title bar that takes the
cards shows the same yellow around its name, without growing. The folder
takes the drop over all of its card as it is drawn, so letting go on its
grown edge still drops into it. With reduced motion it does not grow; with
forced colors it gets an outline in the system's highlight color. While a
folder takes the cards, nothing snaps them and no snap guides are drawn: they
keep the place snapping gave them at the last move and from there follow the
pointer exactly, and when the folder lets go of them snapping goes on from
where they are, so they never jump. See
[dropping into a folder](specs/canvas-drop-into-folder.md#while-dragging).

**Why.** On 2026-10-27 the user described the look they want: dragged onto a
folder's card, the folder's card can grow, and a yellow shadow area appears
that shows it can take the file and make it a file in the folder, with no
text. Measured that day on D88's look, at a zoom of 93 percent: a held note
covered most of the folder's card (a note's card is 300 by 220 canvas
pixels, a folder's 248 by 188), so the folder showed that it would take the
note only at the edges the note left free, with a ring and a tint of the
canvas's intent blue, the blue of a connection that would be made, and it
kept its size. Tried in the window at 106 and 110 percent with the same glow:
both showed in the edges a held note leaves free; at 110 percent the caption
moved far enough to draw the eye away from the note being aimed. With the
look built, a note held over the middle of a folder's card still snapped to
it: the guides of the folder's middle crossed the glow, and the note stayed
put while the pointer moved up to 5 screen pixels, though the cards were
going into the folder and their place no longer mattered.

**What was set aside.**
- Words such as "Move into drafts": the user asked for none, and the card
  under the pointer is the place the words would name.
- A growth as large as a magnified icon's, a third or more: in the plain
  grid a note stands 40 canvas pixels beside a folder's card, and it would be
  covered.
- Keeping the intent blue: on the canvas it says that a connection would be
  made, and the user asked for yellow, the color of a folder.
- Growing a folder of the path: the path is a row of names, and a grown name
  would cover the names beside it.
- Taking the drop only over the folder's place, as before: on the grown edge
  the folder would then shrink under the pointer, and a card let go there
  would stay beside the folder that showed it would take it.
- Drawing the folder over the dragged cards: the dragged cards are what the
  user holds, and they stay half transparent over it as D88 has them.
- Putting the cards back under the pointer when a folder takes them, or
  when it lets go of them: what snapping had moved them by, up to 5 screen
  pixels, would then show as a jump in that frame.

**Consequences.**
- Revises D88's look: the canvas's intent color on a taking folder's card,
  and the focus color on a folder of the path, give way to the yellow.
- [Dropping into a folder](specs/canvas-drop-into-folder.md): the goals,
  which folder takes them (the grown card), what shows while dragging, and
  criteria 1, 4, 11, and 12; [the location in the title bar](specs/title-bar-location.md#a-drop),
  requirement 11; [canvas selection and arrangement](specs/canvas-selection-and-arrangement.md#moving-a-set),
  Snap to Cards for a moved set.
- The canvas's stylesheet has the yellow as a color of its own,
  `--bh-card-folder-drop`, beside the folder's other colors; the title bar's
  rule names the same yellow.

## D93 — A pinch zooms the picture of an image or a video in Card Detail, and spreads out the time of a video or a sound (NEW, 2026-10-27)

> **Revised by D96 (2026-10-27).** The wheel and a two-finger swipe move a
> zoomed picture, as on the canvas, and only a pinch or the zoom key zooms
> it. The picture of a video grows past its player over Card Detail, as a
> browser zooms its page, up to 5 times as it fits or twice its pixels when
> that is more. The time of the frame viewer and of the waveform spreads
> out while they are edited. The rest of D93 stands.

**Decision.** In Card Detail a pinch of the trackpad zooms what is under the
fingers. Over the picture of a video, it and the wheel zoom the picture as
the crop view zooms an image (D85): around the pointer, from as it fits to
twice its pixels; while it is zoomed in, a drag moves it and a click still
plays and pauses it. The page of an image that BaseHalf cannot edit, a GIF,
an AVIF, a BMP, or an SVG, zooms with a pinch, and with the wheel and the
zoom key, as its − and + do, around the pointer, as a PDF's page does (D87).
Over the frame viewer of a video and the waveform of a sound, a pinch spreads
their time out around the pointer, down to half a second; the wheel then
moves it along, a handle dragged past an edge carries it with it, and it
follows the playhead while the video or the sound plays. Elsewhere a pinch
does nothing, and none zooms the window or the canvas. See
[editing media](specs/media-editing.md#zooming-the-picture-and-the-time).

**Why.** On 2026-10-27 the user had the pinch added to Card Detail of a note
(D87), and agreed to it over images, videos, and sounds once D85 had rebuilt
their Card Detail. Measured that day in a development window with a pinch
made through the browser's protocol (25 wheel events with Ctrl held, a scale
of 1.6): over the crop view of a PNG of 2048 × 2048 the picture grew from 663
to 1,061 pixels, as D85 built it; over a generated video of 854 × 480, over
its frame viewer, and over the waveform of a WAV nothing changed, since none
of them took the events; over a GIF the window handed the pinch on to its
page, which did nothing with it. The window and the canvas kept their zoom in
every case. A phone's photos zoom a video that plays with a pinch as they
zoom a photo. A phone's voice recorder, which the editor of a sound follows
(D84), zooms its waveform with a pinch "for more precise editing", and editors
of video zoom their timeline with one.

**What was set aside.**
- A pinch that zooms only the picture, and leaves the time alone: the voice
  recorder and the editors zoom their time, and a stretch of a long sound to
  cut out is hard to select at the whole length, where a bar of the waveform
  holds a second of a song of four minutes. Holding a handle still keeps its
  spread for a handle's precision.
- The wheel scrolling a zoomed video, and zooming only with a pinch or the
  zoom key, as a page does: the picture fits Card Detail, so there is nothing
  to scroll, and the crop view zooms with the wheel.
- A double click that shows the video as it fits, as on an image: a double
  click on the player fills the screen (generation cards, "The player").
- Zooming beyond twice the pixels of the picture: what is drawn larger shows
  no more of it; the limit is the crop view's.
- The page of an image that BaseHalf cannot edit made to work as the crop view
  does, the wheel zooming it and a drag moving it: a change of that page
  beyond the pinch, for formats that few generated images have.
- A view of the whole length beside a spread-out stretch, as some editors
  have: a thin bar shows where the stretch lies while it changes, as
  BaseHalf's scrollbars show, and pinching in shows the whole.

**Consequences.**
- [Editing media](specs/media-editing.md): "Zooming the picture and the
  time", the hold's release, and criteria 16 to 19;
  [generation cards](specs/generation-cards.md#the-player) points to it from
  Card Detail's player, and [zoom and outline of a note](specs/note-zoom-and-outline.md)
  from L5.
- The crop view and the player of a video share one computation of a zoom's
  factor, its largest zoom, the point under the pointer, and the edges; the
  frame viewer and the waveform share the spreading out of their time.
- Nothing is stored: a zoom is the view's, and goes when Card Detail closes.

## D94 — The region of a provider is the user's choice, and the other region is easy to find (NEW, 2026-10-27)

**Decision.** A provider's region stays the user's choice, and the region
the catalog lists first stays chosen until the user picks another: China, for
ByteDance, Kling, Alibaba, MiniMax, and Vidu. BaseHalf makes the other region
easy to find where it matters. On the Providers page, the region's hint says
that each region has its own console, keys, and models, and asks for the
region the user's key comes from; the link to the console of the region
chosen follows the choice, before the credential fields, so that both are in
view without scrolling and choosing International changes the link at once.
When such a provider refuses the credentials at its region's own address, for
a generation or for the list of a speech model's voices, the message names
the region the request went to and the other one, and says to choose that
region in Providers. Nothing is asked, and nothing changes by itself. See
[providers, Choosing a region](specs/providers.md#choosing-a-region).

**Why.** On 2026-10-27 the user was told that these five providers still
start in their China region although BaseHalf is not planned for mainland
China for now, with the recommendation to start them in International. The
user asked whether the region is not the user's own choice, why there is a
default at all, and whether Set Up opens China's settings; China first was
acceptable to them, as long as the design makes International easy to find.
A window at 1440 × 900 points showed where it was not. Set Up opened the
provider with China chosen and International one button beside it, under the
hint "The region sets where requests go and which models are offered.",
which says nothing of keys. The link to the console, where a key is made, was
the last part of the page, under the endpoint, out of view without scrolling
for all five. A key made in the International console and pasted while China
is chosen is refused at the first generation, since nothing is checked when
it is saved, and the card said only "The provider refused the credentials:"
and the provider's words, which name no region.

**What was set aside.**
- International chosen first, the recommendation: the user keeps China
  first.
- No region chosen until the user picks one: a provider would be set up
  without an address, and Set Up would ask a question before the key.
- Telling the region from the key by trying it in each region: the key would
  go to a region the user did not choose.
- Switching the region by itself after a refusal: the user's choice would
  change without the user.
- A console link for each region at once: opening the International console
  would not choose International, and a key made there would still go to
  China.
- An action that opens Providers on a card whose credentials were refused: a
  failed card has no action for any failure, and its model menu already ends
  with Providers…, which opens Providers at the card's provider.

**Consequences.**
- [Providers](specs/providers.md#credentials-regions-and-endpoints): the
  region, the console link, the credentials, and the endpoint, in this order;
  the region's hint; and the words of credentials refused in a region.
- [Generation cards](specs/generation-cards.md#ending-without-its-files): a
  generation refused for its credentials in a region says so.
- The catalog, the regions and their order, the stored settings, and what is
  sent are unchanged.

## D95 — BaseHalf is for anyone who thinks with AI on a canvas, not one kind of user (NEW, 2026-10-27)

**Decision.** BaseHalf has no single main user. It is for anyone whose
thinking and an AI's flow on one canvas: someone learning a field (D16),
someone making images, video, and sound with AI models (D58, D63, D64, D78),
someone who thinks in maps, for whom notes made small with their connections
are a mind map, and someone reviewing code on a canvas. The affordances stay
generic, as D16 already said: no surface is shaped for one of these alone,
and a feature made for one is also judged by what it does for the others.

**Why.** Generation cards had become a large part of the product while D16
still named learners as the primary user, so on 2026-10-22 the user was asked
whether professional creators of AI media and small studios should take that
place, with a recommendation that they should. On 2026-10-27 the user
answered that BaseHalf has many learning uses and that creators of AI media
are not the only ones who can use it: learners can too; a note made very
small on the canvas becomes a mind map; the canvas can also become a tool for
reviewing code; what BaseHalf is mainly about is the AI's and the user's
thinking flowing on the canvas, a broad use.

**What was set aside.**
- Creators of AI media and small studios as the main user, the
  recommendation of 2026-10-22: it would weigh every choice by paid
  generation, while the same canvas serves learning, maps, and review.
- An edition or a mode for each audience: one canvas and one set of
  affordances serve all of them.

**Consequences.**
- Revises D16: learners are among the people BaseHalf is for, not its
  primary user. D17 stays: compound thinking is the product form.
- Nothing in the window changes.

## D96 — Media in Card Detail opens to view it, Edit edits it, and its gestures are the canvas's (NEW, 2026-10-27)

> **Revised by D97 (2026-10-28).** While an image is edited, a pinch zooms
> its picture under the crop frame, which changes the part kept, and a
> two-finger swipe moves the picture under it; Edit takes a zoom of the view
> back to as it fits, in a glide. The rest of D96 stands.

**Decision.** Card Detail of a video, an image, or a sound opens to look at
the file, as a phone's photo library and voice recorder show what they hold:
the picture of an image, the player of a video with its timeline under it,
and the waveform of a sound with Play, each as the file is, with nothing of
editing on it. **Edit**, in the header's right group before Close, shows the
editor in place: the crop frame and the tools, the yellow frame and the
handles of the frame viewer over the whole original, and the handles, the
trims, and the selection of the waveform, with the line under them. Edit
becomes **Done**, which goes back to viewing, as Escape does. A change is
still saved as it is made (D85): Edit and Done change nothing of the file,
and nothing waits for Done. The picture keeps its place and size, in every
frame, when the editor comes and goes: the room of the tools under it is
kept while viewing. In Card Detail the gestures are the canvas's: a
two-finger swipe and the mouse wheel move a zoomed picture, and a pinch, or
the wheel with the zoom key, zooms it; the wheel alone never zooms. A pinch
zooms the place under the fingers as a browser zooms its page: the picture
of an image or a video grows past its own box over Card Detail's media area,
up to 5 times as it fits, or twice its own pixels when that is more, while
Card Detail's controls keep their size. See
[editing media](specs/media-editing.md#editing-in-card-detail).

**Why.** On 2026-10-27, after D85 and D93, the user set a phone's photo
editor as the reference for editing in BaseHalf, and named three problems.
Opening an image went into editing at once: its crop frame showed as soon as
the pointer was over the picture, and its tools stood under it; the user
asked for an Edit button that editing starts with, as on the phone. A
two-finger swipe zoomed the picture, since a trackpad sends it as the wheel,
which D85 and D93 had zoom it, and a zoomed picture moved only by a drag,
which the user's three-finger drag made: the canvas does the opposite, so the
same fingers did two things on one screen. And a pinch over a video zoomed
it inside its player, whose box cut it, while the user expected the place
under the fingers to grow as a browser's page does. This morning the user
had complained that D84's Edit made the video jump up and flash; so Edit
here changes nothing of the picture's place.

**What was set aside.**
- Saving on Done and a Cancel, as the phone's editor has: changes save
  themselves (D85), and undo and Revert to Original are the ways back. The
  user asked to change how editing starts, not how it saves.
- Edit under the picture, where the tools appear: the header holds the
  card's views and Close, Edit and Done stand in one place, and they take no
  room from the picture.
- The player's own time bar while viewing a video, and the frame viewer only
  while editing: the picture would move to make room for the viewer, as it
  did in D84. Viewing keeps the viewer as the video's timeline, showing the
  file as it is.
- Showing the whole picture again when Edit is pressed, as the phone does:
  it would move a zoomed picture.
- A pinch that crops in editing, as the phone's crop tool does: a pinch never
  changes the file, while viewing or editing.
- The tools and the player's controls zooming with the picture, as a page's
  do: they are Card Detail's, as a browser's toolbar is.
- Twice the picture's pixels as the limit of a zoom (D93): a video of 480
  lines that fits larger than its pixels could hardly zoom.
- Spreading out the time of the timeline or the waveform while viewing:
  that is for precise editing (D93).

**Consequences.**
- Revises D85: Card Detail opens to view, Edit shows the editor, and the
  header holds Edit or Done; the line under the editor shows the edit and
  Revert to Original only while editing. The invariant "a change is the
  result" keeps no Save, Apply, or Cancel; editing a media file starts with
  Edit, and its Done only goes back
  ([architecture invariants](harness/architecture-invariants.md#product-shell)).
- Revises D93: the wheel moves a zoomed picture; a pinch zooms the picture of
  a video over Card Detail, past its player; the limit of a zoom; the time
  spreads out only while editing.
- [Layout controls](specs/layout-controls.md#card-detail): Edit and Done in
  the header. [Opening and closing Card Detail](specs/card-detail-opening.md#the-keyboard):
  Escape leaves editing before it closes Card Detail.
- While viewing, Play plays the file through once, and the player counts its
  time from the start of the part an edit keeps.
- The undo of an edit, the file, its record, and its original are unchanged.

## D97 — A crop is taken back by pushing its frame to the edge, and a pinch while cropping zooms the picture under the frame (NEW, 2026-10-28)

**Decision.** The crop of an image works as a phone's photo editor and the
photo app of the desktop do.
- **The rest of the original stays in sight.** While editing, it shows dimmed
  around the crop frame, also at rest, so what a crop left out is never
  hidden.
- **Pushing toward the edge takes the picture back.**
  - A corner or a side dragged into the margin of 24 px inside the view's
    edge, or past it, stops at the margin's inner edge, and the picture
    follows.
  - It moves and grows smaller around the opposite corner or side, which
    keeps its place on screen, faster the deeper the pointer is.
  - It goes on until the picture's own edge is in reach, or the whole picture
    fits, so one drag takes back what a crop cut.
- **Letting go waits.** The frame stays where it was let go for 1 s, then the
  frame and the picture glide in 200 ms to rest, the part kept as large as
  fits at the middle of the view.
- **The gestures while cropping.**
  - A pinch, or the wheel with the zoom key, zooms the picture under the frame
    around the pointer. The frame keeps its place and size, and the part kept
    grows smaller as the picture grows and larger as it shrinks, as far as the
    picture holds.
  - A two-finger swipe and the wheel move the picture under the frame, as a
    drag inside it does.
  - Each pinch and each swipe is one change, "Crop still.png", once it rests.
- **Edit takes a zoom of the view back** to the picture as it fits, in a glide
  of 200 ms.
- **Viewing does not change.** A pinch zooms the view as a browser zooms its
  page (D96).

See [editing media, Cropping an image](specs/media-editing.md#cropping-an-image).

**Why.** On 2026-10-28, after D96, the user named three problems with an
image:
- a crop could not be taken back to the original's size;
- pushing a crop's edge back toward the edge did not move and shrink the
  picture, as the phone's editor does;
- a pinch while editing did not zoom.

The user set the photo app of the desktop as the reference, since it works as
the phone does. Measured in a development window on a picture of
2400 × 1600:
- After a crop to 1320 × 880 and its glide, the picture was zoomed from 0.41
  to 0.75 screen pixels for each of its pixels, and the rest of the original
  lay outside the view, painted over.
- A drag of a corner kept the scale it started with. Even the window's corner
  took the part back only to 1823 × 1015, and the frame's corner went outside
  the view.
- A pinch out at rest changed nothing, since the view zooms only above as it
  fits. A pinch in zoomed the view and hid the frame (D96).

What the references do:
- The photo app recenters and resizes the photo once a handle is let go.
- It takes back more of the photo when a handle is pushed "against the edge
  of the window", and resizes and recenters "after a second".
- It zooms the photo in and out with a two-finger pinch while cropping, and a
  drag in the middle moves the photo under a crop of the same size.
- The phone's crop is changed by dragging the corners or by pinching the
  photo, and the corner or side opposite the one dragged stays put.

**What was set aside.**
- Taking a crop back only with Revert to Original: that takes back every
  choice, the turn and the angle too.
- A wider margin around the frame at rest, to give the pointer room: the part
  kept would show smaller, and the window's edge would still bound one drag.
- Following at the window's edge instead of the view's: the pointer would
  leave the picture first. The 24 px of the frame's rest are where a handle
  reaches the view's edge.
- Showing the rest of the original only while dragging (D85): a crop then
  looks final, and nothing shows that there is more to take back.
- The view's zoom while an image is edited (D96): a pinch can mean one thing,
  and in a crop tool it is the crop's, in both references. The view's zoom
  stays for viewing, and for a video while editing.
- Gliding at once on letting go (D85): a handle let go and taken again moved
  under the pointer, and the reference waits.
- A double click that zooms while editing: it zoomed the view. A double click
  while editing does nothing.
- Option-dragging a corner to move all four, and Shift with a side, as the
  photo app has them: more than the plain crop the user asked for, with no
  adjustments beyond it.

**Consequences.**
- Revises D96: Edit shows an image's whole picture as it fits, gliding from a
  zoom of the view; a pinch while cropping changes the crop; a double click
  while editing does nothing.
- Revises D85's crop view: the rest of the original shows dimmed while
  editing, and letting go waits 1 s before the glide.
- A handle pushed toward the edge of an editor in Card Detail follows one
  rule: what it edits comes to it, faster the deeper the pointer is in the
  view's margin of 24 px or past it, until the end is in reach. For the crop,
  the picture moves and shrinks. For the frame viewer and the waveform, the
  spread-out stretch moves along (D93).
- The edit record, what is written, and the undo are unchanged. A pinch and a
  swipe while cropping are steps named as a drag of the frame is.

## D98 — A video's controls float over its picture and darken nothing else, and a trim follows a handle held against its edge (NEW, 2026-10-28)

**Decision.** The controls of a video's player, on a card and in Card Detail,
float over the picture as a photo app's player has them. The bar lies 8 px
inside the picture's bottom, left, and right edges, 30 px high with rounded
corners, at most 480 px wide, in the middle. The sound button is a round
button inside the top left corner. Each has its own small translucent
backing that blurs the picture behind it, so that the controls read over a
white picture as over a black one. No shade goes across the picture, and a
card at rest has nothing over its picture. In Card Detail the controls show
as a player's do: while the video is paused, while the pointer moves over the
picture or rests on a control, and while a key took the keyboard to one of
them. While it plays, they fade 2.5 s after the pointer last moved, and at
once when it leaves the picture; faded, the keyboard still reaches them. Card
Detail draws its player with the video's shape from the first frame it shows,
never a box of another shape, and a card that cannot take its video's shape
shows its own surface around the picture, not black. In the frame viewer of a
video and the waveform of a
sound, a drag that comes within 24 px of the strip's edge, not only past it,
moves a spread-out stretch along, a held handle's spread too, by the rule the
crop frame of an image follows (D97): the depth from the margin's inner side
over 100 is the share of its length the stretch moves each second, at most 4,
while what the drag holds stays at the margin's inner side, never under the
edge, until the start or the end is in view. See [generation cards, "The player"](specs/generation-cards.md#the-player)
and [editing media](specs/media-editing.md#zooming-the-picture-and-the-time).

**Why.** On 2026-10-28 the user found a video card's black edge too wide and
asked for it to be narrower, or not felt at all, and asked that a video's
editing follow the phone's. Measured in a window with videos of 16:9, 9:16,
4:3, 1:1, and 21:9 on a blue grid:
- No picture was letterboxed. Each card took its video's shape (D66) with
  the 1 px edge of an image card. Card Detail's player had the picture's size
  from its first frame.
- The black was the shade under the controls. It was a gradient from half
  black at the picture's bottom edge, 64 px high: a fifth of a 300 px card
  while it was hovered or selected. In Card Detail it was 56 px, always
  shown, and darkened the bottom of the picture by up to 45%. On a dark video
  it reads as a black band along the bottom edge.

A photo app's player shows its controls on a small floating bar of their own
and darkens nothing else. While the video plays, it hides them once the
pointer rests. The phone's trim already matched BaseHalf's frame viewer: the
yellow frame and its handles, the frame at the handle in the picture, and
holding a handle to spread the strip out. Only its edge differed. The phone
follows a handle held against the edge of the strip. BaseHalf's moved only
once the pointer went past the edge, and a held handle's spread did not move
at all: the handle stopped at the spread's end, 2 s from where it was held.
The user asked for one rule wherever a handle is dragged towards an edge
("可能是个全局的问题"), so the strips take the crop frame's numbers.

**What was set aside.**
- A shorter or lighter shade: it is still a band across the picture.
- The controls under the picture, outside it: the card's shape is the
  picture's (D66), and Card Detail's frame viewer is there.
- Hiding the controls of a selected card while the pointer is elsewhere: the
  selected card is where the keyboard is, and its bar is now small.
- Controls that fade while a Card Detail video is paused: a paused video
  with nothing on it reads as a still picture.
- A strip that also zooms out while it follows a handle: its stretch is a
  window onto the length, which moving along reaches; holding a handle and
  the pinch choose its scale.
- A placeholder before Card Detail knows the video's size: the player takes
  the shape its card measured, or waits for the video's own size before it
  is drawn, so no box of the wrong shape shows. In the window measured it
  never showed, since Card Detail draws the player once it has its first
  frame; a video Card Detail opens before any card measured it could.
- A narrower frame around a video that its card cannot hold at its shape
  (one wider than 3:1, or smaller than a card can be): the frame is the
  picture fitted into the card, and its surface around the picture is the
  card's, as an image card's is.

**Consequences.**
- [Generation cards, "The player"](specs/generation-cards.md#the-player): the
  controls float over the picture with their own backing. Card Detail's show
  as a player's do. Criteria 40 and 99.
- [Editing media](specs/media-editing.md#zooming-the-picture-and-the-time):
  the 24 px margin at the strip's edges, its speed, what the drag holds, and
  criterion 27.
- The zoomed picture of D96 gets no shade across it either.
- The cards' shapes, the player's behaviour on a card (D62), and the
  frame viewer's other gestures are unchanged.
