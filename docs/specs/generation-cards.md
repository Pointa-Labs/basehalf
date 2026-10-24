# Generation cards

Status: Draft (2026-10-22, reviewed once; replaces the Video node specification of 2026-10-15 to 2026-10-22; 2026-10-23, D67: a draft is what will be made, a card with its file shows what made it, New Version, and every input of a draft is used; 2026-10-24, D68: the input row is the card's connections as tiles, a name in the prompt is a chip that follows its input, and `@` opens the reference menu; D69: Pick on Canvas stays on and shows what a click does; D70: the inputs narrow the settings, and Generate says why it cannot run; D71: adding an input is two buttons at the panel's top right, and notes are in the reference menu; D74: a prompt mentions its inputs' files, and each provider module names them as its model reads them)
Decisions: [D58](../decisions.md#d58--a-video-node-is-a-prompt-over-its-connections-run-by-the-users-own-providers-new-2026-10-15),
[D59](../decisions.md#d59--video-providers-are-built-in-integrations-with-each-models-exact-settings-users-bring-their-own-keys-new-2026-10-19),
[D61](../decisions.md#d61--basehalf-shows-no-price-new-2026-10-21),
[D62](../decisions.md#d62--a-cards-video-is-the-cards-picture-and-the-pointer-plays-it-new-2026-10-22),
[D63](../decisions.md#d63--a-generated-file-is-its-card-new-2026-10-22),
[D64](../decisions.md#d64--basehalf-generates-images-with-the-same-cards-panel-and-providers-new-2026-10-22),
[D67](../decisions.md#d67--a-draft-is-what-will-be-made-a-generated-file-shows-what-made-it-new-2026-10-23),
[D68](../decisions.md#d68--a-cards-references-are-its-connections-and-a-name-in-its-prompt-follows-its-input-new-2026-10-24),
[D69](../decisions.md#d69--pick-on-canvas-stays-on-and-shows-what-a-click-does-new-2026-10-24),
[D70](../decisions.md#d70--what-the-inputs-leave-room-for-is-what-the-settings-offer-and-generate-says-why-it-cannot-run-where-it-is-new-2026-10-24),
[D71](../decisions.md#d71--adding-an-input-is-two-buttons-at-the-panels-top-right-and-notes-are-in-the-reference-menu-new-2026-10-24),
[D74](../decisions.md#d74--a-prompt-mentions-its-inputs-files-and-each-provider-module-names-them-as-its-model-reads-them-new-2026-10-24)
Related: [providers and the model catalog](providers.md),
[reference graph](reference-graph.md),
[following moved items](following-moved-items.md),
[mirror file resilience](mirror-file-resilience.md),
[canvas card placement](canvas-card-placement.md),
[built-in AI Video and the frozen plugin platform](built-in-ai-video-and-plugin-freeze.md),
[architecture invariants](../harness/architecture-invariants.md)

This specification owns the cards that generate an image or a video: where
their file and what made it are kept, the draft a card is before its file
exists, their inputs, the panel under the card, the card, how a generation
runs from a click to its files, New Version, and how agents generate.
Which providers and models exist, what each model accepts, the credentials,
and the requests belong to [providers and the model catalog](providers.md);
this specification reads them from the catalog.

## Problem

Measured on 2026-10-21 and 2026-10-22 in a development window and in the
code:

- **The card was not the file.** A Video card was a `.bhnode` JSON file. Files
  showed `video.bhnode` and no video; the video lay in
  `outputs/<node id>/<task id>.mp4`, and a first generation added an
  `outputs` folder card beside the Video card. Renaming the card changed a
  title inside the JSON, not a file. Card Detail found what made a video by
  reading every `.bhnode` beside it until one named the video.
- **An unfinished generation was shared.** The running task was written into
  the node file, which git shares. A teammate who pulled it settled the task
  on their computer: a task `submitting` for more than two minutes failed as
  "closed on the way", and a `running` one failed when their provider was not
  set up or at once when their own key asked about a task it did not know.
- **BaseHalf made no images.** Storyboards, characters, and scenes had to be
  made elsewhere and imported before a Video card could use them.
- Every other node kind (`file`, `image`, `audio`, `pdf`, `presentation`) was
  an empty `.bhnode` that waited for an imported file, a second way to put a
  file on the canvas beside putting the file there.

Found on 2026-10-23 in the user's own window and in the records of the cards
they had made that day (D67):

- **A card with its file showed a prompt that had not made it.** Its panel
  was the draft's panel: the prompt could be changed and sent, but a change
  never reached the card, and Generate made a new card beside it. The prompt
  under the card stayed changed. Of six generated cards, three showed a prompt
  that was not the one in their `made.yaml`, and one showed a model and an
  input that had not made it either.
- **A connected input was left out without a word.** Three video cards were
  connected from a video, but all three were in Frames, which takes no video:
  none of them sent it. The panel only dimmed the input, and said why when the
  pointer was on it.
- With a video connected into a second video card, both cards had a prompt
  that could be changed, and nothing told which one the second video used.

Found on 2026-10-24, when the user asked for the prompt and its references to
work as the canvas products for media work do (D68):

- **A name in the prompt meant a place in the list, not an input.** Names
  were plain text. With 图片1, 图片2, and 图片3 connected, removing the
  connection of 图片1 made the 图片2 of the prompt name the image that had
  been third, without a word; the prompt kept a name for the image that was
  gone too.
- **`@` named only what was already connected.** It typed a name as text and
  listed the connected inputs; a card of the canvas had to be connected first,
  with Pick on Canvas or a line drawn on the canvas.
- **The input row showed little of each input.** A 32 px picture beside its
  name, no larger look, and no way to change the order other than the swap
  arrow of the two frames.

Found on 2026-10-24, when the user asked whether a name in the prompt should
simply be its file's own name (D74):

- **A name was a number in the list, not the file.** 图片2 said nothing about
  which file it was, so D71 took the numbers off the tiles, and the chips
  then named inputs by numbers shown nowhere else. Every change of the list
  had to write the prompt again (D68).
- **The models do not read one kind of name.** In their documentation,
  Kling's omni models read `<<<image_1>>>`, Runway reads `@image1` for a
  reference tagged `image1`, xAI reads `<IMAGE_0>` counted from 0, and Wan
  2.6 reads `character1` across its images and videos. The prompt was sent
  as written, so the same prompt named the right input at one model and
  nothing at another, and choosing another model left it wrong.
- **A note could not be named.** Choosing a note in the reference menu
  connected it and put nothing in the prompt (D71).

## Goals

- **The file is the card.** A generated image or video is an ordinary file in
  the card's folder, under the card's name. Files, Finder, git, and agents see
  the image or the video itself.
- **What made a file travels with it.** Its prompt, settings, and the record
  of the generation are card information, like its description: they follow
  renames and moves, inside BaseHalf or outside it.
- **A card exists before its file.** A draft is shown on the canvas from the
  moment it is created, and its generation lands under its own name, so
  nothing moves when the file arrives.
- **Unfinished work stays on the computer that started it**, as git keeps
  uncommitted work local.
- **A paid result is never thrown away by BaseHalf, and a request is never
  sent twice by it.**
- **One card and one panel for images and videos**, drawn from the catalog.
- **A draft is what will be made; a card with its file shows what made it.**
  Only a draft can be changed, and only Generate on a draft is paid for. A
  card with its file never changes: its panel shows the inputs, prompt,
  model, and settings that made it, and **New Version** makes a new draft
  beside it from them.
- **What is connected to a draft is sent.** A connection the model cannot
  use is refused when it is made, and one that becomes unusable stops
  Generate with the reason; an input is never left out without a word. The
  mode follows the inputs.
- **A card's references are its connections.** The input row above the
  prompt and the connections on the canvas are one list: what is removed in
  one is gone from the other, and what is added in one shows in the other.
- **A mention is its input's file.** The prompt mentions an input by the
  path its connection names, shows it as a chip with the file's name and
  picture, and follows the file when it is renamed or moved; a mention is
  taken out when its connection is removed. Each provider module writes the
  mentions as its model reads them when the prompt is sent (D74).
- Everything the earlier Video node did keeps working: the inputs in the
  order of the connections, the panel, another version beside a card, a
  generation that survives a reload, agents that generate.

## Non-goals

- Compatibility with `.bhnode` files and the `outputs/` tree. The product has
  not launched: an earlier `.bhnode` shows as an ordinary file, and
  `outputs/` as an ordinary folder.
- Writing the prompt or the record into the image or video file's own
  metadata, as a node-graph tool does. A draft has no file to write into, and
  a file sent to someone else would carry its prompt.
- Showing drafts in Files, Search, or Quick Open. A draft is a card, not yet a
  file.
- A placeholder card that waits for an imported file. A file is put on the
  canvas by putting it in the folder.
- Editing, trimming, upscaling, or masking an image or a video.
- Following a draft that an agent or a tool moved by moving its directory
  under `.bh/mirror/`. A draft is moved through BaseHalf.
- A price, an estimate, or a currency (D61).

## Terms

- **Generation card**: a draft, or a card with its file whose card
  information holds a `made.yaml`, readable or not; its path has a generation
  extension. A file without a `made.yaml` is an ordinary file: BaseHalf did
  not make it.
- **Card with its file**: a generation card whose file exists. Its file was
  generated by BaseHalf, and its `made.yaml` says how; it does not change.
- **Generation extension** and **kind**: `image` for `.png`, `.jpg`, `.jpeg`,
  `.webp`, `.gif`, `.avif`, and `.bmp`; `video` for `.mp4`, `.mov`, `.m4v`,
  and `.webm`; without regard to case. These are the extensions an input of
  that kind may have. A `generation.yaml` or `made.yaml` at any other path is
  not read.
- **Draft**: a generation card whose path names no file and that has no
  `made.yaml`. Its path is the path its file will have.
- **Generation information**: a draft's `generation.yaml` (what its
  generation uses) and a card's `made.yaml` (what made its file),
  [described below](#card-information).
- **Input**: an entry of the card's upstream list, that is, a connection into
  the card. Its kind is image, video, audio, text, or other.
- **Mode that is used**: the mode a draft's generation runs in, the card's
  own mode when it uses every input, and otherwise the first of the model's
  modes, in the catalog's order, that does ([Inputs](#inputs)).
- **Provider**, **model**, **mode**, and **parameter**: as the
  [model catalog](providers.md#terms) defines them. *Frames* (首尾帧) uses
  the first image as the start frame and the second as the end frame;
  *References* (多模态参考) uses images, videos, and audio as references, and
  for an image model also no image at all; *Extend* and *Edit* take a video to
  continue or change.
- **Generation**: one request to a provider, from the click to the files it
  makes or to its end without one. It makes one file, or for an image model
  as many as its `count`.
- **Task record**: what this computer keeps about a generation that runs, or
  about the last one that ended without its files,
  [described below](#the-task-record).

## Card information

### The file

- A generated image or video is written into the card's folder under the
  card's name. It is an ordinary file of the user's: BaseHalf never rewrites
  it, and everything that works on a file works on it.
- The card is the card of that file. Renaming the card renames the file, and
  the card's name is the file's name ([canvas card name](canvas-card-name.md)).
- A generated file never changes, and neither does what made it. Another
  version of it is a new draft beside it ([New Version](#new-version)).

### `generation.yaml`

`.bh/mirror/<path>/generation.yaml` holds what the generation of the draft at
`<path>` uses. Users, through the panel, and agents write it. Only a draft has
one: when the draft's file lands, BaseHalf writes its `made.yaml` and removes
its `generation.yaml` ([Landing](#landing), step 6). A `generation.yaml` beside
a card with its file, such as one an earlier build left or an agent wrote, is
not read, and nothing is generated from it.

```yaml
prompt: "@[frames/start.png] 里的人骑车经过海边，镜头缓慢跟随"
provider: "bytedance"
model: "seedance-2.5"
mode: "frames"
params:
  resolution: "720p"
  duration: 5
  generate_audio: true
```

- `prompt`: up to 64 KiB. It mentions an input as `@[<entry>]`, the entry of
  the card's `upstream` list that names it, as the list writes it
  ([Mentions](#mentions)).
- `provider` and `model` are ids of the [model catalog](providers.md#the-catalog);
  without `model`, none is chosen. `mode` is one of the model's modes.
  `params` maps parameter names to strings, numbers, or booleans.
- It stores no `path`: where it is says which card it belongs to, so a copy
  that an agent makes is read as the copy's.
- **Reading never fails because of the content**, field by field: a field
  with the wrong shape reads as absent, and the others are used. A file that
  is not YAML at all, such as one with the markers of a git conflict, reads as
  a card with no prompt and no settings, and the card stays a generation card.
  The panel says "BaseHalf could not read this card's prompt and settings." A
  save then first keeps a recovery copy under
  `.bh/cache/recovered/mirror/<path>/generation.<12 hex digits>.yaml` and
  says "BaseHalf could not read the saved prompt and settings of <name>, so
  it saved the new ones. A copy of the old ones is kept." (D41: the user is
  never asked to open the file.)
- **Writing.** BaseHalf writes only the fields it changes, against the bytes it
  read, with the [value grammar](mirror-file-resilience.md#value-grammar) and
  its write check, and plans the write again from the new bytes when the file
  changed underneath. So a prompt typed in the panel and a model that an agent
  wrote meanwhile both stay. The file is at most 256 KiB.
- **Types.** The fields of `params` are read by the type the model's
  parameter declares; while the catalog does not know the parameter, a plain
  `true` or `false` is a boolean, a plain decimal number is a number, and
  anything else is a string. BaseHalf writes strings in double quotes, so what
  it wrote reads back the same.
- The reader checks only these shapes. Whether the provider, model, mode, and
  values exist is known from the catalog, which the panel and Generate
  consult.

### `made.yaml`

`.bh/mirror/<path>/made.yaml` is the record of the generation that made the
card's file. BaseHalf writes it once, when the file lands, and never changes
it; nobody else writes it.

```yaml
id: "20261019T080000-k3f9"
startedAt: "2026-10-19T08:00:00.000Z"
finishedAt: "2026-10-19T08:02:10.000Z"
remoteId: "cgt-20261019080001-abcd"
provider: "bytedance"
region: "cn"
model: "seedance-2.5"
providerModel: "doubao-seedance-2-5-260628"
mode: "frames"
params:
  resolution: "720p"
  duration: 5
  generate_audio: true
prompt: "@[frames/start.png] 里的人骑车经过海边，镜头缓慢跟随"
inputs:
  - "frames/start.png"
  - "frames/end.png"
  - "notes/scene.md"
```

- `id` is unique to this file: the task id, with `-<n>` for the n-th image of
  a generation that made several. `output` and `outputs` then say which one
  of how many it is.
- `copyOf` is in the record of a copy only: the `id` of the record of the
  file it copies, the first one for a copy of a copy. The rest of the record
  is the original's.
- `prompt` is the card's own prompt as it was sent, with its mentions as the
  paths they named then, which are the paths of `inputs`. What the provider
  module wrote for the mentions and the text of the text inputs that joined
  it are not recorded; `inputs` names those notes, as it names every input,
  in the order they were listed. So a note's text is never copied into what
  git shares. The whole prompt as sent, as the module wrote it, stays in the
  task record on this computer while the generation runs.
- A `made.yaml` that cannot be read is left as it is, byte for byte, and the
  card shows its file without its record.
- The panel of a card with its file shows what its `made.yaml` holds
  ([The panel of a card with its file](#the-panel-of-a-card-with-its-file)),
  and **New Version** starts a new draft from it.

### Drafts and missing files

- **A draft** is a `generation.yaml` with no `made.yaml` whose path names no
  file. It is created by **New Image**, **New Video**, **Create from
  Connection**, **New Version**, a generation of several images, the starter
  template, a copy, or an agent.
- The canvas of a folder shows its drafts: every directory
  `.bh/mirror/<folder>/<name>/` that holds a `generation.yaml` and no
  `made.yaml`, whose name has a generation extension, and that names no item
  in the folder. A draft has a card row like any card, and its place is kept
  the same way; its row is never removed as the row of an item that is gone
  ([canvas card placement](canvas-card-placement.md)).
- A draft is a node of the [reference graph](reference-graph.md): it can be
  connected to and from, and its upstream list is its `upstream.yaml`. An
  entry that names a draft is not broken; as an input it is unavailable until
  the draft has its file.
- A draft is not in Files, Search, or Quick Open. Its card says what it is: the
  name and the kind's glyph.
- **A file that appears at a draft's path** is the card's file from then on,
  unless the file is an item that was moved there, through BaseHalf or
  outside it and [recognized](following-moved-items.md#recognition): then the
  moved item keeps its own card information and the draft moves aside to the
  next free name, the first numbered name of its folder (`shot-2.mp4`,
  `shot-3.mp4`) at which neither an item nor any card information is. The
  entries that named the draft's path then name the item that took it: the
  rename refactor leaves an entry alone whose old path names an item again
  ([reference graph](reference-graph.md#rename-refactor)). BaseHalf did not
  make a file that appears there, so it has no `made.yaml`: its card is an
  ordinary file's, and the draft's `generation.yaml` is no longer read.
- **A missing file**: when the file of a card that has a `made.yaml`
  disappears (deleted in Finder, deleted to the trash, not pulled from git),
  the card is gone from the canvas like any card whose file is gone, and its
  card information stays where it is, so that the file and its card come back
  together when it returns. It never becomes a draft: BaseHalf does not offer
  to generate again what was paid for once.
- A draft in a folder that does not exist on this computer is not shown. Git
  drops a folder without files, so a folder that holds only drafts reaches a
  teammate as drafts without a folder; they show when the folder exists.
- Only "not found" tells BaseHalf that a card's file or card information is
  not there. What it cannot look at (a read error, too many open files, a
  permission, a symbolic link on the way) is never taken for absence: a card
  is not called deleted, gone, or free because the disk did not answer.

### The task record

- A generation is recorded on this computer only, in
  `.bh/cache/generation/<task id>.json` of the workspace folder that holds
  the card. Git does not share it
  ([workspace state](workspace-state-and-legacy-cleanup.md#what-basehalf-persists)).
- It holds: the paths of the cards the generation lands on (one, or one per
  image), the state, the start time, the provider's task id once known,
  whether the provider answers at once, the request record (as `made.yaml`
  will hold it), the whole prompt as sent, the window that follows it and when
  that window last said it is alive, what is being landed, and the error of a
  generation that failed.
- **States.** `preparing` (the inputs are read and checked; nothing is sent),
  `submitting` (the request is on its way, or, for a provider that answers at
  once, waiting for that answer), `running` (the provider has the task),
  `landing` (the provider has made the files; they are received and moved
  into place), `failed`, and `stopped`.
- **One follower.** The window that started a generation follows it and writes
  that it is alive every 30 seconds, from the moment it writes the record, so
  that a long preparation is not taken for a window that is gone. Another
  window takes a generation over only when that has not happened for 90
  seconds. Windows look again at different moments, a few seconds apart.
- **One window takes a record over.** Before it acts on a stale record, a
  window claims it by creating `.bh/cache/generation/<task id>.<ms>.takeover`
  for the moment the record was last said alive, with the file system's
  exclusive create: of the windows that try, exactly one does, and the others
  leave the record to it. A claim that nothing came of, because the window
  that made it is gone before it said the record alive, can be claimed again
  90 seconds later, by a claim named after it, again by one window.
- **Every change of a record is written against the bytes that were read**,
  and planned again from the new bytes when they changed underneath, so that
  a heartbeat, a takeover, a stop, and a move that writes a card's new path
  never write over one another. A record that nothing was sent for is
  removed only when the bytes on disk still say so.
- **Partial downloads belong to the task**, not to a window: they are removed
  when the user stops the generation, when its record is removed, and when
  the window that follows it is done with them, never because another window
  follows the record now or ended it.
- The record of a generation that ended without its files stays until the
  card generates again or is deleted, so that the card can say why. The record
  of a generation that landed is removed once each `made.yaml` is written, and
  so is one whose cards that got no file are all gone, such as an image of
  several whose draft was deleted.
- BaseHalf watches `.bh/cache/generation/` and nothing else of `.bh/cache/`, so
  every window of the workspace on this computer shows the same state.
- When the workspace opens, BaseHalf removes the partial downloads and claims
  of records that are gone, the partial downloads of records the user
  stopped, the claims of records said alive since, and ended records whose
  cards that got no file are all gone (no file and no draft); a card that
  landed does not keep its record. A record that failed keeps its partial
  downloads: the window that sent its request may still receive the answer
  ([Continuing after a reload or a restart](#continuing-after-a-reload-or-a-restart)).
- On a volume that ignores letter case, `shots/Video.mp4` and `shots/video.mp4`
  name the same card: a record is found for a card, and claims it, whatever
  case names it.
- A teammate who pulls a draft through git gets its prompt, settings, and
  connections, and no task: a generation is followed and settled only on the
  computer that started it.

### What git shares

| Shared through git | Kept on this computer |
| --- | --- |
| the generated files, the drafts' `generation.yaml` (prompts and settings), `made.yaml`, `upstream.yaml`, descriptions | card places (D46), credentials, the last values used, task records, the prompt as sent with the text of its notes |

Two people who generate the same draft each get a file under the same name and
a `made.yaml`; git reports the conflict as for any file both added. BaseHalf
adds nothing to resolve it.

### What an agent may write

An agent may create a draft or change what a draft generates by writing its
`generation.yaml` (`prompt`, `provider`, `model`, `mode`, `params`), and its
inputs in `upstream.yaml`. It never writes `made.yaml` or a task record, never
writes the `generation.yaml` or the `upstream.yaml` of a card with its file,
and, as for everything under `.bh/`, it never moves, renames, or deletes these
files: a draft is renamed, moved, or deleted by the user on the canvas.
Another version of a card with its file is a new draft, which
`basehalf --generate` makes on its own ([Agents](#agents)). A prompt that an
agent writes mentions an input as `@[<entry>]`, an entry of the draft's
`upstream.yaml` ([Mentions](#mentions)); the agent writes no model's own
names, which the provider module writes when the prompt is sent. The skill
that BaseHalf offers to agents describes this subset and the command that
generates.

## Creating a generation card

- **New Image** and **New Video**, on the canvas's menu and in **Create from
  Connection**, make a draft in the folder of the canvas, named `image` or
  `video` with the extension of the model's output (`image.png`,
  `video.mp4`), with the next free number when the name is taken by a file, a
  folder, or a draft (`video-2.mp4`), as the canvas numbers what it creates.
  Its `generation.yaml` holds an empty prompt and the provider, model, mode,
  and values of the last generation of that kind on this computer, made legal
  for that model; a model that is deprecated or no longer in the catalog is
  not chosen. Create from Connection also writes its `upstream.yaml` with the
  source of the connection.
- The new card is placed as a card the user creates is placed
  ([canvas card placement](canvas-card-placement.md#a-card-the-user-just-created-is-shown)),
  becomes the selected card, and shows its panel with the prompt focused.
  From the Create button or a keyboard command it is centered on the middle
  of the visible part of the canvas, and when no place there is open the
  view goes to it, so that its panel shows and its prompt has the keyboard.
  At a point of the canvas and from a connection it is where the user
  pointed, and the view stays.
- A new card has the shape of its draft's ratio, 533 × 300 for a 16:9 video
  and 300 × 300 for a square image
  ([canvas card placement](canvas-card-placement.md#the-card-of-an-image-or-a-video-has-its-pictures-shape)).
- **Every name BaseHalf chooses treats a draft's path as taken**: a new draft,
  New Version, several images, a paste, a drop, Import File, Capture Frame,
  and the rename editor.
- **A draft's extension follows its model.** An image model declares the
  format it delivers ([providers](providers.md#model)); when the user chooses
  a model whose format differs, the draft is renamed to that extension at
  once, with the next free number if that name is taken, as a rename does.
- The earlier six **New Node** actions and the empty `file`, `image`,
  `audio`, `pdf`, and `presentation` nodes are removed. A file is added to a
  canvas by putting it in the folder: dropping it, **Import File…**, or any
  other tool.

## Inputs

The inputs of a generation card are its upstream entries in order: the order
of the list is the order of the inputs. The [reference graph](reference-graph.md)
owns how entries are added, removed, and renamed. A draft accepts an entry
that its model can use, draft or not ([What is connected is
sent](#what-is-connected-is-sent)); a card with its file keeps the entries
that made it.

Each entry resolves to a kind by its file's extension: images (`png`, `jpg`,
`jpeg`, `webp`, `gif`, `svg`, `avif`, `bmp`), videos (`mp4`, `mov`, `m4v`,
`webm`), audio (`mp3`, `wav`, `m4a`, `aac`, `ogg`, `flac`), and text (`md`,
`markdown`, `txt`). An entry that names a draft is of the draft's kind and
unavailable until the draft has its file. Anything else, such as a folder, a
PDF, or a book, is of kind other and is not used.

How a generation uses the inputs is computed once, in `planBaseHalfInputs`,
from the slots that the [mode that is used](#what-is-connected-is-sent)
declares ([Modes and inputs](providers.md#modes-and-inputs)), for the panel
and for the request alike:

- **Text inputs** join the prompt in every mode: the card's prompt, then
  each text input in order, under its name and a colon on a line of its own,
  such as `scene:`, separated by a blank line (D74). A note's name is the one
  BaseHalf shows for it, its file's name without `.md`, with as much of its
  folder as tells it from another note of the card with the same name
  (`a/scene:`). Neither square brackets nor `@` mark it, since some models
  read those as names of inputs or as commands of the camera. A Markdown
  note's front matter is left out, and each text input adds at most 16 KiB.
- **Frames mode** takes the first available image as the start frame and the
  second as the end frame, as far as the mode declares them. Later images,
  videos, and audio are not used.
- **References mode** takes images, videos, and audio in order, as many as
  the mode declares. Later ones are not used. An image model's references
  mode with no image makes the image from the prompt alone.
- **Extend** and **Edit** take the first available video as the clip, and Edit
  takes images as references as far as the mode declares them.
- **Mentions**: the prompt mentions an input by its file, as `@[<entry>]`
  ([Mentions](#mentions)). When the prompt is sent, the provider module
  writes each mention of an image, a video, or a sound as its model reads
  it ([providers](providers.md#names-in-the-prompt)), and a mention of a note
  is written as the note's name in double quotes, under which its text
  follows.
- An input that cannot be used says why, in the input row and in the reason
  line of the panel: it names nothing, it is a draft without its file, its
  kind cannot be used, the mode that is used does not take it, or it comes
  after what the model takes.
- The provider receives images in the formats the mode declares
  (`imageFormats`; PNG, JPEG, and WebP when it declares none). An image of
  another format is drawn to PNG first. The mode's limits (sizes, lengths,
  bytes) are checked before anything is written, and a file outside them is
  refused with its name and the limit.

### What is connected is sent

Every input of a draft is sent; none is left out without a word.

- **A connection the model cannot use is refused when it is made.** A
  connection into a draft whose model uses the source in none of its modes,
  as a video into a model that takes no video, a fourth image into a model
  that takes three, or a PDF, is refused with the reason, on the canvas and
  from the panel's buttons: "<model> takes no videos.", "<model> takes at
  most 3 images.", or "An image or video card cannot use <name>." A draft
  without a model, or whose model the catalog does not have yet, accepts
  images, videos, audio, and text. Create from Connection makes its draft
  from any source, as the user asked; when its model cannot use the source,
  its panel says so and Generate does not run.
- **The mode follows the inputs.** The mode that is used is the card's own
  mode when that mode uses every input, and otherwise the first of the
  model's modes, in the catalog's order, that does. The panel shows the mode
  that is used, and that is what is sent and recorded. The card's own mode
  stays in its `generation.yaml` as the user or an agent chose it, so that it
  is used again when the inputs allow: connecting a video to a draft in
  Frames shows References, and disconnecting it shows Frames again. The
  model is never changed for the inputs. A missing input and a draft without
  its file count as of their kind here.
- **An input that cannot be used stops Generate.** When no mode of the model
  uses every input, as after another model was chosen, the mode that is used
  is the card's own, and the first input it cannot use is the reason
  Generate does not run ([The panel](#the-panel)). Disconnecting that input
  or choosing a model that takes it lets Generate run.
- **A card with its file keeps the inputs that made it.** No connection into
  it is made, removed, or changed, on the canvas, in the badge editor, or
  from its panel: "<name> was made from these inputs. To change them, make a
  new version." A connection into a card that generates is refused the same
  way, and so is removing or changing one, while it generates: "<name> is
  generating. Its inputs can be changed once it is done." When an input of a
  card with its file is deleted, the card's entry names nothing, and its
  panel shows the input as gone.

### Mentions

A mention in a draft's prompt is its input's file, not a place in the list
(D74). It is written `@[<entry>]`: the entry of the card's list that names
the input, as the list writes it, relative to the workspace folder, with a
`]` in it written `\]`. That is what `generation.yaml` stores, what agents
write, and what the panel shows as a chip with the file's name
([The panel](#the-panel)). No name of a model is stored.

- **Which input.** A mention names the input whose entry is the same path,
  compared in Unicode NFC. Every input can be mentioned: an image, a video,
  a sound, a note, and an input of another kind, which cannot be used
  anyway. A mention whose path no entry of the list names is a mention of a
  file that is not connected: the panel shows it so, and Generate does not
  run while the prompt holds it.
- **When the prompt is sent**, the window gives the provider service the prompt's text
  and, in place of each mention of an image, a video, or a sound, the place
  of that input in the request: the start frame, the end frame, the clip, or
  the n-th reference image, video, or sound. The provider module writes each
  of them as its model reads it, counting by the order of the request
  ([providers](providers.md#names-in-the-prompt)). A mention of a note is
  written as the note's name in double quotes, `"scene"`, under which its
  text follows the prompt ([Inputs](#inputs)). So the same prompt names the
  right input at every model, and choosing another model changes nothing in
  it.
- **A mention follows its input.** When BaseHalf changes a draft's list, it
  writes the mentions of the draft's prompt again in the same step:
  - **What changes the list.** The cross of a tile, a connection removed on
    the canvas or in the badge editor, a connection whose end is moved to
    another card, **Also remove <name> from their upstream lists** when a
    card is deleted, a rename or a move of an input, through BaseHalf or
    followed after a move outside it, **Relink Everywhere…**, and every other
    remove or replace of the [reference graph](reference-graph.md#reference-edits).
  - **An input whose entry is rewritten in place**, by a rename, a move, a
    relink, or a connection whose source end moved to another card, keeps
    its mentions, which take the new path.
  - **A mention of an input that is no longer connected** is taken out of
    the prompt, with the one space after it, or the one before it when none
    follows. "@[a.png] 里的人骑车，背景是 @[b.png]" without `a.png` is
    "里的人骑车，背景是 @[b.png]".
  - **Adding and reordering** change no mention: a tile dragged to another
    place, the swap arrow, and a connection made anywhere leave the prompt
    as it is.
  - **One step.** The prompt and the list are written together and are one
    step of undo. Undo brings both back, the mentions that were taken out
    too, and redo writes both again. When the prompt was changed since the
    step, undo and redo keep that change and write its mentions for the list
    they write; a mention that the step took out does not come back then.
  - **What is left as it is.** A mention whose path the list did not name
    before the change, the prompt of a card with its file, which never
    changes, and the prompts of cards whose lists did not change. A list
    that an agent writes itself, in `upstream.yaml`, changes no prompt: the
    agent writes the prompt it means.
  - A prompt that cannot be read or written keeps its text, and the change
    of the list is not undone for it: BaseHalf says "BaseHalf could not
    update the mentions in the prompt of <name>." Its mentions may then name
    files that are not connected, and the panel shows them so.
- **Copies, New Version, and templates.** A copy of a draft keeps its
  prompt and has no connections, so its mentions name files that are not
  connected until they are connected again. New Version gives the new draft
  the prompt of the record with each mention of the n-th recorded input
  written for the card's n-th entry as it is now, so that a mention of an
  input renamed since names it where it is. A draft of a template mentions
  its inputs relative to the template, and its mentions are rebased with the
  template's references ([reference graph](reference-graph.md#templates)).

## Providers

The providers, their models, and the credentials users enter for them are
specified in [providers and the model catalog](providers.md). The user sets
them up in Settings, on the **Providers** page. A card offers the models of
its kind: an image card the image models, a video card the video models.

## Settings

The settings of a draft are drawn from its model's
[parameters](providers.md#parameters), for the mode that is used:

- **Mode** first, when the model offers more than one. A mode that the
  provider's region does not offer is dimmed with the reason, and can still
  be chosen. A mode that cannot use every input of the card is dimmed with
  the first input it cannot use, such as "Frames cannot use clip.mp4.",
  and cannot be chosen. The mode that is used is checked.
- Then every parameter that is not advanced, in the order the model declares
  them: a choice of up to five values as a row of buttons, of more as a list
  that scrolls after six rows; a choice drawn as `ratio` as small ratio
  shapes; a whole or decimal number as buttons when it has five or fewer
  steps, as a slider with its value when it has up to 1,000, and as a number
  field when it has more, such as a seed, with `s` after a field in seconds;
  **Auto** next to a number that offers it; a switch for a boolean; a text
  field for text.
- **More** opens the advanced parameters, such as the seed and the negative
  prompt. An optional parameter left empty sends nothing: an optional number
  is a number field, or buttons with **None** when it has five or fewer
  steps, and an optional choice adds **None**.

**A range the inputs narrow** (D70). A rule of the provider can narrow how
far a number goes for what is connected, such as Wan 3.0, whose input videos
and result are at most 30 seconds together. `check` answers that range with
its reason ([check](providers.md#requests)), and the setting ends there: its
slider or field goes no further, a button beyond it is dimmed with the
reason, and a line under it says why, such as "Up to 25s. The connected video
lasts 5.0 seconds, and Wan 3.0 makes at most 30 seconds with it." A value
beyond the range is used as its end: the summary shows that value, and that
is what is sent and recorded. The card keeps the value it chose, which shows
again when the inputs leave room for it, as a value the start frame sets
does. Auto is never narrowed. The range follows the last answer of `check`,
which comes a quarter of a second after the inputs or the values change.

The values are the card's `params`; a parameter without a value shows its
default, and that is what is sent. Choosing another model or mode keeps every
value the new model or mode accepts and gives the others their defaults,
without a message (`normalizeBaseHalfParams`); the panel shows the result,
and that is what is sent. A value that the mode does not use, an unknown
name, and a number off the parameter's steps are not accepted. While the
catalog is not there yet, the last values are written as they were stored.

The summary of the settings names the mode and then, for every parameter that
is not advanced and has a value: a choice by its option's label, a number
with the unit seconds as `5s`, **Auto** as its label, any other number as its
label and value (`Steps 30`, `Images 4`), a boolean that is on by its label
and one that is off as `Sound off`, and text as written.

A parameter that a start frame sets (`setByStartFrame`) shows **Set by the
start frame** in place of its choices while the inputs plan a start frame,
and the summary leaves it out; nothing is sent or recorded for it then. The
card keeps its value, which shows again when no start frame is connected.

## The panel

A generation card that is the only selected card shows one panel under it. It
appears when the card is selected, including right after the card is
created, and goes when the card is no longer selected. A draft shows the
panel described in this section, where what it generates is written and
changed; a card with its file shows what made it
([The panel of a card with its file](#the-panel-of-a-card-with-its-file)). An
ordinary file shows none. When a draft's file lands while the panel is open,
the panel of the card with its file takes its place. The workbench builds the
panel; the canvas scene places it ([Placement](#placement)).

From top to bottom:

1. **Input row**, when the card has inputs or its mode takes any: the card's
   connections as tiles, in the order of its `upstream` list, and at its
   right end, the panel's top right, the two buttons that add an input (D71).
   The row and the connections on the canvas are one list. A connection made
   or removed anywhere adds or takes away its tile at once; removing a tile
   removes its connection; and every way the row adds an input draws its
   connection, or is refused as a connection on the canvas is
   ([What is connected is sent](#what-is-connected-is-sent)).
   - **A tile** is a 48 px square with rounded corners. An image shows its
     picture and a video its first frame, filling the square; audio, text,
     other kinds, and an input without its file show their glyph, and a text
     input its name under it. A tile shows no number (D71): an input is
     named by its file, in its look, on its chip in the prompt, and in the
     reference menu (D74). A video
     and a sound show their length at the bottom left, such as 6.8s, once
     their file tells it, since a model's limits count it (D70). An input
     that cannot be used is dimmed.
   - **Frames mode** shows the start and the end frame first, joined by a
     swap arrow, as far as the model takes frames, each marked Start or End
     at its foot; an empty frame is a tile with a plus and its mark, which
     opens a menu of the two buttons' actions. The other inputs follow. Until the card has a
     model, an image card shows its inputs as references mode does, since
     every image model takes references, and a video card as frames mode
     does.
   - **Pointing at a tile** shows a larger look at the input above it: the
     picture, or a video's first frame, in its own shape, at most
     176 × 132 px, with its file's name under it, and why, for an input that
     cannot be used; audio, text, and other kinds show the name alone. The
     look opens
     below the row when there is no room above it inside the canvas, and
     goes when the pointer leaves the tile. It is BaseHalf's own, as every
     hover is. The row is drawn again only when what it shows changes, and
     the look stays while its input stays, so that nothing blinks when the
     prompt changes, is checked, or is saved (D71).
   - Pointing at a tile also shows a cross at its top right, which removes
     the connection, and an `@` at its bottom right, which puts its mention
     into the prompt at the caret, or at the end when the prompt has no
     caret, with a space after it, and moves the keyboard into the prompt.
   - **Dragging a tile** along the row moves its connection to that place in
     the list, and the start and the end frame follow it, as one step of
     undo; the prompt's mentions stay as they are ([Mentions](#mentions)). A
     press that moves less than 4 px is a click. A
     drag of a tile never moves the card or the canvas. The pointer over a
     tile is the arrow, also while it is dragged, since a tile is no card
     that moves; over its cross and its `@` it is the pointing hand (D71).
     The swap arrow exchanges the two frames' entries in `upstream`.
   - **The two buttons** at the top right are **Pick on Canvas**, which
     starts and ends picking, where clicking cards of the canvas connects
     them ([Pick on Canvas](#pick-on-canvas)), and is highlighted while the
     draft picks; and **Import File…**, which copies a file into the card's
     folder and connects it. Each is an icon whose name is its tooltip and
     its accessible name: an arrow in a frame for Pick on Canvas, and a
     paperclip for Import File…, as an attachment has, since nothing is
     uploaded anywhere. Import File… is the one way to add a file from the
     panel or the card. A card or a file that the model cannot use is
     refused with the reason, as a connection on the canvas is, and Import
     File… copies nothing then.
   - A connection made or removed changes the row at once. The tiles that
     stay keep their pictures and a video's first frame, so drawing the row
     again blinks nothing, and an input that comes back soon, as by undo or a
     second click of Pick on Canvas, shows its picture at once; the prompt's
     chips keep their pictures too.
   - The line on the canvas changes with the tile. A connection that the
     panel makes or removes, by Pick on Canvas, the reference menu, Import
     File…, or a tile's cross, and its undo and redo, draws the canvas at
     once, as a line drawn on the canvas does, and does not wait for the
     canvas to learn of it from the file.
   - The tiles scroll sideways when they do not fit; the two buttons stay at
     the right.
2. **Prompt**: a text field that grows to five lines and then scrolls.
   - **Mentions are chips** (D74). Each mention in it shows as a chip: the
     input's picture, 14 px, or its glyph, and its file's name, with as much
     of its folder as tells it from another input of the card with the same
     name (`a/hero.png`). A chip is one piece of the text: the caret steps
     over it, Backspace and Delete remove it whole, and it is selected,
     copied, and cut as its mention, `@[<entry>]`, so that pasting it into a
     prompt puts in the same mention. A mention of a file that is not
     connected shows as a chip with the file's glyph and name and a warning
     underline. A mention typed by hand is the same text and shows as a chip
     once its `]` is typed; nothing turns into a chip while an input method
     composes. Pasting puts in the text alone, as far as the prompt's 64 KiB.
   - **Undo** in the prompt undoes its own typing, in runs as a text field
     does, and redo redoes it; neither undoes a step of the canvas while the
     prompt has the keyboard. **Select All** selects the whole prompt.
   - **`@`** opens the reference menu at the caret, typed after the start of
     the prompt, a space, or anything that is not a Latin letter or digit, so
     that an e-mail address does not; a full-width `＠` opens it too. The
     keyboard moves into the menu's search field.
     - The menu lists **Connected**: the card's images, videos, sounds, and
       notes, in the order of the input row, each with its picture or glyph
       and its file's name; and **On This Canvas**: **Images**, **Videos**,
       **Audio**, and **Notes** (D71), each opening the list of the cards of
       that kind on the canvas of the card's folder, drafts too, by name,
       apart from the card itself. A card that is connected says Connected
       at the right. A card that the draft's model cannot
       use is dimmed with the reason and cannot be chosen, and so is a kind
       of which the model takes none.
     - Typing in the search field shows, in place of the two parts, the
       connected inputs and the cards of the canvas whose name or file name
       holds what was typed, under Connected and their kinds. With nothing
       found, it says "Nothing here has that name."; with nothing to list,
       "Connect an image, a video, audio, or a note, or add one to this
       canvas."
     - Choosing a connected input puts its mention in place of the `@`, as
       a chip with a space after it. Choosing a card that is not connected
       connects it, so its tile and its connection appear, and then puts its
       mention there; when the connection is refused, the reason is shown and
       the `@` stays. A note is chosen as a card is (D74): its chip names it,
       and its text follows the prompt under its name when the prompt is
       sent, as the text of every connected note does.
     - Up and Down move through the items, and the first item is current
       when the menu opens. Right or Enter on a kind opens its list, and Left
       goes back. Enter chooses. Escape, or a click outside the menu, closes
       it and puts the caret after the `@`, which stays as typed.
     - The menu opens below the caret, or above it when there is no room,
       inside the canvas, and the list of a kind opens beside it.
   - The prompt is saved to `generation.yaml` half a second after typing
     stops, when the field loses focus, when the card is deselected, and
     before a generation starts. Nothing is written while an input method
     composes text. Saving never opens a dialog. When the file changes
     underneath while the field has the focus, the field keeps what the user
     typed; at rest it shows the new prompt.
3. **Footer**: the model button, the settings button, and the Generate
   button.
   - The model button shows the model's name. Its menu lists the catalog's
     models of the card's kind grouped by provider: the providers that are
     set up first, then the others, each in the catalog's order; a provider
     that is not set up says so next to its name, and its models can still be
     chosen. Each model shows a second line drawn from its declarations: its
     modes, and for a video its range of durations, its largest resolution,
     and Sound when it makes sound, such as "Frames · References · 4–15s ·
     1080p · Sound"; for an image its largest resolution, how many images
     one generation can make when that is more than one, and how many
     reference images it takes, such as "4K · Up to 4 images · 14
     references". The largest resolution is the one with the most pixels:
     a `p` value counts a 16:9 frame of that height and a `k` value a square
     of that many thousand pixels a side, so 720p < 768p < 1k < 1080p <
     1.5k < 2k < 3k < 4k. A model the provider's region does not offer is shown
     dimmed with the reason, and can still be chosen. Deprecated models are
     listed only for a card that uses one. The menu ends with **Providers…**.
   - While the catalog loads, the model button says so and its menu holds
     only **Providers…**; when it could not be loaded, the menu says why. The
     window asks the provider service for the catalog once and keeps it; a failed request
     is tried once more a second later, and again when a panel or the
     Providers page opens.
   - The settings button sums up the settings: the mode, then the value of
     every parameter that is not advanced, such as "Frames · 720p · 5s ·
     Sound". Its popover is 300 px wide and holds the settings above; every
     change is saved at once, and text when its field loses the focus, on
     Enter, and when the popover closes. Until the catalog has the card's
     model, there is no settings button.
   - The Generate button is a round arrow. While the card generates, it is a
     stop square that stops the generation. A tooltip it showed goes when it
     changes under the pointer, so that it never names what it did before.

The rows share the panel's edges. The tiles, the text of the prompt, a chip
at the start of a line of it, the warning icon of the reason that Generate
cannot run, and the model button begin at one left edge, and the reason's
action ends where the Generate button ends; in the panel of a card with its
file, the line under the prompt and the model's name begin there too. A
chip in the prompt stands on the line of its text: its name and the text
around it share a baseline.

The Generate button is enabled only when the card can generate. Otherwise its
tooltip and accessible name say the first reason, in this order
(`getBaseHalfGenerateBlocker`): the card is generating; the catalog is
loading or could not be loaded; no model is chosen; the catalog has no such
model; the model makes the other kind; the provider is not set up; the
provider's region does not offer the model; the provider's region does not
offer the mode; there is nothing to send, since the prompt is empty and
nothing is connected; an input is missing, is a draft without its file, or is
not a file on this computer; an input cannot be used, by its name and why,
such as "clip.mp4 cannot be sent: Wan 3.0 takes at most 5 videos."; the
prompt mentions a file that is not connected, "The prompt mentions hero.png,
which is not connected." (D74); or the first problem that the provider
module reports for the planned generation
([check](providers.md#requests)); there is nothing to send. A new card therefore says nothing about the prompt its
model needs before the user has written or connected anything. For no model,
no such model, a model of the other kind, the provider, and the region, the
model button is outlined and its tooltip says the same.

The panel also shows that reason as a line above the footer, at most two
lines tall, only when it is fixed outside the panel (D70): **Set Up** opens
Providers at the provider that is not set up, **Providers…** opens it at the
provider whose region does not offer the model or the mode, and a catalog
that could not be loaded says why. A reason that the panel itself fixes, an
input, a setting, the model, or the prompt, shows no line: Generate is
dimmed, its pointer is the not-allowed one, and its tooltip says why, as a
choice of a menu that cannot be made is dimmed with its reason. There is no
line either while the card generates, while the catalog loads, when no
model is chosen, or when there is nothing to send.

The panel asks the provider module for the problems of the planned
generation a quarter of a second after the model, mode, values, prompt,
inputs, or the inputs' files change, also before the provider is set up, and
keeps the last answer for the same model until the new one arrives. It asks
with the files a generation would send: images in a format the mode takes,
or drawn to PNG as a generation draws them, and videos and audio as they
are, so sizes, lengths, and formats are reported before Generate. An input
that is missing, a draft, or not a file on this computer is reported by
name instead, and nothing is asked.

**While the draft generates**, the panel shows what is being generated, and
none of it can be changed: the prompt is read only and can be selected and
copied, and `@` opens nothing; the input row has no buttons, no cross, no `@`,
no swap arrow, and no dragging; the model and
settings buttons show their values and open nothing; Generate is the stop
square; and Pick on Canvas ends. When the generation fails or is stopped, the card is a draft again
and its panel can be changed again.

Keyboard: `Cmd/Ctrl+Enter` in the prompt generates when the button is
enabled. `Escape` closes the innermost open menu or popover, and with none
open, returns focus to the card. The input row is one stop of Tab: Left and
Right move between its tiles and buttons, Delete or Backspace on a tile
removes its connection, Enter on a tile puts its mention into the prompt,
and Alt+Left and Alt+Right move the tile one place. Menus follow the
arrow keys, Home, End, and Enter. A menu starts at its checked item; without one, a menu opened from
the keyboard starts at its first item, and a menu opened by a click has no
current item until Down chooses the first or Up the last.

Focus follows the canvas's rule
([architecture invariants](../harness/architecture-invariants.md#product-shell)).
The prompt has no frame or ring when it has the focus: its caret shows it,
and the text being typed looks as it does at rest. A field of the settings
popover shows the focus by its border alone. The buttons, slots, and menu
items show a ring only when the keyboard moved the focus to them, so a model
chosen with the mouse leaves no ring on the model button.

### Pick on Canvas

**Pick on Canvas**, the first of the two buttons at the panel's top right,
connects cards of the canvas to the draft by clicking them (D69). It stays on until it is ended,
and a click on a connected card removes it again. A card with its file and a
draft that generates do not offer it.

While the draft picks:

- **A bar** at the top of the canvas says what a click does: "Click cards to
  connect them to <name>, or a connected card to remove it." It has **Done**
  at its right. The button is highlighted with the accent, and the input
  row tells assistive technology "Click cards on the canvas. Escape or Done
  ends." without showing it, so that the tiles keep their room (D71).
- **The pointer** over a card is the pointing hand when a click connects or
  removes it, and the not-allowed pointer over a card that cannot be an
  input: the draft itself, a folder, or a card the model cannot use. It is
  never the hand that moves a card, and never the text cursor over a card's
  name. Over the blank canvas it is the arrow.
- **A label** beside the pointer says what a click on the card under it does,
  "Connect <name>" or "Remove <name>", or why the card cannot be an input,
  as a refused connection says it ("Seedream 5.0 Pro takes no videos.", "A
  folder cannot be an input."). The draft itself has no label.
- **The cards** show what they are. Under the pointer, a card that a click
  connects has the accent outline; a connected card is darkened, with a
  check mark at its top left; a card that cannot be an input is faded. A
  look changes at once, without a fade, and a click that connects or
  removes a card draws neither card again
  ([card continuity](canvas-card-interaction-continuity.md#a-change-of-connections)),
  so the outline under the pointer never blinks. The draft stays selected,
  with its panel.
- **The canvas is not edited**: no card moves or resizes, the handles that
  draw a connection and the toolbars of the selection do not show, the
  blank canvas starts no selection box, a
  double click does nothing, and no menu opens on the canvas. The view moves
  and zooms as at other times, by the wheel, the trackpad, or a drag with
  the middle or the right button, and the panel's tiles and prompt work as
  before. A press that moves more than 4 px, or that is let go on another
  card, is no click.

A click on a card that can be connected connects it at the end of the list,
as a line drawn on the canvas does. A click on a connected card removes its
connection, and its mentions leave the prompt, as its tile's cross does
([Mentions](#mentions)). Each is one step
of undo; the card, its line, and the row change at once, and picking goes
on. A click on a card that cannot be an input, on the draft, or on the blank
canvas changes nothing.

Escape, Done, or the button ends picking, and so does whatever takes the panel
away or locks it: the draft no longer being selected, starting to generate,
moved, or deleted. In the panel, Escape first closes a menu that is open
there.

### The panel of a card with its file

The panel of a card with its file shows what made it, from its `made.yaml`,
where a draft's panel has the same parts. Nothing in it can be changed. From
top to bottom:

1. **Inputs**, when it had any: the card's inputs in order, as the tiles of
   a draft's input row, with the Start and End marks the mode that made it
   gave them, without the buttons, a cross, an `@`, a swap
   arrow, or dragging. Pointing at a tile shows its larger look. An input
   that is gone shows its glyph, and its look says it is gone.
2. **Prompt**: the prompt it was made with, as text that can be selected and
   copied, five lines tall at most and then scrolling, with its mentions as
   chips of the inputs it was made from, as in a draft's prompt. A card made
   without a prompt says "No prompt".
3. **A line**, when one applies: which image of how many it is, such as
   "Image 2 of 4", for a generation that made several; "A copy. This is what
   made the original." for a copy.
4. **Footer**: the model's name and the summary of the settings it was made
   with, as text, with the names from the catalog when it has them and the
   recorded ids otherwise; and **New Version** at the right, where a draft
   has Generate. Its tooltip says "Make a new draft beside this card from
   what made it." ([New Version](#new-version)).

A `made.yaml` that cannot be read shows "BaseHalf could not read what made
this file." and no New Version. `Escape` returns the focus to the card, and
the button follows the canvas's rule of focus.

### Placement

The panel is 512 px wide (narrower only on a canvas narrower than 536 px); its
height follows its content, from 132 px without an input row to 268 px with
one and a reason line of two lines. It keeps that size at every zoom. It sits
10 px below the card, centered; above the card, clear of its name and toolbar,
when there is no room below for the tallest panel; inside the canvas, clamped,
when there is room for neither. The toolbar's place counts also while the
toolbar is hidden, as while the card generates, so that the panel does not
change sides or move when the toolbar comes and goes under the user's
pointer. The panel and its menus stay 12 px inside the
canvas and 52 px above its bottom edge, clear of the zoom controls there,
which would otherwise cover the model button or a menu's last items. When the
card is off the canvas, the panel is hidden. Opening the panel never pans or
zooms the canvas. Moving or resizing the card takes the panel along on the
side it was on. A menu or popover of the panel opens upward when there is no
room below, stays inside the canvas, and scrolls inside itself; a menu of the
footer that opens below opens below the panel.

## The card

What a generation card shows follows its phase (`baseHalfGenerationPhase`):

| Phase | The card shows |
| --- | --- |
| draft | the kind's glyph |
| generating | the glyph, the phase in words (Preparing, Waiting, Generating, Saving), the time since it started, and a progress bar, exact when the provider reports progress |
| failed | the glyph and the error in at most two lines; when two lines cut it, the whole error in the hover of its text |
| stopped | the glyph and "Stopped" |
| file | the image, or the video in [the player](#the-player) |
| file that cannot be shown | the glyph and "This image cannot be shown here" or "This video cannot be played here" |

The phases generating, failed, and stopped come from the task record and are
shown only on the computer that has it. When the file arrives, the card takes
its picture's shape where it is, as large as the room there allows, and the
image or the video fills it
([canvas card placement](canvas-card-placement.md#the-card-of-an-image-or-a-video-has-its-pictures-shape)).
The user does not resize it. A card whose file was
just saved goes from Saving straight to its picture: it says Saving after the
record is removed, also once it is drawn again with its file, until the image
has loaded or the video has its first frame, and at most 2 s more. The card
changes in place when its generation information changes, as when the panel
saves the prompt or an agent writes the file, and when it is selected or
deselected: its player stays, and a video that plays goes on playing, except
on a card deselected with the pointer elsewhere, which pauses it.

The card's caption is its name, as for every file
([canvas card name](canvas-card-name.md)); a draft's caption is the name its
file will have, and renaming it renames the draft. A draft has no file to
open: a double click on it, Enter, and **Open** in its menu select it, and its
panel shows. Its card has no badge face until it has its file.

### The player

A video on a card plays the way canvas products for media work play the video
of a node. The card of any video file plays its video the same way, and the
card of a sound file its sound: the files the window shows as videos and
sounds ([architecture invariants](../harness/architecture-invariants.md#product-shell)).

- **The picture is the card's.** A click on it selects the card and never
  starts or stops the video, also while it plays. A drag from it moves the
  card, also when the card is selected. A double click opens the card, as on
  any card. The pointer over it is the card's grab hand.
- **The pointer plays it.** While the pointer is on the card, the video plays
  without sound; when the pointer leaves, it pauses where it is, also when
  the card is selected. At rest the card shows the frame where the video
  stopped, at first its first frame, also when the canvas draws the card
  again. One video or sound on the canvas plays at a time: one that starts
  pauses the others, a video in a note too. Opening the card, by a double
  click or **Open**, pauses its video.
- **Controls drawn by BaseHalf**, not the system's, over the picture while the
  pointer is on the card or the card is selected: a sound button at the top
  left, and at the bottom a bar with play and pause, the time played, a
  position slider, the length, and **Open**, which opens the card as a
  double click does. A press on the controls never moves the card, and the
  pointer over them is the arrow; between them, the picture stays the card's.
  The controls scale with the canvas, as the rest of the card does, and stay
  hidden on a picture narrower than 160 screen pixels, as the zoom or a
  resize leaves it.
- **Sound starts off.** The sound button turns it on for that card while the
  card shows its video, also when the canvas draws the card again; the video
  then plays with sound while the pointer is on it.
- **Sound fades.** A sound that starts or stops at once is a click in the
  speakers, loud where the sound is loud: a generated video often is in its
  last seconds, and often ends at full sound. So the sound comes up over
  40 ms when the video starts or the sound is turned on, and goes down over
  60 ms before the video pauses or the sound is turned off, whatever pauses
  it: the play button, the pointer leaving, opening the card, or another
  video starting. It also goes down over the last 100 ms of the video, and
  for each jump of the position. The play button shows Play at once. A video
  without sound starts and stops at once, as before. The window's sound
  output runs while a video with sound plays, and stops 5 s after the last
  one stopped.
- **Card Detail plays it the same way.** Card Detail shows the video in this
  player, not the system's, with what a card that is opened needs: the
  controls always show, a click on the picture plays and pauses it, Space
  does too, the pointer on it plays nothing, the sound is on, and **Full
  Screen** stands where **Open** is. The video starts at the frame its card
  showed; when Card Detail closes, the card shows the frame where it stopped
  ([opening and closing Card Detail](card-detail-opening.md)).
- **A sound plays in the same player.** There is nothing to see, so the card
  of a sound shows the glyph of a sound where a video shows its frame, and
  the player has no sound button: the pointer on the card plays
  nothing, Play plays the sound with its sound on, and the sound comes up
  and goes down as a video's does. A sound plays while its card is selected
  or the pointer is on it, and pauses when its card is neither. Card Detail
  plays it in the same player, as it plays a video, without Full Screen. No
  sound plays in the system's controls.
- **The keyboard.** The buttons are buttons; the position slider moves a
  second with Left and Right, and goes to the start and the end with Home
  and End. The arrow keys on a control move no card.

### The toolbar

A selected draft has no toolbar: what it takes is added from its panel,
whose Import File… is its one way to add a file (D71). Above a generation
card with its file the toolbar shows **Reveal in Finder** (Explorer on
Windows, the file manager elsewhere) and **Open**, and on a video **Capture
Frame**, with First Frame, Current Frame, and Last Frame.

- **Capture Frame** writes a PNG of that frame into the card's folder, named
  after the card and the frame (`shot first frame.png`, `shot last
  frame.png`, or `shot frame at 3.2s.png` for the current frame, with a
  number added when the name is taken). Its card appears to the right of the
  video card, with the frame's shape, connected from the video: its upstream
  list names the video it was taken from. It is an ordinary image that the
  user can connect to another card.
- **Open** shows the image or the video large in Card Detail, with what made
  it, from `made.yaml`: model and the id sent to the provider, provider and
  region, mode, settings, the prompt with each mention as its file's name,
  the inputs in order by their files' names, a frame with its Start or End,
  which image of how many it is, and when it started and finished. The names
  of the provider,
  region, model, mode, and each parameter and value come from the catalog
  when it has them, and are the recorded ids otherwise. A file without
  `made.yaml` says that it was not generated by BaseHalf. Card Detail lies
  over the canvas the card is on, and closing it shows that canvas again.
  Every way of opening the card does this: the toolbar's **Open**, the
  player's **Open**, a double click, and **Open** in the card's menu.
  - This section is below the image or the video of every generation card
    with its file, however Card Detail was opened, and is drawn again when
    its card information changes. An image or a video that is no generation
    card has none.
  - A `made.yaml` that cannot be read is not shown: the section says
    "BaseHalf could not read what made this file." A copy's section says
    that the file is a copy and that what it shows made the original.

## A generation

### Starting

**Generate** (the button, `Cmd/Ctrl+Enter`, or an agent) runs these steps on
a draft. The steps before 5 write nothing; a stop at step 6 or 7 removes the
record and leaves no card it made. A card with its file does not generate: the
panel has no Generate for it, and an agent's `basehalf --generate` makes a new
version of it first and generates that draft ([Agents](#agents)).

1. Save the panel's pending prompt and read the card's generation
   information. A card with a `made.yaml`, readable or not, whose file is
   gone is a missing file, not a draft: stop with "<name> is not there any
   more: it was moved or deleted. Restore it to generate from it."
2. If the card or the card that a generation of several images would use is
   generating, stop with "This card is already generating."
3. Read the catalog and the provider's setup. Stop with the first blocker that
   is known without the inputs, as the panel shows it. An agent's request
   waits up to 30 seconds for the catalog while it loads. An agent's request
   whose values the model does not accept stops with the first such value
   instead of making them legal.
4. Decide the cards the generation lands on: the draft itself, and for an
   image `count` above 1, that many cards in all
   ([Several images](#several-images-from-one-generation)).
5. Write the task record as `preparing`, naming those cards, and claim them:
   when another record that is not ended names one of them, the record that
   was written first keeps it, and the other generation removes its record
   and stops with "This card is already generating." Then make the new drafts
   of step 4, one undo step together, named Generate.
6. Read the provider's region, endpoint, and credentials. Plan the inputs
   with the mode that is used, read the text inputs, and build the prompt:
   its text, each mention of an image, a video, or a sound as that input's
   place in the request, and each note under its name
   ([Mentions](#mentions)). Stop when an input is missing or cannot be used,
   or when the prompt mentions a file that is not connected, with the reason
   the panel shows ([What is connected is sent](#what-is-connected-is-sent)).
   Prepare the images, videos, and audio, and have the provider module check
   the planned generation with its files; stop with the first problem. The
   module's check answers the prompt as it writes it, which the task record
   keeps and the request sends. The values
   sent are the card's `params` made legal for the model and the mode that is
   used, with every default filled in.
7. Check the claim again, since another window may have written its record
   while this one prepared, and stop as in step 5 when that record keeps a
   card. Then write the request record and the state `submitting`.
8. Send the request through the provider service
   ([providers, Requests](providers.md#requests)). When the provider returns
   its task id, write it and the state `running`. When it answers with the
   files at once, continue at step 10. A call that does not reach the
   service, or one whose service stopped while it ran it, leaves the outcome
   unknown.
9. Ask the provider about the task every 5 seconds, the first time after 3
   seconds, and show the phase and progress on the cards.
10. Land the files ([Landing](#landing)).
11. Remember the provider, model, mode, and values as the last used for the
    kind on this computer.

### Landing

Each file the generation made lands on its card. A paid file is thrown away
only when the user stopped the generation or the card was deleted. Steps 2 to
6 run inside the workspace mutation lease, so that no move or rename runs
between deciding its place and moving it there; before them, a move outside
BaseHalf that is still being followed is let finish, up to 10 seconds:

1. Download the file to `.bh/cache/generation/<task id>-<n>.part`, never into
   the user's folder. Check it: a video is an MP4 of at most 512 MiB; an image
   is a PNG, JPEG, or WebP of at most 64 MiB. A file the provider answered with
   at once is checked the same way. Write its size and SHA-256 in the record
   as soon as it is received in full, so that a window that takes the record
   over lands it without downloading it again; the files a provider answered
   with at once are complete when the answer comes, and are recorded together
   in one write before the first of them lands. A file received only in part
   is removed and asked for again; the file of a provider that answers at once
   cannot be asked for again, and its card fails with a message saying so.
2. Read the card's path from the record, where every move or rename of the
   card has written it. When the file's format differs from the card's
   extension and the card is still a draft, the draft is first renamed to the
   format's extension, with the next free number if that name is taken.
3. Decide the file's place. The draft at the path is its card. When a file
   took the path by then, or when the draft's card information is not at the
   path and BaseHalf cannot tell that the card was deleted (part of it moved,
   or a move is still being followed), the file goes beside it: the next free
   name in that folder with the extension of the file's format, with its own
   `made.yaml`, and its card appears to the right. The card was
   deleted when its record says the canvas released it, or when none of its
   card information is left and no move is being followed: then the file is
   not landed. When the card's folder is gone, it is created again, unless a
   move is still being followed, which is waited for first.
4. Write in the record what is being landed: the path, the size, and the
   SHA-256 of the file.
5. Put the file in place without ever replacing anything there and with
   nothing partial in the card's folder at any moment: the provider service gives the
   complete partial download the card's name by a hard link, which fails when
   the name is taken, and then removes the partial download
   ([providers, Requests](providers.md#requests), `place`). When the name is
   taken, the file goes beside it as in step 3. Where the file system cannot
   link there (the workspace folder and its `.bh/cache/` on different
   volumes, or a file system without hard links), the provider service copies the bytes
   straight to the name by an exclusive create instead; in that rare case
   alone, a crash during the copy can leave a partial file in the card's
   folder.
6. Write `made.yaml`, then remove the card's `generation.yaml`: the card is a
   card with its file now, and what made it is its `made.yaml`. A file that
   went beside its card gets only its `made.yaml`. When every file has
   landed, remove the record. A crash between the two writes leaves the
   `generation.yaml`, which is not read beside a file, and the next landing
   of the record removes it.

A problem before the file is put in place keeps the file and tries again, up
to three times 5 seconds apart, and only then fails the card, saying that the
file was received but could not be put into its folder. A problem after it,
writing `made.yaml`, leaves the file where it is, and the card says that the
file is in its folder but its record could not be written.

After a crash between step 5 and 6, the window that follows the record again
finds the file at the path with the recorded size and SHA-256, and finishes
step 6 without downloading again.

### Ending without its files

- **The provider refuses** (wrong key, refused content, too many requests):
  the task fails with the provider's message.
- **The outcome is unknown**: the request may have reached the provider, but
  no answer came back. The task fails with a message saying so and asking
  the user to check the provider's console before generating again, since a
  second request may be charged again. BaseHalf never sends a request again
  by itself.
- **The provider reports a failure** or a cancellation: the task fails with
  its message.
- **One image of several is refused** while the others are made: its card
  fails with the provider's reason, and the others land.
- **Asking fails**: a network error is retried at the next interval for up to
  30 minutes in a row; a refused key fails the task; a task the provider does
  not know fails the task.
- **Too long**: when the provider still says that the task is not done two
  hours after its start, the task fails with a message that says so. The
  limit counts only answers: a task that finished while no window asked, or
  while the computer slept, lands however late it is asked.
- **Stop**: the user presses the stop square on one of its cards. BaseHalf
  stops asking, asks the provider to cancel where it can (best effort), and
  records the task as `stopped`. A file that arrives later, also from a
  provider that answers at once, is deleted and not kept.
- **A card is deleted** while it generates: the generation is stopped first
  when it was the only card, and its record goes with the card; otherwise that
  card's file is not landed.

The card shows the failure and is a draft again: its prompt and settings can
be changed, and the Generate button starts a new generation on the same card. An error is plain text without secrets or markup, at most 4
KiB.

### Continuing after a reload or a restart

The window that started a generation follows it until it ends, also when the
panel closes and when the canvas shows another folder. When a window finds a
record that is not ended and whose follower has not said it is alive for 90
seconds:

- a `running` task is taken over and followed again: BaseHalf asks the
  provider about its task id and continues from step 9. It asks in the region
  the request records, at the endpoint set up on this computer while the
  provider is still set up in that region, and otherwise at that region's base
  URL. A task whose provider is not set up any more fails once it is two hours
  old, saying that BaseHalf could not ask the provider and that it may have
  finished there;
- a `landing` task is taken over and landed;
- a `submitting` task fails, never sent again: for a provider with tasks, with
  a message saying that BaseHalf closed while the request was on its way and
  asking the user to check the provider's console; for a provider that answers
  at once, with "BaseHalf closed while the provider was making the files. They
  may have been made and charged, but BaseHalf could not receive them. Check
  the provider's console.";
- a `preparing` task is removed, since nothing was sent.

The window that sent a request takes up its answer also when another window
ended the record as failed meanwhile, taking it for gone, as after a sleep:
the files the provider answered with land, and a task the provider made is
followed, with the record `landing` or `running` again and the cards that the
failure ended waiting again, unless another generation has claimed the card
since.

### New Version

**New Version**, the button of the panel of a card with its file, makes a new
draft from what made the card. The canvas products for media work generate a
node again in place and keep the earlier result in a history, or keep it
among the node's versions; one of them also copies a node with its
connections, which is the way it keeps several versions side by side. A card
that is a file never changes, so another version is always a new card:

- The draft is in the same folder, named like the card with the next free
  number (`shot.mp4` and `shot-2.mp4` give `shot-3.mp4`), and its card
  appears to the right of the original card.
- Its `generation.yaml` holds the prompt, provider, model, mode, and values
  of the card's `made.yaml`, without the seed, so that generating it makes
  another result. Its `upstream.yaml` lists the card's inputs in their
  order. It is not connected from the original card, which is not its input:
  to make a version from the card itself, connect from it
  ([What is connected is sent](#what-is-connected-is-sent)).
- It becomes the selected card, with its panel open and its prompt focused;
  when it is not in sight, the view goes to it, as to any card the user just
  created at a place BaseHalf chose
  ([canvas card placement](canvas-card-placement.md#a-card-the-user-just-created-is-shown)).
  Nothing is generated and nothing is paid for until the user generates it:
  `Cmd/Ctrl+Enter` at once makes another result from the same inputs, and a
  change to the prompt or the settings first makes a changed version.
- Making it is one step of the canvas undo stack, named New Version. The
  original card and its file do not change.

### Several images from one generation

An image model's `count` makes several images in one request. Each image is a
file, so each is a card. The canvas products for media work keep several
results inside one node by default, as a pile or as variants of it; one of
them also lays the results out as separate nodes, and that is what a card that
is a file does:

- At step 4 BaseHalf decides one card per image: the card the generation runs
  on, then new drafts named like it with the next free numbers, with the same
  prompt, settings, and upstream entries, in a row to its right. They are made
  at step 5, before anything is sent, so the user sees where each image will
  land while it is made.
- Every card shows the generation's phase; stopping it from any of them stops
  it for all.
- Each image lands on its own card, in the order the provider gives them, and
  its `made.yaml` says which one of how many it is; its panel says it too.
  An image the provider refused fails on its card alone. New Version on any
  of them makes one draft with the same values, the count among them.
- When the provider makes fewer images than asked, the cards left over fail
  with "The provider made fewer images than asked."
- `basehalf --generate` prints the path of every card.

## Moving, renaming, copying, and undo

- **A card with its file** moves and is renamed as every file is: through the
  workbench, its card information moves with it, `made.yaml` included;
  outside BaseHalf, it is [followed](following-moved-items.md) by its
  content.
- **A draft** is moved or renamed only through BaseHalf, since it has no file:
  renaming its card, cutting its card and pasting it on the canvas of another
  folder, as a file is moved on the canvas, or moving its folder. A draft that
  is pasted keeps its name where it is free, and takes the next free number
  otherwise. Its card information and card row move, and the entries that
  name it are rewritten, as for a file. The menu of a draft's card has no
  **Reveal in Files**: a draft is not in Files. A draft below a folder that is
  moved outside BaseHalf follows the folder
  ([following moved items](following-moved-items.md#recognition), rule 4).
  Renaming keeps the kind: a draft's name keeps an extension of its kind.
  - A draft moves only to a name that no file, folder, or draft has, in a
    folder that exists, within its workspace folder. The card information of
    a generated file that is in the trash or missing, a `generation.yaml` or
    a `made.yaml`, takes the name too: the file comes back with its record.
    The rest of what an item that is gone left under that name gives way, as
    it does to a move of a file through the workbench.
  - Its card information, card row, and task records move in one exclusive
    run under the workspace mutation lease; the entries that name it are
    rewritten right after, as after any move, and are owed until they are.
- **While a card generates**, a move or a rename of it or of its folder, through
  BaseHalf or [followed](following-moved-items.md#relocation) after a move
  outside it, writes the card's new path into the task record in the same
  exclusive run, so that the files land where the card is.
  - The path a task record names always holds the card's `generation.yaml`.
    The card information is written at the new path first, then the record
    takes the new path, and only then does the old path give up its
    `generation.yaml` and `made.yaml`. A move that fails part-way leaves the
    card whole at the path its record names: a draft's move through BaseHalf
    takes back what it wrote, and a stage of the mirror cascade that fails,
    or a Skip, leaves the generation information at both paths.
  - A card whose `generation.yaml` finds its place at the new path taken,
    after a move outside BaseHalf, keeps all of its card information at the
    old path, and its record keeps naming it
    ([following moved items](following-moved-items.md#relocation)).
- **Copying** a generation card makes a new card in the folder where it is
  pasted: of a draft, a draft with the same prompt and settings; of a card
  with its file, a copy of the file with a `made.yaml` whose `id` is new and
  which says it is a copy of the original's. Neither has upstream entries or
  a task. A copy carries no connections, as a copy of any card does; New
  Version is the way to start a draft with the same inputs. On the canvas, Copy and Paste and
  Duplicate copy a draft as they copy a file, and name the copy of either
  kind as a pasted draft is named: its own name where that is free, and the
  next free number after its own otherwise (`shot-2.mp4` duplicated beside
  itself is `shot-3.mp4`).
  - A copy of a card with its file is made by any copy of its file through
    the workbench, in Files too, under the name the copy takes there. A copy
    of a folder copies the cards below it, the drafts among them; the record
    of a generated file that is gone is not copied.
  - Card information that is already at the path a copy takes stays, as it
    is for a file that appears at a draft's path. A copy from outside the
    open folders, or into a folder BaseHalf is set to leave alone, gets none.
  - When the card information of a copy cannot be written, the copy is a
    plain file, and BaseHalf says "BaseHalf could not copy the prompt and
    settings of <name>."
- **Undo.** Creating, renaming, moving, deleting, and copying a draft are each
  one step of the canvas undo stack, which keeps all of the draft's card
  information; so is New Version, and so are the drafts a generation made,
  together, as one step named Generate. A generation itself is not undone.
  - While a draft of a step generates, undo refuses, says why, and keeps the
    step for later.
  - Once a draft of a step has its file, or its prompt or settings changed
    since the step (compared field by field, in whatever order an agent
    wrote them), as when a prompt was typed into a new draft, or its path is
    taken, the step is done with: undo and redo change nothing and say why,
    and the next undo goes to the step before.

## Deleting

- Deleting a draft removes its card information and its card row, as one undo
  step. When it generates, the generation is stopped first, or, when it is one
  of several cards of a generation, its image is not landed. The canvas asks
  the generation service to release the card before the draft operations
  delete it; a draft whose card information is all gone when its file
  arrives, while no move is being followed, gets no file either, however it
  was deleted.
- The task record goes with the card it is kept for. Releasing a card
  removes the record of a generation that ended without its file, and the
  record of one that ends because the card is released, unless another card
  of the record that got no file is still there to say why; the card being
  released counts as gone. Undoing the delete brings the draft back as a
  draft, without the old error. A record that the window which sent its
  request took up again meanwhile is not ended, and stays.
- The draft operations do not delete a draft that a generation that has not
  ended still lands on. They refuse with "This card is generating. Stop it
  first." and change nothing, so that a file that is paid for always has its
  card to land on. A released card is not landed on: the generation of one
  card has stopped, and one card of several has given up its file.
- Deleting a card with its file deletes the file as any file is deleted. A
  delete to the trash of a generated file keeps `made.yaml`, as it keeps
  `upstream.yaml`: the card leaves the canvas as a missing file, and
  restoring the file brings its card back whole. A file without `made.yaml`
  that still has a `generation.yaml`, as a file that appeared at a draft's
  path has, loses it with the delete, so that it does not stay behind as a
  draft; so does such a file below a deleted folder. A draft below a folder
  that is deleted to the trash keeps its card information and shows again
  when the folder comes back. A permanent delete removes them all, the
  drafts below a deleted folder included.

## Agents

- An agent writes generation information as described in
  [What an agent may write](#what-an-agent-may-write).
- `basehalf --generate <path>` starts a generation of the draft at `<path>`
  exactly as Generate does, and prints the path of every card the generation
  lands on once the task record is `submitting`. For a card with its file, it
  first makes a new version of it, as New Version does, and generates that
  draft: the cards it prints are the new draft and the further drafts of
  several images. It does not wait for the files; each file and its
  `made.yaml` show when it lands.
  - `<path>` is relative to the workspace folder and names a generation card:
    a draft, or an image or video file with its `made.yaml`. A path
    that names anything else, lies outside the workspace folder or under
    `.bh/`, or passes through a symbolic link is refused, and nothing is
    written. A card whose file is gone, which has its `made.yaml`, readable
    or not, and no file, also with its folder gone, is a missing file: it is
    refused with the sentence Generate gives, "<name> is not there any more:
    it was moved or deleted. Restore it to generate from it."
  - It prints one line of JSON and exits with 0 once the generation is
    `submitting`:
    `{"version":5,"type":"generate","ok":true,"outcome":"succeeded","path":"<path>","cards":["<card>",…]}`,
    the cards in the order of the outputs, each relative to the workspace
    folder. When the generation cannot start, it prints
    `{"version":5,"type":"generate","ok":false,"outcome":"rejected","path":"<path>","error":"<reason>"}`
    and exits with 1; the reason is the plain sentence the panel would show,
    such as "This card is already generating." or the first value the model
    does not accept.
- The command runs from any folder of the workspace in an Agent Area
  terminal, also when the workspace was opened through a symbolic link: a
  shell reports its folder by its real path (on macOS, a folder under `/tmp`
  or `/var` is under `/private`), and BaseHalf finds the workspace folder by
  comparing real paths.
- No confirmation is asked: the user asked the agent to work, and the user's
  own key pays.
- `basehalf --list-capabilities` includes the model catalog as
  `host.modelCatalog`: each provider with its label, whether it is set up, its
  regions (id and label) and the region in use, and each model with its
  kind, label, description, the regions that offer it and those that retire
  it, the format an image model delivers, whether the provider answers with
  the files at once, its prompt rule, its modes with their input slots and
  limits, its parameters, and whether it is deprecated.
  It holds no credential, endpoint, id sent to a provider, or price. When the
  catalog could not be loaded, it lists no provider and says why in `error`.
  An agent chooses `provider`, `model`, `mode`, and `params` from it.
- `basehalf --list-capabilities` also includes `host.generationCards`, the
  contract of [what an agent may write](#what-an-agent-may-write): the
  extensions of each kind; where `generation.yaml` and the inputs of the card
  at `<path>` are; that `made.yaml` and `.bh/cache/generation/` are
  BaseHalf's; the command that generates; and the authoring contract of
  `generation.yaml` (contract version 7): its schema, an example of a draft's
  `generation.yaml` and `upstream.yaml` built through BaseHalf's own writer
  with a model of the catalog, and the rules: the draft rule, that only a
  draft has a `generation.yaml`, that the inputs of a card with its file stay
  as they are, that every input of a draft is sent, the mode that is used,
  and that a prompt mentions an input as `@[<entry>]` of its `upstream.yaml`
  and writes no model's names (D74). Version 5 let a card with its file keep
  a `generation.yaml` for its next generation; version 6 named inputs by
  kind and order, as 图片1 and Image 1.
- The skill that BaseHalf offers to agents describes drafts,
  `generation.yaml`, `made.yaml`, the input order and mentions, the mode
  that is used, the catalog, and this command. An agent that makes an image with a tool of its own, such as
  its own image generation, puts the image in the folder of the canvas the user
  works on, where it is a card.

## Sequence and the starter template

- A Sequence item names a video file: `{ id, title, videoPath, generationId }`,
  the path relative to the Sequence file and, for a generated video, the `id`
  of its `made.yaml`. An item is available when its path is a video file
  and, when it has a `generationId`, that file's `made.yaml` has that `id`;
  otherwise it shows as missing or changed. **Repair Moved Video Sequence
  Clip** finds the one video whose `made.yaml` has the item's `generationId`
  and updates only the path. Deleting a video changes no Sequence; its item
  shows as missing.
- **Add Video Result to Sequence** takes a video card with its file.
- The starter template makes folders, notes, video drafts, and an empty
  Sequence, with the connections it declares; every shot folder holds a note,
  so that git keeps the folder.

## What is removed

- The `.bhnode` document of every kind, its reader and writer, the node
  document store of the reference graph, and the contract agents read
  (`nodeDocument`, contract version 4).
- The `outputs/` tree, the reserved outputs rule, the upstream-only rule for
  result files, and the `outputs` folder card.
- The six **New Node** actions and the empty nodes they made, and the import
  into `assets/<node id>/`.
- Card Detail's search of neighbouring node files for what made a video.
- `basehalf --run-node`, `host.videoCatalog`, and the extension API
  `inspectCanvasNode`, replaced by `basehalf --generate`, `host.modelCatalog`,
  and `inspectGenerationCard`, which answers a card's kind, whether it has its
  file, and the `id` of its `made.yaml`.
- The `nodeId` and `videoNodePath` of Sequence items, its scans of
  `**/*.bhnode`, and the removal of Sequence items when a video is deleted.
- From D58 and D59, as recorded there: the Draft, Attempt, and sealed-Result
  lifecycle, recipes, the reviewed catalogs, the Video Composer, channels,
  presets, typed model ids, and the OpenAI-compatible request format.

The other parts of the frozen plugin platform stay as they are
([built-in AI Video and the frozen plugin platform](built-in-ai-video-and-plugin-freeze.md)).

## Limits

- A folder that holds only drafts has no file on disk. Git does not keep it,
  and a move of it outside BaseHalf is not recognized; its drafts then stay
  under the old path and show again when a folder of that name exists.
- A draft whose directory an agent moved under `.bh/mirror/` is a new draft at
  the new path; its place on the canvas and the entries that named it stay
  behind.
- Two people who generate the same draft get a conflict in git.

## Implementation boundaries

The modules keep the names they had for the Video node where they keep their
job, so that a name in history still finds its file.

- `common/basehalfGenerationInfo.ts` (new, replacing `basehalfVideoNode.ts`):
  the fields of `generation.yaml` and `made.yaml`, their shapes, reading field
  by field and writing with the value grammar, generation extensions and
  kinds, and the task record's fields, states, transitions, and claims. Pure.
- `common/basehalfVideoCatalog.ts`: the types of the catalog as the window
  receives it, models of both kinds, parameter normalization, input planning
  and names from mode declarations, prompt building, the summary of the
  settings, and the Generate blockers. Pure. It names no provider and no model.
- `common/basehalfVideoGeneration.ts`: the generation card store, the task
  record store, the catalog, provider settings, and generation service
  interfaces. The card store reads and writes generation information, lists
  drafts by the one rule of `common/basehalfGenerationDraft.ts`, and makes
  them, writing a new draft's `upstream.yaml` through the reference edit
  service before its `generation.yaml`; the draft operations rename, move,
  delete, and restore them; the task record store
  reads, writes, and watches `.bh/cache/generation/`; the catalog service asks
  for the catalog; the provider settings service keeps each provider's region,
  endpoint, and credentials and the last values used per kind.
- `common/basehalfNodeDocument.ts`, the `.bhnode` document, is removed.
- `common/basehalfGenerationInputNames.ts` (new, D68): the names in a prompt,
  the chips they show as, and the names of a prompt written again after a
  change of the list, from the list before and after and the entries a
  replace paired. Pure.
- The workbench implements the services, the panel of a draft
  (`browser/basehalfVideoNodePanel.ts`) and of a card with its file
  (`browser/basehalfGenerationRecordPanel.ts`), the card, the toolbar
  actions, and the Providers page, all drawn from the catalog. Both panels
  draw their inputs with the input row (`browser/basehalfGenerationInputRow.ts`)
  and their prompt with the prompt field
  (`browser/basehalfGenerationPromptEditor.ts`: the text with its chips, its
  own undo and Select All, and the caret), and a draft's panel opens the reference menu
  (`browser/basehalfGenerationReferenceMenu.ts`). The name follower
  (`browser/basehalfGenerationNameFollower.contribution.ts`) takes part in the reference
  edits of drafts and writes the names of their prompts, as a participant of
  the reference edit service ([reference graph](reference-graph.md#undo)). The canvas
  lists drafts through the card store; the reference graph, the mirror
  cascade, and following moved items treat `generation.yaml` and `made.yaml`
  as card information and drafts as items.
- The provider service, in the shared process, owns the catalog and the
  provider modules and answers the calls of [Requests](providers.md#requests)
  (D75). The workbench passes the credentials with each call; the service
  keeps nothing.
- What Video Sequence learns of a generation card
  ([Video Sequence](video-sequence.md)), through the card store, is
  `{ kind, hasFile, generationId? }` for a generation card of an open
  workspace folder: `image` or `video`, whether its file exists, and the
  `id` of its `made.yaml` when it has one that can be read. It learns
  nothing for every other path: a file without generation information,
  a draft whose folder is not on this computer, a path outside the open
  workspace folders or under `.bh/`, and one that is or passes through a
  symbolic link. Nothing is written. The extension API
  `vscode.basehalf.inspectGenerationCard(uri)` answers the same and stays
  with the frozen platform; since D75 no admitted extension calls it.

## Acceptance criteria

Card information

1. A generated video lands as `<folder>/<card name>.mp4` and a generated image
   as `<folder>/<card name>.<png|jpg|webp>`, with nothing under `outputs/` and
   no partial file in the folder at any time, short of a crash in the rare
   case of [Landing](#landing), step 5; `made.yaml` then holds the
   request that the panel showed, with the paths of the text inputs and not
   their text.
2. New Image and New Video make drafts: a card on the canvas, a
   `generation.yaml`, no file, nothing in Files; Create from Connection also
   writes the draft's `upstream.yaml`, and the connection shows.
3. A draft's prompt and settings are saved in its `generation.yaml` with no
   dialog, also when no model is chosen, and read back the same; an agent that
   writes `prompt`, `provider`, `model`, `mode`, and `params` makes a draft
   that the canvas shows and that generates; a prompt typed in the panel while
   an agent changes the model keeps both.
4. The task record of a generation is in `.bh/cache/generation/`, never in
   card information; a second window shows the card generating, and a Generate
   there, or an agent's `--generate` at the same moment, is refused with "This
   card is already generating." and sends nothing.
5. Renaming a card with its file in Finder, and renaming a draft on the
   canvas, keep the card's prompt, settings, record, connections, and place;
   renaming the folder of a draft in Finder keeps the draft's prompt,
   connections, and place, also in a folder the canvas never showed, and
   lands the file of a generating draft in the renamed folder; a rename of a
   generating draft that fails part-way leaves the draft whole where its task
   record names it.
6. Deleting a generated file to the trash takes its card off the canvas and
   offers nothing to generate; restoring it brings the card back with its
   prompt and record, and renaming a draft to its name meanwhile is refused.
7. A `generation.yaml` with git's conflict markers leaves the card shown and
   the panel usable; saving a prompt keeps a recovery copy, and `made.yaml` is
   unchanged.
8. A file dropped into the folder under a draft's name becomes the card's
   file, an ordinary file without a panel; a file moved there in Finder that
   BaseHalf recognizes keeps its own card, and the draft moves to the next
   free name.

Inputs

9. With three images, a video, and a text note connected in that order to a
   draft whose own mode is Frames on a model that also has References, the
   mode that is used is References: it takes the three images and the video,
   adds the note's text without front matter to the prompt, and the panel
   shows References. With the video and the third image disconnected, the
   mode that is used is Frames again, with the first image as the start frame
   and the second as the end frame. The card's `generation.yaml` keeps Frames
   throughout.
10. The swap arrow exchanges the two frames' entries in `upstream` and nothing
    else, in one undo step.
11. An SVG start frame reaches the provider as a PNG; an image larger than the
    mode allows is reported with its name and the limit before Generate, and
    refused before anything is written.
12. An input that names a draft is dimmed as unavailable until the draft has
    its file.

Providers

13. Providers lists the catalog's providers, each with its models under Images
    and Videos; a provider is set up with a region and its credentials, which
    are stored encrypted and are in no workspace file and not in the page's
    DOM.
14. The model menu of a card lists the catalog's models of the card's kind by
    provider, the providers that are set up first, each model with its
    abilities on a second line, and marks a provider that is not set up and a
    model its region does not offer; choosing an image model that delivers
    JPEG renames `image.png` to `image.jpg`.

Panel and card

15. Creating a draft selects it and shows the panel with the prompt focused,
    with no frame or ring around the prompt.
16. The panel never pans or zooms the canvas; it is below, above, or clamped
    as specified, and hidden when the card is off the canvas.
17. The settings popover is drawn from the model's parameters for the mode,
    advanced ones under More; choosing a model or mode that does not accept a
    value replaces it with the default; the settings button and the request
    show the same values.
18. The Generate button is disabled with the first blocker as its tooltip and
    accessible name, in the specified order; the panel shows that reason as a
    line above the footer only when it is fixed outside the panel, whose Set
    Up opens Providers at the provider.
19. A name in the prompt that matches no input is underlined as a warning;
    `@` opens the reference menu (criterion 54).

A generation

20. Against a local test provider, Generate writes the task record as
    `preparing`, `submitting`, then `running` with the provider's task id,
    shows the phases on the card, and ends with the file at the card's path,
    `made.yaml` written, and the record removed.
21. A provider that answers at once lands its files without asking about a
    task; a reload while it is answering ends the card with the message about
    files that may have been made and charged, and nothing is sent again.
22. A refused key ends the task as failed with the provider's message; an
    unknown outcome ends it with the message about the provider's console and
    sends nothing again.
23. Stop ends the task as `stopped` and keeps no file that arrives later.
24. New Version on a card with its file makes a draft to its right with the
    prompt, provider, model, mode, and values of its `made.yaml` without the
    seed, and with its inputs, selects it with its prompt focused, generates
    nothing, and is one step of undo; the original is unchanged.
25. An image generation with `count` 4 makes three drafts to the right of the
    card before it sends, lands one image on each, and when the provider
    refuses one, fails that card alone.
26. After a reload, a `running` task is followed again and lands; a
    `submitting` task whose window is gone fails with the restart message; a
    task that crashed after its file was moved into place writes its
    `made.yaml` without a second download.
27. An image that arrives as JPEG for `image.png` lands as `image.jpg` with its
    card, connections, and place.
28. `basehalf --generate` starts a generation without a question, prints the
    path of every card, and refuses values the model does not accept; on a
    card with its file, it makes a new version and generates that draft, and
    the card itself does not change.
29. Capturing the first, current, and last frame writes three PNGs whose cards
    appear beside the video, each connected from it.
30. Sequence adds a generated video, shows an item as changed when another
    video took its path, and repairs a moved one by its `generationId`.
31. Nothing shows what a generation costs: the panel, Providers, and what
    agents read hold no price, estimate, or currency, and `check` answers no
    price or estimate.

Undo

32. Undo of New Video removes the draft with its prompt, and redo brings it
    back; undo of deleting a draft brings back its prompt, settings,
    connections, and place; both refuse while the draft generates.

Focus

33. While the prompt is typed in, it has no frame or ring; a field of the
    settings popover shows its focus by its border alone.
34. The model menu of a card without a model and the menu of Capture Frame,
    opened by a click, have no current item and no ring, and choosing from
    them with the mouse leaves no ring on the model button or on Capture
    Frame.

The player

35. A click on the picture of a selected card whose video plays leaves the
    video playing; a drag from the picture of a selected card moves the card;
    the pointer over the picture is the grab hand, and over the controls the
    arrow.
36. The pointer on a card plays its video without sound and leaving the card
    pauses it, also while the card is selected; the controls show while the
    pointer is on the card or the card is selected; a press on the position
    slider moves the video and not the card; the sound button turns the
    sound on.
37. The card of a video file plays its video the same way.
38. **Open** on the player and a double click on the picture open the card
    and pause its video; closing Card Detail shows the canvas the card is on
    again.
39. Pausing a video with sound, by any of the ways that pause it, takes its
    sound to silence over 60 ms before it stops; starting it and turning the
    sound on bring the sound up over 40 ms; the sound reaches silence before
    the video's end; recorded at the window's output, no sample after the
    pause differs from silence.
40. Card Detail plays a video in the player with its controls shown, the
    sound on, and Full Screen; a click on the picture plays and pauses it.
    It starts at the frame the card showed, and the card shows the frame
    where Card Detail stopped.
41. The card of a WAV file shows the glyph of a sound and no system control;
    the pointer on it plays nothing; Play plays it with its sound, and
    pausing it takes the sound down as criterion 39 says (measured
    2026-10-23: the last 2 ms before silence peak at 0.017, against 0.283
    for the same sound stopped at once). Card Detail plays it in the same
    player, without Full Screen. The cards of MOV, M4V, and MKV files play
    their video.

A draft and a card with its file (D67)

42. The panel of a card with its file shows the inputs, prompt, model, and
    summary of the settings of its `made.yaml`, not those of a
    `generation.yaml` beside it; its prompt can be selected and copied, and
    nothing in it changes the card. It has New Version and no Generate. With
    a `made.yaml` that cannot be read, it says so and has no New Version.
43. When a draft's file lands, its `made.yaml` is written and its
    `generation.yaml` is removed, and its panel, if open, becomes the panel
    of a card with its file; a file that lands beside its card has only its
    `made.yaml`.
44. While a draft generates, its prompt is read only, its input row has no
    buttons, no cross, and no swap arrow, its model and settings buttons open
    nothing, and its stop square stops it; after a failure the card is a
    draft that can be changed.
45. A connection from a video card into a draft whose model takes no video
    is refused, on the canvas and through Pick on Canvas, with the reason,
    and nothing is written; a PDF is refused the same way. When a model that
    takes no video is chosen for a draft with a video connected, Generate is
    disabled, and the reason line names the video and why.
46. Connecting into a card with its file, disconnecting one of its inputs,
    and reconnecting one are refused with the reason, and its `upstream.yaml`
    is unchanged; the same is refused for a draft while it generates.
47. A mode that cannot use every input of the draft is dimmed in the
    settings with the first input it cannot use, and cannot be chosen.
48. A selected draft, image or video, shows no toolbar above it: no Upload
    Image or Upload Video (D71).

References and mentions (D68, D74)

49. With three images, a video, and a note connected to a draft in
    references mode, the input row shows five tiles in the order of the
    list, none with a number (D71); a connection drawn on the canvas
    adds its tile at the end, and a connection removed on the canvas takes
    its tile away.
50. The cross of a tile removes its connection from the canvas, and undo
    brings back the connection, the tile, and the mentions the prompt lost.
51. Pointing at a tile shows its larger look above it, or below the row when
    there is no room above, with its file's name; for an input that cannot
    be used, it also says why.
52. With "@[a.png] 里的人骑车，背景是 @[c.png]" and the images `a.png`,
    `b.png`, and `c.png` connected, removing the connection of `a.png` on the
    canvas writes "里的人骑车，背景是 @[c.png]" to `generation.yaml` in the
    same step of undo; dragging the tile of `c.png` before `b.png` changes
    nothing in the prompt; moving the source end of the connection of
    `c.png` to `d.png` writes `@[d.png]` in its place.
53. A mention typed by hand of a connected input shows as a chip with its
    picture and its file's name; Backspace after a chip removes it whole;
    copying a prompt with chips copies their mentions as text, and pasting
    it puts the same chips in; and `generation.yaml` holds the mentions as
    `@[<entry>]`.
54. Typing `@` opens the reference menu with its search field focused; Enter
    on a connected input puts its chip in place of the `@`; choosing an image
    card of the canvas that is not connected connects it, shows its tile and
    its connection, and puts its chip there; a video card, for a model that
    takes no video, is dimmed with the reason and cannot be chosen; Escape
    leaves the `@` as typed.
55. An `@` inside an e-mail address opens nothing; composing Chinese with an
    input method, in the prompt and in the search field, makes no chip and
    opens no menu before the composition ends.
56. `Cmd/Ctrl+Z` in the prompt undoes its typing and not a step of the
    canvas; with the canvas focused, it undoes the canvas's step.
    `Cmd/Ctrl+A` in the prompt selects the whole prompt, and what is typed
    next takes its place.
57. The `@` of a tile puts its mention at the caret; on a focused tile,
    Alt+Right moves it one place and Delete removes its connection.
58. While a draft generates, its tiles have no cross, `@`, or dragging, and
    its prompt opens no menu; the panel of a card with its file shows its
    inputs as tiles and the mentions of its prompt as chips, read only.

Pick on Canvas (D69)

59. Pick on Canvas stays on: clicks on two cards connect both, in that
    order; a click on a connected card removes it and its mentions; each is one
    step of undo; and a click on the blank canvas, the draft, or a card the
    model cannot use changes nothing. Escape and Done end it.
60. While picking, the pointer over a card that a click connects or removes
    is the pointing hand, and over the draft, a folder, or a card the model
    cannot use it is the not-allowed pointer, over a card's name as well;
    the label beside it says what a click does or why not; a connected card
    is darkened with a check mark; and a drag moves no card.
61. A connection made or removed, by a tile's cross, the reference menu, or
    Pick on Canvas, draws the row and the prompt again without a blank
    frame: the tiles and chips that stay keep their pictures, and a video's
    tile keeps its first frame.
62. While picking, a click that connects or removes the card under the
    pointer changes its look in one frame: the accent outline appears or
    goes once, and the card's element, picture, and video stay.
63. The tiles, the prompt's text and a chip at its start, the reason's icon,
    and the model button begin at one left edge, within half a pixel, and
    the reason's action and the Generate button end at one right edge; a
    chip's text and the prompt's text share a baseline.
64. A connection made or removed in the panel, and its undo, shows on the
    canvas's line within two frames of the tile at 60 Hz, 34 ms.

Ranges, lengths, and Generate (D70)

65. With a 5.0-second video connected to a Wan 3.0 draft set to 30 seconds,
    the duration goes up to 25 seconds with its reason under it, the summary
    says 25s, Generate is enabled, and 25 seconds are sent and recorded; the
    card keeps 30, which shows again when the video is removed.
66. The tile of a video or a sound shows its length, such as 5.0s.
67. The model menu shows each video model's range of durations, such as
    4–15s.
68. A reason the panel fixes, such as a problem `check` reports for the
    prompt, dims Generate with the reason as its tooltip and shows no line;
    a provider that is not set up shows its line with Set Up.

Adding inputs and notes (D71)

69. A draft's panel has Pick on Canvas and Import File… as two icon buttons
    at its top right, at the end of the input row, with their names as
    tooltips, and no plus; Import File…'s icon is the paperclip, and no
    control of a generation card shows a cloud; a click on Pick on Canvas
    starts picking and highlights it with the accent, and a second click
    ends picking.
70. The reference menu lists Notes under On This Canvas with the notes of
    the card's folder; choosing one connects it, so its tile and its line
    appear, and puts its chip in place of the `@` (D74); a connected note
    is listed under Connected and says Connected in the list of Notes.
71. The pointer over a tile is the arrow, and over its cross and its `@` the
    pointing hand.
72. Clicking the `@` of a tile while pointing at it puts its mention in the
    prompt, and for two seconds after, through the check and the save of the
    prompt, the row is not drawn again: the tile, its picture, the look, and
    the look's picture stay the same elements.

Mentions (D74)

73. Renaming a connected image on the canvas or in Files, and moving it to
    another folder, writes its new path into the mention of the draft's
    prompt, and its chip shows the new name; undoing a rename on the canvas,
    and renaming the file back, put both back. A rename outside BaseHalf
    that BaseHalf follows does the same.
74. A mention of a file that is not connected, as an agent may write it or
    a copy of a draft keeps it, shows as a chip with the file's glyph and
    name and a warning underline, and Generate is dimmed with "The prompt
    mentions <name>, which is not connected."; connecting the file shows its
    picture on the chip and lets Generate run.
75. A generation sends the prompt as its provider module writes it, and
    `made.yaml` and the panel of the card with its file keep the mentions:
    through the ByteDance module, a mention of the end frame of a Seedance
    2.5 draft is sent as `the last frame`, and one of its second reference
    image as `@Image 2` ([ByteDance](providers/bytedance.md)); the task
    record holds the prompt so written.
76. A mentioned note is sent as its name in double quotes, and its text
    follows the prompt under that name: `Shoot @[notes/scene.md] at dusk.`
    with a note that says `A rider on the coast.` is sent as
    `Shoot "scene" at dusk.`, a blank line, `scene:`, and the note's text.
77. Two connected inputs with the same file name in different folders show
    chips with their folders, such as `a/hero.png` and `b/hero.png`.
78. Card Detail shows the prompt of a generated file with each mention as
    its file's name. New Version of a card whose input was renamed after the
    card was made gives the new draft a prompt that mentions the input at its
    new path, and the new draft can generate.
79. `basehalf --list-capabilities` gives the authoring contract of
    `generation.yaml` as version 7, whose example prompt mentions an input as
    `@[<entry>]` of the example's `upstream.yaml`.

## Verification

- Unit tests of the pure modules (`basehalfGenerationInfo.test.ts`,
  `basehalfVideoCatalog.test.ts`); of the card store with drafts, renames,
  copies, deletes, undo, conflict markers, and field-by-field writes; of the
  task record store with two followers, claims, and stale heartbeats; of the
  services with a fake provider service and a test catalog, including a provider that
  answers at once, a crash during landing, and several images; of the panel
  drawn from that catalog; of the reference index and edit service with
  drafts; of the mirror cascade and following moved items with
  `generation.yaml`, `made.yaml`, drafts, and a folder moved during a
  generation, also when a step of the move fails; of the draft operations,
  with a move that fails part-way and a delete while the draft generates;
  of the one rule of drafts, with a disk that cannot be read; for criterion
  31, what the panel's footer holds, the labels of the regions on Providers,
  and the catalog that `--list-capabilities` gives agents; the player's
  gestures, controls, and sound
  (`basehalfCanvasCardVideoPlayer.test.ts`), and its fades with a test
  audio graph and clock (`basehalfCanvasVideoSound.test.ts`).
- Unit tests of the canvas and its interface: the folder's model with its
  drafts (`basehalfCanvasModel.test.ts`), the card's face
  (`basehalfVideoCard.test.ts`), the panel host
  (`basehalfCanvasVideoPanel.contribution.test.ts`), New Image, New Video,
  and the draft operations as steps of undo
  (`basehalfGenerationCardActions.test.ts`), the names a paste, a duplicate,
  and a copy take (`basehalfCanvasFileOperations.test.ts`), copies through
  the workbench (`basehalfGenerationCardCopy.test.ts`), the action context
  of a draft (`basehalfCanvasActionContext.test.ts`), a selected draft for
  agents (`basehalfAgentSelection.test.ts`), and what Card Detail says made
  a file (`basehalfGenerationProvenance.test.ts`).
- Unit tests for D67: the mode that is used and the input refusals
  (`basehalfVideoCatalog.test.ts`), the recipe of New Version without the
  seed (`basehalfGenerationInfo.test.ts`), the panel of a card with its file
  (`basehalfGenerationRecordPanel.test.ts`), the panel host choosing the
  panel and selecting the new version
  (`basehalfCanvasVideoPanel.contribution.test.ts`), New Version as an
  action (`basehalfGenerationCardActions.test.ts`), the landing that
  removes `generation.yaml` and `--generate` on a card with its file
  (`basehalfVideoGenerationService.test.ts`), and the connections the canvas
  refuses.
- Unit tests for D68 and D74: mentions that follow a change of the list,
  the names of notes, and the prompt in parts
  (`basehalfGenerationMentions.test.ts`); a participant of the reference
  edit service and its undo and redo (`basehalfReferenceServices.test.ts`);
  the follower that writes a draft's prompt
  (`basehalfGenerationMentionFollower.test.ts`); the prompt with chips, an input
  method, paste, and its own undo (`basehalfGenerationPromptEditor.test.ts`);
  the tiles, their look, and dragging (`basehalfGenerationInputRow.test.ts`);
  the reference menu (`basehalfGenerationReferenceMenu.test.ts`); and the
  panel (`basehalfVideoNodePanel.test.ts`).
- Unit tests for D69: what a click on each card does while picking, and
  connecting and removing in a row (`basehalfVideoNodePanel.test.ts`); the
  pictures and chips kept when the row and the prompt are drawn again
  (`basehalfGenerationInputRow.test.ts`,
  `basehalfGenerationPromptEditor.test.ts`).
- The tests of each provider module ([providers](providers.md#verification)).
- `npm run basehalf:smoke` with steps for criteria 1 to 8, 13 to 30, 32 to 38,
  42 to 46, 49, 50, 52, 54, 56, 59, 60, 62 to 64, 73 to 76, and 78, against the local test provider through the ByteDance module, with a
  test key; no paid provider is called. The test provider answers every task
  and image with a file of its own, as a real provider does, so that a file
  moved outside BaseHalf is told from another by its content. After a
  reload, the smoke has the new window take a generation over at once by
  writing its task record as it is when the window that followed it last said
  it was alive two minutes before, and it stands for a delete to the Trash by
  moving the file out of the workspace, since it deletes permanently. What a
  window cannot make happen is covered by the unit tests above: a second
  window of the workspace (criterion 4), a rename that fails part-way
  (criterion 5), and a crash after a file was moved into place (criterion
  26).
- A real-window check of drafts, the panel, the settings of models of several
  providers, a generation of an image, of four images, and of a video against
  the local test provider, a rename in Finder during a generation, and a
  reload during a generation; and for D67, the panel of a card with its file,
  New Version and generating it at once, a video connected into a second
  video draft, and a connection into a card with its file; and for D68, the
  tiles and their look, a drag of a tile, the reference menu typed with the
  real keyboard and with an input method, and the names of a prompt after a
  connection is removed on the canvas and after undo; for D74, mentions of
  images and a note, a rename in Files and in Finder, and the prompt the test
  provider received; and for D69, Pick on
  Canvas on a canvas of large images and videos, with every frame of the row
  sampled while cards are connected and removed (criterion 61).
- A generation with a real provider is run by a person with their own key
  before a release that adds or changes a provider module.
