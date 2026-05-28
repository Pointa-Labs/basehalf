# @basehalf/desktop

Electron + React shell for BaseHalf. A thin UI layer over `@basehalf/core`
— all operations go through the IPC bridge (`window.bh.run`) to core's
single `run(command, args)` door. No business logic lives here.

## Status

PR 9 (scaffold) and PR 10 (workspace GUI) are in. The shell now boots
with a TopBar (workspace dropdown + pick/remove), a Sidebar with
NavTree (lazy-expand directory tree, hidden-files blacklist), an
"unreachable workspace" recovery UI (re-select / unregister), and a
one-shot macOS Full Disk Access guidance banner. PR 11 onward adds
the canvas + badges + block editor + agent protocol. See
[roadmap](../../docs/roadmap.md).

## Layout

```text
src/
  main/
    index.ts                    BrowserWindow + core singleton + window state persistence
    ipc.ts                      ipcMain handlers: bh:run (delegates to core), workspace:pick
    window-state.ts             read/write/clamp bounds against BH_CONFIG_DIR/window-state.json
  preload/
    index.ts                    contextBridge → window.bh (run / pickWorkspace / platform)
  renderer/
    index.html                  CSS reset + React mount point
    env.d.ts                    ambient window.bh type declaration
    src/main.tsx                React root entry
    src/App.tsx                 layout shell (TopBar + [Sidebar | Main] + banners)
    src/store/
      workspace.ts              Zustand store: workspaces, current, reachability, actions
    src/components/
      TopBar.tsx                workspace dropdown + Pick / Remove buttons
      Sidebar.tsx               workspace header + (NavTree | WorkspaceUnreachable)
      NavTree.tsx               recursive lazy-expand directory tree, hidden-files filter
      WorkspaceUnreachable.tsx  re-select / unregister UI when current folder is gone
      ErrorBanner.tsx           bottom-pinned dismissible error overlay
      FdaTip.tsx                top-pinned macOS Full Disk Access guidance (once-per-host)
test/
  ipc.test.ts                   vitest contract tests for the bh:run channel
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
