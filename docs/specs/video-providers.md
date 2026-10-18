# Video providers and the model catalog

Status: Active (2026-10-19)
Decision: [D59](../decisions.md#d59--video-providers-are-built-in-integrations-with-each-models-exact-settings-users-bring-their-own-keys-new-2026-10-19)
Related: [Video node](video-node.md),
[built-in AI Video and the frozen plugin platform](built-in-ai-video-and-plugin-freeze.md)

This specification owns which video providers BaseHalf runs, the catalog that
declares their models, the credentials users enter for them, and how a request
reaches a provider and comes back. The [Video node](video-node.md)
specification owns the node, its panel, its card, and the life of a
generation; it reads everything about providers and models from the catalog
described here.

## Problem

D58 gave the window a table of nine models and let users type any other model
id into a "channel". The table decided which settings the panel showed, how
settings changed between models, and which inputs a mode took; the request
formats lived in the AI Video extension; a general profile guessed for every
model the table did not know. The same knowledge sat in four places that had
to agree, and a new model, such as a new Seedance version, either needed a
change in several of them or ran on a guess.

A node-graph tool for generative media keeps one integration per provider,
on the provider's own API, and declares every model with its exact
parameters next to the code that calls it. Every control is drawn from those
declarations, and a price estimate is computed from them. Its catalog stays
right because one team owns it and ships it with each release. BaseHalf
takes that design, with one difference: users bring their own keys and pay
their providers directly.

## Goals

- One source of truth: each provider module in the AI Video extension
  declares its models and calls its API. Nothing in the window knows a
  provider or a model.
- Every model runs with exactly the options its provider accepts, and the
  panel offers nothing else.
- Users set up a provider once: a region, their own credentials, and, when
  they use a relay or a private gateway, its endpoint.
- The panel shows what a generation will cost, from the provider's published
  list price, before it runs.
- Inputs reach the provider without any service of BaseHalf in between.

## Non-goals

- A service, proxy, credit balance, or storage of BaseHalf's own.
- Models a provider offers that the catalog does not list. They come with a
  release.
- User-written request scripts, and a general format for relays. A relay that
  mirrors a provider's own API is used through that provider.
- Inputs that a provider takes only as public URLs and for which it has no
  upload endpoint. Such inputs are not offered for that provider.
- Video editing tools that are not generation (upscaling, background removal,
  lip sync on an existing video).
- Compatibility with D58 channels or `.bhnode` version 5 settings. The
  product has not launched.

## Terms

- **Provider**: a company's video API, such as ByteDance's Seedance API.
- **Region**: one deployment of a provider with its own base URL, keys, and
  currency, such as Volcengine Ark (China) and BytePlus ModelArk
  (international) for ByteDance.
- **Credentials**: what the provider needs to accept a request, usually one
  API key; some need two values.
- **Endpoint**: the base URL requests go to. It is the region's base URL
  unless the user enters another one.
- **Model**: an entry of the catalog, such as Seedance 2.5. Its id is stable
  in BaseHalf; the id sent to the provider may differ by region.
- **Mode**: how the node's inputs are used: `frames`, `reference`, `extend`,
  or `edit` ([Modes and inputs](#modes-and-inputs)).
- **Parameter**: a setting a model declares, such as `resolution`.
- **Estimate**: the price of one generation computed from the provider's
  published list price.

## The catalog

The AI Video extension builds the catalog from its provider modules and
answers it to the window through the internal command
`basehalf.video.provider.catalog`. The window asks once per window and keeps
the answer; it changes only when the extension changes. The same catalog
reaches agents through `basehalf --list-capabilities`
([Video node, Agents](video-node.md#agents)). Labels, descriptions, and
tooltips are in the window's display language.

### Provider

```json
{
	"id": "bytedance",
	"label": "ByteDance",
	"regions": [
		{ "id": "cn", "label": "China · Volcengine Ark", "baseUrl": "https://ark.cn-beijing.volces.com/api/v3", "currency": "CNY", "console": "https://ark.volcengine.com/region:cn-beijing/apiKey" },
		{ "id": "intl", "label": "International · BytePlus ModelArk", "baseUrl": "https://ark.ap-southeast.bytepluses.com/api/v3", "currency": "USD", "console": "https://ai.byteplus.com/ark/region:ap-southeast-1/apiKey" }
	],
	"credentials": [{ "id": "apiKey", "label": "API Key" }],
	"models": [ ... ]
}
```

- `id` is stable and is what a node stores. `regions` lists at least one
  region; `currency` is `CNY` or `USD`; `console` is where the user gets a
  key.
- `credentials` lists the values the provider needs, in order. Every value is
  a secret.

### Model

```json
{
	"id": "seedance-2.5",
	"label": "Seedance 2.5",
	"description": "…",
	"providerModels": { "cn": "doubao-seedance-2-5-260628", "intl": "dreamina-seedance-2-5-260628" },
	"prompt": { "required": "withoutMedia", "maxLength": 20000 },
	"modes": [ ... ],
	"parameters": [ ... ],
	"estimate": true,
	"deprecated": false
}
```

- `providerModels`: for each region that offers the model, the id sent to
  the provider there. A node whose provider is set up in another region shows
  the model as unavailable there.
- `prompt.required`: `always`, `withoutMedia` (required when the mode sends
  no image or video), or `never`. `maxLength` counts characters of the
  prompt as sent, text inputs included.
- `deprecated` models are shown only to nodes that already use them.

### Modes and inputs

A model offers one or more modes. Each declares the input slots it fills from
the node's connections ([Video node, Inputs](video-node.md#inputs)):

| Mode | Uses |
| --- | --- |
| `frames` | the first image as the start frame and the second as the end frame, as far as the mode takes them; with no image, the prompt alone |
| `reference` | images, videos, and audio as references, in order |
| `extend` | the first video as the clip to continue |
| `edit` | the first video as the clip to change, and images as references |

```json
{
	"id": "frames",
	"label": "Frames",
	"inputs": {
		"startFrame": "optional",
		"endFrame": "optional",
		"images": { "min": 0, "max": 0 },
		"videos": { "min": 0, "max": 0 },
		"audios": { "min": 0, "max": 0 },
		"source": "none"
	},
	"limits": { "imageMinSide": 300, "imageMaxSide": 6000, "imageAspect": [0.4, 2.5], "imageMaxBytes": 31457280, "videoSeconds": [2, 30], "videoTotalSeconds": 30, "audioSeconds": [2, 30], "audioTotalSeconds": 30 }
}
```

- `startFrame` and `endFrame` are `none`, `optional`, or `required`.
- `images`, `videos`, and `audios` give how many references the mode takes.
- `source` is `none` or `required` (the clip of `extend` and `edit`).
- `limits` are checked before anything is sent; any may be absent.
- A provider whose API takes videos or audio only as public URLs, and that
  has no upload endpoint, declares no video or audio slots.

### Parameters

```json
{ "name": "resolution", "label": "Resolution", "kind": "choice", "options": [{ "value": "480p", "label": "480p" }, { "value": "720p", "label": "720p" }, { "value": "1080p", "label": "1080p" }], "default": "720p" }
{ "name": "ratio", "label": "Ratio", "kind": "choice", "display": "ratio", "options": [ ... ], "default": "16:9", "modes": ["reference"] }
{ "name": "duration", "label": "Duration", "kind": "integer", "unit": "seconds", "min": 4, "max": 30, "step": 1, "default": 5, "auto": { "value": -1, "label": "Auto" } }
{ "name": "generate_audio", "label": "Sound", "kind": "boolean", "default": true }
{ "name": "seed", "label": "Seed", "kind": "integer", "min": 0, "max": 2147483647, "optional": true, "advanced": true }
{ "name": "negative_prompt", "label": "Negative Prompt", "kind": "text", "maxLength": 2500, "optional": true, "advanced": true }
```

- `kind` is `choice`, `integer`, `number`, `boolean`, or `text`.
- `default` is used when the node has no value. `optional` parameters may be
  left unset, and nothing is sent for them.
- `modes` limits a parameter to some modes; without it the parameter applies
  to every mode.
- `advanced` parameters are shown under **More** in the settings.
- `display` is a hint: `ratio` draws ratio shapes, `slider` a slider.
- `auto` adds a choice that lets the provider decide.
- Rules that join several parameters, such as "1080P allows 6 seconds only",
  are checked by the provider module and reported by `check`
  ([Requests](#requests)), not declared.

### Estimate

A model with `estimate: true` has its price computed by its provider module
from the provider's published list price for the region, given the mode,
parameters, and inputs. The answer is a single amount or a range in the
region's currency, with the date of the price list. Where the price depends on
something known only after the run, such as the length of a reference video
that the provider measures, the answer is a range. A model without a published
price has no estimate.

## Credentials, regions, and endpoints

Settings has one **Video Providers** page. It lists the providers of the
catalog. For each:

- **Region**, when the provider has more than one. It sets the base URL, the
  currency, and which models are offered.
- **Credentials**: one field per value the provider declares. A value is
  stored encrypted on this computer, never in the workspace, and never shown
  again: the field says whether it is set and offers Replace and Remove.
- **Endpoint**: the region's base URL unless the user enters another one, an
  `https` URL, or an `http` URL on this computer. It is how a relay or a
  private gateway that mirrors the provider's own API is used.
- A link to the provider's console for the region.

A provider is set up when every credential value is set. Nothing is checked
with the provider when values are saved; the first generation tells the user
whether they work. Removing the credentials of a provider leaves its nodes
as they are; they show that the provider is not set up.

The credential values of a provider are stored as one secret, a JSON object
of the declared ids, under `basehalf.modelServices.video.<provider>.apiKey`.
The region and the endpoint are stored in the application storage of this
computer.

## Requests

The window calls the AI Video extension through internal commands. Each
answers `{ok: true, value}` or `{ok: false, error: {code, message}}` and keeps
no state between calls. Requests run in the extension host: providers do not
answer cross-origin requests from the window.

| Command | Does |
| --- | --- |
| `basehalf.video.provider.catalog` | answers the catalog |
| `basehalf.video.provider.check` | validates a planned generation and estimates its price |
| `basehalf.video.provider.submit` | sends the request once and answers the provider's task id |
| `basehalf.video.provider.poll` | asks the provider about a task once |
| `basehalf.video.provider.download` | downloads the video to a given file |
| `basehalf.video.provider.cancel` | asks the provider to cancel a task, where it can |

- `check` takes the provider, region, model, mode, parameters, the prompt as
  sent, and the planned inputs with their files. It answers the problems, in
  order, as plain sentences, and the estimate. With files, it reads image
  sizes and video and audio lengths and checks them against the mode's
  limits; without files it checks only counts and parameters.
- `submit` is never retried. A request whose answer does not come back, whose
  answer is only a server error (408 or 5xx), or whose accepted answer cannot
  be read has an unknown outcome
  ([Video node, Ending without a video](video-node.md#ending-without-a-video));
  a refusal (any other 4xx) made no task. `submit` checks the request exactly
  as `check` does with files and sends nothing when it finds a problem.
- `poll`, `download`, and uploads are retried on network errors and on 429,
  408, 500, 502, 503, and 504, three times, 1, 2, then 4 seconds apart, or
  after the `Retry-After` the provider asks for when it is at most 30
  seconds; a longer one ends the retries, and the error says the wait. A
  cancellation is sent once.
- A download follows at most five redirects, sends the credentials only to
  the endpoint's own origin, never to a CDN, stops at 512 MiB, and keeps only
  a file that starts like an MP4. A refusal from another origin means the
  address expired.
- A provider module maps its own task states to `pending`, `running`,
  `succeeded` with a video URL, or `failed` and `cancelled` with the
  provider's message, and reports progress when the provider does.
- Inputs travel the provider's way: inline base64 or a data URL where the
  provider takes it, otherwise the provider's upload endpoint. Files are read
  from the workspace by the extension; nothing is uploaded anywhere else.
- Errors are plain text of at most 1,000 characters, without the credentials,
  markup, or request bodies: wrong credentials (`auth`, 401 and 403), refused
  input (`rejected`, any other 4xx, and 404 for a request that creates a
  task), too many requests (`rateLimited`, 429, with the provider's limit when
  it states one), insufficient balance (`balance`, 402 or the provider's own
  code), unknown task (`notFound`, 404 when asking about a task), unknown
  outcome, network failure, unreadable answer. A provider module reads the
  provider's own error codes where they say more than the status.
- Nothing is logged except, in the extension's log (the **BaseHalf AI
  Video** output channel), the method, the path without query, the status,
  and the time of each call.
- The extension checks every request against the model's declarations
  (the inputs the mode takes, the prompt rule, each parameter's value, and
  with files the mode's limits) before the provider module adds the rules
  between parameters and the estimate. An estimate is answered only for a
  model declared with one, in its region's currency.

## Providers

Every provider below is reached on its own API with the user's credentials.
The detailed model tables are in each provider's section, written when the
provider is implemented.

| Provider | Regions and base URL | Credentials | Images | Videos and audio | Cancel |
| --- | --- | --- | --- | --- | --- |
| ByteDance (Seedance) | China `https://ark.cn-beijing.volces.com/api/v3`, international `https://ark.ap-southeast.bytepluses.com/api/v3` | API key, `Authorization: Bearer` | data URL | audio as data URL; video only as a public URL: not offered | queued tasks |
| Kling | China `https://api-beijing.klingai.com`, international `https://api-singapore.klingai.com` | API key, `Authorization: Bearer` | base64 | public URL only: not offered | no |
| Alibaba (Wan) | China `https://dashscope.aliyuncs.com`, international `https://dashscope-intl.aliyuncs.com` | API key, `Authorization: Bearer`, `X-DashScope-Async: enable` | data URL | temporary upload (`oss://`) in China only | pending tasks |
| MiniMax (Hailuo) | China `https://api.minimax.cn`, international `https://api.minimax.io` | API key, `Authorization: Bearer` | data URL | file upload (`mm_file://`) | queued tasks (H3) |
| Vidu | China `https://api.vidu.cn`, international `https://api.vidu.com` | API key, `Authorization: Token` | data URL | audio as data URL | before it is scheduled |
| Google (Gemini) | `https://generativelanguage.googleapis.com/v1beta` | API key, `x-goog-api-key` | inline base64 | inline base64 (videos), within the request size | no |
| PixVerse | `https://app-api.pixverse.ai` | API key, `API-KEY` and a new `Ai-trace-id` per request | upload (`img_id`) | upload (`media_id`) | no |
| Luma | `https://agents.lumalabs.ai/v1` | API key, `Authorization: Bearer` | base64 data | file upload | no |
| Runway | `https://api.dev.runwayml.com` | API key, `Authorization: Bearer`, `X-Runway-Version: 2024-11-06` | data URI | upload (`runway://`) | yes |
| xAI (Grok Imagine) | `https://api.x.ai/v1` | API key, `Authorization: Bearer` | data URL | file upload | no |
| LTX | `https://api.ltx.io` | API key, `Authorization: Bearer` | data URI | upload (`ltx://`) | no |
| Black Forest Labs (FLUX) | `https://api.bfl.ai/v1` | API key, `x-key` | base64 | — | no |

These facts were read from each provider's documentation on 2026-10-18; each
provider's section records the pages it follows. OpenAI's video API closed on
2026-09-24 and is not offered. Google's Veo models on the Gemini API are
previews retiring from 2026-10-22; Google is offered through the model that
replaces them.

### Phases

1. The catalog, the Video Providers page, the settings drawn from the
   catalog, estimates, and ByteDance, Kling, Alibaba, MiniMax, Vidu, and
   Google.
2. PixVerse, Luma, Runway, xAI, LTX, and Black Forest Labs.

Until a provider is implemented it is not in the catalog.

### ByteDance (Seedance)

Implemented in `extensions/basehalf-ai-video/src/providers/bytedance.ts`.
The facts below follow these official pages, read on 2026-10-18 and
2026-10-19: on Volcengine Ark, 创建视频生成任务 API, 查询视频生成任务 API,
取消或删除视频生成任务, Base URL 及鉴权, 模型列表 (updated 2026-10-18),
模型价格 (updated 2026-10-17), and 错误码 (updated 2026-10-17); on BytePlus
ModelArk, Create a video generation task (updated 2026-10-17), Retrieve a
video generation task, Cancel or delete a video generation task, Model list,
and Model pricing (both updated 2026-10-18).

**Regions and credentials.** One credential, `apiKey` (**API Key**), sent as
`Authorization: Bearer <key>`.

| Region | Label | Base URL | Currency | Console |
| --- | --- | --- | --- | --- |
| `cn` | China · Volcengine Ark | `https://ark.cn-beijing.volces.com/api/v3` | CNY | `https://ark.volcengine.com/region:cn-beijing/apiKey` |
| `intl` | International · BytePlus ModelArk | `https://ark.ap-southeast.bytepluses.com/api/v3` | USD | `https://ai.byteplus.com/ark/region:ap-southeast-1/apiKey` |

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

- Every model's duration defaults to 5 seconds, a price the user can read
  before the run; Auto (`-1`) lets the model choose and makes the estimate a
  range.
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

**Parameters.** Each is named as the API field it sets.

| Parameter | Label | Kind | Values | Default | Models |
| --- | --- | --- | --- | --- | --- |
| `resolution` | Resolution | choice | as in the model table | as in the model table | all |
| `ratio` | Ratio | choice, drawn as ratio shapes | 16:9, 4:3, 1:1, 3:4, 9:16, 21:9, Adaptive (`adaptive`) | Adaptive; 16:9 for 1.0 Pro and 1.0 Pro Fast | all |
| `duration` | Duration | whole seconds, step 1 | as in the model table; Auto is `-1` | 5 | all |
| `generate_audio` | Sound | boolean | | on | 2.5, the 2.0 series, 1.5 Pro |
| `seed` | Seed | whole number 0 to 2147483647, optional, advanced | | unset: a new seed each time | 1.5 Pro, 1.0 Pro, 1.0 Pro Fast |
| `camera_fixed` | Fixed Camera | boolean, advanced | | off | 1.5 Pro, 1.0 Pro, 1.0 Pro Fast |
| `watermark` | Watermark | boolean, advanced | | off | all |

Rules that `check` reports:

- Seedance 2.5 keeps the start frame's ratio: with a start frame, Ratio must
  be Adaptive.
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

**Errors.** The statuses map as in [Requests](#requests). The provider's codes
`AccountOverdueError` and `OperationDenied.ServiceOverdue` are `balance`;
`OperationDenied.ServiceNotOpen`, `ModelNotOpen`, and
`InvalidEndpointOrModel.*` are `rejected`, with the provider's message saying
that the model is not activated for the account.

**Estimate.** Tokens are seconds × width × height × 24 / 1024 at the output
size of the resolution and ratio, and the price is the tokens times the price
per million tokens of the model and resolution for output without an input
video. Auto duration gives a range from the shortest to the longest duration;
Adaptive a range over the six ratios at the resolution.

| Model | Volcengine Ark, CNY (2026-10-17) | BytePlus ModelArk, USD (2026-10-18) |
| --- | --- | --- |
| Seedance 2.5 | 70.00 at 480p and 720p, 77.00 at 1080p | 10.70 at 480p and 720p, 11.70 at 1080p |
| Seedance 2.0 | 46.00 at 480p and 720p, 51.00 at 1080p, 26.00 at 4K | 7.00 at 480p and 720p, 7.70 at 1080p, 4.00 at 4K |
| Seedance 2.0 Fast | 37.00 | 5.60 |
| Seedance 2.0 Mini | 23.00 | 3.50 |
| Seedance 1.5 Pro | — | 2.40 with sound, 1.20 without |
| Seedance 1.0 Pro | 15.00 | 2.50 |
| Seedance 1.0 Pro Fast | 4.20 | 1.00 |

Output sizes in pixels, from the create pages:

| Resolution | Ratio | 2.5 | 2.0 series and 1.5 Pro | 1.0 Pro and 1.0 Pro Fast |
| --- | --- | --- | --- | --- |
| 480p | 16:9, 4:3, 1:1, 3:4, 9:16, 21:9 | 854×480, 752×560, 640×640, 560×752, 480×854, 992×432 | 864×496, 752×560, 640×640, 560×752, 496×864, 992×432 | 864×480, 736×544, 640×640, 544×736, 480×864, 960×416 |
| 720p | the same | 1280×720, 1112×834, 960×960, 834×1112, 720×1280, 1470×630 | the same as 2.5 | 1248×704, 1120×832, 960×960, 832×1120, 704×1248, 1504×640 |
| 1080p | the same | 1920×1080, 1664×1248, 1440×1440, 1248×1664, 1080×1920, 2206×946 | the same as 2.5 | 1920×1088, 1664×1248, 1440×1440, 1248×1664, 1088×1920, 2176×928 |
| 4K | the same | — | 3840×2160, 3326×2494, 2880×2880, 2494×3326, 2160×3840, 4398×1886 (2.0 only) | — |

The prompt has no documented length limit; the pages advise at most 500
Chinese characters or 1,000 English words. The catalog bounds it at 20,000
characters, text inputs included.

## Acceptance criteria

1. The window contains no provider or model name, request format, or
   parameter table; removing a provider module removes the provider from the
   page, the model menu, and `--list-capabilities`.
2. Every control of the settings is drawn from the selected model's
   declarations, and changing the model keeps every value the new model
   accepts and gives the others the new model's defaults.
3. A provider is set up with its region and credentials; the credentials are
   in no workspace file, no page markup, and no log.
4. `check` reports, before anything is written, a missing required input, too
   many inputs, an input outside the mode's limits, a prompt that is too long
   or missing, and a rule between parameters.
5. Each implemented provider passes its module's tests against a local
   server that answers like the provider: create, poll through every state,
   download, cancel where offered, refused credentials, too many requests,
   and an answer that never comes.
6. The estimate of each model with a published price matches the provider's
   price list for three parameter combinations recorded in its tests.
7. A request is never sent twice by BaseHalf.

## Verification

- Unit tests of the catalog contract, of the window's drawing and planning
  from declarations, and of each provider module.
- The smoke runs the Video node steps against the local test provider through
  the ByteDance module.
- No real provider is called by tests.
