# Opening and closing Card Detail

Status: Active (2026-10-23)
Related: [architecture invariants](../harness/architecture-invariants.md#product-shell),
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

## Scope

In scope: what the window shows from the moment Card Detail is asked to open
until it shows its file, and from the moment it is asked to close until the
canvas is back; and what becomes of the cards under Card Detail.

Not in scope, and unchanged: what Card Detail shows (its header, badge, and
projections), navigation and its history, a folder's card (a double click on
it opens the folder's canvas), and switching Card Detail from one file to
another.

## Terms

- **Its card**: the card of Card Detail's file on the canvas under Card
  Detail, when that card is on screen.
- **Drawn**: Card Detail shows its file: an image has loaded, a video has
  the frame where it starts, a sound knows its length.

## Required behavior

### Opening

- The canvas stays on screen as it is until Card Detail is drawn, and at most
  250 ms. No frame shows Card Detail without its image or its video.
- Card Detail then grows out of its card over 260 ms, slowing down: it starts
  at the place and the size of its card and takes the whole canvas area,
  while the card's picture fades into Card Detail and the canvas stays under
  it. Without its card on screen, as when the file was opened from Files,
  Search, or Quick Open, Card Detail fades in over the canvas.
- Card Detail grows in with what it shows of an image, a video, or a sound.
  An editor, such as that of a note, and a PDF show themselves once the
  transition is over: the browser holds a transition up for the first frame
  of a webview that has just started (2 s for a note's editor, measured
  2026-10-23). So does a projection that is not drawn after 250 ms.

### Closing

- Card Detail goes back into its card over 220 ms, speeding up, while the
  canvas comes back under it. Without its card on screen, it fades out.
- The cards under Card Detail stay as they were: no picture of an image or a
  video is drawn anew. Only the cards of notes are drawn again, so that they
  show what was written in Card Detail; their transition waits until they are
  in the window, at most 150 ms.
- The card of a video shows the frame where Card Detail's video stopped
  ([generation cards, "The player"](generation-cards.md#the-player)).

### Motion and the window

- With reduced motion (the system's setting, or `workbench.reduceMotion`),
  nothing grows or fades: Card Detail appears and goes in one frame, and
  still no frame shows it empty.
- In a window that is not shown, Card Detail opens and closes at once.
- Opening or closing while a transition runs ends that transition at once,
  as if it had run to its end, and the new one starts from there.

## Limits

- While a transition runs, at most 260 ms, the browser gives every click to
  the window's root: a click then reaches nothing. Keys go where the keyboard
  is. The smoke's own pointer input waits for a transition to end.

## Failure

A transition that the window cannot run, or that the browser stops, leaves
Card Detail open or closed as asked, at once. What Card Detail shows is never
lost to a transition: the transition only delays the frames, never the
navigation, which has already changed when it starts.

## Acceptance criteria

1. A double click on the card of a video: no frame between the double click
   and Card Detail drawn shows an empty Card Detail. The frames show the
   canvas, then Card Detail growing from the card's place, then Card Detail
   with the video at the frame its card showed.
2. Closing that Card Detail: no frame shows the video card without its
   picture, and the video card is the same element before and after.
3. The same for the card of an image.
4. A note opened from its card, a line typed, Card Detail closed with Close:
   the card shows the line when the transition ends, and its transition did
   not wait for the note's editor.
5. A file opened from Files: Card Detail fades in; closing it fades it out.
6. With `workbench.reduceMotion` on: the frames go from the canvas straight
   to Card Detail drawn, and back.

## Verification

- Unit tests of the transition (`basehalfCanvasCardDetailTransition.test.ts`):
  which element has the transition's name before and after, the card's name
  with its own; that the update waits for the drawn signal at most 250 ms;
  that reduced motion is a type of the transition, which stops its motion;
  and that without the browser's support, in a window that is not shown, and
  when the browser refuses, Card Detail is drawn at once.
- In the window, recorded on every frame by the page itself (the screencast
  of the DevTools protocol sends no frames while a view transition runs):
  when each transition starts, when its animation runs, and when it ends, for
  the card of a video, of an image, and of a note, opening and closing; that
  the video card and its video element are the same before and after; and,
  with the transition slowed to 4 s, a screenshot every 700 ms. Before this
  change, the same video card showed nine frames of an empty Card Detail and,
  closing, one frame without its picture.
