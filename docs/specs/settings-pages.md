# BaseHalf's pages in Settings

Status: Active (2026-10-21)
Decisions: [D49](../decisions.md#d49--the-state-of-an-update-is-a-page-in-settings-not-a-card-new-2026-10-12)
put the About page in Settings, and
[D59](../decisions.md#d59--video-providers-are-built-in-integrations-with-each-models-exact-settings-users-bring-their-own-keys-new-2026-10-19)
the Video Providers page.
Related: [video providers](video-providers.md#credentials-regions-and-endpoints)
(what the Video Providers page holds), [app update](app-update.md#where-an-update-shows)
(what the About page holds), [Video node](video-node.md#the-panel) (Set Up and
Video Providers… of the panel)

This specification owns the BaseHalf group of the Settings table of contents,
the pages BaseHalf draws there, how Settings opens at a page, and what
Settings does while a page is shown. What each page holds is owned by the
specification linked above.

## Problem

Measured in the real window on 2026-10-21:

- **Set Up flashed another page.** Settings opened on Commonly Used and
  switched to Video Providers 20 to 35 ms later, two to four frames, every
  time. The command first opened Settings and asked for the page only once
  Settings had drawn its first page.
- **A page opened over a search kept the search.** With a search typed in
  Settings, Video Providers from the menu bar showed the page under the
  search text, with no entry of the table of contents selected.
- **Settings opened again on an empty page.** With Settings in the editor
  area, closing it on Video Providers and opening it again showed Video
  Providers selected in the table of contents and, beside it, only the
  headings "BaseHalf" and "Video Providers".
- **The pages were empty headings in the settings list.** BaseHalf › Agent
  Area listed Default Session and then the headings "Video Providers" and
  "About" with nothing under them; so did the whole list after a search was
  cleared.
- **The skill switch was in no area.** Agent Area matched
  `basehalf.agent.*`, and the setting that turns off the offer of BaseHalf's
  skill is `basehalf.agents.offerSkill`: only a search found it. The area
  Connections matched no setting since the last one was removed, and was
  never drawn.
- **The welcome page's Open BaseHalf Settings… found nothing.** It searches
  for the tag `basehalf`, and no setting had it.
- **Enter did not reach a page.** Enter on the entry of a page moved the
  focus to the hidden settings list, so it stayed in the table of contents.
- **Two settings took values that changed nothing, without a word.** An
  attachments folder such as `../images` or `/Users/me/pics` was replaced by
  `attachments`, and a default zoom above 1 was used as 1, while Settings
  showed both as accepted and described the zoom as the initial one.

## Terms

- **Settings**: the Settings editor of the base. It opens as an overlay in
  the middle of the window, unless `workbench.editor.useModal` is `off`; then
  it opens in the editor area, where it keeps its place between openings.
- **Page**: a part of Settings that BaseHalf draws in place of a list of
  settings: **Video Providers** and **About**.
- **Table of contents**: the list of groups at the left of Settings.

## The BaseHalf group

The table of contents has a group **BaseHalf**. It lists BaseHalf's settings
by area, each area that has settings, and then the pages Video Providers and
About:

| Entry | Holds |
| --- | --- |
| Editor | `basehalf.editor.*` |
| Canvas | `basehalf.canvas.*` |
| Agent Area | `basehalf.agent.*` and `basehalf.agents.*` |
| Video Providers | the page ([video providers](video-providers.md#credentials-regions-and-endpoints)) |
| About | the page ([app update](app-update.md#where-an-update-shows)) |

- Every BaseHalf setting is in exactly one area, and every area holds a
  setting.
- A value that a BaseHalf setting cannot take is refused in Settings, with
  the reason, instead of being replaced by its default without a word: the
  attachments folder (`basehalf.editor.attachmentsDirectory`) is a folder
  inside the note's folder, by the same rule the rich editor uses, and the
  default zoom (`basehalf.canvas.defaultZoom`) goes up to 1, the largest zoom
  at which the canvas fits a folder
  ([workspace state](workspace-state-and-legacy-cleanup.md#canvas-viewport-state)).
- Every BaseHalf setting has the tag `basehalf`. The welcome page's **Open
  BaseHalf Settings…** searches Settings for it and lists them all.
- Search results name the group as **BaseHalf**, such as "BaseHalf ›
  Editor".
- A page has no settings and shows no count. It is no heading in the
  settings list, and no search lists it.
- The entry of a page shows the page in place of the settings list. As for
  every entry, a click or the arrow keys there keep the focus in the table
  of contents; Enter, or Tab, moves it into the page.

## Opening Settings at a page

These open Settings at a page: **Set Up** and **Video Providers…** of the
Video panel and its model menu, the command **Video Providers** (also in the
Preferences part of the application menu), and the command **About
BaseHalf**. Video Providers opens at a provider when one is given.

- **The first frame shows the page.** Settings never shows another page or a
  list of settings before it, and the overlay never shows an empty body.
- **Settings that is already open** shows the page at once, in place of what
  it showed.
- **A search is left.** The search box is empty when the page shows.
- The table of contents shows the page's entry selected and the BaseHalf
  group expanded.
- The keyboard focus is on the page: on its selected entry, such as the
  provider, or on the page itself; an opening that keeps the focus where it
  is leaves it there.

## While a page is shown

- Choosing another entry of the table of contents, or typing in the search
  box, leaves the page.
- Switching between User and Workspace does not change a page. The page
  stays, with what was typed in it and the focus.
- Settings that opens again where it kept its place shows the entry chosen
  last, a page too, unless it opens with a search, such as the welcome
  page's Open BaseHalf Settings…: the search is shown. The focus stays where
  the opening put it, such as the search box. The overlay starts anew each
  time, on Commonly Used.
- A page is drawn again only when what it shows changed. After a change made
  on the page, the focus stays on the control it was on, or moves to the one
  that took its place, such as Replace after Set; it never falls out of the
  page, where Escape would no longer close Settings.
- A focus ring shows only when the keyboard moved the focus, as on the
  canvas ([architecture invariants](../harness/architecture-invariants.md#product-shell));
  the page itself, which takes the focus for the keyboard to start from,
  shows none. A text field shows its focus by its border.
- Each page's elements have ids of their own: Settings can show a page in
  two editor groups at once.

## Implementation boundaries

- `contrib/preferences/browser/settingsCustomSections.ts`: the registry of
  pages, from the id of a page's entry to the page.
- `ISettingsEditorOptions.customSection` in
  `services/preferences/common/preferences.ts`: opening Settings at a page,
  with what the page should show (for Video Providers, a provider). The
  option travels with the opening, as the base's own `query` does, so the
  first drawing of Settings already holds the page.
- `contrib/preferences/browser/settingsEditor2.ts`: shows a page in place of
  the settings list, at the opening, on the choice of its entry, and when
  Settings opens again on it. BaseHalf's lines there are marked
  `BaseHalf:`.
- The pages: `video/browser/basehalfVideoProvidersPage.ts` and
  `shell/browser/basehalfAbout.ts`.

## Acceptance criteria

1. Set Up of the Video panel, the command Video Providers, and the command
   About BaseHalf open Settings at the page, in the overlay and in the
   editor area: sampled every frame in the real window from the click on, no
   frame shows Settings with another entry selected, with the settings
   list, or without the page.
2. With a search typed in Settings, Video Providers from the application
   menu shows the page with an empty search box and the page's entry
   selected.
3. With Settings in the editor area, closing it on a page and opening it
   again shows that page.
4. Switching User and Workspace while a page is shown keeps the page, the
   text typed in it, and the focus.
5. BaseHalf › Agent Area lists Default Session and the switch for the offer
   of the skill, and no area or the whole list shows a page as a heading.
6. The welcome page's Open BaseHalf Settings… lists every BaseHalf setting.
7. Enter on the entry of a page puts the focus on the page.
8. Clicking a page, or a control on it, draws no focus ring; choosing a
   region with the arrow keys keeps the focus on the region, with a ring,
   and Escape then closes Settings; after Set, the focus is on Replace.

## Verification

- The real-window check of criteria 1 to 7, in both forms of Settings, from
  a disposable workspace.
- Unit tests: every BaseHalf setting is in exactly one area and has the tag
  that the welcome page searches for
  (`shell/test/browser/basehalfSettingsLayout.test.ts`); a page is an entry
  of the table of contents and no heading of the settings list
  (`settingsCustomSections.test.ts`).
- The smoke: Settings opens at Video Providers from its command and from Set
  Up (`areas/workbench/settings.mts`, `areas/video/videoNode.mts`). The smoke
  runs Settings in the editor area.
