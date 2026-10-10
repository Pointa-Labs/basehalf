# Canvas card interaction continuity

Status: Active (2026-10-10)
Related: [canvas card resize](canvas-card-resize.md),
[canvas connection handles](canvas-connection-handles.md)

## Problem

A click on a card control, such as the badge toggle, was sometimes ignored.
The card looked normal and nothing happened.

The canvas rebuilds a card whenever its content changes: a file is saved, a
description is edited, a preview finishes loading. The workbench builds the
replacement element and the scene puts it into the document on its next
commit. The workbench disposed the listeners of the old element as soon as it
built the replacement. Until the scene's commit, the element on screen had no
listeners, and a click on it was lost.

The window is short but recurring, because saving a file is exactly when the
user's next click is likely. It is the reason the smoke's badge steps failed
intermittently.

## Goals

- A card element that is in the document always has its listeners.
- A click during a background re-render does what it would have done just
  before that re-render.

## Non-goals

- Changing when cards are rebuilt or reused.
- Keeping an open in-card editor alive across a rebuild. The existing reuse
  rules own that.

## Required behavior

`BaseHalfCanvasCardListenerStores` owns the listener store of every card
element the workbench builds.

- **Replace.** When the workbench builds a new element for a card, the store
  of the element it replaces is kept if that element is still in the
  document, and disposed at once if it is not. An element that was built but
  never reached the document is therefore released immediately.
- **Mount.** The scene reports when it has put a card's element into the
  document in place of the previous one. At that point the stores of the
  elements it replaced are disposed. A report for an element that is no longer
  the card's newest one changes nothing.
- **Remove.** When a card leaves the scene, its stores are disposed at once,
  kept ones included. The same holds when the scene is reset or the canvas is
  disposed.

A handler that runs on an element about to be replaced sees the state of the
render that built it. Handlers already tolerate that state being out of date,
because a click can always arrive just before a re-render: operations that
change files check their mutation guard, and operations that change only the
view request a new render.

## Acceptance criteria

1. While the element a new one replaces is in the document, a listener on the
   old element still fires. After the scene reports the new element, it no
   longer fires.
2. An element that was replaced before it reached the document loses its
   listeners at once.
3. A report for an element that a newer one has replaced disposes nothing.
4. Removing a card, resetting, and disposing release every store, kept ones
   included.
5. In the product, opening and closing a badge face right after its file was
   saved works on the first click. The smoke's `badge-editor-upstream-downstream`
   step passes in repeated canvas runs.

## Verification

- A unit test of `BaseHalfCanvasCardListenerStores` covers criteria 1–4.
- The BaseHalf smoke covers criterion 5.
