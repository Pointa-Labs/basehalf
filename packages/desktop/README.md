# @basehalf/desktop

Electron + React shell for BaseHalf. A thin UI layer over `@basehalf/core`
— all operations go through the IPC bridge (`window.bh.run`) to core's
single `run(command, args)` door. No business logic lives here.

## Status

PR 9 (scaffold) is in. PR 10 onward builds the real UI on top of this
shell: workspace selector, NavTree, canvas, block editor, agent
protocol. See [roadmap](../../docs/roadmap.md).

## Layout

```text
src/
  main/
    index.ts          BrowserWindow + core singleton + window state persistence
    ipc.ts            ipcMain.handle('bh:run') — the only IPC channel
    window-state.ts   read/write/clamp bounds against BH_CONFIG_DIR/window-state.json
  preload/
    index.ts          contextBridge → window.bh (renderer-side bridge)
  renderer/
    index.html
    env.d.ts          ambient window.bh type declaration
    src/main.tsx      React root entry
    src/App.tsx       single component (PR 9 scaffold)
test/
  ipc.test.ts         vitest contract tests for the bh:run channel
```

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
- **`@basehalf/core` is bundled into main, not externalized.** Rollup
  inlines its ESM into the CJS main output; we can't `require()` an
  ESM-only package at CJS runtime.
- **`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.**
  The renderer never gets Node APIs; only the explicit `window.bh`
  bridge from preload. Don't expose more without a security review.
- **Window state lives at `BH_CONFIG_DIR/window-state.json`** (per-machine
  UI prefs, decoupled from workspaces.json — see G-01 in
  `private-docs/requirements/SR-atomic-2026-05-28.md`).
