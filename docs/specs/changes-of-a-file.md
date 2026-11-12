# The changes of a file

Status: Active (2026-11-04)
Decision: [D119](../decisions.md#d119--a-change-is-a-state-of-a-file-and-its-diff-is-a-view-of-its-card-detail-new-2026-11-04)
Related: [Git, SCM, GitHub, and GitGraph](../git-scm-github-gitgraph.md) (Source
Control stays VS Code's), [note rendering](note-rendering.md) (what a card
shows of its file), [the selection agents can see](selection-for-agents.md),
[opening and closing Card Detail](card-detail-opening.md),
[layout controls](layout-controls.md#card-detail) (the header of Card Detail)

## The rule

**A change is a state of a file, and its diff is a view of its Card Detail.** A
card goes on showing its file, whatever git says about it, and says that the
file changed. Card Detail shows what changed. The changes of all files stay VS
Code's multi-file diff.

## Problem

An agent writes files directly, so the question after it worked is what it
changed. On 2026-11-04 the text diff itself was good: side by side in the center
of the window and one column in a narrow one, with the Agent Area beside it. What
was around it was not, measured in a window on a folder with every kind of
change:

- A click on the row of a changed picture or video showed two warnings and Open
  Anyway. A new picture showed one warning. A new note opened in a plain text
  editor instead of Rich.
- The multi-file diff said 12 files and showed 9. The pictures and the video were
  gone without a word. BaseHalf's own files under `.bh` stood before `notes` and
  `src`; in the owner's folder 36 of 40 rows of Changes were under `.bh`.
- With Card Detail of a file open, a click on that file's row showed the diff for
  7 of 401 frames and closed it, which looks like a click that did nothing.
- Escape stayed in a diff, and the path in the title bar became
  `previews.ts (Working Tree) (previews.ts)`.
- Card Detail of a changed file said nothing about the change, and led nowhere
  to it. A card said nothing either, while Files did.
- What is selected in an editor over the canvas does not reach agents.

These have one cause. A file opens in Card Detail, but a row of Source Control
opened VS Code's editor, the fallback that Card Detail replaces for every other
way to a file (D20, D22). Each of them could be patched, and the two surfaces
would stay.

## Goals

- Where the changes are shows on the canvas, at every zoom.
- What changed in one file is one click away from a row or from a card, for code,
  notes, pictures, videos, and sounds.
- While reading a diff, the Agent Area stays beside it, and what is selected in
  the diff reaches agents.
- VS Code's way of showing, staging, and reverting a change stays as it is.

## Non-goals

- A diff on a card. See [why not](#why-a-preview-does-not-show-changes). A code card
  marks the lines that changed, as VS Code's editor does ([code cards](code-cards.md)).
- Comments, approvals, or marks of files already read.
- "What the agent changed in its last turn". BaseHalf does not own an agent's
  turns; the changes are what git says.
- A history of its own for folders without git. Source Control offers Initialize
  Repository.
- A rendered diff of a note. A note's diff is of its source.
- Comparing two versions of a PDF or a book.

## Terms

- **Changed file**: a file that Source Control lists under Changes or Staged
  Changes. A new file is one, and its letter says so.
- **Mark**: what a card shows of the change: the color and letter of its name,
  and the bar. The card of a note shows no name above it
  ([a note's title names its file](note-title.md#a-notes-card-shows-no-name-above-it)):
  its letter stands left of the badge button in the card's upper right
  corner, in the color of the change.
- **Changes view**: the view of Card Detail that shows the difference. It stands
  in the header's switch with the file's other views.
- **Multi-file diff**: VS Code's editor of the changes of all files, opened by
  Open Changes on a group of Source Control.

## Required behavior

### The card

1. A card shows its file as it does without git ([note
   rendering](note-rendering.md), rule 32). The text it shows of a file never depends
   on what git says about the file. Beside the lines of a code card there are marks
   ([code cards](code-cards.md), rules 10 to 13), and after the Changes view it stands
   at the line that view stood at (rule 16 there).
2. The card of a changed file has a mark. Its name takes the color that Files
   gives the file, and the letter that Files gives it stands after the name.
3. The mark has a bar on the left edge of the card's face, in that color, 3 pixels
   wide on the screen at every zoom. It takes no room from what the card shows
   and the face's rounded corners cut it. At 27% of a folder of 113 files a
   colored name alone can hardly be seen, and the bar is found at once.
4. The card of a folder that holds a changed file, at any depth, also inside a
   nested repository, has the mark
   with Files' dot instead of a letter. A row of its list takes the color and the
   letter of that file, or the dot of that folder, as Files shows them.
5. A file that git ignores, and a draft, which has no file yet, have no mark.
6. A click on the letter opens Card Detail at the Changes view, or at the file's
   usual view when it has no Changes view. It selects no card, and a drag from it
   moves the card, as with the name. The dot and the bar do nothing.
7. Marks come from what Source Control knows, as in Files, so they appear when it
   does: 1.5 to 4 s after a file is written, while the preview follows in about
   0.2 s (measured 2026-11-04). BaseHalf asks git nothing of its own for them.

### The Changes view

8. Card Detail offers the Changes view while the file is listed under Changes or
   Staged Changes with an earlier version to compare, and can be shown as text or
   is a picture, a video, or a sound. A new file has no earlier version and so no
   such view. A PDF, a book, and another binary file have none either.
9. The Changes view is never where a file opens by itself. A card, Files, Search,
   and Quick Open open the usual view. It comes last in the header's switch: Rich,
   Preview, Source, Changes for a note, Source and Changes for code, View and
   Changes for a picture, a video, or a sound. A code file that has only Source
   shows no switch until it changes, and then shows both.
10. The view of a text file is VS Code's diff, with its settings
    (`diffEditor.*`): side by side, one column when the view is narrower than
    900 px, the whole file with the first change in sight. Its left side is the
    file's version in git and cannot be edited. Its right side is the file: the
    same text model as Source, saved as Source saves it, and each change has VS
    Code's Revert Block and, where VS Code has it, Stage Block. A space typed in it
    arrives: the canvas holds Space for panning only outside what takes text, and
    every VS Code editor over a canvas, also Source and the commit message box,
    counts as taking text.
11. The header holds Previous Change, Next Change, and the switch between one
    column and two while the Changes view shows. Alt-F5 and Shift-Alt-F5 move between
    changes wherever the keyboard is, as in VS Code, also in the list of Source
    Control after a click on a row. Escape closes Card Detail as it does from Source,
    also with text selected. What in the editor uses Escape takes it first, as its
    Find, a list of suggestions, or several cursors ([opening and closing Card
    Detail](card-detail-opening.md)).
12. The view compares what a row of Source Control would: a file under Changes
    with what is staged or committed, a file only under Staged Changes with what
    is committed. A row opens the comparison of its own group.
13. The diff follows the file while an agent writes it. When the file no longer
    has changes, Card Detail goes to the file's usual view by itself, keeps what is
    selected nowhere, and the keyboard goes with the view if it was in the diff. Going
    back or forward in the window's history to a Changes view that is gone shows the
    usual view too.
14. A version above 256 MiB is not read, on either side: git would hand it to the
    window whole. The view says so in words. A file that turns out not to be text, or
    cannot be read, loses the view or says so as Source does; the file is read first,
    so that a binary file is known by its first bytes before git hands over anything.
15. What is selected on the right side reaches agents as text in the file: `path`,
    `first_line`, `last_line`, and `text`. What is selected on the left side
    reaches them with `committed: true`: its lines are those of that earlier
    version, not of the file now ([the selection agents can
    see](selection-for-agents.md)). The side is the one that last had the keyboard, so
    that it holds while the keyboard is in a terminal and an agent writes the file.

### Pictures, videos, and sounds

16. The Changes view of a picture, a video, or a sound shows the earlier version
    and the file next to each other, each as large as it fits, with what they are
    right under them: Before and Now, and the size of a picture in pixels.
17. A video and a sound play in place with their own controls. Starting one pauses
    the other. Going to another view of the file stops what plays, in either
    direction, and nothing of one view shows over the other: neither a player's
    controls nor Edit and Revert to Original.
18. An earlier version above 256 MiB is not read: git would hand it to the window
    whole. The view says so and shows the file.

### Rows of Source Control

19. A click on the row of a changed file with a Changes view opens Card Detail at
    that view. The canvas goes to the file's folder, as with a click in Files, and
    the keyboard stays in the list, so that the arrow keys walk the rows.
20. A click on the row of a file without a Changes view opens its usual view: a
    new note in Rich, a new picture in its viewer, a changed PDF in its reader.
21. These go on as VS Code has them: a deleted file (there is no file to open), a
    file under `.bh`, a conflict, a file outside the workspace folders, and a row
    opened to the side. So do the files of a commit in Graph. Card Detail of the same
    file closes first, or it would close what VS Code opened as its duplicate.
22. What was opened last is in front. A diff that VS Code's editor shows over Card
    Detail stays open, also of the same file, and closing it comes back to Card
    Detail. Card Detail that opens under such an editor, from a row, Files, or a card,
    takes its place, and every editor over the canvas closes, also those behind it,
    which with no tabs would otherwise come to the front. A change that saves by itself
    is saved first. Walking the results of Quick Search closes nothing until one is
    opened. A window of its own and the settings overlay are not over the canvas.

### All changes

23. Open Changes on a group of Source Control opens VS Code's multi-file diff over
    the canvas, with the Agent Area beside it. While it is open, a click on a row shows
    that file in it instead of opening Card Detail, so that reading it stays one
    place. A row of a file it leaves out opens as rule 21 says; a file it does not
    list is never an error in its place.
24. It leaves out files under `.bh`, which are BaseHalf's own and hidden everywhere
    else in the window. Its title counts what it shows. Commit and Stage All
    Changes are not affected.
25. A binary file stands in it with its name and "Binary file changed", and a
    button that opens the file of its row: at the Changes view when it has one,
    otherwise in its usual view. A deleted one has no button. A file that could not be
    read stands in it the same way and says so. No file of the list is left out
    silently.
26. Escape closes a diff or a multi-file diff over the canvas when the editor has
    nothing else to do with the key, such as ending a selection.

## Why a preview does not show changes

Showing the first change on a changed card was tried in the window and set aside.

- In this repository's history (2026-11-04: 2,803 changes of code files, 1,036 of
  documents, which are longer than ordinary notes), the first change is in a card's
  first 12 lines in 21% and 19% of them, so the file's first lines rarely show a
  change. That is why a card has a mark. But the whole change fits 12 lines in only
  31% and 46%, typically 21 lines in 3 places and 13 lines in 2, so a card that
  showed changes would still show only a part.
- A card is recognized by how it looks. Every changed card would change its face
  and change it back at each commit, and someone who rarely commits would have a
  canvas of diffs instead of a canvas of their work.
- A note is edited on its card, and a picture cannot show a difference on its
  face, so one rule would no longer hold for every kind of card.

VS Code's editor keeps the file and marks the lines beside it, and a diff is
something to open. Since D121 a code card does the same: its text stays, its changed
lines are marked, a thin ruler says where in the file the changes are, and a reader
who looked at a change finds the card at that change. No card moves by itself because
its file changed.

## Acceptance criteria

1. A card of a modified file, a new file, and a renamed file shows the letter and
   color of the same file in Files, and its preview is the same as without git.
   Committing removes the mark and leaves the preview as it is.
2. A folder holding a changed file at any depth shows the dot and the bar, and the
   rows of its list say what Files says.
3. The bar measures 3 screen pixels at 27%, 72%, and 150%.
4. A file that git ignores and a draft have no mark.
5. A click on the letter opens the Changes view and selects no card; a drag from
   the letter moves the card.
6. A modified code file offers Source and Changes; a modified note offers Rich,
   Preview, Source, and Changes; a modified picture offers View and Changes; a new
   file, a PDF, and an unchanged file do not offer Changes.
7. Opening a changed file from its card, Files, Search, or Quick Open shows its
   usual view. Going back to a Changes view whose last change went shows it too.
8. A click on a modified file's row opens Card Detail at Changes, with the canvas at
   its folder, and the arrow keys still walk the rows. This also holds with Card
   Detail of the same file open, and of another file open, and with several editors
   over the canvas, of which none stays.
9. The view is side by side at 1036 px and one column at 836 px.
10. Typing on the right side of the view, spaces too, changes the file and what
    Source shows, and Revert Block and Stage Block change the file and the index as
    in VS Code. A space reaches the commit message box.
11. Previous Change, Next Change, Alt-F5, and Shift-Alt-F5 move between
    changes, the keys also with the keyboard in the list; Escape closes Card Detail,
    after Find if it is open.
12. A file written from outside shows in the view without a click. After the last
    change is reverted, Card Detail shows the usual view, with the keyboard in it.
13. Text selected on the right side is recorded with the file's lines, and text
    selected on the left with `committed: true`.
14. A modified picture shows both versions with Before and Now right under them and
    their sizes; a video and a sound play, one at a time; going to View stops them,
    and going back to Changes stops what View plays, with no controls of the other
    view showing; a version above 256 MiB says so.
15. A new note's row opens Rich, a new picture's row its viewer, and a changed PDF's
    row its reader. A deleted file's row, a row under `.bh`, and a commit's file row
    open VS Code's editor as before.
16. A diff of a commit's file over Card Detail of that file stays open, and closing
    it shows Card Detail. A click in Files under a diff over the canvas shows Card
    Detail, and the diff is closed.
17. The multi-file diff lists every changed file outside `.bh`, with binary files
    as placeholders whose button opens them, also when staged, and its title counts
    them. A click on a row while it is open shows that file in it, and a row under
    `.bh` opens VS Code's editor of that file.
18. Escape closes a diff and a multi-file diff over the canvas, but ends a selection
    first when there is one.

## Verification

- Unit tests of the changes service, of which files have a Changes view, and of the
  marks a canvas gets.
- The smoke's steps in the `workbench` suite (the card of a code file, marks, what
  opens as usual, rows, the view, the views of a sound, the multi-file diff, what
  opened last, and spaces), on a fixture repository with every kind of change, and in
  `canvas` (what agents see of each side of a diff).
- Once in a real window, on a folder of real files: criteria 3, 9, 12, and 14, with
  frames sampled while panning a canvas of many marked cards.
