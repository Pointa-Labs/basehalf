# Black Forest Labs

Status: Active (2026-10-19; image models, 2026-10-22; names in the prompt, 2026-10-24)
Decisions: [D59](../../decisions.md#d59--video-providers-are-built-in-integrations-with-each-models-exact-settings-users-bring-their-own-keys-new-2026-10-19),
[D64](../../decisions.md#d64--basehalf-generates-images-with-the-same-cards-panel-and-providers-new-2026-10-22),
[D74](../../decisions.md#d74--a-prompt-mentions-its-inputs-files-and-each-provider-module-names-them-as-its-model-reads-them-new-2026-10-24)
Parent: [Providers and the model catalog](../providers.md)

This specification owns the Black Forest Labs module of the provider service
(`vscode-base/src/vs/platform/basehalfProviders/node/bfl.ts`): the
catalog entry it declares for FLUX 3 and its image models, the requests it
sends, and how it reads the answers. What is the same for every provider (the
commands, checks from the declarations, retries, the download, plain
messages) is owned by the parent specification and is not repeated here. The
video model is specified first; the image models are in
[Image models](#image-models).

## Sources

Black Forest Labs' documentation at `https://docs.bfl.ai/` (every page is
also served as Markdown at its path plus `.md`; the index is `llms.txt`), the
OpenAPI document `https://api.bfl.ai/openapi.json` that the index links, and
the rate card. Every page below was read on 2026-10-19. Apart from the
release notes, the pages carry no dates.

| Page (path) | What this specification takes from it |
| --- | --- |
| `api-reference/utility/generate-a-video-with-flux-3` (`POST /v1/flux-3-video` in the OpenAPI document) | the modes `t2v`, `i2v`, `v2v`, and `draft_enhance`; every field with its values, ranges, and defaults; that no other field is accepted; the answer `{id, polling_url, cost}`; the `x-key` header |
| `api-reference/tools/video-edit` (`POST /v1/flux-tools/video-edit-v1`) | the edit's fields; "Polling does not require an API key"; "Do not send the API key to the video download URL"; a poll answered 503 with `Retry-After` is asked again; the end states |
| `api-reference/utility/get-result` (`GET /v1/get_result`) | the poll's answer, its statuses, `progress`, and `details`; the operation names no key |
| `flux_3/flux3_overview` | the length of each mode, 24 fps, keyframes and the clip sent as data URLs, result addresses expiring about 2 hours after the task ends, FLUX 3 as a preview model, draft mode |
| `flux_3/flux3_video` | the field table (safety tolerance 0 to 4, default 2), the delivered size of each resolution class and ratio, keyframe and continuation examples |
| `flux_tools/flux_video_edit` | the edit's limits (15 seconds, 50 MiB, sides of at least 160 px, at least 17 frames at 24 fps), what its output follows, the fields it refuses, its address expiring about 1 hour after the result |
| `flux_tools/flux_video_upscale` | the upscale, left out |
| `api_integration/integration_guidelines` | the global endpoint and the regional `api.eu.bfl.ai` and `api.us.bfl.ai`; that the `polling_url` must be used; delivery hosts `delivery.*.bfl.ai`; at most 24 requests at once for most endpoints |
| `api_integration/errors` | the HTTP statuses, the poll statuses, the moderation reasons, the safety tolerance range of each endpoint |
| `quick_start/get_started`, `account_management/organizations_projects`, `account_management/credits_billing` | the dashboard, keys per project (`bfl_…`), prepaid credits, the first request a FLUX 3 video |
| `quick_start/pricing` and `https://bfl.ai/pricing` | the resolution labels |
| `release-notes` | FLUX 3 video released as a preview on 2026-08-04; continuation limited to 15 seconds on 2026-08-17; `qhd` and `uhd` added on 2026-09-10 |
| `cookbook/video_quickstart`, `cookbook/video_start_from_images`, `cookbook/video_edit_recast_continue` | images as PNG, JPEG, or WebP; no upload service, local files inline as base64 data URLs; a clip of at most 50 MB and 15 seconds; a continuation's duration counting the new part only; 5 generations at once per organization |

The cookbook recipes call an earlier preview endpoint (`/v1/flux-3-preview-high`,
with `480p` and `720p`, `reference_images`, and keyframes as objects), so
this specification takes from them only what the API reference does not say.

## Region and credentials

| Region | Label | Base URL | Console |
| --- | --- | --- | --- |
| `global` | Global | `https://api.bfl.ai/v1` | `https://dashboard.bfl.ai` |

- One credential, `apiKey` (**API Key**, placeholder `bfl_…`), sent as
  `x-key: <key>`. A key belongs to a project (**API → Keys** in the
  dashboard) and draws on the organization's prepaid credits. The quick
  start's first request is a FLUX 3 video made with such a key, so the video
  API is open to every key with credits.
- `api.bfl.ai` routes each request across BFL's clusters. The integration
  guide also names `api.eu.bfl.ai` (EU clusters only) and `api.us.bfl.ai` (US
  clusters only) without saying which endpoints they serve; the OpenAPI
  document lists `https://api.bfl.ai` only, and every video page uses it. So
  the catalog declares one region. A user who wants a regional host enters
  `https://api.eu.bfl.ai/v1` or `https://api.us.bfl.ai/v1` as the
  **Endpoint**.
- The endpoint is the base the paths below are joined to, `/v1` included.

## Model

One catalog model. FLUX 3 runs text to video, image to video, and
continuation on `/v1/flux-3-video`, where the body's `mode` says which, and
edits on a route of its own, `/v1/flux-tools/video-edit-v1` (FLUX Video Edit
[fast]; the OpenAPI document's summary is "Edit a video with FLUX 3"). BFL has
no model ids; a route names what runs. The node's mode and inputs choose the
route: `providerModels` gives the first route, `check` answers
`providerModel`, the route the request is sent to, and `submit` sends to
exactly that route.

| Catalog id | Label | Mode and inputs | Route (`providerModel`) | Body `mode` |
| --- | --- | --- | --- | --- |
| `flux-3` | FLUX 3 | Frames without a frame | `flux-3-video` | `t2v` |
| | | Frames with a start frame, and an end frame if any | `flux-3-video` | `i2v` |
| | | Edit | `flux-tools/video-edit-v1` | none |
| | | Extend | `flux-3-video` | `v2v` |

- `providerModels` is `{ "global": "flux-3-video" }`. The model is not
  deprecated; BFL calls FLUX 3 a preview model.
- The prompt is required in every mode (`always`): the schema of each mode
  requires `prompt`, and every documented request has one. BFL states no
  limit for the prompt of `/v1/flux-3-video`; the catalog bounds it at 20,000
  characters, text inputs included. The edit takes 1 to 4,096 characters once
  surrounding spaces are removed, and `check` reports a longer prompt in Edit
  mode.

## Modes and inputs

| Mode | Start frame | End frame | Clip | Limits |
| --- | --- | --- | --- | --- |
| Frames (`frames`) | optional | optional | none | images PNG, JPEG, or WebP |
| Edit (`edit`) | none | none | required | an MP4 of 0.7 to 15 seconds, at most 50 MiB |
| Extend (`extend`) | none | none | required | an MP4 of at most 15 seconds and 50 MB |

No mode takes reference images, reference videos, or audio.

- Frames without a frame is text to video. With a start frame it is image to
  video: "one starts the video, two start and end it". An end frame needs a
  start frame.
- Images are PNG, JPEG, or WebP (cookbook), the formats every mode takes
  without an `imageFormats` declaration; the window draws an image of another
  format to PNG first. BFL states no size for keyframe images: "oversized
  pixel dimensions are downscaled automatically; files over the limit are
  rejected" (cookbook). The catalog declares no image limit, and BFL's
  refusal is shown.
- Edit: the clip is "an HTTP(S) URL or a base64-encoded mp4, up to 15 seconds
  and 50 MiB. Each side at least 160 pixels, and at least 17 frames after
  normalization to 24 fps, about 0.7 seconds": `videoSeconds: [0.7, 15]` and
  `videoMaxBytes: 52428800`. BaseHalf does not measure the sides of a video;
  BFL fails a clip with a side under 160 px. The edit takes no images ("image
  input … not supported").
- Extend: the API reference states no limit for `start_video`. The cookbook
  gives "mp4, up to 50 MB and 15 seconds; the limit is on the file you send":
  `videoSeconds: [0.1, 15]` (only the maximum is stated) and `videoMaxBytes:
  50000000` (50 MB, counted as 50,000,000 bytes to stay on the safe side).
- A clip is MP4: every page names mp4 only. `check` refuses a MOV clip, which
  the declarations' video checks would let through.
- `check` refuses a request whose JSON, its inputs as data URLs included, is
  larger than the 128 MiB BaseHalf sends.

## Parameters

| Name | Label | Kind | Values | Default | Modes | Sent as |
| --- | --- | --- | --- | --- | --- | --- |
| `resolution` | Resolution | choice | `720p` (720p), `1080p` (1080p), `2k` (2K), `4k` (4K): BFL's HD, FHD, QHD, and UHD | `720p` | Frames, Extend | `resolution`: `hd`, `fhd`, `qhd`, `uhd` |
| `ratio` | Ratio (ratio shapes) | choice | `adaptive` (Adaptive), `21:9`, `2:1`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16`, `9:21` | `adaptive` | Frames, Extend | `aspect_ratio`, Adaptive as `auto` |
| `duration` | Duration | integer, seconds | 5 to 20, step 1, or Auto (`-1`) | 5 | Frames, Extend | `duration`, Auto as `"auto"` |
| `sound` | Sound | boolean | | on | Frames, Extend | `generate_audio` |
| `safety_tolerance` | Safety Tolerance | integer, advanced | 0 to 4, step 1 | 2 | every mode | `safety_tolerance` |

- The defaults are BFL's own (`hd`, `auto` ratio, sound on, tolerance 2),
  except the duration: BFL's default is `auto`, and the catalog's is 5
  seconds, so that a video has a known length until the user chooses Auto.
- Resolution labels are the rate card's. At 16:9, `hd` is 1280 × 704, `fhd`
  1920 × 1088, `qhd` 2560 × 1440, and `uhd` 3840 × 2176 (the tooltip says
  so); above `hd`, BFL runs the same generation and finishes it with its
  video upsampler.
- Adaptive is BFL's `auto`, which "lets the harness choose from the prompt and
  any references"; in a continuation it keeps the clip's shape (cookbook).
- Duration: 5 to 20 seconds for text and image to video, 5 to 15 for a
  continuation (API reference; release notes of 2026-08-17). In Extend mode
  the duration is the length of the new part (cookbook); the tooltip says so.
- Safety tolerance: 0 is the strictest. The video page and the errors page
  give 0 to 4, default 2, for every FLUX 3 video mode, and the edit page the
  same for the edit; a higher value answers 422. The OpenAPI document allows
  0 to 7 and says that the route and the organization set the approved
  maximum. The catalog offers 0 to 4.
- Edit sends no resolution, ratio, duration, or sound, which the edit refuses
  (HTTP 422): its output keeps the clip's length, shape, and sound at 24 fps,
  and a clip larger than 720p comes back at 720p.

Rules that `check` reports after the declarations' checks:

| Mode | Rule | Source |
| --- | --- | --- |
| Extend | the duration is at most 15 seconds, or Auto | API reference, release notes of 2026-08-17 |
| Edit | the prompt, without surrounding spaces, is at most 4,096 characters | edit API reference |
| Edit, Extend | the clip is an MP4, not a MOV | every page names mp4 |
| every mode | the request with its inputs is at most 128 MiB | BaseHalf's limit |

## Requests

Every create carries `x-key: <key>` and `Content-Type: application/json`,
goes to the endpoint's origin, and is sent once. Not sent: `user`, `version`
(`latest`, the default, is the only value), `draft`, and a webhook.

**Frames without a frame:** `POST /flux-3-video` with

```json
{ "mode": "t2v", "prompt": "<prompt>", "aspect_ratio": "auto", "duration": 5, "resolution": "hd", "generate_audio": true, "safety_tolerance": 2 }
```

**Frames with a start frame:** `POST /flux-3-video` with `mode` `i2v` and
`keyframes`: the start frame alone as one data URL, as the overview's example
sends it, or the start and end frames as a list of two.

```json
{ "mode": "i2v", "prompt": "<prompt>", "keyframes": ["data:image/png;base64,<start>", "data:image/jpeg;base64,<end>"], "aspect_ratio": "16:9", "duration": "auto", "resolution": "fhd", "generate_audio": true, "safety_tolerance": 2 }
```

**Extend:** `POST /flux-3-video` with

```json
{ "mode": "v2v", "prompt": "<prompt>", "start_video": "data:video/mp4;base64,<clip>", "aspect_ratio": "auto", "duration": 15, "resolution": "uhd", "generate_audio": false, "safety_tolerance": 2 }
```

**Edit:** `POST /flux-tools/video-edit-v1` with

```json
{ "video": "data:video/mp4;base64,<clip>", "prompt": "<prompt>", "safety_tolerance": 2 }
```

- An image is a data URL whose type is read from its bytes (`image/png`,
  `image/jpeg`, `image/webp`); the clip is `data:video/mp4;base64,…`. The
  overview sends keyframes and clips this way, and the cookbook says local
  files travel inline because "there is no upload service". Timed
  `[seconds, image]` keyframes are not sent.
- The answer is `{id, polling_url, cost, input_mp, output_mp}`. The task's
  `remoteId` comes from it as the next section says. An answer that gives
  neither a usable polling address nor an `id` leaves the outcome unknown.

## Asking about a task

The integration guide says that with the global or a regional endpoint "you
must use the `polling_url` returned in the initial request response", and the
edit reference that "Polling does not require an API key". A node keeps one
value for its task, the `remoteId`, so the polling address is kept as that
value:

- The create's `polling_url` becomes the `remoteId` when it is an `https`
  address (or `http` on this computer) of at most 256 characters, either on
  the endpoint's origin or on BFL's own hosts (`bfl.ai` and its subdomains,
  over `https`), such as `https://api.bfl.ai/v1/get_result?id=a770da3b-…`.
- Otherwise (no polling address, a longer one, or one on another host) the
  `remoteId` is the task's `id`, asked about at `GET
  {endpoint}/get_result?id=<id>`, the documented endpoint.
- A poll is `GET <remoteId>` for an address and `GET
  {endpoint}/get_result?id=<remoteId>` for an id. The key goes with it only
  to the endpoint's origin; a polling address on a BFL cluster host is asked
  without the key, which BFL does not need there. A `remoteId` that is an
  address on neither the endpoint's origin nor a BFL host (the endpoint
  changed, or the address was written by hand) is refused without a request.
- A poll answered 503 is read first: "A failed task can come back as HTTP
  `503` with a normal JSON body. Read `status` from the body before treating
  a `503` as a retryable outage" (FLUX 3 Image guide, read 2026-10-22). A
  body with a `status` is that state, below. Without one, the poll is asked
  again after its `Retry-After` ("wait and retry the same URL, not submit
  another generation"), or 1, 2, then 4 seconds apart, three times, as every
  poll is retried; a wait longer than 30 seconds, or a fourth 503, fails the
  poll as a network error, which the window asks again later.

| `status` | Answer |
| --- | --- |
| `Pending` | `pending` |
| `Reasoning` (planning), `Generating` | `running` |
| `Ready` | `succeeded` with `result.sample`; without it `succeeded`, and the download asks again |
| `Request Moderated` | `failed`: moderation refused the prompt or an input, with the `Moderation Reasons` of `details` |
| `Content Moderated` | `failed`: moderation withheld the finished video, with its reasons |
| `Error`, and `Failed`, which the integration guide's example also checks | `failed` with BFL's explanation in `details.error` |
| `No Card Generated` | `failed`; the status is in the OpenAPI document's list without an explanation |
| `Task not found` | `notFound`: the task does not exist or has expired |
| any other | an answer BaseHalf cannot read |

`progress` is reported when it is a number from 0 to 1; BFL does not document
its scale, so another value is not shown.

## Result

`result.sample` is a signed MP4 address on BFL's delivery hosts
(`delivery.*.bfl.ai`, the integration guide). It is never the endpoint's
origin, so the download sends it no key, as BFL asks. It expires about 2
hours after the task ends (overview; the edit page says about 1 hour), and
BaseHalf downloads at once. When a download has no address
(`videoLocation`), the task is asked about again.

## Cancel

BFL has no cancellation: the OpenAPI document has no such operation. `cancel`
sends nothing and answers false.

## Errors

| Status | Meaning (errors page) | Answer |
| --- | --- | --- |
| 401, 403 | the key is missing or wrong, or may not use the endpoint | `auth` |
| 402 | the organization has too few credits | `balance` |
| 429 | too many requests, or too many tasks at once | `rateLimited` |
| 400, 422 | a malformed request, or a field or value BFL does not take | `rejected` |
| 404 | the route of a create, or the task of a poll | `rejected` for a create, `notFound` for a poll |
| 500, 503 | BFL's error or maintenance | `unknownOutcome` for a create, asked again for a poll |

The message says what BFL refused and, for the key, the credits, and too many
tasks, what to do, followed by BFL's words: `detail` as text, each field and
message of a validation error's `detail` list (never the value sent),
`details.error`, or `message`. The integration guide allows at
most 24 requests at once for most endpoints; the cookbook gives 5 video
generations at once per organization, a sixth answering 429 ("too many active
tasks"), a sign to wait for a running task.

## What is left out, and why

- **FLUX Video Upscale** (`/v1/flux-tools/video-upscale-v1`): upscaling is
  not generation ([non-goals](../providers.md#non-goals)), and it does
  not fit Edit, which changes what a clip shows on a prompt: the upscale
  changes the clip's size.
- **Drafts and Draft Enhance** (`draft`, `mode: "draft_enhance"`): a draft
  is a fast `hd` preview meant to be finished from its `draft_cache` bundle,
  which a node does not keep, and a fresh full render is another take.
- **More keyframes and timed keyframes**: FLUX 3 takes up to ten images as
  frames of the clip, spread over it or pinned to seconds. The node's Frames
  mode has a start and an end frame, and its references are not frames of
  the clip.
- **References**: the API has no reference images or videos yet ("Omni
  Reference with images and videos will be available soon"); the cookbook's
  `reference_images` and `reference_video` belong to the earlier preview
  endpoint.
- **Seed, prompt upsampling, negative prompt, output format, watermark**: the
  video routes have none of them and refuse unknown fields; FLUX 3
  interprets and expands every prompt itself, and the video is always MP4.
- **`user`, `version`, webhooks**: an end-user id BaseHalf has no use for,
  `latest` as the only version, and BaseHalf asks about tasks itself.
- **FLUX 3 Action** (robot actions): not video generation. The image models
  are in [Image models](#image-models).
- **The regional hosts as regions**: see [Region and
  credentials](#region-and-credentials).

## Facts not confirmed

- Whether the regional hosts serve the video routes.
- On which hosts BFL hands out polling addresses: the documentation shows
  only `api.bfl.ai`. BaseHalf follows one on the endpoint's origin or on a
  BFL host.
- The limits of a continuation's clip and of keyframe images, that image
  formats are PNG, JPEG, and WebP, and that a continuation's video holds only
  the new part: these come from the cookbook, written for the earlier preview
  endpoint.
- The scale of `progress`, and what `No Card Generated` means.
- Whether a prompt of spaces is accepted with keyframes or a clip: the field
  is required in every mode, and the catalog requires text.
- Which safety tolerance above 4 an organization may have approved.

## Acceptance criteria

1. The catalog has the provider `bfl` with the region `global`, one API key,
   and the model `flux-3` with exactly the modes, inputs, limits, and
   parameters above; BaseHalf ships the module.
2. Each mode sends the body above once to its route with the key in `x-key`;
   `check` answers that route as `providerModel`.
3. A task is asked about at its polling address on the endpoint's origin or
   a BFL host, with the key only on the endpoint's origin, and at
   `{endpoint}/get_result?id=` when the create gave no usable address; a
   polling address elsewhere is never asked.
4. Polls map every status above; the video downloads without the key from
   the poll's address, or from a new poll when the download has none.
5. `cancel` answers false and sends nothing.
6. 401 answers `auth`, 402 `balance`, 429 `rateLimited`, 422 `rejected`
   with BFL's words; a create whose connection drops after it was sent
   answers `unknownOutcome` and was sent once.
7. `check` reports each rule above, and a refused request sends nothing.

## Verification

`vscode-base/src/vs/platform/basehalfProviders/test/node/bfl.test.ts` runs the module
through the provider commands against local servers that answer like BFL's
API and its delivery host. No test calls Black Forest Labs or uses a real
key.

## Image models

Black Forest Labs' image models run on the same API, region, key, task flow,
polling addresses, and errors as FLUX 3's video. This part says what
differs; everything it does not say is as above.

### Sources of the image models

`https://docs.bfl.ai/` (each page as `<path>.md`), the OpenAPI document
`https://api.bfl.ai/openapi.json`, and BFL's Help Center, read on
2026-10-22; the request fields were read again on the live API references
the same day.

| Page (path) | What this part takes from it |
| --- | --- |
| `api-reference/utility/generate-an-image-with-flux-3` (`POST /v1/flux-3-image`) | `prompt` (required), `images` (1 to 10, each "an http(s) URL or base64"), `aspect_ratio` (15 values or `auto`, the default), `resolution` (`768sq`, `1k`, `1.5k`, `2k`, `4k`; default `1k`), `grounding` (default `true`), `safety_tolerance`, `version`; unknown fields refused (`additionalProperties: false`); the answer `{id, polling_url, cost, input_mp, output_mp}` |
| `flux_3/flux3_image_generate` | `seed`, `width`, and `input_image` "don't work here" (422); poll the `polling_url`; at `Ready` the image is at `result.sample`, whose signed address "expires after 1 hour", without the key; "A failed task can come back as HTTP `503` with a normal JSON body"; 400 for a reference above 16 megapixels, 422 below 256 × 256 or for a blank prompt |
| `flux_3/flux3_image_overview`, `guides/prompting_editing_multi_reference` | text to image, edits, and up to ten references, each named by its position ("Image 1" is the first entry); under `auto` the output takes the first image's shape; grounding on by default, off "for faster results" |
| `flux_3/flux3_image_klein`, `api-reference/utility/generate-an-image-with-flux-3-klein` | FLUX 3 Image Klein (left out, below) |
| `api-reference/models/generate-or-edit-an-image-with-flux2-[pro]`, `…-[pro]-preview`, `…-[max]`, `…-[flex]`, `…-[klein]-4b`, `…-[klein]-9b`, `…-[klein]-9b-preview` | FLUX.2: `prompt`; `input_image` to `input_image_8` (to `input_image_4` for [klein]); `seed`; `width` and `height` (at least 64); `disable_pup` ([pro], [max]; default `false`, prompt upsampling on) or `prompt_upsampling` ([flex]; default `true`); [flex]'s `guidance` (1.5 to 10, default 5) and `steps` (1 to 50, default 50); `safety_tolerance`; `output_format` (`jpeg`, the default, `png`, `webp`); the preview endpoints: "For stable production use, prefer FLUX.2 [pro] (/flux-2-pro)" |
| `flux_2/flux2_overview` | which model is for what; up to 8 references on the API, 4 for [klein]; [max] searches the web when prompted; [klein] has no prompt upsampling; fixed snapshots and preview endpoints share one contract |
| `flux_2/flux2_image_editing`, `flux_2/flux2_text_to_image` | the requests of an edit and of text to image; signed addresses "only valid for 10 minutes" |
| Help Center: "What are the FLUX.2 technical specifications?", "What aspect ratios and output dimensions are supported?", "What are the resolution limits?" (each "Last updated 4 months ago") | width and height of FLUX.2: at least 64, multiples of 16, at most 4 megapixels (2048 × 2048), any ratio, 1024 × 1024 by default; inputs over 4 megapixels are resized; at most about 2 megapixels recommended |
| `api_integration/integration_guidelines`, `api_integration/errors` | the polling address must be used; "Generated images expire after 10 minutes"; delivery hosts; the safety tolerance: 0 to 4 for FLUX 3 Image, 0 to 5 for FLUX.2, default 2, a higher value answers 422 |
| `quick_start/pricing` (no price is taken), `release-notes` | the tiers of FLUX 3 Image (768 × 768, about 1, 2, 4, and 16 megapixels; `768sq` "for fast previews"); FLUX 3 Image on 2026-10-01, Klein on 2026-10-15, FLUX.2 [pro] and [flex] on 2025-11-25, [max] on 2025-12-16, [klein] on 2026-01-15 |
| Kontext, Erase, Outpainting, and Deblur references and guides | BFL's samples send local images as plain base64 strings, without a `data:` prefix |

### FLUX 3 Image and FLUX.2

| Catalog id | Label | Route (`providerModels.global`) | Images | What it does |
| --- | --- | --- | --- | --- |
| `flux-3-image` | FLUX 3 Image | `flux-3-image` | 0 to 10 | BFL's newest image model: an image from the prompt, an edit, or a composition of several images, up to 4K, grounded in a web search |
| `flux-2-pro` | FLUX.2 [pro] | `flux-2-pro` | 0 to 8 | FLUX.2 for most images and edits |
| `flux-2-max` | FLUX.2 [max] | `flux-2-max` | 0 to 8 | FLUX.2's highest quality and prompt following; it searches the web when the prompt asks about something current |
| `flux-2-flex` | FLUX.2 [flex] | `flux-2-flex` | 0 to 8 | FLUX.2 for text in the image and small details, with steps and guidance |
| `flux-2-klein-4b` | FLUX.2 [klein] 4B | `flux-2-klein-4b` | 0 to 4 | the fastest FLUX.2 model |
| `flux-2-klein-9b` | FLUX.2 [klein] 9B | `flux-2-klein-9b` | 0 to 4 | fast, with higher quality than 4B |

- `kind: "image"`, `outputFormat: "png"`. Each request is a task, as for the
  video: no model answers at once, and each task makes one image.
- The prompt is always required. BFL states no limit; the catalog bounds it
  at 20,000 characters, as for the video.
- Each model has one route, so `check` answers no `providerModel`.
- FLUX.2 [pro] and [klein] 9B go to their fixed snapshots, which their
  preview endpoints' own pages advise "for stable production use".
- The FLUX.2 [klein] pages take the request of FLUX.2 without its prompt
  upsampling and with 4 images, so both [klein] models are offered.
- No model is deprecated.

### Mode and inputs of the image models

One mode, References (`reference`), with the images of the table above and
no frames, videos, audio, or source. No `imageFormats` is declared: images
are PNG, JPEG, or WebP, and the window draws any other image to PNG.

- **FLUX 3 Image**: each image at least 256 px a side (`imageMinSide: 256`)
  and at most 16 megapixels, counted as 16,777,216 px, which `check` reports.
- **FLUX.2**: BFL states no limit for an input and resizes one above 4
  megapixels.
- **Names in the prompt** ([providers](../providers.md#names-in-the-prompt)).
  A mention of the n-th image of FLUX 3 Image is written `Image n`: ""Image
  1" is the first entry in `images`, "image 2" the second, and so on. Use the
  same words every time" (`guides/prompting_editing_multi_reference`,
  2026-10-01). FLUX.2's is written `image n`: "Refer to each input as "image
  1", "image 2", etc. in your prompt"
  (`guides/usecases_editing_multi_image_compositing`, 2026-10-01). Both are
  written in English in every prompt, as BFL defines them. The descriptions
  no longer tell the user how to name the images. FLUX 3's video frames and
  clip have no names there and take the shared ones.
- Images go inline as plain base64, the form BFL's samples send: FLUX 3 Image
  in `images`, a list in the order of the inputs; FLUX.2 in `input_image`,
  `input_image_2`, and so on. `check` refuses a request larger than the 128
  MiB BaseHalf sends.

### Parameters of the image models

| Name | Label | Kind | Values (default in bold) | Models | Sent as |
| --- | --- | --- | --- | --- | --- |
| `resolution` | Resolution | choice | **`1k`** (1K), `1.5k` (1.5K), `2k` (2K), `4k` (4K) | FLUX 3 Image | `resolution`, the same value |
| `resolution` | Resolution | choice | **`1k`** (1K), `1.5k` (1.5K), `2k` (2K) | FLUX.2 | with `ratio`, as `width` and `height` |
| `ratio` | Ratio | choice, ratio shapes | **`adaptive`** (Adaptive), `21:9`, `2:1`, `16:9`, `3:2`, `7:5`, `4:3`, `5:4`, `1:1`, `4:5`, `3:4`, `5:7`, `2:3`, `9:16`, `1:2`, `9:21` | FLUX 3 Image | `aspect_ratio`, Adaptive as `auto` |
| `ratio` | Ratio | choice, ratio shapes | the same shapes without Adaptive; **`1:1`** | FLUX.2 | with `resolution`, as `width` and `height` |
| `grounding` | Grounding | boolean | **on** | FLUX 3 Image | `grounding` |
| `prompt_extend` | Prompt Rewriting | boolean, More | **on** | [pro], [max], [flex] | `disable_pup`: the opposite ([pro], [max]); `prompt_upsampling` ([flex]) |
| `steps` | Steps | integer, More | 1 to 50, step 1, **50** | [flex] | `steps` |
| `guidance` | Guidance | number, More | 1.5 to 10, step 0.1, **5** | [flex] | `guidance` |
| `seed` | Seed | integer, optional, More | 0 to 2147483647 | FLUX.2 | `seed` |
| `safety_tolerance` | Safety Tolerance | integer, More | 0 to 4, **2** (FLUX 3 Image); 0 to 5, **2** (FLUX.2) | all | `safety_tolerance` |

- The defaults are BFL's own: `auto` and `1k` for FLUX 3 Image, grounding
  on, upsampling on, [flex]'s 50 steps and guidance 5, tolerance 2, and for
  FLUX.2 1024 × 1024, which is 1:1 at 1K.
- FLUX 3 Image's resolutions are BFL's equal-area tiers: 1K about 1
  megapixel, 1.5K about 2, 2K about 4, and 4K about 16, which "can take
  several minutes"; the tooltip says so. `768sq` is left out (below).
- Adaptive is FLUX 3 Image's `auto`: a ratio the prompt asks for, otherwise
  the first image's shape, and from the prompt alone 1:1. FLUX.2 has no such
  value, so its ratio is always sent, also for an edit.
- FLUX.2's tiers follow FLUX 3 Image's areas: 1K is at most 1,048,576 px,
  1.5K at most 2,097,152, and 2K at most 4,194,304, FLUX.2's largest. For
  the ratio `a:b` and the tier's area `A`, `width` is √(A·a/b) and `height`
  √(A·b/a), each rounded down to a multiple of 16:

| Ratio | 1K | 1.5K | 2K |
| --- | --- | --- | --- |
| 21:9 | 1552 × 656 | 2208 × 944 | 3120 × 1328 |
| 2:1 | 1440 × 720 | 2048 × 1024 | 2896 × 1440 |
| 16:9 | 1360 × 768 | 1920 × 1072 | 2720 × 1536 |
| 3:2 | 1248 × 832 | 1760 × 1168 | 2496 × 1664 |
| 7:5 | 1200 × 864 | 1712 × 1216 | 2416 × 1728 |
| 4:3 | 1168 × 880 | 1664 × 1248 | 2352 × 1760 |
| 5:4 | 1136 × 912 | 1616 × 1280 | 2288 × 1824 |
| 1:1 | 1024 × 1024 | 1440 × 1440 | 2048 × 2048 |
| 4:5 | 912 × 1136 | 1280 × 1616 | 1824 × 2288 |
| 3:4 | 880 × 1168 | 1248 × 1664 | 1760 × 2352 |
| 5:7 | 864 × 1200 | 1216 × 1712 | 1728 × 2416 |
| 2:3 | 832 × 1248 | 1168 × 1760 | 1664 × 2496 |
| 9:16 | 768 × 1360 | 1072 × 1920 | 1536 × 2720 |
| 1:2 | 720 × 1440 | 1024 × 2048 | 1440 × 2896 |
| 9:21 | 656 × 1552 | 944 × 2208 | 1328 × 3120 |

- `grounding` is BFL's field: "web search and image search", off for faster
  results from the prompt and the images alone.
- `prompt_extend` is the shared name of FLUX.2's prompt upsampling, which
  rewrites the prompt with more detail before it generates. [klein] has none.
- `steps` and `guidance` are [flex]'s fields: more steps give more detail,
  and a higher guidance follows the prompt more closely at some cost to
  realism.
- `seed`: FLUX 3 Image takes none (422). FLUX.2 states no range; the shared
  seed's is used.
- Not offered, because the models have none: a count (one image per task), a
  negative prompt, and a watermark.

Rules that `check` reports after the declarations' checks:

| Rule | Models | Source |
| --- | --- | --- |
| each image is at most 16 megapixels | FLUX 3 Image | "`400` A reference image is larger than 16 megapixels" |
| the request with its images in base64 is at most 128 MiB | all | the most BaseHalf sends in one request |

### Requests of the image models

Every create carries `x-key: <key>` and `Content-Type: application/json`,
goes to the endpoint's origin, and is sent once. Not sent: `user`,
`version`, and a webhook.

**FLUX 3 Image:** `POST /flux-3-image` with

```json
{ "prompt": "<prompt>", "images": ["<base64>", "<base64>"], "aspect_ratio": "auto", "resolution": "1k", "grounding": true, "safety_tolerance": 2 }
```

`images` only with images, as a list also of one, as BFL's examples send it.

**FLUX.2 [pro] and [max]:** `POST /flux-2-pro` or `POST /flux-2-max` with

```json
{ "prompt": "<prompt>", "input_image": "<base64>", "input_image_2": "<base64>", "width": 1360, "height": 768, "disable_pup": false, "seed": 7, "safety_tolerance": 2, "output_format": "png" }
```

**FLUX.2 [flex]:** `POST /flux-2-flex` with the same fields, but
`prompt_upsampling` (`true` when Prompt Rewriting is on) in place of
`disable_pup`, and `steps` and `guidance`.

**FLUX.2 [klein]:** `POST /flux-2-klein-4b` or `POST /flux-2-klein-9b` with
the same fields as [pro] but no upsampling field, and at most
`input_image_4`.

- `input_image` fields only for the images there are; `seed` only when it
  is set; `output_format` is always `png`.
- The answer and the task's `remoteId` are the video's
  ([Requests](#requests), [Asking about a task](#asking-about-a-task)).

### Answers of the image models

A poll maps the statuses as for the video, with the 503 rule there, except:

- `Ready` is `succeeded` with one output, the address of `result.sample`;
  without one, the answer cannot be read.
- **The image is downloaded at once.** The address lasts 10 minutes ("only
  valid for 10 minutes", FLUX.2 and the integration guide; 1 hour on the
  FLUX 3 Image pages). When the window names the task's target with the
  poll, the output is answered with the credential headers of its own, so
  that the poll itself downloads the image into the target; the headers go
  only to the endpoint's origin, and a delivery host gets no key. Without a
  target, the address is answered as it is, for the window to download.
- `Request Moderated` and `Content Moderated` say that moderation refused
  the prompt or an input before the image was made, or withheld the
  finished image, with BFL's reasons.
- There is no cancellation.

### Errors of the image models

As for the video ([Errors](#errors)): 401 and 403 `auth`, 402 `balance`, 429
`rateLimited`, 400 (such as a reference above 16 megapixels) and 422 (such as
an unknown field or a safety tolerance above the route's) `rejected` with
BFL's words, and a create without an answer has an unknown outcome.

### Left out of the image models

- **FLUX 3 Image Klein** (`/v1/flux-3-image-klein`): its guide calls the
  request the same as FLUX 3 Image's, but its reference refuses `grounding`
  and adds `seed`, `steps`, `output_format`, `width`, and `height`, and the
  guide says "Do not use it without its prompt upsampler" without saying that
  the API runs it.
- **The preview endpoints** (`flux-2-pro-preview`, `flux-2-klein-9b-preview`):
  see above.
- **`768sq`**, FLUX 3 Image's tier "for fast previews": no shared value names
  it.
- **FLUX 3 Image's `width`, `height`, and `match_input`**: in the live OpenAPI
  document only; the guide says that `width` does not work there.
- **The FLUX.1 models** (Kontext, FLUX1.1 [pro] and Ultra, FLUX.1 [dev],
  Fill, Expand), which BFL calls the previous generation, and **the image
  tools** (Outpainting, Erase, Deblur), which are not generation.
- **Bounding boxes**: they are written in the prompt, as BFL describes; no
  setting is needed.
- **Output formats other than PNG**, and webhooks.

### Not confirmed for the image models

- FLUX 3 Image's output format: it has no field. BaseHalf declares PNG, which
  BFL's own clients save; a file in another format still lands, under its own
  extension.
- Whether the image routes take data URLs: BaseHalf sends plain base64, as
  BFL's samples do.
- How long the address lasts: 1 hour on the FLUX 3 Image pages, 10 minutes
  everywhere else; BaseHalf downloads at once.
- Whether `1.5k` is served: it is in the reference's values and the rate
  card, not in the release note.
- The limits of FLUX.2's inputs, the 16 megapixels of FLUX 3 Image as a
  count of pixels, and FLUX.2's seed range: none is stated.
- The size an edit of FLUX.2 gets without `width` and `height`: BaseHalf
  always sends them.
- Whether the regional hosts serve the image routes.

### Acceptance criteria of the image models

1. The catalog has the six image models above, of kind image with PNG
   output, with exactly the modes, limits, and parameters above;
   `buildCatalog` accepts them.
2. Each model sends the body above, once, to its route, with its images as
   plain base64 in order, FLUX.2's width and height from the table, and
   `output_format` `png` for FLUX.2.
3. `check` reports an image of FLUX 3 Image above 16 megapixels and a
   request too large to send; a refused request sends nothing.
4. A poll maps every status; a 503 with a status is that state; `Ready`
   with targets downloads the image into the target at once, without the key
   on a delivery host, and without targets answers its address.
5. 401 answers `auth`, 402 `balance`, 429 `rateLimited`, 422 `rejected`, and
   a moderated image fails with its sentence.

### Verification of the image models

`test/bfl.test.ts` runs the six image models through the provider commands
against the same local API and delivery host as FLUX 3's video. No test
calls Black Forest Labs or uses a real key.
