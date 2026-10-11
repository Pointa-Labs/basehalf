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
- The left product surface is Files, Git, and Search. There is no plugin
  surface: no Plugins library, no plugin manager command, no stock Extensions
  Marketplace, and no plugin-defined global sidebar (D45).
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

See [roadmap.md](../roadmap.md), public decisions D20–D23, D39, and D45 in
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
  `.bh/mirror/<path>/upstream.yaml` for any other node. A Markdown note with
  no `upstream` key that cannot take one, or that already has a list in its
  `upstream.yaml`, uses that file as its store (D42). The reverse direction
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
- Every card has a saved place. A card gets it when it first appears on a
  canvas, and after that only the user changes it: no place is computed
  again at a later drawing, and BaseHalf never puts a card on another one by
  its own choice. Places are kept in the folder's layout and out of git, by
  an ignore file of BaseHalf's own inside `.bh/`. A row records whether
  BaseHalf chose its place. Only such a row gives way to the row that
  follows a moved item, and only such a row is removed when its item is gone
  ([canvas card placement](../specs/canvas-card-placement.md), D46).
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
  Agents use their own file tools, also to move and rename files. BaseHalf
  recognizes a moved item by its content and moves what it keeps for it; no
  agent calls BaseHalf for that
  ([following moved items](../specs/following-moved-items.md), D44). What
  BaseHalf writes by itself is its own: the card information it moves along
  with an item, and the places of cards that appear. Opening a folder
  changes nothing that git shows, and nothing is written by itself in a
  marked folder.
- BaseHalf assumes users do not read code and never open `.bh/`. No message,
  button, or repair step sends them to a file's source or to a hidden file;
  repairs are actions in BaseHalf's own interface (D41). Messages give reasons
  in plain words: no file-format terms, no path under `.bh/`, and no raw file
  system error text, which goes to the log.
- BaseHalf writes no agent guides, no `.bh/agent-harness/`, no focus state,
  and no edits of the user's `.gitignore` into workspaces. Its one ignore
  file is `.bh/.gitignore`. Agent Area Claude Code sessions
  receive BaseHalf context at launch instead, as defined in
  [agent launch context](../specs/agent-launch-context.md).
- BaseHalf is the container that intelligence flows through, not an
  intelligence layer. Agents learn a workspace from the files and from the
  [agent skill](../specs/agent-skill.md), which BaseHalf offers and the user
  installs into the agents' own skill folders. It is never installed unasked
  and never written into a workspace (D43).

See public decisions D12–D14, D24, D35–D38, and D40–D43, the
[reference graph](../specs/reference-graph.md) and
[workspace state and legacy cleanup](../specs/workspace-state-and-legacy-cleanup.md)
specifications, and the relevant records under `private-docs/decisions/`.

## Built-in AI Video, executable media, and the frozen plugin platform

The first two points are owned by
[built-in AI Video and the frozen plugin platform](../specs/built-in-ai-video-and-plugin-freeze.md).

- AI Video is built in. It ships inside the application as a built-in
  extension, is admitted only as that copy, and has no install, update, or
  removal of its own (D45).
- The plugin platform is frozen. Do not register its interface, fetch its
  catalog, add a product configuration entry that names the registry or the
  publishing portal, or write a message that sends the user to Plugins. Its
  code, tooling, and documents are kept and must keep compiling and passing
  their tests. Changing or deleting them is a separate decision.
- The shell is fixed. The host owns the sidebar, canvas, navigation,
  reference semantics, node lifecycle, credentials, and Agent Area. AI Video
  adds recipes, a template, a file-specific Card Detail projection, structural
  cleanup, and executors through the host's contribution points. This
  boundary is internal, so both sides may change together. AI Video's project
  file transitions and structural cleanups may not change any upstream value.
- The initial extension ecosystem is curated around Git, GitHub,
  GitHub Authentication, Codex, and Claude rather than a general marketplace.
- Workflow output is ordinary local user-owned data. Domain truth does not
  move into `.bh/mirror/` or an extension-private database.
- Executable media follows Draft → immutable Attempt(s) → one sealed local-file
  Result. A Result never switches files or runs again; changed settings create a
  new Draft. AI Video contributes recipes, input roles, validation, and
  executors without duplicating canvas or lifecycle truth.

See public decisions D26–D28, D33, D34, and D45.
[plugin-architecture.md](../plugin-architecture.md) and
[plugin-development.md](../plugin-development.md) describe the frozen platform
(D25, D29–D32) and the contribution points that AI Video still uses.

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
