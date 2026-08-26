# AI Video domain contract

AI Video is a thin capability pack on BaseHalf's universal canvas. It contributes
video-domain recipes, a starter template, a Sequence card projection, and
bounded structural cleanup. The host defines the interaction and execution
model once; the extension adds only reusable video-production meaning.

## User outcome

The user describes a video in Agent Area. Their Agent creates or revises
ordinary project files and asks the host to create and run result nodes. The
canvas immediately shows each new node and owns its waiting, running, failed,
cancelled, or completed presentation. Agent Area does not need to remain open
for the node to finish.

Every generated or imported media result has its own file and node. Once a node
reaches `result`, its artifact is sealed. Generating again or remixing creates a
new node and leaves the old result playable and unchanged.

The output of this capability pack is a set of independently usable shot
materials and an explicit clip order. Editing and final movie assembly are out
of scope.

## One host model

BaseHalf owns:

- ordinary text and code files plus generic File, Image, Video, Audio, PDF, and
  Presentation nodes;
- card rendering, direct editing, ports, dragging, selection, and geometry;
- the directed reference graph;
- recipe configuration and input binding storage;
- waiting, running, result, failure, cancellation, and restart recovery;
- ordinary local artifact storage;
- model-service discovery, settings, credentials, and paid-run authorization;
- Agent Area.

The extension must not recreate those concerns in a Webview, private database,
or domain document. In particular, it has no separate canvas scene, custom
workflow editor, permanent inspector, workflow-level Run action, lifecycle
store, credential field, or media provider registry. Its Sequence projection is
a focused view of one ordinary JSON file, not another workflow surface.

## Domain roles

Content kind and domain role are different axes. The host content kind decides
how a node is rendered; the extension role explains what that node contributes
to video production.

The first roles are:

- `storyboard-frame` on an Image node;
- `audio-plan` on a File node whose artifact is a Markdown handoff;
- `clip-plan` on a File node whose artifact is a Markdown handoff;
- `audio` on an Audio node;
- `clip` on a Video node.

Editable text is always an ordinary Markdown file and uses the host's existing
rich/source/preview projections. Briefs, scripts, shot plans, prompts, dialogue,
and continuity notes therefore never acquire a second JSON-backed editing
model. Deterministic planning recipes produce ordinary Markdown or SVG
artifacts and must never present those handoffs as generated media.

## One edge, target-owned input roles

The BaseHalf reference graph remains the only edge system. `A → B` means A's
context flows into B. The extension may assign a recipe-local role to that
direct input, such as `prompt`, `reference`, `first-frame`, `last-frame`,
`source-video`, `audio`, or `style`.

An edge is created only when the source is a real input to the target. Copying
prompt text or generation settings into a new node does not by itself create a
reference edge. The input role belongs to the target recipe binding; it is not
stored on the edge and does not create a second graph.

## Recipes and execution

Recipes remain declarative extension contributions. They declare ids, labels,
accepted direct-input roles, bounded parameters, primary result kind, and an
executor. The host validates bindings and parameters before execution and owns
all durable lifecycle transitions.

The node's host-owned `prompt` is the single authored generation intent. It is
not duplicated in recipe parameters, and the host freezes it into each Attempt
before supplying it to the executor.

Starting a recipe creates a new result-node file and canvas card before provider
submission. The node owns the resulting lifecycle independently of the Agent
session that initiated it. A successful Video node exposes exactly one sealed
Video artifact. A failure or cancellation remains inspectable on that new node
and never changes an earlier result.

The initial local planning recipes are:

- `storyboard-frame`, which emits an SVG Image artifact;
- `clip-brief`, which emits a Markdown File artifact;
- `audio-brief`, which emits a Markdown File artifact.

These executors are deterministic previews. They do not call a model service
and must say so plainly. The `generate-video` recipe is different: it resolves
one exact host-frozen model/service selection against the bundled reviewed
catalog, submits one paid asynchronous provider task, and seals the downloaded
MP4 as the Video Result. Empty Video and Audio targets in the starter template
remain planning placeholders until the user explicitly configures a recipe.

## Reviewed video model transport

`models/video-models.json` is the single capability source used by both the
host settings UI and the executor boundary. Its keys include provider,
deployment, region, official model id, and revision. The initial reviewed
providers are BytePlus ModelArk Seedance, MiniMax Hailuo, and Alibaba Cloud Wan
2.6. Every model and mode links to the official provider documentation and
records the date on which its matrix was checked.

The `generate-video` recipe explicitly owns catalog contribution
`pointa.basehalf-ai-video.official-models`. The host resolves UI choices only
from that catalog and freezes its id into the Attempt snapshot; the executor
requires the same id before it reads credentials or submits a paid task. A model
contributed by another extension cannot silently route into this adapter.

The currently executable transport paths are text-to-video, first-frame-to-video,
and first/last-frame-to-video where the provider exposes them. Frame inputs are
read from the host's immutable Attempt snapshot, bounded below 20 MB each, checked
as PNG/JPEG/WebP, and encoded only for the provider request. Seedance reference,
edit, and extension modes, Wan reference-to-video, and Wan custom-audio options
remain visible as documented capability but are marked unavailable. They cannot
be selected as runnable paths until a reviewed local media-upload transport is
implemented. Accordingly, the executable recipe currently contributes no audio
input slot and the runnable Wan mode definitions accept no audio binding.
Seedance 1.5 Draft is not a catalog parameter because the provider implements it
as a separate `draft_task` followed by final generation; this executor supports
neither half of that two-stage workflow and never submits either field.

Paid task creation is never retried after an ambiguous submit or transport
failure. Once a provider accepts a task, the executor awaits durable host
acknowledgement of its remote id before the first poll. An explicit exact Retry
first checks that frozen task and resumes it when it is pending or complete. Only
when that read proves the old task failed or was cancelled may the Retry submit
one replacement task; the replacement id must be durably acknowledged before it
is polled. A transient polling failure leaves that durable task untouched: it
does not cancel the task or submit a replacement. Only idempotent task reads and
MiniMax file lookup use bounded automatic retries. Polling has a finite window
and unknown statuses fail closed.
Downloads use HTTPS, never receive provider credentials, are capped at 256 MiB,
and must contain an MP4 `ftyp` signature before any project artifact is written.

Cancellation aborts local polling/download immediately. The executor also makes
a bounded best-effort remote cancellation call for queued BytePlus and Wan
tasks. BytePlus cannot cancel a task after it starts running, Wan cancellation
is limited to pending tasks, and MiniMax documents no video-task cancellation
endpoint. In all three cases a cancelled or failed Attempt accepts no late or
partial artifact; any file written before a final cancellation check is removed.

## Video node interaction

The detailed desktop implementation contract is
[`video-node-development-spec.md`](video-node-development-spec.md). It defines
the complete model-selection, connection, settings, input, execution, recovery,
and verification flow. The exact lower-Composer geometry, generic
child-popover placement, and show/dismiss behavior are defined by
[`video-node-composer-surface-spec.md`](video-node-composer-surface-spec.md).
The Models trigger, picker dimensions, row layout, overflow, and activation
behavior are defined by
[`video-node-model-picker-spec.md`](video-node-model-picker-spec.md). This
document remains authoritative for lifecycle and host/plugin ownership.

Generation methods are capabilities of the selected exact model. Start frame
and end frame are target-owned input roles required by specific methods, not
global Video-node settings. Changing a model or method never silently relabels
an existing input binding.

A Video node has three distinct surfaces with non-overlapping responsibilities:

- the card owns identity, playback, lifecycle status, and progress;
- the node-adjacent Composer owns the prompt and primary generation action;
  model, parameter, input, and Attempt controls open as one anchored child
  popover at a time without replacing or resizing the Composer. The compact
  Composer is canonically centered beneath the card; initial selection may pan
  within the bounded surface rule to preserve that relationship, while later
  explicit geometry or viewport changes use below/above/clamped placement;
- a contextual toolbar above a selected verified Video Result owns operations on
  that sealed video or its node.

The first Result toolbar exposes only complete host operations, in stable visual
order: **Copy Settings to New Draft**, **Show Details**, **More Actions**, and
**Open Full Preview**. Drafts, active Attempts, and unverifiable Results do not
expose this Result-only toolbar. Unsupported editing ideas such as trim, enhancement,
extension, frame extraction, pinning, or asset-library storage must not appear
as inert controls; they require a reviewed capability and an end-to-end
operation that produces a new node rather than overwriting the sealed Result.

The toolbar and Composer use fixed screen-space sizing while the canvas zooms.
Opening model, parameter, input, or Attempt controls must preserve the selected
card, canvas viewport, Composer bounds, and prompt DOM. Child popovers may cover
part of the video temporarily; they scroll or clamp internally and never turn
the Composer into a second inspector page or pan the canvas to make room. Only
the first Composer mount may perform the bounded pan needed to keep the compact
card/Composer pair visible.

Moving or resizing the selected card closes its child popover while the main
Composer remains visible, inert, fixed-size, and attached without unmounting
its prompt. After the canvas commits the new card geometry, the same Composer
resolves below, above, or clamped from the live card bounds without panning the
canvas. Pan and zoom keep Composer dimensions fixed and update only its anchor
position. A fully off-screen card has no floating Composer; the mounted surface
may reappear only when the same selected card returns.

## Sequence document

`video-sequence.json` is an ordinary user-owned JSON file:

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

Each item stores only:

- a Sequence-local stable `id`;
- a human-readable `title`;
- the stable Video Result `nodeId`;
- a portable `videoNodePath` relative to the Sequence file.

Sequence does not store run ids, revision ids, mutable selection state, output
paths, provider jobs, or credentials. The node identity is the result identity.
Because every Video Result node is sealed, a Sequence item cannot drift to a
later generation inside the same node.

Inspection accepts an item only when:

1. the path resolves to a saved node with the stored stable identity;
2. the node kind is `video`;
3. `node.lifecycle === 'result'`;
4. `node.result.artifact` is a Video artifact whose integrity is `available`.

The clean host inspection shape consumed by this plugin is:

```ts
interface CanvasNodeState {
  id: string;
  kind: CanvasNodeKind;
  lifecycle: 'draft' | 'running' | 'result' | 'failed' | 'cancelled' | 'interrupted';
  result?: {
    source: 'imported' | 'attempt';
    attemptId?: string;
    artifact: CanvasNodeResultArtifact;
  };
  attempts: readonly CanvasNodeAttempt[];
}
```

Sequence reads only `id`, `kind`, `lifecycle`, and `result.artifact`; attempt
history is not part of its document or playback identity.

## Sequence operations

The projection and Command Palette expose the same explicit operations:

- **Show Video Sequence Status** validates saved references without mutation.
- **Add Video Result to Sequence** appends one verified sealed result.
- **Move Video Sequence Clip** changes playback order by one position.
- **Remove Video Sequence Clip** removes only the Sequence reference.
- **Repair Moved Video Sequence Clip** updates only a missing path after a
  bounded identity scan finds exactly one verified result.

There is no in-node replacement operation. To use a newly generated or remixed
clip, add its new Video Result node and remove the old Sequence item if desired.

Deletion cleanup is equally narrow. Explicitly deleting a Video Result node
removes Sequence items whose `nodeId` and rooted `videoNodePath` both match. It
does not delete artifacts or rewrite unrelated items. If a Sequence file cannot
be parsed and verified, deletion fails closed rather than leaving a known stale
reference.

## Starter template and local data

The starter template may create ordinary briefs, scripts, shot metadata, an
empty Sequence, configured planning nodes, empty media placeholders, canvas
cards, and explicit input references. It must not contain credentials,
generated results, provider jobs, output paths, private extension state,
executable payloads, install hooks, or user assets.

Plugin removal leaves all ordinary project files and artifacts readable. The
retired `.aivideo` format remains a clean break and is not recreated or
migrated by this extension.
