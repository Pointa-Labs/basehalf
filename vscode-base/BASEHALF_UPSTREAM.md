# BaseHalf VS Code Base

This directory was converted from a submodule into ordinary tracked source on
2026-06-30 so BaseHalf can develop directly on a VS Code base in this branch.

Upstream source:

- Repository: https://github.com/microsoft/vscode.git
- Branch at import time: `main`
- Commit at import time: `19c9f45e467a381b590bab4909d9c1cdcd75050f`

BaseHalf-specific work should happen in this tree as normal product source.
When updating from upstream VS Code later, use the commit above as the import
baseline.

## Modern UI brought to 1.141 on 2026-10-12

The files of VS Code's Modern UI layout, of the default themes, and of the
status letters in Source Control are at their state in release 1.141.0
(commit `2a59476c9bfcb90b3ddc372c36762471b7dfad1c`), while the rest of this
tree is at the import commit. See public decision D51 and
`docs/specs/workbench-appearance.md`.

How it was done: each file was merged three ways, with the import commit as
the base and the 1.141.0 file as the other side. `reference/vscode` in the
repository root holds the 1.141.0 source for this (an ignored folder).

When the whole tree is updated from upstream later, take upstream's version
of every file below and apply BaseHalf's own changes to it again. Only
`viewPaneContainer.ts` (the option `fillsToBottomEdge`), `titlebarPart.ts`
(the tool bar at the left end, see below), `scmViewPane.ts` (how Changes
starts, see below), and the two theme files (terminal colors) hold a BaseHalf
change among them.

### Identical to 1.141.0
- `extensions/theme-defaults/themes/dark_modern.json`
- `extensions/theme-defaults/themes/dark_vs.json`
- `extensions/theme-defaults/themes/hc_black.json`
- `extensions/theme-defaults/themes/hc_light.json`
- `extensions/theme-defaults/themes/light_modern.json`
- `extensions/theme-defaults/themes/light_vs.json`
- `src/vs/base/browser/ui/iconLabel/iconlabel.css`
- `src/vs/base/browser/ui/scrollbar/scrollableElement.ts`
- `src/vs/base/browser/ui/splitview/paneview.css`
- `src/vs/base/browser/ui/splitview/paneview.ts`
- `src/vs/platform/theme/common/sizes/baseSizes.ts`
- `src/vs/workbench/browser/actions/layoutDensityActions.ts`
- `src/vs/workbench/browser/labels.ts`
- `src/vs/workbench/browser/media/floatingPanels.css`
- `src/vs/workbench/browser/media/style.css`
- `src/vs/workbench/browser/part.ts`
- `src/vs/workbench/browser/parts/activitybar/activitybarPart.ts`
- `src/vs/workbench/browser/parts/activitybar/media/activityaction.css`
- `src/vs/workbench/browser/parts/auxiliarybar/media/auxiliaryBarPart.css`
- `src/vs/workbench/browser/parts/editor/media/breadcrumbscontrol.css`
- `src/vs/workbench/browser/parts/editor/media/editorgroupview.css`
- `src/vs/workbench/browser/parts/editor/media/modalEditorPart.css`
- `src/vs/workbench/browser/parts/editor/media/multieditortabscontrol.css`
- `src/vs/workbench/browser/parts/editor/media/singleeditortabscontrol.css`
- `src/vs/workbench/browser/parts/media/paneCompositePart.css`
- `src/vs/workbench/browser/parts/paneCompositePart.ts`
- `src/vs/workbench/browser/parts/panel/panelPart.ts`
- `src/vs/workbench/browser/parts/statusbar/media/statusbarpart.css`
- `src/vs/workbench/browser/parts/statusbar/statusbarPart.ts`
- `src/vs/workbench/browser/parts/views/media/views.css`
- `src/vs/workbench/common/theme.ts`
- `src/vs/workbench/contrib/files/browser/media/explorerviewlet.css`
- `src/vs/workbench/contrib/modernUI/CSS_PERFORMANCE.md`
- `src/vs/workbench/contrib/modernUI/README.md`
- `src/vs/workbench/contrib/modernUI/browser/connectedEditorTabs.ts`
- `src/vs/workbench/contrib/modernUI/browser/media/activityBar.css`
- `src/vs/workbench/contrib/modernUI/browser/media/commandCenter.css`
- `src/vs/workbench/contrib/modernUI/browser/media/connectedEditorTabs.css`
- `src/vs/workbench/contrib/modernUI/browser/media/editorBorder.css`
- `src/vs/workbench/contrib/modernUI/browser/media/fontRamp.css`
- `src/vs/workbench/contrib/modernUI/browser/media/keyboardFocusOnly.css`
- `src/vs/workbench/contrib/modernUI/browser/media/notificationsDialogs.css`
- `src/vs/workbench/contrib/modernUI/browser/media/padding.css`
- `src/vs/workbench/contrib/modernUI/browser/media/paneHeaders.css`
- `src/vs/workbench/contrib/modernUI/browser/media/roundedCorners.css`
- `src/vs/workbench/contrib/modernUI/browser/media/sashHandles.css`
- `src/vs/workbench/contrib/modernUI/browser/media/shadows.css`
- `src/vs/workbench/contrib/modernUI/browser/media/statusBar.css`
- `src/vs/workbench/contrib/modernUI/browser/media/tabs.css`
- `src/vs/workbench/contrib/modernUI/browser/media/titlebar.css`
- `src/vs/workbench/contrib/modernUI/browser/modernUI.contribution.ts`
- `src/vs/workbench/contrib/scm/browser/media/scm.css`
- `src/vs/workbench/contrib/scm/browser/quickDiffModel.ts`
- `src/vs/workbench/contrib/scm/browser/scmViewPane.ts`
- `src/vs/workbench/contrib/search/browser/media/searchview.css`
- `src/vs/workbench/services/decorations/browser/decorationsService.ts`
- `src/vs/workbench/services/decorations/common/decorations.ts`
- `src/vs/workbench/services/decorations/test/browser/decorationsService.test.ts`
- `src/vs/workbench/services/layout/browser/layoutService.ts`
- `src/vs/workbench/services/themes/browser/modernTabColorCustomizations.ts`
- `src/vs/workbench/services/themes/common/colorThemeData.ts`
- `src/vs/workbench/test/browser/part.test.ts`
- `src/vs/workbench/test/browser/parts/activitybar/activitybarPart.test.ts`
- `src/vs/workbench/test/browser/window.test.ts`
- `src/vs/code/electron-browser/workbench/partsSplash.ts`
- `src/vs/code/electron-browser/workbench/workbench.ts`
- `src/vs/code/test/electron-browser/partsSplash.test.ts`
- `src/vs/platform/theme/common/themeService.ts`
- `src/vs/platform/theme/electron-main/themeMainServiceImpl.ts`

### Partly at 1.141.0

Only the changes that the layout needs were taken. The other changes of
these files between the two releases belong to features this tree does not
have.

- `extensions/theme-defaults/themes/2026-dark.json`: merged; the terminal colors are BaseHalf's.
- `extensions/theme-defaults/themes/2026-light.json`: merged; the terminal colors are BaseHalf's.
- `src/vs/base/browser/dom.ts`: only the singleton mark of `ModifierKeyEmitter`.
- `src/vs/workbench/browser/layout.ts`: merged; the chat setting import was left out.
- `src/vs/workbench/browser/parts/editor/editor.ts`: only the connected-tabs class names.
- `src/vs/workbench/browser/parts/editor/editorPart.ts`: only the margins and the border of the card.
- `src/vs/workbench/browser/parts/globalCompositeBar.ts`: only `onDidChange` and `getHeight`.
- `src/vs/workbench/browser/parts/notifications/notificationsViewer.ts`: only the row height that Modern UI sets.
- `src/vs/workbench/browser/parts/sidebar/sidebarPart.ts`: only the changed argument of the composite bar.
- `src/vs/workbench/browser/parts/titlebar/titlebarPart.ts`: only the shell background, the border, and the setting listener; plus BaseHalf's tool bar at the left end.
- `src/vs/workbench/browser/parts/views/viewPaneContainer.ts`: upstream's file plus BaseHalf's `fillsToBottomEdge`.
- `src/vs/workbench/browser/workbench.contribution.ts`: only the settings of Modern UI, without the two of the translucent pop-ups.
- `src/vs/workbench/contrib/files/browser/views/explorerView.ts`: only the case of the workspace name in the title.
- `src/vs/workbench/contrib/splash/browser/partsSplash.ts`: upstream's file, reading the theme with `getColorTheme` because this tree has no window-local theme overlays.
- `src/vs/workbench/test/browser/workbenchTestServices.ts`: only the new members of the test layout and host services.
- `src/vs/workbench/contrib/modernUI/test/browser/modernUI.contribution.test.ts`: upstream's file with one test skipped, which reads rules that the tab logic of 1.141 generates.
- `src/vs/workbench/workbench.common.main.ts`: only the import of the module.

### Removed

`src/vs/workbench/contrib/styleOverrides/`, the early version of the module.
Upstream renamed it to `src/vs/workbench/contrib/modernUI/`.

### Left out

- `src/vs/workbench/contrib/modernUI/electron-browser/frostedGlass.contribution.ts`,
  its stylesheet, and its tests: translucent pop-ups need
  `isGPUCompositingEnabled` and `onDidChangeGPUCompositing` of the native
  host.
- The editor tab logic of 1.141 (`multiEditorTabsControl.ts` and the files
  around it). The tab stylesheets are at 1.141.0.
- The window-local theme overlays of the theme service
  (`registerColorThemeOverlay`, `getBaseColorTheme`). Only the Agents window
  of VS Code uses them.
- `src/vs/workbench/browser/actions/layoutActions.ts`: the icons of the
  layout density entries need two new codicons.
- `src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css` and the
  stylesheets under `src/vs/workbench/browser/parts/editor/media/`: their
  changes belong to title bar and tab logic that was not taken.
- `src/vs/workbench/test/browser/window.test.ts`: it tests a change of
  `window.ts` that is not part of the layout.

## The tool bar at the left end of the title bar (2026-10-13)

BaseHalf's own change, not upstream's. See public decision D56 and
`docs/specs/layout-controls.md`. An update of the whole tree has to carry
these over:

- `src/vs/platform/actions/common/actions.ts`: `MenuId.TitleBarLeft`.
- `src/vs/workbench/browser/parts/titlebar/titlebarPart.ts`: the tool bar
  that draws that menu, and on macOS the room of the window buttons before
  it.
- `src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css`: the
  rules of both.
- `src/vs/workbench/browser/actions/layoutActions.ts` and
  `src/vs/workbench/browser/parts/auxiliarybar/auxiliaryBarActions.ts`: the
  toggle of the part at the left edge is registered in that menu and not in
  `MenuId.LayoutControlMenu`.

## No control of the panel (2026-10-24)

BaseHalf's own change. See public decision D72 and
`docs/specs/layout-controls.md`. An update of the whole tree has to carry
it over:

- `src/vs/workbench/browser/parts/panel/panelActions.ts`: Toggle Panel is
  not registered in `MenuId.LayoutControlMenu`,
  `MenuId.MenubarAppearanceMenu`, or `MenuId.LayoutControlMenuSubmenu`, and
  its two layout icons are gone. The command keeps Cmd+J.

## How Changes starts (2026-11-04)

BaseHalf's own change. See "The Changes View" in
`docs/git-scm-github-gitgraph.md`. An update of the whole tree has to carry
it over:

- `src/vs/workbench/contrib/scm/browser/scmViewPane.ts`: a folder named `.bh`
  starts closed (`collapseByDefault`).

## `.bh` in Files by a setting (2026-11-04)

BaseHalf's own change. See public decision D116 and
`docs/specs/workspace-state-and-legacy-cleanup.md`. An update of the whole tree
has to carry it over:

- `src/vs/workbench/contrib/files/browser/views/explorerViewer.ts`: with
  `basehalf.files.showHiddenFolder` on, the filter of Files leaves `**/.bh` out of
  `files.exclude`, for Files alone.

## The changes of a file (2026-11-04)

BaseHalf's own change, with one part ported. See public decision D119 and
`docs/specs/changes-of-a-file.md`. An update of the whole tree has to carry it
over:

- `src/vs/workbench/contrib/scm/browser/scmViewPane.ts`: a click on a row goes to
  `tryOpenBaseHalfSourceControlRow` first, and with the multi-file diff active it
  reveals the file there instead.
- `src/vs/workbench/contrib/multiDiffEditor/browser/scmMultiDiffSourceResolver.ts`:
  the list leaves out files under `.bh`.
- `src/vs/workbench/contrib/multiDiffEditor/browser/multiDiffEditor.ts` and
  `src/vs/editor/browser/widget/multiDiffEditor/workbenchUIElementFactory.ts`:
  `openFile`, which the button of a binary file calls.
- `src/vs/editor/browser/widget/multiDiffEditor/multiDiffEditorWidgetImpl.ts`:
  `reveal` of a file that is not in the list does nothing instead of throwing, which
  replaced the whole diff with an error.
- `src/vs/workbench/contrib/search/browser/quickTextSearch/textSearchQuickAccess.ts`:
  the preview of a result is `transient`, so that it closes no editor over the canvas.

A binary file standing in the multi-file diff with its name is VS Code's own since
release 1.144.0, ported in part, in `multiDiffEditorInput.ts`, `model.ts`,
`multiDiffEditorViewModel.ts`, `diffEditorItemTemplate.ts`, and `style.css`. Take
upstream's version at an update and put the button back.

## Space in an editor over the canvas (2026-11-04)

BaseHalf's own change. See "The Changes view" in
`docs/specs/changes-of-a-file.md`. An update of the whole tree has to carry it
over:

- `src/vs/editor/browser/controller/editContext/native/nativeEditContext.ts`: the
  element has the class `nokey`, without which the canvas library takes the Space
  key from it.

## The location in the title bar (2026-07-12, revised 2026-10-24)

BaseHalf's own change. See public decision D73 and
`docs/specs/title-bar-location.md`. An update of the whole tree has to
carry it over:

- `src/vs/workbench/browser/parts/titlebar/commandCenterControl.ts`: while
  a canvas or Card Detail is shown, the command center's quick pick item
  draws the path and a magnifier. A click on it opens the search except on
  a folder button or "…", a press on a button inside it leaves the keyboard
  where it was, and only Enter and Space on those buttons are kept from the
  action bar.
- `src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css`: the
  rules of `basehalf-location-mode` and `basehalf-command-center-*`.

## The check of proposed API (2026-10-25)

`isProposedApiEnabled` in
`src/vs/workbench/services/extensions/common/extensions.ts` checks the API
proposals an extension declares, as in 1.141.0. The import commit returned
`true` there. Public decision D76 restored VS Code's extension system to the
import commit and kept this line at its 1.141.0 state. An update of the whole
tree takes upstream's line.

## The text editor of Card Detail

Card Detail is not an editor pane, so VS Code's editor service knows nothing of its text
editor (D121). `services/editor/browser/editorService.ts` answers `activeTextEditorControl`
and `visibleTextEditorControls` with `baseHalfShownTextEditors` when no pane has one, and
`browser/parts/editor/editorStatus.ts` reads it for the status bar and its language and
encoding pickers. Each change has a `BaseHalf:` mark. A base update keeps them; everything
that reads those two properties then works on Card Detail without knowing it, as Go to Line,
Go to Symbol, the palette's editor commands, and the marks of changed lines do.

## What left the tree and the package (2026-11-05)

See public decision D122 and `docs/specs/what-the-package-holds.md`. When the whole tree is
updated from upstream, these come back and go again:

- **Delete** `extensions/copilot/`, and `src/vs/sessions/` but for `common/theme.ts` and
  `common/sizes.ts`, which `workbench.common.main.ts` imports. Delete
  `src/vs/workbench/test/browser/componentFixtures/sessions/`,
  `build/vite/mobile-multi-diff*`, and `scripts/code-sessions-web.*`.
- **`package.json`**: no script builds or watches `extensions/copilot`. The packages of
  the spec's rule 4 are in `devDependencies`.
- **`build/lib/dependencies.ts`**: only what `package-lock.json` has outside of its dev packages ships.
- **`build/lib/extensions.ts`**: only what `isBaseHalfPackagedExtension` admits builds, also its
  media, and `extensions/node_modules` does not ship.
- **`build/gulpfile.vscode.ts`**: source maps are stripped everywhere, nothing of Copilot's
  runtime or of the Agents window is listed, and `node-pty` keeps one prebuilt folder.
- **`build/buildfile.ts`, `build/next/index.ts`**: the desktop lists no bundle of the agent host.
- **`ThirdPartyNotices.txt`**: BaseHalf's sections for `yjs` and `lib0` stand at the end.
- **`build/gulpfile.extensions.ts`, `build/gulpfile.reh.ts`, `build/gulpfile.hygiene.ts`,
  `build/hygiene.ts`, `build/buildfile.ts`, `build/next/index.ts`, `build/lib/mangle/index.ts`,
  `build/gulpfile.vscode.web.ts`, `build/npm/dirs.ts`, `eslint.config.js`, `.vscode-test.js`,
  `.vscode/launch.json`, `.vscode/tasks.json`, `.eslint-allowed-javascript-files`, `.eslint-ignore`**:
  what named the two folders.
- **`src/vs/workbench/contrib/chat/electron-browser/agentSessions/media/openInAgents.css`**: no
  picture from the Agents window's folder.
- **`product.json`**: `builtInExtensions` is empty. `trustedExtensionPublishers` stays absent: it would
  also take away the delay of the agent extensions' updates.
- **`src/vs/platform/windows/electron-main/windowsMainService.ts`**: `openAgentsWindow` opens an
  ordinary window and `isSessionsWindow` is always false.
- **`src/vs/platform/extensionManagement/node/extensionManagementService.ts`**: no signature is verified.
- **`src/vs/workbench/contrib/extensions/browser/extensions.contribution.ts`**: `extensions.verifySignature`
  is not registered.
- **`src/vs/platform/environment/node/argv.ts`**: help does not list `--agents`.
- **`src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostCustomizationService.ts`**:
  `IAgentHostMcpServer` is declared there, as its old file left.
- **`src/vs/workbench/test/browser/componentFixtures/fixtureUtils.ts`**: no service of the Agents window.

Left as they are, because nothing reads them while the folders are gone: mentions in `.github/`,
`build/azure-pipelines/`, `build/filters.ts`, `build/darwin/`, `build/lib/copilot.ts`,
`build/lib/i18n*`, the layer rules of `src/vs/sessions` in `eslint.config.js`, the picture that
`agentsVoiceWindowService.ts` asks for in a window BaseHalf never opens, and comments.
