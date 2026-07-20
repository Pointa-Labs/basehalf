# Manifest and host API

## Product boundary

A reviewed plugin extends the one BaseHalf canvas. The normal contribution is a
**Recipe** that teaches an existing canvas node how to run, optionally paired
with a **Template** that creates a useful starter arrangement. BaseHalf keeps
ownership of nodes, cards, direct references, input bindings, Run/Cancel,
Current, and History.

A plugin may also publish bounded domain document and deterministic command
contracts to Agent sessions, contribute commands, settings, ordinary VS Code extension
capabilities, and an opt-in card-detail **Projection** for a proprietary file
format or exact file name. A Projection is a view over one local file. It cannot
create another workflow canvas, redefine reference meaning, or own an execution
lifecycle. A bounded **Structural Cleanup** may remove stale exact-result
references from ordinary domain documents when the host deletes a result node;
the host still owns deletion, validation, and project undo.

A plugin cannot add a competing global Activity Bar container, replace
Files/Git/Search/Plugins or Agent Area, make editor tabs primary, use proposed
APIs, or store the only copy of user work in extension-private state.

## Required manifest ownership

Every published manifest needs:

- a stable `publisher.name` identity and immutable version;
- display metadata, an HTTPS source repository, and a license file;
- compatible `engines.vscode` and `engines.basehalf` ranges;
- an owned primary command and compiled entry point;
- at least one owned Agent capability, Recipe, Template, opt-in Projection, or
  Structural Cleanup;
- a README; the publisher may take version notes from `CHANGELOG.md` or an
  explicit release-notes file.

The usual plugin declares both `basehalfCanvasRecipes` and
`basehalfCanvasTemplates`. `basehalfCardProjections` is required only when a
dedicated file type or exact file name genuinely needs its own Card Detail
renderer. `basehalfStructuralCleanups` is required only when an ordinary domain
document stores exact references that must be updated before a matching result
container is deleted.

`basehalfAgentCapabilities` is manifest-only discovery metadata. It may publish
owned ordinary document formats and schema summaries, explicit exact-version
pin semantics, and deterministic owned commands with bounded parameter and
return contracts. Only admitted declarations reach live Agent Area capability
discovery. They do not add a second canvas, execute code, carry credentials, or
contain project data.

Before invoking anything, a TUI Agent can inspect the current host contract,
installed Recipes, and reviewed extension capabilities:

```sh
basehalf --list-capabilities
```

This read-only response is produced through the matching Agent Area session; it
does not create a workspace cache or expose internal command ids.

Inside a BaseHalf-owned TUI Agent session, an Agent can invoke one of those
reviewed deterministic operations with one JSON request:

```sh
basehalf --run-operation '{"operationId":"publisher.plugin.operation","parameters":{"document":"project/data.json"}}'
```

The operation id and every parameter must match the live discovery response.
`uri` parameters are portable paths relative to the selected open workspace
folder, not absolute paths or URI strings. The host rechecks terminal ownership,
admission, parameter types, real paths, symbolic links, dirty working copies, and
the declared JSON return type before printing one versioned JSON response. It
never accepts an arbitrary command id. Installed reviewed canvas Templates are
available through the host operation listed in that response; it creates the new
project below the command's current workspace directory.

The registered command receives `(parameters, cancellationToken)`. A mutating
operation must check that token at its final commit boundary and use the host's
compare-and-apply file transition instead of writing an unchecked late result.
Cancellation is cooperative because admitted plugins are trusted local code;
review rejects operations that keep mutating project data after cancellation.

The CLI rejects proposed APIs, global shell contributions, unowned IDs,
wildcard Projections, incompatible Recipe/Template pairs, and packages that do
not contain the files declared by the manifest. The server repeats and
strengthens those checks against the exact VSIX submitted for review.

## Contribute a Recipe

A Recipe declares the operation BaseHalf can attach to a node. Its contract is
bounded and inspectable: accepted direct input kinds, local parameters, an
optional model capability, and ordinary file outputs. It does not declare a
new node type or a new kind of edge.

```json
{
  "contributes": {
    "basehalfCanvasRecipes": [
      {
        "id": "my-studio.story-board.create-image",
        "label": "Create image",
        "modelCapability": "image",
        "inputs": [
          {
            "id": "context",
            "label": "Context",
            "accepts": ["text", "image"],
            "minItems": 1,
            "maxItems": 8
          }
        ],
        "parameters": [
          {
            "id": "instructions",
            "label": "Instructions",
            "type": "multiline",
            "required": true,
            "maxLength": 8000
          }
        ],
        "outputs": [
          {
            "id": "image",
            "kind": "image",
            "extensions": [".png"],
            "minItems": 1,
            "maxItems": 1,
            "primary": true
          }
        ]
      }
    ]
  }
}
```

Register the matching executor from `activate`:

```ts
const registration = vscode.basehalf.registerCanvasRecipeExecutor(
  'my-studio.story-board.create-image',
  {
    async execute(request, progress, token) {
      // request.inputs contains only the direct, explicitly bound input
      // snapshots frozen by BaseHalf for this run.
      const result = vscode.Uri.joinPath(request.outputDirectory, 'result.png');
      await createImage({
        inputs: request.inputs,
        parameters: request.parameters,
        result,
        progress,
        token,
      });
      return {
        artifacts: [
          {
            id: `${request.runId}:image`,
            outputId: 'image',
            kind: 'image',
            resource: result,
          },
        ],
        primaryArtifactId: `${request.runId}:image`,
      };
    },
  },
);
context.subscriptions.push(registration);
```

The executor receives one immutable run request. Its `inputs` are the direct
references the user or Agent explicitly bound to Recipe slots, in saved order;
the executor must not recursively walk the graph or infer hidden dependencies.
It writes artifacts only inside `request.outputDirectory` and returns their
ordinary local file URIs. BaseHalf validates those artifacts, records the run,
selects Current, retains earlier results in History, and restores state after an
Extension Host restart. The plugin must not maintain a second Current/History
database.

Recipe inputs may accept `text` and `code`, but Recipe outputs and `.bhnode`
containers use only `file`, `image`, `video`, `audio`, `pdf`, or
`presentation`. A generated Markdown or source artifact declares `file` and
still points to its ordinary local file. This keeps authored Text/Code cards on
their normal editor interaction instead of giving the same content a second
executable identity. Every `.bhnode` top-level `id` is a canonical lowercase
UUID created once by the host or the validated authoring contract and retained
across file moves and renames.

## Contribute a Template

A Template is inert starter content, not a saved run. It may create ordinary
UTF-8 text or source files, result-container documents, card geometry, direct
references, and Recipe input bindings. It cannot include results,
Current/History state, credentials, absolute paths, private extension data,
binary executable payloads, or install hooks. Instantiation writes declared
files but never executes them.

Declare a packaged JSON resource:

```json
{
  "contributes": {
    "basehalfCanvasTemplates": [
      {
        "id": "my-studio.story-board.image-from-brief",
        "label": "Image from brief",
        "resource": "templates/image-from-brief.json"
      }
    ]
  }
}
```

Use `parseBaseHalfCanvasTemplateForManifest` from `@basehalf/plugin-sdk` in
tests or build tooling. It checks both the template structure and its semantic
fit with the manifest: Recipe identity, output kind, parameter constraints,
direct references, slot bindings, and accepted input kinds.

## Request shared model services

Model connections and credentials are global host capabilities configured once
by the user. A manifest Recipe declares only the capability it needs. The node's
Recipe stores the stable service id and optional explicit model id selected by
the user or Agent. For every explicit run, BaseHalf freezes the service label,
capability, model id, and a digest of the non-secret request-affecting connection
settings before the executor starts.

```ts
const access = request.modelService
  ? await vscode.basehalf.getModelServiceAccess(request.modelService)
  : undefined;

if (!access) {
  throw new Error('Configure an image model service in BaseHalf Settings.');
}
```

The executor must pass the exact host-frozen `request.modelService` snapshot.
If the endpoint or authorization settings changed after the run started, access
fails closed instead of silently sending the request through a different
connection. Rotating only the secret keeps the non-secret connection identity
stable. The digest keeps the endpoint itself out of project history; it is an
audit identity, not a credential.

Never put an API key in the manifest, Recipe parameters, Template, project
files, logs, output metadata, webview messages, or extension storage. A plugin
may use the granted connection only for the current explicit run. It owns its
provider request, cancellation, errors, usage disclosure, and billing behavior;
BaseHalf owns credential storage and access policy.

When the provider returns them, the executor should report a bounded
`providerRequestId`, structured `usage`, and decimal-string `cost` in its result.
BaseHalf stores those fields only on the immutable successful Run. A failed or
cancelled Run keeps its frozen model selection and leaves the previous Current
unchanged.

## Opt in to a card-detail Projection

Use a Projection only when a proprietary file format cannot be represented well
by BaseHalf's built-in Card Detail. Declare explicit file suffixes, exact base
names, or both, and register the declared provider from `activate`:

```json
{
  "contributes": {
    "basehalfCardProjections": [{
      "id": "my-studio.story-board.project",
      "label": "Story Board",
      "extensions": [".story-board"]
    }]
  }
}
```

To claim one ordinary shared document without claiming its whole suffix, use a
domain-specific, case-insensitive exact base name. Avoid generic names that may
already belong to unrelated project files:

```json
{
  "contributes": {
    "basehalfCardProjections": [{
      "id": "my-studio.story-board.sequence",
      "label": "Sequence",
	      "fileNames": ["story-board-sequence.json"]
    }]
  }
}
```

Suffixes include the leading dot and may contain letters, digits, dots, and
hyphens after the first character. Exact names contain no path separators.
Selectors are opt-in and cannot use wildcards. `icon` is optional; BaseHalf
supplies one fixed file-view icon when it is omitted.

```ts
const registration = vscode.basehalf.registerCardProjectionProvider(
  'my-studio.story-board.project',
  {
    async resolveCardProjection(resource, view) {
      view.webview.options = { enableScripts: true };
      view.webview.html = renderProjectFile(resource);
    },
  },
);
context.subscriptions.push(registration);
```

The local file remains the source of truth. A Projection may edit or preview
that file through the host working-copy lifecycle, but it cannot become another
canvas, hide the only copy of content in webview state, or independently run
Recipes. Removing the plugin must leave the file and all generated outputs
browsable as ordinary project data.

## Keep domain references coherent on deletion

Some ordinary domain documents pin a host result node and an exact immutable
version. If deleting that result node would leave stale entries, declare the
deleted resource suffix and register one cleanup provider for the plugin:

```json
{
  "contributes": {
    "basehalfStructuralCleanups": [{
      "id": "my-studio.story-board.result-references",
      "extensions": [".bhnode"]
    }]
  }
}
```

```ts
const cleanup = vscode.basehalf.registerCanvasStructuralCleanupProvider({
  async prepareDelete(resource, token) {
    // Return [] when no owned domain document references this result.
    // Every transition carries the exact bytes read and the desired next bytes.
    return findDomainReferenceTransitions(resource, token);
  },
});
context.subscriptions.push(cleanup);
```

The manifest contribution activates the reviewed plugin only for declared
suffixes. `prepareDelete` does not write files or delete the node. It returns at
most the bounded transitions needed to remove owned domain references. BaseHalf
rejects dirty files, symbolic links, paths outside the workspace, stale
`expected` bytes, duplicate targets, and oversized transitions. It commits the
accepted transitions and the host deletion in one project undo group; if
deletion fails, it restores already-applied cleanup before returning the error.

For a deterministic command that explicitly updates one ordinary project
document outside deletion, use:

```ts
await vscode.basehalf.applyProjectFileTransition(
  resource,
  bytesReadFromDisk,
  nextBytes,
  'Update sequence',
);
```

This is a compare-and-swap write: the saved bytes must still equal the supplied
`expected` bytes. The host rejects dirty files, symbolic links, non-local or
out-of-workspace paths, and payloads over 4 MiB, then records one project undo
step. Call it only from an explicit user or Agent action. Automated services
and activation hooks must not write user files unprompted.

Continue with [Local development and testing](local-development.md).
