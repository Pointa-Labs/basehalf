# Mureka

Status: Draft (2026-10-25, D78; the sections after Models are completed with the module)
Decisions: [D78](../../decisions.md#d78--basehalf-makes-speech-music-and-sound-effects-with-the-same-cards-panel-and-providers-new-2026-10-25)
Parent: [Providers and the model catalog](../providers.md)

This specification owns the Mureka module of the provider service
(`vscode-base/src/vs/platform/basehalfProviders/node/mureka.ts`): the music
models it declares, the requests it sends, and how it reads Mureka's
answers. What is the same for every provider is owned by the parent
specification and is not repeated here.

## Sources

Mureka's API platform documentation at `https://platform.mureka.ai/docs/`,
read on 2026-10-25.

## Regions and credentials

One region, `https://api.mureka.ai`. One API key, sent as
`Authorization: Bearer`; the console is `https://platform.mureka.ai/`.
Mureka answers 403 to a request from a region it does not serve.

## Models

| Model | Makes | Provider id |
| --- | --- | --- |
| Mureka 9.5 | music | `mureka-9.5` |
| Mureka O2 | music | `mureka-o2` |

Both are tasks that are polled, make two songs by default and at most
three (`count`), and deliver MP3. Each offers From a Description, in which
Mureka writes the lyrics or, with Instrumental on, makes music without
singing (Mureka 9.5 only: Mureka's instrumental call does not take O2), and
From Lyrics, in which the prompt is the lyrics and Style the style. A connected sound is the reference song, uploaded through Mureka's
own upload endpoint.

## Modes and inputs

## Parameters

## Requests

## Task states

## Errors

## Left out

- Extending, editing, remixing, and separating songs; a voice cloned for
  singing; a melody hummed or drawn; music for a video.

## Acceptance criteria

## Verification
