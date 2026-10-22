# Build and publish a BaseHalf plugin

> **Paused.** Plugin publishing is frozen
> ([D45](decisions.md#d45--ai-video-is-built-in-and-the-plugin-platform-is-frozen-new-2026-10-11)).
> BaseHalf does not install or load plugins from the catalog, and submissions
> are not accepted. This guide describes the platform as it was built and is
> kept for when the freeze is lifted.

> **Removed by D58 and D63.** Recipes, recipe executors, the reviewed model
> and provider connection catalogs, connection validators, and model service
> access for extensions are gone
> ([D58](decisions.md#d58--a-video-node-is-a-prompt-over-its-connections-run-by-the-users-own-providers-new-2026-10-15)).
> So are `.bhnode` node documents and the `outputs/` tree
> ([D63](decisions.md#d63--a-generated-file-is-its-card-new-2026-10-22)): a
> generated image or video is an ordinary file that is its own card, made
> over its connections by the user's own providers
> ([generation cards](specs/generation-cards.md)). Where this page
> describes them, it records the platform as it was built.

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
   fixed-shell contract, main-canvas Recipes and Templates, local run data,
   shared model services, and opt-in Card Detail Projections.
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

The generated plugin extends BaseHalf's existing canvas; it does not ship a
separate workflow editor. Its Recipe receives only the direct input snapshots
frozen for an explicit Attempt and writes exactly one ordinary local artifact
into the host-provided attempt directory. BaseHalf owns cancellation, the
append-only Attempt audit, the sealed Result, and credential storage. Use a
card-detail Projection only for a proprietary file
format that needs a dedicated renderer.
