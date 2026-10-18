# Video node

Status: Active (2026-10-15; providers and settings from the model catalog, 2026-10-19)
Decisions: [D58](../decisions.md#d58--a-video-node-is-a-prompt-over-its-connections-run-by-the-users-own-providers-new-2026-10-15),
[D59](../decisions.md#d59--video-providers-are-built-in-integrations-with-each-models-exact-settings-users-bring-their-own-keys-new-2026-10-19)
Related: [video providers and the model catalog](video-providers.md),
[reference graph](reference-graph.md),
[canvas card placement](canvas-card-placement.md),
[built-in AI Video and the frozen plugin platform](built-in-ai-video-and-plugin-freeze.md),
[architecture invariants](../harness/architecture-invariants.md)

This specification owns the Video node: its file, its inputs, the panel under
its card, the card, how a generation runs from a click to a video file, and
how agents run it. Which providers and models exist, what each model accepts,
the credentials, the requests, and the estimates belong to
[video providers and the model catalog](video-providers.md); this
specification reads them from the catalog. It replaces the earlier Video
node specifications of the AI Video extension (the development, Composer
surface, model picker, model settings, inputs, and execution and recovery
specifications), which are removed.

## Problem

Measured on 2026-10-14 in a development window and in the code:

- A new Video node showed no place to write a prompt until the user clicked
  elsewhere and clicked the card again. Writing a prompt before choosing a
  model and then clicking the canvas opened a dialog, "The Video Draft could
  not be saved", and the prompt was lost.
- A model could be chosen only from a reviewed list of eight models from three
  international providers. Nothing reached the provider the user actually
  uses (Seedance 2.5 on Volcengine Ark), a relay, or any model released after
  the list was checked on 2026-08-16.
- Inputs were a second system beside the connections: each input carried a
  stored role, with a canvas pick mode, a "Needs review" group, and role
  conversions. Text could not feed a video at all, and three of the six
  methods of the first model were listed as unavailable.
- Every Generate opened a confirmation sheet. An agent could never start a
  video. After a restart, a running generation waited for the user to press
  "Check status".
- The settings popover was 256 px wide: the ratio row overflowed, and the
  footer read "Text to V… 1… 72… 5.". Frame slots showed no image and their
  buttons drew missing-glyph boxes.
- About 29,000 lines of source (half of it a general "executable node"
  framework with this one user), 12,000 lines of tests, and 9,500 lines of
  specifications served one node. No test generated a video end to end.

Two canvas products for media work, and an open-source canvas, do the same
job with one panel under the node, the node's connections as its inputs, and
a model list the user fills.

## Goals

- Writing a prompt and generating is the first thing a new Video node offers,
  and the prompt is never lost.
- Every model of the catalog runs with the user's own credentials, with
  exactly the options it accepts and its estimated price shown before the
  run.
- The node's connections are its inputs, in their order. What the panel shows
  is what is sent.
- A generation keeps going when the panel closes, the window reloads, or
  BaseHalf restarts, and its video lands as an ordinary file in the workspace.
- An agent can make and run Video nodes from the files and the command line.
- One small implementation that the tests drive from a click to a video file.

## Non-goals

- Editing, trimming, joining, or upscaling video. Sequence keeps a clip order
  only.
- Several videos per generation. A node holds one video.
- Anything the [video providers](video-providers.md#non-goals) specification
  leaves out: user-written request scripts, a general relay format, and
  inputs a provider takes only as public URLs.
- Compatibility with `.bhnode` versions 4 and 5. The product has not
  launched; such a file is unreadable and shows as such.

## Terms

- **Video node**: a `.bhnode` file of kind `video`, drawn as a card.
- **Input**: an entry of the node's `upstream` list, that is, a connection
  into the node. Its kind is image, video, audio, text, or other.
- **Provider**, **model**, **mode**, and **parameter**: as the
  [model catalog](video-providers.md#terms) defines them. *Frames* (首尾帧)
  uses the first image as the start frame and the second as the end frame;
  *References* (多模态参考) uses images, videos, and audio as references;
  *Extend* and *Edit* take a video to continue or change.
- **Generation**: one request to a provider, from the click to the video file
  or to its end without one.
- **Task**: the record of the generation that runs, or of the last one that
  ended without a video, kept in the node's file.

## The node file

A `.bhnode` is version 6. Every kind keeps `version`, `id`, `kind`, `title`,
`upstream`, and an optional `result`. A Video node adds `prompt`,
`generation`, and `task`. Other kinds may not carry them.

```json
{
	"version": 6,
	"id": "7766b3bb-c97d-4126-80eb-cb3f4fa82bc8",
	"kind": "video",
	"title": "Shot 1",
	"prompt": "图片1里的人骑车经过海边，镜头缓慢跟随",
	"upstream": ["frames/start.png", "frames/end.png", "notes/scene.md"],
	"generation": {
		"provider": "bytedance",
		"model": "seedance-2.5",
		"mode": "frames",
		"params": { "resolution": "720p", "duration": 5, "generate_audio": true }
	},
	"task": {
		"id": "20261019T080000-k3f9",
		"state": "running",
		"startedAt": "2026-10-19T08:00:00.000Z",
		"remoteId": "cgt-20261019080001-abcd",
		"request": {
			"provider": "bytedance",
			"region": "cn",
			"model": "seedance-2.5",
			"providerModel": "doubao-seedance-2-5-260628",
			"mode": "frames",
			"params": { "resolution": "720p", "duration": 5, "generate_audio": true },
			"prompt": "图片1里的人骑车经过海边，镜头缓慢跟随",
			"inputs": ["frames/start.png", "frames/end.png", "notes/scene.md"]
		}
	}
}
```

The fields, their limits, and the task transitions are implemented once in
`basehalfVideoNode.ts`; the node document reader validates a Video node
through it.

- `prompt`: up to 64 KiB. What the next generation sends, editable in every
  phase.
- `generation`: what the next generation uses. `provider` and `model` are
  ids of the [model catalog](video-providers.md#the-catalog); without
  `model`, none is chosen. `mode` is one of the model's modes. `params` maps
  parameter names to strings, numbers, or booleans. The reader checks only
  these shapes: whether the provider, model, mode, and values exist is known
  from the catalog, which the panel and Generate consult.
- `task`: the generation that runs (`submitting`, then `running` once the
  provider returns its task id in `remoteId`), or the last one that ended
  without a video (`failed` with `error`, or `stopped`). `request` records
  what was sent: the provider and its region, the catalog model and the id
  sent to the provider, the mode, every parameter with its value, the prompt
  as sent, and the inputs. A new generation replaces an ended task.
- `result`: the file the node shows. `{"source": "imported", "artifact"}` for
  a file the user brought in, or `{"source": "generated", "artifact",
  "generation"}` for a generated video, where `generation` holds the task id,
  the provider's task id, the start and end times, and the `request`. An
  artifact is `{"kind", "path", "size"}`, with a workspace-relative path.
- A node never has both `task` and `result`. A node with a video never runs
  again: generating from it makes a new node (see
  [Generating again](#generating-again)).
- A generated video is written to `outputs/<node id>/<task id>.mp4` in the
  workspace folder of the node. The `outputs` folder at a workspace root is
  BaseHalf's output tree; references never point into it.
- Prompt and settings stay editable after a video exists. They are what the
  next generation uses; `result.generation.request` keeps what made the
  video.

### What an agent may write

An agent may create a Video node and write `title`, `prompt`, `upstream`, and
`generation`. It never writes `task` or `result`; BaseHalf owns them. The
skill that BaseHalf offers to agents describes this subset and the command
that runs a node ([Agents](#agents)).

## Inputs

The inputs of a Video node are its `upstream` entries in order: the order of
the list is the order of the inputs. The [reference graph](reference-graph.md)
owns how entries are added, removed, and renamed; a Video node accepts any
entry in every phase.

Each entry resolves to a kind:

- a file by its extension: images (`png`, `jpg`, `jpeg`, `webp`, `gif`,
  `svg`, `avif`, `bmp`), videos (`mp4`, `mov`, `m4v`, `webm`), audio (`mp3`,
  `wav`, `m4a`, `aac`, `ogg`, `flac`), text (`md`, `markdown`, `txt`);
- a `.bhnode` by the file it shows: an Image node with an image is an image,
  and so on; a node that shows nothing yet is unavailable;
- anything else, such as a folder or a PDF, is of kind other and is not used.

How a generation uses the inputs is computed once, in
`planBaseHalfVideoInputs`, from the slots that the selected mode declares
([Modes and inputs](video-providers.md#modes-and-inputs)), for the panel and
for the request alike:

- **Text inputs** join the prompt in both modes: the node's prompt, then the
  text of each text input in order, separated by a blank line. A Markdown
  note's front matter is left out, and each text input adds at most 16 KiB.
- **Frames mode** takes the first available image as the start frame and the
  second as the end frame, as far as the mode declares them. Later images,
  videos, and audio are not used.
- **References mode** takes images, videos, and audio in order, as many as
  the mode declares. Later ones are not used.
- **Extend** and **Edit** take the first available video as the clip, and Edit
  takes images as references as far as the mode declares them.
- **Names**: images, videos, and audio are numbered by kind in upstream
  order, used or not: 图片1, 图片2, 视频1, 音频1 in a Chinese display
  language, and Image 1, Video 1, Audio 1 otherwise. A prompt refers to an
  input by its name, as these models expect, and keeps meaning the same input
  while the list keeps its order.
- An input that is not used says why: it names nothing, its kind cannot be
  used, the mode does not use it, or it comes after what the model takes.
- The provider receives images as PNG, JPEG, or WebP. An image of another
  format is drawn to PNG first. The mode's limits (sizes, lengths, bytes) are
  checked before anything is written, and a file outside them is refused
  with its name and the limit.

## Providers

The providers, their models, and the credentials users enter for them are
specified in [video providers and the model catalog](video-providers.md).
The user sets them up in Settings, on the **Video Providers** page.

## Settings

The settings of a node are drawn from its model's
[parameters](video-providers.md#parameters), for the node's mode:

- **Mode** first, when the model offers more than one.
- Then every parameter that is not advanced, in the order the model declares
  them: a choice of up to five values as a row of buttons, of more as a list;
  a choice drawn as `ratio` as small ratio shapes; a whole or decimal number
  as a slider with its value, or as buttons when it has five or fewer steps;
  **Auto** next to a number that offers it; a switch for a boolean; a text
  field for text.
- **More** opens the advanced parameters, such as the seed and the negative
  prompt. An optional parameter left empty sends nothing.

The values are the node's `params`; a parameter without a value shows its
default, and that is what is sent. Choosing another model or mode keeps every
value the new model or mode accepts and gives the others their defaults,
without a message (`normalizeBaseHalfVideoParams`); the panel shows the
result, and that is what is sent. A new Video node starts with the provider,
model, mode, and values of the last generation on this computer, made legal
for that model.

## The panel

A Video node that is the only selected card shows one panel under it. It
appears when the card is selected, including right after the node is
created, and goes when the card is no longer selected. The workbench builds
it; the canvas scene places it ([Placement](#placement)).

From top to bottom:

1. **Input row**, when the mode or the node has inputs to show.
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
     the node's folder and connects it).
2. **Prompt**: a text field that grows to five lines and then scrolls. Typing
   `@` lists the inputs that have a name, with thumbnails; choosing one types
   its name. Names in the prompt are highlighted; a name that matches no
   input is underlined as a warning. The prompt is saved to the node's file
   half a second after typing stops, when the field loses focus, when the
   card is deselected, and before a generation starts. Nothing is written
   while an input method composes text. Saving never opens a dialog.
3. **Footer**: the model button, the settings button, the estimate, and the
   Generate button.
   - The model button shows the model's name. Its menu lists the catalog's
     models grouped by provider, in the catalog's order; a provider that is
     not set up says so next to its name, and its models can still be chosen.
     A model the provider's region does not offer is shown dimmed with the
     reason. Deprecated models are listed only for a node that uses one. The
     menu ends with **Video Providers…**.
   - The settings button sums up the settings: the mode, then the value of
     every parameter that is not advanced, such as "Frames · 720p · 5s ·
     Sound". Its popover is 300 px wide and holds the settings above; every
     change is saved at once.
   - The estimate shows the price of one generation from the provider's
     list price, as "≈ ¥7.56" or "¥3.00–¥9.00", in the region's currency. Its
     tooltip says that it is an estimate from the provider's published price
     of the given date and that the provider's bill counts. Without an
     estimate, nothing is shown.
   - The Generate button is a round arrow. While the node generates, it is a
     stop square that stops the generation.

The Generate button is enabled only when the node can generate. Otherwise its
tooltip and accessible name say the first reason, in this order
(`getBaseHalfVideoGenerateBlocker`): the node is generating; no model is
chosen; the catalog has no such model; the provider is not set up; the
provider's region does not offer the model; the first problem that the
provider module reports for the planned generation
([check](video-providers.md#requests)); there is nothing to send. For the
second to fifth, the model button is outlined and its tooltip says the
same.

Keyboard: `Cmd/Ctrl+Enter` in the prompt generates when the button is
enabled. `Escape` closes the innermost open menu or popover, and with none
open, returns focus to the card. Menus follow the arrow keys, Home, End, and
Enter.

### Placement

The panel is 512 px wide (narrower only on a canvas narrower than 536 px);
its height follows its content, from 132 px without an input row to 220 px
with one. It keeps that size at every zoom. It sits 10 px below the card,
centered; above the card, clear of its name and toolbar, when there is no room
below for the tallest panel; inside the canvas, clamped, when there is room
for neither. When the card is off the canvas, the panel is hidden. Opening the
panel never pans or zooms the canvas. Moving or resizing the card takes the
panel along on the side it was on. A menu or popover of the panel opens
upward when there is no room below, stays inside the canvas, and scrolls
inside itself; a menu of the footer that opens below opens below the panel.

## The card

What a Video card shows follows the node's phase (`baseHalfVideoNodePhase`):

| Phase | The card shows |
| --- | --- |
| empty | a video glyph |
| generating | the glyph, the phase in words (Waiting, Generating, Downloading), the time since it started, and a progress bar, exact when the provider reports progress |
| failed | the glyph and the error in at most two lines; the full text in the tooltip |
| stopped | the glyph and "Stopped" |
| video | the video, with controls when the card is selected |
| video file missing | the glyph and "The video file is missing", with its path in the tooltip |
| video that cannot be played | the glyph and "This video cannot be played here", with its path in the tooltip |

The card keeps its size when a video arrives; the video is fitted inside it.
The card changes in place when its node changes, as when the panel saves the
prompt or a generation records its task, and when it is selected or
deselected: its player stays, and a video that plays goes on playing while
the card stays selected. Deselecting the card pauses the video where it is.

Above a selected Video card, the toolbar shows **Upload Video** while the
node is empty and does not generate. Above a card with a video it shows
**Capture Frame**, with First Frame, Current Frame, and Last Frame, **Reveal
in Finder** (Explorer on Windows, the file manager elsewhere), and **Open**.

- Capturing a frame writes a PNG of that frame into the node's folder,
  named after the node and the frame (`Shot 1 first frame.png`, `Shot 1 last
  frame.png`, or `Shot 1 frame at 3.2s.png` for the current frame, with a
  number added when the name is taken). Its card appears to the right of the
  video card. It is an ordinary image that the user can connect to another
  node.
- **Open** shows the video large in Card Detail, with what made it: model,
  provider, mode, settings, prompt, the inputs in order, and when it started
  and finished. An imported video says that it was imported.

## A generation

### Starting

**Generate** (the button, `Cmd/Ctrl+Enter`, or an agent) runs these steps;
the ones before the task is written write nothing:

1. Save the panel's pending prompt and read the node's file.
2. If the node holds a video, make a new node beside it and continue there
   ([Generating again](#generating-again)).
3. Read the provider's region, endpoint, and credentials. Stop with the first
   blocker, as the panel shows it.
4. Plan the inputs, read the text inputs, and build the prompt. Prepare the
   used images, videos, and audio, and have the provider module check the
   planned generation with its files; stop with the first problem, or when an
   input is missing.
5. Write the task as `submitting`, with the request record.
6. Send the request through the AI Video extension. When the provider
   returns its task id, write it and the state `running`.
7. Ask the provider about the task every 5 seconds, the first time after 3
   seconds, and show the phase and progress on the card.
8. When the provider reports success, download the video to
   `outputs/<node id>/<task id>.mp4`: first to a file ending in `.part`,
   checked to be an MP4 of at most 512 MiB, then renamed. Write the result;
   the task leaves the node.
9. Remember the provider, model, mode, and values as the last used on this
   computer.

### Ending without a video

- **The provider refuses** (wrong key, refused content, too many requests):
  the task fails with the provider's message.
- **The outcome is unknown**: the request may have reached the provider, but
  no answer came back. The task fails with a message saying so and asking
  the user to check the provider's console before generating again, since a
  second request may be charged again. BaseHalf never sends a request again
  by itself.
- **The provider reports a failure** or a cancellation: the task fails with
  its message.
- **Asking fails**: a network error is retried at the next interval for up to
  30 minutes in a row; a refused key fails the task; a task the provider does
  not know fails the task.
- **Too long**: two hours after the start, the task fails with a message that
  says so.
- **Stop**: the user presses the stop square. BaseHalf stops asking, asks
  the provider to cancel where it can (best effort), and records the task as
  `stopped`. A video that arrives later is not kept.
- **The node changed**: when the node's task is no longer this generation (it
  was stopped in another window, or the file was replaced), a downloaded file
  is deleted and nothing is written.

The card shows the failure; the Generate button starts a new generation in
the same node. An error is plain text without secrets or markup, at most 4
KiB.

### Continuing after a reload or a restart

The window that started a generation follows it until it ends, also when the
panel closes and when the canvas shows another folder. When a window shows a
Video card whose task is active and that no generation in the window follows:

- a `running` task is followed again: BaseHalf asks the provider about its
  `remoteId` and continues from step 7;
- a `submitting` task that started more than two minutes ago fails with a
  message saying that BaseHalf closed while the request was on its way and
  asking the user to check the provider's console. It is never sent again.

Two windows of one workspace may both follow a task. The first that writes
the result wins; the other deletes its download.

### Generating again

Generating from a node that holds a video makes a new Video node in the same
folder, named like the original with the next free number, as the canvas
numbers the files it creates (`shot.bhnode` and `shot-2.bhnode` give
`shot-3.bhnode`, titled "Shot 3"), with the same prompt, settings, and
upstream entries, and runs the generation there. Its
card appears to the right of the original card, and it becomes the selected
card. The original node and its video do not change.

## Agents

- An agent writes a Video node as described in
  [What an agent may write](#what-an-agent-may-write).
- `basehalf --run-node <path>` starts a generation of the node, exactly as
  Generate does, and prints the path of the node that runs (a new node when
  the node held a video) once its task is recorded. It does not wait for the
  video. The node's file shows the progress and the result.
- The command runs from any folder of the workspace in an Agent Area
  terminal, also when the workspace was opened through a symbolic link: a
  shell reports its folder by its real path (on macOS, a folder under `/tmp`
  or `/var` is under `/private`), and BaseHalf finds the workspace folder by
  comparing real paths.
- No confirmation is asked: the user asked the agent to work, and the user's
  own key pays.
- `basehalf --list-capabilities` includes the model catalog: each provider
  with whether it is set up, and each model with its modes, input slots,
  limits, and parameters. An agent chooses `provider`, `model`, `mode`, and
  `params` from it.
- The skill that BaseHalf offers to agents describes the Video node fields,
  the input order and names, the catalog, and this command.

## Sequence, the starter template, copies, and deletion

- Sequence reads a Video node as before: a node with a video file that exists
  has the lifecycle `result` and an available video; a missing file is
  missing. Its document and commands do not change.
- The starter template makes folders, notes, empty Video nodes in version 6,
  and an empty Sequence. It makes no planning nodes.
- A copied Video node keeps its title, prompt, and settings; it has no
  upstream entries, task, or result.
- Deleting a Video node removes its file as today. Its videos stay in
  `outputs/` as the user's files.

## What is removed

- The `.bhnode` version 4 fields `role`, `recipe`, and `attempts`, the input
  bindings with their roles, and the Draft, Attempt, and sealed-Result
  lifecycle (D34).
- Recipes: the recipe contribution point, recipe executors, the three
  planning recipes (storyboard frame, clip brief, audio brief), the generate
  video recipe, and the node-local surface that edited recipe nodes.
- The reviewed model catalog and provider connection catalog, their
  contribution points, the connection validators, model service access for
  extensions, the paid-run authorization and request fingerprints, node run
  leases, and the node execution service.
- The Video Composer with its four popovers, canvas pick state machine,
  Needs review group, role conversion, first-mount pan, and confirmation
  sheet.
- The Models & Providers page, replaced by Video Providers.
- From D58, by D59: channels, presets, model ids typed by the user, model
  profiles in the window, the general profile, the OpenAI-compatible request
  format, and the Veo long-running prediction format of the Gemini API.

The other parts of the frozen plugin platform stay as they are
([built-in AI Video and the frozen plugin platform](built-in-ai-video-and-plugin-freeze.md)).

## Implementation boundaries

- `common/basehalfVideoNode.ts`: the video fields, their shapes, and the task
  transitions. Pure.
- `common/basehalfVideoCatalog.ts`: the types of the catalog as the window
  receives it, parameter normalization, input planning and names from mode
  declarations, prompt building, the summary of the settings, and the Generate
  blockers. Pure. It names no provider and no model.
- `common/basehalfVideoGeneration.ts`: the node store, provider settings, and
  generation service interfaces.
- `common/basehalfNodeDocument.ts`: the version 6 document, which embeds the
  video fields.
- The workbench implements the services, the panel, the card, the toolbar
  actions, and the Video Providers page, all drawn from the catalog.
- The built-in AI Video extension owns the catalog and the provider modules
  and answers the commands of [Requests](video-providers.md#requests). The
  workbench passes the credentials with each call; the extension keeps
  nothing.

## Acceptance criteria

The file

1. A Video node is written as version 6 with exactly the fields above; a
   version 4 or 5 file shows as unreadable; a Video node with `task` and `result`
   together, a non-video node with `prompt`, or an unknown field is refused
   with the field's path.
2. An agent-written Video node with `title`, `prompt`, `upstream`, and
   `generation` is shown and runs.

Inputs

3. With three images, a video, a text note, and a PDF connected in that order,
   frames mode on Seedance 2.5 uses the first image as the start frame and the
   second as the end frame, adds the note's text without front matter to the
   prompt, and dims the rest, each with its reason; references mode on a model
   that takes videos uses the three images and the video.
4. The swap arrow exchanges the two frames' entries in `upstream` and nothing
   else, in one undo step.
5. An SVG start frame reaches the provider as a PNG; an image larger than the
   mode allows is refused with its name and the limit before anything is
   written.

Providers

6. Video Providers lists the catalog's providers; a provider is set up with a
   region and its credentials, which are stored encrypted and are in no
   workspace file and not in the page's DOM.
7. The model menu lists the catalog's models by provider and marks a provider
   that is not set up and a model its region does not offer.

Panel and card

8. Creating a Video node selects it and shows the panel with the prompt
   focused.
9. Typing a prompt and clicking the canvas saves the prompt to the file, with
   no dialog, also when no model is chosen.
10. The panel never pans or zooms the canvas; it is below, above, or clamped
    as specified, and hidden when the card is off the canvas.
11. The settings popover is drawn from the model's parameters for the mode,
    advanced ones under More; choosing a model or mode that does not accept a
    value replaces it with the default; the settings button, the estimate,
    and the request show the same values.
12. The Generate button is disabled with the first blocker as its tooltip and
    accessible name, in the specified order.
13. Typing `@` lists the named inputs, and choosing one types its name; a
    name with no input is underlined.

A generation

14. Against a local test provider, Generate writes `submitting`, then
    `running` with the provider's task id, shows the phases on the card, and
    ends with the video in `outputs/<node id>/<task id>.mp4` and a `generated`
    result whose request matches the panel.
15. A refused key ends the task as failed with the provider's message; an
    unknown outcome ends it with the message about the provider's console and
    sends nothing again.
16. Stop ends the task as `stopped` and keeps no video that arrives later.
17. Generating from a node with a video makes a sibling node to its right with
    the same prompt, settings, and inputs, selects it, and runs there; the
    original is unchanged.
18. After a reload, a `running` task is followed again and completes; a
    `submitting` task older than two minutes fails with the restart message.
19. `basehalf --run-node` starts a generation without a question and prints
    the path of the node that runs.
20. Capturing the first, current, and last frame writes three PNGs whose cards
    appear beside the video.
21. Sequence adds a generated video and refuses a node without one.
22. The estimate shows the price that the provider module computes for the
    node's model, mode, values, and inputs, in the region's currency, and
    changes when they change.

## Verification

- Unit tests of the pure modules (`basehalfVideoNode.test.ts`,
  `basehalfVideoCatalog.test.ts`), of the document reader, of the services
  with a fake extension and a test catalog, and of the panel drawn from that
  catalog.
- The tests of each provider module ([video providers](video-providers.md#verification)).
- `npm run basehalf:smoke` with steps for criteria 6 to 17, 19, 20, and 22
  against the local test provider through the ByteDance module, with a test
  key; no paid provider is called.
- A real-window check of the panel, the settings of models of several
  providers, a generation against the local test provider, and a reload
  during a generation.
- A generation with a real provider is run by a person with their own key
  before a release that adds or changes a provider module.
