# BaseHalf AI Video

The first official BaseHalf domain plugin provides a local, provider-neutral
node workflow canvas for scripts, characters, scenes, shots, and generation
runs. It is intentionally smaller and more domain-specific than ComfyUI:
creators arrange story nodes, connect context from left to right, inspect one
node at a time, and explicitly run individual or pending shot nodes.

Use **BaseHalf: Create AI Video Project...** or open a `.aivideo` file. Saving
and running are explicit actions. The project JSON and generated artifacts stay
beside the user's files; disabling the plugin leaves them readable and
Git-manageable.

## Workflow graph

`.aivideo` version 2 stores the visible node positions and directed dependency
edges alongside the ordinary project data. Version 1 list-based projects open
as a default Script to Scene to Shot graph and are upgraded on their next save.

- **Script**, **Character**, and **Scene** nodes provide context.
- **Shot** nodes are executable and choose a generation provider.
- An edge `A -> B` means B receives A and every transitively upstream node as
  input. The graph must be acyclic and the Script node cannot accept inputs.
- **Run pending** executes draft, failed, and interrupted Shot nodes in
  topological order.
- Node positions, edges, prompts, status, and output paths remain readable JSON.

The built-in **Prompt package (local)** provider writes the fully resolved shot
request to `<project>.outputs/<shot-id>/request.json`. It proves the workflow
and handoff contract without pretending to generate a video. Video and voice
services can be added as separate reviewed connector extensions.

## Connector API

A connector activates this extension, obtains its exported API, and registers
an `AIVideoGenerationProvider`, an `AIVideoVoiceGenerationProvider`, or both.
Providers receive the project, selected shot, only the inputs reachable through
the workflow graph, an output directory, and a cancellation token. Voice
providers also receive the local video-provider outputs for the same Shot. They
must write outputs inside the assigned project folder and return their local
URIs. Credentials belong in secret storage or the provider's authenticated
client, not in `.aivideo` files.

This initial API is extension-export based and first-party. It can be promoted
to a dedicated stable BaseHalf connector API after the first real video and
voice connectors validate the shape.
