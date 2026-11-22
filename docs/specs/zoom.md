# Each part zooms by itself

Status: Active (2026-11-22)
Decision: [D153](../decisions.md#d153--each-part-of-the-window-zooms-by-itself-new-2026-11-22)
Related: [the keys of the canvas](canvas-keys.md) (Zoom Canvas In, Out, and
to 100%), [Agent Area terminal](agent-area-terminal.md) (the terminal's
font), [PDFs and books](documents-and-books.md) (the zoom of a PDF and the
text of a book), [BaseHalf's Settings](settings-pages.md) (the rows of Zoom
and Font Size), [canvas wheel gestures](canvas-wheel-gestures.md) (a pinch
and the wheel on the canvas)

This specification owns which zoom the keys that zoom change, and what each
zoom leaves as it is. What the canvas's zoom control, a PDF's zoom, and a
book's text size look like and do is owned by the specifications linked
above.

## Problem

Pressed in the real window on 2026-11-22, with the window at 100%:

- **The Agent Area had no zoom of its own.** With the keyboard in a terminal
  of the Agent Area, Cmd+= zoomed the window to 120%: the text of the
  terminal, the canvas's cards, Files, and every bar of the window grew
  together. A card on the canvas went from 600 to 720 pixels of the screen
  and the Sidebar from 592 to 710. To read an agent's answer larger, the
  whole window had to grow.
- **The window's zoom changed the canvas.** The canvas had its own zoom keys,
  but the window's zoom, from Files, from Settings, or from the menu, drew
  every card larger on top of the canvas's zoom. A card at the canvas's 100%
  had a size of its own for each zoom of the window, and the zoom control
  still said 100%.

## Terms

- **The window's zoom**: `window.zoomLevel`, the zoom of the base. It is the
  size of everything this specification does not give a zoom of its own.
- **A part has the keyboard**: the element with the keyboard focus is in it.
  The canvas has the keyboard as [the keys of the canvas](canvas-keys.md#terms)
  say. The Agent Area has the keyboard in a terminal session and on its tabs
  and buttons.
- **The size on the screen**: what a part draws, measured against a window at
  a zoom of 100%.

## The rule

1. **The keys that zoom change the zoom of the part that has the keyboard.**
   They are Cmd+=, Cmd+Shift+=, and Cmd+NumPad + to zoom in; Cmd+-,
   Cmd+Shift+-, and Cmd+NumPad - to zoom out; and Cmd+NumPad 0 to go back,
   with Cmd+0 too on the canvas, in the Agent Area, and in a PDF. Elsewhere
   Cmd+0 is the base's Focus into Primary Side Bar, as before.

   | The keyboard is | The keys change |
   | --- | --- |
   | on the canvas, also in a note or a code card edited there | the canvas's zoom |
   | in the Agent Area | the size of the Agent Area's text |
   | in a PDF in Card Detail | the PDF's zoom |
   | in a book in Card Detail | the size of the book's text |
   | anywhere else | the window's zoom |

2. **Each zoom is its own.** The window's zoom does not change the size on
   the screen of the canvas's cards or of the Agent Area's text: a card at the
   canvas's 100% and the Agent Area's text at 13 are as large on the screen
   at every zoom of the window. The canvas's zoom and the Agent Area's text
   change nothing else either.

## Requirements

### The window

3. The window's zoom is the size of Files, Search, Source Control, the title
   bar and the status bar, menus, hovers, the Command Palette, Settings, Card
   Detail with what it shows, the controls the canvas draws over its cards,
   and the tabs and buttons of the Agent Area. It is the base's, with the
   base's steps, keys, and menu.
4. In Settings the row Zoom says under its name that the canvas and the
   Agent Area's text keep their own size.

### The canvas

5. **The canvas's zoom is the size on the screen of its cards.** The zoom
   control and its field, Zoom to 100% and the other sizes of its menu, the
   keys, a pinch, the wheel when it zooms, Zoom of a New Folder, and the
   highest zoom of Fit to Screen (100%) all mean that size. Its range stays
   20% to 400%, and a step of the keys stays 10%.
6. **A change of the window's zoom keeps the canvas's zoom**, and what lies at
   the canvas's top left corner stays there, as when the canvas's room changes
   for any other reason. The cards keep their size on the screen; the canvas
   shows more or less of them as its room on the screen changes. The change is
   drawn in the frame the window's new zoom is drawn in.
7. What the canvas draws at a size of the screen and not of the canvas, such
   as the toolbars beside a card, the panel of a generation card, and the
   frame of a selection, takes the window's zoom, as the controls around the
   canvas do.
8. A folder keeps the canvas's zoom in its viewport ([workspace
   state](workspace-state-and-legacy-cleanup.md)), so it opens at the same
   size after the window's zoom changed, also after a restart.

### The Agent Area

9. **The Agent Area's text has its own size**: `terminal.integrated.fontSize`,
   13 by default ([Agent Area terminal](agent-area-terminal.md#row-height)),
   the row Font Size on the Agent Area page of Settings.
10. Three commands change it, in the category BaseHalf, listed in the Command
    Palette and in Keyboard Shortcuts:

    | Command | Default keys | What it does |
    | --- | --- | --- |
    | Larger Agent Area Text | Cmd+=, Cmd+Shift+=, Cmd+NumPad + | one pixel larger, up to 100 |
    | Smaller Agent Area Text | Cmd+-, Cmd+Shift+-, Cmd+NumPad - | one pixel smaller, down to 6 |
    | Reset Agent Area Text Size | Cmd+0, Cmd+NumPad 0 | the default size: the setting has no value of the user's |

    Their keys act while the Agent Area has the keyboard and go to no
    program in the terminal, as the keys of the window's zoom did there. A
    change is written as Settings writes it, and the row Font Size shows it
    as it changes.
11. **The text keeps its size on the screen at every zoom of the window.** The
    terminal draws its font at the size divided by the window's zoom, and its
    rows and columns follow its room, as after any change of the font.
12. In the pane of an agent's extension the page is the extension's: its text
    takes the window's zoom, and the keys there zoom the window, as before.

### What stays

13. A PDF and a book keep their zoom and their text size as [PDFs and
    books](documents-and-books.md) say: the keys there never zoom the window.
    A note, a picture, and a video in Card Detail magnify by a pinch, as
    before, and take the window's zoom as a page does.
14. BaseHalf's default for `window.zoomPerWindow` stays off: the window's
    zoom holds in every window and shows in Settings.

## States and failure

- **A zoom of the window outside the canvas's range**: at a window's zoom of
  300% the canvas's 400% is still 400% on the screen; the canvas's own steps
  never leave 20% to 400%.
- **A folder opened while the window's zoom changes**: the folder opens at
  its kept zoom, measured with the zoom of the window it opens in.
- **A text size in a settings file outside 6 to 100**: the terminal draws the
  nearest size it takes, as the base does; the keys step from that size.

## Limits

- The keys of a PDF and of a book are the reader's page's own. The commands
  Zoom Reader In, Zoom Reader Out, and Zoom Reader to 100% hold them so that
  the window does not zoom there; another key given to them in Keyboard
  Shortcuts does not zoom the reader.
- The window's zoom is the base's, with the base's steps: a key changes its
  level by one, a factor of 1.2. Nothing of this specification adds steps to
  it.
- A program in the terminal that sizes its output by the window's pixels,
  such as a picture drawn in the terminal, is drawn at the terminal's size.

## Acceptance criteria

1. With the keyboard in a terminal of the Agent Area, Cmd+= makes
   `terminal.integrated.fontSize` 14 and leaves `window.zoomLevel` as it was;
   Cmd+- makes it 13 again; Cmd+0 removes the user's value. The shell gets
   none of the three.
2. With the keyboard in Files, Cmd+= zooms the window to 120%. A card's width
   on the screen (its width in the window's pixels times the window's zoom
   factor) is as before within 1 px, the zoom control says the percentage it
   said, and the width on the screen of a cell of the Agent Area's terminal
   is as before within 0.5 px. Cmd+NumPad 0 there brings the window back
   to 100%.
3. With the window at 120%, the zoom control's Zoom to 100% draws a card as
   large on the screen as the canvas's 100% in a window at 100%, and Fit to
   Screen draws no card larger than that.
4. With the window at 120%, a pinch and the keys stop at the canvas's 20% and
   400%, as the zoom control reads them.
5. A folder closed at the canvas's 80% with the window at 100%, and opened
   again with the window at 120%, shows the zoom control at 80% and its cards
   at the size on the screen they had.
6. Settings shows the row Zoom with its line. Settings stands over the window
   while it is open, so the keys reach the Agent Area only while it is
   closed: opened after two presses of Cmd+= in the Agent Area, it shows Font
   Size 15 on the Agent Area page.

## Verification

- Unit tests: the canvas's zoom as shown and as drawn at a window's zoom of
  100%, 120%, and 300%, the range at each, and the point at the middle kept
  across a change of the window's zoom; the three commands of the Agent
  Area's text with their range and their default; the terminal's font at a
  window's zoom of 120%.
- The smoke's workbench suite presses the three keys in a terminal of the
  Agent Area (criterion 1); its canvas suite zooms the window from Files and
  measures a card and the zoom control (criteria 2 and 3).
- In the real window: criteria 2 to 6, with a terminal that runs an agent.
