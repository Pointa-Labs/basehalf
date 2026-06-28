# @basehalf/desktop

Electron + React workbench for BaseHalf. The desktop app follows VS Code-style
renderer workbench parts, main-process services, provider adapters, and narrow
shared protocols. The old core command-bus path is no longer the desktop data
backend.

## Status

Pre-alpha but well past scaffold: the v0 desktop app has shipped. The shell
boots into a three-region layout (sidebar file tree | canvas | right panel)
with workspace switching, file/folder **badges** on a React Flow canvas (drag,
positions persist, references, folder sub-canvases), a **BlockNote** block
editor with VS Code-style editor groups (split panes, tabs, drag-to-dock),
media / code / PDF previews, the **focus** chip (Agent Context + Copy brief +
brief preview), and a ⌘K **content-search** palette. Still changing quickly.
See [roadmap](../../docs/roadmap.md).

## Layout

```text
src/
  code/       Electron main entrypoint, sandbox preload, and service composition
  platform/   cross-workbench platform services (windows, workspace, terminal,
              update, native host, configuration, storage, files)
  workbench/  renderer workbench parts, contributions, services, and desktop boot
  renderer/   thin Vite HTML/env host for the workbench entry
test/        vitest unit tests (ipc contract, paneTree, mdSegment, liveDoc, …)
```

The exhaustive per-file tree is intentionally omitted — it rots faster than it
helps. Browse `src/` for the current set.

Git follows the VS Code split: `workbench/contrib/scm` owns native Git / SCM
views, while `workbench/contrib/githubPullRequests` is a separate provider
contribution consumed by SCM. GitHub account state goes through
`workbench/services/authentication`; the PR provider only exposes repository and
pull request operations.

## Commands

```bash
pnpm --filter @basehalf/desktop dev         # electron-vite dev (HMR + window)
pnpm --filter @basehalf/desktop build       # production bundle to out/
pnpm --filter @basehalf/desktop preview     # run the production bundle
pnpm --filter @basehalf/desktop typecheck
pnpm --filter @basehalf/desktop test        # vitest IPC contract tests
pnpm --filter @basehalf/desktop lint
```

The `dev` and `preview` scripts use `cross-env ELECTRON_RUN_AS_NODE=` to
unset that variable from the host shell — if set globally, it makes
Electron start as a plain Node process, and `require('electron')` returns
the binary path (a string) instead of the API.

## Notes for editors

- **Main and preload emit as CommonJS (`.cjs`)** even though the package
  is `type: module`. Electron's `electron` npm package is a CJS stub
  whose `module.exports` is the path to the binary; only Electron's
  runtime CJS require-hook returns the real API. ESM `import 'electron'`
  bypasses the hook. Renderer stays ESM (Vite handles it).
- **`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.**
  The renderer never gets Node APIs; only the explicit `window.bh`
  bridge from preload. Don't expose more without a security review.
- **Window state lives at `BH_CONFIG_DIR/window-state.json`** (per-machine
  UI prefs, decoupled from workspaces.json — see G-01 in
  `private-docs/requirements/SR-atomic-2026-05-28.md`).
