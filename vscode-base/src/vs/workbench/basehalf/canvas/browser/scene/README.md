# The canvas scene

`../basehalfCanvasReactScene.ts` is the scene object that the canvas view
holds. It loads React and React Flow, which are bundled in
`extensions/basehalf/canvas-react-vendor-out`, mounts the scene in the view's
element, and passes the view's snapshots and commands on to it. What React
draws is made in this folder.

React is loaded when the scene mounts, not imported, so each part of the scene
is made by a factory from the scene's environment,
`IBaseHalfCanvasSceneEnvironment` in `basehalfCanvasSceneShared.ts`: React as it
was loaded (`vendor`, and `h` for `vendor.createElement`), the element the
scene is drawn in (`host`), the canvas view that answers for the scene
(`delegate`), and the contexts that the parts share. The mount makes the
environment, and the scene component's factory makes the other parts.

## Components

| Factory | File | What it draws |
| --- | --- | --- |
| `createBaseHalfCanvasSceneComponent` | `basehalfCanvasSceneComponent.ts` | The root: React Flow with the cards, connections, and the controls of the selection. It keeps the state its hooks share and calls them (below). |
| `createBaseHalfCanvasCardNode` | `basehalfCanvasCardNode.ts` | A card: the element the canvas view built for it, put into React Flow, with its resize corners and sides. |
| `createBaseHalfCanvasReferenceEdge` | `basehalfCanvasReferenceEdge.ts` | A connection, and reconnecting it by dragging either half of its line. |
| `createBaseHalfCanvasSelectionToolbar` | `basehalfCanvasSelectionToolbar.ts` | The toolbar over selected cards, and the box around a set. |
| `createBaseHalfCanvasNoteSelectionControls` | `basehalfCanvasNoteSelectionControls.ts` | The format toolbar and background colors of a selected Note. |
| `createBaseHalfCanvasVideoSelectionControls` | `basehalfCanvasVideoSelectionControls.ts` | The toolbar of a selected Video card, and the place beside it for the Video panel. |
| `createBaseHalfCanvasSceneOverlays` | `basehalfCanvasSceneOverlays.ts` | The circles that begin a connection, the line kept after one is let go on the canvas, the snap guides, and the bridge to React Flow's store. |

## What the scene component does

The scene component keeps the refs and the state that its work shares, and
does each part of its work in a hook. It calls them in this order:

| Hook | File | What it does |
| --- | --- | --- |
| `useBaseHalfCanvasSceneSelection` | `basehalfCanvasSceneSelection.ts` | Changes the selection, asking the canvas view first. |
| `useBaseHalfCanvasSceneCancellation` | `basehalfCanvasSceneCancellation.ts` | Ends what the user is doing when it is cancelled: Escape, a lost pointer, the window losing focus. |
| `useBaseHalfCanvasSceneSnapshot` | `basehalfCanvasSceneSnapshot.ts` | Takes a new snapshot from the canvas view and keeps what is still being saved. |
| `useBaseHalfCanvasSceneGeometry` | `basehalfCanvasSceneGeometry.ts` | Moves and resizes cards, snapped, and saves their final places and sizes. |
| `useBaseHalfCanvasScenePressGesture` | `basehalfCanvasScenePressGesture.ts` | The marquee and moving a set by its box; Shift-click on the box and Arrange. |
| `useBaseHalfCanvasSceneConnections` | `basehalfCanvasSceneConnections.ts` | Connects, reconnects, and removes connections, and keeps the line for Create from Connection. |
| `useBaseHalfCanvasSceneKeyboard` | `basehalfCanvasSceneKeyboard.ts` | The arrow keys, Command-D, and Delete. |
| `useBaseHalfCanvasSceneRuntime` | `basehalfCanvasSceneRuntime.ts` | What the canvas view may ask of the mounted scene, such as the viewport. |
| `useBaseHalfCanvasSceneMouse` | `basehalfCanvasSceneMouse.ts` | Clicks, double clicks, context menus, and the wheel. |

Each hook file also holds the rules of its concern that need no React, such
as `BaseHalfCanvasPendingConnectionState` and `baseHalfCanvasAutoPanStep`.

`basehalfCanvasSceneShared.ts` holds the environment, the types of React
Flow's nodes and edges, and small functions that several files use.
`basehalfCanvasSelectionControlsPlacement.ts` works out where the toolbars and
the Video panel go beside a selection. `basehalfCanvasSceneNodeDrag.ts` holds
the state of a drag of cards and puts cards back when it is cancelled.

## Rules

- New behavior on the canvas is a canvas feature in `../../../canvasContrib/`
  ([code organization](../../../../../../../../docs/harness/code-organization.md)).
  This folder is for what the scene itself draws and does.
- A component is made by its factory, once per mount. React keeps a
  component's state only while its function stays the same, so a component is
  never made during a render.
- A hook takes, by name, what it uses of the scene component (its `scene`
  parameter) and returns what the component's later code uses.
- The scene component calls its hooks in a fixed order, and React runs their
  effects in that order. Several effects add listeners for the same events on
  the same element, which then run in the order they were added, so a new hook
  or effect goes where its listeners must run.
- A rule that needs no React is a function of its own, exported and tested in
  `../../test/browser/basehalfCanvasReactScene.test.ts`.
- The scene was cut from one file without changing what it did; each hook is
  a run of statements of the scene component, in the order they had.
