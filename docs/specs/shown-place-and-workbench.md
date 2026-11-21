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
buttons of a mouse and with a swipe, the file that Files and Source
Control reveal, and the title of the window that the system shows. What
the title bar draws of the shown place is owned by
[the location in the title bar](title-bar-location.md).

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
- **Files and Source Control did not reveal the file in Card Detail.** With
  `explorer.autoReveal` and `scm.autoReveal` on, their defaults, a note of
  a closed folder opened from the search left Files as it was, its folders
  closed and no row selected, and a changed note opened the same way left
  its row in Source Control unselected. Selecting a card and opening a
  folder's canvas changed nothing in Files either, which stays so.
- **The title of the window named only the workspace.** On a note in Card
  Detail the title was the workspace's name, so the system's list of
  windows could not say what a window shows. The variables of
  `window.title` that speak of the active editor and of its folder were
  empty.

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

### Files and Source Control

6. **Files reveals the file in Card Detail.** When Card Detail comes to
   show a file, whatever opened it, the canvas, the search, Search, a link,
   Go Back, or an agent, Files selects the file's row, as
   `explorer.autoReveal` says: with `true`, its default, Files opens the
   folders above the file and scrolls the row into view when it is not in
   view; with `focusNoScroll` it selects the row without scrolling; with
   `false` it does nothing. A file that `explorer.autoRevealExclude` names,
   or that lies in a folder it names, is not revealed. Files does the same
   when it comes into view while Card Detail shows a file.
7. **A canvas reveals nothing.** While a canvas is shown, Files keeps the
   selection it has: opening a folder's canvas, selecting cards, and closing
   Card Detail change nothing in Files. A folder shown as a canvas is the
   last part of the path in the title bar, and the cards of a canvas are
   not rows that Files could select one of.
8. **Source Control reveals the file in Card Detail.** With
   `scm.autoReveal` on, its default, the row of the file that Card Detail
   comes to show is selected and scrolled into view, in the last group that
   lists the file. A file without a row there changes nothing, and with the
   setting off nothing is selected.
9. **The keyboard stays where it is.** Revealing a file selects a row and
   never moves the keyboard into Files or Source Control.
10. **An editor of the base comes first.** While an editor of the base
    covers the canvas, Files and Source Control follow that editor, as in
    the base.

### The title of the window

11. **The title of the window speaks of the shown place.** The title that
    the system shows for the window, in its list of windows and wherever
    else it names the window, is made from `window.title`, as in the base.
    While a canvas or Card Detail is shown, its variables mean:

    | Variable | In Card Detail | On a canvas |
    | --- | --- | --- |
    | `${activeEditorShort}` | the name BaseHalf shows for the file: a note without its extension ([canvas card name](canvas-card-name.md)) | empty |
    | `${activeEditorMedium}` | the file's path from the workspace folder | empty |
    | `${activeEditorLong}` | the file's whole path | empty |
    | `${activeFolderShort}`, `${activeFolderMedium}`, `${activeFolderLong}` | the folder whose canvas lies under Card Detail: its name, its path from the workspace folder, its whole path | the same of the folder whose canvas is shown |
    | `${dirty}` | the mark of unsaved changes, as an editor of the base shows it: none for a file that saves itself, the mark when its save failed or met a change on the disk | empty |
    | `${activeEditorState}` | what the file's decoration says, as Modified | empty |

    Every other variable, the workspace's name and path, the name of the
    application, the focused view, is what it is in the base.
12. **With the title as it comes**, a note in Card Detail is named before
    the workspace, as an editor's file is in the base, and a canvas by the
    workspace alone. A title that names the folder of a canvas needs
    `${activeFolderShort}` in `window.title`.
13. **The title follows the place.** It changes when Card Detail opens,
    shows another file, or closes, when another folder's canvas is shown,
    and when the file in Card Detail is renamed.
14. **An editor of the base comes first.** While an editor of the base
    covers the canvas, the title is the base's: it names that editor.
15. **The title bar stays as it is.** It draws the path of the shown place
    itself ([the location in the title bar](title-bar-location.md)) and
    reads none of these variables. The hover of its search, which in the
    base says the search's name and then the title of the window, says the
    title as it now is.

## Implementation boundaries

- `navigation/common/basehalfShownPlaceTitle.ts` holds the service that
  answers what the title says of the shown place: the file, the name
  BaseHalf shows for it, the folder of the canvas, and whether the file
  holds changes that are not about to be saved, by the base's own rule for
  the file of an editor. The window title
  (`browser/parts/titlebar/windowTitle.ts`) asks it where it has no active
  editor, and makes the paths and the folder's names with the code it has
  for an editor's file.
- `navigation/common/basehalfShownPlace.ts` answers what the shown place
  is to the base: the file that Card Detail shows, the folder whose canvas
  is shown, and an event for a change of either. It answers nothing while
  an editor of the base covers the canvas. A part of the base that follows
  the active editor asks it where the base has no active editor, and
  nothing else of BaseHalf's: the explorer view (`selectActiveFile`) and
  the view of Source Control (`onDidActiveEditorChange`), each at the one
  place where it reads the active editor's file. Everything the two
  settings do, the folders that open, the excluded files, the scrolling, is
  the base's own code after that place.

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
  (`contrib/webview/browser/pre/index.html`, `webviewElement.ts`). The
  text of a book is a frame inside its page, which the page's frame does
  not hear: the book reader's page tells Card Detail of the two buttons
  there, and Card Detail sends the same mouse event from the page's place
  (`basehalf.book.mouseButton`). In both cases the history service alone
  reads the setting.

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

4. With the default settings and the folders of Files closed, a note
   inside a folder of a folder, opened from the search: Files shows both
   folders open and the note's row selected, and the keyboard is in the
   note. After Escape, on the canvas, the row is still selected.
5. With `explorer.autoReveal` false, or with the note's folder in
   `explorer.autoRevealExclude`, the same open leaves Files as it was.
6. With Source Control in view and two changed notes, opening one from the
   search selects its row, and opening the other its row; an unchanged file
   leaves the selection; with `scm.autoReveal` false the selection stays.
7. With the settings as they come, the title of the window is the
   workspace's name on the canvas of the workspace folder; with a note of
   a folder open in Card Detail it is the note's name without its
   extension, the separator, and the workspace's name; after Escape, on the
   folder's canvas, it is the workspace's name again; and with a code file
   open it starts with the file's name with its extension.
8. With `window.title` set to
   `${activeFolderShort}|${activeFolderMedium}|${activeEditorShort}|${activeEditorMedium}|${dirty}|${rootName}`,
   for the note `drafts/deep/inner.md` of the workspace `ws`: the canvas of
   the workspace folder gives `ws|||||ws`, the note in Card Detail
   `deep|drafts/deep|inner|drafts/deep/inner.md||ws`, the canvas of its
   folder `deep|drafts/deep||||ws`, and while letters are typed into the
   note, which saves itself, no title holds the mark of unsaved changes.
9. On each of these places the path in the title bar is what it was before
   this specification.

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
- Unit tests in Node (`basehalfShownPlace.test.ts`): a canvas shows a
  folder and no file, Card Detail a file over its canvas, an editor of the
  base over the canvas neither, and both kinds of change are told.
- In the real window on 2026-11-21: criteria 4, 5, and 6, the rows read
  from Files and from Source Control. Before the change, the same opens
  selected nothing. `focusNoScroll` was read in the code and not run.
- Unit tests in Node (`basehalfShownPlaceTitle.test.ts`): what the title
  says on a canvas, of a note, of a code file, of a file without a canvas
  of its own, and under an editor of the base; the mark of unsaved changes
  by the state of the file and by how files are saved; and which changes
  are told.
- In the real window on 2026-11-21: criteria 7, 8, and 9, the title read
  from the window's document, which is what the system is given, and the
  path read from the title bar. Before the change, every title was the
  workspace's name. The system's own list of windows was not looked at,
  and a rename of the file in Card Detail (rule 13) was not run.
- The `navigation` suite of the smoke runs criteria 1 and 2
  (`mouse-buttons-go-back-and-forward`, the buttons sent over the debugging
  protocol to a note, the canvas, and Files), criteria 4 and 5 with
  `explorer.autoReveal` off (`files-reveal-the-file-in-card-detail`), and
  criteria 7 and 9 (`window-title-names-the-shown-place`), on files of its
  own.
- In the real window the same day: the back button over a PDF, and over
  the text of a book, each to the place before and forward again, and with
  the setting off no change over the book's text. Before the book's page
  told Card Detail of the buttons, the back button did nothing over a
  book's text and went back over the bar above it.
- Not verified: the buttons over the view of an agent extension, and over
  a frame that a page of another extension puts inside itself.
