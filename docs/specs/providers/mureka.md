# Mureka

Status: Draft (2026-10-25, D78)
Decisions: [D78](../../decisions.md#d78--basehalf-makes-speech-music-and-sound-effects-with-the-same-cards-panel-and-providers-new-2026-10-25)
Parent: [Providers and the model catalog](../providers.md)
Related: [generation cards](../generation-cards.md#several-images-from-one-generation)
(several songs from one generation)

This specification owns the Mureka module of the provider service
(`vscode-base/src/vs/platform/basehalfProviders/node/mureka.ts`): the music
models it declares, the requests it sends, and how it reads Mureka's
answers. What is the same for every provider is owned by the parent
specification and is not repeated here.

## Sources

The facts below follow Mureka's API platform documentation at
`https://platform.mureka.ai/docs/`, read on 2026-10-25. Its API reference
is drawn by script from Mureka's OpenAPI description (OpenAPI 3.0.0, "Mureka
API" 1.0), which the site's script holds; every field and value below was
read there. No page carries a date of its own; the changelog dates Mureka's
releases.

| Topic | Pages (path under `/docs/`) |
| --- | --- |
| Songs | `api/operations/post-v1-song-easy-generate` (Prompt to song), `api/operations/post-v1-song-generate` (Lyrics to song), `api/operations/get-v1-song-query-{task_id}` |
| Instrumentals | `api/operations/post-v1-instrumental-generate`, `api/operations/get-v1-instrumental-query-{task_id}` |
| Files | `api/operations/post-v1-files-upload` |
| Lyrics | `api/operations/post-v1-lyrics-generate` |
| Key, host, and errors | `en/quickstart`, `en/error-codes` |
| Models, limits, and balance | the introduction (`/docs/`), `en/changelog`, `en/faq` |

The console's address is the route of the dashboard's "API Keys" tab, which
the quick start names, in the platform's own app
(`https://platform.mureka.ai/apiKeys`).

## Regions and credentials

| Region | Label | Base URL | Console |
| --- | --- | --- | --- |
| `global` | Global | `https://api.mureka.ai` | `https://platform.mureka.ai/apiKeys` |

- One credential, `apiKey` (**API Key**), sent as
  `Authorization: Bearer <key>`. The API platform has a balance of its own,
  topped up in its console; a membership of Mureka's website does not pay
  for it.
- Mureka answers 403 to a request from a region it does not serve ("You are
  accessing the API from an unsupported region"). **Open:** which regions it
  serves; the documentation does not say, Singapore included.

## Models

| Model | Label | Id sent | Makes | Modes |
| --- | --- | --- | --- | --- |
| `mureka-9.5` | Mureka 9.5 | `mureka-9.5` | music | From a Description (songs and instrumentals), From Lyrics |
| `mureka-o2` | Mureka O2 | `mureka-o2` | music | From a Description (songs), From Lyrics |

- Both are of kind `audio`, make `music`, deliver MP3 (`outputFormat`), and
  run as tasks that are polled. One request makes 1 to 3 songs, 2 by
  default (`count`), and each song lands on its own card
  ([generation cards](../generation-cards.md#several-images-from-one-generation)).
- Mureka 9.5 is Mureka's newest model: every call lists it last among its
  models, and the changelog released its enhanced version on 2026-08-28.
  Mureka O2 was released on 2025-12-09.
- Mureka O2 makes no instrumentals: Mureka's instrumental call takes `auto`,
  `mureka-7.6`, `mureka-8`, `mureka-9`, and `mureka-9.5` only. So O2
  declares no Instrumental.
- Not offered: `auto`, which Mureka describes as "the latest version of the
  regular model" and which would leave the card without the model that made
  its songs, and the older `mureka-7.6`, `mureka-8`, and `mureka-9`. No
  retirement dates are published.

## Modes and inputs

- **From a Description** (`reference`): the prompt describes the song, and
  Mureka writes the lyrics and sings them. With Instrumental on (Mureka 9.5),
  Mureka makes music without singing from the description.
- **From Lyrics** (`lyrics`): the prompt is the lyrics the song sings, and
  Style is the style. Mureka's examples tag a section in square brackets on
  its own line (`[Verse]`), and its songs report their sections as intro,
  verse, pre-chorus, chorus, bridge, break, and outro.
- Each mode takes 0 or 1 sound, the reference song, whose music the song
  follows; no image and no video.
- The reference song is an MP3 or an M4A of at most 10 MiB (Mureka writes
  10 MB; a file's size is read as MiB, as other modules read it), and at
  least 30 seconds long. Mureka uses 30 seconds of it: "The supported audio
  duration range is [30,30] seconds, excess will be trimmed". So a longer
  song is taken, and a shorter one is refused. **Open:** whether Mureka
  itself refuses a shorter song or uses it as it is; `check` refuses it.
  The size is the mode's `audioMaxBytes`; the format and the length are the
  module's rules, since the declarations name no audio formats and a range
  of seconds has an end that Mureka does not have.
- The prompt is required in both modes (`always`). The catalog's limit is
  5,000 characters, that of the lyrics. In From a Description, Mureka takes
  at most 2,000 characters, and at most 1,024 with Instrumental on; `check`
  says so. Characters are counted as Unicode characters, as the declarations
  count them; Mureka does not say how it counts.

Rules that `check` reports:

- A reference song that is not an MP3 or an M4A, such as a WAV: "Reference
  audio 1 song.wav is not an MP3 or M4A file; Mureka takes the reference
  song as MP3 or M4A."
- A reference song shorter than 30 seconds: "Reference audio 1 hum.mp3 is
  12 seconds long; Mureka takes a reference song of at least 30 seconds and
  uses 30 seconds of it."
- A reference song with Instrumental on. Mureka's instrumental call takes a
  prompt or a reference of its own (`instrumental_id`), and "does not
  support combination with other control options"; a description is always
  sent, so no reference song can be: "With Instrumental on, Mureka 9.5 makes
  music from the description alone: remove the reference song, or turn
  Instrumental off."
- Style with a reference song in From Lyrics. Lyrics to song documents each
  of its controls alone and names the pairs it takes together, `prompt` with
  `vocal_id` and `reference_id` with `vocal_id`; the style (`prompt`) with a
  reference song (`reference_id`) is not among them: "Mureka 9.5 follows
  Style or a reference song, not both: clear Style, or remove the reference
  song." Style left empty is not set.
- A description longer than Mureka takes: "The prompt is 2400 characters
  long; in From a Description mode, Mureka 9.5 takes at most 2000.", and
  with Instrumental on, "…; with Instrumental on, Mureka 9.5 takes at most
  1024."

**Names in the prompt** ([providers](../providers.md#names-in-the-prompt)).
Mureka documents no names for the inputs of a prompt, so a mention of the
reference song takes the shared name, `Audio 1` (`音频1` in a Chinese
prompt). In From Lyrics, the prompt is sung as it is written, the name
included.

## Parameters

| Parameter | Label | Kind | Values | Default | Models | Modes | Mureka's field |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `count` | Songs | whole number | 1 to 3, step 1 | 2 | both | both | `n` ("Defaults to 2, maximum 3") |
| `instrumental` | Instrumental | boolean | | off | Mureka 9.5 | From a Description | the call: the instrumental call instead of Prompt to song |
| `style` | Style | text, optional | at most 1,024 characters | none | both | From Lyrics | `prompt` of Lyrics to song |

Each is a shared name of the catalog
([providers, Parameters](../providers.md#parameters)). A Style of spaces
alone is sent as no Style.

## Requests

Every request goes to the endpoint, `https://api.mureka.ai` unless the user
entered another one, under `/v1/`, with `Authorization: Bearer <key>`.

### The reference song

`POST /v1/files/upload` as a multipart form: `purpose` set to `reference`,
then `file`, named `reference-song.mp3` or `reference-song.m4a` by the format
its header shows, with its MIME type (`audio/mpeg`, `audio/mp4`). The
answer's `id` is the `reference_id` of the request that follows. The song is
uploaded before the task is created, so a refused upload creates no task;
uploads are retried as polls are. Not sent: `url`, the address of a file,
since inputs come from the workspace.

### From a Description

`POST /v1/song/easy-generate` (Prompt to song), JSON: `model`, the id sent;
`prompt`, the description; `n`; and `reference_id` with a reference song.
Not sent: `styles` (Mureka's style chips, which the description can name),
`vocal_id`, and `stream`.

Prompt to song takes the model: its `model` takes the same values as Lyrics
to song's, `mureka-9.5` and `mureka-o2` among them. So the model the user
chose writes the lyrics and sings them, in one request, and BaseHalf does
not first ask Mureka's lyrics call (`POST /v1/lyrics/generate`) for lyrics
to sing. **Open:** whether Prompt to song takes `prompt` and `reference_id`
together; it documents neither a pair nor a refusal, and BaseHalf sends
both.

With Instrumental on: `POST /v1/instrumental/generate`, JSON: `model`,
`prompt`, and `n`. Not sent: `instrumental_id` (see the rules above) and
`stream`.

### From Lyrics

`POST /v1/song/generate` (Lyrics to song), JSON: `lyrics`, the prompt;
`model`; `n`; `prompt`, the Style, when it is set; and `reference_id` with a
reference song. Not sent: `gender`, `vocal_id`, `melody_id`, and `stream`.

### The task

Each create answers its task (`SongTask` or `InstrumentalTask`) with its
`id`, such as `"1436211"`. BaseHalf's id of the task names the query that
asks about it: `song/1436211` for Prompt to song and Lyrics to song,
`instrumental/1436211` for the instrumental call. A create is sent once, as
every create is ([providers, Requests](../providers.md#requests)).

## Task states

| Request | Pending | Running | Succeeded | Failed | Cancelled |
| --- | --- | --- | --- | --- | --- |
| `GET /v1/song/query/{id}`, or `GET /v1/instrumental/query/{id}` for an instrumental | `preparing`, `queued` | `running`, `streaming` | `succeeded`, with `choices` | `failed`, with `failed_reason`; `timeouted` | `cancelled` |

- A task that succeeded gives one song per choice, in the order of the
  choices' `index`: its `url`, valid for 30 days. The window downloads each
  at once. A choice without `url` is refused alone: "Mureka gives no
  address for this song."; a task that succeeded without choices is an
  answer BaseHalf cannot read. **Open:** Mureka does not say that `url` is
  an MP3; it names `flac_url` and `wav_url` as the lossless forms, and its
  speech examples serve MP3 from `cdn.mureka.ai`. A song that arrives in
  another format lands under the extension of its format
  ([providers, Audio format](../providers.md#audio-format)).
- `failed` ends the task with Mureka's `failed_reason`, or "Mureka reports
  that the task failed." without one. `timeouted` ends it as failed: "Mureka
  stopped the task because it took too long.", with the reason when Mureka
  gives one. `cancelled` ends it as cancelled.
- `streaming` is the phase of a request with `stream`, which BaseHalf does
  not send; it is read as running. Mureka reports no progress. Any other
  status is an answer BaseHalf cannot read.
- A task id that names no query (neither `song/` nor `instrumental/`) is
  refused, and nothing is asked.
- Mureka's addresses are on its file hosts, not on the API's origin, so
  their download carries no credentials; an address on the endpoint's
  origin, as a relay may give, gets them.

## Cancel

Mureka documents no cancellation. `cancel` answers false and sends nothing;
a task that the user stops runs to its end at Mureka.

## Errors

Mureka answers an error with its HTTP status and
`{"error": {"message"}, "trace_id"}` (quick start); the message is read
from `error.message`.

| Status | What Mureka says | Code of the contract |
| --- | --- | --- |
| 400 | "Invalid Request": the parameters are wrong | `rejected`, with Mureka's message |
| 401 | "Invalid Authentication" | `auth` |
| 403 | "Forbidden": a region Mureka does not serve | `rejected`: "Mureka does not serve requests from this region.", with Mureka's words in parentheses |
| 429 | "Rate limit reached for requests", also when the account runs more tasks at once than its top-up allows | `rateLimited`, followed by "Mureka works on only as many generations at once as the account's top-up allows: wait for one to finish." |
| 429 | "You exceeded your current quota, please check your billing details": no credits left | `balance` |
| 500, 503 | an error or an overload of Mureka's servers | by the status: a create's outcome is unknown, and a poll or an upload is asked again |

- A 403 is not about the key, so it is not `auth`, whose message would send
  the user to the credentials.
- The two answers of 429 are told apart by Mureka's words: one that speaks
  of the quota, the billing, or an insufficient balance or credits is
  `balance`. Mureka documents no 402; one would be `balance` too.
- Mureka's words refine a 4xx answer only, never 408 or 5xx, so that a
  create answered by a server error keeps its unknown outcome.
- Mureka documents no code for content that it refuses. A request it
  refuses is answered with a 4xx and its message (`rejected`); a task it
  stops ends as failed with its `failed_reason`.
- A 404 to a query is `notFound`, an unknown task.

## Left out

- `auto` and the older models (see Models).
- Extending, editing, remixing, and separating songs; a voice cloned for
  singing (`vocal_id`); a melody hummed or drawn (`melody_id`); music for a
  video or an image.
- An instrumental that follows a reference song (`instrumental_id`), which
  Mureka makes without a description.
- The singer's gender (`gender` of Lyrics to song): Style can name it, as
  Mureka's own example does ("r&b, slow, passionate, male vocal").
- Mureka's style chips (`styles` of Prompt to song): the description can
  name the style.
- Streaming (`stream`), the lossless files (`flac_url`, `wav_url`), and the
  timed lyrics of a song (`lyrics_sections`).
- Writing or extending lyrics alone (`/v1/lyrics/generate`,
  `/v1/lyrics/extend`): a note holds lyrics, and From a Description writes
  them with the song.
- A reference song by address (`url` of the upload).

## Acceptance criteria

1. Mureka is listed under Audio with Mureka 9.5 and Mureka O2, each making
   music in MP3 as a task, with From a Description and From Lyrics, Songs
   from 1 to 3 (2 by default), Style in From Lyrics, Instrumental in From a
   Description for Mureka 9.5 only, and a reference song of at most 10 MiB.
2. From a Description sends the description and the chosen model to Prompt
   to song, and with Instrumental on to the instrumental call; From Lyrics
   sends the prompt as `lyrics` and Style as `prompt` to Lyrics to song;
   Songs is `n` in every request.
3. A reference song is uploaded with the purpose `reference` before the
   task is created and sent as `reference_id`, in both modes; a refused
   upload creates no task.
4. A task is asked about at the query of its kind; a task that succeeded
   lands one song per choice, in the order of the choices, from an address
   that gets no credentials; `failed` and `timeouted` end it as failed with
   Mureka's reason, `cancelled` as cancelled.
5. `check` refuses a reference song that is not an MP3 or an M4A, larger
   than 10 MiB, or shorter than 30 seconds; a reference song with
   Instrumental on or with Style; Instrumental for Mureka O2; and a
   description longer than Mureka takes. Nothing is sent for a request it
   refuses.
6. A 403 says that Mureka does not serve the region; a 429 about the quota
   is `balance` and any other 429 `rateLimited`; a create is sent once, also
   when its answer never comes.

## Verification

`src/vs/platform/basehalfProviders/test/node/mureka.test.ts` runs the module
through the provider commands against local servers that answer like
Mureka's API and its file host:

- the catalog entry with its region, its models, modes, inputs, limits, and
  parameters, and the module last among the providers;
- the exact requests of each model and mode: the path, the credentials, and
  the body of Prompt to song, the instrumental call, and Lyrics to song, with
  and without Style, and the upload of a reference song as an MP3 and as an
  M4A before the task it is sent with;
- Songs of 1 and of 3, landing one song per choice in the order of the
  choices, downloaded without credentials;
- polls of a song and of an instrumental through every state, a task that
  failed and one that timed out, and a status BaseHalf does not know;
- Mureka O2 without Instrumental;
- refused keys, the region Mureka does not serve, too many requests, an
  empty balance, a refused request, a server error, an upload that is
  refused, a create whose answer never comes or whose connection drops,
  which is sent once and has an unknown outcome, and a poll whose answer
  never comes;
- `cancel`, which sends nothing, and a task id that names no query;
- the rules of `check`.

A generation with Mureka's own API is run by a person with their own key
before a release ([generation cards](../generation-cards.md#verification)).
