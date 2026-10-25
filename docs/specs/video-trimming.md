# Trimming a video

Status: Draft (2026-10-25, reviewed once; revised the same day: a trim
changes the video itself and can be undone, instead of saving a new clip)
Decision: [D79](../decisions.md#d79--card-detail-trims-a-video-in-place-and-undo-puts-it-back-new-2026-10-25)
Related: [generation cards](generation-cards.md) ("The player", "The file",
and "`made.yaml`"),
[opening and closing Card Detail](card-detail-opening.md),
[architecture invariants](../harness/architecture-invariants.md#product-shell),
public decision D82 (the old version of a file that BaseHalf replaces is
kept for undo)

This specification owns the trim bar under the video in Card Detail and
Trim, which replaces the video with the part the bar selects: which frames
and which sound that part holds, its format, how a generated video records
the trim, and how undo puts the video back. The player above the bar is the
player of every video
([generation cards, "The player"](generation-cards.md#the-player)); this
specification only adds what the bar asks of it. Keeping the old version of
a replaced file, and undo and redo of the replacement, belong to D82.

## Problem

Measured on 2026-10-25 in a development window and on the videos of the
development workspace:

- **The large video has room under it, and nothing to do with it there.** In
  a window of 1440 × 900, Card Detail plays a 16:9 video at 1082 × 608, with
  93 px empty above and below it; a narrower canvas area leaves more.
- **A clip with a bad start or end has to be cut in another program** and
  imported again. So does a shot cut to the length a model takes as a
  reference: providers take reference and source videos of 2 to 15 s or 3 to
  10 s, and some at most 5 s.
- **A generated video has few key frames, often one.** All five generated
  videos of the development workspace have one, at 0 s; a 1440p clip from
  another generator has two, at 0 s and 4.18 s. A cut that copies the
  compressed frames instead of encoding them again can start only at a key
  frame. Hiding the frames before the start behind an edit list, as the
  system's own trim does, keeps them in the file: a cut of 2.0 to 3.9 s of a
  5.18 MB clip took 4.47 MB that way and 1.23 MB encoded again, its end ran
  0.1 s over on clips with B-frames, and a program that ignores edit lists
  shows the hidden frames. What the file holds would not be what BaseHalf
  shows.
- **Encoding again is fast and close to lossless.** The window's hardware
  H.264 encoder took 295 frames per second at 480p, 360 at 1080p, and 90 at
  2160p on the development computer. A 480p generated clip encoded again at
  its own bitrate was 46.4 dB PSNR on average and 41.0 dB at its worst frame,
  48.0 dB at 1.5 times its bitrate.
- The canvas products for media work trim the same way: a strip of the
  video's frames under the enlarged video, a part chosen with two handles,
  and a confirmation.
- **A trim is an edit of the video.** The first build of this feature saved
  the part as a new file beside the video, and the user found that wrong: an
  edit changes what it edits, and undo takes it back, as every other change
  in BaseHalf can be taken back (D82).

## Goals

- Under the player of a video in Card Detail, a **trim bar**: choose the part
  of the video to keep, play it, and **Trim** the video to it.
- **Trim changes the video itself.** The file keeps its name, its folder, its
  card, and its connections; its content becomes the selected part.
- **Undo puts the video back**, byte for byte, and redo trims it again: a trim
  is one step of the canvas's undo, also with the keyboard in Card Detail.
- **The trimmed video holds what the player showed between the handles**: its
  first frame is the frame at the start handle, its last frame the one shown
  just before the end handle, and its sound is the sound of those frames, in
  sync.
- **It looks and sounds like the video did**: the same picture, the same
  frame times, at no lower a bitrate, and no click where the trim cuts into
  the sound.
- **A generated video still says what made it**, and that it was trimmed,
  and to which part of what was generated.

## Non-goals

- Cutting a part out of the middle, splitting a video into several clips,
  joining clips, changing speed, cropping, filters, and titles. The bar
  chooses one part, as the canvas products for media work do.
- Saving the part as a new file beside the video. A copy of the video, made
  first, is trimmed as any video is.
- Trimming a sound file. The bar is under the player of a video only.
- Trimming on the canvas. The card of a video plays it; Card Detail has the
  room for the bar.
- Choosing a part by an AI model.
- A trim that copies the video's compressed frames instead of encoding them
  again. See [D79](../decisions.md#d79--card-detail-trims-a-video-in-place-and-undo-puts-it-back-new-2026-10-25).
- Keeping the high dynamic range or the transparency of a video: a trimmed
  HDR video is in the standard range, as the window draws it, and a picture's
  transparency is not kept.
- Versions of a video beyond what undo holds. D82 owns how long the old
  version is kept.
- Showing the lengths that each model accepts.
- A command for agents. A trimmed video is a file that agents see like any
  other.
- Videos the window does not show as videos, such as `.mkv`: Card Detail has
  no player for them, and so no trim bar.

## Terms

- **Video**: the file that Card Detail shows: a file the window shows as a
  video ([architecture invariants](../harness/architecture-invariants.md#product-shell)),
  with the extension `.mp4`, `.mov`, `.m4v`, or `.webm`.
- **Picture**: the video's first video track; **sound**: its first sound
  track.
- **Frame edge**: the time at which a frame starts to be shown, and the end
  of the last frame. Times are as the player shows them: after the video's
  edit list, from 0.
- **Length of the picture**: from 0 to the end of its last frame. It can
  differ from the length the player says: the sound can run longer than the
  picture, and a recording may not say its length at all.
- **Trim bar**: the strip of frames under the player, with its handles, its
  playhead, and the Trim button.
- **Selection**: the part of the picture between the start handle and the
  end handle, both on frame edges. At first it is the whole picture.
- **Trim**: the action that replaces the video with the selection, and the
  step of undo it makes.

## The trim bar

### Where it is

- Card Detail of a video shows the trim bar under its player, 12 px below it,
  as wide as the player, and at least 280 px wide where the space allows it;
  in a narrower space it is as wide as the space. The player and the bar are
  centered together in the space the player had, which keeps the player's
  rules for its size with the bar's height taken from that space. The bar
  keeps the height of its status line also while the line is empty, so that
  the player does not move when a message comes and goes.
- For a video that is a generation card, the bar is between the player and
  the section that says what made the video
  ([generation cards, "The toolbar"](generation-cards.md#the-toolbar)).
- A sound has no trim bar. Neither does the player in full screen, which shows
  the player alone; there the player plays the whole video, and I and O do
  nothing.
- Card Detail does not wait for the bar. It is drawn, and fades in, when the
  video has the frame where it starts
  ([opening and closing Card Detail](card-detail-opening.md#opening)); the
  bar's frames appear when they are read, and until then the strip is empty.

### What it shows

From left to right, the **strip** and the **Trim** button. Under them, one
line of status.

- **The strip** is 48 px high and spans the length of the picture. It shows
  the picture's frames across it: as many pictures as fit at the strip's
  height in the picture's shape as it is shown, each the frame at the middle
  of its place. When the strip changes width, its pictures are laid out
  again.
- **The selection** has a light frame around it, and the strip is dimmed
  outside it. A **handle** stands just outside each edge of the selection,
  so that a short selection can still be seen and grabbed.
- **The playhead** is a thin line at the time the player shows, at the end of
  the strip when the player is past the end of the picture. It follows the
  player while it plays.
- **The length of the selection** is in its middle, or above the strip over
  its middle when the selection is narrower than the length: in tenths of a
  second under a minute, in minutes and seconds from a minute on (`1:05`),
  never more than it is, as the player shows its times (`3.5s` for 3.57 s).
  The length is that of the frames between the handles, so that 30 frames at
  30 per second are `1.0s`. The status line and the record of a trim show
  lengths and times the same way.
- **Trim** is a round button with a check mark. Its hover says **Trim** and
  its key, Enter. It is disabled while the whole picture is selected and while
  the video is being trimmed; its hover then says why: "Choose a part of the
  video first", "The video is being trimmed". A disabled Trim keeps the
  keyboard, so that Escape still closes Card Detail from it.

### The pointer

- **A drag of a handle** moves that edge of the selection, to the nearest
  frame edge. It pauses the player, and while it moves, the player shows the
  frame at the handle: the first frame of the selection at the start handle,
  the last at the end handle. After the drag, the player stays there.
- **The selection is at least 1.0 s long**, or the whole picture when the
  picture is shorter. A handle that is moved closer than that to the other
  one pushes the other one along, until it reaches the start or the end of
  the picture, where both stop.
- **Where the two handles meet**, a press takes the one whose side of the
  meeting point it is on.
- **A drag inside the selection, while it is shorter than the picture**,
  moves the selection with its length, to the nearest frame edges, as far as
  the start or the end of the picture. It pauses the player, and while it
  moves, the player shows the frame at the selection's start.
- **A press anywhere else on the strip**, or a press inside the selection
  that does not move, moves the playhead there: the player shows that time.
  A drag from there moves the playhead along.
- The pointer is a sideways arrow over a handle, a grab hand over a selection
  that can move, and the arrow everywhere else on the bar.
- A press on the bar is the bar's: it never reaches the player or the canvas
  under Card Detail.
- **The selection is kept** for the video while the window is open, as the
  player keeps where a video stopped: Card Detail opened again on the video
  shows it. When the video's file changes, by a trim, its undo, or anything
  else, the bar reads it again and selects the whole picture.

### Playing

- While the selection is shorter than the picture, the player plays the
  selection: Play starts at the selection's start when the playhead is
  outside the selection or on its last frame, plays to the selection's end,
  and goes on from its start again, until it is paused. No frame after the
  selection's end is shown: the player looks at each frame it shows. Before
  each jump back, the sound goes down over the last 100 ms of the selection,
  as it does at the end of a video, and it comes up after the jump, as for
  every jump of the position
  ([generation cards, "The player"](generation-cards.md#the-player)).
- While the whole picture is selected, the player plays as before.

### The keyboard

- The bar's controls take the keyboard after the player's: the start handle,
  the end handle, then Trim. Each handle is a slider that says its time and
  the picture's length. A control shows a focus ring only when the keyboard
  moved the focus there, as in the player
  ([architecture invariants](../harness/architecture-invariants.md#product-shell)).
- **On a handle**: Left and Right move it by 0.1 s, with Shift by one frame,
  with Command (Control on Windows and Linux) by 1 s; Home and End move it as
  far as it goes; Up and Down do what Right and Left do. Every step moves the
  handle at least one frame. A handle moved by the keyboard pushes the other
  one as a dragged handle does, and the player shows the frame at the handle.
- **I** and **O**, with the keyboard in the player or the bar, put the start
  at the start of the frame the player shows, and the end at the end of that
  frame, so that the frame on screen is in the trimmed video either way; the
  selection stays at least 1.0 s long.
- **Space** on a handle plays and pauses, as it does on Play.
- **Enter** on a handle trims the video, as Trim does when it is enabled.
- **Escape** closes Card Detail, as anywhere in it
  ([opening and closing Card Detail](card-detail-opening.md#the-keyboard)).
  During a drag of a handle or of the selection it ends the drag instead and
  puts the selection back where it was.
- **Command+Z** (Control+Z on Windows and Linux) with the keyboard in the
  player or the bar undoes the trim, and **Shift+Command+Z** redoes it, as on
  the canvas (D82).
- When the video is shown anew because its file changed, as after a trim, an
  undo, or a redo, the keyboard stays on the control it was on, so that the
  next Command+Z, Escape, or arrow key works where it did.
- The arrow keys on the bar move no card.

## Trimming

Trim replaces the video with the selection, in one step of undo.

### What the trimmed video holds

- **The picture**: the frames from the one at the start to the last one
  shown before the end, each at its own time, counted from 0; no frame is
  added, dropped, or moved. A video with a variable frame rate keeps its
  frame times. The picture keeps its coded size and the matrix of its track,
  which turns it as it turned the video. The first frame is a key frame, and
  then about every 2 s. Colors are as the window shows them.
- **The sound**: the sound of the video, from the start to the end exactly,
  with the video's sample rate and number of channels where the system's
  encoder takes them. Where the trim cuts into the sound, at its start or at
  its end, the sound comes up over the first 5 ms or goes down over the last
  5 ms, so that the cut makes no click; a cut at the sound's own start or end
  does not fade. The sound plays in sync with the picture, within a
  millisecond: the file's edit list, or the codec delay of a WebM, hides the
  delay that the encoder puts before the sound, and the edit list, or the
  discard padding of a WebM, the padding of its last packet. A video without
  sound stays without sound.
- **The file's information**: the information at the level of the file of an
  MP4 or MOV video, such as its title, its creation date, and the label that
  marks generated content (GB 45438-2025), is kept unchanged.

### Its format

The trimmed video keeps the video's container and extension, so that its
name, its card, and everything that names it stay as they were.

| Video | Trimmed video |
| --- | --- |
| `.mp4`, `.m4v`, `.mov` | the picture in H.264, or in HEVC when the video's picture is HEVC and the window can encode HEVC; the sound in AAC |
| `.webm` | the picture in VP9, the sound in Opus |

- The picture's bitrate is at least the video's own: its average bitrate
  times 1.25 when the codec stays, times 1.6 from HEVC or VP9 to H.264, times
  2 from AV1 to H.264 or VP9; and at least 0.07 bits for each pixel of each
  frame in H.264 and VP9, 0.05 in HEVC, because the window's encoders need
  more bits than the encoders that compressed most generated videos hardest;
  between 1 and 100 Mbit/s. Measured on 2026-10-25 on a 1440p clip at 60
  frames per second and 6.9 Mbit/s: 1.25 times its bitrate kept 41.1 dB PSNR
  on average and 36.3 dB at the worst frame, the floor (15.5 Mbit/s) about 44
  and 39. A recording of 640 × 360 in VP9 at 1.1 Mbit/s, trimmed to a WebM,
  kept 53.2 dB on average and 43.7 dB at its worst frame.
- The sound's bitrate is the video's, snapped to 96, 128, 160, or 192 kbit/s:
  the system's AAC encoder on Windows takes only these. Its sample rate is the
  video's when it is 44.1 or 48 kHz, and 48 kHz otherwise; Opus is always
  48 kHz. It is in stereo or mono as the video is.
- Where the window has no AAC encoder, as on Linux, an MP4 or MOV is trimmed
  without its sound, and the status line says so.
- A picture in 10 bits, or in a high dynamic range, is drawn as the window
  draws it and encoded in 8 bits, in the standard range.

### A generated video

- A generation card whose `made.yaml` can be read stays a generation card:
  the record still says what made the file, and it gets the part it was
  trimmed to, in seconds of what was generated (`trimStart` and `trimEnd`,
  [generation cards, "`made.yaml`"](generation-cards.md#madeyaml)). A second
  trim narrows the part within it. The panel of the card and Card Detail's
  section of what made the video say that it was trimmed, and to which part
  ([generation cards](generation-cards.md#the-panel-of-a-card-with-its-file)).
- The record's `id` stays, so a Sequence that names the video still finds it
  ([Video Sequence](video-sequence.md)). New Version makes a draft from the
  record as before, and generates the whole of a new video.
- A `made.yaml` that cannot be read is left as it is; the video is trimmed
  all the same.
- Undo puts back the record as it was, with the video, in the same step.

### Undo

- A trim is one step of the canvas's undo, named **Trim** and the video's
  name. Undo puts the video back as it was, byte for byte, with its record,
  and redo trims it again. The old version is kept as D82 keeps the old
  version of every file BaseHalf replaces.
- The canvas and Card Detail show the video's new content as soon as the file
  changes, after a trim, an undo, or a redo.

### While it is trimmed, and after

- The trimmed video is encoded in memory, written into BaseHalf's cache
  folder of the workspace (`.bh/cache/`), and then put in the video's place in
  one step, so that no part of a video ever shows in its place, and the
  canvas never draws a video that is not whole.
- While a video is trimmed, the status line says **Trimming the video…** with
  how much is done, and Trim is disabled. The handles can move: the trim keeps
  the selection it started with.
- A trim goes on when Card Detail closes or shows another file, and while the
  window is in the background or minimized. Card Detail of the video, opened
  again while the trim runs, says that the video is being trimmed. A window
  that closes or reloads during a trim stops it, and the video stays as it
  was; what that trim wrote into the cache folder is deleted by a trim an hour
  later or more.
- When it is trimmed, the status line says **Trimmed to** and the new length,
  and that Command+Z puts the video back; the whole of the new video is
  selected.
- When Card Detail does not show the video at the end of a trim, because it
  is closed or shows another file, the end is a notification: that the video
  is trimmed, or why it is not.

## Failure

- **A video that cannot be trimmed** shows the bar with what frames it can,
  Trim disabled, and the status line **BaseHalf can't trim this video:** and
  one of these reasons:
  - its file cannot be read as MP4, MOV, or WebM, or its index is damaged;
  - it has no picture;
  - its picture is put together from several parts by its edit list:
    BaseHalf reads an edit list of empty edits followed by one edit at the
    normal speed, which programs write for a delay or for B-frames, and no
    other;
  - its index is too large to read (more than 64 MB, or more than two
    million blocks of a WebM);
  - this system cannot decode its picture;
  - this system cannot encode a picture of its size.
- **Sound that cannot be decoded or encoded**: the video is trimmed without
  its sound, and the status line says so.
- **A trim that fails**, because the video cannot be read, the window cannot
  encode it, or its place cannot be written: the video stays as it was, no
  part of a trim is left in the cache, the status line says **BaseHalf could
  not trim the video:** and why, and Trim is enabled again.
- **A video that changes while it is trimmed**, in its size or its time of
  change, or that is moved, renamed, or deleted: the video is not replaced,
  and the status line says that it changed while it was being trimmed.

## Limits

- A trimmed video is built in memory before it is written: one whose size,
  estimated from its bitrate and length, would pass 2 GB is refused before
  the trim starts, and the status line says so.
- Only the picture and the first sound of a video are used; other tracks,
  such as subtitles and time codes, are not in the trimmed video.
- The strip reads the video's frames once when Card Detail opens it. It
  decodes from the key frame before each of its pictures, so the pictures of
  a long video with few key frames appear one by one.
- VP9 is encoded by the window in software: a WebM takes longer to trim than
  an MP4 of the same size.
- A picture of odd width or height is encoded one pixel narrower or lower
  when the window's encoder refuses its size.

## Acceptance criteria

1. Card Detail of a video shows the trim bar under its player, with the
   picture's frames, the whole picture selected, its length in the middle,
   the playhead at the player's time, and Trim disabled. Card Detail of a
   sound has none, and the bar does not delay Card Detail's fade.
2. Dragging the start handle shows the frame at the handle in the player,
   dims the strip before it, puts the handle on a frame edge, and changes the
   length. Moving a handle to within 1.0 s of the other pushes the other one,
   and both stop at the ends of the picture.
3. A drag inside a selection shorter than the picture moves it with its
   length; a press outside it moves the playhead there; Escape during a drag
   puts the selection back and leaves Card Detail open.
4. With a part selected, Play plays it from its start to its end and on from
   its start again until Pause, and no frame after the selection's end is
   shown, sampled on every frame; with the whole picture selected, the player
   plays as before.
5. On a handle, Left and Right move it by 0.1 s, Shift with them by one
   frame, Command or Control by 1 s, Home and End to its limits; I and O,
   with the player paused inside a frame, put the start at that frame's start
   and the end at its end; Enter trims; Space plays and pauses; Escape closes
   Card Detail; no arrow key moves a card.
6. Trim on a 5 s, 30 fps H.264 and AAC MP4 with 1.0 s to 4.5 s selected
   replaces it, under its name, with:
   - 105 frames, each of which, compared with the video's frame at the same
     time, is at least 40 dB PSNR and higher than with the frame before or
     after;
   - a length of 3.5 s, and sound of 3.5 s that starts at its first frame
     within 1 ms by cross-correlation with the video's sound, rises over its
     first 5 ms, and falls over its last 5 ms;
   - H.264 and AAC at the video's coded size and matrix, with the video's
     `udta` box and the label of generated content.
7. Undo of that trim puts back the video's bytes and its `made.yaml` exactly;
   redo trims it again; both with the keyboard on the trim bar.
8. A generated video's `made.yaml` keeps its `id` and gets `trimStart` and
   `trimEnd` with the part of what was generated; a second trim of 0.5 s to
   2.5 s of the trimmed video records 1.5 s to 3.5 s; the card's panel and
   Card Detail's section of what made the video show the trim.
9. A WebM is trimmed to a WebM with a VP9 picture and Opus sound that plays
   from its first frame and seeks to each frame. On a computer whose window
   can encode HEVC, an HEVC MOV is trimmed to an HEVC MOV. A video whose track
   turns it a quarter shows turned the same way after its trim. A video with
   a variable frame rate keeps its frame times.
10. A video whose picture cannot be decoded shows the bar with Trim disabled
    and the reason; a trim that fails leaves the video and the cache as they
    were and says why.
11. A video changed or renamed during its trim is not replaced, and the
    status line says why.
12. Card Detail closed during a trim: the video is trimmed, the canvas shows
    it, and a notification says so.
13. The selection is kept when Card Detail closes and opens again on the
    video, and is the whole picture again after the video changes.

## Verification

- Unit tests of the selection (frame edges, the minimum length, pushing,
  moving, the keyboard's steps, I and O), of the length label, of reading
  MP4, MOV, and WebM files (boxes, sample tables, fragments, edit lists,
  lacing) from small fixtures, of writing MP4, MOV, and WebM files (written
  and read back to the same samples), of the plan of a trim (which frames are
  decoded and which are kept, the range of sound, the bitrates), of the
  record of a trim in `made.yaml`, and of the fades.
- Tests in the window of the unit tests: a short MP4 and a short WebM encoded
  there with the window's encoders, trimmed, and decoded again, for the
  count, the times, and the first and last frames, and the length of the
  sound; a video with a click at a white frame, as an MP4 and as a WebM,
  trimmed, for the click at that frame by the window's own decoder of whole
  files; and a trim through the service on a file system in memory, for the
  replacement, the record, a video that changes while it is trimmed, and the
  step of undo it asks for.
- The smoke step `card-detail-video-trim` in the `cardDetail` suite: opens a
  video of the fixture in Card Detail, drags the handles, plays the
  selection, trims it, and checks the replaced file and the status line, then
  undoes and redoes the trim with the keyboard on the bar; and Escape on a
  handle.
- In a development window, with the generated videos of the development
  workspace, a 1440p clip at 60 frames per second, a video recorded as WebM,
  an HEVC MOV, a turned video, and a square one: the time a trim takes, the
  PSNR of the trimmed video against the video, frame by frame as the window's
  decoder gives them, the sync of the sound, the frame times Chromium
  presents against those the reader finds, every frame of a looping
  selection, and Card Detail and the card on the canvas after a trim, its
  undo, and its redo, twice.

## Where this lands

`src/vs/workbench/basehalf/videoTrim/` ([code organization](../harness/code-organization.md)):
the selection, reading MP4, MOV, and WebM, writing MP4, MOV, and WebM, and the
plan of a trim in `common/`; the trim bar, the strip's frames, the encoding
with the window's encoders, and the service that trims a video through the
replacement of D82 in `browser/`. Card Detail mounts the bar under the player
of a video; the player gives the bar its time, a jump to a time, and the
playing of a range. The record of a trim is part of `made.yaml`, which
generation cards own.
