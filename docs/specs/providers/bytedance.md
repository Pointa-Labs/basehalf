# ByteDance (Seedance, Seedream)

Status: Active (2026-10-19); image models Draft (2026-10-22)
Decisions: [D59](../../decisions.md#d59--video-providers-are-built-in-integrations-with-each-models-exact-settings-users-bring-their-own-keys-new-2026-10-19),
[D64](../../decisions.md#d64--basehalf-generates-images-with-the-same-cards-panel-and-providers-new-2026-10-22)
Parent: [Providers and the model catalog](../providers.md)

Implemented in `extensions/basehalf-ai-video/src/providers/bytedance.ts`:
the Seedance video models, and the Seedream image models
([Image models](#image-models)).
The video facts below follow these official pages, read on 2026-10-18 and
2026-10-19: on Volcengine Ark, 创建视频生成任务 API, 查询视频生成任务 API,
取消或删除视频生成任务, Base URL 及鉴权, 模型列表 (updated 2026-10-18), and
错误码 (updated 2026-10-17); on BytePlus ModelArk, Create a video generation
task (updated 2026-10-17), Retrieve a video generation task, Cancel or delete
a video generation task, and Model list (updated 2026-10-18).

**Regions and credentials.** One credential, `apiKey` (**API Key**), sent as
`Authorization: Bearer <key>`.

| Region | Label | Base URL | Console |
| --- | --- | --- | --- |
| `cn` | China · Volcengine Ark | `https://ark.cn-beijing.volces.com/api/v3` | `https://ark.volcengine.com/region:cn-beijing/apiKey` |
| `intl` | International · BytePlus ModelArk | `https://ark.ap-southeast.bytepluses.com/api/v3` | `https://ai.byteplus.com/ark/region:ap-southeast-1/apiKey` |

The consoles are the API key pages the create pages link to.

## Video models

**Models.** The id sent in each region, the modes, and the main settings:

| Model | `cn` | `intl` | Modes | Resolution (default) | Duration | Sound |
| --- | --- | --- | --- | --- | --- | --- |
| `seedance-2.5` Seedance 2.5 | `doubao-seedance-2-5-260628` | `dreamina-seedance-2-5-260628` | Frames, References | 480p, 720p, 1080p (720p) | 4–30 s or Auto | yes |
| `seedance-2.0` Seedance 2.0 | `doubao-seedance-2-0-260128` | `dreamina-seedance-2-0-260128` | Frames, References | 480p, 720p, 1080p, 4K (720p) | 4–15 s or Auto | yes |
| `seedance-2.0-fast` Seedance 2.0 Fast | `doubao-seedance-2-0-fast-260128` | `dreamina-seedance-2-0-fast-260128` | Frames, References | 480p, 720p (720p) | 4–15 s or Auto | yes |
| `seedance-2.0-mini` Seedance 2.0 Mini | `doubao-seedance-2-0-mini-260615` | `dreamina-seedance-2-0-mini-260615` | Frames, References | 480p, 720p (720p) | 4–15 s or Auto | yes |
| `seedance-1.5-pro` Seedance 1.5 Pro | — | `seedance-1-5-pro-251215` | Frames | 480p, 720p, 1080p (720p) | 4–12 s or Auto | yes |
| `seedance-1.0-pro` Seedance 1.0 Pro | `doubao-seedance-1-0-pro-250528` | `seedance-1-0-pro-250528` | Frames | 480p, 720p, 1080p (1080p) | 2–12 s | no |
| `seedance-1.0-pro-fast` Seedance 1.0 Pro Fast | `doubao-seedance-1-0-pro-fast-251015` | `seedance-1-0-pro-fast-251015` | Frames, start frame only | 480p, 720p, 1080p (1080p) | 2–12 s | no |

- Every model's duration defaults to 5 seconds; Auto (`-1`) lets the model
  choose.
- BytePlus marks Seedance 1.5 Pro as retiring, with Seedance 2.0 Mini as its
  replacement, so it is `deprecated`. Volcengine Ark marks 1.0 Pro and 1.0 Pro
  Fast as retiring and BytePlus does not, so both stay listed.
- Draft mode (a 480p draft, then the final video made from the draft's task
  id) is not offered yet.

**Modes and inputs.**

- **Frames**: an optional start frame and an optional end frame (no end frame
  for 1.0 Pro Fast); without a frame, the prompt alone (text to video). The
  prompt is required when no frame is sent.
- **References** (2.5 and the 2.0 series): for 2.5, 0 to 30 images and 0 to 10
  audio clips, at least one of either; for the 2.0 series, 1 to 9 images and
  0 to 3 audio clips (the API takes no audio without an image or a video).
  The prompt is required when no image is sent. Reference videos are not
  offered: the API takes them only as a public URL or an asset id, which
  needs other credentials.
- Limits in every mode: an image is 300 to 6000 px on each side, 0.4 to 2.5 in
  width over height, and at most 30 MiB; an audio clip is WAV or MP3, at most
  15 MiB, 2 to 30 seconds and 30 seconds together for 2.5, 2 to 15 seconds and
  15 seconds together for the 2.0 series; the whole request, inputs
  included, at most 64 MB.
- Images are sent as data URLs of the format their header shows
  (`data:image/png;base64,…`, also `jpeg`, `webp`, `gif`), audio as
  `data:audio/wav` or `data:audio/mp3`.

**Parameters.** Each is named as the API field it sets, except Sound, whose
shared name is `sound` and whose field is `generate_audio`.

| Parameter | Label | Kind | Values | Default | Models |
| --- | --- | --- | --- | --- | --- |
| `resolution` | Resolution | choice | as in the model table | as in the model table | all |
| `ratio` | Ratio | choice, drawn as ratio shapes; on Seedance 2.5 set by the start frame (`setByStartFrame`), which keeps the frame's shape, and `adaptive` is sent then | 16:9, 4:3, 1:1, 3:4, 9:16, 21:9, Adaptive (`adaptive`) | Adaptive; 16:9 for 1.0 Pro and 1.0 Pro Fast | all |
| `duration` | Duration | whole seconds, step 1 | as in the model table; Auto is `-1` | 5 | all |
| `sound` | Sound, sent as `generate_audio` | boolean | | on | 2.5, the 2.0 series, 1.5 Pro |
| `seed` | Seed | whole number 0 to 2147483647, optional, advanced | | unset: a new seed each time | 1.5 Pro, 1.0 Pro, 1.0 Pro Fast |
| `camera_fixed` | Fixed Camera | boolean, advanced | | off | 1.5 Pro, 1.0 Pro, 1.0 Pro Fast |
| `watermark` | Watermark | boolean, advanced | | off | all |

Rules that `check` reports:

- Seedance 1.0 Pro and 1.0 Pro Fast choose a ratio only from a start frame:
  without one, Ratio cannot be Adaptive.
- References on Seedance 2.5 needs at least one image or audio clip.
- The prompt may not carry the API's text settings (`--rs`, `--rt`, `--dur`,
  `--fps`, `--frames`, `--seed`, `--cf`, `--wm`, and their long names): the
  settings set them, so that what the panel shows is what is sent.
- An audio clip in another format than WAV or MP3 is refused with its name.
- A request whose inputs as data URLs would exceed 64 MB is refused.

**Request.** `POST /contents/generations/tasks` with `model` (the region's
id), `content`, and the parameters above that apply, with their values or
defaults (an unset seed is not sent). `content` holds, in order: the prompt as
`{"type": "text", "text"}` when it is not empty; the start frame and the end
frame as `{"type": "image_url", "image_url": {"url"}, "role"}` with the roles
`first_frame` and `last_frame`; reference images with the role
`reference_image`; reference audio as `{"type": "audio_url", "audio_url":
{"url"}, "role": "reference_audio"}`. The answer's `id` is the task id. Not
sent: `draft`, `return_last_frame`, `service_tier`, `callback_url`,
`execution_expires_after`, `priority`, `safety_identifier`, `tools`,
`output_format` (MP4, the default, is the format kept), `frames`, and
`omni_reference_task_type` (without a reference video, a References task is
always a reference task).

**Task states.** `GET /contents/generations/tasks/{id}`: `queued` is pending,
`running` running, `succeeded` succeeded with `content.video_url`, `failed`
failed with `error.message`, `expired` failed with "The task expired before it
finished.", and `cancelled` cancelled. Any other status is an answer AI Video
cannot read. The video address is valid for 24 hours (Seedance 2.5: at most
100 downloads); BaseHalf downloads it once.

**Cancel.** The task is read first. Only a queued task is cancelled, with
`DELETE /contents/generations/tasks/{id}` sent once: a `DELETE` on a task that
ended deletes its record. A running task cannot be cancelled, and a refused
`DELETE` (the task started meanwhile) answers false.

**Errors.** The statuses map as in [Requests](../providers.md#requests). The provider's codes
`AccountOverdueError` and `OperationDenied.ServiceOverdue` are `balance`;
`OperationDenied.ServiceNotOpen`, `ModelNotOpen`, and
`InvalidEndpointOrModel.*` are `rejected`, with the provider's message saying
that the model is not activated for the account.

The prompt has no documented length limit; the pages advise at most 500
Chinese characters or 1,000 English words. The catalog bounds it at 20,000
characters, text inputs included.

## Image models

The Seedream models run on the same regions, keys, and base URLs as Seedance
(D64). Their API answers the request with the images: there is no task to
poll or cancel.

**Sources.** Read on 2026-10-22 from each site's own page data, since the
pages are drawn by script: on Volcengine Ark, 图片生成 API (updated
2026-10-14), 模型列表 (2026-10-21), Seedream 4.0-5.0 教程 (2026-10-13), 模型下线公告
(2026-10-14), and 错误码 (2026-10-17); on BytePlus ModelArk, Image
generation API (updated 2026-10-17), Model list (2026-10-19), the Seedream
4.0-5.0 tutorial (2026-10-13), Model deprecation (2026-09-28), and Error codes
(2026-10-17). Both sites document the same fields, values, and size tables;
where they differ, the difference is named below.

**Models.** Every Seedream model is of kind `image`, answers at once
(`answersAtOnce`), and offers the one mode References (`reference`):

| Model | Label | `cn` | `intl` | Makes | References | Resolution | Format |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `seedream-5.0-pro` | Seedream 5.0 Pro | `doubao-seedream-5-0-pro-260628` | `dola-seedream-5-0-pro-260628` | one image | 0 to 10 | 1K, 1.5K, 2K | PNG |
| `seedream-5.0-flash` | Seedream 5.0 Flash | `doubao-seedream-5-0-flash-260915` | `dola-seedream-5-0-flash-260915` | one image, faster | 0 to 10 | 1K, 1.5K, 2K | PNG |
| `seedream-5.0-lite` | Seedream 5.0 Lite | `doubao-seedream-5-0-260128` | `seedream-5-0-260128` | one image, or a set | 0 to 14 | 2K, 3K, 4K | PNG |
| `seedream-4.5` | Seedream 4.5 | `doubao-seedream-4-5-251128` | `seedream-4-5-251128` | one image, or a set | 0 to 14 | 2K, 4K | JPEG |
| `seedream-4.0` | Seedream 4.0 | `doubao-seedream-4-0-250828` | `seedream-4-0-250828` | one image, or a set | 0 to 14 | 1K, 2K, 4K | JPEG |

- The format is the model's `outputFormat`: 5.0 Pro, Flash, and Lite are asked
  for PNG; 4.5 and 4.0 make JPEG only and take no format.
- Volcengine Ark retires 5.0 Lite, 4.5, and 4.0 in its tenth batch: no new
  endpoints since 2026-09-24, and the service ends on 2026-11-24 at 14:00
  (UTC+8). 5.0 Lite and 4.5 are then shut down; 4.0 is replaced by
  `doubao-seedream-4-0-20260415`, which no model list shows. Image models are
  not moved to a new model by themselves. The three are deprecated in China
  only (`deprecatedIn: ["cn"]`); BytePlus retires none of them.
- **Open: the BytePlus id of 5.0 Lite.** BytePlus's model list gives
  `seedream-5-0-260128` (and says it also takes `seedream-5-0-lite-260128`),
  while its deprecation page names `dola-seedream-5-0-lite-260128` as the
  model that replaces Seedream 3.0. The catalog sends the model list's id; a
  call with a real key has to show which ids BytePlus accepts.
- BytePlus's `eu-west-1` region stopped 5.0 Lite on 2026-09-10; the `intl`
  base URL is `ap-southeast-1`.
- Each model must be activated in the provider's console. A model that is not
  is refused with the provider's message, as for Seedance.

**References.** The images connected to the card, in order; the prompt names
them Image 1, Image 2 ([generation cards, Inputs](../generation-cards.md#inputs)),
as Seedream expects. 5.0 Pro and Flash take up to 10, the others up to 14.
Each is a PNG, JPEG, or WebP (Seedream also takes BMP, TIFF, GIF, HEIC, and
HEIF, which the window draws to PNG), more than 14 px on each side, 1/16 to 16
in width over height, at most 36,000,000 pixels, and at most 30 MiB. Images
travel as data URLs of the format their header shows: `image` is a string for
one reference and a list for several.

**Parameters.** Shared names take the catalog's values
([providers, Parameters](../providers.md#parameters)); a parameter only
Seedream has is named as its field.

| Parameter | Label | Kind | Values | Default | Models | Sent as |
| --- | --- | --- | --- | --- | --- | --- |
| `ratio` | Ratio | choice, drawn as ratio shapes | 16:9, 4:3, 3:2, 1:1, 2:3, 3:4, 9:16, 21:9, Adaptive (`adaptive`) | Adaptive | all | `size`, below |
| `resolution` | Resolution | choice | `1k`, `1.5k`, `2k`, `3k`, `4k` as the model table offers them, labeled 1K, 1.5K, 2K, 3K, 4K | `2k` | all | `size`, below |
| `count` | Images | whole number, 1 to 15 | | 1 | 5.0 Lite, 4.5, 4.0 | `sequential_image_generation`, below |
| `background` | Background | choice | Opaque (`opaque`), Transparent (`transparent`) | Opaque | 5.0 Pro, Flash | `background` |
| `optimize_prompt_options.mode` | Prompt Optimization | choice, advanced | Standard (`standard`), Fast (`fast`) | Standard | 5.0 Pro, 4.0 | `optimize_prompt_options: {"mode"}` |
| `watermark` | Watermark | boolean, advanced | | off | all | `watermark`, always sent: Seedream's default is on |

- **Size.** Adaptive sends the level alone (`1K`, `1.5K`, `2K`, `3K`, `4K`),
  and the model takes the shape from the prompt and the references. Any other
  ratio sends the width and height of the provider's own table for that
  level, which is the size the model makes for the ratio at the level:

  | Level | 1:1 | 4:3 | 3:4 | 16:9 | 9:16 | 3:2 | 2:3 | 21:9 |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | 1K (5.0 Pro, Flash) | 1024x1024 | 1152x864 | 864x1152 | 1424x800 | 800x1424 | 1248x832 | 832x1248 | 1568x672 |
  | 1.5K (5.0 Pro, Flash) | 1536x1536 | 1792x1344 | 1344x1792 | 2048x1152 | 1152x2048 | 1872x1248 | 1248x1872 | 2352x1008 |
  | 2K (5.0 Pro, Flash) | 2048x2048 | 2368x1776 | 1776x2368 | 2816x1584 | 1584x2816 | 2496x1664 | 1664x2496 | 3136x1344 |
  | 1K (4.0) | 1024x1024 | 1152x864 | 864x1152 | 1280x720 | 720x1280 | 1248x832 | 832x1248 | 1512x648 |
  | 2K (5.0 Lite, 4.5, 4.0) | 2048x2048 | 2304x1728 | 1728x2304 | 2848x1600 | 1600x2848 | 2496x1664 | 1664x2496 | 3136x1344 |
  | 3K (5.0 Lite) | 3072x3072 | 3456x2592 | 2592x3456 | 4096x2304 | 2304x4096 | 3744x2496 | 2496x3744 | 4704x2016 |
  | 4K (5.0 Lite, 4.5, 4.0) | 4096x4096 | 4704x3520 | 3520x4704 | 5504x3040 | 3040x5504 | 4992x3328 | 3328x4992 | 6240x2656 |

  Every size lies within the model's own range for a width and height
  (921,600 to 4,624,220 pixels for 5.0 Pro and Flash, 3,686,400 to 16,777,216
  for 5.0 Lite and 4.5, 921,600 to 16,777,216 for 4.0, each 1/16 to 16 in
  shape). Custom sizes are not offered.
- **Images.** 5.0 Pro and Flash make one image per request and take no
  `sequential_image_generation`. 5.0 Lite, 4.5, and 4.0 send `disabled` for
  one image, and for several `auto` with
  `sequential_image_generation_options.max_images` set to `count`. Then the
  model makes a set of related images as the prompt describes, at most that
  many and possibly fewer, so each of these models' descriptions says so; the
  cards left over fail as fewer images than asked
  ([generation cards](../generation-cards.md#several-images-from-one-generation)).
- **Background.** Transparent keeps the transparency of the one reference
  image that has it and makes a PNG with a transparent background; Opaque is
  sent otherwise.
- **Prompt Optimization.** Seedream always optimizes the prompt; 5.0 Pro and
  4.0 also offer Fast, which answers sooner. The others take only Standard,
  their default, and are sent nothing for it.
- No Seedream model takes a seed, a negative prompt, a guidance scale, or `n`.

Rules that `check` reports:

- 5.0 Lite, 4.5, and 4.0 make at most 15 images and references together: with
  references, Images is at most 15 less their number.
- Transparent needs exactly one reference image, a PNG or a WebP, the formats
  that carry transparency; whether the image has transparency, ByteDance
  checks.
- A reference image of more than 36,000,000 pixels is refused with its name.
- A request whose inputs as data URLs would exceed 64 MB is refused. The image
  page documents no limit for the whole request; the catalog keeps the 64 MB
  of the provider's video API (open question).

**Request.** `POST /images/generations`, JSON: `model` (the region's id),
`prompt`, `image` with references, `size`, the fields of the table above that
apply, `output_format: "png"` for 5.0 Pro, Flash, and Lite, and
`response_format: "url"`. Not sent: `stream`, `layer_decomposition`, and
`tools`. The prompt is required, with no documented limit (the pages advise at
most 300 Chinese characters or 600 English words); the catalog bounds it at
20,000 characters, text inputs included, as for Seedance.

**Answer.** `data[]`, one entry per image, in the provider's order:

- `url`: an address valid for 24 hours, on the provider's file host, which the
  window downloads without the key. Addresses are asked for rather than
  `b64_json`, because a set of 15 PNGs at 4K as base64 could exceed the
  256 MiB AI Video reads of an answer.
- `b64_json`: the image itself, as a relay may answer; it is written to the
  image's target.
- `error` (`code`, `message`): that image was refused on its own, such as by
  the content check of one image of a set, while the others continue. Its card
  fails with the provider's message.
- An entry with none of these is refused with "ByteDance answered an image AI
  Video cannot read."

An answer of HTTP 200 without `data` but with `error` made no image and is
refused with the provider's message; any other answer that cannot be read
leaves the outcome unknown. A Seedream model has no task: `poll` refuses it,
and `cancel` answers false and sends nothing.

**Errors.** As for Seedance; besides, HTTP 400 with
`InputTextSensitiveContentDetected`, `InputImageSensitiveContentDetected`
(`.PolicyViolation`, or `.PrivacyInformation` for a real person), or
`OutputImageSensitiveContentDetected` (`.DeepFake`, `.PolicyViolation`) is
`rejected` with the provider's message, and HTTP 429 with
`ModelAccountIpmRateLimitExceeded` (500 images a minute per model) is
`rateLimited`. A server error or a connection that drops after the request was
sent leaves the outcome unknown; the request is never sent again.

**Left out.** Seedream 3.0 and SeedEdit 3.0, retired in both regions; layer
decomposition (5.0 Pro, Flash), which makes layers instead of an image; web
search (5.0 Lite, China only); streaming; custom sizes; and the editing marks
`<point>` and `<bbox>` in the prompt as a setting (a prompt may still carry
them).

**Acceptance criteria.**

1. The five Seedream models are listed under Images in both regions with the
   ids above; 5.0 Lite, 4.5, and 4.0 are deprecated in China only.
2. Each ratio at each level sends the size of the table above, and Adaptive
   sends the level alone.
3. Images above 1 sends `auto` with `max_images` on 5.0 Lite, 4.5, and 4.0;
   every image the provider answers lands on its own target, an image it
   refused is reported alone, and fewer images than asked are fewer outputs.
4. Watermark off is sent as `false`; `output_format` is sent only where the
   model takes it.
5. A refused key, too many requests, an overdue account, a content refusal,
   a server error, and a dropped connection map as described, and the request
   is sent once.

**Verification.** `extensions/basehalf-ai-video/test/bytedance.test.ts`
generates through the local test provider
(`scripts/basehalf-video-mock-provider.mts`), which answers
`POST /api/v3/images/generations` like Ark with small PNGs, as addresses it
serves itself or as base64, and records each request as it records a video's.
Its tests cover the catalog entries, the body of each model with and without
references, every size of the table, sets, outputs answered as addresses, as
base64, refused alone, and fewer than asked, the errors above, and the rules
of `check`.
