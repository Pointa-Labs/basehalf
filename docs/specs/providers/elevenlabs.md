# ElevenLabs

Status: Draft (2026-10-25, D78; the sections after Models are completed with the module)
Decisions: [D78](../../decisions.md#d78--basehalf-makes-speech-music-and-sound-effects-with-the-same-cards-panel-and-providers-new-2026-10-25)
Parent: [Providers and the model catalog](../providers.md)

This specification owns the ElevenLabs module of the provider service
(`vscode-base/src/vs/platform/basehalfProviders/node/elevenlabs.ts`): the
speech and sound-effect models it declares, the voices it lists, the
requests it sends, and how it reads ElevenLabs' answers. What is the same for
every provider is owned by the parent specification and is not repeated
here.

## Sources

ElevenLabs' API documentation at `https://elevenlabs.io/docs/` and its
OpenAPI file at `https://api.elevenlabs.io/openapi.json`, read on
2026-10-25.

## Regions and credentials

One region, `https://api.elevenlabs.io`, which ElevenLabs routes to the
nearest place. Its data-residency hosts belong to Enterprise accounts with
keys of their own, and are reached by entering one as the endpoint. One API
key, sent as `xi-api-key`; the console is
`https://elevenlabs.io/app/settings/api-keys`.

## Models

| Model | Makes | Provider id | Prompt |
| --- | --- | --- | --- |
| Eleven v4 | speech | `eleven_v4` | at most 10,000 characters |
| Eleven v3 | speech | `eleven_v3` | at most 5,000 characters |
| Multilingual v2 | speech | `eleven_multilingual_v2` | at most 10,000 characters |
| Flash v2.5 | speech | `eleven_flash_v2_5` | at most 40,000 characters |
| Sound Effects | sound | `eleven_text_to_sound_v2` | the description of the sound |

Every model answers at once with the file and delivers MP3. The speech
models' voices are listed, with samples. ElevenLabs' music models are not
offered (D78).

## Parameters

## Requests

## Voices

## Errors

## Left out

- Music, for the reason D78 gives; dialogue with several voices; changing
  the voice of a recording; dubbing; voice cloning and voice design.

## Acceptance criteria

## Verification
