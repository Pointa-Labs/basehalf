# Manifest and host API

## Product boundary

A reviewed plugin can contribute commands, settings, ordinary VS Code extension
capabilities, and BaseHalf card projections in the center. A projection may be
a workflow canvas, domain document editor, preview, or another project surface
tied to an ordinary local file.

A plugin cannot add a competing global Activity Bar container, replace
Files/Git/Search/Plugins or Agent Area, make editor tabs primary, use proposed
APIs, or store the only copy of user work in extension-private state.

## Required manifest ownership

Every published manifest needs:

- a stable `publisher.name` identity and immutable version;
- display metadata, repository, and license;
- compatible `engines.vscode` and `engines.basehalf` ranges;
- an owned primary command;
- at least one owned card projection with explicit file suffixes;
- a README, release notes, and compiled entry point.

The CLI rejects proposed APIs, global shell contributions, unowned IDs, and
wildcard projections before upload. The server repeats and strengthens those
checks against the exact VSIX submitted for review.

## Register a card projection

Register each declared projection from `activate`:

```ts
const registration = vscode.basehalf.registerCardProjectionProvider(
  'my-studio.story-board.project',
  {
    async resolveCardProjection(resource, view) {
      view.webview.options = { enableScripts: true };
      view.webview.html = renderProject(resource);
    }
  }
);
context.subscriptions.push(registration);
```

Plugin output is user data. Explicit user or Agent runs may create ordinary
project files and media, but domain truth must not exist only in extension state
or BaseHalf's derived mirror.

## Request shared model services

Model credentials are a host capability configured once by the user. A plugin
discovers a compatible connection and requests access only for the explicit run
that needs it:

```ts
const services = await vscode.basehalf.getModelServices('image');
const connection = services[0]
  ? await vscode.basehalf.getModelServiceAccess(services[0].id)
  : undefined;
```

Never write an API key into project files, logs, output metadata, webview
messages, or extension storage. The plugin owns its provider request, errors,
usage disclosure, and billing behavior.

Continue with [Local development and testing](local-development.md).
