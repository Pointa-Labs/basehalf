# Where the keyboard returns

Status: Active (2026-11-21)
Decision: [D149](../decisions.md#d149--the-keyboard-is-always-somewhere-that-answers-new-2026-11-21)
Related: [the keys of the canvas](canvas-keys.md) (the commands, and the
context keys that say where the keyboard is),
[opening and closing Card Detail](card-detail-opening.md#the-keyboard)
(what takes the keyboard in Card Detail),
[canvas card name](canvas-card-name.md) (the editor of a name),
[generation cards](generation-cards.md) (the panel under a card),
[Agent Area terminal](agent-area-terminal.md) (the sessions),
[BaseHalf's Settings](settings-pages.md) and
[the commands and menus BaseHalf has](commands-and-menus.md#keyboard-shortcuts)
(the overlay),
[screen reader mode](screen-reader-mode.md),
[architecture invariants](../harness/architecture-invariants.md#product-shell)
(rings are for the keyboard)

This specification owns where the keyboard is after what had it goes away:
an overlay, Card Detail, an editor on a card, a menu, a field, a name, a
card, a session. What each of these does while it is open is owned by its
own specification.

## Problem

The keys of the canvas are commands that act where the canvas has the
keyboard (D146). Measured in the real window on 2026-11-21, with the real
keyboard and the real pointer, the keyboard was often on nothing a user can
see after something closed. Command+= tells: it zooms the canvas where the
canvas has the keyboard, and the whole window elsewhere.

| What closed | Where the keyboard was afterwards | Command+= zoomed |
| --- | --- | --- |
| Nothing: a window that just opened | the empty editor group under the canvas | the window |
| Settings, by Escape, by its close button, by a press beside it, opened by its key or from the gear's menu; the keyboard had been on a card or on the blank canvas | the empty editor group under the canvas | the window |
| The advanced list; Keyboard Shortcuts | the same | the window |
| Settings over Card Detail of an image or of a note | the same: Escape no longer closed Card Detail, and a letter went nowhere | the window |
| Settings opened with the keyboard on a row of Files, or in a terminal of the Agent Area | the row, the terminal | (as there) |
| The Command Palette or Quick Open, dismissed; a command run from the palette | the card that had it, with a ring | the canvas |
| The Command Palette, opened after Settings had closed | the empty editor group again | the window |
| Card Detail of an image, by Escape, its close button, Go Back, or Command+W; of a note, by Escape in its editor | the blank canvas, with the card still selected | the canvas |
| A note edited on its card, by Escape | the page itself | the window |
| A note or a code card edited on its card, by a press on the blank canvas | the blank canvas | the canvas |
| A code card edited on its card, by Escape or Command+W | the card | the canvas |
| A card's name, by Enter with the same or a new name, or by Escape | the blank canvas, no card selected | the canvas |
| The Create menu, a context menu of the canvas or of a card, by Escape | the blank canvas | the canvas |
| The menu of the zoom control, by Escape | its button | the canvas |
| A press on a button of the canvas or of a note's toolbar | the button; the card | the canvas |
| The prompt of a draft, by Escape | the frame the canvas library draws around the card; the arrow keys there moved the card by 5 and 20 where Move Card moves it by 1 and 10 | the canvas |
| That frame, by Escape again | the page itself | the window |
| A card, or a draft, deleted with the keyboard on it; Delete Selected Cards run from the palette | the page itself | the window |
| A session of the Agent Area that had the keyboard, ended by `exit`, with another session left or none | the page itself | the window |
| The window, brought back to the front from another application | where it was, the empty editor group included | (as there) |

So three places took the keyboard that answer nothing:

- **The empty editor group under the canvas.** The base returns the keyboard
  to its editor area when an overlay closes over it, and when a window opens.
  In BaseHalf the canvas lies over that area, and what is under it is an
  empty group no one sees.
- **The page itself.** The browser puts the keyboard there when the element
  that had it is taken away: the editor of a note, a deleted card, the
  terminal of a session that ended.
- **The frame the canvas library draws around a card**, which no key of the
  canvas knows: there the library moved the card by its own steps.

A key pressed in the first two did nothing, or acted on the window. With the
keyboard on the empty group, Delete, Backspace, Enter, and the arrow keys
did nothing with a card selected, and Command+=, Command+-, and Command+0
zoomed the window.

## The rule

**The keyboard is always somewhere that answers.** When what had the
keyboard goes away and nothing else took it, the keyboard returns to where
it was before, when that is still there, and otherwise to the canvas. It is
never on the page itself, and never on a part the user cannot see.

### What takes it

When the keyboard is on the page itself or on the empty editor group under
the canvas, the first of these that is there takes it:

1. A dialog that is open keeps what it has: nothing under it takes the
   keyboard.
2. An overlay that is open: its own content.
3. An editor of the base that is shown over the canvas, such as the
   multi-file diff.
4. Card Detail, when it is open: what it shows, as when it opened
   ([opening and closing Card Detail](card-detail-opening.md#the-keyboard)).
   A note keeps its caret.
5. The card that last had the keyboard on this canvas, when the canvas
   still shows it.
6. The canvas itself.

### The card that last had the keyboard

- The canvas remembers one place: a card, or the canvas itself.
- A card is the place when the keyboard is on the card, in something of it
  that is no control (its note or its code being edited, its name), or on
  the frame the canvas library draws around it.
- The canvas itself is the place when the keyboard is on the blank canvas,
  as after a press there.
- A toolbar, a menu, a button, a field of the canvas, and a connection
  change nothing: the place is what it was before the keyboard went there.
- A card that is renamed or moved to another name is still the place. A
  card that is deleted, or that the shown canvas does not hold, is not: the
  canvas is.
- Another part of the window that takes the keyboard, such as Files or the
  Agent Area, changes nothing either. When the keyboard later has nowhere
  to go, it comes to where it last was on the canvas.

### Each closing

- **An overlay** (BaseHalf's Settings, the advanced list, Keyboard
  Shortcuts, a document over the canvas). The keyboard returns to the card
  that had it, to the blank canvas, or to Card Detail under the overlay.
  When it had been outside the canvas area, in Files or in the Agent Area,
  it returns there, as the base does.
- **The Command Palette, Quick Open, a context menu, a menu of the title
  bar.** The base returns the keyboard to the element that had it. When that
  element is the empty editor group or is gone, the rule takes over.
- **Card Detail.** When it closes with the keyboard in it, the card of its
  file takes the keyboard, when the canvas shows that card, and otherwise
  the canvas. A file opened from Files with the keyboard left there keeps
  the keyboard there.
- **A note or a code card edited on its card.** Escape, and Command+W on a
  code card, leave the keyboard on the card, which stays selected. A press
  elsewhere puts the keyboard where the press lands.
- **A card's name.** After Enter and after Escape the keyboard is on the
  card whose name was edited. No card is selected, as before
  ([canvas card name](canvas-card-name.md#the-editor-in-place)). A press
  outside the editor puts the keyboard where it lands.
- **The Create menu and a context menu of the canvas.** After Escape the
  keyboard is at the place the canvas remembers: the card that had it, or
  the blank canvas.
- **The menu of the zoom control, and any menu a button opens.** After
  Escape the keyboard is on the button, as before.
- **The panel under a generation card.** Escape in it leaves the keyboard
  on the card itself, not on the library's frame.
- **A card that is deleted while it has the keyboard**, by its key, from a
  menu, from the palette, or outside BaseHalf. The canvas takes the
  keyboard.
- **A session of the Agent Area that ends while it has the keyboard.** The
  session that comes to the front takes it. With no session left, the rule
  takes over.
- **A window that opens** has the keyboard on the canvas when a canvas is
  shown and nothing else has taken it.
- **A window that comes back to the front** has the keyboard where it was.

### Not taking the keyboard

- The rule acts only when the keyboard is on the page itself or on the empty
  editor group. A field the user pressed into, a terminal, Files, a dialog,
  a menu, the Command Palette, Card Detail's own editor, and an agent's
  session keep it.
- What asks for the keyboard after the rule acted gets it: a new note whose
  editor opens a moment after its menu closed, Card Detail once it is
  drawn. The rule never takes the keyboard back from them.
- Giving a card or the canvas the keyboard moves nothing: the canvas keeps
  its place and its zoom, and no part of the window scrolls.
- The canvas itself draws no ring. A card that takes the keyboard after a
  key shows the ring it shows when the keyboard reaches it otherwise; after
  a press of the pointer it shows none
  ([architecture invariants](../harness/architecture-invariants.md#product-shell)).
- A window that is not in front takes no keyboard from another
  application: the place is ready when it comes to the front.

### A key that is held

A key that is still held when the keyboard moves does not act where the
keyboard arrives: Enter held to accept a name does not open the card, and
Escape held to close an overlay does not end the selection. The repeats of
a held key do nothing on the canvas once the keyboard is on another element
than the one the key went down on. Tab and the arrow keys are not held back:
they move the keyboard themselves.

A key pressed anew acts where the keyboard is. With a card selected and the
keyboard returned to it, Delete and Backspace delete the card, as they do
after the Command Palette closes; undo brings it back
([exact undo](exact-undo.md)).

### The frame the canvas library draws

Nothing of BaseHalf puts the keyboard on the frame. Where the Tab key puts
it there, the arrow keys do not reach the library while that card is
selected ([the keys of the canvas](canvas-keys.md#changing-a-key)).

### Screen reader mode

The rule is the same in [screen reader mode](screen-reader-mode.md). What
takes the keyboard has a name: a card is announced by its name ("First
image card"), the canvas itself as "Canvas", Card Detail by what it shows.
The empty editor group ("Editor Group 1 (empty)") is no longer where a
closing ends.

## Implementation boundaries

- `canvas/common/basehalfCanvasKeyboardHome.ts`: the pure rules. What takes
  the keyboard (`baseHalfKeyboardReturnsTo`), the place the canvas remembers
  (`baseHalfCanvasKeyboardPlaceAfter`), and whether a held key is held back
  (`baseHalfCanvasHoldsBackRepeat`). It names no element.
- `canvas/browser/view/basehalfCanvasKeyboardHome.ts`, the part
  `keyboardHome` of the canvas view: remembers the place, hears the two
  events that put the keyboard nowhere, and gives it by the rule.
  - The keyboard on the page itself: the browser tells every element that
    loses the keyboard to nothing (`focusout` without a related element),
    also when the element is taken away, hidden, or disabled (measured in
    this build's browser). The part looks once the code that removed the
    element has run, and acts only when the keyboard is still on the page.
  - The keyboard on the empty editor group: the group is told it has the
    keyboard (`focusin`), and hands it on at once.
  - A key pressed while the keyboard is on the page itself, should that
    still happen, sends the keyboard by the rule before the key is looked
    up.
- No change in a file of the base. The base's own returns (the overlay's,
  the palette's, a menu's) stay as they are; the part acts on where they
  end.
- The closings of the canvas ask the part instead of naming an element:
  Card Detail, the editor of a note, the editor of a name, the Create menu
  and the context menus, Tidy Canvas, and `IBaseHalfCanvasView.focus` and
  `focusCard` for the features.
- The Agent Area gives the keyboard to the session in front when the
  session that had it ends (`agentArea/browser`).
- The scene element has the role of a group and the name "Canvas".

## Acceptance criteria

1. **A window that opens.** With a folder open, the keyboard is on the
   canvas, and Command+= zooms the canvas.
2. **Settings.** With the keyboard on a selected card: Command+, and
   Escape; its close button; a press beside it; opened from the gear's
   menu. Each time the keyboard is on that card, the card is selected, and
   Command+= zooms the canvas. With the keyboard on the blank canvas, it is
   on the blank canvas afterwards.
3. **The advanced list and Keyboard Shortcuts**: the same as 2.
4. **An overlay over Card Detail.** Settings over Card Detail of an image
   and of a note, Escape: the keyboard is in Card Detail, a letter goes into
   the note at its caret, and Escape closes Card Detail.
5. **An overlay over Files and over a terminal**: the keyboard is on the
   row and in the terminal afterwards.
6. **The Command Palette.** Dismissed, and after a command: the keyboard is
   where it was. Opened in a window that just opened and dismissed: the
   keyboard is on the canvas.
7. **Card Detail.** Opened from a card and closed by Escape, by its close
   button, by Go Back, and by Command+W: the keyboard is on that card, and
   Enter opens it again. Opened from Files and closed by its close button:
   the keyboard is on the card of the file.
8. **A note edited on its card.** Escape: the keyboard is on the card, the
   card is selected, Command+= zooms the canvas, and Enter edits the note
   again. A press on the blank canvas: the keyboard is on the blank canvas.
9. **A code card edited on its card.** Escape and Command+W: the keyboard
   is on the card.
10. **A card's name.** F2, then Enter with the same name, Enter with a new
    name, and Escape: the keyboard is on the card whose name was edited, no
    card is selected, and F2 opens the editor again. Enter held until it
    repeats opens nothing.
11. **Menus.** The Create menu from its button and from a double click, a
    context menu of the blank canvas and of a card, each closed by Escape:
    the keyboard is on the card that had it, or on the blank canvas. The
    menu of the zoom control, by Escape: on its button.
12. **A deleted card.** A card and a draft deleted with the keyboard on
    them, and Delete Selected Cards run from the palette: the keyboard is on
    the canvas, Command+= zooms the canvas, and Command+Z brings the card
    back.
13. **The panel of a draft.** Escape in the prompt: the keyboard is on the
    card itself. The arrow keys move the card by Move Card's steps. Escape
    again ends the selection and leaves the keyboard on the card.
14. **The Agent Area.** A session that has the keyboard ends with another
    left: the keyboard is in the session in front. The last one ends: the
    keyboard is on the canvas.
15. **The window comes back to the front**: the keyboard is where it was.
16. **Nothing is taken.** A new note made from the Create menu takes the
    keyboard in its title, and what is typed at once is in the note. A
    press into Files, into a terminal, and into the prompt of a draft
    leaves the keyboard there.
17. **Nothing moves.** With the card that has the keyboard moved out of
    view by moving the canvas, Settings and Escape: the canvas has the same
    place and zoom, and no element of the window has scrolled.
18. **Rings.** After a closing by the pointer (a close button, a press
    beside an overlay), the element with the keyboard draws no ring. The
    canvas itself draws none after a closing by a key.
19. **A key pressed after a closing** acts as it acts there otherwise: a
    letter does nothing, and with a card selected Backspace deletes it and
    Command+Z brings it back. Escape held through the closing of an overlay
    leaves the card selected.
20. A unit test holds what takes the keyboard for each case of "What takes
    it", the place the canvas remembers after each place the keyboard can
    be, and which repeats of a held key are held back.

## Verification

- Unit tests of the rules (`basehalfCanvasKeyboardHome.test.ts`).
- The smoke's canvas suite: a step, `keyboard-returns-to-canvas`, opens and
  closes Settings over a selected card and reads the element with the
  keyboard and the canvas's zoom after Command+=; ends a note's editing by
  Escape and reads the same.
- In the real window, every row of the table of "Problem" again, with the
  real keyboard and the real pointer: the element with the keyboard, what
  Command+= zooms, the selection, and the ring.
