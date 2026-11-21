# The commands and menus BaseHalf has

Status: Active (2026-11-21)
Decision: [D141](../decisions.md#d141--a-command-of-what-basehalf-does-not-have-is-in-no-list-and-does-not-run-new-2026-11-21)
Related: [the settings BaseHalf offers](settings-catalog.md),
[architecture invariants](../harness/architecture-invariants.md#product-shell),
[built-in AI Video and no plugins](built-in-ai-video-and-no-plugins.md),
[Git/SCM/GitHub/GitGraph](../git-scm-github-gitgraph.md),
[Agent Area terminal](agent-area-terminal.md)

This specification owns which commands of the base BaseHalf has: what the
Command Palette lists, what the menus hold, which keys run a command, and
what happens when something executes a command by its id. It also owns where
output shows, since BaseHalf has no bottom panel. Which settings BaseHalf
offers is owned by [the settings BaseHalf offers](settings-catalog.md); what
each of BaseHalf's own surfaces does with its commands is owned by the
specification of the surface.

## Problem

Measured on 2026-11-21 in the real window of a development build, with a
folder under git open:

- **The Command Palette listed 679 commands, and 188 of them belonged to
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
| The shape of the shell | breadcrumbs, the side bar's and the activity bar's place, the Command Center and the custom title bar, Auto Save, Toggle between Light/Dark Themes, workspace trust, Move View | 9 | each only writes a setting that BaseHalf keeps at its own value, switches to a theme BaseHalf never switches to, or moves a view out of its place |
| Notebooks | `notebook.*`, `workbench.notebook.*`, the interactive window | 8 | nothing ships that opens a notebook |
| The base's chat and agents | `workbench.action.chat.*`, `chat.*`, inline chat, agent sessions, tool servers (`workbench.mcp.*`), voice input, the base's onboarding, Open in Images Preview | 7 | the Agent Area is BaseHalf's surface for agents; see [the base's chat](#the-bases-chat) |
| The merge editor | `merge.*`, `mergeEditor.*`, Git's Resolve in Merge Editor | 5 | D123: a conflict is resolved in the file with its actions |
| The integrated browser | `workbench.action.browser.*` | 4 | D137: a page opens in the system's browser |
| Testing | `testing.*` and the Testing views | 4 | no test provider ships |
| Remote | the remote menu, forwarded ports, the connection, the links to the base's web editor | 3 | BaseHalf opens local folders |
| The Marketplace | the Extensions view and its lists, Start Extension Bisect, Browse Color Themes in Marketplace | 3 | D45 and D76: BaseHalf installs only the agent extensions |
| Problems | the Problems view and its filters | 3 | a view of the bottom panel; the marks show in Source |
| Timeline and Outline | `timeline.*`, Open Timeline, `outline.*` | 2 | hidden views: the Graph of Source Control shows a file's commits |
| The Search Editor | opening search results in an editor | 0 | it would cover the canvas |
| Cloud changes and settings sync | `workbench.editSessions.*`, `workbench.userDataSync.*` | 0 | no service is configured |

The families with 0 were not listed in this window and were reachable by a
key, a menu, or their id.

### Kept families

| Family, by the category the palette lists it under | Listed | The surface that uses it |
| --- | --- | --- |
| Git, Source Control, Merge Conflict, Publish to GitHub | 95 | Source Control and the Changes view |
| Terminal | 73 | the Agent Area: its terminals are the base's, and the commands that make one make a session there ([Agent Area terminal](agent-area-terminal.md)) |
| View: the side bars, zoom, Zen Mode, full screen, closing and stepping through editors | 67 | the shell, and the one editor group under Card Detail |
| No category: the editor's own, Go to, the clipboard, Quick Open, the window | 62 | Source, the canvas, and the window |
| BaseHalf, Agent, About | 53 | the Agent Area, the canvas, Providers, About |
| Developer | 51 | Reload Window, Toggle Developer Tools, the logs, and the like |
| File, Workspaces, Explorer, Create | 36 | Files |
| Help, Notifications, Accounts, Output, Local History, Shell Command, and four single commands | 28 | the window, and [output](#output) |
| Preferences, Snippets | 19 | Settings, Keyboard Shortcuts, Color Theme, and snippets in Source |
| Search | 7 | Search |

After the change the palette lists 492 commands, under 491 names.

- **The terminal's commands stay as a family.** An Agent Area terminal is a
  terminal of the base, and a command that acts on the active terminal acts
  on it. Only the commands that would put a terminal where BaseHalf has no
  surface are hidden: a terminal in the editor area, in a window of its own,
  or in the panel.
- **Stepping through editors stays.** Source Control opens a deleted file and
  the files of a commit in the one editor group, and Next Editor and Close
  Editor work there.
- **Welcome and its walkthroughs stay.** An empty window shows the Welcome
  page.
- **Go to Next Problem stays.** The marks of a mistake show in Source.
- **The base's plumbing stays.** Git asks `_aiEdits.*` at every commit. No
  pattern names plumbing; the one such command that the palette offers,
  the notebook's Select Kernel, is named by its id.

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
5. **Keyboard Shortcuts** lists no hidden command to bind.
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
8. **A new command of a hidden family is hidden before it ships.** A check
   fails when the base registers a command under a category of a hidden
   family and no pattern names it.

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
- **Four marked changes in the base's files**, each one line that asks the
  list: the keybinding service leaves the default keys of hidden commands
  out of its resolver; the list of commands without a key leaves them out;
  the Command Palette leaves out the editor's own commands that are hidden;
  and Customize Layout, whose rows are not a menu, leaves out its rows.
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
   Profiles and no Tasks.
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
   an id that no pattern names, fails a unit test.
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

## Verification

- Unit tests of the list (`basehalfHiddenCommands.test.ts`): the family of a
  hidden command, the commands that stay, the commands of the hidden
  surfaces, and that no pattern names the base's plumbing; of the two
  services (`basehalfCommandAndMenuServices.test.ts`): the refusal, and a
  menu with its submenus (criteria 3 and 8); and of the registry
  (`basehalfHiddenCommandFamilies.test.ts`), which loads the base's own
  registrations of Tasks, Debug, Notebooks, Testing, chat, the merge editor,
  the Search Editor, Problems, and Remote, and fails on a command of their
  categories that no pattern names (criterion 9).
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
  492 after; the application menu, File 26 entries and 21, View 50 and 21,
  Go 38 and 26, Run 1 and no menu, Terminal 12 and 4, Preferences 8 and 6,
  Edit, Selection, and Help unchanged; the gear's menu, 9 entries and 7; the
  Accounts menu, 2 and 1; the context menu of the title bar and Customize
  Layout as criteria 5 and 6 say; and the eight keys of criterion 7, pressed
  with the keyboard in Files.
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
