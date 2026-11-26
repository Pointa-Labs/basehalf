# The commands and menus BaseHalf has

Status: Active (2026-11-21)
Decision: [D141](../decisions.md#d141--a-command-of-what-basehalf-does-not-have-is-in-no-list-and-does-not-run-new-2026-11-21),
[D146](../decisions.md#d146--the-keys-of-the-canvas-are-commands-and-keyboard-shortcuts-opens-over-the-canvas-new-2026-11-21)
for Keyboard Shortcuts,
[D150](../decisions.md#d150--the-shell-says-sidebar-and-agent-area-and-one-thing-has-one-command-new-2026-11-21)
for the words of the shell,
[D155](../decisions.md#d155--the-right-end-of-the-title-bar-is-more-and-the-agent-areas-button-new-2026-11-26)
for the More menu
Related: [the settings BaseHalf offers](settings-catalog.md),
[layout controls](layout-controls.md#the-right-group) for the buttons of the
title bar,
[the keys of the canvas](canvas-keys.md),
[architecture invariants](../harness/architecture-invariants.md#product-shell),
[built-in AI Video and no plugins](built-in-ai-video-and-no-plugins.md),
[Git/SCM/GitHub/GitGraph](../git-scm-github-gitgraph.md),
[Agent Area terminal](agent-area-terminal.md)

This specification owns which commands of the base BaseHalf has: what the
Command Palette lists, what the menus hold, which keys run a command, what
Keyboard Shortcuts lists and where it opens, and what happens when something
executes a command by its id. It owns the words the shell uses for the
parts of the window, wherever the base names them. It also owns where
output shows, since BaseHalf has no bottom panel. The keys of BaseHalf's own canvas are owned by
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
  which have no provider; 66 actions of the Extensions view and 3 of an
  extension's page, by their bare ids; the commands of the views of Run and
  Debug; and commands of the base's chat that the palette never listed. D141 read the two lists
  Keyboard Shortcuts is made from and did not open it.
- **Keyboard Shortcuts listed none of the keys of the canvas**
  ([the keys of the canvas](canvas-keys.md)).

Seen in the real window once more that day, after Keyboard Shortcuts had
come to list what BaseHalf has:

- **The shell named the parts by the base's words.** The two buttons of the
  title bar read "Toggle Primary Side Bar (⌘B)" and "Toggle Secondary Side
  Bar (⌥⌘B)". Customize Layout listed "Primary Side Bar" and "Secondary Side
  Bar". The Command Palette listed eleven commands under these names, Open
  View grouped its rows under "Side Bar" and "Secondary Side Bar", the
  context menus said "Hide Primary Side Bar", and a screen reader heard
  "Secondary Side Bar shown". Every specification, and every command of
  BaseHalf's own, calls the part at the right the Agent Area and the part at
  the left the sidebar. The base's files hold the two names 76 times in 13
  files.
- **One thing had several commands.** Five commands showed and hid the Agent
  Area under five names: "View: Toggle Secondary Side Bar Visibility",
  "BaseHalf: Toggle Agent Area", "BaseHalf: Toggle Agent Area Terminal",
  "View: Toggle Panel Visibility", and "View: Toggle Terminal". With one
  editor group, nine commands "in Group" did what the same command without
  the words does.
- **A command froze the window.** "View: Toggle Terminal" opens the base's
  terminal view in the bottom panel. BaseHalf closes that view when it
  opens, the command opened it again, and the window stopped answering,
  with its memory growing, until it was killed. Reproduced twice.
- **Keyboard Shortcuts listed BaseHalf's own commands by bare ids**: 29
  commands, among them the commands of the canvas's menus
  (`basehalf.canvas.copy`, `basehalf.canvas.cut`, …), which take what the
  menu was opened on and do nothing from a key, and six that have a key and
  no name (`basehalf.cardDetail.close`).
- **Commands of what BaseHalf does not have were still listed**: 24 of
  comment threads, which no extension of BaseHalf's provides; 10 of the
  Refactor Preview, a view of the bottom panel; the terminal's Attach to
  Session, Detach Session, and Clear Previous Session History, which belong
  to the base's kept sessions (D147).
- **Menus that the base draws by itself held entries that led nowhere.**
  The context menu of the sidebar's icons offered Extensions and Run and
  Debug, a Move To submenu, and "Move Primary Side Bar Right", which runs a
  hidden command. The list of languages offered "Search Marketplace
  Extensions for '.json'...", which runs a hidden command and so does
  nothing. D141 had the menu service leave out hidden commands; these menus
  are not made by it.

## Terms

- **The base**: the workbench BaseHalf is built on, and its extensions that
  ship with BaseHalf.
- **A hidden command**: a command of the base that BaseHalf does not have.
- **A family**: the commands of one feature, named by their ids or by a
  pattern of ids.
- **The base's plumbing**: a command whose id starts with `_`. The base's
  parts and its extensions call it, and almost none is offered in a list.

## The words of the shell

The base has names for the parts of its window, and BaseHalf has its own
for the parts it keeps. A user reads BaseHalf's.

| The base's words | BaseHalf's |
| --- | --- |
| Primary Side Bar, Side Bar | Sidebar |
| Secondary Side Bar | Agent Area |
| Toggle Primary Side Bar Visibility | Toggle Sidebar |
| Toggle Secondary Side Bar Visibility | Toggle Agent Area |

Inside a sentence the left part is written "sidebar", as the
specifications write it.

1. **Every place where a user reads a name of the base's shows BaseHalf's
   words**: the buttons of the title bar and their tooltips, the application
   menu, the More menu, every context menu, the Command Palette, Keyboard
   Shortcuts, Customize Layout, Open View, what a screen reader hears when a
   part is shown or hidden, and the description of a setting in the advanced
   list.
2. **A name of the base's that a user reads nowhere stays as it is**: the
   id of a command, the name of a setting, a context key in a condition of
   Keyboard Shortcuts, and the name of a command BaseHalf does not have.
3. **A word that BaseHalf's users know by the base's name stays**: Command
   Palette, Keyboard Shortcuts, Source Control, Status Bar, Explorer for the
   view of files and folders, and editor for the editor of text that Source
   is.
4. **A part BaseHalf does not have has no word**: its commands are hidden
   ([hidden families](#hidden-families)). BaseHalf has no panel, so no list
   names one.

### One command for one thing

A user does not see two commands that do one thing under two names.

- **The Agent Area is shown and hidden by Toggle Agent Area.** It is the
  command of the title bar's button, of View › Appearance, and of Customize
  Layout, with the key the button's tooltip shows, Option+Command+B. The
  Command Palette and Keyboard Shortcuts list it once, under View.
  BaseHalf's own command of the same name is gone.
- **Toggle Agent Area Terminal** stays: it shows the Agent Area with a
  session in it, starting the First Session when there is none, and gives it
  the keyboard ([Agent Area terminal](agent-area-terminal.md#the-first-session)).
  It has the two keys that show a terminal in the base, Control+Backquote
  and Command+J.
- The panel's toggle, which BaseHalf had made a third name for the same,
  and the toggle of the base's terminal view are hidden with the panel.
- **A command "in Group" is hidden where the same command without the
  words is listed**, since there is one editor group: Close All Editors,
  Open Next Editor, Open Previous Editor, Open Next and Previous Recently
  Used Editor, Show All Editors By Most Recently Used, and Save All stay.
  Close Other Editors in Group and Close Saved Editors in Group have no
  such twin and stay under the base's names.

## Which commands BaseHalf has

BaseHalf has a command when a surface of BaseHalf's uses it today. A command
of a feature that BaseHalf does not have, by a decision or because nothing of
it ships, is hidden.

### Hidden families

"Listed" is the number of commands the Command Palette listed before, with
nothing typed.

| Family | What it holds | Listed | Why BaseHalf does not have it |
| --- | --- | --- | --- |
| Editor tabs and groups | splitting, new groups, moving an editor or a group, the editor layouts, pinning, locking a group, the tab bar, the place of the editor actions, an editor or a terminal in a window of its own, hiding the editor area; the commands "in Group" that a command without the words does, closing the editors to the left or to the right of a tab, the first, the last, and the numbered editor of a group, the sides of an editor that is split in its group, and the commands of a window that holds one editor (D150) | 85 | a file opens in Card Detail, and there is one editor group without tabs |
| The bottom panel | focusing, moving, aligning, and maximizing the panel, the Output view with its filters, the terminal view of the panel; the panel's toggle, the base's terminal view with the commands the base makes for every view, and the Refactor Preview (D150) | 19 | the shell has no bottom panel; [output](#output) opens as a document |
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
| Comment threads | adding a comment, moving between threads, the Comments view and its filters | 0 | a thread comes from an extension that provides comments, and BaseHalf runs none; the comments of code, Toggle Line Comment and the like, are the editor's own and stay |
| The terminal's kept sessions | Attach to Session, Detach Session, Clear Previous Session History | 3 | BaseHalf brings back the arrangement of the Agent Area and starts every session anew (D147) |

The last two families were named by D150, which also added to five earlier
ones. The shape of the shell has the two commands that step through the
views of the Agent Area, which has one, and the commands that put a view
back in its place, which no view leaves. The Marketplace has Product Icon
Theme, since a product icon theme comes only from an extension that
BaseHalf does not install. The base's chat has the quick access of the
base's agents.

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
language service adds two of its own (D142). D146 adds the commands of the
canvas that the palette lists, five while nothing is selected
([the keys of the canvas](canvas-keys.md#the-command-palette)), and takes
Snooze Inline Suggestions and Cancel Snooze Inline Suggestions; the palette
was not counted again in a folder under git.

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
  list do: from the More menu, from its key, from the Command Palette, and
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
- **It names the commands in BaseHalf's words**
  ([the words of the shell](#the-words-of-the-shell)), as the Command
  Palette does.
- **A command of BaseHalf's own is listed by its name, never by its id.**
  One that has a key has a name. One that has neither a key nor an entry
  of the Command Palette is not listed: it is a command of a menu, which
  takes what the menu was opened on and would do nothing from a key, or a
  command that BaseHalf's parts call. The commands of the base that the
  base lists by their ids, as `cursorDown`, stay as the base lists them.
- The key bindings file, which Keyboard Shortcuts opens from its title, and
  the default key bindings, which the Command Palette opens, open in the
  overlay too.

## The menus

- **The More menu** is the menu of the three dots at the right end of the
  title bar ([layout controls](layout-controls.md#the-right-group), D155).
  It is the one menu of the title bar for what is about the application,
  and holds, in this order:
  1. Settings, Keyboard Shortcuts, Themes with Color Theme and File Icon
     Theme, and Layout Density with Default and Compact;
  2. Command Palette… and Customize Layout…;
  3. Accounts;
  4. the entries of an update.

  Settings is its first entry. A line stands between two of these groups. A
  group that an update of the base adds stands after the first, in the
  base's order.
- **Accounts is a submenu of the More menu**, and the title bar has no
  Accounts menu of its own. It holds each request of an extension to sign
  in or to use an account, Manage Accounts…, and Manage Extension Account
  Preferences…. Manage Accounts… lists the accounts that are signed in;
  choosing one offers its trusted extensions and Sign Out. It is the base's
  command, which the Command Palette lists too.
- **Snippets is a command of the Command Palette.** Configure Snippets
  makes snippets for code, a tool of Source that few use: the More menu
  and the Preferences menu of the application menu do not hold it, and the
  Command Palette and Keyboard Shortcuts do. A command of this kind is
  named in a list of its own, beside the hidden families.
- **A context menu holds no hidden command and reads in BaseHalf's words,
  whoever makes it.** The base draws some context menus itself, without the
  menu service: the menu of the sidebar's icons, of the sidebar's title, and
  of a part. What holds for a menu of the menu service holds for them: an
  entry whose command is hidden is left out, a submenu that is left empty
  goes, and the names are BaseHalf's.
- **The context menu of the sidebar's icons** holds no Move To: a view
  stays in its part.
- **An entry that leads to what BaseHalf does not have is not shown.** The
  list of languages does not offer to search the Marketplace.

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
  so no list offers one, no entry of Accounts or of the title bar
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
   and its context menu, the More menu with Accounts, the context menus
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
9. **The words** ([the words of the shell](#the-words-of-the-shell)). The
   base's words and BaseHalf's are one table (`BASEHALF_WORDS`), and one
   function gives a text in BaseHalf's words. The menu service applies it
   to every item it hands out, the context menu service to every entry it
   shows, Keyboard Shortcuts to the name of every row, and the advanced list
   to the description of a setting. Where the base draws a name itself, the
   same function is called at that place.
10. **A command of the Command Palette only** is in no menu but the
    palette's.
11. **A command of BaseHalf's own that has a key has a name.** The window
    names such a command without a name in its log, and the smoke fails on
    the line.
12. **A new command of a hidden family is hidden before it ships.** A check
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
- **The words** are `shell/common/basehalfWords.ts`, which imports
  nothing. BaseHalf's menu service hands out an item whose name holds a
  word of the base's as a copy with BaseHalf's words: its title, its short
  title, its tooltip, the title it has while it is on, and its description.
  Everything that draws from the menu service follows: the title bar, the
  application menu, the More menu, the Command Palette, and the menus of
  the views.
- **Context menus**: BaseHalf's context menu service
  (`shell/electron-browser/basehalfContextMenuService.ts`) takes the place
  of the base's, as the menu service does. Every context menu of the
  window is shown by it, so the menus the base draws itself are served
  there: `shell/common/basehalfContextMenuActions.ts` leaves out the entries
  whose id is a hidden command, and gives the others BaseHalf's words.
- **Marked changes in the base's files for the words**, a line each, where
  the base draws a name itself or reads one from a registry without the
  menu service: the name of a row of Keyboard Shortcuts, the description of
  a setting in the Settings editor, the rows of Customize Layout, the
  groups of Open View, and what the layout and the two toggles say to a
  screen reader.
- **Marked changes for entries that lead nowhere**: the context menu of the
  sidebar's icons makes no Move To, and the list of languages makes no
  entry for the Marketplace.
- **Keyboard Shortcuts and BaseHalf's own commands**: the base's list of
  commands without a key leaves out a command of BaseHalf's own that the
  Command Palette has no entry for
  (`shell/common/basehalfHiddenCommands.ts`, `isBaseHalfOwnCommand`). A
  command of BaseHalf's that has a key gets its name from an entry of the
  Command Palette, one that never holds where the palette should not list
  it ([the keys of the canvas](canvas-keys.md)).
- **Five marked changes in the base's files** ask the list, a line or a few
  each: the keybinding service leaves the default keys of hidden commands
  out of its resolver; the list of commands without a key leaves them out;
  the Command Palette leaves out the editor's own commands that are hidden;
  Customize Layout, whose rows are not a menu, leaves out its rows; and
  Open View, whose rows are views, asks the hidden surfaces
  (`shell/common/basehalfOfferedViews.ts`).
- **Keyboard Shortcuts in the overlay**: the base opens Keyboard Shortcuts
  and the key bindings file in the editor group they were asked from, and
  the default key bindings in the active group. Two marked changes in
  `services/preferences/browser/preferencesService.ts` send them to the
  overlay unless the group is the overlay's already, under the base's own
  conditions for the overlay: `workbench.editor.useModal`, which is locked
  at `some`, and not while the base's smoke driver runs.
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
3. The More menu holds Settings, Keyboard Shortcuts, Themes, Layout
   Density, Command Palette, Customize Layout, and Accounts, in this order,
   and the entries of an update; Themes holds Color Theme and File Icon
   Theme. It holds no Snippets and no Product Icon Theme. Accounts holds
   Manage Accounts and Manage Extension Account Preferences, and no entry of
   a language model.
4. The context menu of a file in Files holds no Open Timeline, no entry of
   chat, of testing, or of the integrated browser, and no Share.
5. The context menu of the title bar holds Navigation Controls and Layout
   Controls, and no entry that writes a locked setting.
6. Customize Layout lists Sidebar, Agent Area, and Status Bar under
   Visibility, the place of the quick input, and the modes, and nothing for
   the place of the side bar or the alignment of a panel. It has no row
   Panel: BaseHalf has no panel.
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
14. Keyboard Shortcuts of the More menu, its key, Preferences: Open
    Keyboard Shortcuts of the Command Palette, and Keyboard Shortcuts… of
    Settings each show Keyboard Shortcuts in the overlay, with the canvas in
    view behind it, and Escape closes it. Preferences: Open Default Keyboard
    Shortcuts (JSON) opens in the overlay too.
15. Keyboard Shortcuts lists no command whose id a hidden family names:
    none of inline suggestions, of the Extensions view, of the views of Run
    and Debug, or of the base's chat. It lists the commands of the canvas
    under BaseHalf.
16. A key given to a command in Keyboard Shortcuts is in the key bindings
    file and runs the command at once.

17. The button at the left end of the title bar reads "Toggle Sidebar"
    with its key, and the layout button of the right group "Toggle Agent
    Area" with its key. No button of the title bar reads "Side Bar".
18. With nothing typed, the Command Palette lists no command whose name
    holds "Side Bar" or "Panel". It lists View: Toggle Sidebar, View:
    Toggle Agent Area, View: Focus into Agent Area, and View: Maximize
    Agent Area. Keyboard Shortcuts lists no row whose name holds "Side
    Bar".
19. The Command Palette lists one command named Toggle Agent Area, and
    Keyboard Shortcuts one, with Option+Command+B. Toggle Agent Area
    Terminal has Control+Backquote and Command+J. Command+J shows the Agent
    Area with a session and hides it again.
20. "Toggle Terminal" of the base is in no list, and executing
    `basehalf.internal.terminal.toggleView` or `workbench.action.togglePanel`
    fails as a command that does not exist. The window keeps answering.
21. Open View groups its rows under Sidebar and Agent Area.
22. The context menu of the sidebar's icons holds no Extensions, no Run and
    Debug, no Move To, no entry for the place of the side bar, and reads
    "Hide Sidebar". The context menu of the sidebar's title reads "Hide
    Sidebar".
23. Hiding and showing the Agent Area and the sidebar says "Agent Area
    hidden", "Agent Area shown", "Sidebar hidden", and "Sidebar shown" to a
    screen reader.
24. Keyboard Shortcuts lists no row that starts with `basehalf.` or
    `pointa.`: no command of BaseHalf's own by its id. It lists BaseHalf:
    New Note, Close Card Detail, Go to Next Change in Changes, Go to
    Previous Change in Changes, Close Changes, and Stop Editing Code on
    Card with their keys.
25. Keyboard Shortcuts and the Command Palette list no command of comment
    threads, of the Refactor Preview, or of the terminal's kept sessions,
    no command "in Group", and no Close Editors to the Left. Toggle Line
    Comment and Toggle Block Comment stay.
26. With a JSON file in Source, Change Language Mode lists no entry that
    names the Marketplace.
27. The Preferences menu of the application menu holds no Configure
    Snippets; the Command Palette lists Snippets: Configure Snippets.
28. In the advanced list, the description of a setting that names the
    sidebar or the Agent Area by the base's words reads in BaseHalf's.

## Verification

### The words of the shell and what is listed (D150)

- Unit tests: the table and the function (`basehalfWords.test.ts`): the
  names of the title bar, the palette, the application menu with its
  underlined letter, Customize Layout, Open View, a screen reader, and the
  descriptions of settings, and the texts that stay; the menu service
  (`basehalfCommandAndMenuServices.test.ts`): the title, the short title,
  the tooltip, the title while on, the description, the second command of
  an item, and a submenu in BaseHalf's words, the registry as it was, and a
  command of the Command Palette only; the context menus
  (`basehalfContextMenuActions.test.ts`); the families
  (`basehalfHiddenCommands.test.ts`); what Keyboard Shortcuts lists without
  a key (`basehalfKeyboardShortcutsList.test.ts`); the names of the keyed
  commands and the check of criterion 24 on a list
  (`basehalfKeyedCommands.test.ts`); the keys of Toggle Agent Area Terminal
  (`basehalfAgentAreaTerminalConfig.test.ts`); and the keys of Zoom Canvas
  Out (`basehalfCanvasKeys.test.ts`).
- The smoke, changed and not run: the steps that toggle the Agent Area name
  Toggle Agent Area Terminal or View: Toggle Agent Area;
  `layout-control-at-the-left-end` and `card-detail-holds-no-layout-control`
  read the buttons by their new names; `title-bar-menus-hold-what-basehalf-has`
  reads the gear's menu without Snippets; the palette step looks for the
  newly hidden commands and categories; `hidden-families-name-their-commands`
  also fails on a command of BaseHalf's with a key and no name.
- Run in the real window on 2026-11-21, in a folder under git with notes, a
  picture, a video, a sound, a PDF, and a JSON file, before and after, by
  scripts that read every row:
  - **The Command Palette**, nothing typed: 491 rows before and 471 after.
    Gone: the 11 under "Side Bar" names, which came back as 9 under
    BaseHalf's (the two that step through the views of the Agent Area did
    not); BaseHalf: Toggle Agent Area, Toggle Panel Visibility, and Toggle
    Terminal; 9 "in Group", Close Editors to the Left and to the Right; 3 of
    the terminal's kept sessions; Product Icon Theme; Reset View Locations.
    New: BaseHalf: New Note.
  - **Keyboard Shortcuts**: 1,757 rows before and 1,631 after; by the two
    lists it is made from, 1,551 commands and 1,427. The 124 that left: 41
    of tabs, groups, and an editor's own window; 24 of comment threads; 22
    of BaseHalf's own without a name, the removed Toggle Agent Area among
    them; 16 of the panel, with the Refactor Preview and the base's
    terminal view; 14 of the shape of the shell, the places of views among
    them; 3 of the base's quick access for agents; 3 of the terminal's kept
    sessions; and Product Icon Theme. Six of BaseHalf's own that had a key
    and a bare id have a name. No row holds "Side Bar" or "Panel", and none
    starts with `basehalf.` or `pointa.`. Sorted by family after: the
    editor of text with lists and quick input 474; Git, Source Control, and
    GitHub 259; the window 187; the terminal 120; BaseHalf 77;
    notifications, output, and a developer's tools 77; Settings, Keyboard
    Shortcuts, themes, and update 76; Files 67; Search 35; and 55 more of
    the editor by bare ids.
  - **Criteria 17 and 19**: the buttons read "Toggle Sidebar (⌘B)" and
    "Toggle Agent Area (⌥⌘B)". Option+Command+B with no session showed the
    Agent Area with the sessions to choose from and started none; a second
    press hid it. Command+J showed it with the First Session and the
    keyboard in it; a second press hid it. Control+Backquote is in no row
    on the keyboard layout of the machine, before and after, and did
    nothing.
  - **Criterion 20**: before, View: Toggle Terminal of the palette stopped
    the window twice (100% of a processor, 1.2 and 3.6 GB, no answer to the
    debugger) until it was killed. After, a key of the user's bound to
    `basehalf.internal.terminal.toggleView` and one bound to
    `workbench.action.togglePanel` each said that the command was not
    found, nothing opened, and the window answered.
  - **Criteria 3, 6, 21, 22, 26, 27, 28**: read from the gear's menu with
    its submenus, Customize Layout, Open View, the context menu of the
    sidebar's icons (before: Extensions, Run and Debug, Move To, Activity
    Bar Position, Move Primary Side Bar Right, Hide Primary Side Bar;
    after: Explorer, Source Control, Search, Hide Sidebar, and the entries
    of the icon), the list of languages of a JSON file, and the advanced
    list searched for "side bar". The application menu was read from the
    system's menu bar: Appearance holds Sidebar, Agent Area, and Status
    Bar, and Preferences holds no Configure Snippets. The context menu of
    the sidebar's title was read before only.
  - **Criterion 23**: the text the window hands to assistive technology
    read "Agent Area shown", "Agent Area hidden", "Sidebar hidden", and
    "Sidebar shown" after each toggle. No screen reader ran.
  - **The checks of required behavior 11 and 12**, run against the
    registries of the window: of 1,444 commands of the palette's menu none
    is under a hidden family's category without a pattern; of 52 commands
    of BaseHalf's own with a key none is without a name. The window's log
    had neither line.
  - **Zoom Canvas Out**: on the canvas at 43%, Command+Shift+= went to 53%
    and Command+Shift+- back to 43% and on to 33%, and the window's own
    zoom did not change. Before the change it was read in the table only.
- Not reproduced: the extension links of the advanced list that an earlier
  reading reported, and a button of JSON's language status that runs a
  hidden command. Three searches of the advanced list showed no link to an
  extension; the base makes two such entries, for a search result of the
  Marketplace and for a recommended extension, and neither showed. JSON's
  status showed Show Schemas, which listed the schemas; its Configure Trust
  runs a hidden command and shows only in a folder that is not trusted,
  which BaseHalf has none of.

### The hidden families (D141, D146)

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
  hidden categories, the More menu and its Accounts hold their entries,
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
- Unit tests for Keyboard Shortcuts: the families of what it still listed
  (`basehalfHiddenCommands.test.ts`), and where the base opens it, from a
  group of the main part with the overlay on and off
  (`preferencesService.test.ts`).
- The workbench suite of the smoke, `canvas-keys-are-commands`: Keyboard
  Shortcuts lists the commands of the canvas and none of inline
  suggestions, of the Extensions view, or of the views of Run and Debug.
  Under the smoke driver it stands in the editor area, as the advanced list
  does.
- Run in the real window on 2026-11-21 for criteria 14 to 16, in a folder
  without git. Before: Keyboard Shortcuts of the gear's menu stood in the
  editor area, the canvas was not in view, and Escape did not close it; its
  list had 1,852 rows. After: from the gear's menu, from Keyboard Shortcuts…
  of Settings (in place of Settings), from its key, and from the Command
  Palette it stood in the overlay with the cards in view around it, and
  Escape closed it each time; the default key bindings opened in the overlay.
  Its list had 1,752 rows: 123 rows of 112 commands were gone (15 commands of
  inline suggestions, 15 of parameter hints, inlay hints, renaming a symbol,
  and linked editing, 66 actions of the Extensions view and 3 of an
  extension's page, 5 of the views of Run and Debug, 7 of the base's chat,
  and the peek of a test), and 25 rows of the 19 commands of the canvas had
  come. The rows were read by scrolling the list; the ids, from the two
  lists the editor is made from, which gave 1,845 and 1,747 rows: 7 rows of
  the editor before and 5 after are not told by their ids. Tidy Canvas given
  Alt+T by a double click on its row was in the key bindings file and
  tidied at once. After Escape the keyboard is on the editor group under the
  canvas, as after Settings closes, not on the canvas: a press on the canvas
  gives it the keyboard.
- Run in the real window on 2026-11-21 for criteria 4 and 5 of the required
  behavior: the default key bindings, opened as JSON, were searched for the
  ids of Tasks, Start Debugging, splitting an editor, Toggle Output, and the
  Extensions view, bound or listed as without a key: none was there, and
  Toggle Zen Mode and the terminal's New were. The Keyboard Shortcuts editor
  reads the same two lists and was not opened.

### The More menu (D155)

- `basehalfMoreButton.test.ts`: the group of Settings first and the other
  groups in their order; Customize Layout and Accounts in the More menu, and
  Manage Accounts in Accounts.
- The smoke, step `title-bar-menus-hold-what-basehalf-has`: the More menu
  starts with Settings, Keyboard Shortcuts, Themes, Layout Density, Command
  Palette…, Customize Layout…, and Accounts, holds no Snippets, and Accounts
  holds Manage Accounts… and Manage Extension Account Preferences… and no
  entry of a language model (criterion 3).
- Read in an isolated development window on 2026-11-26, with what each
  entry opened: [layout controls](layout-controls.md#verification). No
  account was signed in, so Manage Accounts… said that there are no active
  accounts; with an account signed in it was not run.
