# Layout controls

Status: Active (2026-10-13, revised 2026-10-24 and 2026-11-21)
Decision: [D56](../decisions.md), [D72](../decisions.md), [D96](../decisions.md) (Edit and Done of media),
[D150](../decisions.md) (the names of the controls, and the panel's command)
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

## Goals

- A layout control is in one place, and the place does not depend on what is
  open.
- One part has one control in the title bar and one entry in the View menu.
- A control is on the side of the window where its part is.
- On macOS the control of the left side follows the window buttons, where
  macOS applications have it.

## Scope

In scope:

- where the title bar shows the controls of the sidebar and of the Agent
  Area;
- that neither the title bar nor the View menu shows a control of the panel;
- what the header of Card Detail holds.

Not in scope, and unchanged:

- The commands themselves, their icons, and keyboard shortcuts. They are
  VS Code's: `workbench.action.toggleSidebarVisibility` (Cmd+B) and
  `workbench.action.toggleAuxiliaryBar` (Option+Cmd+B). Their names are
  BaseHalf's, Toggle Sidebar and Toggle Agent Area, wherever a user reads
  them ([the commands and menus BaseHalf has](commands-and-menus.md#the-words-of-the-shell),
  D150).
- The other entries of the title bar's right group.
- The rest of the View menu, the command palette, and Customize Layout,
  which also hold the commands
  ([the commands and menus BaseHalf has](commands-and-menus.md)).
- Auxiliary windows. They show no layout controls, as before.

## Terms

- **Left end of the title bar**: the region before the breadcrumb. On macOS
  it starts with the window buttons (close, minimize, zoom), which macOS
  draws.
- **Right group**: the toolbar at the right end of the title bar.
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
7. The control follows the settings of the other layout controls. It is not
   shown when `workbench.layoutControl.enabled` is `false` or when
   `workbench.layoutControl.type` is `menu`. "Layout Controls" in the title
   bar's context menu switches all of them.
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

### Implementation boundary

10. The left end of the title bar draws the entries of one menu,
    `MenuId.TitleBarLeft`. The entry of the left side part is registered
    there and not in the menu of the right group, with the same command,
    icons, and conditions as before. BaseHalf adds no command and no state.

### The panel

11. The title bar holds no control of the panel, whatever the settings of
    the layout controls. In the right group the control of the Agent Area
    is the first layout control.
12. The View menu's Appearance submenu holds no entry for the panel, and
    neither does the menu that the title bar shows when
    `workbench.layoutControl.type` is `menu`. Agent Area is the entry of
    the Agent Area.
13. The panel's command is hidden, as every command of the panel is (D150):
    it is in no list and does not run. Cmd+J, the key it had, is a key of
    Toggle Agent Area Terminal, which does what the key did: it shows the
    Agent Area with a session, and hides it
    ([the commands and menus BaseHalf has](commands-and-menus.md#one-command-for-one-thing)).

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
- **Layout controls are switched off.** No control is shown at either end.
  Cmd+B, the View menu, and the command palette still work.
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
   no button.
7. In a new window the right group holds no "Toggle Panel" button, and
   "Toggle Agent Area" is its first layout control.
8. The View menu's Appearance submenu and the layout control menu hold no
   entry for the panel. Cmd+J hides the Agent Area, and a second Cmd+J
   shows it. The Command Palette lists no command of the panel.

## Verification

- `basehalfLayoutControls.test.ts`: the menu that holds each control for
  both values of `workbench.sideBar.location`, and the settings that hide
  the control (requirements 1, 7, 10, and 11; criteria 5 and 6). The
  menus that hold the panel's command (requirement 12), and the keys of
  Toggle Agent Area Terminal (requirement 13; criterion 8 without the
  window).
- `npm run basehalf:smoke`, step `layout-control-at-the-left-end`: criteria
  1 to 3 and 7 in the running window. Step
  `card-detail-holds-no-layout-control`: criterion 4.
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
