# Files in notes

Status: Active (2026-11-03)
Decision: [D111](../decisions.md#d111--a-file-put-into-a-note-is-the-notes-own-in-a-hidden-folder-of-its-own-and-the-note-links-it-as-any-markdown-file-links-a-file-new-2026-11-03)
Related: [formats of a note](note-formats.md) (the blocks of pictures,
videos, sounds, and files, and how a note's links open), [note rendering](note-rendering.md)
(what the card and Preview show), [copy, paste, and drop](copy-paste-and-drop.md)
(the clipboard and drops everywhere else), [exact undo](exact-undo.md)
(deleting a note, the kept versions), [editing media](media-editing.md)
(editing a picture, a video, or a sound), [following moved items](following-moved-items.md)
(moves made outside BaseHalf), [workspace state](workspace-state-and-legacy-cleanup.md)
(what BaseHalf keeps in `.bh/`), [agent skill](agent-skill.md),
[architecture invariants](../harness/architecture-invariants.md#content-and-graph-truth)

## The rule

**A file put into a note is the note's own. BaseHalf keeps it in the note's
own folder in a hidden store, `.bh/attachments/<folder>/<file>`, and the note
links it with an ordinary relative Markdown link. An item that is already in
the workspace is linked where it is. A stored file that no text file has
mentioned for 30 days goes to the Trash.**

## Problem

Until D111 a file put into a note went to `attachments/` beside the note,
one folder for every note of that folder:

- The folder showed as a card on the canvas and as a folder in Files, with
  the files of every note in it, mixed, named `image.png`, `image-2.png`.
  The owner: "attachment 里面没有关于笔记的路径或镜像路径，只是把所有工作空间里的文件混在了一起，感觉有点奇怪",
  and "我总觉得这个 attachment 应该变成隐藏文件".
- A file stayed after its block was deleted, for ever: "当我们在笔记里插入其他文件作为 attachment，插入以后又删掉，attachment 里面就会永久保留".
- In a note's Rich editor, a picture, a video, and a sound offered "Open in
  Card Detail", which left the note to edit a part of it, and named an inner
  part of BaseHalf to the user: "这个 Card Detail 太不严谨了… 应该直接支持原地编辑就行了呀".
- Two notes could link one file, so a change made for one note changed the
  other.

## Goals

- A note's files are its own: one folder per note, nothing shared between
  notes, not shown anywhere a user browses the workspace.
- The note stays a Markdown file that any tool reads: the links are plain
  relative links.
- A rename or a move of a note never loses its files.
- Files a note no longer uses leave by themselves, late enough for undo,
  copies, and git to find them.
- Inside a note, its pictures, videos, and sounds are edited in place; only a
  file that is another thing to read, as a PDF, opens.

## Non-goals

- Links to other items of the workspace following those items when they are
  renamed or moved: Markdown links stay navigation only
  ([reference graph](reference-graph.md), invariant 3).
- Exporting a note or a folder together with its files.
- A note's files as connections or cards.

## Terms

- **A note's files**: the files kept for a note in the store.
- **The store**: `.bh/attachments/` of a home.
- **A note's home**: the nearest folder at or above the note, never above the
  workspace folder, that holds `.bh/` or is the root of a git repository (it
  holds a `.git` folder or a `.git` file); the workspace folder when no nearer
  folder does.
- **A note's folder**: its folder in the store, `<home>/.bh/attachments/<folder>/`.
- **A link into the store**: a relative link whose decoded path ends in
  `.bh/attachments/<one segment>/<one segment>`. `<folder>/<file>` is its
  **key**; the part before `.bh` is its **route**.

## Required behavior

### The store and homes

1. A note's files are at `<home>/.bh/attachments/<folder>/<file>`. In the
   usual case the home is the workspace folder, so the store is its own
   `.bh/attachments/`, beside `.bh/mirror/` and `.bh/cache/`, never inside the
   mirror.
2. A git repository inside the workspace folder keeps its notes' files at its
   own root: BaseHalf makes `<repository>/.bh/` with its ignore file (rule 63)
   when the first file is put into a note there. A folder that has its own
   `.bh/` keeps its notes' files there too. BaseHalf makes no other `.bh/`.
3. A home's store is made with the first file put into one of its notes, and
   a note's folder with the first file put into that note. Nothing is made
   when a folder opens, and nothing for a note without files.
4. In a marked folder (the workspace folder or the home holds
   `.basehalf-no-workspace-setup`), putting a file into a note is refused with
   a plain reason.
5. `.bh` is hidden at every depth: on the canvas, in Files, Search, Quick
   Open, and the `[[` menu (`files.exclude` holds `**/.bh`). Putting a file into
   a note adds no card to any canvas.
6. The setting `basehalf.editor.attachmentsDirectory` is gone. A folder named
   `attachments` that a note links into is an ordinary folder of the
   workspace, and its links keep working (pre-launch: nothing is moved).

### A note's folder and the names of its files

7. A note's folder is the first folder named by the note's links into the
   store that exists. A note without one gets the folder the window last put
   one of its files into, while that folder is there, so that files put in
   together, and a file put in after an undo took the last one away, share
   it; else a new folder.
8. A new folder's name is 10 random characters of `a-z` and `0-9`, as
   `7k3f9q2m1x`, free in every store BaseHalf knows. It is never renamed or
   moved, and it holds nothing of the note's name or place. An agent may make
   a folder the same way; any one-segment name is a folder.
9. A file keeps its own name, cleaned: control characters and the characters
   that some systems forbid in names become `-`, white space becomes one
   space, trailing dots and spaces go, a device name gets `_`, a name keeps at
   most 160 characters with its extension. Names are stored in Unicode NFC;
   `[` and `]` become `(` and `)`; `.git`, `.gitignore`, `.gitattributes`, and
   `.gitmodules` get `_` in front.
10. A picture without a name, as a screenshot or a picture pasted from a
    page, is named by the local time it was put in:
    `untitled 2026-11-03 15.30.12.png`.
11. A name that is taken in the note's folder, compared without case, gets a
    number: `cat.jpg`, then `cat 2.jpg`. A file in the store is never
    overwritten.

### Putting files into a note

12. **From outside the workspace.** A file chosen in Picture, Video, Sound,
    or File of the slash menu or the add button, dropped on the note's
    editor, or pasted from the clipboard is copied into the note's folder,
    where the volume can, as a clone that takes no room, and goes in as one
    block: a picture, a video, or a sound by the one list of media files, any
    other file as a file block. Its block's name is the stored file's name.
13. **A picture with no file** (a screenshot, a picture copied from a page or
    an app, a picture dragged from a page) is saved into the note's folder by
    rule 10, at most 100 MiB, PNG and JPEG as they are and any other picture as
    PNG.
14. **Several files** at once each become their own block, in the order they
    came, one after another from the caret or the point of release. One that
    fails is left out with its reason, and the rest go in.
15. **Items of the workspace are linked where they are**, as the input row of
    a draft connects them ([copy, paste, and drop](copy-paste-and-drop.md)):
    a picture, a video, or a sound of the workspace is its block, linked
    where it is; a note or a folder is a link; any other file is a file block.
    Nothing is copied or moved, also when the cards were cut. A file under
    `.bh/`, as another note's file, counts as a file from elsewhere and is
    copied into this note's folder.
16. While a file is copied, its place in the note shows that it is being
    added (formats of a note, rule 49). A file that cannot be stored adds
    nothing and says why in plain words, with no path under `.bh`. A read-only
    note, or one in a marked folder, takes nothing.
17. A file put in and its link are one step of undo. Undo takes the block
    away; the file stays under rule 43, so redo finds it.

### The link

18. A link into the store is relative to the note: one `../` for each folder
    between the home and the note, then `.bh/attachments/<folder>/<file>`.
    From `读书/Untitled 1.md`: `![untitled 2026-11-03 15.30.12.png](../.bh/attachments/7k3f9q2m1x/untitled%202026-11-03%2015.30.12.png)`,
    `[报告 v2.pdf](../.bh/attachments/7k3f9q2m1x/报告%20v2.pdf)`.
19. **One encoder** writes every link BaseHalf writes into a note: as UTF-8
    with upper-case hex it encodes every ASCII character but letters, digits,
    `-`, `.`, `_`, `~`, and `/`, every white space, and control and format
    characters; all other characters, CJK among them, are written as they are,
    in NFC. No `<…>` destination is written.
20. **Every place reads a link the same way**: a destination with a scheme, a
    leading `#`, or a leading `/` is no file of the note; `?` and `#` end the
    path; the path is percent-decoded once and normalized to NFC; it is read
    from the note's folder and must stay inside the workspace folder or the
    store of a folder above it (formats of a note, rules 53 and 55).

### Showing

21. **Rich** shows a picture, a video, and a sound of the note with its file,
    and any other file as a file block, by its name. A block's name is its
    stored file's name; the toolbar offers no Rename.
22. **In a note, its pictures, videos, and sounds are edited in place.** Their
    menu in Rich has no item that opens them elsewhere, and no label names
    Card Detail. A file block's menu has **Open**, and a double click on a file
    block opens it too, in BaseHalf's viewer for its kind (PDF, book, picture,
    video, sound) over the note's canvas; a kind without a viewer opens in the
    system's application for it.
23. **The card and Preview** show the same pictures, players, and file
    blocks as Rich ([note rendering](note-rendering.md)); a picture carries
    its file's version, so an edit of it shows at once.
24. **Source** shows the Markdown as stored.
25. A missing file (not synced yet, released, removed by hand) shows as the
    broken-picture sign with its name, or as a file block that opens nothing.

### Card Detail of a note's file

26. A note's file opens over the note's canvas; Back returns to the note.
    Its name in the header cannot be changed, and Card Detail offers no badge,
    description, connections, Delete, Reveal, or action that makes a
    connected card. Navigation never shows the canvas of a folder under
    `.bh/`.

### Editing a note's file

27. A note's picture, video, or sound is edited as any media file is
    ([editing media](media-editing.md)), in place in the note (D113 for a
    picture in Rich). Its original and edit record are card information at
    its own path: `.bh/mirror/.bh/attachments/<folder>/<file>/`. The file never
    moves, so the record never follows it.

### Renames and moves

28. A rename of a note, by anyone, and a move at the same depth, change
    nothing: neither the folder nor the links hold the note's name or place.
29. A move of a note to another depth in BaseHalf rewrites, once the move is
    done, the route of each of its links into the store and nothing else, in
    one minimal edit with the undo source of a BaseHalf service: Command-Z in
    an editor of the note stops at it and asks nothing, and an open Rich takes
    it while the user types.
30. A move outside BaseHalf, or while it was closed, leaves the links broken
    until BaseHalf sees the note (300 ms after the folder's file events are
    quiet, or at the next open). Then a link into the store that leads
    nowhere gets its route corrected when its key is in the note's home store,
    or its files cloned into a new folder of the home's store when the key is
    in another store BaseHalf knows. Only links that lead nowhere are
    touched; nothing is written while git is in the middle of an operation in
    that repository, nor in a marked folder.
31. A note moved into another home has its files cloned into a new folder of
    the new home's store, and its links pointed there; the old files leave by
    rule 43.
32. A folder moved to another depth corrects the notes below it by rules 29
    and 30. A folder that is a home carries its store along.

### Copies

33. Each note BaseHalf copies (Duplicate, Command-C and Command-V of its card,
    a copy in Files, Import, a copied folder of notes, a note made from pasted
    text) gets its own folder in the same copy: the stored files its links
    name are cloned, with their edit records, and the copy's links are pointed
    at the clones before any editor holds it. The original is untouched. A
    clone that fails leaves the copy linking the original's files, and says
    why.
34. A copy made outside BaseHalf shares the original's files: a shared file
    stays while either note mentions it. A file put into the copy goes into
    the folder its links already use.
35. A block cut or copied into another note keeps working there: its relative
    links are rebased to the receiving note, and each stored file that is not
    in the receiving note's folder is cloned there. Into the same note nothing
    is copied. A block of file blocks alone copies the files themselves for
    other places, never as cut.

### Leaving

36. Nothing deletes a note's file at once: a block removed in Rich, in Source,
    or by an agent, a note deleted on the canvas (it is kept in the kept
    versions, [exact undo](exact-undo.md)), in Files, or outside BaseHalf.
    Undo, redo, a paste of a cut block, Put Back, and `git restore` find the
    files.
37. **The scan.** At an open, after the comparison of moved items, at most
    once a day per home and by one window at a time (a lock in `.bh/cache/`
    that goes stale after five minutes), BaseHalf lists the text files of the
    workspace folder outside `.git` and `node_modules` (Markdown, txt, html,
    json, yaml, csv, xml, org, rst, adoc, tex, ipynb), with the notes in the
    kept versions and the text of the notes open in the window, saved or not,
    and reads each whole. A folder without `.bh/` is not scanned.
38. A stored file counts as mentioned wherever its key occurs after
    `attachments/` in a scanned file, written as it is or percent-encoded, in
    NFC or NFD. A false match only keeps a file longer.
39. Nothing is downloaded: a workspace folder that the system keeps in the
    cloud is not scanned, and a run that meets the placeholder of a file the
    system took off the disk into the cloud releases nothing.
40. A stored file that nothing mentions gets a note of the time in
    `.bh/cache/note-files.json` (machine-local, ignored by git); a file that is
    mentioned again loses it.
41. A run that could not read a file, reached a limit, or runs in a marked
    folder notes and releases nothing. A window never releases files from a
    store above its workspace folder.
42. Just before a release, BaseHalf reads again every text file that changed
    since the scan.
43. **Release.** A file whose note is 30 days old goes to the Trash from
    where it is, with its original if it was edited; when no file of a folder
    is mentioned, the whole folder goes as one item. Put Back returns it where
    the note's links look. With the Trash off, the files are deleted.

### Git

44. The store is tracked like the notes, in the repository that tracks the
    note.
45. `.bh/.gitignore` holds anchored rules, and BaseHalf writes it when it is
    missing or differs:

    ```gitignore
    /.gitignore
    /mirror/**/canvas.yaml
    !/mirror/**/canvas.yaml/
    /cache/
    /*.basehalf-tmp
    /mirror/**/*.basehalf-tmp
    ```

46. When the ignore files git reads for the store (the `.gitignore` files from
    the repository's root down, `info/exclude`, the user's global ignore file)
    leave the store out, one notice per home and machine says so, without a
    path. When the cause is the two lines early versions wrote into a user's
    `.gitignore` (`# BaseHalf derived cache` and `.bh/`), the notice offers
    Remove, Show, and Keep; Remove deletes exactly those two lines after the
    user confirms, and Keep is remembered.

### Agents

47. The skill tells agents that a note's files are in `.bh/attachments/<folder>/`,
    one folder per note, linked relative to the note; to put a file into a
    note, copy it into the folder the note's other store links use, or a new
    folder of 10 random lowercase letters and digits in the store of the
    note's home, never overwriting; to link it with the one encoder; to take a
    file out of a note by removing its link, never by moving, renaming, or
    deleting anything under `.bh/`; and that a moved note's routes are
    corrected by BaseHalf when it sees the note.

### Subfolders and repositories

48. A subfolder opened in a window of its own still shows its notes' files in
    the store above it: Rich takes the stores of folders above the workspace
    folder as places it may read. A file put into such a note goes into the
    folder its links already use. A window never releases files from a store
    above its workspace folder.

### Failure messages

49. Every failure says what happened in plain words, as "Could not add
    clip.mp4: the disk is full.", and never shows a path under `.bh`.

## What is built in which stage

| Stage | Rules |
| --- | --- |
| 1. The store, names, and links; Rich's chooser, upload, paste, and drop of data into the store; Rich's menu; the hidden `.bh`; the setting gone | 1 to 13, 16 to 25, 44, 45 |
| 2. The 30-day release | 36 to 43 |
| 3. Several files at once, files from paths without copying their bytes through the editor, items of the workspace linked where they are | 12, 14, 15 |
| 4. Route corrections and moves into another home | 28 to 32 |
| 5. Copies and blocks between notes | 33 to 35 |
| 6. Card Detail of a note's file, the git notice, subfolder windows | 26, 46, 48 |
| 7. Agents | 47 |

## Acceptance criteria

1. A picture chosen from the slash menu in a note at the workspace root is
   stored as `.bh/attachments/<10 characters>/<its name>` and linked as
   `![name](.bh/attachments/<folder>/<encoded name>)`; a second picture of the
   same note goes into the same folder; a picture put into another note goes
   into another folder.
2. No card, folder, or Files entry for `.bh` appears after a file is put into
   a note, on any canvas.
3. A screenshot pasted into a note is stored as `untitled <date> <time>.png`;
   a second picture of the same name in that note becomes `<name> 2.png`.
4. A note in `读书/` links `../.bh/attachments/<folder>/<file>` with spaces and
   ASCII punctuation encoded and CJK as written, and Rich, the card, and
   Preview show the picture.
5. A picture's block in Rich has no item that opens it elsewhere, and no
   label of Rich says Card Detail; a file block's menu has Open, and a double
   click on it opens the PDF in BaseHalf's reader.
6. A block removed from a note leaves its file in the store; after the file
   has been mentioned by no text file for 30 days (a scan with its noted time
   moved back), the next scan moves the file to the Trash, and the whole folder
   when no file of it is mentioned; Put Back returns it where the link looks.
7. A note in the kept versions keeps its files through a scan.
8. A scan that meets a file it cannot read releases nothing.
9. `.bh/.gitignore` holds the anchored rules; `git status` shows a stored file
   as untracked and a layout as ignored.
10. A note renamed on the canvas, in Files, and by `mv` in the same folder
    keeps showing its pictures, and nothing is written to it.
11. A note moved to another depth on the canvas shows its pictures, its links
    rewritten in their routes only; moved by `mv` while BaseHalf runs, within
    10 s; while closed, at the next open.
12. Duplicate of a note gives the copy its own folder of clones.
13. A block pasted from a note into a note at another depth shows its
    picture in the receiving note, from a clone in its folder.
14. The skill's text names `.bh/attachments/` as note content and its version
    is 12.

## Verification

- Unit tests in Node: the home, the folder, names and numbering, the encoder
  and the reader, finding links into the store, the planners of corrections
  and of the scan (`basehalfNoteFiles.test.ts`, `basehalfNoteFileLinks.test.ts`).
- The Rich bundle test: a file put into a note goes into the note's folder,
  with its link in the one encoding; Rich's menu of a picture and of a file
  block.
- The smoke's `cardDetail` suite: criteria 1, 3, 5; `canvas`: criterion 2.
- Stages 3 to 7 add their own checks as they are built.
