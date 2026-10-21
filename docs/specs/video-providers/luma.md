# Luma

Status: Active (2026-10-19)
Decision: [D59](../../decisions.md#d59--video-providers-are-built-in-integrations-with-each-models-exact-settings-users-bring-their-own-keys-new-2026-10-19)
Parent: [Video providers and the model catalog](../video-providers.md)

This specification owns the Luma module of AI Video
(`vscode-base/extensions/basehalf-ai-video/src/providers/luma.ts`): the
catalog entry it declares, the requests it sends, and how it reads Luma's
answers. What is the same for every provider (the commands, checks from the
declarations, retries, the download, plain messages) is owned by the parent
specification and is not repeated here.

## Sources

The Luma Agents API documentation, `https://docs.agents.lumalabs.ai/`, read
on 2026-10-18 and read again on 2026-10-19, when every page below was the
same byte for byte. Its pages carry no date of their own; the API answers
with `X-API-Version: 2026-04-01`.

| Page (path) | What this specification takes from it |
| --- | --- |
| `/` (Quickstart) | the base URL; the key as a bearer token; keys start with `luma-api-` |
| `guides/model/` | the models: `uni-1` and `uni-1-max` make images, `ray-3.2` is the one video model; video is MP4; result addresses expire after 1 hour |
| `guides/videos/generation/` | `type: "video"`: the prompt, `aspect_ratio`, `video.resolution`, `video.duration`, `video.loop`, `video.hdr`, `video.exr_export`, start and end frames, keyframes, extend, the validation rules, the answer, polling |
| `guides/videos/editing/` | `type: "video_edit"`: the source video, `video.edit` (`auto_controls`, `strength`, `controls`, keyframes), the guide frame, HDR, the aspect ratio of an edit, the validation rules |
| `guides/videos/reframing/` | `type: "video_reframe"` (left out) |
| `guides/videos/migration/` | the Dream Machine models that retire; `ray-3.2` as the only id of the new API; keys from the Luma API Platform; the four states |
| `guides/files/`, `api/resources/files/methods/create/`, `.../complete/`, `.../get/`, `.../delete/`, `.../list/` | the Files API: the presigned upload, `complete`, the file states, `expires_at` |
| `api/resources/generations/methods/create/`, `.../get/` | the fields of a request and of a generation, the failure codes |
| `guides/pricing/` | which failed generations are refunded or partly charged |
| `guides/error-handling/`, `guides/rate-limits/`, `guides/faq/` | the error answers and their statuses, the limits, image and video sizes and formats, no cancellation, retention |

The Dream Machine API documentation, `https://docs.lumalabs.ai/docs/`
(`welcome`, `api`, `video-generation`, `faq`; updated 2026-07-10), was read
on the same days to decide between the two APIs.

## Which API

Every request goes to the **Luma Agents API**
(`https://agents.lumalabs.ai/v1`). The Dream Machine API
(`https://api.lumalabs.ai/dream-machine/v1`) is not used:

- **Current models.** Ray 3.2 (`ray-3.2`) is Luma's current video model and
  is served only by the Agents API. The Dream Machine API serves Ray 2
  (`ray-2`) and Ray 2 Flash (`ray-flash-2`); the migration guide lists them,
  with Ray 3, Ray 2 Relaxed, Ray 3 Reference, and Ray 3 Refiner, as
  retiring, and says the new API accepts no older Ray id. Every Dream
  Machine page opens with "Looking for the latest Luma API?" and links to
  the Agents API.
- **Inputs from local files.** The Dream Machine API takes images only as
  public addresses ("currently this is the only way to pass an image") and
  has no upload. The Agents API takes images as base64 and has a Files API.
- **Keys.** Keys for the current API are made in the Luma API Platform
  (`https://platform.lumalabs.ai`), which the Dream Machine pages also send
  their readers to.

## Region and credentials

| Region | Label | Base URL | Console |
| --- | --- | --- | --- |
| `global` | Luma Agents API | `https://agents.lumalabs.ai/v1` | `https://platform.lumalabs.ai` |

- One credential, `apiKey` (**API Key**, shown with the placeholder
  `luma-api-…`), sent as `Authorization: Bearer <key>`. Luma has one
  deployment and no sandbox.
- Generations, limits, and files belong to the API client: several keys of
  one client share them.
- Limits, per client and by plan: requests a minute on `POST /generations`
  over a sliding 60-second window, and generations running at once. Asking
  about a generation is outside the per-minute limit.

## Model

| Catalog id | Label | Sent as (`global`) | Modes |
| --- | --- | --- | --- |
| `ray-3.2` | Ray 3.2 | `ray-3.2` | Frames, Edit |

- Luma uses one id for every task of the model; the mode chooses the request
  `type` (`video` for Frames, `video_edit` for Edit). `check` answers no
  `providerModel`.
- The prompt is always required: 1 to 6,000 characters for every type
  (`prompt.required: "always"`, `maxLength: 6000`).
- The model is not deprecated.

## Modes and inputs

| Mode | Start frame | End frame | Images | Videos, audio | Source |
| --- | --- | --- | --- | --- | --- |
| Frames (`frames`) | optional | optional | none | none | none |
| Edit (`edit`) | none | none | 0 to 1 | none | required |

- **Frames** without a frame is text to video; with frames, image to video.
  An end frame needs a start frame, as for every model.
- **Edit** changes the clip under the prompt and keeps its motion. The image,
  when there is one, is the edit's single guide frame (`video.start_frame`):
  the look the edited video has at its first frame.
- **Images** (frames and the guide frame): at most 50 MB, which Luma counts
  as 52,428,800 bytes (`imageMaxBytes`), and at most 8,000 px a side
  (`imageMaxSide`). Luma takes JPEG, PNG, WebP, and still GIF, so no
  `imageFormats` is declared; the window draws a GIF to PNG.
- **The clip of Edit**: at most 18 seconds and 200 MB (`videoSeconds: [0.1,
  18]`, `videoMaxBytes: 209715200`, Luma's MB being 1,048,576 bytes as its
  image limit shows). Luma states only the longest clip; 0.1 seconds stands
  for "any length". The editing guide, the API reference, and the FAQ's
  table give 18 seconds; the error-handling page says 30, and the module
  follows the three. The clip is MP4 or MOV, the formats whose length AI
  Video reads; Luma asks only for a `video/*` type and names `video/mp4` as
  its example.

## Parameters

| Name | Label | Kind | Values | Default | Modes | Sent as |
| --- | --- | --- | --- | --- | --- | --- |
| `resolution` | Resolution | choice | `360p`, `540p`, `720p`, `1080p` | `720p` | both | `video.resolution` |
| `ratio` | Ratio | choice, ratio shapes | `adaptive` (Adaptive), `9:16`, `3:4`, `1:1`, `4:3`, `16:9`, `21:9` | `adaptive` | Frames | `aspect_ratio`; nothing for Adaptive |
| `duration` | Duration | integer, seconds | 5 or 10 (step 5) | 5 | Frames | `video.duration`: `"5s"` or `"10s"` |
| `loop` | Loop | boolean | | off | Frames | `video.loop: true`, only when on |
| `strength` | Strength | choice | `auto` (Auto), `adhere_1` to `adhere_3` (Adhere 1 to 3), `flex_1` to `flex_3` (Flex 1 to 3), `reimagine_1` to `reimagine_3` (Reimagine 1 to 3) | `auto` | Edit | Auto: `video.edit.auto_controls: true`; otherwise `video.edit.strength` |
| `hdr` | HDR | boolean, under More | | off | both | `video.hdr: true`, only when on |

The defaults are Luma's own: 720p, the shape chosen by the model when
`aspect_ratio` is left out ("the model selects a ratio based on the prompt
and anchor frames"), 5 seconds, no loop, standard dynamic range, and for an
edit the automatic controls Luma recommends as the default.

- `resolution`: 360p is Luma's draft tier, for fast previews; its tooltip
  says so.
- `strength` is Luma's field name. Its tooltip gives the bands: Adhere keeps
  the clip's motion, composition, and structure; Flex keeps its motion and
  lets the prompt change style and content; Reimagine lets the prompt drive
  most of it; Auto lets the model derive the controls from the clip.
- `hdr` makes an HDR-encoded MP4. Luma's reference says HDR "requires HDR
  access"; an account without it is refused with Luma's message.
- An edit sends no `aspect_ratio` (Luma ignores it: the edit keeps the clip's
  shape) and no `duration` (the edited video keeps the clip's length).

### Rules between parameters

`check` reports these after the checks of the declarations, in this order:

| Rule | Mode | Luma's words |
| --- | --- | --- |
| HDR needs 720p or 1080p | both | `360p`/`540p` "rejected with `hdr: true`" |
| An HDR video is 5 seconds long | Frames | "`10s` is rejected with `hdr`" |
| A looping video is 5 seconds long | Frames | `loop` "rejected with `10s`" |
| A looping video is not HDR | Frames | `loop` "rejected with … `hdr`" |
| A looping video has no end frame | Frames | `loop` "rejected with … `end_frame`" |

`check` then reports a Frames request whose JSON with its images in base64
would be larger than the 128 MiB AI Video sends, and an Edit clip larger than
128 MiB, the most AI Video sends in one request (the clip's upload).

## Requests

Every request to the API carries `Authorization: Bearer <key>`, and one with
a body sends `Content-Type: application/json`; the upload's `PUT` to Luma's
storage carries neither ([The upload](#the-upload)). Nothing else is sent: no
`user_id`, no `X-Request-Id`.

### Frames

`POST /generations` with

```json
{
	"model": "ray-3.2",
	"type": "video",
	"prompt": "<prompt>",
	"aspect_ratio": "16:9",
	"video": { "resolution": "720p", "duration": "5s" }
}
```

- `aspect_ratio` is left out for Adaptive. `video.loop` and `video.hdr` are
  sent, as `true`, only when they are on.
- **Frames go as keyframes.** A start frame, and an end frame when there is
  one, are sent as `video.keyframes` with `video.keyframe_indexes` `[0]` or
  `[0, 24 × duration]` (`[0, 120]` for 5 seconds, `[0, 240]` for 10): the
  first and the last frame of the output's 24-frames-a-second grid, whose
  highest index the guide gives as 120 for 5 seconds and 240 for 10. The
  guide calls a single keyframe at index 0 equivalent to `start_frame`, and
  keyframes, unlike `start_frame` and `end_frame` ("the legacy 2-frame
  surface"), support 10 seconds and HDR. So a start frame works at both
  durations and with HDR.
- **With Loop**, which keyframes do not take, the start frame is sent as
  `video.start_frame` instead; Loop takes no end frame (a rule above).
- An image is `{ "data": "<base64>", "media_type": "image/png" }`: its bytes
  as plain base64, with the type read from the bytes (`image/png`,
  `image/jpeg`, or `image/webp`).

```json
{
	"model": "ray-3.2",
	"type": "video",
	"prompt": "<prompt>",
	"video": {
		"resolution": "1080p",
		"duration": "10s",
		"keyframes": [
			{ "data": "<base64>", "media_type": "image/png" },
			{ "data": "<base64>", "media_type": "image/jpeg" }
		],
		"keyframe_indexes": [0, 240]
	}
}
```

### Edit

The clip is uploaded first ([The upload](#the-upload)), then
`POST /generations` with

```json
{
	"model": "ray-3.2",
	"type": "video_edit",
	"prompt": "<prompt>",
	"source": { "file_id": "<file id>" },
	"video": {
		"resolution": "720p",
		"edit": { "auto_controls": true },
		"start_frame": { "data": "<base64>", "media_type": "image/png" }
	}
}
```

- `video.edit` is `{ "auto_controls": true }` for Auto and
  `{ "strength": "<value>" }` otherwise ("supplying `strength` implies manual
  mode").
- `video.start_frame` is sent only with an image; `video.hdr` only when on.

### The upload

Luma takes the clip of an edit as a hosted address, inline base64, a prior
generation's id, or a file of its Files API. BaseHalf sends it through the
Files API, the way Luma gives for bytes that are not hosted, which carries
files larger than an inline request and checks them before the generation:

1. `POST /files` with `{ "mime_type": "video/mp4", "size_bytes": <bytes>,
   "purpose": "input", "expires_at": "<24 hours later>" }`: the presigned
   flow. `mime_type` is `video/mp4` or `video/quicktime`, read from the
   bytes. `expires_at` lets Luma delete the file a day later; without it, a
   file is never removed. The answer's `id` is the file id and its `upload`
   gives `url`, `method` (`PUT`), and `headers`.
2. `PUT` of the bytes to `upload.url`, with `upload.headers`. The address is
   Luma's storage, not the endpoint's origin, so it gets no key. A refusal of
   the storage (an XML `<Error>`) refuses the generation with its code, and
   so does an address that does not start with `https://`.
3. `POST /files/{id}/complete` starts Luma's ingest and moderation and
   answers the file.
4. While the file's `state` is `pending`, `GET /files/{id}` every 2 seconds,
   at most 60 times (2 minutes). `ready` goes on to the generation; `failed`
   (with `failure_reason`), `deleted`, a state AI Video does not know, or
   still `pending` refuses it, and nothing is created.

Each step is retried as uploads are. A file Luma does not know (404) while it
is uploaded refuses the generation.

### The answer

`201` with the generation, whose `id` (a UUID) is the task id; an answer
without it leaves the outcome unknown. Luma answers an error as
`{ "detail": "…" }` ([Errors](#errors)). A `503` whose
`error.code` is `TRANSIENT.SERVICE.UNAVAILABLE` says that "no generation was
created", so it refuses the generation (`rejected`) and the user can
generate again; any other 5xx leaves the outcome unknown.

## Task states

`GET /generations/{id}`:

| Luma `state` | Answer |
| --- | --- |
| `queued` | `pending` |
| `processing` | `running` (Luma reports no progress) |
| `completed` | `succeeded` with the `url` of the first `output` entry of type `video`; without one, the answer cannot be read |
| `failed` | `failed` with `failure_reason` and `failure_code` |
| any other | the answer cannot be read |

`404` ("Generation not found", also for another client's id) is `notFound`.
The failure codes, with what the message adds:

| `failure_code` | Message |
| --- | --- |
| `content_moderated` | moderation refused the prompt, an input, or the video; refunded |
| `generation_failed` | the model failed; refunded; generating again usually works |
| `budget_exhausted` | the account ran out of funds during the generation; part may be charged |
| `output_not_found` | Luma could not retrieve the video; refunded; generating again usually works |
| `image_too_large`, `unsupported_format`, `corrupt_input` | an input could not be used |
| `invalid_request` | refused as invalid while it ran |
| `rate_limited` | a service Luma relies on was busy; generate again in a moment |

## Result and retention

- The video's address is a presigned address of Luma's storage that expires
  after 1 hour; every `GET /generations/{id}` gives a new one. The download
  sends it no credentials. BaseHalf downloads at once; when a download has
  no address (`videoLocation`), the generation is asked about again.
- The generation's id does not expire. A generation that is still active
  after 1 hour ends (Luma's "1-hour active-job TTL"). Luma keeps outputs
  "long enough to serve presigned URLs"; BaseHalf relies on nothing longer.

## Cancel

Luma has no cancellation ("There is no cancel endpoint"), and the Agents API
has no `DELETE` for generations. `cancel` sends nothing and answers false.

## Errors

| Status | Luma's `detail` | Answer |
| --- | --- | --- |
| 400, 413, 422 | the field at fault, such as "Prompt must be between 1 and 6000 characters" | `rejected` |
| 401 | "Missing or invalid API key", "Invalid API key", "API key has been revoked", "API key has expired" | `auth` |
| 402 | "Insufficient balance. …" | `balance` |
| 403 | "API client is suspended", "API client is deactivated" | `auth` |
| 404 | "Generation not found" | `notFound` (a create: `rejected`) |
| 429 | "Rate limit exceeded" (requests a minute), "Too many concurrent jobs" (`Retry-After: 60`) | `rateLimited`, with what the limit is |
| 502, 503 | an upstream service or ingestion is unavailable | a create: unknown outcome, except the transient 503 above; other requests are asked again |

The message is Luma's `detail` with a sentence of what to do. A `detail`
that is a list of field errors is read as each field's path and message.

## Left out

- **Reframe** (`type: "video_reframe"`): it changes a clip's shape and fills
  the new area, a task none of the node's modes means; it takes none of
  Edit's settings and a clip of at most 10 seconds.
- **Extend** (`video.start_frame.generation_id`, `video.end_frame.generation_id`):
  Luma extends only a prior generation of the same client, named by its id;
  it takes no clip from a file, and the node's Extend mode sends a clip.
- **More than two keyframes**, at positions the user chooses
  (`video.keyframes` with other `keyframe_indexes`), and the keyframes of an
  edit (`video.edit.keyframes`): the node's inputs carry no position in the
  video.
- **Reference images**: `image_ref` is for images only and is refused on
  video requests.
- **Per-signal edit controls** (`video.edit.controls`: pose, depth, normals,
  trajectory, face): expert tuning beside Auto and the nine strengths, which
  Luma recommends to start with.
- **EXR export** (`video.exr_export`): BaseHalf keeps the MP4 only, and the
  export is billed.
- **Seed, negative prompt, watermark**: the API has no such fields (the FAQ:
  "there is no public `seed` parameter", "There is no `negative_prompt`
  parameter"; the request reference lists no watermark).
- **Camera concepts** (`concepts`): a field of the Dream Machine API only;
  Ray 3.2 takes camera motion from the prompt.
- **The Dream Machine models** (Ray 2, Ray 2 Flash) and the image models
  (`uni-1`, `uni-1-max`): see [Which API](#which-api); images are not video.
- **Inline clips** (`source.data`): Luma advises inline data "only for small
  media files"; the Files API carries any clip AI Video sends.
- **`user_id`** and request ids: they attribute usage among a partner's own
  users, which BaseHalf does not have.

## Not confirmed

- **The longest clip**: 18 seconds on three pages, 30 on one; the module
  takes 18.
- **MOV clips**: Luma names no video format besides its `video/mp4` example;
  a MOV clip is sent as `video/quicktime`.
- **How long ingest takes**: no page says; the module waits 2 minutes.
- **`expires_at`**: the reference gives it as an optional string; the module
  sends an ISO 8601 time, as the answers write theirs.
- **The final keyframe index**: the guide gives 120 and 240 as the highest
  valid indexes; that they are the last frame is read from it.

## Acceptance criteria

1. The catalog has the provider `luma` with the one region, one API key, and
   Ray 3.2 with exactly the modes, limits, and parameters above.
2. Frames sends the body above, once, with frames as keyframes (as
   `start_frame` with Loop); Edit uploads the clip, waits until the file is
   ready, then sends the body above once, with the key in `Authorization`
   and never to the storage.
3. A poll maps `queued`, `processing`, `completed`, and `failed` as above;
   the video downloads from the poll's address, or from a new question when
   the download has none.
4. `cancel` answers false and sends nothing.
5. 401 answers `auth`; 429 answers `rateLimited` with what the limit is; a
   transient 503 answers `rejected`; a create whose connection drops answers
   `unknownOutcome` and was sent once.
6. `check` reports each rule between parameters and a request too large to
   send; a refused request sends nothing, not even an upload.

## Verification

`vscode-base/extensions/basehalf-ai-video/test/luma.test.ts` runs the module
through the provider commands against a local server that answers like the
Agents API and its storage. No test calls Luma or uses a real key.
