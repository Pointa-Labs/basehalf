# Canvas selection and arrangement

Status: Active (2026-10-12). Implemented. Revised 2026-10-25: a marquee that
touches no card selects the connections it crosses. Revised 2026-10-27: a set
let go on a folder goes into it.
Decision: [D52](../decisions.md#d52--several-selected-cards-are-one-object-and-the-user-tidies-a-canvas-on-request-new-2026-10-12),
revised by [D80](../decisions.md#d80--a-connection-pulled-off-a-card-and-let-go-on-empty-canvas-is-removed-and-a-marquee-over-connections-alone-selects-them-new-2026-10-25)
and [D88](../decisions.md#d88--cards-let-go-on-a-folder-go-into-it-new-2026-10-27)
Related: [canvas card placement](canvas-card-placement.md) (rows, chosen
rows, list order, the plain grid),
[canvas connection handles](canvas-connection-handles.md) (capture circles),
[canvas wheel gestures](canvas-wheel-gestures.md),
[canvas card resize](canvas-card-resize.md#terms) (flow and screen pixels),
[reference graph](reference-graph.md) (connections),
[architecture invariants](../harness/architecture-invariants.md)

## The rules

**What is selected decides what the canvas shows, not how it was selected.**
One selected card is one card, whether it was clicked or boxed. Two or more
selected cards are a set: one object with one box, one toolbar, and one way
to move it.

**A marquee selects the cards it touches. When it touches no card, it selects
the connections it crosses.** Cards and connections are never selected
together.

**BaseHalf moves cards only when the user asks for it**: by arranging a set
or by tidying the canvas. Each is one step that the user can take back.

## Problem

Selecting several cards was never specified. The canvas used the marquee of
its canvas library as it comes, on top of a selection that BaseHalf owns and
that was built for one card. The user reported two faults, and reading the
code on 2026-10-12 gave the causes below. Faults 1 to 3 were then
[reproduced in the real window](#seen-in-the-real-window-before-the-change-2026-10-12).

1. **A marquee does not select some cards.** The library marks every
   connection of a boxed card as selected, in the same step as the card.
   BaseHalf allows cards or one connection to be selected, never both, and
   the kind that was marked last wins. The connection is always last, so the
   cards are dropped and one connection is selected.
2. **One card selected by a marquee is not the same as one card selected by
   a click.** After any marquee the library lays its own rectangle over the
   selected cards, also over one card. BaseHalf shows the controls of a
   single card under it, and the rectangle takes every click, double click,
   and resize that was meant for the card.
3. A set that is moved by one of its cards is no longer a set afterwards:
   only the dragged card stays selected.
4. A set made by Shift-click and a set made by a marquee look and behave
   differently, because only the marquee brings the library's rectangle.
5. While the marquee is drawn, every change of the boxed cards is a request
   to the workbench that is answered later, so the cards are marked late.
6. There is no way to put cards in order. The
   [placement specification](canvas-card-placement.md#open-questions) left
   the tidy command open.
7. No marquee selects a connection (reported on 2026-10-25), so connections
   are removed one by one.

## Scope

In scope:

- Selecting cards with a marquee.
- Selecting connections with a marquee, and what Delete and Disconnect do
  with several selected connections.
- The states of the selection, and what each shows.
- A set of cards: its box, its toolbar, moving it.
- Arranging a set in a grid, a row, or a column.
- Tidying a whole canvas, with a question that keeps or reverts the result.

Not in scope, and unchanged:

- Everything a single selected card can do: its toolbar, the controls of a
  Note or a video card, resizing, connecting, opening, editing, moving by
  the arrow keys, its context menu.
- Selecting one connection with a click, and what one selected connection
  shows.
- Dragging an end of a connection
  ([canvas connection handles](canvas-connection-handles.md#dragging-an-end-of-a-connection)).
- Moving the canvas and zooming.
- How a place is saved and when BaseHalf chooses one
  ([canvas card placement](canvas-card-placement.md)).
- Card Detail. While it is open the canvas takes no input.

## Terms

- **Card rectangle**: the place and the size of a card's row, in flow
  pixels. The caption above a card is not part of it.
- **Empty canvas**: a point of the canvas scene where no card, connection,
  capture circle, set box, toolbar, menu, or view control takes the pointer.
- **Marquee**: the rectangle the user draws with the pointer to select
  cards, or connections where it touches no card.
- **Set**: two or more selected cards.
- **Set box**: the smallest rectangle that holds the card rectangles of a
  set and the captions above them. A caption takes the pointer, so the box
  holds it: a press on the name of a card of a set is a press on the box.
- **Connection**: a connection that the canvas draws between two of its
  cards. It runs from the upstream card to the downstream card.
- **Line of a connection**: the curve the canvas draws for it, from the
  anchor point on the side of one card to the anchor point on the side of
  the other, without its arrowhead and without the wider band around it that
  takes the pointer.
- **Group**: cards of one canvas that connections join, directly or through
  other cards, in either direction. A group has at least two cards.
- **Single**: a card that no connection joins to another card of the canvas.
- **List order**: as in
  [canvas card placement](canvas-card-placement.md#terms): folders first,
  then by name.
- **Gaps**: 40 between two cards side by side and 60 between two cards one
  above the other. These are the gaps of the plain grid.
- **Wide gap**: 120. It is the distance between the columns of a group,
  where a connection and its arrowhead are drawn, and between the blocks of
  a tidied canvas.

All sizes are in flow pixels unless a sentence says screen pixels.

## What two other canvas products do

Two canvas products of the same kind were tried in the window on
2026-10-12, on test canvases, with every change undone afterwards. Both are
built on the canvas library that BaseHalf uses, so what they do differently
from BaseHalf is their choice and not a limit of the library. They are
called the first and the second product here.

| Behavior | First product | Second product |
| --- | --- | --- |
| A drag that begins on empty canvas | draws a marquee | draws a marquee |
| Which cards a marquee selects | every card it touches | every card it touches |
| Connections of the boxed cards | not selected | the connection between two boxed cards is selected with them; one with only one boxed card is not (tried 2026-10-25) |
| A marquee that touches only connections (tried 2026-10-25) | selects every connection it crosses, with no toolbar | selects nothing |
| Cards are marked while the marquee is drawn | yes | not observed |
| A set after the marquee | a dashed box with a margin, a toolbar above it | a filled box without a margin, a toolbar above it |
| The toolbar of a set | seven actions in four groups, most with the name beside the icon | five actions in three groups, icons alone, the name shown when the pointer rests on one |
| The number of selected cards | not shown | not shown |
| A click on a card or in a gap inside the box | changes nothing | changes nothing |
| A drag that begins anywhere inside the box | moves the set, which stays selected | moves the set, which stays selected |
| Leaving the set | a click on empty canvas | a click on empty canvas |
| A secondary click on the set | no menu | no menu |
| A marquee with Shift held | replaces the selection | replaces the selection |
| A set made by Shift-click | has no box and no toolbar | has the same box and toolbar |
| A marquee that touches one card | the same as a click on that card | the card is marked, with no toolbar, and does not answer a click |
| Undo of a move of the set | the cards go back, the box stays behind | the cards and the toolbar go back |
| Escape, and the select-all key | do nothing | Escape is not reliable; the key selects the text of the page |
| Arranging a set | grid, row, column | grid, and a layout that follows the connections |
| Tidying the whole canvas | a button at the lower left | none |

How the first product arranges and tidies:

- A set is arranged from the upper left corner of its box, with a fixed
  distance between cards and without changing a size. Four cards made a
  grid of two columns, and eight a grid of three. Cards that are not in the
  set are not looked at: an arranged card came to lie exactly on another
  card. One undo took the arrangement back.
- The order was mostly the order of the places, row by row. In one row two
  cards changed places. The rule could not be worked out.
- The tidy button does not look at the selection. It moves every card of
  the canvas. Each group is laid out from left to right along its
  connections, with the cards that follow one card stacked beside it.
  Groups stand side by side and continue in a new row. Cards without a
  connection come last. The view then shows the whole result.
- After tidying, a small question beside the button offers to keep the
  result or to revert it. It does not block the canvas: cards can be
  clicked and moved while it is open. Revert put every card back where it
  was before, also a card that had been moved in between.

Before this specification the toolbar of a set began with the bare number
of cards, followed by icons without names. Neither product shows that
number, and both put the actions in groups. BaseHalf names its buttons as
the first product does: its four actions fit, and a name needs no icon font
and no resting pointer to be read.

On 2026-10-25 both were tried again with connections. A selected connection
shows a button that cuts it, in both, and Delete removes every selected
connection. One undo brought back what Delete removed. A marquee over two
connections in the first product selected both and showed no button. The
first product draws the connections between selected cards with a moving
color, without selecting them. Neither lets an end of a connection be
dragged.

BaseHalf takes what both products agree on. Where they differ it takes the
behavior that keeps one state for one selection: the second product's for a
set made by Shift-click, the first product's for a marquee that touches one
card, and the first product's for a marquee over connections, which the
user chose on 2026-10-25. The box is drawn filled and without a margin, as the second product
draws it. A box that stays behind and keys that select page text are faults
and are not taken.

## Required behavior

### The states of the selection

The selection is exactly one of these. What the canvas shows follows from
the state alone.

| State | What is selected | What the canvas shows |
| --- | --- | --- |
| Nothing | nothing | no selection controls |
| One card | one card | that card's outline and its own controls, as before this specification |
| A set | two or more cards | the outline of each card, the set box, the set toolbar |
| Connections | one or more connections | the selected look of each connection's line; nothing else |

- Cards and connections are never selected together.
- A way of selecting never leaves a mark of its own. One card that was
  boxed, one card that was clicked, and the last card left by Shift-click
  are the same state, show the same controls, and answer the pointer in the
  same way.
- The state changes at once when the number of selected cards changes:
  - A Shift-click that adds a second card makes a set.
  - A Shift-click that leaves one card of a set makes that card the one
    selected card.
  - When a selected card disappears from the canvas, because its item was
    deleted or moved away by anyone, it leaves the selection, and the state
    follows the number that is left.
- A card that appears on the canvas is not added to the selection.

### The marquee

**Where it begins.** A press of the primary button that then moves more
than 4 screen pixels draws a marquee when one of these holds:

- The press is on empty canvas.
- Shift is held and the press is on the canvas scene: also on a card, a
  connection, or a set box. It is not on a toolbar, a menu, a view control,
  or a Note that is being edited. This is how a marquee is begun on a
  canvas that is full of cards.

A press that moves less is a click and does what a click does there. So a
Shift-click with an unsteady hand is still a Shift-click.

A drag that begins on a card without Shift moves the card, and a drag that
begins inside a set box without Shift [moves the set](#moving-a-set).

**When it begins.** The selection is cleared as by a click on empty canvas.
A Note that is being edited is closed first, as a click elsewhere closes
it. When it cannot be closed, the selection stays as it was and no marquee
is drawn.

**While it is drawn.**

- The marquee is drawn between the point of the press and the pointer.
- A card is in the marquee when its card rectangle and the marquee share
  any area. This is so for a card that is not drawn because it is out of
  view.
- Every card in the marquee shows the selected outline, in the same frame
  in which the marquee reached it. A card that the marquee leaves loses the
  outline. No toolbar, box, or handle is shown yet.
- While the marquee touches no card, every connection whose line it crosses
  shows the selected look, in the same frame in which the marquee reached
  it. A line is crossed when any point of it lies in the marquee, also at
  one of its ends and also when the line is not drawn because it is out of
  view. A connection that the marquee leaves loses the look.
- While the marquee touches a card, no connection is marked, also one whose
  line it crosses.
- Near the edge of the scene the canvas moves and the marquee grows with
  it, as before this specification. The point of the press stays where it
  was on the canvas. A wheel that moves the canvas while the button is held
  is followed in the same way.
- Nothing is saved and nothing is sent to the workbench.

**When the button is released.** A marquee that is released while the
selection is still being cleared, because a Note is closing, selects when
that is done. The cards in the marquee are the selection:

- none, and no line crossed: nothing is selected;
- none, and one or more lines crossed: those connections are selected;
- one: that card is the one selected card;
- two or more: they are a set.

The canvas scene has the keyboard focus afterwards.

Shift held during a marquee changes only where it may begin. The marquee
replaces the selection. It does not add to it.

No marquee is drawn while a generation card waits for the user to pick an
input.

### A set

**Each card** of a set shows the selected outline. It shows none of the
controls of a single card: no resize targets, no connection handles, no
Note controls, no video controls. The card has no capture circles while it
is part of a set, because the half of a circle that reaches outside the box
would show its handles.

**The set box** is the one thing a set has that a card has not.

- It is drawn over the set's cards and connections and under the toolbars
  and menus: a fill and a 1 screen pixel border in the canvas's own
  selection colors, without a margin around the cards. The cards stay
  readable through the fill in the light and the dark themes.
- It is worked out from the card rectangles every time the canvas is drawn.
  It is never kept by itself, so it cannot be anywhere else than around its
  cards: not after a move, an undo, an arrangement, or a change made by an
  agent.
- It takes the pointer in its whole area, also over a card that lies inside
  it without being part of the set.

| Input on the set box | What happens |
| --- | --- |
| Press and drag, more than 4 screen pixels | The set [moves](#moving-a-set). |
| Click, on a card or in a gap | Nothing changes. |
| Double click | Nothing changes. Nothing is opened, edited, or created. |
| Shift-click on a card of the set | That card leaves the selection. |
| Shift-click on a card in the box that is not part of the set | That card joins the set. |
| Shift-click in a gap | Nothing changes. |
| Secondary click | Nothing changes, and no menu is shown. |
| A wheel gesture that begins on it | The canvas moves. A Note under the box does not scroll. |
| A connection line that is released on it | Nothing is connected and no menu opens, as on a card. |

**The set toolbar** stands above the box, or below it when there is no room
above, as the toolbar of a single card does. Every button shows its icon
and its name beside it. A set has no card of its own that says what an icon
means, and a toolbar that the icon font has not reached would otherwise be
empty. The toolbar shows no number of cards. From the left it has three
groups, with a thin line between them:

1. **Arrange**, which opens a menu with **Grid**, **Row**, and **Column**
   ([arranging a set](#arranging-a-set));
2. **Duplicate** and **Copy Paths**;
3. **Delete**, apart from the actions that keep the cards.

The three actions of the last two groups do what they did before this
specification. The toolbar is as wide as its names make it in the language
of the window, and it is kept inside the view with that width. The number
of selected cards is in the name that assistive technology reads.

Delete, Backspace, and the duplicate key act on the whole set, as before.
The arrow keys do nothing while a set is selected, also when one of its
cards has the keyboard focus.

**Leaving the set.** A set ends when the user clicks on empty canvas, draws
a marquee, selects a connection, opens the context menu of empty canvas or
of a card outside the box, or goes to another canvas. It also ends when
fewer than two of its cards are left.

### Selected connections

One or more connections are selected by a marquee that touches no card. One
is selected by a click on its line, as before.

- Each selected connection shows the selected look of its line. Nothing else
  is shown: no box, no toolbar, no handles.
- **Delete and Backspace** remove every selected connection, as one step of
  undo. The canvas must have the keyboard focus, as for one connection.
  - The connections that end at one card leave its list in one write.
  - A connection that cannot change, such as an input of a generation card
    with its file or of a draft while it generates
    ([reference graph](reference-graph.md#connecting)), stays. The others
    are removed, and the reason is shown once.
  - Undo brings every removed connection back, each entry in its place in
    its list.
- **The context menu** of a selected connection keeps the selection, and its
  **Disconnect** removes every selected connection in the same way. The
  context menu of a connection that is not selected selects that connection
  alone first, as before.
- A click on a connection selects it alone. A click on empty canvas, a
  marquee, selecting a card, and going to another canvas end the selection.
- A selected connection that disappears, because an agent or another view
  removed it, leaves the selection.
- Dragging an end of one of them changes only that connection
  ([canvas connection handles](canvas-connection-handles.md#dragging-an-end-of-a-connection)).

### Moving a set

- A drag that begins anywhere in the set box moves every card of the set by
  the same amount. The box, the toolbar, and the connections follow in
  every frame.
- The toolbar is hidden while the set moves and returns when it is dropped,
  as the controls of a single card do.
- Snap to cards acts on the set box as it acts on one card, and not while a
  folder takes the set
  ([dropping into a folder](canvas-drop-into-folder.md#while-dragging)).
- Near the edge of the scene, inside it, the canvas moves, as when one card
  is dragged. While the pointer is outside the scene, it does not move.
- Let go with the pointer on a folder's card or on a folder of the path, the
  set goes into that folder, as one step of undo; let go outside the scene
  anywhere else, every card goes back to its place
  ([dropping into a folder](canvas-drop-into-folder.md)).
- Escape during the move puts every card back, as for one card. No card
  is left marked as being dragged: a card that was would have no capture
  circles afterwards.
- When the set is dropped it is still the selection, with the same cards.
- The move is saved as one change and is one step of undo. Undo puts every
  card back and leaves the selection as it is.

### Arranging a set

Arrange puts the cards of a set in order. It moves only the cards of the
set, and it never changes a size.

**Order.** The cards are put in rows by their places, and then read row by
row from left to right:

1. Sort the cards by their top edge, and among equal top edges by their
   left edge.
2. The first card begins a row. A card belongs to the row of the card that
   began it when its top edge is above the vertical middle of that card.
   Otherwise it begins the next row.
3. Inside a row, sort by the left edge, and among equal left edges by list
   order.

So cards that stand roughly in a line keep their order from left to right,
also when their top edges differ a little.

**Where it starts.** The upper left corner of the result is the upper left
corner of the set box before the arrangement.

| Choice | Result |
| --- | --- |
| **Row** | One row. The top edges are level. Each card stands one side gap to the right of the card before it. |
| **Column** | One column. The left edges are level. Each card stands one vertical gap below the card before it. |
| **Grid** | As many columns as the square root of the number of cards, rounded up. The cards fill it row by row. A column is as wide as its widest card and a row as high as its highest card. A card stands at the left and the top of its cell. Columns are one side gap apart and rows one vertical gap apart. |

- Cards outside the set are not moved and not looked at. An arranged card
  can come to lie on another card, as a card can that the user drops there.
- The set stays selected and its box follows.
- The arrangement is saved as one change and is one step of undo.
- A card whose place did not change keeps its row as it is.

### Tidying a canvas

**The button.** The view controls at the lower left of the canvas begin
with a **Tidy Canvas** button, before Snap to Cards and the zoom control.
Shift+Alt+F does the same while the keyboard focus is in the canvas and not
in a place for typing, so also while a button of the canvas has it. The
button is disabled while the canvas shows fewer than two cards and while a
generation card waits for the user to pick an input.

**What it moves.** Every card of the canvas that is shown. It does not look
at the selection, and the selection stays as it is. It never changes a
size. A Note that is being edited is closed first, as a click elsewhere
closes it. When it cannot be closed, nothing is tidied.

**The layout** is a function of the cards, their sizes, their connections,
and list order. The same canvas always gets the same result, and tidying a
tidied canvas moves no card.

1. **Groups and singles.** The cards are split into groups and singles.
2. **A connection that closes a circle** is left out of the layout. Going
   through the cards of a group in list order and following each
   connection downstream, a connection that leads back to a card on the
   way there is the one left out. It is still drawn.
3. **Columns of a group.** A card that no connection of the group leads to
   is in the first column. Every other card is one column to the right of
   the rightmost card that leads to it.
4. **Order in a column.** The first column is in list order. In every
   further column a card comes before another when the uppermost card that
   leads to it from the column before stands higher. Among cards with the
   same such card, list order decides.
5. **Places in a group.** A column is as wide as its widest card. Columns
   are one wide gap apart. The cards of a column are stacked with one
   vertical gap between them, with their left edges level. Every column is
   centred on the same horizontal line, so that a card with several cards
   after it stands beside their middle.
6. **The singles** make one grid in list order, built as
   [Arrange builds a grid](#arranging-a-set), but with as many columns as
   the [plain grid](canvas-card-placement.md#terms) has for that number of
   cards.
7. **Blocks.** Each group is a block, and the grid of the singles is a
   block. The groups come first, in the list order of their first cards.
   The grid of the singles comes last. Blocks stand side by side, one wide
   gap apart, with their top edges level. A block begins a new row when the
   row has a block and would become wider than 2400 with it. A new row
   begins at the left, one wide gap below the lowest edge of the row
   above.
8. **Where it starts.** The upper left corner of the result is the upper
   left corner of the smallest rectangle that held all cards before.

**After the layout** is applied:

- The view shows all cards, as Fit to Screen does.
- When at least one card moved, the [question](#keep-or-revert) is asked.
  When no card moved, nothing else happens.
- The tidy is saved as one change and is one step of undo.
- A card whose place did not change keeps its row as it is, and takes no
  part in the change: moving such a card afterwards does not keep undo from
  taking the tidy back.
- Which cards move is decided against the layout as it is saved, not
  against what the canvas draws. The two differ for a moment after an undo,
  and a tidy in that moment still moves every card that the layout has
  elsewhere.

### Keep or revert

After a tidy that moved a card, a small question stands above the Tidy
Canvas button: **Keep this arrangement?** with **Revert** and **Keep**.

- It does not block the canvas. Cards can be selected, moved, edited, and
  created while it is open, and it stays where it is.
- **Keep** closes the question. Nothing else changes.
- **Revert** puts every card that the tidy moved back at the place it had
  before the tidy, and closes the question.
  - A card that the user moved again in the meantime goes back as well.
  - A card that the tidy did not move stays where it is.
  - A card that is no longer on the canvas is passed over, and a card that
    appeared in the meantime stays where it is. A card whose item was
    renamed in the meantime is passed over as well and stays at its tidied
    place.
  - Only places go back. A size that changed in the meantime stays.
  - Each row is again what it was: a place that BaseHalf had chosen is
    again a chosen row.
  - The view goes back to what it showed before the tidy.
  - The revert is one step of undo of its own.
- The question closes, and the result is kept, when the user tidies again,
  also when that tidy moves no card, presses Escape while the question has
  the focus, or leaves the canvas for another folder. Closing or reloading
  the window keeps the result.
- When the question closes while one of its buttons has the keyboard focus,
  the focus goes to the canvas. Undo and the keys of the canvas then work
  without a click.
- Undo of the tidy closes the question, because nothing is left to keep or
  revert. Redo of the tidy does not ask again.
- The question belongs to the view controls and is hidden with them.

### What is saved, and undo

- Selecting saves nothing. The selection is not kept when the window is
  closed and is not a step of undo.
- A card that a move of a set, an arrangement, a tidy, or a revert put at a
  new place has the user's row from then on, as a card has that the user
  dragged. The revert is the exception stated above: it gives a row back as
  it was.
- Each of the four is saved in one write of the layout. No drawing shows a
  part of it.
- A place is saved with the four decimal places that the layout keeps, and
  the change that undo holds has the same numbers. Otherwise undo does not
  find the row it wrote and refuses.
- Rows of the layout that have no card on the canvas are left as they are.
- The four are steps of the canvas's undo, named for what they did. Undo
  and redo move the same cards and leave the selection as it is.

### Keyboard and assistive technology

- The set toolbar is reached and operated by the keyboard as the toolbar of
  a single card is. Arrange opens a menu of three items that the arrow keys,
  Enter, and Escape operate. Opened from the keyboard, the menu starts at
  Grid; opened by a click, it has no current item and shows no focus ring
  until an arrow key chooses one
  ([architecture invariants](../harness/architecture-invariants.md#product-shell)).
- The set box is announced as a group with the number of selected cards.
- Tidy Canvas has a name, and its tooltip shows the key.
- The buttons of the question are reached by Tab. Keep is the default
  button. The question is announced when it appears.
- In a high contrast theme the set box is drawn with its border alone.

### Failures

- **The layout cannot be written.** The cards go back to their saved
  places, and the user is told that the positions could not be saved, as
  when one card cannot be saved. After a tidy that failed, no question is
  asked.
- **The canvas changes while a tidy or an arrangement is worked out**,
  because an item was added, removed, or renamed. The command is worked out
  on the cards that are shown when it is applied. A card that appears a
  moment later gets its place as any new card does and is not part of the
  result.
- **A card of the set is carried to another path** while the set is moved.
  It is saved under the new path, as for one card
  ([following moved items](following-moved-items.md)).

## Not in this version

- A way to add to the selection with a marquee.
- Shift-click on a connection to add it to the selected connections.
- A button on a selected connection that removes it.
- A key that selects every card, and a key that clears the selection.
- A context menu for a set.
- Moving a set with the arrow keys.
- A control on the set box that creates a card downstream of the whole set.
- Groups that are kept, and piles of cards. Public decision D33 keeps
  grouping out until it has a document of its own.
- Aligning or spreading cards without arranging them, and resizing a set.
- A lasso.
- Sharing an arrangement
  ([canvas card placement](canvas-card-placement.md#non-goals)).

## Constraints on the implementation

- **One owner of the selection.** The workbench owns it, as before. The
  marks of the canvas library are a copy of it. The library's own rectangle
  around selected cards is not used, and the library's marking of
  connections during a marquee does not reach the selection.
- **The marquee asks the workbench twice**: once when it begins, to clear
  the selection, and once when the button is released. The outlines in
  between belong to the scene alone.
- **The set box and the set toolbar are worked out from the card
  rectangles** of the drawing in which they are shown.
- **The order, the three arrangements, and the tidy layout are functions
  without services**, so that unit tests cover them with plain numbers.
  So is the test of which lines a marquee crosses: it works from the card
  rectangles, the anchors, and the marquee in flow pixels, with the curve
  the canvas draws, and never reads the drawing.
- **The selected connections are the scene's own**, as the one selected
  connection was. The workbench is asked to clear the selection of cards
  when a marquee begins, and is told of no connection.
- **An arrangement, a tidy, and a revert go through the write that saves a
  move of cards**: one change of the layout and one undo element for all
  cards.
- **What the question needs to revert is kept in the window's memory.**
  Nothing about it is written to disk.

## Acceptance criteria

Selection

1. A marquee over cards with and without connections selects exactly the
   cards it touches. No connection is selected, also one whose line the
   marquee crosses.
2. While a marquee is drawn over a canvas of 300 cards, the most a canvas
   shows, every card it reaches shows the outline in the same frame, and no
   request goes to the workbench between the first movement and the
   release.
3. A marquee that touches one card and a click on that card give the same
   state: the same controls are shown, a double click opens or edits the
   card, and its resize targets and connection handles answer.
4. A marquee that touches no card and crosses no line leaves nothing
   selected.
5. A set made by a marquee and a set of the same cards made by Shift-click
   show the same box and the same toolbar and answer the pointer in the
   same way.
6. In a set, a click or a double click on a card or in a gap of the box
   changes nothing. A click on empty canvas ends the set.
7. A Shift-click on a card of a set of two leaves the other card as the one
   selected card, with the controls of a single card.
8. With Shift held, a drag that begins on a card draws a marquee and does
   not move the card. A Shift-click that moves 3 screen pixels is still a
   Shift-click.
9. A marquee that begins while a Note is being edited closes the Note
   first, and the note's text is as the user left it.

Moving

10. A drag that begins in a gap of the set box moves every card of the set
    by the same amount. After the drop the same cards are selected and the
    box is around them.
11. One undo after that move puts every card back, and the box is around
    them again.
12. Escape during the move puts every card back and saves nothing. When
    the set ends afterwards, its cards have their capture circles.
13. The element at the caption of a card of a set is the box, and a drag
    from there moves the set, which stays selected.
14. The cards of a set have no capture circles, and another card has its
    four.
15. The arrow keys move no card of a set that was made by Shift-click, with
    the focus on its last card.

Arranging

16. Row, Column, and Grid give the places that the rules above give, for
    cards of different sizes. The unit tests state the numbers.
17. An arrangement moves no card outside the set and changes no size.
18. One undo takes an arrangement back. The set is still selected.

Tidying

19. Tidy Canvas with two cards selected moves cards outside the selection
    as well, and the two cards are still selected afterwards.
20. In a group, every connection that is part of the layout runs from a
    column to a column further right.
21. A canvas with two groups and five singles gets the groups side by side
    and the grid of the singles after them.
22. Tidying a tidied canvas moves no card and asks nothing.
23. The question stays open while a card is clicked and while one is moved.
    Revert then puts every card back where it was before the tidy, also the
    card that was moved, and the view is as before.
24. After Revert, a row that was a chosen row before the tidy is one again.
25. Keep closes the question and changes no place.
26. A window that is reloaded while the question is open shows the tidied
    canvas and no question.
27. One undo takes a tidy back and closes the question.
28. After Keep, and after Revert, undo works without a click on the canvas.
29. Shift+Alt+F tidies while the Tidy Canvas button has the keyboard focus,
    and a tidy that moves no card closes a question that is open.

Storage

30. A marquee, a Shift-click, and a click write nothing under `.bh/`, also
    a marquee that selects connections.
31. An arrangement, a tidy, and a revert each write the layout once.

Connections

32. A marquee that touches no card and crosses the lines of two connections
    selects both, and no card. While it is drawn both lines show the selected
    look; a line it leaves loses the look.
33. Delete after criterion 32 removes both connections: each downstream note
    no longer lists its upstream card. One undo brings both back.
34. Two selected connections into the same note leave its list in one write,
    and one undo brings both entries back in their places.
35. With a connection into a generation card with its file and another one
    selected, Delete removes the other one, keeps the first, and shows the
    refusal once.
36. Disconnect in the context menu of one of two selected connections removes
    both.
37. A marquee that crosses a line and then reaches a card marks and selects
    only the card. Drawn back off the card, it marks the line again.
38. The lines a marquee crosses are given by a function that the unit tests
    cover: a line through the marquee, a line with only its end in it, a
    line that curves around the marquee, and a marquee inside the band of a
    line that it does not cross.

## Verification

- Unit tests of the functions for the order, the three arrangements, and
  the tidy layout: cards of different sizes, a group with a circle, a card
  with several cards before it, singles only, groups only, and rows of
  blocks that wrap.
- Unit tests of the function that gives the state for a selection.
- Unit tests of the function that gives the lines a marquee crosses.
- The smoke in the real window, on a fixture workspace with connected and
  unconnected cards. Each step also checks which element is at the pointer,
  because an element can be drawn and still be covered.
- Criterion 2 is measured in the real window on a canvas of 300 cards,
  frame by frame ([measured](#measured-on-2026-10-12)).
- The step `canvas-selection-and-arrangement` of the smoke covers criteria
  1, 3, 5 to 7, 10 to 14, 18, 19, 22 to 25, 27, and 28 on a folder of five
  notes that it writes and removes. It leaves out the capture circles of
  criterion 12, the drag of criterion 13, and Revert of criterion 28.
- The step `canvas-marquee-selects-connections` of the smoke covers criteria
  32 to 34, 36, and 37 with the real pointer.

### Seen in the real window before the change, 2026-10-12

A development window of 1440 × 900 on a fixture workspace outside the
repository: four notes in one folder, `a.md` to `d.md`, and one connection
from `a.md` to `b.md`. Each marquee was drawn with the real pointer, from
empty canvas below the cards up into them.

| The marquee touched | Selected afterwards |
| --- | --- |
| `c.md`, which has no connection | `c.md` |
| `b.md`, the downstream card | no card, and the connection |
| `a.md`, the upstream card | no card, and the connection |
| `a.md` and `b.md` | no card, and the connection |
| `c.md` and `d.md` | both cards |
| all four, with `c.md` and `d.md` reached last | all four cards |

- After the marquee over `c.md` alone, the element at the middle of the card
  was the canvas library's rectangle and not the card. A click there changed
  nothing, and a double click did not open the note for editing.
- After the marquee over `c.md` and `d.md`, a drag from the middle of
  `c.md` moved both cards. Afterwards only `c.md` was selected.

One more fault showed while the change was checked, in the drag of one card,
which this specification does not change. At 77% zoom a card that was
dropped where nothing snaps was saved at `x: 1863.9047`. Undo then changed
nothing: the layout keeps four decimal places, the change that undo held had
the place as the pointer gave it, with more, and so the row on disk did not
match. A card that snapped to another card was not affected, because its
place was a whole number.

### Checked in the real window after the change, 2026-10-12

The same window and workspace, with the real pointer and keyboard.

- Each of the six marquees of the table above selected exactly the cards it
  touched, and no connection.
- While a marquee over two cards was drawn, both showed the outline and
  nothing was selected. After it, no outline was left over.
- A marquee over `c.md` alone and a click on it gave the same state. The
  element at the middle of the card was the card, and a double click opened
  the note for editing.
- In a set, the element over a card was the box. A click on a card and a
  double click in a gap changed nothing.
- A Shift-click on one card of a set of two left the other as the one
  selected card, and a second Shift-click made the same set again.
- A drag from a gap of the box moved both cards by the same amount and no
  other card. The set was still selected, and the box was around the cards.
- Undo put both cards back, with the box around them. Escape during a move
  put them back as well.
- With Shift held, a drag from the middle of `a.md` to `b.md` selected both
  and moved neither.
- A set made by Shift-click and a set made by a marquee had the same box
  and the same toolbar.
- One card that was dropped where nothing snaps went back on undo.
- Arrange, on a set of three cards of a canvas with five: Column, Grid, and
  Row gave the places of the rules, moved no card outside the set, and
  changed no size. The set was still selected with the box around it. A card
  whose place did not change kept the row that BaseHalf had chosen. One undo
  took Column back, and every row was again one that BaseHalf had chosen.
  The menu lay over the set box, and the arrow keys and Enter chose from
  it.
- Tidy Canvas, on a canvas of five cards with one card that leads to two
  others and two singles, two of the cards selected: every card went to the
  place of the rules, the two cards were still selected, every card was in
  view, and the question was asked. With the question open a card was
  selected and another was moved. Revert then put every card back, also the
  one that was moved, every row was again one that BaseHalf had chosen, and
  the view was as before. Undo of a second tidy took it back and closed the
  question. Shift+Alt+F tidied, Keep closed the question and changed no
  place, and tidying the tidied canvas moved no card and asked nothing.
- After Keep, undo took the tidy back without a click on the canvas. With
  the focus on the Tidy Canvas button, Shift+Alt+F tidied, and that tidy,
  which moved no card, closed the open question.
- In a set, the element at the caption of a card was the box, and a drag
  from there moved the set, which stayed selected. The cards of the set had
  no capture circles and another card had its four. After Escape during a
  move and the end of the set, the cards had their circles again.
- The arrow keys moved no card of a set made by Shift-click.
- A marquee that began while the note of `c.md` was being edited closed the
  note and selected the cards it touched. The note held what had been
  typed.
- A marquee, a click, and a Shift-click changed no file under `.bh/`.
- The toolbar of a set read Arrange, Duplicate, Copy Paths, Delete, with no
  number, and stood inside the window.
- The whole smoke passed on the last commit of the change, 129 steps.

### Not run

- Criterion 26. The window was not reloaded while the question was open.
  What the question needs is kept in the window's memory alone, so a
  reloaded window has none of it.
- Criterion 31 was not counted write by write. An arrangement, a tidy, and
  a revert each go through one change of the layout.
- Tidy Canvas being disabled while a video card waits for an input, and the
  look of the box and the question in a light and in a high contrast theme,
  were not looked at in the window.

### Reviewed on 2026-10-12

A second reader went through the change against this specification without
running it, and tested the layout functions on 4,000 random canvases. What
it found is fixed and is in the rules above: a caption outside the box, from
which a set could still be dragged and then lost all cards but one; capture
circles of a set's cards that reached outside the box; the keyboard focus
that fell to the window when the question closed; the key that a focused
button kept; a connection line released on the box; a card left marked as
dragged after Escape; a marquee released before the selection was cleared;
and a canvas moved by the wheel under a marquee.

The step of the smoke then found one more: a tidy right after an undo moved
nothing, because it compared the new places with what the canvas still
drew. It now compares them with the layout.

### Measured on 2026-10-12

A development window of 1440 × 900 on a display of 120 Hz, so that a frame
is 8.3 ms. The canvas held 300 notes, 30 of them with a connection, at 20%
zoom, the smallest. 242 cards were in the view, and those are the cards
that the marquee and the set below hold. The pointer was the real one, and
the time between frames was taken inside the window.

| What was done | Frames | Median | 95 of 100 below | Longest | Over 50 ms |
| --- | --- | --- | --- | --- | --- |
| A marquee drawn across all 242 cards in two seconds | 536 | 8.3 ms | 16.6 ms | 33.5 ms | none |
| The set of 242 cards moved for one second | 189 | 8.3 ms | 9.4 ms | 58.3 ms | one |

- The outlines grew with the marquee, up to 227 cards in a frame before the
  release. The cards get the outline in the handler of the pointer's move,
  before the frame is drawn, and the workbench is asked only when the
  marquee begins and when the button is released.
- Arrange in a grid: the layout was saved 52 ms after the click.
- Tidy Canvas on all 300 cards: the layout was saved after 51 ms and the
  question stood after 288 ms. Two frames were longer than 50 ms, the
  longest 100 ms. Revert gave the layout back as it was.

## Specifications this changes

- [Canvas card placement](canvas-card-placement.md): the tidy command it
  left open is the one specified here, and the rows it writes are the
  user's.
- [Canvas wheel gestures](canvas-wheel-gestures.md): a wheel gesture that
  begins on a set box moves the canvas.
- [Canvas connection handles](canvas-connection-handles.md): the cards of a
  set show no handles, and their capture circles are under the set box.
- [Reference graph](reference-graph.md#reference-edits): several entries
  leave one store in one write (2026-10-25).

## Open questions

None that block implementation.
