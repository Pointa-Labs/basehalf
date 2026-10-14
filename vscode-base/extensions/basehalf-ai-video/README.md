# BaseHalf AI Video

BaseHalf AI Video is built into BaseHalf. It sends the provider requests of
the Video node, contributes a starter video workflow, and plays an ordered
Sequence of clips. The Video node itself (its file, its inputs, the panel, the
card, a generation, and the Video Providers page) belongs to the host; see the
[video node specification](../../../docs/specs/video-node.md) (D58) and the
[domain contract](docs/product-contract.md).

## Provider commands

The workbench's generation service calls four internal commands. Each answers
`{ok: true, value}` or `{ok: false, error: {code, message, status?}}` and never
throws. The key, the endpoint, the model, and the task id arrive with every
call; nothing is kept between calls.

| Command | Argument | Answer |
| --- | --- | --- |
| `basehalf.video.provider.submit` | the request: prompt, settings, frames, references | `{remoteId}` |
| `basehalf.video.provider.poll` | the task | `{state: pending \| running, fraction?}`, `{state: succeeded, videoUrl?}`, or `{state: failed \| cancelled, message}` |
| `basehalf.video.provider.download` | the task, `videoUrl?`, and a new `.part` file | `{size}` |
| `basehalf.video.provider.cancel` | the task | `{cancelled}` |

The types are copied from `src/vs/workbench/basehalf/common/basehalfVideoProviders.ts`
of the host into `src/videoProviderTypes.ts`; the two must stay the same.

HTTP runs here, in the extension host, because providers answer no
cross-origin requests from the window. Every endpoint and video address is
`https://`, or `http://` on this computer (a local relay or the test
provider).

### Formats

| Provider kind | Request format | Create | Ask | Video | Cancel |
| --- | --- | --- | --- | --- | --- |
| `ark`, `byteplus` | Seedance task API | `POST {endpoint}/contents/generations/tasks` with `content` items (text, `image_url` with role `first_frame`, `last_frame`, or `reference_image`) | `GET …/tasks/{id}` | `content.video_url` | `DELETE …/tasks/{id}` (a queued task) |
| `dashscope` | Wan video synthesis | `POST {endpoint}/services/aigc/video-generation/video-synthesis` with `X-DashScope-Async: enable`: `size` from ratio and resolution without frames, `img_url` with a start frame; first and last frames at `…/image2video/video-synthesis` | `GET {endpoint}/tasks/{id}` | `output.video_url` | `POST {endpoint}/tasks/{id}/cancel` (a pending task) |
| `minimax` | MiniMax video generation | `POST {endpoint}/video_generation` with `first_frame_image` and `last_frame_image` | `GET {endpoint}/query/video_generation?task_id=` | `file.download_url` of `GET {endpoint}/files/retrieve?file_id=` | none |
| `gemini` | Veo long-running prediction | `POST {endpoint}/models/{model}:predictLongRunning` with `x-goog-api-key`, inline `image`, `lastFrame`, and `referenceImages` | `GET {endpoint}/{operation}` | `response.generateVideoResponse.generatedSamples[0].video.uri` | none |
| `openai` | `/videos` tasks | `POST {endpoint}/videos` as a multipart form: `model`, `prompt`, `seconds`, `size`, then `input_reference` files (the start and end frame, or the reference images), `input_video`, and `input_audio` | `GET {endpoint}/videos/{id}` | a URL in the answer, or `GET {endpoint}/videos/{id}/content` | none |

Images travel as data URLs or inline base64; local videos and audio travel
only in the `/videos` form. An input larger than 20 MiB, or a request larger
than 128 MiB, is refused before anything is sent.

### Outcomes

HTTP 401 and 403 answer `auth`, 400, 409, and 422 `rejected`, 404 `notFound`,
429 `rateLimited`. A request that may create a task and fails after its body
left this computer, times out after that, or gets an HTTP 5xx answers
`unknownOutcome`; an accepted request whose answer cannot be read answers
`invalidResponse`, which the workbench treats the same way. It never sends
such a request again by itself. A request that never got through answers
`network`. MiniMax
reports its own status codes in HTTP 200 answers; 1004 and 2049 are `auth`,
1002 and 1039 `rateLimited`, the rest `rejected`.

Downloads follow at most five redirects, send the key only to the endpoint's
own origin (never to a CDN), stop at 512 MiB (`tooLarge`), must begin with an
MP4 `ftyp` box (`notVideo`), and are written to the new `.part` file the
workbench names. A download that fails leaves no file.

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
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test extensions/basehalf-ai-video/test/*.test.ts
```

The provider tests run every format against the local test provider and
small in-test servers. The local test provider speaks the Seedance task API
and the `/videos` API with the key `basehalf-mock-key`:

```sh
node --experimental-strip-types scripts/basehalf-video-mock-provider.mts --port 8123 --seconds 3
```

It prints its endpoints (`http://127.0.0.1:8123/api/v3` for a Volcengine Ark
channel, `http://127.0.0.1:8123/v1` for an OpenAI Compatible channel). `--fail
key|reject|task|drop|slow` makes every request fail that way; a prompt that
contains `[mock:reject]`, `[mock:fail]`, `[mock:drop]`, or `[mock:slow]` fails
only that request. No test calls a real provider.

The packaged extension includes `out/` and `templates/`; source, tests, and
internal product notes are excluded.
