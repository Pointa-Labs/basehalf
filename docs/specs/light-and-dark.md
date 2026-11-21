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
   the colors a note stores in its file ([formats of a note](note-formats.md), a format, not a look), the page a
   book is drawn on by its reader, and the white ground a picture is flattened on before it is sent to a
   provider.
4. **The names a stylesheet already uses stay.** The canvas's variables (`--bh-card-surface` and the others)
   are defined once, in the canvas's block, each as its registry color. A rule keeps the name it uses.
5. A color of BaseHalf's is a color of the theme in every respect: `workbench.colorCustomizations` changes it
   as it changes any other.

### Dark is unchanged

6. Under a dark theme every pixel BaseHalf draws is what it was before this specification. The dark default of
   each color is the value the stylesheets held.

### The light palette

7. **The canvas is quiet paper**, a little darker than what lies on it and than the shell around it. Its lines
   are as faint as on the dark canvas: the theme's foreground at 4.5%.
8. **A card stands on the paper by a hairline and a little light**: a white surface, a border one step darker
   than the paper, and a shadow whose ink is a fraction of the dark one's. Nothing glows. A white surface never
   lies on a white ground without a border.
9. **Text is near black.** A card's four grays of text keep their order. Every color BaseHalf sets for text has
   a contrast of at least 4.5:1 against the ground it is drawn on; the table under "The palette" holds the
   measured ratios.
10. **Connections are as quiet as in the dark**: a line has about the contrast against the paper that the dark
    line has against the dark canvas (3.5:1), and its arrowhead is the stronger of the two, as in the dark.
11. **The accent is the theme's**: links, the focus ring, the intent of a drag, and the primary button take the
    theme's colors under both kinds, as before.
12. **The user's material looks as it does.** A picture, a video, a page of a PDF, a book's cover, and the
    colors of a code card's language are not recolored. What BaseHalf draws over a picture or a video (the
    player's controls, the crop frame, the marks of a pick, the duration on a tile) is light on a dark scrim
    under both kinds: it lies on the material, not on the theme.
13. **Behind a picture, a video, and a PDF in Card Detail stands the paper of the canvas**, not white and not
    black. The same file lies on the same ground on the canvas and when it is opened; a picture with a white
    ground keeps its edge, which it would lose on a white page; and a dark stage would be a dark room inside a
    light product, the split this specification removes. Under a dark theme the ground is Card Detail's own,
    as before.
14. **The backgrounds of a note** (its seven colors) are tints of the paper under a light theme, and the note's
    text on each keeps 4.5:1.
15. **The colors a note stores** are values in its file and stay the same values under every theme. Under a
    light theme a surface draws each stored value in the light form of the same color, so that colored words
    and words on a colored ground are readable; the file is not rewritten, and a note reads the same in both
    kinds after a switch back.
16. **Shadows.** A shadow's ink is a color of the registry: black under a dark theme, a low share of a dark
    ink under a light one, so that a menu, a toolbar, and a panel lift from the paper without a dark edge.

### The terminal

17. The terminal's colors (background, foreground, cursor, selection, the 16 colors, and the marks of a
    command) are the registry's own terminal colors, and BaseHalf sets their defaults for a dark and for a
    light theme in the same module. The dark defaults are the palette the profile held. The light defaults are a
    light ground with the 16 colors dark enough to be read on it: each of them except white and bright black
    has 4.5:1 against the ground, and those two at least 3:1, as they are the dim ones.
18. The product profile sets no `workbench.colorCustomizations`. The two themes of the product carry no terminal
    colors of their own, so the defaults show. A theme of the base that sets one of them shows its own. A
    user's customization holds over both, as for every color.
19. The Agent Area's chrome around a terminal (its tabs, dividers, and frame) is drawn from the terminal's
    background and foreground, as before, so it follows the terminal under both kinds.
20. High contrast themes keep the base's terminal colors for high contrast.

### Switching

21. A change of the theme changes every surface at once: an open canvas, an open Card Detail in each of its
    forms, an open Agent Area with a terminal, Settings. Nothing is reloaded, no surface keeps the old palette,
    and from the first frame after the change every surface shows the new one. A value that a script computed
    from a color (the page a book is drawn on) is computed again when the theme changes.

### High contrast

22. Under a high contrast dark theme BaseHalf draws its dark values and under a high contrast light theme its
    light values, each with the theme's contrast border where a rule already asked for it. Neither is worse
    than before this specification: high contrast dark is unchanged, and high contrast light no longer draws a
    black canvas in a white window.

### Following the system

23. The product's themes are the base's two defaults: `Dark 2026` and `Light 2026`. BaseHalf leaves
    `workbench.preferredDarkColorTheme` and `workbench.preferredLightColorTheme` at the base's defaults, which
    are these two, and `workbench.preferredHighContrastColorTheme` and
    `workbench.preferredHighContrastLightColorTheme` at the base's high contrast themes. The profile no longer
    turns the light ones dark.
24. With `window.autoDetectColorScheme` on, the base follows the system's appearance with those two themes, and
    BaseHalf with it. Its default stays the base's, off: the product starts dark.
25. A row "Appearance" of Settings would read and write only settings of the base:

    | Choice | Writes | Is shown when |
    | --- | --- | --- |
    | Dark | `window.autoDetectColorScheme` off, `workbench.colorTheme` `Dark 2026` | detection is off and the theme is of a dark kind |
    | Light | `window.autoDetectColorScheme` off, `workbench.colorTheme` `Light 2026` | detection is off and the theme is of a light kind |
    | Match the System | `window.autoDetectColorScheme` on | detection is on |

    The base ignores `workbench.colorTheme` while detection is on. Themes > Color Theme stays the way to the
    base's other themes.

## The palette

The values are in `ui/common/basehalfColors.ts`. The base colors, as hex or as red, green, blue and alpha:

| Color | Dark | Light |
| --- | --- | --- |
| The canvas | `#0b0c0d` | `#f3f3f1` |
| A card's surface | `#222426` | `#ffffff` |
| A card's quieter surface | `#191a1b` | `#f6f6f4` |
| A card's border | `#3a3c3f` | `#dededb` |
| A card's stronger border | `#565a5e` | `#bfc0bd` |
| Text of a card: primary, secondary, tertiary, faint | `#e1e2e3` `#b0b3b5` `#898d90` `#666a6d` | `#1d1e20` `#45484b` `#62656a` `#6c6f73` |
| A connection: line, arrowhead | `#666a6d` `#b1b1b7` | `#96989b` `#77797d` |
| The ink of a card's shadow | `#070809` | `#14181f` at 28% |
| The ink of other shadows | `#000000` | `#14181f` at 30% |
| A folder: surface, border, glyph | `#252524` `#494437` `#c5ad69` | `#fbf8ee` `#e2d8b9` `#8f6f1c` |
| The terminal: ground, text | `#1f1f1f` `#cccccc` | `#fcfcfb` `#1f2328` |

The contrast of each text color against its ground is measured by `basehalfColors.test.ts`, which fails under
4.5:1, and the ratios are listed in the decision's record (D148).

## States and failure

- **Before the theme is loaded.** The registry gives each color its default for the kind of the startup theme,
  so the canvas has its colors from the first frame it is drawn.
- **A theme of an extension.** BaseHalf's allowlist admits no theme but the base's defaults. A theme that sets
  none of BaseHalf's colors gets the defaults of its kind.
- **A customized color.** `workbench.colorCustomizations` with a `basehalf.*` color shows that color, in the
  window and in a page.
- **A page that is loading while the theme changes** gets the values of the theme it starts with, then the new
  ones by the same message every page gets.
- **A note with stored colors under a light theme** draws the light forms. A color outside the palette is drawn
  as written, as before.

## Limits

- The base's own surfaces (Files, Source Control, Search, menus, the Command Palette, a code card's editor,
  Source) take the theme's colors, not BaseHalf's. Under the two product themes they agree with BaseHalf's
  palette; under another theme of the base they are that theme's.
- A program in the terminal that draws with colors of its own choosing (24-bit colors) is not recolored. A
  program that asks the terminal for its background gets the light one.
- The picture a window shows before it has loaded follows the theme as in the base.
- The films, screenshots, and icons of the product are dark and stay so.

## Acceptance criteria

1. With `workbench.colorTheme` `Dark 2026`, screenshots of these states are equal pixel by pixel before and
   after this specification, apart from pixels that differ between two runs of the same build (a video's frame,
   a file's time): the canvas at 37% and at 100%, a note in Rich, in Preview, and in Source, a code card being
   edited, the selection toolbar, a note's toolbar, a generation panel, the Agent Area with a terminal, each
   page of Settings, a picture, a video, a sound, and a PDF in Card Detail, and the menus BaseHalf opens.
2. With `Light 2026`, in the same states: the canvas, every card, every toolbar, the view controls, the New
   button, Card Detail in each form, the generation panel, the Agent Area and its terminal, and Settings are
   light; no surface is dark except the user's material and what lies on it.
3. The computed background of `.basehalf-canvas-workbench` is the registry's value of `basehalf.canvasBackground`
   for the theme's kind, and the body of the page of Rich has the same variable with the same value.
4. Changing `workbench.colorTheme` between `Dark 2026` and `Light 2026` with a canvas, a note in Rich, and a
   terminal open: sampled every frame, the canvas, a card, the page of Rich, and the terminal's ground each go
   from the one palette to the other with no frame of a third color, and all are changed within the frames the
   base takes to apply a theme. No page is loaded again.
5. In a terminal under `Light 2026`: the prompt, the 16 colors, a listing with colors, and a colored diff are
   readable; the selection is visible; the cursor is visible.
6. Under `Default High Contrast` the states of criterion 1 are equal to before. Under `Default High Contrast
   Light` the canvas and cards are light and every card has a visible border.
7. With `window.autoDetectColorScheme` on and no theme chosen, the window shows `Dark 2026` while the system is
   dark and `Light 2026` while it is light.
8. No source of BaseHalf's holds a literal color outside `ui/common/basehalfColors.ts` and the named exceptions,
   and none names `prefers-color-scheme`.
9. Every text color of the light palette has at least 4.5:1 against its ground, and every one of the dark
   palette that had it keeps it.

## Verification

- `ui/test/node/basehalfColors.test.ts` reads the sources: criterion 8.
- `ui/test/common/basehalfColors.test.ts`: every color has a default for each of the four kinds, one dot in its
  identifier, and the contrasts of criterion 9; the terminal's dark defaults are the palette the profile held.
- `basehalfWorkbenchProfile.test.ts`: the profile sets no color customizations and no preferred theme.
- The smoke's `navigation` suite, step `light-and-dark`: criteria 3 and 4 in the running window, read from the
  computed styles of the window and of the page of Rich under each theme.
- Criteria 1, 2, 5, 6, and 7 are looked at in the real window: screenshots of each state under both themes,
  compared pixel by pixel for the dark one.
