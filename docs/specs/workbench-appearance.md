# Workbench appearance

Status: Active (2026-10-12)
Related: [architecture invariants](../harness/architecture-invariants.md),
roadmap tracks 8 and 9, public decisions D22 and D51,
[Git/SCM/GitHub/GitGraph](../git-scm-github-gitgraph.md),
[upstream record](../../vscode-base/BASEHALF_UPSTREAM.md)

## Problem

BaseHalf is built on VS Code and is meant to look like it wherever it reuses
its parts. It did not, in three ways.

- **No status colors in Git.** In Source Control and in Files, the status
  letter after a changed file (`M`, `U`, `D`) and the file name were the same
  gray as every other label. In VS Code a modified file is yellow, a new file
  is green, and a deleted file is red.
- **Startup colors.** The window showed the colors that VS Code paints for the
  first moments of a start, before its color theme is loaded, and kept them.
- **The old layout.** VS Code now draws the sidebar, the editor area, and the
  secondary sidebar as separate rounded cards with a gap between them (its
  Modern UI). BaseHalf's parts met without a gap.

The first two had one cause: the color theme is supplied by a built-in
extension, `vscode.theme-defaults`, and the product's extension allowlist
(D22) did not admit it. No theme was ever loaded. A color that an extension
contributes, such as the Git status colors, gets its value when a theme is
applied, so these colors had no value at all.

The base that BaseHalf imported (VS Code 1.128) contained an early version of
the card layout, switched off by default. The version users see in VS Code
today is that of 1.141.

## Scope

In scope:

- which color theme the product shows, and where it comes from;
- the card layout of the workbench parts: the sidebar, the canvas area, and
  the Agent Area;
- the status colors and status letters in Source Control and Files.

Not in scope, and unchanged:

- The palette of the canvas and of the Agent Area terminal. Both have a dark
  palette of their own (see [Limits](#limits)).
- The behavior of Source Control, Files, and the Git extension. BaseHalf uses
  VS Code's implementation as it is
  ([Git/SCM/GitHub/GitGraph](../git-scm-github-gitgraph.md)).
- A file icon theme. The product shows no file icons in Files and Source
  Control, as before.

## Requirements

### Color theme

1. The product color theme is VS Code's default dark theme, `Dark 2026`,
   which is the default value of `workbench.colorTheme` in the base. BaseHalf
   does not define a theme of its own. The theme files are those of VS Code
   1.141; the terminal colors in them are BaseHalf's.
2. The built-in extension `vscode.theme-defaults` is admitted by the
   allowlist as the extension family `theme`, and only as the copy that ships
   inside the application.
3. The `theme` family is required, like Git and GitHub: a narrower
   `extensions.allowed` setting cannot switch it off. Without it the product
   has no theme.
4. Other theme extensions stay blocked, the built-in ones included
   (`vscode.theme-monokai` and the like).
5. `workbench.colorCustomizations` of the product profile still applies on
   top of the theme. It carries the terminal palette only.
6. A theme switch that the system makes by itself stays on a dark theme:
   `workbench.preferredLightColorTheme` is `Dark 2026` and
   `workbench.preferredHighContrastLightColorTheme` is `Default High
   Contrast` in the product's configuration defaults. These are the themes
   VS Code applies when it follows the system's light appearance or its
   high-contrast setting.

### Card layout

7. `workbench.experimental.modernUI` is `true`. The sidebar, the canvas area,
   and the Agent Area are separate cards with a corner radius of 8 px, a gap
   of 4 px between them, and a gutter of 4 px to the window edge. The title
   bar, the status bar, and the gaps share one background.
8. The layout is VS Code's own, at the state of release 1.141.0: the layout
   helpers of the layout service, the margins that the workbench parts
   reserve, `workbench/browser/media/floatingPanels.css`, and the module
   `workbench/contrib/modernUI`. BaseHalf adds no rules of its own for the
   corners, the gaps, or the borders of the workbench parts. Requirement 10
   is the one exception.
   [The upstream record](../../vscode-base/BASEHALF_UPSTREAM.md#modern-ui-brought-to-1141-on-2026-10-12)
   lists the files and what was left out.
9. The settings stay normal settings. A user who switches
   `workbench.experimental.modernUI` off gets the former layout, where the
   parts meet without a gap. `window.density.layout` set to `compact` keeps
   the rest of Modern UI and removes the gaps and the corner radii.
10. The Agent Area fills its card. In this layout the base keeps a gap of
    5 px below the last pane of a view container, for panes that end in a
    list. The Agent Area owns its whole part and paints its own background,
    so a gap would show as a strip of another color under a terminal. Its
    view container, and the container that hosts an extension agent's view
    inside it, are created with `fillsToBottomEdge`, an option that BaseHalf
    added to the base's view pane container for this.

### Git status colors and letters

11. With the theme loaded, the status letter of a changed file in Source
    Control and in Files has the theme's color for that status, and in Files
    the file name has it too. Nothing in BaseHalf sets these colors.
12. The status letter is drawn as VS Code 1.141 draws it: the label carries
    the marker classes `monaco-decoration-badge` and
    `monaco-decoration-text-badge`, and Source Control lays the letter out in
    a box of fixed size so that the letters of all rows line up.
13. The title of the Files view shows the workspace name as the user wrote
    it. The base's early version of the layout capitalized each word of it.

### Before the window has loaded

14. The picture that a window shows before the workbench has loaded has the
    same cards as the loaded window: each card where it was when the window
    last saved its layout, with the same corner radius, border, and
    background. It is VS Code's own code of 1.141.

## States and failure

- **Before the theme is loaded.** A window starts with the startup colors and
  switches to the theme when the extensions are registered, as in VS Code.
  Both are the same dark scheme, so the switch is small.
- **A window that has no saved layout yet.** The first window of a new
  profile has nothing to draw the cards from and shows a plain background
  until it has loaded.
- **The theme extension is missing or fails to load.** The window keeps the
  startup colors, and status colors have no value. This is the former state
  of the product. The smoke step below fails in that case.
- **A light theme is selected.** The default themes extension holds more
  themes than `Dark 2026`, and `Preferences: Color Theme` in the command
  palette lists them. See [Limits](#limits).

## Limits

- The canvas and the Agent Area terminal do not follow the color theme. With a
  light theme selected, the sidebar, title bar, and status bar are light and
  these two stay dark. A user reaches this only by choosing a light theme in
  the command palette; no menu offers it, and the system cannot switch to it
  (requirement 6). Making the canvas follow the theme is a design task of its
  own and belongs to roadmap track 9.
- These parts of VS Code 1.141's Modern UI are not in the product, because
  they need changes of the same release outside the layout:
  - translucent backgrounds of menus, the command palette, and other pop-ups
    (they need GPU compositing calls of the native host);
  - the connected shape of editor tabs. The stylesheets are there, the tab
    logic is the base's. BaseHalf shows no editor tabs
    (`workbench.editor.showTabs` is `none`);

## Acceptance criteria

1. In a window on a new profile, the workbench element carries the class of
   the loaded theme, and `--vscode-gitDecoration-modifiedResourceForeground`
   has a value.
2. In a workspace that is a git repository with a modified, a new, and a
   deleted file, the letters `M`, `U`, and `D` in Source Control have three
   different colors, and none is the color of the file name beside it.
3. The sidebar has a corner radius of 8 px. The gap between the sidebar and
   the canvas area, and between the canvas area and the Agent Area, is 4 px.
4. The top and the bottom of the Agent Area are within 1 px of the top and
   the bottom of its part, with a terminal session and with no session.
5. With `extensions.allowed` set to a list that leaves out
   `vscode.theme-defaults`, the extension is still allowed.
6. `vscode.theme-monokai` is not allowed.
7. A window that is started a second time shows, before it has loaded, a
   card for the sidebar, the canvas area, and the Agent Area at the positions
   and sizes these parts had in the first run, each with a corner radius of
   8 px.
8. For the same workspace and window size, the position, size, margin,
   border, corner radius, and background of the sidebar, the canvas area, the
   Agent Area part, the status bar, and the rows and badges of Source Control
   are those of VS Code 1.141 with its activity bar at the top and its tabs
   hidden.

## Verification

- `basehalfWorkbenchProfile.test.ts`: the extension families, the admitted
  and blocked theme extensions, and the configuration defaults.
- `basehalfAllowedExtensionsService.test.ts`: the theme extension is allowed,
  stays allowed under a narrower `extensions.allowed`, and other theme
  extensions are not.
- `npm run basehalf:smoke`, step `product-theme-and-cards`: criteria 1 and 3
  in the running window. The Agent Area steps check criterion 4 each time
  the Agent Area opens (`assertAgentAreaOwnsAuxiliaryBarChrome`).
- The unit tests that came with the ported files: `modernUI.contribution`,
  `part`, `activitybarPart`, `decorationsService`, `window`.
- `partsSplash.test.ts` (in `vs/code/test/electron-browser`): the metrics
  and colors of the picture before loading.
- Criteria 7 and 8 were measured once, on 2026-10-12: criterion 7 by starting
  a window twice and reading the picture of the second start, criterion 8 by
  reading the computed styles of both products side by side. Neither is an
  automated check.
