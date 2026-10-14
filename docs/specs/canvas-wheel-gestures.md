# Canvas wheel gestures

Status: Active (2026-10-12)
Related: [canvas card resize](canvas-card-resize.md#terms) (flow and screen
pixels), [architecture invariants](../harness/architecture-invariants.md)

## Problem

A Note card at rest shows the beginning of its note. The rest is cut off at
the bottom of the card. A two-finger scroll over the card moved the canvas,
so the only way to read on was to double-click the card and scroll inside the
editor.

Reading is the most common thing a user does with a note on the canvas, and
it should not need a mode. The canvas must still be easy to move: a scroll
that moves the canvas brings cards under the pointer all the time, and it
must not stop because one of them can scroll.

The rule is where the pointer is when the scroll begins. A scroll that begins
on a long note scrolls the note. A scroll that begins anywhere else moves the
canvas, and goes on moving it over whatever comes under the pointer.

A table or a code block of a note can be wider than the card
([note rendering](note-rendering.md)). The same rule lets it be read: a
sideways scroll that begins on such a table or code block scrolls it.

## Scope

In scope: what a wheel event moves when the pointer is over the canvas scene.
Wheel events come from a two-finger scroll on a trackpad, from its momentum
after the fingers lift, and from a mouse wheel. All three follow the same
rules.

Not in scope, and unchanged:

- Pinch zoom and wheel zoom with the zoom key held. This specification never
  touches their events.
- Moving the canvas by dragging, and auto-pan at the edges during a drag.
- Scrolling inside a Note that is being edited, a badge face, or a toolbar
  when the scroll starts there. Such a surface takes the wheel also when it
  has nothing to scroll.
- Previews of text files, code files, and folders. They show a short excerpt
  and do not scroll. Reading them is Card Detail's job.
- A visible scroll indicator on a Note at rest. There is none.

## Terms

- **Wheel gesture**: a run of wheel events that ends when the **quiet time**
  of 150 ms has passed without a wheel event. The momentum that follows a
  trackpad scroll belongs to the same gesture. The canvas already treats a
  wheel pan as ended after the same 150 ms.
- **Owner**: what a wheel gesture moves. A gesture has one owner from its
  first event to its last.
- **Card content**: the painted box of a card, inside its outline. The
  caption above the card is not part of it.
- **Scrollable content**: content that a card gives the canvas to scroll for
  the user (`cardScrollableContent` of the scene delegate). Today the only
  one is the resting projection of a Markdown Note, which holds the whole
  note. A long note is built in parts as it is scrolled, and the canvas has
  the parts a scroll needs built before it moves the note
  ([note rendering](note-rendering.md#note-size-and-parts), rule 28). A note
  above 1 MiB shows a label instead of its text and has nothing to scroll. A
  card shows no scrollable content while its Note is being edited and while
  its badge face is open.
- **Sideways box**: an element inside scrollable content that holds more
  than it shows from left to right, and that the canvas scrolls sideways for
  the user (the class `basehalf-canvas-scroll-sideways`). Today these are a
  table and a code block of a Note at rest that are wider than the card.
- **Own-scroll surface**: an element with the `nowheel` class. It handles the
  wheel by itself: a Note being edited, a badge face, a toolbar, a player.

## Required behavior

### When a gesture ends

A gesture ends when the quiet time has passed without a wheel event. A busy
window does not end it: a wheel event that waited while the window was busy
for longer than the quiet time belongs to the gesture that was running. Cards
are drawn while the canvas moves, so the window is busy exactly when a pan
must not be cut in two.

The quiet time is a timer. A timer that fires more than 16 ms late was held
up by a busy window, and the wheel events that waited are handled only after
it, at the start of a later frame. Such a timer does not end the gesture. It
gives them 50 ms to come in, and the gesture ends by the first timer that
fires on time.

### Choosing the owner

The owner is chosen from the first event of a gesture and from the element
that event is delivered to, which is what the pointer is on then. Later
events do not change it, whatever is under the pointer by then.

1. The first event is on an own-scroll surface: that surface owns the
   gesture. BaseHalf leaves every event of the gesture alone, as before.
2. The first event is on the card content of a card that shows scrollable
   content, no mouse button is held, and the content is taller than its box
   or the event is on a sideways box that is wider than it shows: the
   gesture **waits for its direction** (below). Then the content, the
   sideways box, or the canvas owns it.
3. Otherwise the canvas owns the gesture.

So the canvas owns every gesture that starts on a card without a note, and
on a note that fits its card unless the gesture starts on a table wider than
the card.

The canvas also owns a gesture that starts on the box of a set of selected
cards. The box lies over its cards, so the first event is delivered to the
box and not to a card, and a Note under the box does not scroll
([canvas selection and arrangement](canvas-selection-and-arrangement.md#a-set)).

An event with no movement in it (both deltas zero) never starts a gesture.
Before a gesture it is left alone; inside a gesture it belongs to the
gesture. An event with the zoom key or Ctrl held (pinch) is not part of any
gesture and is left alone.

### Waiting for the direction

The first events of a trackpad scroll ask for a pixel or two, sometimes
sideways before the scroll goes down. One such event does not show what the
user means.

- The events of the gesture are held, and nothing moves, until together they
  ask for 4 screen pixels of movement (`|x| + |y|`). One notch of a mouse
  wheel asks for more, so it is never held.
- Then the content owns the gesture if both hold:
  - the movement so far is more vertical than horizontal (`|y| > |x|`; on
    platforms where Shift turns a wheel into a horizontal scroll, a Shift
    wheel event counts as horizontal);
  - the content is not already at the end the movement points to: not at the
    top for a scroll up, not at the bottom for a scroll down.
- Otherwise the sideways box that the gesture began on owns it if both hold:
  - the movement so far is more horizontal than vertical (`|x| > |y|`);
  - the box is not already at the end the movement points to: not at its
    left end for a scroll to the left, not at its right end for a scroll to
    the right.
- Otherwise the canvas owns the gesture.
- The new owner moves by everything that was held. No movement is lost.
- A gesture that ends before it asked for 4 pixels moves nothing.

So a sideways scroll over the text of a note, a scroll beyond the end that a
note is already at, and a scroll beyond the end that a table is already at
move the canvas. This is how a scroll area inside another one behaves on the
desktop.

### A gesture the content owns

- Each event scrolls the content vertically by `deltaY / zoom` flow pixels,
  so the text moves on screen as far as the fingers did at every canvas
  zoom. Fractions of a pixel add up across events instead of being lost.
- The horizontal part of each event is dropped. The canvas does not move
  sideways while a note is being read.
- At the top or the bottom the content stops. The canvas does not move for
  the rest of the gesture, momentum included.
- The canvas viewport does not change, and no viewport interaction is
  reported.
- If the card is redrawn during the gesture, the gesture goes on with the new
  drawing of the same card.
- If the card no longer shows the content (the card is gone, its badge face
  was opened, or the Note began to be edited), the rest of the gesture moves
  nothing.

### A gesture a sideways box owns

- Each event scrolls the box sideways by `deltaX / zoom` flow pixels.
  Fractions of a pixel add up across events.
- The vertical part of each event is dropped. The note does not move up or
  down while its table is being read sideways.
- At its left or right end the box stops. The canvas does not move for the
  rest of the gesture, momentum included.
- The canvas viewport does not change, and no viewport interaction is
  reported.
- If the box is no longer shown (the card was redrawn or is gone, its badge
  face was opened, or the Note began to be edited), the rest of the gesture
  moves nothing.

### Where the text of a scrolled Note is cut

- The text of a Note at rest is cut at the top and at the bottom of the card
  content, as the text of a Note that is being edited is. No band without
  text is left between the card's outline and the text of a scrolled note.
- The space around the text (8 flow pixels above its first block, 12 below
  its last block) belongs to the scrolled content. It shows at the top and at
  the bottom of the note and nowhere between.
- This moves no text. A note that is not scrolled shows its text where it
  did, and the text is at the same place at rest and while it is edited, at
  every scroll position.

### A gesture the canvas owns

- Every event pans the canvas, as before this specification.
- This holds also for an event that is delivered to an own-scroll surface or
  to a card with scrollable content, which happens when the canvas brings one
  under the pointer and when momentum starts there. That surface does not
  scroll.

### Scroll position of a Note at rest

- The position is kept when the card is selected and deselected, and when
  the Note starts and stops being edited: the editor opens at the position
  the resting note has when the editor is ready, and leaves its own position
  behind (unchanged).
- The position is kept when the card is redrawn while it stays on screen:
  after the file changed on disk, and after the card showed something else in
  between, such as its badge face or a loading text. If the new text is
  shorter, the position is the nearest one that exists.
- A card that left the area near the viewport is drawn from the top when it
  returns (unchanged). The position is not saved to disk.
- The sideways position of each table and code block is kept when the Note
  starts and stops being edited, as long as the note has the same number of
  them then. A card that is redrawn for another reason shows them from
  their left end.

### What does not change

- A Note at rest can still be dragged from anywhere on its body. Its content
  has no scrollbar and takes no pointer events of its own.
- Clicks, double-click to edit, links in the note, and selection work as
  before.

## Limits

A wheel event does not say when the fingers were lifted. Only the quiet time
separates one gesture from the next, with two consequences.

- A swipe that begins within the quiet time of the momentum before it belongs
  to the same gesture. Quick swipes at the end of a note move nothing until
  there is a pause, and then the canvas moves. Stopping a pan with a touch and
  scrolling at once goes on panning.
- A scroll that goes on after the fingers rested for longer than the quiet
  time is a new gesture, and so is each notch of a slowly turned mouse wheel.
  It belongs to what the pointer is on then, which can be a long note that
  the canvas brought there.

## Failure and recovery

There is nothing to save and nothing to recover. A gesture whose content is
gone moves nothing until it ends, and the next gesture chooses its owner
again.

## Acceptance criteria

1. The pointer is on a Note at rest whose text is longer than the card.
   Scrolling down moves the text, and the canvas viewport does not change.
2. In one gesture that runs past the end of the note, the text stops at its
   end and the viewport does not change.
3. A gesture that starts on empty canvas and goes on while a long Note is
   under the pointer keeps panning the canvas. The note does not scroll.
4. The same over a Note that is being edited: the canvas keeps panning and
   the editor does not scroll.
5. More than the quiet time after a pan has ended with a long Note under the
   pointer, a new scroll down moves the note and not the canvas.
6. The canvas pans for a scroll that starts on a Note whose text fits its
   card, on a long Note with a sideways scroll, on a long Note at its top
   with a scroll up, and on a long Note at its bottom with a scroll down.
7. At 50% and 200% canvas zoom, a 60-pixel scroll moves the text 60 screen
   pixels.
8. A pinch over a long Note zooms the canvas. A wheel scroll over a long Note
   while a mouse button is held pans the canvas.
9. After a Note at rest was scrolled, selecting it, deselecting it, and
   double-clicking it keep the position. The editor opens at that position.
10. After a scrolled Note's file changes on disk, the redrawn card shows the
    same position. After its badge face was opened and closed, it does too.
11. A Note at rest that has been scrolled can still be dragged by its body.
12. A pan is running, and the window is busy for 400 ms. A wheel event that
    arrived in that time, with a long Note under the pointer, pans the canvas
    and does not scroll the note.
13. A long Note at rest that was scrolled to its middle shows text up to the
    top and the bottom of its card content. Scrolled back to its top, the
    note shows its text where a note that was never scrolled shows it.
14. The pointer is on a table of a Note at rest that is wider than the card.
    A scroll to the right moves the table and brings its last column into
    view. The canvas viewport and the vertical position of the note do not
    change.
15. On the same table, a scroll down moves the note when the note is longer
    than its card, and the canvas when it is not. A scroll to the left on a
    table at its left end moves the canvas.
16. A sideways scroll that begins on the text of the same note, outside the
    table, moves the canvas.
17. After a table was scrolled sideways, double-clicking a paragraph of the
    note shows the table at the same sideways position in the editor.

## Verification

- Unit tests cover the owner choice, the wait for the direction, and the
  timer that ends a gesture, on time and held up
  (`basehalfCanvasWheelGesture.test.ts`), and what happens to the wheel
  events in the document (`basehalfCanvasWheelGestures.test.ts`).
- The smoke covers criteria 1, 3, 4, 5, the fitting-note case of 6, 9, the
  file change of 10, and the cut of 13 (the box that cuts the text of a
  scrolled note is the card content), and in `canvas-note-renders-markdown`
  criteria 14 and 17.
- Criteria 2, 7, 8, 11, 12, and the rest of 6 and 10 are checked in the real
  window when this behavior changes. Criteria 15 and 16 are covered by the
  unit tests. Momentum and the feel of a real
  trackpad are checked by hand: a test cannot produce them.
