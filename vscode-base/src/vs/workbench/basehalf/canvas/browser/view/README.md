# The canvas view

`../basehalfCanvasWorkbench.contribution.ts` is the canvas view: one object per
window that draws the canvas of the folder that is shown and hosts Card
Detail. It builds the elements, owns the scene and the state its parts share,
and creates the parts below as its first fields. Its constructor wires the
scene's gestures, the services' events, and the canvas features.

Each part is one concern in one file. A part keeps its own state and reaches
the shared state and the other parts through `view`:
`this.view.renderedItemsByPath`, `this.view.badgeEditor.flushBadgeDescriptionWrite(...)`.

| `view.` | File | What it does |
| --- | --- | --- |
| `renderer` | `basehalfCanvasRenderer.ts` | Draws the canvas of the folder that is shown: reads the folder, its generation cards from the card store (its drafts among its items), and its layout, builds the scene, keeps cards that did not change, and holds a drawing while a gesture or a move is going on. |
| `previews` | `basehalfCanvasPreviews.ts` | What each card shows of its item: reads previews, hydrates them in batches after a drawing, and sizes the cards of new files. |
| `cardRenderer` | `basehalfCanvasCardRenderer.ts` | Builds the element of each card: its caption and glyph, and the body for a note, a file, media, a folder, or a generation card, and runs the actions of a generation card's toolbar. |
| `badgeEditor` | `basehalfCanvasBadgeEditor.ts` | The badge editor of a card and of Card Detail: its face, its upstream and downstream, and the description that is saved as the user types, with drafts and recovery when a save fails. |
| `noteEditing` | `basehalfCanvasNoteEditing.ts` | Editing a note on its card: opening and closing the card editor, its format commands and the navigation they hold back, and focusing a note the user just created. |
| `connections` | `basehalfCanvasConnections.ts` | Connections on the canvas: reading them from the reference graph, connecting, reconnecting, and disconnecting cards as reference operations with undo, the anchors kept in the layout, and Create from Connection. |
| `geometry` | `basehalfCanvasGeometry.ts` | Places, sizes, and the view: saving moved and resized cards as steps of undo, putting cards back, zoom, fitting, and the viewport each folder keeps. |
| `selectionActions` | `basehalfCanvasSelectionActions.ts` | What the user does with cards: opening a card, duplicating and deleting a selection, the context menus, Pick on Canvas, and the selection agents can see. |
| `creation` | `basehalfCanvasCreation.ts` | Making things on the canvas: the inline editors that name a new item or rename one, new notes, drafts of images and videos, and PDF branches, where new cards go, and files imported or dropped onto the canvas. |
| `folderDrops` | `basehalfCanvasFolderDrops.ts` | Dropping into a folder: the cards let go on a folder's card or on a folder of the path in the title bar, and items from Files or files from outside let go on a folder's card, handed to the feature that moves them (`canvasContrib/folderDrop/`). |
| `cardDetailHost` | `basehalfCanvasCardDetailHost.ts` | Card Detail inside the canvas: its header, title, and save status, the projections that draw a file, and keeping the open item when it is renamed or moved. |

`basehalfCanvasViewShared.ts` holds the types, constants, and small functions
that several parts use. A helper that one part uses lives in that part's file.

## Stylesheets

The view and each part that draws elements import their stylesheets from
`../media/`:

| Stylesheet | Imported by | What it styles |
| --- | --- | --- |
| `basehalfCanvasWorkbench.css` | the view | The view in the editor area, its controls, the layers of the canvas, the empty canvas, and its notices. |
| `basehalfCanvasCard.css` | `cardRenderer` | A card: its frame and its states, its caption and name, and its body. |
| `basehalfCanvasCardPreview.css` | `cardRenderer` | What a card shows: a Note's Markdown, folders, media, and the face of a generation card. |
| `basehalfCanvasBadgeEditor.css` | `badgeEditor` | The badge editor and its toggle, on a card and in Card Detail. |
| `basehalfCanvasNoteEditor.css` | `noteEditing` | The editor of a Note in its card. |
| `basehalfCanvasNameEditor.css` | `creation` | The editor of a card's name and of the name of a new card. |
| `basehalfCanvasCardDetail.css` | `cardDetailHost` | Card Detail: its header, save status, and the layers of its projections. |

## Rules

- New behavior on the canvas is a canvas feature in `../../../canvasContrib/`,
  which sees only `IBaseHalfCanvasView` (`../basehalfCanvasExtensions.ts`). A
  part is for what the view itself does
  ([code organization](../../../../../../../../docs/harness/code-organization.md)).
- A change to one concern goes into its part. When a part needs state that
  only it uses, the state moves into the part.
- Members of the view and of a part that other files of the view use are
  public. That is how the parts work together, not an interface for features.
- The parts were cut from one class without changing what it did; the order
  in which the view makes, wires, and disposes things is the order it had.
