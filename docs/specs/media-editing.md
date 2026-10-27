# Editing media

Status: Draft (2026-10-26)
Decision: [D84](../decisions.md#d84--a-video-an-image-or-a-sound-is-edited-in-card-detail-and-its-original-is-kept-new-2026-10-26),
which revises [D79](../decisions.md#d79--card-detail-trims-a-video-in-place-and-undo-puts-it-back-new-2026-10-25),
and [D85](../decisions.md#d85--editing-media-is-direct-a-change-is-saved-as-it-is-made-with-no-edit-mode-new-2026-10-26),
which makes the editing direct
Related: [exact undo](exact-undo.md) (the steps of an edit and their undo),
[generation cards](generation-cards.md) ("The player", "The file", and
"`made.yaml`"), [opening and closing Card Detail](card-detail-opening.md),
[layout controls](layout-controls.md#card-detail) (the header of Card Detail),
[workspace state](workspace-state-and-legacy-cleanup.md#what-basehalf-persists)
(what `.bh/` holds), [architecture invariants](../harness/architecture-invariants.md#product-shell)

This specification owns the editing of a video, an image, and a sound in
Card Detail: the original that BaseHalf keeps for an edited file and the
record of the edit, how a change is saved and undone, Revert to Original, the
editor of each kind, what the edited file holds, and its format. The player
of a video or a sound is the player of every card
([generation cards, "The player"](generation-cards.md#the-player)); this
specification only adds what an editor asks of it. The undo and redo of a
step belong to [exact undo](exact-undo.md).

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
- **Editing asked for steps a change does not need** (D85, counted on the
  first build, D84): Edit, the change, then Done, or its menu for Save as New,
  with Cancel and Close beside them. A trim took 3 actions, cutting a part out
  of a sound 5, cropping an image to 16:9 4; the editor of a sound showed 8
  buttons, and it had an undo of its own beside the canvas undo. A phone saves
  a trim that is dragged into place, and BaseHalf saves a note as it is typed.

## Goals

- **A change is the result** (D85): Card Detail of a video, an image, or a
  sound shows its editor at once, and a change is saved as it is made. There
  is nothing to press to edit, to save, or to leave.
- **The file in its folder is the edited file.** It keeps its name, its
  folder, its card, and its connections; Files, agents, and providers see the
  edit.
- **The original is kept**, with the file's card information, through
  renames, moves, copies, git, and the Trash, until the user reverts: a file
  put back from the Trash comes back with its edit. **Nothing of an edit is
  kept for good without its file**: an original whose file has been gone for
  30 days goes to the Trash.
- **An edit starts from the original.** The editor of an edited file shows the
  whole original with the choices of its edit: a trim can be widened again, a
  crop moved, a deleted part of a sound brought back. Each edit is encoded
  from the original, never from an earlier edit.
- **Revert to Original** puts the original back at any time.
- **Each change is one step of the canvas undo**, and undo puts back exactly
  what the step changed, with the one undo of the window.
- **An edited file looks and sounds like its original did**: the same
  picture and frame times, the same sample rate, no lower a bitrate, and no
  click where a cut joins sound.

## Non-goals

- Adjusting light and color, filters, markup, and taking things out of a
  picture. The editors trim, crop, turn, flip, straighten, and cut sound: the
  edits that a phone's editors offer first.
- Saving a video without its sound: the player's sound button mutes only the
  playing (D85).
- Saving an edit as a new file beside the file: Duplicate on the canvas, then
  a change, does that ([architecture invariants](../harness/architecture-invariants.md#product-shell)).
- Correcting perspective (the vertical and horizontal adjustments of a
  phone's crop tool), and finding the crop or the horizon automatically.
- Cropping or turning a video, changing its speed, and joining files.
- Recording over a part of a sound.
- Editing on the canvas, and editing several files at once.
- Editing GIF, AVIF, BMP, and SVG images, and videos and sounds of other
  formats: the window cannot write them as they are, so Card Detail shows them
  without an editor.
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
- **Editor**: what Card Detail shows of a media file that BaseHalf can edit,
  in place of a plain view: the frame viewer of a video under its player, the
  waveform of a sound, and the crop view of an image.
- **The choices of an edit**: what the editor sets: a part to keep, parts to
  delete, a crop, a turn, a flip, an angle.
- **Change**: what the user does in an editor that alters the choices, ended
  when it is let go: a handle released, a part cut out, a turn, a flip, a
  ratio, an angle, a crop.

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
- While its file is gone, an original stays for 30 days, so that the file can
  come back with its edit ([When the file is gone](#when-the-file-is-gone)).

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
  the millisecond. A video keeps one part; a sound keeps one or more.
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
  edited: the editor starts from the file, and Revert to Original is not
  offered. The first change then writes a new record in its place, and keeps
  the one that could not be read as a recovery copy under `.bh/cache/recovered/`.

### Changes save themselves

- **A change is saved as it is made** (D85): a handle let go, a part cut out,
  a turn, a flip, a ratio, an angle let go, a crop let go. Nothing is pressed to
  save it, and nothing to leave: there is no mode of editing.
- **The editor shows a change at once**, drawn from the original: the player
  plays the part kept, the waveform joins the parts kept, and the crop view
  shows the part kept. Nothing waits for the file.
- **The file follows.** Once the choices have rested for 1 s, BaseHalf writes
  the edit of the original into the file, and the record beside it; at once
  when Card Detail closes or shows another file, and when the window closes,
  which waits for the writes that are left; and before the file is moved,
  copied, or deleted in the window, so that a Duplicate right after a change
  copies the change. Writes of a file run one at a time, in the background: a
  change made while one runs is written after it.
- The first change of a file keeps the file as it was as the original. A change
  of an edited file leaves the original as it is and replaces the record.
  Choices that keep the whole original, as the whole video kept or the whole
  picture unturned, are no edit: the original's bytes go back in the file's
  place, and the original and the record go.
- **Each change is one step of the canvas undo**, named for what it did:
  "Trim shot.mp4", "Cut take.wav", "Crop still.png", "Turn still.png",
  "Flip still.png", "Straighten still.png". Changes of the same name to one
  file within 0.6 s are one step, as when an arrow key repeats. Command+Z
  undoes the step wherever the keyboard is in Card Detail, outside an editor
  of text, and on the canvas ([exact undo](exact-undo.md#editing-media)).
- **Undo and redo show the choices before or after at once** in an editor of
  the file, and the file follows as after a change. What BaseHalf wrote for
  the last 8 sets of choices of a file stays in `.bh/cache/edit/` until the
  window closes, so that undo and redo put back the very bytes, at once; for
  older ones the edit is encoded again from the original, and the original's
  own bytes come back as they are.
- Editing keeps nothing in the kept versions of exact undo: undo puts back
  choices, and the original holds what the Trash would hold. So editing puts
  nothing in the Trash.
- A step that cannot be undone as it was says why and changes nothing, as a
  step of the canvas does: "'shot.mp4' changed meanwhile. Undo did not change
  it." and "'shot.mp4' is not there any more."

### Revert to Original

- Under the editor of an edited file, its line says what the edit is and
  offers **Revert to Original**: "Trimmed to 1.0s–4.5s · Revert to Original".
  It is one step, "Revert shot.mp4 to Original": the original's bytes go back
  in the file's place, and the original and the record go. It asks nothing:
  undo takes it back.
- A copy to change apart from the file is made on the canvas, with Duplicate,
  and then changed: the copy of an edited file has its original too
  ([Copies, deletes, and the Trash](#copies-deletes-and-the-trash)).

### A file that changed outside BaseHalf

- When the file is no longer the result of its record, because an agent, a
  program, or git changed it, its fingerprint tells. The record and the
  original are then of another file: the editor starts from the file as it
  is, and Revert to Original is not offered. The first change keeps the file
  as it is then as the new original, when it is written.
- An original that is missing, or that cannot be read, is treated the same
  way.
- The originals that the card information holds then, the one before and one
  of another name, as `original.mov` after `shot.mov` was renamed
  `shot.mp4`, are of no version of the file that the change makes. They go
  to the Trash when the change is written, as an original whose file is gone
  does in the end ([When the file is gone](#when-the-file-is-gone)), and the
  undo of the change puts back the file as it was, without them.
- A file that changes outside BaseHalf while Card Detail shows it is shown
  anew, as it is; choices that were not written yet are dropped, and a write
  that finds the change writes nothing.

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
  a file put back from the Trash can still be reverted
  ([When the file is gone](#when-the-file-is-gone)).

### When the file is gone

- A file that is not there leaves its original and its record at its path in
  `.bh/mirror/`: a file in the Trash; one deleted, or moved where BaseHalf does
  not follow it, outside BaseHalf, by an agent, another program, or git; and
  one that is away for now, on a git branch that does not have it or in a
  folder that is being synced. When the file comes back, its edit is there:
  its editor shows it, and Revert to Original puts the original back.
- So that an original does not stay for good when its file does not come
  back, a window that opens a workspace folder notes each original whose file
  is not there, once
  [following moved items](following-moved-items.md#when-basehalf-compares) has
  followed the moves it recognized. An original whose file was gone at every
  open for 30 days since the first goes to the Trash, from the folder that held
  the file, as an ordinary file named after it: `shot original.mp4`, or
  `shot original 2.mp4` when that name is taken. When that folder is gone too,
  it goes from the card information, under the same name. Its record is
  deleted. Without the Trash, both are deleted for good.
- 30 days is as long as a phone's photo library keeps what was deleted, and
  what the system offers for emptying the Trash: a file put back from the Trash
  within that time comes back with its edit, and after it the Trash holds the
  file and its original side by side.
- The notes are machine-local, in `.bh/cache/gone-originals.json`
  ([workspace state](workspace-state-and-legacy-cleanup.md#what-basehalf-persists)).
  A file that is there at an open loses its note: the 30 days start again when
  it is gone again.
- An original gets no note, and stays, while its path waits for its move to be
  followed, while the file cannot be looked at (an error is never read as the
  file's absence), while a cloud folder holds a placeholder in the file's
  place, when its record cannot be read, and in a folder marked to be left
  alone.
- A file that is there keeps its original, also when it changed: its first
  change decides about it ([A file that changed outside BaseHalf](#a-file-that-changed-outside-basehalf)).

### Generation cards

- An edit changes a generated file, never what made it: `made.yaml` stays as
  it was written when the file landed, and New Version makes a draft from it
  as before ([generation cards, "`made.yaml`"](generation-cards.md#madeyaml)).
- The panel of a generated card says that the file was edited, and how:
  "Edited: Trimmed to 1.0s–4.5s.", "Edited: Turned · Cropped to 1600 × 900.",
  "Edited: Trimmed to 3 parts."
  ([generation cards](generation-cards.md#the-panel-of-a-card-with-its-file)),
  while the file has the size the edit gave it. In Card Detail, the line under
  the editor says it, and the section of what made the file does not again.
- The record's `id` in `made.yaml` stays, so a Sequence that names a video
  still finds it after an edit ([Video Sequence](video-sequence.md)).

## Editing in Card Detail

### What Card Detail shows

- Card Detail of a video, an image, or a sound that BaseHalf can edit shows
  its editor at once, in place of a plain view, with the original of an
  edited file and the choices of its edit: the player of a video with the
  frame viewer under it, the waveform of a sound with Play under it, and the
  crop view of an image with its tools under it.
- The header holds no control of editing: the title, the description, and
  Close ([layout controls](layout-controls.md#card-detail)).
- A file that BaseHalf cannot edit shows as a plain view, an image in its
  page and a video or a sound in the player, and nothing says why: there is no
  control to explain ([Failure](#failure)). So does every media file in a
  workspace folder that BaseHalf leaves alone, which keeps no card information
  ([spec-driven development](spec-driven-development.md)).
- **The line under the editor**: for an edited file, what the edit is and
  **Revert to Original** ([Revert to Original](#revert-to-original));
  "Saving…" with the share done while the file is written, after the line of
  an edited file; the failure of a write, with **Try Again**; and nothing for
  a file that was never edited. It keeps its height while it is empty.

### The keyboard

- Card Detail opens with the keyboard on the editor's first control: the
  player's Play for a video, Play for a sound, and the crop frame for an
  image.
- **Escape** closes Card Detail
  ([opening and closing Card Detail](card-detail-opening.md#the-keyboard)).
  During a drag in an editor it only ends the drag and puts back what the
  drag changed, and with a part of a sound selected it only drops the
  selection.
- **Command+Z** (Control+Z on Windows and Linux) undoes the last step of the
  canvas, a change of an edit among them, and **Shift+Command+Z** redoes it,
  with the keyboard anywhere in Card Detail outside an editor of text
  ([exact undo](exact-undo.md#undo-while-card-detail-is-open)).
- When an undo, a redo, or a write changes the file that Card Detail shows,
  the editor stays, and the keyboard stays on the control it was on.
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
  had.
- **The viewer is the video's timeline**: the player above it shows Play, the
  time, its sound button, and Full Screen, and no bar of its own for the time.
  The player's sound button mutes only the playing; it changes nothing in the
  file.
- **The part kept** has a yellow frame around it, 3 px above and below, with
  a handle 14 px wide on each side that carries a dark chevron; the strip
  outside it is dimmed. While the whole video is kept, the frame is white.
- **The playhead** is a white line at the time the player shows, and follows
  it while it plays.
- **The length of the part** is in its middle, or above the viewer over its
  middle when the part is narrower than the label, in tenths of a second under
  a minute and in minutes and seconds from a minute on, never more than it is,
  as the player shows times (`3.5s` for 3.57 s).

### The pointer

- **A drag of a handle** moves that end of the part, to the nearest frame
  edge. It pauses the player, and while it moves, the player shows the frame
  at the handle: the first frame of the part at the start handle, the last at
  the end handle. Letting go of it is a change, "Trim shot.mp4".
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
  while it moves, the player shows the frame at the part's start. Letting go
  of it is a change, as for a handle.
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
- While the whole video is kept, the player plays the whole video, as a card's
  player does.

### The keyboard of the frame viewer

- The viewer's controls take the keyboard after the player's: the start
  handle, then the end handle. Each handle is a slider that says its time and
  the video's length.
- **On a handle**: Left and Right move it by 0.1 s, with Shift by one frame,
  with Command (Control on Windows and Linux) by 1 s; Home and End move it as
  far as it goes; Up and Down do what Right and Left do. Every step moves the
  handle at least one frame, and pushes the other handle as a drag does; the
  player shows the frame at the handle. Each key is a change; a key that
  repeats is one.
- **I** and **O**, with the keyboard in the player or the viewer, put the
  start at the start of the frame the player shows, and the end at the end of
  that frame: each is a change.
- **Space** on a handle plays and pauses. The arrow keys move no card.

## Cropping an image

### The crop view

- Card Detail of an image shows the picture as its edit made it: the original,
  turned, flipped, and straightened as the choices say, as large as fits in
  Card Detail with a margin of 24 px, and only the part kept; the rest of the
  original is hidden.
- The **crop frame** stands on the edges of the part kept: a white frame with
  thick corners and a handle in the middle of each side. It shows while the
  pointer is over the picture or the keyboard is on the frame, and fades out
  otherwise. While a corner, a side, or the picture is dragged, the rest of
  the original shows around the frame, dimmed, and lines divide the part into
  thirds.
- Under the picture, a row of tools, from left to right: **Turn Left**,
  **Flip**, **Ratio**, and the **Straighten** dial. Revert to Original, in the
  line under them, sets everything back.

### The crop frame

- **A drag of a corner or of a side** moves it, keeping the ratio when one is
  set, and never past the picture: the part kept is always all picture, with
  no empty corner, also while the picture is straightened. Letting go of it is
  a change, "Crop still.png".
- **A drag inside the frame**, while the part is smaller than the picture,
  moves the picture under the frame, as far as its edges go; letting go is a
  change, "Crop still.png". While the part is the whole picture, a drag there
  does nothing.
- When a drag ends, the frame and the picture glide in 200 ms until the frame
  is as large as fits, at the middle of the view.
- **The wheel, or a pinch of the trackpad, over the picture** zooms the view,
  never the edit: around the pointer, from the picture as it fits up to twice
  its pixels; a picture that fits at more than twice its pixels does not zoom.
  While the view is zoomed in, the crop frame does not show, and a drag moves
  the view. A double click shows the picture as it fits, or, as it fits, at its
  own pixels around the pointer. Card Detail opens with the picture as it
  fits, and a change shows it as it fits again.
- **The size of the part** stands under the frame while it is dragged, in
  pixels of the original (`1600 × 900`).

### The tools

- Each tool is a change when it is used: a turn, a flip, a ratio, and an
  angle when the dial is let go.
- **Turn Left** turns the picture and the frame a quarter to the left.
- **Flip** mirrors the picture and the frame left to right.
- **Ratio** opens a menu: Freeform, Original, Square, 16:9, 5:4, 7:5, 4:3,
  5:3, and 3:2, with Tall and Wide at its top for the ratios that have both;
  the menu says which is set. A ratio makes the frame the largest part of that
  ratio around its center that the picture holds. At first the ratio is
  Freeform, or the one an edit before kept: Original, or a ratio of the
  menu, tall or wide as it was.
- **The Straighten dial** turns the picture under the frame by up to 45° each
  way, in steps of 0.1°, with a mark at every degree and the angle above it
  (`−2.5°`). The frame keeps its ratio and grows smaller as far as it must to
  hold only picture. A double click on the dial sets it back to 0°.

### The keyboard of the crop view

- The tools take the keyboard after the crop frame: the frame's corners in
  turn from the top left, then the tools. On a corner, the arrow keys move it
  by 1 pixel of the screen, with Shift by 10; inside the frame, with the frame
  focused, the arrow keys move the picture. On the dial, Left and Right turn
  by 0.1°, with Shift by 1°. Keys that follow each other within 0.6 s are one
  change.

## Editing a sound

### The waveform

- Card Detail of a sound shows, in place of a player, the **waveform** of the
  sound as the choices make it, its kept parts joined, and each joint marked
  with a thin yellow line. A sound has no picture, so the waveform takes the
  place of one: as wide as the view less 48 px on each side, at most
  1,280 px, and 30% of the view's height, from 112 to 240 px.
- The waveform is drawn as rounded bars, 3 px wide with 2 px between them, as
  the recorders and editors of sound on phones draw it. Each bar is as high
  as the loudness of its stretch, the root mean square of its samples, set
  against the loudest 50 ms of the original on a curve (the ratio to the
  power 0.6) that keeps a quiet word visible beside a loud one. A stretch
  more than 48 dB below the loudest is silence, and shows as a dot. So speech
  shows its phrases and the pauses between them, and a song its beat rather
  than one block. When the hold spreads the waveform out, the bars stay as
  wide and each holds a shorter stretch.
- The waveform has the yellow frame, the handles, the playhead, the length
  label, and the hold to spread it out of the frame viewer of a video
  ([Editing a video](#editing-a-video)); its edges are those of the sound's
  samples, and for an MP3 those of its frames. As in the frame viewer, the
  handles hold the part kept: letting go of one trims the sound to the part
  between them, a change, "Trim take.wav". The part is at least 0.1 s, or the
  whole sound when it is shorter. The waveform shows the parts kept from the
  start of the original to its end, so that a trim can be widened again: what
  a trim left out at either end is outside the handles, dimmed, and a stretch
  cut out between parts is a joint.
- Under the waveform, at its left, **Play** with the time and the length.
- **A drag on the waveform inside the part kept** selects a stretch of it: the
  stretch is lit, and **Delete** stands on it. Delete, or the Delete key,
  cuts the stretch out and joins what is left, a change, "Cut take.wav"; the
  handles hold what they held, less the stretch. A press elsewhere, a press on
  the selected stretch that does not move, and Escape drop the selection. A
  stretch is at least 0.1 s, and Delete does not show while what would be left
  is shorter than 0.1 s.

### Playing

- Play plays the sound as the choices make it, its kept parts one after the
  other, each coming up over 5 ms and going down over 5 ms at its ends, so
  that no joint clicks; while the part between the handles is shorter than
  the whole, it plays over and over, as the part of a video does. A press on
  the waveform that does not move moves the playhead there.

### The keyboard of the waveform

- As the frame viewer's. With a stretch selected, the Delete key, or
  Backspace, cuts it out, as Delete does. **Space** plays and pauses with the
  keyboard anywhere on the waveform or on Play.

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
  the codec delay and discard padding of a WebM. A video without sound has no
  sound track.
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
  Linux, an MP4 or MOV is saved without sound, and the line under the editor
  says so.

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
| `.wav` | the same format and chunks, its samples cut exactly, in whole numbers or floating point |
| `.mp3` | its frames as they are, cut at frame edges, without encoding again, with a new Info frame |
| `.flac` | FLAC without loss, decoded and encoded again by BaseHalf |
| `.m4a` | AAC encoded again by the window, at the original's bitrate snapped as for a video |
| `.ogg` | Opus encoded again by the window, also from Vorbis, in an Ogg of its own |

- Where a cut starts or ends the sound, and on both sides of a joint, the
  sound fades over 5 ms, so that no cut clicks. An MP3 fades by the gain of its
  frames over two granules instead (−30 dB, then −12 dB), since its frames are
  not encoded again; the reserve of bits that its frames share is laid out
  again from an empty reserve, so that every frame decodes after a cut, each
  frame's data byte for byte as it was. A frame whose data no longer fits
  takes a higher bitrate.
- A FLAC is decoded by BaseHalf's own decoder, not the window's: the window
  gives its samples as fractions scaled by 32767 above zero and by 32768
  below (measured on 2026-10-26: 318 of 44,100 samples came back one off), so
  that its whole numbers could not be read back exactly. A WAV is cut in its
  bytes.
- The tags of the original are kept: the ID3 tags of an MP3, the chunks of a
  WAV besides its format and data, the metadata blocks of a FLAC, the iTunes
  tags of an M4A, and the comments of an OGG.
- Where the window has no AAC encoder, as on Linux, an M4A cannot be edited:
  Card Detail shows it in the player, without an editor.

## While it is saved, and after

- The edited file is made in memory from the original, written into the
  workspace's cache folder (`.bh/cache/edit/`), and put in its place with its
  record, so that no part of a file ever shows in its place.
- A write goes on when Card Detail closes or shows another file. Card Detail
  of the file, opened again while one runs, shows the choices being written
  and "Saving…". A window that closes or reloads waits for its writes, with
  "Saving edits" while it does. A window that crashes or is stopped leaves the
  file as its last write made it: a change that was not written yet is lost,
  as an unsaved word would be. What a stopped write left in the cache folder
  is deleted by a write an hour later or more.
- The canvas card shows the file as it is written: its picture, its length,
  and its shape. The editor in Card Detail does not show the file anew when
  its own write lands: it already shows the choices.
- The editor reads a copy of what it starts from, the file or its original,
  made in `.bh/cache/edit/shown/` when Card Detail shows the file and cloned at
  no cost on a disk that can clone: a write replaces the file, and Revert to
  Original removes the original, and neither changes what the editor reads or
  the player of a video plays. The copy goes when Card Detail closes or shows
  another file.

## Failure

- **A file that cannot be edited** shows as a plain view, without an editor: a
  video whose file cannot be read as MP4, MOV, or WebM, or whose index is
  damaged, too large (more than 64 MB, or two million blocks of a WebM), or put
  together from several parts by its edit list; a video without a picture; a
  picture this system cannot decode, or of a size it cannot encode; an image of
  a format BaseHalf does not write; an image the window cannot decode; a sound
  this system cannot decode; an M4A where the window has no AAC encoder.
- **A write that fails**, because the original cannot be read, the window
  cannot encode it, or its place cannot be written: the file, its original,
  and its record stay as the last write made them, and the line under the
  editor says "BaseHalf could not save the edit:" and why, with **Try Again**.
  The editor keeps the choices. When Card Detail does not show the file, a
  notification says it, with Try Again. What the write encoded stays in the
  cache until the window closes, so that Try Again writes it at once.
- **A file that changes outside BaseHalf while it is shown**, in its size or
  its time of change, or that is moved, renamed, or deleted: nothing is
  written, and Card Detail shows the file anew as it is
  ([A file that changed outside BaseHalf](#a-file-that-changed-outside-basehalf)).

## Limits

- An edited file is built in memory before it is written: a video whose size,
  estimated from its bitrate and length, would pass 2 GB is refused before the
  save starts; an image over 16,384 pixels on a side, or 256 million pixels,
  and a sound longer than 30 minutes, or whose file passes 256 MB, are refused
  the same way.
- Only the picture and the first sound of a video are used; other tracks are
  not in the edited video.
- The frame viewer reads the frames of a video once when the editor opens, and
  again where it is spread out; with few key frames, a long video's pictures
  appear one by one.
- A write encodes a video again from the original, longer for a long or a
  large one, while the line says Saving… with the share done; a change while
  it runs is written after it. Measured on 2026-10-27 in a development window,
  after the rest of 1 s: 0.18 to 0.21 s for a generated clip of 3 s at 480p,
  0.2 s for a crop of a PNG of 2048 × 2048, and 0.04 s for a cut of a WAV of
  6 s; an undo or a redo to what was written before puts the bytes back in
  about 15 ms.
- VP9 is encoded by the window in software: a WebM takes longer to save than
  an MP4 of the same size.
- A picture of odd width or height is encoded one pixel narrower or lower when
  the window's encoder refuses its size.
- An MP3 is cut at frame edges, about 26 ms apart at 44.1 kHz.
- A copy of an edited file on a disk that cannot clone files takes as much
  room again for its original.

## Acceptance criteria

1. Card Detail of a video, an image, and a sound shows its editor at once,
   with no control of editing in its header; a GIF shows its page, without an
   editor, and nothing that says why.
2. In the frame viewer, dragging the start handle shows the frame at the
   handle, moves the yellow frame, and changes the length; holding a handle
   still for 0.4 s spreads the viewer around it; moving a handle within 1.0 s
   of the other pushes it.
3. Letting go of the start handle of a 5 s video at 1.0 s, and of the end
   handle at 4.5 s, with nothing pressed after: within 3 s the video is 3.5 s
   of it, as D79's criterion 6 measures, `.bh/mirror/<path>/original.mp4` is
   byte for byte the video before, and `edit.yaml` holds the part kept. The
   Edit menu's Undo names "Trim shot.mp4".
4. Card Detail of that video, opened again, shows the whole 5 s original in the
   viewer with the handles at 1.0 s and 4.5 s; widening the part to 0.5 s gives
   4.0 s of the original, encoded from the original.
5. Revert to Original on it puts back the original's bytes and removes
   `original.mp4` and `edit.yaml`; undo of it brings the edit back byte for
   byte; redo reverts again.
6. Command+Z with the keyboard on a handle undoes the last trim in the viewer
   at once and in the file; Shift+Command+Z redoes it, byte for byte.
7. Cropping a 2048 × 2048 PNG to 16:9 with Ratio gives a PNG of 2048 × 1152
   whose pixels are the original's rows kept; a quarter turn and a flip give
   the original's pixels turned and mirrored; an angle of 10° leaves no empty
   corner. The wheel over the picture zooms the view and changes no edit.
8. Delete on a selected stretch of a WAV, and letting go of a handle, give a
   WAV of the kept samples, with 5 ms fades at the joints, its other chunks
   unchanged; an MP3 edited the same way decodes in the window without an
   error, its frames otherwise byte for byte the original's.
9. A copy of an edited file can be reverted to the original; a deleted edited
   file put back from the Trash after its window closed can be reverted.
10. A file changed by another program after its edit shows as it is, without
    Revert to Original, and its first change keeps it as the new original.
11. Escape closes Card Detail; during a drag it puts back what the drag
    changed and leaves Card Detail open.
12. A generated video edited keeps its `made.yaml` byte for byte, and its
    panel and the line under its editor say how it was edited.
13. Changes, their undo and redo, Revert to Original, and then closing the
    window with the Trash on: the file holds the last change, nothing is in
    the Trash, and nothing is left in `.bh/cache/kept/` or of the copies in
    `.bh/cache/edit/`.
14. An edited file that is gone at the opens of 30 days: at the first open
    after them, `shot original.mp4`, byte for byte its original, is in the
    Trash from the file's folder, and its record is gone. A file that is back
    before then keeps its edit, and its note is gone.
15. From the first frame that Card Detail of a video or an image shows its
    picture, recorded on every frame, the picture keeps its place and size
    while the frame viewer or the crop tools stand in the space under it; no
    frame shows the picture taken away or drawn anew, also when a change, its
    write, its undo, and Revert to Original land; and closing Card Detail
    shows no frame without the card's picture (the user, 2026-10-27: the video
    "jumped up" and "flashed" when Edit was pressed, and Cancel flashed).

## Verification

- Unit tests of the edit record (reading, writing, defaults left out, the
  fingerprint), of the choices of each editor (the frame edges and the minimum
  part, pushing and moving; the crop's geometry with turns, flips, angles, and
  ratios; the kept parts of a sound through trims and cuts), and of the
  readers and writers of each format, written and read back.
- Tests in the window of the unit tests: a short video, image, and sound of
  each format made there, edited, and read back for their frames, pixels, and
  samples; a click at a white frame kept in sync; and changes through the
  service on a file system in memory: the write after the rest and at a flush,
  one write at a time, the steps of undo and their names, undo and redo byte
  for byte from what was written, a first change, Revert to Original, a file
  changed meanwhile, and a write that fails.
- Unit tests of the notes of originals whose file is gone, at opens on a file
  system in memory with a clock that moves on: a file that is back, a path
  whose move waits, a record that cannot be read, a folder that is gone, and a
  name that is taken.
- The smoke steps of the `cardDetail` suite: editing a video
  (`card-detail-video-edit`: the handles, the file written with nothing
  pressed, the editor again from the original, undo and redo with the
  keyboard, Revert to Original and its undo, and Escape), cropping an image
  (`card-detail-image-edit`: an SVG shows no editor; Square, a turn and a
  flip, the wheel that zooms only the view, Revert to Original, and undo), and
  cutting a sound (`card-detail-sound-edit`: a stretch selected and cut, a
  trim, the editor again, undo, and Revert to Original).
- In a development window: each kind and format with the media of the
  development workspace, the time each write takes, the quality of the edited
  file against its original frame by frame, and the canvas card and Card Detail
  after each change and its undo and redo.

## Where this lands

`src/vs/workbench/basehalf/mediaEdit/` ([code organization](../harness/code-organization.md)):
the edit record, the choices of each editor, the readers and writers of each
format, and the notes of originals whose file is gone in `common/`, which the
mirror cascade runs at open after its sweep of orphaned badges
([mirror file resilience](mirror-file-resilience.md)); the editing of Card
Detail, the editors, the encoding with the window's encoders, and the service
that applies a change, writes the file after it, and keeps the steps of its
undo, in `browser/`. Card Detail gives the editors the place of its view; the
player of a video gives the frame viewer its time, a jump to a time, and the
playing of a range; the waveform of a sound plays the edit itself, with the
window's audio.
