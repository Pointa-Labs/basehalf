# BaseHalf AI Video

BaseHalf AI Video is the first official BaseHalf domain plugin. It gives the
user's existing Agent a local, readable workflow contract for arranging scripts,
prompts, references, image generation, individual video clips, audio, and clip
playback order.

Use **BaseHalf: Create AI Video Project...** or open a `.aivideo` file. The
project JSON and generated artifacts remain ordinary files beside the user's
project. Disabling the plugin leaves those files readable and Git-manageable.

## Product model

The canvas has exactly four media node kinds:

- **Text** — brief, script, storyboard, image prompt, video prompt, dialogue, or note.
- **Image** — generated image, imported reference, or frame.
- **Video** — one generated or imported clip.
- **Audio** — voice, music, sound effect, or reference.

Providers and models are node settings, not extra node kinds. A **Shot Group**
visually contains the nodes that collaborate to produce one clip. **Sequence**
orders the selected results of Video nodes for playback. It does not trim,
transition, mix, or combine them into an edited movie.

The `.aivideo` contract is version 4, and the plugin accepts that contract only.
The schema is shipped at
[`schemas/aivideo.schema.json`](schemas/aivideo.schema.json) and registered for
source-mode and Agent editing.

## Build with Agent

**Ask Agent** explicitly saves the current project, copies a schema-bound
workflow-authoring brief, and opens a BaseHalf Agent Area session. The Agent is
asked to modify that same local `.aivideo` file, arrange one Shot Group per
intended clip, fill storyboard and execution prompts, preserve run history, and
place final Video nodes into playback order.

BaseHalf does not insert a hidden model or store the Agent prompt. External
Agent edits reload the canvas when there are no conflicting local UI edits.

## Running and history

Executable Image, Video, and Audio nodes use connected upstream results and Text
content. A workflow run follows graph order, so an Image result can be produced
before the Video node that consumes it. Each run appends an immutable local
record containing the provider, model, prompt snapshot, input paths, time,
status, and output paths. Selecting an older result marks only downstream work
stale; it never deletes prior results.

The built-in **Local previsualization** provider keeps the entire path usable
without model credentials:

- Image nodes create a clearly labelled local storyboard placeholder and the
  provider request.
- Video and Audio nodes create readable text handoffs and the provider request.
- A run refreshes `sequence-preview.md`, which describes clip order without
  claiming that a final movie was rendered.

The checked-in example pairs
[`last-bus-home.aivideo`](examples/last-bus-home.aivideo) with its generated
[`sequence-preview.md`](examples/last-bus-home.outputs/sequence-preview.md).

## Model-service API

This extension currently exposes a reviewed, extension-exported
`AIMediaGenerationProvider` registry. A provider declares its supported Image,
Video, and Audio kinds plus capabilities such as native video audio. It receives
only the current node, graph-reachable inputs, an assigned output directory, and
a cancellation token. Returned files must remain inside that directory.

Credentials never belong in `.aivideo`. The shared BaseHalf model-service
settings will own authentication; this plugin only stores the selected provider
and model ids. The registry remains first-party until real model connectors
validate a stable host-level API.
