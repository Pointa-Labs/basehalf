# AI Video domain contract

AI Video is built into BaseHalf (D45). Generation cards themselves (their
files and generation information, drafts, inputs, the panel, the card, a
generation, the providers, and agents that generate) are owned by the host
specification [generation cards](../../../../docs/specs/generation-cards.md)
(D58, D63, D64). This document owns what AI Video adds on top of them: the
provider commands, the Sequence document and its view, and the starter
template.

## User outcome

The user describes a video in Agent Area, or writes its prompt in the panel
of a video card. Their Agent creates or revises ordinary project files and
video drafts and generates them; the canvas shows each card's progress and
its video. Agent Area does not need to stay open for a generation to finish.

Every generated or imported video is its own file, and that file is its
card. A card with its video never generates again: generating from it makes
a new card and leaves the old video playable and unchanged.

The output of this capability is a set of independently usable shot
materials and an explicit clip order. Editing and final movie assembly are out
of scope.

## Providers and the model catalog

AI Video holds one module per provider and the catalog built from them; the
host's [providers and the model catalog](../../../../docs/specs/providers.md)
specification (D59, D64) owns the contract. The commands
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
      "videoPath": "shots/shot-01/clip.mp4",
      "generationId": "20261019T080000-k3f9"
    }
  ]
}
```

Each item stores only:

- a Sequence-local stable `id`;
- a human-readable `title`;
- a portable `videoPath`, relative to the Sequence file, that names a video
  file;
- for a video that BaseHalf generated, `generationId`, the `id` of its
  `made.yaml`.

Sequence does not store task ids, provider data, or credentials. A generated
video never changes, and the `id` of its `made.yaml` is the clip's identity:
an item whose path holds another video shows as changed instead of playing
it.

Inspection accepts an item only when:

1. its path names a video file that exists;
2. when the item has a `generationId`, that file's `made.yaml` has that `id`.

Otherwise the item shows as missing or changed: missing when its path names
no video file, changed when the video there has no `made.yaml` with the
item's `generationId`. For an item of either kind that has a
`generationId`, inspection looks for the moved video: a bounded scan of the
videos below the folder of the Sequence file, at most 256, for the one whose
`made.yaml` has that `id`. When it finds exactly one, it offers **Repair
Moved Video Sequence Clip**. A file must be a regular file inside the open
workspace folder, not a symbolic link. Sequence reads only a card's kind,
whether it has its file, and the `id` of its `made.yaml` from the host's
`inspectGenerationCard`; it reads nothing under `.bh/`.

## Sequence operations

The projection and Command Palette expose the same explicit operations:

- **Show Video Sequence Status** validates saved references without mutation.
- **Add Video Result to Sequence** appends one video card with its file, and
  the `id` of its `made.yaml` when it has one.
- **Move Video Sequence Clip** changes playback order by one position.
- **Remove Video Sequence Clip** removes only the Sequence reference.
- **Repair Moved Video Sequence Clip** updates only the path of an item after
  a bounded scan finds exactly one video whose `made.yaml` has the item's
  `generationId`.

There is no replacement operation. To use a newly generated clip, add its
video and remove the old Sequence item if desired.

Deleting a video changes no Sequence: its item shows as missing until it is
repaired or removed. Sequence never deletes a video and never rewrites an
item by itself.

## Starter template and local data

The starter template creates ordinary briefs and scripts as Markdown notes,
shot folders that each hold a note so that git keeps them, video drafts, an
empty Sequence, canvas cards, and the connections the template declares,
which the host stores in each target's `upstream` list. It contains no
credentials, task records, generated files, private extension state,
executable payloads, install hooks, or user assets.

All project files and videos stay readable without AI Video. The retired
`.aivideo` format is not recreated or migrated, and neither is an earlier
`.bhnode` (D63).
