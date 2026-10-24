# Google (Gemini API)

Status: implemented (D59; image models D64, 2026-10-22; names in the prompt D74, 2026-10-24; speech and music models D78, 2026-10-25). Part of
[providers and the model catalog](../providers.md), which defines
the catalog, the requests, and the rules every provider follows.

Implemented in `src/vs/platform/basehalfProviders/node/google.ts`. The
module declares Google's video model, Gemini Omni Flash, which runs in the
background; Google's image models, Nano Banana, which answer each request
with its image ([Image models](#image-models)); its speech models, Gemini
3.8 TTS, which answer each request with the speech
([Speech models](#speech-models)); and its music models, Lyria, which answer
each request with the song ([Music models](#music-models)). All use the same
region, key, endpoint, and error reading.

The facts about the video model follow Google's official pages, read on 2026-10-19 (those
also saved on 2026-10-18 had not changed), with the date each page gives as
its last update: Generate and edit videos with Gemini Omni Flash
(2026-09-23), the Gemini Omni Flash model page (2026-08-27), Background
execution (2026-10-14), Interactions API overview (2026-10-15), the
Interactions API reference and its OpenAPI document (2026-10-15), Interactions
API breaking changes of May 2026, API errors (2026-09-20), File input methods
(2026-10-07), Files API, Rate limits (2026-10-15), Billing, Using Gemini API
keys, Gemini Developer API pricing (2026-10-16), Deprecations (2026-10-12),
and the Changelog (2026-10-14).

## Running in the background

BaseHalf records the provider's task id as soon as a request is accepted and
asks about the task later, also after a reload or a restart
([generation cards, A generation](../generation-cards.md#a-generation)). The Gemini API
serves its video model through the Interactions API, whose video examples
make one call that answers with the finished video. The same API runs an
interaction in the background, and BaseHalf uses that:

- `POST /v1beta/interactions` with `"background": true` answers at once with
  the interaction's `id`; the client then asks `GET /v1beta/interactions/{id}`
  until the interaction ends (Background execution; the reference describes
  `background` as "whether to run the model interaction in the background").
- Background execution names "standard Gemini models" and managed agents as
  supported, with `gemini-4-argon` and `gemini-3.8-flash` as examples. It does
  not name Gemini Omni Flash. The Omni guide treats both ways as open to the
  model: its best practices set `background=false`, `store=false`, and
  `stream=false` "for faster, synchronous unary generation", and it describes
  what `GET /v1beta/interactions/{id}` answers for an Omni interaction. That
  Omni runs in the background is therefore implied rather than stated. Were
  Google to refuse the flag for this model, the create would be refused (HTTP
  400, no task). Were it to ignore the flag, the create would answer with the
  finished interaction, whose id BaseHalf follows as usual (the create's
  answer is read as large as a poll's), or, after two idle minutes, end as an
  unknown outcome. None of these fails silently.
- States, from the reference: `queued`, `in_progress`, `requires_action`,
  `completed`, `failed`, `cancelled`, `incomplete`, and the deprecated
  `budget_exceeded`.
- An interaction made in the background is stored (`store` defaults to true;
  the overview calls `store=false` incompatible with background execution).
  Background execution keeps a stored interaction for 7 days; the overview
  keeps stored interactions 55 days on the paid tier, which a project can
  shorten to 7, 14, or 28 days. A generation ends within two hours, so either
  is enough.
- The finished video is a `model_output` step whose content holds
  `{"type": "video", "mime_type": "video/mp4", "data": "<base64>"}`. The Omni
  guide notes that `GET /v1beta/interactions/{id}` answers the video inline as
  base64 even for an interaction created with `"delivery": "uri"`, whose
  address is guaranteed only in the creation answer or the event stream. A
  background interaction has neither, so the video comes inline.
- `POST /v1beta/interactions/{id}/cancel` cancels a background interaction
  that still runs.

Nothing holds a request open while the video is made: the create answers at
once, and every poll is one short request.

## Region and credentials

One credential, `apiKey` (**API Key**), sent as `x-goog-api-key: <key>`.
Rate limits apply per project, not per key, and spend-based limits over a
rolling 10 minutes, which grow with the usage tier; exceeding either answers
HTTP 429 (`rate_limit_exceeded`, `quota_exceeded`, `too_many_requests`, or,
for the spend limits, `RESOURCE_EXHAUSTED`).

| Region | Label | Base URL | Console |
| --- | --- | --- | --- |
| `global` | Gemini API | `https://generativelanguage.googleapis.com/v1beta` | `https://aistudio.google.com/api-keys` |

The pricing page lists Gemini Omni Flash, every image model, and both Lyria
models for the paid tier only ("Not available" on the free tier). A refusal
that names the free tier is answered with a plain message that the key needs
a paid tier ([Errors](#errors)). The speech models are offered on both
tiers, and a refusal that names the free tier says what it means for them
([Speech models](#speech-models)).

## Models

| Model | Sent as | Modes | Resolution (default) | Ratio (default) | Length |
| --- | --- | --- | --- | --- | --- |
| `gemini-omni-1.1-flash` Gemini Omni 1.1 Flash | `gemini-omni-1.1-flash` | Frames, References, Edit, Extend | 360p, 720p, 1080p, 4K (720p) | 16:9, 9:16 (16:9) | 3 to 10 s, set by the prompt |

- The model page gives the output as 3 to 10 seconds at 24 frames per
  second, with sound, in 360p, 720p, 1080p, or 4K; 1080p and 4K are upscaled.
  No deprecation is announced for it.
- The length of the video follows the prompt (the guide's timing examples,
  such as `[0-3s] … [3-6s] …`). The reference lists a
  `response_format.duration` field, but the Omni guide neither documents nor
  uses it, so BaseHalf sends none and offers no Duration setting.

**Left out.**

- `veo-3.1-generate-preview` and `veo-3.1-fast-generate-preview` (released
  2025-10-15) and `veo-3.1-lite-generate-preview` (released 2026-03-31) are
  previews whose shutdown date is 2026-10-22, three days after this reading,
  with `gemini-omni-1.1-flash` as the replacement (Deprecations). They also
  run through `models/{model}:predictLongRunning` and its operations, a format
  D59 removed.
- `gemini-omni-flash-preview` (released 2026-06-30) shuts down on 2026-10-22,
  replaced by `gemini-omni-1.1-flash`.
- `veo-2.0-generate-001`, `veo-3.0-generate-001`, and
  `veo-3.0-fast-generate-001` shut down on 2026-06-30.
- Not offered for Omni: conversational editing with `previous_interaction_id`
  (each generation of a node stands alone), audio references (the guide:
  unsupported), thinking and safety settings, service tiers, webhooks, and
  streaming.

## Modes and inputs

Every mode sends `generation_config.video_config.task`, the reference's
"optional task mode for video generation" (without it, "the model
automatically determines the appropriate mode based on the provided text
prompt and input media"), so that the mode the user chose is the one Google
runs.

| Mode | Task | Start, end frame | Reference images | Reference videos | Clip |
| --- | --- | --- | --- | --- | --- |
| Frames | `text_to_video` without a frame, `image_to_video` with one | optional, optional (an end frame needs a start frame) | — | — | — |
| References | `reference_to_video` | — | 0 to 6 | 0 to 3, each at most 3 s | — |
| Edit | `edit` | — | — | — | required, at most 10 s |
| Extend | `extend` | — | — | — | required, at most 10 s |

- `image_to_video` takes "one or two source images. The first image defines
  the starting frame, and the optional second image defines the ending
  frame."
- References needs at least one image or video. Google states no maximum for
  reference images; its guide shows six in one request, so the catalog takes
  up to six until Google states a limit. Reference videos: "a maximum of 3
  clips, up to 3 seconds each"; their sound is ignored.
- Edit and Extend take the clip only. The guide shows reference media with an
  extension only without a task, and warns that the task "adds strict
  constraints". Input videos for editing and extending are at most 10 seconds.
  Google does not edit or extend an uploaded video for users in the European
  Economic Area, Switzerland, and the United Kingdom; BaseHalf sends the
  request and shows Google's refusal.
- A clip or a reference video must be MP4 or MOV, the formats whose length AI
  Video can read; the declared lengths are 0.1 to 3 seconds for a reference
  video and 0.1 to 10 seconds for a clip (Google states only the maximum).
- The prompt is required in every mode: each documented request describes
  the video, the transition, the change, or the continuation in text. Google
  states no prompt limit besides the context window of 1,048,576 tokens; the
  catalog bounds the prompt, text inputs included, at 1,048,576 characters.
- Inputs travel inline as base64, in the request's `input` list. File input
  methods allows inline data up to 100 MB per request, and the Files API page
  asks for the Files API only above that, so a request whose inputs, encoded,
  would pass 100 MB (10^8 bytes) is refused before anything is sent. The
  Files API (an upload, then waiting for a video file to become `ACTIVE`) is
  not used: inline inputs keep one request per generation.
- A poll reads the interaction without `include_input`, which the reference
  of `GET /interactions/{id}` says adds the input only when it is true, so
  the inputs are not sent back with each poll.

## Parameters

Each is named as the field it sets.

| Parameter | Label | Kind | Values | Default | Sets | Modes |
| --- | --- | --- | --- | --- | --- | --- |
| `resolution` | Resolution | choice | 360p, 720p, 1080p, 4K (`4k`) | 720p | `response_format.resolution` | all |
| `ratio` | Ratio | choice, drawn as ratio shapes | 16:9, 9:16 | 16:9 | `response_format.aspect_ratio` | Frames, References |
| `seed` | Seed | whole number 0 to 2147483647, optional, advanced | | unset: nothing sent | `generation_config.seed` | all |

- Edit and Extend send no ratio: the clip has one.
- The seed is a field of the reference's `generation_config` ("seed used in
  decoding for reproducibility"); the guide's list of settings Omni does not
  support (system instructions, temperature, `top_p`, stop sequences,
  negative prompts) does not name it.

Rules that `check` reports:

- References needs at least one reference image or video.
- A request whose inputs as base64 would pass 100 MB is refused.

## Request

`POST /interactions`, sent once, with:

```json
{
  "model": "gemini-omni-1.1-flash",
  "input": [
    { "type": "image", "mime_type": "image/png", "data": "<base64>" },
    { "type": "text", "text": "<the prompt>" }
  ],
  "generation_config": { "video_config": { "task": "image_to_video" }, "seed": 42 },
  "response_format": { "type": "video", "resolution": "720p", "aspect_ratio": "16:9" },
  "background": true
}
```

- `input` lists the media in the plan's order (start frame, end frame,
  reference images, reference videos, or the clip), then the prompt as the
  last part, as every example of the guide does.
- **Names in the prompt** ([providers](../providers.md#names-in-the-prompt)).
  A mention is written as the tag of its role, as the guide recommends:
  `<FIRST_FRAME>`, `<LAST_FRAME>`, and `<IMAGE_REF_n>` and `<VIDEO_REF_n>`
  counted from 0 by kind ("Image references start from 0."; "Using tags in
  prompts to set image and video roles", `gemini-api/docs/omni`, 2026-09-23).
  The clip of an edit or an extension has no simple tag, so the shared name
  is written.
- An image is sent as `{"type": "image", "mime_type", "data"}` with the type
  its header shows (`image/png`, `image/jpeg`, `image/webp`, `image/gif`); a
  video as `{"type": "video", "mime_type", "data"}` with `video/mp4` or
  `video/mov` (the reference's names).
- `seed` is sent only when set; `ratio`, as `response_format.aspect_ratio`, only in Frames and References.
- Not sent: `store` (true by default, which background execution needs),
  `stream`, `delivery` (inline is the default), `previous_interaction_id`,
  `system_instruction`, `tools`, `safety_settings`, `service_tier`,
  `webhook_config`, `labels`, and the `Api-Revision` header, which Google
  ignores since the legacy schema was removed on 2026-06-08.
- The answer's `id` is the task id.

## Task states

`GET /interactions/{id}`, whose answer may carry the video and the inputs and
is read up to 384 MiB:

| Status | State |
| --- | --- |
| `queued` | pending |
| `in_progress` | running |
| `completed` with a video | succeeded |
| `completed` without a video | failed, with the model's text when it wrote one |
| `failed` | failed, with the interaction's `errors` (or the output step's error) |
| `cancelled` | cancelled |
| `incomplete` | failed: "Google ended the generation without a complete video." |
| `requires_action` | failed: the interaction waits for an action BaseHalf cannot take |
| `budget_exceeded` | failed |

Any other status is an answer BaseHalf cannot read. Google reports no
progress.

## Result

The poll of a completed interaction gives no address: the video is the
base64 `data` of the output step's video content. `download` reads the
interaction again and writes the decoded bytes to the `.part` file under the
same checks as a download: at most 512 MiB, and only a file that starts like
an MP4 (the framework's inline video, below). Should Google answer an address
instead (`uri`), the poll gives it as the video URL: an absolute address is
used as it is, and a resource name `files/<id>` becomes
`<endpoint>/files/<id>:download?alt=media`, the Files API download. The key
goes only to the endpoint's origin.

**Framework.** A provider module's `videoLocation` may answer the video itself,
`{ bytes }`, instead of an address. The download writes it to the new `.part`
file with the checks of a download (512 MiB, `tooLarge`; MP4, `notVideo`) and
leaves no file when it fails.

## Cancel

`POST /interactions/{id}/cancel`, sent once and without a body, applies to a
background interaction that still runs. An answer means the cancellation was
taken (Google may show the new status only after its clean-up), unless it
shows the interaction already ended (`completed`, `failed`, `incomplete`,
`budget_exceeded`); that, or a refusal (HTTP 400, 404, or 409), answers
false. The providers table of the main specification predates this file and
lists no cancel for Google.

## Errors

The Interactions API answers an error as `{"error": {"code", "message"}}`
with a `snake_case` code; older Google answers carry a numeric `code` and a
`status` such as `RESOURCE_EXHAUSTED`. The message is Google's (its code, or
its status, when it has no message). Every code of the API errors page
agrees with its HTTP status, so the statuses map as in
[Requests](../providers.md#requests): `authentication` (401) and
`permission_denied` (403) are `auth`, `payment_required` (402, Prepay
credits depleted) is `balance`, `rate_limit_exceeded`, `quota_exceeded`, and
`too_many_requests` (429) are `rateLimited`, `invalid_request` and
`failed_precondition` (400, for example billing that is not enabled) are
`rejected`, and `model_not_found` (404) refuses a create. Blocked generations
(codes such as `safety`, `prohibited_content`, `content_blocked`) come as a
refused create or a failed interaction with Google's message.

**A key of a free-tier project.** No model of this module is offered on the
free tier (Pricing) but the speech models, whose refusals their own part
reads ([Speech models](#speech-models)), and the pages do not say how Google
words the refusal.
Any error answer (4xx) whose error names the free tier (`free tier`,
`free_tier`, or `FreeTier`, as in a quota of `limit: 0` for
`generate_content_free_tier_requests`, or "free tier is not available in your
country") is answered as `auth` with: "Google offers this model only on a paid
tier, and the project of this API key is on the free tier. Set up billing for
the project in Google AI Studio, or use the key of a project that has it."
Without this, such a refusal, usually HTTP 429, would read as too many
requests, and waiting would not help.

## Facts not confirmed

- That Gemini Omni Flash runs in the background is implied by the Omni guide
  and not stated by the background execution page (above).
- Whether a poll answers the inputs' base64 again inside its `user_input`
  step.
- The highest number of reference images: Google states none.
- Whether the reference's `response_format.duration` applies to Omni.

## Image models

Google makes images with its Nano Banana models through the same
Interactions API, endpoint, key, and errors as the video model. An image
interaction is created and answered in one call: BaseHalf sends the request
once and receives the image inside the answer, so every image model declares
`answersAtOnce` ([providers, Requests](../providers.md#requests)).

### Sources

Google's official pages, read on 2026-10-22 in the Markdown form Google serves
for each page, with the date each gives as its last update:

| Page | Updated | What this part takes from it |
| --- | --- | --- |
| Nano Banana image generation (`gemini-api/docs/image-generation`) | 2026-10-09 | the models and the one Google recommends; requests with `response_format`; the prompt before the images in most examples; up to 14 reference images; the default shape ("matches the output image size to that of your input image, or otherwise generates 1:1 squares"); the ratios and sizes of each model; thinking levels; "the model won't always follow the exact number of image outputs" |
| Model pages of `gemini-nano-banana-2.1`, `gemini-3-pro-image`, `gemini-3.1-flash-lite-image`, `gemini-3.1-flash-image`, and `gemini-2.5-flash-image` | 2026-10-06, 2026-09-03, 2026-09-03, 2026-10-09, 2026-09-03 | inputs, input token limits, sizes, thinking, Lite's 1K only and its ten ratios |
| Interactions API reference (`api/interactions-api`) and its OpenAPI document | 2026-10-21 | `response_format` of type `image`: `aspect_ratio` (14 values), `image_size` (`512`, `1K`, `2K`, `4K`), `mime_type` (`image/jpeg` only), `delivery`; `generation_config.thinking_level`; the statuses; the five model ids |
| Interactions API overview | 2026-10-15 | the answer of a create holds the steps the model made; interactions are stored by default |
| Background execution | 2026-10-21 | names standard Gemini models and agents, and no image model |
| API errors | 2026-09-20 | the error shape, the codes by status, the codes of blocked images (`image_safety`, `image_prohibited_content`, `image_recitation`, `image_other`) and `no_image` |
| Deprecations | 2026-10-20 | release and shutdown dates, and replacements |
| Changelog | 2026-10-14 | 2.1 released and 3.1 Flash Image deprecated on 2026-10-06; inline data raised from 20 MB to 100 MB on 2026-01-08 |
| File input methods | 2026-10-07 | inline data up to 100 MB per request |
| Pricing | 2026-10-19 | read only for the tiers: no image model is offered on the free tier |
| Rate limits and Billing | 2026-10-15, 2026-09-28 | a project is on the free tier until billing is set up in Google AI Studio |

### Models

| Catalog id | Label | Sent as (`global`) | Ratios | Resolution | `thinking_level` (default) | Prompt |
| --- | --- | --- | --- | --- | --- | --- |
| `gemini-nano-banana-2.1` | Nano Banana 2.1 | `gemini-nano-banana-2.1` | the 14 | 1K, 2K, 4K | minimal, medium, high (medium) | 131,072 |
| `gemini-3-pro-image` | Nano Banana Pro | `gemini-3-pro-image` | the 10 | 1K, 2K, 4K | none: it always thinks | 65,536 |
| `gemini-3.1-flash-lite-image` | Nano Banana 2 Lite | `gemini-3.1-flash-lite-image` | the 10 | 1K | minimal, high (minimal) | 65,536 |
| `gemini-3.1-flash-image` | Nano Banana 2 (deprecated) | `gemini-3.1-flash-image` | the 14 | 1K, 2K, 4K | minimal, high (minimal) | 131,072 |

- The 14 ratios are 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 5:4, 4:5, 21:9, 4:1,
  1:4, 8:1, and 1:8; the 10 are the same without 4:1, 1:4, 8:1, and 1:8 (the
  guide's tables; Lite's page names the ten).
- Nano Banana 2.1 is the model Google recommends for new projects; Pro is for
  the most demanding images (text, diagrams, product shots); Lite is the
  fastest, at 1K only, and "not optimized for multiple reference inputs".
  Each description says so.
- Every image model is of kind `image`, delivers JPEG (`outputFormat:
  jpeg`, below), answers at once, and offers the one mode `reference` with 0
  to 14 images. The prompt is required (`always`). Google states no prompt
  limit besides the input token limit, so the catalog bounds the prompt, text
  inputs included, at as many characters as the model takes input tokens
  (the Prompt column).
- `gemini-3.1-flash-image` is deprecated: Google deprecated it on 2026-10-06
  without a shutdown date and names 2.1 as its replacement. It is shown only
  to cards that already use it.
- **Left out.** `gemini-2.5-flash-image`: the guide calls it "the legacy
  pioneer" and recommends moving to Lite, and it shuts down on 2027-03-15; no
  page recommends it, and no card uses it before launch. The previews
  (`gemini-3.1-flash-image-preview` and `gemini-3-pro-image-preview`, shut
  down on 2026-06-25, and older ones) and Imagen (shut down on 2026-08-17).
  The size `512` of `gemini-3.1-flash-image`: the shared resolutions start at
  1K, and the model is deprecated.

### Inputs

- Reference images travel inline as base64, each as `{"type": "image",
  "mime_type", "data"}` with the type its bytes show (`image/png`,
  `image/jpeg`, `image/webp`; the window draws any other image to PNG), in
  the order of the plan, after the prompt.
- A mention of the n-th image is written with the shared names, `Image n`
  or `图片n`: the guide names images in words, such as "the first image" or
  "image 1", and documents no tag (`gemini-api/docs/image-generation`,
  2026-10-09). Its examples that name images put them before the text, and
  the module puts them after it; whether that matters is not documented.
- At most 14, the guide's limit for every image model. The guide also splits
  the 14 by use (objects, characters, style) per model, which the card does
  not tell apart, so only the total is checked.
- A request whose inputs as base64 would pass 100 MB is refused before
  anything is sent, as for the video model. The image understanding page
  (2026-09-23) still says that inline images limit a request to 20 MB; the
  changelog of 2026-01-08 raised the limit to 100 MB, and File input methods
  gives 100 MB, so the 100 MB check applies.
- Videos, PDFs, and audio are not offered: an image model's references are
  images.

### Parameters

| Name | Label | Kind | Values | Default | Models | Sent as |
| --- | --- | --- | --- | --- | --- | --- |
| `ratio` | Ratio | choice, ratio shapes | Adaptive (`adaptive`), then the model's ratios | Adaptive | all | `response_format.aspect_ratio`; nothing for Adaptive |
| `resolution` | Resolution | choice | 1K (`1k`), 2K (`2k`), 4K (`4k`); 1K only on Lite | 1K | all | `response_format.image_size`: `1K`, `2K`, `4K` (Google refuses a lowercase k) |
| `thinking_level` | Thinking | choice, advanced | the model's levels: Minimal, Medium, High | the model's default | 2.1, Lite, 3.1 Flash | `generation_config.thinking_level` |

- Adaptive leaves the shape to Google, which matches the reference images or
  makes a square without them; its tooltip says so.
- `thinking_level` is named as Google's field, since no other provider has
  it, and is always sent with the model's default unless the card chose
  another level.
- No `count`: one request makes one final image. The API has no number of
  images, and Google warns that the model does not always follow a number
  asked for in the prompt.
- No seed: the reference lists `generation_config.seed`, but no page shows it
  for image models (below).

### Request

`POST /interactions`, sent once and not in the background:

```json
{
  "model": "gemini-nano-banana-2.1",
  "input": [
    { "type": "text", "text": "<the prompt>" },
    { "type": "image", "mime_type": "image/png", "data": "<base64>" }
  ],
  "response_format": { "type": "image", "mime_type": "image/jpeg", "image_size": "2K", "aspect_ratio": "16:9" },
  "generation_config": { "thinking_level": "high" }
}
```

- `input` is the prompt, then the reference images in the plan's order; a
  request without images sends the prompt alone.
- `response_format.type` `image` drops the conversational text from the
  answer. `mime_type` is always `image/jpeg`: the reference names no other
  value, so the model declares JPEG and a draft has its final name before it
  generates. A file that arrives in another format still lands under its own.
- `generation_config` is sent only for a model with a thinking level.
- Not sent: `background` (no page says that an image model runs in the
  background, and one image is made within one request: the create waits up
  to ten minutes for its answer), `store` (Google's default, as for every
  request of this module), `delivery` (inline is the default), `tools`
  (Search grounding, whose search suggestions must be shown with the image,
  which a card cannot), `safety_settings`, `previous_interaction_id`,
  `system_instruction`, and `seed`.

### Answer

The answer is the interaction, holding the steps the model made:

| Status | Output |
| --- | --- |
| `completed` with an image in a `model_output` step | the last such image (the SDK's `output_image` is "the last generated image block"), its bytes written to the request's target, with the format its `mime_type` names; the bytes decide |
| `completed` without an image | refused: "Google finished the generation without an image", with the model's text or the interaction's errors when it has them |
| `failed` | refused with the interaction's errors, such as a blocked image (`image_safety`) in Google's words, or the output step's error |
| `cancelled`, `incomplete`, `requires_action`, `budget_exceeded` | refused, with the words of the video model's states; `incomplete`: "Google ended the generation before the image was finished." |
| `queued`, `in_progress` | Google did not finish the interaction within its answer: its `id` is answered as a task and followed like a video interaction, `GET /interactions/{id}`; a completed image interaction then answers its image as the task's output, written to the targets named with the task, and the statuses above that end without an image fail the task |
| any other | the outcome is unknown: the image may have been made |

- Images inside `thought` steps (the model's interim "thought images") are
  not outputs.
- An image answered as an address (`uri`) instead of base64 is answered as
  that address, a Files API resource name made the download address under
  the endpoint as for a video; the key goes only to the endpoint's origin.

### Errors

As for the video model ([Errors](#errors)): 401 and 403 are `auth`, 402
(`payment_required`, Prepay credits depleted) is `balance`, 429 is
`rateLimited`, and other 4xx are `rejected`. A create whose connection drops
after it was sent, or whose answer is a server error (408 or 5xx), has an
unknown outcome and is never sent again. A prompt or an image that Google
blocks (`image_safety`, `image_prohibited_content`, `safety`, and the other
blocked codes) comes either as an error answer, `rejected` with Google's
message, or as a failed interaction, a refused output with it. A key of a
free-tier project is answered with the paid-tier message.

### Facts not confirmed

- Whether an image model runs in the background: no page says so, and
  BaseHalf does not ask for it. The background execution guide (read
  2026-10-23) names standard Gemini models and managed agents as examples, the
  Interactions reference says only "Whether to run the model interaction in
  the background", and neither names an image model.
- Whether `response_format.mime_type` takes `image/png`: one REST example of
  the guide sends it, while the reference names `image/jpeg` only; and which
  type Google answers when none is asked for.
- Whether `generation_config.seed` applies to image models.
- How Google words its refusal of a free-tier key for these models.
- Lite's page says "14 aspect ratios" and lists ten; the catalog offers the
  ten it lists.

### Acceptance criteria

1. The catalog lists the four image models above under Google with exactly
   their ratios, resolutions, thinking levels, and prompt bounds, each of kind
   `image`, delivering JPEG, and answering at once, with 3.1 Flash Image
   deprecated and no other image model.
2. A request sends the prompt, then each reference image as base64 in the
   plan's order, to `/interactions` once and without `background`;
   `response_format` always has the type `image` and the MIME type
   `image/jpeg`, `image_size` in upper case, and `aspect_ratio` unless the
   ratio is Adaptive; `thinking_level` goes only to models that have it.
3. A completed answer writes its last image to the target; one without an
   image, a failed one, and a blocked one answer a refused output with
   Google's words; an answer still running is followed by its id until its
   image lands.
4. 401, 402, 429, a refusal that names the free tier, and a blocked prompt
   answer `auth`, `balance`, `rateLimited`, `auth` with the paid-tier
   message, and `rejected`; a create whose connection drops answers an
   unknown outcome and was sent once.
5. `check` refuses more than 14 reference images, a ratio the model does not
   take, and a request over 100 MB, and nothing is sent then.

### Verification

`vscode-base/src/vs/platform/basehalfProviders/test/node/google.test.ts` runs the image
models through the provider commands against a local server that answers
like the Interactions API. No test calls Google or uses a real key.

## Speech models

Google makes speech with its Gemini 3.8 TTS models under the same key,
endpoint, and errors (D78). A speech request is created and answered in one
call to `generateContent`: there is no task to poll or cancel, and both
models declare `answersAtOnce`.

### Sources

Google's official pages, read on 2026-10-25 in the Markdown form Google
serves for each page:

| Page | What this part takes from it |
| --- | --- |
| Text-to-speech with `generateContent` (`gemini-api/docs/generate-content/speech-generation`) | the request (`responseModalities`, `speechConfig.voiceConfig`, `responseFormat.audio`); the answer's `inlineData`; a WAV at 24 kHz, mono, 16-bit by default for a request that is not streamed, where earlier models answered raw samples; the 30 prebuilt voices and their one-word descriptions; up to two speakers |
| Text-to-speech with the Interactions API (`gemini-api/docs/speech-generation`) | the same models through `/interactions`, with `generation_config.speech_config` |
| `generateContent` reference (`api/generate-content`) | `SpeechConfig`, `VoiceConfig` (`prebuiltVoiceConfig.voiceName`, or `voice`), `ResponseFormatConfig.audio`, `PromptFeedback.blockReason`, `Candidate.finishReason` and `finishMessage`, and the `FinishReason` values: `STOP` for the natural stop, `MAX_TOKENS` and `CONTINUATION` for the output limit, the others for filters, and "If empty, the model has not stopped generating tokens" |
| Interactions API reference (`api/interactions-api`) and its OpenAPI document | the speech configuration named `structured_speech_config` |
| Interactions API overview | "While it is now considered legacy, the original `generateContent` API remains fully supported" |
| Model pages of `gemini-3.8-flash-tts` and `gemini-3.8-flash-lite-tts` | text in, audio out; 8,192 input tokens and 16,384 output tokens; 130 and 101 languages |
| Tokens (`gemini-api/docs/tokens`) | "a token is equivalent to about 4 characters", and a token can be a single character |
| Deprecations and changelog | both released on 2026-09-22, without a shutdown date; the earlier TTS previews shut down on 2026-11-17 |
| Pricing | read only for the tiers: both models are offered on the free tier |
| Troubleshooting | a project that is not eligible for the free tier must be upgraded to the paid tier |

### Models

| Catalog id | Label | Sent as (`global`) | Prompt |
| --- | --- | --- | --- |
| `gemini-3.8-flash-tts` | Gemini 3.8 Flash TTS | `gemini-3.8-flash-tts` | 8,192 |
| `gemini-3.8-flash-lite-tts` | Gemini 3.8 Flash-Lite TTS | `gemini-3.8-flash-lite-tts` | 8,192 |

- Each is of kind `audio`, makes `speech`, answers at once, and delivers
  WAV (`outputFormat: wav`): Google's speech is uncompressed samples, which
  come as a WAV, and samples that come raw are written as one
  ([Answer](#answer-1)).
- One mode, Speech (`reference`), without inputs: "TTS models accept
  text-only inputs".
- The prompt is the verbatim transcript, required, and bounded at 8,192
  characters: the models take 8,192 input tokens, a token is about four
  characters and can be one, so as many characters as tokens keeps a usual
  text within the limit, as for the image models. Google states no other
  limit.
- Gemini 3.8 Flash TTS is the flagship ("maximum acoustic fidelity, nuanced
  acting, and expressive control", 130 languages); Flash-Lite is the fast
  one for everyday speech (101 languages). Each description says so.
- Tags such as `<laugh>`, `<sigh>`, and `<short pause>` are the text's, and
  are sent as written.
- **Left out.** `gemini-3.1-flash-tts-preview`,
  `gemini-2.5-flash-preview-tts`, and `gemini-2.5-pro-preview-tts`, which
  shut down on 2026-11-17 with the 3.8 models as their replacements.

### Voices

- The voice (`voice`, of kind `voice`, not listed) is one of the 30
  prebuilt voices, which the catalog declares with Google's one-word
  descriptions, in the order of the guide's table: Zephyr (Bright), Puck
  (Upbeat), Charon (Informative), Kore (Firm), Fenrir (Excitable), Leda
  (Youthful), Orus (Firm), Aoede (Breezy), Callirrhoe (Easy-going), Autonoe
  (Bright), Enceladus (Breathy), Iapetus (Clear), Umbriel (Easy-going),
  Algieba (Smooth), Despina (Smooth), Erinome (Clear), Algenib (Gravelly),
  Rasalgethi (Informative), Laomedeia (Upbeat), Achernar (Soft), Alnilam
  (Firm), Schedar (Even), Gacrux (Mature), Pulcherrima (Forward), Achird
  (Friendly), Zubenelgenubi (Casual), Vindemiatrix (Gentle), Sadachbia
  (Lively), Sadaltager (Knowledgeable), and Sulafat (Warm). Kore, which the
  guide's examples speak in, is the default.
- The voice is not listed, so a card chooses among these 30, and `voices`
  is refused for these models. **Open:** Google does list voices,
  `GET /v1beta/voices`: an Extended Voice Library of hundreds of prebuilt
  voices, then the project's own designed and replicated voices
  (`voice_…`), in pages of up to 1,000. They are not offered in this phase
  ([providers](../providers.md#providers): "no: 30 voices in the catalog").
  Offering them would make the voice listed, with a `listVoices` that reads
  those pages; samples come only with a single designed voice, not in the
  list.

### Request

`POST /models/{model}:generateContent`, sent once:

```json
{
  "contents": [{ "role": "user", "parts": [{ "text": "<the prompt>" }] }],
  "generationConfig": {
    "responseModalities": ["AUDIO"],
    "responseFormat": { "audio": { "mimeType": "AUDIO_WAV" } },
    "speechConfig": { "voiceConfig": { "prebuiltVoiceConfig": { "voiceName": "Kore" } } }
  }
}
```

- `generateContent`, not the Interactions API of the module's other models:
  Google documents both for these models and calls `generateContent`
  legacy but fully supported, and its reference and guide agree on every
  field this request sends, while the Interactions reference names the
  speech configuration `structured_speech_config` where its guide sends
  `speech_config`.
- `AUDIO_WAV` asks for the default of a request that is not streamed: a
  WAV, 24 kHz, mono, 16-bit. No sample rate is sent: 24,000 Hz is the
  default and the highest the guide names.
- `prebuiltVoiceConfig.voiceName` names a prebuilt voice, as the guide's
  requests for two speakers do; `voiceConfig.voice`, which also takes
  designed and replicated voices, is not needed for these.
- Not sent: `speech_metadata` (a style or a speaker for a turn),
  `multiSpeakerVoiceConfig` (dialogue is later, D78), `languageCode` ("The
  TTS models detect the input language automatically"), and
  `systemInstruction`.

### Answer

| Answer | Output |
| --- | --- |
| a part of the first candidate with `inlineData`, and the finish reason `STOP` or none | its bytes, decoded from base64 and written to the request's target: a WAV as it is; raw samples (`audio/L16` or `audio/pcm`, at the type's `rate=`, 24,000 Hz without one, mono, 16-bit little-endian, as Google describes its raw samples) written as a WAV first (`pcmToWav`); the bytes decide the format |
| speech whose candidate stopped at the output limit, `MAX_TOKENS`, or `CONTINUATION` | refused: "Google cut the speech off at its output limit, before the end of the text (MAX_TOKENS). A shorter text helps." |
| speech whose candidate ended for any other reason, such as `SAFETY` or `OTHER` | refused: "Google ended the speech before it was finished (OTHER).", with the candidate's `finishMessage` when it has one |
| `promptFeedback.blockReason` and no speech | refused: "Google blocked the text (SAFETY)." with Google's reason |
| a candidate without speech | refused: "Google finished the generation without the speech (SAFETY).", with the candidate's `finishMessage` or text when it has them |
| no candidate | refused: "Google finished the generation without the speech." |

- The last part with `inlineData` is the speech.
- Speech lands only when its candidate finished at its natural stop
  (`STOP`): the reference names `MAX_TOKENS` for "the maximum number of
  tokens … was reached" and `CONTINUATION` for a response that "reached the
  per-request token limit, but generation is not yet complete", and the
  others for a candidate stopped by a filter or for no stated reason.
  Speech cut off there does not say the whole text, and the models answer
  at most 16,384 output tokens, which a long text can reach within the
  8,192 characters the prompt takes. It is refused as an output, as a song
  that Lyria did not finish is ([Music models, Answer](#answer-2)): the card
  says why and keeps its draft.
- A candidate without a finish reason, and one with
  `FINISH_REASON_UNSPECIFIED`, which the reference calls a default that is
  not used, lands. The reference says an empty finish reason means that the
  model has not stopped, which describes a stream that goes on; the answer
  of a request that is not streamed is whole when it comes.
- A speech model has no task: `poll` refuses it, and `cancel` answers false
  and sends nothing.

### Errors

As for the other models ([Errors](#errors)), except for a key of a free-tier
project: both speech models are offered on the free tier (Pricing), so a
refusal that names the free tier does not mean that the model needs a paid
tier.

- With HTTP 429, the project's free quota of the model is used up, and the
  answer is `rateLimited`: "Google's free tier lets the project of this API
  key use this model only so much, and that is used up for now. Wait and
  try again, or set up billing for the project in Google AI Studio for
  higher limits."
- With another status, such as a project that is not eligible for the free
  tier, or a country where the free tier is not available, the answer is
  `auth`: "Google's free tier is not available to the project of this API
  key. Set up billing for the project in Google AI Studio, or use the key of
  a project that has it."

### Facts not confirmed

- The `inlineData.mimeType` of a 3.8 model's WAV (the guide shows none);
  the module reads the bytes.
- That `responseFormat` with `AUDIO_WAV` is taken with `responseModalities`
  (the guide's example of a format sets `AUDIO_L16`).
- How Google words the refusal of a free-tier quota for these models.
- How `generateContent` answers a key that is not valid: the pages name
  invalid keys among the errors of 400, 402, and 403 without saying which.
  The status decides, as for the other models: 401 and 403 are `auth`, and
  a 400 is `rejected` with Google's words.

### Acceptance criteria

1. The catalog lists Gemini 3.8 Flash TTS and Gemini 3.8 Flash-Lite TTS
   under Audio, each making speech in WAV at once from a prompt of at most
   8,192 characters, in one of the 30 prebuilt voices, Kore by default.
2. A request sends the prompt as the one text part to `generateContent`
   once, with the audio modality, WAV, and the prebuilt voice.
3. A WAV answered lands as it is, and raw samples land as a WAV of their
   rate; a blocked text, an answer without the speech, and one without a
   candidate are refused outputs with Google's reason.
3a. Speech whose candidate stopped at the output limit (`MAX_TOKENS`,
   `CONTINUATION`) is a refused output that says the speech was cut off and
   that a shorter text helps; speech that ended for another reason than
   `STOP` is a refused output with Google's reason; nothing of either is
   written. Speech without a finish reason lands.
4. A voice other than the 30 is refused by `check`, and `voices` is
   refused; nothing is sent then.
5. A used-up free quota answers `rateLimited` and a project without a free
   tier `auth`, each with its message; a project denied access, too many
   requests, a server error, and a dropped connection map as for the other
   models, and the request is sent once.

### Verification

`google.test.ts` also runs the speech models against a local server that
answers like `generateContent`: the catalog entries, the body of each
model, a WAV and raw samples answered, a blocked text and an answer without
the speech, speech cut off at the output limit or ended before its natural
stop, the voices `check` takes, the free tier, the errors, and that a
speech model has no task.

## Music models

Google makes music with Lyria through the same Interactions API, endpoint,
key, and errors as its video and image models (D78). A music interaction is
created and answered in one call, as an image interaction is: BaseHalf
sends the request once and receives the song inside the answer, so both
music models declare `answersAtOnce`.

### Sources

Google's official pages, read on 2026-10-25 in the Markdown form Google
serves for each page:

| Page | What this part takes from it |
| --- | --- |
| Generate music with Lyria 3.5 (`gemini-api/docs/music-generation`) | the two models and their lengths; the Interactions API; text and up to 10 images inline; MP3 by default; the steps of the answer, with audio blocks and text blocks of lyrics or structure; custom lyrics with section tags; instrumental tracks asked for in the prompt; the limitations |
| Lyria prompt guide (`gemini-api/docs/lyria-prompt-guide`) | "Include your lyrics directly in the prompt beneath a `Lyrics:` header", for Lyria 3.5 |
| Model pages of `lyria-3.5` and `lyria-3-clip-preview` | text and images in, MP3 and text out; 131,072 input tokens |
| Background execution | names standard Gemini models and managed agents, not Lyria |
| Deprecations and changelog | `lyria-3.5` stable since 2026-09-03, `lyria-3-clip-preview` a preview since 2026-03-25, neither with a shutdown date; `lyria-3.5` replaces `lyria-3-pro-preview` |
| Pricing | read only for the tiers: neither model is offered on the free tier |
| Interactions API reference and its OpenAPI document | audio content (`data`, `uri`, `mime_type`) |

### Models

| Catalog id | Label | Sent as (`global`) | Modes | Length |
| --- | --- | --- | --- | --- |
| `lyria-3.5` | Lyria 3.5 | `lyria-3.5` | From a Description, From Lyrics | "a couple of minutes", set by the prompt |
| `lyria-3-clip-preview` | Lyria 3 Clip | `lyria-3-clip-preview` | From a Description | 30 seconds |

- Each is of kind `audio`, makes `music`, answers at once, and delivers MP3
  ("By default, the Lyria 3.5 models generate audio in MP3 format"; both
  model pages name MP3). One song a request: no `count`.
- The prompt is required when no image is sent (`withoutMedia`): the models
  make music "from text prompts or from images". It is bounded at 131,072
  characters, as many as the models take input tokens, as for the image
  models.
- No Duration: Lyria 3 Clip "always generates a 30-second clip", and the
  length of a Lyria 3.5 song follows the prompt ("create a 2-minute song",
  or timestamps).
- **Left out.** `lyria-3-pro-preview`, which `lyria-3.5` replaces;
  `lyria-realtime-exp`, a stream without an end (D78); and
  `lyria-3.5-clip-preview` and `lyria-3.5-pro-preview`, which have model
  pages that neither the guide, the pricing page, nor the deprecations
  name.

### Modes and inputs

- **From a Description** (`reference`): the prompt describes the music, and
  0 to 10 images are references: "the model will compose music inspired by
  the visual content".
- **From Lyrics** (`lyrics`), Lyria 3.5 only: the prompt is the lyrics,
  which the prompt guide puts "directly in the prompt beneath a `Lyrics:`
  header", with section tags such as `[Verse]` and `[Chorus]`; Style is the
  music's direction before them. Images are references as in From a
  Description. Lyria 3 Clip has no From Lyrics: Google documents lyrics of
  one's own for Lyria 3.5 only ("Lyria 3.5 generates vocal tracks with
  lyrics by default. You can provide your own lyrics").
- Images travel inline as base64, each `{"type": "image", "mime_type",
  "data"}` with the type its bytes show, after the text, in the plan's
  order; PNG, JPEG, and WebP (the window draws any other image to PNG). A
  request whose inputs as base64 would pass 100 MB is refused, as for the
  other models.
- The guide states "up to 10 images" in its part on Lyria 3.5; the catalog
  takes the same number for Lyria 3 Clip.

### Parameters

| Name | Label | Kind | Default | Models | Modes | Sent as |
| --- | --- | --- | --- | --- | --- | --- |
| `instrumental` | Instrumental | boolean | off | both | From a Description | "Instrumental only, no vocals." after the prompt and a blank line |
| `style` | Style | text, optional, at most 1,000 characters | none | Lyria 3.5 | From Lyrics | before the lyrics, a blank line between |

- Both are shared names ([providers](../providers.md#parameters)). Google
  has no fields for them: its guide asks for an instrumental in the
  prompt's words ("Instrumental only, no vocals."), and puts the musical
  direction apart from the lyrics ("Separate lyrics from instructions").
- No seed, negative prompt, or count: the guide documents none for Lyria.

### Request

`POST /interactions`, sent once and not in the background:

```json
{
  "model": "lyria-3.5",
  "input": [
    { "type": "text", "text": "Slow folk, a woman sings over a fingerpicked guitar.\n\nLyrics:\n\n[Verse]\nTide comes in, tide goes out" },
    { "type": "image", "mime_type": "image/png", "data": "<base64>" }
  ]
}
```

- `input` is the text, then the images, as the guide's example with an
  image lists them; without a text (an image alone) there is no text part.
- From a Description sends the prompt; with Instrumental on, "Instrumental
  only, no vocals." follows after a blank line, or stands alone without a
  prompt.
- From Lyrics sends the Style, a blank line, `Lyrics:`, a blank line, and
  the lyrics; without a Style, it starts at `Lyrics:`. `check` counts and
  answers the lyrics as the prompt, and the module writes this form when it
  sends them ([providers](../providers.md#acceptance-criteria), criterion
  18).
- Not sent: `background` (no page says that Lyria runs in the background,
  and a song is made within one request: the create waits up to ten
  minutes for it), `response_format` (MP3 is the default, and the guide's
  requests send none), `store` (Google's default), and `delivery` (inline is
  the default).

### Answer

As for an image model (the answer of [Image models](#image-models)), with
the song in place of the image:

| Status | Output |
| --- | --- |
| `completed` with audio in a `model_output` step | the last audio block (the SDK's `output_audio` is "the last generated audio block"), its bytes written to the request's target, with the format its `mime_type` names (`audio/mp3`, `audio/mpeg`, `audio/wav`); the bytes decide |
| `completed` without audio | refused: "Google finished the generation without a song", with the model's text or the interaction's errors when it has them |
| `failed` | refused with the interaction's errors, or the output step's error |
| `cancelled`, `requires_action`, `budget_exceeded` | refused, with the words of the video model's states |
| `incomplete` | refused: "Google ended the generation before the song was finished." |
| `queued`, `in_progress` | Google did not finish the interaction within its answer: its `id` is followed as a task, and the song of the completed interaction lands on the targets named with the task |
| any other | the outcome is unknown: the song may have been made |

- Text blocks, the lyrics or a JSON description of the song's structure,
  are not outputs.
- A song answered as an address (`uri`) instead of base64 is answered as
  that address, as an image's is.

### Errors

As for the video and image models ([Errors](#errors)): neither music model
is offered on the free tier (Pricing), so a refusal that names the free
tier is answered with the paid-tier message.

### Facts not confirmed

- Whether Lyria runs in the background; BaseHalf does not ask for it.
- How long a full song takes to make; one request of at most ten minutes
  is assumed.
- Up to 10 images for Lyria 3 Clip, and whether it sings lyrics of one's
  own.
- That an image alone, without a text, makes music: the pages say that the
  models make music from images, and no example shows one without text.
- The `mime_type` of Lyria's audio blocks (the guide shows none); the bytes
  decide.

### Acceptance criteria

1. The catalog lists Lyria 3.5, with From a Description and From Lyrics,
   and Lyria 3 Clip, with From a Description, under Audio, each making
   music in MP3 at once from a prompt or 0 to 10 images.
2. A request sends the text, then the images inline, once and without
   `background`; Instrumental adds Google's words, and From Lyrics sends
   the Style and the lyrics beneath `Lyrics:`.
3. A completed answer writes its last audio block to the target; one
   without a song, a failed one, and an unfinished one are refused outputs
   with Google's words; an answer still running is followed by its id until
   its song lands.
4. A key of a free-tier project answers `auth` with the paid-tier message.

### Verification

`google.test.ts` also runs the music models against a local server that
answers like the Interactions API: the catalog entries, the body of each
model and mode, the songs answered, followed, and refused, the free tier,
and the rules of `check`.
