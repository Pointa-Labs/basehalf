# AI Video domain contract

AI Video is a thin capability pack on BaseHalf's universal canvas. It contributes
video-domain recipes, a starter template, a Sequence card projection, and
bounded structural cleanup for exact Sequence membership. The host defines the
interaction model once; the extension adds only reusable video-production
meaning. It has no second canvas or custom workflow editor, so users never have
to learn a second canvas or run system when they move between domains.

## User outcome

The user describes a video in Agent Area. Their Agent creates or revises
ordinary project files and host-owned nodes. The user sees the resulting
workflow on the main canvas, adjusts individual nodes, and explicitly runs the
parts they want. Each selected result remains stable until the user runs again
or chooses another successful result.

The output of this capability pack is a set of independently usable shot
materials and an explicit clip order. Editing and final movie assembly are out
of scope.

## One host model

BaseHalf owns:

- ordinary text and code files plus generic File, Image, Video, Audio, PDF, and
  Presentation result nodes;
- card rendering, direct editing, ports, dragging, selection, and geometry;
- the directed reference graph;
- recipe configuration and input binding storage;
- readiness, Run, Cancel, Current, immutable history, and stale-state behavior;
- ordinary local artifact storage;
- model-service discovery, settings, and credentials;
- Agent Area.

The extension must not recreate those concerns in a Webview, private database,
or domain document. In particular, it has no separate canvas scene, custom
workflow editor, permanent inspector, workflow-level Run action, history store,
credential field, or media provider registry. Its Sequence projection is a
focused view of one ordinary JSON file, not another workflow surface.

## Domain roles

Content kind and domain role are different axes. The host content kind decides
how a node is rendered; the extension role explains what that node contributes
to video production.

The first roles are:

- `storyboard-frame` on an Image node;
- `audio-plan` on a File result node whose Current is a Markdown handoff;
- `clip-plan` on a File result node whose Current is a Markdown handoff;
- `audio` on an Audio node;
- `clip` on a Video node;

Editable text is always an ordinary Markdown file and uses the host's existing
rich/source/preview projections. Briefs, scripts, shot plans, prompts, dialogue,
and continuity notes therefore never acquire a second JSON-backed editing
model. Deterministic planning recipes return immutable Markdown handoffs from a
File result node; opening that artifact uses the ordinary Markdown experience.

## One edge, target-owned consumption

Every visible edge keeps one meaning: the source's context flows into the
target. It does not mean “run next,” and creating an edge never executes either
node.

When the target has a recipe, its input binding assigns each direct incoming
source to a target-owned role. The first video roles are:

- `prompt` for written instructions;
- `reference` for general media references;
- `first-frame` and `last-frame` for boundary images;
- `source-video` for transformation or continuation input;
- `audio` for sound attached to a clip;
- `style` for visual direction.

The binding is recipe configuration, not an edge label. It may affect
readiness, available parameters, and the executor request, but it never changes
the graph's visible semantics. Executors receive only direct bound inputs; they
do not recursively traverse the canvas.

## Recipe contract

This extension uses only the File, Image, Video, and Audio subset of the host's
six result kinds. It declares three deterministic recipes:

1. `storyboard-frame` accepts text and image context and returns one SVG
   planning frame.
2. `clip-brief` accepts text, image, video, file, and audio context and returns
   one Markdown clip handoff as a File artifact.
3. `audio-brief` accepts text, audio, and video context and returns one Markdown
   audio handoff as a File artifact.

Each recipe validates its own input roles and bounded parameters. Its executor
may write only inside the host-selected run directory and returns ordinary
artifact URIs. The host validates those artifacts, records the run, and decides
which successful result becomes Current.

The local executors are an honest no-key path: an SVG is labelled as a planning
asset, while clip and audio planning recipes produce File results that
explicitly state no media model was called. Empty Video and Audio targets remain
non-executable until a reviewed media recipe is assigned. The extension must
never create placeholder files with real media extensions or imply a successful
remote generation.

## Run and result integrity

A node can use only a recipe whose single primary output matches the node's
content kind. Every direct incoming reference must have one visible target-owned
input binding before Run becomes available. Removing an input removes that
reference instead of leaving a connected source that execution silently ignores.

Run is an explicit node action. The host first flushes the node document, freezes
the selected recipe, parameters, direct input bindings, and exact input versions,
then gives the executor only those frozen resources. It never runs upstream nodes
or resolves recursive ancestors. Failure and cancellation preserve the previous
Current result.

History records both successful runs and immutable imported revisions, while
their artifacts stay ordinary user-owned local files. Importing or replacing
content appends a revision instead of overwriting the prior selection. Before
previewing, reusing, or selecting any historical result, the host verifies its
recorded size and digest. A file changed outside BaseHalf is shown as changed; a
deleted file is shown as missing. Neither state is silently treated as the
original result. When the recipe remains ready, the node's primary recovery
action is Run again.

## Sequence

A Shot is an ordinary folder plus a small `shot.json` containing a stable id,
title, and primary Video node path relative to the directory containing that
`shot.json`. Its storyboard, references, nodes, and artifacts remain ordinary
files in that folder; the Shot document does not
duplicate their content or graph relationships.

Sequence is an ordinary JSON file with paths relative to its workflow root,
defined as the directory containing `video-sequence.json`, and an ordered list of:

- a stable item id;
- a user-facing title;
- the stable Video node id;
- a workflow-root-relative Video node path;
- the exact successful run or imported revision id to play.

Pinning a version keeps an arranged sequence stable when a clip node later
produces or imports another result. Sequence is not a second graph, an execution
dependency, or a timeline editor. The starter template creates an empty
sequence and never fabricates version ids or results.

Before presenting a Sequence item as available, the extension asks the host to
verify that the saved path resolves to a Video result node, its stable id still
matches, the pinned version is successful or imported, and its primary local
artifact still matches the recorded integrity data. A different verified
Current is reported as an available explicit update; it never changes the pin
automatically. Inspection uses one bounded pass and returns the verified pinned
artifact used by the projection; rendering must not perform a second per-item
node inspection or substitute a newer Current artifact.

The Command Palette exposes six Sequence operations: inspect status; append a
saved Video node's verified Current; move one clip earlier or later; explicitly
update one pin to that node's verified Current; and remove one playback-order
reference without deleting its node, history, or files; the sixth explicitly
repairs a moved node path. If a saved path is
missing, inspection performs a bounded identity-only scan and offers a repair
only when exactly one node still has the same stable id and the pinned result is
freshly verified. Repair is always an explicit action and never changes the
version pin. Add rechecks the Video
Current immediately before the atomic document edit and pins that exact
successful run or imported revision. Remove changes only Sequence. The commands
accept structured arguments and return structured results for extension-based
Agents. TUI Agents may edit the ordinary JSON with their existing file tools.
Neither path creates a second canvas, a timeline surface, or an automatic update
path.

Agent-invoked Sequence commands observe the host cancellation token immediately
before their atomic compare-and-save transition. A cancelled request can finish
read-only inspection work, but it cannot commit a late playback-order edit.

Structural deletion removes a Sequence membership only when both the stable
Video node id and the exact path relative to that Sequence root match the node
being deleted. A stale moved-node path remains visibly invalid until the user
repairs or removes it; cleanup never guesses from a copied identity across
workflows. Workspace discovery is bounded to 256 Sequence files and may cache
only their URIs behind file-event invalidation. Every cleanup still reloads the
candidate document and submits an exact compare-and-swap transition.

## Template admission

The starter template may contain only:

- ordinary UTF-8 text files;
- host-owned `.bhnode` declarations;
- card geometry;
- explicit directed references;
- recipe ids, bounded parameters, and direct input bindings.

It must not contain credentials, Current results, runs, history, output paths,
private extension state, binary executable payloads, install hooks, or user
assets. A template may include ordinary user-readable source files, but
instantiation only writes those files and never executes them. Every input
binding must have a matching direct reference in the template.

## Agent and local ownership

Agent interaction remains in Agent Area. The extension contributes no chat
button and no hidden intelligence. An Agent uses the same ordinary files and
node contracts as the user, so changes remain inspectable, reversible, and
compatible with external tools.

Explicit recipe runs may create ordinary local artifacts. Uninstalling the
extension never deletes those artifacts or any source file. The retired
`.aivideo` format has no registration or migration path; old files stay on disk
and fall back to source viewing.
