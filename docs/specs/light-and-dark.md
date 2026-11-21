# Light and dark

Status: Active (2026-11-21)
Related: public decision D148, [workbench appearance](workbench-appearance.md) for the theme extension and the
card layout, [architecture invariants](../harness/architecture-invariants.md#product-shell),
[Agent Area terminal](agent-area-terminal.md), [formats of a note](note-formats.md) for the colors a note stores,
[the settings BaseHalf offers](settings-catalog.md)

## Problem

BaseHalf was a dark product inside a base that has light themes. The gear's menu offers Themes > Color Theme, so
any user gets there. Seen in the real window on 2026-11-21 with a light theme chosen: the sidebar, the title bar,
and the status bar turned light; the canvas stayed black; a code card turned white on the black canvas; the
toolbar of a note turned white; the controls at the canvas's bottom left and its New button nearly vanished; the
Agent Area's terminal stayed dark in a light frame.

Measured in the sources on the same day (`src/vs/workbench/basehalf`, `src/vs/platform/basehalf*`, and the page
bundles under `extensions/basehalf/*-src`; comments and tests left out). A color is written in one of four ways:
a variable of the theme (`var(--vscode-…)`), a variable of BaseHalf's defined once and used by name
(`var(--bh-…)`, `var(--basehalf-…)`), or a literal value (`#222426`, `rgb(0 0 0 / 32%)`, `white`).

| Surface | Files | Literal values (stylesheets / code) | Uses of a theme variable | Uses of BaseHalf's variables |
| --- | --- | --- | --- | --- |
| Canvas and cards | 16 | 86 (32 / 54) | 72 | 175 |
| Card Detail: picture, video, sound | 6 | 43 (42 / 1) | 80 | 33 |
| Toolbars and view controls of the canvas | 11 | 33 (32 / 1) | 134 | 42 |
| Generation panels and the Providers page | 9 | 29 (28 / 1) | 218 | 88 |
| Settings, About, and the product profile | 3 | 28 (1 / 27) | 30 | 0 |
| The page of Rich | 3 | 28 (27 / 1) | 119 | 7 |
| The pages of a PDF and a book | 3 | 14 (5 / 9) | 86 | 1 |
| Card Detail: its frame, Preview, Source, the outline | 5 | 12 (10 / 2) | 81 | 17 |
| The Agent Area and its terminal | 2 | 10 (6 / 4) | 57 | 66 |
| Connections, change marks, the scene's vendor sheet, shared parts | 5 | 0 | 12 | 11 |
| **All** | **63** | **283 (183 / 100)** | **889** | **440** |

So more than half of what BaseHalf draws already asked the theme, and that is why the surfaces came apart:

- **The canvas stayed dark** because its 17 base colors were literal values in one block
  (`.basehalf-canvas-workbench` in `basehalfCanvasWorkbench.css`): the canvas, a card's surface and borders, four
  grays of text, the folder's golds, warning and danger. The 277 uses of `--bh-…` variables all lead there.
- **The code card and the toolbars turned light** because they are drawn with the theme's variables
  (`--vscode-editor-background`, `--vscode-editorWidget-background`).
- **The view controls vanished** because their glyphs take `--vscode-foreground`, near black under a light
  theme, on the canvas that stayed black.
- **The terminal stayed dark** because the product profile set `workbench.colorCustomizations` by default, and a
  customization holds over every theme, a light one too. The two themes of the product carry terminal colors of
  their own under it, which never showed.
- Of the 100 literal values in code, 54 are the colors a note stores (the palette of Rich) and 27 the terminal's
  palette in the profile. Of the 183 in stylesheets, 42 are drawn over or beside a picture or a video, 41 are the
  ink of a shadow, 30 a fallback after a variable that always has a value, 18 the black of a mask (which is no
  color), 17 the canvas's base colors, 14 the backgrounds of a note, 8 the yellow of an edit mode and its text,
  and 13 others: a black or a white mixed into another color, the page of Rich's copies of a card's grays, the
  knob of a switch.
- The system could not switch BaseHalf to light by itself: the profile set `workbench.preferredLightColorTheme`
  to the dark theme for that reason.

The surfaces can draw from one set of colors with a dark and a light value: the set is small and already had
one place. A light BaseHalf is built; keeping BaseHalf dark under every theme was the fallback and is set aside
(D148).

## Scope

In scope: the colors of everything BaseHalf draws, in the window and in the pages it shows in a frame; the
terminal's palette; which themes the product has for dark and light and how it follows the system's appearance.

Not in scope: a row in Settings (the settings pages own it; "Following the system" below says what it reads and
writes); a theme of BaseHalf's own; the shapes, sizes, and fonts of anything; the base's own parts, which follow
their theme as in VS Code.

## Requirements

### One mechanism

1. **BaseHalf's colors are colors of the base's color registry.** Each has an identifier `basehalf.<name>`, a
   description, and a default for each kind of theme: dark, light, high contrast dark, high contrast light. All
   are registered in one module, `ui/common/basehalfColors.ts`. The workbench gives each to the window as the
   variable `--vscode-basehalf-<name>` and to every page in a frame under the same name, and gives both the new
   values when the theme changes. An identifier has one dot, so that the window and a page spell the variable
   alike.
2. **The kind of the theme decides, never its name.** A value is chosen by the kind the theme declares. Where a
   stylesheet must differ by kind beyond a color, the window styles under the class of the kind on the
   workbench's root (`vs`, `vs-dark`, `hc-black`, `hc-light`), and a page under the class the workbench keeps on
   its body (`vscode-light`, `vscode-dark`, `vscode-high-contrast`, `vscode-high-contrast-light`), as a page
   reads reduced motion (D139). Nothing BaseHalf draws asks the system for its appearance
   (`prefers-color-scheme`): the theme is the answer, and the base asks the system for it when the user says so.
3. **No literal color outside that module.** A stylesheet or a source of BaseHalf's writes a color as a variable
   of the theme, as one of BaseHalf's, or as a mix of them (`color-mix`, `transparent`, `currentColor`, the
   system colors of forced colors). The exceptions are named in the test that checks this: the black of a mask,
   which draws nothing; the colors a note stores in its file ([formats of a note](note-formats.md), a format,
   not a look), in the module that holds them, in what the skill tells an agent of them, and in the selectors
   that find them; and the white a picture is flattened on before it is sent to a provider.
4. **A color with a share of transparency is a color of its own for each share**, named by the share in
   percent: `basehalf.shadow32` is the ink of a shadow at 32%. A share written in the registry reaches a
   stylesheet as the same number the literal value had. A share mixed in the stylesheet (`color-mix` with
   `transparent`) is computed another way and is off by one step of 255 in some pixels, which rule 6 does not
   allow.
5. **The names a stylesheet already uses stay.** The canvas's variables (`--bh-card-surface` and the others)
   are defined once, in the canvas's block, each as its registry color. A rule keeps the name it uses.
6. A color of BaseHalf's is a color of the theme in every respect: `workbench.colorCustomizations` changes it
   as it changes any other.

### Dark is unchanged

7. Under a dark theme every pixel BaseHalf draws is what it was before this specification. The dark default of
   each color is the value the stylesheets held, and where a part of Rich was drawn by the editor's own sheet
   in one color whatever the theme (a block of code, a quote), that color is the dark default.

### The light palette

8. **The canvas is quiet paper**, a little darker than what lies on it and than the shell around it. Its lines
   are as faint as on the dark canvas: the theme's foreground at 4.5%.
9. **A card stands on the paper by a hairline and a little light**: a white surface, a border one step darker
   than the paper, and a shadow whose ink is three tenths of the dark one's share. Nothing glows. A white
   surface never lies on a white ground without a border: the swatches of a note's backgrounds have an edge
   under a light theme, and a block of code in a note has a ground of its own.
10. **Text is near black.** A card's four grays of text keep their order. Every color BaseHalf sets for text
    has a contrast of at least 4.5:1 against the ground it is drawn on; "The palette" holds the measured ratios.
11. **Connections are as quiet as in the dark**: a line has about the contrast against the paper that the dark
    line has against the dark canvas (3.4:1 and 3.5:1), and its arrowhead is the stronger of the two, as in
    the dark.
12. **The accent is the theme's**: links, the focus ring, the intent of a drag, and the primary button take the
    theme's colors under both kinds, as before.
13. **The user's material looks as it does.** A picture, a video, a page of a PDF, a book's cover, and the
    colors of a code card's language are not recolored. What BaseHalf draws over a picture or a video (the
    player's controls and its black ground, the crop frame, the marks of a pick, the duration on a tile) is
    light on a dark scrim under both kinds: it lies on the material, not on the theme.
14. **Behind a picture, a video, a sound, and a PDF in Card Detail stands the paper of the canvas**, not white
    and not black. The same file lies on the same ground on the canvas and when it is opened; a picture with a
    white ground keeps its edge, which it would lose on a white page; and a dark stage would be a dark room
    inside a light product, the split this specification removes. Under a dark theme the ground is Card
    Detail's own, as before. What is written about the file (how it was generated) stays on Card Detail's page
    under it. A book is text and is read on the page, as a note is.
15. **The part of a picture a crop leaves out recedes into what stands behind it**: into the dark under a dark
    theme, into the paper under a light one. The picture is edited on the same ground it is viewed on.
16. **The backgrounds of a note** (its seven colors) are tints of the paper under a light theme, and the note's
    text on each keeps 4.5:1.
17. **The colors a note stores** are values in its file and stay the same values under every theme. Under a
    light theme a surface draws each stored value in the light form of the same color, so that colored words
    and words on a colored ground are readable: the card, the card's editor, Preview, Rich, and a block Rich
    shows as it is written. The file is not rewritten, and a note reads the same in both kinds after a switch
    back.
18. **Shadows.** A shadow's ink is a color of the registry: black under a dark theme, a low share of a dark
    blue-gray under a light one, so that a menu, a toolbar, and a panel lift from the paper without a dark
    edge. A high contrast light theme draws no shadow, as the base's own widgets there.
19. **The veil over several selected cards** lies on white cards under a light theme: it is light enough there
    that a selected card stays white.

### The terminal

20. The terminal's colors (background, foreground, cursor, selection, the 16 colors, and the marks of a
    command) are the registry's own terminal colors, and BaseHalf sets their defaults for a dark and for a
    light theme in the same module; the base's file that registers them asks for these. The dark defaults are
    the palette the profile held. The light defaults are a light ground with the 16 colors dark enough to be
    read on it: each has 4.5:1 against the ground, apart from bright black, the dim one, which has 3.7:1.
    White and bright white are a gray and a near black there: a program that writes bold white or bright white
    for what matters is read.
21. The product profile sets no `workbench.colorCustomizations`. The base's default themes (`Dark 2026`,
    `Light 2026`, and the Modern, Plus, and Visual Studio themes under them) carry none of these terminal
    colors, so BaseHalf's defaults show under each. A user's customization holds over them, as for every
    color, and it no longer replaces the whole palette.
22. **A character keeps its contrast against the ground of its cell under a light theme.** BaseHalf's default
    for `terminal.integrated.minimumContrastRatio` is 1, the palette as it is, which the dark palette is made
    for. On a light ground a program that writes white on a color (a badge), or its default text on black,
    cannot be read at 1. So while the user has set no ratio, a light theme takes the base's own default, 4.5,
    and a high contrast theme 7. The light palette already has 4.5:1 for its own colors, so nothing that could
    be read changes. A ratio the user sets holds under every theme.
23. The Agent Area's chrome around a terminal (its tabs, dividers, and frame) is drawn from the terminal's
    background and foreground, as before, so it follows the terminal under both kinds. Where a theme gives the
    terminal no background, the chrome takes the sidebar's.
24. High contrast themes keep the base's terminal colors for high contrast.

### Switching

25. A change of the theme changes every surface at once: an open canvas, an open Card Detail in each of its
    forms, an open Agent Area with a terminal, Settings. Nothing is reloaded, no surface keeps the old palette,
    and the frame after the change draws the new palette whole. While the theme changes nothing in the window
    glides: a card, a toolbar, and a control move between their own states over a tenth of a second or two, and
    with the theme's colors as those states they would fade from the old palette to the new on a canvas that is
    already light. A value that a script computed from a color (the page a book is drawn on) is computed again
    when the theme changes.

### High contrast

26. Under a high contrast dark theme BaseHalf draws its dark values and under a high contrast light theme its
    light values, with the theme's contrast border around a card, a folder, and a control, a white canvas, and
    connections near black. Neither is worse than before this specification: under high contrast dark the
    canvas and its cards are unchanged and the terminal has the base's high contrast colors at 7:1 in place of
    BaseHalf's dark palette; high contrast light no longer draws a black canvas in a white window.

### Following the system

27. The product's themes are the base's two defaults: `Dark 2026` and `Light 2026`. BaseHalf leaves
    `workbench.preferredDarkColorTheme` and `workbench.preferredLightColorTheme` at the base's defaults, which
    are these two, and `workbench.preferredHighContrastColorTheme` and
    `workbench.preferredHighContrastLightColorTheme` at the base's high contrast themes. The profile no longer
    turns the light ones dark.
28. With `window.autoDetectColorScheme` on, the base follows the system's appearance with those two themes, and
    BaseHalf with it. Its default stays the base's, off: the product starts dark.
29. A row "Appearance" of Settings would read and write only settings of the base:

    | Choice | Writes | Is shown when |
    | --- | --- | --- |
    | Dark | `window.autoDetectColorScheme` off, `workbench.colorTheme` `Dark 2026` | detection is off and the theme is of a dark kind |
    | Light | `window.autoDetectColorScheme` off, `workbench.colorTheme` `Light 2026` | detection is off and the theme is of a light kind |
    | Match the System | `window.autoDetectColorScheme` on | detection is on |

    The base ignores `workbench.colorTheme` while detection is on. Themes > Color Theme stays the way to the
    base's other themes.

## The palette

The values are in `ui/common/basehalfColors.ts`. The base colors:

| Color | Dark | Light |
| --- | --- | --- |
| The canvas | `#0b0c0d` | `#f3f3f1` |
| A card's surface | `#222426` | `#ffffff` |
| A card's quieter surface | `#191a1b` | `#f6f6f4` |
| A card's border | `#3a3c3f` | `#dbdbd7` |
| A card's stronger border | `#565a5e` | `#b9bab6` |
| Text of a card: primary, second, third, faintest | `#e1e2e3` `#b0b3b5` `#898d90` `#666a6d` | `#1d1e20` `#45484b` `#5b5e62` `#626569` |
| A connection: line, arrowhead | `#666a6d` `#b1b1b7` | `#818386` `#6a6c70` |
| The ink of a card's shadow, at 46%, 34%, and 12% | `rgb(7 8 9)` | `rgb(20 24 31)` at three tenths of the share |
| The ink of other shadows, at 16% to 60% | black | `rgb(20 24 31)` at three tenths of the share |
| A folder: surface, border, glyph | `#252524` `#494437` `#c5ad69` | `#fbf8ee` `#e2d8b9` `#8a6a18` |
| A note's backgrounds: red, orange, yellow, green, cyan, blue, purple | `#392626` `#3b2c22` `#373320` `#22332a` `#203238` `#222f3d` `#30273c` | `#fce6e4` `#fcead6` `#fbf1c8` `#e0f2e4` `#dbf0f4` `#dfeafb` `#ece4f9` |
| A block of code in a note: ground, text | `#161616` `#ffffff` | `#f1f1ef` `#1d1e20` |
| Behind a picture in Card Detail | Card Detail's page | `#f3f3f1` |
| The terminal: ground, text | `#1f1f1f` `#cccccc` | `#fdfdfc` `#1f2328` |

The contrast of each text color against its ground, measured on 2026-11-21 (WCAG 2 contrast ratio). The dark
column is what a dark theme draws and drew before; the faintest text of a card had under 4.5:1 there and is
unchanged (rule 7).

| Text | Light value on its ground | Light | Dark |
| --- | --- | --- | --- |
| A card's text on a card | `#1d1e20` on `#ffffff` | 16.7 | 12.0 |
| Its second text on a card | `#45484b` on `#ffffff` | 9.2 | 7.4 |
| Its third text on a card | `#5b5e62` on `#ffffff` | 6.5 | 4.7 |
| Its faintest text on a card | `#626569` on `#ffffff` | 5.9 | 2.9 |
| Its third text on the canvas | `#5b5e62` on `#f3f3f1` | 5.9 | 5.9 |
| Its faintest text on the canvas | `#626569` on `#f3f3f1` | 5.3 | 3.6 |
| Its third text on the quieter surface | `#5b5e62` on `#f6f6f4` | 6.0 | 5.2 |
| Its faintest text on the quieter surface | `#626569` on `#f6f6f4` | 5.4 | 3.2 |
| The faintest text on a note's background, the lowest of the seven (purple) | `#626569` on `#ece4f9` | 4.8 | 2.6 |
| Colored words of a note on a card, the lowest of the nine (gray; dark: pink) | `#6f6e69` on `#ffffff` | 5.1 | 5.2 |
| A card's text on a colored ground of words, the lowest of the nine (purple; dark: orange) | `#1d1e20` on `#e5dbf7` | 12.6 | 7.9 |
| A folder's glyph on its card | `#8a6a18` on `#fbf8ee` | 4.8 | 7.0 |
| A warning on a card | `#8a6d00` on `#ffffff` | 4.9 | 6.7 |
| A failure on a card | `#c62828` on `#ffffff` | 5.6 | 4.4 |
| A failure on its ground | `#c62828` on `#fde7e7` | 4.8 | 3.6 |
| Code in a note on its ground | `#1d1e20` on `#f1f1ef` | 14.8 | 18.1 |
| A quote in a note | `#5b5e62` on `#ffffff` | 6.5 | 3.6 |
| The words of Done on its yellow | `#1c1c1e` on `#f5c400` | 10.4 | 12.1 |

| Terminal color | Light | Against the light ground | Dark | Against the dark ground |
| --- | --- | --- | --- | --- |
| `terminal.foreground` | `#1f2328` | 15.5 | `#cccccc` | 10.3 |
| `terminal.ansiBlack` | `#1f2328` | 15.5 | `#272727` | 1.1 |
| `terminal.ansiRed` | `#c4322e` | 5.4 | `#f74949` | 4.7 |
| `terminal.ansiGreen` | `#1a7f37` | 5.0 | `#2ea043` | 4.9 |
| `terminal.ansiYellow` | `#7d5e00` | 5.9 | `#9e6a03` | 3.5 |
| `terminal.ansiBlue` | `#0b63ce` | 5.6 | `#0078d4` | 3.6 |
| `terminal.ansiMagenta` | `#7a3fd6` | 5.9 | `#d01273` | 3.2 |
| `terminal.ansiCyan` | `#0a7c86` | 4.9 | `#1db4d6` | 6.7 |
| `terminal.ansiWhite` | `#656d76` | 5.2 | `#cccccc` | 10.3 |
| `terminal.ansiBrightBlack` | `#7c848c` | 3.7 | `#5d5d5d` | 2.5 |
| `terminal.ansiBrightRed` | `#d1242f` | 5.2 | `#dc5452` | 4.3 |
| `terminal.ansiBrightGreen` | `#18803a` | 4.9 | `#23d18b` | 8.3 |
| `terminal.ansiBrightYellow` | `#8f6a00` | 4.9 | `#f5f543` | 14.1 |
| `terminal.ansiBrightBlue` | `#1f6feb` | 4.6 | `#3b8eea` | 4.9 |
| `terminal.ansiBrightMagenta` | `#8f52e8` | 4.5 | `#d670d6` | 5.6 |
| `terminal.ansiBrightCyan` | `#0b7f89` | 4.7 | `#29b8db` | 7.0 |
| `terminal.ansiBrightWhite` | `#1b1f23` | 16.3 | `#e5e5e5` | 13.1 |

`basehalfColors.test.ts` under `ui/test/common` fails when a text color of the light palette falls under 4.5:1
against a ground it is drawn on.

## States and failure

- **Before the theme is loaded.** The registry gives each color its default for the kind of the startup theme,
  so the canvas has its colors from the first frame it is drawn.
- **A theme of an extension.** BaseHalf's allowlist admits no theme but the base's defaults. A theme that sets
  none of BaseHalf's colors gets the defaults of its kind.
- **A customized color.** `workbench.colorCustomizations` with a `basehalf.*` color shows that color, in the
  window and in a page.
- **A page that is loading while the theme changes** gets the values of the theme it starts with, then the new
  ones by the same message every page gets.
- **A note with stored colors under a light theme** draws the light forms. A color outside the palette, or a
  palette color in another spelling than the one BaseHalf writes, is drawn as written, as before.
- **A theme that gives the terminal no background** (the high contrast themes): the terminal and the Agent
  Area's chrome take the sidebar's.

## Limits

- The base's own surfaces (Files, Source Control, Search, menus, the Command Palette, a code card's editor,
  Source, and Preview's own rendering) take the theme's colors, not BaseHalf's. Under the two product themes
  they agree with BaseHalf's palette; under another theme of the base they are that theme's.
- A program in the terminal that draws with colors of its own choosing (24-bit colors) is not recolored. A
  program that asks the terminal for its background gets the light one. The contrast of rule 22 lifts or sinks
  the foreground of a cell only; it does not hold for powerline characters, as in the base.
- Colored words of a note on a colored ground of words, both chosen by the user, have no ratio that is kept:
  the nine by nine pairs are the user's.
- The picture a window shows before it has loaded follows the theme as in the base.
- A page in a frame gets the new colors by the base's message to it, in the frames the base takes for that: the
  window and the page each change in one frame of their own, which need not be the same frame.
- The films, screenshots, and icons of the product are dark and stay so.

## Acceptance criteria

1. With `workbench.colorTheme` `Dark 2026`, screenshots of these states are equal pixel by pixel before and
   after this specification, apart from pixels that differ between two runs of the same build (the frame of a
   video that played, the place of its playhead, a scroll bar that fades): the canvas at 37% and at 100%, a
   note in Rich, in Preview, and in Source, a code card being edited, the selection toolbar, a note's toolbar
   and its backgrounds, a generation panel, the Agent Area with a terminal and a selection in it, each page of
   Settings, a picture, a video, a sound, a PDF, and a code file in Card Detail, a picture, a video, and a
   sound being edited, and the menus BaseHalf opens.
2. With `Light 2026`, in the same states: the canvas, every card, every toolbar, the view controls, the New
   button, Card Detail in each form, the generation panel, the Agent Area and its terminal, and Settings are
   light; no surface is dark except the user's material and what lies on it.
3. The computed background of `.basehalf-canvas-workbench` is the registry's value of `basehalf.canvasBackground`
   for the theme's kind, and the page of Rich has BaseHalf's colors under the same names with the values of the
   same kind.
4. Changing `workbench.colorTheme` between `Dark 2026` and `Light 2026` with a canvas, a note in Rich, and a
   terminal open: sampled every frame, the canvas, a card's surface and border, Card Detail, the Agent Area,
   the terminal's text, and the sidebar each have the old value, then the new, with no value between, and all
   change in the same frame of the window; the page of Rich changes its kind, its text, and BaseHalf's colors in
   one frame of its own and is the page that was open.
5. In a terminal under `Light 2026`: the prompt, the 16 colors as text and as grounds, a listing with colors, a
   colored diff, white on a colored ground, and a full-screen program are readable; the selection is visible;
   the cursor is visible.
6. Under `Default High Contrast` the canvas and its cards are as before. Under `Default High Contrast Light`
   the canvas and cards are light, every card has the theme's contrast border, and the terminal is read.
7. With `window.autoDetectColorScheme` on, the window shows `Dark 2026` while the system is dark and
   `Light 2026` while it is light, whatever `workbench.colorTheme` says.
8. No source of BaseHalf's holds a literal color outside `ui/common/basehalfColors.ts` and the named exceptions,
   and none names `prefers-color-scheme`.
9. Every text color of the light palette has at least 4.5:1 against its ground, and every one of the dark
   palette has the ratio it had.

## Verification

- `ui/test/node/basehalfColors.test.ts` reads the sources: criterion 8.
- `ui/test/common/basehalfColors.test.ts`: every color has one dot in its identifier and a value under each of
  the four kinds; the dark defaults are the values the stylesheets held, a note's stored values among them; the
  contrasts of criterion 9; a connection's two ratios; the terminal's dark defaults are the palette the profile
  held, its light ones are read on the light ground, and high contrast keeps the base's; the contrast ratio of
  rule 22 by kind.
- `ui/test/browser/basehalfThemeChange.test.ts`: nothing glides in the frames a change of the theme is drawn in.
- `basehalfWorkbenchProfile.test.ts`: the profile sets no color customizations, no theme, and no detection.
- `terminalColorRegistry.test.ts` of the base: the 16 colors under a dark and a light theme are BaseHalf's.
- The smoke's `navigation` suite, step `light-and-dark`: criteria 3 and 4 in the running window.
- Criteria 1, 2, 5, and 6 are looked at in the real window: screenshots of each state under both themes, the
  dark ones compared pixel by pixel between the build before and the build after; criterion 4 is also sampled
  there. Criterion 7 was seen on 2026-11-21 for a dark system only: the light half is the base's own path with
  its default theme for it.
- Criterion 1 as measured on 2026-11-21, at two device pixels per pixel, the window behind another application
  and its color profile fixed, each build started on a fresh copy of one folder: 51 screenshots of 2880 by 1800,
  of which 40 are equal in every pixel. The 11 others differ where two runs of one build differ too: the frame
  a video stopped at and the place of its playhead (the canvas's video card, left out of the count in five
  screenshots, and the player in two), a scroll bar that fades (two), the line of the cursor in a code card
  (one), and up to 82 pixels by up to three steps of 255 along the top of a picture's card and the rims of
  cards (five). Three things were found by this comparison and fixed: a share of transparency mixed in the
  stylesheet (rule 4), a swatch's edge of no color, which still changed the rim of the round swatch, and the
  terminal's inactive selection, which a theme under the default ones set.
- What makes two screenshots comparable, found the hard way: the title bar has another color while the window
  is the front one, a driver that is connected keeps the document focused, the window opens on whichever
  display is in use and takes its scale and its color profile, and a zoom by the wheel lands a hair apart from
  run to run, which shows as one step on a smoothed edge. A comparison fixes the scale and the profile at
  launch, puts the window behind before a driver connects, and zooms by the number.
