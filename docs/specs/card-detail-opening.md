# Opening and closing Card Detail

Status: Active (2026-10-23)
Related: [architecture invariants](../harness/architecture-invariants.md#product-shell)
(the files a card and Card Detail show),
[generation cards](generation-cards.md) ("The player" and "The toolbar"),
public decisions D33, D34, D62, and D65

## Problem

On 2026-10-23 the user found that a double click that opens a card, and
closing Card Detail again, flashed once and felt abrupt. Recorded frame by
frame in the window, with the card of a 5 s video:

- **Opening.** The canvas was replaced at once by an empty Card Detail. It
  stayed empty for about 140 ms, nine frames, while the page that plays the
  video loaded, and then the video appeared at once.
- **Closing.** Card Detail went at once, and every card on the canvas was
  drawn anew. The video card showed an empty picture for a frame while its
  video loaded again.

The first answer moved the card's picture into Card Detail and back. The
browser draws such a move above the whole window, from the card's whole
rectangle: a card partly outside the canvas, or larger than it at a high
zoom, drew over the sidebar for the first frames of the move. The user found
that the motion slipped out of control. Card Detail now fades in and out
where it is.

The keyboard did not follow either. Opening Card Detail left the keyboard on
the canvas, so that typing right after Expand on a note went nowhere, and
Escape typed in a note's editor, an image, or a PDF did not close Card
Detail: those draw in webviews, whose keys do not reach the canvas.

## Scope

In scope: what the window shows from the moment Card Detail is asked to open
until it shows its file, and from the moment it is asked to close until the
canvas is back; and what becomes of the cards under Card Detail.

Also in scope: where the keyboard is when Card Detail has opened, and
Escape, which closes it.

Not in scope, and unchanged: what Card Detail shows (its header, badge, and
projections), navigation and its history, a folder's card (a double click on
it opens the folder's canvas), and switching Card Detail from one file to
another.

## Terms

- **Drawn**: Card Detail shows its file: an image has loaded, a video has
  the frame where it starts, a sound knows its length.

## Required behavior

### Opening

- The canvas stays on screen as it is until Card Detail is drawn, and at most
  250 ms. No frame shows Card Detail without its image or its video.
- Card Detail then fades in where it is, over the canvas area, growing from
  98% of its size to its size, in 180 ms, slowing down. The card and the
  canvas do not move, and no frame draws anything of the transition outside
  the canvas area, wherever the card is and at any zoom. Card Detail opens
  the same way whether it was opened from its card, from Files, Search, or
  Quick Open.
- Card Detail fades in with what it shows of an image, a video, or a sound.
  An editor, such as that of a note, a PDF, and a book show themselves once
  the transition is over: the browser holds a transition up for the first frame
  of a webview that has just started (2 s for a note's editor, measured
  2026-10-23). So does a projection that is not drawn after 250 ms.

### Closing

- Card Detail fades out where it is, shrinking to 98% of its size, in
  150 ms, speeding up, while the canvas shows under it as it is.
- The cards under Card Detail stay as they were: no picture of an image or a
  video is drawn anew. Only the cards of notes are drawn again, so that they
  show what was written in Card Detail.
- The card of a video shows the frame where Card Detail's video stopped
  ([generation cards, "The player"](generation-cards.md#the-player)).

### The keyboard

- Once Card Detail is drawn and its transition is over, it takes the
  keyboard: the editor of a note has the caret at the end of the note, so
  that what is typed goes on from there; the editor of another text has it
  at its start, or where it was opened, as from a result of Search; the
  player of a video or a sound has it on Play; an image, a PDF, and a book
  have it in their page. It does not when it was opened to keep the keyboard where it
  was, as a click in Files does, or when the keyboard went out of the canvas
  meanwhile.
- Escape closes Card Detail, wherever in it the keyboard is: in its header,
  in the player, in a note's editor, in an image, in a PDF, in a book, or in
  the Sequence view ([Video Sequence](video-sequence.md#the-sequence-view)).
  What uses Escape itself takes it first: a menu or a list of the editor
  (slash, files, emoji, a block's or a table's menu), a field of its own,
  such as that of a link or the page number of a PDF, a menu or a dialog of
  the PDF viewer, the contents and the search of the book reader
  ([PDFs and books](documents-and-books.md#the-book-reader)), the
  composition of an input method, and full screen.
- When Card Detail closes with the keyboard in it, the keyboard goes back to
  the canvas, where the keys of the selected card work again.

### Motion and the window

- With reduced motion (the system's setting, or `workbench.reduceMotion`),
  nothing grows or fades: Card Detail appears and goes in one frame, and
  still no frame shows it empty.
- In a window that is not shown, Card Detail opens and closes at once.
- Opening or closing while a transition runs ends that transition at once,
  as if it had run to its end, and the new one starts from there.

## Limits

- While a transition runs, the browser gives every click to the window's
  root: a click then reaches nothing. Opening, that is the wait for Card
  Detail to be drawn, at most 250 ms, and 180 ms; closing, 150 ms. Keys go
  where the keyboard is. The smoke's own pointer input waits for a
  transition to end.

## Failure

A transition that the window cannot run, or that the browser stops, leaves
Card Detail open or closed as asked, at once. What Card Detail shows is never
lost to a transition: the transition only delays the frames, never the
navigation, which has already changed when it starts.

## Acceptance criteria

1. A double click on the card of a video: no frame between the double click
   and Card Detail drawn shows an empty Card Detail. The frames show the
   canvas, then Card Detail fading in over it, then Card Detail with the
   video at the frame its card showed. No frame draws anything outside the
   canvas area, also for a card that the sidebar half covers and at 200%
   zoom.
2. Closing that Card Detail: no frame shows the video card without its
   picture, and the video card is the same element before and after.
3. The same for the card of an image.
4. A note opened from its card with Expand, a line typed at once, Escape:
   the line is in the note, Card Detail closes, and the card shows the line
   when the transition ends; the transition did not wait for the note's
   editor.
5. Escape closes Card Detail with the keyboard in its header, the player of
   a video, an image, and a PDF, and the keyboard is on the canvas again;
   with a menu of the note's editor open, it closes the menu only.
6. A file opened from Files: Card Detail fades in the same way.
7. With `workbench.reduceMotion` on: the frames go from the canvas straight
   to Card Detail drawn, and back.

## Verification

- Unit tests of the transition (`basehalfCanvasCardDetailTransition.test.ts`):
  that Card Detail alone has the transition's name, opening and closing, and
  a transition that a newer one ended leaves the name to it; that the update
  waits for the drawn signal at most 250 ms; that the transition says it runs
  until its animation has ended, after which Card Detail takes the keyboard;
  that reduced motion is a type of the transition, which stops its motion;
  and that without the browser's support, in a window that is not shown, and
  when the browser refuses, Card Detail is drawn at once. Unit tests of the
  pages' messages: the Escape of the pages of an image, a sound, and a PDF
  (`basehalfMediaViewState.test.ts`), and the request that gives the note's
  editor the keyboard (`basehalfMarkdownRichWebviewProtocol.test.ts`).
- In the window, recorded on every frame by the page itself (the screencast
  of the DevTools protocol sends no frames while a view transition runs):
  when each transition starts, when its animation runs, and when it ends, for
  the card of a video, of an image, and of a note, opening and closing; that
  the video card and its video element are the same before and after; with
  the transition slowed to 4 s, a screenshot of the whole window every
  700 ms, also from a card that the sidebar half covers and from a card
  larger than the canvas at 400% zoom, with nothing drawn outside the canvas
  area; the animations of each transition on every frame: 180 ms opening,
  150 ms closing, none with reduced motion (2026-10-23); and where the
  keyboard is after each opening, and what Escape does there, also with the
  slash menu of a note and the zoom menu of a PDF open. Before this change, the same video card showed
  nine frames of an empty Card Detail and, closing, one frame without its
  picture.
- Full screen is not tried in the window that the checks drive: on macOS the
  window's full screen is a space of its own, which a window in the
  background does not enter, so the request waits. That Escape leaves full
  screen and not Card Detail rests on the canvas, which closes nothing while
  an element of the window is full screen.
