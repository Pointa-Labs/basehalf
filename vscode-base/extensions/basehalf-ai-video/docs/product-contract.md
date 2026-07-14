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
   node settings.

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
- Every generated Image, Video, or Audio node owns exactly one Run action on
  the node. There is no workflow-level Run action or duplicate inspector action.
- A node can run only after its required upstream media results exist. While it
  runs, its Run action becomes Cancel and unrelated editing is locked.
- Every run records its provider, model, prompt snapshot, input paths, time,
  status, and ordinary local output paths.
- Rerunning appends history and selects the new successful result. It never
  deletes or overwrites a prior run.
- Downstream nodes keep using the selected result until an explicit rerun or
  result selection changes it.
- Editing an upstream node marks affected executable nodes stale while keeping
  their prior results visible.
- Removing a node never deletes its output files.

## Node surface contract

The canvas keeps its full width at all times. Selecting a node must never open
a permanent inspector or add another vertical product column.

A node in its resting state answers four questions without interaction:

1. What media and production role is this?
2. What content or selected result does it currently hold?
3. What is missing or stale?
4. What is the next executable action?

Text nodes use three deliberately separate states. At rest, the label sits
outside the card and the body is a scrollable, Markdown-rendered reading
surface. A single click selects the node and opens a temporary AI instruction
composer below or above it; that composer generates or revises only the
selected node through one configured global Text model. A double click enters
direct editing inside the card and reveals a compact formatting toolbar. The
card exposes one connection port at the midpoint of every side on hover, and a
selected card can be resized; its dimensions are ordinary project data.

Every node owns north, east, south, and west ports. Any port can start or
receive a connection, and the chosen sides are stored with the edge so the path
survives reopening. Pulling a port onto empty canvas opens a type-aware menu:
the source node's media kind decides which downstream node kinds are valid.
The plugin implements this scene, path geometry, persistence, and validation in
its own package. It does not import the host canvas implementation or share the
host canvas state pipeline.

Generated-media nodes reveal only actions whose object is unambiguous: Edit,
Import, Runs, and (for an unordered Video result) Add to clips. Run remains in
the node footer because readiness and execution state belong to the producing
node, not to selection.

Edit and Runs open one temporary editor anchored to the selected node. It uses
the side with enough visible canvas space and never reserves a layout column.
The editor closes when the user clicks or moves the canvas, changes selection,
navigates to a clip, or presses Escape. Prompt resolution, provider/model
choices, generation parameters, and local paths are progressively disclosed
inside that editor; they are not permanent canvas chrome. Delete remains in the
node context menu so a destructive action is never a habitual primary control.

## Model-service boundary

The project stores provider/model choices but never credentials. BaseHalf's
main settings own text, image, video, and audio model services and expose
capabilities such as supported inputs, native audio, duration, resolution, and
aspect ratio. The Text-node composer consumes a reviewed global Text connection
and receives a short-lived credential snapshot only when the user explicitly
runs it. Media generation continues to consume the plugin's capability-shaped
provider registry until every media connection uses the common host service.

For Video nodes, audio mode is `auto`, `generate`, or `none`. `generate` is only
available when the selected provider reports native-audio support.

## UI admission rule

Every visible action must identify its object, consequence, result location,
and recovery path. Agent interaction lives in Agent Area, graph actions live on
the canvas, execution lives on the generated media node, and editing/history
live in a temporary node-anchored surface. Empty permanent side panels and
duplicate Agent, run, or save actions are not part of the product.
