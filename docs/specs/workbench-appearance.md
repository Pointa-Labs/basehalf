# Workbench appearance

Status: Active (2026-10-12)
Related: [architecture invariants](../harness/architecture-invariants.md),
roadmap tracks 8 and 9, public decisions D22 and D51,
[Git/SCM/GitHub/GitGraph](../git-scm-github-gitgraph.md)

## Problem

BaseHalf is built on VS Code and is meant to look like it wherever it reuses
its parts. It did not. Two things were different, and both came from the same
cause.

- **No status colors in Git.** In Source Control and in Files, the status
  letter after a changed file (`M`, `U`, `D`) and the file name were the same
  gray as every other label. In VS Code a modified file is yellow, a new file
  is green, and a deleted file is red.
- **Startup colors.** The window showed the colors that VS Code paints for the
  first moments of a start, before its color theme is loaded, and kept them.

The cause: the color theme is supplied by a built-in extension,
`vscode.theme-defaults`, and the product's extension allowlist (D22) did not
admit it. No theme was ever loaded. A color that an extension contributes,
such as the Git status colors, gets its value when a theme is applied, so
these colors had no value at all.

Separately, VS Code now draws the sidebar, the editor area, and the secondary
sidebar as separate rounded cards with a gap between them (its Modern UI).
The base that BaseHalf imported already contains this layout, switched off by
default.

## Scope

In scope:

- which color theme the product shows, and where it comes from;
- the card layout of the workbench parts: the sidebar, the canvas area, and
  the Agent Area;
- the status colors in Source Control and Files.

Not in scope, and unchanged:

- The palette of the canvas and of the Agent Area terminal. Both have a dark
  palette of their own (see [Limits](#limits)).
- The code of Source Control, Files, and the Git extension. BaseHalf uses VS
  Code's implementation as it is
  ([Git/SCM/GitHub/GitGraph](../git-scm-github-gitgraph.md)).
- A file icon theme. The product shows no file icons in Files and Source
  Control, as before.
- Changes that VS Code made to its Modern UI after the imported base, such as
  a larger corner radius, connected editor tabs, and translucent overlays.
  They arrive when the base is updated from upstream
  (`vscode-base/BASEHALF_UPSTREAM.md`). Do not copy single upstream files of
  a later version into the base to get them earlier.

## Requirements

### Color theme

1. The product color theme is VS Code's default dark theme, `Dark 2026`,
   which is the default value of `workbench.colorTheme` in the base. BaseHalf
   does not define a theme of its own.
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

### Card layout

6. `workbench.experimental.modernUI` is `true` in the product's configuration
   defaults. The sidebar, the canvas area, and the Agent Area are then
   separate cards with rounded corners and a gap between them and to the
   window edge.
7. The layout is the base's own (`workbench/contrib/styleOverrides` and
   `workbench/browser/media/floatingPanels.css`). BaseHalf adds no rules of
   its own for the corners, the gaps, or the borders of the workbench parts.
   Requirement 9 is the one exception.
8. The setting stays a normal setting. A user who switches it off gets the
   former layout, where the parts meet without a gap.
9. The Agent Area fills its card. In this layout the base keeps a gap of
   5 px below the last pane of a view container, for panes that end in a
   list. The Agent Area owns its whole part and paints its own background,
   so a gap would show as a strip of another color under a terminal. Its
   view container, and the container that hosts an extension agent's view
   inside it, are created with `fillsToBottomEdge`, an option that BaseHalf
   added to the base's view pane container for this.

### Git status colors

10. With the theme loaded, the status letter of a changed file in Source
   Control and in Files has the theme's color for that status, and in Files
   the file name has it too. Nothing in BaseHalf sets these colors.

## States and failure

- **Before the theme is loaded.** A window starts with the startup colors and
  switches to the theme when the extensions are registered, as in VS Code.
  Both are the same dark scheme, so the switch is small.
- **The theme extension is missing or fails to load.** The window keeps the
  startup colors, and status colors have no value. This is the former state
  of the product. The smoke step below fails in that case.
- **Another theme is selected.** The default themes extension holds more
  themes than `Dark 2026`, and the Color Theme picker lists them. See
  [Limits](#limits).

## Limits

- The canvas and the Agent Area terminal do not follow the color theme. With a
  light theme selected, the sidebar, title bar, and status bar are light and
  these two stay dark. The product has been dark only so far; the picker had
  no themes to offer before this specification. Making the canvas follow the
  theme belongs to roadmap track 9.
- The layout is the one of the imported base. It differs in details from the
  current VS Code release (a corner radius of 6 px, not 8 px).

## Acceptance criteria

1. In a window on a new profile, the workbench element carries the class of
   the loaded theme, and `--vscode-gitDecoration-modifiedResourceForeground`
   has a value.
2. In a workspace that is a git repository with a modified, a new, and a
   deleted file, the letters `M`, `U`, and `D` in Source Control have three
   different colors, and none is the color of the file name beside it.
3. The sidebar has rounded corners, and there is a gap between the sidebar
   and the canvas area, and between the canvas area and the Agent Area.
4. The top and the bottom of the Agent Area are within 1 px of the top and
   the bottom of its part, with a terminal session and with no session.
5. With `extensions.allowed` set to a list that leaves out
   `vscode.theme-defaults`, the extension is still allowed.
6. `vscode.theme-monokai` is not allowed.

## Verification

- `basehalfWorkbenchProfile.test.ts`: the extension families, the admitted
  and blocked theme extensions, and the configuration default.
- `basehalfAllowedExtensionsService.test.ts`: the theme extension is allowed,
  stays allowed under a narrower `extensions.allowed`, and other theme
  extensions are not.
- `npm run basehalf:smoke`, step `product-theme-and-cards`: criteria 1 and 3
  in the running window. The Agent Area steps check criterion 4 each time
  the Agent Area opens (`assertAgentAreaOwnsAuxiliaryBarChrome`).
