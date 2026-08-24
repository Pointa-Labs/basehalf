# BaseHalf AI Video

BaseHalf AI Video is the official thin video-domain capability pack for
BaseHalf's universal canvas. It contributes video-production recipes, one
starter template, a Sequence card projection, and bounded Sequence membership
cleanup. It does not introduce a second canvas, custom workflow editor,
document model, inspector, execution system, or provider registry.

Run **BaseHalf: Create Video Workflow…** to instantiate the starter workflow in
the current project. The workflow contains ordinary Markdown and JSON files plus
host-owned `.bhnode` containers for storyboard, audio, and video work. The user
edits the sources, runs individual steps, or asks an Agent in Agent Area to
expand the script, add shots, bind inputs, and change parameters.

## Boundary

BaseHalf owns the product primitives shared by every domain:

- the canvas, cards, selection, geometry, and directed reference graph;
- ordinary text and code files plus generic File, Image, Video, Audio, PDF, and
  Presentation nodes;
- waiting, running, failed, cancelled, and sealed-result lifecycle state;
- local artifact storage, global model-service settings, and protected
  credentials;
- Agent Area and ordinary file navigation.

This extension owns only video-domain meaning:

- the `storyboard-frame`, `audio-plan`, `clip-plan`, `audio`, and `clip` roles;
- recipe-local input roles such as prompt, first frame, last frame, audio, and
  style reference;
- the host-owned node prompt as the single authored generation intent, kept
  separate from recipe-specific parameters;
- bounded parameters such as aspect ratio, duration, audio mode, and purpose;
- a starter brief-to-shot template;
- an ordered Sequence document that references sealed Video Result nodes;
- the Sequence projection for inspecting and playing those results;
- structural cleanup that removes Sequence membership when its matching Video
  Result node is explicitly deleted;
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
- **Generate Video** uses the host-selected reviewed Seedance, Hailuo, or Wan
  capability, follows the provider's asynchronous task protocol, downloads one
  verified MP4, and seals it as a local Video Result.

The three planning executors are deliberately local and deterministic. They do
not call a model service and never present a text handoff as generated media.
`Generate Video` is the provider-backed executor and uses the same host-owned
Draft → immutable Attempt → sealed Result lifecycle.

## Official video capabilities

The extension ships one reviewed JSON catalog for BytePlus Seedance 2.0 Mini
and 1.5 Pro, MiniMax Hailuo-02, and Alibaba Cloud Wan 2.6 in its documented
International and US deployment scopes. The model settings UI and request
adapter are both bound to the owned
`pointa.basehalf-ai-video.official-models` catalog and resolve the same exact
provider/deployment/region/model/revision entry. A third-party catalog therefore
cannot become a runnable choice for this executor. Switching models also switches
to that model's real resolution, duration, ratio, audio, and input matrix.

Text-to-video and supported frame-to-video modes run end to end. Modes that
require a local reference-video, source-video, or audio upload are explicitly
unavailable until that upload transport exists; the extension does not expose a
control that only pretends it can run. Seedance 1.5 Draft is also omitted: its
official `draft_task` flow is a separate two-stage operation, so this one-step
executor never serializes `draft` or `draft_task`.

Provider task ids are durably acknowledged as soon as submission succeeds and
before polling begins. An exact Retry carrying an existing task id skips the paid
submission and first resumes polling/download for that same task. If the provider
confirms that task is failed or cancelled, the Retry may submit exactly one
replacement and durably replace the Attempt's remote id before polling it. A
transient poll failure never cancels or replaces a durable task. This is
especially important for MiniMax, which documents no video cancellation
endpoint. Polling and downloads are bounded, credentials are never sent to
output CDNs, and only a complete verified MP4 is returned to BaseHalf.
Cancellation aborts local work and attempts the provider's documented queued-task
cancellation where one exists; MiniMax currently documents no video cancellation
endpoint.

All three reviewed provider protocols require a Bearer API key. Although the
host connection form is intentionally provider-neutral, this executor rejects
credential-free and custom-header variants before transport. Provider endpoints
must also be public HTTPS URLs without embedded credentials.

## Sequence

Each shot folder can carry a small `shot.json` with a stable id, title, and
primary clip-node path. `video-sequence.json` is an ordinary, readable project
file:

```json
{
  "version": 1,
  "kind": "pointa.basehalf-ai-video.sequence",
  "items": [
    {
      "id": "shot-01",
      "title": "Opening",
      "nodeId": "clip-node-01",
      "videoNodePath": "shots/shot-01/clip.bhnode"
    }
  ]
}
```

`clipNodePath` in a Shot document is relative to the directory containing that
`shot.json`. `videoNodePath` in a Sequence item is relative to the directory
containing `video-sequence.json`. Each item stores a readable path and stable
node identity. The referenced file must be a sealed Video Result node with
exactly one available Video artifact. The item order is playback order.

A Video Result is one file and one node. Generating or remixing another result
creates another node; it never changes the Sequence item above. To replace a
clip in playback order, remove the old item and add the new Video Result.

Open `video-sequence.json` in Card Detail to inspect and play its saved order.
Clicking a clip plays it, **Play all** advances when each clip ends, and row
actions open the result node, move it earlier or later, repair a moved path, or
remove it from playback order. Sequence does not trim, transition, mix, or
render a final movie.

The matching Command Palette actions are the Agent, keyboard, and accessibility
fallback for the same operations:

- **BaseHalf: Show Video Sequence Status…** verifies every path, stable node id,
  sealed result state, and unique local Video artifact.
- **BaseHalf: Add Video Result to Sequence…** appends one sealed Video Result to
  playback order.
- **BaseHalf: Move Video Sequence Clip…** moves one item earlier or later.
- **BaseHalf: Remove Video Sequence Clip…** removes only the playback-order
  reference and preserves the Video Result node and artifact.
- **BaseHalf: Repair Moved Video Sequence Clip…** changes only a missing saved
  path after a bounded scan finds one stable-identity match and freshly verifies
  its result state and artifact.

Extension-based Agents can call the same commands with structured arguments:

```ts
const sequence = vscode.Uri.file('/project/video/video-sequence.json');
await vscode.commands.executeCommand(
  'pointa.basehalf-ai-video.inspectSequence',
  { sequence },
);
await vscode.commands.executeCommand(
  'pointa.basehalf-ai-video.addSequenceItemFromVideoResult',
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
  'pointa.basehalf-ai-video.removeSequenceItem',
  { sequence, itemId: 'shot-01' },
);
await vscode.commands.executeCommand(
  'pointa.basehalf-ai-video.repairSequenceItemPath',
  { sequence, itemId: 'shot-01' },
);
```

Add and remove return the saved Sequence document, affected item, and fresh
inspection. Inspect and path repair return structured status data; move returns
the saved Sequence document. TUI Agents may also edit the ordinary JSON
directly, but must preserve each stable `nodeId` and portable `videoNodePath`.

## Local data and legacy files

Workflow inputs and outputs remain ordinary user-owned files inside the
project. The template contains no credentials, generated results, output paths,
or user assets. Disabling or uninstalling the extension leaves all project files
and generated artifacts in place.

The former `.aivideo` project format is no longer created, registered, parsed,
or migrated. Existing `.aivideo` files and their output folders are left
untouched and can still be opened as source files.

## Development

From `vscode-base/`:

```sh
npx tsc -p extensions/basehalf-ai-video/tsconfig.json
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test extensions/basehalf-ai-video/test/*.test.ts
```

The packaged extension includes `out/`, `models/`, and `templates/`; source,
tests, local research, and internal product notes are excluded from the VSIX.
