# A code file on its card and in Card Detail

Status: Active (2026-11-05)
Decision: [D121](../decisions.md#d121--a-code-card-is-a-small-window-on-its-file-and-source-is-vs-codes-editor-new-2026-11-05)
Related: [note rendering](note-rendering.md) (what other cards show), [canvas wheel
gestures](canvas-wheel-gestures.md), [the changes of a file](changes-of-a-file.md),
[opening and closing Card Detail](card-detail-opening.md), [the selection agents can
see](selection-for-agents.md), [canvas card resize](canvas-card-resize.md)

## The rule

**A code card is a small window on its file, and Card Detail is the same window made
large.** Four things of VS Code's editor hold in both:

- **The file stays.** What shows is what the file says, whatever git says about it.
- **A change is a mark beside its lines.** A diff is something to open.
- **You can see where you are.** Line numbers, and where the view and the changes stand
  in the whole file.
- **What shows can be scrolled and edited where it shows.** There is no mode for reading.

What stays BaseHalf's own is what follows from a canvas. It holds hundreds of files, so
a card is a drawing until it is touched. A wheel gesture belongs to what it began on, so
the canvas stays easy to move. A card is recognized by its face, so a change never puts
something else on it.

## Problem

Measured on 2026-11-05, in a window next to the installed VS Code 1.144, on one folder
of real code with changes.

On the canvas:

- A wheel gesture over a code card moved the canvas. The card showed the first 8 KiB of
  the file at most, and the rest could only be read by leaving the canvas.
- A double click left the canvas too. A note is edited on its card with the same gesture.
- A card that had been read at line 300 in the Changes view showed line 1 again, its
  license header, when Card Detail closed. What had just been read was gone.
- Nothing on the card said which lines changed, or where in the file they were. The
  letter and the bar say only that something did.
- A card has no line numbers, so a scrolled card would not say where it is, and its last
  lines faded as if they were less important.

In Source, the same file:

| | VS Code | Source |
| --- | --- | --- |
| Where the view stands | Minimap, 120 px | Nothing; `minimap` was switched off |
| Changed lines | Bars beside the line numbers, marks in the minimap and the ruler | None |
| Find | Command-F | Nothing, and Escape then closed Card Detail |
| Folding, sticky scroll | Yes | No |
| `editor.*` settings | Apply | Ignored |
| Go to Line, Go to Symbol | Work | "Open a text editor first" |
| Editor commands in the palette | Listed | None |
| Line, column, language, indentation | In the status bar | Nowhere |

These have one cause. Source was built on the simple editor VS Code uses for an input
box, and a card was built as a picture of the file's head. Each gap could be patched, and
both would stay what they are.

## Goals

- A card can be read to the end of its file, where it stands, without losing the canvas.
- A card can be edited where it stands, with the gesture a note has.
- What was read in Card Detail is what the card shows afterwards.
- Which lines changed, and where they are in the file, shows on the card and in Source.
- Source is VS Code's editor, with what that brings and the settings it reads.
- A canvas of many code cards moves as it moved before.

## Non-goals

- A diff on a card. [Why not](changes-of-a-file.md#why-a-preview-does-not-show-changes)
  still holds: a card shows its file. Marks are not a diff.
- Language services: hover, go to definition, and rename stay as D118 left them. An agent
  answers those questions.
- Text files that are not code. They wrap, and their lines are not what a reader
  navigates by ([note rendering](note-rendering.md), rule 32).
- A minimap on a card. A card's width goes to its code; its overview is a thin ruler.
- A place that survives closing the window. A card opens at line 1 again, as a note does.

## Terms

- **Face**: what a code card draws at rest: lines, line numbers, marks, and the ruler. It
  is a drawing: no editor runs, and it takes no pointer events of its own.
- **Card's editor**: VS Code's editor on the card, there while the code is being edited.
- **Place**: the first line a file's card or view shows. A file has one place while the
  window is open, whichever surface moved it last.
- **Marks**: VS Code's quick diff of the file: added, modified, and deleted lines, as the
  gutter of a text editor shows them.
- **Ruler**: a thin strip at the right edge of a face, for the whole file from top to
  bottom.

## Required behavior

### The face

1. A code file is what [note rendering](note-rendering.md), rule 33, says it is. Its card
   shows lines in the editor's colors, at the editor's tab width, in the font of the
   setting `editor.fontFamily` at 12 px with lines of 18 px, whatever the size of the
   editor. A line that is longer than the card ends at its edge. Nothing is skipped, and
   nothing fades: the last line that fits is as bright as the first.
2. Each line has its number, right-aligned in a gutter that is as wide as the editor's for
   that many lines, with at least 3 digits. The gutter stays where it is when the text
   moves sideways. A face has the lines the editor has: a last line break has an empty line
   after it, and an empty file has line 1, which can be edited as any other.
3. A face draws only the lines in view and a few around them, whatever the length of the
   file. Without a place, marks, or a gesture it needs only the head of the file it read,
   and no text model.
4. The first gesture on a file that is longer than its head, or a place beyond its head,
   reads the whole file into VS Code's text model of the file. The colors of lines come
   from that model then, and arrive by themselves when it has reached them. A face that
   has no model keeps showing the lines it drew.
5. A file above 5 MiB keeps its head: a gesture ends at the last line of the head, and a
   double click opens Card Detail.

### Scrolling

6. A wheel gesture follows [canvas wheel gestures](canvas-wheel-gestures.md): one that
   begins on a face whose file is longer than its card moves the lines, and a sideways
   one moves the text. At the end of the file or of a line the gesture moves nothing more,
   and the canvas does not move. One that began elsewhere goes on moving the canvas.
7. Below a canvas zoom of 50%, where a line can no longer be read, a gesture that begins
   on a face moves the canvas.
8. While lines move, the ruler shows where the view stands in the file, and it fades 800 ms
   after they stop.
9. A card at rest shows its place. It keeps it when it is selected, when it is drawn again,
   when the file is written from outside, and when it leaves the view and comes back. If the
   file has become shorter, it shows the last lines there are.

### Marks

10. A face of a changed file marks its lines as VS Code's gutter does, in the colors of
    `editorGutter.addedBackground`, `editorGutter.modifiedBackground`, and
    `editorGutter.deletedBackground`: a bar beside added and modified lines, and a small
    triangle where lines were taken out. They come from the same quick diff as Source's, and
    there are as many as it has. A file git does not know has none, as in VS Code.
11. The ruler of a changed file stays, with a tick in those colors for each change, at its
    place in the whole file. It says where the changes are while the card shows something
    else. A tick is as large on the screen at every zoom, 4 px wide and at least 3 px high,
    and the card's rounded corners cut none. An unchanged file has no ruler at rest.
12. A face asks for marks only while it is on the screen and its file is listed as changed,
    a few files at a time. They appear when Source Control knows of the change, or a moment
    later. The text does not depend on them.
13. The bar and the letter of [the changes of a file](changes-of-a-file.md), rules 2 and 3,
    stay as they are: they say at any zoom that the file changed.

### The place

14. Card Detail of a code file opens at the card's place, unless it was opened at a selection
    or a line, as from Search. The Changes view opened from a row or from the letter shows the
    first change.
15. Moving between Source and Changes keeps the line in view, in both directions, as VS Code's
    Open File and Open Changes do. A line that the left side has and the right does not goes
    to the nearest line of the right.
16. When Card Detail closes, in any view, the card shows the place the view had. It stands
    there on the first frame of the closing, not after it. So a change read in the Changes view
    is what the card shows afterwards, with its marks, and it stays when the file is committed.
17. A click on a row or a letter moves the place of no other file. Nothing moves a card by
    itself because its file changed, and a change an agent writes does not take a reader away
    from what they read.

### Editing on the card

18. A double click on a face edits the file on the card, with the caret at the point of the
    click. The name still renames. Enter on a selected code card edits it from its place. No
    line moves or changes its colors on any frame when the editor comes and when it goes, and
    the marks stand where they stood.
19. The card's editor is VS Code's editor of the same text model as Source, with the same
    gutter as the face and without a minimap, folding, sticky scroll, or suggestions, which do
    not fit a card. Undo, redo, the clipboard, Find, and many cursors are as in any editor.
20. It writes the file as Source does. A letter typed there shows in Source, on the card's
    next drawing, and in the marks.
21. Escape ends the editing once the editor has no other use for it, such as a Find, and so does
    Command-W, which does not close the window from there. A press
    outside the card, opening Card Detail, and going to another folder end it
    too, and what was typed is written first. The keyboard goes back to the canvas with the card
    still selected. Switching to another application does not end it.
22. The canvas does not take the keys, the wheel, or a drag of what is being edited: Space is
    a space, the wheel scrolls, and a drag selects text. The card can still be moved by its name.
23. What is selected in the card's editor reaches agents as a selection in Source does.

### Into Card Detail

24. A selected code card has Expand in its toolbar, as a note has, and it opens Card Detail.

### Source

25. Source is VS Code's editor: all its features that need no language service, with the settings
    `editor.*` for the file and its language, read again when they change. The minimap, folding,
    sticky scroll, Find, the ruler, and marks show as they do in VS Code. So they do for a note's
    Source, without colors.
26. A mark can be clicked for VS Code's view of that change in place, with its Revert and Stage.
    Alt-F3 and Shift-Alt-F3 show the next and the previous change that way, and Alt-F5 and
    Shift-Alt-F5 move to them, as in VS Code.
27. While Source or the Changes view has the keyboard, it is the window's text editor, as an editor
    in a tab is: Go to Line, Go to Symbol, and the editor's commands in the palette act on it.
28. While Source shows, the status bar has VS Code's entries of a text editor: line and column,
    indentation, encoding, line endings, and language, and they do what they do in VS Code.
29. Escape closes Find first, and closes Card Detail when the editor has no other use for it
    ([opening and closing Card Detail](card-detail-opening.md)).

## Limits

- A face and the card's editor color with the language's grammar. Source adds colors of brackets
  and, with a language service, of meanings.
- A line ends after 400 characters on a face, because a card is far narrower. The card's editor
  and Source show all of it.
- A place is a line. A wrapped view in Source comes back at the start of the line.
- A face draws marks as the editor does by default. The settings `scm.diffDecorations*` apply in
  the editor only.
- Marks need the file's text model, so a canvas with many changed files on the screen holds that
  many models. At most 24 are kept; the marks of a face that lost its model stay as they were until
  it is used again.

## Acceptance criteria

1. A wheel gesture over a long code card moves its lines at 72%, 100%, and 150%, on screen as far as
   the fingers did, up to the file's last line, without moving the canvas. A gesture over empty canvas
   that goes on over the card keeps moving the canvas. At 40% a gesture on the card moves the canvas.
2. A file of 30,000 lines scrolls on a card with no frame over 33 ms once its model is there, and lines
   have their colors within a second of stopping.
3. A panning canvas of 120 code cards, 30 of them changed, measures as it did before this
   specification (p50 8.3 ms, p95 about 10 ms at 120 Hz), and opening its folder takes no longer.
4. Each line of a face stands within 1 px of the same line in the card's editor when editing begins
   and when it ends, at 72%, 100%, and 150%, on every frame.
5. A double click at a word puts the caret in it. Typing, Space, undo, Find, and a selection by drag
   work, and Escape leaves the card selected with the file written.
6. A changed file's face has bars on the lines Source marks, the ruler has a tick for each change, and
   committing removes both and leaves the text and the place.
7. A click on the row of a file changed at line 300, then Escape: the card shows that line and its
   bars on the first frame of the closing. A click on the row of another file leaves this one there.
8. Source and Changes keep the line when switching between them.
9. In Source: the minimap shows at the width VS Code gives it, with marks; Command-F opens Find, and
   Escape closes it and leaves Card Detail open, and a second Escape closes it; folding and sticky
   scroll work; a change of `editor.fontSize` shows at once; a click on a mark opens its change in
   place; Go to Line goes to the line; the palette lists Format Document and Fold All.
10. The status bar shows line, column, and language while Source shows, follows the caret, and shows
    none of them on the canvas.
11. A file above 5 MiB shows its head, its gesture ends there, and a double click opens Card Detail.
12. A note's card and every other card behave as before.

## Verification

- Unit tests of the lines a face draws, of the double click's action, and of the place.
- The smoke's steps in `canvas` (face, scrolling, marks, editing) and `workbench` (Source, its marks,
  commands, and status bar, the place after Changes).
- Once in a real window on a folder of real files, with frames sampled: criteria 2, 3, and 4.
