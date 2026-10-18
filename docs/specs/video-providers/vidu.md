# Vidu

Status: Active (2026-10-19)
Decision: [D59](../../decisions.md#d59--video-providers-are-built-in-integrations-with-each-models-exact-settings-users-bring-their-own-keys-new-2026-10-19)
Owner: [Video providers and the model catalog](../video-providers.md), which
this page details for the provider `vidu`
Module: `vscode-base/extensions/basehalf-ai-video/src/providers/vidu.ts`

This page records what the Vidu module of AI Video declares and sends: its
regions and credentials, its models with their modes, inputs, parameters, and
rules, how a request is built, how a task is followed and cancelled, and how
its price is estimated. Everything not said here follows
[Video providers and the model catalog](../video-providers.md) and the
[Video node](../video-node.md).

## Sources

Every fact below was read in Vidu's official documentation on 2026-10-18 and
read again on 2026-10-19, when every page was the same. Paths are under
`https://platform.vidu.com/docs/` (international) and
`https://platform.vidu.cn/docs/` (China), which have the same paths; a page is
fetched by adding `.md`.

| Topic | Pages |
| --- | --- |
| Index | `llms.txt` |
| Models and prices | `overview/model-map`, `overview/pricing`, `overview/faq`, `api-reference/updates` |
| Vidu Q4 Preview | `api-reference/video-models/vidu-q4-preview/image-to-video`, `…/reference-to-video` |
| Vidu Q3 | `api-reference/video-models/vidu-q3/text-to-video`, `…/image-to-video`, `…/start-end-to-video`, `…/reference-to-video` |
| Vidu Q2 | `api-reference/video-models/vidu-q2/text-to-video`, `…/image-to-video`, `…/start-end-to-video`, `…/reference-to-video` |
| Vidu Q1 and 2.0 (left out) | `api-reference/video-models/vidu-q1/text-to-video`, `…/image-to-video`, `…/start-end-to-video`, `…/reference-to-video` |
| Tasks | `api-reference/task-management/task-detail`, `…/task-list`, `…/cancel-task`, `…/account-balance` |
| Errors | `api-reference/other-documentation/error-codes` |
| Limits | `terms-and-policies/usage-and-limits`, `terms-and-policies/content-moderation` (international site only) |
| Credit price | `https://platform.vidu.cn/pricing` and `https://platform.vidu.com/pricing`: the text of the pages' script, which states the price of a credit |
| HTTP statuses of the error codes | the earlier Chinese documentation site, `https://docs.platform.vidu.cn/7179254m0.md` (error codes) and `…/331854699e0.md` (task query) |

## Regions and credentials

| Region | Label | Base URL | Currency | Console |
| --- | --- | --- | --- | --- |
| `cn` | China | `https://api.vidu.cn` | CNY | `https://platform.vidu.cn` |
| `intl` | International | `https://api.vidu.com` | USD | `https://platform.vidu.com` |

- One credential, `apiKey` ("API Key"), made under API Key Management on the
  platform. It is sent as `Authorization: Token <key>`. Every page says
  `Token`; one header table of the international Q4 Preview reference page
  says `Bearer`, which the request examples on the same page contradict.
- Requests are JSON (`Content-Type: application/json`). Inputs travel inside
  the request as data URLs. Vidu has no upload endpoint.
- Limits are per organization, not per key: up to 5 tasks run at a time, and
  further tasks wait in the `queueing` state in the order they came.

## Models

The models in the order the window lists them. Vidu Q3 Pro comes first: it
takes text, a start frame, or both frames, so a node works on it with whatever
it is given.

| Catalog id | Label | Vidu model (`cn`, `intl`) | Modes | Create requests |
| --- | --- | --- | --- | --- |
| `q3-pro` | Vidu Q3 Pro | `viduq3-pro`, `viduq3-pro` | Frames | `text2video`, `img2video`, `start-end2video` |
| `q3-turbo` | Vidu Q3 Turbo | `viduq3-turbo`, `viduq3-turbo` | Frames | `text2video`, `img2video`, `start-end2video` |
| `q3-pro-fast` | Vidu Q3 Pro Fast | `viduq3-pro-fast`, `viduq3-pro-fast` | Frames (start frame) | `img2video`, `start-end2video` |
| `q4-preview` | Vidu Q4 Preview | `viduq4-preview`, `viduq4-preview` | Frames (start frame), References | `img2video`; `reference2video` |
| `q3` | Vidu Q3 | `viduq3`, `viduq3` | References | `reference2video` |
| `q3-mix` | Vidu Q3 Mix | `viduq3-mix`, `viduq3-mix` | References | `reference2video` |
| `q3-turbo-reference` | Vidu Q3 Turbo References | `viduq3-turbo`, not offered | References | `reference2video` |
| `q2-pro` | Vidu Q2 Pro | `viduq2-pro`, `viduq2-pro` | Frames (start frame) | `img2video`, `start-end2video` |
| `q2-turbo` | Vidu Q2 Turbo | `viduq2-turbo`, `viduq2-turbo` | Frames (start frame) | `img2video`, `start-end2video` |

Each create request is `POST /ent/v2/<request>` under the endpoint in use. In
Frames mode the inputs choose it: no image is `text2video`, a start frame alone
is `img2video`, and a start and an end frame are `start-end2video`.

`viduq3-turbo` is two catalog models because its reference request differs
from its frame requests (durations 3–15 instead of 1–16, no sound setting, a
5,000-character prompt). Its reference request with images is documented only
on the Chinese site; the international site documents it only with subjects,
which BaseHalf does not use ([Left out](#left-out)), so it is not offered there.

## Modes and inputs

**Frames**, by model:

| Models | Start frame | End frame | Limits |
| --- | --- | --- | --- |
| `q3-pro`, `q3-turbo` | optional | optional | image at most 10 MiB, aspect ratio 1:4 to 4:1 |
| `q3-pro-fast`, `q2-pro`, `q2-turbo` | required | optional | image at most 10 MiB, aspect ratio 1:4 to 4:1 |
| `q4-preview` | required | none | image at most 50 MiB |

**References**, by model:

| Models | Images | Audio | Limits |
| --- | --- | --- | --- |
| `q4-preview` | 1–15 | 0–3 | image at most 50 MiB; audio 3–12 seconds, at most 50 MiB |
| `q3`, `q3-turbo-reference` | 1–7 | none | each side at least 128 px, aspect ratio 1:4 to 4:1 |
| `q3-mix` | 1–7 | 0–3, international only | each side at least 128 px, aspect ratio 1:4 to 4:1; audio 3–12 seconds, at most 20 MiB |

No mode takes videos, and no model offers Extend or Edit.

The module adds these input rules (`check`), each a plain sentence naming the
file and the limit:

- Images are PNG, JPEG, or WebP; audio is MP3.
- The start and end frames have close shapes: the start frame's aspect ratio
  (width to height) divided by the end frame's is from 0.8 to 1.25. The pages
  word this as the frames' "resolution" divided; BaseHalf reads it as their
  aspect ratios.
- The request with its inputs as data URLs is at most 20 MiB. Most create pages
  state this limit for the body; BaseHalf applies it to every create request.
- `q3-mix` takes reference audio only in International: only the international
  page documents its `sounds`.

Sizes the pages give in MB are read as MiB.

## Parameters

The models declare these parameters with the values their pages list; the
second table says which model has which. A value is sent under the field of
the same name.

| Parameter | Label | Kind | Values and default |
| --- | --- | --- | --- |
| `resolution` | Resolution | choice | by model, below; default 720p |
| `duration` | Duration | whole seconds | by model, below; default 5 |
| `aspect_ratio` | Ratio | choice, drawn as ratios | `16:9` (default), `9:16`, `1:1`, `4:3`, `3:4`, and `auto` where listed |
| `audio` | Sound | on or off | where listed |
| `is_rec` | Expand Prompt | on or off | `q4-preview` Frames only; default off |
| `seed` | Seed | whole number 0–2147483647, optional, under More | sent only when set; empty or 0 is random |

| Model | Resolution | Duration | Ratio | Sound |
| --- | --- | --- | --- | --- |
| `q4-preview` | 540p, 720p, 1080p, 2K, 4K | 3–16 | References only, no `auto` | on |
| `q3-pro`, `q3-turbo` | 540p, 720p, 1080p | 1–16 | Frames, sent only without a start frame, no `auto` | on |
| `q3-pro-fast` | 720p, 1080p | 1–16 | — | on |
| `q3` | 540p, 720p, 1080p | 3–16 | with `auto` | on |
| `q3-mix` | 720p, 1080p | 3–15 | with `auto` | — |
| `q3-turbo-reference` | 540p, 720p, 1080p | 3–15 | with `auto` | — |
| `q2-pro`, `q2-turbo` | 540p, 720p, 1080p | 1–10 | — | off |

- The ratio of a video made from a frame is the frame's own, so `q3-pro` and
  `q3-turbo` send `aspect_ratio` only to `text2video`. Its tooltip says so.
- `is_rec` lets Vidu write a fuller prompt before it generates. Vidu's own
  default is on; BaseHalf's is off, so that the prompt is used as written
  unless the user turns it on.
- `q2-pro` and `q2-turbo` make sound from a start frame alone: their
  `start-end2video` request has no `audio` field.
- Values the pages list for one request only are not offered: `360p` of the
  Q2 start–end request has no price.

Tooltips, in English like every label of the module:

| Parameter | Tooltip |
| --- | --- |
| `aspect_ratio` of `q3-pro`, `q3-turbo` | Used when there is no start frame; a video made from a frame takes the shape of the frame. |
| `aspect_ratio` with `auto` | Auto lets Vidu choose the shape from the reference images. |
| `audio` | Dialogue and sound effects made together with the picture. |
| `audio` of `q2-pro`, `q2-turbo` | Dialogue and sound made with the picture, from a start frame alone. It adds 15 credits. |
| `is_rec` | Vidu writes a fuller prompt from yours and the start frame before it generates. It may add 10 credits. |
| `seed` | The same seed and settings make a similar video. Empty or 0 makes a new one each time. |

### Prompt

| Model | Rule | Most characters |
| --- | --- | --- |
| `q4-preview` | required in References, optional with a start frame | 20,000 |
| `q3-pro` | required without a start frame | 20,000 |
| `q3-pro-fast` | optional (a start frame is always there) | 20,000 |
| `q3-turbo` | required without a start frame | 20,000; 5,000 without a start frame in International |
| `q3`, `q3-mix` | always | 20,000 in China, 5,000 in International |
| `q3-turbo-reference` | always | 5,000 |
| `q2-pro`, `q2-turbo` | optional | 2,000 with a start frame alone, 5,000 with an end frame |

The catalog declares the largest number and `withoutMedia` or `always`; the
module reports the rest.

### Rules between parameters and inputs

`check` reports, after the declarations' own checks:

1. A prompt longer than the region and the create request allow, or missing in
   References mode of `q4-preview` once an image is connected (without one, the
   declarations' check already asks for a prompt).
2. Sound on for `q2-pro` or `q2-turbo` with an end frame.
3. With files: an image that is not PNG, JPEG, or WebP; audio that is not MP3;
   start and end frames of different shapes; a request over 20 MiB.
4. Reference audio for `q3-mix` in China.

## Requests

Create, once (`http.create`):

| Field | Sent |
| --- | --- |
| `model` | the Vidu model of the region |
| `images` | `img2video`: the start frame; `start-end2video`: the start and end frames; `reference2video`: the reference images in order |
| `sounds` | `reference2video` of `q4-preview` and `q3-mix`: the reference audio in order, when there is any |
| `prompt` | the prompt as sent, when it is not empty |
| `duration`, `resolution` | always |
| `aspect_ratio` | `text2video` and `reference2video` of the models that declare it |
| `audio` | the models that declare it, to the requests that take it |
| `is_rec` | `img2video` of `q4-preview` |
| `seed` | when set |

- Images are data URLs of their own format (`data:image/png;base64,…`,
  `image/jpeg`, `image/webp`), read from the file's bytes. Audio is sent as
  `data:video/mp3;base64,…`, as the pages' examples write it.
- Nothing else is sent: no `callback_url`, `payload`, `off_peak`, `watermark`,
  `wm_position`, `wm_url`, `meta_data`, `voice_id`, `subjects`, `bgm`, or
  `movement_amplitude`.
- The answer's `task_id` (a string) is the task id. An answer of status 200
  that carries an error (`code` of 400 or more, or a `reason`) and no task id is
  a refusal read like an error answer.

Poll (`http.request`): `GET /ent/v2/tasks/<id>/creations`.

| `state` | Answered |
| --- | --- |
| `created`, `queueing` | `pending` |
| `processing` | `running` |
| `success` | `succeeded`, with the `url` of the first creation |
| `failed` with `err_code` `UserCancelled` | `cancelled` |
| `failed` | `failed`, with the code's description and that Vidu charges nothing for a video that fails |
| any other | `running` |

- States are compared without case: the content moderation page writes
  `FAILED`.
- `progress`, when the answer carries a number from 0 to 100, is reported as
  the fraction done. The pages document no such field; see
  [Not confirmed](#not-confirmed).

Result: the creation's `url` is the video without a watermark (the task list
page says so; `watermarked_url` has one), valid for 24 hours. The download
sends the key only when that address is on the endpoint's own origin, never to
a storage host. When a poll gave no address, `videoLocation` asks for the task
again and takes the same `url`.

Cancel (`http.requestOnce`): `POST /ent/v2/tasks/<id>/cancel` with
`{"id": "<id>"}`. An answer of `{}` means cancelled. Vidu refuses once the task
is scheduled (`"task state is scheduled, can not cancel"`, code 400): an
answer of status 400, or of status 200 that carries an error, answers
`cancelled: false`.

### Errors

An error answer is `{"code", "reason", "message", "metadata"}`. `reason` is
one of the documented error codes:

| `reason` | Code of the contract | Message |
| --- | --- | --- |
| `Unauthorized`, `Forbidden` (401, 403) | `auth` | the key is not accepted, check it in Video Providers |
| `CreditInsufficient` (400) | `balance` | the account has too few credits |
| `QuotaExceeded` (429) | `rateLimited` | too many tasks at once; Vidu runs up to 5 at a time for an organization |
| `TooManyRequests`, `SystemThrottling` (429) | `rateLimited` | requests too frequent, or Vidu is limiting them |
| `TaskNotFound` (404) | `notFound` when asking about a task | Vidu does not know the task |
| content review codes, `ModelUnavailable`, image codes (400) | `rejected` | what the code means |
| any other code, such as the field errors | by the status | Vidu's message |

Every message names the code in parentheses. A code is read as the contract's
code only with a status below 500; a server error keeps its meaning, so a
create it answers has an unknown outcome. The same meanings describe the
`err_code` of a failed task.

## Estimate

Every model declares an estimate. The price is in credits: one credit is
¥0.03125 in China (100 yuan buy 3,200 credits at every tier) and $0.005 in
International, the standard rate the international pricing page states
(higher purchase tiers have better rates, so the estimate may be above what is
paid). Credits by model, from the documentation's pricing page
(`overview/pricing`, the same in both regions) as read on 2026-10-19, the
estimate's price date:

| Model | Requests | Credits per second: 540p / 720p / 1080p / 2K / 4K |
| --- | --- | --- |
| `q4-preview` | both | 9 / 19 / 24 / 38 / 78 |
| `q3-pro` | all three | 9 / 20 / 24 |
| `q3-turbo` | all three | 7 / 12 / 13 |
| `q3-pro-fast` | `img2video` | — / 12 / 15 |
| `q3` | `reference2video` | 7 / 12 / 15 |
| `q3-mix` | `reference2video` | — / 24 / 29 |
| `q3-turbo-reference` | `reference2video` | 4 / 10 / 13 |

The estimate is the rate times the duration. `q2-pro` and `q2-turbo` are
priced per video by its length, the same for both requests: credits for a
1-second video, for a 2-second video, and then for each further second.

| Model | 540p | 720p | 1080p |
| --- | --- | --- | --- |
| `q2-turbo` | 6; 8; +2 | 8; 10; +10 | 35; 45; +10 |
| `q2-pro` | 8; 10; +5 | 15; 25; +10 | 55; 70; +15 |

Sound adds 15 credits to an `img2video` request of Q2. The platform's pricing
page gives the same numbers length by length (1 to 10 seconds from a start
frame, 1 to 8 from start and end frames; the API takes 1 to 10 for both).

- `is_rec` on for `q4-preview` gives a range up to 10 credits more: the update
  notice of 2025-11-03 says each call with it costs 10 more credits, and the Q2
  pages say the same; the Q4 page names no price for it.
- `q3-pro-fast` with an end frame has no estimate: the price list gives
  `img2video` only.
- The estimate is the standard price. Vidu's off-peak mode, about half the
  price, is not offered ([Left out](#left-out)).
- `viduq3-mix`: the pricing page of the documentation gives 24 and 29 credits a
  second; the pricing page of the platform lists 20 and 24, the same row as two
  industry models. The estimate follows the documentation, the higher one.

Examples recorded in the tests:

| Region | Model and settings | Credits | Estimate |
| --- | --- | --- | --- |
| China | `q3-pro`, 720p, 5 s | 100 | ¥3.125 |
| China | `q4-preview` References, 4K, 16 s | 1,248 | ¥39 |
| China | `q2-turbo`, start frame, 720p, 5 s, sound | 55 | ¥1.71875 |
| International | `q3-turbo`, 1080p, 10 s | 130 | $0.65 |
| International | `q3-mix`, 1080p, 15 s | 435 | $2.175 |
| International | `q2-pro`, start and end frames, 540p, 1 s | 8 | $0.04 |

## Left out

- **Vidu Q1 (`viduq1`, `viduq1-classic`) and Vidu 2.0**: older generations,
  five-second 1080p videos only (Q1) or four and eight seconds (2.0). Q2, Q3,
  and Q4 cover every mode they offer.
- **`viduq2`** (text to video and references), **`viduq2-pro-fast`**, and the
  references of **`viduq2-pro`**: not in this phase. `viduq2` makes what Q3
  Turbo and Q3 make, and its references with images are documented only on
  the Chinese site; the image-to-video page documents no request of
  `viduq2-pro-fast`; the price of the video references of `viduq2-pro` is only
  in a separate sheet.
- **`viduq3-ad` and `viduq3-drama`**: models tuned for advertising and comic
  drama, without a price in the documentation's price list.
- **Subjects** (`subjects`, `auto_subjects`, the subject library): BaseHalf
  names its inputs Image 1, Audio 1, and so on; subjects are another way of
  naming them in the prompt.
- **Video extension and smart multi-frame**: the function list names them, but
  the API reference of 2026-10-19 has no page for either.
- **Off-peak mode** (`off_peak`): its tasks run within 48 hours, longer than a
  generation waits ([Video node, Ending without a video](../video-node.md#ending-without-a-video)).
- **`is_rec` of Q2 and Q3**: their pages say that Vidu then generates from a
  prompt of its own and leaves the user's aside; on Q2 it costs 10 more
  credits.
- **`voice_id`, `bgm`, `movement_amplitude`**: a voice comes from a separate
  list, and the other two are documented on one region's pages only.
- **Watermark settings** (China): the video downloaded is `url`, which has no
  watermark.
- **Callbacks** (`callback_url`): BaseHalf asks about the task.

## Not confirmed

- **Progress**: the pages document no progress field. The module reads
  `progress` only when it is a number from 0 to 100.
- **The frames rule**: the pages divide the frames' "resolution"; BaseHalf
  checks their aspect ratios.
- **The status of a refused cancellation**: the page shows the refusal under
  "200 OK" with `code: 400`; both statuses are read as a refusal.
- **Seed range**: the pages give an integer without a range; BaseHalf allows 0
  to 2147483647.
- **Audio data URL type**: the pages' examples write `data:video/mp3`; BaseHalf
  sends that type.
- **`is_rec` of `q4-preview`**: its price, hence the range.
- **The credit price in International**: only the pricing page's script states
  $0.005; the documentation's price page states the price in yuan.
- **`task_id`**: the pages give a string. When an answer gives it as a number,
  the module takes its digits from the answer's text, so a long id keeps every
  digit.

## Acceptance criteria

1. The catalog lists the models of [Models](#models) with exactly the modes,
   inputs, limits, parameters, and prompt rules of this page, and
   `q3-turbo-reference` only in China.
2. Each model's request goes to its endpoint with `Authorization: Token`, the
   fields of [Requests](#requests), and its inputs as data URLs.
3. A poll answers every documented state, with progress when the answer has
   it, and a download takes the creation's `url` without sending the key to its
   host.
4. A cancellation answers true for `{}` and false when Vidu refuses it.
5. A refused key answers `auth`, too many tasks `rateLimited` with Vidu's limit,
   too few credits `balance`, and a create whose connection drops
   `unknownOutcome` after one request.
6. `check` reports every rule of
   [Rules between parameters and inputs](#rules-between-parameters-and-inputs)
   and sends nothing when one applies.
7. The estimates of [Estimate](#estimate) match the recorded examples.

## Verification

`extensions/basehalf-ai-video/test/vidu.test.ts` runs the module through the
provider commands against a local server that answers like Vidu. No test calls
Vidu.
