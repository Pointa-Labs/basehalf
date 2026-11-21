# The items a canvas shows

Status: Active (2026-11-21)
Decision: [D138](../decisions.md#d138--a-card-follows-the-settings-its-file-follows-elsewhere-new-2026-11-21)
Related: [the settings BaseHalf offers](settings-catalog.md) (the row of the
canvas under "Where a surface does not follow a listed setting"),
[workspace state](workspace-state-and-legacy-cleanup.md) (`.bh` and the root
agent files), [reference graph](reference-graph.md#sources) (what the
reference index reads), [following moved items](following-moved-items.md)
(the snapshot), [canvas card placement](canvas-card-placement.md) (where a
card that appears goes)

This specification owns which entries of a folder have a card on its canvas,
and which items BaseHalf follows: reads for the reference index, recognizes
after a move outside BaseHalf, and offers in the list of items to connect.

## Problem

Read in the code and run in the real window on 2026-11-21:

- **The canvas left out entries by a list of names of its own**: `.idea`,
  `.vscode`, `.turbo`, `.next`, `.nuxt`, `.svelte-kit`, `node_modules`,
  `dist`, `build`, `out`, `__pycache__`, `.pytest_cache`, `target`, and
  `vendor`. A user's folder named `build` or `out` had no card, and nothing a
  user could set brought it back. Files showed it.
- **What a user hid in Files still had a card.** The canvas did not read
  `files.exclude`.
- **The same list decided two different things**: which entries have a card,
  and which folders BaseHalf walks for the reference index, for the snapshot
  of following moved items, and for the list of items to connect. A note in
  `build/` could not be connected, and an entry that named it was dangling.
- **A folder's card counted entries its own canvas does not show**: `.git`
  and the files the system makes.

## Terms

- **Item**: an entry of a workspace folder that has a card. The
  [reference graph](reference-graph.md#terminology) calls it a node.
- **Followed item**: an item BaseHalf reads and keeps track of by itself:
  the reference index reads its upstream list, a move of it outside BaseHalf
  is recognized ([following moved items](following-moved-items.md)), and the
  list of items to connect offers it.
- **Never an item**: `.bh` and `.git` at any depth, the files the system
  makes (`.DS_Store`, `Thumbs.db`, `desktop.ini`), and `CLAUDE.md` and
  `AGENTS.md` of the workspace folder itself.

## Required behavior

### What has a card

1. An entry of a folder has a card when Files shows it: the canvas leaves
   out what the setting `files.exclude` of the workspace folder leaves out,
   by the same patterns, also one that depends on a sibling
   (`"**/*.js": { "when": "$(basename).ts" }`). A pattern set to `false` is
   off, as in Files.
2. What is never an item has no card, whatever the setting says. With
   `basehalf.files.showHiddenFolder` on, Files shows `.bh` and the canvas does
   not ([workspace state](workspace-state-and-legacy-cleanup.md)).
3. No name is left out by BaseHalf itself any more. A folder named `build`,
   `out`, `dist`, `target`, `vendor`, or `node_modules` has a card, as in
   Files, and its canvas shows its entries by the same rule. The one such
   name BaseHalf's default for `files.exclude` holds is `.vscode`, the
   folder of a folder's own settings: it has no card and no row in Files
   until a user turns the pattern off.
4. A change of `files.exclude` is followed at once: the open canvas draws
   again, a card that the setting now leaves out goes, and one it no longer
   leaves out appears, at the place it had
   ([canvas card placement](canvas-card-placement.md)).
5. A folder's card lists and counts what the folder's own canvas shows.
6. Hiding an item changes nothing that names it: its upstream list is still
   read, and an entry that names it stays valid.

### What BaseHalf follows

7. BaseHalf follows every item that Search does not leave out: neither the
   item nor a folder above it matches the setting `search.exclude` of the
   workspace folder. By the base's default that leaves out `node_modules`
   and `bower_components` at any depth. `files.exclude` plays no part here
   (rule 6).
8. The reference index, the snapshot of following moved items, and the list
   of items to connect cover exactly the followed items: one rule, in the
   walk of the folder and for every file event.
9. A change of `search.exclude` is followed at once: the reference index
   reads the folders again, and the snapshot is taken again, which
   recognizes no move.

### A card that is not followed

10. A card under a folder that Search leaves out is a card as any other in
    what a user does with it: it opens, it is edited, renamed, moved, copied,
    and deleted, and it has a place on its canvas.
11. It can be the upstream of a followed item: an entry may name any item,
    and a rename or a move of it in BaseHalf rewrites the entries that name
    it.
12. It takes no connection: its own upstream list would not be read. A
    connection let go on it draws no line and writes nothing, and the canvas
    says "<name> is in a folder that Search leaves out."
13. A move of it outside BaseHalf is not recognized: its card comes at its
    new path as a new card.
14. Taking the folder out of `search.exclude` makes its items followed
    (rule 9).

## Why BaseHalf does not follow everything that has a card

Measured on 2026-11-21 in a development build, on a folder of 54 files with
a dependency folder beside them, a copy of real packages (first draw: the
time from the start of the window's loading to the first cards; two or three
starts each):

| Dependency folder | Followed | First draw | Stores the index reads | Items in the snapshot, its file |
| --- | --- | --- | --- | --- |
| 40,620 files, 1,735 of them Markdown | no (left out) | 1.9 to 2.2 s | 23 | 54, 57 KB |
| the same | yes | 2.7 s (2.66 to 2.74 s; once 4.5 s) | 1,758 | 40,670, 3.0 MB |
| 225,100 files | no (left out) | 2.0 s | 23 | 54, 57 KB |
| the same | yes | 3.8 to 4.0 s | 10,698 | none: above the limit of 200,000 items, nothing is recognized in the whole folder |

- Following a dependency folder delays every start, to read notes nobody
  connects, and above 200,000 files it switches off following moved items
  for the user's own notes too.
- While 4,000 files were written into the dependency folder in 9 s, a note
  written beside it had its card after 0.17 s when the folder was left out
  and after 0.29 s when it was followed: the cost is at the start, not while
  files arrive.
- The canvas itself is not slower either way: the dependency folder is one
  more card.

So the two needs take two settings the user already has. `files.exclude`
says what is shown, and the canvas follows it as Files does. `search.exclude`
says what is worth reading through, and BaseHalf's own reading follows it as
Search does. A card that falls between the two says so when it is asked for
what it cannot keep (rule 12).

## Limits

- Files can also hide what git ignores (`explorer.excludeGitIgnore`, off by
  default). The canvas does not follow that setting.
- A pattern that depends on a sibling is asked where the siblings are known:
  for the cards of a folder. A path alone never matches such a pattern.
- A canvas of a folder that `files.exclude` hides can still be reached by its
  path, and shows its entries by rule 1.
- The walks of [files in notes](files-in-notes.md) keep their own list of
  folders they leave out (`.git` and `node_modules`).
- An entry written into a note while its folder was followed stays in the
  file when Search leaves the folder out again. Its line is not drawn then,
  and is drawn again when the folder is followed again.

## Implementation boundaries

- `workspace/common/basehalfItemRules.ts` holds the rules: the names that are
  never an item, the entries of a folder that have a card, whether a path is
  followed, the exclusions of a walk, and a reader of the two settings for a
  workspace folder that says when either changes.
- The canvas asks it for the cards of a folder and for a folder card's list.
  The reference index, following moved items, and the list of items to
  connect ask it for what is followed. No other list of names exists.

## Acceptance criteria

1. With folders named `build`, `out`, and `node_modules` in a workspace
   folder, the root canvas has a card for each, and the names of the cards
   are the names Files lists.
2. With `"files.exclude": { "drafts": true, "**/*.log": true }` written into
   the user's settings while the canvas is open, the cards of `drafts` and of
   `run.log` go within the time Files takes, and they come back when the
   lines are removed.
3. `.bh`, `.git`, `.DS_Store`, and the root `CLAUDE.md` have no card with
   `files.exclude` empty.
4. A connection drawn between two notes in `build/` writes the upstream entry
   and its line stays. The reference index holds the note's list, and an
   entry elsewhere that names a note of `build/` is valid.
5. A connection let go on a note under `node_modules/` writes nothing, draws
   no line, and shows the sentence of rule 12. With `"search.exclude":
   { "**/node_modules": false }` the same connection is written and stays.
6. A note in a folder hidden by `files.exclude` is in the reference index,
   and an entry that names it is valid.
7. With a dependency folder of 40,000 files under `node_modules/`, the first
   draw of the root canvas comes as it does with the fixed list of names
   (about 2 s in a development build), and the reference index reads none of
   the folder's files.

## Verification

- Unit tests of the rules (`basehalfItemRules.test.ts`), of the cards of a
  folder model, of the refusal of a connection, of the reference index on a
  fixture with `build/`, `hidden/`, and `node_modules/`, and of the list of
  items to connect.
- The smoke's `canvas-shows-what-files-shows` step in `workbench`.
- In a real window: criteria 1, 2, 4, 5, and 7.
