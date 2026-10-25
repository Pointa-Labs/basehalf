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

## Code organization

- BaseHalf's workbench code is under `src/vs/workbench/basehalf/`, in a folder
  per feature with VS Code's layer folders and its own tests. It is never
  spread into VS Code's `contrib/` or `services/` folders.
- The canvas is a core with features registered beside it, as VS Code's code
  editor and terminal are. New canvas behavior is a canvas feature in
  `canvasContrib/<feature>/`, not more code in the canvas view, and the core
  never imports a feature.
- VS Code's own files import only BaseHalf's `common/` modules, apart from the
  workbench entry files, and every change in a VS Code file is marked with a
  `// BaseHalf:` comment.

See [code organization](code-organization.md) and public decision D60.

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
- On the canvas, a focus ring is for the keyboard. The workbench rings every
  focused button, field, and element with a tab index, also after a click;
  on the canvas surface, its own buttons, and the toolbars, menus, and Video
  panel over its cards, and in BaseHalf's player and its trim bar, also in
  Card Detail, a control shows a ring only when the keyboard moved the focus
  there. A text field shows its focus by its caret, and a field with a border
  by its border alone. A menu that BaseHalf draws on the
  canvas starts at its checked item. Without one, it has no current item
  when a click opened it, until an arrow key chooses one, as the
  workbench's context menus do, and it starts at its first item when the
  keyboard opened it. Card Detail keeps the look of the editors it hosts.
- BaseHalf never shows the system's tooltip, the box that an HTML `title`
  draws (D65). A hover is drawn by the workbench's hover service, as VS
  Code's own buttons draw theirs, and only where it tells what is not in
  view: the name and the key of a button that shows only an icon, why a
  control is disabled or refuses what was typed, the whole of a message that
  is cut short, and what the panel of a generation card says of its model,
  its settings, and its inputs ([generation cards](../specs/generation-cards.md#the-panel)).
  A card, a name, a path, a row, a tab, and a button that shows its words
  show nothing more under the pointer. Where a
  specification speaks of a tooltip, it means this hover. An element gets
  it from the `data-basehalf-hover` attribute
  (`shell/browser/basehalfHover.ts`) or from the hover service directly.
- Card Detail fades in and out where it is, over the canvas area: no frame
  shows it empty, and no frame draws anything of it outside the canvas
  area. Once open it takes the keyboard, and Escape closes it wherever in it
  the keyboard is
  ([opening and closing Card Detail](../specs/card-detail-opening.md)).
- A card and Card Detail show the same files as an image, a PDF, a book, a
  sound, or a video, by one list
  (`platform/protocol/common/basehalfMediaFiles.ts`): images `.avif`,
  `.bmp`, `.gif`, `.ico`, `.jpeg`, `.jpg`, `.png`, `.svg`, and `.webp`;
  `.pdf`; books `.azw`, `.azw3`, `.cbz`, `.epub`, `.fb2`, `.fbz`, and
  `.mobi`; sounds `.flac`, `.m4a`, `.mp3`, `.oga`, `.ogg`, and `.wav`;
  videos `.m4v`, `.mkv`, `.mov`, `.mp4`, and `.webm`; without regard to
  case. The window loads each image, sound, and video of the list itself,
  from any folder, through its file protocol, as the worker that draws a
  PDF's cover loads the PDF, and a sound and a video play
  in BaseHalf's player, never in the system's controls
  ([generation cards](../specs/generation-cards.md#the-player)). A PDF and a
  book show their cover on their card and are read in a page of their own
  ([PDFs and books](../specs/documents-and-books.md)). A file that the
  system cannot decode says so where it would show.
- Use VS Code mechanics underneath without allowing the product to collapse
  back into stock VS Code navigation or layout.

See [roadmap.md](../roadmap.md), public decisions D20–D23, D39, D45, and D65
in [decisions.md](../decisions.md).

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
  Markdown file, or `.bh/mirror/<path>/upstream.yaml` for any other node, a
  draft included. A Markdown note with
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
- A BaseHalf operation that is carried out by moving files into storage that
  nothing shows, or back out of it, is told to the window as what it does:
  the delete of an item, its creation, or a write of a file, and a move
  within that storage is told to no one (`IFileService.move` with a report,
  marked `// BaseHalf:`). The kept versions of
  [exact undo](../specs/exact-undo.md#the-kept-versions) and the undo copy of
  a project made from a template are such storage. Files, open editors, the
  history of Back and Forward, and everything else that listens to file
  operations then need nothing of their own for it, as for a delete to the
  system's Trash, which VS Code tells as a delete.
- Every card has a saved place. A card gets it when it first appears on a
  canvas, and after that only the user changes it: no place is computed
  again at a later drawing, and BaseHalf never puts a card on another one by
  its own choice. Only the size of an image or a video card is computed
  again, as its picture's shape as large as the room at its place allows.
  Places are kept in the folder's layout and out of git, by
  an ignore file of BaseHalf's own inside `.bh/`. A row records whether
  BaseHalf chose its place. Only such a row gives way to the row that
  follows a moved item, and only such a row is removed when its item is gone
  ([canvas card placement](../specs/canvas-card-placement.md), D46, D66).
- BaseHalf changes an upstream value only through a reference operation that
  the user started or confirmed, or through the rename refactor of an agent
  move, as listed in
  [reference graph Invariant 4](../specs/reference-graph.md#invariants). Host
  lifecycle writes carry `upstream` through unchanged.
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
  and never written into a workspace (D43). Installing puts a link there to
  BaseHalf's own copy, which takes each release's text; after that BaseHalf
  changes nothing in the agents' folders unless the user asks (D83).

See public decisions D12–D14, D24, D35–D38, and D40–D43, the
[reference graph](../specs/reference-graph.md) and
[workspace state and legacy cleanup](../specs/workspace-state-and-legacy-cleanup.md)
specifications, and the relevant records under `private-docs/decisions/`.

## Built-in AI Video, executable media, and no plugins

The first two points are owned by
[built-in AI Video and no plugins](../specs/built-in-ai-video-and-no-plugins.md).

- AI Video is BaseHalf's own code, not an extension (D75). Its provider
  service runs in the shared process, which every window calls directly;
  requests to providers are Node's requests there with VS Code's proxy
  agent, one connection each and never sent again by themselves, never
  through the window. Video Sequence and the starter template are workbench
  code. It has no install, update, or removal of its own (D45).
- BaseHalf has no plugin platform (D76). No extension contributes to
  BaseHalf: do not add a contribution point, an extension API of BaseHalf, a
  catalog, a product configuration entry that names the registry or the
  publishing portal, or a message that sends the user to Plugins. VS Code's
  own extension system stays as VS Code has it, so that BaseHalf can build
  on it later; a change to it beyond the allowlist and the install policy is
  a decision of its own.
- The shell is fixed. The host owns the sidebar, canvas, navigation,
  reference semantics, node lifecycle, credentials, and Agent Area. Video
  Sequence adds a template, a file-specific Card Detail projection, and its
  commands through the host's registries, and the provider service answers
  the calls of generation cards. Sequence's project file transitions may not
  change any upstream value.
- The extension ecosystem is curated around Git, GitHub, GitHub
  Authentication, Codex, and Claude rather than a general marketplace.
- Workflow output is ordinary local user-owned data. Domain truth does not
  move into an extension-private database, and into `.bh/mirror/` only as
  card information: since D63 the prompt and settings of a generation card
  and the record of what made its file are card information there, while the
  generated image or video is an ordinary file in the user's folder.
- A generation card's file is the card: an ordinary image or video file in
  the card's folder, under the card's name. Its inputs are its connections,
  in the order of its `upstream` list; no role is stored beside them, and
  every input of a draft is sent. What a draft's generation uses is its
  `generation.yaml` and what made a file is its `made.yaml`, card information
  that follows the file. A draft is a card before its file exists; a card
  whose generated file is gone is a missing file, never a draft. A card with
  its file never changes, keeps the inputs that made it, and never generates
  again: New Version makes a new draft from what made it (D67). A generation is recorded on this
  computer only, under `.bh/cache/`, and followed by one window; it never
  sends a request again by itself and continues after a restart
  ([generation cards](../specs/generation-cards.md)).

See public decisions D26–D28, D33, D45, D58, D63, D64, D67, D75, and D76.
D25 and D29 to D34 describe the plugin platform that D76 removed.

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
