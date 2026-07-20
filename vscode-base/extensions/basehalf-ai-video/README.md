# BaseHalf AI Video

BaseHalf AI Video is the official thin video-domain capability pack for
BaseHalf's universal canvas. It contributes video-production recipes, one
starter template, a Sequence card projection, and bounded Sequence membership
cleanup. It does not introduce a second canvas, custom workflow editor,
document model, inspector, run history, or provider registry.

Run **BaseHalf: Create Video Workflow…** to instantiate the starter workflow in
the current project. The workflow contains ordinary Markdown and JSON files plus
host-owned `.bhnode` result containers for one storyboard frame, audio and clip
handoffs, and empty Audio and Video targets. The user edits the Markdown sources,
configures individual result nodes, or asks an Agent in Agent Area to expand the
script, add shots, bind inputs, and change parameters.

## Boundary

BaseHalf owns the product primitives shared by every domain:

- the canvas, cards, selection, geometry, and one directed reference edge;
- ordinary text and code files plus generic File, Image, Video, Audio, PDF, and
  Presentation result-node documents;
- recipe configuration, Current result, immutable run history, cancellation,
  and output directories;
- global model-service settings and protected credentials;
- Agent Area and ordinary file navigation.

This extension owns only video-domain meaning:

- the `storyboard-frame`, `audio-plan`, `clip-plan`, `audio`, and `clip` node roles;
- recipe-local input roles such as prompt, first frame, last frame, audio, and
  style reference;
- bounded parameters such as aspect ratio, duration, audio mode, and purpose;
- a starter brief-to-shot template;
- an ordered Sequence document that pins clip nodes to exact successful or imported versions;
- the Sequence card projection for inspecting and playing those exact pins;
- structural cleanup that removes an exact Sequence membership when its matching Video node is explicitly deleted;
- a Shot document that identifies the primary clip node inside one shot folder;
- executors for the recipes it declares.

A canvas edge always keeps the BaseHalf meaning “source context flows into
target.” An input binding records how the target recipe consumes that direct
source; it does not add a second kind of edge and it never starts execution by
itself.

## Contributed recipes

- **Storyboard Frame** creates a labelled SVG planning frame.
- **Clip Previsualization** creates a Markdown production handoff for one clip.
- **Audio Previsualization** creates a Markdown production handoff for planned
  dialogue, music, or sound.

These built-in executors are deliberately local and deterministic. They do not
call a model service and never present a text handoff as generated media. A real
image, video, or audio connector can later implement an additional reviewed
recipe while reusing the same host node and run lifecycle.

## Sequence

Each shot folder can carry a small `shot.json` that gives the shot a stable id,
title, and primary clip-node path. `video-sequence.json` is an ordinary, readable
project file:

```json
{
  "version": 1,
  "kind": "pointa.basehalf-ai-video.sequence",
  "items": [
    {
      "id": "shot-01",
      "title": "Opening",
      "nodeId": "clip-node-01",
      "videoNodePath": "shots/shot-01/clip.bhnode",
      "versionId": "run-or-revision-01"
    }
  ]
}
```

`clipNodePath` in a Shot document is relative to the directory containing that
`shot.json`. `videoNodePath` in a Sequence item is relative to the workflow root,
defined as the directory containing that `video-sequence.json`. Each Sequence item
stores the stable node identity as well as the readable path, and pins one
immutable generated run or imported revision. The item order is playback order.
Sequence does not trim, transition, mix, or render a final movie, and this
extension does not claim a dedicated timeline surface.

Open `video-sequence.json` in Card Detail to use the primary Sequence surface. It
shows one native player and the exact ordered pins below it. Clicking a clip
plays it, **Play all** advances when each clip ends, and row actions open the
source node, move the pin earlier or later, explicitly update or repair it, or
remove it from playback order. The projection follows saved Sequence and Video
node changes made by the user or an Agent. Project files and generated outputs
remain unchanged until an explicit action is run.

The matching Command Palette actions are the Agent, keyboard, and accessibility
fallback for the same lifecycle:

- **BaseHalf: Show Video Sequence Status…** verifies every path, stable node id,
  pinned version, lifecycle state, and primary local Video artifact.
- **BaseHalf: Add Current Video to Sequence…** chooses a saved Video node whose
  Current is a verified successful run or imported revision, then appends that
  exact version to playback order.
- **BaseHalf: Move Video Sequence Clip…** moves one item earlier or later without
  changing its pinned version.
- **BaseHalf: Update Video Sequence Clip to Current…** explicitly replaces one
  pin with that node's different, verified Current. A node changing Current never
  changes Sequence by itself.
- **BaseHalf: Remove Video Sequence Clip…** removes only the playback-order
  reference. It does not delete the Video node, its Current, history, or files.
- **BaseHalf: Repair Moved Video Sequence Clip…** changes only a missing saved
  path after a bounded scan finds one stable-identity match and freshly verifies
  the exact pin. Discovery never applies the repair automatically.

Extension-based Agents can call the same commands with structured arguments:

```ts
const sequence = vscode.Uri.file('/project/video/video-sequence.json');
await vscode.commands.executeCommand(
  'pointa.basehalf-ai-video.inspectSequence',
  { sequence },
);
await vscode.commands.executeCommand(
  'pointa.basehalf-ai-video.addSequenceItemFromCurrent',
  {
    sequence,
    videoNode: vscode.Uri.file('/project/video/shots/shot-01/clip.bhnode'),
    itemId: 'shot-01',
    title: 'Opening'
  },
);
await vscode.commands.executeCommand(
  'pointa.basehalf-ai-video.moveSequenceItem',
  { sequence, itemId: 'shot-01', direction: 'down' },
);
await vscode.commands.executeCommand(
  'pointa.basehalf-ai-video.updateSequenceItemToCurrent',
  { sequence, itemId: 'shot-01' },
);
await vscode.commands.executeCommand(
  'pointa.basehalf-ai-video.removeSequenceItem',
  { sequence, itemId: 'shot-01' },
);
await vscode.commands.executeCommand(
  'pointa.basehalf-ai-video.repairSequenceItemPath',
  { sequence, itemId: 'shot-01' },
);
```

Add and remove return the saved Sequence document, affected item, and its fresh
inspection. Inspect, update, and path repair return structured status data; move
returns the saved Sequence document. TUI Agents can also read and edit the ordinary JSON
directly, but must preserve the stable `nodeId`, portable `videoNodePath`, and
exact `versionId` contract.

## Local data and legacy files

Workflow inputs and outputs remain ordinary user-owned files inside the
project. The template contains no credentials, results, history, or user
assets. Disabling or uninstalling the extension leaves all project files and
generated artifacts in place.

The former `.aivideo` project format is no longer created, registered, parsed,
or migrated. Existing `.aivideo` files and their output folders are left
untouched and can still be opened as source files.

## Development

From `vscode-base/`:

```sh
npx tsc -p extensions/basehalf-ai-video/tsconfig.json
node --experimental-strip-types --test extensions/basehalf-ai-video/test/*.test.ts
```

The packaged extension includes `out/` and `templates/`; source, tests, local
research, and internal product notes are excluded from the VSIX.
