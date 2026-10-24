# Code organization

This harness document defines where BaseHalf's own source code goes in
`vscode-base/`, which of its parts may import which, and how BaseHalf changes
VS Code's own files. It follows how VS Code organizes its workbench: a folder
per feature under `workbench/contrib/`, each with its layer folders and its
own tests, and a code editor and a terminal whose features register
themselves with a core instead of growing it. Public decision D60 in
[decisions.md](../decisions.md) records why.

## One root, a folder per feature

BaseHalf's workbench code is under `src/vs/workbench/basehalf/`, in one folder
per feature:

| Folder | What it holds | Owning documents |
| --- | --- | --- |
| `shell/` | The product profile with the extension allowlist and install policy, About, release notes, settings, layout controls, and the item glyphs and sideways scrollbar that several surfaces draw | [Layout controls](../specs/layout-controls.md), [workbench appearance](../specs/workbench-appearance.md) |
| `navigation/` | Folders opening as canvases and files as Card Detail, back and forward, and the flush before Card Detail is left | [Roadmap](../roadmap.md) tracks 2 and 4 |
| `workspace/` | What BaseHalf keeps in `.bh/`: reading, writing, and recovering mirror files, the mirror cascade, following moved items, legacy cleanup, workspace mutations, and project file transitions | [Mirror file resilience](../specs/mirror-file-resilience.md), [following moved items](../specs/following-moved-items.md), [workspace state](../specs/workspace-state-and-legacy-cleanup.md) |
| `markdown/` | The Markdown document under the rich, source, and preview projections, and the reading aids of `adhd.yaml` | [Note rendering](../specs/note-rendering.md), roadmap track 5 |
| `references/` | The reference graph: its stores and index, reference edits, the rename refactor, migration, and the badge editor | [Reference graph](../specs/reference-graph.md) |
| `canvas/` | The canvas: its model and layout file, its view, scene, gestures, placement, and arrangement | The canvas specifications in the [harness routes](README.md#task-routes) |
| `canvasContrib/` | The features of the canvas, a folder each, such as `zoom/`, `snap/`, and `tidy/` | [The canvas: a core and its features](#the-canvas-a-core-and-its-features) |
| `cardDetail/` | Card Detail and its projections | Roadmap tracks 2 and 5 |
| `documents/` | PDFs and books: which files they are, their covers and the cache that keeps them, the readers of covers, and the book reader's page | [PDFs and books](../specs/documents-and-books.md) |
| `agentArea/` | The Agent Area, its terminal, the agent skill, the selection agents can see, and the registry of the capabilities agents read | [Agent Area terminal](../specs/agent-area-terminal.md), [agent skill](../specs/agent-skill.md), [selection for agents](../specs/selection-for-agents.md) |
| `video/` | Generation cards of images, videos, and sounds: their drafts and generation information, the task records, the model catalog as the window receives it, the providers' settings, and the Providers page | [Generation cards](../specs/generation-cards.md), [providers and the model catalog](../specs/providers.md) |
| `sequence/` | Video Sequence: the Sequence document, its view in Card Detail, its commands and its capability for agents, and the starter template | [Video Sequence](../specs/video-sequence.md) |

Inside a feature folder, files are in VS Code's layer folders: `common/`,
`browser/`, and `electron-browser/`. Tests are in `test/<layer>/` of the same
feature, stylesheets and images in a `media/` folder beside the code that uses
them. File names keep their `basehalf` prefix, so a name in a document or in
history still finds its file.

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

- A new file goes into the folder of the feature whose specification it
  implements. A feature with a specification of its own that fits none of
  these folders gets a new folder and a row in this table.
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
  window's connection to it in `electron-browser/` (D75).

## What may import what

- VS Code's layer rules apply in every feature folder: `common/` imports only
  `common/`, `browser/` imports `common/` and `browser/`, and
  `electron-browser/` imports all three. Lint reports a violation
  (`code-import-patterns` and `code-layering` in `vscode-base/eslint.config.js`),
  and `npm run valid-layers-check` checks the types each layer uses.
- A feature folder may import another one. Prefer the other feature's services
  and types in its `common/` folder over its views.
- Only `canvas/` imports the types of React, React DOM, and React Flow, in its
  `browser/` layer: its scene loads them when it mounts
  (`canvas/browser/scene/README.md`). Lint allows it there and nowhere else.
- There are no import cycles. `npm run check-cyclic-dependencies` checks the
  transpiled output in about two seconds.
- A `common/` module that a webview bundle under `extensions/basehalf/*-src/`
  imports may import only its siblings and the vendored leaf modules
  (`marked`, `yaml`), nothing from `vs/base`: the bundle's type check follows
  every import without VS Code's global types. Check it with
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
- A canvas feature may import `canvas/` and other feature folders. `canvas/`
  never imports a canvas feature; lint enforces this the way it does for
  VS Code's terminal, whose features are one folder deeper than the core.
  One file, `canvas/basehalfCanvas.all.ts`, loads the core and then every
  feature, as VS Code's `terminal.all.ts` does; the order of its imports is
  the order of the features' view controls.
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
  features (`canvasContrib/zoom/`, `snap/`, `tidy/`, and `videoPanel/`).
  Through `IBaseHalfCanvasView` a feature reads the scene that was drawn,
  its items and what their cards show, and the selection; moves cards and
  puts them back as steps of undo; reads and sets the viewport; shows a
  panel under a card; lets the user pick a card; and hears the canvas's keys.
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
  and the sideways scrollbar in `shell/browser/media/`. None depends on the
  order they load in.
- Next: parts that are features of their own move on into `canvasContrib/`,
  in the order of how often their code changed: the generation cards and
  their actions, connections, creating cards, the badge editor, Card Detail,
  and note editing.
- On 2026-10-20, 75 of VS Code's files carried BaseHalf changes, most of them
  unmarked. They are marked, or replaced by an extension point, when their
  subsystem is next ported from a newer VS Code, not in a pass of their own.
