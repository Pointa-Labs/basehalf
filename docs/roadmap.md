# Roadmap

BaseHalf is being rebuilt on top of a real VS Code base. This roadmap is the
current execution guide for that migration; older Core-era v0 plans are
historical context and should not drive new implementation work.

See also:

- [decisions.md D20](decisions.md#d20--vs-code-as-substrate-basehalf-as-canvas-first-product-new-2026-06-30)
  for the VS Code substrate decision.
- [decisions.md D21](decisions.md#d21--right-side-agent-area-hosts-tui-extension-agents-and-terminal-new-2026-06-30)
  for Agent Area direction.
- [decisions.md D22](decisions.md#d22--vs-code-sidebar-extension-and-file-open-boundaries-new-2026-06-30)
  for sidebar and extension boundaries.
- [decisions.md D23](decisions.md#d23--module-complete-migration-not-mvp-or-intermediate-shell-new-2026-06-30)
  for the quality bar: module-complete migration, not an MVP shell.

## Product Direction

BaseHalf uses VS Code as the lower application substrate, not as the final
product shape. We inherit VS Code's mature implementations for files, Git/SCM,
GitHub auth, QuickInput, commands, keybindings, extension host, workbench
services, notifications, progress, dialogs, and platform integration.

BaseHalf's own product layer remains canvas-first:

- The folder is the primary product object: an AI-native folder workspace.
- The background is always the canvas.
- Folders open canvases; files open full-screen card detail inside the canvas
  flow.
- Standard VS Code editor groups and tabs are fallback/advanced capability, not
  the default BaseHalf open model.
- Markdown is a multi-projection document: rich editable, source, and preview
  projections over one VS Code `TextDocument` / working copy.
- The right side is BaseHalf's Agent Area, unifying TUI agents, extension agents,
  and plain terminals.
- The left sidebar exposes exactly Files, Git, and Search.

## Quality Bar

This migration is not an MVP, spike, or temporary shell. Work can land module by
module, but a module is not done until it is coherent enough to keep.

Each module's definition of done includes:

- Relevant VS Code source comparison.
- Clear keep/delete boundary against old BaseHalf code.
- Complete UI states: normal, empty, loading, error, disabled, conflict, and
  permission states where applicable.
- Complete interactions: keyboard, mouse, context menu, command palette,
  cancellation, and navigation behavior where applicable.
- No user-visible dead controls, fake data, placeholder UI, disconnected command
  handlers, or accidental fallthrough into VS Code tabs.
- Tests or explicit verification, including `npm run basehalf:smoke` for
  workbench/UI routing changes.

Large modules may be split into smaller coherent submodules, but each commit
should complete the scope named by that commit.

## Active Module Tracks

### 1. Workbench Profile And Window Shell

Goal: BaseHalf launches as a VS Code-based Electron product with a BaseHalf
profile, predictable window layout, and hidden stock surfaces that conflict with
the product.

Done means:

- BaseHalf product profile is the default for this branch.
- Product identity is BaseHalf-owned: app names, data folders, URL protocol,
  macOS bundle id, Windows identifiers, Linux executable/icon names, and
  GitHub auth callback scheme are not left as Code OSS defaults.
- Activity bar/sidebar/editor/auxiliary layout matches BaseHalf direction.
- VS Code-native Agent/Chat/Copilot/Sessions product surfaces are hidden unless
  explicitly remapped into Agent Area.
- Generic extension marketplace UI is not exposed before the curated extension
  policy is ready.
- Startup does not black-screen, flicker into stock VS Code, or show confusing
  empty editor branding.

Current status: product identity is renamed to BaseHalf in
`vscode-base/product.json` and the VS Code-base dev package is renamed to
`basehalf-vscode-dev`; dev Electron prelaunch verifies the product-specific
executable/app bundle, and the BaseHalf smoke runner fails fast if the runtime
or development identity drifts back to Code OSS.

### 2. Files, Explorer, Canvas, And Card Detail

Goal: Reuse VS Code Explorer/file service mechanics while routing user
activation through BaseHalf's canvas model.

Done means:

- Explorer rows, context menus, create/rename/delete/copy/paste/import/upload,
  drag/drop, keyboard navigation, and refresh behavior remain VS Code-quality.
- File activation opens BaseHalf card detail by default.
- Folder activation opens the corresponding BaseHalf canvas.
- Open Editors is hidden from the product sidebar.
- Dirty card-detail navigation is blocked through the BaseHalf flush gate.
- Notebook, override, side-by-side, and other explicit VS Code editor requests
  remain available as intentional fallback paths.
- Quick Open and Search result activation use the same routing as Explorer.

Current status: the routing submodule is implemented and covered by the
BaseHalf Electron smoke runner.

### 3. Git, SCM, GitHub, And GitGraph

Goal: Stop hand-rolling Git behavior and rely on VS Code's Git/GitHub/SCM
architecture wherever possible.

Done means:

- Source Control panel behavior, repository rows, branch picker, commit box,
  change groups, context menus, command enablement, and toolbar state match VS
  Code source behavior.
- Publish, sync, fetch, pull, push, branch selection, upstream/no-upstream,
  no-remote, auth-required, empty repo, detached HEAD, and error states are
  connected through VS Code-shaped command/auth/progress/notification flows.
- GitHub auth opens the expected VS Code authentication path, including device
  flow/browser flow behavior.
- Browser callback auth requires a BaseHalf-owned GitHub OAuth app/client
  secret and callback scheme. Without that configured, the expected source
  behavior is the VS Code OSS no-secret fallback: device code first, then PAT
  where the client is unsupported.
- No BaseHalf-specific popover or toast replaces a VS Code-native flow unless a
  deliberate product decision says so.
- GitGraph is either sourced from a VS Code-compatible extension/provider path
  or clearly mapped onto VS Code SCM/repository state.

Current boundary note:
[git-scm-github-gitgraph.md](git-scm-github-gitgraph.md) maps GitGraph onto VS
Code's SCM history provider and Source Control Graph view.

### 4. Search, QuickInput, And Command Palette

Goal: Reuse VS Code QuickInput/Search UX while preserving BaseHalf navigation.

Done means:

- Quick Open, command palette, text search, and file search use VS Code's
  single QuickInput surface rather than separate custom popovers.
- Preview, accept, cancel, keyboard navigation, recently opened rows, and
  active-item behavior are aligned with VS Code.
- File/folder accept routes into BaseHalf card detail/canvas.
- Search errors, empty results, ignored files, binary files, and large folders
  have clear states.

### 5. Markdown, Rich Editor, Source, And Preview

Goal: Preserve BaseHalf's rich document model while integrating with VS Code's
text document and working-copy infrastructure.

Done means:

- Rich editor keeps the BlockNote-style editing experience.
- Source projection uses VS Code editor infrastructure.
- Preview projection follows VS Code's Markdown preview/custom-editor pattern.
- All projections share one source of truth and one dirty/conflict/save model.
- External disk changes, save failures, serialization errors, and navigation
  prompts are complete.
- Frontmatter, including a note's `upstream` list, survives rich editing
  byte-for-byte; the rich projection never writes cached frontmatter
  ([reference graph](specs/reference-graph.md#rich-editor-coherence)).

### 6. Workspace Metadata, Reference Graph, And Legacy Cleanup

Goal: Store each reference once in its downstream node, keep `.bh/` as plain
BaseHalf project metadata, and remove what earlier releases wrote, using VS
Code file, working-copy, and storage services underneath. The owning
specifications are [reference graph](specs/reference-graph.md) and
[workspace state and legacy cleanup](specs/workspace-state-and-legacy-cleanup.md).

Done means:

- Each reference `A → B` is stored once, in B's `upstream` list: Markdown
  frontmatter, the `.bhnode` `upstream` field, or
  `.bh/mirror/<path>/upstream.yaml` for other nodes. The reverse direction is
  derived by an in-memory index and never stored.
- Reference operations write through the document's working copy or a
  compare-and-swap writer, with the specified canvas undo, refusals, and
  recovery.
- Dangling, invalid, and unreadable entries are visible issues with explicit
  repair actions; nothing removes them automatically.
- Workbench moves offer the rename refactor, and legacy badge pairs move into
  downstream stores only after the user confirms.
- `badge.yaml`, `canvas.yaml`, `adhd.yaml`, `appearance.yaml`, and
  `upstream.yaml` are read/written through explicit services.
- Canvas viewports persist per folder in VS Code workspace storage, not in the
  workspace.
- Legacy focus and agent-harness files are removed automatically and disclosed;
  BaseHalf sections in root agent files are removed only after confirmation.
- Every read-modify-write path is protected by the keyed mutex.
- Corrupt YAML, missing files, permission errors, symlink hazards, and external
  edits have clear behavior and tests.
- BaseHalf services observe user files; they change user content only through
  explicit or confirmed operations.

### 7. Agent Area, Terminal, And Extension Agents

Goal: Replace VS Code's default terminal/agent surfaces with BaseHalf's
right-side Agent Area while keeping extension compatibility.

Done means:

- The five user choices are represented as first-class session types: TUI
  Codex, TUI Claude Code, VS Code extension Codex, VS Code extension Claude
  Code, and Terminal.
- VS Code terminal API calls from extensions can be hosted in Agent Area.
- Session lifecycle, naming, persistence, focus, split/restart/kill, and
  process errors are complete.
- Qualifying local Claude Code TUI sessions receive the BaseHalf launch
  instruction and relaunch once without it after an early non-zero exit; other
  session types receive none
  ([agent launch context](specs/agent-launch-context.md)).
- The existing Ghosty-inspired terminal interaction quality is preserved.
- Agent Area terminals identify as BaseHalf and turn the wheel into input with
  Ghostty's semantics, so full-screen TUI agents scroll smoothly
  ([Agent Area terminal](specs/agent-area-terminal.md)).
- Stock VS Code Agent/Chat/Copilot/Sessions UI does not leak into the product.

### 8. Extension Allowlist, Authentication, And Secrets

Goal: Enable the extension ecosystem deliberately, starting with Codex/Claude
agent extensions and GitHub auth.

Done means:

- BaseHalf has a curated product allowlist rather than exposing the full
  marketplace by default.
- Required VS Code APIs for selected extensions are present: commands,
  terminals, webviews, auth, secrets, storage, configuration, and file access.
- Blocked extensions fail with a clear product-level reason.
- GitHub/Microsoft auth and SecretStorage use VS Code-compatible flows and do
  not rely on BaseHalf-specific settings detours.
- GitHub auth credentials are product-owned, not copied from Microsoft's VS
  Code release secrets; development builds can inject the BaseHalf OAuth app
  through `BASEHALF_GITHUB_CLIENT_ID` / `BASEHALF_GITHUB_CLIENT_SECRET`.

### 9. Theming, Layout, And Interaction Fidelity

Goal: BaseHalf should feel like a coherent VS Code-based product, with VS Code
quality controls where reused and BaseHalf-specific UI where necessary.

Done means:

- Sidebar, SCM, QuickInput, buttons, menus, toolbars, focus rings, hover states,
  keyboard behavior, spacing, and typography align with VS Code source behavior
  unless intentionally BaseHalf-specific.
- BaseHalf canvas/card detail/Agent Area have stable responsive layout and no
  overlapping text or controls.
- Dark/light/high-contrast themes use VS Code theme tokens instead of hardcoded
  one-off palettes where possible.

### 10. Packaging, Dev Loop, And Regression Harness

Goal: Developers can run and verify the VS Code-base product reliably.

Done means:

- `vscode-base/` can run in development Electron mode.
- A repeatable smoke command verifies startup and key BaseHalf workbench routes.
- Failure artifacts are written for UI smoke failures.
- The branch has clear commands for compile, precommit, and BaseHalf smoke.
- Packaging/update strategy is defined before release work, not guessed from
  the old Electron shell.

Current status: `npm run basehalf:smoke` and
`npm run basehalf:smoke-no-compile` exist in `vscode-base/` and cover product
identity, canvas startup, hidden Open Editors, Source Control's VS Code Git
provider, Quick Open, Quick Text Search, and folder routing.

## Current Execution Order

1. Complete the module audit against D23 and VS Code source, with parallel
   agents for Files/Canvas, Git/SCM/GitHub, Agent Area/Terminal/Extensions, and
   Markdown/workspace metadata.
2. Fix any user-visible dead controls or disconnected command paths before
   adding new surface area.
3. Finish Git/SCM/GitHub next, because it is the module that most benefits from
   using VS Code directly and the one where hand-rolled behavior previously
   caused the most mismatch.
4. Finish Search/QuickInput and Files/Canvas activation as one routing family,
   because all accepted resources must enter the same BaseHalf navigation model.
5. Land D35–D37 in the slice order of
   [reference graph delivery](specs/reference-graph.md#delivery): workspace
   state, frontmatter safety, the reference store flip, the rename refactor,
   and agent guides with launch context. Finish Markdown projections with them
   as one document ownership family.
6. Finish Agent Area extension compatibility, starting with Codex and Claude
   extension paths.

## Historical Notes

The old Core-backed desktop app, CLI, and hand-rolled VS Code-like Git/SCM
refactor are historical reference material. The important source commit for the
old product/business logic is:

`feat(editor): code files first-class - Monaco code editor + canvas cards`

Use that commit to understand BaseHalf's original canvas/card/editor behavior.
Do not treat the later hand-rolled Git/SCM/GitHub refactor as architecture to
preserve; it was sunk cost replaced by the VS Code-base strategy.
