# Create your first BaseHalf plugin

## Prerequisites

- Node.js 22.12 or newer
- a BaseHalf account
- Git and a public source repository for the plugin

Install the supported developer tool:

```bash
npm install --global @basehalf/plugin-cli
```

The CLI owns scaffolding, validation, packaging, browser-based login,
submission, and status. Generated projects use `@basehalf/plugin-sdk` for
manifest validation and typed reviewed host APIs.

## Create a project

Publisher and plugin names form the permanent extension ID. Use lowercase
letters, digits, and hyphens.

```bash
bh-plugin init my-plugin \
  --publisher my-studio \
  --name story-board \
  --display-name "Story Board" \
  --repository https://github.com/my-studio/story-board

cd my-plugin
npm install
npm run check
```

The generated plugin is functional. It contributes one main-canvas Recipe, one
starter Template, and a deterministic executor that writes an ordinary local
Markdown result into the run directory selected by BaseHalf. Replace the sample
Recipe and executor while preserving the fixed-shell, direct-input, and
user-owned-data contracts. The Markdown artifact is a `file` result; Text and
Code remain ordinary editable file cards and are never turned into executable
result containers.

Use `--kind projection --file-extension <extension>` only when a file format
needs a dedicated card-detail projection. A projection does not create a second
canvas or execution lifecycle.

## Run it

Open the plugin folder in BaseHalf and press **F5**. BaseHalf compiles the
extension and opens the generated `test-workspace/` in a separate development
host. This never installs the development build into the user's normal profile.

Continue with [Manifest and host API](manifest-and-host-api.md).
