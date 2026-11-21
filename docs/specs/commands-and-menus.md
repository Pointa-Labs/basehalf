# The commands and menus BaseHalf has

Status: Active (2026-11-21)
Decision: [D141](../decisions.md#d141--a-command-of-what-basehalf-does-not-have-is-in-no-list-and-does-not-run-new-2026-11-21),
[D146](../decisions.md#d146--the-keys-of-the-canvas-are-commands-and-keyboard-shortcuts-opens-over-the-canvas-new-2026-11-21)
for Keyboard Shortcuts
Related: [the settings BaseHalf offers](settings-catalog.md),
[the keys of the canvas](canvas-keys.md),
[architecture invariants](../harness/architecture-invariants.md#product-shell),
[built-in AI Video and no plugins](built-in-ai-video-and-no-plugins.md),
[Git/SCM/GitHub/GitGraph](../git-scm-github-gitgraph.md),
[Agent Area terminal](agent-area-terminal.md)

This specification owns which commands of the base BaseHalf has: what the
Command Palette lists, what the menus hold, which keys run a command, what
Keyboard Shortcuts lists and where it opens, and what happens when something
executes a command by its id. It also owns where output shows, since
BaseHalf has no bottom panel. The keys of BaseHalf's own canvas are owned by
[the keys of the canvas](canvas-keys.md). Which settings BaseHalf
offers is owned by [the settings BaseHalf offers](settings-catalog.md); what
each of BaseHalf's own surfaces does with its commands is owned by the
specification of the surface.

## Problem

Measured on 2026-11-21 in the real window of a development build, with a
folder under git open:

- **The Command Palette listed 679 commands, and 193 of them belonged to
  what BaseHalf does not have.** BaseHalf hid the views of the base that it
  does not have by closing them after they opened. Their features were still
  loaded, and their commands were still offered: 14 of Tasks, Debug: Add
  Configuration, which writes `.vscode/launch.json`, Notebook, Test, Remote,
  Profiles, Browser: Open Integrated Browser, and 85 that split, move, pin,
  and arrange editors in groups and tabs that BaseHalf does not show.
- **A command could turn on what BaseHalf turns off.** The palette listed
  "Chat: Use AI Features with Copilot for free...". The base offers it exactly
  when its AI features are off, and running it writes
  `chat.disableAIFeatures: false`.
- **A command could cover the canvas.** View: Toggle Output and Git's Show
  Git Output opened the base's bottom panel, with Problems, Output, and
  Terminal, which BaseHalf's shell does not have.
- **The menus held entries that did nothing.** The application menu had a
  Run menu with one dead entry, Run Task under Terminal, and Extensions, Run,
  Problems, and Output under View. The gear's menu had Profiles and Tasks.
  The Accounts menu had a disabled "Manage Language Model Access...". The
  context menu of Files offered Open Timeline for a view that is hidden.
- **A command wrote a setting that BaseHalf keeps.** View: Toggle
  Breadcrumbs, moving the side bar or the activity bar, the Command Center
  entry of the title bar's context menu, and File › Auto Save each only
  write a setting that the catalog locks, so each would end in a refusal.
  "Preferences: Toggle between Light/Dark Themes" did nothing: BaseHalf's
  light preference is a dark theme.
- **Nothing enforced a hidden command.** The list of hidden surfaces named
  five commands of the Search Editor, and no code read them.

Seen in the real window later that day, with the hidden commands gone from
the palette and the menus:

- **Keyboard Shortcuts opened in the place of the canvas.** From the gear's
  menu it opened in the editor area: the canvas was gone behind it, the
  title bar showed an editor's, and Escape did not close it. Settings and
  the advanced list open in the overlay over the canvas.
- **Keyboard Shortcuts still listed commands of what BaseHalf does not
  have**: "Accept Inline Completion" and 14 more of inline suggestions,
  which have no provider; 68 actions of the Extensions view by their bare
  ids; the commands of the views of Run and Debug; and commands of the
  base's chat that the palette never listed. D141 read the two lists
  Keyboard Shortcuts is made from and did not open it.
- **Keyboard Shortcuts listed none of the keys of the canvas**
  ([the keys of the canvas](canvas-keys.md)).

## Terms

- **The base**: the workbench BaseHalf is built on, and its extensions that
  ship with BaseHalf.
- **A hidden command**: a command of the base that BaseHalf does not have.
- **A family**: the commands of one feature, named by their ids or by a
  pattern of ids.
- **The base's plumbing**: a command whose id starts with `_`. The base's
  parts and its extensions call it, and almost none is offered in a list.

## Which commands BaseHalf has

BaseHalf has a command when a surface of BaseHalf's uses it today. A command
of a feature that BaseHalf does not have, by a decision or because nothing of
it ships, is hidden.

### Hidden families

"Listed" is the number of commands the Command Palette listed before, with
nothing typed.

| Family | What it holds | Listed | Why BaseHalf does not have it |
| --- | --- | --- | --- |
| Editor tabs and groups | splitting, new groups, moving an editor or a group, the editor layouts, pinning, locking a group, the tab bar, the place of the editor actions, an editor or a terminal in a window of its own, hiding the editor area | 85 | a file opens in Card Detail, and there is one editor group without tabs |
| The bottom panel | focusing, moving, aligning, and maximizing the panel, the Output view with its filters, the terminal view of the panel | 19 | the shell has no bottom panel; [output](#output) opens as a document |
| Tasks | `workbench.action.tasks.*` | 14 | D137: an agent runs a folder's commands in the Agent Area |
| Debug | `debug.*`, `workbench.debug.*`, `workbench.action.debug.*`, `editor.debug.*`, the debug console, and the three commands that debug a window in a new one | 13 | no debugger ships |
| Profiles | `workbench.profiles.actions.*` | 9 | D137: one set of settings |
| The shape of the shell | breadcrumbs, the side bar's and the activity bar's place, the Command Center and the custom title bar, Auto Save, Toggle between Light/Dark Themes, workspace trust, the tabs of the system's windows, Move View | 9 | each only writes a setting that BaseHalf keeps at its own value, needs one at another value, switches to a theme BaseHalf never switches to, or moves a view out of its place |
| Notebooks | `notebook.*`, `workbench.notebook.*`, the interactive window | 8 | nothing ships that opens a notebook |
| The base's chat and agents | `workbench.action.chat.*`, `chat.*`, inline chat, agent sessions, tool servers (`workbench.mcp.*`), voice input, the base's onboarding, Open in Images Preview | 7 | the Agent Area is BaseHalf's surface for agents; see [the base's chat](#the-bases-chat) |
| The merge editor | `merge.*`, `mergeEditor.*`, Git's Resolve in Merge Editor | 5 | D123: a conflict is resolved in the file with its actions |
| The integrated browser | `workbench.action.browser.*` | 4 | D137: a page opens in the system's browser |
| Testing | `testing.*` and the Testing views | 4 | no test provider ships |
| Remote | the remote menu, forwarded ports, the connection, the links to the base's web editor | 3 | BaseHalf opens local folders |
| The Marketplace | the Extensions view and its lists, Start Extension Bisect, Browse Color Themes in Marketplace | 3 | D45 and D76: BaseHalf installs only the agent extensions |
| Problems | the Problems view and its filters | 3 | a view of the bottom panel; the marks show in Source |
| Welcome in a folder | Help: Welcome, Open Walkthrough, Get Started with Accessibility Features, the editor playground | 5 | an empty window shows the Welcome page by itself, and in a folder BaseHalf closes it; a walkthrough and the playground are the base's own tutorials |
| Timeline and Outline | `timeline.*`, Open Timeline, `outline.*` | 2 | hidden views: the Graph of Source Control shows a file's commits |
| The Search Editor | opening search results in an editor | 0 | it would cover the canvas |
| Cloud changes and settings sync | `workbench.editSessions.*`, `workbench.userDataSync.*` | 0 | no service is configured |

| Inline suggestions and inline edits | `editor.action.inlineSuggest.*`, Accept Inline Completion of the accessible view | 2 | no provider: the base's chat extension makes them, and it does not run; their settings are unlisted in the catalog |
| What a language service other than JSON's makes | parameter hints, inlay hints, renaming a symbol, linked editing | 0 | no language service runs but JSON's (D142), which makes none of them; their settings are unlisted in the catalog |

The families with 0 were not listed in this window and were reachable by a
key, a menu, or their id. The last two families were named when Keyboard
Shortcuts was read (D146), with what it still listed of four earlier ones:
the actions of the Extensions view and of an extension's page
(`workbench.extensions.action.*`, but what a developer needs of the
extension host, which is kept by name), the own commands of the views of Run
and Debug, the chat's commands on a commit of the Graph and its setup from
the commit message, and the peek of a test.

### Kept families

| Family, by the category the palette lists it under | Listed | The surface that uses it |
| --- | --- | --- |
| Git, Source Control, Merge Conflict, Publish to GitHub | 95 | Source Control and the Changes view |
| Terminal | 73 | the Agent Area: its terminals are the base's, and the commands that make one make a session there ([Agent Area terminal](agent-area-terminal.md)) |
| View: the side bars, zoom, Zen Mode, full screen, closing and stepping through editors | 66 | the shell, and the one editor group under Card Detail |
| No category: the editor's own, Go to, the clipboard, Quick Open, the window | 62 | Source, the canvas, and the window |
| BaseHalf, Agent, About | 53 | the Agent Area, the canvas, Providers, About |
| Developer | 50 | Reload Window, Toggle Developer Tools, the logs, and the like |
| File, Workspaces, Explorer, Create | 36 | Files |
| Help, Notifications, Accounts, Output, Local History, Shell Command, and two single commands | 24 | the window, and [output](#output) |
| Preferences, Snippets | 19 | Settings, Keyboard Shortcuts, Color Theme, and snippets in Source |
| Search | 7 | Search |

After the change the palette lists 486 commands, under 485 names. JSON's
language service adds two of its own (D142).

- **The terminal's commands stay as a family.** An Agent Area terminal is a
  terminal of the base, and a command that acts on the active terminal acts
  on it. Only the commands that would put a terminal where BaseHalf has no
  surface are hidden: a terminal in the editor area, in a window of its own,
  or in the panel.
- **Stepping through editors stays.** Source Control opens a deleted file and
  the files of a commit in the one editor group, and Next Editor and Close
  Editor work there.
- **The Welcome page of an empty window stays**, with its New File entry.
  Only the commands that open it or a walkthrough in a folder are hidden.
- **Go to Next Problem stays.** The marks of a mistake show in Source.
- **The base's plumbing stays.** Git asks `_aiEdits.*` at every commit. No
  pattern names plumbing; the one such command that the palette offers,
  the notebook's Select Kernel, is named by its id.

## Keyboard Shortcuts

Keyboard Shortcuts is the base's list of commands and their keys. In
BaseHalf it is where a user sees and changes the keys of the product.

- **It opens in the overlay**, over the canvas, as Settings and the advanced
  list do: from the gear's menu, from its key, from the Command Palette, and
  from Keyboard Shortcuts… of BaseHalf's Settings, where it takes the place
  of Settings ([BaseHalf's Settings](settings-pages.md#keyboard-shortcuts)).
  The canvas, Card Detail, and the Agent Area stay as they were behind it.
- **Escape closes it**, as do its close button and a press outside it. With
  text in its search field, Escape first clears the search.
- **It lists the commands BaseHalf has**, with the key and the condition of
  each: none of a hidden family, with or without a key. A command of
  something BaseHalf has stays, also where a base update adds one.
- **It lists BaseHalf's own commands** under the category BaseHalf, the
  keys of the canvas among them ([the keys of the canvas](canvas-keys.md)).
  A key changed there is in effect at once.
- The key bindings file, which Keyboard Shortcuts opens from its title, opens
  in the overlay too.

## Output

BaseHalf's shell has no bottom panel, so output has no view of its own. A
channel of output opens as a document over the canvas, in the overlay that
Settings opens in:

- The document is the channel's own, read-only, under the channel's name,
  colored as a log. It opens at its last line, and what the channel receives
  while it is open shows in it.
- Escape closes it, as does its close button and a press outside it. The
  canvas, Card Detail, and the Agent Area are as they were.
- Every way to show output arrives there: Git's Show Git Output, Output:
  Show Output Channels, Developer: Show Logs and Show Window Log, a channel
  that an extension shows, an agent extension among them, and a channel
  that the base shows itself. One that asks not to take the keyboard does
  not take it.
- The Output view is a hidden surface, with Problems, the debug console, and
  the test results. Nothing opens the bottom panel: a view of it that
  something opens is closed again, as before.
- The commands of the Output view go with it: its toggle, its filters, the
  level of the shown channel, and Clear Output. Developer: Set Log Level
  sets the level of a log.

A channel does not scroll by itself as it grows. Output that should be
followed line by line is a terminal's, in the Agent Area.

## The base's chat

The base's AI features are off in BaseHalf: `chat.disableAIFeatures` is a
locked setting ([the settings BaseHalf offers](settings-catalog.md)). Three
things of the base still reached past that switch:

- **Its setup commands.** The base offers "Use AI Features with Copilot for
  free..." exactly while its AI features are off, and the command turns
  them on. Every command of the family is hidden, the setup's among them,
  so no list offers one, no entry of the Accounts menu or of the title bar
  runs one, and executing one by its id fails. Nothing else in BaseHalf
  writes the switch: the one other writer of the base follows the base's
  own chat extension being enabled, and BaseHalf does not run it.
- **The search for tool servers.** At every start the base looked for the
  servers of its chat, and read a `.mcp.json` at the root of the opened
  folder for it. While the base's AI features are off, it looks for none:
  a `.mcp.json` is an agent's own configuration, and only the agent reads
  it.
- **The account of the base's chat.** With a GitHub session, the base asks
  GitHub which plan of its chat the account has, with the account's token.
  The product configuration names no address for these questions, so none
  is asked. Signing in to GitHub for Git stays as it is.

The product configuration keeps its block for the base's chat agent
(`defaultChatAgent`): 37 modules of the base read it, several without asking
whether it is there. It keeps the names that the base's code compares
extensions and settings with, and has no address of a service: the five
addresses that take an account's token are empty, and the address of the
base's voice service is not there.

## Required behavior

1. **One list.** The hidden commands are data: families, each with its
   command ids, its patterns of ids, and its reason
   (`BASEHALF_HIDDEN_COMMAND_FAMILIES`). A `*` in a pattern stands for any
   run of characters. A command that a pattern names and that BaseHalf has
   is in a list of kept commands, with its reason.
2. **The Command Palette** lists no hidden command, whatever is typed, the
   editor's own commands among them.
3. **No menu holds a hidden command**: the application menu, the title bar
   and its context menu, the gear's and the Accounts menu, the context menus
   of Files, of Source Control, and of an editor, and the title of a view. A
   submenu that is left without an entry goes with its entries, and so does
   a top-level menu of the application menu: there is no Run menu.
4. **No key runs a hidden command.** A key of the base or of an extension
   that ran one is free: it does what comes after it, or nothing. A key the
   user binds to a hidden command in the keybindings file says that the
   command is not found, as for any command that does not exist.
5. **Keyboard Shortcuts** lists no hidden command to bind, and opens in the
   overlay ([Keyboard Shortcuts](#keyboard-shortcuts)).
6. **Executing a hidden command by its id fails** as executing a command
   that does not exist: the caller gets the error `command '<id>' not found`.
   Nothing of the command runs, and no extension is activated for it. This
   holds for BaseHalf's own code, for the base's, and for an extension, an
   agent extension among them: to an extension, BaseHalf is a product in
   which the command does not exist. The refusal is written to the window's
   log.
7. **Customize Layout** lists a row only for a command BaseHalf has, and a
   heading only above a row. Its Restore Defaults writes no setting that has
   its default already.
8. **Open View** lists the views BaseHalf shows: Explorer, Source Control,
   Search, and Agent with their views, and the channels of output. It lists
   no hidden view, not the base's terminal panel, and not the container of
   an agent extension, which the Agent Area hosts.
9. **A new command of a hidden family is hidden before it ships.** A check
   fails when the base registers a command under a category of a hidden
   family and no pattern names it. The check runs in the window, which holds
   every registration of the base: the window names such commands in its
   log, and the smoke fails on the line. A unit test cannot load the base's
   registrations without changing the tests that share its process.

## Implementation boundaries

- **The list** is `shell/common/basehalfHiddenCommands.ts`, beside the hidden
  surfaces. It imports nothing. The commands that the hidden surfaces name
  (`kind: 'command'`) are in it.
- **Menus and the Command Palette**: BaseHalf's menu service
  (`shell/common/basehalfMenuService.ts`) takes the place of the base's. The
  base builds every menu from the menu registry there, so one place serves
  them all; it leaves out hidden commands and what they leave empty.
- **Executing**: BaseHalf's command service
  (`shell/common/basehalfCommandService.ts`) takes the place of the base's
  and refuses a hidden command.
- **Output**: the base's output service opens the Output view in one place,
  `showChannel`. There, a marked change opens the channel's document in the
  overlay instead (`shell/common/basehalfOutput.ts`). The Output view is on
  the list of hidden surfaces.
- **The base's chat**: the search for tool servers is one contribution of
  the base (`contrib/mcp/browser/mcpDiscovery.ts`); a marked change makes it
  follow `chat.disableAIFeatures`. The addresses are in `product.json`.
- **Five marked changes in the base's files** ask the list, a line or a few
  each: the keybinding service leaves the default keys of hidden commands
  out of its resolver; the list of commands without a key leaves them out;
  the Command Palette leaves out the editor's own commands that are hidden;
  Customize Layout, whose rows are not a menu, leaves out its rows; and
  Open View, whose rows are views, asks the hidden surfaces
  (`shell/common/basehalfOfferedViews.ts`).
- **Keyboard Shortcuts in the overlay**: the base opens Keyboard Shortcuts
  and the key bindings file in the editor group they were asked from. A
  marked change in `services/preferences/browser/preferencesService.ts`
  sends them to the overlay unless that group is the overlay's already,
  under the base's own conditions for the overlay: `workbench.editor.useModal`,
  which is locked at `some`, and not while the base's smoke driver runs.
- Nothing of a hidden feature is removed from the build (D122, D137).

## Acceptance criteria

1. With nothing typed, the Command Palette lists no command of a hidden
   family: none under Tasks, Debug, Notebook, Test, Profiles, Browser, Chat,
   Voice, Remote, Problems, or Merge Editor, and none that splits or moves an
   editor.
2. The application menu has no Run menu; Terminal holds New Terminal, Split
   Terminal, Run Active File, and Run Selected Text; View holds no
   Extensions, Run, Browser, Problems, Output, or Editor Layout; Appearance
   holds no entry for the place of the side bar, the activity bar, the
   panel, the tab bar, the editor actions, or breadcrumbs; File holds no
   Auto Save, no Share, and no New Window with Profile; Preferences holds no
   Profiles and no Tasks; Help holds no Welcome, no walkthrough, and no
   Editor Playground.
3. The gear's menu holds Command Palette, Settings, Keyboard Shortcuts,
   Snippets, Themes, and Layout Density, and the entries of an update. The
   Accounts menu holds no entry of a language model.
4. The context menu of a file in Files holds no Open Timeline, no entry of
   chat, of testing, or of the integrated browser, and no Share.
5. The context menu of the title bar holds Navigation Controls and Layout
   Controls, and no entry that writes a locked setting.
6. Customize Layout lists Primary Side Bar, Secondary Side Bar, Panel, and
   Status Bar under Visibility, the place of the quick input, and the modes,
   and nothing for the place of the side bar or the alignment of a panel.
7. The keys that the base gives to Output, Problems, Run and Debug,
   Extensions, Start Debugging, and Run Build Task open nothing and show no
   message.
8. Executing a hidden command by its id fails with `command '<id>' not
   found`, and the command does not run.
9. A command added to the base under the category of a hidden family, with
   an id that no pattern names, is named in the window's log, and the smoke
   fails on it (`hidden-families-name-their-commands`). A unit test shows
   the check on a list of commands.
10. With `chat.disableAIFeatures` on, the base starts no search for tool
    servers, at the start of a window and when `chat.mcp.access` changes.
11. The product configuration has a `defaultChatAgent` whose five addresses
    for entitlements, the token, the registry of tool servers, and managed
    settings are empty, and no `voiceWsUrl`.
12. Git: Show Git Output shows Git's output in the overlay over the canvas,
    at its last line; a letter typed into it changes nothing; Escape closes
    it. The bottom panel does not open. The same holds for a channel picked
    in Output: Show Output Channels and for a log picked in Developer: Show
    Logs.
13. View: Open View lists no Run and Debug, Extensions, Problems, Output
    view, Terminal, Outline, or Timeline.
14. Keyboard Shortcuts of the gear's menu, its key, Preferences: Open
    Keyboard Shortcuts of the Command Palette, and Keyboard Shortcuts… of
    Settings each show Keyboard Shortcuts in the overlay, with the canvas in
    view behind it; Escape closes it, and the canvas has the keyboard.
15. Keyboard Shortcuts lists no command whose id a hidden family names:
    none of inline suggestions, of the Extensions view, of the views of Run
    and Debug, or of the base's chat. It lists the commands of the canvas
    under BaseHalf.
16. A key given to a command in Keyboard Shortcuts is in the key bindings
    file and runs the command at once.

## Verification

- Unit tests of the list (`basehalfHiddenCommands.test.ts`): the family of a
  hidden command, the commands that stay, the commands of the hidden
  surfaces, and that no pattern names the base's plumbing; of the two
  services (`basehalfCommandAndMenuServices.test.ts`): the refusal, and a
  menu with its submenus (criteria 3 and 8); and of the check of criterion 9
  on a list of commands (`basehalfHiddenCommandsCheck.test.ts`).
- The check of criterion 9 was first a unit test that loaded eleven of the
  base's contributions. In the full unit suite those registrations reached
  the editor's own tests, 13 of which then failed, and they left out what
  other modules register: run in the window on 2026-11-21, with 1,420
  commands in the palette's menu and 403 of them under a hidden family's
  category, the check named one the test had missed,
  `workbench.action.speech.stopReadAloud`, which the chat family now names.
- A unit test of the product configuration (`basehalfBaseAiOff.test.ts`,
  criterion 11).
- A unit test of where a channel opens (`basehalfOutput.test.ts`), and the
  list of hidden view containers in `basehalfWorkbenchProfile.test.ts`.
- The workbench suite of the smoke: the palette lists no command of the
  hidden categories, the gear's and the Accounts menu hold their entries,
  the keys of criterion 7 open nothing, and Show Git Output opens over the
  canvas.
- Measured in the real window on 2026-11-21, before and after, in the same
  folder: the Command Palette with nothing typed, 679 commands before and
  486 after; the application menu with its submenus, File 26 entries and
  21, View 50 and 21, Go 38 and 26, Run 1 and no menu, Terminal 12 and 4,
  Help 10 and 6, Preferences 8 and 6, Edit and Selection unchanged; the
  gear's menu, 8 entries and 6; the
  Accounts menu, 2 and 1; the context menu of the title bar and Customize
  Layout as criteria 5 and 6 say; Open View as criterion 13 says; and the
  keys of criterion 7, pressed with the keyboard in Files. The application
  menu after the change was read from what the window sends to the main
  process, which draws it; before, from the menu bar itself.
- Run in the real window on 2026-11-21 for criterion 12: Git: Show Git
  Output, Main picked in Show Output Channels, and Window picked in Show
  Logs each opened in the overlay under the channel's name, with the newest
  line last; a letter typed changed nothing; Escape closed each; the bottom
  panel stayed shut. An agent extension's channel was not run: it reaches
  the same place as Git's, through the extension host.
- Run in the real window on 2026-11-21 for criterion 10: the starts of the
  base's search for a root `.mcp.json` were counted while `chat.mcp.access`
  went to `registry` and back to `all`, which makes the base start every
  search again: one start before the change, none after. That the base asks
  nothing of GitHub with a session was read in the code and not run: no
  session of a real account was used.
- Run in the real window on 2026-11-21 for criteria 4 and 5 of the required
  behavior: the default key bindings, opened as JSON, were searched for the
  ids of Tasks, Start Debugging, splitting an editor, Toggle Output, and the
  Extensions view, bound or listed as without a key: none was there, and
  Toggle Zen Mode and the terminal's New were. The Keyboard Shortcuts editor
  reads the same two lists and was not opened.
