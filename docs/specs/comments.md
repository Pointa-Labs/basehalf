# Comments

Status: Active (2026-11-16)
Decision: [D135](../decisions.md#d135--comments-mark-passages-of-pdfs-books-and-notes-and-the-reader-of-a-pdf-is-basehalfs-own-new-2026-11-16)
Related: [PDFs and books](documents-and-books.md) (the readers and their
selection menu), [formats of a note](note-formats.md) (the Rich view),
[the selection agents can see](selection-for-agents.md),
[agent skill](agent-skill.md), [exact undo](exact-undo.md),
[workspace state](workspace-state-and-legacy-cleanup.md) (`.bh/mirror/`),
[following moved items](following-moved-items.md),
[mirror file resilience](mirror-file-resilience.md),
[reference graph](reference-graph.md#creating-connected-nodes) (Grow branch)

## The rule

**A comment marks a passage of a PDF, a book, or a note, and holds words
about it.** The passage takes the comment's color, and the words stand
beside it on a small sticky note, folded to a mark until the pointer is on it
or it is opened. A comment without words is a highlight. In a PDF a comment
can also be stuck on a place of a page. Comments are kept beside the file,
never in it, as text that the user's agents read and write, and BaseHalf
shows what they write at once.

## Problem

Measured on 2026-11-16 on main `273d6bedf`:

- A word about a passage of a PDF or a book could only become a card: Grow
  branch makes a note file next to the document. Reading a paper, most marks
  are a color, a question, or a few words, not a note of their own, and a
  canvas with one card for each would be a canvas of crumbs.
- The text the user selects is what an agent can see (D57), but nothing the
  user wrote about a document reached an agent, and an agent had no place to
  answer on the page.
- A note had no way to hold a remark about its own text that is not part of
  the text.

## Goals

- Mark a passage in one step, and write about it in one more.
- One kind of comment for PDFs, books, and notes, kept the same way.
- The file itself never changes: the bytes of a PDF or a book stay as they
  are, and the Markdown of a note holds no comment.
- An agent reads and writes comments with the file alone, and answers the
  user's comment under it.
- Comments travel with their file: a rename, a move, git.
- Every change the user makes is one step of undo.

## Non-goals

- Writing comments into a PDF, or listing the annotations a PDF holds. Those
  are drawn on its pages as before. A PDF with its comments written into a
  copy may come later.
- Comments on other files: code, text, pictures, videos, sounds, folders. A
  card's description is its badge.
- Comments on a note's card on the canvas, in its Preview, or in its Source.
  A note's comments show in its Rich view in Card Detail.
- Several people in a thread, mentions, notifications, or resolving. A
  comment has words and replies, by the user or by an agent.
- Comments on a comic book or on a book with a fixed layout, whose pages are
  pictures.
- Formatting inside a comment: its words are plain text with line breaks.
- Places on a page of a book or of a note: only a PDF's pages have places
  that stay.

## Terms

- **Commentable file**: a PDF, a book ([PDFs and books](documents-and-books.md#terms)),
  or a note, a Markdown file.
- **Passage**: the text a comment marks, as it was selected.
- **Comment**: a passage, or a place on a page of a PDF, with a color, words,
  and replies.
- **Highlight**: a comment without words and without replies.
- **Page comment**: a comment of a PDF on a place of a page, not on text.
- **Mark**: the small square, folded at one corner, that stands beside a
  comment with words. It has the comment's color.
- **Comment note**: the sticky note that shows a comment's words and
  replies.
- **Author**: who wrote a comment or a reply: the user, or an agent by its
  name.

## The file

**Where.** `.bh/mirror/<path>/comments.yaml`, where `<path>` is the file's
path relative to the workspace folder. It is project metadata, as
`badge.yaml` and `appearance.yaml` are: it travels with the folder and with
git, and it follows its file when the file is renamed or moved
([following moved items](following-moved-items.md)). Without the file, the
file has no comments. A file whose last comment is deleted keeps an empty
list.

**Content.** YAML:

```yaml
# Comments on this file, by BaseHalf and agents. See the basehalf skill.
comments:
  - id: "m4k2p9wq"
    page: 3
    quote: "Deep learning allows computational models that are composed of multiple processing layers"
    after: " to learn representations of data"
    text: "这一句就是全文的定义"
    at: "2026-11-16T09:12:04Z"
  - id: "t8v1c3za"
    page: 5
    quote: "backpropagation"
    before: "This is done by "
    color: "blue"
    text: "这里没看懂"
    at: "2026-11-16T09:20:11Z"
    replies:
      - text: "Backpropagation computes how much each weight..."
        by: "Claude Code"
        at: "2026-11-16T09:24:40Z"
  - id: "q2w9e7rt"
    page: 2
    place: [0.84, 0.12]
    text: "回头看引用 [12]"
    at: "2026-11-16T09:30:00Z"
```

| Field | What it holds |
| --- | --- |
| `id` | Eight lowercase letters and digits, unique in the file. A comment without one, as an agent may write it, gets one when BaseHalf next writes the file. |
| `quote` | The passage, as the reader shows its text: a PDF's text, a book's text, a note's text without its Markdown marks. Runs of white space count as one space. |
| `before`, `after` | Up to 32 characters just before and after the passage, which tell apart a quote that the text holds more than once. BaseHalf writes them when a comment is made. |
| `page` | A PDF's page that the passage begins on, counted from 1 in the file, not the number printed on the page. |
| `chapter` | A book's entry of the contents that the passage begins in, when the book has one there. |
| `place` | A page comment's place, `[x, y]`: fractions of the page's width and height from its top left corner. |
| `color` | `yellow`, `green`, `blue`, `pink`, or `purple`. A comment without it is yellow. |
| `text` | The words. A highlight has none. |
| `by` | The author when it is not the user: an agent's name, such as `Claude Code` or `Codex`. The user's comments have none. |
| `at` | When it was written, in ISO 8601 and UTC. |
| `replies` | Words under the comment, oldest first, each with `text`, and `by` and `at` as a comment has them. |

**Reading.** The file is read field by field, as `generation.yaml` is
([mirror file resilience](mirror-file-resilience.md#annotation-files)): a
field of the wrong shape reads as absent, and an entry that has neither
`quote`, `place`, nor `page` is kept but not shown. A file that is not YAML
at all, such as one with the markers of a git conflict, shows no comments,
and the Comments list says "Comments can't be read".

**Writing.** BaseHalf changes only the comments the user changed, against
the bytes it read last; when the file changed meanwhile, it reads it again
and makes the change there, by the comment's `id`. Fields and comments
that BaseHalf does not know stay as they are. Over a file that is not YAML,
BaseHalf first keeps a recovery copy,
`.bh/cache/recovered/mirror/<path>/comments.<12 hex digits>.yaml`, as for
the other annotation files, and then writes the new list.

**Changes from outside.** A change of the file by an agent, another
window, or git shows in an open reader or note within a second, without
moving the page and without closing a comment note the user is writing in.

## Finding the passage

1. BaseHalf finds a comment's `quote` each time it shows its file:
   - in a PDF, in the text of `page`, and when it is not there, in the five
     pages before and after it, nearest first;
   - in a book, in the sections of `chapter` when the contents have it, and
     otherwise in the whole book, a section at a time as the reader opens
     them;
   - in a note, in its text.
2. Runs of white space count as one space, and letters made into one glyph
   count as their letters. Where the quote is found more than once, the place
   whose text before and after it matches `before` and `after` best is the
   passage; when none is better, the first.
3. A comment whose passage is not found shows in the Comments list, last,
   with "Passage not found", where it can be read, answered, and deleted.
4. A page comment stands at its `place`. A comment of a PDF with a `page` and
   neither `quote` nor `place` stands at the top right of its page.
5. In a note, a comment follows its passage while the user edits the note in
   Rich: text typed inside the passage joins it, and the comment's `quote`,
   `before`, and `after` are written again 1 s after the note is saved. A
   passage that is deleted whole leaves its comment not found until its words
   are in the note again, as after an undo.

## How comments show

### On the page

6. The passage of each comment is tinted with its color, under its text, on
   every line it covers. Where two comments overlap, both tints show.
7. A comment with words or replies has a mark: in a PDF at the right edge of
   the page, on the line its passage begins on; in a book just after the end
   of its passage, since a book's text flows and its columns move with the
   size of the text; and in a note in the margin to the right of its text,
   on the line its passage begins on. A page comment's mark stands at its
   place. A highlight has no mark, except in a note: a click in a note's
   text places the caret, so there the mark is the way to a comment.
8. With the pointer on a mark, or on the passage of a comment with words in
   a PDF or a book, for 300 ms, the comment note shows beside the mark.
   Nothing else moves. It goes 200 ms after the pointer has left both the
   mark, the passage, and the note.
9. A click on a mark or on such a passage opens its comment note: it stays
   until a click outside it or Escape. In an open note, the words are edited
   where they stand, without a box, and its tools show at its top: the five
   colors, Grow branch, and Delete.
10. A click on a highlight, or on its mark in a note, shows its tools beside
    it: the five colors, Comment, and Delete. Comment opens a comment note on
    it, with the caret in it.
11. Only one comment note or set of tools is open at a time.

### The comment note

12. A sticky note 240 px wide, of the comment's color, with a soft shadow.
    Above the words, the author's name when an agent wrote them. Under the
    words, the replies, each under its author's name when an agent wrote it.
    While the note is open and the comment has words, a "Reply" line under
    them takes a reply. Words longer than the note scroll inside it, which
    is at most 320 px high.
13. It stands to the right of the mark when there is room there in the
    reader or the note, and to its left otherwise. It covers the text under
    it and moves nothing.
14. Words are saved 1 s after the typing stops and when the note closes.
    Removing all of a comment's words, when it has no replies, leaves a
    highlight. Removing all of a reply's words removes the reply.
15. The colors are a light and a dark set, taken from the theme of the
    workbench, so that the tint keeps the text readable and a note stands out
    from the page in both.

## Making a comment

16. Selecting text in a PDF or a book shows its selection menu
    ([PDFs and books](documents-and-books.md#the-selection-menu)):
    **Highlight**, **Comment**, **Grow branch**, and **Copy**.
    - Highlight marks the passage in the color used last on this computer,
      yellow at first. The selection ends.
    - Comment marks the passage and opens its comment note with the caret in
      it. Closing the note without words takes the comment away again, and
      leaves no step of undo.
17. In a note in Rich, the toolbar of a text selection ends with
    **Comment**, which does what Comment does in a reader. A note has no
    Highlight there: its text has colors of its own
    ([formats of a note](note-formats.md#text-colors)).
18. A secondary click on a page of a PDF offers **Add Comment**, which makes a
    page comment at the place of the click and opens its comment note.
19. A comment's color changes with the colors of its tools; the color chosen
    is the color of the next highlight too.
20. **Grow branch** of a comment makes a note from its passage as Grow branch
    of a selection does ([reference graph](reference-graph.md#creating-connected-nodes)),
    with the comment's words and replies below the quote. A page comment and
    a comment of a note have no Grow branch, as a note's own text has none.
    The comment stays.
21. **Delete** removes the comment with its replies.

## The Comments list

22. The panel of the PDF reader and of the book reader has a tab
    **Comments** ([PDFs and books](documents-and-books.md#the-panel)). It
    lists every comment in the order of the document: the color, the start
    of the passage, the start of the words, the author when an agent wrote
    them, and the page or the chapter. A page comment lists its words. A
    click goes to the comment and opens its comment note. Comments that are
    not found come last. Without comments, the list says "No comments".
23. A note's comments that are not found stand at the top of its right
    margin, each with "Passage not found".

## Agents

24. The [skill](agent-skill.md) describes the file: where it is, its fields,
    that an agent adds a comment or a reply with `by` set to its own name,
    copies `quote` from the text as the reader shows it, gives `page` for a
    PDF and `chapter` for a book when it knows it, and changes or deletes the
    user's comments only when the user asks. The skill's version grows.
25. While a comment note is open, the selection record names the comment
    ([the selection agents can see](selection-for-agents.md#the-record)):
    `selected: "comment"`, `path`, `comment` (its `id`), `quote` (missing for
    a page comment), and `text`, the comment's words. "Answer this" is about
    that comment. The status bar shows a comment glyph and the start of the
    words, or of the passage for a comment without words.

## Undo

26. Each change the user makes is one step of the canvas undo
    ([exact undo](exact-undo.md#comments)): Highlight, Comment once its first
    words are saved, a save of words, a color, a reply, and Delete. Cmd+Z in
    Card Detail with the keyboard out of an editor of text undoes it; while
    the keyboard is in a comment note, Cmd+Z undoes the typing there.
27. A step puts back the comment as it was before, by its `id`, and keeps the
    rest of the file as it is now. A comment that changed outside BaseHalf
    since the step, or is gone, is not changed, and undo says "The comment
    changed meanwhile. Undo did not change it."
28. What an agent writes is no step of BaseHalf's undo.

## Limits

- Words: at most 10,000 characters for a comment and for a reply. A quote is
  at most 10,000 characters, as a selection that agents can see is.
- A PDF with 500 comments opens with no frame over 34 ms more than without
  them. Measured (2026-11-17), a paper of 14 pages with 500 comments, at a
  load of about 5: one frame over 34 ms while it opened, as without comments,
  and none while it scrolled. Before a page's text was read once for all its
  quotes, finding them took 460 ms and made five such frames, the longest
  158 ms.
- The passage of a comment in a book is found once the reader has opened its
  section: a comment without `chapter` in a long book is listed before its
  passage is found.

## Acceptance criteria

1. Selecting a sentence of a PDF and pressing Highlight tints it yellow and
   writes one comment with `id`, `page`, `quote`, `before`, `after`, and
   `at`, and no `text`, into `.bh/mirror/<path>/comments.yaml`. The PDF's
   bytes and its modification time are unchanged.
2. Comment on a passage opens a comment note with the caret in it. Typing
   "why?" and waiting a second writes `text: "why?"`; a mark stands at the
   right edge of the passage's first line; the pointer on the mark shows the
   note; a click elsewhere closes it.
3. Comment, then Escape without typing, leaves the file as it was and no step
   of undo.
4. A comment's colors change its tint, its mark, and its note, and the next
   Highlight takes the new color.
5. Cmd+Z after Highlight takes the highlight away, and Shift+Cmd+Z puts it
   back; the file follows both.
6. An agent that appends a comment with `quote`, `page`, `text`, and `by`,
   and a reply under the user's comment, shows both in the open reader
   within a second, the reply under the user's words with the agent's name.
7. A comment whose `quote` is on page 4 while its `page` says 3 is found on
   page 4; a quote that is nowhere is listed last with "Passage not found".
8. A quote that a page holds twice, with `before` that matches the second,
   tints the second.
9. A book's comment tints its passage in pages and in one scroll, and after a
   change of the text size.
10. In a note in Rich, Comment on a sentence shows a mark in the right margin
    and a tint; typing words into the passage keeps it tinted, and after the
    save the file's `quote` holds the new words. Cmd+Z of those words gives
    the passage its old words with the comment still on it, and the file's
    `quote` follows. The note's Markdown holds no trace of the comment.
11. Renaming and moving a commented PDF keeps its comments; deleting it and
    undoing the delete brings them back.
12. While a comment note is open, `.bh/cache/selection.yaml` holds
    `selected: "comment"` with its `id`, `quote`, and `text`.
13. A `comments.yaml` with git's conflict markers shows no comments and
    "Comments can't be read"; a new comment then keeps a recovery copy and
    writes a list that holds it.
14. Secondary click on an empty part of a PDF's page, Add Comment, and words
    make a page comment with `place`; its mark stands where the click was at
    every zoom.
15. The Comments list of a PDF lists comments in page order, and a click on
    one scrolls to it and opens its note.

## Verification

- Unit tests: reading and writing `comments.yaml` (fields, defaults, wrong
  shapes, unknown fields kept, ids added, conflict markers, recovery copy);
  finding a quote (white space, letters made into one glyph, repeated quotes
  with `before` and `after`, nearby pages); the steps of undo and their
  refusal when the comment changed meanwhile; the selection record of a
  comment; the skill's text and version.
- `npm run basehalf:smoke`: the cardDetail suite makes a highlight and a
  comment in a PDF, reads the file, undoes and redoes, and checks that an
  agent's comment written into the file appears.
- The Rich bundle test, part t: the tints and marks of a note's comments,
  passages that follow typing and undo, comments sent again while a passage
  is edited, and a Markdown that holds none of them.
- In the real window: a paper PDF and an EPUB, in the light and the dark
  theme, a comment by the user and a reply by Claude Code through the skill,
  per-frame sampling while a PDF with 500 comments opens and scrolls.
