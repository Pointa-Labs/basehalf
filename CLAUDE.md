# Using BaseHalf (instructions for coding agents)

> **Companion guides:** `AGENTS.md` and `CLAUDE.md` are intentionally kept in
> sync as equivalent coding-agent entry points. Both are for developing
> BaseHalf itself, not the workspace hint that BaseHalf installs into a user's
> project folder.
>
> Product and architecture decisions are indexed below. For subsystem-specific
> details, read the relevant decision/spec instead of copying workspace-agent
> protocol rules into this guide.

## Development protocol: spec first

BaseHalf development is specification-driven. For every substantive product,
architecture, protocol, schema, persistence, security, UI-state, or cross-module
change, read and update the owning specification before editing implementation
source. Follow [the spec-driven development workflow](docs/specs/spec-driven-development.md):

`Spec -> Review -> Plan -> Implementation -> Verification -> Commit`

A conversation summary, task plan, or code diff is not the specification.
Decision documents record why a direction was chosen; specifications define the
current required behavior and acceptance criteria. If implementation discoveries
change the contract, update the specification rather than letting code become the
only source of truth.

## Source-tree boundary: never initialize this repository

The repository root and `vscode-base/` are BaseHalf implementation source trees,
not user workspaces. Their tracked `.basehalf-no-workspace-setup` markers must
remain in place. Never run or accept product workspace initialization against
either directory.

In these source trees:

- do not create or update `.bh/`, `.bh/mirror/`, `.bh/current_focus.yaml`, or
  `.bh/agent-harness/`;
- do not append generated BaseHalf workspace-hint sections to `AGENTS.md` or
  `CLAUDE.md`;
- do not create product-generated agent guides or modify `.gitignore` for
  `.bh/cache/`;
- do not read or follow any `.bh/` YAML found here as development context.

Any such YAML or generated hint is accidental contamination, not product truth.
Use disposable fixture workspaces for development hosts, smoke tests, and
workspace-setup tests. Normal user workspaces without the opt-out marker retain
the product's existing YAML protocol.

Migration baseline: this branch starts from commit
`41639435d6510d3d87a195f5498e88cd8ea80600` (`feat(editor): code files
first-class — Monaco code editor + canvas cards`). Treat that commit and earlier
history as the source of BaseHalf's original product/business logic. The later
hand-rolled VS Code-like Git/SCM/GitHub/workbench refactor commits are sunk cost
and should not be preserved for their own sake. The current strategy is to
develop on a real VS Code base (`vscode-base/`, also reachable through
`reference/vscode` when present) and port only BaseHalf's own product layer onto
it.

Current migration direction, locked on 2026-06-30: use VS Code as the lower
application substrate, not as the final product shape. Git, SCM, GitHub auth,
quick input, files, search, editor infrastructure, workbench services, terminal
process/profile/shell-integration APIs, menus, keybindings, notifications,
progress, and dialogs should prefer VS Code's native implementation. Keep only
BaseHalf-specific integration points: the `.bh` mirror protocol, workspace
setup/hints, canvas, focus/ADHD state, badge/reference graph, agent-oriented
search/brief logic, the canvas-first navigation model, and the right-side Agent
Area product surface.

The left sidebar product surface is intentionally small: **Files**, **Git**,
**Search**, and the BaseHalf-owned **Plugins** library. Prefer VS Code's native
view-container, Activity Bar, Explorer/Search/SCM, menu, and settings mechanics,
but do not expose the stock Extensions Marketplace and do not add Agent to the
sidebar. File activation from Explorer/Search must route back into BaseHalf's
folder/canvas/card-detail navigation: folders open canvases, files open BaseHalf
card detail, and standard VS Code editor tabs are only fallback or advanced
behavior. Individual plugins cannot register competing global sidebars.

The extension ecosystem starts curated, not marketplace-open. The initial
BaseHalf product profile should allow only the extension families needed for
the product shape: Git, GitHub, GitHub authentication, Codex, and Claude. Keep
the full Marketplace/Extensions product surface hidden until there is an
explicit product decision to expose it.

BaseHalf is canvas-first. Opening a canvas card must enter a full-screen card
detail surface inside the BaseHalf canvas flow; it must not default to VS
Code's editor-tab/group behavior. VS Code editor groups may remain available as
an advanced/fallback capability, but they are not the primary open model.

Markdown is a multi-projection document. The Markdown text file / VS Code
`TextDocument` / working copy is the single source of truth. BaseHalf should
offer projections over that same document inside the card detail surface:
`rich` (default, BlockNote-like editable Markdown), `source` (raw Markdown in
VS Code's text editor infrastructure), and `preview` (rendered read-only
Markdown, following VS Code's preview/custom-editor pattern). Switching between
these projections must not create separate files or default editor tabs.
Preserve the original BaseHalf rich Markdown model from the migration baseline:
BlockNote-style editing, a per-file in-memory YJS live document as the
collaboration-ready projection layer, and `mdSegment`-style byte-preserving
splice-save so unchanged Markdown remains verbatim on disk.

The right side of the app is an **Agent Area**, not a generic Terminal panel.
Terminal is one renderer/session type inside it. The Agent Area can host TUI
agents (Codex CLI, Claude Code CLI, or plain shells through BaseHalf's xterm/pty
surface) and VS Code-extension agents (Codex/Claude-style extensions through
the VS Code extension host, webviews, commands, auth/secrets, and terminal API).
The user-visible session picker has exactly five first-class choices: TUI
Codex, TUI Claude Code, VS Code extension Codex, VS Code extension Claude Code,
and Terminal for shell/TUI agents such as OpenCode or Gemini CLI.
Extension calls such as `vscode.window.createTerminal()` should route into
Agent Area sessions instead of restoring VS Code's default terminal panel UI.
Do not ship VS Code's default Agent/Chat/Copilot/Sessions product surfaces in
BaseHalf. Treat `src/vs/sessions` and chat/agent workbench contributions as
architecture reference or compatibility plumbing only; hide/remove their native
views, panel entries, welcome surfaces, status items, and default commands unless
they are explicitly remapped into BaseHalf's Agent Area.

`@basehalf/core` is now historical migration material, not the required desktop
architecture center. Read the old core modules to understand the original
product semantics, but do not add new desktop-facing orchestration to core.
Prefer VS Code-aligned workbench parts, platform services, providers,
contributions, and narrow BaseHalf services.

## Decision Document Index

Read the decision docs when architecture/product context matters. This current
decision index is intentionally duplicated here so context compaction does not
erase the map of where decisions live. Historical/superseded decisions remain in
the source docs for archaeology, but they are not listed here as guidance.

Start here:

- [docs/decisions.md](docs/decisions.md) — public key decisions, including
  historical/superseded entries.
- [private-docs/decisions/README.md](private-docs/decisions/README.md) —
  private decision corpus conventions. This directory is intentionally private
  and may be gitignored, but it is load-bearing for "why did we decide this?"
  questions.
- [private-docs/focus_mode_spec/](private-docs/focus_mode_spec/) —
  authoritative `.bh/mirror/` model and focus-mode spec.

Current public decision index:

- D1 — We are a substrate, not an agent.
- D4 — Grounded + auditable + reversible; re-scoped by D12/D13.
- D6 — Local-first now; collaboration deferred but pre-wired.
- D8 — Stack: TypeScript + SQLite-when-needed; build on existing OSS.
- D9 — License/IP: Apache-2.0 + CLA + long-term open-core.
- D10 — Naming/brand: BaseHalf + edition words + trademark policy.
- D11 — Contribution intake: CLA gate before publish.
- D12 — Markdown files = content truth; `.bh/` = local derived mirror; git =
  user-file history.
- D13 — BaseHalf never modifies user files unprompted.
- D14 — Agent protocol = publish, not inject.
- D15 — Electron desktop app, Mac first, cross-platform target.
- D16 — Target user = curious learners using AI to learn.
- D17 — Compound thinking = the product form.
- D18 — Decisions module retired; corpus moved to MD in private docs.
- D19 — `.bh/mirror/` YAML model; CLI/inbound/proposals/focus.md deleted.
- D20 — VS Code as substrate, BaseHalf as canvas-first product.
- D21 — Right side is Agent Area, not Terminal panel.
- D22 — Sidebar, extension allowlist, and file-open remapping.
- D23 — Module-complete migration, not MVP or intermediate shell.
- D24 — References are explicit directed context flow; Markdown links only navigate.
- D25 — Plugin platform uses a fixed shell and an open center.
- D26 — Executable plugins are curated trusted local software.
- D27 — Plugin workflow output is local user-owned data.
- D28 — AI Video is the first official domain plugin.
- D29 — Official plugins use a signed static catalog and immutable VSIX distribution.
- D30 — Community publishing uses the existing Basehalf account and a signer-separated curated pipeline.
- D31 — Plugin portal and signed registry use separate subdomains.
- D32 — Publishing is one front-stage action; installed lifecycle stays VS Code-native.
- D33 — Main canvas unifies content and optional execution; domain plugins contribute recipes.
- D34 — Executable media nodes use immutable Attempts and seal one local file per Result.

Current private decision index:

- [card-detail-content-rendering-and-rich-attachments.md](private-docs/decisions/card-detail-content-rendering-and-rich-attachments.md) — Card Detail owns direct rendering; rich attachments stay local files and Markdown links.
- [agent-observations-not-badge-flags.md](private-docs/decisions/agent-observations-not-badge-flags.md) — agent write-back is independent observations; badge stays human-written.
- [agent-self-navigates-graph.md](private-docs/decisions/agent-self-navigates-graph.md) — Agent self-navigates graph with token budget and reference depth.
- [ai-native-file-manager-ambition.md](private-docs/decisions/ai-native-file-manager-ambition.md) — BaseHalf ambition as AI-native file manager.
- [bh-is-passive-container-provider.md](private-docs/decisions/bh-is-passive-container-provider.md) — BaseHalf is passive container/provider, not the intelligence.
- [bh-standalone-completeness.md](private-docs/decisions/bh-standalone-completeness.md) — BaseHalf should be useful standalone without agents.
- [block-editor-blocknote.md](private-docs/decisions/block-editor-blocknote.md) — block editor uses BlockNote.
- [blocknote-confirmed-for-notion-parity.md](private-docs/decisions/blocknote-confirmed-for-notion-parity.md) — BlockNote supports Notion-level editing goals.
- [brief-freshness-calibration.md](private-docs/decisions/brief-freshness-calibration.md) — agents should compare annotation/file freshness dates.
- [canvas-creation-stays-on-canvas.md](private-docs/decisions/canvas-creation-stays-on-canvas.md) — creating any node stays on the canvas; New Note enters its inline editor and Card Detail requires explicit open intent.
- [canvas-lib-react-flow.md](private-docs/decisions/canvas-lib-react-flow.md) — canvas uses React Flow.
- [clean-slate-delete-old-src.md](private-docs/decisions/clean-slate-delete-old-src.md) — old `src/` reference implementation was deleted cleanly.
- [containers-renamed-to-badges.md](private-docs/decisions/containers-renamed-to-badges.md) — containers renamed to badges.
- [cross-platform-electron-mac-first.md](private-docs/decisions/cross-platform-electron-mac-first.md) — Electron cross-platform, Mac first.
- [decisions-is-builder-only-tool.md](private-docs/decisions/decisions-is-builder-only-tool.md) — decisions module was builder-only dogfood.
- [decisions-module-retired.md](private-docs/decisions/decisions-module-retired.md) — decisions module retired into MD corpus.
- [defer-since-last-read-delta.md](private-docs/decisions/defer-since-last-read-delta.md) — defer "since last read" summaries.
- [drop-badge-display-field.md](private-docs/decisions/drop-badge-display-field.md) — badge display field removed; display name is filename.
- [extras-travel-with-folder.md](private-docs/decisions/extras-travel-with-folder.md) — extras travel with the folder under `.bh/`.
- [fix-bh-gitignore-extras-policy.md](private-docs/decisions/fix-bh-gitignore-extras-policy.md) — `.bh/` gitignore policy fix.
- [focus-mode-mirror-yaml-model.md](private-docs/decisions/focus-mode-mirror-yaml-model.md) — focus mode spec replaces older badge/inbound/CLI/proposals/focus.md model.
- [global-model-services-are-host-capabilities.md](private-docs/decisions/global-model-services-are-host-capabilities.md) — model connections and encrypted credentials are global host capabilities shared by curated plugins.
- [folders-are-badges-too.md](private-docs/decisions/folders-are-badges-too.md) — folders are first-class badges.
- [ir-v2-13-scope-clarification.md](private-docs/decisions/ir-v2-13-scope-clarification.md) — scope clarification for user-file writes.
- [ir-v2-replaces-v1.md](private-docs/decisions/ir-v2-replaces-v1.md) — IR v2 replaces v1.
- [never-modify-user-files-reaffirmed.md](private-docs/decisions/never-modify-user-files-reaffirmed.md) — BaseHalf never modifies user files unprompted.
- [no-agent-verification-checklist.md](private-docs/decisions/no-agent-verification-checklist.md) — v0 must pass no-agent verification.
- [obsidian-vault-disk-model.md](private-docs/decisions/obsidian-vault-disk-model.md) — workspace disk model follows Obsidian vaults.
- [open-source-and-free-until-mature.md](private-docs/decisions/open-source-and-free-until-mature.md) — open source and free until mature.
- [overturn-event-log-truth-md-files-content-truth.md](private-docs/decisions/overturn-event-log-truth-md-files-content-truth.md) — overturn event-log truth; MD files are content truth.
- [protocol-not-prompt-injection.md](private-docs/decisions/protocol-not-prompt-injection.md) — compound mechanism is protocol, not prompt injection.
- [reference-edges-are-context-flow-topology.md](private-docs/decisions/reference-edges-are-context-flow-topology.md) — explicit references form a general directed context-flow graph; Markdown links only navigate and canvas edges have no relationship prose.
- [rich-editor-agent-native-hardening.md](private-docs/decisions/rich-editor-agent-native-hardening.md) — external writes merge incrementally with remote-author undo semantics; byte fidelity is a gate; Markdown links are authored for navigation without mutating references.
- [rich-editor-undo-single-owner.md](private-docs/decisions/rich-editor-undo-single-owner.md) — rich editor undo/redo has one owner; collaboration undo manager lifecycle is ours.
- [right-side-agent-area-hosts-tui-and-extension-agents.md](private-docs/decisions/right-side-agent-area-hosts-tui-and-extension-agents.md) — right side is Agent Area for TUI and extension agents.
- [screen-attention-economy.md](private-docs/decisions/screen-attention-economy.md) — screen attention economy strategy.
- [target-user-curious-learner-ai-augmented.md](private-docs/decisions/target-user-curious-learner-ai-augmented.md) — target user is curious learner using AI.
- [use-vitest-as-the-test-runner.md](private-docs/decisions/use-vitest-as-the-test-runner.md) — use Vitest as test runner.
- [v1-evolution-not-blocked.md](private-docs/decisions/v1-evolution-not-blocked.md) — v1+ ambitions are not blocked.
- [vscode-aligned-electron-architecture.md](private-docs/decisions/vscode-aligned-electron-architecture.md) — align with VS Code Electron workbench/provider model.
- [vscode-base-canvas-detail-markdown-projections.md](private-docs/decisions/vscode-base-canvas-detail-markdown-projections.md) — VS Code substrate with BaseHalf canvas detail and Markdown projections.
- [vscode-base-module-complete-migration.md](private-docs/decisions/vscode-base-module-complete-migration.md) — migrate modules to complete product quality, not MVP/intermediate shell.
- [vscode-base-react-flow-scene-island.md](private-docs/decisions/vscode-base-react-flow-scene-island.md) — React Flow owns the live canvas scene behind a narrow VS Code workbench adapter.
- [vscode-base-sidebar-extension-and-file-open-boundaries.md](private-docs/decisions/vscode-base-sidebar-extension-and-file-open-boundaries.md) — VS Code sidebar mechanics with BaseHalf navigation.
- [wedge-is-compound-thinking-not-decisions.md](private-docs/decisions/wedge-is-compound-thinking-not-decisions.md) — wedge is compound thinking, not decision provenance.

## Recording why decisions were made (internal team workflow)

This project's own architecture / product decisions are kept as MD files under
`private-docs/decisions/<slug>.md` (one decision per file, with a YAML
frontmatter block plus a rationale body). Grep / read them directly; there's no
CLI wrapper. When you encounter "why did we…" questions about architecture or
product direction, look in `private-docs/decisions/` first. The corpus README at
`private-docs/decisions/README.md` explains the conventions. If you are working
on the `.bh` mirror/focus subsystem, read `private-docs/focus_mode_spec/` at
that point instead of relying on this guide.

## Rules (carry into future modules)

- **VS Code-aligned boundaries.** Prefer workbench parts, renderer services,
  main-process/platform services, provider/extension integrations, commands,
  context keys, menus, quick input, and working-copy/file services that mirror
  the closest VS Code source. Do not deepen `@basehalf/core` coupling for new
  desktop work.
- **Module-complete migration.** Do not frame the VS Code-base work as an MVP,
  spike, or temporary shell. Work may land module by module, but each module
  should be implemented to product quality: source-aligned architecture,
  complete expected UI states, interactions, error paths, tests or explicit
  verification, and a clear keep/delete boundary against old BaseHalf code.
  A module cannot be called done while it still depends on placeholder UI,
  disconnected command handlers, TODO-only integration seams, or behavior that
  is merely demonstrated instead of usable. If a large module is split across
  commits, each commit should complete a named coherent submodule; do not land
  user-visible dead ends, disabled controls, fake data, or detached UI that only
  reserves space for a later pass.
- **Sidebar is Files/Git/Search/Plugins.** Reuse VS Code view-container,
  Activity Bar, Explorer/Search/SCM, context-menu, and settings mechanics. The
  Plugins entry is BaseHalf-owned and curated; it is not the stock Marketplace.
  Keep Agent and plugin-defined global sidebars out, and remap file activation
  into BaseHalf's canvas/card-detail navigation.
- **Curated extensions first.** During the VS Code-base migration, expose only
  the Git/GitHub/GitHub-auth/Codex/Claude extension families needed for SCM and
  Agent Area. Keep the full marketplace and generic Extensions UI hidden.
- **Fixed shell, open center.** Plugins may add project types, main-canvas
  recipes and templates, card previews, and file-specific card-detail projections.
  They must not add competing global sidebars/panels, replace Agent Area, make
  editor tabs primary, or change BaseHalf reference semantics.
- **One primary content/execution canvas.** Text, code, files, folders, images,
  video, audio, PDF, and presentations use the BaseHalf main-canvas model.
  Text and code keep their normal file editors; executable result containers
  use only file/image/video/audio/PDF/presentation kinds. Executable media nodes
  follow Draft → immutable Attempt(s) → one sealed local-file Result. A sealed
  Result never switches files or runs again; changed settings create a new Draft.
  Domain plugins add reviewed recipes, templates, input roles, validation, and executors; they do
  not duplicate the main canvas, node/edge truth, or execution lifecycle.
- **Plugin output is user data.** Explicit user/Agent workflow runs may create
  ordinary project files and media. Keep domain truth out of `.bh/mirror` and
  extension-private databases; plugin removal must leave user files readable.
- **Canvas-first open model.** Card open, close, breadcrumb, focus, and history
  behavior belongs to BaseHalf's product layer. Do not let standard VS Code
  tabbed editor groups become the default card interaction.
- **Reference graph is explicit context flow.** `A → B` means A's context flows
  into B. This is a general directed graph, not a hierarchy: many-to-many
  relationships and cycles are valid, while self-references are not. Only an
  explicit user or Agent action creates cards or references; Markdown links
  only navigate. Canvas edges persist endpoints and anchors, never relationship
  labels or notes. Retired label data is a clean break with no migration.
- **Markdown projections share one truth.** Rich, source, and preview modes for
  `.md` files must operate on one Markdown working copy. Block/rich editor state
  is a YJS-backed projection; the file text remains content truth for git, diff,
  search, external editors, and agents. Preserve byte-stable splice-save for
  unchanged Markdown segments.
- **Agent Area owns the right side.** Do not add new right-side work as a plain
  terminal panel. Model it as agent sessions: TUI agent, extension agent, or
  shell. Keep BaseHalf's terminal interaction quality, but map VS Code terminal
  APIs and extension-created terminals into this surface.
- **No VS Code-native agent surface.** Do not expose VS Code's built-in
  Agent/Chat/Copilot/Sessions UI as a product area. Reuse only the services/APIs
  needed for extension compatibility, and route user-visible agent UI into
  BaseHalf's Agent Area.
- **BaseHalf Electron smoke.** For VS Code-base UI/routing changes, use
  `npm run basehalf:smoke` from `vscode-base/` for a compile + Electron smoke,
  or `npm run basehalf:smoke-no-compile` after `out/` is already current. The
  smoke covers canvas startup, hidden Open Editors, Quick Open, Quick Text
  Search, and folder routing.
- **Legacy core is reference material.** Existing core modules may remain for
  package history and tests. When editing one, keep behavior stable, but move
  desktop-facing orchestration toward cohesive VS Code-style services/adapters.
- **Automated services never write user files unprompted.** Only explicit user
  edits through the BaseHalf UI write back to disk. Agents edit user files with
  their own tools; BaseHalf services observe and reconcile unless the user
  triggers a concrete write action.
- **Don't restore the deleted event-log impl.** It was overturned by the
  architecture; if you need to read it, it's in git history at `c441f79`.
- **Don't restore the deleted decisions module.** It served the old
  AI-coding wedge as a dogfood tool; the corpus lives as MD in
  `private-docs/decisions/` now. See [docs/decisions.md D18](docs/decisions.md).
- **Maintainers (including agents working for them) push `main` directly —
  no PR.** `maintainer-fastlane.yml` auto-greens the `CLAAssistant` check on
  direct pushes by allowlisted logins, so the old "CLAAssistant stuck on
  Expected" problem is gone. The quality gate moved EARLIER: lint, typecheck
  and the full test suite must be green BEFORE every push (CI still runs on
  main but a red run won't block an already-landed push), and substantive
  changes get an in-session adversarial review (there's no PR-time codex
  review on this path). External contributors are unchanged: branch → PR →
  CLA + checks → merge (see [CONTRIBUTING.md](CONTRIBUTING.md)).
