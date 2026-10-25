# Canvas Create menu

Status: Active (2026-10-25)
Decision: [D77](../decisions.md#d77--new-folder-makes-a-folder-at-once-and-the-canvas-has-no-new-file-new-2026-10-25)
Related: [canvas card placement](canvas-card-placement.md#pointing) (where
a new card goes), [canvas card name](canvas-card-name.md) (changing a
card's name on the card),
[generation cards](generation-cards.md#creating-a-generation-card) (New
Image, New Video, and New Audio), [reference graph](reference-graph.md#creating-connected-nodes)
(the menu of a connection line)

## Problem

The canvas's menu offered **New File...** and **New Folder...**. Both put a
box over the canvas at the point the menu was opened: 280 by 44 pixels, with
a border in the canvas's accent color, a shadow, a glyph, and an empty field
that said "filename.ext" or "Folder name". While the user typed, a name that
could not be used was explained in a message under the box. Only Enter made
the item.

On 2026-10-25 the user called that box ugly. They asked that New Folder make
a folder at once with a default name, and that the menu not offer New File:
a user who wants a file makes it in Files, in the sidebar.

Since [D55](../decisions.md#d55--a-note-is-named-without-its-extension-new-2026-10-13)
a name is changed on the card itself, so the box
was a second name editor, there before the item existed. New File asked for
a whole file name with its extension. The files of a canvas come from New
Note, from a generation, or from Import Files..., a drop, a paste, or an
agent.

## Goals

- New Folder makes a folder at once. Nothing asks for its name.
- The canvas has one name editor: the name on the card.
- The menu offers what is made on a canvas. Files of other kinds are made in
  Files.

## Scope

In scope:

- The menu that opens on a secondary click on empty canvas, on a double
  click on empty canvas, and on the Create button. It is one menu.
- Its items and their order.
- What New Folder does.

Not in scope, and unchanged:

- Files in the sidebar. It keeps VS Code's New File... and New Folder...,
  which name the item in the tree.
- The menu of a connection line that is released on empty canvas: Note,
  Image, Video, and Audio ([reference graph](reference-graph.md#creating-connected-nodes)).
- The menu of a card.
- What New Note, New Image, New Video, New Audio, Paste, and Import
  Files... do, and how they are undone.

## Required behavior

### The items

| Group | Items, in order |
| --- | --- |
| 1 | New Note, New Image, New Video, New Audio, New Folder |
| 2 | Paste, Import Files... |

- There is no New File, and no canvas command makes a file from a typed
  name.
- New Folder has no ellipsis: it asks for nothing before it acts.
- New Audio is [D78](../decisions.md#d78--basehalf-makes-speech-music-and-sound-effects-with-the-same-cards-panel-and-providers-new-2026-10-25)'s,
  made on the same day as this menu, and makes a draft as New Image and New
  Video do.

### New Folder

- New Folder makes a folder in the folder of the canvas at once. No box,
  field, message, or question shows, and no name editor opens.
- The folder is called `untitled folder`. When a file or a folder of the
  folder already has that name, it is `untitled folder 2`, then `untitled
  folder 3`, and so on: the first name that is free. On a volume that
  ignores letter case, `Untitled Folder` takes the name too.
- When `untitled folder` to `untitled folder 1000` are all taken, New Folder
  makes nothing and says: "Too many untitled folders. Rename one before
  creating another."
- The card is placed as a card the user creates is placed
  ([canvas card placement](canvas-card-placement.md#pointing)): its top left
  corner is at the point of the secondary click or the double click that
  opened the menu. From the Create button it is centered on the middle of
  the visible canvas, or at the nearest open place in sight.
- The card is selected. The canvas of the parent stays: the new folder is
  not opened.
- The folder's name is changed as any card's: a double click on its name,
  F2, or Rename ([canvas card name](canvas-card-name.md)).

### Undo

- Making the folder is one step of the canvas's undo, as a rename or a
  delete on the canvas is, and as New Image, New Video, and New Audio are.
  One undo on the canvas takes it back: the folder goes into the kept
  versions with whatever was put into it since, and its card with it. Redo
  brings both back, the card at its place ([exact undo](exact-undo.md#what-the-canvas-made), D82).
- Until D82 the undo was VS Code's: it refused a folder that held anything
  ("Unable to delete non-empty folder"), and redo put the card at the end of
  the canvas (measured on 2026-10-25: made at 1035, 488.5; back at 1730,
  690), because a delete in the window removed the card's row at once.

## Acceptance criteria

1. A secondary click on empty canvas, a double click on empty canvas, and
   the Create button open the same menu: New Note, New Image, New Video,
   New Audio, New Folder, a separator, Paste, Import Files....
2. No item of the menu makes a file from a typed name.
3. New Folder makes `untitled folder` in the folder of the canvas. In no
   frame from the click until the card shows is there a box, a field, or a
   message.
4. With `untitled folder` taken, New Folder makes `untitled folder 2`; with
   both taken, `untitled folder 3`.
5. After a secondary click, the card's top left corner is at the point of
   the click. From the Create button, the card is in sight.
6. The new card is selected, and the canvas of its parent stays.
7. A double click on the new card's name opens the rename editor with
   `untitled folder` in it, all selected.
8. One undo on the canvas right after New Folder removes the folder and its
   card. Redo brings both back, the card at its place.
9. An undo after a file was put into the new folder takes both away, and
   redo brings both back.
10. Files in the sidebar still offers New File... and New Folder....

## Verification

- Unit: `basehalfCanvasContextMenu.test.ts` checks the items of the menu
  (criteria 1 and 2).
- Smoke, canvas suite: `canvas-create-menu-makes-drafts` reads the menu
  (criteria 1 and 2), and `canvas-new-folder` covers criteria 3, 5 to 8,
  and the first half of 4. `canvas-numeric-folder-names` makes its folders
  with New Folder and a rename on the card.
- The window: criteria 4, 9, and 10, below. Criteria 8 and 9 changed with
  D82 and are checked as [exact undo](exact-undo.md#acceptance-criteria)
  criterion 7.

### Seen in the window (2026-10-25)

A window of the development host built from this change, on a test
workspace that held one note. It was built before New Audio (D78) was
merged, so its menu had no New Audio yet, and before D82, so its undo was
VS Code's.

| What was done | What happened |
| --- | --- |
| A secondary click on empty canvas, a double click there, and the Create button | The same menu each time: New Note, New Image, New Video, New Folder, a separator, Paste, Import Files.... |
| New Folder after a secondary click at 425, 156 | `untitled folder`. The card's top left corner was at 425, 156, and the card was selected. In the 115 frames from the click until then, no box, field, or message showed. Card Detail stayed closed. |
| New Folder from the Create button | `untitled folder 2`, at the nearest open place in sight: the note took the middle. |
| New Folder twice more | `untitled folder 3`, then `untitled folder 4`. |
| A double click on the name of `untitled folder` | The rename editor, holding `untitled folder` with characters 0 to 15 selected, and the keyboard. |
| Undo on the canvas right after New Folder | The folder and its card went. Redo made the folder again, its card at the end of the canvas. |
| A file put into that folder, then undo | Nothing was removed. The notice said "Unable to delete non-empty folder '…'." |
| Files in the sidebar | New File... and New Folder... in its title bar. |

The same window, before the change: New Folder... put a box of 280 by 44
at the point of the menu, and typing `a/b` into it showed "Enter a name
without path separators." under the field.
