# BaseHalf AI Video

The first official BaseHalf domain plugin is a local, provider-neutral
production workflow canvas for creative briefs, scripts, storyboards,
execution prompts, and generation runs.

Use **BaseHalf: Create AI Video Project...** or open a `.aivideo` file. Saving,
Agent handoff, and running are explicit actions. The project JSON and generated
artifacts stay beside the user's files; disabling the plugin leaves them
readable and Git-manageable.

## Production workflow

`.aivideo` version 3 stores ordinary project data, visible node positions, and
directed workflow edges in one readable JSON file. Version 1 and version 2
projects migrate in memory and are upgraded on their next explicit save.

- **Brief** defines the objective, audience, format, frame, duration, and
  language.
- **Script** contains story beats, action, dialogue, and narration.
- **Character**, **Scene**, and **Visual direction** provide reusable continuity
  context.
- **Shot** is the executable production unit. It keeps storyboard intent,
  camera, motion, duration, first/last frame paths, dialogue, sound direction,
  and provider-neutral execution prompts together without conflating them.
- A dashed context edge passes creative input downstream. A solid Shot to Shot
  edge passes only prior-shot result and sequence continuity, so a previous
  scene cannot silently replace the current Shot's one scene binding.
- **Run pending** executes draft, failed, and interrupted Shot nodes in
  topological order.

The schema is published with the extension at
[`schemas/aivideo.schema.json`](schemas/aivideo.schema.json). It is also
registered as VS Code JSON validation for source-mode and Agent editing.

## Build with Agent

**Build with Agent** explicitly saves the current project, copies a complete
workflow-authoring brief to the clipboard, and opens a new session using the
user's configured BaseHalf Agent Area default. The brief tells the Agent to:

1. Read and modify the current `.aivideo` file directly.
2. Build the brief, script, reusable context, storyboard, and execution prompts.
3. Preserve stable ids, prior outputs, semantic edge kinds, and an acyclic graph.
4. Leave provider execution to an explicit user request.

BaseHalf does not insert a hidden model or retain the prompt. The user's Agent
subscription supplies the intelligence, while the ordinary project file is the
handoff contract. External file changes reload the canvas when there are no
conflicting unsaved UI edits.

## Local text previsualization

Until a video connector is configured, the built-in **Text previsualization
(local)** provider creates two files for every executed shot:

- `request.json` contains the resolved provider handoff and every reachable
  workflow input.
- `shot.md` describes the intended on-screen action, camera, motion,
  continuity, dialogue, sound, and execution prompt.

Every explicit run also refreshes `<project>.outputs/text-preview.md`, a single
ordered textual stand-in for the complete video. These files are honest local
production artifacts, not claims that media was generated.

The checked-in end-to-end example pairs the editable
[`last-bus-home.aivideo`](examples/last-bus-home.aivideo) workflow with its
generated [`text-preview.md`](examples/last-bus-home.outputs/text-preview.md),
so the full brief-to-shot result can be reviewed without a model credential.

## Connector API

A reviewed connector activates this extension, obtains its exported API, and
registers an `AIVideoGenerationProvider`, an
`AIVideoVoiceGenerationProvider`, or both. Providers receive the project,
selected shot, only the inputs reachable through the workflow graph, an output
directory, and a cancellation token. Voice providers also receive the local
video-provider outputs for the same Shot. They must write outputs inside the
assigned project folder and return their local URIs. Credentials belong in
secret storage or the provider's authenticated client, not in `.aivideo` files.

This API remains extension-export based and first-party. It can be promoted to
a stable connector API after real video and voice connectors validate the
shape.
