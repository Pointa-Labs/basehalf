# Repository-wide architecture invariants

This harness document defines the cross-cutting boundaries that implementation
work must preserve.
They summarize current direction for development; the linked specifications and
decision records own the full behavior and rationale.

## Migration boundary

The migration baseline is commit
`41639435d6510d3d87a195f5498e88cd8ea80600` (`feat(editor): code files
first-class — Monaco code editor + canvas cards`). That commit and earlier
history preserve BaseHalf's original product semantics. Later hand-built
VS Code-like infrastructure is not a reason to retain duplicate machinery.

The active desktop product is developed in `vscode-base/` on a real VS Code
substrate. Prefer its workbench, platform, provider, extension-host, file,
working-copy, SCM, GitHub auth, QuickInput, terminal, menu, keybinding,
notification, progress, and dialog infrastructure. Port BaseHalf's product
layer onto those services.

`@basehalf/core` and the old `packages/` desktop implementation are historical
migration material, not the center for new desktop orchestration. Do not restore
the deleted event-log architecture, decisions module, or old CLI-first product
path. Their history remains available for archaeology.

## Product shell

- BaseHalf is canvas-first. Folders open canvases; files open full-screen Card
  Detail inside the canvas flow. VS Code editor tabs/groups are advanced or
  fallback behavior, not the default interaction.
- The left product surface is Files, Git, Search, and the BaseHalf-owned Plugins
  library. Keep the stock Extensions Marketplace and plugin-defined competing
  global sidebars out of the product.
- The right product surface is Agent Area. It hosts TUI Codex, TUI Claude Code,
  VS Code extension Codex, VS Code extension Claude Code, and Terminal sessions.
  Route extension-created terminals there; do not expose stock VS Code
  Agent/Chat/Copilot/Sessions or terminal-panel UI as competing product areas.
- Agent Area terminals present themselves to the programs in them as
  BaseHalf's terminal: `TERM_PROGRAM=BaseHalf`, a BaseHalf XTVERSION reply,
  and Ghostty wheel semantics. Do not reintroduce the `vscode` identity or
  xterm.js's one-report-per-event wheel input
  ([Agent Area terminal](../specs/agent-area-terminal.md), D39).
- Context menus are drawn in the window by default (`window.menuStyle:
  custom`), as VS Code's Agents window does, on every platform. They follow
  the product theme, and canvas state shown while a menu is open, such as the
  Create from Connection line, closes in the same frame as the menu. Users can
  switch back to native menus in settings; a native menu is closed by the OS
  before the window is told, so such state then lags behind it.
- Use VS Code mechanics underneath without allowing the product to collapse
  back into stock VS Code navigation or layout.

See [roadmap.md](../roadmap.md), public decisions D20–D23 and D39 in
[decisions.md](../decisions.md).

## Content and graph truth

- Markdown files and their VS Code `TextDocument` / working copy are content
  truth. Rich, source, and preview are projections over the same document, not
  separate files or default editor tabs.
- The rich projection keeps BlockNote-style editing, a per-file in-memory YJS
  live document, and byte-preserving splice-save so unchanged Markdown stays
  verbatim on disk.
- An explicit reference `A → B` means A's context flows into B. The graph is
  directed, many-to-many, cyclic when useful, and never self-referential.
  Markdown links navigate but do not create reference edges. Edges carry no
  relationship prose.
- `A → B` is stored once, in B's store: the `upstream` frontmatter key of a
  Markdown file, the `upstream` field of a `.bhnode`, or
  `.bh/mirror/<path>/upstream.yaml` for any other node. The reverse direction
  is derived in memory and never stored. `canvas.yaml` edge rows are anchor
  memory only; they never create, block, or imply a reference.
- Dangling and invalid upstream entries are shown as issues and never removed
  automatically. Only an explicit user action repairs or removes them.
- `.bh/mirror/` content that BaseHalf cannot read never blocks a card move or
  a file operation and is never destroyed. Mirror files are read by schema
  through `basehalfMirrorYaml.ts`, every write is read back before it is
  committed, unreadable canvas layout is skipped and preserved as a recovery
  copy, and the mirror cascade always offers Skip
  ([mirror file resilience](../specs/mirror-file-resilience.md), D40).
- BaseHalf changes an upstream value only through a reference operation that
  the user started or confirmed, or through the rename refactor of an agent
  move, as listed in
  [reference graph Invariant 4](../specs/reference-graph.md#invariants). Host
  lifecycle writes carry `upstream` through unchanged, and reviewed plugins may
  not change it.
- Automated BaseHalf services observe user files and never modify them
  unprompted. BaseHalf writes user files only on an explicit user action,
  including the reference operations of reference graph Invariant 4, or after
  the user confirms, as in the removal of earlier BaseHalf sections from root
  agent files in
  [workspace state and legacy cleanup](../specs/workspace-state-and-legacy-cleanup.md#confirmed-user-owned-root-files).
  Agents use their own file tools. Agent Area Claude Code sessions that
  receive the launch context move and rename files through the host
  [agent move](../specs/reference-graph.md#agent-moves) operation; other
  agents' moves still leave BaseHalf metadata behind.
- BaseHalf assumes users do not read code and never open `.bh/`. No message,
  button, or repair step sends them to a file's source or to a hidden file;
  repairs are actions in BaseHalf's own interface (D41). Messages give reasons
  in plain words: no file-format terms, no path under `.bh/`, and no raw file
  system error text, which goes to the log.
- BaseHalf writes no agent guides, no `.bh/agent-harness/`, no focus state,
  and no `.gitignore` edits into workspaces. Agent Area Claude Code sessions
  receive BaseHalf context at launch instead, as defined in
  [agent launch context](../specs/agent-launch-context.md).

See public decisions D12–D14, D24, D35–D38, D40, and D41, the
[reference graph](../specs/reference-graph.md) and
[workspace state and legacy cleanup](../specs/workspace-state-and-legacy-cleanup.md)
specifications, and the relevant records under `private-docs/decisions/`.

## Plugin and executable-media boundary

- The shell is fixed and the center is extensible. Curated plugins may add
  project types, main-canvas recipes and templates, card previews, and
  file-specific Card Detail projections. They may not replace BaseHalf's
  sidebar, canvas, navigation, reference semantics, or Agent Area. Their
  project file transitions and structural cleanups may not change any upstream
  value.
- The initial extension ecosystem is curated around Git, GitHub,
  GitHub Authentication, Codex, and Claude rather than a general marketplace.
- Plugin workflow output is ordinary local user-owned data. Plugin removal must
  leave output readable; domain truth does not move into `.bh/mirror/` or an
  extension-private database.
- Executable media follows Draft → immutable Attempt(s) → one sealed local-file
  Result. A Result never switches files or runs again; changed settings create a
  new Draft. Domain plugins contribute reviewed recipes, input roles,
  validation, and executors without duplicating canvas or lifecycle truth.

See [plugin-architecture.md](../plugin-architecture.md),
[plugin-development.md](../plugin-development.md), and public decisions D25–D34.

## Completion standard

Work lands as coherent, product-quality modules rather than an MVP shell. A
completed scope includes the expected normal, empty, loading, error, permission,
conflict, cancellation, and recovery states that apply; working interactions;
tests or explicit verification; and a clear keep/delete boundary against old
BaseHalf code.

Do not land user-visible dead controls, fake data, disconnected handlers,
TODO-only seams, accidental fallback into VS Code tabs, or detached UI that only
reserves space for later work. Large work may be split only into coherent named
submodules whose landed behavior is usable.

See public decision D23 and the quality bar in [roadmap.md](../roadmap.md).
