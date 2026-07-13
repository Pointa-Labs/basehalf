# AI video workflow product research

Research date: 2026-07-13

This note records the product evidence behind the current workflow canvas.
It focuses on the AI Video plugin and does not change the BaseHalf host.

## What creators are actually managing

AI video creation is not one prompt followed by one final file. Current model
interfaces expose different control surfaces for text-to-video, image-to-video,
first and last frames, reference images, camera motion, duration, aspect ratio,
negative guidance, and audio. Some controls disable others, and the useful
prompt changes by generation mode.

- Runway's text-to-video guide separates visual descriptions from motion
  descriptions. Its image-to-video guide says the input image already defines
  composition, subject, lighting, and style, so the text prompt should focus on
  motion and temporal progression. The same guide documents unwanted cuts and
  contradictory implied motion as iteration problems.
  [Text-to-video guide](https://help.runwayml.com/hc/en-us/articles/42460036199443-Text-to-Video-Prompting-Guide),
  [image-to-video guide](https://help.runwayml.com/hc/en-us/articles/48324313115155-Image-to-Video-Prompting-Guide)
- Reference workflows are a direct response to continuity problems. Runway
  recommends saving and reusing tagged character references, then iterating
  complex changes one element at a time.
  [Image references](https://help.runwayml.com/hc/en-us/articles/40042718905875-Creating-with-Gen-4-Image-References)
- Google exposes first and last frames, aspect ratio, duration, seed, negative
  prompt, and output storage as separate generation parameters. Its prompt
  guidance also treats dialogue, sound effects, and ambience as distinct audio
  directions.
  [First and last frames](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/video/generate-videos-from-first-and-last-frames),
  [prompt guide](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/video/video-gen-prompt-guide)
- Luma's API models a generation as an asynchronous job with status, outputs,
  keyframes, extension from a prior generation, and camera-motion concepts.
  [Video generation API](https://docs.lumalabs.ai/docs/video-generation)
- Adobe Boards lets creators sample an existing canvas image as a first frame,
  last frame, or sub-prompt and choose among multiple generation models whose
  settings differ. Adobe's video documentation also shows that first/last
  frames, composition references, camera controls, and style presets can be
  mutually exclusive.
  [Boards video workflow](https://helpx.adobe.com/firefly/web/create-mood-boards/firefly-boards/add-videos.html),
  [video generation controls](https://helpx.adobe.com/firefly/web/firefly-video-editor/generate-videos/generate-video-using-firefly-models.html)

Research benchmarks support the same product problem. VBench separates video
quality into dimensions such as subject consistency, motion smoothness,
temporal flicker, and spatial relationships. VideoDirectorGPT uses an LLM to
expand an idea into scene descriptions, entities, layouts, backgrounds, and
consistency groups before visual generation. StoryDiffusion focuses directly
on subject consistency over long-range story generation.
[VBench++](https://arxiv.org/abs/2411.13503),
[VideoDirectorGPT](https://arxiv.org/abs/2309.15091),
[StoryDiffusion](https://arxiv.org/abs/2405.01434)

The resulting creator pain points are:

1. Continuity drifts across shots unless characters, scenes, styles, and prior
   results are reusable inputs rather than copied prompt text.
2. Story intent, storyboard intent, and provider execution syntax become mixed
   together, making revisions expensive and unclear.
3. Iteration costs money and time. Creators need to rerun one shot with stable
   upstream context instead of restarting the whole production.
4. Provider controls vary. A project needs a provider-neutral core plus a
   connector-specific handoff, not a schema tied to one model.
5. The result history is hard to reconstruct when prompts, references,
   parameters, and outputs live in different tools.
6. Long-form generation needs hierarchical planning before execution. One
   monolithic prompt is not an adequate production model.

## What workflow canvases teach us

The useful patterns are behavioral, not decorative.

- React Flow treats handles as explicit connection ports, supports connection
  validation, semantic custom nodes, subflows, contextual actions, save and
  restore, and accessible graph interaction.
  [Handles](https://reactflow.dev/learn/customization/handles),
  [subflows](https://reactflow.dev/learn/layouting/sub-flows),
  [interaction examples](https://reactflow.dev/examples)
- n8n supports partial execution of one selected node and the required upstream
  nodes. It can pin an upstream result so later iterations do not repeat costly
  external calls, and it can reload past execution data for debugging. Its AI
  Workflow Builder uses natural language to select, place, and configure nodes,
  but still asks the user to review credentials and parameters.
  [Partial execution](https://docs.n8n.io/workflows/executions/manual-partial-and-production-executions/),
  [data pinning](https://docs.n8n.io/data/data-pinning/),
  [debug executions](https://docs.n8n.io/workflows/executions/debug/),
  [AI Workflow Builder](https://docs.n8n.io/advanced-ai/ai-workflow-builder/)
- Node-RED keeps the node library, workspace, inspector/help, and debug context
  as separate surfaces. Nodes expose status near the node itself, and messages
  preserve a common object as they move through the graph.
  [Editor workspace](https://nodered.org/docs/user-guide/editor/workspace/),
  [node status and messages](https://nodered.org/docs/user-guide/writing-functions)

These patterns map to the plugin as follows:

| Evidence | Plugin decision |
| --- | --- |
| Reusable references improve continuity | Reusable Text and Image nodes feed any number of clip pipelines |
| Text and image generation modes need different prompt information | Storyboard, image prompt, generated frame, video prompt, and generated clip remain separate nodes |
| Partial execution reduces iteration cost | Image, Video, and Audio nodes are independently executable; workflow run follows graph order |
| Frozen upstream output helps debugging | Every run remains selectable inside its producing node |
| Ports and edge semantics reduce invalid graphs | Edges carry one of four media kinds and reject incompatible or cyclic connections |
| Natural-language builders still require review | Ask Agent saves and hands off an explicit file contract; execution remains a separate action |
| Credentials should not enter the workflow definition | `.aivideo` stores provider ids only; connectors own authentication |

## Design audit

Preserved:

- React Flow as the live scene and VS Code theme tokens as the visual system.
- A central canvas, an on-demand four-item node menu, and a selection inspector.
- Autosave, explicit Agent handoff, reviewed workflow execution, cancel, and local output actions.
- A readable project file, external-change reconciliation, and local result
  paths.

Retired or corrected:

- One oversized Shot node is replaced by cooperating Text, Image, Video, and
  Audio nodes inside a visual Shot Group.
- Workflow data dependencies and clip playback Sequence are separate structures.
- The built-in local provider creates in-node storyboard results plus readable
  media and full-sequence previews.
- Agent authoring is no longer an undocumented possibility. The plugin provides
  a schema-bound, user-triggered handoff to the existing Agent Area.

The canvas does not provide editing or final rendering. Its temporal contract is
only an ordered list of independently generated Video-node results.

The UI stays dense and restrained. It does not introduce a second design
system, floating tool chrome, decorative gradients, or a competing global
sidebar.
