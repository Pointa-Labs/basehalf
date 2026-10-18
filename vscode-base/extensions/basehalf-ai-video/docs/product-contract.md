# AI Video domain contract

AI Video is built into BaseHalf (D45). The Video node itself (its file, its
inputs, the panel, the card, a generation, the video providers, and agent
runs) is owned by the host specification [video node](../../../../docs/specs/video-node.md)
(D58). This document owns what AI Video adds on top of it: the provider
commands, the Sequence document and its view, and the starter template.

## User outcome

The user describes a video in Agent Area, or writes it in a Video node's
panel. Their Agent creates or revises ordinary project files and Video nodes
and runs them; the canvas shows each node's progress and its video. Agent
Area does not need to stay open for a node to finish.

Every generated or imported video has its own file and node. A node with a
video never runs again: generating from it makes a new node and leaves the
old video playable and unchanged.

The output of this capability is a set of independently usable shot
materials and an explicit clip order. Editing and final movie assembly are out
of scope.

## Providers and the model catalog

AI Video holds one module per video provider and the catalog built from
them; the host's [video providers and the model catalog](../../../../docs/specs/video-providers.md)
specification (D59) owns the contract. The commands
`basehalf.video.provider.catalog`, `check`, `submit`, `poll`, `download`,
and `cancel` answer `{ok: true, value}` or `{ok: false, error: {code,
message}}` and keep no state, credentials, or files between calls. HTTP runs
in the extension host because providers do not answer cross-origin requests
from the window.

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
- the stable Video node `nodeId`;
- a portable `videoNodePath` relative to the Sequence file.

Sequence does not store task ids, output paths, provider data, or
credentials. The node identity is the clip identity: a node's video never
changes, so a Sequence item cannot drift to another video.

Inspection accepts an item only when:

1. the path resolves to a saved node with the stored stable identity;
2. the node kind is `video`;
3. the node holds a video (`lifecycle` is `result`);
4. the video file exists (`integrity` is `available`).

Sequence reads only `id`, `kind`, `lifecycle`, and `result.artifact` from the
host's inspection of a node.

## Sequence operations

The projection and Command Palette expose the same explicit operations:

- **Show Video Sequence Status** validates saved references without mutation.
- **Add Video Result to Sequence** appends one node that holds a video.
- **Move Video Sequence Clip** changes playback order by one position.
- **Remove Video Sequence Clip** removes only the Sequence reference.
- **Repair Moved Video Sequence Clip** updates only a missing path after a
  bounded identity scan finds exactly one node that holds a video.

There is no replacement operation. To use a newly generated clip, add its
node and remove the old Sequence item if desired.

Deletion cleanup is equally narrow. Explicitly deleting a Video node removes
Sequence items whose `nodeId` and rooted `videoNodePath` both match. It does
not delete videos or rewrite unrelated items. If a Sequence file cannot be
parsed and verified, deletion fails closed rather than leaving a known stale
reference.

## Starter template and local data

The starter template creates ordinary briefs and scripts as Markdown notes,
shot folders, empty Video nodes (`.bhnode` version 6), an empty Sequence,
canvas cards, and the connections the template declares, which the host
stores in each target's `upstream` list. It contains no credentials, tasks,
results, outputs, private extension state, executable payloads, install
hooks, or user assets.

All project files and videos stay readable without AI Video. The retired
`.aivideo` format is not recreated or migrated.
