# Build and publish a BaseHalf plugin

BaseHalf plugins add project experiences inside the fixed BaseHalf shell. They
use the VS Code extension runtime and lifecycle, but ship through BaseHalf's
reviewed catalog rather than the generic Marketplace.

This page is the stable developer entry point. The task guides below are the
canonical documentation; the plugin website should link to or render them
instead of maintaining a second copy.

## Start here

1. [Create your first plugin](plugins/quickstart.md) — install the CLI, generate
   a working TypeScript plugin, and open its development host.
2. [Manifest and host API](plugins/manifest-and-host-api.md) — understand the
   fixed-shell contract, card projections, local data, and shared model
   services.
3. [Local development and testing](plugins/local-development.md) — validate,
   package, and test lifecycle and failure behavior before submission.
4. [Publish, review, and update](plugins/publishing.md) — use your existing
   BaseHalf account, upload an immutable VSIX, and follow it into the signed
   catalog.

For host internals, trust boundaries, and the signed catalog wire contract, see
[Plugin architecture](plugin-architecture.md).

## Five-minute path

```bash
npm install --global @basehalf/plugin-cli

bh-plugin init my-plugin \
  --publisher my-studio \
  --name story-board \
  --display-name "Story Board" \
  --repository https://github.com/my-studio/story-board

cd my-plugin
npm install
npm run check
```

Open the generated folder in BaseHalf and press **F5**. When the plugin is ready
for review, run `npm run publish`. The first publish opens one browser
confirmation and then continues automatically.
