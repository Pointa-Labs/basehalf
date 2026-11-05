# What the package holds

Status: Active (2026-11-05). Implemented.
Decision: [D122](../decisions.md#d122--the-package-holds-what-basehalf-runs-new-2026-11-05)
Related: [app update](app-update.md) (the limit on an archive),
[built-in AI Video and no plugins](built-in-ai-video-and-no-plugins.md) (which
extensions run and install),
[dependency policy](../dependency-policy.md),
[verification and delivery](../harness/verification-and-delivery.md),
[`BASEHALF_UPSTREAM.md`](../../vscode-base/BASEHALF_UPSTREAM.md) (what a base
update has to do again)

## The rule

**The package holds what BaseHalf runs, and nothing else.**

One list says which built-in extensions run and which ship. What the package
declares decides which npm packages ship, not what happens to lie in
`node_modules` on the machine that builds it.

## Problem

The archive of 0.6.1 was 462 MiB, of the 500 that installed applications accept.
Measured in that archive, by what is compressed and what is unpacked:

| What | In the archive | Unpacked | Why it never ran |
| --- | --- | --- | --- |
| `node_modules/@embedpdf`, among it five families of fonts | 131 MiB | 171 MiB | The reader runs its own bundle in `extensions/basehalf/content-viewer-out`, with the one font it uses. Nothing loads this copy. |
| Source maps | 71 MiB | 330 MiB | Only a build on a CI service stripped them, and BaseHalf packages on a maintainer's machine. |
| 42 built-in extensions outside the allowlist, and `extensions/node_modules` | 28 MiB | 107 MiB | The allowlist does not let them run. |
| The runtime of `@github/copilot` | 25 MiB | 87 MiB | The agent host it serves is switched off. |
| `@microsoft/mxc-sdk` | 17 MiB | 46 MiB | Tools of a terminal sandbox on other systems. |
| Native files of other systems in `node_modules` | 6 MiB | 23 MiB | They cannot load here. |
| The bundle of VS Code's Agents window | 4 MiB | 18 MiB | No entry opens it. |
| **Together** | **281 MiB** | **781 MiB** | |

Three more things came out of the same measurements:

- `npm ls --omit=dev`, which lists what ships, also lists packages that nobody
  declares and that only happen to lie in `node_modules`. There were 127 of them
  on the machine that built 0.6.1, 33 MiB unpacked. What shipped depended on the
  machine.
- `@vscode/vsce-sign` was one of them. Its license allows it only with
  Microsoft's products. It shipped by accident and without its program, so that
  **Install Codex Extension and Install Claude Code Extension always failed in a
  packaged BaseHalf**, with "Signature verification failed with 'ENOENT' error."
  A development host does not check signatures, so nobody saw it.
- `extensions/copilot` did not ship, and `compile` and `watch` still built it. In
  development its watchers held about 2.7 GB of memory and its `node_modules` 1.3
  GB of disk. `src/vs/sessions` was 506 files of a window BaseHalf never opens.

## Goals

- A download about 60% smaller, and an installed application about 60% smaller.
- A package that is the same whatever else is in `node_modules`.
- A check that refuses a package holding what it should not, before it is signed.
- The agent extensions install in a packaged BaseHalf.
- A development machine that does not build and watch what never ships.

## Non-goals

- Taking Chat, Notebook, Debug, Testing, or Tasks out of the workbench. They are
  about 5.5 of the 18.5 MiB of the main bundle, 1.5 MiB of the download, and an
  estimated 50 to 60 ms of a start of about 0.95 s, and taking them out means
  changing 83 of VS Code's files and its extension API, which D76 keeps. See
  [D122](../decisions.md#d122--the-package-holds-what-basehalf-runs-new-2026-11-05).
- Deleting the source of the extensions that do not run. They do not ship and
  cost nothing, and admitting one later takes one line.
- Updating Electron or the base.
- Admitting another built-in extension. That is a product decision of its own.

## Terms

- **The package**: the application bundle, and the archive and the disk image
  made from it.
- **Runs**: is loaded in a process of BaseHalf in any state a user can reach
  without changing a setting that BaseHalf turns off.
- **Declared**: reachable from `dependencies` in `vscode-base/package.json`.

## Required behavior

### What the package holds

1. **Built-in extensions.** The package holds exactly the built-in extensions of
   the allowlist, and `extensions/basehalf`, which holds bundles and fonts and runs
   no code. `basehalfBuiltInExtensions.ts` is the one list: the allowlist reads it
   to decide what runs and the build reads it to decide what ships.
   `extensions/node_modules` does not ship: the extensions that run have bundled
   what they need. `product.json` names no extension to download into the package.
2. **No source maps.** No `.map` file ships. The packaging script keeps them
   beside the archive, as `BaseHalf-<version>-darwin-<arch>-sourcemaps.zip`, to read
   a stack from a report. This file is not a release asset.
3. **Declared npm packages only.** What is not declared does not ship, whatever
   lies in `node_modules`.
4. **`dependencies` is what runs from `node_modules`.** What a bundle takes in
   when it is built, or what only gives types to code that does not run, is in
   `devDependencies`. So are:
   - `@embedpdf/fonts-sc`, `@embedpdf/models`, and `@embedpdf/snippet`, which the
     reader's bundle takes in, and `yjs`, of which the workbench has a bundle in
     `markdown/common/vendor`;
   - `@github/copilot`, `@github/copilot-sdk`, `@vscode/copilot-api`,
     `@anthropic-ai/sdk`, `@microsoft/dev-tunnels-*`, `ssh2`, and `zod`, of the agent
     host and of its tunnels;
   - `@microsoft/mxc-sdk` and `@vscode/sandbox-runtime`, of the terminal sandbox of
     the chat's tools;
   - `playwright-core`, of the chat's browser tools.
5. **Native files of this system and this architecture.** `node-pty` ships the
   prebuilt program of the system and architecture of the package only.
6. **No Agents window.** Its bundle, page, and resources do not ship.
7. **Notices.** What leaves `node_modules` takes its license text with it, so the
   notices of what the reader's bundle holds are beside it, as
   `content-viewer-out/pdfViewerNotices.txt`.

### What the tree holds

8. `vscode-base/extensions/copilot` is not in the tree. `compile`, `watch`, and the
   packaging build nothing of it.
9. `vscode-base/src/vs/sessions` holds only `common/theme.ts` and `common/sizes.ts`,
   which register colors and sizes that the workbench reads
   (`--vscode-agents-fontWeight-semiBold` among them).
10. **What asks for the Agents window gets an ordinary window.** `--agents`, and the
    command behind it, open a window as a start without arguments does. No window
    loads the page of the Agents window, also not a window restored from a state
    that an earlier build saved.

### The signature of an extension

11. BaseHalf verifies no signature of an extension. The check that VS Code has needs
    `@vscode/vsce-sign`, which BaseHalf may not ship. What may install is fixed by its
    exact identity, name and id ([built-in AI Video and no
    plugins](built-in-ai-video-and-no-plugins.md), rule 11), it comes from the gallery
    over HTTPS, and the first extension of a publisher asks whether to trust them.
12. A packaged BaseHalf installs the agent extensions from the gallery, and an agent
    session starts on the one it installed.

## Failure and recovery

- A package that breaks 1 to 6 is refused by the layout check that the packaging
  script runs before it makes the archive. The script stops, and nothing is signed.
- A feature that cannot be reached and that would load a package that does not ship
  loads it by a dynamic import, so that nothing fails at a start. If a setting
  that BaseHalf turns off is turned on by hand, such a feature fails where it is
  used, with the error in its log. BaseHalf does not repair it.
- An extension that the gallery serves damaged fails where it is unpacked, as it
  always did. The installation is not left half done.

## Compatibility

- An update replaces the whole application, so nothing that left the package stays
  behind, and a user's data does not name any of it.
- A user who installed an agent extension keeps it. No user of a packaged build could
  have, as long as the install failed.
- A worktree or a checkout keeps the ignored folders of what left the tree
  (`extensions/copilot/node_modules`, `out/vs/sessions`) until they are deleted by
  hand. Nothing reads them.
- A watcher started before this change has `watch-copilot` in it and has to be
  restarted.

## Acceptance criteria

1. In a package, no file ends in `.map`.
2. Every extension in the package is on the allowlist or is `extensions/basehalf`, and
   every built-in extension of the allowlist is in the package.
3. A package holds neither `extensions/node_modules`, nor `node_modules/@embedpdf`,
   `@github/copilot*`, `@microsoft/mxc-sdk`, `@microsoft/dev-tunnels-*`,
   `@vscode/copilot-api`, `@vscode/sandbox-runtime`, `@vscode/vsce`,
   `@vscode/vsce-sign*`, `playwright-core`, `@anthropic-ai/sdk`, `yjs`, or `lib0`.
4. A package holds no `out/vs/sessions`, so neither the bundle nor the page of the
   Agents window.
5. `node-pty/prebuilds` holds the folder of the package's system and architecture
   only.
6. Two builds from two `node_modules` that differ by a package nobody declares hold
   the same list of npm packages.
7. The archive is under 200 MiB.
8. In a packaged window: BaseHalf starts with no error of a missing module in its
   logs; a PDF with Chinese text in fonts it does not embed opens and shows its text;
   the Agent Area's terminal runs; Search finds text; Source Control shows a change.
9. In a packaged window with a new profile, Install Claude Code Extension installs
   it, and the session shows the extension.
10. `basehalf --agents` opens an ordinary window, and a window state that holds the
    workspace of the Agents window opens one too.
11. `npm run compile` and `npm run watch` start nothing of `extensions/copilot`, and a
    development host starts.
12. The full gate of [verification and delivery](../harness/verification-and-delivery.md)
    is green, the smoke also against the packaged application.
13. An installed 0.6.1 is updated to the package for real.

## Verification

```bash
cd vscode-base
build/basehalf/package-darwin.sh arm64 --notes-file <notes>   # runs the layout check
npm run basehalf:package:layout-check -- --app ../VSCode-darwin-arm64/BaseHalf.app
npm run basehalf:package:agent-install -- --app ../VSCode-darwin-arm64/BaseHalf.app
npm run basehalf:smoke-no-compile -- --packaged-app ../VSCode-darwin-arm64/BaseHalf.app
```

`basehalf:package:agent-install` needs the network, downloads about 150 MiB, and opens a
window on a new profile. It is not part of CI.
