# Generation cards

Status: Draft (2026-10-22, reviewed once; replaces the Video node specification of 2026-10-15 to 2026-10-22)
Decisions: [D58](../decisions.md#d58--a-video-node-is-a-prompt-over-its-connections-run-by-the-users-own-providers-new-2026-10-15),
[D59](../decisions.md#d59--video-providers-are-built-in-integrations-with-each-models-exact-settings-users-bring-their-own-keys-new-2026-10-19),
[D61](../decisions.md#d61--basehalf-shows-no-price-new-2026-10-21),
[D62](../decisions.md#d62--a-cards-video-is-the-cards-picture-and-the-pointer-plays-it-new-2026-10-22),
[D63](../decisions.md#d63--a-generated-file-is-its-card-new-2026-10-22),
[D64](../decisions.md#d64--basehalf-generates-images-with-the-same-cards-panel-and-providers-new-2026-10-22)
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
runs from a click to its files, generating again, and how agents generate.
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
- Everything the earlier Video node did keeps working: the inputs in the
  order of the connections, the panel, generating again, a generation that
  survives a reload, agents that generate.

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

- **Generation card**: a card whose card information holds a
  `generation.yaml`, or a `made.yaml`, and whose path has a generation
  extension.
- **Generation extension** and **kind**: `image` for `.png`, `.jpg`, `.jpeg`,
  `.webp`, `.gif`, `.avif`, and `.bmp`; `video` for `.mp4`, `.mov`, `.m4v`,
  and `.webm`; without regard to case. These are the extensions an input of
  that kind may have. A `generation.yaml` or `made.yaml` at any other path is
  not read.
- **Draft**: a generation card whose path names no file and that has no
  `made.yaml`. Its path is the path its file will have.
- **Generation information**: the card's `generation.yaml` (what the next
  generation uses) and `made.yaml` (what made its file),
  [described below](#card-information).
- **Input**: an entry of the card's upstream list, that is, a connection into
  the card. Its kind is image, video, audio, text, or other.
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
- A generated file never changes. Generating from a card that has its file
  makes a new card ([Generating again](#generating-again)).

### `generation.yaml`

`.bh/mirror/<path>/generation.yaml` holds what the next generation of the card
at `<path>` uses. Users, through the panel, and agents write it.

```yaml
prompt: "图片1里的人骑车经过海边，镜头缓慢跟随"
provider: "bytedance"
model: "seedance-2.5"
mode: "frames"
params:
  resolution: "720p"
  duration: 5
  generate_audio: true
```

- `prompt`: up to 64 KiB.
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
prompt: "图片1里的人骑车经过海边，镜头缓慢跟随"
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
- `prompt` is the card's own prompt as it was sent. The text of the text
  inputs that joined it is not recorded; `inputs` names those notes, as it
  names every input, in the order they were listed. So a note's text is never
  copied into what git shares. The whole prompt as sent stays in the task
  record on this computer while the generation runs.
- A `made.yaml` that cannot be read is left as it is, byte for byte, and the
  card shows its file without its record.

### Drafts and missing files

- **A draft** is a `generation.yaml` with no `made.yaml` whose path names no
  file. It is created by **New Image**, **New Video**, **Create from
  Connection**, generating again, a generation of several images, the starter
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
- **A file that appears at a draft's path** becomes the draft's file, and the
  card is that file's card from then on, unless the file is an item that was
  moved there, through BaseHalf or outside it and
  [recognized](following-moved-items.md#recognition): then the moved item
  keeps its own card information and the draft moves aside to the next free
  name, the first numbered name of its folder (`shot-2.mp4`, `shot-3.mp4`) at
  which neither an item nor any card information is. The entries that named
  the draft's path then name the item that took it: the rename refactor leaves
  an entry alone whose old path names an item again
  ([reference graph](reference-graph.md#rename-refactor)).
- **A missing file**: when the file of a card that has a `made.yaml`
  disappears (deleted in Finder, deleted to the trash, not pulled from git),
  the card is gone from the canvas like any card whose file is gone, and its
  card information stays where it is, so that the file and its card come back
  together when it returns. It never becomes a draft: BaseHalf does not offer
  to generate again what was paid for once.
- A draft in a folder that does not exist on this computer is not shown. Git
  drops a folder without files, so a folder that holds only drafts reaches a
  teammate as drafts without a folder; they show when the folder exists.

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
  that it is alive every 30 seconds. Another window takes a generation over
  only when that has not happened for 90 seconds.
- **Every change of a record is written against the bytes that were read**,
  and planned again from the new bytes when they changed underneath, so that
  a heartbeat, a takeover, a stop, and a move that writes a card's new path
  never write over one another; of two windows that take over the same
  record, one does.
- The record of a generation that ended without its files stays until the
  card generates again or is deleted, so that the card can say why. The record
  of a generation that landed is removed once each `made.yaml` is written, and
  so is one whose cards that got no file are all gone, such as an image of
  several whose draft was deleted.
- BaseHalf watches `.bh/cache/generation/` and nothing else of `.bh/cache/`, so
  every window of the workspace on this computer shows the same state.
- When the workspace opens, BaseHalf removes partial downloads that no record
  that has not ended names, and ended records whose cards are gone (no file
  and no draft). A record that has not ended keeps its partial downloads:
  another window may be receiving them, as AI Video writes the files of a
  provider that answers at once while the record is `submitting`.
- A teammate who pulls a draft through git gets its prompt, settings, and
  connections, and no task: a generation is followed and settled only on the
  computer that started it.

### What git shares

| Shared through git | Kept on this computer |
| --- | --- |
| the generated files, `generation.yaml` (prompts and settings, drafts too), `made.yaml`, `upstream.yaml`, descriptions | card places (D46), credentials, the last values used, task records, the prompt as sent with the text of its notes |

Two people who generate the same draft each get a file under the same name and
a `made.yaml`; git reports the conflict as for any file both added. BaseHalf
adds nothing to resolve it.

### What an agent may write

An agent may create a draft or change a card's next generation by writing its
`generation.yaml` (`prompt`, `provider`, `model`, `mode`, `params`), and its
inputs in `upstream.yaml`. It never writes `made.yaml` or a task record, and,
as for everything under `.bh/`, it never moves, renames, or deletes these
files: a draft is renamed, moved, or deleted by the user on the canvas. The
skill that BaseHalf offers to agents describes this subset and the command
that generates ([Agents](#agents)).

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
- New cards are drawn at 720 × 405 for a video and at 300 × 220, the size of a
  file card, for an image.
- **Every name BaseHalf chooses treats a draft's path as taken**: a new draft,
  generating again, several images, a paste, a drop, Import File, Capture
  Frame, and the rename editor.
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
owns how entries are added, removed, and renamed; a generation card accepts
any entry, draft or not.

Each entry resolves to a kind by its file's extension: images (`png`, `jpg`,
`jpeg`, `webp`, `gif`, `svg`, `avif`, `bmp`), videos (`mp4`, `mov`, `m4v`,
`webm`), audio (`mp3`, `wav`, `m4a`, `aac`, `ogg`, `flac`), and text (`md`,
`markdown`, `txt`). An entry that names a draft is of the draft's kind and
unavailable until the draft has its file. Anything else, such as a folder or
a PDF, is of kind other and is not used.

How a generation uses the inputs is computed once, in `planBaseHalfInputs`,
from the slots that the selected mode declares
([Modes and inputs](providers.md#modes-and-inputs)), for the panel and for
the request alike:

- **Text inputs** join the prompt in every mode: the card's prompt, then the
  text of each text input in order, separated by a blank line. A Markdown
  note's front matter is left out, and each text input adds at most 16 KiB.
- **Frames mode** takes the first available image as the start frame and the
  second as the end frame, as far as the mode declares them. Later images,
  videos, and audio are not used.
- **References mode** takes images, videos, and audio in order, as many as
  the mode declares. Later ones are not used. An image model's references
  mode with no image makes the image from the prompt alone.
- **Extend** and **Edit** take the first available video as the clip, and Edit
  takes images as references as far as the mode declares them.
- **Names**: images, videos, and audio are numbered by kind in upstream
  order, used or not: 图片1, 图片2, 视频1, 音频1 in a Chinese display
  language, and Image 1, Video 1, Audio 1 otherwise. A prompt refers to an
  input by its name, as these models expect, and keeps meaning the same input
  while the list keeps its order.
- An input that is not used says why: it names nothing, it is a draft
  without its file, its kind cannot be used, the mode does not use it, or it
  comes after what the model takes.
- The provider receives images in the formats the mode declares
  (`imageFormats`; PNG, JPEG, and WebP when it declares none). An image of
  another format is drawn to PNG first. The mode's limits (sizes, lengths,
  bytes) are checked before anything is written, and a file outside them is
  refused with its name and the limit.

## Providers

The providers, their models, and the credentials users enter for them are
specified in [providers and the model catalog](providers.md). The user sets
them up in Settings, on the **Providers** page. A card offers the models of
its kind: an image card the image models, a video card the video models.

## Settings

The settings of a card are drawn from its model's
[parameters](providers.md#parameters), for the card's mode:

- **Mode** first, when the model offers more than one. A mode that the
  provider's region does not offer is dimmed with the reason, and can still
  be chosen.
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

A generation card that is the only selected card shows one panel under it,
whether or not it has its file. It appears when the card is selected,
including right after the card is created, and goes when the card is no
longer selected. The workbench builds it; the canvas scene places it
([Placement](#placement)).

From top to bottom:

1. **Input row**, when the mode or the card has inputs to show.
   - Frames mode shows two slots, start and end, joined by a swap arrow, as
     far as the model takes frames. A filled slot shows the image with its
     name (图片1). An empty slot shows a plus.
   - References mode shows the used and unused inputs in order as small
     thumbnails with their names, then a plus.
   - Text inputs show as small chips with their file names. An unused input
     is dimmed, and its tooltip says why.
   - Hovering an input shows a cross that removes its connection. The swap
     arrow swaps the order of the two frames' entries in `upstream`.
   - The plus offers **Pick on Canvas** (the next click on a card connects it
     as an input; Escape cancels) and **Import File…** (copies a file into
     the card's folder and connects it).
2. **Prompt**: a text field that grows to five lines and then scrolls. Typing
   `@` lists the inputs that have a name, with thumbnails; choosing one types
   its name. Names in the prompt are highlighted; a name that matches no
   input is underlined as a warning. The prompt is saved to
   `generation.yaml` half a second after typing stops, when the field loses
   focus, when the card is deselected, and before a generation starts.
   Nothing is written while an input method composes text. Saving never
   opens a dialog. When the file changes underneath while the field has the
   focus, the field keeps what the user typed; at rest it shows the new
   prompt.
3. **Footer**: the model button, the settings button, and the Generate
   button.
   - The model button shows the model's name. Its menu lists the catalog's
     models of the card's kind grouped by provider: the providers that are
     set up first, then the others, each in the catalog's order; a provider
     that is not set up says so next to its name, and its models can still be
     chosen. Each model shows a second line drawn from its declarations: its
     modes, and for a video its longest duration, its largest resolution,
     and Sound when it makes sound, such as "Frames · References · 15s ·
     1080p · Sound"; for an image its largest resolution and, when it can
     make more than one, how many images one generation can make, such as
     "4K · Up to 4". The largest resolution is the one with the most pixels:
     a `p` value counts a 16:9 frame of that height and a `k` value a square
     of that many thousand pixels a side, so 720p < 768p < 1k < 1080p <
     1.5k < 2k < 3k < 4k. A model the provider's region does not offer is shown
     dimmed with the reason, and can still be chosen. Deprecated models are
     listed only for a card that uses one. The menu ends with **Providers…**.
   - While the catalog loads, the model button says so and its menu holds
     only **Providers…**; when it could not be loaded, the menu says why. The
     window asks AI Video for the catalog once and keeps it; a failed request
     is tried once more a second later, and again when a panel or the
     Providers page opens.
   - The settings button sums up the settings: the mode, then the value of
     every parameter that is not advanced, such as "Frames · 720p · 5s ·
     Sound". Its popover is 300 px wide and holds the settings above; every
     change is saved at once, and text when its field loses the focus, on
     Enter, and when the popover closes. Until the catalog has the card's
     model, there is no settings button.
   - The Generate button is a round arrow. While the card generates, it is a
     stop square that stops the generation.

The Generate button is enabled only when the card can generate. Otherwise its
tooltip and accessible name say the first reason, in this order
(`getBaseHalfGenerateBlocker`): the card is generating; the catalog is
loading or could not be loaded; no model is chosen; the catalog has no such
model; the model makes the other kind; the provider is not set up; the
provider's region does not offer the model; the provider's region does not
offer the mode; an input is missing, is a draft without its file, or is not a
file on this computer, or the first problem that the provider module reports
for the planned generation ([check](providers.md#requests)); there is
nothing to send. For no model, no such model, a model of the other kind, the
provider, and the region, the model button is outlined and its tooltip says
the same.

The panel also shows that reason as a line above the footer, at most two
lines tall, so it can be read without pointing at the button. When one
action fixes it, the line offers that action: **Set Up** opens Providers at
the provider that is not set up, and **Providers…** opens it at the provider
whose region does not offer the model or the mode. There is no line while
the card generates, while the catalog loads, when no model is chosen, or when
there is nothing to send: the stop square, the model button, and the empty
prompt already say those.

The panel asks the provider module for the problems of the planned
generation a quarter of a second after the model, mode, values, prompt,
inputs, or the inputs' files change, also before the provider is set up, and
keeps the last answer for the same model until the new one arrives. It asks
with the files a generation would send: images in a format the mode takes,
or drawn to PNG as a generation draws them, and videos and audio as they
are, so sizes, lengths, and formats are reported before Generate. An input
that is missing, a draft, or not a file on this computer is reported by
name instead, and nothing is asked.

Keyboard: `Cmd/Ctrl+Enter` in the prompt generates when the button is
enabled. `Escape` closes the innermost open menu or popover, and with none
open, returns focus to the card. Menus follow the arrow keys, Home, End, and
Enter. A menu starts at its checked item; without one, a menu opened from
the keyboard starts at its first item, and a menu opened by a click has no
current item until Down chooses the first or Up the last.

Focus follows the canvas's rule
([architecture invariants](../harness/architecture-invariants.md#product-shell)).
The prompt has no frame or ring when it has the focus: its caret shows it,
and the text being typed looks as it does at rest. A field of the settings
popover shows the focus by its border alone. The buttons, slots, and menu
items show a ring only when the keyboard moved the focus to them, so a model
chosen with the mouse leaves no ring on the model button.

### Placement

The panel is 512 px wide (narrower only on a canvas narrower than 536 px); its
height follows its content, from 132 px without an input row to 260 px with
one and a reason line of two lines. It keeps that size at every zoom. It sits
10 px below the card, centered; above the card, clear of its name and toolbar,
when there is no room below for the tallest panel; inside the canvas, clamped,
when there is room for neither. The panel and its menus stay 12 px inside the
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
| failed | the glyph and the error in at most two lines; the full text in the tooltip |
| stopped | the glyph and "Stopped" |
| file | the image, or the video in [the player](#the-player) |
| file that cannot be shown | the glyph and "This image cannot be shown here" or "This video cannot be played here", with its path in the tooltip |

The phases generating, failed, and stopped come from the task record and are
shown only on the computer that has it. The card keeps its size when the file
arrives; the image or the video is fitted inside it. The card changes in place
when its generation information changes, as when the panel saves the prompt
or an agent writes the file, and when it is selected or deselected: its
player stays, and a video that plays goes on playing, except on a card
deselected with the pointer elsewhere, which pauses it.

The card's caption is its name, as for every file
([canvas card name](canvas-card-name.md)); a draft's caption is the name its
file will have, and renaming it renames the draft. A draft has no file to
open: a double click on it, Enter, and **Open** in its menu select it, and its
panel shows. Its card has no badge face until it has its file.

### The player

A video on a card plays the way canvas products for media work play the video
of a node. The card of any video file plays its video the same way.

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
- **The keyboard.** The buttons are buttons; the position slider moves a
  second with Left and Right, and goes to the start and the end with Home
  and End. The arrow keys on a control move no card.

### The toolbar

Above a selected draft that does not generate, the toolbar shows **Upload
Image** or **Upload Video**. Above a generation card with its file it shows
**Reveal in Finder** (Explorer on Windows, the file manager elsewhere) and
**Open**, and on a video **Capture Frame**, with First Frame, Current Frame,
and Last Frame.

- **Upload** copies the chosen file to the draft's path. It takes a file with
  a generation extension of the draft's kind, and refuses another with "An
  image card takes a PNG, JPEG, WebP, GIF, AVIF, or BMP file." or "A video
  card takes an MP4, MOV, M4V, or WebM file." When the file's extension
  differs from the draft's, the draft is first renamed to that extension, as
  a rename does. The card keeps its prompt and settings; it has no
  `made.yaml`.
- **Capture Frame** writes a PNG of that frame into the card's folder, named
  after the card and the frame (`shot first frame.png`, `shot last
  frame.png`, or `shot frame at 3.2s.png` for the current frame, with a
  number added when the name is taken). Its card appears to the right of the
  video card. It is an ordinary image that the user can connect to another
  card.
- **Open** shows the image or the video large in Card Detail, with what made
  it, from `made.yaml`: model and the id sent to the provider, provider and
  region, mode, settings, the prompt, the inputs in order, which image of how
  many it is, and when it started and finished. The names of the provider,
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

**Generate** (the button, `Cmd/Ctrl+Enter`, or an agent) runs these steps.
The steps before 5 write nothing; a stop at step 6 or 7 removes the record
and leaves no card it made:

1. Save the panel's pending prompt and read the card's generation
   information.
2. If the card or the card that a generation of several images would use is
   generating, stop with "This card is already generating."
3. Read the catalog and the provider's setup. Stop with the first blocker that
   is known without the inputs, as the panel shows it. An agent's request
   waits up to 30 seconds for the catalog while it loads. An agent's request
   whose values the model does not accept stops with the first such value
   instead of making them legal.
4. Decide the cards the generation lands on: the card itself when it is a
   draft, or a new draft beside it when it has its file
   ([Generating again](#generating-again)); and for an image `count` above 1,
   that many cards in all ([Several images](#several-images-from-one-generation)).
5. Write the task record as `preparing`, naming those cards, and claim them:
   when another record that is not ended names one of them, the record that
   was written first keeps it, and the other generation removes its record
   and stops with "This card is already generating." Then make the new drafts
   of step 4, one undo step together, named Generate.
6. Read the provider's region, endpoint, and credentials. Plan the inputs,
   read the text inputs, and build the prompt. Prepare the used images,
   videos, and audio, and have the provider module check the planned
   generation with its files; stop with the first problem, or when an input is
   missing. The values sent are the card's `params` made legal for the model
   and mode, with every default filled in.
7. Check the claim again, since another window may have written its record
   while this one prepared, and stop as in step 5 when that record keeps a
   card. Then write the request record and the state `submitting`.
8. Send the request through the AI Video extension. When the provider returns
   its task id, write it and the state `running`. When it answers with the
   files at once, continue at step 10.
9. Ask the provider about the task every 5 seconds, the first time after 3
   seconds, and show the phase and progress on the cards.
10. Land the files ([Landing](#landing)).
11. Remember the provider, model, mode, and values as the last used for the
    kind on this computer.

### Landing

Each file the generation made lands on its card. Steps 2 to 6 run inside the
workspace mutation lease, so that no move or rename runs between deciding its
place and moving it there:

1. Download the file to `.bh/cache/generation/<task id>-<n>.part`, never into
   the user's folder. Check it: a video is an MP4 of at most 512 MiB; an image
   is a PNG, JPEG, or WebP of at most 64 MiB. A file the provider answered with
   at once is checked the same way. Write its size and SHA-256 in the record
   as soon as it is received in full, so that a window that takes the record
   over lands it without downloading it again. A file received only in part
   is removed and asked for again; the file of a provider that answers at once
   cannot be asked for again, and its card fails with a message saying so.
2. Read the card's path from the record, where every move or rename of the
   card has written it. When the file's format differs from the card's
   extension and the card is still a draft, the draft is first renamed to the
   format's extension, with the next free number if that name is taken.
3. When the card's folder is gone, create it again.
4. Write in the record what is being landed: the path, the size, and the
   SHA-256 of the file.
5. Move the file into place without replacing anything there: when the path
   is taken by then, the file takes the next free name beside it, with a copy
   of the card's `generation.yaml`, and its card appears to the right.
6. Write `made.yaml`, and when every file has landed, remove the record.

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
- **Too long**: two hours after the start, the task fails with a message that
  says so.
- **Stop**: the user presses the stop square on one of its cards. BaseHalf
  stops asking, asks the provider to cancel where it can (best effort), and
  records the task as `stopped`. A file that arrives later, also from a
  provider that answers at once, is deleted and not kept.
- **A card is deleted** while it generates: the generation is stopped first
  when it was the only card; otherwise that card's file is not landed.

The card shows the failure; the Generate button starts a new generation on
the same card. An error is plain text without secrets or markup, at most 4
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
  old;
- a `landing` task is taken over and landed;
- a `submitting` task fails, never sent again: for a provider with tasks, with
  a message saying that BaseHalf closed while the request was on its way and
  asking the user to check the provider's console; for a provider that answers
  at once, with "BaseHalf closed while the provider was making the files. They
  may have been made and charged, but BaseHalf could not receive them. Check
  the provider's console.";
- a `preparing` task is removed, since nothing was sent.

### Generating again

Generating from a card that has its file makes a new draft in the same
folder, named like the card with the next free number
(`shot.mp4` and `shot-2.mp4` give `shot-3.mp4`), with the same prompt,
settings, and upstream entries, and runs the generation there. Its card
appears to the right of the original card, and it becomes the selected card.
The original card and its file do not change.

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
  its `made.yaml` says which one of how many it is. An image the provider
  refused fails on its card alone.
- When the provider makes fewer images than asked, the cards left over fail
  with "The provider made fewer images than asked."
- `basehalf --generate` prints the path of every card.

## Moving, renaming, copying, and undo

- **A card with its file** moves and is renamed as every file is: through the
  workbench, its card information moves with it, `generation.yaml` and
  `made.yaml` included; outside BaseHalf, it is
  [followed](following-moved-items.md) by its content.
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
    folder that exists, within its workspace folder. Card information that an
    item that is gone left under that name gives way, as it does to a move of
    a file through the workbench.
  - Its card information, card row, and task records move in one exclusive
    run under the workspace mutation lease; the entries that name it are
    rewritten right after, as after any move, and are owed until they are.
- **While a card generates**, a move or a rename of it or of its folder, through
  BaseHalf or [followed](following-moved-items.md#relocation) after a move
  outside it, writes the card's new path into the task record in the same
  exclusive run, so that the files land where the card is.
- **Copying** a generation card makes a new card in the folder where it is
  pasted: of a draft, a draft with the same prompt and settings; of a card
  with its file, a copy of the file with the same `generation.yaml` and a
  `made.yaml` whose `id` is new and which says it is a copy of the original's.
  Neither has upstream entries or a task. On the canvas, Copy and Paste and
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
  information. Undo and redo refuse, and say why, while the draft generates;
  when it is not a draft any more, or its prompt and settings changed since
  the step, as when a prompt was typed into a new draft; and when its path is
  taken. A refused undo stays the next step to undo. A generation itself is
  not undone. **Upload** is not a step of undo: the file it copied is the
  card's file from then on.

## Deleting

- Deleting a draft removes its card information and its card row, as one undo
  step. When it generates, the generation is stopped first, or, when it is one
  of several cards of a generation, its image is not landed. The canvas asks
  the generation service to release the card before the draft operations
  delete it; a draft whose card information is gone when its file arrives
  gets no file either, however it was deleted.
- Deleting a card with its file deletes the file as any file is deleted. A
  delete to the trash of a generated file keeps `generation.yaml` and
  `made.yaml`, as it keeps `upstream.yaml`: the card leaves the canvas as a
  missing file, and restoring the file brings its card back whole. A file
  without `made.yaml`, one that was uploaded to a draft, loses its
  `generation.yaml` with the delete, so that it does not stay behind as a
  draft; so does such a file below a deleted folder. A draft below a folder
  that is deleted to the trash keeps its card information and shows again
  when the folder comes back. A permanent delete removes them all, the
  drafts below a deleted folder included.

## Agents

- An agent writes generation information as described in
  [What an agent may write](#what-an-agent-may-write).
- `basehalf --generate <path>` starts a generation of the card at `<path>`,
  a draft or a card with its file, exactly as Generate does, and prints the
  path of every card the generation lands on (a new draft when the card had
  its file) once the task record is `submitting`. It does not wait for the
  files; each file and its `made.yaml` show when it lands.
  - `<path>` is relative to the workspace folder and names a generation card:
    a draft, or an image or video file with generation information. A path
    that names anything else, lies outside the workspace folder or under
    `.bh/`, or passes through a symbolic link is refused, and nothing is
    written.
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
  `generation.yaml` (contract version 5): its schema, an example of a card's
  `generation.yaml` and `upstream.yaml` built through BaseHalf's own writer
  with a model of the catalog, and the rules, the draft rule among them.
- The skill that BaseHalf offers to agents describes drafts,
  `generation.yaml`, `made.yaml`, the input order and names, the catalog, and
  this command. An agent that makes an image with a tool of its own, such as
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
- The workbench implements the services, the panel, the card, the toolbar
  actions, and the Providers page, all drawn from the catalog. The canvas
  lists drafts through the card store; the reference graph, the mirror
  cascade, and following moved items treat `generation.yaml` and `made.yaml`
  as card information and drafts as items.
- The built-in AI Video extension owns the catalog and the provider modules
  and answers the commands of [Requests](providers.md#requests). The
  workbench passes the credentials with each call; the extension keeps
  nothing.
- The extension API `vscode.basehalf.inspectGenerationCard(uri)`
  (`workbench/api/`, through the card store) answers
  `{ kind, hasFile, generationId? }` for a generation card of an open
  workspace folder: `image` or `video`, whether its file exists, and the
  `id` of its `made.yaml` when it has one that can be read. It answers
  `undefined` for every other path: a file without generation information,
  a draft whose folder is not on this computer, a path outside the open
  workspace folders or under `.bh/`, and one that is or passes through a
  symbolic link. Only an admitted extension may call it, and it writes
  nothing.

## Acceptance criteria

Card information

1. A generated video lands as `<folder>/<card name>.mp4` and a generated image
   as `<folder>/<card name>.<png|jpg|webp>`, with nothing under `outputs/` and
   no partial file in the folder at any time; `made.yaml` then holds the
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
   renaming the folder of a generating draft in Finder lands the file in the
   renamed folder.
6. Deleting a generated file to the trash takes its card off the canvas and
   offers nothing to generate; restoring it brings the card back with its
   prompt and record.
7. A `generation.yaml` with git's conflict markers leaves the card shown and
   the panel usable; saving a prompt keeps a recovery copy, and `made.yaml` is
   unchanged.
8. A file dropped into the folder under a draft's name becomes the draft's
   file; a file moved there in Finder that BaseHalf recognizes keeps its own
   card, and the draft moves to the next free name.

Inputs

9. With three images, a video, a text note, and a PDF connected in that order,
   frames mode on Seedance 2.5 uses the first image as the start frame and the
   second as the end frame, adds the note's text without front matter to the
   prompt, and dims the rest, each with its reason; references mode on a model
   that takes videos uses the three images and the video.
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
    line above the footer, whose Set Up opens Providers at the provider.
19. Typing `@` lists the named inputs, and choosing one types its name; a
    name with no input is underlined.

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
24. Generating from a card with its file makes a draft to its right with the
    same prompt, settings, and inputs, selects it, and runs there; the
    original is unchanged; a generation that a blocker stops makes no draft.
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
    path of every card, and refuses values the model does not accept.
29. Capturing the first, current, and last frame writes three PNGs whose cards
    appear beside the video.
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

## Verification

- Unit tests of the pure modules (`basehalfGenerationInfo.test.ts`,
  `basehalfVideoCatalog.test.ts`); of the card store with drafts, renames,
  copies, deletes, undo, conflict markers, and field-by-field writes; of the
  task record store with two followers, claims, and stale heartbeats; of the
  services with a fake extension and a test catalog, including a provider that
  answers at once, a crash during landing, and several images; of the panel
  drawn from that catalog; of the reference index and edit service with
  drafts; of the mirror cascade and following moved items with
  `generation.yaml`, `made.yaml`, drafts, and a folder moved during a
  generation; for criterion 31, what the panel's footer holds, the labels of
  the regions on Providers, and the catalog that `--list-capabilities` gives
  agents; the player's gestures, controls, and sound
  (`basehalfCanvasCardVideoPlayer.test.ts`).
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
- The tests of each provider module ([providers](providers.md#verification)).
- `npm run basehalf:smoke` with steps for criteria 1 to 8, 13 to 30, and 32
  to 38, against the local test provider through the ByteDance module, with a
  test key; no paid provider is called.
- A real-window check of drafts, the panel, the settings of models of several
  providers, a generation of an image, of four images, and of a video against
  the local test provider, a rename in Finder during a generation, and a
  reload during a generation.
- A generation with a real provider is run by a person with their own key
  before a release that adds or changes a provider module.
