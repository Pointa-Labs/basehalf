# BaseHalf's Settings

Status: Active (2026-11-21; replaces the pages BaseHalf drew inside the
Settings editor of the base, 2026-10-21)
Decisions: [D137](../decisions.md#d137--every-setting-has-one-of-five-classes-and-a-setting-nothing-follows-is-work-not-waste-new-2026-11-21)
made Settings BaseHalf's own;
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

This specification owns BaseHalf's Settings: its pages, what the General page
lists and how a setting is changed there, how Settings opens, also at a page,
and how the Settings editor of the base is reached. What the Providers and
the About page hold is owned by the specifications linked above.

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

## Terms

- **Settings**: BaseHalf's Settings, an overlay in the middle of the window.
- **Page**: General, Providers, or About.
- **The advanced list**: the Settings editor of the base, which lists the
  shown and the advanced settings of the catalog
  ([the settings BaseHalf offers](settings-catalog.md)).

## The pages

Settings has a list of its pages at the left, **General**, **Providers**,
and **About**, and shows the page chosen beside it. Under the list, at the
bottom, is **Advanced Settings…**.

- Settings has no search and no choice of a scope: it holds twelve settings
  and two pages, and writes the user's settings.
- A page is drawn when it is first shown and stays while Settings is open:
  what was typed in it is there when the page is chosen again.
- Settings starts anew each time it opens: at General, unless the opening
  asks for a page.

## The General page

The shown settings of the catalog, by what they belong to, each under a name
of BaseHalf's own. `update.mode` is on the About page.

| Section | Name | Setting | Control | The line under the name |
| --- | --- | --- | --- | --- |
| Window | Zoom | `window.zoomLevel` | choice, by percentage | none |
| Canvas | Zoom of a New Folder | `basehalf.canvas.defaultZoom` | choice, by percentage | The largest zoom at which a folder first shows all its cards. |
| Notes | Reading Aids | `basehalf.editor.readingMode` | switch | Keywords stand out, and a paragraph can be marked as read. |
| Code | Font | `editor.fontFamily` | text | none |
| Code | Font Size | `editor.fontSize` | number | In Source. A code card keeps its size. |
| Code | Wrap Long Lines | `editor.wordWrap` | choice: Off, On | In Source. |
| Files | Show the .bh Folder | `basehalf.files.showHiddenFolder` | switch | It holds the files of notes and the records of cards. |
| Agent Area | First Session | `basehalf.agent.defaultSession` | choice of the sessions | Started when the Agent Area opens with no session. |
| Agent Area | Terminal Font | `terminal.integrated.fontFamily` | text, empty: Same as Code | none |
| Agent Area | Terminal Font Size | `terminal.integrated.fontSize` | number | none |
| Agent Area | Offer the BaseHalf Skill | `basehalf.agents.offerSkill` | switch | The skill tells agents what is selected and how cards connect. |

- **A setting is a row**: its name at the left, its control at the right.
  A row has a line under its name only where the name does not say what the
  setting changes or where, and never more than one line. The settings of a
  section stand in one box under the section's name.
- **A control shows the value in effect** and changes it at once: a switch
  and a choice when they are used, a text and a number when the field is
  left or Enter is pressed. No button saves.
- **A change is written to the user's settings.** A value equal to the
  default is written as no value, so the settings file holds only what
  differs.
- **A value that is none of a choice's** is listed with the others, named
  as it is written: the zoom of a window that was changed with the keys of
  the menu, or a way of wrapping that only the advanced list offers.
- **A number outside what the setting takes** becomes the nearest it takes.
  A number field left empty shows the value in effect again.
- **A value changed elsewhere**, in the advanced list, in a settings file,
  or by a key, shows in its row as it changes, unless the user is typing in
  that field.

## Opening Settings

**Settings** of the gear's menu and of the application menu, and its key,
open Settings at General.

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
- `shell/browser/basehalfGeneralSettingsPage.ts`: the General page and the
  row of a setting, which About uses for `update.mode`.
- `ui/browser/basehalfSettingsPage.ts`: what a page is, so that a feature
  below the shell can be one: `generation/browser/basehalfVideoProvidersPage.ts`;
  and `shell/browser/basehalfAbout.ts`.
- `contrib/preferences/browser/preferences.contribution.ts`: the base's
  Settings command hands over to BaseHalf's Settings when it is run without
  a search. BaseHalf has no other line in the Settings editor of the base
  but the catalog's ([the settings BaseHalf offers](settings-catalog.md)).

## Acceptance criteria

1. Settings of the gear's menu, Settings… of the application menu, and the
   key open BaseHalf's Settings at General, in the overlay: the list holds
   General, Providers, About, and Advanced Settings…, and the page holds the
   eleven rows of the table in its order, with these names and lines.
2. A switch, a choice, a text, and a number changed on General are in the
   user's settings file within a second, and what they change follows: the
   zoom of the window, the font size of Source. Set back to the default, the
   line is gone from the file.
3. A number of 500 typed for Font Size becomes 100; an emptied number field
   shows the value in effect.
4. With `window.zoomLevel` at 0.5 in the settings file, Zoom lists 110% with
   its other choices and shows it chosen.
5. Set Up of the panel of a generation card, the command Providers, and the
   command About BaseHalf open Settings at the page: sampled every frame in
   the real window from the click on, no frame shows Settings with another
   page chosen or without the page.
6. With Settings open at General, the command Providers shows Providers in
   place of General, and what was typed in a field of Providers before is
   there when the page is chosen again.
7. In the list, Arrow Down from General shows Providers and keeps the focus
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

## Verification

- The real-window check of criteria 1 to 9, from a disposable workspace.
- Unit tests: the rows of General and their settings are the shown settings
  of the catalog but `update.mode` (`basehalfGeneralSettingsPage.test.ts`);
  the opening at a type and a provider of the Providers page
  (`basehalfVideoProvidersPage.test.ts`); the type that each panel and the
  voice menu open at (`basehalfVideoNodePanel.test.ts`,
  `basehalfGenerationVoiceMenu.test.ts`).
- The smoke: Settings opens at General from its command, changes a setting
  there, opens at About and at Providers from their commands and from Set
  Up, and reaches the advanced list (`areas/workbench/settings.mts`,
  `areas/video/generationCards.mts`, `areas/video/audioCards.mts`). The
  smoke opens Settings in the overlay, as a user does.
