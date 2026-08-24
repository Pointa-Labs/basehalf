# Repository-wide architecture invariants

These are the cross-cutting boundaries that implementation work must preserve.
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
- Use VS Code mechanics underneath without allowing the product to collapse
  back into stock VS Code navigation or layout.

See [roadmap.md](../roadmap.md) and public decisions D20–D23 in
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
  Markdown links navigate but do not create reference edges. Edges persist
  endpoints and anchors, not relationship prose.
- Automated BaseHalf services observe user files and never modify them
  unprompted. Only an explicit user action through BaseHalf may write user data;
  agents use their own file tools.

See public decisions D12–D14 and D24 and the relevant records under
`private-docs/decisions/`.

## Plugin and executable-media boundary

- The shell is fixed and the center is extensible. Curated plugins may add
  project types, main-canvas recipes and templates, card previews, and
  file-specific Card Detail projections. They may not replace BaseHalf's
  sidebar, canvas, navigation, reference semantics, or Agent Area.
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
