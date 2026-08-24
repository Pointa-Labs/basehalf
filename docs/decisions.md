# Key decisions (with the reasoning)

Short ADR-style record of the calls that shaped this project, and *why* — so we
(and contributors) don't relitigate them by accident.

> **2026-05-27+ architecture pivots**: D2 / D3 / D7 (event-log as source of
> truth) were **overturned** when the team replaced the event-log model with
> **MD = content truth + `.bh/` = local derived mirror + git = user-file history**. D5
> (CLI-first over one core) was later superseded by the Electron desktop path
> and the 2026-06 VS Code-base migration. D8's library picks have also evolved
> (see notes inline). D12–D24 capture the current direction.
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

## D12 — MD = content truth; `.bh/` = local derived mirror; git = user-file history (NEW, overturns D2/D3)

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

## D24 — References are explicit directed context flow; Markdown links only navigate (NEW, 2026-07-11)

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
