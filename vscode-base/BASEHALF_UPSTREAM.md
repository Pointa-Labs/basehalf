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
(the tool bar at the left end, see below), and the two theme files (terminal
colors) hold a BaseHalf change among them.

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
- `src/vs/sessions/browser/workbench.ts`: only the three new members of the layout service.
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
