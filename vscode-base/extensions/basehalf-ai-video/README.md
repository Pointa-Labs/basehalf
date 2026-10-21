# BaseHalf AI Video

BaseHalf AI Video is built into BaseHalf. It holds the model catalog and the
video provider integrations of the Video node, contributes a starter video
workflow, and plays an ordered Sequence of clips. The Video node itself (its
file, its inputs, the panel, the card, a generation, and the Video Providers
page) belongs to the window, which draws everything from the catalog this
extension answers; see the
[video providers specification](../../../docs/specs/video-providers.md) (D59),
the [video node specification](../../../docs/specs/video-node.md), and the
[domain contract](docs/product-contract.md).

## Video providers

Each video provider is one module under `src/providers/`, on the provider's
own API, with the user's own credentials. A module declares the provider's
catalog entry (its regions, the credentials it needs, and every model with its
modes, input slots, limits, and parameters) and calls the provider; the
framework around it does everything that is the same for every provider.

### Commands

The window calls six internal commands. Each answers `{ok: true, value}` or
`{ok: false, error: {code, message, status?}}` and never throws. The
credentials, the endpoint, and the task id arrive with every call; nothing is
kept between calls. Requests run here, in the extension host, because
providers answer no cross-origin requests from the window.

| Command | Argument | Answer |
| --- | --- | --- |
| `basehalf.video.provider.catalog` | none | the catalog |
| `basehalf.video.provider.check` | provider, region, model, mode, params, prompt, and the planned inputs as files | `{problems, providerModel?}` |
| `basehalf.video.provider.submit` | the same with the endpoint, the credentials, and the files | `{remoteId}` |
| `basehalf.video.provider.poll` | the task | `{state: pending \| running, fraction?}`, `{state: succeeded, videoUrl?}`, or `{state: failed \| cancelled, message}` |
| `basehalf.video.provider.download` | the task, `videoUrl?`, and a new `.part` file | `{size}` |
| `basehalf.video.provider.cancel` | the task | `{cancelled}` |

The payload types are in `src/providers/types.ts`, a copy of the window's
`src/vs/workbench/basehalf/video/common/basehalfVideoCatalog.ts` without its
`IBaseHalfVideo` and `BaseHalfVideo` prefixes; the two must stay the same.

### The framework

| File | Does |
| --- | --- |
| `module.ts` | `ProviderModule`, the interface every provider implements |
| `registry.ts` | `PROVIDER_MODULES`, the modules in the order the window lists them, and `buildCatalog()`, which validates every declaration and throws on a bad one |
| `commands.ts` | the six commands: strict payload parsing, dispatch by provider id (`unknownProvider` for an unknown one), the checks from the declarations, and message hygiene |
| `check.ts` | the checks every model gets from its declarations: the inputs a mode takes, the prompt rule, each parameter's value, and the mode's limits; `resolveParams` |
| `http.ts` | `ProviderHttp`, HTTP bound to one command's endpoint and the module's credential headers |
| `media.ts` | reading inputs under a byte cap, data URLs and base64, and image sizes and media lengths read from file headers |
| `download.ts` | the download of a video to its `.part` file |
| `failure.ts` | `ProviderFailure` and the mapping of HTTP statuses to error codes |

What every provider gets from the framework:

- **Checks.** Before a module's own `check`, a request is checked against the
  model's declarations: required and surplus inputs, the prompt rule and its
  length in characters, unknown parameters, parameters of another mode, and
  values outside their options, range, or step. With files, the mode's limits
  are checked from the files' headers: image sizes and aspect (PNG, JPEG,
  WebP, GIF), video and audio lengths (MP4, MOV, and M4A movie headers, WAV,
  and MP3 frames), and bytes. `submit` runs the same checks and sends nothing
  when one fails.
- **Requests.** `http.create` sends the request that creates a task once. When
  its answer does not come back, is only a server error (408 or 5xx), or
  cannot be read, the outcome is `unknownOutcome`, and BaseHalf never sends it
  again. `http.request` (polls, lookups, uploads) is retried on network errors
  and on 408, 429, 500, 502, 503, and 504, three times, 1, 2, then 4 seconds
  apart, or after a `Retry-After` of at most 30 seconds; a longer one ends the
  retries. `http.requestOnce` sends once, as for a cancellation. API requests
  never follow a redirect, and answers are read up to 4 MiB.
- **Errors.** 401 and 403 are `auth`, 402 `balance`, 404 `notFound` (`rejected`
  for a create), 429 `rateLimited`, any other 4xx `rejected`, each with the
  provider's message as the module's `readError` reads it. Messages are plain
  text of at most 1,000 characters: every credential value and credential
  header value is replaced by `***`, and markup, control characters, data
  URLs, and long encoded runs are removed.
- **Downloads.** At most five redirects, the credentials only to the endpoint's
  own origin and never to a CDN, at most 512 MiB (`tooLarge`), an MP4 `ftyp`
  box first (`notVideo`), and retries as for `http.request`. A download that
  fails leaves no file.
- **Log.** The **BaseHalf AI Video** output channel gets the method, the path
  without its query, the status, and the time of each exchange, and nothing
  else.

### Adding a provider module

1. Read the provider's official documentation and write its section under
   "Providers" in the video providers specification first: regions,
   credentials, models with their ids per region, modes with their inputs and
   limits, every parameter, the rules between parameters, endpoints, the
   request mapping, task states, where the video is, cancellation, and the
   pages followed.
2. Add `src/providers/<provider>.ts` exporting a `ProviderModule`:
   - `describe()` answers the catalog entry. Keep every English label and
     message in one table at the top of the file, so it can be translated.
     Name parameters after the API's fields when they map one to one.
   - `headers(credentials)` answers the credential headers, for example
     `{Authorization: 'Bearer ' + credentials.apiKey}`.
   - `readError(status, body)`, when the provider has error codes that say
     more than the status (an empty balance answers `{code: 'balance'}`).
   - `check(request, media)` answers only what the declarations cannot say:
     rules between parameters and the provider's own input rules (formats, the
     size of the whole request). Read files through `media` (or
     `measureItems`) only when `request.inputs` carries media.
   - `submit(request, http)` reads the inputs (`plannedItems`, `readMedia`,
     `dataUrlOf`, `base64Of`), uploads them first when the provider takes them
     that way (`http.request`), sends one `http.create`, and answers the task
     id. Parameters arrive checked and with their defaults.
   - `poll`, `videoLocation`, and `cancel` map the provider's task states,
     tell where a video is when the poll gave no address, and cancel where the
     provider can (`http.requestOnce`; answer false when it cannot).
   - Throw `ProviderFailure` (or `rejected`, `unreadable`, `unknownOutcome`)
     for everything refused or unreadable.
3. Add the module to `PROVIDER_MODULES` in `registry.ts`. The test that builds
   the shipped catalog validates its declarations.
4. Test it in `test/<provider>.test.ts` against a local server that answers
   like the provider (`startServer` in `test/providerTestKit.ts`): create,
   poll through every state, download, cancel where offered, refused
   credentials, too many requests, and an answer that never comes, plus the
   mapping of each model's parameters and the rules of `check`. Pass
   `{http: {sleep: async () => undefined}}` to
   `VideoProviderCommands` to skip the waits between retries.

Relative imports in `src/providers/` name the `.ts` file, which the compiler
rewrites to `.js` (`rewriteRelativeImportExtensions`), so the tests run the
sources directly. Use no syntax that type stripping cannot remove (enums,
parameter properties, namespaces).

### Providers

| Provider | Module | Specification |
| --- | --- | --- |
| ByteDance (Seedance) on Volcengine Ark and BytePlus ModelArk | `bytedance.ts` | [ByteDance (Seedance)](../../../docs/specs/video-providers/bytedance.md) |
| Kling | `kling.ts` | [Kling](../../../docs/specs/video-providers/kling.md) |
| Alibaba Cloud Model Studio (Wan and HappyHorse) | `alibaba.ts` | [Alibaba (Wan)](../../../docs/specs/video-providers/alibaba.md) |
| MiniMax (Hailuo and H3) | `minimax.ts` | [MiniMax (Hailuo)](../../../docs/specs/video-providers/minimax.md) |
| Vidu | `vidu.ts` | [Vidu](../../../docs/specs/video-providers/vidu.md) |
| Google (Gemini API) | `google.ts` | [Google (Gemini)](../../../docs/specs/video-providers/google.md) |
| PixVerse | `pixverse.ts` | [PixVerse](../../../docs/specs/video-providers/pixverse.md) |
| Luma | `luma.ts` | [Luma](../../../docs/specs/video-providers/luma.md) |
| Runway | `runway.ts` | [Runway](../../../docs/specs/video-providers/runway.md) |
| xAI (Grok Imagine) | `xai.ts` | [xAI (Grok Imagine)](../../../docs/specs/video-providers/xai.md) |
| LTX | `ltx.ts` | [LTX](../../../docs/specs/video-providers/ltx.md) |
| Black Forest Labs (FLUX) | `bfl.ts` | [Black Forest Labs (FLUX)](../../../docs/specs/video-providers/bfl.md) |

## Sequence

Each shot folder can carry a small `shot.json` with a stable id, title, and
primary clip-node path. `video-sequence.json` is an ordinary, readable project
file:

```json
{
  "version": 1,
  "kind": "pointa.basehalf-ai-video.sequence",
  "items": [
    {
      "id": "shot-01",
      "title": "Opening",
      "nodeId": "clip-node-01",
      "videoNodePath": "shots/shot-01/clip.bhnode"
    }
  ]
}
```

`clipNodePath` in a Shot document is relative to the directory containing that
`shot.json`. `videoNodePath` in a Sequence item is relative to the directory
containing `video-sequence.json`. Each item stores a readable path and stable
node identity. The referenced file must be a Video node that holds a video
whose file exists. The item order is playback order.

A node's video never changes: generating again makes a new node beside it. To
replace a clip in playback order, remove the old item and add the new node.

Open `video-sequence.json` in Card Detail to inspect and play its saved order.
Clicking a clip plays it, **Play all** advances when each clip ends, and row
actions open the node, move it earlier or later, repair a moved path, or
remove it from playback order. Sequence does not trim, transition, mix, or
render a final movie.

The matching Command Palette actions are the Agent, keyboard, and accessibility
fallback for the same operations:

- **BaseHalf: Show Video Sequence Status…** checks every path, stable node id,
  and video file.
- **BaseHalf: Add Video Result to Sequence…** appends one node that holds a
  video.
- **BaseHalf: Move Video Sequence Clip…** moves one item earlier or later.
- **BaseHalf: Remove Video Sequence Clip…** removes only the playback-order
  reference and keeps the node and its video.
- **BaseHalf: Repair Moved Video Sequence Clip…** changes only a missing saved
  path after a bounded scan finds one node with the same identity that holds a
  video.

Extension-based Agents can call the same commands with structured arguments:

```ts
const sequence = vscode.Uri.file('/project/video/video-sequence.json');
await vscode.commands.executeCommand(
  'pointa.basehalf-ai-video.inspectSequence',
  { sequence },
);
await vscode.commands.executeCommand(
  'pointa.basehalf-ai-video.addSequenceItemFromVideoResult',
  {
    sequence,
    videoNode: vscode.Uri.file('/project/video/shots/shot-01/clip.bhnode'),
    itemId: 'shot-01',
    title: 'Opening'
  },
);
```

## Starter workflow

Run **BaseHalf: Create Video Workflow…** to make the starter workflow in the
current folder: a brief, a script, and a first shot with a plan, a sound plan,
an empty Video node, and `shot.json`, plus an empty Sequence. The two notes of
the shot are connected to its Video node, so their text joins its prompt. The
template contains no credentials, tasks, results, or outputs.

## Development

From `vscode-base/`:

```sh
npm run gulp -- compile-extension:basehalf-ai-video
cd extensions/basehalf-ai-video
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test --test-reporter=tap test/*.test.ts
```

The provider tests run every module against small local servers and against
the local test provider; no test calls a real provider. The local test
provider answers like ByteDance's Seedance task API under `/api/v3` and
accepts the key `basehalf-mock-key`:

```sh
node --experimental-strip-types scripts/basehalf-video-mock-provider.mts --port 8123 --seconds 3
```

It prints its base URL, `http://127.0.0.1:8123/api/v3`, to enter as the
ByteDance endpoint in Video Providers with that key. A task is queued for a
third of `--seconds`, then runs, then succeeds with a small MP4 served
without a key. `DELETE` cancels a queued task. `--fail
key|reject|task|expire|drop|slow` makes every request fail that way; a prompt
that contains `[mock:reject]`, `[mock:fail]`, `[mock:expire]`, `[mock:drop]`,
or `[mock:slow]` fails only that request. `POST /__mock/configure` with
`{"fail", "durationMs"}` changes the behavior while it runs, and `GET
/__mock/requests` lists the create requests received, without keys and with
inline media shortened.

The packaged extension includes `out/` and `templates/`; source, tests, and
internal product notes are excluded.
