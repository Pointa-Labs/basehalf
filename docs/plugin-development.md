# Build and publish a BaseHalf plugin

BaseHalf plugins add project experiences inside BaseHalf's fixed shell. They use
the VS Code extension runtime and lifecycle, but publish through BaseHalf's
curated catalog rather than the generic Marketplace.

## Product boundary

A reviewed plugin can contribute commands, settings, ordinary VS Code extension
capabilities, and BaseHalf card projections in the center. A projection may be
a workflow canvas, domain document editor, preview, or another project surface
tied to an ordinary local file.

A plugin cannot add a global Activity Bar container, replace Files/Git/Search/
Plugins or Agent Area, make editor tabs primary, use proposed APIs, or store the
only copy of user work in extension-private state.

## Prerequisites

- Node.js 22 or newer
- a Basehalf account
- a Publisher membership on the Basehalf Plugins page
- acceptance of the current CLA and publishing terms

Install the supported tool when published:

```bash
npm install --global @basehalf/plugin-cli
```

`bh-plugin` owns scaffolding, validation, packaging, login, publishing, and
status. `@basehalf/plugin-sdk` supplies manifest validation and stable host API
types; generated projects include it.

## Create a plugin

Publisher and plugin names form the permanent extension ID. Use lowercase
letters, digits, and hyphens.

```bash
bh-plugin init my-plugin \
  --publisher my-studio \
  --name story-board \
  --display-name "Story Board" \
  --repository https://github.com/my-studio/story-board \
  --file-extension storyboard

cd my-plugin
npm install
npm run compile
```

The scaffold is functional: its primary command creates a readable local JSON
project file and its projection opens that file inside BaseHalf. Replace the
sample schema and UI while preserving the fixed-shell and local-data contracts.

Every published manifest needs identity, version, display metadata, repository,
license, `engines.vscode`, `engines.basehalf`, an owned primary command, and at
least one owned card projection with explicit file suffixes. It also needs a
README, release notes, and compiled entry point.

The CLI rejects proposed APIs, global shell contributions, unowned IDs, and
wildcard projections before upload. The server repeats and strengthens those
checks against the actual VSIX.

## Use host capabilities

Register the declared projection from `activate`:

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

When an explicit workflow run needs a model, discover the user's global
connection and request access only for that run:

```ts
const services = await vscode.basehalf.getModelServices('image');
const connection = services[0]
  ? await vscode.basehalf.getModelServiceAccess(services[0].id)
  : undefined;
```

Never write the API key into project files, logs, output metadata, webview
messages, or extension storage. The plugin owns its provider request, errors,
usage disclosure, and billing behavior.

## Test locally

The generated project includes a BaseHalf extension-development launch
configuration and a separate `test-workspace/`. Open the plugin folder in
BaseHalf and press **F5**. BaseHalf compiles the extension and opens the test
workspace in a development-host window without installing the plugin into the
user's normal profile.

Use that normal extension development-host workflow to test create/open/save,
external changes, dirty-state navigation, cancellation, provider errors,
Extension Host restart, disable/uninstall fallback, and project readability
without the plugin. Generated outputs must be ordinary files with relative
paths.

Before submitting, validate and create the exact local artifact independently
of publication:

```bash
npm run check
npm run package
```

BaseHalf does not expose arbitrary **Install from VSIX**. Local development uses
the development host; distribution uses the reviewed path below.

## Sign in and publish

Open Basehalf's Plugins page with your normal account, create or join a
Publisher, and accept the current agreements. Then:

```bash
bh-plugin login
bh-plugin whoami
npm run publish
bh-plugin status .
```

`login` opens a short-lived device approval page on
`plugins.basehalf.com`. The stored credential is
opaque, expiring, Publisher-scoped, and owner-readable only. It is not the web
password and can be revoked from the Plugins page.

Publishing creates an immutable submission. The VSIX goes directly to private
quarantine, where the server re-hashes and inspects it. Reviewers examine the
exact artifact, repository disclosure, executable-code authority, local data
behavior, and fixed-shell fit. A rejection includes a summary; publish a new
version after fixing it.

Approval creates a release job but does not give the web service a signing key.
A separate signer verifies again, publishes by digest, advances the signed
catalog, and verifies the CDN. Users then see **Update** in Plugins. BaseHalf
reuses VS Code's enable/disable/uninstall, Extension Host restart,
**Restart to Update**, settings, context menus, and runtime-state UI.

## Versions and withdrawal

- Published VSIX objects are immutable; never reuse a version.
- Updates are explicit. Catalog checks never silently install code.
- Normal withdrawal blocks new installs and shows the reason.
- Security withdrawal can use the emergency extension-control list.
- Disable/uninstall must leave user files browsable, searchable, Git-managed,
  and openable as source.

See [`plugin-architecture.md`](plugin-architecture.md) for host internals and the
wire contract.

## Maintainer release of the developer tools

The SDK and CLI are public npm packages released together at one version. The
manual **Publish plugin developer tools** workflow tests both packages, builds
them, packs the workspace dependency to an exact version, and inspects the
tarballs before publishing the SDK first and the CLI second.

Keep `dry_run` enabled for ordinary verification. A production run uses npm
trusted publishing through GitHub OIDC when configured; the `NPM_TOKEN` secret
is retained only as a bootstrap fallback for the first publication. The
`@basehalf` npm organization and the `npm-production` GitHub environment are
external prerequisites and are never created by application code.
