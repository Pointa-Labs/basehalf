# BaseHalf Plugin SDK

TypeScript contracts for BaseHalf plugin manifests and stable, reviewed BaseHalf host APIs.

```sh
npm install --save-dev @basehalf/plugin-sdk
```

Import `@basehalf/plugin-sdk/vscode` for BaseHalf's VS Code API type augmentation:

```ts
import type {} from '@basehalf/plugin-sdk/vscode';
import * as vscode from 'vscode';
```

The SDK is a type and validation package. Plugins still run in BaseHalf's extension host and use the `vscode` runtime module supplied by BaseHalf.

The manifest contract supports five reviewed contribution families:

- `basehalfAgentCapabilities` publishes bounded domain document and command contracts to Agent sessions.
- `basehalfCanvasRecipes` declares bounded inputs, parameters, and ordinary local outputs.
- `basehalfCanvasTemplates` contributes static starter canvases stored in the plugin package.
- `basehalfCardProjections` remains available for file formats or exact file names that need a dedicated card-detail surface.
- `basehalfStructuralCleanups` declares bounded cleanup hooks for ordinary domain documents that pin host-owned result nodes.

Canvas templates use one public, versioned JSON contract. Validate template resources with the same parser used by the publishing CLI:

```ts
import {
  defineBaseHalfCanvasTemplate,
  parseBaseHalfCanvasTemplateForManifest,
} from '@basehalf/plugin-sdk';

const template = defineBaseHalfCanvasTemplate({
  version: 1,
  files: [{ path: 'brief.md', contents: '# Brief\n' }],
  nodes: [],
  cards: [{ path: 'brief.md', x: 40, y: 80, width: 320, height: 240 }],
  references: [],
});

parseBaseHalfCanvasTemplateForManifest(JSON.stringify(template), pluginManifest);
```

Template v1 creates only ordinary text files, `.bhnode` result containers, card geometry, and direct references. Text and code stay ordinary editable file cards; executable result containers use `file`, `image`, `video`, `audio`, `pdf`, or `presentation`. Combined validation rejects reserved paths, private state, run history, unsupported fields, dangling cards or references, undeclared recipes, incompatible primary output kinds, invalid parameters, and any binding without a matching direct reference. A direct reference may remain unassigned; the target stays non-runnable until its Recipe binding is complete.

A recipe executor consumes only the direct, explicitly bound input snapshots frozen by the host for that run and writes only to the run directory supplied in the request:

```ts
const registration = vscode.basehalf.registerCanvasRecipeExecutor(
  'your-publisher.your-plugin.create-document',
  {
    async execute(request) {
      const resource = vscode.Uri.joinPath(request.outputDirectory, 'result.md');
      await vscode.workspace.fs.writeFile(resource, new TextEncoder().encode('# Result\n'));
      return {
        artifacts: [
          {
            id: `${request.runId}:document`,
            outputId: 'document',
            kind: 'file',
            resource,
          },
        ],
        primaryArtifactId: `${request.runId}:document`,
      };
    },
  },
);
```

BaseHalf continues to own canvas geometry, references, input binding storage, Run/Cancel, Current, and History. A plugin contributes recipes, templates, and executors without creating a second canvas or storing project truth privately.

`basehalfAgentCapabilities` is static discovery metadata. It can describe an
owned ordinary document format, an explicit exact-result-version pin, and
deterministic owned commands with their required structured parameters and
return shape. BaseHalf validates admission and ownership before publishing the
declaration through `basehalf --list-capabilities` inside the matching Agent Area
session; no capability cache is written into the workspace. The declaration
cannot carry credentials or project content.

The command handler receives the validated parameter object followed by a
`CancellationToken`. Mutating handlers must observe it at their commit boundary
and use BaseHalf's compare-and-apply transition so a cancelled Agent request
cannot write a late project-file result.

Reviewed domain plugins that maintain ordinary project documents containing
exact result references can inspect one saved host node without parsing host
internals:

```ts
const state = await vscode.basehalf.inspectCanvasNode(nodeResource, {
  versionIds: [pinnedVersionId],
  includeCurrent: true,
});
const pinned = state?.versions.find(version => version.id === pinnedVersionId);
if (state?.id !== expectedNodeId || pinned?.primaryArtifact?.integrity !== 'available') {
  // Keep the domain reference visible, but report it as unavailable.
}
```

`inspectCanvasNode` is read-only. Omit its options for the compatible complete
history view. Supplying options returns a partial `versions` view containing only
the requested ids and optional Current, with fresh primary-artifact integrity for
those entries. It does not expose private host storage or let a plugin mutate
Current or History.

A domain document can opt into Card Detail by suffix, exact base name, or both.
Use a domain-specific exact name so unrelated project files keep their normal
Card Detail projection, without claiming every JSON file in the workspace:

```json
{
  "contributes": {
    "basehalfCardProjections": [{
      "id": "your-publisher.your-plugin.sequence",
      "label": "Sequence",
	      "fileNames": ["your-plugin-sequence.json"]
    }]
  }
}
```

If that document stores exact result-node identities, declare a structural
cleanup for the result-container suffix and register one provider. The provider
only proposes byte-for-byte transitions; BaseHalf validates them and commits the
cleanup together with the node deletion as one project undo operation:

```json
{
  "contributes": {
    "basehalfStructuralCleanups": [{
      "id": "your-publisher.your-plugin.result-references",
      "extensions": [".bhnode"]
    }]
  }
}
```

```ts
const registration = vscode.basehalf.registerCanvasStructuralCleanupProvider({
  async prepareDelete(resource, token) {
    // Read the affected ordinary domain document and return an exact
    // expected -> next transition, or [] when it does not reference resource.
    return transitionsForDeletedResult(resource, token);
  },
});
```

For an explicit user or Agent command that deterministically updates one
ordinary project document, call `applyProjectFileTransition(resource, expected,
next, label)`. The host writes only when the saved bytes still equal `expected`,
rejects dirty files, symbolic links, and paths outside the workspace, and adds a
project undo step. This API is not permission for background or unprompted file
writes.

When a recipe declares `modelCapability`, the node Recipe stores the selected stable service id and optional explicit model id. BaseHalf freezes that selection plus the service label, capability, and non-secret connection identity for each explicit Run. Request access with `vscode.basehalf.getModelServiceAccess(request.modelService)` only while executing that request, and only when `request.modelService` is present. Access fails closed if request-affecting connection settings changed after the snapshot; secret rotation does not change that identity. API keys belong to BaseHalf's global encrypted model settings, never to recipe parameters, templates, project files, logs, or extension storage. Executors may return a bounded provider request id, structured usage, and decimal-string cost for immutable successful Run history.

Read the [plugin development guide](https://github.com/Pointa-Labs/basehalf/blob/main/docs/plugin-development.md) for the supported host API and review contract.
