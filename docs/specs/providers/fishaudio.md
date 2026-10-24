# Fish Audio

Status: Draft (2026-10-25, D78)
Decisions: [D78](../../decisions.md#d78--basehalf-makes-speech-music-and-sound-effects-with-the-same-cards-panel-and-providers-new-2026-10-25)
Parent: [Providers and the model catalog](../providers.md)

This specification owns the Fish Audio module of the provider service
(`vscode-base/src/vs/platform/basehalfProviders/node/fishaudio.ts`): the
speech models it declares, the voices it lists, the requests it sends, and
how it reads Fish Audio's answers. What is the same for every provider is
owned by the parent specification and is not repeated here.

## Sources

Fish Audio's documentation at `https://docs.fish.audio/`, read as its
Markdown pages (`<page>.md`), and its OpenAPI file at
`https://api.fish.audio/openapi.json`, all read on 2026-10-25. The pages
carry no date of their own.

| Page (path) | What this specification takes from it |
| --- | --- |
| `api-reference/endpoint/openapi-v1/text-to-speech` and the OpenAPI file (`TTSRequest`) | `POST /v1/tts`, the `model` header ("If omitted or set to an unrecognized value, the request falls back to `s2.1-pro`"), the JSON body, `prosody.speed` (0.5 to 2), `temperature` and `top_p` (0 to 1, 0.7), `format`, `mp3_bitrate` (64, 128, or 192), `latency`, the answer of audio bytes |
| `developer-guide/core-features/text-to-speech` | the models, speed from 0.5 to 2, the formats and bitrates, and `latency`, whose default this guide gives as `balanced` and the API reference as `normal` |
| `developer-guide/getting-started/quickstart`, `developer-guide/resources/migration` | a request without `reference_id` speaks in "the default voice", "the model's default voice" |
| `features/text-to-speech/drama-3` | Drama 3, its directions, and the public voices Adrian, Delia, and Sheila that its examples use |
| `developer-guide/models-pricing/models-overview`, `choosing-a-model`, `deprecations` | S2.1 Pro, S2.1 Pro Free, S2 Pro, and S1, which retires on 2026-12-31 |
| `api-reference/endpoint/model/list-models`, `features/manage-voices`, `developer-guide/sdk-guide/cookbook/discover-library-voice`, `api-reference/sdk/python/types` | `GET /model` with `self`, `licensed` ("only voices licensed by Fish Audio (rights secured from the voice owner)"), `sort_by`, `page_size` (at most 100), and `page_number`; the answer's `total`, `items`, and `has_more`; a voice's `_id`, `type`, `title`, `state`, `tags`, `languages`, and `samples`, whose `audio` is a "URL or path to the audio file"; "Any public voice `id` works as `reference_id`" |
| `api-reference/errors`, `api-reference/introduction` | errors as `{message, status}` and the meaning of 400, 401, 402, 403, 404, 429, and 5xx; where keys are made |
| `developer-guide/models-pricing/pricing-and-rate-limits` | a limit of requests at once by account, and 429 "without a `Retry-After` header" |
| `https://fish.audio/plan/` (Fish Audio's plans) | the most characters one generation takes in Fish Audio's app: 500, 15,000, and 30,000 by plan |

## Regions and credentials

- One region, `global` (**Global**), base URL `https://api.fish.audio`, the
  only server of the OpenAPI file.
- The console is `https://fish.audio/app/api-keys/`.
- One credential, the API key (`apiKey`, **API Key**), sent as
  `Authorization: Bearer <key>`. The API is paid as used, from the credits of
  the account, without a subscription.

## Models

| Catalog id | Label | `model` header | Languages |
| --- | --- | --- | --- |
| `drama-3` | Drama 3 | `drama-3` | not stated |
| `s2.1-pro` | S2.1 Pro | `s2.1-pro` | 83 |
| `s2-pro` | S2 Pro | `s2-pro` | more than 80 |

- Every model is of kind `audio`, makes speech, answers at once
  (`answersAtOnce`), and delivers MP3 (`outputFormat: mp3`). It offers the
  one mode `reference`, labeled **Speech**, with no inputs. The prompt is
  required.
- The model is chosen by the `model` header of `POST /v1/tts`, which the
  module always sends: Fish Audio serves a missing or unknown model as S2.1
  Pro, and bills it as such, without an error.
- Drama 3 takes directions in square brackets before a line, sounds and
  pauses in brackets, and paired tags such as `<whisper>…</whisper>`; S2.1
  Pro and S2 Pro take free-form cues in brackets, such as `[whispers
  sweetly]`. They are the user's words and are sent as written.
- **The prompt is at most 30,000 characters.** Fish Audio states no longest
  text for its API, and a request answered at once must end within ten
  minutes ([providers, Requests](../providers.md#requests)). BaseHalf takes
  the most that Fish Audio's own app takes in one generation, 30,000
  characters (its Pro plan); the API's own limit is unconfirmed.
- Not offered: S1 (`s1`), which retires on 2026-12-31 and is then served as
  S2.1 Pro; and S2.1 Pro Free (`s2.1-pro-free`), the same model as S2.1 Pro
  for testing and development, without its guarantees of latency.

## Parameters

| Name | Label | Kind | Values | Default | Sent as |
| --- | --- | --- | --- | --- | --- |
| `voice` | Voice | voice, listed | the voices below, and any voice Fish Audio lists | `default` (Default Voice) | `reference_id`, left out for `default` |
| `speed` | Speed | number, 0.5 to 2, step 0.05 | | 1 | `prosody.speed` |
| `temperature` | Temperature | number, 0 to 1, step 0.01, advanced | | 0.7 | `temperature` |
| `top_p` | Top P | number, 0 to 1, step 0.01, advanced | | 0.7 | `top_p` |

- `speed` and `voice` are shared names; `temperature` and `top_p` are Fish
  Audio's fields. The ranges and defaults are those of `TTSRequest`. Every
  model takes the same parameters.
- No rule joins two parameters: `check` adds no problem of its own.

### Voices of the catalog

| Voice id | Label | Description |
| --- | --- | --- |
| `default` | Default Voice | The voice the model speaks in when none is chosen |
| `bf322df2096a46f18c579d0baa36f41d` | Adrian | American English, male |
| `c70cfb98867a4bfb9ae20d2401257b92` | Delia | American English, female |
| `f3a2b90078d54a65af4b95f63bc7798e` | Sheila | American English, female |

- **The default sends no voice.** Fish Audio speaks in "the model's default
  voice" when a request has no `reference_id`. The catalog's default,
  `default`, is that voice: the module leaves `reference_id` out of the
  request for it, so a draft speaks before the user has chosen a voice, in
  every account. A voice id of Fish Audio is 32 hexadecimal characters, so
  `default` names no other voice. Which voice the default is, Fish Audio
  does not say.
- Adrian, Delia, and Sheila are the public voices of Fish Audio's Drama 3
  page, described as it describes them ("EN-US, male"); any public voice is
  used by its id, and nothing is saved to the account.

## Requests

`POST /v1/tts` with `Authorization: Bearer <key>`, `model: <the model's
header>`, `Accept: audio/mpeg`, and JSON:

```json
{
	"text": "Welcome to the coast.",
	"reference_id": "bf322df2096a46f18c579d0baa36f41d",
	"prosody": { "speed": 1 },
	"temperature": 0.7,
	"top_p": 0.7,
	"format": "mp3",
	"mp3_bitrate": 192,
	"latency": "normal"
}
```

- `reference_id` is the voice, left out for the default voice.
- MP3 at 192 kbps is the highest bitrate Fish Audio offers, and it names no
  plan or tier that may not ask for it; the sample rate is the format's own,
  44.1 kHz.
- `latency: "normal"` is sent because the guide and the API reference
  disagree on the default, and the reference calls `normal` "best quality".
- Not sent: `references` (inline voice references need a MessagePack body),
  `prosody.volume` and `normalize_loudness`, `chunk_length`, `normalize`,
  `language` (it only changes how numbers and symbols are spelled out, and
  Fish Audio detects the language), `sample_rate`, `max_new_tokens`,
  `repetition_penalty`, `min_chunk_length`, `condition_on_previous_chunks`,
  `early_stop_threshold`, `features`, and pronunciation dictionaries; each
  keeps Fish Audio's default.

**Answer.** The body, sent in chunks, is the MP3 itself. It is the one
output, written to the request's target under the checks of a sound, and
the bytes decide its format. An empty body leaves the outcome unknown:
"Fish Audio accepted the request but answered no sound." There is no task:
`poll` refuses one, and `cancel` answers false and sends nothing.

**Names in the prompt.** No model takes an input, so a prompt mentions
nothing ([providers](../providers.md#names-in-the-prompt)).

## Voices

`voices` lists, with `GET /model?page_size=100&page_number=<n>` from page 1:

1. **The account's voices** (`self=true`), every page: the voices the user
   made or saved in Fish Audio, marked as its own.
2. **Fish Audio's library**, only the voices whose rights Fish Audio secured
   from their owners (`licensed=true`), best first (`sort_by=score`), page
   after page while the list holds fewer than 2,000 voices, so that it
   stays within what `voices` answers; a library with more is `truncated`.
   When the account's voices alone fill the 2,000, the library is not
   asked, and the list is `truncated`.

- A page has more after it while the answer says `has_more`; an answer
  without `has_more` has more while its `total` is above the voices of the
  pages read; an empty page ends the list.
- A library page that Fish Audio refuses after the first ends the list
  there, as truncated: the answer carries paging fields that the
  documentation does not explain (`max_offset`, `accessible_upper_bound`,
  `window_limited`), which suggest that Fish Audio does not serve every
  page of a long list. A refused first page fails `voices`, and so does any
  refused page of the account's voices.
- Each voice: `_id` is the id and `title` the label. Only a voice of
  speech (`type` `tts`) that is ready (`state` `trained`) and not taken
  down is listed.
- The description joins the English names of its `languages` (`en` is
  English) and its `tags`, as "English, Japanese · Male, Narration"; a voice
  without either has its own `description`, as `voices` shortens it.
- The sample is the `audio` of the first of the voice's samples whose
  `audio` is an address. The SDK's types call it a "URL or path", and only
  an address is kept ([providers, Requests](../providers.md#requests)); a
  path, whose host is undocumented, is skipped, and a voice whose samples
  are all paths has none.
- A voice of the account that is also in the library is listed once, as
  the account's.

## Errors

Fish Audio answers an error as `{message, status}`; an error of the network
in front of the API may not be JSON. The module reads `message`, and the
HTTP status decides the code of the contract as the parent specification
says:

| Status | Fish Audio means | Code of the contract | Message |
| --- | --- | --- | --- |
| 400 | invalid parameters, or a `reference_id` that does not exist | `rejected` | Fish Audio's; when a voice was sent and the message says it was not found or does not exist, that Fish Audio has no such voice that this account can use, with its id, and to choose another voice, with Fish Audio's words |
| 401 | an invalid or missing key | `auth` | Fish Audio's |
| 402 | too few credits | `balance` | Fish Audio's |
| 403 | not permitted for this key or this resource | `auth`; with a voice, `rejected` | with a voice, that Fish Audio does not let this key use the voice, with its id, and to choose another voice, with Fish Audio's words |
| 404 | the model or the voice is not found | `rejected` | with a voice, the voice is missing, as for 400 |
| 422 | a request that does not validate | `rejected` | Fish Audio's |
| 429 | the account runs as many requests at once as it may | `rateLimited` | Fish Audio runs as many requests of the account at once as it allows; wait for them to finish |
| 500, 503, a dropped connection, or no answer within ten minutes | | `unknownOutcome` for a create | |

- A missing or unknown model never fails (it is served as S2.1 Pro), so a
  404 of a request with a voice is the voice.
- How Fish Audio words a missing voice in a 400 is not documented: the
  module looks for "not found" or "not exist" in its message.
- Nothing is sent again: a create is sent once. The list of voices is
  retried as a poll is.

## Left out

- Inline voice references, which need a MessagePack body, and voice
  models made from BaseHalf (D78); voice design.
- Dialogue with several voices (`reference_id` as a list and speaker tags).
- Fish Audio's other fields of `/v1/tts`, which keep their defaults
  ([Requests](#requests)), other formats (WAV, PCM, Opus), streaming,
  timestamps, and the WebSocket.
- S1 and S2.1 Pro Free ([Models](#models)).
- The rest of Fish Audio's library: voices whose rights Fish Audio did not
  secure.

## Acceptance criteria

1. The catalog lists Fish Audio after ElevenLabs, with Drama 3, S2.1 Pro,
   and S2 Pro, each MP3, answered at once, without inputs, with its listed
   voice, the four voices above, and the Default Voice as the default.
2. Each model is sent to `/v1/tts` with its `model` header and the JSON
   body above, without `reference_id` for the default voice and with it for
   any other, and writes the MP3 it answers to its target.
3. `voices` lists the account's voices on every page first, then the
   licensed library by score as far as 2,000 voices, with their
   descriptions and samples, only ready voices of speech, each once.
4. A wrong key, an empty balance, a voice that is missing or not the key's
   to use, a request that does not validate, too many requests, a server
   error, a dropped connection, and a request that never answers map as
   above, each sent once.
5. No request to a sample's address carries the key.

## Verification

`src/vs/platform/basehalfProviders/test/node/fishaudio.test.ts` runs the
module through the provider commands against local servers that answer like
Fish Audio's API and its storage, as the
[parent specification](../providers.md#verification) requires: the catalog
entry and its place among the providers, the request of each model with its
headers and body, the default voice and a chosen one, the MP3 answered at
once, the pages of the account's voices and of the library, their
descriptions and samples, a sample fetched without the key, the errors
above, a request that never answers, and that `poll` and `cancel` send
nothing.
