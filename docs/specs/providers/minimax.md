# MiniMax (Hailuo)

Status: Active (2026-10-19); image models Draft (2026-10-22); names in the prompt (2026-10-24); speech models Draft (2026-10-25)
Decisions: [D59](../../decisions.md#d59--video-providers-are-built-in-integrations-with-each-models-exact-settings-users-bring-their-own-keys-new-2026-10-19),
[D64](../../decisions.md#d64--basehalf-generates-images-with-the-same-cards-panel-and-providers-new-2026-10-22),
[D74](../../decisions.md#d74--a-prompt-mentions-its-inputs-files-and-each-provider-module-names-them-as-its-model-reads-them-new-2026-10-24),
[D78](../../decisions.md#d78--basehalf-makes-speech-music-and-sound-effects-with-the-same-cards-panel-and-providers-new-2026-10-25)
Related: [Providers and the model catalog](../providers.md),
[generation cards](../generation-cards.md#a-generation)

This specification owns the MiniMax provider of the catalog: its regions,
the models it declares with each one's modes, inputs, limits, and
parameters, and how its requests are made and its tasks read.
It is implemented in
`vscode-base/src/vs/platform/basehalfProviders/node/minimax.ts`; the
contract every provider follows is in
[providers and the model catalog](../providers.md).

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

The README of MiniMax's own MCP server on GitHub (`MiniMax-AI/MiniMax-MCP`)
says that a key must be used with the host of its region, and is the only
official material that names `https://api.minimaxi.com`.

## Regions and credentials

| Region | Label | Base URL | Console |
| --- | --- | --- | --- |
| `cn` | China | `https://api.minimax.cn` | `https://platform.minimax.cn/user-center/basic-information/interface-key` |
| `intl` | International | `https://api.minimax.io` | `https://platform.minimax.io/user-center/basic-information/interface-key` |

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
lists the same names.

| Model | Label | Id sent | API | Modes | Resolution (default) | Duration (default) |
| --- | --- | --- | --- | --- | --- | --- |
| `h3` | MiniMax H3 | `MiniMax-H3` | V2 | Frames, References | 768P, 2K (768P) | 4 to 15 s (5) |
| `h3-max` | MiniMax H3 Max | `MiniMax-H3-Max` | V2 | Frames, References | 480P, 768P (768P) | 5 to 15 s (5) |
| `hailuo-2.3` | Hailuo 2.3 | `MiniMax-Hailuo-2.3` | V1 | Frames: start frame optional, no end frame | 768P, 1080P (768P) | 6 or 10 s (6) |
| `hailuo-2.3-fast` | Hailuo 2.3 Fast | `MiniMax-Hailuo-2.3-Fast` | V1 | Frames: start frame required, no end frame | 768P, 1080P (768P) | 6 or 10 s (6) |
| `hailuo-02` | Hailuo 02 | `MiniMax-Hailuo-02` | V1 | Frames: start and end frame optional | 512P, 768P, 1080P (768P) | 6 or 10 s (6) |

- MiniMax H3 Max is MiniMax's faster H3, served by MiniMax's own V2 API
  with the same requests. The API reference and the video guide say it
  takes references (images, videos, and audio); the model list and the
  models overview name only text and frames (the China model list says
  "only"). The catalog follows the API reference.
- The video guide presents H3 and H3 Max as MiniMax's current models. The
  API reference still documents the Hailuo models, the model list lists them
  as available, and the rate limits list the Hailuo series, so they are not
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
  HEIF, which a generation card does not take as images), 256 to 5760 px on each
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
values ([providers, Parameters](../providers.md#parameters)), so
that choosing another model keeps it; the others are named as MiniMax's
fields. The request maps each to MiniMax's field and value
([Requests](#requests)).

| Parameter | Label | Kind | Values | Default | Models | MiniMax's field |
| --- | --- | --- | --- | --- | --- | --- |
| `resolution` | Resolution | choice | `480p`, `512p`, `768p`, `1080p`, `2k` as each model offers them (the model table), labeled as every provider's are: 480p, 512p, 768p, 1080p, 2K | `768p` | all | `resolution`, as MiniMax writes it (`768P`) |
| `ratio` | Ratio | choice, drawn as ratio shapes | 16:9, 4:3, 1:1, 3:4, 9:16, 21:9, Adaptive (`adaptive`) | 16:9 | H3, H3 Max | `ratio`; set by the start frame (`setByStartFrame`), and `adaptive` is sent with a frame |
| `duration` | Duration | whole seconds | 4 to 15 (H3), 5 to 15 (H3 Max), step 1; 6 or 10 (Hailuo, step 4) | 5 (H3, H3 Max), 6 (Hailuo) | all | `duration` |
| `prompt_expansion_mode` | Prompt Expansion | choice | Off (`disabled`), Balanced (`balanced`), Quality (`quality`) | Balanced | H3 Max | `extra.prompt_expansion_mode` |
| `prompt_extend` | Prompt Optimizer | boolean | | on | Hailuo | `prompt_optimizer` |
| `fast_pretreatment` | Fast Optimization | boolean, advanced | | off | Hailuo | `fast_pretreatment` |
| `watermark` | Watermark | boolean, advanced | | off | H3, H3 Max | `aigc_watermark`, in China only |

Rules that `check` reports:

- MiniMax H3 and H3 Max in Frames mode without a frame need a ratio: Ratio
  cannot be Adaptive. With a frame, the video keeps the frame's ratio, which
  MiniMax treats as Adaptive: the start frame sets Ratio, and `adaptive` is
  sent.
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
- Audio that is not WAV or MP3 (M4A) is refused with its name.
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

**Names in the prompt** ([providers](../providers.md#names-in-the-prompt)).
The V2 pages state no rule; their examples call the references by role,
kind, and number, from 1 by kind: "the character's appearance follows
reference images 1 and 2", "following the motion in reference video 1",
"Voice timbre follows reference audio 1", and 参考图1, 参考视频1, and
参考音频1 in Chinese (`guides/video-generation` and the V2 create page, read
2026-10-24). So a mention is written `reference image 1`, `reference video
1`, or `reference audio 1`, or the Chinese names in a Chinese prompt. The
examples never name a frame, and V1 names nothing; those take the shared
names. A name in square brackets is never written for V1, whose
`[command]` syntax moves the camera.

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
- Any other status is an answer BaseHalf cannot read. Neither API reports
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
| 1008, 2053, 2067 | insufficient balance, insufficient credit, usage limit reached with credit auto consumption off | `balance` |
| 1000, 1001, 1024, 1033 | unknown, timeout, internal, or system error | `unknownOutcome` for a create, `network` otherwise |
| 1026, 1027 | sensitive input or output | `rejected` for a create; for a query, the task failed |
| 2013 | invalid parameters | `rejected`; for a query, `notFound` (its one parameter is the task id) |
| any other | | `rejected` |

- An HTTP error maps by its status as [Requests](../providers.md#requests)
  says; the codes and the V2 error types (`authorized_error`,
  `rate_limit_error`, `insufficient_balance_error`) refine a 4xx answer only,
  never 408 or 5xx, so a create answered by a server error keeps its unknown
  outcome.
- A rate limit names MiniMax's limits: 20 requests a minute for the Hailuo
  series; 300 requests a minute and 30 tasks at a time for H3; 10 requests a
  minute for the image models ([Image models](#image-models)). A rate limit
  of a speech request names the speech models' 60 requests a minute
  instead ([Speech models](#speech-models)).

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

`src/vs/platform/basehalfProviders/test/node/minimax.test.ts` runs the module through
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
- the rules of `check`.

## Image models

MiniMax's image models run on the same regions, keys, and base URLs as its
video models (D64). Their API answers the request with the images: there is
no task to poll or cancel.

### Sources

Read on 2026-10-22; no page carries a date. On both sites
(`https://platform.minimax.io/docs/` and `https://platform.minimax.cn/docs/`):
`guides/image-generation`, `api-reference/image-generation-t2i` and
`api-reference/image-generation-i2i` with the files they are drawn from
(`api-reference/image/generation/api/text-to-image.json` and
`…/image-to-image.json`), `faq/models`, `guides/models-intro`, and
`guides/rate-limits`; on the China site also
`api-reference/image/generation/api/openapi.json`. The China text-to-image
page was read again on 2026-10-22 for the names of its style fields.

### Models

| Model | Label | Id sent | Regions | Makes |
| --- | --- | --- | --- | --- |
| `image-01` | MiniMax Image-01 | `image-01` | `cn`, `intl` | 1 to 9 images from a prompt, or from a prompt and one reference image of a person |
| `image-01-live` | MiniMax Image-01 Live | `image-01-live` | `cn` | the same, with drawing styles (comic, lively, medieval, watercolor) |

- Both are of kind `image`, answer at once (`answersAtOnce`), and offer the one
  mode References (`reference`). MiniMax states no output format; its guides
  save the images as JPEG, so the models declare `jpeg` (`outputFormat`), and
  an image that arrives as a PNG lands as one.
- **Open: Image-01 Live outside China.** The international text-to-image page
  leaves it out of its models, while the international image-to-image page
  and model list name it, the latter as making images from a prompt and a
  reference image. The catalog offers it in China only; the international
  text-to-image page, read again on 2026-10-23, still lists `image-01` only.
- No retirement dates are published.

### Modes and inputs

- **References**: no image, or one: MiniMax's character reference
  (`subject_reference` of type `character`), the person the images show.
  MiniMax advises one front-facing portrait. It is a PNG or a JPEG of less
  than 10 MiB (MiniMax writes 10 MB; a file's size is read as MiB, as for
  video); the window draws any other image to PNG first. No pixel limits are
  documented.
- The prompt is required, at most 1,500 characters.

### Parameters

| Parameter | Label | Kind | Values | Default | Models | MiniMax's field |
| --- | --- | --- | --- | --- | --- | --- |
| `ratio` | Ratio | choice, drawn as ratio shapes | 16:9 (1280 × 720), 4:3 (1152 × 864), 3:2 (1248 × 832), 1:1 (1024 × 1024), 2:3 (832 × 1248), 3:4 (864 × 1152), 9:16 (720 × 1280), and for Image-01 21:9 (1344 × 576) | 1:1 | both | `aspect_ratio` |
| `count` | Images | whole number, 1 to 9 | | 1 | both | `n` |
| `prompt_extend` | Prompt Optimizer | boolean | | off | both | `prompt_optimizer` |
| `style_type` | Style | choice, optional | Comic (`comic`), Lively (`lively`), Medieval (`medieval`), Watercolor (`watercolor`) | none | Image-01 Live | `style.style_type`: `漫画`, `元气`, `中世纪`, `水彩` |
| `style_weight` | Style Weight | number, 0.1 to 1, step 0.1, advanced | | 0.8 | Image-01 Live | `style.style_weight`, with a style only |
| `seed` | Seed | whole number 0 to 2147483647, optional, advanced | | unset: a new seed for each image | both | `seed` |
| `watermark` | Watermark | boolean, advanced | | off | both | `aigc_watermark`, in China only |

- The ratio is always sent; MiniMax has no Adaptive, and its default is 1:1.
  The sizes in parentheses are MiniMax's. MiniMax has no resolution.
- The style's values are named in English in the catalog and sent as
  MiniMax's own words. The field names are those of the rendered China
  reference (read again 2026-10-23): `style` is "画风设置，仅当 `model` 为
  `image-01-live` 时生效", with `style_type` required (`漫画`, `元气`,
  `中世纪`, `水彩`) and `style_weight` optional, from more than 0 to 1, 0.8 by
  default. The China site's `openapi.json` still names `type` and `weight`;
  the module sends the names of the reference.
- Rules that `check` reports: the AIGC watermark is offered in China only, as
  for video (the international pages document no `aigc_watermark`).

### Requests and answers

`POST /v1/image_generation`, JSON: `model`, `prompt`, `aspect_ratio`, `n`,
`prompt_optimizer`, `response_format: "base64"`, `seed` when it is set,
`subject_reference: [{"type": "character", "image_file"}]` with a reference
as a data URL of the format its header shows, for Image-01 Live
`style: {"style_type", "style_weight"}` when a style is chosen, and in China
`aigc_watermark`. Not sent: `width` and `height`.

The images are asked for as base64: at about 1K, nine of them make a small
answer, and no second download from MiniMax's file host is needed. The answer
holds:

- `base_resp`: a code other than 0 fails the request as the video V1 API's
  codes do ([Errors](#errors)), such as 1026 for a prompt with sensitive
  content (`rejected`) and 1000 for an unknown error (an unknown outcome);
- `data.image_base64[]`: the images, written to their targets in order;
  `data.image_urls[]`, as a relay may answer, are addresses;
- `metadata.failed_count`, a number or a numeric text: that many images were
  withheld by MiniMax's content check. Each is reported after the images made,
  as refused with "MiniMax's content check stopped this image.", and its card
  fails alone;
- an answer without `data` and without withheld images leaves the outcome
  unknown.

An image model has no task: `poll` refuses it, and `cancel` answers false
and sends nothing. The HTTP statuses and MiniMax's codes map as in
[Errors](#errors); a rate limit names the image models' 10 requests a minute.

### Left out

- Image-01's `width` and `height` (512 to 2048 px, multiples of 8), which
  `aspect_ratio` overrides: the catalog offers MiniMax's own sizes.
- Image-01 Live in the international region (open, above).
- Addresses (`response_format: "url"`) as what is asked for.

### Acceptance criteria

1. Image-01 is listed under Images in both regions, and Image-01 Live in China
   only.
2. A request without a reference sends no `subject_reference`; one with a
   reference sends it as a character with a data URL.
3. Images, Ratio, Prompt Optimizer, the seed, and the style map to `n`,
   `aspect_ratio`, `prompt_optimizer`, `seed`, and `style`; the watermark is
   sent as `aigc_watermark` in China only.
4. Each image answered lands on its target in order, and each image the
   content check withheld is reported as refused while the others land.
5. A nonzero `base_resp`, the HTTP errors, and a dropped connection map as for
   video, and the request is sent once.

### Verification

`src/vs/platform/basehalfProviders/test/node/minimax.test.ts` also runs the image
models against a local server that answers like MiniMax's image API: the
catalog entries, the body of each model with and without a reference and in
each region, the answers as base64 and as addresses with withheld images,
the codes of `base_resp`, refused keys, too many requests, an empty balance,
a dropped connection, and the rules of `check`.

## Speech models

MiniMax's speech models run on the same regions, keys, and base URLs as its
video and image models (D78). Their API answers the request with the
speech: there is no task to poll or cancel. MiniMax's music is not offered
(D78).

### Sources

Read on 2026-10-25; no page carries a date. On the international site
(`https://platform.minimax.io/docs/`): `api-reference/speech-t2a-http` and
the file it is drawn from (`api-reference/speech/t2a/api/openapi.json`),
`guides/speech-t2a-websocket` (the guide of synchronous speech: its models,
languages, and hosts), `api-reference/voice-management-get` and
`api-reference/speech/voice-management/api/openapi.json`,
`faq/system-voice-id`, `faq/about-apis`, `faq/models`,
`api-reference/errorcode`, and `guides/rate-limits`. On the China site
(`https://platform.minimax.cn/docs/`): the same two OpenAPI files, which name
`https://api.minimax.cn` as their server, `faq/system-voice-id`, and
`api-reference/errorcode`.

### Models

| Model | Label | Id sent | Regions | Emotions |
| --- | --- | --- | --- | --- |
| `speech-2.8-hd` | Speech 2.8 HD | `speech-2.8-hd` | `cn`, `intl` | the seven every model takes |
| `speech-2.8-turbo` | Speech 2.8 Turbo | `speech-2.8-turbo` | `cn`, `intl` | the seven |
| `speech-2.6-hd` | Speech 2.6 HD | `speech-2.6-hd` | `cn`, `intl` | the seven, Fluent, and Whisper |
| `speech-2.6-turbo` | Speech 2.6 Turbo | `speech-2.6-turbo` | `cn`, `intl` | the seven, Fluent, and Whisper |

- Each is of kind `audio`, makes `speech`, answers at once
  (`answersAtOnce`), and delivers MP3 (`outputFormat: mp3`).
- The one mode is Speech (`reference`), which takes no inputs. The prompt is
  what the voice says: required, and "less than 10,000 characters", so at
  most 9,999.
- The 2.8 models read interjections in the text, such as `(laughs)` and
  `(sighs)`, and every model reads pauses written `<#0.5#>` and
  pronunciations in parentheses: they are the text's, and are sent as
  written.
- The guide calls Speech 2.8 HD "ultra-realistic", Speech 2.8 Turbo fast
  with a natural flow, Speech 2.6 HD natural with low latency, and Speech
  2.6 Turbo faster; each description says so. Both regions list the same
  ids. No retirement dates are published.

### Voices

- The voice is `voice_setting.voice_id`, a parameter of kind `voice` that
  is listed. The catalog declares one voice, the default
  `English_Graceful_Lady` (**Graceful Lady**, "English"): a system voice
  that the system voice lists of both sites name, and that the reference
  names among MiniMax's latest English voices. Each list's first voice is
  missing from the other list (`English_expressive_narrator`,
  `male-qn-qingse`).
- `voices` asks `POST /v1/get_voice` with `{"voice_type": "all"}`, one
  request without pages, retried as a poll is. The answer's
  `voice_cloning` (voices the user cloned) and `voice_generation` (voices
  the user designed) are the account's own, in that order; its
  `system_voice` are MiniMax's. A voice is its `voice_id`, named by its
  `voice_name` (a cloned or designed voice has none, and the service names
  it by its id), and described by the texts of its `description` list,
  joined by spaces. MiniMax gives no samples.
- A cloned or designed voice is listed only after it has been used for
  speech once (the voice management reference), and MiniMax deletes one
  that is not used within 7 days of its making (`faq/about-apis`); a card
  that sends such a voice gets MiniMax's answer ([Errors](#errors-1)).
- A nonzero `base_resp` of the list maps as the codes of a query do
  ([Errors](#errors)): an unknown or internal error is a network failure,
  and nothing is created.
- More than 2,000 voices answer the first 2,000, with `truncated`.

### Parameters

| Parameter | Label | Kind | Values | Default | MiniMax's field |
| --- | --- | --- | --- | --- | --- |
| `voice` | Voice | voice, listed | `English_Graceful_Lady` in the catalog, and every voice `voices` lists | `English_Graceful_Lady` | `voice_setting.voice_id` |
| `speed` | Speed | number, 0.5 to 2, step 0.05 | | 1 | `voice_setting.speed` |
| `vol` | Volume | number, 0.1 to 10, step 0.1 | | 1 | `voice_setting.vol` |
| `pitch` | Pitch | whole number, −12 to 12 semitones | | 0 | `voice_setting.pitch` |
| `emotion` | Emotion | choice | Auto (`auto`), Happy (`happy`), Sad (`sad`), Angry (`angry`), Fearful (`fearful`), Disgusted (`disgusted`), Surprised (`surprised`), Calm (`calm`), and on Speech 2.6 Fluent (`fluent`) and Whisper (`whisper`) | Auto | `voice_setting.emotion`; nothing for Auto |
| `language_boost` | Language | choice, optional, advanced | Auto (`auto`), then MiniMax's 40 languages in its order, Chinese (`Chinese`), Cantonese (`Chinese,Yue`), English, … Afrikaans | unset: nothing sent | `language_boost` |
| `voice_modify.pitch` | Deepen / Brighten | whole number, −100 to 100, advanced | | 0 | `voice_modify.pitch` |
| `voice_modify.intensity` | Stronger / Softer | whole number, −100 to 100, advanced | | 0 | `voice_modify.intensity` |
| `voice_modify.timbre` | Nasal / Crisp | whole number, −100 to 100, advanced | | 0 | `voice_modify.timbre` |
| `voice_modify.sound_effects` | Sound Effect | choice, optional, advanced | Spacious Echo (`spacious_echo`), Auditorium Echo (`auditorium_echo`), Lo-Fi Telephone (`lofi_telephone`), Robotic (`robotic`) | unset: none | `voice_modify.sound_effects` |

- `speed` is the shared name, and MiniMax's range is the shared one
  ("[0.5, 2]"). The others are MiniMax's own and named as its fields, the
  voice effects with their object, `voice_modify.`; the effects are labeled
  as the sliders of MiniMax's own page ("Deepen/Brighten",
  "Stronger/Softer", "Nasal/Crisp").
- The volume is "(0, 10]", so the catalog starts it at 0.1.
- "By default, the model automatically selects the most natural emotion
  based on text": Auto sends no emotion. The reference says that `fluent`
  and `whisper` are "only available for" the 2.6 models, and also that the
  2.8 models "do not support `whisper`". Whether 2.8 takes `fluent` is not
  clear, so the catalog offers both on 2.6 only.
- The language "controls whether recognition for specific minority
  languages and dialects is enhanced. Default is `null`": unset sends
  nothing, and Auto lets MiniMax detect the language. The 2.6 and 2.8
  models take all 40 (the reference names Persian, Filipino, and Tamil as
  missing from the 01 and 02 models only).
- The voice effects are sent only when one of them is set: then the three
  numbers, and the sound effect when one is chosen.
- No rule joins these parameters, so `check` adds no problem for a speech
  model.

### Requests and answers

`POST /v1/t2a_v2`, sent once, with:

```json
{
	"model": "speech-2.8-hd",
	"text": "<the prompt>",
	"stream": false,
	"output_format": "hex",
	"voice_setting": { "voice_id": "English_Graceful_Lady", "speed": 1, "vol": 1, "pitch": 0, "emotion": "calm" },
	"audio_setting": { "format": "mp3", "sample_rate": 44100, "bitrate": 256000, "channel": 1 },
	"language_boost": "auto",
	"voice_modify": { "pitch": 0, "intensity": -20, "timbre": 0, "sound_effects": "spacious_echo" }
}
```

- `emotion`, `language_boost`, and `voice_modify` are sent only when set.
- The speech is asked for as MP3 at MiniMax's best: 44,100 Hz, the highest
  of its sample rates, and 256,000 bps, the highest of its bitrates, in one
  channel, its default (its FAQ calls mono the clearer for speech). No plan
  is documented to limit them.
- The speech is asked for as hex (`output_format: hex`, MiniMax's default)
  rather than as an address valid for 24 hours: the file comes in the
  answer, and nothing is downloaded from MiniMax's file host. The longest
  speech of 9,999 characters stays within what an answer at once may be.
- The answer holds `data.audio`, the hex of the MP3, written to the
  request's one target under the checks of a download; `base_resp`, whose
  code other than 0 fails the request ([Errors](#errors-1)); and
  `extra_info`, which is not read. An address in `data.audio`, as a relay
  may answer, is downloaded as an image's address is. Text that is not hex
  is refused as the output: "MiniMax answered a sound BaseHalf cannot
  read." An answer without `data.audio` leaves the outcome unknown.
- Not sent: `stream_options`, `pronunciation_dict`, `timbre_weights`,
  `text_normalization_mode`, `subtitle_enable`, `subtitle_type`,
  `latex_read`, and `aigc_watermark`.

A speech model has no task: `poll` refuses it, and `cancel` answers false
and sends nothing.

### Errors

The HTTP statuses and MiniMax's codes map as in [Errors](#errors). A speech
request says more about these codes, which are `rejected`, after MiniMax's
words and code:

| Code | MiniMax's words | BaseHalf adds |
| --- | --- | --- |
| 1026 | input new_sensitive | MiniMax's content check refused the text. |
| 1027 | output new_sensitive | MiniMax's content check stopped the speech. |
| 1042 | invisible character ratio limit | More than a tenth of the text is characters MiniMax cannot read. |
| 2054, 20132 | voice id not exist; invalid samples or voice_id | MiniMax does not know this voice for this key: choose another voice. |
| 2042 | You don't have access to this voice_id | The voice belongs to another MiniMax account: choose one of this account's voices. |
| 2043 | The model does not support this voice_id | This model does not speak in this voice: choose another voice or another model. |
| 2061, 2068 | the plan does not support the model | The MiniMax plan of this key does not include this model. |

A rate limit names MiniMax's 60 requests a minute for the speech models
(`guides/rate-limits`), in place of the video and image models' limits.

### Left out

- Streaming, the speech WebSockets, and the asynchronous API for long texts
  (`/v1/t2a_async_v2`), which runs as a task.
- `speech-02-hd` and `speech-02-turbo`, the older models of the model list,
  and `speech-01-hd` and `speech-01-turbo`, which only the request's list
  names.
- Cloning and designing a voice, which the user does in MiniMax's own app
  (D78), and mixing voices (`timbre_weights`).
- Pronunciation rules, subtitles, text normalization, reading LaTeX, and
  the China region's `aigc_watermark`, an audio mark at the end of the
  speech.
- The US West host `https://api-uw.minimax.io`, which a user can enter as
  the endpoint.
- MiniMax's music (D78).

### Acceptance criteria

1. Speech 2.8 HD, Speech 2.8 Turbo, Speech 2.6 HD, and Speech 2.6 Turbo are
   listed under Audio in both regions, each making speech in MP3 at once.
2. A request sends the prompt as `text`, the voice, Speed, Volume, Pitch,
   and an Emotion other than Auto in `voice_setting`, MP3 at 44,100 Hz and
   256,000 bps as hex, the Language when it is set, and the voice effects
   only when one is set.
3. The hex answered lands on the target as an MP3.
4. `voices` lists the account's cloned and designed voices as its own, then
   MiniMax's system voices, without samples.
5. A nonzero `base_resp`, the HTTP errors, and a dropped connection map as
   for video, with plain words for sensitive text, an unknown voice, and a
   voice or model the key may not use, and the request is sent once.

### Verification

`src/vs/platform/basehalfProviders/test/node/minimax.test.ts` also runs the
speech models against a local server that answers like MiniMax's speech
API: the catalog entries, the body of each model in each region with the
defaults and with every setting, the speech answered as hex and as an
address, the voices of an account through `voices`, the codes of
`base_resp`, refused keys, too many requests, a dropped connection, the
rules of `check`, and that a speech model has no task.
