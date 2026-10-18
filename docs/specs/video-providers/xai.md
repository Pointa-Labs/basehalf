# xAI

Status: Active (2026-10-19)
Decision: [D59](../../decisions.md#d59--video-providers-are-built-in-integrations-with-each-models-exact-settings-users-bring-their-own-keys-new-2026-10-19)
Parent: [Video providers and the model catalog](../video-providers.md)

This specification owns the xAI module of AI Video
(`vscode-base/extensions/basehalf-ai-video/src/providers/xai.ts`): the Grok
Imagine video models it declares, the requests it sends, how it reads xAI's
answers, and how it estimates a price. What is the same for every provider
(the commands, the checks from the declarations, retries, the download, plain
messages) is owned by the parent specification and is not repeated here.

## Sources

xAI's developer documentation at `https://docs.x.ai`, where every page is
also served as Markdown with `.md` added to its path. Every page below was
read on 2026-10-18 and read again, unchanged, on 2026-10-19 (only the rows
of some tables came in another order). The date is the page's own "Last
updated".

| Page (path) | Updated | What this specification takes from it |
| --- | --- | --- |
| `/developers/model-capabilities/video/overview` | 2026-10-08 | the three models and what each takes: modes, frames, references, durations, resolutions, ratios, sound |
| `/developers/model-capabilities/video/generation` | 2026-10-10 | the create and the poll, the statuses `pending`, `done`, `failed`, the defaults (8 seconds, 16:9, 480p), `generate_audio`, the request modes, the failure codes, temporary video URLs |
| `/developers/model-capabilities/video/image-to-video` | 2026-09-21 | a start frame as a public URL, a base64 data URI, or a Files API `file_id`; a frame with `last_frame` or references is reference to video |
| `/developers/model-capabilities/video/reference-to-video` | 2026-10-09 | up to 14 (1.5) and 7 reference images, 15 and 10 seconds, at most 720p; `<IMAGE_0>` tags; preset voices; `last_frame`; keyframes |
| `/developers/model-capabilities/video/editing` | 2026-10-09 | editing on `grok-imagine-video` only: an MP4 of at most 8.7 seconds, no duration, ratio, or resolution |
| `/developers/model-capabilities/video/extension` | 2026-10-09 | extension on `grok-imagine-video` only: an MP4 of 2 to 15 seconds, 2 to 10 seconds added (default 6); the status `expired` in its polling examples |
| `/developers/rest-api-reference/inference/videos` | 2026-04-13 | `POST /v1/videos/generations`, `/edits`, `/extensions`, `GET /v1/videos/{request_id}`, their fields, `progress`, `respect_moderation`, `error.code` |
| `/openapi.json` (read 2026-10-19) | — | the same schemas; the poll answers 200 when the task ended, 202 while it runs, and 404 for an unknown id; no cancel operation |
| `/developers/models/grok-imagine-video-1.5`, `/grok-imagine-video-1.5-lite`, `/grok-imagine-video` | none | the price per second at each resolution, the price of input images and input video seconds, the aliases, 10 requests a second |
| `/developers/models` | 2026-09-21 | the starting price per second of each model |
| `/developers/pricing` | 2026-10-10 | prices in USD; a generation that breaks the usage guidelines is still charged |
| `/developers/model-capabilities/imagine` | 2026-10-08 | duration and resolution set the price of a video |
| `/developers/model-capabilities/imagine/files`, `.../files/inputs`, `.../files/outputs` | 2026-07-30, 2026-07-30, 2026-10-09 | the generation URL is ephemeral, "only good for fetching the asset shortly after generation"; `file_id` inputs |
| `/developers/rest-api-reference/files/upload` | 2026-04-28 | the Files API upload (not used) |
| `/developers/debugging` (its HTML page) | 2026-05-13 | 400 for an invalid argument or an incorrect API key, 401, 403, 404 for an unknown model, 415, 422, 429 |
| `/developers/rate-limits` | 2026-10-05 | 10 requests a second per video model at the first tier, Imagine limits raised through xAI's sales team; 429 above the limit |
| `/console/billing` | 2026-10-10 | requests are rejected once the prepaid credits are used up or the invoiced billing limit is reached |
| `/developers/advanced-api-usage/regions` | 2026-10-10 | the US regional endpoint serves no video generation |
| `/developers/quickstart` | 2026-10-10 | the console page where keys are made |
| `/developers/faq/security` | 2026-10-10 | Zero Data Retention blocks Files API uploads |
| `/developers/release-notes` | 2026-10-13 | July 2026: `grok-imagine-video-1.5` takes text, image, and reference to video, 1080p for the first two |

The model pages give their prices in their HTML only: the Markdown version
lists one price per model, the 480p one.

## Region and credentials

| Region | Label | Base URL | Currency | Console |
| --- | --- | --- | --- | --- |
| `global` | Global | `https://api.x.ai/v1` | USD | `https://console.x.ai/team/default/api-keys` |

- One credential, `apiKey` (**API Key**), sent as `Authorization: Bearer
  <key>`. A key belongs to a team; the team's prepaid credits pay for it.
- Paths are under the endpoint as it is entered: the base URL already ends
  in `/v1`, and a relay that mirrors xAI's API is entered with its own path.
- The US regional endpoint (`https://us.api.x.ai/v1`) serves no video
  generation and is not offered.

## Following a task

Video generation is asynchronous: the create answers at once with
`{"request_id": "…"}`, and `GET /videos/{request_id}` answers the task's
status until it ends (Video Generation, "How it works"). BaseHalf records the
request id and asks about it, also after a reload. xAI has no way to cancel a
task.

## Models

| Catalog id | Label | Sent as (`global`) | Modes |
| --- | --- | --- | --- |
| `grok-imagine-video-1.5` | Grok Imagine Video 1.5 | `grok-imagine-video-1.5` | Frames, References |
| `grok-imagine-video-1.5-lite` | Grok Imagine Video 1.5 Lite | `grok-imagine-video-1.5-lite` | Frames (start frame only) |
| `grok-imagine-video` | Grok Imagine Video | `grok-imagine-video` | Frames (start frame only), References, Edit, Extend |

- xAI takes the same model id for every task; the mode chooses the endpoint
  (`/videos/generations`, `/videos/edits`, `/videos/extensions`). So `check`
  answers no `providerModel`.
- The name of each model is sent, not an alias such as
  `grok-imagine-video-1.5-2026-05-30`: a model's name is its latest stable
  version (Models, "Model Aliases").
- Every model has an estimate and none is deprecated.
- Prompt: `withoutMedia` on every model. A prompt is required for text to
  video; it is optional with a start frame ("Optional for image-to-video"),
  and on 1.5 with any frame or reference image (Video Generation, "Request
  Modes"). `grok-imagine-video` needs one in References, Edit, and Extend,
  which `check` reports. xAI states no longest prompt (a prompt that is too
  long fails as `invalid_argument`), so the catalog bounds it at 1,048,576
  characters, the most AI Video takes.

## Modes and inputs

| Model | Mode | Start frame | End frame | Reference images | Clip | Limits |
| --- | --- | --- | --- | --- | --- | --- |
| 1.5 | Frames (`frames`) | optional | optional | — | — | — |
| 1.5 | References (`reference`) | — | — | 1 to 14 | — | — |
| 1.5 Lite | Frames | optional | — | — | — | — |
| Grok Imagine Video | Frames | optional | — | — | — | — |
| Grok Imagine Video | References | — | — | 1 to 7 | — | — |
| Grok Imagine Video | Edit (`edit`) | — | — | — | required | 0.1 to 8.7 s |
| Grok Imagine Video | Extend (`extend`) | — | — | — | required | 2 to 15 s |

- Frames without an image is text to video, with a start frame image to
  video. A start and an end frame on 1.5 send `image` and `last_frame`, which
  xAI calls reference to video with a pinned first frame. 1.5 Lite and
  Grok Imagine Video do not take `last_frame` ("Classic grok-imagine-video
  still rejects last_frame").
- References needs at least one image: the node sends no voice or keyframe,
  the other inputs that select reference to video.
- Images are JPEG, PNG, or WebP, the three formats every mode takes, so no
  mode declares `imageFormats`; the window draws any other image to PNG. xAI
  states no image size or byte limit for video inputs.
- The clip of Edit and Extend is an MP4 ("`.mp4` with a supported codec such
  as H.264, H.265, or AV1"). Editing takes a clip "up to 8.7 seconds"; xAI
  states no shortest one, so the declared range starts at 0.1 seconds. With
  files, `check` refuses a MOV clip.
- No mode takes audio or reference videos: `reference_audios` takes preset
  voices, and clips of one's own only for partners xAI admits on request.

### Inputs travel inline

Every input is sent inline as a data URL, `data:<type>;base64,<bytes>`, the
type read from the file's bytes: `image/png`, `image/jpeg`, or `image/webp`,
and `video/mp4` for the clip. xAI takes images and videos that way ("Public
URL or base64-encoded data URL"), so nothing is uploaded: the Files API
(`POST /v1/files`) would keep a copy on the user's account until it expires,
bill its storage, and is blocked for teams with Zero Data Retention. xAI
states no largest request; AI Video sends at most 128 MiB, and `check` with
files reports a request whose inputs, encoded, would be larger.

## Parameters

| Name | Label | Kind | Values | Default | Models and modes | Sent as |
| --- | --- | --- | --- | --- | --- | --- |
| `resolution` | Resolution | choice | `480p`, `720p`, `1080p` (1.5, 1.5 Lite); `480p`, `720p` (Grok Imagine Video) | `480p` | Frames, References | `resolution` |
| `ratio` | Ratio (ratio shapes) | choice | `1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `3:2`, `2:3`, `21:9`, `5:2` | `16:9` | Frames, References | `aspect_ratio`, only without a start frame |
| `duration` | Duration | integer, seconds | 1 to 15, step 1 | 5 | Frames, References; Extend on Grok Imagine Video | `duration`, a number |
| `sound` | Sound | boolean | | on | Frames, References | `generate_audio` |

None is optional or advanced. The defaults are xAI's own (480p, 16:9, sound
on), except the duration: xAI's is 8 seconds, the catalog's 5.

- Labels are as xAI writes them: `480p`, `720p`, `1080p`.
- A video made from a start frame takes the frame's shape ("aspect_ratio is
  ignored"); the ratio's tooltip says so, and nothing is sent for it then.
- On 1.5 Lite, 1080p is upscaled from 720p; its tooltip says so. On 1.5, the
  tooltip says that an end frame or reference images allow 720p at most.
- In Extend mode the duration is the length added to the clip, not the
  length of the result (Video Extension); its tooltip says so. Edit has no
  parameter: the edited video keeps the clip's length, shape, and
  resolution, capped at 720p.
- `sound` off sends `generate_audio: false`, which asks for a silent video;
  on sends `true`, the default. Edit and Extend take no such field.

### Rules between parameters

`check` reports these after the checks of the declarations, in this order:

| Model | Rule | Source |
| --- | --- | --- |
| 1.5 | a start and an end frame make a video at 480p or 720p | Video Generation: `image` with `last_frame` is reference to video, and "reference-to-video goes up to 720p" |
| 1.5 | References makes a video at 480p or 720p | Reference-to-Video: "Resolution: Up to 720p" |
| Grok Imagine Video | References makes at most 10 seconds | Video Generation: "Reference-to-video on grok-imagine-video allows up to 10 seconds" |
| Grok Imagine Video | Extend adds 2 to 10 seconds | Video Extension; the API reference |
| Grok Imagine Video | References, Edit, and Extend need a prompt | the API reference: the prompt is required for reference to video, editing, and extension |

With files, `check` then reports a clip that is not an MP4, and a request
larger than AI Video sends.

## Requests

Every request carries `Authorization: Bearer <key>`; a create is sent once,
as JSON.

**Frames and References:** `POST /videos/generations` with

```json
{
	"model": "grok-imagine-video-1.5",
	"prompt": "<prompt>",
	"image": { "url": "data:image/png;base64,<bytes>" },
	"last_frame": { "url": "data:image/jpeg;base64,<bytes>" },
	"duration": 5,
	"resolution": "720p",
	"generate_audio": true
}
```

- `prompt` only when the prompt has text other than spaces.
- `image` for the start frame and `last_frame` for the end frame; without a
  start frame, `aspect_ratio` instead.
- References sends `reference_images`, one `{ "url": … }` per image in the
  order of the plan, with `aspect_ratio`, and no frames.
- Not sent: `keyframes`, `reference_audios`, `output`, `storage_options`,
  `user`.

**Edit:** `POST /videos/edits` with

```json
{ "model": "grok-imagine-video", "prompt": "<prompt>", "video": { "url": "data:video/mp4;base64,<bytes>" } }
```

**Extend:** `POST /videos/extensions` with

```json
{ "model": "grok-imagine-video", "prompt": "<prompt>", "video": { "url": "data:video/mp4;base64,<bytes>" }, "duration": 5 }
```

The answer to each is `{"request_id": "<id>"}`; the task id is that string.
An accepted answer without it leaves the outcome unknown.

### Asking about a task

`GET /videos/{request_id}`. xAI answers 200 once the task ended and 202
while it runs, with `status` and, while pending, `progress` from 0 to 99.

| xAI answer | State |
| --- | --- |
| `pending`, `progress` 0 or absent | `pending` |
| `pending`, `progress` 1 to 99 | `running`, with the progress |
| HTTP 202 with no status AI Video can read or knows | `pending`: 202 says the generation still runs |
| `done` with `video.url` | `succeeded` with that address |
| `done` with `video.respect_moderation: false` (no address) | `failed`: xAI's moderation withheld the video, and xAI still charges for it |
| `failed` | `failed` with `error.message` and `error.code` (`invalid_argument`, `permission_denied`, `failed_precondition`, `service_unavailable`, `internal_error`) |
| `expired` | `failed`: the request expired before its video was ready |
| any other status or none with HTTP 200, or `done` without an address that moderation explains | the answer cannot be read |
| HTTP 404 | `notFound`: xAI does not know the request id |

- **Result**: `video.url`, a temporary address on `vidgen.x.ai`, "only good
  for fetching the asset shortly after generation"; xAI states no lifetime.
  BaseHalf downloads it at once, without the key, since it is not on the
  endpoint's origin. A download without an address asks about the task
  again (`videoLocation`).
- **Cancel**: xAI has no cancellation. `cancel` sends nothing and answers
  false.

### Errors

xAI answers an error as `{"code": "<code>", "error": "<message>"}` (for
example `not-found` for an unknown model); the message is xAI's message with
its code. xAI documents its statuses, not a list of codes, so the module
reads two cases from the message:

| Answer | Code |
| --- | --- |
| 400 whose message is about the API key (xAI answers an incorrect key with 400) | `auth` |
| 4xx other than 429 whose message is about credits or a spending or billing limit (xAI rejects requests once the prepaid credits are used up or the invoiced billing limit is reached) | `balance` |
| 401, 403 | `auth` |
| 404 for a create (an unknown model), 400, 415, 422, any other 4xx | `rejected` |
| 404 for a poll | `notFound` |
| 429 | `rateLimited`, with xAI's limit: 10 requests a second for each video model unless the team's limit was raised (Rate Limits; xAI's sales team raises Imagine limits) |
| 5xx | `unknownOutcome` for a create, `network` (asked again) otherwise |

Authentication, unknown models, and rate limits come back on the request
itself, before a task exists; what xAI refuses while it generates comes back
as a failed task with one of the codes above.

## Estimate

```text
Frames, References: duration × price per second (model, resolution) + images × price per image
Edit:   clip × price per second (480p to 720p) + clip × $0.01
Extend: from added × price per second (480p) + clip × $0.01
        to (clip + added) × price per second (720p) + clip × $0.01
```

Prices in USD from the model pages, read on 2026-10-19 (the pages state no
date of their own; the Pricing page of 2026-10-10 lists the 480p prices):

| Model | 480p | 720p | 1080p | Input image | Input video |
| --- | --- | --- | --- | --- | --- |
| `grok-imagine-video-1.5` | $0.08 / s | $0.14 / s | $0.25 / s | $0.01 | — |
| `grok-imagine-video-1.5-lite` | $0.02 / s | $0.03 / s | $0.14 / s | $0.01 | — |
| `grok-imagine-video` | $0.05 / s | $0.07 / s | — | $0.002 | $0.01 / s |

- "You are charged for each second of video generated" and "also charged
  when using video or image as an input": every frame and reference image is
  an input image. The prices are the same in every cluster xAI lists.
- An edited or extended video keeps the clip's resolution, capped at 720p,
  and AI Video does not measure a video's resolution: the estimate spans the
  480p and 720p prices.
- Extend: the added seconds are generated, and the result holds the clip
  too; xAI does not say which seconds it bills and calls its extension price
  promotional, so the range spans both.
- A clip is counted at its measured length; without its file, from its
  mode's shortest to its longest allowed length (Edit 0.1 to 8.7 seconds,
  Extend 2 to 15).

## Left out

- **Preset voices** (`reference_audios` with `voice_id`) and voice clips:
  a voice belongs to a speaker the prompt names as `<AUDIO_0>`, which a
  node's setting cannot say, and clips of one's own are for partners xAI
  admits on request.
- **Keyframes** (`keyframes`): an image pinned at a time inside the clip,
  which the node's inputs cannot place.
- **A first or last frame with references, or a last frame alone**: the
  node's References mode takes no frames, and an end frame needs a start
  frame.
- **xAI's `<IMAGE_0>` tags**: the prompt is sent as written; a prompt may use
  the tags itself, counting from 0 in the order the images are sent.
- **The Files API** (`file_id` inputs) and **storage of results**
  (`storage_options`, `output`): inputs travel inline, and BaseHalf keeps the
  video it downloads.
- **Seed, negative prompt, watermark, and prompt rewriting**: xAI's video API
  documents none of them.
- **The US regional endpoint and the Batch API**: the first serves no video;
  the second is for batches, not a node's one generation.

## Facts not confirmed

- `generate_audio` and `last_frame` appear in the guides' requests but not in
  the API reference's request schema; the guide does not say whether
  Grok Imagine Video honors `generate_audio`.
- That a start and an end frame on 1.5 allow 720p at most is inferred from
  the guide calling that request reference to video.
- The prompt of 1.5 References: the API reference requires one for reference
  to video, the 1.5 guide makes it optional with reference images; the
  catalog follows the guide for 1.5 and the reference for Grok Imagine Video.
- What a pending poll's 202 answer holds besides `status` and `progress`,
  what `expired` means, and how long a request id can be asked about.
- How long a video address stays valid.
- The code and wording of the answers to an incorrect key and to an empty
  balance; the module reads them from the message.
- The largest request, image, or clip xAI takes inline, and the shortest
  clip it edits.
- Which seconds an extension bills, and the price tier of an edited or
  extended video below 480p.

## Acceptance criteria

1. The catalog has the provider `xai` with one region, one API key, and the
   three models above with exactly their modes, inputs, limits, and
   parameters.
2. Each mode of each model sends the body above, once, to its path, with the
   key in `Authorization` and every input inline as a data URL.
3. A poll maps `pending` with and without progress, `done`, a withheld
   video, `failed`, and `expired` as above; the video downloads from the
   poll's address without the key, or from a new question when the download
   has none.
4. `cancel` answers false and sends nothing.
5. 401 and a 400 about the API key answer `auth`, a message about credits
   `balance`, and 429 `rateLimited`; a create whose connection drops after it
   was sent answers `unknownOutcome` and was sent once.
6. `check` reports each rule above and, with files, a MOV clip; a refused
   request sends nothing.
7. The estimate of three combinations matches the price list, and Edit and
   Extend answer the ranges above.

## Verification

`vscode-base/extensions/basehalf-ai-video/test/xai.test.ts` runs the module
through the provider commands against local servers that answer like xAI's
API and its video host. No test calls xAI or uses a real key.
