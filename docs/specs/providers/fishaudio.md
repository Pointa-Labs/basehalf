# Fish Audio

Status: Draft (2026-10-25, D78; the sections after Models are completed with the module)
Decisions: [D78](../../decisions.md#d78--basehalf-makes-speech-music-and-sound-effects-with-the-same-cards-panel-and-providers-new-2026-10-25)
Parent: [Providers and the model catalog](../providers.md)

This specification owns the Fish Audio module of the provider service
(`vscode-base/src/vs/platform/basehalfProviders/node/fishaudio.ts`): the
speech models it declares, the voices it lists, the requests it sends, and
how it reads Fish Audio's answers. What is the same for every provider is
owned by the parent specification and is not repeated here.

## Sources

Fish Audio's documentation at `https://docs.fish.audio/` and its OpenAPI
file at `https://api.fish.audio/openapi.json`, read on 2026-10-25.

## Regions and credentials

One region, `https://api.fish.audio`. One API key, sent as
`Authorization: Bearer`; the console is `https://fish.audio/app/api-keys/`.

## Models

| Model | Makes | Provider id |
| --- | --- | --- |
| Drama 3 | speech | `drama-3` |
| S2.1 Pro | speech | `s2.1-pro` |
| S2 Pro | speech | `s2-pro` |

The model is chosen by the `model` header of `POST /v1/tts`, which the
module always sends: Fish Audio serves a missing or unknown model as
S2.1 Pro. Every model answers at once with the file and delivers MP3. The
voices are listed: the account's own voice models and the voices of Fish
Audio's library, with samples. `s1` retires on 2026-12-31 and is not
offered.

## Parameters

## Requests

## Voices

## Errors

## Left out

- Inline voice references, which need a MessagePack body, and voice
  models made from BaseHalf (D78); voice design.

## Acceptance criteria

## Verification
