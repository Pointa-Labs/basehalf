# ElevenLabs

Status: Draft (2026-10-25, D78)
Decisions: [D78](../../decisions.md#d78--basehalf-makes-speech-music-and-sound-effects-with-the-same-cards-panel-and-providers-new-2026-10-25)
Parent: [Providers and the model catalog](../providers.md)

This specification owns the ElevenLabs module of the provider service
(`vscode-base/src/vs/platform/basehalfProviders/node/elevenlabs.ts`): the
speech and sound-effect models it declares, the voices it lists, the
requests it sends, and how it reads ElevenLabs' answers. What is the same for
every provider is owned by the parent specification and is not repeated
here.

## Sources

ElevenLabs' documentation at `https://elevenlabs.io/docs/`, read as its
Markdown pages (`<page>.md`), and its OpenAPI file at
`https://api.elevenlabs.io/openapi.json`, all read on 2026-10-25. The pages
carry no date of their own; the changelog entries of 2026 were read too.

| Page (path under `/docs/`) | What this specification takes from it |
| --- | --- |
| `overview/models` | the model ids, their character limits, the languages of each with the codes `language_code` takes, the deprecated Turbo models |
| `overview/capabilities/text-to-speech/eleven-v4` | Eleven v4 has two voice settings, Stability and Similarity: "Style and Speed sliders are not available in Eleven v4" |
| `eleven-creative/playground/text-to-speech` | the voice settings, their usual values, Speed from 0.7 to 1.2, and that Speed, Similarity, and Speaker Boost are "not available for the Eleven v3 model" |
| `api-reference/text-to-speech/convert` and the OpenAPI file (`Body_text_to_speech_full`, `VoiceSettingsResponseModel`) | `POST /v1/text-to-speech/{voice_id}`, its body, `voice_settings` with their ranges and defaults, `seed` (0 to 4294967295), `language_code` ("not supported for multilingual_v2 models"; an unsupported code "will be ignored"), `output_format` and the plans its formats need, the `audio/mpeg` answer |
| `api-reference/text-to-sound-effects/convert`, `overview/capabilities/sound-effects`, `help-center/product/core-capabilities/sound-effects/what-is-sound-effects` | `POST /v1/sound-generation` and its fields: `duration_seconds` from 0.5 to 30 or none ("we will guess the optimal duration"), `loop`, `prompt_influence` (0 to 1, 0.3), `model_id`; "There is a maximum length of 450 characters for your prompt" |
| `api-reference/voices/search` | `GET /v2/voices`, its paging (`page_size` at most 100, `next_page_token`, `has_more`, "Page 0 may include more voices due to default voices being included"), `include_total_count`, and the fields of a voice |
| `help-center/product/voices/my-voices/what-are-default-voices`, `.../how-do-i-access-eleven-labs-default-voices` | "All our Default voices will expire on December 31, 2026", they are "only available for accounts that were created before March 2026", and the new voices that replace them, "that you will be able to use forever" |
| `eleven-creative/voices/voice-library` | "Voice Library voices are not available via the API to free tier users"; "You can use voices from the Voice Library directly without saving them to My Voices" |
| `eleven-api/resources/errors`, `help-center/technical/api-error-code-400-or-401`, `-422`, `-429`, `help-center/account/general/what-does-unusual-activity-detected-...` | the shape of an error, its types and codes, the legacy `status` codes, and the message of a free plan that ElevenLabs stopped |
| `api-reference/authentication`, `eleven-api/quickstart`, `help-center/product/voices/my-voices/why-cant-i-access-my-voices-via-third-party-services` | `xi-api-key`, keys restricted by scope, credit quota, and IP allowlist (403), the page where keys are made, and the permissions Voices (read) and Text to Speech |

## Regions and credentials

- One region, `global` (**Global**), base URL `https://api.elevenlabs.io`,
  which ElevenLabs routes to the nearest place. Its other hosts
  (`https://api.us.elevenlabs.io`, and the data-residency hosts such as
  `https://api.eu.residency.elevenlabs.io`, which belong to Enterprise
  accounts with keys of their own) are reached by entering one as the
  endpoint.
- The console is `https://elevenlabs.io/app/api/api-keys`, where the
  quickstart sends developers to make a key.
- One credential, the API key (`apiKey`, **API Key**), sent as
  `xi-api-key: <key>`.
- A key may be restricted to some endpoints, a credit quota, and an IP
  allowlist. BaseHalf calls Text to Speech, Sound Effects, and the list of
  voices, whose permission is Voices (read); a key without one is refused
  for that call, and the answer says which permission it lacks
  ([Errors](#errors)).

## Models

| Catalog id | Label | Sent (`model_id`) | Makes | Prompt | Languages (`language_code`) |
| --- | --- | --- | --- | --- | --- |
| `eleven-v4` | Eleven v4 | `eleven_v4` | speech | at most 10,000 characters | the 84 of the models page |
| `eleven-v3` | Eleven v3 | `eleven_v3` | speech | at most 5,000 characters | the same and Chichewa (`ny`), 85 |
| `eleven-multilingual-v2` | Multilingual v2 | `eleven_multilingual_v2` | speech | at most 10,000 characters | none: it takes no `language_code` |
| `eleven-flash-v2.5` | Flash v2.5 | `eleven_flash_v2_5` | speech | at most 40,000 characters | the 29 of Multilingual v2, Hungarian, Norwegian, and Vietnamese, 32 |
| `eleven-text-to-sound-v2` | Sound Effects | `eleven_text_to_sound_v2` | sound | at most 450 characters | – |

- Every model is of kind `audio`, answers at once (`answersAtOnce`), and
  delivers MP3 (`outputFormat: mp3`). It offers the one mode `reference`,
  labeled **Speech** or **Sound Effects**, with no inputs: no images, no
  videos, and no audio. The prompt is required: it is what the voice says,
  or the description of the sound.
- Eleven v4 and Eleven v3 read audio tags in the text, such as
  `[whispers]`; they are the user's words and are sent as written.
- ElevenLabs' models page lists the languages of each model with their
  codes. The FAQ of Eleven v4 names a somewhat different list without codes;
  the catalog follows the models page, since it gives the codes the request
  sends.
- The sound-effect prompt's 450 characters are those of ElevenLabs' own
  app; the API reference states no limit. The catalog takes the documented
  one.
- No model is deprecated. Not offered: Eleven v4 Turbo and Eleven v3
  Conversational, documented for ElevenLabs' real-time dialogue WebSocket;
  Flash v2 (`eleven_flash_v2`), which speaks English only and which Flash
  v2.5 covers; the deprecated Turbo models; and `eleven_text_to_sound_v3`,
  which appears only in the API's enumeration and is documented nowhere.

## Parameters

| Name | Label | Kind | Values | Default | Models | Sent as |
| --- | --- | --- | --- | --- | --- | --- |
| `voice` | Voice | voice, listed | the voices below, and any voice the account lists | `6WwXjDDEMyNmFG95zycZ` (Eldrin) | speech | the path's `{voice_id}` |
| `speed` | Speed | number, 0.7 to 1.2, step 0.05 | | 1 | Multilingual v2, Flash v2.5 | `voice_settings.speed` |
| `stability` | Stability | number, 0 to 1, step 0.01 | | 0.5 | Eleven v4, Multilingual v2, Flash v2.5 | `voice_settings.stability` |
| `stability` | Stability | choice | Creative (`0`), Natural (`0.5`), Robust (`1`) | Natural | Eleven v3 | `voice_settings.stability` |
| `similarity_boost` | Similarity | number, 0 to 1, step 0.01 | | 0.75 | Eleven v4, Multilingual v2, Flash v2.5 | `voice_settings.similarity_boost` |
| `style_exaggeration` | Style Exaggeration | number, 0 to 1, step 0.01, advanced | | 0 | Multilingual v2, Flash v2.5 | `voice_settings.style` |
| `use_speaker_boost` | Speaker Boost | boolean, advanced | | on | Multilingual v2, Flash v2.5 | `voice_settings.use_speaker_boost` |
| `language_code` | Language | choice, optional, advanced | the model's languages, by their English names | not set | Eleven v4, Eleven v3, Flash v2.5 | `language_code` |
| `seed` | Seed | whole number, 0 to 2147483647, optional, advanced | | not set | speech | `seed` |
| `duration` | Duration | whole seconds, 1 to 30, with Auto (`-1`) | | Auto | Sound Effects | `duration_seconds`; Auto sends nothing |
| `loop` | Loop | boolean | | off | Sound Effects | `loop` |
| `prompt_influence` | Prompt Influence | number, 0 to 1, step 0.01, advanced | | 0.3 | Sound Effects | `prompt_influence` |

- Each model is sent exactly the voice settings it takes. Eleven v4 takes
  Stability and Similarity, and neither Style nor Speed. Eleven v3 takes
  Stability: ElevenLabs' guide says Speed, Similarity, and Speaker Boost are
  not available for it. Multilingual v2 and Flash v2.5 take all five.
- `speed`, `voice`, `seed`, and `duration` are shared names. ElevenLabs'
  own settings keep its fields' names, except style exaggeration, which is
  `style_exaggeration`, since the shared `style` is the style of a song.
- The defaults are the API's: Stability 0.5, Similarity 0.75, Style
  Exaggeration 0, Speaker Boost on, Speed 1, Prompt Influence 0.3. ElevenLabs'
  guide reads Stability and Similarity on a scale of 100 ("stability around
  50, similarity around 75"); the catalog steps the settings of 0 to 1 by
  0.01.
- **Unconfirmed: Eleven v3's stability.** ElevenLabs' app offered three
  stability presets for Eleven v3, Creative, Natural, and Robust, as an
  earlier version of the best-practices page described them; the pages read
  on 2026-10-25 no longer describe them, and the API reference gives 0 to 1
  for every model. The catalog offers the three as 0, 0.5, and 1, which the
  API's range takes in any case.
- **Unconfirmed: Style Exaggeration on Eleven v3.** The guide names what
  Eleven v3 lacks and is silent on Style Exaggeration, which it recommends
  keeping at 0 at all times. The catalog does not offer it for Eleven v3.
- **Unconfirmed: the range of Style Exaggeration.** The API states no
  bounds for `style`, where it states 0 to 1 for Stability and Similarity;
  the catalog takes 0 to 1 for it too.
- Speed is offered from 0.7 to 1.2, the range of ElevenLabs' guide; the API
  states none. The guide's FAQ calls Speed "available for all voices and all
  models", which its own note on Eleven v3 and the Eleven v4 page
  contradict; the catalog follows the notes.
- ElevenLabs takes seeds up to 4294967295; the shared seed is 0 to
  2147483647. A seed does not guarantee the same take.
- `language_code` is not offered for Multilingual v2, which does not take
  it. ElevenLabs ignores a code that a model does not support. Not set,
  ElevenLabs tells the language from the text. The labels are ElevenLabs'
  English names of the languages.
- No rule joins two parameters: `check` adds no problem of its own.

### Voices of the catalog

| Voice id | Label | Description | Replaces the Default voice |
| --- | --- | --- | --- |
| `6WwXjDDEMyNmFG95zycZ` | Eldrin | Crisp British baritone | George, whom ElevenLabs' quickstart speaks in |
| `WQP7cQUF5aAS6Axh5yaa` | Elara | Crisp pro narrator | Laura |
| `OZ0L6eISlOejga3XjDFt` | Talia | Warm, soft guide | Sarah |
| `gOupLcAkjEnguROwi4oS` | Darian | Warm, grounded storyteller | Roger |
| `BFd5oBc2DDna33pSi4Gf` | Alicia | Polished global anchor | Alice |
| `fnYMz3F5gMEDGMWcH1ex` | Finley | Articulate anchor | Daniel |

- **No voice is in every account.** ElevenLabs' Default voices (category
  `premade`) are only available for accounts created before March 2026, and
  all of them expire on December 31, 2026. ElevenLabs names a new voice of
  its Voice Library to replace each, which "you will be able to use
  forever", and a Voice Library voice is used directly by its id, without
  saving it. So the catalog declares six of those voices, Eldrin, the
  replacement of the quickstart's George, being the default.
- **A free account.** "Voice Library voices are not available via the API
  to free tier users", so a free account is refused the catalog's voices;
  ElevenLabs' answer says so ([Errors](#errors)), and the voice menu lists
  the account's own voices and the Default voices it still has, which the
  user chooses instead. Whether ElevenLabs makes these replacement voices an
  exception for free accounts is unconfirmed.

## Requests

**Speech.** `POST /v1/text-to-speech/{voice_id}?output_format=mp3_44100_128`,
the voice id encoded as a path segment, with `Accept: audio/mpeg` and JSON:

```json
{
	"text": "Welcome to the coast.",
	"model_id": "eleven_v4",
	"voice_settings": { "stability": 0.5, "similarity_boost": 0.75 },
	"seed": 7,
	"language_code": "en"
}
```

- `voice_settings` holds exactly the model's settings above: `stability`
  alone for Eleven v3, and `stability`, `similarity_boost`, `style`,
  `use_speaker_boost`, and `speed` for Multilingual v2 and Flash v2.5. Every
  one is sent, so the voice's own stored settings never decide the take.
- `seed` and `language_code` are sent when they are set.
- MP3 at 44.1 kHz and 128 kbps is the best MP3 that every plan may ask for:
  "MP3 with 192kbps bitrate requires you to be subscribed to Creator tier or
  above", and WAV and PCM at 44.1 kHz need Pro.
- Not sent: `enable_logging` (zero retention is for Enterprise customers),
  `optimize_streaming_latency` (deprecated), `apply_text_normalization`
  (its default, `auto`, decides), `apply_language_text_normalization`,
  `previous_text`, `next_text`, and the request ids around a take,
  pronunciation dictionaries, `use_pvc_as_ivc`, `audio_effects`, and
  `clone_strength` ([Left out](#left-out)).

**Sound effects.** `POST /v1/sound-generation?output_format=mp3_44100_128`,
with `Accept: audio/mpeg` and JSON
`{text, model_id: "eleven_text_to_sound_v2", loop, prompt_influence}`, and
`duration_seconds` when Duration is not Auto. A whole number of seconds
leaves out only the API's floor of 0.5 seconds.

**Answer.** The body is the MP3 itself. It is the one output, written to the
request's target under the checks of a sound, and the bytes decide its
format. An empty body leaves the outcome unknown: "ElevenLabs accepted the
request but answered no sound." There is no task: `poll` refuses one, and
`cancel` answers false and sends nothing.

**Names in the prompt.** No model takes an input, so a prompt mentions
nothing; the window has written the notes the prompt speaks
([providers](../providers.md#names-in-the-prompt)).

## Voices

`voices` asks `GET /v2/voices?page_size=100&include_total_count=false`, then
the same with the `next_page_token` of each answer while it says
`has_more`:

- every voice of the answer, in ElevenLabs' order: `voice_id` is the id,
  `name` the label, and `preview_url` the sample;
- the description joins the voice's labels `gender`, `age`, `accent`,
  `descriptive` (or `description`), and `use_case`, in that order, each with
  `_` read as a space and its first letter in upper case, such as "Male,
  Middle aged, British, Warm, Narrative story"; a voice without those
  labels has its own `description`, as `voices` shortens it;
- `own` is true for every category but `premade`, the Default voices:
  cloned, generated (designed), professional, and the Voice Library voices
  the user saved to My Voices;
- the list stops when the answer has no more, at more than 2,000 voices
  (`truncated`), at a page token it was given before, and after 22 pages,
  which is more than 2,000 voices take even with the Default voices on the
  first page;
- `include_total_count=false` spares ElevenLabs the count, which the list
  does not use.

ElevenLabs' samples are addresses on its storage, not on the API's origin, so
`voicePreview` fetches them without the key, as the parent specification
requires of every sample. The Voice Library (`GET /v1/shared-voices`) is not
listed: it holds thousands of voices that change, and a voice saved from it
is listed among the account's own.

## Errors

ElevenLabs answers an error with `detail`:

- `{type, code, message, status, request_id, param}`, its current shape,
  where `status` repeats the code;
- `{status, message}`, the legacy shape, where `status` is the code;
- a list of `{loc, msg, type}` for a request that does not validate (422);
- or a plain text.

The module reads the code (`code`, or else `status`) and ElevenLabs'
message. The codes refine a 4xx answer only, never 408 or 5xx, so that a
create answered by a server error keeps its unknown outcome:

| Code or answer | Code of the contract | Message |
| --- | --- | --- |
| `invalid_api_key`, `missing_api_key`, and any other 401 | `auth` | ElevenLabs' |
| `insufficient_permissions`, and `missing_permissions` (as ElevenLabs answers a key without a permission; not in its error table) | `auth` | "The API key lacks a permission that this needs: …" with ElevenLabs' words, and that the key's permissions are set on ElevenLabs' API keys page |
| `quota_exceeded` (also with 401) and `insufficient_credits` | `balance` | ElevenLabs' |
| 402 with another code than these and `payment_required`, since a 402 is "insufficient credits or payment is required" | `rejected` | "The plan of this ElevenLabs account does not include this: …" |
| 402 without a code, or with `payment_required` | `balance` | ElevenLabs' |
| `subscription_required` and `feature_not_available` (403) | `rejected` | the same |
| a message that says "Free Tier usage disabled" | `rejected` | ElevenLabs stopped the account's free plan, as it does when it notices unusual activity, such as a VPN or a network that others share; a paid plan is not affected |
| `voice_not_found` (400 or 404) | `rejected` | "ElevenLabs does not know this voice, or this account cannot use it: choose another voice." with ElevenLabs' words |
| `voice_access_denied` | `rejected` | "This ElevenLabs account may not use this voice: choose another voice." with ElevenLabs' words |
| `too_many_concurrent_requests`, `concurrent_limit_exceeded` | `rateLimited` | ElevenLabs runs as many requests of the account at once as its plan allows; wait for them to finish |
| `system_busy` | `rateLimited` | "ElevenLabs is busy: generate again in a moment." |
| a list (422) | `rejected` | "ElevenLabs refused the request: " and each `loc` with its `msg` |
| any other 4xx | as its status | ElevenLabs' |
| 500, 503, a dropped connection, or no answer within ten minutes | `unknownOutcome` for a create | |

- A 403 without a code above, such as an address the key's IP allowlist
  does not name, is `auth`.
- The code of the stopped free plan is not documented; its message is, and
  the module recognizes it by that.
- Nothing is sent again: a create is sent once.

## Left out

- Music, for the reason D78 gives; dialogue with several voices (Text to
  Dialogue); changing the voice of a recording; dubbing; voice cloning and
  voice design.
- Clone Strength (`clone_strength`), which applies only to Professional
  Voice Clones fine-tuned for Eleven v4, and which ElevenLabs recommends
  leaving at 0: a model's settings do not depend on its voice.
- Text normalization (`apply_text_normalization`, whose `on` for Flash v2.5
  is for Enterprise), pronunciation dictionaries, the text around a take for
  continuity, and audio effects.
- Other output formats: MP3 at 192 kbps and WAV at 44.1 kHz need paid
  plans, and an audio model delivers MP3 where the provider offers it
  ([providers, Audio format](../providers.md#audio-format)).
- The Voice Library's own list, and adding a library voice to My Voices.
- Streaming, timestamps, and WebSockets.

## Acceptance criteria

1. The catalog lists ElevenLabs after OpenAI, with the four speech models
   and Sound Effects of the table, each MP3, answered at once, without
   inputs, with its character limit, and each speech model with its listed
   voice, the six voices above, and Eldrin as the default.
2. Each speech model is sent to `/v1/text-to-speech/{voice}` with
   `output_format=mp3_44100_128` and exactly its voice settings, a seed and
   a language only when set, and writes the MP3 it answers to its target;
   Sound Effects is sent to `/v1/sound-generation` with `loop`,
   `prompt_influence`, and `duration_seconds` unless Duration is Auto.
3. `voices` follows `next_page_token` while `has_more`, marks every voice
   but the Default ones as the account's, describes each from its labels,
   gives its `preview_url` as its sample, and answers at most 2,000.
4. A wrong key, a key without a permission, an empty balance, a plan or a
   free plan that refuses, a missing voice, a request that does not
   validate, too many requests at once, a server error, a dropped
   connection, and a request that never answers map as above, each sent
   once.
5. No request to a sample's address carries the key.

## Verification

`src/vs/platform/basehalfProviders/test/node/elevenlabs.test.ts` runs the
module through the provider commands against local servers that answer like
ElevenLabs' API and its storage, as the
[parent specification](../providers.md#verification) requires: the catalog
entry and its place among the providers, the request of each model with its
headers, query, and body, the MP3 answered at once, the default voice, the
pages of voices with the account's and ElevenLabs' own, their descriptions
and samples, a sample fetched without the key, the errors above, a request
that never answers, and that `poll` and `cancel` send nothing.
