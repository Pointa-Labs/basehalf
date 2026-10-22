# OpenAI

Status: Draft (2026-10-22)
Decision: [D64](../../decisions.md#d64--basehalf-generates-images-with-the-same-cards-panel-and-providers-new-2026-10-22)
Parent: [Providers and the model catalog](../providers.md)

This specification owns the OpenAI module of AI Video
(`vscode-base/extensions/basehalf-ai-video/src/providers/openai.ts`): the GPT
Image models it declares, the requests it sends, and how it reads OpenAI's
answers. What is the same for every provider (the commands, the checks from
the declarations, retries, the download, plain messages) is owned by the
parent specification and is not repeated here. OpenAI's video API closed on
2026-09-24; this module declares image models only and no video location.

## Sources

OpenAI's API documentation at `https://developers.openai.com/api/`, read on
2026-10-22; its pages carry no date of their own.

| Page (path) | What this specification takes from it |
| --- | --- |
| `docs/guides/image-generation` | the Image API, the models, sizes and their limits, quality, background, output formats, moderation, the blocked-content error, "may need to complete the API Organization Verification", up to two minutes for complex prompts |
| `reference/resources/images` | `POST /v1/images/generations` and `/v1/images/edits`, their fields and ranges, the answer with `b64_json` |
| `docs/models/gpt-image-2.5-sunburst`, `docs/models/gpt-image-2.5-flare`, `docs/models/gpt-image-2` | the ids, their snapshots, quality values, the endpoints each supports |
| `docs/deprecations` | `gpt-image-1` shuts down 2026-10-23; `gpt-image-1.5`, `gpt-image-1-mini`, and `chatgpt-image-latest` on 2026-12-01 |
| `docs/guides/error-codes` | 401, 403, 429 and its codes, 500, 503 |
| `docs/guides/your-data` | data residency hosts and their conditions |
| the official OpenAPI file, `github.com/openai/openai-openapi` (v2.3.0) | the same schemas: `CreateImageRequest`, the multipart `CreateImageEditRequest`, and the JSON `EditImageBodyJsonParam` |

## Regions and credentials

- One region, `global` (**Global**), base URL `https://api.openai.com/v1`,
  console `https://platform.openai.com/settings/organization/api-keys`.
- One credential, the API key (`apiKey`, **API Key**), sent as
  `Authorization: Bearer <key>`. The `OpenAI-Organization` and
  `OpenAI-Project` headers are not sent: a project key names its project.
- A project with data residency is reached by entering its host as the
  endpoint, such as `https://eu.api.openai.com/v1`; OpenAI decides whether the
  project may use images there.
- An organization that OpenAI has not verified may be refused GPT Image
  models; the refusal is shown as OpenAI words it. Its help article answers no
  client but a browser, so the exact requirement and its error were not read
  (open question).

## Models

| Catalog id | Label | Sent | Quality |
| --- | --- | --- | --- |
| `gpt-image-2.5-flare` | GPT Image 2.5 Flare | `gpt-image-2.5-flare` | `low`, `medium`, `high`, `xhigh`, `max`, `auto` |
| `gpt-image-2.5-sunburst` | GPT Image 2.5 Sunburst | `gpt-image-2.5-sunburst` | the same |
| `gpt-image-2` | GPT Image 2 | `gpt-image-2` | `low`, `medium`, `high`, `auto` |

- Flare is OpenAI's fast model for everyday images; Sunburst is for when
  editing precision matters most; GPT Image 2 is the earlier model, whose
  transparent background is in preview. Each id names OpenAI's default
  snapshot (`-2026-09-08` for 2.5, `-2026-04-21` for 2).
- Every model is of kind `image`, answers at once (`answersAtOnce`), delivers
  `png` (`outputFormat`), and offers the one mode References (`reference`)
  with 0 to 16 images: PNG, JPEG, or WebP of less than 50 MiB each (OpenAI
  writes 50MB; a file's size is read as MiB, as for the other providers).
- The prompt is required, at most 32,000 characters.
- The older models are not listed: they shut down within six weeks of this
  specification. No model is deprecated.

## Parameters

| Name | Label | Kind | Values | Default | Sent as |
| --- | --- | --- | --- | --- | --- |
| `ratio` | Ratio | choice, ratio shapes | 16:9, 4:3, 3:2, 1:1, 2:3, 3:4, 9:16, 21:9, Adaptive (`adaptive`) | Adaptive | `size` (below) |
| `resolution` | Resolution | choice | `1k`, `2k`, `4k` (1K, 2K, 4K) | `1k` | `size` (below) |
| `quality` | Quality | choice | the model's values: Low, Medium, High, Extra High (`xhigh`), Max, Auto | Auto | `quality` |
| `count` | Images | whole number, 1 to 10 | | 1 | `n` |
| `background` | Background | choice | Opaque (`opaque`), Transparent (`transparent`), Auto (`auto`) | Auto | `background` |
| `moderation` | Moderation | choice, advanced | Auto (`auto`), Low (`low`) | Auto | `moderation`, without references only |

- **Size.** Adaptive sends `size: "auto"`: OpenAI chooses the shape and the
  size from the prompt, and Resolution is not sent (the ratio's tooltip says
  so). Any other ratio sends `WxH`: the width and height of exactly that
  shape, each a multiple of 16, whose area is closest to 1024², 2048², or
  3840 × 2160 for `1k`, `2k`, and `4k`, with no side above 3840 and no more
  than 8,294,400 pixels, as OpenAI's size rules require (sides multiples of
  16, at most 3:1, 655,360 to 8,294,400 pixels, edges at most 3840):

  | Ratio | 1K | 2K | 4K |
  | --- | --- | --- | --- |
  | 16:9 | 1280x720 | 2816x1584 | 3840x2160 |
  | 4:3 | 1152x864 | 2368x1776 | 3264x2448 |
  | 3:2 | 1248x832 | 2496x1664 | 3504x2336 |
  | 1:1 | 1024x1024 | 2048x2048 | 2880x2880 |
  | 2:3 | 832x1248 | 1664x2496 | 2336x3504 |
  | 3:4 | 864x1152 | 1776x2368 | 2448x3264 |
  | 9:16 | 720x1280 | 1584x2816 | 2160x3840 |
  | 21:9 | 1568x672 | 3136x1344 | 3808x1632 |

  OpenAI calls sizes above 2560 × 1440 experimental, which every 2K and 4K
  size is; each model's description says so.
- `output_format` is always `png`, so that a transparent background works.
- No seed, negative prompt, or prompt rewriting is offered: OpenAI takes none
  in the Image API.

Rules that `check` reports:

- **Moderation Low takes no references.** OpenAI's multipart edits take no
  `moderation` (its JSON edits do, but they carry an image as a data URL of
  at most 20,971,520 characters, about 15 MiB, where multipart takes 50 MB).
  BaseHalf sends images as multipart files, so Moderation Low is sent for an
  image made from the prompt alone; with references, `check` asks to set
  Moderation to Auto or to disconnect them. Auto with references sends
  nothing, which is OpenAI's default.
- The request with its images is at most what AI Video sends (128 MiB).

## Requests

- **Without images**: `POST /v1/images/generations`, JSON
  `{model, prompt, n, size, quality, background, output_format, moderation}`.
- **With images**: `POST /v1/images/edits`, multipart: `model`, `prompt`, `n`,
  `size`, `quality`, `background`, and `output_format` as text parts, then
  each image as an `image[]` file part in the order of the inputs, named by
  its place and format (`image-1.png`, `image-2.jpg`) with its MIME type. No
  mask is sent: an edit is described in the prompt.
- Not sent: `response_format` and `style` (unsupported for GPT Image models),
  `output_compression` (PNG has none), `input_fidelity` (to be omitted for
  GPT Image 2, and not stated for 2.5), `partial_images`, `stream`,
  `safety_identifier`, and `user`.
- A complex prompt may take two minutes; `submit` waits up to ten
  ([providers, Requests](../providers.md#requests)).

**Answer.** `data[]`, one entry per image, in OpenAI's order:

- `b64_json`: the image itself, written straight to its target;
- `url`, as a relay may answer: an address to download;
- an entry with neither is refused with "OpenAI answered an image AI Video
  cannot read."

An answer without `data` leaves the outcome unknown. Fewer images than asked
are fewer outputs. There is no task: `poll` refuses one, and `cancel` answers
false and sends nothing.

**Errors.** OpenAI answers `{error: {message, type, code, param}}`:

- 401 is `auth` (a wrong key, an organization the key is not in, an IP the
  allow list does not name).
- 403 is `auth`, with OpenAI's words: a country, region, or territory OpenAI
  does not serve, or a project or organization that may not use the model.
- 429 is `rateLimited` (`rate_limit_error`, `slow_down`), or `balance` when
  its code is `credit_balance_exhausted`, `organization_spend_limit_exceeded`,
  `project_spend_limit_exceeded`, or `organization_usage_limit_exceeded`, or
  its type is `insufficient_quota`.
- A blocked prompt or image (`moderation_blocked`, of type
  `image_generation_user_error`) is `rejected` with OpenAI's message and is
  never sent again; any other 400 is `rejected` too.
- 500 and 503 (`server_is_overloaded`), and a connection that drops after the
  request was sent, leave the outcome of `submit` unknown.

## Left out

- The mask of an edit, and inpainting with it.
- Custom sizes beyond the table, and other output formats (JPEG, WebP) with
  their compression.
- JSON edits, file ids, and image addresses as inputs: inputs come from the
  workspace as files.
- Streaming and partial images; the Batch API; the Responses API's image
  tool, whose mainline model rewrites the prompt.
- A ChatGPT or Codex login as credentials
  ([providers, Non-goals](../providers.md#non-goals)).

## Acceptance criteria

1. The three models are listed under Images with their quality values; no
   other OpenAI model is listed, and the module declares no video location.
2. A request without inputs goes to `/images/generations` as JSON, one with
   images to `/images/edits` as multipart with each image an `image[]` part in
   input order; both write one PNG per image to the targets.
3. Each `ratio` and `resolution` sends the size of the table above, and
   `adaptive` sends `auto`.
4. Moderation Low is sent without references, and `check` refuses it with
   references.
5. 401, 403, 429 with `credit_balance_exhausted`, a blocked prompt, and a 503
   or a dropped connection on `submit` map as described, the last two as an
   unknown outcome, and the request is sent once.

## Verification

`extensions/basehalf-ai-video/test/openai.test.ts` runs the module through
the provider commands against a local server that answers like OpenAI, as the
[parent specification](../providers.md#verification) requires: the catalog
entry, the JSON body of a generation and the multipart form of an edit with
several images, every size of the table, the answers as base64 and as
addresses, the errors above, and the rules of `check`.
