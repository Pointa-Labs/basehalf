# Providers and the model catalog

Status: Draft (2026-10-22; video providers active since 2026-10-19; no price, 2026-10-21; image models, D64)
Decisions: [D59](../decisions.md#d59--video-providers-are-built-in-integrations-with-each-models-exact-settings-users-bring-their-own-keys-new-2026-10-19),
[D61](../decisions.md#d61--basehalf-shows-no-price-new-2026-10-21),
[D64](../decisions.md#d64--basehalf-generates-images-with-the-same-cards-panel-and-providers-new-2026-10-22)
Related: [generation cards](generation-cards.md),
[built-in AI Video and the frozen plugin platform](built-in-ai-video-and-plugin-freeze.md),
[BaseHalf's pages in Settings](settings-pages.md) (how Settings opens at the
Providers page)

This specification owns which providers BaseHalf runs, the catalog that
declares their image and video models, the credentials users enter for them,
and how a request reaches a provider and comes back. The
[generation cards](generation-cards.md) specification owns the card, its
panel, and the life of a generation; it reads everything about providers and
models from the catalog described here.

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
declarations. Its catalog stays right because one team owns it and ships it
with each release. BaseHalf takes that design, with two differences: users
bring their own keys and pay their providers directly, and BaseHalf shows no
price (D61).

Until D64 the catalog held only video models, and BaseHalf made no images,
although ten of its twelve video providers sell image models under the same
key.

## Goals

- One source of truth: each provider module in the AI Video extension
  declares its models and calls its API. Nothing in the window knows a
  provider or a model.
- Every model runs with exactly the options its provider accepts, and the
  panel offers nothing else.
- Users set up a provider once: a region, their own credentials, and, when
  they use a relay or a private gateway, its endpoint. The same setup serves
  the provider's image models and its video models.
- Inputs reach the provider without any service of BaseHalf in between.

## Non-goals

- A service, proxy, credit balance, or storage of BaseHalf's own.
- Models a provider offers that the catalog does not list. They come with a
  release.
- User-written request scripts, and a general format for relays. A relay that
  mirrors a provider's own API is used through that provider.
- Inputs that a provider takes only as public URLs and for which it has no
  upload endpoint. Such inputs are not offered for that provider.
- Editing tools that are not generation: upscaling, background removal,
  masks, layers, lip sync on an existing video.
- A ChatGPT or Codex login as credentials. OpenAI's Sign in with ChatGPT
  offers no image generation, and BaseHalf never reads or forwards the login
  of the user's Codex (D64).
- Compatibility with D58 channels or `.bhnode` settings. The product has not
  launched.
- A price, an estimate, or a currency (D61). What a generation costs is in
  the provider's console, where the user gets the key.

## Terms

- **Provider**: a company's API for generative media, such as ByteDance's
  ModelArk.
- **Region**: one deployment of a provider with its own base URL and keys,
  such as Volcengine Ark (China) and BytePlus ModelArk (international) for
  ByteDance.
- **Credentials**: what the provider needs to accept a request, usually one
  API key; some need two values.
- **Endpoint**: the base URL requests go to. It is the region's base URL
  unless the user enters another one.
- **Model**: an entry of the catalog, such as Seedance 2.5 or Seedream 5.0
  Pro. Its id is stable in BaseHalf; the id sent to the provider may differ by
  region. Its **kind** is `image` or `video`.
- **Mode**: how the card's inputs are used: `frames`, `reference`, `extend`,
  or `edit` ([Modes and inputs](#modes-and-inputs)).
- **Parameter**: a setting a model declares, such as `resolution`.
- **Output**: one file a generation makes. A video model makes one; an image
  model makes as many as its `count`.

## The catalog

The AI Video extension builds the catalog from its provider modules and
answers it to the window through the internal command
`basehalf.video.provider.catalog` (the internal commands keep the names they
had before image models). The window asks once per window and
keeps the answer; it changes only when the extension changes. The same
catalog reaches agents through `basehalf --list-capabilities`
([generation cards, Agents](generation-cards.md#agents)). Labels,
descriptions, and tooltips are in the window's display language.

### Provider

```json
{
	"id": "bytedance",
	"label": "ByteDance",
	"regions": [
		{ "id": "cn", "label": "China · Volcengine Ark", "baseUrl": "https://ark.cn-beijing.volces.com/api/v3", "console": "https://ark.volcengine.com/region:cn-beijing/apiKey" },
		{ "id": "intl", "label": "International · BytePlus ModelArk", "baseUrl": "https://ark.ap-southeast.bytepluses.com/api/v3", "console": "https://ai.byteplus.com/ark/region:ap-southeast-1/apiKey" }
	],
	"credentials": [{ "id": "apiKey", "label": "API Key" }],
	"models": [ ... ]
}
```

- `id` is stable and is what a card stores. `regions` lists at least one
  region; the first is the default; `console` is where the user gets a key.
- `credentials` lists the values the provider needs, in order. Every value is
  a secret.

### Model

```json
{
	"id": "seedream-5.0-pro",
	"kind": "image",
	"label": "Seedream 5.0 Pro",
	"description": "…",
	"providerModels": { "cn": "doubao-seedream-5-0-pro-260628", "intl": "dola-seedream-5-0-pro-260628" },
	"prompt": { "required": "always", "maxLength": 4000 },
	"modes": [ ... ],
	"parameters": [ ... ],
	"deprecated": false
}
```

- `kind`: `image` or `video`. A card offers only the models of its kind, and
  a card's kind never changes with its model.
- `providerModels`: for each region that offers the model, the id sent to
  the provider there. A card whose provider is set up in another region shows
  the model as unavailable there. Where the provider has one id per task for
  the same model (one for text to video, one for image to video), the
  catalog still lists one model, whose modes and inputs choose the id;
  `providerModels` gives the id of its first task, and `check` answers the
  id the request would be sent with ([Requests](#requests)).
- `prompt.required`: `always`, `withoutMedia` (required when the mode sends
  no image or video), or `never`. `maxLength` counts characters of the
  prompt as sent, text inputs included.
- `deprecated` models are shown only to cards that already use them.
  `deprecatedIn` lists the regions that retire a model when not all do; the
  model is then deprecated only there. Agents read both.
- `outputFormat`, for an image model: the format its module asks the provider
  for, `png`, `jpeg`, or `webp` ([Image format](#image-format)). A draft takes
  its extension from it ([generation cards](generation-cards.md#creating-a-generation-card)).

### Modes and inputs

A model offers one or more modes. Each declares the input slots it fills from
the card's connections ([generation cards, Inputs](generation-cards.md#inputs)):

| Mode | Kind | Uses |
| --- | --- | --- |
| `frames` | video | the first image as the start frame and the second as the end frame, as far as the mode takes them; with no image, the prompt alone |
| `reference` | image, video | images, videos, and audio as references, in order; an image model's references are images, and with none the prompt alone makes the image |
| `extend` | video | the first video as the clip to continue |
| `edit` | video | the first video as the clip to change, and images as references |

An image model offers the one mode `reference`, whose `images.min` is 0 when
the model also makes an image from the prompt alone. The provider module
sends a request without images to the provider's text-to-image call, where
the provider has one of its own.

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
- `regions` lists the regions that offer the mode, when not every region
  that offers the model does, for example a mode whose clip needs an upload
  that only one region has. Elsewhere the window shows the mode dimmed with
  the reason, and `check` refuses it.
- `limits` are checked before anything is sent; any may be absent.
  `imageFormats` lists the image formats the provider takes in the mode,
  among `png`, `jpeg`, and `webp`, PNG always among them; without it, all
  three. The window draws an image of another format to PNG before it sends
  it ([generation cards, Inputs](generation-cards.md#inputs)).
- A provider whose API takes videos or audio only as public URLs, and that
  has no upload endpoint, declares no video or audio slots.

### Parameters

```json
{ "name": "resolution", "label": "Resolution", "kind": "choice", "options": [{ "value": "480p", "label": "480p" }, { "value": "720p", "label": "720p" }, { "value": "1080p", "label": "1080p" }], "default": "720p" }
{ "name": "ratio", "label": "Ratio", "kind": "choice", "display": "ratio", "options": [ ... ], "default": "16:9", "modes": ["reference"] }
{ "name": "duration", "label": "Duration", "kind": "integer", "unit": "seconds", "min": 4, "max": 30, "step": 1, "default": 5, "auto": { "value": -1, "label": "Auto" } }
{ "name": "count", "label": "Images", "kind": "integer", "min": 1, "max": 4, "step": 1, "default": 1 }
{ "name": "sound", "label": "Sound", "kind": "boolean", "default": true }
{ "name": "seed", "label": "Seed", "kind": "integer", "min": 0, "max": 2147483647, "optional": true, "advanced": true }
{ "name": "negative_prompt", "label": "Negative Prompt", "kind": "text", "maxLength": 2500, "optional": true, "advanced": true }
```

- `kind` is `choice`, `integer`, `number`, `boolean`, or `text`.
- `default` is used when the card has no value. `optional` parameters may be
  left unset, and nothing is sent for them.
- `modes` limits a parameter to some modes; without it the parameter applies
  to every mode.
- `setByStartFrame` marks a parameter that a start frame decides, such as
  the ratio of a model whose video takes the frame's shape. While the
  planned inputs have a start frame, the window shows it as set by the start
  frame, and nothing is sent or recorded for it; the card keeps its value for
  when no start frame is connected. AI Video drops it from a request with a
  start frame before the provider module sees it.
- `advanced` parameters are shown under **More** in the settings.
- `display` is a hint: `ratio` draws ratio shapes, `slider` a slider.
- `auto` adds a choice that lets the provider decide.
- Rules that join several parameters, such as "1080P allows 6 seconds only"
  or "a transparent background needs PNG", are checked by the provider module
  and reported by `check` ([Requests](#requests)), not declared.

**Shared names.** A parameter that means the same at every provider has one
name and one set of values in the catalog, so that choosing another model
keeps it ([generation cards, Settings](generation-cards.md#settings)). The
provider module maps it to its provider's field and value.

| Name | Kind | Values | Means |
| --- | --- | --- | --- |
| `resolution` | choice | lower case: for videos `360p`, `480p`, `512p`, `540p`, `720p`, `768p`, `1080p`, `2k`, `4k`; for images `1k`, `1.5k`, `2k`, `3k`, `4k`; labeled the same at every provider: 720p, 1080p, 1K, 1.5K, 2K, 3K, 4K | the size of the video or of the image |
| `ratio` | choice, drawn as ratio shapes | width to height, such as `16:9`; `adaptive` (**Adaptive**) when the provider takes the shape from the inputs or the prompt | the shape of the video or of the image |
| `duration` | whole seconds | the model's range; Auto is `-1` where the provider can choose | the length of the video |
| `count` | whole number | 1 to the most images one request makes | how many images one generation makes |
| `quality` | choice | `low`, `medium`, `high`, `xhigh`, `max`, and `auto` where the provider can choose | how much effort and detail the provider spends on an image |
| `background` | choice | `opaque`, `transparent`, and `auto` where the provider can choose | whether the image may be transparent |
| `sound` | boolean | | the model makes voices, effects, or music with the video |
| `seed` | whole number, optional, advanced | 0 to 2147483647 | the same seed with the same request gives a similar result |
| `negative_prompt` | text, optional, advanced | | what the result should not show |
| `prompt_extend` | boolean | | the provider rewrites or extends the prompt before it generates |
| `watermark` | boolean, advanced | | the provider marks the result as made by AI |

A parameter only one provider has is named as that provider's field.

### Image format

An image model has no format parameter. Its module asks for PNG where the
provider offers a choice, and takes the provider's own format otherwise; the
model declares the result as `outputFormat`, so that a draft has its final
name before it generates. A file that arrives in another format still lands,
under the extension of its format
([generation cards, Landing](generation-cards.md#landing)).

## Credentials, regions, and endpoints

Settings has one **Providers** page
([BaseHalf's pages in Settings](settings-pages.md) owns how it opens). It
lists the providers of the catalog. For each:

- **Region**, when the provider has more than one. It sets the base URL and
  which models are offered.
- **Credentials**: one field per value the provider declares. A value is
  stored encrypted on this computer, never in the workspace, and never shown
  again: the field says whether it is set and offers Replace and Remove.
- **Endpoint**: the region's base URL unless the user enters another one, an
  `https` URL, or an `http` URL on this computer. It is how a relay or a
  private gateway that mirrors the provider's own API is used.
- A link to the provider's console for the region.
- The provider's models, by name, under Images and Videos, so that the user
  can tell which provider to get credentials from.

A provider is set up when every credential value is set. Nothing is checked
with the provider when values are saved; the first generation tells the user
whether they work. A stored value that cannot be read, such as one encrypted
with a key that this computer no longer has, or one that the keychain refused
for a moment, is neither used nor deleted, and the record of this computer
stays as it is: the provider still shows as set up, a generation says that
BaseHalf cannot read the credentials and asks to set them again, and a value
that can be read again works again. Replace and Remove write over the
provider's stored values: with values that cannot be read, those of its
other credentials are gone too, and show as not set.

The page saves each change at once, one after another:

- The endpoint is saved when its field loses the focus, on Enter, which
  keeps the focus in the field, and when the page closes or is left, also by
  Escape or Cmd+W, which close Settings without taking the focus from the
  field. Its outcome shows where the field
  is, without drawing the page again, so the click that took the focus
  reaches what it clicked. An address the page cannot take is shown with
  the reason while the page is open, and is not kept when the page closes.
- Enter that an input method uses to choose its text is not for the page.
- A second change does not wait for the first to be shown and is not
  dropped; the same change is not made twice. A change that ends after
  another provider is shown says so in the status line, with the provider's
  name, and leaves that provider's fields alone.
- While the catalog loads, the page says so; when it could not be loaded,
  the page says why and offers **Try Again**. Removing the credentials of a provider leaves its cards
as they are; they show that the provider is not set up. Changing the region
keeps an endpoint the user entered; clearing the endpoint, or entering the
region's base URL, goes back to the region's base URL.

The credential values of a provider are stored as one secret, a JSON object
of the declared ids, under `basehalf.modelServices.video.<provider>.apiKey`,
a name from before image models that serves both kinds; a provider id is
lowercase letters, digits, and hyphens. The region, the
endpoint, and the ids of the credential values that are set, never the
values, are stored in the application storage of this computer under
`basehalf.video.providers.v1`, so every window knows at once whether a
provider is set up. The last provider, model, mode, and values used for a
video are stored there under `basehalf.video.lastUsed.v2`, and for an image
under `basehalf.image.lastUsed.v1`. A value is visible ASCII without spaces,
at most 16 KiB.

## Requests

The window calls the AI Video extension through internal commands. Each
answers `{ok: true, value}` or `{ok: false, error: {code, message}}` and keeps
no state between calls. Requests run in the extension host: providers do not
answer cross-origin requests from the window.

| Command | Does |
| --- | --- |
| `basehalf.video.provider.catalog` | answers the catalog |
| `basehalf.video.provider.check` | validates a planned generation |
| `basehalf.video.provider.submit` | sends the request once and answers the provider's task id, or the outputs when the provider answers with them at once |
| `basehalf.video.provider.poll` | asks the provider about a task once |
| `basehalf.video.provider.download` | downloads one output to a given file |
| `basehalf.video.provider.cancel` | asks the provider to cancel a task, where it can |

- `check` takes the provider, region, model, mode, parameters, the prompt as
  sent, and the planned inputs with their files. It answers the problems, in
  order, as plain sentences. It reads image sizes and video
  and audio lengths from the files and checks them against the mode's
  limits. For a model
  whose modes and inputs choose among several provider ids, it also answers
  `providerModel`, the id the request would be sent with; the window records
  that id with the generation.
- `submit` takes, with the request, one target file per output the request
  may make (the `count` of an image model, otherwise one), each a new `.part`
  file under `.bh/cache/generation/`; for a model that answers at once, it
  sends nothing when the request names fewer. It answers either a task to
  poll, or the outputs at once, in the provider's order: an address to
  download, a target it has already written when the provider answered with
  the file itself, or the reason of an output the provider refused alone. A
  file it writes passes the checks a download passes. A provider that answers
  at once may take minutes; `submit` waits up to ten minutes for the whole
  answer and reads up to 256 MiB of it, and the catalog says which models
  answer at once, so that the window can tell what a request that never came
  back may have cost.
- `poll` answers a task that succeeded with its outputs in the same three
  forms, or for a video model whose provider gives one address, with that
  address. When the provider's answer holds the files themselves, `poll`
  writes them to the targets the window names with the task, as `submit`
  does.
- Each output is kept on its own. An output AI Video cannot keep (not a file
  of the model's kind, too large, an address it does not download from, or a
  file it cannot write) is answered like a refusal, with the reason, and the
  others land. Outputs beyond the targets are dropped. An address that needs
  headers of its own is downloaded into its target while the command runs,
  since the headers never leave the extension. A provider that answers with
  the files themselves when the window named no target fails the command:
  `submit` with an unknown outcome, since the files were made, and `poll` as
  refused.
- `submit` is never retried. A request whose answer does not come back, whose
  answer is only a server error (408 or 5xx), or whose accepted answer cannot
  be read has an unknown outcome
  ([generation cards, Ending without its files](generation-cards.md#ending-without-its-files));
  a refusal (any other 4xx) made no task. `submit` checks the request exactly
  as `check` does and sends nothing when it finds a problem.
- `poll`, `download`, and uploads are retried on network errors and on 429,
  408, 500, 502, 503, and 504, three times, 1, 2, then 4 seconds apart, or
  after the `Retry-After` the provider asks for when it is at most 30
  seconds; a longer one ends the retries, and the error says the wait. A
  cancellation is sent once.
- A download follows at most five redirects, sends the credentials only to
  the endpoint's own origin, never to a CDN, and keeps only a file of the
  model's kind: a video that starts like an MP4, at most 512 MiB; an image
  that starts like a PNG, JPEG, or WebP, at most 64 MiB. A refusal from another
  origin means the address expired. `download` takes the kind and the
  output's address; a video without an address is found by the provider
  module where it can find one, and an output that has an address needs no
  task id, since a provider that answers at once gives none. It answers the size and the
  format the bytes start like, which decides the file's extension.
- A provider module maps its own task states to `pending`, `running`,
  `succeeded` with the addresses of the outputs, or `failed` and `cancelled`
  with the provider's message, and reports progress when the provider does.
  An output that the provider refused on its own, such as one image of four
  that its content check stopped, is reported with the reason; the others
  land.
- Inputs travel the provider's way: inline base64 or a data URL where the
  provider takes it, otherwise the provider's upload endpoint. Files are read
  from the workspace by the extension; nothing is uploaded anywhere else.
- Errors are plain text of at most 1,000 characters, without the credentials,
  markup, or request bodies: wrong credentials (`auth`, 401 and 403), refused
  input (`rejected`, any other 4xx, and 404 for a request that creates a
  task), too many requests (`rateLimited`, 429, with the provider's limit when
  it states one), insufficient balance (`balance`, 402 or the provider's own
  code), unknown task (`notFound`, 404 when asking about a task), unknown
  outcome, network failure, unreadable answer, and a download that is not a
  video (`notVideo`), not an image (`notImage`), or too large (`tooLarge`). A
  provider module reads the provider's own error codes where they say more
  than the status.
- Nothing is logged except, in the extension's log (the **BaseHalf AI
  Video** output channel), the method, the path without query, the status,
  and the time of each call, and how many outputs beyond the targets were
  dropped.
- The extension checks every request against the model's declarations
  (the inputs the mode takes, the prompt rule, each parameter's value, and
  the mode's limits) before the provider module adds the rules
  between parameters and the provider's own input rules.

## Providers

Every provider below is reached on its own API with the user's credentials.
Each has its own specification in [providers/](providers/), with its regions,
its models of each kind and what each accepts, and its requests and task
states:

- [ByteDance (Seedance, Seedream)](providers/bytedance.md)
- [Kling](providers/kling.md)
- [Alibaba (Wan, Qwen-Image)](providers/alibaba.md)
- [MiniMax (Hailuo)](providers/minimax.md)
- [Vidu](providers/vidu.md)
- [Google (Gemini)](providers/google.md)
- [PixVerse](providers/pixverse.md)
- [Luma](providers/luma.md)
- [Runway](providers/runway.md)
- [xAI (Grok Imagine)](providers/xai.md)
- [LTX](providers/ltx.md)
- [Black Forest Labs (FLUX)](providers/bfl.md)
- [OpenAI (GPT Image)](providers/openai.md)

| Provider | Regions and base URL | Credentials | Images | Videos and audio | Image models | Cancel |
| --- | --- | --- | --- | --- | --- | --- |
| ByteDance | China `https://ark.cn-beijing.volces.com/api/v3`, international `https://ark.ap-southeast.bytepluses.com/api/v3` | API key, `Authorization: Bearer` | data URL | audio as data URL; video only as a public URL: not offered | Seedream, answered at once | queued tasks |
| Kling | China `https://api-beijing.klingai.com`, international `https://api-singapore.klingai.com` | API key, `Authorization: Bearer` | base64 | public URL only: not offered | Kling Image, tasks on its earlier `/v1/images/` API | no |
| Alibaba | China `https://dashscope.aliyuncs.com`, international `https://dashscope-intl.aliyuncs.com` | API key, `Authorization: Bearer`, `X-DashScope-Async: enable` | data URL | temporary upload (`oss://`) in China only | Qwen-Image and Wan, tasks | pending tasks |
| MiniMax | China `https://api.minimax.cn`, international `https://api.minimax.io` | API key, `Authorization: Bearer` | data URL | file upload (`mm_file://`) | image-01, answered at once | queued tasks (H3) |
| Vidu | China `https://api.vidu.cn`, international `https://api.vidu.com` | API key, `Authorization: Token` | data URL | audio as data URL | Vidu Q2 and Q1, tasks | before it is scheduled |
| Google | `https://generativelanguage.googleapis.com/v1beta` | API key, `x-goog-api-key` | inline base64 | inline base64 (videos), within the request size | Gemini image models, answered at once | running interactions |
| PixVerse | `https://app-api.pixverse.ai` | API key, `API-KEY` and a new `Ai-trace-id` per request | upload (`img_id`) | upload (`media_id`) | none | no |
| Luma | `https://agents.lumalabs.ai/v1` | API key, `Authorization: Bearer` | base64 data | file upload | Uni-1, tasks | no |
| Runway | `https://api.dev.runwayml.com` | API key, `Authorization: Bearer`, `X-Runway-Version: 2024-11-06` | data URI | upload (`runway://`) | Gen-4 Image, tasks | yes |
| xAI | `https://api.x.ai/v1` | API key, `Authorization: Bearer` | data URL | video as a data URL | Grok Imagine Image, tasks | no |
| LTX | `https://api.ltx.io` | API key, `Authorization: Bearer` | data URI | upload (`ltx://`) | none | no |
| Black Forest Labs | `https://api.bfl.ai/v1` | API key, `x-key` | data URL | clip of Edit and Extend as a data URL | FLUX 3 and FLUX.2, tasks | no |
| OpenAI | `https://api.openai.com/v1` | API key, `Authorization: Bearer` | multipart files | none | GPT Image, answered at once | no |

The video facts were read from each provider's documentation on 2026-10-18,
and the image facts on 2026-10-22; each provider's specification records the
pages it follows. OpenAI's video API closed on 2026-09-24 and is not offered;
its image models are. Google's Veo models on the Gemini API are previews
retiring from 2026-10-22; Google is offered through the model that replaces
them.

### Phases

1. The catalog, the Video Providers page, the settings drawn from the
   catalog, and ByteDance, Kling, Alibaba, MiniMax, Vidu, and Google.
2. PixVerse, Luma, Runway, xAI, LTX, and Black Forest Labs.
3. Image models (D64): the kind of a model, outputs, requests that answer at
   once, the Providers page, the image models of ByteDance, Kling, Alibaba,
   MiniMax, Vidu, Google, Luma, Runway, xAI, and Black Forest Labs, and
   OpenAI.

Phases 1 and 2 are implemented (2026-10-19). A provider added later is in the
catalog once its module is in `PROVIDER_MODULES`, and not before.

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
   server that answers like the provider: create, poll through every state or
   an answer with the outputs at once, download, cancel where offered,
   refused credentials, too many requests, and an answer that never comes.
6. No model declares a price and no region a currency, and `check` answers
   no price or estimate (D61).
7. A request is never sent twice by BaseHalf: not after an error, not after a
   reload or a restart, not by a second window, and not when an agent and the
   user start the same card at once.
8. A card offers only the models of its kind, and the Providers page lists
   each provider's models under Images and Videos.
9. An image request with `count` above 1 lands one file per output, and an
   output the provider refused alone is reported while the others land.

## Verification

- Unit tests of the catalog contract, of the window's drawing and planning
  from declarations, and of each provider module.
- The smoke runs the generation card steps against the local test provider
  through the ByteDance module, for a video and for an image.
- No real provider is called by tests.
