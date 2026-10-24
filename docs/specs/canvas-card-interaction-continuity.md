# Canvas card interaction continuity

Status: Active (2026-10-10; 2026-10-24: a change of connections keeps the cards)
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

- Changing when cards are rebuilt or reused, apart from a change of
  connections ([A change of connections](#a-change-of-connections)).
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

### A change of connections

Added 2026-10-24. A connection drawn, removed, or made by Pick on Canvas
changed the connection lists of the two cards it joins, and the canvas built
both cards anew. A video card then showed no picture for up to 0.1 s while its
new player loaded the first frame, and the outline that Pick on Canvas draws
under the pointer started again on the new element, so it blinked.

What a card shows of its connections is its badge toggle: the summary of its
upstream and downstream in the toggle's hover and accessible name, and the dot
of a badge with connections. When only the card's connections change, the
card keeps its element and its content, and its badge toggle is drawn again
in place. The card is built anew as before when anything else it shows
changes, its issue count included, and while its badge face is open, since
the face lists the connections.

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
6. A connection drawn or removed between two cards keeps both cards'
   elements, pictures, and video players; their badge toggles say the new
   number of connections. A card whose badge face is open is built anew.

## Verification

- A unit test of `BaseHalfCanvasCardListenerStores` covers criteria 1–4.
- The BaseHalf smoke covers criterion 5.
- A unit test of the canvas renderer's reuse rule and the smoke's Pick on
  Canvas step cover criterion 6.
