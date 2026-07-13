# BaseHalf AI Video

The first official BaseHalf domain plugin provides a local, provider-neutral
project surface for scripts, characters, scenes, shots, and generation runs.

Use **BaseHalf: Create AI Video Project…** or open a `.aivideo` file. Saving and
running are explicit actions. The project JSON and generated artifacts stay
beside the user's files; disabling the plugin leaves them readable and
Git-manageable.

The built-in **Prompt package (local)** provider writes the fully resolved shot
request to `<project>.outputs/<shot-id>/request.json`. It proves the workflow
and handoff contract without pretending to generate a video. Video and voice
services can be added as separate reviewed connector extensions.

## Connector API

A connector activates this extension, obtains its exported API, and registers
an `AIVideoGenerationProvider`. Providers receive the project, selected shot,
an output directory, and a cancellation token. They must write outputs inside
the project folder and return their local URIs. Credentials belong in secret
storage or the provider's authenticated client, not in `.aivideo` files.

This initial API is extension-export based and first-party. It can be promoted
to a dedicated stable BaseHalf connector API after the first real video and
voice connectors validate the shape.
