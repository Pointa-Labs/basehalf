# Create your first BaseHalf plugin

## Prerequisites

- Node.js 22 or newer
- a BaseHalf account
- Git and a public source repository for the plugin

Install the supported developer tool:

```bash
npm install --global @basehalf/plugin-cli
```

The CLI owns scaffolding, validation, packaging, browser-based login,
submission, and status. Generated projects use `@basehalf/plugin-sdk` for
manifest validation and stable host API types.

## Create a project

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
npm run check
```

The generated plugin is functional. Its primary command creates a readable
local JSON project file and its card projection opens that file in BaseHalf.
Replace the sample schema and UI while preserving the fixed-shell and local-data
contracts.

## Run it

Open the plugin folder in BaseHalf and press **F5**. BaseHalf compiles the
extension and opens the generated `test-workspace/` in a separate development
host. This never installs the development build into the user's normal profile.

Continue with [Manifest and host API](manifest-and-host-api.md).
