# Runway

Status: Active (2026-10-19)
Decision: [D59](../../decisions.md#d59--video-providers-are-built-in-integrations-with-each-models-exact-settings-users-bring-their-own-keys-new-2026-10-19)
Parent: [Video providers and the model catalog](../video-providers.md)

This specification owns the Runway module of AI Video
(`vscode-base/extensions/basehalf-ai-video/src/providers/runway.ts`): the
catalog entry it declares, the requests it sends, how it reads Runway's
answers, and how it estimates a price. What is the same for every provider
(the commands, checks from the declarations, retries, the download, plain
messages) is owned by the parent specification and is not repeated here.

## Sources

Runway's API documentation, `https://docs.dev.runwayml.com/`, which serves
every page as Markdown when `.md` is added to its path. Every page below was
read on 2026-10-19; the copies saved on 2026-10-18 were the same, byte for
byte.

| Page (path) | What this specification takes from it |
| --- | --- |
| `ai-context.md` | the base URL; the key as `Authorization: Bearer`; `X-Runway-Version: 2024-11-06` on every request; the task states; `DELETE /v1/tasks/{id}` cancels or deletes; `gen3a_turbo` and `gen4_aleph` were removed |
| `api.md` and `openapi.json` (API version `2024-11-06`) | the request fields and values of `gen4.5` and `gen4_turbo` (`/v1/text_to_video`, `/v1/image_to_video`) and `aleph2` (`/v1/video_to_video`); the answers of a create and of `GET /v1/tasks/{id}`; `DELETE`; `POST /v1/uploads`; the error bodies |
| `guides/models.md` | which video models are Runway's own and which it resells |
| `guides/pricing.md` | credits per second of each model; a credit costs $0.01 |
| `usage/tiers.md` and the table the page renders | concurrency and generations a day per usage tier; `THROTTLED`; 429 |
| `assets/inputs.md` | size limits of data URIs, URLs, and uploads; image, video, and audio formats; the ratios of each model; aspect ratio limits of prompt images; Aleph 2.0 clips of 2 to 30 seconds at 30 FPS or lower |
| `assets/uploads.md` | the ephemeral upload and its rules |
| `assets/outputs.md` | output addresses expire within 24 to 48 hours |
| `errors/errors.md`, `errors/task-failures.md`, `errors/troubleshooting.md` | HTTP statuses and which may be retried; failure codes; the key's form; images of at most 8,000 px a side |
| `api-details/versioning.md`, `api-details/api_changelog.md` | the version header; Gen-4.5 (2026-02-10), Aleph 2.0 (2026-06-02), the sunset of `gen3a_turbo` and `gen4_aleph` (2026-07-30), Gen-4 Turbo durations of 2 to 10 seconds (2025-10-08) |
| `api-details/moderation.md` | moderation is `auto` unless `contentModeration` says otherwise; moderated generations cost the same as others |
| `guides/setup.md` | the developer portal, API keys per project, credits to buy before the first request |

## Region and credentials

| Region | Label | Base URL | Currency | Console |
| --- | --- | --- | --- | --- |
| `global` | Runway Dev | `https://api.dev.runwayml.com` | USD | `https://dev.runway.com/` |

- One credential, `apiKey` (**API Key**, shown as `key_…`): an API secret
  made in the API Keys tab of a project in the developer portal. It starts
  with `key_` and 128 hexadecimal characters, and it is shown once. It is
  sent as `Authorization: Bearer <key>` to the endpoint's origin only.
- Every request to the API also carries `X-Runway-Version: 2024-11-06`, the
  only version the reference names; requests without it fail. It is a
  request header, not a credential, and it is not sent to Runway's storage
  or to the addresses of videos.
- `/v1` in Runway's paths is not a version. The module adds `/v1` before
  every path unless the endpoint already ends with it, so an endpoint is
  used with or without it.
- A project buys credits before its first request (at least $10). The
  ephemeral upload also needs purchased credits.

## Models

Runway's own video models only (`guides/models.md`):

| Catalog id | Label | Sent as | Modes | Created at |
| --- | --- | --- | --- | --- |
| `gen4.5` | Gen-4.5 | `gen4.5` | Frames, start frame optional | `POST /v1/text_to_video` without a start frame, `POST /v1/image_to_video` with one |
| `gen4_turbo` | Gen-4 Turbo | `gen4_turbo` | Frames, start frame required | `POST /v1/image_to_video` |
| `aleph2` | Aleph 2.0 | `aleph2` | Edit | `POST /v1/video_to_video` |

- Each model has one id at every endpoint: `providerModels` is
  `{global: <id>}`, and `check` answers no `providerModel`.
- Every model has an estimate; none is deprecated.
- Prompts are at most 1,000 characters. Gen-4.5 requires one at both of its
  endpoints (`always`). Gen-4 Turbo and Aleph 2.0 take one optionally
  (`withoutMedia`; their only mode always sends an image or a video).
  Runway counts the prompt in UTF-16 code units, so `check` also refuses a
  prompt whose UTF-16 length is over 1,000 while its characters are not:
  most emoji count as two. A prompt of spaces only is not sent.

## Modes and inputs

| Model | Mode | Slots | Limits |
| --- | --- | --- | --- |
| Gen-4.5 | Frames (`frames`) | start frame optional (none is text to video); no end frame | width to height 0.5 to 2 (`imageAspect: [0.5, 2]`), each side at most 8,000 px, at most 127 MiB |
| Gen-4 Turbo | Frames | start frame required; no end frame | width to height 0.5 to 2.358, each side at most 8,000 px, at most 127 MiB |
| Aleph 2.0 | Edit (`edit`) | the clip to change, required; no images | 2 to 30 seconds (`videoSeconds: [2, 30]`), at most 127 MiB |

- Images are PNG, JPEG, or WebP, the formats every mode takes, so no mode
  declares `imageFormats`; Runway does not take GIF, which the window draws
  to PNG first.
- The 8,000 px limit is the wording of Runway's error ("Height and width
  must not exceed 8000px"); the explanation under it says "less than
  8000px".
- Aleph 2.0 clips "must be 2–30 seconds and 30 FPS or lower", and Aleph
  keeps their resolution up to 1080p. AI Video does not read a clip's frame
  rate; Runway refuses a faster one (`INPUT_VALIDATION.VIDEO.UNSUPPORTED_FPS`).
  AI Video measures MP4 and MOV clips, so those are the clips it sends.
- Runway's upload takes files of 512 bytes to 200 MB. AI Video sends at most
  128 MiB in one request, and the upload's form fields need room, so an
  uploaded file is at most 127 MiB (`imageMaxBytes`, `videoMaxBytes`). With
  files, `check` reports a clip of less than 512 bytes.

## Parameters

| Name | Label | Kind | Values (default in bold) | Models | Sent as |
| --- | --- | --- | --- | --- | --- |
| `resolution` | Resolution | choice | **`720p`** (720p) | Gen-4.5, Gen-4 Turbo | with `ratio`, as the pixel size in `ratio` |
| `ratio` | Ratio | choice, ratio shapes | **`16:9`**, `9:16`, `4:3`, `3:4`, `1:1`, `21:9` | Gen-4.5, Gen-4 Turbo | `ratio`: `1280:720`, `720:1280`, `1104:832`, `832:1104`, `960:960`, `1584:672` |
| `targetAspectRatio` | Ratio | choice, ratio shapes | **`adaptive`** (Adaptive), `16:9`, `4:3`, `3:2`, `1:1`, `2:3`, `3:4`, `9:16`, `21:9` | Aleph 2.0 | `targetAspectRatio`; nothing for Adaptive. Not the shared `ratio`, so that a shape chosen for another model does not carry over and extend the clip |
| `duration` | Duration | integer, seconds | 2 to 10, step 1, **5** | Gen-4.5, Gen-4 Turbo | `duration` |
| `seed` | Seed | integer, optional, More | 0 to 2147483647 | all | `seed` |
| `publicFigureThreshold` | Public Figures | choice, More | **`auto`** (Auto), `low` (Low) | all | `contentModeration.publicFigureThreshold` |

- Runway names the size of the video in `ratio` as width and height in
  pixels. Every size of these models is of 720p's class, so `resolution`
  has one value, and `ratio` names the shape: 21:9 is 1584 × 672 (2.36 to
  1) and 4:3 is 1104 × 832.
- Gen-4.5 requires `ratio` and `duration`, and Gen-4 Turbo `ratio`; the
  reference gives no default for them, nor for Gen-4 Turbo's optional
  `duration`. 16:9 and 5 seconds are BaseHalf's, as for every provider.
  Runway's moderation is `auto` by default, and its seed is random when none
  is sent.
- A start frame of another shape is cropped from its center to the ratio;
  the tooltip says so.
- Gen-4.5 Image to Video takes the six sizes above in the API reference. The
  inputs page lists a seventh, `672:1584`, which the reference does not
  take; it is not offered.
- Aleph 2.0 keeps the shape of its clip unless `targetAspectRatio` asks for
  another; then Runway letterboxes the clip and fills the new area
  ("expand/outpaint"). The clip's length is the video's length, so Aleph 2.0
  has no duration.
- `publicFigureThreshold` `low` makes Runway's moderation less strict about
  recognizable public figures.
- Runway takes seeds up to 4294967295; the shared seed is 0 to 2147483647.

### Rules between parameters

`check` reports, after the checks of the declarations:

| Model | Rule | Source |
| --- | --- | --- |
| Gen-4.5 | without a start frame (text to video), the ratio is 16:9 or 9:16 | `/v1/text_to_video`, `gen4.5`: `ratio` is `1280:720` or `720:1280` |
| all | the prompt is at most 1,000 UTF-16 code units | `promptText`: "up to 1000 characters (measured in UTF-16 code units)" |
| Aleph 2.0 | with files, the clip is at least 512 bytes | `assets/uploads.md` |

## Requests

Every request to the API carries `Authorization: Bearer <key>`,
`X-Runway-Version: 2024-11-06`, and, with a body, `Content-Type:
application/json`. `outputFormat` is not sent, so the video is Runway's
default H.264 MP4.

**Gen-4.5 without a start frame:** `POST /v1/text_to_video` with

```json
{ "model": "gen4.5", "promptText": "<prompt>", "ratio": "1280:720", "duration": 5, "contentModeration": { "publicFigureThreshold": "auto" } }
```

**Gen-4.5 with a start frame, and Gen-4 Turbo:** `POST /v1/image_to_video` with

```json
{ "model": "gen4_turbo", "promptText": "<prompt>", "promptImage": "<data URI or runway:// address>", "ratio": "1104:832", "duration": 5, "seed": 7, "contentModeration": { "publicFigureThreshold": "low" } }
```

**Aleph 2.0:** `POST /v1/video_to_video` with

```json
{ "model": "aleph2", "videoUri": "runway://…", "promptText": "<prompt>", "targetAspectRatio": "9:16", "contentModeration": { "publicFigureThreshold": "auto" } }
```

- `seed` only when it is set; `promptText` only when the prompt has text
  other than spaces, which Gen-4.5's always has; `targetAspectRatio` only
  for a shape other than Adaptive. `contentModeration` is always sent.
- The answer is `{id, estimatedCost: {credits}}`; the task id is `id`, a
  UUID. A 2xx answer without it leaves the outcome unknown.

### Inputs and the upload

- An image goes inline as a data URI, `data:<type>;base64,…` with the type
  of the format its bytes show, when the URI is at most 5 MiB (5,242,880
  characters, Runway's limit for an image data URI, about 3.75 MiB of
  image). A larger image goes through the upload.
- A clip always goes through the upload: Runway takes video data URIs only
  up to 16 MB and advises against them.
- The upload, for each file:
  1. `POST /v1/uploads` with `{"filename": "<start-frame|source-video>.<png|jpg|webp|mp4|mov>", "type": "ephemeral"}`
     (the extension "must be representative of the file's contents")
     answers `{uploadUrl, fields, runwayUri}`;
  2. a multipart `POST` to `uploadUrl`, Runway's storage on another origin,
     so without the key and the version header, with every field of
     `fields` in its order and the file last, as `file`; a 2xx answer is
     success;
  3. the input is `runwayUri`, a `runway://` address valid for 24 hours.
- Runway says a failed upload is not sent again; the client starts over at
  step 1. So an upload is retried as a whole, with a new upload address,
  through `ProviderHttp.retry`: after a network error or an answer of 408,
  429, 500, 502, 503, or 504 of either step, three times, 1, 2, then 4
  seconds apart, or after the `Retry-After` it asks for when that is at most
  30 seconds, as every upload is retried. Any other refusal of the storage
  (an XML error with its `Code` and `Message`) ends the upload. A failed
  upload creates no task.
- Uploads are rate limited (429) and need purchased credits.

### Asking about a task

`GET /v1/tasks/{id}`. Runway does not update a task more often than every
five seconds; the window asks every five seconds.

| Runway `status` | Answer |
| --- | --- |
| `PENDING` | `pending` |
| `THROTTLED` | `pending`: the task waits beyond the tier's concurrency and starts on its own |
| `RUNNING` | `running`, with `progress` (0 to 1) as its fraction |
| `SUCCEEDED` | `succeeded` with the first address of `output`; without one, the download asks again |
| `FAILED` | `failed`, with a sentence for its `failureCode`, then Runway's `failure` and the code |
| `CANCELLED` | `cancelled` |
| any other | the answer cannot be read |

- HTTP 404: the task does not exist, or it was cancelled or deleted
  (`notFound`).
- The video's address is on Runway's CDN, signed in its query; the download
  sends it no key. The addresses "will expire within 24-48 hours; fetch the
  task again to get fresh URLs." Where the video is (`videoLocation`), when a
  download has no address: the task is asked about again, which gives a
  fresh one. How long Runway keeps a task is not documented; BaseHalf
  downloads at once.

| `failureCode` | Sentence before Runway's words |
| --- | --- |
| `SAFETY.INPUT.*` | Runway's moderation refused an input; Runway does not refund these |
| `SAFETY.OUTPUT.*` | Runway's moderation refused the video it made |
| `INPUT_PREPROCESSING.SAFETY.*` | Runway's moderation refused the prompt or an input |
| `INTERNAL.BAD_OUTPUT.*` | Runway rejected the result; logos, watermarks, or text in the inputs, or a prompt that asks for text, are common causes, and generating again may succeed |
| `ASSET.INVALID` | Runway cannot use an input, for its size, length, or another property |
| `INPUT_PREPROCESSING.INTERNAL`, `INTERNAL`, none | Runway had an internal problem; generating again in a moment may succeed |
| any other | none |

### Cancel

`DELETE /v1/tasks/{id}` cancels a task that is running, pending, or
throttled; "Invoking this method for other tasks will delete them", with
their output. So `cancel` asks about the task first (`GET`, with the
retries of a question) and sends `DELETE`, once, only to a task that is
`PENDING`, `THROTTLED`, or `RUNNING`: 204 answers true. A task that has
ended is left alone and answers false, so BaseHalf never deletes a video.
404, a task already cancelled or deleted, answers false. A task may still
end between the question and the `DELETE`; Runway then deletes it, and the
stopped generation would not have kept its video.

### Errors

Runway answers an error as `{error, issues, reason, docUrl}`: `issues` lists
`{code, path, message}` for each refused field, and `reason` is a code such
as `SAFETY.INPUT.TEXT`, `DEPRECATED_MODEL`, or `ASSET.INVALID`. The message
is Runway's `error`, its issues as `path: message`, and its reason in
parentheses.

| Status | Meaning (`errors/errors.md`) | Answer |
| --- | --- | --- |
| 400 | an input is wrong | `rejected` |
| 401 | the key is not valid, was disabled, or its account is suspended | `auth`, with a sentence to check the key |
| 404 | the resource is not available | `rejected` for a create, `notFound` otherwise |
| 429 | over a limit of the project's usage tier: on a create, the generations of the last 24 hours | `rateLimited`, with the limits of the tiers |
| 502, 503 | Runway is shedding load | `unknownOutcome` for a create; otherwise retried, then `network` |
| 504 | Runway is overloaded | as 502 |

- Runway documents no status or reason for a project without credits. A
  402 would be `balance` (the parent's rule); any other refusal carries
  Runway's own words.
- Moderation shows as a failed task, not as an HTTP error. Moderated
  generations cost the same as successful ones, and an account with too
  many is suspended.

### Limits

The limits are per project and model, by usage tier, and all video models
share one table: tier 1, 1 task at once and 50 generations a day; tier 2
(after $50 purchased), 3 and 500; tier 3 (after $100), 5 and 1,000; tier 4
(after $1,000), 10 and 5,000; tier 5 (after $5,000), 20 and 25,000. A task
beyond the concurrency waits as `THROTTLED`; a create beyond the generations
of a rolling 24 hours answers 429. Requests per minute are not limited.

## Estimate

```text
amount (USD) = credits × $0.01
credits      = 12 × duration                    Gen-4.5
             = 5 × duration                     Gen-4 Turbo
             = max(56, 28 × the clip's seconds) Aleph 2.0
```

- Credits cost $0.01 each; sales tax, where it applies, is not included.
  The price list is the one of 2026-10-19, which states no date of its own.
- Aleph 2.0 costs 28 credits a second, at least 56 credits a generation, and
  its video is as long as its clip. With files, the clip's measured length
  gives a single amount; a part of a second counts as measured, since Runway
  does not say how it rounds. Without files, a clip of 2 to 30 seconds gives
  56 to 840 credits ($0.56 to $8.40).
- An MP4 has no surcharge. Moderated tasks cost the same as others, and
  `SAFETY.INPUT` failures are not refunded; other failures are.

## Left out

- **Models Runway resells**: Seedance 2.5, 2.0, 2.0 Fast, and 2.0 Mini;
  Kling 2.5 Turbo Pro, 3.0, and O3; MiniMax H3 and H3 Max; WAN 3.0 and 3.0
  Prime; Grok Imagine Video 1.5 and 1.5 Lite; HappyHorse 1.0; Veo 3.1 and
  3.1 Fast; Gemini Omni Flash and 1.1. They are not Runway's models, and
  their makers' own APIs are BaseHalf providers or candidates for one.
- **Act-Two** (`act_two`, `/v1/character_performance`): it drives a
  character with a recorded performance, which is not generation of this
  kind ([non-goals](../video-providers.md#non-goals)).
- **Aleph 2.0 keyframes** (`keyframes`, each with `seconds`, `at`, or a
  `range`): every image needs a time in the clip, which a node's input
  cannot say.
- **Output formats** (`outputFormat`, `proresProfile`): ProRes `.mov`,
  zipped image sequences, and 10-bit or HDR deliveries cost a surcharge and
  are enabled per account; BaseHalf keeps an H.264 MP4.
- **The size `672:1584`** of Gen-4.5 Image to Video: on the inputs page,
  not in the API reference.
- **Seeds above 2147483647**: outside the shared seed.
- **Inputs as HTTPS addresses**, and `promptImage` as a list with
  `position`, which takes only `first`: AI Video sends its files itself.
- **Model Routers, recipes, workflows, Characters, avatar videos, and
  upscaling, frame rate, and HDR** (`/v1/generate/video`, `/v1/recipes/*`,
  `/v1/workflows`, `/v1/realtime_sessions`, `/v1/avatar_videos`,
  `/v1/video_upscale`, `/v1/video_to_hdr`): not one model's generation, or
  not generation.
- **Retired ids**: `gen3a_turbo` and `gen4_aleph` fail since 2026-07-30;
  `aleph2_alpha` is a deprecated alias of `aleph2`.

## Acceptance criteria

1. The catalog has the provider `runway` with one region, one API key, and
   the three models above with exactly their modes, limits, and parameters.
2. Each model and mode sends the body above, once, to its path, with the
   key and the version header; an endpoint with a path keeps it, and one
   that ends with `/v1` does not get it twice.
3. An image whose data URI would pass 5 MiB, and every clip, go through the
   upload: the storage receives the fields in order and the file last,
   without the key; a failed upload starts over with a new upload address;
   a refused upload creates no task.
4. Asking about a task maps every state above; the video downloads from the
   address of the poll, or of a new question when the download has none.
5. `cancel` sends `DELETE` once, and only to a task that has not ended.
6. 401 answers `auth`; 429 answers `rateLimited`; a create whose connection
   drops after it was sent answers `unknownOutcome` and was sent once.
7. `check` reports each rule above; a refused request sends nothing.
8. The estimate of three combinations matches the price list.

## Verification

`vscode-base/extensions/basehalf-ai-video/test/runway.test.ts` runs the
module through the provider commands against local servers that answer like
Runway's API, its storage, and its CDN; `test/providerHttp.test.ts` covers
`ProviderHttp.retry`. No test calls Runway or uses a real key.
