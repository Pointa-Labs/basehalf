# MiniMax (Hailuo)

Status: Active (2026-10-19)
Decision: [D59](../../decisions.md#d59--video-providers-are-built-in-integrations-with-each-models-exact-settings-users-bring-their-own-keys-new-2026-10-19)
Related: [Video providers and the model catalog](../video-providers.md),
[Video node](../video-node.md#a-generation)

This specification owns the MiniMax provider of the catalog: its regions,
the models it declares with each one's modes, inputs, limits, and
parameters, how its requests are made and its tasks read, and its estimate.
It is implemented in
`vscode-base/extensions/basehalf-ai-video/src/providers/minimax.ts`; the
contract every provider follows is in
[video providers and the model catalog](../video-providers.md).

## Sources

The facts below follow MiniMax's own documentation, on its international
site (`https://platform.minimax.io/docs/`) and its China site
(`https://platform.minimaxi.com/docs/`, which redirects to
`https://platform.minimax.cn/docs/`), read on 2026-10-18 and 2026-10-19;
every page read on both days was unchanged. None of them carries a date of
its own.

| Topic | Pages (path under `/docs/`) |
| --- | --- |
| H3 API (V2) | `api-reference/video-generation-v2-create`, `-v2-query`, `-v2-delete`, `-v2-list`, `-v2-regeneration`, `-v2-h3-context-ir` |
| Hailuo API (V1) | `api-reference/video-generation-t2v`, `-i2v`, `-fl2v`, `-s2v`, `api-reference/video-generation-query`, `api-reference/video-generation-download` |
| Files | `api-reference/file-management-upload`, `api-reference/file-management-retrieve` |
| Models | `guides/video-generation`, `guides/models-intro`, `faq/models`, `release-notes/models` |
| Keys and hosts | `guides/quickstart-preparation`, `api-reference/api-overview`, `guides/mcp-guide` |
| Limits and errors | `guides/rate-limits`, `api-reference/errorcode` |
| Prices | `pricing/overview`, the Video section |

The README of MiniMax's own MCP server on GitHub (`MiniMax-AI/MiniMax-MCP`)
says that a key must be used with the host of its region, and is the only
official material that names `https://api.minimaxi.com`.

## Regions and credentials

| Region | Label | Base URL | Currency | Console |
| --- | --- | --- | --- | --- |
| `cn` | China | `https://api.minimax.cn` | CNY | `https://platform.minimax.cn/user-center/basic-information/interface-key` |
| `intl` | International | `https://api.minimax.io` | USD | `https://platform.minimax.io/user-center/basic-information/interface-key` |

- One credential, `apiKey` (**API Key**), a pay-as-you-go key, sent as
  `Authorization: Bearer <key>`. No group id. A key works only with the host
  of the region it was made in; MiniMax answers "invalid api key" otherwise.
- The consoles are the API key pages the API reference of each site links
  to. MiniMax H3 and H3 Max need a pay-as-you-go key: MiniMax's video
  packages (prepaid points) cover the Hailuo models only.
- **The China host is `https://api.minimax.cn`.** Every China API reference
  page this provider follows names it as its server, the China quick start
  sets it for the other APIs, and the China MCP guide sets it as
  `MINIMAX_API_HOST`. `https://api.minimaxi.com` belongs to the domain the
  China documentation moved from (`platform.minimaxi.com` redirects to
  `platform.minimax.cn`) and appears only in the older MCP README. A user
  whose network needs it can enter it as the endpoint.

## Models

Each model's id is the same in both regions: every page of both sites
lists the same names, and both price lists price all five.

| Model | Label | Id sent | API | Modes | Resolution (default) | Duration (default) |
| --- | --- | --- | --- | --- | --- | --- |
| `h3` | MiniMax H3 | `MiniMax-H3` | V2 | Frames, References | 768P, 2K (768P) | 4 to 15 s (5) |
| `h3-max` | MiniMax H3 Max | `MiniMax-H3-Max` | V2 | Frames, References | 480P, 768P (768P) | 5 to 15 s (5) |
| `hailuo-2.3` | Hailuo 2.3 | `MiniMax-Hailuo-2.3` | V1 | Frames: start frame optional, no end frame | 768P, 1080P (768P) | 6 or 10 s (6) |
| `hailuo-2.3-fast` | Hailuo 2.3 Fast | `MiniMax-Hailuo-2.3-Fast` | V1 | Frames: start frame required, no end frame | 768P, 1080P (768P) | 6 or 10 s (6) |
| `hailuo-02` | Hailuo 02 | `MiniMax-Hailuo-02` | V1 | Frames: start and end frame optional | 512P, 768P, 1080P (768P) | 6 or 10 s (6) |

- MiniMax H3 Max is MiniMax's faster H3, served by MiniMax's own V2 API
  with the same requests. The API reference and the video guide say it
  takes references (images, videos, and audio), and its price list prices
  input videos; the model list and the models overview name only text and
  frames (the China model list says "only"). The catalog follows the API
  reference.
- The price list groups the Hailuo models under legacy models, and the
  video guide presents H3 and H3 Max as MiniMax's current models. The API
  reference still documents the Hailuo models, the model list lists them as
  available, and the rate limits list the Hailuo series, so they are not
  deprecated in the catalog.
- No Hailuo model takes a ratio: a frame sets the shape of the video.

## Modes and inputs

### MiniMax H3 and H3 Max

- **Frames**: an optional start frame and an optional end frame. Without a
  frame, the prompt alone (text to video); with one or two, image to video.
- **References**: 0 to 9 images, 0 to 3 videos, and 0 to 3 audio clips, at
  least one input and at most 12 together, used in that order. MiniMax never
  mixes frames and references in one request; the two modes keep them apart.
- Images, in both modes: PNG, JPEG, or WebP (MiniMax also takes HEIC and
  HEIF, which a Video node does not take as images), 256 to 5760 px on each
  side, 0.4 to 2.5 in width over height, at most 30 MiB. MiniMax writes MB:
  a file's size is read as MiB, and the whole request's as 64,000,000 bytes
  ([Requests](#requests)).
- Videos: MP4 or MOV, at most 50 MiB, 2 to 15 seconds each and 15 seconds
  together. MiniMax also requires 256 to 5760 px on each side, 0.4 to 2.5 in
  width over height, 23.976 to 60 frames a second, and H.264 or H.265; it
  checks these when the file is uploaded and refuses a file outside them,
  before any task exists.
- Audio: WAV or MP3, at most 15 MiB, 2 to 15 seconds each and 15 seconds
  together.
- The prompt is required in every mode, at most 7,000 characters.

### Hailuo

- **Frames** only. Hailuo 2.3 takes a prompt alone or a start frame; Hailuo
  2.3 Fast takes a start frame only (image to video); Hailuo 02 takes a
  prompt alone, a start frame, or a start and an end frame (the first and
  last frame request).
- Images: PNG, JPEG, or WebP, less than 20 MiB, the shorter side more than
  300 px (so at least 301), 0.4 to 2.5 in width over height.
- The prompt is required when no frame is sent, at most 2,000 characters.

## Parameters

A parameter that every provider shares takes the catalog's shared name and
values ([video providers, Parameters](../video-providers.md#parameters)), so
that choosing another model keeps it; the others are named as MiniMax's
fields. The request maps each to MiniMax's field and value
([Requests](#requests)).

| Parameter | Label | Kind | Values | Default | Models | MiniMax's field |
| --- | --- | --- | --- | --- | --- | --- |
| `resolution` | Resolution | choice | `480p`, `512p`, `768p`, `1080p`, `2k` as each model offers them (the model table), labeled as every provider's are: 480p, 512p, 768p, 1080p, 2K | `768p` | all | `resolution`, as MiniMax writes it (`768P`) |
| `ratio` | Ratio | choice, drawn as ratio shapes | 16:9, 4:3, 1:1, 3:4, 9:16, 21:9, Adaptive (`adaptive`) | 16:9 | H3, H3 Max | `ratio` |
| `duration` | Duration | whole seconds | 4 to 15 (H3), 5 to 15 (H3 Max), step 1; 6 or 10 (Hailuo, step 4) | 5 (H3, H3 Max), 6 (Hailuo) | all | `duration` |
| `prompt_expansion_mode` | Prompt Expansion | choice | Off (`disabled`), Balanced (`balanced`), Quality (`quality`) | Balanced | H3 Max | `extra.prompt_expansion_mode` |
| `prompt_extend` | Prompt Optimizer | boolean | | on | Hailuo | `prompt_optimizer` |
| `fast_pretreatment` | Fast Optimization | boolean, advanced | | off | Hailuo | `fast_pretreatment` |
| `watermark` | Watermark | boolean, advanced | | off | H3, H3 Max | `aigc_watermark`, in China only |

Rules that `check` reports:

- MiniMax H3 and H3 Max in Frames mode without a frame need a ratio: Ratio
  cannot be Adaptive. With a frame, the video keeps the frame's ratio, which
  MiniMax always treats as Adaptive: Ratio must be Adaptive.
- References mode needs at least one image, video, or audio clip, and takes
  at most 12 together.
- The AIGC watermark (`watermark`) is offered in China only: the China
  create page documents `aigc_watermark`, and the international one does not.
- Hailuo makes 1080P videos of 6 seconds only.
- Hailuo 02 makes 512P videos only from a start frame and without an end
  frame (image to video).
- Fast Optimization is not offered with an end frame (the first and last
  frame request does not take it). It shortens the prompt optimizer's work
  and does nothing when the optimizer is off.
- With files: audio that is not WAV or MP3 (M4A) is refused with its name.
  An image that is not PNG, JPEG, or WebP, such as a GIF, is drawn to PNG by
  the window first.

## Requests

### MiniMax H3 and H3 Max (V2)

`POST /v2/video_generation`, JSON:

- `model`, the id sent;
- `content`, in order: the prompt as `{"type": "text", "text"}`; the start
  frame and the end frame as `{"type": "image_url", "image_url": {"url"},
  "role"}` with the roles `first_frame` and `last_frame`; reference images
  with the role `reference_image`; reference videos as `{"type":
  "video_url", "video_url": {"url"}, "role": "reference_video"}`; reference
  audio as `{"type": "audio_url", "audio_url": {"url"}, "role":
  "reference_audio"}`;
- `resolution` as MiniMax writes it (`768P`, `2K`, `480P` for the catalog's
  `768p`, `2k`, `480p`), `duration`, and `ratio` (`adaptive` with a frame);
- for H3 Max, `extra: {"prompt_expansion_mode"}`; H3 is sent no `extra`;
- in China, `aigc_watermark`, the value of `watermark`.

The answer's `task_id` is the task id. Not sent: `callback_url`.

Images travel as data URLs of the format their header shows
(`data:image/png;base64,…`, also `jpeg` and `webp`) while the whole body
stays within 64 MB, counted as 64,000,000 bytes; when it would not, the
largest images are uploaded, one at a time, until it does. Videos and audio
are always uploaded. An uploaded file is sent as `mm_file://{file_id}`.

### Hailuo (V1)

`POST /v1/video_generation`, JSON: `model`; `prompt` when it is not empty;
`first_frame_image` with a start frame and `last_frame_image` with an end
frame, as data URLs; `prompt_optimizer`, the value of `prompt_extend`;
`fast_pretreatment`, except with an end frame; `duration`; and `resolution`
as MiniMax writes it (`512P`, `768P`, `1080P`). The answer carries
`task_id` and `base_resp`. Not sent: `callback_url`. MiniMax documents no
upload for these fields, so frames always travel inline.

### Uploads

`POST /v1/files/upload` as a multipart form: `purpose` set to
`video_generation_input` and `file`, named by its slot and format
(`reference-video-1.mp4`, `start-frame.png`) with its MIME type. The answer's
`file.file_id` is a 64-bit number; it is read from the answer's text, so no
digit is lost. MiniMax keeps the file for 7 days. Uploads are retried as
polls are; a file is uploaded before the task is created, so a refused
upload creates no task.

## Task states

| API | Request | Pending | Running | Succeeded | Failed | Cancelled |
| --- | --- | --- | --- | --- | --- | --- |
| V2 | `GET /v2/query/video_generation/{task_id}` | `queued` | `running` | `succeeded`, with `task.content.url` | `failed`, with `task.error.message` and its code | `cancelled` |
| V1 | `GET /v1/query/video_generation?task_id=` | `Preparing`, `Queueing` | `Processing` | `Success`, with `file_id` | `Fail`, with the status message | — |

- V2 answers tasks of the last 7 days; an older or unknown id answers
  `invalid task_id`, which is `notFound`.
- V1 says why a task failed with a nonzero code of `base_resp`: the codes
  1026 and 1027 (sensitive input or output), and any code with `Fail`, end
  the task as failed with MiniMax's message and code. Any other code is about
  the query itself and is read as [Errors](#errors) says.
- Any other status is an answer AI Video cannot read. Neither API reports
  progress.

## Result

- V2: `task.content.url`, an address that expires; asking again gives a new
  one.
- V1: the task's `file_id`, then `GET /v1/files/retrieve?file_id=`, whose
  `file.download_url` is valid for one hour. The poll answers success without
  an address, and the module asks for the task and its file when the
  download starts.
- MiniMax gives addresses on its file hosts, not on the API's origin, so
  the download carries no credentials; an address on the endpoint's origin,
  as a relay may give, gets them.

## Cancel

- V2: the task is read first. Only a queued task gets `DELETE
  /v2/video_generation/{task_id}`, sent once, which answers `action:
  cancelled`. MiniMax refuses to cancel a running task, and a `DELETE` on a
  task that ended deletes its record, so neither is sent; a refused `DELETE`
  (the task started meanwhile) answers false.
- V1: MiniMax has no cancellation. The answer is false and nothing is sent.

## Errors

V2 answers an error with its real HTTP status and `{"type": "error",
"error": {"type", "message", "http_code"}, "request_id"}`; the message ends
with MiniMax's code in parentheses, such as `(1004)`. V1 and the file
endpoints answer HTTP 200 with `base_resp.status_code`, which is 0 on
success; any other code is an error, read as follows:

| Codes | Meaning | Code of the contract |
| --- | --- | --- |
| 1002, 1039, 1041, 2045, 2056 | rate, token, connection, growth, or usage limit | `rateLimited` |
| 1004, 2049 | not authorized, invalid API key | `auth` |
| 1008 | insufficient balance | `balance` |
| 1000, 1001, 1024, 1033 | unknown, timeout, internal, or system error | `unknownOutcome` for a create, `network` otherwise |
| 1026, 1027 | sensitive input or output | `rejected` for a create; for a query, the task failed |
| 2013 | invalid parameters | `rejected`; for a query, `notFound` (its one parameter is the task id) |
| any other | | `rejected` |

- An HTTP error maps by its status as [Requests](../video-providers.md#requests)
  says; the codes and the V2 error types (`authorized_error`,
  `rate_limit_error`, `insufficient_balance_error`) refine a 4xx answer only,
  never 408 or 5xx, so a create answered by a server error keeps its unknown
  outcome.
- A rate limit names MiniMax's limits: 20 requests a minute for the Hailuo
  series; 300 requests a minute and 30 tasks at a time for H3.

## Estimate

The price list (the Video section of `pricing/overview`) has no date; the
estimate gives 2026-10-18, the day it was read. It is the pay-as-you-go list
price; a video package's points are not counted.

**MiniMax H3 and H3 Max**: the duration times the output price of the model
and resolution, plus each image beyond the free ones times the image price,
plus the seconds of the reference videos times the input video price at the
output resolution. Audio is free. The images are the frames and the
reference images together. MiniMax meters whole seconds of input video
(`usage.input_seconds`): with files, the estimate is a range from the
measured length of the videos rounded down to that length rounded up;
without files, from 2 seconds a video to 15 seconds.

| | H3 768P | H3 2K | H3 Max 480P | H3 Max 768P |
| --- | --- | --- | --- | --- |
| Output a second, USD / CNY | 0.08 / 0.50 | 0.13 / 0.80 | 0.05 / 0.33 | 0.08 / 0.50 |
| Input video a second, USD / CNY | 0.08 / 0.50 | 0.13 / 0.80 | 0.0553 / 0.37 | 0.143 / 0.97 |
| Free images | 5 | 5 | 2 | 2 |
| Each further image, USD / CNY | 0.04 / 0.20 | 0.04 / 0.20 | 0.074 / 0.50 | 0.074 / 0.50 |

**Hailuo**: one price a video, by model, resolution, and duration, in USD /
CNY.

| Model | 512P, 6 s | 512P, 10 s | 768P, 6 s | 768P, 10 s | 1080P, 6 s |
| --- | --- | --- | --- | --- | --- |
| Hailuo 2.3 | — | — | 0.28 / 2.00 | 0.56 / 4.00 | 0.49 / 3.50 |
| Hailuo 2.3 Fast | — | — | 0.19 / 1.35 | 0.32 / 2.25 | 0.33 / 2.31 |
| Hailuo 02 | 0.10 / 0.60 | 0.15 / 1.00 | 0.28 / 2.00 | 0.56 / 4.00 | 0.49 / 3.50 |

The price list gives one price a model, resolution, and length; a Hailuo 02
video with an end frame is estimated at that price.

## Left out

- A seed: MiniMax documents none for these models.
- The AIGC watermark in the international region, which its create page does
  not document.
- An end frame without a start frame, which H3 takes: the window plans an
  end frame only with a start frame.
- Media by public URL: inputs come from the workspace.
- `callback_url`: BaseHalf asks about its tasks.
- The older models (T2V-01-Director, T2V-01, I2V-01-Director, I2V-01-live,
  I2V-01), S2V-01 with its subject reference, and video agent templates.
- H3-Context-IR, which makes a prompt and no video; video regeneration, which
  makes a 2K copy of an earlier 768P output from its task id (on an allow
  list) or its exact inputs; and the V2 task list.
- The frame rate, codec, and size of reference videos, which MiniMax checks
  at upload.

## Verification

`extensions/basehalf-ai-video/test/minimax.test.ts` runs the module through
the provider commands against local servers that answer like MiniMax:

- the catalog entry with its regions, models, modes, limits, and parameters;
- the exact body of a create for each model and mode, uploads with their
  form fields and file ids, and images uploaded when the body would be too
  large;
- polls through every V1 and V2 state, the V1 file lookup, and downloads
  that carry no credentials to the video's address;
- cancellation of a queued and a running H3 task and of a Hailuo task;
- refused keys, too many requests, an empty balance, a nonzero `base_resp`
  in an HTTP 200, an unknown task, and a create whose connection drops,
  which is sent once and has an unknown outcome;
- the rules of `check`, and estimates for at least three combinations in
  each region, checked against the price list.
