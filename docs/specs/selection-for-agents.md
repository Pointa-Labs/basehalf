# The selection agents can see

Status: Active (2026-10-14; a selected draft, 2026-10-22 for D63)
Decisions: [D57](../decisions.md#d57--agents-can-read-what-the-user-selected-and-the-window-shows-it-new-2026-10-14),
[D63](../decisions.md#d63--a-generated-file-is-its-card-new-2026-10-22)
Related: [agent skill](agent-skill.md),
[workspace state and legacy cleanup](workspace-state-and-legacy-cleanup.md),
[canvas selection and arrangement](canvas-selection-and-arrangement.md),
[canvas card name](canvas-card-name.md),
[note rendering](note-rendering.md),
[layout controls](layout-controls.md)

## The rule

**What the user selected is what an agent can see.** On a canvas that is the
folder of the canvas, unless the user selected cards. In a note it is the
note, unless the user selected text in it. One rule holds for every kind of
card.

**The window always shows what agents can see.** At the right end of the
status bar, under the Agent Area, BaseHalf shows the name of what is
selected, or the start of the selected text, or how many cards are
selected. It is a reminder and nothing else: it has no button and does not
open.

## Problem

On 2026-10-14 the user made a new note, typed "什么是因子" into it on its
card, switched to Claude Code in the Agent Area, and wanted to say only
"improve this". The agent could not know which note, nor where in it. The
user had to name the note and say where the new text goes.

An editor such as VS Code tells an agent in its terminal which file is open
and what is selected, through the agent's IDE integration. BaseHalf's notes
are edited on their cards and in Card Detail, by editors of BaseHalf's own,
which no such integration sees. Codex and most other agents have no
integration that a terminal reaches by itself.

Earlier releases recorded the user's position for agents
([D35](../decisions.md#d35--the-focus-mirror-is-removed-new-2026-09-27-its-non-goal-of-a-live-signal-revised-by-d57) lists
why it was removed). [D57](../decisions.md#d57--agents-can-read-what-the-user-selected-and-the-window-shows-it-new-2026-10-14)
says what differs in this record.

## Goals

- An agent working in a BaseHalf workspace can learn what the user selected
  there, without the user naming it.
- Every agent that reads the [BaseHalf skill](agent-skill.md) can learn it:
  Claude Code, Codex, and others, in the Agent Area or in any terminal.
- The user sees on screen, at all times, what agents can see.
- Nothing that git shows changes.

## Non-goals

- Making an agent read the record. An agent decides when a task needs it.
- The position of the cursor in a note when no text is selected.
- Telling a running agent that the selection changed. An agent reads the
  record when it needs it.
- What is selected in the sidebar, Source Control, a terminal, or an editor
  tab. Only the canvas and Card Detail are recorded.
- Remote windows and the web, where the skill cannot be installed
  ([agent skill](agent-skill.md#offer)).

## What is recorded

| What the user did last | Recorded | Shown |
| --- | --- | --- |
| Shows a canvas and selected nothing on it | the folder of the canvas | the folder's icon and name |
| Selected one card, of any kind | the card | the card's icon and name, as its caption shows them |
| Opened a card for editing, or opened it in Card Detail, and selected no text | the card | the same |
| Selected text in a note, on its card or in Card Detail | the text, its note, and the lines it is on | a text icon and the start of the text |
| Selected two or more cards | every selected card | "N cards selected" |

- **Only selecting changes it.** Moving the pointer, scrolling, zooming, and
  clicking into another part of the window, such as the Agent Area to type
  to an agent, change nothing. The selected text stays highlighted on its
  card or in Card Detail, in the grey of a selection that is not active.
- A click on empty canvas selects nothing, so the folder is recorded again.
  In Card Detail, a press on the page around the document, where no caret
  goes, ends a text selection as a press in the document does.
  Escape that ends the editing of a note leaves its card selected, so the
  card is recorded. Closing Card Detail records what is selected on the
  canvas.
- Showing another folder's canvas records that folder.
- Renaming, moving, or deleting a selected card ends its selection
  ([canvas card name](canvas-card-name.md)), so the folder is recorded.
- A connection that is selected selects no card; the folder is recorded.
- Card Detail's preview cannot be selected, and a PDF, an image, or a video
  holds no text to select: there the card is recorded. So is a selection that
  holds only white space, such as a selected image block or line break.
- When the note changes while text is selected in it, such as when an agent
  writes it, the selection stays on the text it was on, and the record takes
  that text's new lines. A selection whose text the change rewrote covers the
  new text.
- An editor tab over the canvas changes nothing: the record keeps what was
  selected last.

## The record

**Where.** `.bh/cache/selection.yaml` in the workspace folder that holds what
is recorded. `.bh/cache/` is BaseHalf's machine-local working folder, which
its own ignore file keeps out of git
([workspace state](workspace-state-and-legacy-cleanup.md#what-basehalf-persists)).
A window with several workspace folders keeps one record, in the folder of
the canvas or the note the user is in, and removes it from the others.

**When it exists.** BaseHalf writes the record only while all of these hold:

- the [BaseHalf skill](agent-skill.md) is installed, at its current version,
  for at least one agent;
- the window is a local desktop window;
- the workspace folder is not marked with `.basehalf-no-workspace-setup`
  ([source-tree contract](spec-driven-development.md)).

When one stops holding, BaseHalf removes the record. It also removes it when
the window closes or the folder leaves the window, so a record that exists
belongs to a BaseHalf window that is open. A window removes only the record it
wrote: when the file holds something else, another window wrote it, and it
stays. After BaseHalf ends without closing its window, such as in a crash,
the record stays until a window of that folder writes its own, or finds the
skill missing and removes it. When two windows of one folder hold the same
record and one closes, the record is gone until the other is used again.

**Content.** YAML. Every string is written as a double-quoted scalar.

```yaml
# What the user selected last in BaseHalf. BaseHalf rewrites this file; see the basehalf skill.
selected: "text"
path: "notes/untitled.md"
first_line: 3
last_line: 5
text: "核心概念\nIR（原始需求）：用户想要什么（业务导向、模糊）"
```

- `selected` is `folder`, `card`, `cards`, or `text`.
- `path` names the folder, the card, or the note of the text, relative to the
  workspace folder, with forward slashes, as the entries of an upstream list
  do. The workspace folder itself is `.`.
- `cards` has `paths`, a list of the selected cards in the order of the
  canvas's list order, instead of `path`.
- A selected draft is recorded as a `card`, by the path its file will have,
  and `draft: true` is added: there is no file at that path yet
  ([generation cards](generation-cards.md#drafts-and-missing-files)). Among
  `cards`, a draft is listed by that path like any card.
- `text` adds `first_line` and `last_line`, the first and last line of the
  note's file that hold the selection, counted from 1 and including the
  frontmatter, and `text`, the selected text as the note shows it: without
  Markdown marks, with one line break between blocks.
- Text longer than 10,000 characters is cut there, never inside a character,
  and `text_is_cut: true` is added. The lines are still complete.
- Characters that YAML does not allow in a file, such as U+2028, are written
  as `\u` escapes.

**Writing.** BaseHalf writes the record 200 ms after the selection settles,
only when its content changes, and replaces it whole, so an agent never
reads half of it. The status bar does not wait for it (see below). A window
that gains focus writes its own selection, so with two windows on one folder
the record is the one used last.

## What the window shows

The entry is in the status bar, at its right end, left of the entries that
are there already. It shows the icon and the text of the table above.

- One line, in the colour of other status bar text, as wide as its text. A
  text that does not fit ends with `…`.
- It ends where the entries to its right begin. While the Agent Area is
  shown, it takes at most 60% of the room from there to 8 pixels right of
  the Agent Area's left edge, so it stays at the right end. While the Agent
  Area is hidden, it is at most 240 pixels wide.
- It changes as soon as the selection does: measured in the real window,
  25 ms after a click on a card and 35 ms after text is selected. The record
  follows when the selection settles.
- A card shows the name and the glyph of its caption: a note's name has no
  extension ([canvas card name](canvas-card-name.md)), other files keep
  theirs, a generation card included, and a draft shows the name its file
  will have with the glyph of its kind.
- The start of the selected text is the text with each run of white space,
  line breaks included, made one space.
- Resting the pointer on the entry shows "Agents that use the BaseHalf skill
  can see this." A click does nothing.
- The entry shows nothing while no record can be written: without the
  current skill, in a marked folder, or after a write failed.

## The skill

The [agent skill](agent-skill.md#the-skill) describes the record:

- Its description adds that the skill applies when the user's request does
  not say which file or text it is about, such as "this", "here", or
  "improve it".
- Its body gets a section, "What the user selected", after "A card's badge":
  where the record is, what each field means, that it is what the user
  selected last in BaseHalf and that it exists only while BaseHalf is open,
  and that the user's own words win when they name something else.
- Its version becomes 3, so BaseHalf offers the update.

The [launch instruction](agent-launch-context.md) does not describe the
record: without the skill there is no record.

## Mechanism

**Sources.** The canvas workbench gathers what is selected and hands it to
`IBaseHalfAgentSelectionService` whenever any of it changes.

- *Cards.* The canvas scene tells the workbench the selected cards after
  every change of the selection, whatever made it
  (`IBaseHalfCanvasSceneDelegate.didChangeSelection`). The workbench keeps
  them with the scene they belong to.
- *The folder and Card Detail.* Each change of navigation state reports
  again: another folder's canvas, Card Detail opening, closing, or changing
  its projection.
- *Text in a note on its card.* The note editor reports every change of its
  selection, and also when it is rebuilt. 30 ms after they settle, the
  workbench asks it for the selected text. The text is the editor's text
  between the ends of the selection, with a line break between blocks and
  for a line break inside one. The lines come from the top-level blocks the
  selection begins and ends in, the smallest pieces whose Markdown the editor
  knows, and are narrowed as below.
- *A change made elsewhere.* The note editor is rebuilt from the file. The new
  editor gets the old document and carries the selection across the change:
  positions before the part that changed stay, positions after it move,
  text added at an end of the selection stays outside it, and an end inside
  a replaced part goes to the edge of what replaced it. The documents are
  compared without the names of their blocks, which follow their place.
  Without focus, the new editor draws the selection as not active.
- *Text in Card Detail's rich projection.* The webview works out the lines
  from what a save would write now, so edits made since the note was opened
  count, narrows them, and posts `basehalf.markdownRich.selectionChanged`
  30 ms after the selection settles. It sends at most one character more
  than the record keeps. A press on the page around the document collapses
  the editor's selection at its head: the browser drops the highlight there,
  and the editor would otherwise keep a selection that is no longer shown.
- *Text in Card Detail's source projection.* The editor's selection, read
  30 ms after it settles: its lines exactly, without a last line where the
  selection ends at its start, and its text up to one character more than
  the record keeps.
- *Narrowing* (`baseHalfSelectionLines`). The first line of the selected text
  is looked for in the lines of the block it begins in, and its last line in
  the lines of the block it ends in, each as the text a line shows: a link
  or an image by its text, without HTML tags, marks, or white space, with
  entities decoded. One found on exactly one line narrows that end;
  otherwise the end stays at the block's edge, which holds the selection.
- Text is used only while the note it is in is the one being edited on its
  card, or the one Card Detail shows. Each projection of Card Detail keeps
  its own text, and the one shown counts.

**Showing.** The service hands the status bar a new selection as soon as it
is given one, while the current skill is installed and the folder is not
known to be marked; the record follows.

**Writing.** The service writes the record 200 ms after the last change it
was given. It looks for the marker of the source tree each time, writes
BaseHalf's ignore file first when it is missing, checks that no part of the
path under `.bh/` is a symbolic link, creates `.bh/cache/`, and writes the
file through a temporary file named with `.basehalf-tmp`, which the ignore
file also hides. It writes only when the content differs from what it wrote
last, or when the window gained focus since. When a write fails, it removes
what it wrote before, so nothing is stored that the window does not show. It
checks whether the skill is installed when it starts, when this window
installs or removes the skill, and when the window gains focus; a check that
ends after a later one is ignored. Each time it finds the current skill
missing, it removes records left in the folders of its window.

**Removing.** Before removing its record, the service reads the file and
removes it only when it holds what this window wrote. Closing the window
waits for the removal.

**Quiet writes.** BaseHalf's working files under `.bh/cache/` are left out of
file watching by default (`files.watcherExclude`), so a write wakes neither
git nor the canvas. The canvas also ignores a change of files that are all
under `.bh/cache/`, for a user who changes that setting: the canvas of a
workspace folder holds `.bh/` and would otherwise draw again. The one part of
`.bh/cache/` that BaseHalf watches is `generation/`, the task records of
generations ([generation cards](generation-cards.md#the-task-record)).

**The highlight.** The note editor on a card draws the selection itself
while focus is in another part of the window, because the browser drops the
highlight of a selection when another element of the page takes focus. While
the window is in the background, the browser's own highlight stays. Card
Detail's rich projection is a frame that keeps its selection when it loses
focus, but the browser draws it then in a colour close to the page's own
dark background; the frame styles the selection of an editor without focus
in a neutral grey instead. The source projection draws it as an editor
without focus does.

**The entry.** `BaseHalfAgentSelectionStatusContribution` adds a right-aligned
status bar entry with the highest priority, so it is the leftmost of the
right group, and draws its content itself: the glyph that the caption of a
card draws (`renderBaseHalfItemGlyph`, shared with the canvas) and the text.
It sets the entry's largest width from the room under the Agent Area
whenever the Agent Area or the status bar changes size or visibility.

## Acceptance criteria

1. The rule and the record. Unit tests:
   - selected text wins, then the card Card Detail shows, then the selected
     cards, then the folder; empty text counts as none;
   - the record reads back through a YAML parser as the fields above, also
     for a path with a colon and a hash, a folder named `true`, text with
     quotes, tabs, and a leading dash, and text over 10,000 characters, which
     is cut and marked; a selected draft is a `card` with `draft: true`;
   - the label of each kind: a folder's name, a note's name without its
     extension, a file's name with it, a draft's name, a number of cards,
     and the start of selected text with white space made single spaces, at
     most 120 characters;
   - text of only white space counts as none; characters YAML does not allow
     are escaped and read back; a cut never splits a character;
   - the narrowing of lines: one item of a list, a selection from inside one
     item to inside the next, a selection from a heading into a list, text
     found on several lines, a link read as its text, and a selection that
     starts inside a link's text whose words a later line repeats, which must
     not narrow to that later line.
2. The writer, on an in-memory file system. Unit tests:
   - no record while the skill is missing or only outdated; a record, and
     BaseHalf's ignore file before it, while it is current for one agent;
   - one record per window: a selection in a marked folder removes the
     record of the other folder and writes none; no canvas removes it;
   - closing the window removes the record, but not a record whose content
     another window wrote since;
   - a record left in the folder is removed once the skill is found missing;
     after a failed write no record is left and nothing is shown.
3. The note editor on a card, in its own test script: a selection follows
   text added before it, covers the text that replaced it, stays when the
   change is after it, and follows its text when a block kept as it is
   follows; selected text maps to the Markdown offsets of its first and last
   unit.
4. The webview message is accepted with text and ordered lines, or with no
   text and no lines, and refused otherwise. Unit test.
5. The skill: version 3, the description names a request that does not say
   which file or text it is about, and the body has "What the user
   selected" with the record's path and every field. Unit test.
6. Smoke step `agent-sees-selection`, in the `canvas` suite. The smoke installs the skill into a folder of its own run
   (`BASEHALF_SMOKE_AGENT_SKILL_HOME`, which the product never sets), so the
   agents' settings of the machine are neither read nor changed:
   - nothing is recorded or shown before the skill is installed;
   - after **BaseHalf: Install Agent Skill**, nothing selected records the
     folder `.` and shows the workspace folder's name;
   - the entry is in the status bar and has no label of its own; with the
     Agent Area hidden it is at most 240 pixels wide, and with it shown at
     most 60% of the room under it, never left of it;
   - one card, two cards in list order with "2 cards selected", and a click
     on empty canvas;
   - text selected with the mouse across a soft line break in README.md is
     recorded with lines 4 and 5 and shown by its start;
   - with focus moved out of the note the record is unchanged and the note
     draws the inactive highlight over the selected text;
   - two lines written above the selection from outside move the record to
     lines 6 and 7 with the same text, and the highlight stays; writing the
     file back moves it to lines 4 and 5;
   - Escape with the text still selected leaves the card recorded;
   - in Card Detail's rich projection, text selected with the mouse is
     recorded with its line; with focus elsewhere the selection's style
     differs from its focused style and is not transparent; a press on the
     page beside the document records the card again;
   - git shows nothing under `.bh/cache/`;
   - **BaseHalf: Remove Agent Skill** removes the record and the entry.
7. Checked in the real window once per release of this behaviour, not
   automated: text selected in Card Detail's rich and source projections is
   recorded with its lines; the entry in the light and the dark theme; a
   second window on the same folder takes the record when it gains focus.
8. Recorded once per release of the skill text: an agent that has the skill
   and gets a request that names no file, with a record present, works on
   what the record names (see [recorded trials](#recorded-trials)).

## Recorded trials

**Version 3 of the skill, 2026-10-14.** Each run is one non-interactive
session in a fresh copy of a workspace with `.bh/` (BaseHalf's ignore file and
a record), a note `untitled.md` that holds only "什么是因子", and a folder
`量化学习` with `plan.md` and `notes-ch3.md`. No request names BaseHalf, the
skill, a file of `.bh/`, or the record.

- Claude Code 2.1.296 with its default model, allowed to edit. The skill is a
  project skill of the copy, named `basehalf-v3`: a personal skill wins over a
  project skill of the same name, and the machine had version 2 installed as
  `basehalf`, which `skillOverrides` turned off for the session.
- Codex CLI 0.157.1 with `gpt-6-sol` in its `workspace-write` sandbox. The
  skill is in `.agents/skills/basehalf/` of a stand-in home folder, and Codex
  signs in from the user's own Codex folder.

| Record | Request | Claude Code | Codex |
| --- | --- | --- | --- |
| the card `untitled.md` | 帮我完善一下 | Loaded the skill, read the record, also read the two other notes, and wrote an introduction to factors into `untitled.md` with "什么是因子" as its heading. Nothing else changed. | Read the skill and the record and wrote an introduction into `untitled.md` under the same heading. Nothing else changed. |
| text on line 5 of `notes-ch3.md` | 这段写得太啰嗦了，帮我改简洁一点 | Rewrote line 5 and nothing else. | Rewrote line 5 and nothing else. |
| the card `untitled.md` | 帮我完善一下 量化学习/plan.md | Read the record and edited `plan.md`, which the request names. `untitled.md` did not change. | Edited `plan.md`. `untitled.md` did not change. |
| the cards `notes-ch3.md` and `plan.md` | 把这两篇的要点合成一篇新笔记 | Created a note in `量化学习` from the two, with both in its `upstream` list. | The same, under another name. |

What the trials show, and what they do not:

- In all eight runs the agent loaded the skill for a request that named no
  file, read the record before it edited, and changed only what the record
  or the request named. One run of each is a small sample.
- When the request named a note, both agents followed the request.
- Claude Code used the skill under another name. On a machine where the
  user has not taken the update to version 3, agents still have version 2,
  which says nothing about the record, and BaseHalf writes none.
- Not tried: a session in the Agent Area, where the request is typed into the
  agent's own terminal; a record left behind by a crash; a workspace of
  thousands of files.
