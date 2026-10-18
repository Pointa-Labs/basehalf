# LTX

Status: Active (2026-10-19)
Decision: [D59](../../decisions.md#d59--video-providers-are-built-in-integrations-with-each-models-exact-settings-users-bring-their-own-keys-new-2026-10-19)
Parent: [Video providers and the model catalog](../video-providers.md)

This specification owns the LTX module of AI Video
(`vscode-base/extensions/basehalf-ai-video/src/providers/ltx.ts`): the
catalog entry it declares for Lightricks' LTX video models, the requests it
sends, how it reads LTX's answers, and how it estimates a price. What is the
same for every provider (the commands, the checks from the declarations,
retries, the download, plain messages) is owned by the parent specification
and is not repeated here.

## Sources

LTX's API documentation at `https://docs.ltx.io/`, where every page is also
served as Markdown (`<page>.md`) and the API as an OpenAPI 3.1 document
(`/openapi.json`). `https://docs.ltx.video/` answers with a browser challenge;
the API changelog of 2026-07-21 moved the API to `api.ltx.io`, and the
documentation lives under the same name. Every page below was read on
2026-10-18 and read again, unchanged byte for byte, on 2026-10-19, except
the legacy pages of retake, extend, audio to video, and image to video,
first read on 2026-10-19.

| Page (path) | What this specification takes from it |
| --- | --- |
| `welcome` | the console `https://console.ltx.io`; the endpoints LTX offers |
| `authentication`, `quickstart` | the API key in `Authorization: Bearer`; the base URL `https://api.ltx.io`; `202 Accepted` with a job id |
| `models`, `models/ltx-2-5`, `models/ltx-2-3` | the four model ids, which endpoint each takes, resolutions, frame rates, durations, sizes, automatic duration |
| `api-documentation/api-reference/async-video-generation/submit-text-to-video`, `submit-image-to-video`, `submit-audio-to-video`, `submit-extend`, `submit-retake` | the request of each endpoint, its fields, values, defaults, and errors |
| `api-documentation/api-reference/async-video-generation/get-job-status` | `GET /v2/{endpoint}/{id}`, the job states, `result`, `error`, the retention of a job |
| `api-documentation/api-reference/upload/create-upload` | `POST /v1/upload`, its answer, the signed upload, how long it lasts |
| `api-documentation/api-reference/video-generation/*` (legacy) | the V1 endpoints end on 2026-10-26; extend makes sound for the extension when the clip has sound |
| `async-jobs` | the job lifecycle, the result map, polling advice, retention |
| `migrate-v1-to-v2` | the V2 endpoints replace V1 on 2026-10-26; the upload stays `/v1/upload` |
| `input-formats` | data URIs, the upload, sizes per method and endpoint, image, video, and audio formats |
| `errors`, `rate-limits`, `debugging` | the error shape and types; concurrency (2 by default) and the job queue |
| `pricing` | prices per second by model, endpoint, and resolution |
| `api-changelog` (entries to 2026-10-12) | LTX-2 removed on 2026-08-15; 1:1, 3:2, and 2:3 on LTX-2.5 on 2026-10-12; 1440p, 4K, and 48 fps on LTX-2.5 Pro on 2026-09-02; the V1 retirement |
| `openapi.json` | the exact schemas: required fields, `maxLength: 5000` of every prompt, enums, the job status variants |

The upload hands out a signed address of Google Cloud Storage (LTX's example
answer asks for the headers `x-goog-content-length-range` and
`x-goog-if-generation-match: 0`, and its video addresses are on
`storage.googleapis.com`). What those two headers do is taken from Cloud
Storage's XML API header reference (`https://cloud.google.com/storage/docs/xml-api/reference-headers`,
read on 2026-10-19): a body outside the length range is refused with 400, and
with `x-goog-if-generation-match: 0` a PUT creates the object only when it
does not exist yet and is otherwise refused with 412.

## Region and credentials

| Region | Label | Base URL | Currency | Console |
| --- | --- | --- | --- | --- |
| `global` | LTX API | `https://api.ltx.io` | USD | `https://console.ltx.io` |

- One credential, `apiKey` (**API Key**), sent as `Authorization: Bearer
  <key>`. It is made in the Developer Console.
- The endpoint is the API's root: jobs are under `<endpoint>/v2/…` and the
  upload is `<endpoint>/v1/upload`. A relay that mirrors LTX's API is entered
  as its root. The former name `https://api.ltx.video` keeps working (API
  changelog, 2026-07-21) and can be entered as the endpoint.
- Only the asynchronous V2 endpoints are used. The synchronous V1 endpoints
  (`/v1/text-to-video` and the others), which hold the request open and
  answer with the file, stop working after 2026-10-26.

## Models

One catalog model per LTX model id. LTX takes the same id at every endpoint,
so `providerModels` gives that id and `check` answers no `providerModel`. The
mode and the inputs of a generation choose the endpoint.

| Catalog id | Label | Sent as | Modes |
| --- | --- | --- | --- |
| `ltx-2-5-fast` | LTX-2.5 Fast | `ltx-2-5-fast` | Frames, References |
| `ltx-2-5-pro` | LTX-2.5 Pro | `ltx-2-5-pro` | Frames, References |
| `ltx-2-3-fast` | LTX-2.3 Fast | `ltx-2-3-fast` | Frames |
| `ltx-2-3-pro` | LTX-2.3 Pro | `ltx-2-3-pro` | Frames, References, Edit, Extend |

| Mode and inputs | Endpoint |
| --- | --- |
| Frames without a start frame | `POST /v2/text-to-video` |
| Frames with a start frame, and an end frame if any | `POST /v2/image-to-video` |
| References (an audio track, an image if any) | `POST /v2/audio-to-video` |
| Edit | `POST /v2/retake` |
| Extend | `POST /v2/extend` |

- The endpoint table of `models`: text and image to video on every model;
  audio to video on both LTX-2.5 models and on LTX-2.3 Pro; retake and extend
  on LTX-2.3 Pro only.
- Every model has an estimate and none is deprecated.
- Prompts: every request schema bounds the prompt at 5,000 characters
  (`maxLength: 5000`). Every model declares `withoutMedia`, the rule of its
  loosest endpoint: audio to video needs a prompt unless an image is sent
  ("Required if image_uri is not provided"), and retake and extend take one
  only if given. Text and image to video both require a prompt, so `check`
  adds that Frames with a start frame needs one too.

## Modes and inputs

| Mode | Models | Start frame | End frame | Images | Audio | Clip |
| --- | --- | --- | --- | --- | --- | --- |
| Frames (`frames`) | all | optional | optional | — | — | — |
| References (`reference`) | 2.5 Fast, 2.5 Pro, 2.3 Pro | — | — | 0 to 1 | exactly 1 | — |
| Edit (`edit`) | 2.3 Pro | — | — | — | — | required |
| Extend (`extend`) | 2.3 Pro | — | — | — | — | required |

- Frames without an image is text to video. An end frame needs a start frame
  (`last_frame_uri` interpolates from `image_uri`).
- References is audio to video: the audio track sets the length of the video,
  and an image, when one is connected, is LTX's `image_uri`, which the
  endpoint uses as the first frame (its page calls it "a reference image for
  visual direction"). The model descriptions say so.
- Images, in Frames and References: PNG, JPEG, or WebP, the three formats of
  the contract, so no `imageFormats` is declared; at most 15 MiB
  (`imageMaxBytes: 15728640`; "images are capped at 15 MB" when used in a
  generation). LTX states no limits on image sizes in pixels.
- Audio, in References: WAV, MP3, or M4A, the formats whose length AI Video
  reads (LTX also takes OGG, which AI Video cannot measure, so it is
  refused); at most 32 MiB (`audioMaxBytes`), the size LTX states for audio
  sent by address; at most the model's longest audio, `audioTotalSeconds` 20
  on LTX-2.5 Fast and LTX-2.3 Pro and 10 on LTX-2.5 Pro. At 1440p and 4K every
  model takes at most 10 seconds, which `check` reports with files.
- Clips, in Edit and Extend: MP4 or MOV (LTX also takes MKV, which a Video
  node does not connect); at most 32 MiB for Edit (video input "is capped at
  32 MB on most endpoints") and 100 MiB for Extend (`videoMaxBytes`). Both
  endpoints need at least 73 frames, "around 3 seconds at 24fps"; AI Video
  does not count frames, so `check` asks for 3 seconds, with files. LTX
  states no longest clip, so no `videoSeconds` is declared, and `check`
  itself refuses a clip whose length it cannot read. Clips may be up to 4K,
  and Extend takes 16:9 and 9:16 clips only; AI Video does not measure a
  video's size, and LTX refuses another.
- The sizes are LTX's "MB" read as MiB, as its own upload header writes
  200 MB as `0,209715200`.

## Parameters

| Name | Label | Kind | Values (default in bold) | Models | Modes | Sent as |
| --- | --- | --- | --- | --- | --- | --- |
| `resolution` | Resolution | choice | `720p` (720p), **`1080p`** (1080p), `2k` (2K, LTX's 1440p), `4k` (4K) | all | Frames, References | `resolution`, with the ratio, as `WIDTHxHEIGHT` |
| `ratio` | Ratio | choice, ratio shapes | LTX-2.5: **`16:9`**, `9:16`, `1:1`, `3:2`, `2:3`; LTX-2.3: **`16:9`**, `9:16` | all | Frames, References | the shape of `resolution` |
| `duration` | Duration | integer, seconds | Fast: 6 to 20, step 2; Pro: 6 to 10, step 2; default **6**; Auto (`-1`) on LTX-2.5 | all | Frames | `duration`, `null` for Auto |
| `fps` | Frame Rate | choice, advanced | **24**, 25, 48, 50 (labels "24 fps", …) | all | Frames, References | `fps` |
| `sound` | Sound | boolean | **on** | all | Frames | `generate_audio` |
| `camera_motion` | Camera Motion | choice, optional | `dolly_in`, `dolly_out`, `dolly_left`, `dolly_right`, `jib_up`, `jib_down`, `static`, `focus_shift` (Dolly In, …, Focus Shift) | all | Frames, References | `camera_motion`, only when set |
| `start_time` | Start | number, seconds | 0 to 3,600, step 0.1, **0** | 2.3 Pro | Edit | `start_time` |
| `retake_duration` | Length | number, seconds | 2 to 3,600, step 0.1, **5** | 2.3 Pro | Edit | `duration` |
| `retake_mode` | Replace | choice | **`replace_audio_and_video`** (Video and Sound), `replace_video` (Video), `replace_audio` (Sound) | 2.3 Pro | Edit | `mode` |
| `extend_duration` | Extension | integer, seconds | 2 to 20, step 1, **5** | 2.3 Pro | Extend | `duration` |
| `extend_mode` | Extend At | choice | **`end`** (End), `start` (Start) | 2.3 Pro | Extend | `mode` |
| `context` | Context | integer, seconds, optional, advanced | 1 to 20 | 2.3 Pro | Extend | `context`, only when set |

- The defaults are LTX's own: 1080p is the size audio to video makes without
  one, 24 fps and sound on are the defaults of the endpoints that take them,
  and the retake and extend values are those of LTX's examples (start 0,
  length 5) and defaults (`replace_audio_and_video`, `end`). No duration of
  5 seconds exists in Frames, so its default is the shortest, 6.
- Resolutions use the shared values and labels: LTX's 1440p tier,
  between 1080p and 4K, is the shared `2k`, labeled 2K.
- Sizes, `WIDTHxHEIGHT`, as `models/ltx-2-5` lists them; LTX-2.3 has the
  16:9 and 9:16 columns only:

  | Resolution | 16:9 | 9:16 | 1:1 | 3:2 | 2:3 |
  | --- | --- | --- | --- | --- | --- |
  | 720p | `1280x720` | `720x1280` | `720x720` | `1080x720` | `720x1080` |
  | 1080p | `1920x1080` | `1080x1920` | `1080x1080` | `1620x1080` | `1080x1620` |
  | 1440p | `2560x1440` | `1440x2560` | `1440x1440` | `2160x1440` | `1440x2160` |
  | 4K | `3840x2160` | `2160x3840` | `2160x2160` | `3240x2160` | `2160x3240` |

- The ratio applies with a start frame too: image to video requires a
  `resolution`, and the video has that shape.
- Edit and Extend send no resolution: retake makes 1080p in the clip's
  orientation when none is sent, and extend keeps the clip's size.
- The shared `duration` is the length of the video; the length of a retake
  section and of an extension are other quantities with other ranges, so
  they are LTX's `duration` under the names `retake_duration` and
  `extend_duration`, and LTX's two `mode` fields are `retake_mode` and
  `extend_mode`.
- `start_time` and `retake_duration` are bounded at 3,600 seconds by AI
  Video: a declared number needs a maximum, and LTX states none. The section
  must lie in the clip; a section past the clip's end ends with the clip.
- LTX has no seed, negative prompt, prompt rewriting, or watermark setting.

### Rules between parameters

`check` reports these after the checks of the declarations, in this order:

| Models | Rule | Source |
| --- | --- | --- |
| all | Frames with a start frame needs a prompt | image to video: `prompt` required |
| 2.5 Fast, 2.3 Fast | a duration over 10 seconds needs 720p or 1080p and 24 or 25 fps | support matrices |
| 2.5 Fast, 2.5 Pro | Auto cannot be used with an end frame | `models/ltx-2-5`, image to video |
| 2.5 Fast, 2.5 Pro, 2.3 Pro | with files, the audio is at most 10 seconds at 1440p and 4K | audio to video, maximum audio duration |
| 2.3 Pro | with files, a clip of Edit or Extend is an MP4 or MOV of at least 3 seconds | retake and extend, `video_uri` |
| 2.3 Pro | with files, the Edit section starts before the clip ends | retake, `start_time` |

`submit` also refuses, before anything is sent, a WAV whose audio is PCM
(format 1, or 3 for floating point, also in their extensible form): LTX takes
WAV with AAC-LC, MP3, Vorbis, or FLAC audio inside and says "PCM audio is not
supported". `check` measures lengths only and cannot tell.

## Inputs and the upload

- An image goes inline as a data URI, `data:<type>;base64,…` with the type
  its header shows, when that data URI is at most 7,000,000 characters (a
  data URI's "max encoded size" is 7 MB for images); a larger image goes
  through the upload.
- Videos and audio always go through the upload.
- An upload, for each such file, after every input was read and checked:
  1. `POST /v1/upload` with the key and no body answers `upload_url`,
     `storage_uri`, `expires_at` (one hour), and `required_headers`;
  2. `PUT upload_url` with the file's bytes, `Content-Type` of its format
     (`image/png`, `image/jpeg`, `image/webp`, `video/mp4`,
     `video/quicktime`, `audio/wav`, `audio/mpeg`, `audio/mp4`), and every
     header of `required_headers` unchanged. The address is the storage's,
     so the key is not sent. A 2xx answer is done. The address names a new
     object and its headers forbid overwriting, so a retried upload that
     finds its own earlier copy (HTTP 412) is done too. Any other refusal is
     `rejected`, naming the input, with the storage's `<Code>` and
     `<Message>`;
  3. the input is the `storage_uri` (`ltx://…`), kept by LTX for 24 hours.
- Uploads are retried as every upload is; a failed upload makes no job. An
  answer without `upload_url` or `storage_uri`, or whose `required_headers`
  holds anything but header names with text values, cannot be read, and the
  input is refused. `Content-Length`, `Host`, `Connection`, and
  `Transfer-Encoding`, which AI Video sets itself, are not taken from
  `required_headers`.
- HTTPS addresses, LTX's third way, are never sent.

## Requests

All requests carry `Authorization: Bearer <key>`; a create carries
`Content-Type: application/json` and is sent once.

**Frames without a start frame:** `POST /v2/text-to-video` with

```json
{ "prompt": "<prompt>", "model": "ltx-2-5-fast", "duration": 6, "resolution": "1920x1080", "fps": 24, "generate_audio": true, "camera_motion": "dolly_in" }
```

**Frames with a start frame:** `POST /v2/image-to-video` with

```json
{ "image_uri": "data:image/png;base64,…", "last_frame_uri": "data:image/jpeg;base64,…", "prompt": "<prompt>", "model": "ltx-2-5-pro", "duration": 8, "resolution": "1440x1440", "fps": 24, "generate_audio": true }
```

**References:** `POST /v2/audio-to-video` with

```json
{ "audio_uri": "ltx://uploads/…", "image_uri": "data:image/png;base64,…", "prompt": "<prompt>", "model": "ltx-2-3-pro", "resolution": "1920x1080", "fps": 24 }
```

**Edit:** `POST /v2/retake` with

```json
{ "video_uri": "ltx://uploads/…", "start_time": 0, "duration": 5, "mode": "replace_audio_and_video", "prompt": "<prompt>", "model": "ltx-2-3-pro" }
```

**Extend:** `POST /v2/extend` with

```json
{ "video_uri": "ltx://uploads/…", "duration": 5, "mode": "end", "context": 8, "prompt": "<prompt>", "model": "ltx-2-3-pro" }
```

- `last_frame_uri` only with an end frame; `camera_motion` and `context`
  only when set; `duration: null` for Auto.
- The prompt is always sent to text and image to video, which require it, and
  to the other endpoints only when it has text other than spaces.
- The answer is `202` with `{id, created_at}`. `submit` answers the task id
  `<endpoint>/<id>`, such as `image-to-video/a1b2c3d4-…`: a job is asked about
  at the endpoint it was made at, and a task's records keep only its remote
  id. An answer without an `id` leaves the outcome unknown.

### Asking about a job

`GET /v2/<endpoint>/<id>`, the endpoint and the id read from the task id. A
task id that names no endpoint above is refused, and nothing is sent.

| LTX `status` | Answer |
| --- | --- |
| `pending` | `pending` (queued) |
| `processing` | `running`; LTX reports no progress |
| `completed` | `succeeded` with `result.video_url`; without one, the answer cannot be read |
| `failed` | `failed` with the job's `error`: its message and type, read as an error answer is |
| any other | the answer cannot be read |

- HTTP 404 means the job does not exist or has expired (`notFound`). LTX
  keeps a job's status for up to 24 hours after it ends, and may remove it
  sooner.
- The video's address is on Cloud Storage; the download sends it no
  credentials. LTX says output addresses expire on their own schedule, which
  it does not state; BaseHalf downloads at once.
- Where the video is (`videoLocation`), when a download has no address: the
  job is asked about again.
- **Cancel**: LTX has no cancellation. `cancel` sends nothing and answers
  false.

### Errors

LTX answers an error as `{"type": "error", "error": {"type", "message"}}`,
and a failed job carries the same `{type, message}` in `error`. The message
is a sentence of what it means and what to do, then LTX's type and words.

| Type (status) | Answer |
| --- | --- |
| `invalid_request_error` (400) | `rejected` |
| `authentication_error` (401) | `auth` |
| `insufficient_funds_error` (402) | `balance` |
| `permission_error` (403: the endpoint is not available to the account) | `rejected`, not `auth`: the key is valid |
| `not_found_error` (404) | by the status: `rejected` for a create, `notFound` otherwise |
| `content_filtered_error` (422) | `rejected` |
| `rate_limit_error` (429: the organization's job queue is full) | `rateLimited` |
| `concurrency_limit_error` (429: too many generations at once, 2 by default) | `rateLimited` |
| `api_error` (500), `service_unavailable_error` (503), `overloaded_error` (529) | by the status: `unknownOutcome` for a create, `network` otherwise |

A 429 that asks to wait (`Retry-After`) says the wait, as the contract has it.

## Estimate

```text
amount = price per second (model, endpoint, resolution) × seconds billed
```

In US dollars, from the price list read on 2026-10-19, which states no date
of its own (its last change in the API changelog is of 2026-10-12, when the
1:1, 3:2, and 2:3 sizes were priced as the 16:9 size with the same short
side). Prices per second:

| Model | Text and image to video: 720p / 1080p / 1440p / 4K | Audio to video: 720p / 1080p / 1440p / 4K | Retake | Extend |
| --- | --- | --- | --- | --- |
| LTX-2.5 Fast | 0.09 / 0.13 / 0.19 / 0.30 | 0.09 / 0.13 / 0.19 / 0.30 | — | — |
| LTX-2.5 Pro | 0.12 / 0.17 / 0.25 / 0.39 | 0.12 / 0.17 / 0.25 / 0.39 | — | — |
| LTX-2.3 Fast | 0.03 / 0.06 / 0.12 / 0.24 | — | — | — |
| LTX-2.3 Pro | 0.04 / 0.08 / 0.16 / 0.32 | 0.06 / 0.10 / 0.18 / 0.34 | 0.10 | 0.10 |

Seconds billed:

- Frames: the generated video, so the duration. With Auto, LTX bills the
  length it makes, which is known only after the run: the estimate runs from
  6 seconds, the shortest LTX lists, to the longest the resolution and frame
  rate allow (20 seconds on LTX-2.5 Fast at 720p or 1080p and 24 or 25 fps,
  10 otherwise).
- References: the input audio. With files it is measured; without them, the
  estimate runs from 0 to the longest audio the model takes at the
  resolution.
- Edit: the input clip, all of it. With files it is measured; without them,
  LTX states no longest clip, so there is no estimate.
- Extend: the extension and the context frames LTX uses, at most 505 frames
  together. The frame rate of the clip is not measured, so: with a Context
  setting, the extension plus the context or the clip's length, whichever is
  shorter (without files, the estimate runs from the extension alone to the
  extension plus the context); without one, LTX uses as much context as
  fits, up to 20 seconds, so the estimate runs from the extension alone to
  the extension plus 20 seconds or the clip's length, whichever is shorter.
- The price list names only the sizes 1920×1080 and 1080×1920 for retake and
  extend; their price is used at every size.

## Left out

- **HDR** (`/v2/video-to-video-hdr`): it converts a video to HDR and answers
  EXR frames (`exr_frames_url`), not an MP4: a video tool, not generation
  ([non-goals](../video-providers.md#non-goals)).
- **Reframe** (`/v2/video-to-video-reframe`): it fills a new frame around a
  video, and LTX picks its own model for it (a `model` sent is ignored), so
  it belongs to no catalog model; it reshapes a video rather than making one.
- **The last frame of audio to video** (`last_frame_uri` there): References
  takes images as references, not frames, and Frames takes no audio
  ([Video node, Inputs](../video-node.md#inputs)).
- **The retake's `resolution`**: it offers only 1920×1080 and 1080×1920, the
  same size LTX picks from the clip's orientation when none is sent.
- **HTTPS addresses as inputs**: BaseHalf sends files inline or through
  LTX's upload, never as public addresses.
- **LTX-2** (`ltx-2-fast`, `ltx-2-pro`): removed on 2026-08-15.
- **The V1 endpoints**: synchronous, and gone after 2026-10-26.
- **`x-request-id`**: AI Video logs only the method, path, status, and time
  of a request.

## Facts not confirmed

- The shortest audio that audio to video takes: LTX states none, so the
  estimate without files starts at 0.
- The shortest video Auto makes: LTX lists durations from 6 seconds; the
  estimate starts there.
- The size limit of uploaded audio when it is used: LTX states 32 MB for
  audio sent by address and a 15 MB cap for uploaded images; 32 MiB is taken.
  Whether LTX's "MB" means MiB everywhere: its upload header does.
- Whether image to video takes an empty prompt: the field is required, so
  BaseHalf asks for a prompt.
- Whether audio longer than 10 seconds needs 24 or 25 fps on the fast and
  2.3 models, as a duration does: the audio limit table names the model and
  the resolution only, so nothing is checked.
- Whether a Context longer than the clip is shortened or refused: the
  estimate assumes shortened.
- Whether LTX-2.3 takes `camera_motion`: the request schemas offer it with
  every model, and only the LTX-2.5 page names it.
- How long `result.video_url` stays valid.
- The price of retake and extend at sizes other than 1920×1080 and
  1080×1920.

## Acceptance criteria

1. The catalog has the provider `ltx` with one region, one API key, and the
   four models above with exactly their modes, limits, and parameters.
2. Each mode of each model sends the body above, once, to its endpoint, with
   the key in `Authorization`, and answers `<endpoint>/<id>`.
3. Images within 7,000,000 characters as a data URI go inline; larger
   images, videos, and audio are uploaded with the headers LTX asks for and
   without the key, and their `ltx://` address is sent; a retried upload
   that finds its copy (412) goes on; a refused upload makes no job.
4. Asking about a job uses the endpoint of its task id and maps `pending`,
   `processing`, `completed`, and `failed` as above; the video downloads from
   the address of the poll, or of a new question when the download has none.
5. `cancel` answers false and sends nothing.
6. 401 answers `auth`; 429 answers `rateLimited` with LTX's words; 402 is
   `balance`; `permission_error` is `rejected`; a create whose connection
   drops after it was sent answers `unknownOutcome` and was sent once.
7. `check` reports each rule above, and `submit` refuses PCM audio before
   anything is sent; a refused request sends nothing.
8. The estimate of three combinations of each endpoint matches the price
   list, and every price of the list is used as listed.

## Verification

`vscode-base/extensions/basehalf-ai-video/test/ltx.test.ts` runs the module
through the provider commands against local servers that answer like LTX's
API, its upload storage, and the address of a video. No test calls LTX or
uses a real key.
