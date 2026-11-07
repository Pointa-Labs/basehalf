# Code organization

This harness document defines where BaseHalf's own source code goes in
`vscode-base/`, which of its parts may import which, and how BaseHalf changes
VS Code's own files. It follows how VS Code organizes its workbench: a folder
per feature under `workbench/contrib/`, each with its layer folders and its
own tests, code that every feature uses kept below the features as VS Code
keeps `base/` and `platform/` below `workbench/`, and a code editor and a
terminal whose features register themselves with a core instead of growing
it. Public decisions D60 and D124 in [decisions.md](../decisions.md) record
why.

## One root, a folder per feature

BaseHalf's workbench code is under `src/vs/workbench/basehalf/`, in one folder
per feature:

| Folder | What it holds | Owning documents |
| --- | --- | --- |
| `workspace/` | The workspace as every feature reads it: what an item is by its path (a note or media, the name BaseHalf shows for it, the icon of its kind, and whether BaseHalf shows it), the `.bh/` folder and the parts of its mirror files (their tree, YAML, recovery, commits, and ignore rules), the marker that keeps BaseHalf from setting up a folder, failure reasons in plain words, and the coordinator of workspace mutations. It imports no other folder of BaseHalf's | [Mirror file resilience](../specs/mirror-file-resilience.md), [workspace state](../specs/workspace-state-and-legacy-cleanup.md), [spec-driven development](../specs/spec-driven-development.md) for the marker |
| `ui/` | What several surfaces draw alike: the hover, the glyph of an item, and the sideways scrollbar | [Architecture invariants](architecture-invariants.md#product-shell), [workbench appearance](../specs/workbench-appearance.md) |
| `playback/` | How videos and sounds play anywhere in BaseHalf: the player, its sound, one medium playing at a time, what a media element shows and when it is released, and the media in notes | [Generation cards](../specs/generation-cards.md#the-player), [note rendering](../specs/note-rendering.md) |
| `shell/` | The product profile with the extension allowlist and install policy, About, release notes, settings, and layout controls | [Layout controls](../specs/layout-controls.md), [workbench appearance](../specs/workbench-appearance.md) |
| `navigation/` | Folders opening as canvases and files as Card Detail, back and forward, and the flush before Card Detail is left | [Roadmap](../roadmap.md) tracks 2 and 4 |
| `upkeep/` | What keeps BaseHalf's records in step with the items as they change: the mirror cascade that moves and deletes an item's records with it, following items moved outside the window, the kept versions that undo a delete or a change in place, moving and deleting drafts, project file transitions, keeping the system's files out of git, and the cleanup of what earlier releases wrote | [Mirror file resilience](../specs/mirror-file-resilience.md), [following moved items](../specs/following-moved-items.md), [exact undo](../specs/exact-undo.md), [workspace state](../specs/workspace-state-and-legacy-cleanup.md) |
| `markdown/` | The Markdown document under the rich, source, and preview projections, how each format of a note is written and read back, the links of a note, and the reading aids of `adhd.yaml` | [Note rendering](../specs/note-rendering.md), [formats of a note](../specs/note-formats.md), roadmap track 5 |
| `references/` | The reference graph: its stores and index, reference edits, the rename refactor, migration, and the badge editor | [Reference graph](../specs/reference-graph.md) |
| `canvas/` | The canvas: its model and layout file, its view, scene, gestures, placement, and arrangement | The canvas specifications in the [harness routes](README.md#task-routes) |
| `canvasContrib/` | The features of the canvas, a folder each, such as `zoom/`, `snap/`, `tidy/`, and `generationPanel/` | [The canvas: a core and its features](#the-canvas-a-core-and-its-features) |
| `cardDetail/` | Card Detail and its projections | Roadmap tracks 2 and 5, [formats of a note](../specs/note-formats.md) |
| `documents/` | PDFs and books: which files they are, their covers and the cache that keeps them, the readers of covers, and the book reader's page | [PDFs and books](../specs/documents-and-books.md) |
| `changes/` | What git says about a file as BaseHalf's surfaces read it, the Changes view of Card Detail with a picture's two versions, and what the rows of Source Control open | [The changes of a file](../specs/changes-of-a-file.md) |
| `agentArea/` | The Agent Area, its terminal, the agent skill, the selection agents can see, and the registry of the capabilities agents read | [Agent Area terminal](../specs/agent-area-terminal.md), [agent skill](../specs/agent-skill.md), [selection for agents](../specs/selection-for-agents.md) |
| `generation/` | Generation cards of images, videos, and sounds: their drafts and generation information, the task records, the model catalog as the window receives it, the providers' settings, and the Providers page | [Generation cards](../specs/generation-cards.md), [providers and the model catalog](../specs/providers.md) |
| `sequence/` | Video Sequence: the Sequence document, its view in Card Detail, its commands and its capability for agents, and the starter template | [Video Sequence](../specs/video-sequence.md) |
| `clipboard/` | Copy, paste, and drop: the transfer that a copy, a cut, and a drag hand over, BaseHalf's clipboard that writes the files, their paths, and its record in one write and reads a paste as one transfer, the reading of a drop, and the files a picture or text becomes | [Copy, paste, and drop](../specs/copy-paste-and-drop.md) |
| `mediaEdit/` | Editing a video, an image, or a sound in Card Detail: its editors, the edit record and the kept original, reading and writing the media files, copying a trimmed video's frames and encoding the rest with the window's encoders, and the service that applies each change, writes the file after it, and keeps the steps of its undo | [Editing media](../specs/media-editing.md) |

Inside a feature folder, files are in VS Code's layer folders: `common/`,
`browser/`, and `electron-browser/`. Tests are in `test/<layer>/` of the same
feature, stylesheets and images in a `media/` folder beside the code that uses
them. File names keep their `basehalf` prefix, so a name in a document or in
history still finds its file.

- A new file goes into the folder of the feature whose specification it
  implements. A feature with a specification of its own that fits none of
  these folders gets a new folder, a row in this table, and a place in the
  order of each layer ([below](#the-order-of-the-folders)).
- What several features read and none of them owns goes below them all: what
  a workspace and its items are into `workspace/`, a part that several
  surfaces draw into `ui/`, and what plays a video or a sound into
  `playback/`. A feature does not keep such a part for the others to import.
- BaseHalf's code is never put into VS Code's own `contrib/` or `services/`
  folders. One root of its own lets a VS Code update tell BaseHalf's code
  from VS Code's.
- Code that runs outside the window, or that extends one VS Code service in
  place, sits beside that service, named with a `basehalf` prefix: the app
  update under `platform/update/`, the command bridge of the pty host under
  `platform/terminal/`, and the gallery policy under
  `platform/extensionManagement/`. BaseHalf has no extension host API of its
  own (D76).
- A service of BaseHalf's own that runs outside the window has a platform
  folder of its own, named with a `basehalf` prefix and split into VS Code's
  layers as its services are: the provider service of generation cards is
  `platform/basehalfProviders/`, with its interface and the definitions it
  shares with the window in `common/`, the provider modules in `node/`, the
  service that the shared process runs in `electron-utility/`, and the
  window's connection to it in `electron-browser/` (D75). The setting of
  file times, which the undo of a change in place needs and a window cannot
  do, is `platform/basehalfFiles/` (D82). The write of the clipboard in
  several forms at once, which a window cannot make, is
  `platform/basehalfClipboard/` (D104).

## The order of the folders

VS Code's layers say what a module may run on: `common/` holds the models,
which run anywhere and touch no element of a page, `browser/` the views of a
window, and `electron-browser/` what needs the desktop. Within each layer,
BaseHalf's folders are in an order, from the bottom:

| Layer | The order of its folders |
| --- | --- |
| `common/` | `workspace`, `ui`, `playback`, `cardDetail`, `navigation`, `mediaEdit`, `markdown`, `agentArea`, `generation`, `references`, `documents`, `canvas`, `canvasContrib/*`, `changes`, `clipboard`, `sequence`, `shell`, `upkeep` |
| `browser/` and `electron-browser/` | `workspace`, `ui`, `playback`, `navigation`, `clipboard`, `documents`, `markdown`, `mediaEdit`, `cardDetail`, `changes`, `references`, `upkeep`, `generation`, `canvas`, `canvasContrib/*`, `sequence`, `agentArea`, `shell` |

- In its own layer, a module of a folder imports only folders that come
  before its folder in that layer's order.
- It may import the lower layers of any folder: a view may use any model,
  as in VS Code, where `browser/` imports `common/`. Within one folder,
  VS Code's layer rules alone apply.
- `canvasContrib/*` is every feature of the canvas. A feature of the canvas
  imports no other feature of the canvas; what two of them share belongs to
  the canvas core.
- The models and the views have orders of their own, because a feature's
  model can be read far below where its view stands. Card Detail's model,
  the projections a file has, is read by navigation, while its view hosts the
  editors of notes, media, PDFs, and changes. `upkeep/` stands at the top of
  the models because it moves the records of every feature, and its views at
  the middle of the views because the canvas undoes through its kept
  versions.
- So no cycle of imports passes through two of BaseHalf's folders: a cycle
  stays in one layer, since no layer imports a higher one, and within a layer
  the order allows none.
- Tests are not bound by the order: a test composes the services of several
  folders, and nothing imports a test.
- When a module needs a folder that comes after its own, the shared part
  moves down: into the folder below both, often `workspace/`, `ui/`, or
  `playback/`, or behind a service interface in a `common/` module that the
  lower folder may import, with the implementation registered above. A
  folder moves in an order only when that makes no cycle.
- Lint reports a module that breaks the order as an error
  (`local/code-basehalf-folder-order` in `vscode-base/eslint.config.js`,
  whose orders are the ones above), and a folder that is in no order.

## Stylesheets

- A stylesheet styles what one module draws and is imported by that module,
  as VS Code's widgets import theirs. It sits in the `media/` folder beside the
  module and is named after what it styles. A module that draws inside what
  another one draws, such as the Video toolbar that has the look of a Note's
  toolbar, imports that stylesheet too.
- A rule goes into the stylesheet of the module that makes the element it
  styles, the subject of its selector.
- Stylesheets do not depend on the order they load in. Modules load in an
  order that nothing fixes, so a rule that must win over a rule of another
  stylesheet wins by its specificity, never by coming later. A rule that
  overrides one of the same stylesheet may rely on coming after it. Before a
  rule moves to another stylesheet, check that no rule it would move past can
  style the same element with the same property at the same specificity.

## What may import what

- VS Code's layer rules apply in every feature folder: `common/` imports only
  `common/`, `browser/` imports `common/` and `browser/`, and
  `electron-browser/` imports all three. Lint reports a violation
  (`code-import-patterns` and `code-layering` in `vscode-base/eslint.config.js`),
  and `npm run valid-layers-check` checks the types each layer uses.
- Between BaseHalf's folders, the [order of the folders](#the-order-of-the-folders)
  applies. Prefer another feature's services and types in its `common/`
  folder over its views.
- Only `canvas/` imports the types of React, React DOM, and React Flow, in its
  `browser/` layer: its scene loads them when it mounts
  (`canvas/browser/scene/README.md`). Lint allows it there and nowhere else.
- There are no import cycles. `npm run check-cyclic-dependencies` checks the
  transpiled output in about two seconds.
- A `common/` or `browser/` module that a webview bundle under
  `extensions/basehalf/*-src/` imports may import only its siblings, the
  vendored leaf modules (`marked`, `yaml`), and modules that import nothing,
  such as `platform/protocol/common/basehalfMediaFiles.ts`; nothing else
  from `vs/base` or `vs/platform`: the bundle's type check follows every
  import without VS Code's global types. Check it with
  `npx tsgo --project extensions/basehalf/<bundle>-src/tsconfig.json --noEmit`.

## The canvas: a core and its features

The canvas follows VS Code's code editor and terminal. Each keeps a core that
hosts the view, and each feature registers itself beside the core
(`registerEditorContribution`, `registerTerminalContribution`) and lives in a
folder of its own (`workbench/contrib/terminalContrib/<feature>/`).

- `canvas/` is the core: the model and its layout file, the view and its
  lifecycle, rendering, and the services that features use.
- A canvas feature, such as the zoom controls, the badge editor, note editing
  on a card, the panel of a generation card, selection and arrangement,
  connections, or tidying, is a class registered with
  `registerBaseHalfCanvasContribution` in its own folder
  `canvasContrib/<feature>/`, with its own layer folders, tests, and
  stylesheets. The canvas view creates each registered feature once,
  through dependency injection, and hands it `IBaseHalfCanvasView`
  (`canvas/browser/basehalfCanvasExtensions.ts`): what a feature may read and
  do of the canvas. A feature uses nothing else of the view. When a feature
  needs more, the interface grows by what it needs.
- A canvas feature may import `canvas/` and the folders before it in its
  layer, and no other canvas feature. `canvas/` never imports a canvas
  feature; lint enforces this the way it does for VS Code's terminal, whose
  features are one folder deeper than the core. One file,
  `canvas/basehalfCanvas.all.ts`, loads the core and then every feature, as
  VS Code's `terminal.all.ts` does; the order of its imports is the order of
  the features' view controls.
- New behavior on the canvas is a canvas feature, not more code in the canvas
  view.
- The canvas view itself is a set of parts, one concern per file, as VS Code's
  code editor widget delegates to its view, model, and controllers. The view,
  `canvas/browser/basehalfCanvasWorkbench.contribution.ts`, builds the
  elements, owns the scene and the state its parts share, and creates the
  parts as its first fields. Each part is a class in `canvas/browser/view/`
  (its README lists them) that keeps its own state and reaches the shared
  state and the other parts through `view`. A file of the canvas stays small
  enough to be read whole; a part that grows past about 1,500 lines is split
  by concern.
- The scene that the view draws with React Flow is split the same way. The
  scene object, `canvas/browser/basehalfCanvasReactScene.ts`, loads React and
  mounts the scene. Each component is made by a factory in
  `canvas/browser/scene/` (its README lists them) from the scene's
  environment, and the root component does its work in hooks of one concern
  each, which it calls in a fixed order.

## Changes to VS Code's own files

- Use VS Code's own extension points before changing one of its files:
  services and their registration, registries, menus and context keys, the
  editor resolver, and contribution points.
- VS Code's files import only BaseHalf's `common/` modules, apart from the
  workbench entry files that load BaseHalf's contributions. Lint reports each
  such import: it is a place where BaseHalf hooks into VS Code.
- Mark each change in a VS Code file with a `// BaseHalf:` comment that says
  why, so that a VS Code update can find it.
- Record each VS Code file ported from a newer release in
  `vscode-base/BASEHALF_UPSTREAM.md`.

## Status

- 2026-10-20: the folders by feature are in place.
- 2026-10-20: canvas features register with the canvas. The zoom controls,
  the snap toggle, Tidy Canvas, and the panel under a Video card are
  features (`canvasContrib/zoom/`, `snap/`, `tidy/`, and `videoPanel/`, now
  `generationPanel/`). Through `IBaseHalfCanvasView` a feature reads the
  scene that was drawn, its items and what their cards show, and the
  selection; moves cards and puts them back as steps of undo; reads and sets
  the viewport; shows a panel under a card; lets the user pick a card; and
  hears the canvas's keys.
- 2026-10-21: the canvas view, which was one class of about 10,200 lines,
  is the view (about 1,000 lines) and ten parts of 600 to 1,300 lines in
  `canvas/browser/view/`.
- 2026-10-21: the React scene, which was one file of about 5,100 lines with
  a root component of about 2,000, is the scene object (about 300 lines) and
  19 files of 60 to 580 lines in `canvas/browser/scene/`: a factory for each
  component, and the root component's work in nine hooks.
- 2026-10-21: the canvas stylesheet, which was one file of 3,442 lines with
  no order between its concerns, is 19 stylesheets, each imported by the
  module that draws what it styles: the view and its parts in
  `canvas/browser/media/`, the scene's files in `canvas/browser/scene/media/`,
  Card Detail's projections in `cardDetail/browser/media/`, and the item glyph
  and the sideways scrollbar in `ui/browser/media/`. None depends on the
  order they load in.
- 2026-11-08: the folders are in an order in each layer (D124). Before, all
  20 folders were one cycle of imports; by layer, the models of 9 folders
  were one cycle and the views of 5 another. What every feature reads of an
  item, which had been in the canvas's model, in Card Detail, in the Agent
  Area, and in the information of generation cards, is in `workspace/`; the
  player, which had been in `canvas/` though Card Detail, Changes, media
  editing, and generation cards play with it, is `playback/`; the hover, the
  item glyph, and the sideways scrollbar went from `shell/` to `ui/`; and
  what moves the records of every feature went from `workspace/` to
  `upkeep/`. `video/` is `generation/`, as it holds images and sounds too.
- Next: parts that are features of their own move on into `canvasContrib/`,
  in the order of how often their code changed: the generation cards and
  their actions, connections, creating cards, the badge editor, Card Detail,
  and note editing.
- On 2026-10-20, 75 of VS Code's files carried BaseHalf changes, most of them
  unmarked. They are marked, or replaced by an extension point, when their
  subsystem is next ported from a newer VS Code, not in a pass of their own.
