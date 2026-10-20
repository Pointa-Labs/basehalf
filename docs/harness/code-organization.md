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
| `shell/` | The product profile, About, release notes, settings, layout controls, and the item glyphs and sideways scrollbar that several surfaces draw | [Layout controls](../specs/layout-controls.md), [workbench appearance](../specs/workbench-appearance.md) |
| `navigation/` | Folders opening as canvases and files as Card Detail, back and forward, and the flush before Card Detail is left | [Roadmap](../roadmap.md) tracks 2 and 4 |
| `workspace/` | What BaseHalf keeps in `.bh/`: reading, writing, and recovering mirror files, the mirror cascade, following moved items, legacy cleanup, and workspace mutations | [Mirror file resilience](../specs/mirror-file-resilience.md), [following moved items](../specs/following-moved-items.md), [workspace state](../specs/workspace-state-and-legacy-cleanup.md) |
| `markdown/` | The Markdown document under the rich, source, and preview projections, and the reading aids of `adhd.yaml` | [Note rendering](../specs/note-rendering.md), roadmap track 5 |
| `references/` | The reference graph: its stores and index, reference edits, the rename refactor, migration, and the badge editor | [Reference graph](../specs/reference-graph.md) |
| `canvas/` | The canvas: its model and layout file, its view, scene, gestures, placement, and arrangement | The canvas specifications in the [harness routes](README.md#task-routes) |
| `canvasContrib/` | The features of the canvas, a folder each, such as `zoom/`, `snap/`, and `tidy/` | [The canvas: a core and its features](#the-canvas-a-core-and-its-features) |
| `cardDetail/` | Card Detail and its projections | Roadmap tracks 2 and 5 |
| `agentArea/` | The Agent Area, its terminal, the agent skill, and the selection agents can see | [Agent Area terminal](../specs/agent-area-terminal.md), [agent skill](../specs/agent-skill.md), [selection for agents](../specs/selection-for-agents.md) |
| `video/` | The Video node, its `.bhnode` file, and the video providers | [Video node](../specs/video-node.md), [video providers](../specs/video-providers.md) |
| `plugins/` | The frozen plugin platform, the extension points that AI Video uses, and the extension allowlist | [Built-in AI Video and the frozen plugin platform](../specs/built-in-ai-video-and-plugin-freeze.md) |

Inside a feature folder, files are in VS Code's layer folders: `common/`,
`browser/`, and `electron-browser/`. Tests are in `test/<layer>/` of the same
feature, stylesheets and images in `browser/media/`. File names keep their
`basehalf` prefix, so a name in a document or in history still finds its
file.

- A new file goes into the folder of the feature whose specification it
  implements. A feature with a specification of its own that fits none of
  these folders gets a new folder and a row in this table.
- BaseHalf's code is never put into VS Code's own `contrib/` or `services/`
  folders. One root of its own lets a VS Code update tell BaseHalf's code
  from VS Code's.
- Code that runs outside the window, or that extends one VS Code service in
  place, sits beside that service, named with a `basehalf` prefix: the app
  update under `platform/update/`, the command bridge of the pty host under
  `platform/terminal/`, the gallery policy under `platform/extensionManagement/`,
  and the two halves of the extension host API, `mainThreadBaseHalf.ts` and
  `extHostBaseHalf.ts`, under `workbench/api/`.

## What may import what

- VS Code's layer rules apply in every feature folder: `common/` imports only
  `common/`, `browser/` imports `common/` and `browser/`, and
  `electron-browser/` imports all three. Lint reports a violation
  (`code-import-patterns` and `code-layering` in `vscode-base/eslint.config.js`),
  and `npm run valid-layers-check` checks the types each layer uses.
- A feature folder may import another one. Prefer the other feature's services
  and types in its `common/` folder over its views.
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
  on a card, the Video panel, selection and arrangement, connections, or
  tidying, is a class registered with `registerBaseHalfCanvasContribution` in
  its own folder `canvasContrib/<feature>/`, with its own layer folders, tests,
  and stylesheets. The canvas view creates each registered feature once,
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
  the snap toggle, and Tidy Canvas are features (`canvasContrib/zoom/`,
  `snap/`, and `tidy/`). Through `IBaseHalfCanvasView` a feature reads the
  scene that was drawn, moves cards and puts them back as steps of undo,
  reads and sets the viewport, and hears the canvas's keys.
- Next: the rest of the canvas view, `canvas/browser/basehalfCanvasWorkbench.contribution.ts`
  (about 10,450 lines in one class), and the React scene,
  `canvas/browser/basehalfCanvasReactScene.ts` (about 5,100 lines), are split
  into the canvas core and canvas features, one feature per commit, each with
  unit tests.
- On 2026-10-20, 75 of VS Code's files carried BaseHalf changes, most of them
  unmarked. They are marked, or replaced by an extension point, when their
  subsystem is next ported from a newer VS Code, not in a pass of their own.
