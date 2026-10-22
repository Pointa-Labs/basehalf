# Black Forest Labs

Status: Active (2026-10-19)
Decision: [D59](../../decisions.md#d59--video-providers-are-built-in-integrations-with-each-models-exact-settings-users-bring-their-own-keys-new-2026-10-19)
Parent: [Providers and the model catalog](../providers.md)

This specification owns the Black Forest Labs module of AI Video
(`vscode-base/extensions/basehalf-ai-video/src/providers/bfl.ts`): the
catalog entry it declares for FLUX 3, the requests it sends, and how it reads
the answers. What is the same for every provider (the commands, checks from
the declarations, retries, the download, plain messages) is owned by the
parent specification and is not repeated here.

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
  `videoMaxBytes: 52428800`. AI Video does not measure the sides of a video;
  BFL fails a clip with a side under 160 px. The edit takes no images ("image
  input … not supported").
- Extend: the API reference states no limit for `start_video`. The cookbook
  gives "mp4, up to 50 MB and 15 seconds; the limit is on the file you send":
  `videoSeconds: [0.1, 15]` (only the maximum is stated) and `videoMaxBytes:
  50000000` (50 MB, counted as 50,000,000 bytes to stay on the safe side).
- A clip is MP4: every page names mp4 only. `check` refuses a MOV clip, which
  the declarations' video checks would let through.
- `check` refuses a request whose JSON, its inputs as data URLs included, is
  larger than the 128 MiB AI Video sends.

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
| every mode | the request with its inputs is at most 128 MiB | AI Video's limit |

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
- A poll answered 503 with `Retry-After` is asked again after the wait ("wait
  and retry the same URL, not submit another generation"), as every poll is
  retried.

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
| any other | an answer AI Video cannot read |

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
- **Image models** (FLUX 3 Image and Klein, FLUX.2, FLUX.1 Kontext, the image
  tools) and **FLUX 3 Action** (robot actions): not video generation.
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
   parameters above; AI Video ships the module.
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

`vscode-base/extensions/basehalf-ai-video/test/bfl.test.ts` runs the module
through the provider commands against local servers that answer like BFL's
API and its delivery host. No test calls Black Forest Labs or uses a real
key.
