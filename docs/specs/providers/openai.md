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
2026-09-24; this module declares image models only.

## Sources

OpenAI's API documentation at `https://developers.openai.com/api/`, read on
2026-10-22.

| Page (path) | What this specification takes from it |
| --- | --- |
| `docs/guides/image-generation` | the Image API, the models, sizes, quality, background, output formats, "may need to complete the API Organization Verification", up to two minutes for complex prompts |
| `reference/resources/images` | `POST /v1/images/generations` and `/v1/images/edits`, their fields and ranges, the answer with `b64_json` |
| `docs/models/gpt-image-2.5-sunburst`, `docs/models/gpt-image-2.5-flare`, `docs/models/gpt-image-2` | the ids, their snapshots, quality values, release dates |
| `docs/deprecations` | `gpt-image-1` shuts down 2026-10-23; `gpt-image-1.5`, `gpt-image-1-mini`, and `chatgpt-image-latest` on 2026-12-01 |
| `docs/guides/error-codes` | 401, 403, 429, 503, and the blocked-content error |
| `docs/guides/your-data` | data residency hosts and their conditions |
| the official OpenAPI file, `github.com/openai/openai-openapi` (v2.3.0) | the same schemas |

## Regions and credentials

- One region, `global` (**Global**), base URL `https://api.openai.com/v1`,
  console `https://platform.openai.com/settings/organization/api-keys`.
- One credential, the API key, sent as `Authorization: Bearer <key>`.
- A project with data residency is reached by entering its host as the
  endpoint, such as `https://eu.api.openai.com/v1`; OpenAI decides whether the
  project may use images there.
- An organization that OpenAI has not verified may be refused GPT Image
  models; the refusal is shown as OpenAI words it.

## Models

| Catalog id | Label | Sent | Quality |
| --- | --- | --- | --- |
| `gpt-image-2.5-flare` | GPT Image 2.5 Flare | `gpt-image-2.5-flare` | `low`, `medium`, `high`, `xhigh`, `max`, `auto` |
| `gpt-image-2.5-sunburst` | GPT Image 2.5 Sunburst | `gpt-image-2.5-sunburst` | the same |
| `gpt-image-2` | GPT Image 2 | `gpt-image-2` | `low`, `medium`, `high`, `auto` |

Every model is of kind `image`, answers at once, delivers `png`
(`outputFormat`), and offers the one mode `reference` with 0 to 16 images
(PNG, JPEG, or WebP, at most 50 MiB each). The prompt is required, at most
32,000 characters. The older models are not listed: they shut down within six
weeks of this specification.

## Parameters

| Name | Kind | Values | Default | Sent as |
| --- | --- | --- | --- | --- |
| `ratio` | choice, ratio shapes | `adaptive`, `1:1`, `3:2`, `2:3`, `4:3`, `3:4`, `16:9`, `9:16`, `21:9` | `adaptive` | `size` (below) |
| `resolution` | choice | `1k`, `2k`, `4k` | `1k` | `size` (below) |
| `quality` | choice | the model's values | `auto` | `quality` |
| `count` | whole number | 1 to 10 | 1 | `n` |
| `background` | choice | `auto`, `opaque`, `transparent` | `auto` | `background` |
| `moderation` | choice, advanced | `auto`, `low` | `auto` | `moderation` |

- **Size.** `adaptive` sends `size: auto`. Any other ratio sends `WxH`: the
  width and height of that shape whose area is closest to 1024², 2048², or
  3840 × 2160 for `1k`, `2k`, and `4k`, each a multiple of 16, no side above
  3840, and no more than 8,294,400 pixels. OpenAI calls sizes above
  2560 × 1440 experimental; the model's description says so.
- `output_format` is always `png`, so that a transparent background works.
- No seed, negative prompt, or prompt rewriting is offered: OpenAI takes none.

## Requests

- **Without images**: `POST /v1/images/generations`, JSON
  `{model, prompt, n, size, quality, background, output_format, moderation}`.
- **With images**: `POST /v1/images/edits`, multipart, each image as an
  `image[]` part in the order of the inputs, and the other fields as parts.
  No mask is sent.
- The answer is `data[].b64_json`, one per image, written straight to the
  targets `submit` was given; there is no task to poll and nothing to cancel.
- **Errors**: 401 is `auth`; 403 says the country or the organization is not
  allowed; 429 is `rateLimited`, or `balance` when its code is
  `credit_balance_exhausted` or a spend limit; a blocked prompt or image
  (`moderation_blocked`) is `rejected` with OpenAI's message and is never sent
  again; 503 is a server error and, for `submit`, an unknown outcome.

## Acceptance criteria

1. The three models are listed under Images with their quality values; no
   other OpenAI model is listed.
2. A request without inputs goes to `/images/generations`, one with images to
   `/images/edits` with the images in input order; both write one PNG per
   image to the targets.
3. Each `ratio` and `resolution` gives a size that OpenAI accepts by the rules
   above, and `adaptive` sends `auto`.
4. 401, 429 with `credit_balance_exhausted`, a blocked prompt, and a 503 on
   `submit` map as described, the last as an unknown outcome.

## Verification

The module's tests run against a local server that answers like OpenAI, as
the [parent specification](../providers.md#verification) requires.
