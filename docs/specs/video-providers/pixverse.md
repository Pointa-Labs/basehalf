# PixVerse

Status: Active (2026-10-19)
Decision: [D59](../../decisions.md#d59--video-providers-are-built-in-integrations-with-each-models-exact-settings-users-bring-their-own-keys-new-2026-10-19)
Parent: [Video providers and the model catalog](../video-providers.md)

This specification owns the PixVerse module of AI Video
(`vscode-base/extensions/basehalf-ai-video/src/providers/pixverse.ts`): the
catalog entry it declares, the uploads and requests it sends, how it reads
PixVerse's answers, and how it estimates a price. What is the same for every
provider (the commands, checks from the declarations, retries, the download,
plain messages) is owned by the parent specification and is not repeated here.

## Sources

PixVerse's API documentation, `https://docs.platform.pixverse.ai/`, each page
in the Markdown form its index (`llms.txt`) lists. The pages carry no date of
their own, except the changelog's entries. Every page below was read on
2026-10-18 and read again, unchanged, on 2026-10-19.

| Page | What this specification takes from it |
| --- | --- |
| Start Here (`start-here-2394989m0`) | the one production base URL; the key in `API-KEY`; a new UUID v4 in `Ai-trace-id` with every request; answers `{ErrCode, ErrMsg, Resp}`, whose `ErrCode` is independent of the HTTP status |
| Quick Start (`quick-start-2394985m0`) | the console; `Ai-trace-id` is "a tracing identifier, not an idempotency key. Reusing it may create another task"; uploads come before the create; the task states |
| Model Capability Map (`model-capability-map-2394982m0`) | the core models C1, V6, V5.6, and V5 with their inputs, durations, resolutions, ratios, and capabilities |
| Text-to-Video (`text-to-video-13016634e0`) | `POST /openapi/v2/video/text/generate`, its models and fields; the prompt of at most 5,000 characters |
| Image-to-Video and Video Templates (`image-to-video-and-video-templates-13016633e0`) | `POST /openapi/v2/video/img/generate`, its fields; the prompt of at most 2,048 characters |
| First and Last Frame Video (`first-and-last-frame-video-43051213e0`) | `POST /openapi/v2/video/transition/generate`, its models (C1, V6, V5.6, V5) and fields |
| Reference-to-Video (Fusion) (`reference-to-video-fusion-43051214e0`) | `POST /openapi/v2/video/fusion/generate`: image and video references, the Omni mode, its limits |
| Video Extend (`video-extend-43051216e0`) | `POST /openapi/v2/video/extend/generate`, V6 only; the source's limits |
| Upload Image (`upload-image-13016631e0`) | `POST /openapi/v2/image/upload`: JPEG, PNG, and WebP, smaller than 20 MB, neither side over 10,000 px; `Resp.img_id` |
| Upload Media (Video and Audio) (`upload-media-video-and-audio-43051206e0`) | `POST /openapi/v2/media/upload`: MP4, MOV, and WebM videos; `Resp.media_id` |
| Query Task Status (`query-task-status-43051212e0` and the guide `query-task-status-2394991m0`) | `GET /openapi/v2/video/result/{video_id}`; the states 1, 5, 7, and 8; `Resp.url` |
| Error Codes (`error-codes-2394992m0`), Concurrency Rules (`concurrency-rules-2394990m0`) | every `ErrCode`, the HTTP status it comes with, and what to do about it |
| FAQ (`faq-2394993m0`), Billing and Usage (`billing-and-usage-2394984m0`) | uploads belong to one account and region; credits; refunds of failed tasks |
| PixVerse API Pricing (`pixverse-api-pricing-2394995m0`) | credits per second or per request; "225 Credits = USD 1" |
| Changelog (`changelog-2394996m0`) | release dates; V6 references from 2026-05-21, with `type` and `ref_name` optional |

## Regions and credentials

| Region | Label | Base URL | Currency | Console |
| --- | --- | --- | --- | --- |
| `global` | Global | `https://app-api.pixverse.ai` | USD | `https://platform.pixverse.ai` |

- One region. Start Here names one production base URL, and every page
  answers a refused key with "Use a key from the global environment." The web
  code of PixVerse's platform also names a China host, which no page of the
  documentation describes and whose prices and currency are not published;
  it is not a region of the catalog.
- One credential, `apiKey` (**API Key**), sent as `API-KEY: <key>`. It is made
  in the PixVerse API Platform. Uploads and ids belong to the account and
  region that made them (FAQ).
- Every request also carries `Ai-trace-id`, a new UUID v4 made for that
  request, and again for each retry of a poll or an upload; no trace id is
  sent twice. A repeated trace id does not keep PixVerse from making a second
  task, and a create is never sent twice anyway.
- Every path is under `/openapi/v2`. The endpoint is used with or without it:
  the module adds `/openapi/v2` before every path unless the endpoint already
  ends with it.

## Models

One catalog model per PixVerse model of the capability map. PixVerse takes the
same `model` value at every endpoint; the mode and the inputs of a generation
choose the endpoint, so `check` answers no `providerModel`.

| Catalog id | Label | Sent as `model` | Modes | Released |
| --- | --- | --- | --- | --- |
| `pixverse-c1` | PixVerse C1 | `c1` | Frames | 2026-04-07 |
| `pixverse-v6` | PixVerse V6 | `v6` | Frames, References, Extend | 2026-03-31 |
| `pixverse-v5.6` | PixVerse V5.6 | `v5.6` | Frames | 2026-01-26 |
| `pixverse-v5` | PixVerse V5 | `v5` | Frames | 2025-08-29 |

| Mode and inputs | Endpoint (under `/openapi/v2`) |
| --- | --- |
| Frames without a start frame | Text-to-Video, `/video/text/generate` |
| Frames with a start frame and no end frame | Image-to-Video, `/video/img/generate` |
| Frames with a start and an end frame | First and Last Frame Video, `/video/transition/generate` |
| References | Reference-to-Video (Fusion), `/video/fusion/generate` |
| Extend | Video Extend, `/video/extend/generate` |

- Every model has an estimate and none is deprecated.
- The prompt is required (`always`): every create page lists `prompt` among
  the required fields. It is at most 5,000 characters, and at most 2,048 with
  a start frame and no end frame (Image-to-Video), which `check` reports.

## Modes and inputs

| Mode | Models | Start frame | End frame | Reference images | Reference videos | Source |
| --- | --- | --- | --- | --- | --- | --- |
| Frames (`frames`) | all | optional | optional | none | none | none |
| References (`reference`) | V6 | none | none | 0 to 10 | 0 to 2 | none |
| Extend (`extend`) | V6 | none | none | none | none | required |

- Frames without an image is text to video; an end frame needs a start frame.
- Images go as JPEG, PNG, or WebP, the three formats Upload Image takes, so
  no mode declares `imageFormats`. Their limits, in Frames and References:
  neither side over 10,000 px (`imageMaxSide: 10000`) and smaller than 20 MB,
  read as 20 MiB (`imageMaxBytes: 20971520`).
- References need at least one image or video. Without a reference video they
  take at most 7 images; with one (PixVerse's Omni mode) at most 10. At most 2
  videos, together at most 15 seconds (`videoTotalSeconds: 15`).
- Extend continues one source video of at most 30 seconds
  (`videoTotalSeconds: 30`) and 50 MB (`videoMaxBytes: 52428800`); the source
  and the seconds added are together at most 40 seconds.
- Videos go as MP4 or MOV, whose length AI Video reads. Upload Media also
  takes WebM, whose length AI Video cannot read; such a video is refused.
- No mode takes audio: no endpoint here takes any.

## Parameters

| Name | Label | Kind | Values | Default | Models (modes) | Sent as |
| --- | --- | --- | --- | --- | --- | --- |
| `resolution` | Resolution | choice | `360p`, `540p`, `720p`, `1080p`, labeled as written | `720p` | all | `quality`, as written |
| `ratio` | Ratio | choice, ratio shapes | C1, V6: `16:9`, `9:16`, `4:3`, `3:4`, `1:1`, `2:3`, `3:2`, `21:9`; V5.6, V5: `16:9`, `9:16`, `4:3`, `3:4`, `1:1` | `16:9` | all (V6: Frames, References) | `aspect_ratio`, by Text-to-Video and Fusion only; set by the start frame (`setByStartFrame`) |
| `duration` | Duration | integer, seconds | C1, V6: 1–15, step 1; V5.6: 5–10, step 1, of which 5, 8, and 10 are made; V5: 5 or 8 (step 3) | 5 | all | `duration`; 0 with reference videos |
| `sound` | Sound | boolean | | off | C1, V6 (Frames, References), V5.6 | `generate_audio_switch` |
| `generate_multi_clip_switch` | Multi-clip | boolean | | off | V6 (Frames) | `generate_multi_clip_switch`, by Text-to-Video and Image-to-Video |
| `seed` | Seed | integer 0–2147483647, optional, More | | none | all | `seed`, only when set |

- The defaults are PixVerse's own where it has one: sound and multi-clip are
  off. Every request names a resolution, a duration, and (for text to video
  and references) a ratio, which have no default at PixVerse; the defaults
  are those of PixVerse's examples, 720p, 16:9, and 5 seconds.
- A video made from a start frame takes the frame's shape; the ratio's
  tooltip says so. Image-to-Video, First and Last Frame Video, and Video
  Extend take no ratio.
- With reference videos, Fusion takes `duration: 0`, and the video is as long
  as the longest reference video. In Extend, the duration is the seconds
  added. V6's duration tooltip says both.
- V5 makes no sound: the pages give `generate_audio_switch` to V5.5, V5.6, V6,
  and C1 only, and V5's price has no sound. Video Extend takes no sound
  setting.
- Multi-clip: Text-to-Video and Image-to-Video give it to V5.5 and V6 only;
  First and Last Frame Video and Fusion do not take it.

### Rules between parameters and inputs

`check` reports these after the checks of the declarations, in this order:

| Model | Rule | Source |
| --- | --- | --- |
| V5.6 | the duration is 5, 8, or 10 seconds | every create page |
| V5.6 | at 1080p, the duration is 5 or 8 seconds | price list ("Not supported"), capability map |
| all | with a start frame and no end frame, the prompt is at most 2,048 characters | Image-to-Video |
| V6 | Multi-clip only without an end frame | First and Last Frame Video |
| V6 | References need a reference image or video | Fusion |
| V6 | without a reference video, at most 7 reference images | Fusion |
| V6 | in Extend, the source video and the seconds added together at most 40 seconds, when the source's length is measured | Video Extend |

With files, `check` also refuses a reference video too large for AI Video to
upload in one request: the 128 MiB a request carries, less 64 KiB for the form
around the file.

## Requests

### Uploads

Every input is read first, then uploaded before the create, in the order of
the request (frames, images, videos, the source):

- An image: `POST /openapi/v2/image/upload`, a multipart form with the file in
  `image`, named by its slot and format (`start-frame.png`, `end-frame.jpg`,
  `reference-image-2.webp`) and typed by its bytes. `Resp.img_id` is its id.
- A video: `POST /openapi/v2/media/upload` with the file in `file`
  (`reference-video-1.mp4`, `source-video.mov`). `Resp.media_id` is its id.
- An upload answers `{ErrCode, ErrMsg, Resp}` like every call; a nonzero code
  is read as in [Errors](#errors). Uploads are retried as every upload is,
  each attempt with its own trace id. A failed upload ends the submit before
  the create, so it made no task. The `image_url` and `file_url` forms,
  which take public addresses, are not used.
- Ids are 64-bit integers. The module reads their digits from the answer's
  text when a JSON number would round them, and writes them into the create's
  JSON as numbers with every digit.

### Creating the task

One `POST` with `Content-Type: application/json`, sent once. Every body has
`model`, `prompt` as written, `duration`, and `quality`; `seed` only when set;
`generate_audio_switch` (`true` or `false`) on models with the Sound setting,
except in Extend; and `generate_multi_clip_switch` on V6 in Text-to-Video and
Image-to-Video. Then:

| Endpoint | Fields |
| --- | --- |
| Text-to-Video | `aspect_ratio` |
| Image-to-Video | `img_id` (the start frame) |
| First and Last Frame Video | `first_frame_img`, `last_frame_img` |
| Fusion | `aspect_ratio`; `image_references`, one `{img_id}` per image in order, when there are images; with reference videos also `video_references`, one `{video_media_id}` per video in order, `reference_mode: "omni"`, and `duration: 0` |
| Video Extend | `video_media_id` (the source) |

```json
{ "model": "v6", "prompt": "<prompt>", "duration": 5, "quality": "720p", "aspect_ratio": "16:9", "generate_audio_switch": false, "generate_multi_clip_switch": false }
```

- `webhook_id`, `template_id`, `img_ids`, `source_video_id`, `ref_name`, and
  `type` are never sent.
- The answer is `{ErrCode: 0, ErrMsg, Resp: {video_id, credits}}`; the task id
  is `video_id`, as its digits. A 2xx answer with another `ErrCode` is read as
  in [Errors](#errors): a refusal made no task; a server code, a code the
  documentation does not list, or an answer without a `video_id` leave the
  outcome unknown.

### Asking about a task

`GET /openapi/v2/video/result/{video_id}`.

| `Resp.status` | Answer |
| --- | --- |
| `5` (generating) | `running`; PixVerse reports no progress and no queue |
| `1` (completed) with `Resp.url` | `succeeded` with that address |
| `1` without an address | `running`: the pages count a task complete only "when `status=1` and `Resp.url` is accessible" |
| `7` (content moderation failed) | `failed`, saying that PixVerse's moderation refused the content |
| `8` (generation failed) | `failed` |
| any other | the answer cannot be read |

- A nonzero `ErrCode` is read as in [Errors](#errors).
- The video's address is on PixVerse's media host; the download sends it no
  key. The documentation states no retention for it; BaseHalf downloads at
  once.
- Where the video is (`videoLocation`), when a download has no address: the
  task is asked about again.
- PixVerse may refund a failed or moderated task to the account; BaseHalf does
  not read the ledger.
- **Cancel**: PixVerse documents no cancellation. `cancel` sends nothing and
  answers false.

### Errors

PixVerse answers an error as `{ErrCode, ErrMsg}`, mostly with HTTP 200: a
missing or unregistered key, too few credits, and the rate and concurrency
limits all come with 200. The module reads `ErrCode` in every answer; its
message is a sentence of what happened and what to do, with the code and
PixVerse's words.

| `ErrCode` | Meaning | Answer |
| --- | --- | --- |
| 10004, 10005, 400012 | no API key; a key that is not registered; an invalid account | `auth` |
| 500090 | too few credits | `balance` |
| 712008 | the rate limit of the account or address | `rateLimited` |
| 500044 | the concurrency limit | `rateLimited` |
| 400011, 400013, 400017, 400018, 400019, 400032 | a missing or invalid parameter, a prompt too long, an invalid image id | `rejected` |
| 500020 | permission denied: the account may not use the model or capability | `rejected` |
| 500030, 500031, 500032, 500033, 500041, 500042 | an image's size, information, format, dimensions, upload, or path | `rejected` |
| 500054, 500063 | content moderation, pre-moderation | `rejected` |
| 500060, 500070, 500071 | the monthly effect limit, a template not activated, a resolution the capability does not make | `rejected` |
| 500008, 500064 | data not found; content deleted or unavailable | `notFound` when asking about a task, `rejected` otherwise |
| 500069, 500100, 99999 | high load, an internal database error, an unknown error | `unknownOutcome` for a create, `network` otherwise |
| any other | | `unknownOutcome` for a create, an unreadable answer when asking about a task, `rejected` for an upload |

An answer that is not 2xx is read by its status as the parent specification
says; its `ErrCode` refines a 4xx status (a 5xx status leaves a create's
outcome unknown whatever its code). The concurrency limit counts per account
and plan; the console shows it.

## Estimate

```text
C1, V6:    amount = credits per second (model, resolution, sound) × seconds ÷ 225
V5.6, V5:  amount = credits per request (duration, resolution, sound) ÷ 225
```

PixVerse prices in credits, "225 Credits = USD 1". The price list states no
date of its own; it was read on 2026-10-19, the estimate's `priceDate`. The
amount is the credits divided by 225, not rounded; the list's dollar figures
are the same amounts rounded to three decimals.

Credits per second of video:

| Model | Sound | 360p | 540p | 720p | 1080p |
| --- | --- | --- | --- | --- | --- |
| C1 | off | 6 | 8 | 10 | 19 |
| C1 | on | 8 | 10 | 13 | 24 |
| V6 | off | 5 | 7 | 9 | 18 |
| V6 | on | 7 | 9 | 12 | 23 |

Credits per request:

| Model | Duration | Sound | 360p | 540p | 720p | 1080p |
| --- | --- | --- | --- | --- | --- | --- |
| V5.6 | 5 s | off | 35 | 35 | 45 | 75 |
| V5.6 | 5 s | on | 80 | 80 | 90 | 120 |
| V5.6 | 8 s | off | 70 | 70 | 90 | 150 |
| V5.6 | 8 s | on | 115 | 115 | 135 | 195 |
| V5.6 | 10 s | off | 77 | 77 | 99 | none |
| V5.6 | 10 s | on | 122 | 122 | 144 | none |
| V5 | 5 s | (none) | 45 | 45 | 60 | 120 |
| V5 | 8 s | (none) | 90 | 90 | 120 | 240 |

The seconds of C1 and V6:

- Frames, and References with images only: the duration.
- References with reference videos: "twice the standard V6 rate" (the list's
  "V6 video reference" rows) for the seconds of the longest reference video,
  which the result follows. With measured files that is from its length to
  its next whole second, since the list does not say how a fraction of a
  second is billed; without files, 1 to 15 seconds.
- Extend: the seconds added, at "the applicable V6 resolution, audio, and
  generated-duration rate". Video Extend has no sound setting, so the estimate
  ranges from V6's rate without sound to its rate with sound.

V5.6 at 10 seconds and 1080p has no price, and a rule refuses it. The list's
own calculation examples, which the tests repeat:

| Generation | Credits | List price |
| --- | --- | --- |
| C1, 1080p, sound off, 5 s | 19 × 5 = 95 | $0.422 |
| V6, 720p, sound on, 8 s | 12 × 8 = 96 | $0.427 |
| V6 references with a 5-second reference video, 720p, sound off | 18 × 5 = 90 | $0.400 |
| V5.6, 720p, sound on, 8 s | 135 | $0.600 |

## Left out

- **V5.5, V5-Fast, V4.5, V4, and V3.5**: the create pages still list them,
  but the capability map does not; V5-Fast depends on account permissions,
  and only V5.5 has a published price. V5.6 and V6 make what V5.5 makes,
  V6 also with multiple clips.
- **References on C1, V5.6, and V5**: Fusion lists them "subject to account
  access", and the changelog added C1 and V5.6 to it, but the capability map
  marks Reference-to-Video "Not supported" for all three, and the V5.6 entry
  of the changelog refers to the map. Only V6, where every page agrees, takes
  references.
- **The `auto` ratio of V6 Omni**: it applies only with reference videos; a
  ratio is always chosen, and the video takes it.
- **`ref_name` and `type` of references** (both optional): the prompt is sent
  as written. BaseHalf names its inputs Image 1 and Video 1, and PixVerse's
  `@name` syntax for inputs is not added.
- **Videos PixVerse made as sources** (`source_video_id`): a node's inputs are
  files, which are uploaded.
- **Templates and effects** (`template_id`, `img_ids`, the template list, Image
  Template Generation), **Multi-Transition Video** (V5 keyframes with a
  duration each), and the legacy sound-effect and lip-sync fields of
  Image-to-Video: not generation of this kind, or not this node's inputs.
- **Lipsync, Sound Effect, Swap, Video Edit, Motion Control, Restyle, Upscale,
  Image Avatar, and the agents**: editing or other flows
  ([non-goals](../video-providers.md#non-goals)).
- **Negative prompt, motion mode, style, camera movement, and watermark**: no
  create page of 2026-10-19 documents them; a task's answer still carries
  `negative_prompt` and `style`, which the module does not read.
- **Webhooks** (`webhook_id`): BaseHalf asks about the task itself.
- **Public-address uploads** (`image_url`, `file_url`): BaseHalf uploads the
  bytes.
- **Audio inputs**: none of the endpoints above takes audio.

## Not confirmed

- **The China host** named in the platform's web code: not documented, so not
  offered.
- **Image bytes**: Upload Image says "smaller than 20 MB"; the module reads MB
  as MiB, as every module does.
- **V5.6 at 1080p**: the create pages state the rule only as "Do not use
  unsupported duration/quality combinations"; the price list marks 10 seconds
  at 1080p "Not supported", and V5 is priced at 1080p for 8 seconds.
- **Reference video sizes**: Fusion states none; the module allows what AI
  Video can send in one request.
- **Seconds billed for reference videos and Extend**: hence the ranges of the
  estimate.
- **An unknown task**: the pages do not say what `GET /video/result` answers
  for a `video_id` that does not exist; `500008` (requested data not found)
  answers `notFound`.
- **States other than 1, 5, 7, and 8**: none is documented; any other cannot
  be read.
- **Retention of results**: not documented.

## Acceptance criteria

1. The catalog has the provider `pixverse` with one region, one API key, and
   the four models above with exactly their modes, limits, and parameters.
2. Each mode of each model uploads its inputs first and sends the body above,
   once, to its endpoint, with the key in `API-KEY` and a new `Ai-trace-id`
   on every request; ids keep every digit.
3. Asking about a task maps `5`, `1`, `7`, and `8` as above; the video
   downloads from the address of the poll, or of a new question when the
   download has none.
4. `cancel` answers false and sends nothing.
5. 401 and the codes 10004 and 10005 answer `auth`; 429, 712008, and 500044
   answer `rateLimited`; 500090 answers `balance`; a create whose connection
   drops after it was sent answers `unknownOutcome` and was sent once.
6. `check` reports each rule between parameters and inputs; a refused request
   uploads and sends nothing.
7. The estimate of the list's calculation examples and of three other
   combinations matches the price list.

## Verification

`vscode-base/extensions/basehalf-ai-video/test/pixverse.test.ts` runs the
module through the provider commands against a local server that answers like
PixVerse. No test calls PixVerse or uses a real key.
