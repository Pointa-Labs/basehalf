# Editing media

Status: Draft (2026-10-26)
Decision: [D84](../decisions.md#d84--a-video-an-image-or-a-sound-is-edited-in-card-detail-and-its-original-is-kept-new-2026-10-26),
which revises [D79](../decisions.md#d79--card-detail-trims-a-video-in-place-and-undo-puts-it-back-new-2026-10-25)
Related: [exact undo](exact-undo.md) (the steps of an edit and their undo),
[generation cards](generation-cards.md) ("The player", "The file", and
"`made.yaml`"), [opening and closing Card Detail](card-detail-opening.md),
[layout controls](layout-controls.md#card-detail) (the header of Card Detail),
[workspace state](workspace-state-and-legacy-cleanup.md#what-basehalf-persists)
(what `.bh/` holds), [architecture invariants](../harness/architecture-invariants.md#product-shell)

This specification owns the edit mode of Card Detail for a video, an image,
and a sound: the original that BaseHalf keeps for an edited file and the
record of the edit, what Done, Save as New, Revert, and Cancel do, the
editor of each kind, what the edited file holds, and its format. The player
of a video or a sound is the player of every card
([generation cards, "The player"](generation-cards.md#the-player)); this
specification only adds what an editor asks of it. Keeping the versions that
a step takes away, and the undo and redo of a step, belong to
[exact undo](exact-undo.md).

## Problem

Measured on 2026-10-26 in a development window, on the media of the
development workspace and in a phone's photo editor and voice recorder:

- **A trimmed video lost its original.** Trim (D79) replaced the video, and
  its old version was kept for undo until the window closed; then it went to
  the Trash. Opening the trimmed video again showed only the trimmed part: a
  start cut too early could not be widened again, and nothing brought the
  whole video back.
- **A phone's photo editor keeps the original of every edit.** Its video,
  trimmed and saved, stays one item; Edit on it shows the whole original with
  the handles where the trim left them, the trim can be widened again, and
  Revert to Original brings back the whole video at any time. Done offers to
  save the trim as a new clip instead, which leaves the video as it was. Its
  crop tool crops a photo or a video freely or to a ratio (Original,
  Freeform, Square, 16:9, 5:4, 7:5, 4:3, 5:3, 3:2, each tall or wide), turns
  it by a quarter, flips it, and straightens it with a dial; its voice
  recorder trims a recording between two handles or deletes the part between
  them, and saves the change or saves it as a new recording.
- **Images and sounds had no edit at all.** A generated image comes in the
  shape the model gives, as a square of 2048 × 2048 when the scene needs 16:9,
  and a generated song runs on after the part a video needs; another program
  had to cut them, and the file came back as a new file.
- What D79 measured of videos still holds: a generated video has one key
  frame, a cut that copies compressed frames cannot start where a clip needs
  it to, and encoding again with the window's encoders is fast and close to
  lossless (46.4 dB PSNR on a 480p clip at its own bitrate, 53.2 dB on a WebM
  recording).

## Goals

- **One edit mode for a video, an image, and a sound**: **Edit**, the tools
  of its kind, and **Done**.
- **The file in its folder is the edited file.** It keeps its name, its
  folder, its card, and its connections; Files, agents, and providers see the
  edit.
- **The original is kept**, with the file's card information, through
  renames, moves, copies, git, and the Trash, until the user reverts.
- **An edit starts from the original.** Edit on an edited file shows the whole
  original with the choices of the edit before: a trim can be widened again, a
  crop moved, a deleted part of a sound brought back. Each edit is encoded once
  from the original, never from an earlier edit.
- **Revert** puts the original back at any time. **Save as New** saves the edit
  as a new file beside the file and leaves the file as it was.
- **Done, Save as New, and Revert are each one step of the canvas undo**,
  and undo puts back exactly what the step changed.
- **An edited file looks and sounds like its original did**: the same
  picture and frame times, the same sample rate, no lower a bitrate, and no
  click where a cut joins sound.

## Non-goals

- Adjusting light and color, filters, markup, and taking things out of a
  picture. The editors trim, crop, turn, flip, straighten, mute, and cut
  sound: the edits that a phone's editors offer first.
- Correcting perspective (the vertical and horizontal adjustments of a
  phone's crop tool), and finding the crop or the horizon automatically.
- Cropping or turning a video, changing its speed, and joining files.
- Recording over a part of a sound.
- Editing on the canvas, and editing several files at once.
- Editing GIF, AVIF, BMP, and SVG images, and videos and sounds of other
  formats: the window cannot write them as they are, so Edit is not offered
  for them, and its hover says why.
- Keeping versions besides the original and the edit: the next edit takes the
  place of the one before; undo goes back step by step.
- Showing the lengths or sizes that each model accepts.
- A command for agents. An edited file is a file like any other; agents read
  the edit record as card information.

## Terms

- **Media file**: a video (`.mp4`, `.mov`, `.m4v`, `.webm`), an image (`.png`,
  `.jpg`, `.jpeg`, `.webp`), or a sound (`.mp3`, `.wav`, `.flac`, `.m4a`,
  `.ogg`) that Card Detail shows; its **kind** is video, image, or sound.
- **Original**: the file as it was before its first edit, byte for byte.
- **Edit record**: what BaseHalf keeps of an edit, beside the original
  ([The edit record](#the-edit-record)).
- **Edited file**: a media file that has an edit record and its original.
- **Edit mode**: the state of Card Detail in which a media file's editor is
  shown, from Edit to Done, Save as New, Revert, or Cancel.
- **The choices of an edit**: what the editor sets: a part to keep, parts to
  delete, a crop, a turn, a flip, an angle, mute.

## The edit model

### What is kept

- An edited file at `<path>` has, in its card information under
  `.bh/mirror/<path>/`:
  - `original.<extension>`: the original, with the file's own extension;
  - `edit.yaml`: the edit record.
- Like all card information, both follow the file through renames and moves,
  in BaseHalf or outside it
  ([following moved items](following-moved-items.md)), are shared through
  git ([workspace state](workspace-state-and-legacy-cleanup.md#what-basehalf-persists)),
  and are never shown in Files. An original is as large as the file was, and
  git keeps it as it keeps the file: a workspace that keeps videos with git's
  large file storage keeps their originals there too, since their names end
  the same way.
- A file that was never edited has neither.

### The edit record

`.bh/mirror/<path>/edit.yaml` says how the file was made from its original:

```yaml
original: "original.mp4"
result:
  size: 2043044
  hash: "317c14aac5ae54da0c0a573d4ea660fe56d321d729bafc46d817f551e9cf73bf"
keep:
  - start: 1.033
    end: 4.567
mute: true
```

```yaml
original: "original.png"
result:
  size: 1835812
  hash: "…"
turn: 1
flip: true
straighten: -2.5
crop:
  x: 1024
  y: 600
  width: 1600
  height: 900
```

- `original`: the name of the original in the same folder.
- `result`: the fingerprint of the edited file as BaseHalf wrote it, as
  following moved items takes one: its `size`, and the SHA-256 `hash` of it
  whole up to 16 MiB, or of its first, middle, and last mebibyte when it is
  larger ([following moved items](following-moved-items.md)). It tells
  whether the file is still the result of the edit.
- A video and a sound: `keep` lists the parts of the original that the file
  holds, in order, each a `start` and an `end` in seconds of the original, to
  the millisecond. A video keeps one part; a sound keeps one or more. `mute`
  is in the record of a video that was saved without its sound.
- An image: `turn` is how many quarter turns to the left the original was
  turned (0 to 3), `flip` whether it was then mirrored left to right, and
  `straighten` the angle in degrees, from −45 to 45, that it was then turned
  by, clockwise when positive. `crop` is the part kept: its center (`x`, `y`)
  and its size, in pixels of the original as it was turned and flipped; the
  part is turned by `straighten` about its center. A field at its default
  value (no turn, no flip, no angle, the whole picture) is left out.
- The record is read and written as all mirror files are
  ([mirror file resilience](mirror-file-resilience.md)). A record that cannot
  be read is left as it is, byte for byte, and the file is treated as not
  edited: Edit starts from the file, and Revert is not offered. Done then
  writes a new record in its place, in its step, whose undo puts the one
  that could not be read back.

### Done, Save as New, Revert, and Cancel

- **Done** writes the edit of the original into the file, and the record
  beside it. The first edit keeps the file as it was as the original; an edit
  of an edited file leaves the original as it is and replaces the record.
  Choices that leave the original as it was, as the whole video kept or the
  whole picture unturned, are no edit: Done then reverts an edited file, and
  leaves a file that was not edited as it is.
- **Save as New** writes the edit of the original into a new file in the same
  folder, named as Duplicate names a copy (`shot copy.mp4`), and leaves the
  file, its original, and its record as they are. The new file has no original
  and no record of its own: it is an ordinary file, made from the file. Its
  card appears 40 to the right of the file's card, at the nearest open place,
  and is connected from it, as a frame captured from a video is
  ([canvas card placement](canvas-card-placement.md#pointing)).
- **Revert** puts the original back in the file's place and removes the
  original and the record from the card information. It asks nothing: undo
  takes it back.
- **Cancel** leaves edit mode and forgets the choices made since Edit. It asks
  nothing.
- Each of Done, Save as New, and Revert is one step of the canvas undo
  ([exact undo, "Changing files in place"](exact-undo.md#changing-files-in-place)):
  "Edit <name>", "Save <new name>", "Revert <name>". Undo puts back what the
  step changed, byte for byte, and redo does it again.

### A file that changed outside BaseHalf

- When the file is no longer the result of its record, because an agent, a
  program, or git changed it, its fingerprint tells. The record and the
  original are then of another file: Edit starts from the file as it is, and
  Revert is not offered. Done keeps the file as it is now as the new original,
  in the same step that writes the edit; the original before goes with that
  step's kept versions.
- An original that is missing, or that cannot be read, is treated the same
  way.

### Copies, deletes, and the Trash

- A copy of an edited file, by Duplicate, a paste, or a copy in Files, gets a
  copy of the record and of the original, so that it can be reverted and
  edited from its original as the file can. On a disk that can clone files,
  as macOS's, the copy of the original takes no room until one of them
  changes.
- A delete takes the record and the original with the file's card
  information, and undo brings them back
  ([exact undo, "Deleting"](exact-undo.md#deleting)). When what a window kept
  goes to the Trash, the record and the original stay in `.bh/mirror/` with
  the rest of the card information that a delete to the Trash keeps, so that
  a file put back from the Trash can still be reverted.

### Generation cards

- An edit changes a generated file, never what made it: `made.yaml` stays as
  it was written when the file landed, and New Version makes a draft from it
  as before ([generation cards, "`made.yaml`"](generation-cards.md#madeyaml)).
- The panel of a generated card and Card Detail's section of what made it say
  that the file was edited, and how: "Edited: Trimmed to 1.0s–4.5s.",
  "Edited: Turned · Cropped to 1600 × 900.", "Edited: Trimmed to 3 parts ·
  Without sound." ([generation cards](generation-cards.md#the-panel-of-a-card-with-its-file)),
  while the file has the size the edit gave it.
- The record's `id` in `made.yaml` stays, so a Sequence that names a video
  still finds it after an edit ([Video Sequence](video-sequence.md)).

## Edit mode in Card Detail

### Entering and leaving

- The header of Card Detail of a media file has **Edit** in its right group,
  before Close ([layout controls](layout-controls.md#card-detail)). For a
  file that cannot be edited, Edit is disabled, and its hover says why: "BaseHalf
  can't edit GIF images", "BaseHalf can't edit this video: <reason>".
- Edit shows the file's editor in place of its view, with the original of an
  edited file and the choices of its edit; the header then has, instead of
  Edit, **Revert** (only for an edited file whose original can be read),
  **Cancel**, and **Done**, with its menu, which holds Done and **Save as New
  Video** (Image, Sound). Close stays.
- A workspace folder that BaseHalf leaves alone keeps no card information
  ([spec-driven development](spec-driven-development.md)): there Edit is
  disabled, and says that no original can be kept.
- Done, Save as New, Revert, and Cancel leave edit mode, and Card Detail
  shows the file anew. Closing Card Detail, or showing another file in it,
  cancels the edit.
- Done is disabled while the choices are those of the file as it is, as at
  first, and its hover says "Make an edit first". Save as New is disabled
  while the choices keep the whole original.
- While an edit is saved, the editor stays, its controls are disabled, and
  its status line says what is being done and how much of it.

### The keyboard

- **Edit** takes the keyboard in its place in the header, before Close. In
  edit mode, the keyboard goes to the editor's first control; when edit mode
  ends, the keyboard that was in Card Detail goes to Edit.
- **Escape** cancels the edit, as Cancel does, and does not close Card
  Detail; the next Escape does
  ([opening and closing Card Detail](card-detail-opening.md#the-keyboard)).
  During a drag in an editor it only ends the drag and puts back what the
  drag changed.
- **Enter** on a control of an editor saves, as Done does when it is enabled.
- **Command+Z** (Control+Z on Windows and Linux) in edit mode undoes the
  editor's last change, and **Shift+Command+Z** redoes it: a handle moved,
  a part trimmed or deleted, a turn, a flip, a ratio, an angle. They do not
  reach the canvas undo while the editor is shown. Out of edit mode, they undo
  and redo the steps of the canvas, Done, Save as New, and Revert among them
  ([exact undo](exact-undo.md#undo-while-card-detail-is-open)).
- When Card Detail shows a file anew because the file changed, as after Done,
  an undo, or a redo, the keyboard stays on the control it was on.
- A control shows a focus ring only when the keyboard moved the focus there,
  as in the player
  ([architecture invariants](../harness/architecture-invariants.md#product-shell)).

## Editing a video

### The frame viewer

- Under the player, 12 px below it and as wide as it (at least 280 px where
  the space allows), the **frame viewer**: a strip 48 px high of the
  original's frames across its whole length, as many pictures as fit at its
  height in the picture's shape, each the frame at the middle of its place.
  The player and the viewer are centered together in the space the player
  had. The viewer keeps the height of its status line also while it is empty.
- **The part kept** has a yellow frame around it, 3 px above and below, with
  a handle 14 px wide on each side that carries a dark chevron; the strip
  outside it is dimmed. While the whole video is kept, the frame is white.
- **The playhead** is a white line at the time the player shows, and follows
  it while it plays.
- **The length of the part** is in its middle, or above the viewer over its
  middle when the part is narrower than the label, in tenths of a second under
  a minute and in minutes and seconds from a minute on, never more than it is,
  as the player shows times (`3.5s` for 3.57 s).
- **The sound** button, at the left of the viewer, mutes the video: the
  player plays it without sound, and Done saves it without its sound. It shows
  a crossed speaker while the video is muted. A video without sound has none.

### The pointer

- **A drag of a handle** moves that end of the part, to the nearest frame
  edge. It pauses the player, and while it moves, the player shows the frame
  at the handle: the first frame of the part at the start handle, the last at
  the end handle.
- **A handle held still for 0.4 s** spreads the viewer out around it: the
  viewer then shows a tenth of the video, or 2 s, whichever is longer, around
  the handle's time, with its frames read anew, so that the handle moves a
  frame at a time across a wider stretch of the screen; releasing it shows the
  whole video again.
- **The part is at least 1.0 s long**, or the whole video when it is
  shorter. A handle moved closer than that to the other one pushes the other
  along, until it reaches the start or the end of the video, where both stop.
  Where the two handles meet, a press takes the one on whose side of the
  meeting point it is.
- **A drag inside the part, while it is shorter than the video**, moves the
  part with its length, to the nearest frame edges. It pauses the player, and
  while it moves, the player shows the frame at the part's start.
- **A press anywhere else on the viewer**, or a press inside the part that
  does not move, moves the playhead there; a drag from there moves it along.
- The pointer is a sideways arrow over a handle, a grab hand over a part that
  can move, and the arrow everywhere else. A press on the viewer never reaches
  the player or the canvas under Card Detail.

### Playing

- While the part is shorter than the video, the player plays the part: Play
  starts at the part's start when the playhead is outside the part or on its
  last frame, plays to its end, and goes on from its start again, until it is
  paused. No frame after the part is shown: the player looks at every frame it
  shows. Before each jump back, the sound goes down over the last 100 ms of
  the part, and it comes up after the jump
  ([generation cards, "The player"](generation-cards.md#the-player)).
- While the whole video is kept, the player plays as it does out of edit mode.

### The keyboard of the frame viewer

- The viewer's controls take the keyboard after the player's: the sound
  button, the start handle, then the end handle. Each handle is a slider that
  says its time and the video's length.
- **On a handle**: Left and Right move it by 0.1 s, with Shift by one frame,
  with Command (Control on Windows and Linux) by 1 s; Home and End move it as
  far as it goes; Up and Down do what Right and Left do. Every step moves the
  handle at least one frame, and pushes the other handle as a drag does; the
  player shows the frame at the handle.
- **I** and **O**, with the keyboard in the player or the viewer, put the
  start at the start of the frame the player shows, and the end at the end of
  that frame.
- **Space** on a handle plays and pauses. The arrow keys move no card.

## Cropping an image

### The crop view

- Edit on an image shows the original, turned, flipped, and straightened as
  the choices say, as large as fits in Card Detail with a margin of 24 px, with
  the **crop frame** over it: a white frame around the part kept, with thick
  corners and a handle in the middle of each side, and the picture outside it
  dimmed. While a corner, a side, or the picture is dragged, lines divide the
  part into thirds.
- Under the picture, a row of tools, from left to right: **Turn Left**,
  **Flip**, **Ratio**, and the **Straighten** dial, and **Reset** at the right
  end.

### The crop frame

- **A drag of a corner or of a side** moves it, keeping the ratio when one is
  set, and never past the picture: the part kept is always all picture, with
  no empty corner, also while the picture is straightened.
- **A drag inside the frame** moves the picture under the frame, as far as
  its edges go.
- **The wheel, or a pinch of the trackpad, over the picture** shows the part
  larger or smaller: the frame keeps its place on screen while the part it
  holds of the picture gets smaller or larger, around the pointer, until it is
  the whole picture or 64 pixels on its shorter side.
- When a drag ends, the frame and the picture glide in 200 ms until the frame
  is as large as fits, at the middle of the view.
- **The size of the part** stands under the frame while it is dragged, in
  pixels of the original (`1600 × 900`).

### The tools

- **Turn Left** turns the picture and the frame a quarter to the left.
- **Flip** mirrors the picture and the frame left to right.
- **Ratio** opens a menu: Freeform, Original, Square, 16:9, 5:4, 7:5, 4:3,
  5:3, and 3:2, with Tall and Wide at its top for the ratios that have both;
  the menu says which is set. A ratio makes the frame the largest part of that
  ratio around its center that the picture holds. At first the ratio is
  Freeform, and Original for an edit that had kept the original's ratio.
- **The Straighten dial** turns the picture under the frame by up to 45° each
  way, in steps of 0.1°, with a mark at every degree and the angle above it
  (`−2.5°`). The frame keeps its ratio and grows smaller as far as it must to
  hold only picture. A double click on the dial sets it back to 0°.
- **Reset** sets the turn, the flip, the angle, the ratio, and the frame back
  to those of the original. It is disabled while they are.

### The keyboard of the crop view

- The tools take the keyboard after the crop frame: the frame's corners in
  turn from the top left, then the tools. On a corner, the arrow keys move it
  by 1 pixel of the screen, with Shift by 10; inside the frame, with the frame
  focused, the arrow keys move the picture. On the dial, Left and Right turn
  by 0.1°, with Shift by 1°.

## Editing a sound

### The waveform

- Edit on a sound shows, under its player, the **waveform** of the sound as
  the choices make it, its kept parts joined: 64 px high and as wide as the
  player, at least 280 px. It has the yellow frame, the handles, the playhead,
  the length label, and the hold to spread it out of the frame viewer of a
  video ([Editing a video](#editing-a-video)); its edges are those of the
  sound's samples, and for an MP3 those of its frames.
- Under the waveform, **Trim** and **Delete**: Trim keeps only the part
  between the handles, and Delete removes it. Both join what is left at once,
  and the handles then hold all of it. Trim is disabled while all of the sound
  is between the handles, and Delete while what would be left is shorter than
  0.1 s.

### Playing

- Play plays the sound as the choices make it, its kept parts one after the
  other, each coming up over 5 ms after a joint; a part between the handles
  plays over and over while it is shorter than the whole, as the part of a
  video does.

### The keyboard of the waveform

- As the frame viewer's, with Delete removing the part between the handles,
  as Delete does, while the keyboard is on a handle.

## What the edited file holds

### A video

- **The picture**: the frames of the original from the one at the start of the
  part to the last one shown before its end, each at its own time, counted from
  0; no frame is added, dropped, or moved. A video with a variable frame rate
  keeps its frame times. It keeps its coded size and the matrix of its track.
  The first frame is a key frame, and then about every 2 s. Colors are as the
  window shows them.
- **The sound**: the original's sound from the start of the part to its end
  exactly, with its sample rate and number of channels where the system's
  encoder takes them, coming up over the first 5 ms and going down over the
  last 5 ms where the part cuts into it; in sync with the picture within a
  millisecond, the encoder's delay and padding hidden by the edit list, or by
  the codec delay and discard padding of a WebM. A muted video, and a video
  without sound, has no sound track.
- **The file's information**: the boxes at the level of the file of an MP4 or
  MOV, such as its title, its creation date, and the label that marks generated
  content (GB 45438-2025), unchanged.
- **Its format** is the original's container:

  | Video | Edited video |
  | --- | --- |
  | `.mp4`, `.m4v`, `.mov` | the picture in H.264, or in HEVC when the original's picture is HEVC and the window can encode HEVC; the sound in AAC |
  | `.webm` | the picture in VP9, the sound in Opus |

- The picture's bitrate is at least the original's: its average bitrate
  times 1.25 when the codec stays, times 1.6 from HEVC or VP9 to H.264, and
  times 2 from AV1 to H.264 or VP9; at least 0.07 bits for each pixel of each
  frame in H.264 and VP9, 0.05 in HEVC; between 1 and 100 Mbit/s. Measured on
  2026-10-25 on a 1440p clip at 60 frames per second and 6.9 Mbit/s: 41.1 dB
  PSNR on average at 1.25 times its bitrate and about 44 dB at the floor.
- The sound's bitrate is the original's, snapped to 96, 128, 160, or 192
  kbit/s; its sample rate is the original's at 44.1 or 48 kHz and 48 kHz
  otherwise; Opus is always 48 kHz. Where the window has no AAC encoder, as on
  Linux, an MP4 or MOV is saved without sound, and the status line says so.

### An image

- **The pixels**: the part of the original that the frame held, turned,
  flipped, and straightened, at the original's scale: a crop of 1600 × 900
  pixels of the original is a picture of 1600 × 900. Without an angle and with
  a crop on whole pixels, every pixel kept is the original's; with an angle,
  the picture is resampled smoothly. The original's orientation from its
  camera is applied first, as the window shows it.
- **Its format** is the original's:

  | Image | Edited image |
  | --- | --- |
  | `.png` | PNG, without loss |
  | `.jpg`, `.jpeg` | JPEG at quality 0.95 |
  | `.webp` | WebP without loss when the original is without loss, and at quality 0.95 otherwise |

- **The file's information**: the text chunks of a PNG, its EXIF and XMP
  chunks, and the APP segments of a JPEG with EXIF, XMP, and IPTC, among them
  the label that marks generated content, are kept, with the orientation set
  to upright. A color profile is not kept: the pixels are in sRGB, as the
  window draws them. A content credential bound to the original's pixels is
  not kept, since it no longer matches them.

### A sound

| Sound | Edited sound |
| --- | --- |
| `.wav` | the same format and chunks, its samples cut exactly |
| `.mp3` | its frames as they are, cut at frame edges, without encoding again |
| `.flac` | FLAC without loss, encoded again by BaseHalf |
| `.m4a` | AAC encoded again by the window, at the original's bitrate snapped as for a video |
| `.ogg` | Opus encoded again by the window, also from Vorbis |

- Where a cut starts or ends the sound, and on both sides of a joint, the
  sound fades over 5 ms, so that no cut clicks. An MP3 fades by the gain of its
  frames over two granules instead, since its frames are not encoded again;
  the reserve of bits that its frames share is laid out again so that every
  frame decodes after a cut.
- The tags of the original are kept: the ID3 tags of an MP3, the chunks of a
  WAV besides its format and data, the metadata blocks of a FLAC, the iTunes
  tags of an M4A, and the comments of an OGG.
- Where the window has no AAC encoder, as on Linux, an M4A cannot be edited,
  and Edit says so.

## While it is saved, and after

- The edited file is made in memory from the original, written into the
  workspace's cache folder (`.bh/cache/edit/`), and put in its place in one
  step with its record, so that no part of a file ever shows in its place.
- A save goes on when Card Detail closes or shows another file. Card Detail of
  the file, opened again while it runs, says that it is being saved. A window
  that closes or reloads during a save stops it, and the file stays as it was;
  what that save wrote into the cache folder is deleted by a save an hour later
  or more.
- When it is saved, Card Detail shows the file anew, from its start, with a
  line under the player of a video or a sound, and under an image, until
  Card Detail closes: "Edited. ⌘Z puts it back.", "The original is back. ⌘Z
  puts the edit back.", "Saved shot copy.mp4. ⌘Z takes it away." When Card
  Detail does not show the file at the end of a save, the end is a
  notification.

## Failure

- **A file that cannot be edited** has Edit disabled, with the reason in its
  hover: a video whose file cannot be read as MP4, MOV, or WebM, or whose index
  is damaged, too large (more than 64 MB, or two million blocks of a WebM), or
  put together from several parts by its edit list; a video without a picture;
  a picture this system cannot decode, or of a size it cannot encode; an image
  of a format BaseHalf does not write; an image the window cannot decode; a
  sound this system cannot decode; an M4A where the window has no AAC encoder.
- **A save that fails**, because the original cannot be read, the window
  cannot encode it, or its place cannot be written: the file stays as it was,
  nothing is left in the cache, the status line says "BaseHalf could not save
  the edit:" and why, and the editor's controls are enabled again.
- **A file that changes while it is edited or saved**, in its size or its
  time of change, or that is moved, renamed, or deleted: nothing is written,
  and the status line says that the file changed meanwhile; Cancel and Edit
  then start from the file as it is.

## Limits

- An edited file is built in memory before it is written: a video whose size,
  estimated from its bitrate and length, would pass 2 GB is refused before the
  save starts; an image over 16,384 pixels on a side, or 256 million pixels,
  and a sound over 2 hours are refused the same way.
- Only the picture and the first sound of a video are used; other tracks are
  not in the edited video.
- The frame viewer reads the frames of a video once when the editor opens, and
  again where it is spread out; with few key frames, a long video's pictures
  appear one by one.
- VP9 is encoded by the window in software: a WebM takes longer to save than
  an MP4 of the same size.
- A picture of odd width or height is encoded one pixel narrower or lower when
  the window's encoder refuses its size.
- An MP3 is cut at frame edges, about 26 ms apart at 44.1 kHz.
- A copy of an edited file on a disk that cannot clone files takes as much
  room again for its original.

## Acceptance criteria

1. Card Detail of a video, an image, and a sound has Edit in its header; of a
   GIF, Edit is disabled and says why. Edit shows the editor of the kind, and
   Cancel, Done with its menu, and Close; Revert only for an edited file.
2. In the frame viewer, dragging the start handle shows the frame at the
   handle, moves the yellow frame, and changes the length; holding a handle
   still for 0.4 s spreads the viewer around it; moving a handle within 1.0 s
   of the other pushes it.
3. Done on a 5 s video with 1.0 s to 4.5 s kept replaces it with 3.5 s of it,
   as D79's criterion 6 measures, and writes `.bh/mirror/<path>/original.mp4`,
   byte for byte the video before, and `edit.yaml` with the part kept.
4. Edit on that video shows the whole 5 s original in the viewer with the
   handles at 1.0 s and 4.5 s; widening the part to 0.5 s and Done gives 4.0 s
   of the original, encoded from the original.
5. Revert on it puts back the original's bytes and removes `original.mp4` and
   `edit.yaml`; undo of the Revert brings the edit back exactly; redo reverts
   again.
6. Save as New on a video with a part kept writes `shot copy.mp4` of that part,
   connected from the video, its card 40 to the right; the video, its original,
   and its record stay as they were.
7. Cropping a 2048 × 2048 PNG to 16:9 gives a PNG of 2048 × 1152 whose pixels
   are the original's rows kept; a quarter turn and a flip give the original's
   pixels turned and mirrored; an angle of 10° leaves no empty corner.
8. Trim and Delete on a WAV give a WAV of the kept samples, with 5 ms fades at
   the joints, its other chunks unchanged; an MP3 edited the same way decodes in
   the window without an error, its frames otherwise byte for byte the
   original's.
9. A copy of an edited file can be reverted to the original; a deleted edited
   file put back from the Trash after its window closed can be reverted.
10. A file changed by another program after its edit opens in Edit as it is,
    without Revert, and Done keeps it as the new original.
11. In edit mode, Escape cancels and a second Escape closes Card Detail;
    Command+Z undoes the editor's last change and not a step of the canvas.
12. A generated video edited and saved keeps its `made.yaml` byte for byte,
    and its panel and Card Detail say how it was edited.

## Verification

- Unit tests of the edit record (reading, writing, defaults left out, the
  fingerprint), of the choices of each editor (the frame edges and the minimum
  part, pushing and moving; the crop's geometry with turns, flips, angles, and
  ratios; the kept parts of a sound through Trim and Delete), and of the
  readers and writers of each format, written and read back.
- Tests in the window of the unit tests: a short video, image, and sound of
  each format made there, edited, and read back for their frames, pixels, and
  samples; a click at a white frame kept in sync; and Done, Save as New, and
  Revert through the service on a file system in memory, with the steps of undo
  they ask for.
- The smoke steps of the `cardDetail` suite: editing a video (Edit, the
  handles, Done, Edit again from the original, Revert, undo and redo with the
  keyboard), cropping an image, and cutting a sound.
- In a development window: each kind and format with the media of the
  development workspace, the time each save takes, the quality of the edited
  file against its original frame by frame, and the canvas card and Card Detail
  after each step and its undo and redo.

## Where this lands

`src/vs/workbench/basehalf/mediaEdit/` ([code organization](../harness/code-organization.md)):
the edit record, the choices of each editor, and the readers and writers of
each format in `common/`; Card Detail's edit mode, the editors, the encoding
with the window's encoders, and the service that saves, saves as new, and
reverts through the steps of [exact undo](exact-undo.md) in `browser/`. Card
Detail gives the editors its header and the place of its view; the player
gives them its time, a jump to a time, the playing of a range, and mute.
