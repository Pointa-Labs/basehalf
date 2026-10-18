# Alibaba (Wan)

Status: Active (2026-10-19)
Decision: [D59](../../decisions.md#d59--video-providers-are-built-in-integrations-with-each-models-exact-settings-users-bring-their-own-keys-new-2026-10-19)
Related: [video providers and the model catalog](../video-providers.md),
[Video node](../video-node.md)

This specification owns the provider module `alibaba` of the AI Video
extension (`extensions/basehalf-ai-video/src/providers/alibaba.ts`): the Wan
and HappyHorse video models of Alibaba Cloud Model Studio (DashScope), their
declarations in the catalog, the requests that run them, and their estimates.
Everything the six provider commands do for every provider is owned by
[video providers and the model catalog](../video-providers.md).

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
| `model-pricing` (international updated 2026-10-15; China updated 2026-10-18) | prices per output second |
| `rate-limit` (updated 2026-10-16), `error-code` | limits and error codes |
| `video-to-video-guide`, `wan-video-editing-guide`, `wan-image-to-video-guide` | what input video is billed |
| OSS `postobject` (`https://www.alibabacloud.com/help/en/oss/developer-reference/`) | the upload form and its answers |

## Regions, hosts, and credentials

| Region | Label | Base URL | Currency | Console |
| --- | --- | --- | --- | --- |
| `cn` | China (Beijing) | `https://dashscope.aliyuncs.com` | CNY | `https://bailian.console.aliyun.com/cn-beijing/model/settings/api-key` |
| `intl` | International (Singapore) | `https://dashscope-intl.aliyuncs.com` | USD | `https://modelstudio.console.alibabacloud.com/ap-southeast-1/model/settings/api-key` |

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
  models, and their prices are not those of the two regions above.

## Catalog models

Every model is one provider model id, the same in both regions. The models
are listed in this order.

| Catalog id | Label | Regions | Modes | Prompt required, longest |
| --- | --- | --- | --- | --- |
| `wan3.0-video` | Wan 3.0 | cn, intl | Frames, References, Edit, Extend | without media, 20,000 |
| `wan3.0-video-prime` | Wan 3.0 Prime | cn, intl | Frames, References, Edit, Extend | without media, 20,000 |
| `happyhorse-1.1-t2v` | HappyHorse 1.1 Text to Video | cn, intl | Text | always, 5,000 |
| `happyhorse-1.1-i2v` | HappyHorse 1.1 Image to Video | cn, intl | Frames | without media, 5,000 |
| `happyhorse-1.1-r2v` | HappyHorse 1.1 Reference to Video | cn, intl | References | always, 5,000 |
| `wan2.7-t2v` | Wan 2.7 Text to Video | cn, intl | Text | always, 5,000 |
| `wan2.7-i2v` | Wan 2.7 Image to Video | cn, intl | Frames, Extend | without media, 5,000 |
| `wan2.7-r2v` | Wan 2.7 Reference to Video | cn, intl | References | always, 5,000 |
| `wan2.7-videoedit` | Wan 2.7 Video Edit | cn | Edit | without media, 5,000 |
| `wan2.6-t2v` | Wan 2.6 Text to Video | cn, intl | Text | always, 1,500 |
| `wan2.6-i2v` | Wan 2.6 Image to Video | cn, intl | Frames | without media, 1,500 |
| `wan2.6-i2v-flash` | Wan 2.6 Image to Video Flash | cn, intl | Frames | without media, 1,500 |
| `happyhorse-1.0-t2v` | HappyHorse 1.0 Text to Video | cn, intl | Text | always, 5,000 |
| `happyhorse-1.0-i2v` | HappyHorse 1.0 Image to Video | cn, intl | Frames | without media, 5,000 |
| `happyhorse-1.0-r2v` | HappyHorse 1.0 Reference to Video | cn, intl | References | always, 5,000 |

- `providerModels` maps each listed region to the catalog id. Alibaba offers
  `wan2.7-videoedit` in both regions, but its one mode sends a video, and
  outside China BaseHalf has no way to send one
  ([Inputs](#inputs-and-the-temporary-upload)), so the catalog offers it in
  China only.
- Prompt lengths are the providers' limits in characters; longer prompts
  would be cut by the provider, so `check` refuses them. HappyHorse takes
  5,000 characters or 2,500 Chinese characters: `check` counts a Chinese
  character (CJK ideographs) as two and refuses more than 5,000.
- Every model has `estimate: true`.

## Parameters

Names are the provider's field names. Each value is sent under its own name
in `parameters`, except `negative_prompt`, which goes in `input`; an optional
parameter that is not set, or an empty negative prompt, sends nothing.

| Name | Label | Kind | Models and values (the default in bold) |
| --- | --- | --- | --- |
| `resolution` | Resolution | choice | Wan 3.0, HappyHorse 1.1: 480P, 720P, **1080P**. Wan 2.7, Wan 2.6 image to video, HappyHorse 1.0: 720P, **1080P** |
| `ratio` | Ratio | choice, ratio | Wan 3.0 (Frames, References): **adaptive**, 21:9, 16:9, 4:3, 1:1, 3:4, 9:16. Wan 2.7 text and reference to video: **16:9**, 9:16, 1:1, 4:3, 3:4. Wan 2.7 Video Edit: the same, optional; unset keeps the ratio of the video. HappyHorse text and reference to video: **16:9**, 9:16, 1:1, 4:3, 3:4, 4:5, 5:4, 9:21, 21:9 |
| `size` | Size | choice | Wan 2.6 Text to Video: 1280×720, 720×1280, 960×960, 1088×832, 832×1088, **1920×1080**, 1080×1920, 1440×1440, 1632×1248, 1248×1632, sent as `1920*1080` |
| `duration` | Duration | integer, seconds | Wan 3.0 (Frames, References): 2–30, **5**, or Auto (`-1`). Wan 2.7 and 2.6 except Video Edit: 2–15, **5**. Wan 2.7 Video Edit: 2–10, or **Whole Video** (`0`, not sent). HappyHorse: 3–15, **5** |
| `audio` | Sound | boolean | Wan 3.0, Wan 2.6 Image to Video Flash: **on** |
| `audio_setting` | Sound | choice | Wan 2.7 Video Edit: **auto**, origin (Keep Original) |
| `shot_type` | Shots | choice | Wan 2.6: **single**, multi |
| `negative_prompt` | Negative Prompt | text, 500, optional, More | Wan 2.7, Wan 2.6 |
| `prompt_extend` | Prompt Rewriting | boolean, More | Wan 3.0, 2.7, 2.6: **on** |
| `watermark` | Watermark | boolean, More | Wan: **off**. HappyHorse: **on** (the provider's default) |
| `seed` | Seed | integer 0–2147483647, optional, More | every model |

Rules between parameters and inputs, reported by `check`:

- Wan 3.0 Edit and Extend send `ratio: "adaptive"` and `duration: -1`, as the
  guide recommends; they declare neither parameter.
- Wan 3.0: with videos, the videos' length plus the duration must be at most
  30 seconds (checked when the files are measured and the duration is not
  Auto).
- Wan 2.7 Reference to Video: at least one reference image or video, at most
  five together, and with a reference video at most 10 seconds.
- Wan 2.6: Multiple shots need Prompt Rewriting (`shot_type` takes effect only
  with `prompt_extend: true`).
- Outside China, a video or audio input is refused
  ([Inputs](#inputs-and-the-temporary-upload)).

## Modes and limits

| Model | Mode | Slots | Limits |
| --- | --- | --- | --- |
| Wan 3.0, Prime | Frames | start and end frame optional; none is text to video | images 240–8,000 px, aspect 1:8–8:1, 20 MiB |
| | References | images 0–10, videos 0–5, audio 0–5 | images as above; videos 1–15 s each, 15 s together, 100 MiB; audio 1–15 s each, 15 s together, 15 MiB |
| | Edit | the video to change, images 0–10 | as References |
| | Extend | the video to continue | as References |
| Wan 2.7 Text, Wan 2.6 Text, HappyHorse Text | Text | none | |
| Wan 2.7 Image to Video | Frames | start frame required, end frame optional | images 240–8,000 px, aspect 1:8–8:1, 20 MiB |
| | Extend | the clip to continue (`first_clip`) | video 2–10 s, 100 MiB |
| Wan 2.7 Reference to Video | References | images 0–5, videos 0–5 | images as Frames; videos 1–30 s, 100 MiB |
| Wan 2.7 Video Edit | Edit | the video, images 0–4 | video 2–10 s, 100 MiB; images as Frames |
| Wan 2.6 Image to Video, Flash | Frames | start frame required | images 240–8,000 px, 20 MiB |
| HappyHorse Image to Video | Frames | start frame required | both sides at least 300 px, aspect 1:2.5–2.5:1, 20 MiB |
| HappyHorse Reference to Video | References | images 1–9 | shorter side at least 400 px, 20 MiB |

- Images go as PNG, JPEG, or WebP (BMP is also accepted by the provider but
  never sent); the window draws an image of another format, such as a GIF,
  to PNG first. Videos are MP4 or MOV; audio is WAV or MP3,
  and an M4A clip is refused.
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
  1. `GET {endpoint}/api/v1/uploads?action=getPolicy&model=<provider model>`
     with the key answers `data` with `policy`, `signature`, `upload_dir`,
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
  URLs. So outside China, a video or audio input is refused by `check`:
  Wan 3.0 References takes images only there, Wan 3.0 Edit and Extend and
  Wan 2.7 Image to Video Extend do not run there, and Wan 2.7 Video Edit is
  not offered there.
- Uploads are retried as every upload is; a failed upload creates no task.

## Requests

Every path is under `{endpoint}/api/v1`.

- **Create**: `POST /services/aigc/video-generation/video-synthesis` with
  `{model, input, parameters}`, through `http.create`, once:

  | Models | `input` |
  | --- | --- |
  | Wan 3.0 | `prompt` (when written), `media` (none for text to video): Frames `first_frame`, `last_frame`; References `reference_image`, `reference_video`, `reference_audio` in that order; Edit the video as `reference_video`, then `reference_image`; Extend the video as `reference_video` |
  | Wan 2.7 Text to Video | `prompt`, `negative_prompt` |
  | Wan 2.7 Image to Video | `prompt`, `negative_prompt`, `media`: Frames `first_frame`, `last_frame`; Extend `first_clip` |
  | Wan 2.7 Reference to Video | `prompt`, `negative_prompt`, `media`: `reference_image`, then `reference_video` |
  | Wan 2.7 Video Edit | `prompt`, `negative_prompt`, `media`: `video`, then `reference_image` |
  | Wan 2.6 Text to Video | `prompt`, `negative_prompt` |
  | Wan 2.6 Image to Video, Flash | `prompt`, `negative_prompt`, `img_url` (the start frame) |
  | HappyHorse Text to Video | `prompt` |
  | HappyHorse Image to Video | `prompt`, `media`: `first_frame` |
  | HappyHorse Reference to Video | `prompt`, `media`: `reference_image` |

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
  (sent with 429) is `rejected`; other statuses follow the contract
  (`InvalidApiKey` 401 is `auth`, `Throttling.*` 429 is `rateLimited`).
- **Limits**: 5 requests a second and 5 running tasks per account and model,
  for every model here; over either, HTTP 429 `Throttling.*`. A
  rate-limited message says so. The task query takes 20 requests a second.

## Estimates

The price is per second of video in the region's currency, from the price
list of 2026-10-18 for China (CNY) and of 2026-10-15 for International (USD).
Failed tasks cost nothing.

| Models | China (CNY per second) | International (USD per second) |
| --- | --- | --- |
| Wan 3.0 (list price; a limited-time 30% discount applies now) | 480P 0.3, 720P 0.6, 1080P 1.2 | 480P 0.05, 720P 0.10, 1080P 0.20 |
| Wan 3.0 Prime | 480P 0.45, 720P 0.9, 1080P 1.8 | 480P 0.068, 720P 0.14, 1080P 0.28 |
| Wan 2.7 (all four), Wan 2.6 Text and Image to Video | 720P 0.6, 1080P 1 | 720P 0.10, 1080P 0.15 |
| Wan 2.6 Image to Video Flash with sound | 720P 0.3, 1080P 0.5 | 720P 0.05, 1080P 0.075 |
| Wan 2.6 Image to Video Flash without sound | 720P 0.15, 1080P 0.25 | 720P 0.025, 1080P 0.0375 |
| HappyHorse 1.1 | 480P 0.45, 720P 0.9, 1080P 1.2 | 480P 0.07, 720P 0.14, 1080P 0.18 |
| HappyHorse 1.0 | 720P 0.9, 1080P 1.6 | 720P 0.14, 1080P 0.24 |

Seconds billed:

- Wan 2.7 Text and Image to Video, Wan 2.6, HappyHorse: the duration. In
  Wan 2.7 Extend the duration is the length of the whole result, the clip
  included, and all of it is billed. Wan 2.6 Text to Video is priced by the
  tier of its size.
- Wan 3.0: the input videos plus the output. With a duration, the input
  videos plus the duration, at most 30. With Auto, and always in Edit and
  Extend, a range from the input videos plus 2 seconds to 30 seconds.
- Wan 2.7 Reference to Video: the output plus each reference video up to
  5 seconds divided among the videos (5, 2.5, 1.65, 1.25, or 1 second each
  for one to five videos).
- Wan 2.7 Video Edit: the input video plus the output, which is the input,
  or the chosen duration when that is shorter. When a duration shortens the
  video, the pages do not say whether the whole input or the kept part is
  billed, so the answer is the range of the two.
- An input video whose length is not measured, as in a check without files,
  counts from its mode's shortest to its longest allowed length.

## What is left out, and why

- Wan 2.6 Reference to Video and its Flash version: their prompts name
  references `character1`, `character2` across images and videos together,
  which the node's names (Image 1, Video 1) cannot say.
- HappyHorse 1.0 Video Edit: its video is a public URL only, in both regions;
  no page offers the temporary upload for it.
- Wan 2.5, 2.2, and 2.1 models, and the dated snapshots of Wan 2.7: earlier
  generations and frozen copies of models listed here; Wan 2.2 and 2.1 differ
  in resolutions between the regions, which a catalog model cannot show.
- Driving audio of Wan 2.7 and 2.6 text and image to video (`audio_url`,
  `driving_audio`), the first frame and the voices (`reference_voice`) of
  Wan 2.7 Reference to Video, and the end frame of Wan 2.7 Extend
  (`first_clip` with `last_frame`): the node's Frames mode takes images only,
  its References mode no frame, and its Extend mode the clip alone
  ([Video node, Inputs](../video-node.md#inputs)), and a voice belongs to one
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

## Verification

`extensions/basehalf-ai-video/test/alibaba.test.ts` runs the module through
the provider commands against local servers that answer like DashScope and
OSS: the create body and headers of each family and mode, the upload with
its form and without the key, polls through every state, the download,
cancelling a pending and a running task, refused keys, too many requests, a
create whose connection drops (sent once, unknown outcome), the endpoint with
and without `/api/v1`, every rule above, and three estimates per region.
