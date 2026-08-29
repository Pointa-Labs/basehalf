# Development host

This harness document explains how to run BaseHalf from source with hot reload.
It complements [verification and delivery](verification-and-delivery.md), which
owns the scoped checks and the delivery gate. The disposable-fixture rule below
comes from the source-tree boundary in
[spec-driven development](../specs/spec-driven-development.md).

## Prerequisites

Use the Node version pinned by `vscode-base/.nvmrc`. A shell whose default Node
is older will fail the build in confusing ways:

```bash
cd vscode-base && nvm use
```

Non-interactive shells and coding agents usually cannot source `nvm`. Put the
pinned toolchain on `PATH` explicitly instead:

```bash
export PATH="$HOME/.nvm/versions/node/v$(cat vscode-base/.nvmrc)/bin:$PATH"
```

## Start the watchers

```bash
cd vscode-base
npm run watch
```

This runs four watchers in parallel. Treat the host as ready only once all four
have reported a clean pass:

| Watcher | Ready line |
| --- | --- |
| `watch-client-transpile` | `Finished transpilation with 0 errors` |
| `watch-client` | `Finished compilation with 0 errors` |
| `watch-extensions` | `Finished compilation` |
| `watch-copilot` | `Found 0 errors. Watching for file changes.` |

Use `npm run watchd` instead when the watchers should survive the shell that
started them; stop it with `npm run kill-watchd`.

## Launch the host

A development launch opens a disposable fixture workspace. It must never open
the repository root or `vscode-base/` as a product workspace.

```bash
cd vscode-base
unset ELECTRON_RUN_AS_NODE
mkdir -p .build/basehalf-dev-workspace
./scripts/code.sh "$PWD/.build/basehalf-dev-workspace" \
  --user-data-dir="$PWD/.build/basehalf-dev-user-data" \
  --extensions-dir="$PWD/.build/basehalf-dev-extensions" \
  --logsPath="$PWD/.build/basehalf-dev-logs"
```

`scripts/code.sh` already supplies `vscode-base/` as the Electron application
path, so any further path argument is the workspace to open. The fixture
directory is a normal user workspace: BaseHalf initializes `.bh/` and the
workspace-hint agent guides inside it, which is the behavior the source trees
opt out of through their `.basehalf-no-workspace-setup` markers.

Three failure modes are worth naming because none of them produce an obvious
error message:

- A `ELECTRON_RUN_AS_NODE` exported by an agent or editor terminal makes the dev
  Electron start as plain Node, so no window ever appears. Unset it first.
- `--user-data-dir`, `--extensions-dir`, and `--logsPath` must be absolute. A
  relative value resolves against the filesystem root and the main process exits
  with `ENOENT: no such file or directory, mkdir '/.build'`.
- Running under the wrong Node version fails during the pre-launch build rather
  than at startup.

Keeping host state under `vscode-base/.build/` keeps a development profile out
of the installed product's profile and inside an ignored directory. Those
directories accumulate logs and crash dumps across sessions; clearing entries
older than the current session is safe.

## What reloads

| Change | How it reaches the running host |
| --- | --- |
| `src/vs/**`, including CSS | Watchers rebuild `out/`; reload the window (`Developer: Reload Window`) |
| `extensions/**` | Watchers rebuild; reload the window, or `Developer: Restart Extension Host` |
| `src/vs/code/electron-main/**` and other main-process code | Quit and relaunch the host; a window reload does not restart the main process |

Hot reload replaces neither the scoped checks nor `npm run basehalf:smoke`. A
behavior seen working in the development host is not verified until the checks
named by its owning specification have run.
