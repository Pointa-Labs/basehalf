# Providers and the model catalog

Status: Draft (2026-10-22; video providers active since 2026-10-19; no price, 2026-10-21; image models, D64; each module names the inputs of a prompt, 2026-10-24, D74; audio models, voices, and three new providers, 2026-10-25, D78)
Decisions: [D59](../decisions.md#d59--video-providers-are-built-in-integrations-with-each-models-exact-settings-users-bring-their-own-keys-new-2026-10-19),
[D61](../decisions.md#d61--basehalf-shows-no-price-new-2026-10-21),
[D64](../decisions.md#d64--basehalf-generates-images-with-the-same-cards-panel-and-providers-new-2026-10-22),
[D70](../decisions.md#d70--what-the-inputs-leave-room-for-is-what-the-settings-offer-and-generate-says-why-it-cannot-run-where-it-is-new-2026-10-24),
[D74](../decisions.md#d74--a-prompt-mentions-its-inputs-files-and-each-provider-module-names-them-as-its-model-reads-them-new-2026-10-24),
[D78](../decisions.md#d78--basehalf-makes-speech-music-and-sound-effects-with-the-same-cards-panel-and-providers-new-2026-10-25)
Related: [generation cards](generation-cards.md),
[built-in AI Video and no plugins](built-in-ai-video-and-no-plugins.md),
[BaseHalf's pages in Settings](settings-pages.md) (how Settings opens at the
Providers page)

This specification owns which providers BaseHalf runs, the catalog that
declares their image, video, and audio models, the credentials users enter
for them, the voices a speech model speaks in, and how a request reaches a
provider and comes back. The
[generation cards](generation-cards.md) specification owns the card, its
panel, and the life of a generation; it reads everything about providers and
models from the catalog described here.

## Problem

D58 gave the window a table of nine models and let users type any other model
id into a "channel". The table decided which settings the panel showed, how
settings changed between models, and which inputs a mode took; the request
formats lived in the AI Video extension; a general profile guessed for every
model the table did not know. The same knowledge sat in four places that had
to agree, and a new model, such as a new Seedance version, either needed a
change in several of them or ran on a guess.

A node-graph tool for generative media keeps one integration per provider,
on the provider's own API, and declares every model with its exact
parameters next to the code that calls it. Every control is drawn from those
declarations. Its catalog stays right because one team owns it and ships it
with each release. BaseHalf takes that design, with two differences: users
bring their own keys and pay their providers directly, and BaseHalf shows no
price (D61).

Until D64 the catalog held only video models, and BaseHalf made no images,
although ten of its twelve video providers sell image models under the same
key. Until D78 it held no audio models, and BaseHalf made no sound apart from
the sound of a video.

## Goals

- One source of truth: each provider module of the provider service
  declares its models and calls its API. Nothing in the window knows a
  provider or a model. The catalog and every request and answer have one
  definition, which the window and the service share (D75).
- Every model runs with exactly the options its provider accepts, and the
  panel offers nothing else.
- Users set up a provider once: a region, their own credentials, and, when
  they use a relay or a private gateway, its endpoint. The same setup serves
  the provider's image, video, and audio models, and lists the voices of the
  user's account.
- Inputs reach the provider without any service of BaseHalf in between.

## Non-goals

- A service, proxy, credit balance, or storage of BaseHalf's own.
- Models a provider offers that the catalog does not list. They come with a
  release.
- User-written request scripts, and a general format for relays. A relay that
  mirrors a provider's own API is used through that provider.
- Inputs that a provider takes only as public URLs and for which it has no
  upload endpoint. Such inputs are not offered for that provider.
- Editing tools that are not generation: upscaling, background removal,
  masks, layers, lip sync on an existing video, changing the voice of a
  recording, dubbing, stems, and extending or editing a song.
- Making a voice from BaseHalf, by cloning a recording or describing it. A
  voice is made in the provider's own app, which asks for the speaker's
  consent and stores the voice; it then is among the voices of the account
  ([Voices](#voices)).
- A stream without an end, such as live music, which has no file.
- A ChatGPT or Codex login as credentials. OpenAI's Sign in with ChatGPT
  offers no image generation, and BaseHalf never reads or forwards the login
  of the user's Codex (D64).
- Compatibility with D58 channels or `.bhnode` settings. The product has not
  launched.
- A price, an estimate, or a currency (D61). What a generation costs is in
  the provider's console, where the user gets the key.

## Terms

- **Provider**: a company's API for generative media, such as ByteDance's
  ModelArk.
- **Region**: one deployment of a provider with its own base URL and keys,
  such as Volcengine Ark (China) and BytePlus ModelArk (international) for
  ByteDance.
- **Credentials**: what the provider needs to accept a request, usually one
  API key; some need two values.
- **Endpoint**: the base URL requests go to. It is the region's base URL
  unless the user enters another one.
- **Model**: an entry of the catalog, such as Seedance 2.5 or Seedream 5.0
  Pro. Its id is stable in BaseHalf; the id sent to the provider may differ by
  region. Its **kind** is `image`, `video`, or `audio`; an audio model also
  says what it **makes**: `speech`, `music`, or `sound` (sound effects).
- **Mode**: how the card's inputs are used: `frames`, `reference`, `extend`,
  `edit`, or `lyrics` ([Modes and inputs](#modes-and-inputs)).
- **Parameter**: a setting a model declares, such as `resolution`.
- **Voice**: a voice a speech model speaks in: one of the provider's own, or
  one of the user's account, which the user cloned, designed, or saved in the
  provider's app. Its id is the provider's.
- **Output**: one file a generation makes. A video model makes one; an image
  model and a music model make as many as their `count`.

## The catalog

The provider service builds the catalog from its provider modules and
answers it to the window ([Requests](#requests)). The window asks once per
window and keeps the answer; it changes only when the application changes. The same
catalog reaches agents through `basehalf --list-capabilities`
([generation cards, Agents](generation-cards.md#agents)). Labels,
descriptions, and tooltips are in the window's display language.

### Provider

```json
{
	"id": "bytedance",
	"label": "ByteDance",
	"regions": [
		{ "id": "cn", "label": "China · Volcengine Ark", "baseUrl": "https://ark.cn-beijing.volces.com/api/v3", "console": "https://ark.volcengine.com/region:cn-beijing/apiKey" },
		{ "id": "intl", "label": "International · BytePlus ModelArk", "baseUrl": "https://ark.ap-southeast.bytepluses.com/api/v3", "console": "https://ai.byteplus.com/ark/region:ap-southeast-1/apiKey" }
	],
	"credentials": [{ "id": "apiKey", "label": "API Key" }],
	"models": [ ... ]
}
```

- `id` is stable and is what a card stores. `regions` lists at least one
  region; the first is the default; `console` is where the user gets a key.
- `credentials` lists the values the provider needs, in order. Every value is
  a secret.

### Model

```json
{
	"id": "seedream-5.0-pro",
	"kind": "image",
	"label": "Seedream 5.0 Pro",
	"description": "…",
	"providerModels": { "cn": "doubao-seedream-5-0-pro-260628", "intl": "dola-seedream-5-0-pro-260628" },
	"prompt": { "required": "always", "maxLength": 4000 },
	"modes": [ ... ],
	"parameters": [ ... ],
	"deprecated": false
}
```

- `kind`: `image`, `video`, or `audio`. A card offers only the models of its
  kind, and a card's kind never changes with its model.
- `makes`, for an audio model: `speech` (a voice that says the prompt),
  `music` (a song or an instrumental), or `sound` (sound effects). The
  window names it in the model menu and in the prompt's placeholder
  ([generation cards, The panel](generation-cards.md#the-panel)).
- `providerModels`: for each region that offers the model, the id sent to
  the provider there. A card whose provider is set up in another region shows
  the model as unavailable there. Where the provider has one id per task for
  the same model (one for text to video, one for image to video), the
  catalog still lists one model, whose modes and inputs choose the id;
  `providerModels` gives the id of its first task, and `check` answers the
  id the request would be sent with ([Requests](#requests)).
- `prompt.required`: `always`, `withoutMedia` (required when the mode sends
  no image or video), or `never`. `maxLength` counts characters of the
  prompt as sent, text inputs included.
- `deprecated` models are shown only to cards that already use them.
  `deprecatedIn` lists the regions that retire a model when not all do; the
  model is then deprecated only there. Agents read both.
- `outputFormat`, for an image model: the format its module asks the provider
  for, `png`, `jpeg`, or `webp` ([Image format](#image-format)); for an
  audio model, `mp3` or `wav` ([Audio format](#audio-format)). A draft takes
  its extension from it ([generation cards](generation-cards.md#creating-a-generation-card)).

### Modes and inputs

A model offers one or more modes. Each declares the input slots it fills from
the card's connections ([generation cards, Inputs](generation-cards.md#inputs)):

| Mode | Kind | Uses |
| --- | --- | --- |
| `frames` | video | the first image as the start frame and the second as the end frame, as far as the mode takes them; with no image, the prompt alone |
| `reference` | image, video, audio | images, videos, and audio as references, in order; an image model's references are images, and with none the prompt alone makes the image; an audio model's are the images and sounds its mode takes, such as the song whose style a song follows, and with none the prompt alone makes the sound |
| `extend` | video | the first video as the clip to continue |
| `edit` | video | the first video as the clip to change, and images as references |
| `lyrics` | audio | the prompt as the lyrics a song sings, and references as `reference` takes them |

An image model offers the one mode `reference`, whose `images.min` is 0 when
the model also makes an image from the prompt alone. The provider module
sends a request without images to the provider's text-to-image call, where
the provider has one of its own.

An audio model offers `reference`, in which its prompt is what the voice
says, or describes the music or the sound. A music model that sings given
lyrics also offers `lyrics`, labeled **From Lyrics**, and then labels
`reference` **From a Description**: in it the provider writes the lyrics, or
makes an instrumental when `instrumental` is on.

The catalog holds these rules, and is not built when a module breaks one:
an audio model offers only `reference` and `lyrics`, whose inputs are images
and sounds, without frames, videos, or a clip; `lyrics` is a mode of a music
model only, which also offers `reference` and takes a prompt
(`prompt.required` is not `never`). In `lyrics` mode the prompt is required,
whatever `prompt.required` says, since it is what the song sings, and it is
counted as it is sent, as in every mode: `check` answers "Write the lyrics:
<model> sings them in From Lyrics mode." when it is empty, also with a
reference song.

```json
{
	"id": "frames",
	"label": "Frames",
	"inputs": {
		"startFrame": "optional",
		"endFrame": "optional",
		"images": { "min": 0, "max": 0 },
		"videos": { "min": 0, "max": 0 },
		"audios": { "min": 0, "max": 0 },
		"source": "none"
	},
	"limits": { "imageMinSide": 300, "imageMaxSide": 6000, "imageAspect": [0.4, 2.5], "imageMaxBytes": 31457280, "videoSeconds": [2, 30], "videoTotalSeconds": 30, "audioSeconds": [2, 30], "audioTotalSeconds": 30 }
}
```

- `startFrame` and `endFrame` are `none`, `optional`, or `required`.
- `images`, `videos`, and `audios` give how many references the mode takes.
- `source` is `none` or `required` (the clip of `extend` and `edit`).
- `regions` lists the regions that offer the mode, when not every region
  that offers the model does, for example a mode whose clip needs an upload
  that only one region has. Elsewhere the window shows the mode dimmed with
  the reason, and `check` refuses it.
- `limits` are checked before anything is sent; any may be absent.
  `imageFormats` lists the image formats the provider takes in the mode,
  among `png`, `jpeg`, and `webp`, PNG always among them; without it, all
  three. The window draws an image of another format to PNG before it sends
  it ([generation cards, Inputs](generation-cards.md#inputs)).
- A provider whose API takes videos or audio only as public URLs, and that
  has no upload endpoint, declares no video or audio slots.

### Parameters

```json
{ "name": "resolution", "label": "Resolution", "kind": "choice", "options": [{ "value": "480p", "label": "480p" }, { "value": "720p", "label": "720p" }, { "value": "1080p", "label": "1080p" }], "default": "720p" }
{ "name": "ratio", "label": "Ratio", "kind": "choice", "display": "ratio", "options": [ ... ], "default": "16:9", "modes": ["reference"] }
{ "name": "duration", "label": "Duration", "kind": "integer", "unit": "seconds", "min": 4, "max": 30, "step": 1, "default": 5, "auto": { "value": -1, "label": "Auto" } }
{ "name": "count", "label": "Images", "kind": "integer", "min": 1, "max": 4, "step": 1, "default": 1 }
{ "name": "sound", "label": "Sound", "kind": "boolean", "default": true }
{ "name": "seed", "label": "Seed", "kind": "integer", "min": 0, "max": 2147483647, "optional": true, "advanced": true }
{ "name": "negative_prompt", "label": "Negative Prompt", "kind": "text", "maxLength": 2500, "optional": true, "advanced": true }
{ "name": "voice", "label": "Voice", "kind": "voice", "options": [{ "value": "Kore", "label": "Kore", "description": "Firm" }], "default": "Kore", "listed": false }
```

- `kind` is `choice`, `integer`, `number`, `boolean`, `text`, or `voice`.
- A `voice` parameter is the voice of a speech model
  ([Voices](#voices)). Its `options` are the voices the catalog declares for
  the model, at least its `default`, each with a `description` of a few
  words where the provider gives one. `listed` says that the provider also
  lists voices through the `voices` call: its own and those of the user's
  account. A value that is not among the options is accepted for a listed
  parameter when it is at most 256 characters without control characters,
  since it may be a voice of the account; for one that is not listed, only
  an option is. Such a value is the id of a voice: 1 to 256 characters,
  counted as Unicode characters, not only spaces, and without control
  characters (`isVoiceId` of the provider service's common folder). The
  window has no rule of its own: its catalog, the values it keeps and
  sends, and the voices it reads from a list use the same function.
- The kind `voice` is only that of the parameter named `voice`, and only a
  speech model has it, never optional. Its default is among its options,
  each option's value is the id of a voice and is declared once, and a
  description has 1 to 300 characters. A model whose voice is `listed`
  needs a module that lists voices (`listVoices`); the catalog is not built
  otherwise.
- `count` is a parameter of an image model or a music model only.
- `default` is used when the card has no value. `optional` parameters may be
  left unset, and nothing is sent for them.
- `modes` limits a parameter to some modes; without it the parameter applies
  to every mode.
- `setByStartFrame` marks a parameter that a start frame decides, such as
  the ratio of a model whose video takes the frame's shape. While the
  planned inputs have a start frame, the window shows it as set by the start
  frame, and nothing is sent or recorded for it; the card keeps its value for
  when no start frame is connected. The provider service drops it from a
  request with a start frame before the provider module sees it.
- `advanced` parameters are shown under **More** in the settings.
- `display` is a hint: `ratio` draws ratio shapes, `slider` a slider.
- `auto` adds a choice that lets the provider decide.
- Rules that join several parameters, such as "1080P allows 6 seconds only"
  or "a transparent background needs PNG", are checked by the provider module
  and reported by `check` ([Requests](#requests)), not declared.
- A rule that only narrows how far a number goes for the planned inputs or
  the mode, such as "the input videos and the result are at most 30 seconds
  together", is answered by `check` as a limit, not as a problem (D70).

**Shared names.** A parameter that means the same at every provider has one
name and one set of values in the catalog, so that choosing another model
keeps it ([generation cards, Settings](generation-cards.md#settings)). The
provider module maps it to its provider's field and value.

| Name | Kind | Values | Means |
| --- | --- | --- | --- |
| `resolution` | choice | lower case: for videos `360p`, `480p`, `512p`, `540p`, `720p`, `768p`, `1080p`, `2k`, `4k`; for images `1k`, `1.5k`, `2k`, `3k`, `4k`, and `720p` and `1080p` where the provider names its image sizes that way (Runway, Vidu); labeled the same at every provider: 720p, 1080p, 1K, 1.5K, 2K, 3K, 4K | the size of the video or of the image |
| `ratio` | choice, drawn as ratio shapes | width to height, such as `16:9`; `adaptive` (**Adaptive**) when the provider takes the shape from the inputs or the prompt | the shape of the video or of the image |
| `duration` | whole seconds | the model's range; Auto is `-1` where the provider can choose | the length of the video, of the music, or of the sound |
| `count` | whole number | 1 to the most images or songs one request makes | how many images or songs one generation makes |
| `quality` | choice | `low`, `medium`, `high`, `xhigh`, `max`, and `auto` where the provider can choose | how much effort and detail the provider spends on an image |
| `background` | choice | `opaque`, `transparent`, and `auto` where the provider can choose | whether the image may be transparent |
| `sound` | boolean | | the model makes voices, effects, or music with the video |
| `seed` | whole number, optional, advanced | 0 to 2147483647 | the same seed with the same request gives a similar result |
| `negative_prompt` | text, optional, advanced | | what the result should not show |
| `prompt_extend` | boolean | | the provider rewrites or extends the prompt before it generates |
| `watermark` | boolean, advanced | | the provider marks the result as made by AI |
| `voice` | voice | the provider's voice ids | the voice a speech model speaks in |
| `speed` | number | from 0.5 to 2 in steps of 0.05, 1 being the voice's own pace; a narrower range where the provider has one | how fast the voice speaks |
| `instrumental` | boolean | | music without singing |
| `style` | text, optional | | the style of the music in `lyrics` mode, where the prompt is the lyrics |

A parameter only one provider has is named as that provider's field.

### Image format

An image model has no format parameter. Its module asks for PNG where the
provider offers a choice, and takes the provider's own format otherwise; the
model declares the result as `outputFormat`, so that a draft has its final
name before it generates. A file that arrives in another format still lands,
under the extension of its format
([generation cards, Landing](generation-cards.md#landing)).

### Audio format

An audio model has no format parameter either. Its module asks for MP3, at
the best quality that every plan of the provider allows, since an MP3 plays
everywhere and is small enough for a folder that git keeps; a provider that
gives only WAV, or only raw samples, which the module writes as WAV
(`pcmToWav` of the provider service), delivers WAV. The model declares the
result as `outputFormat`, and a file that arrives in another format lands
under the extension of its format, as an image does.

### Voices

A speech model speaks in one voice, its `voice` parameter. The catalog
declares the voices every account of the provider has, at least the
model's default, so that a draft has a voice before anything is asked. A
provider that speaks in a voice of its own when a request names none may
declare that voice as the default, an option whose value the module leaves
out of the request (Fish Audio). Where no voice is in every account, the
catalog declares those that the most accounts can use, and the provider's
specification says which accounts cannot (ElevenLabs). A
provider whose API lists voices answers, through the `voices` call
([Requests](#requests)), its own voices and those of the user's account:
the voices the user cloned, designed, or saved in the provider's app. Each
listed voice has:

- its `id`, the provider's, which is what the card stores and sends;
- its `label`, the name the provider gives it;
- a `description` of a few words from the provider's labels, such as its
  gender, age, accent, language, or style, as far as the provider gives
  them;
- `own`, whether it is a voice of the account rather than the provider's;
- `sample`, the address of a short recording of it, where the provider
  gives one.

The voices of an account change outside BaseHalf, so the window asks for
them each time the voice menu opens and keeps the last answer for that
provider and region while it asks again
([generation cards, The panel](generation-cards.md#the-panel)). A voice that
the card stores and that no answer lists is still sent; the provider says
whether it knows it.

## Credentials, regions, and endpoints

Settings has one **Providers** page
([BaseHalf's pages in Settings](settings-pages.md) owns how it opens). It
lists the providers of the catalog. For each:

- **Region**, when the provider has more than one. It sets the base URL and
  which models are offered.
- **Credentials**: one field per value the provider declares. A value is
  stored encrypted on this computer, never in the workspace, and never shown
  again: the field says whether it is set and offers Replace and Remove.
- **Endpoint**: the region's base URL unless the user enters another one, an
  `https` URL, or an `http` URL on this computer. It is how a relay or a
  private gateway that mirrors the provider's own API is used.
- A link to the provider's console for the region, named by the provider, and
  by the region too when the provider has more than one ("Get credentials in
  the console of OpenAI", "Get credentials in the console of Kling (China)").
- The provider's models, by name, under Images, Videos, and Audio, so that
  the user can tell which provider to get credentials from. A kind the provider has
  no model of has no line; a model the region does not offer is dimmed and
  says so.

A provider is set up when every credential value is set. Nothing is checked
with the provider when values are saved; the first generation tells the user
whether they work. A stored value that cannot be read, such as one encrypted
with a key that this computer no longer has, or one that the keychain refused
for a moment, is neither used nor deleted, and the record of this computer
stays as it is: the provider still shows as set up, a generation says that
BaseHalf cannot read the credentials and asks to set them again, and a value
that can be read again works again. Replace and Remove write over the
provider's stored values: with values that cannot be read, those of its
other credentials are gone too, and show as not set.

The page saves each change at once, one after another:

- The endpoint is saved when its field loses the focus, on Enter, which
  keeps the focus in the field, and when the page closes or is left, also by
  Escape or Cmd+W, which close Settings without taking the focus from the
  field. Its outcome shows where the field
  is, without drawing the page again, so the click that took the focus
  reaches what it clicked. An address the page cannot take is shown with
  the reason while the page is open, and is not kept when the page closes.
- Enter that an input method uses to choose its text is not for the page.
- A second change does not wait for the first to be shown and is not
  dropped; the same change is not made twice. A change that ends after
  another provider is shown says so in the status line, with the provider's
  name, and leaves that provider's fields alone.
- While the catalog loads, the page says so; when it could not be loaded,
  the page says why and offers **Try Again**. Removing the credentials of a provider leaves its cards
as they are; they show that the provider is not set up. Changing the region
keeps an endpoint the user entered; clearing the endpoint, or entering the
region's base URL, goes back to the region's base URL.

The credential values of a provider are stored as one secret, a JSON object
of the declared ids, under `basehalf.modelServices.video.<provider>.apiKey`,
a name from before image models that serves both kinds; a provider id is
lowercase letters, digits, and hyphens. The region, the
endpoint, and the ids of the credential values that are set, never the
values, are stored in the application storage of this computer under
`basehalf.video.providers.v1`, so every window knows at once whether a
provider is set up. The last provider, model, mode, and values used for a
video are stored there under `basehalf.video.lastUsed.v2`, for an image
under `basehalf.image.lastUsed.v1`, and for a sound under
`basehalf.audio.lastUsed.v1`. A value is visible ASCII without spaces,
at most 16 KiB.

## Requests

The window calls BaseHalf's provider service (D75). The service runs in the
shared process, the background process that the application starts once for
all of its windows, and every window calls it directly. Each call answers
`{ok: true, value}` or `{ok: false, error: {code, message}}`, and the
service keeps no state between calls: the window passes the credentials with
every call that needs them.

- Requests are Node's own, one connection each, and none is sent again by
  itself, so that a create reaches the provider once. VS Code's proxy agent
  applies the system's proxy settings, a proxy auto-configuration, the proxy
  variables of the user's login shell (`https_proxy`, `http_proxy`,
  `no_proxy`), `http.proxy`, `http.noProxy`, and the certificates the system
  trusts, as it did in the extension host; the main process resolves the
  system's proxy with the session that every window uses, and loads the
  certificates for every window unless `http.systemCertificatesNode` asks
  for Node's own. A proxy that asks for authentication gets a Kerberos
  ticket, or the name and password that the main process asks the user for
  once, as for a window's own requests; BaseHalf keeps them for that proxy
  while it runs. `localhost`, `127.0.0.1`, and `::1` are always reached
  directly. The certificates go with each request, also with
  `http.experimental.systemCertificatesV2` on. The cross-origin rules of a
  window do not apply: providers do not answer cross-origin requests from a
  window, which is why requests never run there. Chromium's network stack,
  which the shared process's own requests use, is not used: it sends a
  request again by itself when a kept-alive connection fails before the
  answer.
- A call belongs to the window that made it. When that window closes or
  reloads, the call's requests stop, nothing more is written for it, and a
  partial download it leaves is removed only while it is still its own file:
  the window that goes on with the generation downloads under the same name.
- A call that does not reach the service fails as a call whose service
  stopped while it ran: `submit` has an unknown outcome, since the request
  may have left, and any other call failed for the network; a poll is asked
  again at its interval, as after a network error. The application does not
  start a shared process that stopped again, as VS Code does not: every
  window is told, a call waiting for it fails at once and so does every later
  one, and VS Code asks the user to restart. After the restart, the window
  goes on with the generations it was following.
- A call that reaches the service but cannot send, because BaseHalf could
  not load its network modules, fails for the network: nothing was sent.
- Before D75 the service was the AI Video extension, and the window called it
  through the commands `basehalf.video.provider.*` in the extension host.
  Those commands are gone.

| Call | Does |
| --- | --- |
| `catalog` | answers the catalog |
| `check` | validates a planned generation |
| `submit` | sends the request once and answers the provider's task id, or the outputs when the provider answers with them at once |
| `poll` | asks the provider about a task once |
| `download` | downloads one output to a given file |
| `cancel` | asks the provider to cancel a task, where it can |
| `place` | puts a received file into its card's place, never replacing anything |
| `voices` | lists the voices of a speech model's provider and of the user's account |
| `voicePreview` | fetches the sample of a listed voice, for the window to play |

- `check` takes the provider, region, model, mode, parameters, the prompt in
  parts ([Names in the prompt](#names-in-the-prompt)), and the planned inputs
  with their files. It answers the problems, in order, as plain sentences,
  and the prompt as the provider module writes it, which is what the
  declarations and the module check and what `submit` sends. It reads image sizes and video
  and audio lengths from the files and checks them against the mode's
  limits. For a model
  whose modes and inputs choose among several provider ids, it also answers
  `providerModel`, the id the request would be sent with; the window records
  that id with the generation.
- `check` also answers `limits`: for each number parameter whose range the
  planned inputs or the mode narrow, the lowest and the highest value it can
  take, where they differ from its declaration, and one plain sentence that
  says why. A value beyond a limit is fitted to it, the highest or the
  lowest it can take, before the rules are checked, so it is no problem; a
  value equal to the parameter's Auto is never fitted. The window shows the
  narrowed range in the settings and sends and records the fitted value
  ([generation cards, Settings](generation-cards.md#settings)). `submit`
  fits the parameters as `check` does before it sends them.
- `submit` takes, with the request, one target file per output the request
  may make (the `count` of an image or a music model, otherwise one), each a new `.part`
  file under `.bh/cache/generation/`; for a model that answers at once, it
  sends nothing when the request names fewer. It answers either a task to
  poll, or the outputs at once, in the provider's order: an address to
  download, a target it has already written when the provider answered with
  the file itself, or the reason of an output the provider refused alone. A
  file it writes passes the checks a download passes. A provider that answers
  at once may take minutes; `submit` waits up to ten minutes for the whole
  answer and reads up to 256 MiB of it, and the catalog says which models
  answer at once, so that the window can tell what a request that never came
  back may have cost.
- `poll` answers a task that succeeded with its outputs in the same three
  forms, or for a video model whose provider gives one address, with that
  address. When the provider's answer holds the files themselves, `poll`
  writes them to the targets the window names with the task, as `submit`
  does.
- Each output is kept on its own. An output BaseHalf cannot keep (not a file
  of the model's kind, too large, an address it does not download from, or a
  file it cannot write) is answered like a refusal, with the reason, and the
  others land. Outputs beyond the targets are dropped. An address that needs
  headers of its own is downloaded into its target while the call runs,
  since the headers never leave the service. A provider that answers with
  the files themselves when the window named no target fails the call:
  `submit` with an unknown outcome, since the files were made, and `poll` as
  refused.
- `submit` is never retried. A request whose answer does not come back, whose
  answer is only a server error (408 or 5xx), or whose accepted answer cannot
  be read has an unknown outcome
  ([generation cards, Ending without its files](generation-cards.md#ending-without-its-files));
  a refusal (any other 4xx) made no task. `submit` checks the request exactly
  as `check` does and sends nothing when it finds a problem.
- `poll`, `download`, and uploads are retried on network errors and on 429,
  408, 500, 502, 503, and 504, three times, 1, 2, then 4 seconds apart, or
  after the `Retry-After` the provider asks for when it is at most 30
  seconds; a longer one ends the retries, and the error says the wait. A
  cancellation is sent once.
- A download follows at most five redirects, sends the credentials only to
  the endpoint's own origin, never to a CDN, and keeps only a file of the
  model's kind: a video that starts like an MP4, at most 512 MiB; an image
  that starts like a PNG, JPEG, or WebP, at most 64 MiB; a sound that starts
  like an MP3, a WAV, a FLAC, an Ogg, or an M4A, at most 256 MiB. A refusal from another
  origin means the address expired. `download` takes the kind and the
  output's address; a video without an address is found by the provider
  module where it can find one, and an output that has an address needs no
  task id, since a provider that answers at once gives none. It answers the size and the
  format the bytes start like, which decides the file's extension.
- What a sound starts like is told from its first 64 bytes (`audioFormatOf`,
  one function for a downloaded sound, a sound answered with the file, and a
  voice's sample); a shorter file is too short to be a sound:
  - an MP3: an ID3v2 tag (`ID3`, a version from 2 to 4, and a size whose four
    bytes are each below 128), or the header of an MPEG audio frame of
    Layer III, of MPEG 1, 2, or 2.5, whose bit rate and sample rate are not
    reserved;
  - a WAV: a RIFF file of the `WAVE` form;
  - a FLAC: `fLaC`, followed by its first metadata block, STREAMINFO;
  - an Ogg: the first page of a stream (version 0, the page that begins
    it) whose first packet begins Opus, Vorbis, or FLAC; an Ogg of a video
    is not a sound;
  - an M4A: an ISO media file whose first box is `ftyp` with an audio brand,
    `M4A ` or `M4B `, as its major brand or among the brands it lists in
    those bytes. A file of general brands alone, such as `isom` or `mp42`,
    may hold a video, and is not taken for a sound.

  AAC without a container, a video, and anything else is `notAudio`.
- `place` takes `from`, a `.part` file directly in a `.bh/cache/generation/`
  folder, and `to`, a name in the same workspace folder, outside `.bh/`; both
  are absolute, and anything else is refused. The window cannot call the file
  system's calls itself, so the provider service puts each landing file in place
  ([generation cards, Landing](generation-cards.md#landing)): `to` becomes a
  hard link of the complete `from`, which fails when the name is taken, so it
  never replaces a file and nothing partial is ever at `to`; then `from` is
  removed. Where the file system cannot link there (`from` and `to` on
  different volumes, `EXDEV`, or a file system without hard links), the
  bytes are copied straight to `to` by an exclusive create
  (`COPYFILE_EXCL`), which never replaces a file either; a copy that fails
  takes back what it wrote, and only a crash during that copy can leave a
  partial file at `to`. It answers `{placed: true}`, or `exists` when a file
  already has the name, which the window turns into the next free name
  beside it.
- `voices` takes the access and a speech model whose `voice` is `listed`,
  and answers its provider's voices and the account's
  ([Voices](#voices)), at most 2,000, with `truncated` when the provider
  had more. It asks the provider's list calls, as many pages as that takes,
  is retried as `poll` is, and writes nothing. A model whose voices are not
  listed is refused, and so is a region that does not offer the model, as
  `check` refuses it; nothing is sent then. What the provider module lists
  is made safe to show and to send back: a voice whose id is not the id of a
  voice ([Parameters](#parameters)) is left out; a name and a description
  are plain text on one line, at most 200 and 300 characters, cut with an
  ellipsis; a voice without a name is named by its id; a sample is kept only
  at an `https` address, or an `http` one on this computer, of at most 8,192
  characters; the account's voices come first, each group in the provider's
  order; and a voice listed twice is kept once, the first time, the
  account's before the provider's.
- `voicePreview` takes the access, the model, and the `sample` address of a
  listed voice, and answers the sample's bytes: an `https` address, or
  `http` on this computer; the credentials go only to the endpoint's own
  origin, as for a download; at most 5 MiB; and only bytes that start like a
  sound, as a downloaded sound must. The window decodes and plays them
  itself, so that no address of a provider is ever played by the window. It
  follows redirects and is retried as a download is, and a model whose
  voices are not listed has no samples and is refused. The bytes cross from
  the shared process to the window as bytes, beside the rest of the answer.
- A provider module maps its own task states to `pending`, `running`,
  `succeeded` with the addresses of the outputs, or `failed` and `cancelled`
  with the provider's message, and reports progress when the provider does.
  An output that the provider refused on its own, such as one image of four
  that its content check stopped, is reported with the reason; the others
  land.
- Inputs travel the provider's way: inline base64 or a data URL where the
  provider takes it, otherwise the provider's upload endpoint. Files are read
  from the workspace by the provider service; nothing is uploaded anywhere
  else.
- Errors are plain text of at most 1,000 characters, without the credentials,
  markup, or request bodies: wrong credentials (`auth`, 401 and 403), refused
  input (`rejected`, any other 4xx, and 404 for a request that creates a
  task), too many requests (`rateLimited`, 429, with the provider's limit when
  it states one), insufficient balance (`balance`, 402 or the provider's own
  code), unknown task (`notFound`, 404 when asking about a task), unknown
  outcome, network failure, unreadable answer, and a download that is not a
  video (`notVideo`), not an image (`notImage`), not a sound (`notAudio`), or
  too large (`tooLarge`), and a name that a file already has (`exists`, from
  `place`). A provider module
  reads the provider's own error codes where they say more than the status.
- Nothing is logged except, in the shared process's log **BaseHalf
  Providers**, the method, the path without query, the status, and the time
  of each call, and how many outputs beyond the targets were dropped.
- The provider service checks every request against the model's declarations
  (the inputs the mode takes, the prompt rule, each parameter's value, and
  the mode's limits) before the provider module adds the rules
  between parameters and the provider's own input rules.

### Names in the prompt

A prompt mentions its inputs by their files ([generation
cards](generation-cards.md#mentions), D74), and the models name their inputs
in different ways. So the window sends the prompt in parts, and the provider
module writes the names:

```json
"prompt": [{ "input": "images", "index": 1 }, " wears the coat of ", { "input": "images", "index": 0 }, ".\n\nscene:\nA rider on the coast."]
```

- A part is text, or a mention of an input of the request: `startFrame`,
  `endFrame`, or `source`, without an index, or `images`, `videos`, or
  `audios` with the input's place among them, from 0. The window has written
  the notes already: a mention of a note is its name in double quotes, and
  the notes' texts follow under their names; in a prompt that is spoken or
  sung, the mention is the note's text itself, and the other notes' texts
  follow without their names
  ([generation cards, Inputs](generation-cards.md#inputs)). A prompt that
  mentions nothing may be sent as one string.
- A mention of an input that the request does not send is refused, and so is
  a part BaseHalf cannot read; nothing is sent then.
- The module writes each mention as its provider's documentation names that
  input, for the model and the mode (`writePrompt`), and the service joins
  the parts. A module whose provider documents no names writes the shared
  ones: a reference by its kind and its number among the references of its
  kind in the request, from 1, `Image 2`, `Video 1`, `Audio 1`; the start and
  the end frame as `the first frame` and `the last frame`; and the clip as
  `the source video`. The shared names are in Chinese when the prompt's own
  text has a Chinese character, `图片2`, `视频1`, `音频1`, `首帧`, `尾帧`,
  and `原视频`, and in English otherwise.
- Where a provider ties a name to a field of the request, such as a tag or a
  reference's name, the module sets the field to the name it writes.
- Each provider's specification says how its module names the inputs, with
  the pages that say so. The descriptions of the models no longer tell the
  user how to name inputs: the user mentions files.

## Providers

Every provider below is reached on its own API with the user's credentials.
Each has its own specification in [providers/](providers/), with its regions,
its models of each kind and what each accepts, and its requests and task
states:

- [ByteDance (Seedance, Seedream)](providers/bytedance.md)
- [Kling](providers/kling.md)
- [Alibaba (Wan, Qwen-Image)](providers/alibaba.md)
- [MiniMax (Hailuo)](providers/minimax.md)
- [Vidu](providers/vidu.md)
- [Google (Gemini)](providers/google.md)
- [PixVerse](providers/pixverse.md)
- [Luma](providers/luma.md)
- [Runway](providers/runway.md)
- [xAI (Grok Imagine)](providers/xai.md)
- [LTX](providers/ltx.md)
- [Black Forest Labs (FLUX)](providers/bfl.md)
- [OpenAI (GPT Image)](providers/openai.md)
- [ElevenLabs](providers/elevenlabs.md)
- [Fish Audio](providers/fishaudio.md)
- [Mureka](providers/mureka.md)

| Provider | Regions and base URL | Credentials | Images | Videos and audio | Image models | Cancel |
| --- | --- | --- | --- | --- | --- | --- |
| ByteDance | China `https://ark.cn-beijing.volces.com/api/v3`, international `https://ark.ap-southeast.bytepluses.com/api/v3` | API key, `Authorization: Bearer` | data URL | audio as data URL; video only as a public URL: not offered | Seedream, answered at once | queued tasks |
| Kling | China `https://api-beijing.klingai.com`, international `https://api-singapore.klingai.com` | API key, `Authorization: Bearer` | base64 | public URL only: not offered | Kling Image, tasks on its earlier `/v1/images/` API | no |
| Alibaba | China `https://dashscope.aliyuncs.com`, international `https://dashscope-intl.aliyuncs.com` | API key, `Authorization: Bearer`, `X-DashScope-Async: enable` (videos) | data URL | temporary upload (`oss://`) in China only | Qwen-Image and Wan, answered at once | pending tasks |
| MiniMax | China `https://api.minimax.cn`, international `https://api.minimax.io` | API key, `Authorization: Bearer` | data URL | file upload (`mm_file://`) | image-01, answered at once | queued tasks (H3) |
| Vidu | China `https://api.vidu.cn`, international `https://api.vidu.com` | API key, `Authorization: Token` | data URL | audio as data URL | Vidu Q2 and Q1, tasks | before it is scheduled |
| Google | `https://generativelanguage.googleapis.com/v1beta` | API key, `x-goog-api-key` | inline base64 | inline base64 (videos), within the request size | Gemini image models, answered at once | running interactions |
| PixVerse | `https://app-api.pixverse.ai` | API key, `API-KEY` and a new `Ai-trace-id` per request | upload (`img_id`) | upload (`media_id`) | none | no |
| Luma | `https://agents.lumalabs.ai/v1` | API key, `Authorization: Bearer` | base64 data | file upload | Uni-1, tasks | no |
| Runway | `https://api.dev.runwayml.com` | API key, `Authorization: Bearer`, `X-Runway-Version: 2024-11-06` | data URI | upload (`runway://`) | Gen-4 Image, tasks | yes |
| xAI | `https://api.x.ai/v1` | API key, `Authorization: Bearer` | data URL | video as a data URL | Grok Imagine Image, tasks | no |
| LTX | `https://api.ltx.io` | API key, `Authorization: Bearer` | data URI | upload (`ltx://`) | none | no |
| Black Forest Labs | `https://api.bfl.ai/v1` | API key, `x-key` | data URL for the video, plain base64 for the image models | clip of Edit and Extend as a data URL | FLUX 3 Image and FLUX.2, tasks | no |
| OpenAI | `https://api.openai.com/v1` | API key, `Authorization: Bearer` | multipart files | none | GPT Image, answered at once | no |

The audio models, of three new providers and of two that BaseHalf has for
images and videos:

| Provider | Base URL | Credentials | Audio models | Inputs | Voices listed |
| --- | --- | --- | --- | --- | --- |
| ElevenLabs | `https://api.elevenlabs.io` | API key, `xi-api-key` | speech (Eleven v4, Eleven v3, Multilingual v2, Flash v2.5) and sound effects, answered at once | none | yes, with samples |
| Fish Audio | `https://api.fish.audio` | API key, `Authorization: Bearer` | speech (Drama 3, S2.1 Pro, S2 Pro), answered at once | none | yes, with samples |
| Mureka | `https://api.mureka.ai` | API key, `Authorization: Bearer` | music (Mureka 9.5, Mureka O2), tasks | a reference song, by upload | – |
| MiniMax | as above | as above | speech (Speech 2.8 HD and Turbo, Speech 2.6 HD and Turbo), answered at once | none | yes, without samples |
| Google | as above | as above | speech (Gemini 3.8 Flash TTS and Flash-Lite TTS), answered at once through `generateContent`; music (Lyria 3.5, Lyria 3 Clip), answered at once through the Interactions API | images, inline (music) | no: 30 voices in the catalog |

The video facts were read from each provider's documentation on 2026-10-18,
the image facts on 2026-10-22, and the audio facts on 2026-10-25; each
provider's specification records the pages it follows. OpenAI's video API closed on 2026-09-24 and is not offered;
its image models are. Google's Veo models on the Gemini API are previews
retiring from 2026-10-22; Google is offered through the model that replaces
them.

### Phases

1. The catalog, the Video Providers page, the settings drawn from the
   catalog, and ByteDance, Kling, Alibaba, MiniMax, Vidu, and Google.
2. PixVerse, Luma, Runway, xAI, LTX, and Black Forest Labs.
3. Image models (D64): the kind of a model, outputs, requests that answer at
   once, the Providers page, the image models of ByteDance, Kling, Alibaba,
   MiniMax, Vidu, Google, Luma, Runway, xAI, and Black Forest Labs, and
   OpenAI.
4. Audio models (D78): the audio kind and what a model makes, the audio
   format, voices and the `voices` and `voicePreview` calls, Lyrics mode,
   the speech models of MiniMax and Google, Google's Lyria, and ElevenLabs,
   Fish Audio, and Mureka.

Later, and not in the catalog until then: the speech and sound effects that
xAI, Kling, Vidu, and Runway sell under the keys BaseHalf already stores;
dialogue with several voices; and sound made for a connected video.

Phases 1 and 2 are implemented (2026-10-19). A provider added later is in the
catalog once its module is in `PROVIDER_MODULES`, and not before.

## Acceptance criteria

1. The window contains no provider or model name, request format, or
   parameter table; removing a provider module removes the provider from the
   page, the model menu, and `--list-capabilities`.
2. Every control of the settings is drawn from the selected model's
   declarations, and changing the model keeps every value the new model
   accepts and gives the others the new model's defaults.
3. A provider is set up with its region and credentials; the credentials are
   in no workspace file, no page markup, and no log.
4. `check` reports, before anything is written, a missing required input, too
   many inputs, an input outside the mode's limits, a prompt that is too long
   or missing, and a rule between parameters; a range that the inputs or the
   mode narrow is answered as a limit with its reason, and a value beyond it
   is fitted, not refused, by `check` and by `submit`.
5. Each implemented provider passes its module's tests against a local
   server that answers like the provider: create, poll through every state or
   an answer with the outputs at once, download, cancel where offered,
   refused credentials, too many requests, and an answer that never comes.
6. No model declares a price and no region a currency, and `check` answers
   no price or estimate (D61).
7. A request is never sent twice by BaseHalf: not after an error, not after a
   reload or a restart, not by a second window, and not when an agent and the
   user start the same card at once.
8. A card offers only the models of its kind, and the Providers page lists
   each provider's models under Images, Videos, and Audio.
9. An image request with `count` above 1 lands one file per output, and an
   output the provider refused alone is reported while the others land.
10. A prompt in parts is written by the provider module of the request:
    `check` answers the prompt so written, `submit` sends it, a prompt of one
    string is sent as it is, and a mention of an input that the request does
    not send is refused before anything is sent. Each module's names are its
    provider's own (`promptNames.test.ts`): `@图片1` for Seedance 2.5, `@image_1`
    for Kling's omni video models with each image item's `id`, `<<<image_1>>>`
    for Kling's omni image models, `@image1` for Runway's tagged references,
    `@image1` and its `ref_name` for PixVerse, `<IMAGE_0>` for xAI,
    `<FIRST_FRAME>` and `<IMAGE_REF_0>` for Gemini Omni, and the shared names
    where a provider documents none (D74).
11. The catalog and each request and answer are defined once, under the
    provider service's common folder, and the window uses that definition:
    no second definition of them is left in the window (D75).
12. A generation's requests are sent by the provider service in the shared
    process: a window that generates has no AI Video extension in its
    extension host, a create whose connection the provider drops reaches it
    once, and the requests reach the provider through the proxy that is set.
13. A call that does not reach the provider service fails as one whose
    service stopped while it ran: a `submit` with an unknown outcome, any
    other call for the network, and the catalog with **Try Again**. When the
    shared process stops, a call waiting for it fails at once in every
    window, and so does every later call.
14. When the window that made a call closes or reloads, the call's requests
    stop, and a download it leaves removes only the file it made.
15. An audio model makes one file of the format it declares, and a music
    model with `count` above 1 one file per song; a download or an answer
    with the file that does not start like a sound, or is larger than
    256 MiB, is refused as `notAudio` or `tooLarge`, and the other outputs
    land.
16. `voices` answers, for a speech model whose voice is listed, the
    provider's voices and the account's, the account's marked as its own,
    with their samples where the provider gives them, at most 2,000;
    `voicePreview` answers a sample's bytes, at most 5 MiB, and refuses bytes
    that do not start like a sound. Neither sends the credentials to another
    origin than the endpoint's.
17. A `voice` value that is not among a listed parameter's options passes
    `check` when it is at most 256 characters without control characters;
    for a parameter that is not listed, only an option passes.
18. In `lyrics` mode, the prompt reaches the provider as the lyrics and
    `style` as the style, in the fields or the form the provider documents.

## Verification

- Unit tests of the catalog contract, of the window's drawing and planning
  from declarations, and of each provider module.
- The smoke runs the generation card steps against the local test provider
  through the ByteDance module, for a video and for an image, and through
  the ElevenLabs and Mureka modules for sounds, and reads the extension
  host's log for criterion 12.
- A unit test of the window's answer when a call does not reach the service,
  and of the window's connection, which fails every waiting and later call
  once the shared process stopped (criterion 13).
- Unit tests of the provider service's channel, which passes each call's
  cancellation to the service, of a call's requests that stop when it is
  cancelled, and of a download that, failing, leaves another download's file
  under its name (criterion 14).
- The smoke's step of a dropped create counts the creates its provider
  received (criterion 12, second part).
- The proxy part of criterion 12 was checked by hand in the window on
  2026-10-24, with a temporary smoke step: with `http.proxy` set to a local
  proxy that logs what passes it, and the provider's endpoint on a host that
  only a proxy could reach, a generation's request arrived at the proxy. A
  loopback address is always reached directly, so the check needs such a
  host. That each request has a connection of its own was measured in Node
  with the transport and the proxy agent: directly to `[::1]`, which the
  agent's patch treats as it treats a provider's host, and through a proxy,
  three requests had three connections, each with `Connection: close`. That
  the system's settings reach the agent through the main process's session,
  and that a proxy's authentication is asked of the main process, was read in
  the code.
- A search of the window's code for criterion 11.
- Unit tests of the audio checks of a download and of an answer with the
  file (criterion 15), of `voices` and `voicePreview` against a local server
  (criterion 16), of the `voice` value in `check` (criterion 17), and of each
  audio module, Lyrics mode among them (criterion 18): what a sound starts
  like (`providerMedia.test.ts`), sounds downloaded and answered with the
  file (`providerDownload.test.ts`), sounds as outputs, the voice in `check`,
  and Lyrics mode (`providerAudio.test.ts`), the voices and their samples
  (`providerVoices.test.ts`), a sample's bytes over the channel between the
  processes (`basehalfProviderConnection.test.ts`), and the catalog's rules
  for audio models (`providerCatalog.test.ts`).
- The smoke generates speech through the ElevenLabs module, with its voices
  and a sample, and two songs in Lyrics mode through the Mureka module,
  against the local test provider, which answers like each of them under a
  path of its own, `/elevenlabs` and `/mureka`, as it answers like ModelArk
  under `/api/v3`. The tests of the two modules generate against it too, as
  the ByteDance module's do: speech in a voice of the account it lists, and
  two songs with a reference song it takes as an upload.
- No real provider is called by tests.
