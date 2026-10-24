# Reference graph: downstream-owned upstream lists

Status: Active (2026-09-27; Open File removed 2026-10-10 for D41; a note that
cannot hold its list keeps it in its sidecar, 2026-10-10 for D42; node
documents removed and drafts added, 2026-10-22 for D63; the mentions in a
draft's prompt follow its entries, 2026-10-24 for D74; Audio from
Connection, 2026-10-25 for D78)
Decisions: [D37](../decisions.md#d37--references-are-stored-once-by-the-downstream-node-new-2026-09-27),
[D41](../decisions.md#d41--users-are-not-expected-to-read-code-or-open-hidden-files-new-2026-10-10),
[D42](../decisions.md#d42--a-note-that-cannot-hold-its-upstream-list-keeps-it-with-basehalf-new-2026-10-10),
[D63](../decisions.md#d63--a-generated-file-is-its-card-new-2026-10-22),
[D74](../decisions.md#d74--a-prompt-mentions-its-inputs-files-and-each-provider-module-names-them-as-its-model-reads-them-new-2026-10-24),
[D78](../decisions.md#d78--basehalf-makes-speech-music-and-sound-effects-with-the-same-cards-panel-and-providers-new-2026-10-25)
Related: [workspace state and legacy cleanup](workspace-state-and-legacy-cleanup.md),
[agent launch context](agent-launch-context.md),
[generation cards](generation-cards.md)

## Problem

A reference `A → B` means A's context flows into B. It is the structure that
keeps a learning domain with many branches in one place: every branch note
knows the trunk it grows from.

Until this specification, BaseHalf stored each reference twice, in two
BaseHalf-private files: `A`'s `badge.yaml` listed B in `references`, and `B`'s
listed A in `referenced_by`. That design had three problems:

- Agents and other tools could not see the structure unless a hint that
  BaseHalf wrote into the user's `CLAUDE.md` and `AGENTS.md` told them to read
  `.bh/mirror/**`.
- Agents that edited the YAML by hand could leave one-sided pairs. Keeping
  pairs consistent needed a Repair/Discard subsystem and multi-file
  transactions.
- References broke whenever files moved outside BaseHalf, and every rename
  required a scan of the whole tree.

## Goals

- Store every reference exactly once, inside the downstream node, the way a
  source file declares its own imports.
- Make the structure visible in the text an agent already reads when it opens a
  note, with no hint file and no live focus signal.
- Let people, agents, and other tools edit references as ordinary text. BaseHalf
  code derives the reverse direction, validates entries, draws edges, and
  performs refactors that the user confirms.
- Make every BaseHalf write a direct result of an explicit user action. Give
  every such write a defined undo, refusal, and recovery behavior.

## Non-goals

- Inferring references from Markdown links, mentions, or content. Markdown
  links remain navigation only.
- A persistent reverse-index cache. The index is rebuilt in memory.
- An agent command that answers "what is downstream of X". Agents search for
  `upstream` entries instead. A query command may be specified later.
- TOML (`+++`) frontmatter, MDX, or other markup formats as downstream stores.
- Enforcing `.basehalf-no-workspace-setup` for the canvas layout, appearance,
  and ADHD writers beyond what [Source-tree guard](#source-tree-guard)
  requires.

## Terminology

- **Node**: a workspace file or folder that the canvas can show as a card. The
  workspace root folder and anything under `.bh/` are not nodes. A draft is a
  node too: a generation card whose file does not exist yet
  ([generation cards](generation-cards.md#drafts-and-missing-files)).
- **Reference `A → B`**: A is the **upstream** and B is the **downstream**.
- **Upstream list**: the ordered list of upstream entries that a downstream
  node stores. It is the only reference truth.
- **Downstream set**: all nodes whose upstream lists name a given node. It is
  derived and never stored.
- **Store**: where a node's upstream list lives (see [Stores](#stores)).
- **Entry**: one item of an upstream list, taken as the source text of that
  item.
- **Dangling entry**: a valid entry that names no existing node.
- **Invalid entry**: an entry that is empty, violates the
  [path grammar](#path-grammar), names the node itself, or repeats an earlier
  entry.
- **Unreadable store**: a store whose upstream value cannot be read (see
  [Markdown store](#markdown-store)). It contributes no edges.
- **Reference operation**: any BaseHalf action that changes an upstream value.

## Invariants

1. A reference is stored once, in its downstream node's store. No component
   stores or caches the reverse direction on disk.
2. The graph is directed and many-to-many. Cycles are allowed. Self-references
   are invalid.
3. Markdown links never create references.
4. BaseHalf changes an upstream value only through a reference operation that
   the user started. The permitted operations are:
   - connect, disconnect, and reconnect on the canvas;
   - add or remove an upstream or downstream entry in the badge editor;
   - Relink, Relink Everywhere, Remove, Use Workspace Path, and Move into File
     on an issue;
   - creating a connected node (PDF branch, Create from Connection, the
     draft that New Version makes from a generation card with its file, the
     drafts a generation of several images makes, and the image that Capture
     Frame takes from a video);
   - Upload into a draft, which removes the draft's entries with its
     `generation.yaml`, since the uploaded file was not made from them;
   - renaming a draft whose model delivers another format, or whose image
     arrived in another format;
   - a new order of a generation card's inputs in its panel;
   - template instantiation the user started;
   - the rename refactor after a move, which rewrites the entries that name
     the moved item without asking
     ([following moved items](following-moved-items.md#entries-are-always-updated));
   - a migration the user confirmed;
   - undo and redo of any of these.

   A generation card's prompt and settings are written to its
   `generation.yaml`, the record of what made its file to its `made.yaml`,
   and its task record to `.bh/cache/`; none of these writes changes an
   upstream value. No background process changes an upstream value.
5. People, agents, and other tools may edit stores as ordinary text. Saved
   content is truth. BaseHalf never reverts it without an explicit user action.
6. A project file transition that is not BaseHalf's own operation, such as a
   change to a Sequence, must not change upstream values (see
   [Project file transitions](#project-file-transitions)).

## Stores

The downstream node's kind decides where its upstream list lives.

| Downstream node | Store |
| --- | --- |
| Markdown file (extension `.md` or `.markdown`, any case) | YAML frontmatter key `upstream` |
| Any other node: folder, PDF, image, audio, video, code, text, a draft, and so on | `.bh/mirror/<path>/upstream.yaml` |

### A note that cannot hold its list

A Markdown note's store is its sidecar `upstream.yaml`, not its frontmatter,
while the note has no `upstream` key of its own and at least one of these
holds (D42):

- the note cannot take the key, because the document is
  [not writable](#recognition): a leading block the recognizer rejects, TOML
  frontmatter, a frontmatter mapping that is not a block mapping in column 0,
  or frontmatter beyond the size window;
- the note already has a sidecar `upstream.yaml`.

A note that has an `upstream` key keeps its list in the note, whatever state
the key is in.

- The index and the edit service decide this with one shared rule. The index
  applies it to saved content. The edit service applies it to the text it
  would edit, which is the open document when there is one.
- The edit service takes the decision under the workspace lease, after the
  note's open projections are flushed. A note with unsaved changes and
  auto-save off refuses the write with "Save or revert <file> first", whether
  its list is in the note or in the sidecar.
- For such a note the sidecar is a sidecar store in every respect: reads,
  writes, undo, the marked-folder rule, workbench moves, and deletes follow
  [Sidecar store](#sidecar-store). The note's bytes are never changed.
- The second condition keeps a list in use when the note changes. Editing the
  top of a note so that it can take a key never makes its connections
  disappear; the badge then offers **Move into File**.
- BaseHalf never moves a list between the note and the sidecar by itself
  (Invariant 4).
- The index reads only the first 64 KiB of a note, so it cannot tell
  frontmatter that closes beyond that window from none at all. For such a
  note the edit service, which reads the whole text, still keeps the list in
  the sidecar. The badge then offers Move into File, and that move is refused
  with the size reason.

Every node can be downstream. A generated image or video is an ordinary file,
and its list is in its `upstream.yaml` like that of any other file
([generation cards](generation-cards.md#card-information)).

## Path grammar

An entry is taken as the source text of its item.
- A plain YAML scalar is never type-resolved, so `2024` names the path `2024`.
- One trailing `/` is removed before validation, so `docs/` names the folder
  `docs`.

An entry is valid when all of these hold:

- it is not empty and does not start with `/`;
- it contains no backslash, no NUL, and no other control character;
- it has no empty, `.`, or `..` segment;
- its first segment is not `.bh`;
- it does not name the workspace root, and it does not name the downstream node
  itself.

Other characters that the file system accepts in a name are valid. That
includes `?`, `:`, `*`, `"`, `<`, `>`, `|`, and non-ASCII text.

Matching rules:
- Entries are relative to the workspace folder that owns the downstream node.
  References between workspace folders are not representable.
- Entries and file names are compared after NFC normalization, then with
  `IUriIdentityService` comparison, so a case-only difference matches on a
  case-insensitive file system.
- BaseHalf writes an entry in the Unicode form of the name on disk, and writes
  folder entries without a trailing slash.
- Validation is per entry. One invalid entry never hides the valid entries in
  the same list.
- A later duplicate of an earlier entry is invalid.

## Markdown store

### Recognition

Frontmatter is a block delimited by `---` lines at the start of the document,
after an optional BOM. The BaseHalf recognizer accepts it when its content is a
YAML block mapping. Every projection that hides frontmatter uses the same
recognizer.

- The recognizer accepts a mapping key whose value is empty (YAML
  `missing-value` at a mapping colon). An `upstream:` left behind by a person or
  an agent therefore never turns the whole block into body text.
- This tolerance lives in the BaseHalf recognizer, not in `base/common/yaml.ts`.
- A leading `---` with no closing fence within the first 64 KiB means the
  document has no frontmatter.

The `upstream` value is read from source text:

- An empty value, a plain `~`, `null`, `Null`, or `NULL`, or `[]` means no
  entries.
- A block or flow sequence yields one entry per item.
- Any other plain or quoted scalar is one entry.
- An item that is empty, `~`, a mapping, or a sequence is an invalid entry. The
  other entries stay valid.

The store is **unreadable**, contributes no edges, and cannot be written by
BaseHalf when any of these hold:
- the value is a mapping;
- the `upstream` key appears twice;
- the value or any item is a plain scalar that starts with `&`, `*`, or `!`
  (an anchor, alias, or tag);
- the value is a block scalar (`|` or `>`).

A document is **not writable** by BaseHalf in two cases:
- a closed leading fence pair whose content the recognizer rejects;
- a document that uses TOML `+++` frontmatter.

BaseHalf never writes into such a document. It has no `upstream` key, so its
list is kept in its sidecar
([A note that cannot hold its list](#a-note-that-cannot-hold-its-list)) and
connecting into it is not refused. A note that merely starts with a thematic
break is one of these documents.

**Entries inside the block.** Such a block can still list connections: for
example, frontmatter that BaseHalf wrote and that another tool later made
invalid elsewhere. When the block has a line matching `^upstream\s*:`,
BaseHalf reads that key's own lines (up to the next line that starts another
key) as a list and keeps its valid entries apart from the store, as the
note's **block entries**.

- Block entries draw no edges while the note has no sidecar. The badge shows
  one issue, "The connections written at the top of this note are not in
  use.", with **Rebuild List**.
- The first write to the note's sidecar starts the sidecar with the block
  entries, so a connect never leaves them behind. Rebuild List does the same
  and nothing else. The note is not changed.
- Once the sidecar exists, the block entries are ignored and the issue is
  gone. That must stay true when the user removes the last entry, or the next
  connect would bring back connections the user removed. So while the note
  has block entries, a sidecar that becomes empty is kept as a file with an
  empty list. Only undoing the step that carried the entries over deletes it
  again.
- A removal of an entry that is not listed creates no sidecar.
- A block with no such line, or with no valid entry, carries no issue.

### Writes

BaseHalf edits frontmatter with a minimal text edit limited to the `upstream`
key's lines. It never re-serializes the mapping. Other keys, their order,
comments, quoting, and the body stay byte-identical.

- **No frontmatter.** Insert `---`, `upstream:`, the item lines, and `---` at
  the start of the document (after the BOM), using the document's EOL.
- **No `upstream` key.** Insert `upstream:` and its item lines immediately
  before the closing fence. If the mapping is not a block mapping that starts
  in column 0, the document is not writable.
- **Block list.** Items are added, removed, or replaced line by line, keeping
  the list's indent.
- **Single scalar or flow sequence.**
  - If every current item is a valid entry, BaseHalf replaces the value text,
    from after `upstream:` to its end, with a block list of the same entries.
  - A single scalar that is not a valid entry means the key is used by another
    tool. The store is reported as "Another tool keeps something else where
    this upstream list goes", and writes are refused with that reason.
- **Order.** New entries are appended. Removals keep the order of the rest. A
  source-end reconnect replaces the entry in place.
- **Quoting.** An entry is written as a double-quoted scalar when it has any of
  these properties. Otherwise it is written plain.
  - It starts with a YAML indicator or whitespace, or ends with whitespace.
  - It contains any of `: `, ` #`, `,`, `[`, `]`, `{`, `}`, `"`, `'`, or a tab.
  - It ends with `:`.
  - It matches a YAML 1.1 or 1.2 null, bool, int, float, or timestamp form, for
    example `~`, `null`, `yes`, `off`, `true`, `2024`, `01`, `0x1F`, `1e3`,
    `.inf`, or `2024-01-01`.
- **Last entry removed.** Remove the key line and its item lines, and keep any
  comment lines. If only whitespace remains between the fences, remove the
  block and both fences. If comments or other text remain, write `upstream: []`
  instead, so no user byte is lost and the block stays recognizable.
- **Idempotence.** Adding an entry that the current text already lists, by
  identity, writes nothing and succeeds. Removing an entry that is not listed
  writes nothing and succeeds.

## Drafts

A draft is a node: a `generation.yaml` with no `made.yaml` whose path names
no file, a generation card whose image or video does not exist yet
([generation cards](generation-cards.md#drafts-and-missing-files)). The
index treats a path that holds a draft as present. A draft in a folder that
does not exist on this computer is not shown, so it is not present either: an
entry that names it is dangling until a folder of that name exists.

- Its store is its `upstream.yaml`, under the rules of
  [Sidecar store](#sidecar-store). For a generation card, a draft or one with
  its file, the list is also its inputs, in order
  ([generation cards](generation-cards.md#inputs)).
- **Connect into a draft** appends an entry, as into any sidecar node. So
  does a connect into a generation card while it generates and after its
  file has arrived. An entry that is already listed is never listed twice. A
  generation records the inputs it used when it starts, so a later change of
  the list never changes what made a file.
- **A draft that is being made.** Create from Connection writes the draft's
  `upstream.yaml` before its `generation.yaml`. For that first write the edit
  service counts the draft as present when its path has a generation
  extension, names no file or folder, has no `made.yaml`, and lies in a folder
  that exists; any other path that holds nothing is refused as missing.
- **An entry that names a draft** is not dangling: it draws an edge and
  shows no issue. As an input it is unavailable until the draft has its
  file.
- When the draft's file arrives, the same `upstream.yaml` is the store of the
  card with its file. Nothing moves.
- **A missing file is not a draft.** A generation card that has a
  `made.yaml` and whose file is gone is a node that is gone, as any file
  that is gone: entries that name it are dangling, and its `upstream.yaml`
  stays until the file returns ([Sidecar store](#sidecar-store)).
- **A copy** of a generation card starts with no upstream list, as every
  copied sidecar node does.
- The product has not launched: a `.bhnode` that an earlier build wrote is an
  ordinary file, whose own `upstream` field is not read.

## Sidecar store

- A sidecar-store node keeps its list in `.bh/mirror/<path>/upstream.yaml`. The
  only recognized key is `upstream`, read with the Markdown value rules. The
  file needs nothing else, so an agent can create it with only that key.
- BaseHalf edits `upstream.yaml` only through the reference edit service, using
  the same minimal text planner as frontmatter. No other BaseHalf writer opens
  this file. Builds before D37 never read or write it.
- **A note's sidecar.** An `upstream.yaml` that belongs to a Markdown note is
  that note's store while the note has no `upstream` key
  ([A note that cannot hold its list](#a-note-that-cannot-hold-its-list)).
  When the note could take the key, the badge also reports "An upstream list
  for this note is saved outside the note" and offers **Move into File**. The
  list stays in use until the user moves it.
- **Wrong owner.** An `upstream.yaml` that belongs to a Markdown note with an
  `upstream` key of its own is ignored and reported the same way.
- **Move into File**, in one explicit operation:
  - appends to the file's own store the entries it does not already list, in
    order;
  - then removes the `upstream.yaml`.
- **Missing node.** An `upstream.yaml` whose node does not exist contributes no
  edges and no downstream entries. It becomes live again if a node reappears at
  that path. This holds for a note too: when a note is added, restored from
  the trash, or brought back by a branch switch, the index reads its sidecar
  again. An `upstream.yaml` whose path is a draft is live: a draft is a node
  ([Drafts](#drafts)). That of a generation card whose generated file is gone
  is not: the card is a missing file until its file returns.
- **Workbench move.** The node's `upstream.yaml` moves with its mirror
  directory. The mirror cascade never changes the upstream value of any other
  node; only the [rename refactor](#rename-refactor) does.
- **Delete.**
  - A workbench delete to the trash keeps the node's `upstream.yaml`, so a
    restore brings its upstream list back. The same applies to every descendant
    of a deleted folder.
  - A permanent delete removes the file.
  - Deleting a draft removes its `upstream.yaml` with the rest of its card
    information ([generation cards](generation-cards.md#deleting)).
- **Copy.** A copied sidecar node starts with no upstream list. Unlike Markdown,
  its list does not travel in its bytes.
- **Move into File** moves every entry BaseHalf can read into the file, a
  repeated entry once, and then deletes the sidecar.
  - When the sidecar holds anything the move leaves behind (an invalid entry
    other than a repeat, or content BaseHalf cannot read), BaseHalf first
    saves the sidecar as a recovery copy under the rules of
    [mirror file resilience](mirror-file-resilience.md), and afterwards says
    "BaseHalf moved the upstream entries it could read into <name>. The rest
    could not be used and was removed." If the copy cannot be saved, the
    sidecar is left unchanged.
  - Undo of a move out of a sidecar that could not be read writes a sidecar
    with the entries that were moved.
  - It refuses when the sidecar changed after its entries were read.
- A `badge.yaml` that holds only legacy keys reads as having no badge; the
  migration's legacy reader is the only consumer of those keys.
- **`badge.yaml`.** It keeps `path`, `kind`, `description`, and `orphan`, and
  never holds references. Until a migration run removes them, every
  `badge.yaml` write keeps the legacy `references` and `referenced_by` values
  unchanged, with the same items in the same order. A malformed legacy value
  never makes `path`, `kind`, or `description` unreadable.

## Reference index

`IBaseHalfReferenceIndexService` owns the derived graph.

### Sources

- **Truth** is saved disk content. Unsaved buffers are never indexed.
- **Enumeration.** For each workspace folder, the index covers every Markdown
  file that the canvas could show, and every draft.
  - It uses file search with every exclude setting and ignore file disregarded,
    and with symbolic links ignored.
  - Its explicit exclusions are the canvas-ineligible names (the canvas
    `SKIP_NAMES` and hidden file names, and the root `CLAUDE.md` and
    `AGENTS.md`), plus `.bh/` and `.git/`.
  - Extensions match without regard to case.
  - Sidecar stores come from a walk of `.bh/mirror/**/upstream.yaml`. The walk
    never follows symbolic links.
  - Drafts are the ones the generation card store lists: a `generation.yaml`
    with no `made.yaml`, whose path has a generation extension and names no
    file or folder, in a folder that exists
    ([generation cards](generation-cards.md#drafts-and-missing-files)). The
    same walk of `.bh/mirror/` that finds the sidecar stores finds them.
- **Reads.** Markdown reads at most the first 64 KiB. A leading BOM is removed
  before recognition. When a badge editor or Card Detail opens a node, that
  node's own store is read directly, so its Upstream list never depends on
  enumeration.
- **Ownership.** A file belongs to the innermost workspace folder that contains
  it. An outer folder skips files owned by a nested folder.

### States

The index of each workspace folder is in one of three states:

- **building**: the initial scan or a full rescan is running.
- **ready**: the scan finished.
- **partial**: one of these happened:
  - file search hit its limit;
  - the store count reached 50,000;
  - a store could not be read because of an I/O error; such files are listed as
    store problems;
  - the watcher reported an error.

A full rescan of a folder runs:
- after a watcher error or restart;
- when an event batch exceeds 1,000 paths;
- on the command **BaseHalf: Rebuild Upstream Index**.

A folder that is added starts in the building state. A folder that is removed
drops its stores, problems, and pending prompts.

### Events

| Event | Index action |
| --- | --- |
| A file changes or is added | re-read that store |
| A folder is added, or a path of unknown type is added | re-scan the subtree, including its mirror walk |
| A path is deleted | drop every store at or under that path, including sidecars under the matching mirror path |
| A change under `.bh/mirror/**/upstream.yaml` | re-read that sidecar |
| A `generation.yaml` or `made.yaml` under `.bh/mirror/` is added or removed | check again whether that path holds a draft, and read its sidecar again |
| A file or folder is added or deleted | check again whether that path, and the drafts below it, hold a draft that is shown |

The deleted paths of one event batch are dropped in one pass over the stores.
Each store is looked up among the deleted paths by its own path and the
paths above it, so the work grows with the number of stores and not with
that number times the number of deleted paths. Measured on 2026-10-11 in a
workspace of 4,300 notes: 300 files renamed at once outside BaseHalf kept the
window's thread busy for 2.7 seconds when every deleted path was compared
with every store, and nothing else in the window ran in that time. A unit
test deletes a folder, two notes, and a PDF with a kept list in one batch,
next to paths that only start like theirs, and those stay.

After a BaseHalf save succeeds, the edit service passes the saved text to the
index. The index updates that store and fires `onDidChange` before the
operation resolves. The watcher event that follows, for identical content,
does nothing.

### Consumers before ready

| Consumer | building | partial |
| --- | --- | --- |
| Canvas edges | cards shown, no edges, and a "Loading connections" status | drawn; the status notes unscanned files |
| Badge editor Downstream list, toggle counts | "Loading…", no counts | shown, marked incomplete |
| Any Markdown store change (connect, remove, undo, redo) | allowed: since D63 no store change needs the index | allowed |
| Delete confirmation | "Checking connections…"; confirming is allowed | "at least N items" |
| Rename refactor, Relink Everywhere, migration | wait for ready, with progress | proceed, and the prompt or report says "at least" |

Navigation and card rendering never wait for the index.

## Reference edits

`IBaseHalfReferenceEditService` performs every reference operation.

Primitive operations:
- **add** an entry;
- **remove** an entry, or several entries of one store in one write (Delete
  of several selected connections that end at one card);
- **replace** an entry in place (source-end reconnect, Relink, rename
  refactor);
- **move** an edge between downstream nodes (target-end reconnect).

A move adds the entry to the new downstream before removing it from the old
one. If it fails after the add, both entries remain and the failure is
reported.

### Preflight

Before writing anything, an operation resolves and validates every store it
will touch:
- the target kind;
- whether the store is readable and writable;
- the state of the Markdown model, and the flush (steps 2 and 3 below);
- the source-tree guard.

If any store fails, the operation writes nothing and names the blocking stores.

The rename refactor, Relink Everywhere, and migration are the exception. They
exclude failing stores and list them as skipped before the user confirms.

### Markdown documents

1. Capture a resource stamp for the document. Run the remaining steps inside
   `IBaseHalfWorkspaceMutationCoordinator.runResourceMutation`. If the stamp is
   stale or fenced, refuse with "This item is being moved".
2. Resolve the text file model. Refuse if any of these hold:
   - it is read-only, orphaned, in conflict, or in error;
   - it is binary.

   A note that cannot take an `upstream` key is not refused here. Its store
   is its sidecar ([A note that cannot hold its list](#a-note-that-cannot-hold-its-list)),
   and only an operation that addresses the note itself, Move into File, is
   refused for it.
3. Flush the pending edits of every open projection of the document. Rich
   registers its flusher under the workspace-and-path key, and the other
   projections under the resource key; flush both. If any flush returns false
   or has not finished within 2 s, refuse with "Finish or resolve the unsaved
   edit in <file> first".
4. If the document had unsaved changes before step 3 and the effective
   `files.autoSave` for it is `off`, refuse with "Save or revert <file> first".
   BaseHalf never saves text the user chose not to save.
5. Plan the minimal edit from the model's current text. If planning is a no-op,
   succeed without writing.
6. Apply the edit through `IBulkEditService` with a user-facing label and the
   model version check. This edit carries no canvas undo source; it belongs to
   the document's own undo stack.
7. Save the document. If the save fails because the file changed on disk while
   the model is still at the version BaseHalf produced, revert the model to
   disk, re-plan once, and apply and save again. Otherwise show "The upstream
   change to <file> is not saved" with Retry and Revert Change. A
   BaseHalf write never leaves a document in the save-conflict state without
   that notice.

### Rebuilding a list

A list that BaseHalf cannot read, or can read but will not edit in place,
would leave the user with an issue and no way to resolve it. **Rebuild List**
writes the list again in BaseHalf's own form. It is a user-started, confirmed
reference operation (Invariant 4) and never runs by itself.

**Where it is offered.** On the store issue row of the badge editor and in
**BaseHalf: Show Upstream Issues**, for these stores:

- a Markdown file whose `upstream` value is a mapping, a block scalar, uses an
  anchor, alias, or tag, appears more than once, holds a value used by another
  tool, or has an entry that spans several lines;
- a sidecar `upstream.yaml` that cannot be read.

It is not offered for a frontmatter mapping that is not a block mapping in
column 0 and already holds `upstream`. For it the row states the reason and
has no action.

A note that cannot hold a list keeps it in its sidecar
([A note that cannot hold its list](#a-note-that-cannot-hold-its-list)). For
such a note Rebuild List is offered only to carry over the
[entries inside its leading block](#recognition). Its confirmation detail
reads "BaseHalf will keep the connections it can read from this note for you.
The note itself is not changed."

**Confirmation.** "Rebuild the upstream list of <name>?" with the detail
"BaseHalf will write the list again in a form it can use. It keeps the
connections it can read. Anything else in the list is removed." and the
buttons **Rebuild List** and Cancel.

**Markdown.** BaseHalf removes every top-level `upstream` key together with
its value lines. At the position of the first one it writes one block list of
the valid entries those keys held, in order and without repeats. Other keys,
lines outside the removed ones, and the body stay byte-identical.

- **What it can read.** An anchor or a tag in front of an entry is dropped
  and the entry kept, without its quotes when it is quoted. An alias, an
  empty or null item, a mapping, and a block scalar hold no entry BaseHalf
  reads, and the plain entries beside such an item are kept.
- **No valid entry.** It writes no key, and when nothing else remains in the
  frontmatter the block is removed. When removing the key would leave
  something the recognizer rejects, such as only comments or a leading blank
  line, it writes `upstream: []` in its place, as removing the last entry
  does.
- **Another repeated key.** The block stays unrecognized, as it was. Its list
  is then one key that reads, and it is carried into the note's sidecar as
  [entries inside the block](#recognition).
- **Recovery copy.** Before the edit, BaseHalf saves the note's text up to the
  last line the rebuild changes as
  `.bh/cache/recovered/mirror/<path>/frontmatter.<12 hex digits>.md`. A marked
  folder gets no copy. When the edit has to be planned again because the note
  changed, the copy is taken again. If the copy cannot be saved, the note is
  left unchanged and BaseHalf says "BaseHalf could not keep a copy of what
  Rebuild List would replace in <name>, so it changed nothing: <plain failure
  reason>".
- **Undo.** The edit goes through the document as every Markdown write does
  and belongs to the document's own undo stack; it is not a canvas undo step.
- It is refused, and nothing changes, only when the keys cannot be located
  as whole lines: a frontmatter mapping that is not a block mapping in
  column 0.

**Sidecar.** BaseHalf first saves the file as a recovery copy,
`.bh/cache/recovered/mirror/<path>/upstream.<12 hex digits>.yaml`, under the
rules of [mirror file resilience](mirror-file-resilience.md). It then writes
the valid entries it could read as a block list, or deletes the file when
there are none.

- A sidecar BaseHalf reads but will not edit in place, such as a flow
  mapping, keeps every entry it reads.
- A sidecar it cannot read keeps the entries of the `upstream` keys that
  still read, whatever the shape of the file.
- A sidecar BaseHalf will not edit in place is always shown as an issue, so
  Rebuild List is offered wherever a write to it is refused.

The refusal rules of every other write apply: a marked folder, a read-only or
unsaved document, and a symbolic link refuse the rebuild with their reason. After a rebuild the store is readable and writable,
and its issue is gone.

### Sidecars

Sidecars, the lists of drafts included, are written by the reference edit
service with expected-bytes compare and swap, under the workspace mutation
lease.

### Multi-document operations

These operations write several stores:
- target-end reconnect;
- Relink Everywhere;
- rename refactor;
- migration;
- templates.

They run the preflight, then apply every Markdown edit in one bulk edit, then
write sidecars. If a later step fails, a notification lists exactly which
documents changed and which did not, and the same report goes to the BaseHalf
log. If the window closes during an operation, the remaining steps do not
resume. Entries that were not yet updated stay visible as issues.

### Undo

- **Canvas and badge editor operations.** Every reference operation started from
  the canvas or the badge editor is one canvas custom undo element under the
  canvas undo source. For every store it affects, the element records the
  expected and next upstream lists.
  - Undo re-resolves each store, loading its Markdown model if the model is not
    loaded, and compares the store's current list:

    | Current state of every affected store | Undo |
    | --- | --- |
    | holds `next` | writes `expected` through the edit service, using the same refusal and save rules |
    | holds `expected` | the step completes without writing |
    | anything else | refuses with "<file> changed since this edit", writes nothing, and keeps the element |

  - Redo mirrors this.
  - A multi-store gesture is one element and one canvas undo step. Canvas undo
    never skips a refused element to undo an older one.
  - The element joins the undo stacks of the canvas and of every sidecar
    store it changed, so a newer canvas step supersedes older undone steps of
    those nodes. It never joins a Markdown document's stack, which the
    document's own text undo owns.
- **Document editor.** Undo in a document's editor follows that document's own
  text undo stack. It can undo the text of a reference edit while the model is
  alive. After that, canvas undo of the same step finds `expected` and
  completes without writing.
- **Not undo steps.** Migration and template instantiation are not canvas
  undoable. The rename refactor and Relink Everywhere are canvas undo elements.
- **Anchor rows** do not take part in undo.
- **Participants.** A feature may take part in a reference edit of a node it
  owns. Once every store of the operation is written, or the stores it wrote
  before it failed, it writes what depends on the lists that changed, and
  every undo and redo of the operation restores that together with the
  lists: the canvas step, and the Undo of a rename's report too. Putting
  back or writing again what a participant wrote changes nothing that is so
  already, so a step whose lists were restored another way leaves it right.
  Generation cards do this for the mentions in a draft's prompt
  ([generation cards](generation-cards.md#mentions)).
  A participant never takes part in undo, redo, or a rollback, which put
  back what it wrote instead; an operation that was refused or wrote no
  store never reaches it; and when it cannot write, the lists stay written
  and it says so.

### Rich editor coherence

The rich projection keeps frontmatter outside its block model, and it never
writes frontmatter bytes from its own cache.
- Every save, force-write ("Keep my edits"), and projection handoff combines
  the model's current frontmatter with the rich body.
- Conflict detection compares bodies only, so a difference in frontmatter alone
  is never a conflict, and "Keep my edits" keeps the local body with the
  model's frontmatter.
- A model change that arrives while a rich save is in flight is queued and
  forwarded to the webview after the save completes.
- A save result refreshes the cached frontmatter.
- If the document cannot be read at save time, the save fails and the rich
  edits stay pending; the cached frontmatter is never written instead.

## ADHD read ranges

- `adhd.yaml` gains `line_base: body`. Read ranges then count lines from the
  first body line after the frontmatter that the recognizer accepts, or from
  line 1 when there is none. Reference edits, agent edits, and undo can
  therefore no longer shift read ranges.
- A file without `line_base` holds absolute lines from earlier releases.
  Readers convert its ranges by subtracting the current frontmatter line count.
- Before a reference operation changes the frontmatter line count of a document
  whose `adhd.yaml` has no `line_base`, it first persists that conversion. This
  is a one-time `.bh/` write that is part of the operation.
- Every later ADHD write stores body-relative ranges.

## Canvas

### Edges

For each card `T` in a folder canvas, and each valid, non-dangling upstream
entry `F` of `T` that is a sibling card, BaseHalf draws `F → T`. It uses
anchors from the `canvas.yaml` edge row for `(F, T)` when one exists, and
default anchors otherwise. References with nodes outside the folder draw no
edge. They appear in the badge editor and in the toggle counts.

`canvas.yaml` edge rows are anchor memory only. They never create, block, or
imply a reference.
- Connect upserts the row. Disconnect keeps it, so undo or a later reconnect
  restores the anchors.
- A row with no live reference is ignored when drawing and is kept. BaseHalf
  never removes a row because a reference is missing.
- Rows are removed only when a workbench structural operation deletes an
  endpoint card or moves it out of the folder.

### Connecting

A connection's target can be any node, a draft included (see
[Stores](#stores)). These connections are refused with an explanation:
- into a note whose own `upstream` key BaseHalf cannot read or edit in place
  (the message names Rebuild List when it applies);
- into a node whose store needs a `.bh/` write in a marked folder (see
  [Source-tree guard](#source-tree-guard));
- into a generation card with its file, whose entries are the inputs that
  made it, and into a draft while it generates
  ([generation cards](generation-cards.md#what-is-connected-is-sent));
- into a draft whose model can use the source in none of its modes
  ([generation cards](generation-cards.md#what-is-connected-is-sent)).

Disconnecting an entry of a generation card with its file, or of a draft
while it generates, and reconnecting one, are refused the same way, on the
canvas and in the badge editor. The rename refactor still rewrites their
entries after a move, so that they keep naming the inputs that were moved.

### Creating connected nodes

- **PDF branch** creates the note with an `upstream` list naming the PDF in its
  initial bytes: a frontmatter block before the heading. Grow branch from a
  book does the same with the book
  ([PDFs and books](documents-and-books.md#grow-branch-from-a-book)).
  - The body's `Source:` Markdown link stays for navigation.
  - This is one create with no second write, so there is no "created but not
    connected" state.
  - Framing after the branch uses the PDF's downstream set from the index,
    including the new note once it is indexed. It falls back to the PDF and the
    new note.
- **Create from Connection** creates a node that references the source.
  Releasing a connection drag from a card on empty canvas opens a context menu
  at the release point. It is the same kind of menu as the double-click create
  menu, never Quick Input.
  - **Items.** **Note**, **Image**, **Video**, and **Audio**. These are the
    double-click menu's New Note, New Image, New Video, and New Audio (D78).
    The earlier items for empty audio, file, PDF, and presentation nodes are
    removed (D63).
  - **First bytes.** The new node lists the source as its only `upstream`
    entry before it exists: a note in its initial bytes, and a draft in its
    `upstream.yaml`, which is written before its `generation.yaml`. There is
    no "created but not connected" state.
  - **Edge and placement.** The edge runs from the dragged handle to the
    opposite side of the new card. That side is centered on the release point.
    The card is not moved from there, also when it reaches into another card
    or past the edge of the visible canvas, and the view is not moved either
    ([canvas card placement](canvas-card-placement.md#a-pointed-place-is-taken-as-it-is)).
    The anchor row is written as a connect writes it. In a marked folder no
    row is written, and the edge uses default anchors.
  - **Note** creates `untitled.md` (or the next free `untitled-N.md`). Its
    content is only a frontmatter block that lists the source. It opens for
    inline editing, as New Note does.
  - **Image**, **Video**, and **Audio** create a draft named `image`,
    `video`, or `audio` with the extension of the model's output
    (`image.png`, `video.mp4`, `audio.mp3`), with the next free number when
    the name is taken by a file, a folder, or a draft, as New Image, New
    Video, and New Audio do
    ([generation cards](generation-cards.md#creating-a-generation-card)).
    The draft is selected, and its panel shows. All three are offered from
    every source, a note included: the source becomes the draft's first
    input, and the panel says how a generation uses it, or that its model
    cannot use it and Generate does not run
    ([generation cards](generation-cards.md#inputs)). An audio draft has the
    size of a file card, and the side the line enters is centered on the
    release point as for any card.
  - **Cancel.** Escape or a click outside closes the menu and writes nothing.
  - **Undo.** For a draft, one canvas undo step removes the draft with its
    card information, its card, and its edge together, and refuses while the
    draft generates. The connection lives in the draft's `upstream.yaml`. A
    note is undone the way New Note is. Canvas history is linear: a new
    canvas action discards the actions that were undone and not redone, in
    every folder, so a later redo never brings back a removed node.

### Deleting

Deleting a node never changes another node's store. Downstream entries that
named the deleted node become dangling.

The delete confirmation says: "<name> is upstream of K items. They will show a
broken upstream entry that you can fix later." It has a checkbox, "Also remove
<name> from their upstream lists", which is unchecked by default. When it is
checked, the removals are one bulk edit applied after the delete, as a separate
undo step. A generation card with its file keeps its entry: it names an input
that made the card, and its panel shows it as gone.

### Copying and importing

| What is copied | What happens to upstream entries |
| --- | --- |
| Markdown file | keeps its bytes and entries. Entries that do not resolve show as dangling. A note whose list is kept in its sidecar starts with no upstream list, like a sidecar node. |
| Folder | entries inside it that name other items in the original folder still name the originals. The copy confirmation states this. |
| Generation card, a draft or one with its file | a draft's copy is a draft with the same prompt and settings; a copy of a card with its file gets a `made.yaml` with a new `id` that says it is a copy. It starts with no upstream list and no task ([generation cards](generation-cards.md#moving-renaming-copying-and-undo)) |
| Sidecar node | starts with no upstream list |

### First frontmatter notice

The first time BaseHalf adds a frontmatter block to a Markdown file that had
none, a one-time notification (per machine) says: "Saved this connection inside
<B>. Agents and other tools that read the note see it there." Its only action
is **OK**. It has no action that opens the note's source (D41).

## Badge editor

The card flip face and the Card Detail badge zone share one editor.

- **Description.** Storage is unchanged. The placeholder reads "One line about
  this file…" ("…this folder…" for folders). UI copy no longer promises that
  agents read it.
- **Upstream.** This node's own list, which is editable.
  - Helper line: "Context that flows into this card. Saved inside this file,
    so agents reading it see it too." For sidecar nodes, and for a note whose
    list is kept in its sidecar: "BaseHalf keeps this list for this file."
    ("…this folder." for folders).
  - **Add Upstream** opens a workspace-wide picker titled "Add upstream to
    <name>". The picker:
    - lists every node in the downstream node's workspace folder, drafts
      included, leaving out the node itself and its current entries;
    - orders cards on the current canvas first, then the folders above this
      node (nearest first) and their children, then everything else by path;
    - shows each item's name, workspace-relative path, and description, and
      matches typing against name and path.
  - × removes an entry.
- **Downstream.** The derived list, with navigation to each node.
  - **Add Downstream** opens the same picker. It adds this node to the chosen
    node's upstream list.
  - × removes this node from that node's list. Its tooltip names the file:
    "Remove from the upstream of <path>".
  - Both actions write the other node's store exactly as a canvas connect or
    disconnect would, under the same refusal rules.
- **Entry rows.** Dangling and invalid entries render inline in Upstream at
  their list position, in a warning style, with their actions:
  - **Dangling:**
    - **Relink…** opens the picker and replaces the entry in place.
    - **Relink Everywhere…** replaces the same dangling path in every store
      that names it, including entries under it when it was a folder. It is a
      confirmed multi-document operation that follows the rename refactor rules
      and is one undo step.
    - **Remove**.
    - When exactly one node in the workspace has the entry's file name, the
      first action is **Relink to <path>**.
  - **Invalid, in a readable store:** **Remove**. When the entry, read
    relative to the downstream file, names an existing node, the first action
    is **Use <workspace path>**, which replaces it in place.
  - **Unreadable or not-writable store:** one issue row that states the
    reason, with **Rebuild List** when BaseHalf can rebuild the list
    ([Rebuilding a list](#rebuilding-a-list)).
  - **No Open File.** No row, notice, or list offers an action that opens a
    file's source or a file under `.bh/`. BaseHalf assumes users do not read
    code (D41), so every repair it offers is an action in its own interface.
    An earlier **Open File** action is removed from all of them.

    **Known gap.** One state has no repair in the product. A note whose
    frontmatter is not a block mapping in column 0 and already holds
    `upstream` has its entries read, and edits to it are refused with the
    reason.
- **Counts.**
  - The collapsed summary and the card toggle tooltip show "↑N upstream · ↓M
    downstream", counting nodes in any folder, plus "· K issues" when there are
    issues.
  - Issue rows are not listed twice. The issue count is the number of warning
    rows plus one for an unreadable store.
- **Empty states.**
  - Upstream: "Nothing flows into this card yet. Add upstream, or drag a
    connection into it on the canvas."
  - Downstream: "Nothing draws on this card yet."
- **A generation card's rows** are plain entries, and × removes one whether
  or not the card has its file, also while it generates. Its panel shows its
  inputs with their names and how a generation uses them
  ([generation cards](generation-cards.md#inputs)).

### Wording

UI copy uses "upstream", "downstream", and "connection". It avoids
"reference", which also names the references mode of a generation card.

Every string the reference interface shows is written for someone who does not
read code (D41):

- "upstream", "downstream", "upstream list", "connection", "badge", "note",
  and "node" are product words and are shown as plain text, never in code
  formatting.
- No string names a file format or a part of one (frontmatter, YAML, TOML,
  JSON, key, mapping, anchor, alias, tag, block scalar), the `.bh/` folder or
  a file in it, "metadata", "sidecar", or "node document".
- A message that names a store names the node it belongs to, never a file
  under `.bh/`. Where a note and its sidecar must be told apart, the sidecar
  is "the list BaseHalf keeps for <name>".
- Parser and file-format detail goes to the log, not to the message. A file
  system failure is shown as a
  [plain failure reason](mirror-file-resilience.md#failure-reasons-in-messages),
  never as the error's own text.
- No message tells the user to fix a file. Where BaseHalf has a repair, the
  message names the action and where it is.

Store issue rows, in the badge editor and in Show Upstream Issues:

| Store state | Row text | Action |
| --- | --- | --- |
| A list BaseHalf cannot read (mapping, repeated key, anchor/alias/tag, block scalar; an unreadable sidecar) | "BaseHalf can't read this upstream list." | Rebuild List |
| A list BaseHalf reads but will not edit in place (a Markdown entry over several lines; a sidecar that is a flow mapping) | "BaseHalf can't change this upstream list the way it is written." | Rebuild List |
| A value used by another tool | "Another tool keeps something else where this upstream list goes." | Rebuild List |
| A frontmatter mapping BaseHalf cannot edit that already holds `upstream` | "BaseHalf can't save connections into this note because of how the file begins." | none |
| A store the file system refuses to read | "The upstream list could not be read: <plain failure reason>" | none |
| A sidecar list for a note that could hold it, or for a note that has a list of its own | "An upstream list for this note is saved outside the note." | Move into File |
| Entries inside a leading block BaseHalf does not recognize, in a note with no sidecar | "The connections written at the top of this note are not in use." | Rebuild List |

Refusal messages for the same states, where <name> is the node's file name:

| Refusal | Message |
| --- | --- |
| The list cannot be read or edited in place and can be rebuilt | "BaseHalf can't read the upstream list of <name>. Use Rebuild List in its badge first." |
| The list cannot be read and cannot be rebuilt | "BaseHalf can't read the upstream list of <name>." |
| The list is read but cannot be edited in place | "BaseHalf can't change the upstream list of <name> the way it is written. Use Rebuild List in its badge first." |
| A sidecar changed after it was read | "The upstream list of <name> changed since this edit." |
| A value used by another tool | "Another tool keeps something else where the upstream list of <name> goes. To connect anyway, use Rebuild List in its badge." |
| A frontmatter mapping BaseHalf cannot edit that already holds `upstream`; Move into File into a note that cannot take a list | "BaseHalf can't save connections into <name> because of how the file begins." |
| Move into File into a note whose frontmatter is beyond the size window | "BaseHalf can't save connections into <name>: the top of the file is too large to change." |
| A sidecar the file system refuses to read | "The upstream list of <name> could not be read: <plain failure reason>" |
| A sidecar behind a symbolic link | "BaseHalf keeps the upstream list of <name> behind a symbolic link. BaseHalf doesn't change files through links." |
| A marked folder | "<name> is in a folder BaseHalf is set to leave alone." |

Invalid entry rows keep their short reasons. Two of them avoid file-system
terms: an entry under `.bh` reads "This path points into BaseHalf's own
files.", and an entry with a control character reads "This path contains a
character that can't be used."

The command **BaseHalf: Show Upstream Issues** lists every issue in the
workspace in a quick pick, grouped by file, with the same actions. Choosing an
issue that has no action shows its reason in a notification.

## Rename refactor

When a node or folder is moved or renamed, BaseHalf rewrites the entries that
name it. It does not ask and shows nothing
([following moved items](following-moved-items.md#entries-are-always-updated)).
This holds for a move through the workbench and for a move outside it that
BaseHalf recognized. A workbench move is any `IWorkingCopyFileService` move:
Explorer, canvas rename, drag-move, and paste-move. Undo and redo of a move
are moves and follow the same rules.

- **Planning.**
  - For a workbench move, BaseHalf snapshots from the index, in the
    working-copy file operation's prepare step, every store whose entries name
    a moved path or a path inside a moved folder. After the move and its
    mirror cascade it maps each affected store to its current location.
    Stores inside a moved folder and moved sidecars are read at their new
    paths.
  - For a move outside the workbench, the plan starts when the card
    information is at the new path. It finds the stores in the index, where
    the entries still name the old path.
  - Pending moves compose. If a path in a plan that is not written yet moves
    again, the entries map through both moves.
- **When it writes.** BaseHalf re-plans from the stores' current content. It
  rewrites only entries that still name the old path and whose old path still
  names no node. Entries that changed, or that now resolve to a node at the
  old path, are left alone.
- **Undo.** The update adds no undo step of its own. Undoing a workbench move
  is a move back, which updates the entries back.
- **Scope.** Entries inside a moved folder that name other items in the same
  folder are updated too. The list of a generation card is updated whether or
  not it has its file, also while it generates: its generation recorded its
  inputs when it started. A moved draft is a moved item, and the entries that
  name it are updated as for a file.
- **Not written now, written later.** A document with unsaved changes when
  auto-save is off is written when it is saved or reverted. Until then the
  entry is broken and shows as broken.
- **Never written:** anything in a marked folder.
- **Case-only rename.** On a case-insensitive file system the entries still
  match. Their spelling is updated, because other systems match exact
  spelling.
- **Store kind changes.** When a rename changes the node's store kind, for
  example from `notes.txt` to `notes.md`, its entries move into the file as
  **Move into file** does, in the same update.
- **Across workspace folders.** Moves between workspace folders stay refused,
  because entries cannot cross folders.
- **Legacy pairs before migration.** Until migration removes them, a workbench
  move rewrites legacy `references` and `referenced_by` items that name moved
  paths in every `badge.yaml`, as releases before D37 did, so an unmigrated
  pair stays complete. This touches only legacy keys, never an upstream value.
- **Removed cascades.** The move cascade rewrites no node input of its own,
  a delete removes no entry by itself, and no badge graph of other badges is
  rewritten.
- **Outside the workbench.** A move made outside it (terminal commands,
  including an agent's own file tools, and other applications) is followed
  when BaseHalf recognizes the item at its new path: the card information
  moves and the entries are rewritten
  ([following moved items](following-moved-items.md)). An item it does not
  recognize is left as it is. Its entries become dangling and visible, and
  **Relink Everywhere…** repairs them. Its BaseHalf metadata stays at the old
  mirror path, and at the next workspace open a `badge.yaml` whose node is
  gone is marked orphan, except in marked folders.

### Agent moves

BaseHalf has no move operation for agents. An agent moves and renames files
with its own tools, and BaseHalf follows the item
([following moved items](following-moved-items.md)). The host operation
`basehalf.workspace.move`, which earlier releases offered to Agent Area
sessions, is removed. Its id stays reserved: a request for it is refused, and
no capability for agents may declare it.

## Migration from legacy badge pairs

A legacy pair `A → B` is **complete** when A's `badge.yaml` `references`
contains B and B's `referenced_by` contains A. This matches the old liveness
rule. Until a pair is migrated it produces no edge.

### Detection

- Detection for a workspace folder waits until that folder's index is ready.
- It runs on open, when a folder is added, and (debounced) when a `badge.yaml`
  that contains legacy keys changes.
- It skips folders marked with the source-tree marker.

### Outcomes

Each pair ends in exactly one outcome:

- **Migrated.** The downstream store, re-read from disk after the write, lists
  the upstream entry. A pair whose entry was already present is also migrated.
- **Deferred.** The write was refused or not saved for a reason the user can
  fix. The legacy keys stay, and the pair is offered again. Deferral reasons:
  - unsaved changes with auto-save off;
  - a conflict;
  - a read-only file;
  - an unreadable or not-writable store;
  - a failed save;
  - a missing downstream;
  - an endpoint owned by another workspace folder;
  - a store reached through a symbolic link.
- **Dropped.** The pair can never be represented, and it is recorded:
  - one-sided;
  - self;
  - a workspace-root or `.bh/` endpoint;
  - an item the legacy grammar rejected, a path with a control character, or a
    malformed legacy key.

  A pair is never dropped for a path that the legacy badge grammar accepted,
  other than those endpoints.

### Prompt

The prompt appears whenever legacy keys exist and at least one pair needs a
downstream write:

> Connections from an earlier BaseHalf version are hidden until they are moved
> into your files. Move N connections? BaseHalf will save them inside M notes
> and in the lists it keeps for K other items.
>
> Move Connections · Preview · Later

With only notes the last sentence ends after "M notes."; with only other items
it reads "BaseHalf will save them in the lists it keeps for K items."
The report follows the [wording](#wording) rules: a row for a legacy key that
cannot be read is described as "an earlier connection list in its badge".

- **Preview** opens a read-only report grouped by downstream node, in three
  sections: "Will be added", "Already present", and "Can't be moved" with each
  reason. One-sided pairs appear there as "Only one side was recorded". The
  report offers **Move Connections**.
- **Later**, or closing the notification without choosing, hides the prompt
  until the next session. The command **BaseHalf: Move Earlier Connections…**
  stays available while pending pairs exist.
- **Move Connections** re-scans before writing. One migration runs per
  workspace at a time; choosing it again during a run shows the progress.
- In a multi-root workspace, one notification covers every folder that has
  pending pairs.
- When no pair needs a downstream write, because every remaining pair is
  already present or dropped, the pairs are settled without a prompt. Settling
  writes only `.bh/` files.

Completion notification: "Moved N connections into M files." When any pair was
dropped or deferred, it adds "J couldn't be moved" with a **Show** action that
opens the report.

### Durability

1. Before removing any legacy key, migration appends every processed pair,
   with its outcome and the date, to `.bh/legacy-references.yaml`, and re-reads
   the file. That file is append-only; existing records are never rewritten or
   removed.
2. BaseHalf removes a pair's legacy keys only on a later detection, at the next
   open or later. It does so when the downstream store on disk still lists the
   upstream, or when the pair has a Dropped record. Deferred pairs keep their
   keys. If the user undoes a migration edit, the pair becomes eligible for
   migration again and is not lost.
3. Migration writes carry no canvas undo source. The migration itself is not
   an undo step; the report says that changes are reverted with version
   control.
4. If the window closes during migration, nothing resumes automatically. The
   next detection sees the written pairs as already present.

## Templates

A template is one JSON document of version 1 with four lists:

- `files`: the text files it creates, each `{ path, contents }`.
- `drafts`: the generation cards it creates without a file, each
  `{ path, prompt }`. The path has a generation extension, which gives the
  draft its kind ([generation cards](generation-cards.md#terms)). `prompt`
  is at most 64 KiB and may be left out, which is an empty prompt. It
  mentions an input as `@[<path>]` with the path relative to the template,
  as its references name it; instantiation rebases each mention as it
  rebases the references, so the draft's prompt mentions the entries of its
  `upstream.yaml` ([generation cards](generation-cards.md#mentions)). A draft
  declares nothing else: its provider, model, mode, and values are this
  computer's.
- `cards`: a card row `{ path, x, y, width, height }` for a file or a draft.
- `references`: connections `{ from, to, fromAnchor, toAnchor }` between the
  files and drafts it creates.

Paths are relative to the template and portable. A template holds no other
list: one with the `nodes` list of earlier builds is refused (D63). Every
folder that holds a draft also holds a file of the template, so that the
folder exists on every computer the project reaches through git
([generation cards](generation-cards.md#drafts-and-missing-files)).

- Instantiation creates the project folder, its folders, and its files, and
  writes the card rows and anchor rows the template declares, drafts'
  included. Then it makes each draft through the card store: its
  `upstream.yaml` with the references into it, written first, then its
  `generation.yaml` with the template's prompt and the provider, model, mode,
  and values of the last generation of the draft's kind on this computer,
  made legal for that model, as New Image and New Video do. A draft keeps the
  name the template gives it. Last, it writes the `upstream.yaml` of the
  other sidecar targets.
- Template `references` pairs keep their format. The host materializes each
  pair into the target node's store. It rebases each path from template-relative
  to workspace-relative, under the instantiation folder:
  - new Markdown files receive the `upstream` list in their initial bytes,
    merged into any template frontmatter by the planner;
  - sidecar nodes, the template's drafts included, receive `upstream.yaml`,
    subject to the source-tree guard.
- Template validation, in the SDK and in the host, rejects template text
  files whose frontmatter contains an `upstream` key.
- Pending template setup records move to the storage key
  `basehalf.canvas.pendingTemplateSetups.v2`. Version 1 records from an older
  build are discarded, with a warning that names the setup.
- A setup that is finished later makes the drafts that are not there yet and
  keeps the ones that are. A draft whose path an item or other card
  information took meanwhile is refused with its name, and nothing of it is
  written.
- Undoing the creation of a project moves its folder away and keeps the card
  information of its drafts, as a delete to the trash does; redoing it shows
  them again.

## Generation

- A generation reads the card's own upstream list, in order, from its
  `upstream.yaml` ([generation cards](generation-cards.md#inputs)). It reads
  no other store.
- A dangling entry is an input that is not there: the panel shows it dimmed
  with its reason, and it is not sent. An entry that names a draft is not
  dangling; it is unavailable until the draft has its file.
- A generation records the paths it used in its task record when it starts,
  and in `made.yaml` when its file lands. Upstream edits afterwards never
  change a generation that runs or the record of a file that exists.
- Markdown inputs are read without their frontmatter when the generation
  starts, as [Inputs](generation-cards.md#inputs) says.
- A mention in a draft's prompt follows its input when a reference edit
  removes or replaces an entry of the draft's list, a rename and a relink
  included: it takes the new path, or it is taken out with the entry
  ([generation cards](generation-cards.md#mentions)).

## Capability discovery

Discovery describes the new model. The node command bridge version increases,
because both ends validate these literals.

- `host.contextEdge` states three things:
  - the downstream stores the edge;
  - the Markdown store is the `upstream` frontmatter key;
  - a generation card uses its inputs in the order of its `upstream` list.
- `host.modelCatalog` is the model catalog that agents choose a card's
  `provider`, `model`, `mode`, and `params` from
  ([generation cards](generation-cards.md#agents)).
- `host.generationCards` is the contract of what an agent may write to make
  or change a generation card, and the command that generates it
  ([generation cards](generation-cards.md#agents)). The bridge that carries
  discovery and `basehalf --generate` is version 5.
- Discovery has no `host.nodeDocument`, and `host.contextEdge` names no node
  store and no `node-result` source (D63). It lists no recipes (D58).
- `host.operations` lists the template operation when templates are
  installed, and nothing otherwise. Host operation ids are reserved,
  including the retired `basehalf.workspace.move`: a capability that declares
  one is rejected.

## Project file transitions

A project file transition that is not BaseHalf's own operation, such as a
change to a Sequence ([Video Sequence](video-sequence.md#sequence-operations)),
may not change any upstream value. Since D76 no extension makes one.

The host reads the upstream state of both the expected bytes and the next bytes
with the index reader. A state is either "unreadable" or the ordered list of
raw entry strings, valid and invalid.
For a Markdown file the list includes the
[entries inside an unrecognized leading block](#recognition), because
BaseHalf carries those into the note's sidecar.

The transition is rejected with an error that names the file and says that
BaseHalf changes upstream entries only through explicit user actions, unless
the two states are identical. That includes a transition that makes a readable store
unreadable, or an unreadable store readable. BaseHalf's own operations are
exempt.

## Source-tree guard

A workspace folder is **marked** when its root contains
`.basehalf-no-workspace-setup`. Markers in subdirectories have no effect. The
marker is checked before each write. If its existence cannot be determined, the
folder is treated as marked.

In a marked folder:

- BaseHalf runs no migration and writes no `upstream.yaml` and no
  `.bh/legacy-references.yaml`.
- It refuses connections whose target needs a sidecar store.
- A Markdown upstream edit that the user explicitly requests is an
  ordinary user edit and is allowed. BaseHalf writes only that store: no
  `canvas.yaml` anchor row, no `adhd.yaml`, and nothing else under `.bh/`. The
  edge is drawn with default anchors.
- The rename refactor rewrites nothing.
- Items moved outside the workbench are not followed.
- The index still reads every store.

## Failure behavior

| Situation | Behavior |
| --- | --- |
| Store unreadable or not writable | No edges from an unreadable store. The issue is shown with Rebuild List when the list can be rebuilt, and other writes are refused with the reason. |
| Note cannot hold a list | The list is kept in the note's sidecar. Nothing is refused and no issue is shown. |
| Model read-only, in conflict, or in error | Write refused with the reason; nothing changes |
| Flush fails or times out | Refused: "Finish or resolve the unsaved edit in <file> first" |
| Model changed between planning and applying | Re-plan once, then refuse |
| Save fails | Notice with Retry and Revert Change |
| Partial multi-document failure | Report lists changed and unchanged documents, and is logged |
| Index building | See [Consumers before ready](#consumers-before-ready) |

## Delivery

Each slice is a coherent commit. A release must not contain slice 3 without
slice 4, or slice 5 without slice 3.

1. **Workspace state (D35).** Remove focus writers and readers; add viewport
   state and the legacy focus cleanup. Independent.
2. **Frontmatter safety.** The recognizer accepts null values, and the rich
   projection never writes cached frontmatter. Independent; it also stops agent
   frontmatter edits from raising the conflict banner.
3. **Reference store flip (D37).**
   - Entry grammar, planner, the three stores, the index, and the edit service.
   - Canvas, undo, badge editor, issues, delete, and copy.
   - `.bhnode` version 4, with execution, discovery, and the bridge version
     (replaced by version 5, D58; node documents removed by D63).
   - Plugin guard (removed with the plugin platform, D76), template
     materialization with pending setups version 2, and migration.
4. **Rename refactor, Relink Everywhere, and ADHD `line_base`.**
5. **Agent guides (D36).** Stop the hint, harness, and `.gitignore` writes; the
   root-file notification; the launch context.

## Acceptance criteria

1. The frontmatter planner round-trips byte-exactly for:
   - other keys, comments, block scalars as the last key, CRLF, and BOM;
   - a comment-only remainder.

   It adds, removes, and replaces entries; converts a single valid scalar or a
   flow list to a block list; and removes the empty key or the empty block as
   specified. Entries `2024`, `true`, `null`, `a, b`, and `why?.md` are quoted as
   specified and read back as paths. A foreign string value is refused.
2. The recognizer accepts `upstream:` with no value.
   - `upstream: *a`, a duplicated key, a mapping value, and a block scalar make
     the store unreadable.
   - `- ~` is one invalid entry, and the other entries stay valid.
   - A note that starts with a thematic break shows no issue, and its list is
     kept in its sidecar (criterion 21).
3. Connecting A to a Markdown B writes only B's store and the `canvas.yaml`
   anchor row. The edge appears when the operation resolves.
   - After B's model is disposed, canvas undo removes exactly that entry and
     redo restores it.
   - If the entry was edited externally in between, canvas undo refuses and
     changes nothing.
   - A dirty rich editor on B neither reports a conflict nor reverts the entry.
   - With auto-save off and unsaved text in B, the connect is refused.
4. Connecting into a draft appends to its `upstream.yaml` in one write. The
   draft rules hold:
   - An entry that names a draft draws an edge and shows no issue. An entry
     that names a generated file deleted to the trash shows as broken, and
     restoring the file brings back the file's own list.
   - A draft's list with one invalid entry shows the issue, and the draft
     does not use the entry as an input.
   - Connecting and disconnecting work on a draft, on a generation card that
     generates, and on one with its file.
   - A copy of a generation card starts with no upstream list.
5. The sidecar store and target rules hold:
   - Connecting into a folder, a PDF, or an image or video file writes its
     `upstream.yaml`.
   - An empty entry, or an entry under `.bh/`, is reported as invalid.
   - Move into File moves sidecar entries into a Markdown file's frontmatter.
6. The index behaves as specified:
   - It derives downstream sets and reports dangling, invalid, unreadable, and
     not-writable stores.
   - It updates on an external folder `mv`, on a deletion, and on an external
     frontmatter edit.
   - It never reads unsaved buffers.
   - A note in a folder hidden by `files.exclude` still shows its edges.
   - It reports the partial state when the store limit is hit.
7. Deleting a node leaves dangling entries visible. The delete checkbox removes
   them as a separate undo step. Relink, Relink Everywhere, and Use Workspace
   Path repair entries by explicit action.
8. Workbench rename:
   - A rename prompts; Update rewrites every affected store it may write,
     including stores in excluded paths, and lists the skipped ones.
   - Skip leaves entries dangling, and a terminal move produces no prompt.
   - Planner unit tests cover a folder move, a case-only rename, an entry that
     names a sibling inside the moved folder, a renamed draft, and a
     generation card that generates.
9. Migration:
   - Complete legacy pairs are written after confirmation.
   - Every processed pair is recorded before any key is removed.
   - Keys are removed only on a later detection.
   - Undoing a migration edit, or a failed save, leaves every pair recoverable.
   - Preview lists every pair in exactly one section, and the counts match the
     files written.
10. Project file transitions that are not BaseHalf's own and change an
    upstream value, including one that breaks the frontmatter fence, are
    rejected.
11. Capability discovery and bridge validation use the new literals on both
    ends.
12. The badge editor behaves as specified:
    - Add Upstream, Add Downstream, ×, the issue actions, counts, and empty
      states all behave as specified.
    - Add Upstream from `a/b/note.md` can pick `a/overview.md` and
      `sources/book.pdf`, and writes `note.md`.
13. Templates merge `upstream` through the planner. Validation rejects
    template text with an `upstream` key. A version 1 pending setup is
    discarded with a warning that names it.
14. In a marked folder:
    - There is no migration and no sidecar or legacy-record write.
    - Connecting into a sidecar target is refused.
    - Connecting two Markdown files leaves `.bh/` absent.
15. A PDF branch note's first saved bytes contain `upstream` naming the PDF, and
    the PDF → note edge appears with no other file written.
    Create from Connection:
    - Releasing a connection drag on empty canvas opens the menu at the release
      point, not Quick Input. Escape writes nothing.
    - Note creates a note whose first bytes list the source in `upstream`. It
      draws the edge and opens inline editing.
    - Image creates an image draft whose `upstream.yaml` names the source.
    - Video is offered from every source, a text source included, and
      creates a video draft whose first input is the source.
    - Audio is offered from every source too, and creates an audio draft,
      at the size of a file card, whose first input is the source (D78).
    - The menu offers no item for an empty file, PDF, or presentation node,
      and none for an empty audio node: Audio makes a draft.
    - One canvas undo removes a created draft, its card, and its edge. A
      later canvas action, undone and redone in another folder, redoes that
      action and not the removed draft.
16. ADHD ranges stay aligned after a connect, an agent frontmatter edit, and an
    undo. A legacy `adhd.yaml` is converted exactly once.
17. Moves: see the acceptance criteria of
    [following moved items](following-moved-items.md#acceptance-criteria).
    Discovery does not list `basehalf.workspace.move`, a request for it is
    refused, and a capability operation with that id is rejected.
18. The smoke covers these flows on an annotatable target:
    - connect, disconnect, and both reconnects;
    - canvas undo after closing the note;
    - a rename through the Explorer, which updates the entry without a
      question, and a rename back;
    - migration from a seeded legacy pair;
    - the badge editor's Upstream and Downstream;
    - Rebuild List on a note whose list was added twice: the plain issue row,
      the confirmation, and the rewritten list;
    - a note that starts with a horizontal rule: Add Upstream keeps the list
      with BaseHalf and leaves the note unchanged, and Move into File moves
      it into the note once the note can hold it;
    - Create from Connection: the menu, its cancel, Note, and Image with its
      undo.
19. Rebuild List:
    - A Markdown store whose `upstream` is a mapping, a block scalar, an
      anchored or tagged value, a value used by another tool, a list with an
      entry over several lines, or a key that appears twice is rewritten as
      one block list. The valid entries of every `upstream` key are kept in
      order without repeats; other keys, comments, and the body are
      byte-identical.
    - With no valid entry the key is removed, and a frontmatter block that
      held nothing else is removed with it. When only comments or a leading
      blank line would remain, `upstream: []` is written instead.
    - An entry with an anchor or a tag in front of it is kept, together with
      the plain entries beside it.
    - The note's text up to the last changed line is saved as a recovery copy
      before the edit.
    - A frontmatter mapping that is not a block mapping in column 0 is
      refused, and nothing changes.
    - A sidecar that cannot be read is saved as a recovery copy and then
      rewritten, or deleted when it has no valid entry. A sidecar that is a
      flow mapping keeps every entry it lists.
    - The store issue row offers Rebuild List exactly when the list can be
      rebuilt, and asks for confirmation before it writes. No row, notice, or
      list offers Open File.
20. Wording and Move into File:
    - No string of the reference interface names frontmatter, YAML, TOML,
      JSON, `.bh/`, "metadata", "sidecar", or "node document", shows
      `upstream` in code formatting, or tells the user to fix a file. A
      refusal for a sidecar store names its node, never `upstream.yaml`.
    - The first-connection notice has **OK** as its only action.
    - Move into File on a sidecar with an invalid entry, and on a sidecar that
      cannot be read, moves the entries BaseHalf can read, saves the sidecar
      as a recovery copy, deletes it, and tells the user. With a recovery copy
      that cannot be saved, the sidecar is unchanged.
21. A note that cannot hold its list (D42):
    - Connecting into a note with TOML frontmatter, into a note whose leading
      block the recognizer rejects (a note that starts with a thematic break
      included), and into a note whose frontmatter is beyond the size window
      writes `.bh/mirror/<path>/upstream.yaml`, leaves the note
      byte-identical, and draws the edge. Disconnect, canvas undo, and redo
      change only the sidecar.
    - The badge lists the entries with "BaseHalf keeps this list for this
      file." and shows no issue. The exception is a note whose frontmatter
      closes beyond the size window: the index cannot tell that it cannot
      hold a list, so its badge offers a Move into File that is refused with
      the size reason.
    - A note that is deleted and comes back shows its kept list again.
    - Removing every entry of a kept list leaves no issue and brings no entry
      back, also for a note with entries inside its leading block.
    - A note whose leading block is rejected and lists entries under
      `upstream` shows one issue with Rebuild List. Rebuild List, and the
      first connect into the note, start the sidecar with those entries and
      leave the note byte-identical; afterwards the issue is gone.
    - When the note becomes able to hold a list, its sidecar list stays in
      use and the badge offers Move into File, which moves the entries into
      the note and deletes the sidecar.
    - When the note has an `upstream` key of its own, its sidecar is ignored
      and reported.
    - The rename refactor updates the entries in such a sidecar, and a
      workbench move carries the sidecar with the note.
    - In a marked folder the connection is refused with the marked-folder
      reason and nothing is written.
