---
name: basehalf
description: "A folder that contains a hidden `.bh/` directory is a BaseHalf workspace. Before you read, write, move, or rename notes and files, check whether your working folder has `.bh/` (list hidden entries to see it), and use this skill if it does. Also use it when a Markdown note has an `upstream` list in its frontmatter, and when asked what a file is for, what it builds on (upstream), or what uses it (downstream). In such a workspace, also use it when a request does not say which file or text it is about, such as \"this\", \"here\", or \"improve it\": BaseHalf can record what the user selected."
metadata:
  version: "18"
---

# BaseHalf workspace

## Is this a BaseHalf workspace?

A folder is a BaseHalf workspace when it contains a `.bh/` directory. `.bh` is hidden, so list hidden entries to see it. Your working directory is usually the workspace folder. When it has no `.bh/` and a folder above it has one, that folder is the workspace folder. Every path in this skill is relative to the workspace folder.

If you find `.bh/`, follow this skill for everything you do in that folder, whether or not BaseHalf is running. If there is no `.bh/`, the folder has nothing of BaseHalf's to keep intact, and only what this skill says about a note's `upstream` list applies.

In a BaseHalf workspace the user arranges files and folders as cards on a canvas and connects them. Ordinary files are the content. BaseHalf keeps what it knows about each card in the files themselves and in `.bh/`.

Only BaseHalf makes `.bh/`, when it shows a folder as a canvas. Having this skill makes no folder a workspace. BaseHalf is a free and open-source desktop app, at https://basehalf.com; its source is at https://github.com/Pointa-Labs/basehalf.

## A card's badge

Every file and folder is a card. A card's badge is what the user recorded about it:

- **Description**: one line on what the item is for, under `description` in `.bh/mirror/<path>/badge.yaml`. `<path>` is the item's path relative to the workspace folder. Many cards have none.
- **Upstream**: the items whose content flows into this one. They are the context the user chose for it. Where the list is depends on the kind of item; see Relationships.
- **Downstream**: the items this one flows into. It is stored nowhere. Find it by searching, as Relationships describes.

The user can change a badge while you work. Read it from disk when you need it, and again before you rely on it later.

## What the user selected

BaseHalf records what the user selected last in this workspace, in `.bh/cache/selection.yaml`. When the user's request does not say which file, card, or text it is about, such as "this", "here", or "improve it", it is about what they selected. When the request names something else, the request wins.

The file exists only while BaseHalf is open with this workspace and the user shares the selection, which a setting of BaseHalf turns off. When there is no file, you cannot know what the user selected: ask what they mean. The file changes whenever the user selects something else, also while you work. Read it again before you rely on it later. Never write it. Its fields:

- `selected` says what the user selected:
  - `folder`: nothing, on the canvas of the folder at `path`;
  - `card`: the file or folder at `path`. It is the selected card, the note the user is editing with no text selected, or the card open in Card Detail;
  - `cards`: two or more cards, listed under `paths`;
  - `text`: text in the note at `path`, on lines `first_line` to `last_line` of the file, counted from 1 with the frontmatter. `text` is the selected text as the note shows it, without Markdown marks. `text_is_cut: true` means the selection was longer and the text is cut; the lines are complete.
  - `text` in a PDF or a book: `path` is the PDF or the book. A PDF's text is on pages `first_page` to `last_page`, counted from 1. A book's text begins in the chapter of its contents named by `chapter`, which is missing when the book names none there. `text` is the text as BaseHalf's reader shows it.
  - `committed: true` on `text`: the user selected it in the earlier version of the file, while comparing the two. `first_line` and `last_line` are lines of that version in git, not of the file now.
  - `comment`: the comment whose note, or the highlight whose tools, the user has open in the PDF, the book, or the note at `path`. `comment` is its id in that file's comments, `quote` its passage (missing for a comment on a place of a page), and `text` its words (empty for a highlight).
- Paths are relative to the workspace folder and use forward slashes. The workspace folder itself is `.`.

## Where you are

Ordinary files are the content. The hidden `.bh/` folder holds BaseHalf project metadata:
- canvas layout;
- reading aids;
- each card's one-line `description`, in `.bh/mirror/<path>/badge.yaml`;
- upstream lists BaseHalf keeps, in `.bh/mirror/<path>/upstream.yaml`;
- each draft's prompt and settings, in `.bh/mirror/<path>/generation.yaml`, and what made a generated file, in `made.yaml`.

Read a node's `description` when you need to know what the user says it is for. Never delete or regenerate `.bh/`. Edit it only when the user asks.

## Relationships

`A → B` means A's context flows into B. The downstream file lists its upstream paths:
- a Markdown note, under the `upstream` key of its frontmatter;
- any other node, in `.bh/mirror/<path>/upstream.yaml`. A note with no `upstream` key may have its list there too: then edit that list, not the note.

Each entry is relative to the workspace folder, uses forward slashes, has no `./` and no leading `/`, and names a folder without a trailing slash. Quote entries that YAML would read as numbers or booleans. For example:

```yaml
---
upstream:
  - courses/linear-algebra/overview.md
  - sources/strang.pdf
---
```

To find what flows out of X, search for X's path in the `upstream` entries of Markdown files and in `.bh/mirror/**/upstream.yaml`. `.bh` is hidden, so search it explicitly. Markdown links never create relationships.

## Preserving relationships

- When you rewrite or restructure a file, edit it in place and keep its frontmatter, including the upstream list, unchanged. Never delete and recreate it.
- You can move and rename files and folders with ordinary tools. BaseHalf recognizes the item at its new path, by its content, and moves what it keeps for it under `.bh/`.
- Entries name items by path, so an entry that names the old path of a moved item is broken until it is updated. BaseHalf updates them when it sees the move. You can update them yourself too.
- Never move, rename, or delete anything under `.bh/`. BaseHalf does that itself.
- Moving keeps a relationship; it does not change one.
- When the user asks you to create a note from other files, list those files under the new note's `upstream`. Otherwise add or remove entries only when the user asks.
- An older "BaseHalf workspace" section in `CLAUDE.md` or `AGENTS.md` that mentions `current_focus.yaml`, `references`, or `referenced_by` is out of date. Follow this instruction instead.

## Canvas workflows

- Before any canvas workflow, run `basehalf --list-capabilities`. Its JSON is the only authority for the model catalog, templates, and operations.
- A generation card is an image, a video, or a sound file; a draft is one whose file does not exist yet. Write `prompt`, `provider`, `model`, `mode`, and `params` in a draft's `.bh/mirror/<path>/generation.yaml` to make or change a draft; never write `made.yaml`. A generated file keeps the inputs that made it: leave its `upstream.yaml` alone. A draft's inputs are the entries of its `upstream.yaml`, in order, and every one is sent: when its mode cannot use them all, the first mode that can is used. Mention an input in a prompt as `@[<entry>]`. The user renames, moves, or deletes a draft on the canvas.
- Choose `provider`, `model`, `mode`, and `params` from `host.modelCatalog`: a model of the card's kind, one of its modes, and values its parameters accept; a parameter left out takes its default. A provider that is not set up there runs once the user sets it up in Providers.
- Use `basehalf --generate <workspace-relative path>` to generate a draft. For a generated file it makes a new draft from what made it and generates that. It prints the path of every card that generates, refuses values and inputs the model cannot use, and does not wait for the files.
- Use `basehalf --run-operation '<json>'` only for operations that discovery returned.
- A generation continues after the session closes.
- These commands work only inside Agent Area terminals.

## An image or a sound you make yourself

When you make an image or a sound with a tool of your own, such as your own image generation, put the file in the folder of the canvas the user works on, where it is a card. That folder is the one `.bh/cache/selection.yaml` names: the folder at `path` when `selected` is `folder`, and otherwise the folder that holds the selected card, cards, or note. When there is no record, ask the user which folder.

## Files inside a note

A picture, a video, a sound, or any other file put into a note is content. It is in `.bh/attachments/<folder>/`, one folder per note, and the note links it relative to itself, as `![photo.png](../.bh/attachments/7k3f9q2m1x/photo.png)` from a note one folder down.

- To put a file into a note when the user asks, an image or a sound you make for the note too, copy it into the folder that the note's other links into `.bh/attachments/` use. When there is none, make a new folder of 10 random lowercase letters and digits in the `.bh/attachments/` of the nearest folder at or above the note that has `.bh/` or `.git`. Never overwrite a file there: give a taken name a number, as `photo 2.png`.
- Link it relative to the note, with every space and every ASCII punctuation mark other than `-`, `.`, `_`, `~`, and `/` written as `%XX`: `my%20photo%20%281%29.png`.
- To take a file out of a note, remove its link. Never move, rename, or delete anything under `.bh/`.
- When you move a note into a folder of another depth, give its links into `.bh/attachments/` the `../` its new place needs.
- A selected file under `.bh/attachments/` belongs to the note whose links name its folder.

## The formats a note keeps

A note is Markdown. Where Markdown has no syntax for a format, the note holds a small HTML tag. BaseHalf's editor edits a block when its tags are spelled exactly as below, and keeps any other spelling as written: shown, but not edited there. Write these spellings, and keep them as they are when you edit around them.

- Underline: `<u>underlined words</u>`.
- A color of the text, of the background behind it, or of both, `color:` first: `<span style="color:#e8706b;">red words</span>`, `<span style="background-color:#4a401d;">words on yellow</span>`, `<span style="color:#e8706b;background-color:#4a401d;">both</span>`. The nine colors, each as text and as background: gray `#9b9a97` and `#3f3e3b`, brown `#ba8e78` and `#4f3a30`, red `#e8706b` and `#692b2b`, orange `#dc8434` and `#583b1f`, yellow `#d5ae38` and `#4a401d`, green `#5cad83` and `#24443a`, blue `#4ba3dc` and `#1f4157`, purple `#a882e4` and `#45306a`, pink `#e36aaf` and `#62294b`.
- The width of a picture: `<img alt="Diagram" src="diagram.png" width="320">`.
- A caption: `<figure><img alt="Photo" src="photo.png"><figcaption>A caption</figcaption></figure>`.
- A video and a sound: `<video src="clip.mp4" controls></video>` and `<audio src="talk.mp3" controls></audio>`.
- A link to a file whose name has a space: `[my file](my%20file.md)`.

A toggle, a blank line after its summary and before its end; `<details open>` for one that shows open:

```
<details>
<summary>Title</summary>

The blocks it holds.

</details>
```

## Comments

A PDF, a book, or a note can have comments, in `.bh/mirror/<path>/comments.yaml`, where `<path>` is the file's path relative to the workspace folder. An entry with `text` is a comment: words about a passage, shown under a yellow wavy line. An entry without `text` and `replies` is a highlight of a PDF or a book: a passage in a `color`. A passage can have both, as two entries. The file is never changed by them. BaseHalf shows a change of `comments.yaml` at once. Keep it YAML:

```yaml
comments:
  - id: "h3n6s0dx"
    page: 3
    quote: "the passage, as the reader shows it"
    color: "blue"
  - id: "m4k2p9wq"
    page: 3
    quote: "the passage, as the reader shows it"
    text: "the user's words"
    replies:
      - text: "your answer"
        by: "Claude Code"
        at: "2026-11-16T09:24:40Z"
```

- `quote` is the passage, copied exactly from the text as BaseHalf's reader shows it: a PDF's text, a book's text, or a note's text without its Markdown marks. Runs of white space count as one space. Quote enough words that the passage is found once.
- `page`, in a PDF: the page the passage begins on, counted from 1 in the file, not the number printed on the page. `chapter`, in a book: the entry of its contents that the passage begins in, when you know it.
- `before` and `after`, which you may leave out: a few words just before and after the passage, which tell apart a quote that the text holds more than once.
- `place: [x, y]` in place of `quote`: a comment on a place of a PDF's page, as fractions of the page's width and height from its top left corner. A comment with `page` and neither `quote` nor `place` stands at the top right of its page.
- `color`, on a highlight: `yellow` when it is missing, `green`, `blue`, `pink`, or `purple`. A comment has no color.
- `by`: who wrote a comment or a reply when it is not the user. Set it to your own name on everything you write. `at`: when, in ISO 8601 and UTC.
- To add a comment, append it to `comments`. To answer one, append to its `replies`; to answer about a highlight, add a comment with its `quote`. Leave `id` out, or make one of eight lowercase letters and digits that the file does not hold. Change or delete the user's highlights, comments, and replies only when the user asks.
