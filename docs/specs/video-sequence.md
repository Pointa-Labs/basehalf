# Video Sequence and the starter template

Status: Active (2026-10-24, moved from the AI Video extension for D75)
Decisions: [D45](../decisions.md#d45--ai-video-is-built-in-and-the-plugin-platform-is-frozen-new-2026-10-11),
[D63](../decisions.md#d63--a-generated-file-is-its-card-new-2026-10-22),
[D75](../decisions.md#d75--ai-video-is-basehalfs-own-code-not-an-extension-new-2026-10-24)
Related: [generation cards](generation-cards.md),
[providers and the model catalog](providers.md),
[built-in AI Video and the frozen plugin platform](built-in-ai-video-and-plugin-freeze.md),
[reference graph](reference-graph.md#templates)

Generation cards themselves (their files and generation information, drafts,
inputs, the panel, the card, a generation, the providers, and agents that
generate) are owned by [generation cards](generation-cards.md) (D58, D63,
D64). This specification owns what is added on top of them for a video
workflow: the Sequence document, its view and its operations, the Sequence
capability that agents read, and the starter template. Until D75 the AI
Video extension held them, and this text was its domain contract.

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
it. The `kind` keeps the name it had in the extension, so that files written
before D75 stay Sequences.

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
whether it has its file, and the `id` of its `made.yaml`, through the card
store ([generation cards](generation-cards.md#implementation-boundaries));
it reads nothing under `.bh/` itself.

## Sequence operations

The Sequence view in Card Detail and the Command Palette expose the same
explicit operations:

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
item by itself. A change to a Sequence file is a project file transition
that may not change any upstream value (D37).

The commands keep the ids they had in the extension
(`pointa.basehalf-ai-video.inspectSequence`, `addSequenceItemFromVideoResult`,
`moveSequenceItem`, `removeSequenceItem`, `repairSequenceItemPath`, and
`createWorkflow`), and so do the view (`pointa.basehalf-ai-video.sequence`)
and the capability for agents (`pointa.basehalf-ai-video.sequence-capability`):
agents, the skill, and saved Card Detail states name them.

## Starter template and local data

The starter template creates ordinary briefs and scripts as Markdown notes,
shot folders that each hold a note so that git keeps them, video drafts, an
empty Sequence, canvas cards, and the connections the template declares,
which the host stores in each target's `upstream` list. It contains no
credentials, task records, generated files, private state, executable
payloads, install hooks, or user assets. It is registered with the canvas
templates as `pointa.basehalf-ai-video.starter-workflow` and is part of the
application, as the canvas's own code is.

All project files and videos stay readable without BaseHalf. The retired
`.aivideo` format is not recreated or migrated, and neither is an earlier
`.bhnode` (D63).

## Failure

- A Sequence file that cannot be read, or that is not a Sequence, shows its
  error in the view and offers no operation that changes it.
- A change to a Sequence file that is refused, because the file changed on
  disk since it was read or because the change would touch an upstream
  value, is not written, and BaseHalf says why.
- An inspection that is cancelled starts no further checks.

## Acceptance criteria

1. A Sequence of video files parses, with the `id` of the `made.yaml` of a
   generated video; ambiguous, legacy, and unsafe documents are refused.
2. An item is available when its path is a video file and, with a
   `generationId`, that file's `made.yaml` has it; otherwise it is missing
   or changed.
3. Repair is offered only when exactly one video of the item's generation is
   found by the bounded scan, and it changes only the path.
4. Add, Move, Remove, and Repair change only the Sequence, never a video.
5. The view bounds what it shows to a fixed prefix, follows only the video
   files of the current clips, keeps the active clip across refreshes, and
   coalesces overlapping refreshes.
6. The starter template makes notes, a video draft, and an empty Sequence,
   and nothing that runs; every shot folder holds a note; the shot's notes
   are connected to its video draft.
7. The commands, the view, the capability for agents, and the template are
   there on the first start of a fresh profile, with no extension, and keep
   their ids.

## Verification

- Unit tests under `src/vs/workbench/basehalf/sequence/test/` for criteria 1
  to 6, moved from the extension's tests.
- The smoke steps `video-workflow-template` and
  `video-sequence-adds-generated-video` run the template, Add Video Result
  to Sequence, Show Video Sequence Status, and Repair Moved Video Sequence
  Clip in the real window (criterion 7).

## Where this lands

`src/vs/workbench/basehalf/sequence/`: the Sequence document in `common/`,
its commands, its view in Card Detail, its capability for agents, and the
starter template in `browser/`, registered with the card projection
registry, the canvas template registry, and the agent capability registry
directly, not through the frozen platform's contribution points.
