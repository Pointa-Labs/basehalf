# Kling

Status: Active (2026-10-19; image models, 2026-10-22; names in the prompt, 2026-10-24)
Decisions: [D59](../../decisions.md#d59--video-providers-are-built-in-integrations-with-each-models-exact-settings-users-bring-their-own-keys-new-2026-10-19),
[D64](../../decisions.md#d64--basehalf-generates-images-with-the-same-cards-panel-and-providers-new-2026-10-22),
[D74](../../decisions.md#d74--a-prompt-mentions-its-inputs-files-and-each-provider-module-names-them-as-its-model-reads-them-new-2026-10-24)
Parent: [Providers and the model catalog](../providers.md)

This specification owns the Kling module of the provider service
(`vscode-base/src/vs/platform/basehalfProviders/node/kling.ts`): the
catalog entry it declares, the requests it sends, and how it reads Kling's
answers, for its video models and, in [Image models](#image-models), its
image models. What is the same for every provider (the commands, checks from
the declarations, retries, the download, plain messages) is owned by the
parent specification and is not repeated here.

## Sources

Kling's API documentation, international `https://kling.ai/document-api/`
and China `https://klingai.com/document-api/`, which have the same pages
under the same paths and agree except for their language. Every page below
was read on 2026-10-18 and read again, unchanged, on 2026-10-19.

| Page (path) | What this specification takes from it |
| --- | --- |
| `api/get-started/authentication` | the base URL of each region; the API key in `Authorization: Bearer` |
| `guides/get-started/quick-start` | the console of each region |
| `updates/api` | 2026-06-17: the new API takes API keys only; 2026-07-15: Kling 3.0, 3.0 Omni, 2.6, and 2.5 Turbo were added to the new API, and the legacy API stays; 2026-04-23: 4K; 2025-09-29: results are deleted after 30 days |
| `guides/capability-map/video` (updated 2026-05-19) | per model: durations, first and last frames, sound |
| `api/video/3-0-turbo/text-to-video`, `.../image-to-video` | Kling 3.0 Turbo |
| `api/video/3-0-omni/text-to-video`, `.../image-to-video` | Kling 3.0 (paths `/text-to-video/kling-3.0`, `/image-to-video/kling-3.0`) |
| `api/video/3-0-omni/video-omni` | Kling 3.0 Omni |
| `api/video/o1/video-omni` | Kling O1 |
| `api/video/2-6/text-to-video`, `.../image-to-video` | Kling 2.6 |
| `api/video/2-5-turbo/text-to-video`, `.../image-to-video` | Kling 2.5 Turbo |
| the query sections of every model page (identical) | `GET /tasks`, the task states, `outputs` |
| `api/video/multi-elements` | base64 is sent without a `data:` prefix |
| `api/get-started/concurrency-rules` | concurrency per account, model, and resource package; code 1303 |
| `api/get-started/error-codes` | the codes and their statuses |

## Regions and credentials

| Region | Label | Base URL | Console |
| --- | --- | --- | --- |
| `cn` (default) | China | `https://api-beijing.klingai.com` | `https://klingai.com/dev/api-key` |
| `intl` | International | `https://api-singapore.klingai.com` | `https://kling.ai/dev/api-key` |

- One credential, `apiKey` (**API Key**), sent as `Authorization: Bearer
  <key>`. It is made in the console of the region.
- Every video request uses the **new API**, where the model is part of the
  path (`/text-to-video/kling-3.0`). It serves every video model below in
  both regions and takes API keys only. Kling O1 is not named in the update
  of 2026-07-15, but its page gives its path on the new API,
  `/omni-video/kling-o1`. The legacy video API (`/v1/videos/...`, the model in
  `model_name`, the state `succeed`, the result in
  `data.task_result.videos`) is not used.
- Kling's image models exist on the legacy API only (`/v1/images/...`), which
  takes the same API key: the authentication page names the API key "for all
  models", and the update of 2026-06-17 says that it works with every
  existing model beside a token signed from an access key and a secret key,
  which BaseHalf does not use ([Image models](#image-models)).

## Models

One catalog model per Kling model id. Kling uses the same id for text to
video and image to video, and the same id in both regions.

| Catalog id | Label | Sent as (`cn`, `intl`) | Modes | Created at |
| --- | --- | --- | --- | --- |
| `kling-3.0-turbo` | Kling 3.0 Turbo | `kling-3.0-turbo` | Frames (start frame only) | `/text-to-video/…`, `/image-to-video/…` |
| `kling-3.0` | Kling 3.0 | `kling-3.0` | Frames | `/text-to-video/…`, `/image-to-video/…` |
| `kling-3.0-omni` | Kling 3.0 Omni | `kling-3.0-omni` | Frames, References | `/omni-video/…` |
| `kling-o1` | Kling O1 | `kling-o1` | Frames, References | `/omni-video/…` |
| `kling-2.6` | Kling 2.6 | `kling-2.6` | Frames | `/text-to-video/…`, `/image-to-video/…` |
| `kling-2.5-turbo` | Kling 2.5 Turbo | `kling-2.5-turbo` | Frames | `/text-to-video/…`, `/image-to-video/…` |

No model is deprecated. The prompt is required
when no image is sent (`withoutMedia`): Kling requires the prompt of text to
video, and its image pages list the prompt item among the contents without
requiring it. The prompt is at most 3,072 characters on 3.0 Turbo, 3.0, and
3.0 Omni, and 2,500 on O1, 2.6, and 2.5 Turbo.

## Modes and inputs

| Mode | Models | Start frame | End frame | Reference images | Videos, audio, source |
| --- | --- | --- | --- | --- | --- |
| Frames (`frames`) | all | optional | optional; none on 3.0 Turbo | none | none |
| References (`reference`) | 3.0 Omni, O1 | none | none | 1 to 7 | none |

- Frames without an image is text to video. An end frame needs a start
  frame (Kling does not make a video from a last frame only).
- Limits of both modes, from every image section: each side at least 300 px
  (`imageMinSide: 300`), width to height between 1:2.5 and 2.5:1
  (`imageAspect: [0.4, 2.5]`), at most 50 MB (`imageMaxBytes: 52428800`).
- Kling takes JPEG and PNG images only (`imageFormats: ["png", "jpeg"]`); the
  window draws any other image to PNG before it sends it.
- 7 reference images: without a reference video and without elements, the
  reference images may number 7.

## Parameters

None is advanced and none is optional; every value is sent, except the ratio
with a start frame.

| Name | Label | Kind | Values | Default | Models | Sent as |
| --- | --- | --- | --- | --- | --- | --- |
| `resolution` | Resolution | choice | `720p`, `1080p`; also `4k` (4K) on 3.0 and 3.0 Omni | `720p` | all | `settings.resolution` |
| `ratio` | Ratio (ratio shapes) | choice | `16:9`, `9:16`, `1:1` | `16:9` | all, both modes | `settings.aspect_ratio`; set by the start frame (`setByStartFrame`), so it is sent only without one |
| `duration` | Duration | integer, seconds | 3–15 step 1 (3.0 Turbo, 3.0, 3.0 Omni); 3–10 step 1 (O1); 5 or 10, step 5 (2.6, 2.5 Turbo) | 5 | all | `settings.duration`, a number |
| `sound` | Sound | boolean | | `false` (off, Kling's default) | 3.0, 3.0 Omni, 2.6 | `settings.audio`: `native` or `off` |

The defaults are Kling's own.

- A video made from a start frame takes the frame's shape; the ratio's
  tooltip says so. Kling's image-to-video endpoints have no aspect ratio, and
  the omni endpoint requires one only when no first frame is sent.
- Kling 3.0 Turbo has no sound setting and always makes sound.
  O1 and 2.5 Turbo make no sound (O1's `audio` value `original` keeps the
  sound of a reference video, which is not offered).

### Rules between parameters

`check` reports these after the checks of the declarations, in this order:

| Model | Rule | Source |
| --- | --- | --- |
| 3.0 Turbo | with a start frame, the prompt is at most 2,500 characters | 3.0 Turbo image to video |
| O1 | in Frames mode, the duration is 5 or 10 seconds | O1 page (a first frame without references); capability map (text and images) |
| 2.6 | sound only at 1080p | 2.6 text and image to video |
| 2.6 | start and end frames only at 1080p | 2.6 image to video; capability map |
| 2.6 | start and end frames only without sound | capability map ("1080P silent videos") |
| 2.5 Turbo | start and end frames only at 1080p | 2.5 Turbo image to video; capability map |

`check` then reports a request whose JSON with its images in base64 would be
larger than the 128 MiB BaseHalf sends.

## Requests

All requests carry `Authorization: Bearer <key>` and
`Content-Type: application/json`. Nothing is sent in `options`: no callback
URL, custom task id, or watermark. An image is its file's bytes as plain
base64, without a `data:` prefix, in the `url` field.

**Frames without a start frame, on 3.0 Turbo, 3.0, 2.6, and 2.5 Turbo:**
`POST /text-to-video/<model>` with

```json
{ "prompt": "<prompt>", "settings": { "resolution": "720p", "aspect_ratio": "16:9", "duration": 5, "audio": "off" } }
```

**Frames with a start frame, on the same models:**
`POST /image-to-video/<model>` with

```json
{
	"contents": [
		{ "type": "prompt", "text": "<prompt>" },
		{ "type": "first_frame", "url": "<base64>" },
		{ "type": "last_frame", "url": "<base64>" }
	],
	"settings": { "resolution": "1080p", "duration": 10, "audio": "off" }
}
```

**Both modes on 3.0 Omni and O1:** `POST /omni-video/<model>` with

```json
{
	"contents": [
		{ "type": "prompt", "text": "<prompt>" },
		{ "type": "refer_image", "url": "<base64>", "id": "image_1" }
	],
	"settings": { "resolution": "720p", "aspect_ratio": "16:9", "duration": 5, "audio": "off" }
}
```

- `audio` is sent only by models with the Sound setting.
- The prompt item is sent only when the prompt has text other than spaces.
- Frames on the omni endpoint send `first_frame` and `last_frame` items;
  References send one `refer_image` item per image, in order.
- **Names in the prompt** ([providers](../providers.md#names-in-the-prompt)).
  Every image item of the omni endpoint has an `id`, `image_1` onward in the
  order of `contents`, the frames included, and a mention is written `@` and
  that id: "Specify an image, an Element, a video in the format of @xxx,
  such as @image_1"; the `id` is the "input index ID, used to specify in
  prompt", unique in the task (3.0 Omni and O1 video pages, read
  2026-10-24). With at most 7 images, no id is a part of another. The other
  video models' frames have no `id` and no name in the documentation, so the
  shared names are written.
- The answer is `{code: 0, message, request_id, data: {id, status, …}}`; the
  task id is `data.id`, a string. A 2xx answer with another code is read as
  in [Errors](#errors): a code that says the request was refused made no task;
  a 5xxx code, a code the documentation does not list, or a missing id leave
  the outcome unknown.

### Asking about a task

`GET /tasks?task_ids=<id>`. The task is the entry of `data` whose `id` is the
task id, or the only entry. An answer without it means Kling does not know
the task (`notFound`).

| Kling `status` | Answer |
| --- | --- |
| `submitted` | `pending` |
| `processing` | `running` (Kling reports no progress) |
| `succeeded` | `succeeded` with the `url` of the first output of type `video` (not its `watermark_url`); without one, the answer cannot be read |
| `failed` | `failed` with the task's `message` |
| any other | the answer cannot be read |

- The video's address is on Kling's CDN; the download sends it no
  credentials. Kling deletes results after 30 days; BaseHalf downloads at
  once.
- Where the video is (`videoLocation`), when a download has no address: the
  task is asked about again.
- **Cancel**: Kling has no cancellation. `cancel` sends nothing and answers
  false.

### Errors

Kling answers an error as `{code, message, request_id}`. The module reads the
code; its message is Kling's message with a sentence of what to do and the
code.

| Codes (status) | Meaning | Answer |
| --- | --- | --- |
| 1000–1004 (401) | authentication failed | `auth`; the message says to check the key in Providers |
| 1100 (429) | the account's status is abnormal | `rejected` |
| 1101 (429) | the account is in arrears | `balance` |
| 1102 (429) | the resource package is used up or expired | `balance` |
| 1103 (403) | the account may not use this API or model | `rejected` |
| 1200, 1201 (400) | invalid request or parameter | `rejected` |
| 1202, 1203 (404) | unknown method or resource, such as the model | by the status: `rejected` for a create, `notFound` otherwise |
| 1300, 1301 (400) | platform policy, content safety | `rejected` |
| 1302 (429) | too many requests | `rateLimited` |
| 1303 (429) | more tasks at once than the resource package allows | `rateLimited` |
| 1304 (429) | the account's IP allow list | `rejected` |
| 5000–5002 (500, 503, 504) | Kling's own error | by the status: `unknownOutcome` for a create, `network` (asked again) otherwise |

Concurrency counts per account, model, and resource package; a task holds
its place from `submitted` until it ends. Asking about tasks is not limited.

## Left out

- **Multi-shot storyboards.** Not offered in this phase. `multi_shot` is not
  sent, so Kling's default applies on 3.0 and 3.0 Omni: a prompt written in
  Kling's shot format (`shot 1, 3, …; shot 2, 2, …;`) makes several shots.
- **Reference videos, video editing, and motion control** (`feature_video`,
  `base_video`, the motion control endpoints) and the `original` sound that
  goes with them: Kling takes videos only as public URLs and has no upload
  endpoint.
- **Elements and voices** (`element`, `voice` items): they name assets made
  in Kling's element and voice APIs, which a generation card's inputs are not.
- **Negative prompt and CFG scale**: the new API has neither; only the
  legacy API takes a `negative_prompt`. On the new API the prompt holds both
  what to show and what to avoid.
- **Older video models** such as Kling 2.1: the documentation gives them no
  path on the new API.
- **Watermarked results, callbacks, and custom task ids**: BaseHalf asks
  about tasks itself and keeps the video without a watermark.
- **Avatar, lip sync, effects, and audio generation**: not video generation
  of this kind ([non-goals](../providers.md#non-goals)).

## Acceptance criteria

1. The catalog has the provider `kling` with the two regions, one API key,
   and the six models above with exactly their modes, limits, and parameters.
2. Each mode of each model sends the body above, once, to its path, with the
   key in `Authorization`.
3. Asking about a task maps `submitted`, `processing`, `succeeded`, and
   `failed` as above; the video downloads from the address of the poll, or of
   a new question when the download has none.
4. `cancel` answers false and sends nothing.
5. 401 answers `auth`; each 429 code answers as the error table says (1101
   and 1102 `balance`); a create whose connection drops after it was sent
   answers `unknownOutcome` and was sent once.
6. `check` reports each rule between parameters and refuses WebP and GIF
   images; a refused request sends nothing.

## Image models

### Image sources

Read on 2026-10-22 under `https://kling.ai/document-api/` and
`https://klingai.com/document-api/`, which agree on every field, value, and
limit. Only the capability map shows a date.

| Page (path) | What it settles |
| --- | --- |
| `api/image/3-0-omni/image-generation` (the same as `api/image/2-1/image-generation`) | `POST /v1/images/generations` and its query: Kling Image 3.0 and 2.1 |
| `api/image/3-0-omni/image-omni` (the same as `api/image/o1/image-generation`) | `POST /v1/images/omni-image` and its query: Kling Image 3.0 Omni and O1 |
| `api/image/2-1/multi-image-to-image` | Kling Image 2.1's subjects, scene, and style ([Images left out](#images-left-out)) |
| `guides/capability-map/image` (updated 2026-05-19) | per model: ratios, resolutions, Adaptive (`auto`), series, references |
| `api/get-started/authentication`, `updates/api` | the API key for every model (2026-06-17); the legacy API stays (2026-07-15) |
| `api/get-started/concurrency-rules` | an image task holds one place for each image it makes |
| `api/get-started/error-codes` | the codes, the same as for videos |

### Image catalog

| Catalog id | Label | Sent as (`cn`, `intl`) | Created at | Asked about at | References |
| --- | --- | --- | --- | --- | --- |
| `kling-image-3.0-omni` | Kling Image 3.0 Omni | `kling-v3-omni` | `POST /v1/images/omni-image` | `GET /v1/images/omni-image/{task_id}` | 0–10 |
| `kling-image-3.0` | Kling Image 3.0 | `kling-v3` | `POST /v1/images/generations` | `GET /v1/images/generations/{task_id}` | 0–1 |
| `kling-image-o1` | Kling Image O1 | `kling-image-o1` | `POST /v1/images/omni-image` | `GET /v1/images/omni-image/{task_id}` | 0–10 |

- Every image model has the kind `image`, the one mode References
  (`reference`) with `images.min` 0, and runs as a task. Its `outputFormat`
  is `png`: Kling states no format, and its examples are PNG.
- The prompt is always required (both calls require it) and at most 2,500
  characters.
- They follow the video models, in this order. Kling Image 3.0 Omni comes
  first: it takes the most references and resolutions.
- **Kling Image 2.1** (`kling-v2-1`) is left out. What it adds over the
  three models is a subject or a face reference with their fidelities
  (`image_reference`, `image_fidelity`, `human_fidelity`) and a multi-image
  call of subjects, a scene, and a style (`/v1/images/multi-image2image`):
  each gives an input a role, which references in order cannot say, so it
  adds no mode BaseHalf can offer. Its text to image and single reference are
  what Kling Image 3.0 does, newer.
- Kling deletes results after 30 days; BaseHalf downloads them at once.

### Image inputs

- JPEG and PNG only (`imageFormats: ["png", "jpeg"]`), each side at least
  300 px (`imageMinSide: 300`), width to height between 1:2.5 and 2.5:1
  (`imageAspect: [0.4, 2.5]`), at most 10 MB (`imageMaxBytes: 10485760`,
  read as MiB as for videos). The window draws any other image to PNG.
- An image is its file's bytes as plain base64 without a `data:` prefix: the
  one `image` of Kling Image 3.0, and `image_list` items `{ "image": … }` of
  the omni models, in order.
- A mention of the n-th image of an omni image model is written
  `<<<image_n>>>`: "Specify an image in the format of <<<>>>, such as
  <<<image_1>>>" (Image 3.0 Omni and Image O1 pages, read 2026-10-24),
  counted in the order of `image_list`. Kling Image 3.0 takes one image,
  which no page names: the shared names are written.
- `check` reports a request whose JSON with its images in base64 would be
  larger than the 128 MiB BaseHalf sends.

### Image parameters

| Name | Label | Kind | Values | Default | Models | Sent as |
| --- | --- | --- | --- | --- | --- | --- |
| `ratio` | Ratio | choice, ratio shapes | `16:9`, `9:16`, `1:1`, `4:3`, `3:4`, `3:2`, `2:3`, `21:9`; `adaptive` (Adaptive) on 3.0 Omni and O1 | `16:9` on 3.0 and 3.0 Omni, `adaptive` on O1 | all | `aspect_ratio`, Adaptive as `auto` |
| `resolution` | Resolution | choice | `1k`, `2k` (1K, 2K); also `4k` (4K) on 3.0 Omni | `1k` | all | `resolution` |
| `count` | Images | integer 1–9 | | 1 | all | `n` |
| `negative_prompt` | Negative Prompt | text, 2,500, optional, More | | | 3.0 | `negative_prompt`, when not blank |

- The defaults are Kling's own, except the ratio of 3.0 Omni: Kling's
  default there is `auto`, which 3.0 Omni refuses without a reference, so its
  default is `16:9`, Kling's default on its other call.
- Adaptive lets Kling choose the shape from the inputs; the tooltip says so,
  and on 3.0 Omni that it needs a reference image.
- O1's 4K is not offered: its call lists `4k`, but the capability map gives
  O1 1K and 2K only.
- No seed and no prompt rewriting: Kling has neither. No watermark setting:
  Kling's watermark makes a second, marked copy (`watermark_url`) beside the
  clean `url`, which is the one BaseHalf downloads, so `watermark_info` is not
  sent.

Rules between parameters and inputs, reported by `check`:

| Model | Rule | Source |
| --- | --- | --- |
| 3.0 Omni | Adaptive needs a reference image | capability map: text to image, "Auto ratio is not supported" |
| 3.0 | a negative prompt only without a reference image | generations: "In the Image-to-Image scenario … negative prompts are not supported" |

### Image requests

- **Create**, once, with `Authorization: Bearer <key>` and
  `Content-Type: application/json`. Kling Image 3.0:

  ```json
  { "model_name": "kling-v3", "prompt": "<prompt>", "negative_prompt": "<when set>", "image": "<base64, with a reference>", "resolution": "1k", "n": 2, "aspect_ratio": "16:9" }
  ```

  The omni models:

  ```json
  { "model_name": "kling-v3-omni", "prompt": "<prompt>", "image_list": [{ "image": "<base64>" }], "resolution": "4k", "n": 4, "aspect_ratio": "auto" }
  ```

  Nothing else is sent: no `result_type` (Kling's default makes single
  images, not a series), `series_amount`, `element_list`, `watermark_info`,
  `callback_url`, or `external_task_id`. The answer is
  `{code: 0, message, request_id, data: {task_id, task_status, …}}`; the task
  id is `data.task_id`. Another code is read as in [Errors](#errors).
- **Asking about a task** at the model's own path, never at `GET /tasks`
  (whether the new API sees these tasks is not documented). The answer is
  `{code, message, data: {task_id, task_status, task_status_msg, task_result}}`:

  | `task_status` | Answer |
  | --- | --- |
  | `submitted` | `pending` |
  | `processing` | `running` (no progress) |
  | `succeed` | `succeeded` with the `url` of each of `task_result.images`, in order, never its `watermark_url`; without one, the answer cannot be read |
  | `failed` | `failed` with `task_status_msg` |
  | any other | the answer cannot be read |

- The images are on Kling's CDN and are downloaded without the key.
- An image task holds one of the account's places for each image it makes
  (`n`); over the limit, Kling answers 1303 (`rateLimited`).
- **Cancel**: none, as for videos.

### Images left out

- **Kling Image 2.1** and its multi-image call ([Image catalog](#image-catalog)).
- **Series** (`result_type: "series"`, `series_amount`) of 3.0 Omni: the
  model may choose how many images it makes, while a generation makes its
  cards before it sends.
- **Elements** (`element_list`): assets of Kling's element library, which a
  card's inputs are not.
- **Outpainting** (`/v1/images/editing/expand`): editing, not generation
  ([non-goals](../providers.md#non-goals)).

### Image open questions

1. The format of the images: not stated; PNG is declared, and an image in
   another format lands under its own extension.
2. 4K on O1: offered by the call, not by the capability map; not offered.
3. Whether `GET /tasks` of the new API sees these tasks: not used.

### Image acceptance criteria

1. The catalog lists the three image models above, after the video models,
   with the kind `image`, PNG, as tasks, in both regions, with exactly their
   mode, limits, and parameters.
2. Each model's create goes once to its path with the key and the body above,
   its references as plain base64.
3. Asking about a task goes to the model's own path and maps `submitted`,
   `processing`, `succeed` (every image's `url` in order), and `failed`; an
   image downloads without the key.
4. A refused key answers `auth`, a 429 code as the error table says, a refused
   content `rejected`, and a create whose connection drops `unknownOutcome`,
   each after one request.
5. `check` refuses Adaptive without a reference on 3.0 Omni and a negative
   prompt with a reference on 3.0; a refused request sends nothing.

## Verification

`vscode-base/src/vs/platform/basehalfProviders/test/node/kling.test.ts` runs the module
through the provider commands against a local server that answers like Kling,
for the video models and the image models
([Image acceptance criteria](#image-acceptance-criteria)). No test calls Kling
or uses a real key.
