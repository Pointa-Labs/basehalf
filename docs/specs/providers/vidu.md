# Vidu

Status: Active (2026-10-19; image models, 2026-10-22; names in the prompt, 2026-10-24)
Decisions: [D59](../../decisions.md#d59--video-providers-are-built-in-integrations-with-each-models-exact-settings-users-bring-their-own-keys-new-2026-10-19),
[D64](../../decisions.md#d64--basehalf-generates-images-with-the-same-cards-panel-and-providers-new-2026-10-22),
[D74](../../decisions.md#d74--a-prompt-mentions-its-inputs-files-and-each-provider-module-names-them-as-its-model-reads-them-new-2026-10-24)
Owner: [Providers and the model catalog](../providers.md), which
this page details for the provider `vidu`
Module: `vscode-base/extensions/basehalf-ai-video/src/providers/vidu.ts`

This page records what the Vidu module of AI Video declares and sends: its
regions and credentials, its models with their modes, inputs, parameters, and
rules, how a request is built, and how a task is followed and cancelled. The
sections up to [Image models](#image-models) are about the video models.
Everything not said here follows
[Providers and the model catalog](../providers.md) and
[generation cards](../generation-cards.md).

## Sources

Every fact below was read in Vidu's official documentation on 2026-10-18 and
read again on 2026-10-19, when every page was the same. Paths are under
`https://platform.vidu.com/docs/` (international) and
`https://platform.vidu.cn/docs/` (China), which have the same paths; a page is
fetched by adding `.md`.

| Topic | Pages |
| --- | --- |
| Index | `llms.txt` |
| Models | `overview/model-map`, `overview/faq`, `api-reference/updates` |
| Vidu Q4 Preview | `api-reference/video-models/vidu-q4-preview/image-to-video`, `…/reference-to-video` |
| Vidu Q3 | `api-reference/video-models/vidu-q3/text-to-video`, `…/image-to-video`, `…/start-end-to-video`, `…/reference-to-video` |
| Vidu Q2 | `api-reference/video-models/vidu-q2/text-to-video`, `…/image-to-video`, `…/start-end-to-video`, `…/reference-to-video` |
| Vidu Q1 and 2.0 (left out) | `api-reference/video-models/vidu-q1/text-to-video`, `…/image-to-video`, `…/start-end-to-video`, `…/reference-to-video` |
| Tasks | `api-reference/task-management/task-detail`, `…/task-list`, `…/cancel-task`, `…/account-balance` |
| Errors | `api-reference/other-documentation/error-codes` |
| Limits | `terms-and-policies/usage-and-limits`, `terms-and-policies/content-moderation` (international site only) |
| HTTP statuses of the error codes | the earlier Chinese documentation site, `https://docs.platform.vidu.cn/7179254m0.md` (error codes) and `…/331854699e0.md` (task query) |

## Regions and credentials

| Region | Label | Base URL | Console |
| --- | --- | --- | --- |
| `cn` | China | `https://api.vidu.cn` | `https://platform.vidu.cn` |
| `intl` | International | `https://api.vidu.com` | `https://platform.vidu.com` |

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
second table says which model has which. They take the names and values every
provider shares ([Shared names](../providers.md#parameters)), so that
choosing another model keeps them, and the module sends each under Vidu's
field and value:

| Parameter | Label | Kind | Values and default | Sent as |
| --- | --- | --- | --- | --- |
| `resolution` | Resolution | choice | by model, below, in lower case; labels as Vidu writes them (`2k` is **2K**, `4k` is **4K**); default `720p` | `resolution`, as Vidu writes it (`2K`, `4K`) |
| `duration` | Duration | whole seconds | by model, below; default 5 | `duration` |
| `ratio` | Ratio | choice, drawn as ratios | `16:9` (default), `9:16`, `1:1`, `4:3`, `3:4`, and `adaptive` (**Adaptive**) where listed | `aspect_ratio`, with `adaptive` sent as `auto` |
| `sound` | Sound | on or off | where listed | `audio` |
| `prompt_extend` | Expand Prompt | on or off | `q4-preview` Frames only; default off | `is_rec` |
| `seed` | Seed | whole number 0–2147483647, optional, under More | sent only when set; empty or 0 is random | `seed` |

| Model | Resolution | Duration | Ratio | Sound |
| --- | --- | --- | --- | --- |
| `q4-preview` | `540p`, `720p`, `1080p`, `2k`, `4k` | 3–16 | References only, no `adaptive` | on |
| `q3-pro`, `q3-turbo` | `540p`, `720p`, `1080p` | 1–16 | Frames, sent only without a start frame, no `adaptive` | on |
| `q3-pro-fast` | `720p`, `1080p` | 1–16 | — | on |
| `q3` | `540p`, `720p`, `1080p` | 3–16 | with `adaptive` | on |
| `q3-mix` | `720p`, `1080p` | 3–15 | with `adaptive` | — |
| `q3-turbo-reference` | `540p`, `720p`, `1080p` | 3–15 | with `adaptive` | — |
| `q2-pro`, `q2-turbo` | `540p`, `720p`, `1080p` | 1–10 | — | off |

- The ratio of a video made from a frame is the frame's own, so `q3-pro` and
  `q3-turbo` send `aspect_ratio` only to `text2video`. Its tooltip says so.
- `adaptive` is Vidu's `auto`: Vidu takes the shape from the reference images.
- `prompt_extend` lets Vidu write a fuller prompt before it generates. Vidu's
  own default of `is_rec` is on; BaseHalf's is off, so that the prompt is used
  as written unless the user turns it on.
- `q2-pro` and `q2-turbo` make sound from a start frame alone: their
  `start-end2video` request has no `audio` field.
- Values the pages list for one request only are not offered: `360p` of the
  Q2 start–end request.

Tooltips, in English like every label of the module:

| Parameter | Tooltip |
| --- | --- |
| `ratio` of `q3-pro`, `q3-turbo` | Set by the start frame (`setByStartFrame`): used when there is no start frame; a video made from a frame takes the shape of the frame. |
| `ratio` with `adaptive` | Adaptive lets Vidu choose the shape from the reference images. |
| `sound` | Dialogue and sound effects made together with the picture. |
| `sound` of `q2-pro`, `q2-turbo` | Dialogue and sound made with the picture, from a start frame alone. |
| `prompt_extend` | Vidu writes a fuller prompt from yours and the start frame before it generates. |
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

**Names in the prompt** ([providers](../providers.md#names-in-the-prompt)).
Q4 Preview's example names its references `[@reference_image_1]` and
`[reference_audio_1]` in English and 参考图1 and 参考音频1 in Chinese, counted
by kind in order (`vidu-q4-preview/reference-to-video`, read 2026-10-24), and
the module writes those. Vidu documents no names for the references of Q3,
Q3 Mix, and Q3 Turbo, whose example names none ("Santa Claus and the bear
hug by the lakeside."), or for frames: the shared names are written.

### Rules between parameters and inputs

`check` reports, after the declarations' own checks:

1. A prompt longer than the region and the create request allow, or missing in
   References mode of `q4-preview` once an image is connected (without one, the
   declarations' check already asks for a prompt).
2. Sound on for `q2-pro` or `q2-turbo` with an end frame.
3. Audio that is not MP3; start and end frames of different shapes; a
   request over 20 MiB. (An image that is not PNG, JPEG, or WebP is
   drawn to PNG by the window first.)
4. Reference audio for `q3-mix` in China.

## Requests

Create, once (`http.create`):

| Field | Sent |
| --- | --- |
| `model` | the Vidu model of the region |
| `images` | `img2video`: the start frame; `start-end2video`: the start and end frames; `reference2video`: the reference images in order |
| `sounds` | `reference2video` of `q4-preview` and `q3-mix`: the reference audio in order, when there is any |
| `prompt` | the prompt as sent, when it is not empty |
| `duration` | always |
| `resolution` | always, as Vidu writes it: `540p`, `720p`, `1080p`, `2K`, `4K` |
| `aspect_ratio` | `ratio`, to `text2video` and `reference2video` of the models that declare it; `adaptive` as `auto` |
| `audio` | `sound`, of the models that declare it, to the requests that take it |
| `is_rec` | `prompt_extend`, to `img2video` of `q4-preview` |
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
| `Unauthorized`, `Forbidden` (401, 403) | `auth` | the key is not accepted, check it in Providers |
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

## Left out

- **Vidu Q1 (`viduq1`, `viduq1-classic`) and Vidu 2.0**: older generations,
  five-second 1080p videos only (Q1) or four and eight seconds (2.0). Q2, Q3,
  and Q4 cover every mode they offer.
- **`viduq2`** (text to video and references), **`viduq2-pro-fast`**, and the
  references of **`viduq2-pro`**: not in this phase. `viduq2` makes what Q3
  Turbo and Q3 make, and its references with images are documented only on
  the Chinese site; the image-to-video page documents no request of
  `viduq2-pro-fast`.
- **`viduq3-ad` and `viduq3-drama`**: models tuned for advertising and comic
  drama; not in this phase.
- **Subjects** (`subjects`, `auto_subjects`, the subject library): another
  request body, in which a name of the request is mentioned as `[@name]`;
  the prompt mentions the inputs themselves, and the module names them
  (D74).
- **Video extension and smart multi-frame**: the function list names them, but
  the API reference of 2026-10-19 has no page for either.
- **Off-peak mode** (`off_peak`): its tasks run within 48 hours, longer than a
  generation waits ([generation cards, Ending without its files](../generation-cards.md#ending-without-its-files)).
- **`is_rec` of Q2 and Q3**: their pages say that Vidu then generates from a
  prompt of its own and leaves the user's aside.
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

## Image models

### Image sources

Read on 2026-10-22; no page shows a date. The pages are the same under
`https://platform.vidu.com/docs/` and `https://platform.vidu.cn/docs/`.

| Page | What it settles |
| --- | --- |
| `api-reference/image-generation` | the create `POST /ent/v2/reference2image`, its body and answer, and the query of its creations |
| `overview/model-map` | the image models: what each does, its resolutions, how many images it takes, its ratios |
| `api-reference/updates` | 2025-09-08: reference to image, 1–7 images, 1080p; 2025-09-17: prompts of up to 2,000 characters; 2025-12-01: `viduq2` adds text to image and editing |
| `api-reference/task-management/task-detail`, `…/cancel-task` | the query and the cancellation, the same as for videos |
| `api-reference/other-documentation/error-codes` | the codes, the same as for videos, with `ImageDownloadFailure` |

### Image catalog

| Catalog id | Label | Vidu model (`cn`, `intl`) | References | Ratios | Resolutions |
| --- | --- | --- | --- | --- | --- |
| `q2-image` | Vidu Q2 | `viduq2` | 0–7 | `16:9` (default), `9:16`, `1:1`, `4:3`, `3:4`, `21:9`, `2:3`, `3:2`, `adaptive` | `1080p` (default), `2k`, `4k` |
| `q1-image` | Vidu Q1 | `viduq1` | 1–7 | `16:9` (default), `9:16`, `1:1`, `4:3`, `3:4` | `1080p` |

- Both have the kind `image` and run as tasks, with the one mode References
  (`reference`): Vidu Q2 makes an image from the prompt alone, edits one, or
  keeps the subjects of up to 7 references; Vidu Q1 keeps the subjects of 1
  to 7. Their `outputFormat` is `png`: the format is not documented, and an
  image in another format lands under its own extension.
- The prompt is always required, at most 2,000 characters.
- They follow the video models, Vidu Q2 first: it also works from the prompt
  alone.
- A task makes one image: the call has no count, and its example answers
  one creation, so the models declare no `count`.

### Image inputs

- `images`: data URLs of their own format (`image/png`, `image/jpeg`,
  `image/webp`), read from the bytes, in order. The window draws any other
  image to PNG.
- Each at least 128 × 128 px (`imageMinSide: 128`), width to height within
  1:4 to 4:1 (`imageAspect: [0.25, 4]`), at most 50 MB (`imageMaxBytes:
  52428800`).
- The request with its data URLs is at most 20 MiB, as for videos; `check`
  reports a larger one.

### Image parameters

| Parameter | Label | Kind | Values and default | Sent as |
| --- | --- | --- | --- | --- |
| `ratio` | Ratio | choice, ratio shapes | by model, above; default `16:9`; `adaptive` labeled **Adaptive** | `aspect_ratio`, Adaptive as `auto` |
| `resolution` | Resolution | choice | by model, above, labeled 1080p, 2K, 4K; default `1080p` | `resolution`, as Vidu writes it: `1080p`, `2K`, `4K` |
| `seed` | Seed | whole number 0–2147483647, optional, under More | sent only when set; empty or 0 is random | `seed` |

- Adaptive is Vidu's `auto`, "the same aspect ratio as the first input
  image"; its tooltip says so. Vidu defines it only from an image, so `check`
  refuses Adaptive without a reference.
- The resolutions keep the values the video models use (`1080p`, `2k`, `4k`),
  so that choosing another Vidu model keeps them.
- Nothing else is offered: the call has no count, watermark switch, prompt
  rewriting, or negative prompt. The image downloaded is the creation's `url`,
  which has no watermark; `watermarked_url` has one.

### Image requests

- **Create**, once (`http.create`): `POST /ent/v2/reference2image` with
  `Authorization: Token <key>` and

  ```json
  { "model": "viduq2", "images": ["data:image/png;base64,…"], "prompt": "<prompt>", "aspect_ratio": "auto", "resolution": "2K", "seed": 7 }
  ```

  `images` only when there are references, `seed` only when set; no
  `payload` or `callback_url`. The task id is read as for videos.
- **Asking about a task**: `GET /ent/v2/tasks/<id>/creations`, with the states
  of the video models. `success` answers the `url` of every creation, in
  order, never its `watermarked_url`; without one, the answer cannot be read.
  A failure names an image: "Vidu could not make the image (code)." or what
  the code means, such as "Vidu's content review refused the image it made
  (CreationPolicyViolation)."; it does not say what a failure costs, which no
  image page states.
- The image's `url` is downloaded without the key, as a video's.
- **Cancel** and **errors**: as for the video models; `ImageDownloadFailure`
  (an image of the request could not be read) is refused by its status.

### Image open questions

1. How many images a task makes: one, by the example; a second creation
   would be dropped, since a generation names one file. The image page, read
   again on 2026-10-23, still has no count among the fields of the create,
   and its example still answers one creation.
2. The format of the images: not documented, also on 2026-10-23 (the page
   names formats only for the images sent); PNG is declared.
3. What Adaptive does without a reference: not defined; refused.

### Image acceptance criteria

1. The catalog lists `q2-image` and `q1-image` after the video models, with
   the kind `image`, PNG, as tasks, in both regions, with exactly their mode,
   limits, parameters, and prompt rule above.
2. Each model's create goes once to `/ent/v2/reference2image` with
   `Authorization: Token` and the fields above, its references as data URLs.
3. A poll answers every state, and `success` the `url` of each creation; an
   image downloads without the key.
4. A refused key answers `auth`, too many tasks `rateLimited`, too few credits
   `balance`, refused content `rejected`, and a create whose connection drops
   `unknownOutcome`, each after one request.
5. `check` refuses Adaptive without a reference and a request over 20 MiB, and
   a refused request sends nothing.

## Verification

`extensions/basehalf-ai-video/test/vidu.test.ts` runs the module through the
provider commands against a local server that answers like Vidu, for the
video models and the image models
([Image acceptance criteria](#image-acceptance-criteria)). No test calls
Vidu.
