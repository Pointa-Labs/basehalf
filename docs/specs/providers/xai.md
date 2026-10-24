# xAI

Status: Active (2026-10-19; image models 2026-10-22; names in the prompt, 2026-10-24)
Decisions: [D59](../../decisions.md#d59--video-providers-are-built-in-integrations-with-each-models-exact-settings-users-bring-their-own-keys-new-2026-10-19),
[D64](../../decisions.md#d64--basehalf-generates-images-with-the-same-cards-panel-and-providers-new-2026-10-22),
[D74](../../decisions.md#d74--a-prompt-mentions-its-inputs-files-and-each-provider-module-names-them-as-its-model-reads-them-new-2026-10-24)
Parent: [Providers and the model catalog](../providers.md)

This specification owns the xAI module of AI Video
(`vscode-base/extensions/basehalf-ai-video/src/providers/xai.ts`): the Grok
Imagine video models and image models it declares, the requests it sends, and
how it reads xAI's answers. What is the same for every provider (the commands,
the checks from the declarations, retries, the download, plain messages) is
owned by the parent specification and is not repeated here. Everything above
[Image models](#image-models) is about the video models.

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
| `/developers/models/grok-imagine-video-1.5`, `/grok-imagine-video-1.5-lite`, `/grok-imagine-video` | none | the aliases, 10 requests a second |
| `/developers/models` | 2026-09-21 | a model's plain name is its latest stable version ("Model Aliases") |
| `/developers/pricing` | 2026-10-10 | a generation that breaks the usage guidelines is still charged |
| `/developers/model-capabilities/imagine/files`, `.../files/inputs`, `.../files/outputs` | 2026-07-30, 2026-07-30, 2026-10-09 | the generation URL is ephemeral, "only good for fetching the asset shortly after generation"; `file_id` inputs |
| `/developers/rest-api-reference/files/upload` | 2026-04-28 | the Files API upload (not used) |
| `/developers/debugging` (its HTML page) | 2026-05-13 | 400 for an invalid argument or an incorrect API key, 401, 403, 404 for an unknown model, 415, 422, 429 |
| `/developers/rate-limits` | 2026-10-05 | 10 requests a second per video model at the first tier, Imagine limits raised through xAI's sales team; 429 above the limit |
| `/console/billing` | 2026-10-10 | requests are rejected once the prepaid credits are used up or the invoiced billing limit is reached |
| `/developers/advanced-api-usage/regions` | 2026-10-10 | the US regional endpoint serves no video generation |
| `/developers/quickstart` | 2026-10-10 | the console page where keys are made |
| `/developers/faq/security` | 2026-10-10 | Zero Data Retention blocks Files API uploads |
| `/developers/release-notes` | 2026-10-13 | July 2026: `grok-imagine-video-1.5` takes text, image, and reference to video, 1080p for the first two |

## Region and credentials

| Region | Label | Base URL | Console |
| --- | --- | --- | --- |
| `global` | Global | `https://api.x.ai/v1` | `https://console.x.ai/team/default/api-keys` |

- One credential, `apiKey` (**API Key**), sent as `Authorization: Bearer
  <key>`. A key belongs to a team; the team's prepaid credits pay for it.
- Paths are under the endpoint as it is entered: the base URL already ends
  in `/v1`, and a relay that mirrors xAI's API is entered with its own path.
- The US regional endpoint (`https://us.api.x.ai/v1`) serves no video or
  image generation and is not offered.

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
- No model is deprecated.
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
  states no shortest one, so the declared range starts at 0.1 seconds.
  `check` refuses a MOV clip.
- No mode takes audio or reference videos: `reference_audios` takes preset
  voices, and clips of one's own only for partners xAI admits on request.

### Inputs travel inline

Every input is sent inline as a data URL, `data:<type>;base64,<bytes>`, the
type read from the file's bytes: `image/png`, `image/jpeg`, or `image/webp`,
and `video/mp4` for the clip. xAI takes images and videos that way ("Public
URL or base64-encoded data URL"), so nothing is uploaded: the Files API
(`POST /v1/files`) would keep a copy on the user's account until it expires,
bill its storage, and is blocked for teams with Zero Data Retention. xAI
states no largest request; AI Video sends at most 128 MiB, and `check`
reports a request whose inputs, encoded, would be larger.

**Names in the prompt** ([providers](../providers.md#names-in-the-prompt)).
A mention of the n-th reference image is written `<IMAGE_n>`, counted from 0:
"Refer to reference images in the prompt by their position in the list,
starting at `<IMAGE_0>`" (reference-to-video guide, 2026-10-19). xAI names
no start frame, end frame, or clip, and BaseHalf sends no frame with
references, so those take the shared names.

## Parameters

| Name | Label | Kind | Values | Default | Models and modes | Sent as |
| --- | --- | --- | --- | --- | --- | --- |
| `resolution` | Resolution | choice | `480p`, `720p`, `1080p` (1.5, 1.5 Lite); `480p`, `720p` (Grok Imagine Video) | `480p` | Frames, References | `resolution` |
| `ratio` | Ratio (ratio shapes) | choice | `1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `3:2`, `2:3`, `21:9`, `5:2` | `16:9` | Frames, References | `aspect_ratio`; set by the start frame (`setByStartFrame`), so it is sent only without one |
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
| Grok Imagine Video | References makes at most 10 seconds: answered as a limit of `duration` (D70) | Video Generation: "Reference-to-video on grok-imagine-video allows up to 10 seconds" |
| Grok Imagine Video | Extend adds 2 to 10 seconds: answered as a limit of `duration` (D70) | Video Extension; the API reference |
| Grok Imagine Video | References, Edit, and Extend need a prompt | the API reference: the prompt is required for reference to video, editing, and extension |

`check` then reports a clip that is not an MP4, and a request larger than
AI Video sends.

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
| 429 | `rateLimited`, with xAI's limits: 10 requests a second for each video model and 6 for each image model at the first usage tier, unless the team's limit was raised (Rate Limits; xAI's sales team raises Imagine limits). The module reads the error without knowing the model, so the message names both |
| 5xx | `unknownOutcome` for a create, `network` (asked again) otherwise |

Authentication, unknown models, and rate limits come back on the request
itself, before a task exists; what xAI refuses while it generates comes back
as a failed task with one of the codes above.

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
6. `check` reports each rule above and a MOV clip; a refused request sends
   nothing.

## Verification

`vscode-base/extensions/basehalf-ai-video/test/xai.test.ts` runs the module
through the provider commands against local servers that answer like xAI's
API and its video host. No test calls xAI or uses a real key.

## Image models

xAI makes images with Grok Imagine Image on the same API, key, and errors as
its video models. Its image calls answer with the images unless the request
sets `deferred: true`; BaseHalf always sets it, so that an image generation is
a task like a video: the create answers at once with a request id, BaseHalf
records it, and asks about it until the images are ready, also after a
reload. No request is held open while the images are made.

### Sources

Read on 2026-10-22 as Markdown, like the pages of the video models; the date
is the page's own "Last updated".

| Page (path) | Updated | What this part takes from it |
| --- | --- | --- |
| `/developers/model-capabilities/images/generation` | 2026-10-08 | `POST /v1/images/generations`; `n` from 1 to 10; the ratios and `auto`, the default, which "lets the model pick the best ratio for the prompt"; the resolutions "currently supported", `1k` (the default) and `2k`; `quality` `low`, `medium`, and `auto`, the default, which "currently uses low for image generation and medium for image editing", on 2.0 only; deferred generation: `deferred: true` answers a `request_id`, `GET /v1/images/{request_id}` answers `pending` with HTTP 202 and `done` or `failed` with HTTP 200, addresses only, results kept 24 hours; addresses are temporary |
| `/developers/model-capabilities/images/editing` | 2026-10-08 | `POST /v1/images/edits` takes JSON, not multipart; a source image as a public URL, a base64 data URI, or a `file_id` |
| `/developers/model-capabilities/images/multi-image-editing` | 2026-08-28 | up to five source images, in the order they are sent; the output takes the first image's shape unless `aspect_ratio` sets one |
| `/developers/rest-api-reference/inference/images` and `/openapi.json` | 2026-10-02 | the fields of both creates and of the poll; `image` or `images`, never both, each JPEG, PNG, or WebP, referred to as `<IMAGE_0>`, `<IMAGE_1>`, … in the prompt; for single image editing, `aspect_ratio` must not be set; `resolution` `1k`, `2k`, `1.5k`; a failed generation is an answer, not an HTTP error, with the codes `invalid_argument`, `permission_denied`, `failed_precondition`, `service_unavailable`, `internal_error`; `mime_type` is `image/jpeg` "unless the requested quality produces PNG"; Zero Data Retention teams must set `output` to use `deferred` |
| `/developers/migration/imagine-image-quality-nov-2` | 2026-09-02 | `grok-imagine-image-quality` retires on 2026-11-02 and is then served by 2.0 at `low`; 2.0 "additionally accepts `quality`, up to five source images for editing, and the `21:9` and `5:2` aspect ratios"; `grok-imagine-image` (1.0) "is not affected" |
| `/developers/migration/may-15-retirement` | 2026-09-02 | `grok-imagine-image-pro` redirects to `grok-imagine-image-quality` since 2026-05-15 |
| `/developers/release-notes` | 2026-10-15 | August 2026: `auto` quality, five source images "(was 3)", `21:9` and `5:2` |
| `/developers/models`, `/developers/models/grok-imagine-image-2.0`, `/developers/models/grok-imagine-image` | 2026-09-21 | 2.0 is xAI's image model; both take text and images and make images; 1.0's alias `grok-imagine-image-2026-03-02` |
| `/developers/rest-api-reference/inference/models` | 2026-04-13 (read again 2026-10-23) | an image model's `max_prompt_length`, an integer without a unit or a description, 1024 in the example |
| `/developers/model-capabilities/imagine/files` | (read) | the generation address is an ephemeral one on `imgen.x.ai`, "only good for fetching the asset shortly after generation" |
| `/developers/rate-limits` | 2026-10-05 | 6 requests a second for each image model at the first tier |
| `/developers/advanced-api-usage/regions` | 2026-10-10 | the US endpoint serves "none of the image generation, video generation, or voice APIs" |
| `/developers/pricing` | (read) | a request that breaks the usage guidelines is still charged |

### Models

| Catalog id | Label | Sent as (`global`) | Reference images | Ratios besides Adaptive | Quality |
| --- | --- | --- | --- | --- | --- |
| `grok-imagine-image-2.0` | Grok Imagine Image 2.0 | `grok-imagine-image-2.0` | 0 to 5 | the 15 | Auto, Low, Medium |
| `grok-imagine-image` | Grok Imagine Image | `grok-imagine-image` | 0 to 3 | the 13 | none |

- The 15 ratios are 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 2:1, 1:2, 21:9, 5:2,
  19.5:9, 9:19.5, 20:9, and 9:20; the 13 are the same without 21:9 and 5:2.
- Both are of kind `image`, deliver JPEG (`outputFormat: jpeg`; a PNG that
  some quality produces lands under its own extension), run as tasks, and
  offer the one mode `reference`. The prompt is required (`always`): xAI
  requires one for an edit and needs one to generate.
- The prompt is at most 64,000 characters on 2.0 and 16,000 on Grok Imagine
  Image. The models API gives each image model a `max_prompt_length`
  without a unit; its reference's example says 1024, while its live answer
  says 64000 for `grok-imagine-image-2.0` and 16000 for `grok-imagine-image`
  (as an open-source SDK reported on 2026-10-22 after reading
  `GET /v1/image-generation-models`). The catalog takes the live values and
  reads them as characters, the smaller reading for most prompts; a prompt
  that xAI counts as longer is refused in xAI's words.
- 1.0 is declared with three source images and without 21:9 and 5:2. The
  release notes give five images and the two ratios to image editing and
  generation in general, but the migration guide of November credits them to
  2.0, so the catalog offers 1.0 only what predates them.
- **Left out.** `grok-imagine-image-quality`, retiring on 2026-11-02 and then
  served by 2.0 at Low, and `grok-imagine-image-pro`, redirected since
  2026-05-15. No card uses either before launch.

### Inputs

- Reference images travel inline as data URLs, `data:<type>;base64,<bytes>`
  with `image/png`, `image/jpeg`, or `image/webp` read from the bytes, as the
  video inputs do; nothing is uploaded. The window draws any other image to
  PNG.
- One image is sent as `image`, two or more as `images`, in the order of the
  plan. A mention of the n-th is written `<IMAGE_n>`, from 0: "When multiple
  images are provided, refer to them as <IMAGE_0>, <IMAGE_1>, etc." (images
  API reference, 2026-10-02); one image is named the same way.
- A request whose inputs as data URLs would pass 128 MiB is refused, as for
  video. xAI states no largest source image (the 20 MiB of the models page is
  for images sent to its chat models).

### Parameters

| Name | Label | Kind | Values | Default | Models | Sent as |
| --- | --- | --- | --- | --- | --- | --- |
| `ratio` | Ratio | choice, ratio shapes | Adaptive (`adaptive`), then the model's ratios | Adaptive | both | `aspect_ratio`; nothing for Adaptive |
| `resolution` | Resolution | choice | 1K (`1k`), 2K (`2k`) | 1K | both | `resolution` |
| `quality` | Quality | choice | Auto (`auto`), Low (`low`), Medium (`medium`) | Auto | 2.0 | `quality` |
| `count` | Images | whole number | 1 to 10 | 1 | both | `n` |

- Adaptive is xAI's default, `auto`, and nothing is sent for it: a
  generation takes the shape the model picks for the prompt, an edit the
  shape of its first image. The tooltip says so.
- Quality Auto is xAI's default; its tooltip says what xAI serves for it.
  Every value is sent as it is.
- `1.5k` is not offered: the API reference and the models API list it, but
  the guide names `1k` and `2k` as the resolutions currently supported.
- xAI documents no seed, negative prompt, mask, or watermark for images.

### Rules between parameters

`check` reports, after the checks of the declarations:

| Model | Rule | Source |
| --- | --- | --- |
| both | a ratio other than Adaptive needs no reference image or at least two: the edit of one image takes that image's shape | the edit reference: "For single image editing, do not set this. It will always auto-detect from the input image." |

`check` then reports a request larger than AI Video sends.

### Requests

Every request carries `Authorization: Bearer <key>`; a create is sent once,
as JSON, and always with `deferred: true`.

**Without reference images:** `POST /images/generations` with

```json
{ "model": "grok-imagine-image-2.0", "prompt": "<prompt>", "n": 4, "resolution": "2k", "aspect_ratio": "16:9", "quality": "medium", "deferred": true }
```

**With reference images:** `POST /images/edits` with `image` for one and
`images` for two or more:

```json
{ "model": "grok-imagine-image-2.0", "prompt": "<prompt>", "images": [{ "url": "data:image/png;base64,<bytes>" }, { "url": "data:image/jpeg;base64,<bytes>" }], "n": 1, "resolution": "1k", "quality": "auto", "deferred": true }
```

- `quality` goes to 2.0 only; `aspect_ratio` only when the ratio is not
  Adaptive, and so never with one image.
- An image is sent as `{ "url": … }`, the reference's form; the guide's
  examples add `"type": "image_url"`, which the reference does not list.
- Not sent: `response_format` (a deferred request answers addresses only,
  the default), `output`, `storage_options`, and `user`.
- The answer is `{"request_id": "<id>"}`; the task id is that string. An
  accepted answer without it leaves the outcome unknown.

### Asking about a task

`GET /images/{request_id}`:

| xAI answer | State |
| --- | --- |
| `pending` (HTTP 202) | `pending`, or `running` with the progress should the answer give one, as for video |
| HTTP 202 with no status AI Video can read or knows | `pending` |
| `done` with `data` | `succeeded`, one output per entry in xAI's order: its `url`, or refused when the entry has no address or says `respect_moderation: false` |
| `done` without `data` | the answer cannot be read |
| `failed` | `failed` with `error.message` and `error.code` |
| any other status with HTTP 200, or none | the answer cannot be read |
| HTTP 404 | `notFound` |

- **Result**: each `url` is a temporary address on `imgen.x.ai`; BaseHalf
  downloads it at once, without the key, since it is not on the endpoint's
  origin. Fewer entries than `n` leave the cards left over failed
  ([generation cards](../generation-cards.md#several-images-from-one-generation)).
- An entry without an address is refused with "xAI gave no address for this
  image."; one that says `respect_moderation: false` with "xAI withheld this
  image because it did not pass moderation; xAI still charges for the
  generation." (Pricing).
- **Cancel**: none, as for video: `cancel` sends nothing and answers false.

### Errors

As for the video models ([Errors](#errors)), the 429 message naming both
limits. A prompt or an image refused when the request is made is `rejected`
with xAI's message; one refused while the images are made is a failed task
with xAI's message and code. A team with Zero Data Retention must give
`output` to use `deferred`, which BaseHalf cannot (it has no storage of its
own); xAI's refusal is shown as it words it.

### Facts not confirmed

- Whether `1.5k` is a resolution of any model.
- Whether 1.0 takes five source images and the ratios 21:9 and 5:2.
- The unit of each model's `max_prompt_length`, and its live values, which
  only a third party's reading of the live answer gives.
- How REST reports a moderated image: `respect_moderation` appears only in
  the SDK's examples.
- The largest source image, and which quality produces PNG.

### Acceptance criteria

1. The catalog lists the two image models above under xAI with exactly their
   reference images, ratios, resolutions, quality, and count, each of kind
   `image`, delivering JPEG, and running as tasks; no other image model.
2. A request without images goes to `/images/generations`, one with images
   to `/images/edits` with `image` or `images` as data URLs in the plan's
   order; each is sent once, with `deferred: true`, `n`, `resolution`,
   `quality` on 2.0, and `aspect_ratio` unless Adaptive.
3. A poll maps 202 to `pending`, `done` to one output per address in xAI's
   order with an entry without an address or withheld by moderation refused
   alone, `failed` to a failure with xAI's code, and 404 to `notFound`; the
   images download without the key.
4. `check` reports a ratio with one reference image, too many images, a
   value the model does not take, and a prompt over the model's 64,000 or
   16,000 characters, and a refused request sends nothing.
5. 401 and a 400 about the API key answer `auth`, a message about credits
   `balance`, 429 `rateLimited` with both limits, and a refused prompt
   `rejected`; a create whose connection drops answers `unknownOutcome` and
   was sent once.

### Verification

The same test file runs the image models through the provider commands
against local servers that answer like xAI's API and its image host.
