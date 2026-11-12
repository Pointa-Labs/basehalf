# The line of a connection

Status: Active (2026-11-12)
Decision: [D130](../decisions.md#d130--a-line-takes-the-sides-that-face-each-other-and-stays-between-its-two-cards-new-2026-11-12)
Related: [reference graph](reference-graph.md#edges) (which connections a
canvas draws, and the rows that remember sides),
[canvas connection handles](canvas-connection-handles.md) (anchor points,
drawing a line, dragging an end),
[canvas selection and arrangement](canvas-selection-and-arrangement.md)
(a marquee over lines, Tidy Canvas),
[canvas card placement](canvas-card-placement.md#beside-the-card-it-follows)
(where a card lands that follows another)

## Problem

A canvas draws a connection as a curve from the midpoint of one side of the
upstream card to the midpoint of one side of the downstream card. Which
sides, and how far the curve swings, decided whether a map could be read.
Three things made a map of thirteen notes look tangled (reported on
2026-11-12, on the folder of the launch film, and reproduced the same day in
a development window):

1. **The sides were chosen by the distance between the centres.** A line
   ran sideways when the centres were at least as far apart sideways as up
   and down, and else up and down. In a tidied map a card stands in the
   column after the card it follows, and often much higher or lower. Its
   line then left the top or the bottom of that card, ran behind the cards
   stacked above or below it, and entered the card from above or below. Of
   twelve lines of the tidied map, two did.
2. **The curve swung out by half the distance between its ends, at least 48
   and at most 220, whatever the room between the two cards.** Between two
   columns 120 apart a line to a card 800 lower swung 220 past each end:
   into the next column and back.
3. **Sides that the user drew stayed where they were drawn.** A line drawn
   from the bottom of one card to the top of another kept those sides when
   the second card was moved beside or above the first, and looped around
   both cards.

## Scope

In scope: the sides at which a connection's line leaves and enters its two
cards, when the sides that the layout remembers are drawn, the curve between
the two ends, and what Tidy Canvas does with remembered sides.

Not in scope, and unchanged:

- Which connections a canvas draws, and when a row of remembered sides is
  written ([reference graph](reference-graph.md#edges)).
- The anchor points, the handles, and the gestures that draw a line or drag
  one of its ends ([canvas connection handles](canvas-connection-handles.md)).
- The arrowhead, the colors, and the width of a line.
- A line never goes around a card that stands between its two cards.

## Terms

- **Line**: the curve a canvas draws for a connection, from the upstream
  card to the downstream card.
- **Side**: north, east, south, or west of a card. A line's end is the
  **anchor point** of a side: its midpoint.
- **Beside**: one card lies beside another when it lies wholly to its left
  or right. The **gap** is the distance between their two nearer edges.
  **Above** and **below** likewise.
- **Remembered sides**: the two sides of the layout's row for a pair of
  cards. The row is written when the user draws or reconnects the line
  ([reference graph](reference-graph.md#edges)).
- **Ahead**: a point lies ahead of a side when it lies beyond the straight
  line that the side lies on, away from the card.

All sizes are in flow pixels.

## Required behavior

### The sides a line takes by itself

A line without remembered sides takes the two sides that face each other, by
where one card lies from the other:

1. **One card lies beside the other, with a gap of at least 40, or with a
   smaller gap while neither card lies above the other: the line runs
   sideways.** It leaves the side of the upstream card that faces the
   downstream card and enters the side that faces back: east to west when
   the downstream card is on the right, west to east when it is on the left.
   This holds however far up or down the other card is.
2. **Otherwise, one card lies above the other: the line runs up or down.**
   South to north when the downstream card is below, north to south when it
   is above.
3. **Otherwise the cards lie over each other or touch.** The centres decide,
   as before: sideways when they are at least as far apart sideways as up
   and down.

40 is the gap of two cards that stand side by side in the plain grid: the
smallest room that BaseHalf itself leaves between two cards, and enough for
a curve and its arrowhead. Sideways comes first because a map reads from
left to right: a card that appears goes into the column after the card it
follows ([canvas card placement](canvas-card-placement.md#beside-the-card-it-follows)),
and Tidy Canvas lays columns out from left to right.

So every line of a tidied map leaves the right side of one card and enters
the left side of the next, and so does every line of a map that grew by
itself.

### Remembered sides

- Remembered sides are drawn while they **face each other**: the other end
  of the line lies ahead of each of the two sides.
- When they do not, the line takes its sides by itself. The row is kept, so
  when the cards are moved back, the remembered sides are drawn again.
- A line that the user draws or reconnects is drawn with the sides they
  chose from the moment they let go, as before, and the row is written as
  before.

A user who pulls a line from the bottom of a card to a card below it gets
that line. When the lower card is later moved beside the upper one, or above
it, a line from the bottom would have to turn around the card: the line
then takes the sides that face each other.

### The sides follow the cards

The sides are decided from where the two cards are now:

- at every drawing of the canvas;
- while a card is dragged or resized, in the frame in which the card moves.
  A line changes sides under the pointer, not after the card is let go.

A marquee over lines tests the curve that is drawn
([canvas selection and arrangement](canvas-selection-and-arrangement.md#required-behavior)),
and a reconnect keeps, for the end that is not dragged, the side that is
drawn.

### The curve

The curve is a cubic curve that leaves each end at a right angle to its
side. How far it reaches straight out from an end:

- **The other end lies ahead of the side, by a distance *a*:** half of *a*,
  at least 24, and never more than *a*.
- **The other end does not lie ahead:** half of the sum of the two
  distances between the ends, sideways and up and down, at least 48 and at
  most 220, as before. This is an end that the user is dragging, which can
  be anywhere.

What follows for two sides that face each other:

- The curve stays between the two sides. It never swings past either end,
  so a line between two columns stays in the gap between them.
- The lines from one side to several cards of the next column share their
  first stretch and part one after the other: they read as one trunk.
- Two lines between the same two columns do not cross when their ends are
  in the same order on both sides.

### Tidy Canvas

Tidy Canvas lays every group out from left to right along its connections
([canvas selection and arrangement](canvas-selection-and-arrangement.md#tidying-a-canvas)).
Sides that were drawn for the places before have no claim on that layout:

- **A tidy forgets the remembered sides** of every connection between two
  cards it shows, in the same change of the layout as the places. Every line
  then takes its sides by itself, which is east to west for every
  connection the layout follows.
- **Undo of the tidy brings the remembered sides back** with the places,
  and redo forgets them again.
- **Revert**, in the question after a tidy, brings them back too, also for
  a pair whose sides were drawn again since.
- A tidy that moves no card still forgets remembered sides. It asks
  nothing, and undo takes it back.

Arranging a set of selected cards, and moving cards by hand, forget
nothing: there the rule of [remembered sides](#remembered-sides) decides.

## Failure

- A line whose card is not drawn is not drawn, as before.
- When the layout cannot be written, a tidy fails as before, and no
  remembered side is forgotten.

## Acceptance criteria

1. A line without remembered sides between a card and a card in the column
   to its right, 120 away, leaves the east side and enters the west side,
   also when the second card stands 1,400 higher or 1,960 lower.
2. The same with the second card on the left: west to east.
3. Two cards one above the other, also when the lower one stands 250 to the
   side and still under the upper one: south to north, and north to south
   the other way round.
4. Two cards whose gap to the side is 20, one below the other: south to
   north. Two cards 10 apart side by side at nearly the same height: east
   to west. Two neighbours of the plain grid in a row, and two that stand
   diagonally: east to west.
5. Two cards that lie over each other take their sides by the centres.
6. Remembered south and north sides are drawn while the second card is
   below the first, also one column aside. With the second card beside or
   above the first, the line takes the sides that face each other, and the
   layout still holds the row. With the card back below, the remembered
   sides are drawn again.
7. Between an east side and a west side 120 apart, both ends reach 60
   straight out, also when the second end is 1,960 lower. 1,000 apart they
   reach 500. 40 apart they reach 24, and 10 apart they reach 10.
8. An end whose other end lies behind its side reaches out as before: for
   ends 200 apart sideways and 290 apart up and down, 220.
9. While a card is dragged from the right of the card it follows to its
   left, the line changes from east and west to west and east in a frame in
   which the card is still held.
10. A canvas of the film's thirteen notes that is tidied has twelve lines,
    all east to west. No line passes behind a card.
11. Tidy Canvas on a canvas with a remembered row removes the row in the
    write that moves the cards. Undo of the tidy writes it back with the
    places, redo removes it again, and Revert writes it back.

## Verification

- Unit: `basehalfCanvasModel.test.ts` covers the sides a line takes by
  itself (criteria 1 to 5), remembered sides (6), and the curve (7 and 8);
  `basehalfCanvasArrangement.test.ts` tests a marquee against the curve
  that is drawn; `basehalfCanvasTidy.contribution.test.ts` covers what Tidy
  Canvas asks of the canvas for remembered sides, and what Revert asks
  (criterion 11 as a rule).
- Criteria 9 to 11 were measured in a development window, as recorded
  below. No smoke step reads the sides of a line yet.

### Seen in the real window (2026-11-12)

A development window of 1440 × 900 on a fixture folder outside the
repository, with the thirteen notes of the launch film's mind map: a root,
four notes that list it upstream, and two notes after each of those. The
same steps were run on the code before this change and after it.

| What was done | Before | After |
| --- | --- | --- |
| The notes written one a second, as an agent writes them | a grid of five columns; twelve lines, several behind cards | a tree of three columns ([canvas card placement](canvas-card-placement.md#beside-the-card-it-follows)); twelve lines, all east to west, none behind a card |
| Tidy Canvas | a tree; two of the twelve lines left the top or the bottom of a card and ran behind its neighbours; the lines from the root swung past the second column and back | the same tree; twelve lines east to west; the lines from the root part one after the other |
| A card dragged above the card it follows, to its left, below and left of it, and far to its right and below, the line read while the card was held and after it was let go | north to south, then a loop from the top of the card around to the bottom of the other, then south to north, then east to west | north to south, west to east, south to north, east to west, each already while the card was held |
| A line drawn from the south side of one card to the north side of the card below it, then the lower card moved up and to the right | the row south and north; the line left the bottom, swung 220 down and came back from above | the same row; the line east to west, and the row still in the layout |
| Tidy Canvas with that row in the layout, then Undo, then Redo; and Tidy Canvas, then Revert | the row stayed | the tidy removed the row; Undo wrote it back with the places, Redo removed it, and Revert wrote it back |

## Open questions

- **A line still passes behind a card that stands between its two cards.**
  The sides and the curve keep a line out of the columns beside it; nothing
  routes it around a card in its way.
- **Lines of one corridor lie close together.** In a map that grew by
  itself the third column can stand far below the cards it follows, and the
  lines of several cards then run down the same gap side by side. They do
  not cross, and Tidy Canvas shortens them.
