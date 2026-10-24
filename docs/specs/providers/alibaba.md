# Alibaba (Wan, Qwen-Image)

Status: Active (2026-10-19; image models, 2026-10-22)
Decisions: [D59](../../decisions.md#d59--video-providers-are-built-in-integrations-with-each-models-exact-settings-users-bring-their-own-keys-new-2026-10-19),
[D64](../../decisions.md#d64--basehalf-generates-images-with-the-same-cards-panel-and-providers-new-2026-10-22)
Related: [providers and the model catalog](../providers.md),
[generation cards](../generation-cards.md)

This specification owns the provider module `alibaba` of the AI Video
extension (`extensions/basehalf-ai-video/src/providers/alibaba.ts`): the Wan
and HappyHorse video models and the Qwen-Image and Wan image models of
Alibaba Cloud Model Studio (DashScope), their declarations in the catalog,
and the requests that run them. The sections up to
[Image models](#image-models) are about the video models.
Everything the six provider commands do for every provider is owned by
[providers and the model catalog](../providers.md).

The provider is labeled **Alibaba (Wan, Qwen-Image)**.

## Sources

Read on 2026-10-18 and checked again on 2026-10-19. International pages are
under `https://www.alibabacloud.com/help/en/model-studio/`, China pages under
`https://help.aliyun.com/zh/model-studio/`; both were read where they differ.

| Page | What it settles |
| --- | --- |
| `regions` (updated 2026-10-13), `base-url`, `singapore-regional-access-information`, `beijing-access-information` | regions, hosts, keys per region, the API key consoles |
| `wan3-video-generation-api-reference` (updated 2026-10-15), `wan3-video-generation-guide` | Wan 3.0 requests, media types and combinations, limits, durations |
| `text-to-video-api-reference`, `image-to-video-general-api-reference`, `wan-video-to-video-api-reference`, `wan-video-editing-api-reference` | Wan 2.7 text to video, image to video, reference to video, video editing |
| `legacy-wan-text-to-video-api-reference`, `legacy-image-to-video-api-reference`, `legacy-wan-reference-to-video-api-reference` | Wan 2.6 |
| `happyhorse-text-to-video-api-reference`, `happyhorse-image-to-video-api-reference`, `happyhorse-reference-to-video-api-reference`, `happyhorse-video-edit-api-reference` | HappyHorse |
| `video-generate-edit-model`, `newly-released-models` | which models exist, their resolutions and lengths, release dates |
| `manage-asynchronous-tasks`, `async-task-api` | task query, states, cancellation |
| `get-temporary-file-url` | the temporary upload |
| `rate-limit` (updated 2026-10-16), `error-code` | limits and error codes |
| OSS `postobject` (`https://www.alibabacloud.com/help/en/oss/developer-reference/`) | the upload form and its answers |

## Regions, hosts, and credentials

| Region | Label | Base URL | Console |
| --- | --- | --- | --- |
| `cn` | China (Beijing) | `https://dashscope.aliyuncs.com` | `https://bailian.console.aliyun.com/cn-beijing/model/settings/api-key` |
| `intl` | International (Singapore) | `https://dashscope-intl.aliyuncs.com` | `https://modelstudio.console.alibabacloud.com/ap-southeast-1/model/settings/api-key` |

- A region has its own keys and models; a key of one region does not work in
  the other.
- Credentials: one API key, sent as `Authorization: Bearer <key>` to the
  endpoint's origin. A create also sends `X-DashScope-Async: enable`
  (required; without it the provider answers "current user api does not
  support synchronous calls") and, when an input is an `oss://` address,
  `X-DashScope-OssResourceResolve: enable`.
- The base URLs are the shared DashScope hosts. Alibaba recommends the
  workspace host `https://{WorkspaceId}.{cn-beijing|ap-southeast-1}.maas.aliyuncs.com`
  (higher concurrency, a 3,600-second request timeout instead of 600) and
  says the shared hosts get no new features after 2026-09-30. Every model
  declared here was released before that date (Wan 3.0 on 2026-08-06, Wan
  3.0 Prime on 2026-08-20), the Wan 2.7 and HappyHorse references say the
  shared host "remains fully functional", and the regions page says moving
  to a workspace host needs no change but the host. The Wan 3.0 reference
  shows only workspace hosts, as every video page now does, and does not say
  whether the shared host serves it. The shared host takes a key of any
  workspace of the region; the workspace host takes only its own
  workspace's keys and needs the workspace id, which BaseHalf cannot know.
  So the shared host is the region's base URL, and a user who wants the
  workspace host, or whose account answers that a model does not exist on
  the shared host, enters `https://{WorkspaceId}.{region}.maas.aliyuncs.com`
  as the provider's **Endpoint**.
- The endpoint is used with or without `/api/v1`: the module adds `/api/v1`
  before every path unless the endpoint already ends with it.
- Other regions (US Virginia, Germany Frankfurt, Japan Tokyo, China Hong
  Kong) are not offered: they have only workspace hosts or a few of these
  models.

## Catalog models

The catalog lists one model per version. Alibaba has one model id per task of
a version (text to video, image to video, references, editing); the mode and
the inputs of a generation choose the task. `providerModels` maps both
regions to the id of the model's first task, `check` answers `providerModel`,
the id the request would be sent with, and `submit` sends exactly that id.

| Catalog id | Label | Mode and inputs | Task (Alibaba's id) |
| --- | --- | --- | --- |
| `wan3.0` | Wan 3.0 | every mode | `wan3.0-video` |
| `wan3.0-prime` | Wan 3.0 Prime | every mode | `wan3.0-video-prime` |
| `happyhorse-1.1` | HappyHorse 1.1 | Frames without a frame | `happyhorse-1.1-t2v` |
| | | Frames with a start frame | `happyhorse-1.1-i2v` |
| | | References | `happyhorse-1.1-r2v` |
| `wan2.7` | Wan 2.7 | Frames without a frame | `wan2.7-t2v` |
| | | Frames with a start frame, and an end frame if any | `wan2.7-i2v` |
| | | References | `wan2.7-r2v` |
| | | Edit (China only) | `wan2.7-videoedit` |
| | | Extend | `wan2.7-i2v` (from a clip) |
| `wan2.6` | Wan 2.6 | Frames without a frame | `wan2.6-t2v` |
| | | Frames with a start frame | `wan2.6-i2v` |
| `wan2.6-flash` | Wan 2.6 Flash | Frames, start frame required | `wan2.6-i2v-flash` |
| `happyhorse-1.0` | HappyHorse 1.0 | as HappyHorse 1.1 | `happyhorse-1.0-t2v`, `-i2v`, `-r2v` |

- The models are listed in this order, in both regions. Every task id is the
  same in both regions.
- Alibaba offers `wan2.7-videoedit` in both regions, but it takes a video,
  and outside China BaseHalf has no way to send one
  ([Inputs](#inputs-and-the-temporary-upload)): every Edit and Extend mode
  names the China region (`regions: ["cn"]`), so International shows it dimmed
  and `check` refuses it there.
- Prompts: every model declares `withoutMedia`, the rule of its loosest
  task, so a generation from the prompt alone needs one. `check` adds the
  stricter rule of a task: reference to video (Wan 2.7 and HappyHorse
  References) needs a prompt. The longest prompt is 20,000 characters for
  Wan 3.0, 5,000 for Wan 2.7 and HappyHorse, and 1,500 for Wan 2.6 and 2.6
  Flash; the provider would cut a longer one, so the declarations refuse it.
  HappyHorse takes 5,000 characters or 2,500 Chinese characters: `check`
  counts a Chinese character (CJK ideographs) as two and refuses more than
  5,000.

## Parameters

The shared names of [providers](../providers.md#parameters)
(`resolution`, `ratio`, `duration`, `sound`, `seed`, `negative_prompt`,
`prompt_extend`, `watermark`) and Alibaba's own (`shot_type`,
`audio_setting`). A model declares the union of its tasks' parameters, with
`modes` where they apply; a task sends only those it takes, under Alibaba's
name and value: `resolution` as written in capitals (`1080p` is sent as
`1080P`), `sound` as `audio`, `negative_prompt` in `input`, every other one
under its own name in `parameters`. An optional parameter that is not set, or
an empty negative prompt, sends nothing.

| Name | Label | Kind | Models and values (the default in bold) |
| --- | --- | --- | --- |
| `resolution` | Resolution | choice, labels 480p, 720p, 1080p (sent as 480P, 720P, 1080P) | Wan 3.0, HappyHorse 1.1: `480p`, `720p`, **`1080p`**. Wan 2.7, Wan 2.6, Wan 2.6 Flash, HappyHorse 1.0: `720p`, **`1080p`** |
| `ratio` | Ratio | choice, ratio; in Frames on Wan 2.7, Wan 2.6, and HappyHorse set by the start frame (`setByStartFrame`) | Wan 3.0 (Frames, References): **adaptive**, 21:9, 16:9, 4:3, 1:1, 3:4, 9:16. Wan 2.7 (Frames, References) and Wan 2.6: **16:9**, 9:16, 1:1, 4:3, 3:4. HappyHorse: **16:9**, 9:16, 1:1, 4:3, 3:4, 4:5, 5:4, 9:21, 21:9 |
| `duration` | Duration | integer, seconds | Wan 3.0 (Frames, References): 2–30, **5**, or Auto (`-1`). Wan 2.7 (Frames, References, Extend), Wan 2.6, Wan 2.6 Flash: 2–15, **5**. HappyHorse: 3–15, **5** |
| `sound` | Sound | boolean | Wan 3.0, Wan 2.6 Flash: **on**; sent as `audio` |
| `audio_setting` | Sound | choice | Wan 2.7 (Edit): **auto**, origin (Keep Original) |
| `shot_type` | Shots | choice | Wan 2.6, Wan 2.6 Flash: **single**, multi |
| `negative_prompt` | Negative Prompt | text, 500, optional, More | Wan 2.7, Wan 2.6, Wan 2.6 Flash |
| `prompt_extend` | Prompt Rewriting | boolean, More | Wan 3.0, 2.7, 2.6, 2.6 Flash: **on** |
| `watermark` | Watermark | boolean, More | **off**, as for every provider; HappyHorse's own default is on |
| `seed` | Seed | integer 0–2147483647, optional, More | every model |

- `ratio` in Frames is sent only by text to video: a start frame sets the
  shape of the video, which its tooltip says. References sends it. Wan 2.6
  text to video (`wan2.6-t2v`) takes no ratio or resolution but a size,
  `W*H`, for each pair as its documentation lists them: 720p 16:9 `1280*720`, 9:16
  `720*1280`, 1:1 `960*960`, 4:3 `1088*832`, 3:4 `832*1088`; 1080p 16:9
  `1920*1080`, 9:16 `1080*1920`, 1:1 `1440*1440`, 4:3 `1632*1248`, 3:4
  `1248*1632`.
- Wan 3.0 Edit and Extend send `ratio: "adaptive"` and `duration: -1`, as the
  guide recommends; they declare neither parameter.
- Wan 2.7 Edit sends no ratio and no duration: the edit keeps the video's
  shape and length, which is what Alibaba does when they are left out
  ([What is left out](#what-is-left-out-and-why)).
- In Extend, the Wan 2.7 duration is the length of the whole result, the clip
  included.

Ranges that the inputs narrow, answered by `check` as limits of `duration`
(D70; [providers, Requests](../providers.md#requests)):

- Wan 3.0: with videos, the duration goes up to 30 seconds minus the videos'
  length, rounded down, when the files are measured; the reference says
  "the total input video duration + output video duration must not exceed
  30 seconds" (read again on 2026-10-24). A sum up to 0.05 s over 30 passes,
  for the rounding of a measured length. The reason says how long the video
  or the videos are, such as "The connected video lasts 5.0 seconds, and Wan
  3.0 makes at most 30 seconds with it." Auto is left to the model.
- Wan 2.7 References: with a reference video, the duration goes up to 10
  seconds: "With a reference video, Wan 2.7 makes at most 10 seconds."

Rules between parameters and inputs, reported by `check`:

- Wan 2.7 References: at least one reference image or video, and at most five
  together.
- Wan 2.6 and 2.6 Flash: Multiple shots need Prompt Rewriting (`shot_type`
  takes effect only with `prompt_extend: true`).
- Wan 2.7 and HappyHorse References need a prompt.
- Outside China, Edit and Extend (by their modes' regions), and a video or
  audio input, are refused ([Inputs](#inputs-and-the-temporary-upload)).

## Modes and limits

| Model | Mode | Slots | Limits |
| --- | --- | --- | --- |
| Wan 3.0, Prime | Frames | start and end frame optional; none is text to video | images 240–8,000 px, aspect 1:8–8:1, 20 MiB |
| | References | images 0–10, videos 0–5, audio 0–5 | images as above; videos 1–15 s each, 15 s together, 100 MiB; audio 1–15 s each, 15 s together, 15 MiB |
| | Edit | the video to change, images 0–10 | as References |
| | Extend | the video to continue | as References |
| Wan 2.7 | Frames | start and end frame optional; none is text to video | images 240–8,000 px, aspect 1:8–8:1, 20 MiB |
| | References | images 0–5, videos 0–5 | images as Frames; videos 1–30 s, 100 MiB |
| | Edit | the video, images 0–4 | video 2–10 s, 100 MiB; images as Frames |
| | Extend | the clip to continue (`first_clip`) | video 2–10 s, 100 MiB |
| Wan 2.6 | Frames | start frame optional; none is text to video | images 240–8,000 px, 20 MiB |
| Wan 2.6 Flash | Frames | start frame required | images 240–8,000 px, 20 MiB |
| HappyHorse 1.1, 1.0 | Frames | start frame optional; none is text to video | both sides at least 300 px, aspect 1:2.5–2.5:1, 20 MiB |
| | References | images 1–9 | shorter side at least 400 px, 20 MiB |

- Images go as PNG, JPEG, or WebP, the formats every mode takes (BMP is also
  accepted by the provider but never sent); the window draws an image of
  another format, such as a GIF, to PNG first. Videos are MP4 or MOV; audio
  is WAV or MP3, and an M4A clip is refused.
- The providers also limit video resolution (240–4,096 px a side) and frame
  rate (at least 16 fps for Wan 3.0 references); AI Video does not measure
  them, and the provider refuses such a video.
- Wan reference images are documented as "PNG without an alpha channel".
  AI Video sends a PNG as it is; what the provider does with transparency is
  its answer.

## Inputs and the temporary upload

- Images are sent inline as `data:<type>;base64,…`, the type read from the
  bytes. A request carries at most 128 MiB (AI Video's limit); `check`
  refuses images whose encoding is larger.
- Videos and audio are taken only as addresses. In China (Beijing) they go
  through Alibaba's temporary upload: for each file,
  1. `GET {endpoint}/api/v1/uploads?action=getPolicy&model=<task id>` (the
     routed task's id) with the key answers `data` with `policy`, `signature`, `upload_dir`,
     `upload_host`, `oss_access_key_id`, `x_oss_object_acl`,
     `x_oss_forbid_overwrite`, `max_file_size_mb`, and `expire_in_seconds`
     (300); a policy is fetched for each file just before its upload;
  2. a multipart `POST` to `upload_host` (an OSS host, so no key is sent)
     with `OSSAccessKeyId`, `Signature`, `policy`, `x-oss-object-acl`,
     `x-oss-forbid-overwrite`, `key` = `upload_dir/<random name>.<mp4|mov|wav|mp3>`,
     `success_action_status` = `200`, and `file` last; HTTP 200 with no body
     is success. A file larger than `max_file_size_mb` is refused before it
     is sent. Each upload has its own name, so a retried upload that finds
     its own earlier copy (`409 FileAlreadyExists`) counts as done;
  3. the input is `oss://<key>`, valid for 48 hours, usable only with the
     model named in step 1 and keys of the same account.
- The upload page says the temporary upload works in China (Beijing) only,
  and the international model pages take videos and audio only as public
  URLs. So outside China, `check` refuses a video or audio input: Wan 3.0
  and Wan 2.7 References take images only there, and Edit and Extend of
  Wan 3.0 and Wan 2.7 do not run there.
- Uploads are retried as every upload is; a failed upload creates no task.

## Requests

Every path is under `{endpoint}/api/v1`.

- **Create**: `POST /services/aigc/video-generation/video-synthesis` with
  `{model, input, parameters}`, through `http.create`, once. `model` is the
  routed task's id; `input` holds the prompt when written, the negative
  prompt where the task takes one, and the inputs:

  | Task | Inputs | `parameters` |
  | --- | --- | --- |
  | `wan3.0-video`, `wan3.0-video-prime` | `media` (none for text to video): Frames `first_frame`, `last_frame`; References `reference_image`, `reference_video`, `reference_audio` in that order; Edit the video as `reference_video`, then `reference_image`; Extend the video as `reference_video` | `resolution`, `ratio`, `duration`, `audio`, `prompt_extend`, `watermark`, `seed` |
  | `wan2.7-t2v` | none | `resolution`, `ratio`, `duration`, `prompt_extend`, `watermark`, `seed` |
  | `wan2.7-i2v` | `media`: Frames `first_frame`, `last_frame`; Extend `first_clip` | `resolution`, `duration`, `prompt_extend`, `watermark`, `seed` |
  | `wan2.7-r2v` | `media`: `reference_image`, then `reference_video` | `resolution`, `ratio`, `duration`, `prompt_extend`, `watermark`, `seed` |
  | `wan2.7-videoedit` | `media`: `video`, then `reference_image` | `resolution`, `audio_setting`, `prompt_extend`, `watermark`, `seed` |
  | `wan2.6-t2v` | none | `size`, `duration`, `shot_type`, `prompt_extend`, `watermark`, `seed` |
  | `wan2.6-i2v`, `wan2.6-i2v-flash` | `img_url` (the start frame) | `resolution`, `duration`, `shot_type`, `audio` (Flash only), `prompt_extend`, `watermark`, `seed` |
  | `happyhorse-*-t2v` | none | `resolution`, `ratio`, `duration`, `watermark`, `seed` |
  | `happyhorse-*-i2v` | `media`: `first_frame` | `resolution`, `duration`, `watermark`, `seed` |
  | `happyhorse-*-r2v` | `media`: `reference_image` | `resolution`, `ratio`, `duration`, `watermark`, `seed` |

  The answer's `output.task_id` is the task id.
- **Poll**: `GET /tasks/{task_id}`. `output.task_status`: `PENDING` is
  pending, `RUNNING` running, `SUCCEEDED` succeeded with `output.video_url`,
  `FAILED` failed with `output.message` and `output.code`, `CANCELED`
  cancelled, `UNKNOWN` (the task does not exist or is older than 24 hours)
  `notFound`. No progress is reported.
- **Result**: `output.video_url`, an MP4 on an OSS host valid for 24 hours;
  it is downloaded without the key. A succeeded task without the address is
  asked once more by `videoLocation`.
- **Cancel**: `POST /tasks/{task_id}/cancel`, sent once. Only a `PENDING`
  task can be cancelled; HTTP 200 is cancelled, `400 UnsupportedOperation`
  (the task already runs or ended) is not.
- **Errors** are `{code, message, request_id}`; the message carries the
  provider's message and code. `Arrearage`, `PrepaidBillOverdue`,
  `PostpaidBillOverdue`, `BudgetLimitExceeded`, and
  `AllocationQuota.FreeTierOnly` are `balance`; `CommodityNotPurchased`
  (sent with 429) is `rejected`; `DataInspectionFailed` and
  `IPInfringementSuspect` (the content check and the intellectual-property
  check, sent with 400) are `rejected`, and the second adds that Prompt
  Rewriting can cause it, as the image pages say; other statuses follow the
  contract (`InvalidApiKey` 401 is `auth`, `Throttling.*` 429 is
  `rateLimited`). A model the endpoint does not know (`ModelNotFound`, or
  `InvalidParameter` with "Model not exist.") adds that a model released
  after 2026-09-30 may be offered only on the workspace's own host, whose API
  host the user enters as the **Endpoint** in Providers
  ([Regions, hosts, and credentials](#regions-hosts-and-credentials)). This
  holds for every model of the module, image and video.
- **Limits**: 5 requests a second and 5 running tasks per account and model,
  for every model here; over either, HTTP 429 `Throttling.*`. A
  rate-limited message says so. The task query takes 20 requests a second.

## What is left out, and why

- The ratio and the duration of Wan 2.7 Edit (`wan2.7-videoedit`): one
  `ratio` serves Frames and References with 16:9 by default and one
  `duration` 2 to 15 seconds, while an edit keeps the video's shape and
  length unless told otherwise; the edit always keeps them, as Alibaba
  recommends unless the video is to be cut short.
- Wan 2.6 reference to video (`wan2.6-r2v`, `wan2.6-r2v-flash`): their prompts name
  references `character1`, `character2` across images and videos together,
  which the node's names (Image 1, Video 1) cannot say.
- HappyHorse 1.0 video editing (`happyhorse-1.0-video-edit`): its video is a public URL only, in both regions;
  no page offers the temporary upload for it.
- Wan 2.5, 2.2, and 2.1 models, and the dated snapshots of Wan 2.7: earlier
  generations and frozen copies of models listed here; Wan 2.2 and 2.1 differ
  in resolutions between the regions, which a catalog model cannot show.
- Driving audio of Wan 2.7 and 2.6 text and image to video (`audio_url`,
  `driving_audio`), the first frame and the voices (`reference_voice`) of
  Wan 2.7 References, and the end frame of Wan 2.7 Extend
  (`first_clip` with `last_frame`): the node's Frames mode takes images only,
  its References mode no frame, and its Extend mode the clip alone
  ([generation cards, Inputs](../generation-cards.md#inputs)), and a voice belongs to one
  reference, which an input cannot say. Wan 3.0 References takes audio.
- Wan 3.0 `file` and `link` inputs (documents and web pages): a node's inputs
  are images, videos, audio, and text.
- Character animation, character swap, digital humans, VACE editing, style
  repainting, and lip sync (`wan2.2-animate-*`, `wan2.2-s2v`,
  `wan2.1-vace-plus`, `video-style-transform`, `videoretalk`): not
  generation, or a separate flow.
- Kling, Vidu, MiniMax, and PixVerse models served through DashScope: those
  providers have their own modules.
- The Asset Center `asset_id` inputs: the center holds only videos the
  provider generated.

## Image models

### Image sources

Read on 2026-10-22, international pages under
`https://www.alibabacloud.com/help/en/model-studio/` and China pages under
`https://help.aliyun.com/zh/model-studio/`, which document the same
parameters.

| Page | What it settles |
| --- | --- |
| `qwen-image-generation-and-editing-api-reference` (updated 2026-10-11; China 2026-10-10) | the Qwen-Image 3.0 and 2.1 models, the synchronous and asynchronous calls, the body, `n`, `size`, `negative_prompt`, `prompt_extend`, `watermark`, `seed`, the input limits, the answer |
| `wan-image-generation-and-editing-api-reference` (updated 2026-10-11) | the Wan 2.7 Image models, `size` levels and `W*H`, `n`, image sets, `watermark`, `seed`, the input limits, the answer with several images |
| `qwen-image-api` (updated 2026-10-11) | the earlier Qwen-Image series: its 500-character negative prompt |
| `regions` (updated 2026-10-13) | the shared hosts' 600-second request timeout, and that they get no new features after 2026-09-30 |
| `manage-asynchronous-tasks` (updated 2026-10-11) | the task query, the only asynchronous call any page shows on the shared host |
| `rate-limit` (updated 2026-10-22) | each image model's limit |
| `error-code` (updated 2026-10-11) | `DataInspectionFailed`, `IPInfringementSuspect`, `InvalidParameter` "Model not exist.", `ModelNotFound` |
| `newly-released-models` (updated 2026-10-22) | release dates |

### The synchronous call

Every image model is created by the synchronous call
`POST /services/aigc/multimodal-generation/generation`, which answers with
the images, and declares `answersAtOnce`. The asynchronous create
(`POST /services/aigc/image-generation/generation` with
`X-DashScope-Async: enable`, polled at `GET /tasks/{task_id}`) would let a
generation outlive a reload, but every image page shows both calls on
workspace hosts only, and no official page shows the asynchronous image
create on the shared hosts BaseHalf uses (`manage-asynchronous-tasks` shows
only the task query there). Alibaba recommends the synchronous call ("full
feature coverage"). It may take up to the shared host's 600-second request
timeout, the ten minutes `submit` waits for an answer at once
([providers, Requests](../providers.md#requests)).

### Models

Each id is sent as it is, the same in both regions. No retirement dates are
published.

| Catalog id | Label | Does | References |
| --- | --- | --- | --- |
| `qwen-image-3.0-pro` | Qwen-Image 3.0 Pro | text to image; edits and references | 0–3 |
| `qwen-image-3.0` | Qwen-Image 3.0 | the same, faster | 0–3 |
| `qwen-image-2.1-pro` | Qwen-Image 2.1 Pro | text to image; edits from up to 10 images; a transparent PNG when the prompt asks for one | 0–10 |
| `qwen-image-2.1-turbo` | Qwen-Image 2.1 Turbo | the same, faster | 0–10 |
| `wan2.7-image-pro` | Wan 2.7 Image Pro | text to image up to 4K; edits and references | 0–9 |
| `wan2.7-image` | Wan 2.7 Image | the same at 1K and 2K, faster | 0–9 |

- Every image model has the kind `image`, `outputFormat: "png"` (Alibaba
  answers PNG only), `answersAtOnce: true`, and the one mode References
  (`reference`) with `images.min` 0: without a reference the prompt alone
  makes the image.
- The prompt is always required. Qwen takes at most 4,500 characters:
  Alibaba advises at most 4,500 tokens and gives no character limit, and a
  character is rarely more than one token. Wan takes at most 5,000 characters
  and cuts a longer prompt, so the declarations refuse one.
- The image models are listed after the video models, in this order.
- Qwen-Image 2.1 came out on 2026-10-02 (Pro) and 2026-10-09 (Turbo), after
  the shared hosts stopped getting new features; whether they serve it is
  not documented. Read again on 2026-10-23: the image API reference gives
  Singapore only workspace hosts (`{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com`)
  and mentions the shared host only in a note on moving, which says "The
  existing domain remains fully functional"; the 2.1 Pro page lists Singapore
  with the scope International and names no host. It is declared in both
  regions; a host that does not know
  it answers that the model does not exist, and the message says how to use
  the workspace's host ([Image requests](#image-requests)).

### Inputs

| | Qwen-Image 3.0, 2.1 | Wan 2.7 Image |
| --- | --- | --- |
| Formats sent | PNG, JPEG, WebP (the provider also takes BMP, TIFF, GIF) | PNG, JPEG, WebP (also BMP) |
| Each side | at most 8,000 px | 240–8,000 px |
| Aspect (width to height) | 1:10–10:1 (`imageAspect: [0.1, 10]`) | 1:8–8:1 |
| Size | 10 MiB | 20 MiB |

- References are data URLs of their own format, read from the bytes, in the
  order of the inputs, before the text. The window draws an image of another
  format to PNG first.
- Wan's pages document PNG "without an alpha channel"; AI Video sends a PNG
  as it is, as for the video models.
- `check` refuses images whose encoding is larger than the 128 MiB AI Video
  sends in one request.

### Image parameters

| Name | Label | Kind | Values (the default in bold) | Models | Sent as |
| --- | --- | --- | --- | --- | --- |
| `ratio` | Ratio | choice, ratio shapes | **`adaptive`** (Adaptive), `1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `3:2`, `2:3`, `21:9` | all | with `resolution`, as `parameters.size` |
| `resolution` | Resolution | choice | `1k`, **`2k`** (1K, 2K); also `4k` (4K) on Wan 2.7 Image Pro | all | with `ratio`, as `parameters.size` |
| `count` | Images | integer | 1–6 (Qwen), 1–4 (Wan), **1** | all | `parameters.n` |
| `negative_prompt` | Negative Prompt | text, 500, optional, More | | Qwen-Image 3.0 Pro, 3.0 | `parameters.negative_prompt`, when not blank |
| `prompt_extend` | Prompt Rewriting | boolean, More | **on** (Alibaba's default) | Qwen | `parameters.prompt_extend` |
| `watermark` | Watermark | boolean, More | **off** (Alibaba's default) | all | `parameters.watermark` |
| `seed` | Seed | integer 0–2147483647, optional, More | | all | `parameters.seed`, when set |

The ratio's tooltip says that Adaptive follows the last reference image and
is square without one. The size sent, `parameters.size`:

- **A ratio** at a resolution is `W*H` in exactly that ratio, in whole
  multiples of 16, as large as the resolution's pixels allow (1K is
  1024 × 1024 pixels, 2K is 2048 × 2048, 4K is 4096 × 4096, as Wan's levels
  are defined):

  | Ratio | 1K | 2K | 4K (Wan 2.7 Image Pro) |
  | --- | --- | --- | --- |
  | 1:1 | `1024*1024` | `2048*2048` | `4096*4096` |
  | 16:9 | `1280*720` | `2560*1440` | `5376*3024` |
  | 9:16 | `720*1280` | `1440*2560` | `3024*5376` |
  | 4:3 | `1152*864` | `2304*1728` | `4672*3504` |
  | 3:4 | `864*1152` | `1728*2304` | `3504*4672` |
  | 3:2 | `1248*832` | `2496*1664` | `4992*3328` |
  | 2:3 | `832*1248` | `1664*2496` | `3328*4992` |
  | 21:9 | `1456*624` | `3024*1296` | `6160*2640` |

  Every size is inside the providers' ranges: Qwen 512×512 to 2048×2048
  pixels, Wan 768×768 to 2048×2048 (4096×4096 for Wan 2.7 Image Pro from the
  prompt alone), aspect 1:8 to 8:1. The pages give no table of sizes for
  these models; Qwen rounds a size to multiples of 16 itself.
- **Adaptive** on Wan is the level alone, `1K`, `2K`, or `4K`: Wan then takes
  the shape of the last reference image, and makes a square without one.
  Qwen takes no level, so the module sends the same: the last reference
  image's shape at the resolution's pixels (`W*H` rounded down to multiples
  of 16, the shape held within 1:8–8:1), or the square of the resolution
  without a reference. Qwen's own choice of a size from the prompt (no
  `size`) is not offered: the resolution would then not be what was chosen.
- Rule between parameters and inputs, reported by `check`: Wan 2.7 Image Pro
  makes 4K images only from the prompt alone; with reference images it
  takes 1K or 2K.

### Image requests

- **Create**: `POST /services/aigc/multimodal-generation/generation` under
  `{endpoint}/api/v1`, once, through `http.create`, which waits up to ten
  minutes for the answer; no `X-DashScope-Async`:

  ```json
  {
  	"model": "qwen-image-3.0-pro",
  	"input": { "messages": [{ "role": "user", "content": [{ "image": "data:image/png;base64,…" }, { "text": "<prompt>" }] }] },
  	"parameters": { "size": "2560*1440", "n": 2, "negative_prompt": "…", "prompt_extend": true, "watermark": false, "seed": 7 }
  }
  ```

  The content holds the references in order, then exactly one text item.
  Wan models send no `negative_prompt` and no `prompt_extend`.
- **Answer**: every `image` of every item of `output.choices[].message.content`,
  in order, is one output (Wan answers several images inside one choice). Each
  is a PNG address on an OSS host, valid for 24 hours, which the window
  downloads without the key. An answer whose choices hold fewer images than
  asked leaves the other cards to fail as fewer images
  ([generation cards](../generation-cards.md#several-images-from-one-generation)):
  the pages document no image refused on its own, and Alibaba charges only
  for the images it made. A 2xx answer without choices that carries a `code`
  is a refusal read as an error; one without either has an unknown outcome.
- No poll and no cancel: the answer is the result.
- **Errors**: as for the video models ([Requests](#requests)). Too many
  requests (`Throttling.*`, 429) names the model's own limit: 5 requests a
  minute for Qwen-Image 3.0 Pro, 20 for Qwen-Image 3.0 and 2.1 Pro, 120 for
  Qwen-Image 2.1 Turbo, and 5 requests a second and 5 at once for each Wan
  2.7 Image model. `IPInfringementSuspect` says that Prompt Rewriting can
  cause it. A model the host does not know adds how to use the workspace's
  host.

### Left out, and why

- **Image sets** of Wan (`enable_sequential`): the model decides how many
  images it makes, up to `n`, while a generation makes its cards before it
  sends ([generation cards](../generation-cards.md#several-images-from-one-generation)).
- **Boxes** (`bbox_list`) and the **colour palette** (`color_palette`) of
  Wan: coordinates of an input and colours with shares are not inputs or
  settings a card has.
- **Thinking** (`enable_thinking` of Qwen, `thinking_mode` of Wan) and
  Qwen's `prompt_extend_mode`: Alibaba's defaults apply (thinking on, direct
  rewriting).
- **The earlier image models** (`qwen-image-2.0*`, `qwen-image-max`,
  `-plus`, `-edit*`, `wan2.6-t2i`, `wan2.6-image`, Wan 2.5, 2.2, and 2.1):
  replaced by the models above.
- **Z-Image**, the **OpenAI-compatible** call, and the Vidu image models
  served through DashScope: the Vidu module has its own.

### Open questions

1. Whether the shared hosts serve Qwen-Image 2.1. Declared in both regions;
   the message of a host that does not know a model says how to use the
   workspace's host.
2. Whether the shared hosts take the asynchronous image create. The
   synchronous call is used.
3. Qwen's prompt and negative prompt limits are not given in characters for
   these models; BaseHalf takes 4,500 and 500.
4. Whether Wan requires a prompt; BaseHalf requires one.
5. Whether one image of several can be refused alone; the pages document no
   such answer.

### Acceptance criteria

1. The catalog lists the six image models with the kind `image`, PNG,
   answered at once, in both regions, with exactly their mode, limits, and
   parameters above, after the video models.
2. Each model's request goes once to the synchronous call with the key and
   without `X-DashScope-Async`, its references as data URLs before the text,
   and the size of the table; Adaptive sends Wan's level and Qwen's size of
   the last reference image.
3. The answer's images are the outputs in order, an address AI Video does not
   take is refused on its own, and an image downloads without the key.
4. A refused key answers `auth`, too many requests `rateLimited` with the
   model's limit, an empty balance `balance`, a refused content `rejected`,
   and an answer that never comes `unknownOutcome`, each after one request.
5. `check` refuses 4K with references on Wan 2.7 Image Pro and too large a
   request, and a request it refuses is not sent.

## Verification

`extensions/basehalf-ai-video/test/alibaba.test.ts` runs the module through
the provider commands against local servers that answer like DashScope and
OSS: the task each mode and set of inputs routes to, as `check` answers it
and as the create sends it; the body and headers of every task; the sizes of
Wan 2.6 text to video; the upload with its form and without the key; Edit
and Extend refused outside China; polls through every state, the download,
cancelling a pending and a running task, refused keys, too many requests, a
create whose connection drops (sent once, unknown outcome), the endpoint with
and without `/api/v1`, and every rule above. For the image models it runs
the catalog, the body of each model with and without references, every size
of the table and of Adaptive, answers with several images and with an
address that is refused, the download, the errors above, and the rules of
`check`.
