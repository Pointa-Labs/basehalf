# Editing media

Status: Draft (2026-10-26, revised 2026-10-28)
Decision: [D84](../decisions.md#d84--a-video-an-image-or-a-sound-is-edited-in-card-detail-and-its-original-is-kept-new-2026-10-26),
which revises [D79](../decisions.md#d79--card-detail-trims-a-video-in-place-and-undo-puts-it-back-new-2026-10-25),
and [D85](../decisions.md#d85--editing-media-is-direct-a-change-is-saved-as-it-is-made-with-no-edit-mode-new-2026-10-26),
which makes the editing direct;
[D93](../decisions.md#d93--a-pinch-zooms-the-picture-of-an-image-or-a-video-in-card-detail-and-spreads-out-the-time-of-a-video-or-a-sound-new-2026-10-27)
for zooming the picture and the time;
[D96](../decisions.md#d96--media-in-card-detail-opens-to-view-it-edit-edits-it-and-its-gestures-are-the-canvass-new-2026-10-27)
for viewing before editing, and the gestures of the canvas;
[D97](../decisions.md#d97--a-crop-is-taken-back-by-pushing-its-frame-to-the-edge-and-a-pinch-while-cropping-zooms-the-picture-under-the-frame-new-2026-10-28)
for cropping as a phone's photo editor does;
[D99](../decisions.md#d99--a-trim-of-a-video-is-saved-by-copying-its-frames-at-once-and-the-frame-viewer-lines-up-with-the-picture-new-2026-10-28)
for saving a trim by copying the video's frames, and the frame viewer under
the picture;
[D100](../decisions.md#d100--in-card-detail-the-keyboard-is-the-medias-and-a-press-of-a-button-leaves-it-there-new-2026-10-28)
for the keyboard, which stays on the media; and
[D101](../decisions.md#d101--a-zoomed-picture-moves-within-its-own-edges-under-floating-controls-and-the-frame-viewer-shows-its-pictures-together-new-2026-10-28)
for a zoomed picture that stays within its edges under floating controls,
and the frame viewer's pictures and glide
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
- D79 measured that a generated video has one key frame, and that encoding
  again with the window's encoders is fast for a short clip and close to
  lossless (46.4 dB PSNR on a 480p clip at its own bitrate, 53.2 dB on a WebM
  recording). It concluded that a cut that copies compressed frames cannot
  start where a clip needs it to, which an MP4's edit list makes possible
  (D99).
- **Editing asked for steps a change does not need** (D85, counted on the
  first build, D84): Edit, the change, then Done, or its menu for Save as New,
  with Cancel and Close beside them. A trim took 3 actions, cutting a part out
  of a sound 5, cropping an image to 16:9 4; the editor of a sound showed 8
  buttons, and it had an undo of its own beside the canvas undo. A phone saves
  a trim that is dragged into place, and BaseHalf saves a note as it is typed.
- **Opening a file went into editing** (D96, 2026-10-27, after D85): the crop
  frame of an image showed as soon as the pointer was over it, its tools stood
  under it, and the handles of a video and a sound were there at once, where
  a phone's photo library shows a photo to look at and edits it after Edit.
  A two-finger swipe zoomed a picture, which a trackpad sends as the wheel,
  while on the canvas it moves; and a pinch over a video zoomed it inside
  its player, whose box cut it, where a browser zooms the place under the
  fingers over its whole page.
- **A crop could not be taken back** (D97, 2026-10-28, after D96). On a
  picture of 2400 × 1600, a crop to 1320 × 880 glided to fill the view, which
  zoomed the picture from 0.41 to 0.75 screen pixels for each of its pixels,
  and the rest of the original lay outside the view, painted over. A drag of
  a corner kept that scale, so even the window's corner took the part back
  only to 1823 × 1015, with the frame's corner outside the view; nothing moved
  or shrank the picture as a phone's photo editor does when a crop is pushed
  back to the edge. A pinch while editing zoomed the view and hid the frame,
  and a pinch out did nothing, where a phone's crop tool zooms the picture
  under the frame.
- **A trim took minutes, and the file grew** (D99, 2026-10-28, after D98).
  The user trimmed 4 min 50 s off the start of a 75-minute lecture, 1080p in
  H.264 and 340 MB: the line under the editor said "Saving… 9%" long after
  letting go, the save took about 4 minutes, and the file came out at 619 MB.
  Measured in a development window on a generated 75-minute 1080p video of
  354 MB with a key frame every 10 s: 364 s to save a trim of its first
  289 s. Every frame kept was decoded and encoded again, at a bitrate of at
  least 0.07 bits for each pixel of each frame, more than a lecture's. A
  phone's photo editor saves the same trim as fast as it copies the file: its
  compressed frames are copied, and the file's edit list says where the
  video starts and ends.
- **The strip of frames did not line up with the picture** (D99). Under the
  player it stood 14 px inside the picture's edges on both sides, the room
  of the handles, which viewing does not show.

## Goals

- **View first, then edit** (D96): Card Detail of a video, an image, or a
  sound opens to look at the file, as a phone's photo library shows a photo;
  **Edit** shows its editor in place, and **Done** goes back to viewing.
  Nothing of the picture moves when the editor comes and goes.
- **A change is the result** (D85): in the editor a change is saved as it is
  made. There is nothing to press to save it, and Done saves nothing.
- **A trim is saved at once** (D99): a trim of a video copies its frames and
  sound, as a phone's photo editor saves one, so that a save takes about as
  long as copying the file, whatever its length. Nothing of an MP4 or a MOV
  is encoded again.
- **The gestures are the canvas's** (D96): a two-finger swipe moves, a pinch
  zooms, and a pinch zooms the place under the fingers as a browser zooms its
  page.
- **A crop as a phone's photo editor has it** (D97): the rest of the original
  stays in sight while cropping, a frame pushed to the edge brings the
  picture to it, and a pinch zooms the picture under the frame, so a crop is
  always taken back the way it was made.
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
- **An edited file looks and sounds like its original did**: a video's
  frames and sound are the original's, bit for bit; an image's pixels and a
  sound's samples keep their scale and rate, and no cut that joins sound
  clicks.

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
- **Viewing** and **editing**: the two ways the editor shows the file
  (D96). Viewing shows the file as it is, to look at and play; editing shows
  the controls that change it, from the original. Card Detail opens to
  viewing; **Edit** goes to editing, and **Done** back.
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
  save it: Done only goes back to viewing, and changes nothing of the file
  (D96).
- **The editor shows a change at once**, drawn from the original: the player
  plays the part kept, the waveform joins the parts kept, and the crop view
  shows the part kept. Nothing waits for the file.
- **The file follows.** Once the choices have rested for 0.3 s, BaseHalf writes
  the edit of the original into the file, and the record beside it; at once
  when Card Detail closes or shows another file, and when the window closes,
  which waits for the writes that are left; and before the file is moved,
  copied, or deleted in the window, so that a Duplicate right after a change
  copies the change. Writes of a file run one at a time, in the background: a
  change made while one runs is written after it. The rest takes a burst of
  keys as one write; since a trim copies instead of encoding, a longer one
  would only keep the file behind the editor (D99).
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
  older ones the edit is made again from the original, and the original's
  own bytes come back as they are.
- Editing keeps nothing in the kept versions of exact undo: undo puts back
  choices, and the original holds what the Trash would hold. So editing puts
  nothing in the Trash.
- A step that cannot be undone as it was says why and changes nothing, as a
  step of the canvas does: "'shot.mp4' changed meanwhile. Undo did not change
  it." and "'shot.mp4' is not there any more."

### Revert to Original

- Under the editor of an edited file, its line says what the edit is and
  offers **Revert to Original**: "Trimmed to 1.0s–4.5s · Revert to Original",
  its times as the player shows them, "Trimmed to 4:49–75:17" from a minute
  on (D99). It is one step, "Revert shot.mp4 to Original": the original's bytes go back
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

- **Card Detail opens to view the file** (D96), as a phone's photo library
  shows a photo: the picture of an image as the file holds it, the player of
  a video with the frame viewer under it as its timeline, and the waveform of
  a sound with Play under it, each as the file is, with nothing of editing on
  it ([Viewing and editing](#viewing-and-editing)).
- **Edit** stands in the header's right group, before Close
  ([layout controls](layout-controls.md#card-detail)), for a file that
  BaseHalf can edit. It shows the editor in place, with the original of an
  edited file and the choices of its edit: the crop frame and the tools of an
  image, the yellow frame and the handles of the frame viewer over the whole
  original, the handles, the trims, and the selection of the waveform, and
  the line under the editor. Edit becomes **Done**, drawn in the yellow of the
  editor, which goes back to viewing; Escape does too
  ([The keyboard](#the-keyboard)). Card Detail that closes, or shows another
  file, ends the editing: it opens to viewing again.
- Edit and Done change nothing of the file, and nothing waits for Done:
  changes save themselves ([Changes save themselves](#changes-save-themselves)).
- **Nothing moves when the editor comes and goes.** The picture keeps its
  place and its size, and is drawn in every frame, when Edit and Done are
  pressed: the room of the tools under it is kept while viewing, empty under
  an image, and holding the timeline under a video and Play under a sound. A
  zoom of the picture, of an image or of a video, glides back to as it fits
  in 200 ms when Edit is pressed, as a phone's photo editor shows the whole
  picture to edit it (D97, D101); a pinch while cropping zooms the picture
  under the frame. The picture is drawn in every frame.
- A file that BaseHalf cannot edit shows as a plain view, an image in its
  page and a video or a sound in the player, without Edit, and nothing says
  why: there is no control to explain ([Failure](#failure)). So does every
  media file in a workspace folder that BaseHalf leaves alone, which keeps no
  card information ([spec-driven development](spec-driven-development.md)).
- **The line under the editor**: while editing, for an edited file, what the
  edit is and **Revert to Original** ([Revert to Original](#revert-to-original)).
  While viewing and editing, "Saving…" with the share done once a write has
  taken more than 1 s and while it goes on, after the line of an edited file
  (D99): a write that ends sooner shows nothing. And the failure of a write,
  with **Try Again**; nothing else. It keeps its height while it is empty.

### Viewing and editing

| | Viewing | Editing |
| --- | --- | --- |
| An image | the picture as the file holds it; the room of the tools empty | the rest of the original dimmed around the part kept, the crop frame on it while the pointer is over the picture or the keyboard is on it, and the tools under it ([Cropping an image](#cropping-an-image)) |
| A video | the frame viewer shows the file: the frames of the part kept, from its start to its end, with the playhead; a press moves the playhead; Play plays the file through once | the frame viewer shows the whole original, the part kept in its yellow frame, with its handles and length; the part plays over and over ([Editing a video](#editing-a-video)) |
| A sound | the waveform shows the sound as the file holds it, from the first handle to the second, with the playhead; a press moves the playhead; Play plays it through once | the waveform shows the trims at its ends outside the handles, the handles, and a selected stretch with Delete; the part between the handles plays over and over ([Editing a sound](#editing-a-sound)) |

- While viewing, the time that the player of a video and Play of a sound show
  counts from the start of the part kept, to the length of the file.
- While viewing, the controls of editing take no keyboard and no pointer:
  the crop frame and its corners, the handles, and the tools.

### The keyboard

- **The keyboard is the media's** (D100): the player of a video, the
  waveform of a sound, and the picture of an image. Card Detail opens with
  the keyboard there, a click on the picture puts it there, and so does
  going back to viewing; it shows no ring there, as a page shows none around
  its text. **A press with the pointer leaves the keyboard where it was**, as
  the system's own buttons do: on Play, the sound button, Full Screen, the position
  slider, Edit and Done, a handle, the crop frame and its corners, a tool,
  the dial, Revert to Original, Try Again, and Delete. Only the keyboard
  moves it to a control, with Tab, and the control then shows its ring.
  Edit and Done are buttons of the header; pressed with the keyboard, the
  keyboard stays on the button they become. While editing, the controls of
  the editor follow in the order of their places, after the header's.
- **Space** plays and pauses a video or a sound with the keyboard on its
  media, or nowhere; on a button that Tab took the keyboard to, it presses
  the button, and on a handle it plays and pauses.
- **Escape**, during a drag in an editor, only ends the drag and puts back
  what the drag changed; with a part of a sound selected, it only drops the
  selection; while editing, it goes back to viewing, wherever in Card Detail
  the keyboard is; otherwise it closes Card Detail
  ([opening and closing Card Detail](card-detail-opening.md#the-keyboard)).
  One press does it after any control was used: going back to viewing takes
  the keyboard from a control of editing to the media, and Escape with the
  keyboard nowhere, on the window's own body, is Card Detail's.
- **Left** and **Right** move the playhead of a video or a sound a second
  back or on, and **Home** and **End** move it to the start and the end of
  what its timeline shows: the file while viewing, the original while
  editing. **Shift** with Left or Right moves a video one frame back or on,
  and pauses it first, where BaseHalf knows its frames: in a video it can
  edit. A sound, and a video it cannot edit, move a second with Shift too. A
  video or a sound that plays goes on playing from where the key put it. The
  keys work with the keyboard anywhere in Card Detail: on the media, on a
  button, in the player at full screen, or nowhere, on the window's own body.
  A control that takes them itself takes them first: a handle while editing,
  the position slider of a video that BaseHalf cannot edit, and a field of
  text. They change nothing of the file and move no card.
- **Command+Z** (Control+Z on Windows and Linux) undoes the last step of the
  canvas, a change of an edit among them, and **Shift+Command+Z** redoes it,
  with the keyboard anywhere in Card Detail outside an editor of text
  ([exact undo](exact-undo.md#undo-while-card-detail-is-open)).
- When an undo, a redo, or a write changes the file that Card Detail shows,
  the editor stays, and the keyboard stays on the control it was on.
- A control shows a focus ring only when the keyboard moved the focus there,
  as in the player
  ([architecture invariants](../harness/architecture-invariants.md#product-shell)):
  a key pressed on the media lights up no control.

### Zooming the picture and the time

A pinch of the trackpad zooms what is under the fingers (D93): the picture of
an image or a video, as a phone's photos do, and, while editing, the time of a
video or a sound, as editors of video and sound and a phone's voice recorder
do. The gestures are the canvas's (D96,
[canvas wheel gestures](canvas-wheel-gestures.md)): a two-finger swipe and the
mouse wheel move what is zoomed, and a pinch, or the wheel with Command (Ctrl
on Windows and Linux) or Ctrl held, zooms it. **The wheel alone never zooms**
in Card Detail.

- **A pinch over the picture of an image or a video**, while viewing, and
  over a video's while editing, zooms the place under the fingers as a
  browser zooms its page (D96), never the edit: the point under the pointer
  stays under it, and
  the picture grows past its own box, over the whole media area of Card
  Detail, as the page under a browser's toolbar does. Card Detail's controls
  keep their place and their size over it: the header, the player's
  controls, Edit or Done, the frame viewer, Play, the tools, and the line
  under the editor. **The zoomed picture shows under them**, as a phone's
  photos show under its bars (D101): nothing of Card Detail's background
  hides it in a band, and the frame viewer and the line under the editor
  stand on a translucent backing that blurs the picture behind them, as the
  player's controls do (D98), with 6 px of it around them and rounded
  corners. The backing fades in over 150 ms once the picture grows past its
  box and out when it fits again; at rest they stand on Card Detail's
  background as before. The media area zooms from
  as it fits up to 5 times that, as a browser zooms a page, or up to twice
  the picture's own pixels when that is more. A pinch follows the fingers, by
  e^(−Δy / 100) for each of its events, the measure the browser gives a
  pinch, and a notch of the wheel with the zoom key zooms by at most 10%, as
  over a note. The crop view of an image zooms so while viewing, and so does
  the player of every video in Card Detail, edited or not. **While an image
  is edited**, a pinch, the wheel, and a two-finger swipe over its picture
  are the crop's instead, as in a phone's crop tool: they zoom and move the
  picture under the crop frame (D97, [The crop frame](#the-crop-frame)).
- **A picture zoomed in** moves with a two-finger swipe and the wheel, and
  with a drag on it, **as far as its own edges go**, as a phone's photos do
  (D101): an edge of the zoomed picture stops at the edge of the media area,
  so that no room around the picture shows beside it, and along a side where
  the zoomed picture is no larger than the media area a drag, a swipe, and
  the wheel do not move it, and it stays wholly inside the area. A pinch
  follows the fingers, the place under them staying under them past these
  edges if they go there, and 150 ms after its last movement the picture
  glides in 200 ms to where its edges allow, as a phone's photos settle; as
  it fits, that is where it rests. A drag or a swipe that starts before it
  has settled settles it at once. The pointer over it is
  a grab hand. Over a video, a drag neither plays nor pauses it, a click that
  does not move plays and pauses it, and a double click fills the screen, as
  at rest; over an image, a double click shows it as it fits, or, as it
  fits, at its own pixels around the pointer. Escape during the drag puts the
  picture back where the drag took it from and leaves Card Detail open.
  Done, the frame viewer, a change and its undo, Full Screen, and a change
  of the size of Card Detail keep the zoom, as far as the new size allows;
  Edit shows the picture as it fits, in a glide of 200 ms (D97, D101). Card
  Detail opens with the picture as it fits, and so does a file
  shown anew. As it fits, a swipe and the wheel over the picture move
  nothing.
- **An image that BaseHalf cannot edit**, a GIF, an AVIF, a BMP, or an SVG,
  shows in its page with −, Fit, 100%, and + at the bottom right. A pinch
  over it, and the wheel with Command (Ctrl on Windows and Linux) or Ctrl
  held, zoom it as − and + do, from 10% to 800% of its pixels, around the
  pointer; the wheel without them scrolls a picture larger than the view, and
  a picture smaller than the view stays in its middle. The browser gives a
  pinch over a page to the window, which hands it on to the page, as for a
  PDF ([zoom and outline of a note](note-zoom-and-outline.md), L5).
- **While editing, a pinch over the frame viewer of a video or the waveform
  of a sound spreads its time out** around the pointer, and so does the wheel
  with Command (Ctrl on Windows and Linux) or Ctrl held, as over a note: by
  e^(−Δy / 100) for each event, a notch of the wheel at most 10%. The time
  under the pointer stays under it, from the whole length down to half a
  second, or, for a video, to as many frames as the strip has pictures when
  that is longer. Pinching in to the whole length ends it.
  - While it is spread out, a sideways swipe of two fingers and the wheel
    move it along, as far as the start and the end go. The yellow frame, the
    handles, the selected stretch, and the playhead are cut at its edges
    where they lie outside it, and a handle outside it does not show. While
    the stretch changes, a thin bar over the bottom of the strip shows where
    it lies in the whole length, and goes 1 s after the last change, as
    BaseHalf's scrollbars float and hide.
  - A press, a drag of a handle or of the part, a selection, and Delete work
    there as on the whole length, at the times under the pointer. A drag of
    a handle, of the part, of the playhead, or of a selection that comes
    within 24 px of an edge of the strip, or goes past it, moves the stretch
    along (D98), as a phone's trim follows a handle held against its edge,
    by the rule the crop frame of an image follows too
    ([The crop frame](#the-crop-frame)). The depth of the pointer counts
    from the margin's inner side, the edge itself being 24 and a pixel past
    it one more; each second the stretch moves by that depth / 100 of its
    length, at most 4 times its length, until the start or the end of the
    length is in view. Meanwhile what the drag holds stays at the margin's
    inner side, at the time the moving stretch shows there, so that it never
    slides under the strip's edge; once the start or the end is in view, it
    goes on to the edge. Bringing the pointer back out of the margin stops
    the stretch. The stretch only moves; its length stays. A held handle's
    spread moves along so too. Holding a handle still spreads the
    viewer further around it when the hold's stretch is the shorter one, and
    letting go of the handle shows the stretch the pinch chose again.
  - While the video or the sound plays, the stretch follows the playhead:
    when the playhead leaves it, the stretch of the same length that begins
    at the playhead shows.
  - The frame viewer shows its pictures stretched while the fingers move,
    and reads the frames of the new stretch 150 ms after the last movement;
    the waveform draws its bars anew in every frame.
  - A trim, a cut, their undo and redo, and a change of the size of Card
    Detail keep the stretch, as far as the length then allows. Card Detail
    opens with the whole length, and Done shows the file's length again.
  - While viewing, the frame viewer and the waveform show the length of the
    file, and a pinch over them does nothing.
- **A pinch elsewhere in Card Detail of a video or a sound**, over the player
  of a sound that BaseHalf cannot edit, Play, the line under the editor, the
  tools, and what made a generated file, does nothing. A pinch in Card Detail
  never zooms the window or the canvas under it.

## Editing a video

### The frame viewer

- Under the player, 12 px below it and as wide as it (at least 280 px where
  the space allows), the **frame viewer**: a strip 48 px high of the
  original's frames across its whole length, as many pictures as fit at its
  height in the picture's shape, each the frame at the middle of its place.
  The player and the viewer are centered together in the space the player
  had.
- **The strip lines up with the picture** (D99): its ends stand under the
  picture's left and right edges, within 1 px, while viewing and while
  editing, and Edit and Done move the strip itself nowhere. The handles stand
  outside the strip's ends, so that while editing a part that reaches the
  video's start or end has its handle outside the picture's edge.
- **The viewer is the video's timeline**: the player above it shows Play, the
  time, its sound button, and Full Screen, and no bar of its own for the time.
  The player's sound button mutes only the playing; it changes nothing in the
  file.
- **The part kept** has a yellow frame around it, 3 px above and below, with
  a handle 14 px wide outside each of its ends that carries a dark chevron;
  the strip outside it is dimmed. While the whole video is kept, the frame is
  white.
- **The playhead** is a white line at the time the player shows, and follows
  it while it plays.
- **The length of the part** is in its middle, or above the viewer over its
  middle when the part is narrower than the label, in tenths of a second under
  a minute and in minutes and seconds from a minute on, never more than it is,
  as the player shows times (`3.5s` for 3.57 s).
- **While viewing** (D96), the viewer is the timeline of the file as it is: the
  frames of the part kept, from its start to its end, across the strip, with
  the playhead, and no yellow frame, handles, shade, or length. A press
  anywhere on it moves the playhead there, and a drag from there moves it
  along. Edit shows the whole original under the same strip, with the part
  kept in its frame where it lies; Done shows the file again. **The strip
  glides between them** (D101): over 250 ms its stretch goes from the part to
  the whole original, or back, its pictures moving and scaling with the
  times they show, while the yellow frame, the handles, and the shade fade
  in or out; the pictures of the new stretch then fade in over the moved
  ones.
- **The pictures come together**, as a phone's filmstrip shows them (D101).
  Each is the frame at the middle of its place, or, when the video has a key
  frame within half a place of that middle, the key frame nearest it, which
  is read without the frames before it, as a phone's thumbnails are; the
  pictures of a held handle's spread are so too. A set of pictures shows
  once all of it is read, fading in over 120 ms over what the strip showed;
  a set that takes longer than 1 s shows what is read then and fades in the
  rest as it comes. Until the first set is read, the strip is its empty
  shade. The pictures of the whole original and of the part kept are kept
  while Card Detail shows the file, so that Edit and Done read them once.

### The pointer

- **A drag of a handle** moves that end of the part, to the nearest frame
  edge. It pauses the player, and while it moves, the player shows the frame
  at the handle: the first frame of the part at the start handle, the last at
  the end handle. Letting go of it is a change, "Trim shot.mp4".
- **A handle held still for 0.4 s** spreads the viewer out around it: the
  viewer then shows a tenth of the video, or 2 s, whichever is longer, around
  the handle's time, with its frames read anew, so that the handle moves a
  frame at a time across a wider stretch of the screen; releasing it shows the
  whole video again, or the stretch that a pinch spread out
  ([Zooming the picture and the time](#zooming-the-picture-and-the-time)).
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
- While viewing, the player plays the file through once, as a card's player
  plays a video: the part kept, from the playhead to the part's end, where it
  stops, and from the part's start when Play is pressed there. Its time
  counts from the part's start, to the part's length.

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
- With the keyboard anywhere else in Card Detail, Left, Right, Home, and End
  move the playhead ([The keyboard](#the-keyboard)).

## Cropping an image

### The crop view

- Card Detail of an image shows the picture as its edit made it: the original,
  turned, flipped, and straightened as the choices say, as large as fits in
  Card Detail with a margin of 24 px, and the part kept.
- While viewing, that is all it shows: the rest of the original is hidden,
  and the room of the tools under the picture stays empty (D96).
- While editing, **the rest of the original shows around the part kept,
  dimmed**, as a phone's photo editor shows it, at rest too, so that what a
  crop left out stays in sight and can be taken back (D97). It comes and goes
  with Edit and Done in 150 ms; the picture does not move.
- While editing, the **crop frame** stands on the edges of the part kept: a
  white frame with thick corners and a handle in the middle of each side. It
  shows while the pointer is over the picture or the keyboard is on the
  frame, and fades out otherwise. While a corner, a side, or the picture is
  dragged, the dimmed rest grows lighter, to show what the drag can take in,
  and lines divide the part into thirds.
- While editing, under the picture, a row of tools, from left to right:
  **Turn Left**, **Flip**, **Ratio**, and the **Straighten** dial. Revert to
  Original, in the line under them, sets everything back.

### The crop frame

- **A drag of a corner or of a side** moves it, keeping the ratio when one is
  set, and never past the picture: the part kept is always all picture, with
  no empty corner, also while the picture is straightened. The corner or the
  side across from it keeps its place on screen. Letting go of it is a
  change, "Crop still.png".
- **Pushed to the edge, the frame brings the picture to it** (D97), as a
  phone's photo editor and the photo app do when a crop is pushed back
  "against the edge of the window":
  - A corner or a side dragged into the margin of 24 px inside the view's
    edge, or past the view, stops at the margin's inner edge. The frame never
    leaves the view.
  - While it is held there, the picture follows: it moves and grows smaller
    around the corner or the side across from the one dragged, which keeps its
    place, so that the frame takes in more of the original.
  - It is faster the deeper the pointer is: by e^(−r) of its size each second,
    where r is the depth past the margin's inner edge divided by 100 px, at
    most 4, as a strip moves along past its edge (D93). Each frame of the
    screen zooms by its own share of that.
  - It stops when the pointer comes back inside the margin, and when the
    original's edge is in reach of the frame, in each way the frame is
    pushed, as far as the part may go with its ratio and its angle. It also
    stops when the whole picture fits the view as it fits.
  - So one drag takes a crop back to the original's edge.
- **A drag inside the frame**, away from its corners and sides, while the
  part is smaller than the picture, moves the picture under the frame, as far
  as its edges go: the frame stays still and the picture follows the pointer
  exactly, with nothing moving at the press or the release, as a phone's photo
  editor moves the photo under its crop with a finger and the photo app with a
  drag in the middle (D97). A drag that a trackpad's three-finger drag makes is
  such a drag. Letting go is a change, "Crop still.png". While the part is the
  whole picture, a drag there does nothing.
- **When a drag of a corner or a side ends**, the frame and the picture stay
  where they are for 1 s, as the photo app waits "a second", then glide in
  200 ms until the frame is as large as fits, at the middle of the view. A
  press within that second starts from where they are. A ratio from its menu
  glides at once; keys glide 0.6 s after the last one.
- **A pinch over the picture**, or the wheel with the zoom key, zooms the
  picture under the frame around the pointer (D97), as a phone's crop tool
  and the photo app do. The frame keeps its place and its size, and the part
  kept changes: it grows smaller as the picture grows, down to the smallest
  part, and larger as the picture shrinks, as far as the picture holds with
  the part's ratio. Near an edge of the original the picture slides so that
  the part stays all picture. A pinch follows the fingers by e^(−Δy / 100)
  for each of its events, and a notch of the wheel with the zoom key zooms by
  at most 10%, as over every picture in Card Detail.
- **A two-finger swipe and the wheel** over the picture move the picture
  under the frame, as a drag inside it does, with the fingers, as far as its
  edges go.
- A pinch and a swipe are each one change, "Crop still.png", once they have
  rested for 150 ms, as a gesture ends
  ([Zooming the picture and the time](#zooming-the-picture-and-the-time)); one
  that changes nothing is no change.
- A double click while editing does nothing. Card Detail opens with the
  picture as it fits, and Edit shows it as it fits, gliding from a zoom of the
  view.
- **The size of the part** stands under the frame while it is dragged,
  pinched, or swiped, in pixels of the original (`1600 × 900`).

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
- **While viewing** (D96), the waveform shows the sound as the file holds it:
  its kept parts joined from the first handle to the second, across the
  strip, with its joints and the playhead, and no yellow frame, handles,
  trims, or length. A press moves the playhead there, a drag from there moves
  it along, and Play plays the sound through once, to its end. Edit shows the
  trims at its ends outside the handles, as below.
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

- **Nothing is encoded again** (D99). An MP4, M4V, or MOV holds the
  original's compressed frames and sound packets as they are. Its picture
  keeps the frames from the key frame that the first frame of the part needs
  through the last frame that the part's frames need, in the order they are
  decoded. Its sound keeps the packets from the ones that the first packet
  shown needs, two of AAC or 80 ms of Opus, to one after the one at the end.
  A new index lists them, and the edit list of
  each track shows the track from the start of the part to its end:
  - the picture from the frame at the start, each frame at its own time,
    counted from 0, to the end of the last frame shown before the end; no
    frame is added, dropped, or moved, and a variable frame rate keeps its
    times;
  - the sound from the start to the end, to the sample, in sync with the
    picture as in the original. A sound that starts after the part does, or
    ends before it, keeps that delay and that end. A video without sound has
    no sound track.
- **What is not shown stays in the file, hidden**: the frames from the key
  frame before the start, at most the time between two key frames, but the
  whole part before the start of a generated video that has one key frame;
  the frames after the end that the frames before it need; and the packets
  of sound around the start and the end. The window's player, the system's
  video reader, and ffprobe read the edit list and show none of them; a
  program that does not read edit lists shows them too.
- **The sound is cut without fades**: its packets are the original's.
- **Its format** is the original's: its container and brands, its codecs,
  their bitrates, and its sample descriptions as they are, with the shape of
  its pixels, its colors, and its HDR information; the coded size and the
  matrix of its track; and the boxes at the level of the file, such as its
  title, its creation date, and the label that marks generated content
  (GB 45438-2025), unchanged. The index goes before the frames, so that the
  file plays while it is still being read. Its size is the original's for the
  part kept, with what stays hidden.
- **A WebM** has no edit list that players read:
  - its frames are copied from the first key frame at or after the start of
    the part, through the last one shown before its end. The frames before
    that key frame, from the frame at the start on, are encoded again by the
    window in the video's codec, VP8 or VP9, from the key frame before them,
    the first of them a key frame; none is when the start is a key frame;
  - its Opus sound in mono or stereo is copied from 80 ms before the start to
    the packet at the end, and cut at the start by the file's codec delay and
    at the end by the discard padding of its last block, which can drop only
    from that packet; another sound is encoded again in Opus, whole;
  - a WebM whose picture the window cannot encode in its codec, as AV1 or VP9
    of more than 8 bits, is encoded again whole: the picture in VP9 and the
    sound in Opus. The picture's bitrate is then at least the original's: its
    average bitrate times 1.25 when the codec stays and times 2 from AV1; at
    least 0.07 bits for each pixel of each frame; between 1 and 100 Mbit/s.
    The first frame is a key frame, and then about every 2 s. The sound comes
    up over its first 5 ms and goes down over its last 5 ms where the part
    cuts into it, at the original's bitrate snapped to 96, 128, 160, or 192
    kbit/s, at 48 kHz.

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
| `.m4a` | for an edit that keeps one part, its packets as they are, the part shown by the edit list, as a video's sound is (D99); for one that joins parts, AAC encoded again by the window, at the original's bitrate snapped to 96, 128, 160, or 192 kbit/s |
| `.ogg` | Opus encoded again by the window, also from Vorbis, in an Ogg of its own |

- Where a cut starts or ends the sound, and on both sides of a joint, the
  sound fades over 5 ms, so that no cut clicks; not at the ends of an M4A
  whose packets are copied. An MP3 fades by the gain of its
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

- The edited file is written into the workspace's cache folder
  (`.bh/cache/edit/`), and put in its place with its record, so that no part
  of a file ever shows in its place. An MP4, M4V, MOV, or M4A whose packets
  are copied is written by the shared process, from its new index, made in
  the window, and the ranges of the original that it copies (D99); the bytes
  of its frames never pass through the window. Every other edited file is made
  in memory from the original.
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

- An edited file that is built in memory is limited by it: a WebM whose size,
  estimated from its bitrate and length, would pass 2 GB is refused before the
  save starts; an image over 16,384 pixels on a side, or 256 million pixels,
  and a sound longer than 30 minutes, or whose file passes 256 MB, are refused
  the same way. A video whose frames are copied has no such limit.
- Only the picture and the first sound of a video are used; other tracks are
  not in the edited video.
- The frame viewer reads the frames of a video once when the editor opens, and
  again where it is spread out; with few key frames, a long video's pictures
  appear one by one.
- A write of a video copies its bytes, as long as the disk takes to copy
  them, while the line says Saving… with the share done once it has taken
  1 s; a change while it runs is written after it. Measured on 2026-10-28 in
  a development window from letting go, the rest of 0.3 s with it, on a busy
  machine (load 21 to 31): 0.9 to 1.1 s for a trim of the first 289 s of a
  75-minute 1080p video of 354 MB, which took 364 s when it was encoded
  again; 0.4 s for a trim of a 1-minute 1080p clip; 0.6 s for a trim of a
  3-minute 720p WebM, from a key frame or between two. Measured on
  2026-10-27, after the rest of 1 s: 0.2 s for a crop of a PNG of
  2048 × 2048, and 0.04 s for a cut of a WAV of 6 s; an undo or a redo to
  what was written before puts the bytes back in about 15 ms.
- A WebM takes longer to save than an MP4 of the same size by the frames that
  it encodes again: VP8 and VP9 are encoded by the window in software. Its
  frames are read into the window, and it is built in memory.
- A picture of odd width or height that a WebM encodes again whole is encoded
  one pixel narrower or lower when the window's encoder refuses its size.
- What `.bh/cache/edit/` keeps of the last 8 writes of a video takes room on
  the disk as large as each write, until the window closes.
- An MP3 is cut at frame edges, about 26 ms apart at 44.1 kHz.
- A copy of an edited file on a disk that cannot clone files takes as much
  room again for its original.

## Acceptance criteria

1. Card Detail of a video, an image, and a sound opens to view it: no crop
   frame with the pointer over the image, no tools, no handles, no yellow
   frame, and Edit in the header before Close; Edit shows the editor and
   becomes Done, and Done goes back; a GIF shows its page, without Edit or an
   editor, and nothing that says why.
2. After Edit, in the frame viewer, dragging the start handle shows the frame at the
   handle, moves the yellow frame, and changes the length; holding a handle
   still for 0.4 s spreads the viewer around it; moving a handle within 1.0 s
   of the other pushes it.
3. Letting go of the start handle of a 5 s video at 1.0 s, and of the end
   handle at 4.5 s, with nothing pressed after: within 3 s the video is 3.5 s
   of it, its first frame shown the original's at 1.0 s, and every sample it
   holds byte for byte one of the original's (D99);
   `.bh/mirror/<path>/original.mp4` is byte for byte the video before, and
   `edit.yaml` holds the part kept. The Edit menu's Undo names "Trim shot.mp4".
4. Card Detail of that video, opened again, shows the whole 5 s original in the
   viewer with the handles at 1.0 s and 4.5 s; widening the part to 0.5 s gives
   4.0 s of the original, made from the original.
5. Revert to Original on it puts back the original's bytes and removes
   `original.mp4` and `edit.yaml`; undo of it brings the edit back byte for
   byte; redo reverts again.
6. Command+Z with the keyboard on a handle undoes the last trim in the viewer
   at once and in the file; Shift+Command+Z redoes it, byte for byte.
7. Cropping a 2048 × 2048 PNG to 16:9 with Ratio gives a PNG of 2048 × 1152
   whose pixels are the original's rows kept; a quarter turn and a flip give
   the original's pixels turned and mirrored; an angle of 10° leaves no empty
   corner. While viewing, a pinch over the picture zooms the view and changes
   no edit; the wheel without the zoom key zooms nothing.
8. Delete on a selected stretch of a WAV, and letting go of a handle, give a
   WAV of the kept samples, with 5 ms fades at the joints, its other chunks
   unchanged; an MP3 edited the same way decodes in the window without an
   error, its frames otherwise byte for byte the original's.
9. A copy of an edited file can be reverted to the original; a deleted edited
   file put back from the Trash after its window closed can be reverted.
10. A file changed by another program after its edit shows as it is, without
    Revert to Original, and its first change keeps it as the new original.
11. While viewing, Escape closes Card Detail; while editing, it goes back to
    viewing and leaves Card Detail open, also with the keyboard on Done;
    during a drag it puts back what the drag changed and leaves the editor
    open. After a ratio chosen from its menu, Turn Left, and a press on the
    frame viewer, one Escape goes back to viewing and the next closes Card
    Detail.
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
15. From the first frame that Card Detail of a video, an image, or a sound
    shows its picture or its waveform, recorded on every frame, the picture
    keeps its place and size while the frame viewer, the crop tools, or Play
    stand in the space under it, and when Edit and Done are pressed, both
    ways, also with a video's picture zoomed in (an image's glides to as it
    fits, criterion 26); no frame shows the picture taken
    away or drawn anew, also when a change, its write, its undo, and Revert
    to Original land; and closing Card Detail shows no frame without the
    card's picture (the user, 2026-10-27: the video "jumped up" and "flashed"
    when Edit was pressed, and Cancel flashed).
16. A pinch made through the browser's protocol, by 1.6, over the picture of
    a video of 1280 × 720 in Card Detail draws it 1.6 times larger, with the
    point that was under the pointer within 2 pixels of it along each side
    where no edge of the picture stands on the media area's (D101), past the
    box of its player, which keeps its place and size, and the controls at
    their size; between the player and the frame viewer the picture shows,
    also after a swipe (criterion 33). A drag then moves the picture
    and does not play it; a click plays it; a pinch by 0.5 shows it as it
    fits. A video of 854 × 480 that fits at 1,280 pixels zooms to 5 times
    that.
17. The same pinch over an SVG draws it 1.6 times larger around the pointer,
    and Fit shows it as it fits again; over a PNG it zooms the crop view while
    viewing, and zooms the picture under the crop frame while editing
    (criterion 25).
18. After Edit, a pinch by 4 over the middle of the waveform of a sound spreads its time
    out 4 times around the pointer, the time under the pointer within a bar
    of where it was; the wheel then moves it along. A press there moves the
    playhead to the time under the pointer, and a drag there selects a
    stretch that Delete cuts out, while the waveform stays spread out. A
    pinch by 2 over the frame viewer of a video spreads it 2 times, and
    within a second of the last movement its pictures are frames of the new
    stretch.
19. A pinch over Play, the line under the editor, the player of a sound
    that BaseHalf cannot edit, and, while viewing, the frame viewer and the
    waveform changes nothing, and no pinch in Card Detail changes the zoom of
    the window or of the canvas.
20. Over a picture zoomed in by a pinch, a two-finger swipe and the wheel
    move it with the fingers and zoom nothing; over a picture as it fits they
    change nothing (the user, 2026-10-27: a two-finger swipe zoomed and only
    a three-finger drag moved, the opposite of the canvas).
21. While viewing a video trimmed to 1.0 s–4.5 s of 5 s, the frame viewer
    shows 3.5 s of frames and no handle, the player says `0.0s` and `3.5s`, and
    Play plays to the end of the part and stops there; while editing it plays
    the part over and over.
22. Edit, then Done, with nothing changed between, leaves the file, its
    record, and the undo as they were; a change after Edit is saved with
    nothing more pressed; Card Detail closed while editing opens to viewing
    again.
23. A PNG of 2400 × 1600 cropped to 1320 × 880 by its top left corner, once
    the frame has come to rest: the same corner dragged into the view's
    margin and held there takes the part back to the original's top left in
    one drag (the user, 2026-10-28: a crop could not be taken back to the
    original's size, and the picture did not move and shrink at the edge).
    Recorded on every frame:
    - the frame stays inside the view;
    - the bottom right corner keeps its place on screen within 1 px;
    - the picture's scale goes down in every frame while the pointer is held
      past the margin's inner edge, and stops once the original's edges are in
      reach;
    - no frame lacks the picture.
    Let go, the part is 2400 × 1600, and once written the file is the
    original's bytes, with no original and no record left.
24. While editing, the rest of the original shows dimmed around the part
    kept, also at rest; while viewing, it does not show. Let go, the frame stays
    where it was for 1 s, within 1 px, then is at rest within 300 ms more; a
    press within the second starts from there.
25. While editing a PNG of 2400 × 1600, a pinch by 2 over the picture leaves
    the frame's place and size on screen within 1 px and halves the width and
    the height of the part kept around the pointer. A pinch by 0.5 brings it
    back, and a further pinch out stops at the largest part of its ratio that
    the picture holds. Each pinch is one step, "Crop still.png". The wheel
    with Command zooms as a pinch, and a two-finger swipe moves the picture
    under the frame, also one step. A double click changes nothing. A pointer
    drag inside the frame, recorded on every frame, keeps the frame within
    0.5 px and the picture's offset from the pointer within 0.5 px, moves
    nothing at the press or the release, and is one step.
26. Edit pressed with the picture zoomed in by a pinch while viewing: the
    picture glides to as it fits in 200 ms, drawn in every frame, and the frame
    then stands on the part kept.
27. With the frame viewer of a 6 s video spread out around its held start
    handle, the pointer held 12 px inside the strip's right edge, without
    going past it, moves the stretch along, the handle 24 px inside the edge
    at a later time in every frame and never closer to the edge; moved back
    to 40 px inside the edge, the stretch and the handle stop; the stretch's
    length is the same throughout (D98). The waveform of a sound does the
    same.
28. A 75-minute 1080p MP4 of 354 MB with a key frame every 10 s, its start
    handle let go at about 289 s: the file holds the trim within 1.5 s of
    letting go, the rest of 0.3 s with it, and the line under the editor shows
    no "Saving…" for a write that ends within 1 s (the user, 2026-10-28: a
    trim of a 75-minute lecture took about 4 minutes, D99). The edited file is
    smaller than the original by about the part cut; every sample it holds is
    byte for byte one of the original's; and the window's player, the
    system's video reader, and ffprobe show its first frame as the original's
    at the start and its length as the part's, within a frame.
29. Card Detail of a 16:9 video in a window 3440 px wide, viewing and then
    editing: the strip's left and right ends stand within 1 px of the
    picture's edges, Edit and Done move none of its pictures, and while the
    whole video is kept the handles stand outside the picture's edges.
30. A WebM in VP8 or VP9 with Opus, trimmed from a time that is not a key
    frame: its first frame shown is the original's at the start, its frames
    from the next key frame on are byte for byte the original's, only those
    before it are encoded again, and its Opus packets are the original's,
    its sound starting at the start within a millisecond.
31. Card Detail of a 12 s video that BaseHalf can edit, opened by a double
    click, the keyboard on Play: Right three times moves the playhead from
    the start to 3 s, Left once to 2 s, Shift+Right one frame on, End to the
    file's last frame, and Home to its start, while no card under Card
    Detail moves; the same after a press on the frame viewer, with the
    keyboard on Edit or Done, and with it on the window's body. While
    viewing a part from 2 s to 8 s, Home and End stop at the part's ends;
    while editing, End goes to the original's last frame, and on a handle
    Right still moves the handle, a trim. The playhead of a sound moves a
    second with Right likewise (the user, 2026-10-28: the left and right
    arrows did nothing).
32. Card Detail of a video opened by a double click: the keyboard is on its
    player, and no element shows a ring, also after Right, Left, Home, End,
    and Space. While it plays with the pointer resting on the picture, its
    controls fade 2.5 s after a Right. A press on Play, Full Screen, Edit, or
    a handle with the pointer leaves the keyboard on the player; after a
    click on Edit, Space plays and pauses the video and the editing stays.
    Tab from the player takes the keyboard to the sound button, which then
    shows its ring. The same holds for a sound, with its waveform, and for
    an image, with its picture, which shows no ring after a key (D100; the
    user, 2026-10-28: a blue frame on Play at Left and Right).
33. Card Detail of a 16:9 video, zoomed in 2.5 times by a pinch and dragged
    400 px toward the bottom right: the picture's top and left edges stop at
    the media area's top and left edges, and no room around it shows; under
    the frame viewer the picture shows, blurred, through a backing 6 px
    around the strip, and no band of the background hides it anywhere. The
    same for an image while viewing. As it fits, the viewer stands on the
    background with no backing (D101; the user, 2026-10-28: a thick black
    edge under a zoomed video dragged toward the bottom right).
34. Card Detail of a 75-minute 1080p lecture with a key frame every 10 s,
    recorded on every frame from the double click: the frame viewer's
    pictures show together, within 1 s, each from a key frame, fading in over
    120 ms; no frame shows some of them and not others (D101; the user: the
    strip "不丝滑").
35. The same lecture with its first 5 minutes trimmed off, recorded on every
    frame: Done glides the strip from the whole original to the part kept in
    250 ms and Edit back, every frame showing pictures over the whole strip,
    none of them empty or torn; the pictures of the new stretch fade in once,
    together; Edit glides a zoomed picture back to as it fits in 200 ms (D101;
    the user: Edit and Done changed the strip "很奇怪").

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
- Unit tests of the copy of a trim (D99): the samples kept with a key frame
  before the start, frames shown out of order, a sound that starts late or
  ends early, and the edit lists, sample tables, and places of the new index,
  read back by BaseHalf's own reader; tests in the window of the unit tests
  that the window's player shows the frame at the start of a copied clip and
  plays it for its length; and a test of the shared process that writes a
  file from bytes and ranges of other files.
- Unit tests of zooming (`basehalfMediaZoom.test.ts`): the factor of a pinch
  and of the wheel with the zoom key, the largest zoom of a picture, the zoom
  of a media area around a point and its edges, a picture that stops at its
  own edges and does not move along a side where it is no larger than the
  area (D101), a move by a swipe, and a
  stretch of time spread out, moved along, kept inside the length, and
  following the playhead. Tests in the window of the unit tests of the zoom
  of a video's picture (`basehalfVideoPictureZoom.test.ts`: a pinch past the
  player's box, a swipe that moves and does not zoom, a drag and the click
  after it, Escape, and a smaller player) and of the time of the frame viewer
  and the waveform (`basehalfTimeZoom.test.ts`: a pinch, the zoom key, the
  wheel, the rest after a gesture, the bar, a drag past an edge, the
  playhead, a cut, and nothing while viewing).
- Tests in the window of the unit tests of viewing and editing
  (`basehalfMediaViewing.test.ts`): each editor opens to viewing with none of
  its controls of editing reachable, Edit and Done show and hide them without
  moving the picture, a press while viewing moves the playhead, the keys of
  the playhead within the file while viewing and the original while editing,
  Play while viewing plays once, and Escape goes back to viewing.
- Unit tests of the crop's gestures (D97): the part kept when the picture
  zooms under a fixed frame, with turns, angles, ratios, the smallest part,
  and the largest that the picture holds (`basehalfImageCrop.test.ts`); and,
  in the window of the unit tests, the crop view
  (`basehalfImageCropView.test.ts`): a corner pushed into the margin that
  brings the picture to it around the opposite corner and stops at the
  original's edge, the wait of 1 s before the glide, a pinch and a swipe
  while editing, each one change, and Edit that takes a zoom of the view
  back.
- Unit tests of the notes of originals whose file is gone, at opens on a file
  system in memory with a clock that moves on: a file that is back, a path
  whose move waits, a record that cannot be read, a folder that is gone, and a
  name that is taken.
- The smoke steps of the `cardDetail` suite: editing a video
  (`card-detail-video-edit`: viewing first, Edit, the handles, the file
  written with nothing pressed, the editor again from the original, undo and
  redo with the keyboard, Revert to Original and its undo, Escape back to
  viewing, viewing that plays the part once, criterion 31, the keys of the
  playhead with the keyboard on the player and nowhere, and criterion 32,
  the keyboard that stays on the player through presses of Play, Edit, and
  a handle, with no ring), cropping an image
  (`card-detail-image-edit`: an SVG shows no editor and no Edit; viewing
  first, a pinch that zooms only the view, Edit, Square, a turn and a flip, a
  wheel that zooms nothing, Revert to Original, Done, and undo; and
  `card-detail-image-crop-back`: criteria 23 to 26, a crop taken back to the
  original by a corner held in the margin, recorded on every frame, a pinch
  and a swipe while editing, and Edit from a zoomed view), and
  cutting a sound (`card-detail-sound-edit`: viewing first, the keys of the
  playhead, Edit, a stretch selected and cut, a trim, the editor again, undo,
  and Revert to Original),
  and pinching (`card-detail-media-pinch`: criteria 16 to 20 and 33, with
  pinches and swipes made through the browser's protocol). Unit tests of
  the key frames the frame viewer's pictures are read from
  (`basehalfVideoTrimPictures.test.ts`), and, in the window of the unit
  tests, of the strip's glide and its sets of pictures shown together.
- In a development window: each kind and format with the media of the
  development workspace, the time each write takes, the quality of the edited
  file against its original frame by frame, and the canvas card and Card Detail
  after each change and its undo and redo.

## Where this lands

`src/vs/workbench/basehalf/mediaEdit/` ([code organization](../harness/code-organization.md)):
the edit record, the choices of each editor, the readers and writers of each
format, the plan of a trim's copy and its index, what a zoom of a picture or
of the time computes, and the notes of originals whose file is gone in
`common/`, which the
mirror cascade runs at open after its sweep of orphaned badges
([mirror file resilience](mirror-file-resilience.md)); the editing of Card
Detail, the editors, the encoding with the window's encoders, and the service
that applies a change, writes the file after it, and keeps the steps of its
undo, in `browser/`, with the spreading out of the time that the frame viewer
and the waveform share, and viewing and editing of each editor. Card Detail
gives the editors the place of its view, Edit and Done in the header that its
host gives it, and zooms the picture of the player of every video
(`src/vs/workbench/basehalf/cardDetail/browser/`); the
player of a video gives the frame viewer its time, a jump to a time, and the
playing of a range; the waveform of a sound plays the edit itself, with the
window's audio. The shared process's file clones service
(`src/vs/platform/basehalfFiles/`) writes a file from bytes and ranges of
other files, which a trim's copy asks of it (D99).
