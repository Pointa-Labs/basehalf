# The shown place and the workbench

Status: Active (2026-11-21)
Decision: [D139](../decisions.md#d139--what-basehalf-draws-follows-the-settings-of-the-workbench-new-2026-11-21)
Related: [the location in the title bar](title-bar-location.md) (the path
BaseHalf draws for the shown place),
[the settings BaseHalf offers](settings-catalog.md) (the settings named
here are advanced), [opening and closing Card Detail](card-detail-opening.md),
[canvas card name](canvas-card-name.md) (the name BaseHalf shows for an
item), [architecture invariants](../harness/architecture-invariants.md#product-shell)

This specification owns what the parts of the workbench that follow the
base's active editor follow in BaseHalf: going back and forward with the
buttons of a mouse and with a swipe. What the title bar draws of the shown
place is owned by [the location in the title bar](title-bar-location.md).

## Problem

The base's workbench follows its active editor, the editor of the tab in
front. BaseHalf has no tabs: a folder is shown as a canvas and a file in
Card Detail over it, and neither is an editor of the base. So a feature of
the base that asks for the active editor finds none, and its settings do
nothing, though the Settings editor lists them. Measured on 2026-11-21 in
the real window, a development build of 0.7.0:

- **The back and forward buttons of a mouse did nothing**, over the canvas,
  over Files, and over a note in Card Detail, with
  `workbench.editor.mouseBackForwardToNavigate` on, its default. They moved
  through the base's history of editors, which is empty, while Go Back in
  the title bar, three places back at that moment, went through BaseHalf's
  history.
- **A swipe ran a command that does nothing.** With
  `workbench.editor.swipeToNavigate` on, a swipe opens the base's
  previously used editor. Run from the Command Palette on a note in Card
  Detail, that command changed nothing.

## Terms

- **The shown place**: the folder whose canvas is shown, or the file that
  Card Detail shows over that canvas. It is what the path in the title bar
  ends with.
- **BaseHalf's history**: the places that were shown, in their order. Go
  Back and Go Forward of the title bar move through it.
- **A page**: what Card Detail or the Agent Area draws in a frame of its
  own, as a note in Rich, a PDF, a book, and the view of an agent
  extension. The workbench does not hear the pointer there by itself.

## Required behavior

### Back and forward

1. **One pair of commands.** Go Back and Go Forward are the base's two
   commands, and every way to go back or forward runs them: the buttons of
   the title bar, their keys, the Go menu, the back and forward buttons of a
   mouse, and a swipe. While a canvas or Card Detail is shown, they move
   through BaseHalf's history. While an editor of the base covers the
   canvas, as Settings does, they move through the base's history, as
   before.
2. **The buttons of a mouse.** With
   `workbench.editor.mouseBackForwardToNavigate` on, the back button of a
   mouse goes back and its forward button goes forward, wherever in the
   window the pointer is: over the canvas, the sidebar, the title bar, the
   Agent Area, and a page. They act when the button goes down. With the
   setting off, the two buttons do nothing in the window.
3. **A swipe.** With `workbench.editor.swipeToNavigate` on, on a system
   that reports a swipe of three fingers to the window, a swipe to the left
   goes back and a swipe to the right goes forward. With the setting off, a
   swipe does nothing.
4. **Nowhere to go.** With no place before or after the shown one, going
   there does nothing: no sound, no message.
5. **Leaving Card Detail** by a button of the mouse or a swipe is leaving
   it by Go Back: what is being typed is saved first, and a file that
   cannot be saved keeps Card Detail open
   ([architecture invariants](../harness/architecture-invariants.md#content-and-graph-truth)).

## Implementation boundaries

- The base's history service hears the buttons of a mouse on the window
  (`services/history/browser/historyService.ts`), and the main process
  hears the swipe (`platform/windows/electron-main/windowImpl.ts`). Each
  runs the commands `workbench.action.navigateBack` and
  `workbench.action.navigateForward`
  (`browser/parts/editor/editorActions.ts`), which already choose between
  BaseHalf's history and the base's. Nothing else decides where back and
  forward go.
- A page reports the back and forward buttons to the workbench as it
  reports its keys: the page's frame posts the button, and the webview
  element sends a mouse event of that button from its own element, where
  the history service hears it
  (`contrib/webview/browser/pre/index.html`, `webviewElement.ts`).

## Acceptance criteria

1. With the default settings, from the canvas of the workspace folder: open
   a folder's canvas, then a note of another folder from the search. The
   back button of a mouse pressed over the note shows the folder's canvas,
   pressed again over the canvas shows the workspace folder's canvas, and
   pressed a third time changes nothing. The forward button pressed over
   Files shows the folder's canvas again, and pressed again the note.
2. With `workbench.editor.mouseBackForwardToNavigate` off, neither button
   changes the shown place.
3. With `workbench.editor.swipeToNavigate` on, a swipe to the left reported
   to the window on a note in Card Detail shows the place before it, and a
   swipe to the right the note again.

## Verification

- Unit tests in the window of the test runner
  (`basehalfMouseBackForward.test.ts`): with the base's history service
  made as the window makes it, the back button runs Go Back and the forward
  button Go Forward, once, when the button goes down; the window takes both
  events of such a button; the primary button runs nothing; and with the
  setting off the buttons run nothing and are left alone.
- In the real window on 2026-11-21, with the buttons sent over the debugging
  protocol (`Input.dispatchMouseEvent` with `button: "back"` and
  `"forward"`), which reach the window and a page as the buttons of a mouse
  do: criterion 1, the first press over a note in Rich, and criterion 2
  over a note and over Files. Before the change, the same presses changed
  nothing.
- Criterion 3 in the real window the same day, with the window's `swipe`
  event sent from the inspector of the main process, to the left and to
  the right; with the setting off, the window does not listen for it. The
  gesture itself, three fingers on a trackpad, was not made: no tool makes
  it.
- Not verified: the buttons over a PDF, over a book, whose text is in a
  frame inside its page, and over the view of an agent extension.
