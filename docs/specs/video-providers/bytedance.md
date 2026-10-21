# ByteDance (Seedance)

Status: Active (2026-10-19)
Decision: [D59](../../decisions.md#d59--video-providers-are-built-in-integrations-with-each-models-exact-settings-users-bring-their-own-keys-new-2026-10-19)
Parent: [Video providers and the model catalog](../video-providers.md)

Implemented in `extensions/basehalf-ai-video/src/providers/bytedance.ts`.
The facts below follow these official pages, read on 2026-10-18 and
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

**Errors.** The statuses map as in [Requests](../video-providers.md#requests). The provider's codes
`AccountOverdueError` and `OperationDenied.ServiceOverdue` are `balance`;
`OperationDenied.ServiceNotOpen`, `ModelNotOpen`, and
`InvalidEndpointOrModel.*` are `rejected`, with the provider's message saying
that the model is not activated for the account.

The prompt has no documented length limit; the pages advise at most 500
Chinese characters or 1,000 English words. The catalog bounds it at 20,000
characters, text inputs included.
