# The keys of the canvas

Status: Active (2026-11-21)
Decision: [D146](../decisions.md#d146--the-keys-of-the-canvas-are-commands-and-keyboard-shortcuts-opens-over-the-canvas-new-2026-11-21)
Related: [the commands and menus BaseHalf has](commands-and-menus.md)
(Keyboard Shortcuts and the Command Palette),
[canvas selection and arrangement](canvas-selection-and-arrangement.md)
(what moving, duplicating, deleting, and Tidy Canvas do),
[canvas card name](canvas-card-name.md) (the rename editor),
[a code file on its card](code-cards.md) (editing on the card),
[opening and closing Card Detail](card-detail-opening.md) (Escape),
[exact undo](exact-undo.md) (what a delete keeps)

This specification owns which keys the canvas has, as commands: their names,
their default keys, and where each key acts. What a command does is owned by
the specification of what it changes, linked above. How Keyboard Shortcuts
lists commands and where it opens is owned by
[the commands and menus BaseHalf has](commands-and-menus.md).

## Problem

Read in the code and pressed in the real window on 2026-11-21:

- **The keys of the canvas were in no list.** Seven listeners of the page
  compared each key press with keys written into the code: one of the scene,
  one of the canvas view, one of each card, and four of the features. Only
  two rules of BaseHalf's were in the base's list of keys, both for closing
  what is open.
- **No key could be changed.** Keyboard Shortcuts listed none of them, so a
  user could not give Tidy Canvas another key, or take Delete away from the
  cards.
- **The zoom keys were written twice**, in the canvas view and again in the
  menu of the zoom control, which stands outside the canvas.

## Terms

- **The canvas has the keyboard**: the element with the keyboard focus is
  in the canvas area, and Card Detail is closed.
- **A place for text**: a field, a text area, an editor of code, or text
  that is edited in place, as a note on its card.
- **A control**: a button, a field, a link, a player, a slider, a connection
  handle, a toolbar, a panel under a card, or anything else on a card that
  takes a press for itself.

## Which keys are commands

One rule decides:

- **A key that acts on the canvas or on its selection is a command.** It has
  a name, it is in Keyboard Shortcuts, and a user can give it another key or
  none.
- **A key inside a control stays the control's.** The arrow keys, Home, End,
  Enter, and Space of a toolbar or a menu, what is typed into a field, the
  keys of the editor of a note or of a code card, the keys of a player, and
  Enter or Space on a connection handle are not commands. The editor of a
  note on its card has a key of its own for its toolbar, Alt+F10, with its
  other keys.
- **Escape stays with what is open or under way.** It ends, innermost first,
  a connection or a drag that is being made, a menu, a field, an editor on a
  card, the selection of the card that has the keyboard, and Card Detail
  ([opening and closing Card Detail](card-detail-opening.md#the-keyboard)).
  Each of these takes Escape from the element it is on, and one command
  could not stand for them. Close Card Detail is a command with a key of its
  own.
- Undo, Redo, Cut, Copy, and Paste are the base's commands, and the canvas
  answers them ([exact undo](exact-undo.md),
  [copy, paste, and drop](copy-paste-and-drop.md)).

## The commands

Every command is in the category BaseHalf. "Cmd" is the system's command
key: Command, or Control where the system has no Command key.

| Command | Default keys | Where the key acts |
| --- | --- | --- |
| Zoom Canvas In | Cmd+=, Cmd+Shift+=, Cmd+NumPad + | the canvas has the keyboard, wherever in it |
| Zoom Canvas Out | Cmd+-, Cmd+Shift+-, Cmd+NumPad - | the same |
| Zoom Canvas to 100% | Cmd+0, Cmd+NumPad 0 | the same |
| Fit Canvas to Screen | none | |
| Tidy Canvas | Shift+Alt+F | the canvas has the keyboard, outside a place for text |
| Move Card Left, Right, Up, Down | Left, Right, Up, Down | one card is selected, and the keyboard is on that card or on the blank canvas; not while a generation card waits for a pick |
| Move Card Left by 10, Right by 10, Up by 10, Down by 10 | Shift with the arrow key | the same |
| Duplicate Selected Cards | Cmd+D | cards are selected, and the keyboard is on the canvas outside a control, or in the toolbar of the selection |
| Delete Selected Cards or Connections | Delete, Backspace, and Command+Backspace on a system with a Command key | cards are selected, in the same places; or connections are selected and the keyboard is on the blank canvas or on a selected connection |
| Rename Card | F2 | the keyboard is on a card itself |
| Open Card | Enter | the keyboard is on a card itself; or one code card is selected and the keyboard is on the canvas outside a control |
| Select Card | Space | the keyboard is on a card itself |
| Focus Card Toolbar | Alt+F10 | the keyboard is in the selected image or video card, on the card or on anything of it |

- **Zoom.** The three keys are the keys that zoom the window. While the
  canvas has the keyboard they zoom the canvas, also from a note or a code
  card that is edited there; anywhere else they zoom the window. Each
  command has every key the window's command has: Zoom Canvas Out had no
  Cmd+Shift+-, so on the canvas Cmd+Shift+= zoomed the canvas in and
  Cmd+Shift+- zoomed the window out (D150). On a system where the base
  gives Control+Shift+- to Go Forward, the window's zoom has no such key;
  BaseHalf is released for a system where it has.
- **Fit Canvas to Screen** is what the menu of the zoom control does. It had
  no key, and has none until a user gives it one.
- **Move Card** moves by one pixel of the canvas at 100%, **by 10** by ten.
  A set of cards is not moved by keys: while two or more cards are selected,
  the arrow keys do nothing on the canvas and on its cards.
- **Open Card** does what Enter did: a file opens in Card Detail, a note or
  a code card is edited on its card, and a draft is selected.
- **Focus Card Toolbar** moves the keyboard to the first button of the
  toolbar that stands by the card.
- A key that is held with a modifier the table does not name is not the
  command's. Before the keys were commands, the listeners compared less:
  on a system with a Command key, Control+= zoomed the canvas and Control+D
  duplicated, as Command does; Shift+Command+D duplicated; and F2, Enter,
  Space, Delete, and Backspace acted with any modifier held. These run
  nothing of the canvas now. Command+Backspace, which deletes in a file
  manager and in Files, is kept as a key of the delete.

### Nothing changes at the default keys

Each default key acts where it acted before it was a command, and nowhere
else:

- A letter, a digit, Space, Enter, Delete, Backspace, or an arrow key typed
  into a note on its card, into the name of a card, into a code card, into
  the prompt under a generation card, into the prompt of a badge, or into
  the field of the zoom control goes to the text.
- The editor of a card's name keeps every key, as it did: while a name is
  edited the canvas does not have the keyboard, so the zoom keys zoom
  neither the canvas nor the window.
- A key pressed in a toolbar, in a menu, or on a button of a card is the
  control's.
- While Card Detail is open, no key of the table acts on the canvas under
  it.
- With the keyboard outside the canvas, in Files, in Search, in the Agent
  Area, in the Command Palette, or in an overlay, no key of the table acts
  on the canvas.

### Changing a key

- Keyboard Shortcuts lists each command under its name, with its key and
  the condition it has. A user gives a command another key, a second key, or
  none, there or in the key bindings file.
- The changed key acts at once, in the places of the table. The key it had
  is free: it does what comes after it, or nothing.
- A key that the user gives to a command acts before the control it is
  pressed on only in the places of the table; a place for text keeps what is
  typed.
- The menu of the zoom control shows the keys the three zoom commands have
  now, and takes them while it has the keyboard. The tooltip of Tidy Canvas
  shows the key Tidy Canvas has now. A command without a key shows none.
- The arrow keys never reach the canvas library, which would move the
  selected cards by its own steps: where Move Card acts, an arrow key that
  the user took from it does nothing. Nor do they reach it from the frame
  the library draws around the one selected card, where the Tab key can put
  the keyboard: there they do nothing (D149).

### The Command Palette

The palette lists a command where running it from a list makes sense: the
four of the view (Zoom Canvas In, Out, to 100%, Fit Canvas to Screen), Tidy
Canvas, Duplicate Selected Cards, Delete Selected Cards or Connections, and
Rename Card. It lists them while a canvas is shown and Card Detail is
closed; the two of the selection while cards or connections are selected;
Rename Card while one card is selected. Run from the palette, a command
acts on the selection.

Move Card, Open Card, Select Card, and Focus Card Toolbar are not in the
palette: they act on the card that has the keyboard, and the palette takes
the keyboard.

## Required behavior

1. **One table.** The commands, their default keys, and their conditions
   are data (`BASEHALF_CANVAS_KEY_COMMANDS`). Each is registered with the
   base's commands and key bindings from that table, in the category
   BaseHalf.
2. **The canvas says where the keyboard is.** Context keys tell the base's
   key bindings what the conditions need:
   - `basehalfCanvasFocus`: the canvas has the keyboard, and no name is
     being edited.
   - `basehalfCanvasKeyboardOn`: what in the canvas has it: `canvas` (the
     blank canvas), `card` (a card itself), `insideCard` (something of a
     card that is no control), `connection` (a selected connection),
     `toolbar` (the toolbar of the selection), `control`, `scene`
     (elsewhere among the cards), or `frame` (the rest of the canvas area).
   - `basehalfCanvasTextFocus`: the keyboard is in a place for text.
   - `basehalfCanvasSelectedCards`: how many cards are selected.
   - `basehalfCanvasConnectionsSelected`: connections are selected.
   - `basehalfCanvasKeyboardOnSelectedCard`: the card that has the keyboard
     is the one selected card.
   - `basehalfCanvasSelectedCardEditsOnCard`: the one selected card is a
     code card that is edited on its card.
   - `basehalfCanvasPicking`: a generation card waits for a pick.
   - `basehalfCanvasKeyboardByToolbar`: the keyboard is where Focus Card
     Toolbar acts.
3. **The conditions are true at the key press.** The canvas works them out
   from the element that has the keyboard and from the selection as the
   scene holds it, before the key is looked up. They are never one drawing
   behind.
4. **A command's key acts before the controls of the canvas**, as the keys
   did: the canvas looks the key up when it enters the canvas area, and
   when the key is a command of the table whose condition holds, the
   command runs and nothing else of the page receives the key. Open Card
   and Select Card let the key go on to the canvas library, which selects
   the card as it did.
5. **A key of the table whose condition does not hold** is not the
   canvas's: the control it is pressed on receives it, then the base's key
   bindings.
6. An input method's keys are never looked up.
7. The repeats of a key that is held do nothing on the canvas once the
   keyboard is on another element than the one the key went down on, but
   for Tab and the arrow keys
   ([where the keyboard returns](keyboard-return.md#a-key-that-is-held)).

## Implementation boundaries

- `canvas/common/basehalfCanvasKeys.ts`: the table, the context keys, the
  conditions, and the pure rule that turns where the keyboard is and what is
  selected into the values of the context keys. It names no element.
- `canvas/browser/basehalfCanvasKeys.contribution.ts`: registers the
  commands of the table.
- `canvas/browser/view/basehalfCanvasKeys.ts`, the part `keys` of the canvas
  view: reads where the keyboard is from the page, sets the context keys,
  looks the key up, and runs a command on the card that has the keyboard or
  on the selection. The scene tells it the selection and takes Move Card,
  Duplicate, and Delete (`IBaseHalfCanvasSceneKeys`).
- A feature of the canvas runs its own command: Tidy Canvas gives its
  command to the canvas view (`IBaseHalfCanvasView.registerCommand`). The
  zoom control asks the base's key bindings for the keys of the three zoom
  commands, for its menu's labels and for the keys the menu takes.
- The canvas view keeps one rule of keys that is no command: the arrow keys
  that it stops before the canvas library (`baseHalfCanvasStopsArrowKey`).
- No listener of the canvas compares a key with a key of the table any
  more: the scene, the cards, the canvas view, Tidy Canvas, and code cards
  had one each.
- No change in a file of the base: the base's key bindings are asked
  through `IKeybindingService`.

## Acceptance criteria

1. Keyboard Shortcuts, with `basehalf canvas` or a command's name typed,
   lists the commands of the table under BaseHalf, each with its default
   keys.
2. With one card selected, each key of the table does what the table says;
   with the keyboard in a note edited on its card, in a card's name, in a
   code card, in the prompt of a draft, in the prompt of a badge, and in
   the field of the zoom control, the keys other than the three of zoom
   change nothing of the canvas: no card moves, none is duplicated,
   deleted, or renamed, and what was typed is in the text.
3. Cmd+= zooms the canvas with the keyboard on the canvas, also in a note
   edited on its card, and zooms the window with the keyboard in Files.
4. With Card Detail open, no key of the table changes the canvas under it.
5. A key pressed in the real window before the keys were commands and after
   does the same in each of these places: the blank canvas; a selected
   note, video, and code card; two selected cards; a selected connection; a
   card with the keyboard that is not selected; the toolbar of a note, of a
   code card, of a video, and of two cards; a card's name, a note, and a
   code card being edited; the prompt of a draft and of a badge; the Tidy
   Canvas button; the menu of the zoom control; Card Detail with a note, a
   code file, and a video; Files; and Quick Open.
6. Tidy Canvas given another key in Keyboard Shortcuts tidies at that key
   at once, and Shift+Alt+F tidies no more; the tooltip of the button shows
   the new key.
7. Delete Selected Cards or Connections with its keys removed: Delete with
   a card selected deletes nothing.
8. Move Card Left with its key removed: Left with one card selected and
   the keyboard on it moves nothing.
9. The Command Palette lists Zoom Canvas In, Zoom Canvas Out, Zoom Canvas
   to 100%, Fit Canvas to Screen, and Tidy Canvas under BaseHalf while a
   canvas is shown, and each runs from there.
10. A unit test holds, for each command, where its condition is true, and
    fails when a command has no name, no condition where it has a key, or a
    key that another command of the table has under a condition that can
    hold with it.

## Verification

- Unit tests of the table and the rule (`basehalfCanvasKeys.test.ts`):
  where each command's key acts over 28 places, that no key has two commands
  in one place, the commands with their default keys, and the arrow keys the
  canvas view stops. Tidy Canvas runs as the feature's command
  (`basehalfCanvasTidy.contribution.test.ts`).
- The smoke's canvas suites press the default keys (zoom in the zoom menu,
  Delete, F2, Enter, Escape, Shift+Alt+F) and are unchanged. A step of the
  workbench suite, `canvas-keys-are-commands`, reads the commands in
  Keyboard Shortcuts, gives Zoom Canvas In a key in the key bindings file,
  presses it, and takes it away again.
- Run in the real window on 2026-11-21 for criterion 5, before any code
  changed and after, with the real keyboard (`page.keyboard`): 19 keys (the
  four of zoom, the arrow keys and one with Shift, the duplicate key, Delete,
  Backspace, F2, Enter, Space, Shift+Alt+F, Alt+F10, Escape, and a letter) in
  27 places, 511 presses: Enter and Space were not pressed in the toolbar
  of a video, where they would capture a frame. For each press, what changed
  was written down: the
  zoom of the canvas and of the window, the cards and their places, the
  selection, the connections, Card Detail, the element with the keyboard,
  the text under the caret, the editors on cards, the question of Tidy
  Canvas, menus, Quick Open, dialogs, and the files of the folder. 510
  presses changed the same before and after. One differed in a class of the
  note's editor that hides its selection while it takes the keyboard, which
  comes and goes with the moment of the reading.
- The places: the blank canvas; a selected note, video, and code card; two
  selected cards; a selected connection; a note, a code, a video, and a
  draft card that has the keyboard and is not selected; a card with the
  keyboard while another is selected; the toolbar of a note, a code card, a
  video, and two cards; a card's name, a note, and a code card being edited;
  the prompt of a draft and of a badge; the Tidy Canvas button; the field
  of the zoom menu; Card Detail with a code file in Source, and with a note
  and a video while Files has the keyboard; Files; and Quick Open.
- What the first run showed and the code had not said: the editor of a
  card's name keeps every key, so the zoom keys do nothing there; and after
  Escape ends the editing of a note on its card the keyboard is on the page
  itself, where the zoom keys zoom the window. Since D149 the keyboard is
  on the card then ([where the keyboard returns](keyboard-return.md)).
- Run in the real window for the keys with other modifiers, in five places,
  before and after: the 21 presses that differ are the ones "The commands"
  names: Control+=, Control+D, and Shift+Command+D act no more, nor F2,
  Enter, Space, and Delete with Shift or Command held. With Shift, Enter and
  Space now only reach the canvas library, which adds the card to the
  selection or takes it out. Command+Backspace deletes as before.
- Run in the real window for criteria 1 and 6 to 9: Keyboard Shortcuts
  listed the nineteen commands by their names with their keys; Tidy Canvas
  given Alt+T there tidied at Alt+T, did not at Shift+Alt+F, typed in a note
  edited on its card, and the tooltip read "Tidy Canvas (⌥T)"; with the
  keys of the delete and of Move Card Left removed in the key bindings file,
  Delete and Backspace deleted nothing and Left moved nothing while Right
  moved the card; Zoom Canvas In given Alt+Z zoomed at once, the menu of the
  zoom control read "Zoom In ⌥Z" and took the key; Fit Canvas to Screen
  given Alt+G fitted; the palette listed the five commands of the view, and
  with a card selected the three of the selection; Zoom Canvas In, Rename
  Card, and Duplicate Selected Cards ran from it; it listed no Move Card and
  no Open Card.
