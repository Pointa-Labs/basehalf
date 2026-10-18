# Google (Gemini API)

Status: implemented (D59). Part of
[video providers and the model catalog](../video-providers.md), which defines
the catalog, the requests, and the rules every provider follows.

Implemented in `extensions/basehalf-ai-video/src/providers/google.ts`.
The facts below follow Google's official pages, read on 2026-10-19 (those
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
([Video node, A generation](../video-node.md#a-generation)). The Gemini API
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
rolling 10 minutes ($10 to $200 by usage tier); exceeding either answers HTTP
429 (`rate_limit_exceeded`, `quota_exceeded`, `too_many_requests`, or, for the
spend limits, `RESOURCE_EXHAUSTED`).

| Region | Label | Base URL | Currency | Console |
| --- | --- | --- | --- | --- |
| `global` | Gemini API | `https://generativelanguage.googleapis.com/v1beta` | USD | `https://aistudio.google.com/api-keys` |

The pricing page lists Gemini Omni Flash for the paid tier only ("Not
available" on the free tier); a key of a free-tier project is refused by
Google with its own message.

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
| `aspect_ratio` | Ratio | choice, drawn as ratio shapes | 16:9, 9:16 | 16:9 | `response_format.aspect_ratio` | Frames, References |
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
- An image is sent as `{"type": "image", "mime_type", "data"}` with the type
  its header shows (`image/png`, `image/jpeg`, `image/webp`, `image/gif`); a
  video as `{"type": "video", "mime_type", "data"}` with `video/mp4` or
  `video/mov` (the reference's names).
- `seed` is sent only when set; `aspect_ratio` only in Frames and References.
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
| `requires_action` | failed: the interaction waits for an action AI Video cannot take |
| `budget_exceeded` | failed |

Any other status is an answer AI Video cannot read. Google reports no
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
[Requests](../video-providers.md#requests): `authentication` (401) and
`permission_denied` (403) are `auth`, `payment_required` (402, Prepay
credits depleted) is `balance`, `rate_limit_exceeded`, `quota_exceeded`, and
`too_many_requests` (429) are `rateLimited`, `invalid_request` and
`failed_precondition` (400, for example billing that is not enabled) are
`rejected`, and `model_not_found` (404) refuses a create. Blocked generations
(codes such as `safety`, `prohibited_content`, `content_blocked`) come as a
refused create or a failed interaction with Google's message.

## Estimate

Google bills the output video's tokens: "calculated at a rate of 5,792 tokens
per second of 720p video", at $17.50 per million video output tokens on the
paid tier's Standard pricing (Gemini Developer API pricing, last updated
2026-10-16), "an effective price of approximately $0.10 per second". One
second of 720p costs 5,792 × $17.50 / 1,000,000 = $0.10136.

- Only 720p has a published rate. At 360p, 1080p, and 4K the panel shows no
  estimate.
- Frames, References, and Edit: the length is known only after the run, so
  the estimate is 3 to 10 seconds: $0.30408 to $1.0136.
- Extend: the extended video contains the clip (the guide extends "by 10s, up
  to a total length of 40s", and edits the clip's last frames to join the
  two), so the estimate is the clip's length plus 3 to 10 seconds. With the
  clip's file, its length is measured (a 4-second clip: 7 to 14 seconds,
  $0.70952 to $1.41904); without it, a clip of at most 10 seconds gives 3 to
  20 seconds, $0.30408 to $2.0272.
- Input tokens ($1.50 per million) and thinking tokens ($9.00 per million)
  cannot be counted before the run and are not included; Google's bill
  counts.

## Facts not confirmed

- That Gemini Omni Flash runs in the background is implied by the Omni guide
  and not stated by the background execution page (above).
- Whether a poll answers the inputs' base64 again inside its `user_input`
  step.
- The highest number of reference images: Google states none.
- How long an edited video is, and whether an extension is billed for the
  clip's seconds: the estimates take the ranges above.
- Whether the reference's `response_format.duration` applies to Omni.
