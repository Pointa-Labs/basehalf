# Layout controls

Status: Active (2026-10-13, revised 2026-10-24, 2026-11-21, and 2026-11-26)
Decision: [D56](../decisions.md), [D72](../decisions.md), [D96](../decisions.md) (Edit and Done of media),
[D150](../decisions.md) (the names of the controls, and the panel's command),
[D155](../decisions.md) (the right group: More and the control of the Agent Area)
Related: [workbench appearance](workbench-appearance.md) (the cards that the
controls show and hide), [architecture invariants](../harness/architecture-invariants.md)
(product shell), roadmap tracks 1, 2, and 9

## Problem

A layout control is a button that shows and hides a part of the window: the
sidebar, the Agent Area, or the panel. The control of the sidebar was in two
places, and both were wrong.

- **In Card Detail.** The header of an open card had a button that hid the
  sidebar and showed it again. The sidebar belongs to the window, not to the
  card. The button was there only while a card was open, among the controls
  that act on the card: its views and Close.
- **At the right end of the title bar.** VS Code puts all layout controls
  there, in one group. The control of the sidebar was the first of the
  group, at the far end of the window from the sidebar it moves.

The right group also held two controls for one part. BaseHalf has no panel
under the canvas: the terminal is in the Agent Area
([D21](../decisions.md#d21--right-side-is-agent-area-not-terminal-panel-new-2026-06-30)),
and the panel's command opens and closes the Agent Area. Its button, next
to the Agent Area's own, did what that one does, and its icon never showed
the Agent Area open. The View menu's Appearance submenu had the same pair:
Panel and Secondary Side Bar.

After that the right group still held four buttons, read in the window on
2026-11-26: the control of the Agent Area, Accounts, the gear, and three
dots at the edge. Three of them opened a menu about the application. The
Accounts menu held one entry while nobody was signed in. The three dots were
the tool bar's own overflow, and their menu held one entry, Customize
Layout. The control of the Agent Area was the first of the four, the
farthest from the part it shows.

## Goals

- A layout control is in one place, and the place does not depend on what is
  open.
- One part has one control in the title bar and one entry in the View menu.
- A control is on the side of the window where its part is.
- On macOS the control of the left side follows the window buttons, where
  macOS applications have it.
- The right end of the title bar holds two buttons: one menu for what is
  about the application, and the control of the Agent Area at the edge of
  the window.

## Scope

In scope:

- where the title bar shows the controls of the sidebar and of the Agent
  Area;
- which buttons the right group holds, and their order;
- that neither the title bar nor the View menu shows a control of the panel;
- what the header of Card Detail holds.

Not in scope, and unchanged:

- The commands themselves, their icons, and keyboard shortcuts. They are
  VS Code's: `workbench.action.toggleSidebarVisibility` (Cmd+B) and
  `workbench.action.toggleAuxiliaryBar` (Option+Cmd+B). Their names are
  BaseHalf's, Toggle Sidebar and Toggle Agent Area, wherever a user reads
  them ([the commands and menus BaseHalf has](commands-and-menus.md#the-words-of-the-shell),
  D150).
- What the More menu holds
  ([the commands and menus BaseHalf has](commands-and-menus.md#the-menus)).
- The rest of the View menu, the command palette, and Customize Layout,
  which also hold the commands
  ([the commands and menus BaseHalf has](commands-and-menus.md)).
- Auxiliary windows. They show no layout controls, as before.

## Terms

- **Left end of the title bar**: the region before the breadcrumb. On macOS
  it starts with the window buttons (close, minimize, zoom), which macOS
  draws.
- **Right group**: the toolbar at the right end of the title bar.
- **More**: the button of the right group that is drawn as three dots and
  opens the More menu.
- **Left side part**: the part at the left edge of the window. It is the
  sidebar, and the **right side part** is the Agent Area, in every window:
  BaseHalf keeps `workbench.sideBar.location` at `left`
  ([the settings BaseHalf offers](settings-catalog.md), D137). The base
  registers the controls by side, for both values of the setting, and
  BaseHalf leaves that registration as it is.

## Requirements

### Title bar

1. The control of the left side part is at the left end of the title bar.
   The control of the right side part is in the right group. Each is in the
   title bar once.
2. On macOS the control of the left side part is the first thing after the
   window buttons. At zoom level 0 on macOS 26 its left edge is 80 px from
   the left edge of the window, 9 px after the last window button, which is
   the distance between two window buttons. It is on the line of the window
   buttons: its icon begins and ends at the height where they begin and end.
   The rest of the title bar is 1.5 px lower, as in VS Code.
3. In full screen there are no window buttons. The control is 8 px from the
   left edge of the window, on the line of the rest of the title bar.
4. In a locale where macOS draws the window buttons on the right, and on
   Windows and Linux, the control is at the left end of the title bar, after
   the application icon and the menu where these exist.
5. The space around the window buttons still moves the window when it is
   dragged. Only the control itself takes a click.
6. The control stays where it is when its part is hidden. Its icon shows
   whether the part is open, as in the right group.
7. The control follows the setting of the other layout control. It is not
   shown when `workbench.layoutControl.enabled` is `false`. "Layout
   Controls" in the title bar's context menu switches both.
8. The title bar gives the control room before the breadcrumb. In a window
   too narrow for both, the breadcrumb is shortened, not the control.

### Card Detail

9. The header of Card Detail holds no layout control. Its right group is
   the sign that saving failed (only when it did), the views of the card,
   **Edit** or **Done** of a video, an image, or a sound that BaseHalf can
   edit, and Close. Edit shows the editor of the file in place and becomes
   Done, which goes back to viewing it (D96,
   [editing media](media-editing.md#editing-in-card-detail)). While an edited
   file is edited, **Revert to Original** stands after the name, at the left
   of the header ([editing media](media-editing.md#revert-to-original), D120).
   For a PDF or a book the header is the reader's only bar: **Sidebar**, which
   opens and closes the reader's own panel, stands at its left end before the
   name, and **Find** and **Comments** stand before Close
   ([PDFs and books](documents-and-books.md#the-reader), D135). Sidebar is no
   layout control: the panel is the reader's, and the window's sidebar keeps
   its control in the title bar.

### Implementation boundary

10. The left end of the title bar draws the entries of one menu,
    `MenuId.TitleBarLeft`. The entry of the left side part is registered
    there and not in the menu of the right group, with the same command,
    icons, and conditions as before. BaseHalf adds no command and no state.

### The panel

11. The title bar holds no control of the panel, whatever the settings of
    the layout controls. In the right group the control of the Agent Area
    is the only layout control.
12. The View menu's Appearance submenu holds no entry for the panel. Agent
    Area is the entry of the Agent Area.
13. The panel's command is hidden, as every command of the panel is (D150):
    it is in no list and does not run. Cmd+J, the key it had, is a key of
    Toggle Agent Area Terminal, which does what the key did: it shows the
    Agent Area with a session, and hides it
    ([the commands and menus BaseHalf has](commands-and-menus.md#one-command-for-one-thing)).

### The right group

14. In a main window the right group holds two buttons, from left to
    right: More, and the control of the right side part. It holds no
    Accounts button, no gear, and no second button of three dots.
15. More is drawn as three dots, and its name is "More" in every window,
    also in one opened with a profile, where the base named its button
    after the profile. A click on it, or
    Enter or Space while it has the keyboard, opens the More menu under it
    ([the commands and menus BaseHalf has](commands-and-menus.md#the-menus)).
    The menu holds what the gear's menu and the Accounts menu held, and
    Customize Layout.
16. The control of the right side part is the last button of the group, at
    the edge of the window where its part is, as the control of the left
    side part is the first at the left end. Where the window buttons are on
    the right, they follow it.
17. More shows a badge while something in its menu waits for the user: an
    update that is ready, and a request of an extension to sign in or to
    use an account. The badge is the one the gear and the Accounts button
    had.
18. The layout controls are buttons. BaseHalf keeps
    `workbench.layoutControl.type` at `toggles`
    ([the settings BaseHalf offers](settings-catalog.md), D137): the title
    bar draws no menu of layout controls in their place and no button for
    Customize Layout.
19. More is no layout control. It stays when
    `workbench.layoutControl.enabled` is `false`, and it is the same button
    whatever part is shown.
20. A secondary click on More shows the context menu of the title bar, as a
    secondary click anywhere else on the title bar does.
21. An auxiliary window has no More, as it has no layout controls.
22. More is the base's button of the gear under BaseHalf's name and icon.
    BaseHalf gives the title bar its own item for the button through the
    base's registry of title bar items, and adds Customize Layout, Accounts,
    and Manage Accounts to the base's menus through the menu registry
    (`shell/browser/basehalfMoreButton.contribution.ts`); the order of the
    menu's groups is `shell/common/basehalfMoreMenu.ts`. One marked change
    in the base's title bar puts the button before the layout controls and
    leaves out the Accounts button, and one keeps the buttons of the right
    group from being hidden.
23. No button of the title bar is hidden by itself. The context menu of a
    button of the right group holds no entry that hides the button, as that
    of the button at the left end holds none: a hidden button would go into
    an overflow of three dots beside More. Layout Controls of the title
    bar's context menu shows and hides the layout controls.

## States and failure

- **The part is hidden.** The control shows the icon of the closed state at
  the same place. A click opens the part.
- **Full screen.** Requirement 3.
- **Zoom.** The title bar grows with the zoom level and the window buttons
  do not, so the distance of requirement 2 grows with the zoom level, and
  the control can be up to half a pixel off the line of the window buttons.
  Below zoom level 0 the title bar keeps its size and both are as at zoom
  level 0.
- **macOS before 26.** The window buttons are smaller and end 9 px earlier.
  The control is at the same place, so the distance is 18 px.
- **Layout controls are switched off.** No control is shown at either end,
  and More is the only button of the right group. Cmd+B, the View menu, and
  the command palette still work.
- **An update is ready, or an extension asks to sign in.** More shows a
  badge with the number of things that wait, until the update is installed
  or the request is answered.
- **A settings file names another `workbench.layoutControl.type`.** The
  value has no effect, as for every locked setting, and the editor of the
  file says so.
- **A session rang its bell while the Agent Area is hidden.** The control of
  the Agent Area shows a dot at its upper right, at either end of the title
  bar, until the Agent Area is shown
  ([Agent Area terminal](agent-area-terminal.md#the-bell), rule 7). The
  control keeps its place, its size, and its command.

## Acceptance criteria

1. In a new window the left end of the title bar holds exactly one button,
   "Toggle Sidebar". On macOS, not in full screen, its left edge is
   80 px from the left edge of the window. At the middle of the button, the
   button is the topmost element.
2. The right group holds no button for the sidebar.
3. A click on the button hides the sidebar, a second click shows it, and
   the button's rectangle is the same in both states.
4. With a card open in Card Detail, the header holds no button that shows or
   hides the sidebar, and the button of criterion 1 is where it was.
5. The menu of the left end holds the control of the sidebar and the menu
   of the right group the control of the Agent Area while
   `workbench.sideBar.location` is `left`, the value BaseHalf keeps. The
   base's registration for `right` is read by a unit test only.
6. With `workbench.layoutControl.enabled` set to `false`, the left end holds
   no button, and the right group holds More alone.
7. In a new window the right group holds no "Toggle Panel" button, and
   "Toggle Agent Area" is its only layout control.
8. The View menu's Appearance submenu and the layout control menu hold no
   entry for the panel. Cmd+J hides the Agent Area, and a second Cmd+J
   shows it. The Command Palette lists no command of the panel.

9. In a new window the right group holds exactly two buttons, "More" and
   then "Toggle Agent Area". No button of the title bar is named Accounts,
   Manage, or More Actions. At the middle of each button, the button is the
   topmost element.
10. A click on More opens a menu whose first entry is Settings and that
    holds Customize Layout… and Accounts. Escape closes it.
11. `workbench.layoutControl.type` is a locked setting with the value
    `toggles`.
12. While an activity of the application and one of accounts are shown,
    More holds both, and it holds the one that is left when the other ends.
13. A secondary click on Toggle Agent Area in the right group shows no
    entry that starts with "Hide".

## Verification

- `basehalfLayoutControls.test.ts`: the menu that holds each control for
  both values of `workbench.sideBar.location`, and the settings that hide
  the control (requirements 1, 7, 10, and 11; criteria 5 and 6). The
  menus that hold the panel's command (requirement 12), and the keys of
  Toggle Agent Area Terminal (requirement 13; criterion 8 without the
  window).
- `basehalfMoreButton.test.ts`: the order of the More menu's groups, the
  entries BaseHalf adds to the More menu and to Accounts, the activities
  More shows, and its name in a window of a profile (requirements 15 and
  17; criterion 12).
  `basehalfSettingsCatalog.test.ts`: criterion 11.
- `npm run basehalf:smoke`, step `layout-control-at-the-left-end`: criteria
  1 to 3 and 7 in the running window. Step
  `card-detail-holds-no-layout-control`: criterion 4. Step
  `title-bar-right-group-is-more-and-agent-area`: criteria 9 and 13. Step
  `title-bar-menus-hold-what-basehalf-has`: criterion 10, with the order of
  the menu and what Accounts holds.
- Run in an isolated development window on 2026-11-26, 1440 px
  wide, by a script that reads the buttons and every row
  (`.build/rw-more/`, tool state of the checkout). Before: the
  right group held Toggle Agent Area at 1328 px, Accounts, Manage, and More
  Actions at 1406 px; Manage held 6 entries, Accounts 1, More Actions 1.
  After: More at 1380 px and Toggle Agent Area at 1406 to 1428 px, each
  topmost at its middle; the More menu held Settings, Keyboard Shortcuts,
  Themes, Layout Density, a line, Command Palette…, Customize Layout…, a
  line, and Accounts with Manage Accounts… and Manage Extension Account
  Preferences…; the window ran without updates, so no entry of an update
  was there to read. Also seen there:
  - Settings, Customize Layout…, and Manage Accounts… each opened what they
    name; the tooltip of the button read "More"; Enter and Space on it
    opened the menu (requirement 15).
  - A secondary click on More showed Navigation Controls and Layout
    Controls (requirement 20), and one on Toggle Agent Area Configure
    Keybinding and the same two, where it had also offered to hide the
    button (requirement 23). With Layout Controls switched off there, the
    left end held no button and the right group More alone, at 1406 px
    (requirement 19; criterion 6).
  - Showing the Agent Area left both buttons where they were.
  - In a window 620 px wide both buttons kept their size, and the More menu
    opened inside the window.
  - A user's settings file with `workbench.layoutControl.type` as `both`
    changed nothing (requirement 18).
- Not run in a window: the badge of requirement 17 with a real update or a
  real request to sign in; the unit test shows it with activities of both
  kinds. Requirement 16 where the window buttons are on the right, and
  requirement 21: no such system and no auxiliary window was at hand.
- Measured once, on 2026-10-13, in a development window on macOS 26, and not
  automated:
  - Requirement 2: in a capture of the window the icon and the window
    buttons cover the same rows, and the last window button ends at 71 px.
  - Requirement 8: in a window 620 px wide the control keeps its place and
    size and the breadcrumb is shortened.
  - Criterion 6 in the running window, by changing the setting. Criterion 5
    was measured then with the sidebar at the right, which the catalog has
    locked since (D137).
- Not measured in a real window:
  - Requirement 3. The window was not put into full screen. With the class
    that the layout sets on a full-screen window, the control is at 8 px.
  - Requirement 5. No window was dragged. The room of the window buttons
    carries no `app-region` of its own, so the drag region of the title bar
    covers it, and the control carries `no-drag`.
  - Requirement 4 and macOS before 26. No such system was at hand.
