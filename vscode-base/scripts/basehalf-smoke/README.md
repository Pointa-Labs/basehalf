# The smoke of BaseHalf

The smoke drives a real BaseHalf window through the product's flows. It is
organized as VS Code's own smoke tests are (`test/smoke/src/areas/`): its steps
are in suites by area, and each suite runs in a process of its own, on a
BaseHalf of its own with a fresh fixture workspace. No suite depends on what
another one did, so a suite can run alone.

```bash
cd vscode-base
npm run basehalf:smoke                                          # compile, then every suite
npm run basehalf:smoke-no-compile                               # every suite, on the current out/
npm run basehalf:smoke-no-compile -- --suite canvas,cardDetail  # some suites
```

Run the suites of the areas a change touches while working, and the whole
smoke before delivery ([verification and delivery](../../../docs/harness/verification-and-delivery.md)).
`--keep` keeps each suite's folder, `--output <path>` puts each in
`<path>/<suite>`, `--packaged-app <path>` runs a packaged application, and
`--verbose` echoes the window's console. A suite that fails keeps its folder,
with `logs/failure.png`, and the others still run.

BaseHalf keeps drawing while another window covers it: it is launched with
`--disable-backgrounding-occluded-windows` and
`--disable-renderer-backgrounding`. Without them, macOS stops the frames of a
covered window, and every step that waits for a frame or takes a screenshot
times out while someone works in front of it. A pointer moved over the
window, or a click that takes its focus, still disturbs a run.

A raw `page.mouse` action waits for a view transition of the window to end
(`waitForViewTransitionsBeforePointerInput` in `app.mts`). While Card Detail
grows out of its card or goes back into it, at most 260 ms, the window's root
takes every click, so a click sent then reaches nothing. A locator's click
waits by itself, since it hits nothing else until the end.

| Suite | What it covers |
| --- | --- |
| `workbench` | The window at startup, the surfaces BaseHalf hides, the Agent Area, Source Control, and Settings. |
| `canvas` | Creating, editing Notes, renaming, cards that follow renames, connections, badges, selection, zoom, snapping, and the covers of PDFs and books. |
| `cardDetail` | Card Detail and its projections: the rich Markdown editor, source, media, PDF, and books; the trim bar of a video; back and forward from it. |
| `navigation` | Quick Text Search, the Explorer, back and forward between folders and cards, and what happens to the files of the workspace. |
| `video` | Generation cards of images, videos, and sounds: drafts, the panel, the voice menu, generations against the local test provider through the ByteDance, ElevenLabs, and Mureka modules, Providers, the starter template, and Sequence. |

## Files

| File | What it holds |
| --- | --- |
| `../basehalf-smoke.mts` | Runs the suites one after another and says which passed. |
| `suiteList.mts` | The suites in the order the whole smoke runs them, and what each covers. |
| `suites.mts` | The steps of each suite, in order. |
| `runSuite.mts` | Runs one suite: the fixture workspace, BaseHalf on it, the steps, and the summary. |
| `context.mts` | The options and the folders of a run, the product, and the BaseHalf it launched. |
| `fixture.mts` | The fixture workspace, its git history, and what it holds before BaseHalf first opens it. |
| `app.mts` | Launching and closing BaseHalf: its console and errors, the size of its window, and what a failed run leaves. |
| `lib/` | Helpers of more than one area: steps and waiting, Quick Open and commands, the canvas, Card Detail, the rich editor's frame, notifications, the workspace's files, the window's controls, the Agent Area's terminal, the Providers page, and the frames Settings paints as it opens at one of BaseHalf's pages. |
| `areas/<area>/` | The assertions of each area, a file per concern: `workbench/`, `canvas/`, `cardDetail/`, `navigation/`, and `video/` (generation cards, with the local test provider; those of sounds in `audioCards.mts`). |

## Adding a step

1. Write its assertion in the file of `areas/` that checks the same thing. A
   helper that two areas use goes into `lib/`.
2. Add it to its suite in `suites.mts`:
   `await step('canvas-thing-it-checks', () => assertCanvasThingItChecks(page));`
3. Make the suite do what the step needs first. A step never relies on a card,
   a file, or a state that another suite makes.

An area imports `lib/`, `context.mts`, `fixture.mts`, and `app.mts`, never
another area. Each step prints `[basehalf-smoke] start <step>` and
`[basehalf-smoke] pass <step>`, and each suite ends with a summary of the steps
that passed.
