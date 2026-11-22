# BaseHalf's Settings

Status: Active (2026-11-21; replaces the pages BaseHalf drew inside the
Settings editor of the base, 2026-10-21; 2026-11-22, D152: drawn as the
base's Settings, without boxes)
Decisions: [D137](../decisions.md#d137--every-setting-has-one-of-five-classes-and-a-setting-nothing-follows-is-work-not-waste-new-2026-11-21)
made Settings BaseHalf's own;
[D143](../decisions.md#d143--a-setting-of-basehalfs-own-is-a-choice-only-the-user-can-make-and-settings-has-a-page-for-each-part-of-the-product-new-2026-11-21)
gave it a page for each part of the product and the settings of BaseHalf's
own;
[D152](../decisions.md#d152--settings-is-drawn-as-the-bases-settings-blocks-on-the-page-no-boxes-new-2026-11-22)
gave it the look of the base's Settings;
[D49](../decisions.md#d49--the-state-of-an-update-is-a-page-in-settings-not-a-card-new-2026-10-12)
put the About page in Settings,
[D59](../decisions.md#d59--video-providers-are-built-in-integrations-with-each-models-exact-settings-users-bring-their-own-keys-new-2026-10-19)
the page of providers,
[D64](../decisions.md#d64--basehalf-generates-images-with-the-same-cards-panel-and-providers-new-2026-10-22)
named it Providers, and
[D107](../decisions.md#d107--the-providers-page-sorts-the-providers-by-card-type-and-a-providers-one-key-serves-every-card-type-it-makes-new-2026-10-31)
sorted it by card type.
Related: [the settings BaseHalf offers](settings-catalog.md) (which settings
are shown, and which the advanced list holds),
[providers](providers.md#credentials-regions-and-endpoints) (what the
Providers page holds), [app update](app-update.md#where-an-update-shows)
(what the About page holds), [generation cards](generation-cards.md#the-panel)
(Set Up and Providers… of the panel)

This specification owns BaseHalf's Settings: its pages, which settings each
page lists and under which names, how a setting is changed there, how
Settings opens, also at a page, and how Keyboard Shortcuts and the Settings
editor of the base are reached. What a setting does is owned by the
specification of the surface it changes, named in the tables below. What the
Providers and the About page hold is owned by the specifications linked
above.

## Problem

Measured in the real window on 2026-11-21:

- **Settings was the Settings editor of the base.** It opened on Commonly
  Used, the editor's font size and Format On Save, with a search over 1,353
  settings, a choice between User and Workspace, and ten groups of which
  BaseHalf was the fifth. BaseHalf's five settings stood in four areas of
  one or two settings each.
- **Its words were the base's.** A setting read "Controls whether BaseHalf
  offers to install its skill for your agents: in a notification when you
  open a folder, and in the status bar until you answer. The skill tells
  agents such as Claude Code and Codex what you select and where a card's
  description and connections are." Two settings of one area were named
  "Agent: Default Session" and "Agents: Offer Skill".
- **The two pages stood inside it**, under a search box and a choice of
  scope that did nothing for them, and the Providers page had 379 of the
  overlay's 692 points of height: its key field was cut off at first sight.

Read in the code and seen in the real window later that day, with Settings
BaseHalf's own and one page of eleven rows:

- **What a user would set was fixed, or kept nowhere.** The magnet of the
  canvas, Snap to Cards, was on again after every start. The mouse wheel
  moved the canvas and could not zoom it. A note had four sizes and three
  fonts of its text, in Rich 16 px, in Preview 14 px, on its card 13 px in
  another font, in Source the code's, and none could be chosen. A note
  always opened in Rich. The record of the selection that agents read could
  be stopped only by removing the skill. The Agent Area was empty after
  every start.
- **The keys of the canvas were in no list.** Keyboard Shortcuts opened in
  the place of the canvas, and nothing in Settings led to it.
- **One page held what belongs to four parts of the product**, six sections
  of one to four rows.

## Terms

- **Settings**: BaseHalf's Settings, an overlay in the middle of the window.
- **Page**: General, Canvas, Notes, Agent Area, Providers, or About.
- **A setting of BaseHalf's own**: one whose name starts with `basehalf.`.
- **The advanced list**: the Settings editor of the base, which lists the
  shown and the advanced settings of the catalog
  ([the settings BaseHalf offers](settings-catalog.md)).

## The pages

Settings has a list of its pages at the left and shows the page chosen
beside it: **General**, **Canvas**, **Notes**, **Agent Area**,
**Providers**, and **About**. A page is a part of the product by the name
the product has for it. Under the list, at the bottom, are **Keyboard
Shortcuts…** and **Advanced Settings…**.

- Settings has no search and no choice of a scope: it holds the settings a
  user would look for, on the page of what they change.
- **Every setting of BaseHalf's own is on a page**, and the pages hold the
  shown settings of the catalog and no other
  ([the settings BaseHalf offers](settings-catalog.md)). BaseHalf has no
  setting of its own that only the advanced list holds.
- A page is drawn when it is first shown and stays while Settings is open:
  what was typed in it is there when the page is chosen again, but for a
  credential that was typed and not set, which is cleared when its page is
  left.
- Settings that was closed opens at General, unless the opening asks for a
  page. Settings that is open, or stands behind the advanced list, shows the
  page it has when it is asked for again without one.

## What earns a setting

A setting of BaseHalf's own is a choice that only the user can make (D143).
It has a row when all of these hold:

1. **People differ in it, and BaseHalf cannot tell which they are**: what
   they hold in the hand, how well they see, what they like to look at, what
   they let an agent read.
2. **It belongs to what BaseHalf is for**: the canvas, notes, agents. A
   choice that only matters after a rare accident is not a setting; BaseHalf
   handles the accident.
3. **Its effect is in view at once**, in the window as it stands.
4. **Its words need no knowledge of how BaseHalf is built.**

What fails the first is decided by BaseHalf and stays fixed. What BaseHalf
can do by itself is done without a setting. A control of the product that
stays set, as the magnet of the canvas, is a setting too, and the control
and its row are one value.

## The settings of each page

The shown settings of the catalog, each under a name of BaseHalf's own.
`update.mode` is on the About page. The last column names the
specification that owns what the setting does.

### General

| Section | Name | Setting | Control | The line under the name | Owned by |
| --- | --- | --- | --- | --- | --- |
| Window | Appearance | `workbench.colorTheme` | choice: Dark, Light | none | [light and dark](light-and-dark.md) |
| Window | Match the System | `window.autoDetectColorScheme` | switch | Dark or light, as the system is. | light and dark |
| Window | Zoom | `window.zoomLevel` | choice, by percentage | The canvas and the Agent Area's text keep their own size. | [each part zooms by itself](zoom.md) |
| Code | Font | `editor.fontFamily` | text | none | [code cards](code-cards.md) |
| Code | Font Size | `editor.fontSize` | number | In Source. A code card keeps its size. | code cards |
| Code | Wrap Long Lines | `editor.wordWrap` | choice: Off, On | In Source. | code cards |
| Files | Show the .bh Folder | `basehalf.files.showHiddenFolder` | switch | It holds the files of notes and the records of cards. | [workspace state](workspace-state-and-legacy-cleanup.md) |

### Canvas

One group, without a section's name.

| Name | Setting | Control | The line under the name | Owned by |
| --- | --- | --- | --- | --- |
| Zoom of a New Folder | `basehalf.canvas.defaultZoom` | choice, by percentage | The largest zoom at which a folder first shows all its cards. | [workspace state](workspace-state-and-legacy-cleanup.md) |
| Mouse Wheel | `basehalf.canvas.wheel` | choice: Moves the Canvas, Zooms | A pinch zooms either way, and a drag with the middle or the right button moves the canvas. | [canvas wheel gestures](canvas-wheel-gestures.md) |
| Snap to Cards | `basehalf.canvas.snap` | switch | A card that is moved or resized lines up with the cards near it. | [canvas selection and arrangement](canvas-selection-and-arrangement.md) |
| Background | `basehalf.canvas.background` | choice: Lines, Dots, Plain | none | [workbench appearance](workbench-appearance.md) |
| Play Videos Under the Pointer | `basehalf.canvas.playVideosOnHover` | switch | Without sound. | [generation cards](generation-cards.md) |

### Notes

One group, without a section's name.

| Name | Setting | Control | The line under the name | Owned by |
| --- | --- | --- | --- | --- |
| Font | `basehalf.notes.fontFamily` | choice: Default, Serif, Monospace | On the card and in Card Detail. | [note rendering](note-rendering.md) |
| Text Size | `basehalf.notes.fontSize` | number, 12 to 28 | In Card Detail. On the canvas, a card's text follows the zoom. | note rendering |
| Opens In | `basehalf.notes.openIn` | choice: Rich, Preview, Source | none | note rendering |
| Reading Aids | `basehalf.editor.readingMode` | switch | Keywords stand out, and a paragraph can be marked as read. | note rendering |

Appearance is the color theme: Dark and Light are BaseHalf's two, `Dark 2026` and `Light 2026`; another theme,
chosen from the gear's menu, is listed by its name. While Match the System is on, the base takes the system's
appearance and the theme chosen here waits.

The font is a list of fonts, as the code's: Default is no value, the font of
the window; Serif and Monospace are lists BaseHalf names; any other list,
written in a settings file, is listed as it is written.

### Agent Area

| Section | Name | Setting | Control | The line under the name | Owned by |
| --- | --- | --- | --- | --- | --- |
| Sessions | First Session | `basehalf.agent.defaultSession` | choice of the sessions | A new tab starts with it. | [Agent Area terminal](agent-area-terminal.md) |
| Sessions | Reopen Sessions | `basehalf.agent.restoreSessions` | switch | A folder opens with the tabs and panes it was closed with, each started anew. | Agent Area terminal |
| Terminal | Font | `terminal.integrated.fontFamily` | text, empty: Same as Code | none | Agent Area terminal |
| Terminal | Font Size | `terminal.integrated.fontSize` | number | none | Agent Area terminal |
| Agents | Offer the BaseHalf Skill | `basehalf.agents.offerSkill` | switch | The skill tells agents what is selected and how cards connect. | [agent skill](agent-skill.md) |
| Agents | Share the Selection | `basehalf.agents.shareSelection` | switch | Agents with the skill can read which cards and which text are selected. | agent skill |

## How a setting is changed

- **A setting is a block** of its name, a line about it, and its control,
  drawn as in [How Settings looks](#how-settings-looks). It has a line only
  where the name does not say what the setting changes or where, and never
  more than one line.
- **A control shows the value in effect** and changes it at once: a switch
  and a choice when they are used, a text and a number when the field is
  left or Enter is pressed. No button saves.
- **A change is written where the value in effect comes from**: to the
  settings file of the folder when the folder sets the setting, and to the
  user's otherwise, as the base writes a setting it is given no place for.
  So a control never shows one value and changes another. In the user's
  settings a value equal to the default is written as no value, and so is
  an emptied text: the file holds only what differs.
- **A value that is none of a choice's** is listed with the others: a zoom
  by its percentage, as the zoom of a window that was changed with the keys
  of the menu, and any other as it is written, as a way of wrapping that
  only the advanced list offers.
- **A number outside what the setting takes** becomes the nearest it takes.
  A number field left empty shows the value in effect again.
- **A value changed elsewhere**, in the advanced list, in a settings file,
  or by a key, shows in its row as it changes; in a field the user is typing
  in, when the field is left.
- **Each zoom is one setting.** The keys that zoom the window change
  `window.zoomLevel`, as the row Zoom does, and the keys that zoom in the
  Agent Area change its Font Size, as that row does ([each part zooms by
  itself](zoom.md)). BaseHalf's default for `window.zoomPerWindow` is off,
  so a zoom holds in every window and shows in Settings.

## How Settings looks

Settings is drawn as the Settings editor of the base is in VS Code 1.147,
measured side by side on 2026-11-22 (D152), and draws no boxes: no frame
around a section or a page, and no line between settings.

- **The list of pages** is a list of names, 22 px a line, 13 px: the page
  shown is in bold, and a name under the pointer has the background of a
  row under the pointer. Keyboard Shortcuts… and Advanced Settings… stand at
  its foot in the color of descriptions. A line of the border's color
  stands between the list and the page.
- **A page** starts with its name, 26 px at weight 600. A section of a page
  has its name at 22 px, at weight 600.
- **A setting** is a block, 12 px of room above, 18 px below, and 14 px at
  each side: its name, 13 px at weight 600 in `settings.headerForeground`;
  under it the line about it, 13 px, in the color of text at 0.9 opacity;
  and 9 px under that its control. A block under the pointer has
  `settings.rowHoverBackground`, with corners of 6 px; a block with the
  keyboard in a control of it has `settings.focusedRowBackground` and an
  outline of `settings.focusedRowBorder` while the keyboard shows its ring.
- **A setting that is on or off** is the base's check box: 18 px, corners of
  3 px, in `settings.checkboxBackground`, `settings.checkboxBorder`, and
  `settings.checkboxForeground`, with a check mark when it is on. The line
  about the setting stands beside it, 9 px to its right, and a press on the
  line changes it too. Before, a switch stood at the right of the row.
- **A choice** is a field 320 px wide and 26 px high, with corners of 4 px,
  in `settings.dropdownBackground`, `settings.dropdownBorder`, and
  `settings.dropdownForeground`; the system draws its list. **A number** is
  a field 200 px wide, **a text** 420 px wide, both 26 px high with corners
  of 4 px, in the colors of `settings.numberInput*` and
  `settings.textInput*`.
- **A changed setting**, one that the user's or the folder's settings file
  sets, has the base's mark at its left: a line 2 px wide in
  `settings.modifiedItemIndicator`, 5 px from the block's left edge, from
  15 px below its top to 18 px above its bottom.
- **The Providers page** keeps its two columns, the list of providers at the
  left and the provider chosen at the right, without a frame: a line of the
  border's color stands between them. The card types above the list, and the
  regions of a provider, are tabs as the base's User and Workspace are: 13 px
  at weight 600, corners of 4 px, the chosen one in
  `modernTab.activeBackground` and `modernTab.activeForeground`, another
  under the pointer in `modernTab.hoverBackground`. A provider of the list
  is its name and the line under it, the provider chosen in bold on the
  background of a row under the pointer.

## Opening Settings

**Settings** of the gear's menu and of the application menu, and its key,
open Settings: at General when it was closed.

These open Settings at a page: **Set Up** and **Providers…** of the panel of
a generation card and its model menu, **Set Up** of its voice menu, the
command **Providers** (also in the Preferences part of the application
menu), and the command **About BaseHalf**.

Providers opens at a card type and a provider when they are given
([providers](providers.md#credentials-regions-and-endpoints), D107):

- From a card, at the card's type and the card's provider: an audio card's
  Set Up opens Audio with its provider selected.
- With a provider alone, or with a type that does not list the provider, at
  the first type that lists it. With a type alone, at that type, where the
  provider shown stays when the type lists it, as when the type is chosen on
  the page. A type the page does not offer, or a provider the catalog does
  not have, is not given.
- With neither, as from the application menu: where the page is, when
  Settings shows it already, and otherwise at Image and its first provider.
- The provider selected is in view in its list.

For every opening:

- **The first frame shows the page.** Settings never shows another page
  before it, and the overlay never shows an empty body.
- **Settings that is already open** shows the page at once, in place of
  what it showed.
- The list shows the page as chosen.
- The keyboard is on the page: on its selected entry, such as the provider,
  or on the page itself.

## While Settings is open

- A click on a page's name shows the page. In the list, the arrow keys, Home,
  and End choose a page and keep the keyboard in the list; Enter moves it
  into the page.
- Escape closes Settings wherever in it the keyboard is. A field that takes
  Escape for itself, as the field of a credential being replaced, takes it
  first.
- A page is drawn again only when what it shows changed. After a change made
  on a page, the focus stays on the control it was on, or moves to the one
  that took its place, such as Replace after Set; it never falls out of the
  page.
- A focus ring shows only when the keyboard moved the focus, as on the
  canvas ([architecture invariants](../harness/architecture-invariants.md#product-shell));
  the page itself, which takes the focus for the keyboard to start from,
  shows none. A text field shows its focus by its border.
- Each page's elements have ids of their own.

## Keyboard Shortcuts

**Keyboard Shortcuts…** opens Keyboard Shortcuts of the base in the overlay,
in place of Settings, as Keyboard Shortcuts of the gear's menu does. It
lists the commands of BaseHalf, those of the canvas among them, each with
its key, and a key is changed there
([commands and menus](commands-and-menus.md)).

## The advanced list

- **Advanced Settings…** opens the Settings editor of the base in the
  overlay, in place of Settings. So does the command Advanced Settings, and
  every command of the base that asks for settings by a search, as
  Configure Terminal Settings. Settings of the gear's menu or its key shows
  BaseHalf's Settings again.
- It lists the shown and the advanced settings of the catalog, and no
  other. It has no entry for BaseHalf's pages.
- The welcome page's **Open BaseHalf Settings…** opens Settings.

## What Settings does not say

- No sentence tells how Settings works, what was just done, or what the
  mechanism behind a setting is. A state is one word where it matters.
- A button that has its words has no icon. A label is in the size and the
  color of the text around it, in the case it is written in.
- Nothing is saved with a message: the control shows the new value.

## Implementation boundaries

- `shell/common/basehalfSettings.ts`: the pages and `IBaseHalfSettingsService`,
  by which every feature opens Settings at a page.
- `shell/browser/basehalfSettingsEditor.ts`: Settings, an editor of the
  window that opens in its overlay; `basehalfSettingsEditorInput.ts`: what
  an opening asks for travels with it, so the first drawing holds the page.
- `shell/browser/basehalfShownSettings.ts`: the settings of each page, with
  their names, lines, and controls. `shell/browser/basehalfSettingsListPage.ts`:
  a page that lists settings, and the row of a setting, which About uses for
  `update.mode`.
- `shell/common/basehalfConfiguration.ts` registers every setting of
  BaseHalf's own, also one that a feature below the shell reads: the feature
  reads the value from the configuration, by its name.
- `ui/browser/basehalfSettingsPage.ts`: what a page is, so that a feature
  below the shell can be one: `generation/browser/basehalfVideoProvidersPage.ts`;
  and `shell/browser/basehalfAbout.ts`.
- `contrib/preferences/browser/preferences.contribution.ts`: the base's
  Settings command hands over to BaseHalf's Settings when it asks for no
  search and no setting, also when it comes from the application menu.
- What BaseHalf still has in the Settings editor of the base: the one group
  of its settings in `settingsLayout.ts`, the name Advanced Settings in
  `preferencesEditorInput.ts`, its own name among the terms of search
  results in `contrib/preferences/common/preferences.ts`, and the lines of
  the catalog ([the settings BaseHalf offers](settings-catalog.md)). The
  editor itself, its tree, and its options are the base's.

## Acceptance criteria

1. Settings of the gear's menu, Settings… clicked in the application menu,
   and the key open BaseHalf's Settings at General, in the overlay: the list
   holds General, Canvas, Notes, Agent Area, Providers, About, and under
   them Keyboard Shortcuts… and Advanced Settings…; each of the four pages
   of settings holds the rows of its table in its order, with these names
   and lines.
2. A switch, a choice, a text, and a number changed on General are in the
   user's settings file within a second, and what they change follows: the
   zoom of the window, the font size of Source. Set back to the default, the
   line is gone from the file. A setting that the folder's settings file
   sets is changed there, and its control shows the new value.
3. A number of 500 typed for Font Size becomes 100; an emptied number field
   shows the value in effect.
4. With `window.zoomLevel` at 0.5 in the settings file, Zoom lists 110% with
   its other choices and shows it chosen. After the key that zooms in, Zoom
   shows 120%.
5. Set Up of the panel of a generation card, the command Providers, and the
   command About BaseHalf open Settings at the page: sampled every frame in
   the real window from the click on, no frame shows Settings with another
   page chosen or without the page.
6. With Settings open at General, Providers of the application menu shows
   Providers in place of General. A name typed in the form of Add Provider
   is there when the page is chosen again; a key typed and not set is not.
7. In the list, Arrow Down from General shows Canvas and keeps the focus
   in the list; Enter puts it into the page; Escape closes Settings from the
   list and from a page.
8. Clicking a page, or a control on it, draws no focus ring; a control the
   keyboard reached has one.
9. Advanced Settings… shows the Settings editor of the base: its table of
   contents has no group BaseHalf with pages, and no setting of the catalog's
   locked, pending, or unlisted classes; Settings of the gear's menu then
   shows BaseHalf's Settings again.
10. Set Up and Providers… of an image, a video, and an audio card, and Set
    Up of the voice menu, open Providers at the card's type with the card's
    provider selected and in view in the list; the command Providers opens
    it at Image, or where it is when Settings shows it already (D107).
11. Every registered setting whose name starts with `basehalf.` has a row on
    a page, and a page has no row of a setting that is not shown in the
    catalog. A unit test fails otherwise.
12. Keyboard Shortcuts… shows Keyboard Shortcuts in the overlay; the canvas
    stays in view behind it, and Escape closes it.
13. No element of Settings, the Providers page among its pages, has a
    border but the fields, the check boxes, the buttons as the theme draws
    them, the line beside the list of pages, and the line between the
    Providers page's columns. The sizes,
    paddings, and colors of [How Settings looks](#how-settings-looks) are
    those read from the window, in the dark and the light theme, and a
    press on the line beside a check box changes its setting.

## Verification

- The real-window check of criteria 1 to 9 and 13, from a disposable
  workspace; for criterion 13 the computed styles of both products were read
  side by side, VS Code 1.147.0 on a profile of its own.
- Unit tests: the rows of the four pages and their settings are the shown
  settings of the catalog but `update.mode`, and every setting of
  BaseHalf's own is among them (`basehalfSettingsListPage.test.ts`);
  the opening at a type and a provider of the Providers page
  (`basehalfVideoProvidersPage.test.ts`); the type that each panel and the
  voice menu open at (`basehalfVideoNodePanel.test.ts`,
  `basehalfGenerationVoiceMenu.test.ts`).
- The smoke: Settings opens at General from its command, changes a setting
  there, opens at About and at Providers from their commands and from Set
  Up, and reaches the advanced list (`areas/workbench/settings.mts`,
  `areas/video/generationCards.mts`, `areas/video/audioCards.mts`). The
  smoke opens Settings in the overlay, as a user does; the base keeps its
  own Settings editor out of the overlay while its smoke driver runs, so
  the smoke sees the advanced list in the editor area.
