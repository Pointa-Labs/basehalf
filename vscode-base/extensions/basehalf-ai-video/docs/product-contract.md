# AI Video product contract

AI Video is a local production canvas assembled primarily through the user's
existing Agent. The Agent creates and fills a workflow; the user inspects,
adjusts, and reruns parts of it. The plugin is the durable container and
deterministic runner, not the creative intelligence.

## User journey

1. The user describes the animation or video in Agent Area.
2. The Agent writes a complete `.aivideo` workflow using the available blocks.
3. The canvas reloads the local file and shows the arranged production graph.
4. The user edits prompts, references, models, and sequence order directly or
   asks the Agent to revise them.
5. Explicit import actions copy outside assets into an ordinary local
   `<project>.assets/` folder; Text imports also fill the selected Text node.
6. Running a media node creates a new immutable local run. Prior results remain
   available in that node's history.
7. Video nodes selected in Sequence define playback order. Sequence preview
   plays those separate results one after another. It never trims,
   transitions, mixes, or combines clips into a final edited movie.
8. Opening a multi-shot project focuses the first Shot Group at a readable
   scale. Selecting an item in Sequence navigates to that shot without opening
   node settings; **Show all** is the intentional production-overview action.

## Four media blocks

The node library exposes exactly four user-facing media categories:

- **Text** holds intent, scripts, storyboard beats, prompts, dialogue, or notes.
- **Image** imports or generates visual references and frames.
- **Video** imports or generates individual clips.
- **Audio** imports or generates voice, music, or sound effects.

Roles refine what a node does without multiplying the top-level node library.
Providers and models are settings of executable media nodes, never node types.

## Structure is not media

- A **Shot Group** visually contains the text, image, video, and audio blocks
  that collaborate to produce one clip.
- **Sequence** is an ordered list of Video node outputs. It is basic temporal
  arrangement, not a timeline editor.

Neither structure becomes a fifth media category.

Sequence doubles as shot navigation because a large production cannot keep
dozens of complete clip pipelines legible at one global zoom level. The canvas
still contains the complete arranged workflow; it simply defaults to the unit
the user can act on.

## Node and run contract

- Results appear inside the node that produced them.
- Every run records its provider, model, prompt snapshot, input paths, time,
  status, and ordinary local output paths.
- Rerunning appends history and selects the new successful result. It never
  deletes or overwrites a prior run.
- Downstream nodes keep using the selected result until an explicit rerun or
  result selection changes it.
- Editing an upstream node marks affected executable nodes stale while keeping
  their prior results visible.
- Removing a node never deletes its output files.

## Model-service boundary

The project stores provider/model choices but never credentials. BaseHalf's
main settings will own image, video, and audio model services and expose
capabilities such as supported inputs, native audio, duration, resolution, and
aspect ratio. Until that common service exists, the plugin consumes the same
capability-shaped provider registry locally.

For Video nodes, audio mode is `auto`, `generate`, or `none`. `generate` is only
available when the selected provider reports native-audio support.

## UI admission rule

Every visible action must identify its object, consequence, result location,
and recovery path. Project actions live in the header, graph actions on the
canvas, node editing in the selection inspector, and run history inside the
producing node. Empty permanent side panels and duplicate run/save actions are
not part of the product.
