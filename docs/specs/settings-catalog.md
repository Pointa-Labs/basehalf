# The settings BaseHalf offers

Status: Active (2026-11-21). Decided; being implemented: until the catalog is
in the product, the Settings editor of the base lists every setting.
Decision: [D137](../decisions.md#d137--every-setting-has-one-of-five-classes-and-a-setting-nothing-follows-is-work-not-waste-new-2026-11-21)
Related: [BaseHalf's pages in Settings](settings-pages.md) (the pages, which
change with the Settings of BaseHalf's own),
[a code file on its card and in Card Detail](code-cards.md),
[Agent Area terminal](agent-area-terminal.md),
[workbench appearance](workbench-appearance.md),
[screen reader mode](screen-reader-mode.md), [app update](app-update.md),
[providers](providers.md#credentials-regions-and-endpoints)

This specification owns which settings BaseHalf offers to a user, which it
keeps at a value of its own, which it leaves out, and which it does not
follow yet. It gives every setting that the base registers one of five
classes. How the pages of Settings look and what they say is owned by
[BaseHalf's pages in Settings](settings-pages.md). The specification that
owns a surface owns what its settings do there.

## Problem

Measured on 2026-11-21 in the real window, a development build of 0.7.0, from
the configuration registry of the window:

- **1,474 settings are registered, and 5 are BaseHalf's.** The others are the
  base's and those of the five extensions that ship with settings (Git, GitHub,
  GitHub authentication, merge conflicts, media preview). Settings opens on
  Commonly Used: the editor's font size, Format On Save, Default Formatter.
- **705 settings change nothing today, for two different reasons.** 676
  belong to what BaseHalf does not have, by a decision or because nothing of
  it ships: the base's chat and agents (198), what needs a language service
  or a formatter (92), notebooks (61), editor tabs and groups (39), debug
  (34). The other 29 name something a surface of BaseHalf's has or could
  have, and the surface does not follow them: the name of a session in the
  Agent Area, its bell, its sessions after a reload. A first count took both as dead.
- **A setting that works in one place is ignored in another.** The editor on
  a code card reads none of the user's `editor.*` settings but the font: the
  cursor, closing brackets, and the key of several cursors follow the
  settings in Source and not on the card. The canvas leaves out folders by a
  list of names of its own, `build`, `out`, `dist`, `vendor`, and the like,
  and not by `files.exclude` as Files does.
- **Some settings break the product.** Run in the window:
  `window.commandCenter` off removes the location and its search from the
  title bar; `workbench.secondarySideBar.forceMaximized` lays the Agent Area
  over the whole window, a note and the canvas with it;
  `workbench.panel.opensMaximized` as `always` lets the Output panel cover the
  canvas, and a note opened then is not in view. Read in the code:
  `window.titleBarStyle` as `native` draws two title bars.
- **A default is not a rule.** BaseHalf sets 39 defaults of the base
  (`shell/common/basehalfWorkbenchProfile.ts`), such as no editor tabs and
  the base's AI features off. A settings file overrides each of them, and the
  main process, which reads the settings of the window before a window
  exists, never sees them.
- **A hidden feature can be turned on again from its settings.** With
  `chat.disableAIFeatures` set to false in a settings file, the base's chat
  commands return (read in the code, not run). The Command Palette lists a
  command of the base that writes exactly that.

## Terms

- **The base**: the workbench BaseHalf is built on, and its extensions that
  ship with BaseHalf.
- **A settings file**: the user's `settings.json`, or the `settings.json` in
  the `.vscode` folder of an opened folder.
- **BaseHalf's Settings**: the pages BaseHalf draws for its settings
  ([BaseHalf's pages in Settings](settings-pages.md)).
- **The advanced list**: the Settings editor of the base, with its search and
  its table of contents.
- **The catalog**: the rules that give each setting its class.

## The five classes

| Class | Listed in | Its value | A value in a settings file |
| --- | --- | --- | --- |
| Shown | BaseHalf's Settings, and the advanced list | the user's | applies |
| Advanced | the advanced list | the user's | applies |
| Locked | nowhere | BaseHalf's | has no effect, and the file says so |
| Pending | nowhere, until its surface follows it | the base's default | is left alone |
| Unlisted | nowhere | the base's default | is left alone |

- **Shown.** BaseHalf's Settings lists the setting under a name and a line of
  BaseHalf's own. It writes the user's `settings.json`, so the advanced list
  and the file show the same value.
- **Advanced.** The setting works as in the base and keeps the base's name
  and words. BaseHalf honors the value: where a surface of BaseHalf's depends
  on such a setting, it follows it.
- **Locked.** The setting has BaseHalf's value in every process, the main
  process too. No list shows it. A value written in a settings file changes
  nothing, and the editor of the file marks the line as having no effect in
  BaseHalf, as the base marks a setting it does not know. BaseHalf never
  rewrites the file.
- **Pending.** The setting names a behavior that a surface of BaseHalf's has
  or could have, and the surface does not follow it. No list shows a setting
  that does nothing. Each pending setting has the surface that owes the
  answer, and one of two ends: the surface follows it, and it becomes
  advanced or shown; or a decision says BaseHalf does not have the behavior,
  and it becomes unlisted. Pending is a list of work, not a place to stay.
- **Unlisted.** The setting belongs to something BaseHalf does not have, by a
  decision or because nothing of it ships. No list shows it. A value in a
  settings file is read as the base reads it, and normally changes nothing.

## How a setting gets its class

1. **Locked** when BaseHalf's shell, its canvas, or its saving rest on one
   value, and another value does one of these: covers the canvas or a note,
   removes a control of BaseHalf's with nothing in view to bring it back,
   shows a surface BaseHalf hides, or turns on a feature BaseHalf turns off.
   A default that BaseHalf merely prefers is not locked.
2. **Pending** when nothing reads the setting today and no decision says why.
   The cause is then how a surface was built, not a choice: an Agent Area
   terminal is kept out of the base's terminal groups, so everything the
   groups did for a terminal went with them.
3. **Unlisted** when a decision, or the absence of anything that ships,
   explains why nothing reads it.
4. **Shown** when a user would look for it without knowing the base, its
   words need no knowledge of the base, and its effect is in view at once.
   These are few.
5. **Advanced** otherwise. A setting whose other value takes something of
   BaseHalf's away in a way the user asked for is advanced, not locked: with
   Git off the cards show no change marks, and with the Trash off a delete is
   for good.

A setting belongs to exactly one class. The rules are read in this order,
and within a class the first rule that names the setting holds. That nothing
reads a setting is never by itself a reason to leave it out for good: the
question is whether BaseHalf decided so.

## The catalog

Counts are those of the registry on 2026-11-21. A pattern ends in `*` where
it stands for every setting that starts so.

### Shown (12)

| Setting | What it is to a user |
| --- | --- |
| `basehalf.editor.readingMode` | reading aids in notes |
| `basehalf.canvas.defaultZoom` | how large the canvas first shows a folder |
| `basehalf.files.showHiddenFolder` | `.bh` in Files |
| `basehalf.agent.defaultSession` | the session the Agent Area starts with |
| `basehalf.agents.offerSkill` | the offer of BaseHalf's skill |
| `window.zoomLevel` | the size of everything in the window |
| `editor.fontFamily`, `editor.fontSize`, `editor.wordWrap` | code and a note's Source: the font also of code cards |
| `terminal.integrated.fontFamily`, `terminal.integrated.fontSize` | the Agent Area's terminals |
| `update.mode` | whether BaseHalf looks for updates by itself |

### Locked (49)

| Why | Settings and BaseHalf's value |
| --- | --- |
| The title bar is BaseHalf's: the location, its search, and the buttons of the window (5) | `window.commandCenter` true, `window.customTitleBarVisibility` `auto`, `window.titleBarStyle` `custom`, `window.nativeTabs` false, `window.nativeFullScreen` true |
| BaseHalf has no editor tabs (3) | `workbench.editor.showTabs` `none`, `zenMode.showTabs` `none`, `breadcrumbs.enabled` false |
| The shape of the shell: Files, Git, and Search at the left with their icons above, the Agent Area at the right, each a card (3) | `workbench.activityBar.location` `top`, `workbench.sideBar.location` `left`, `workbench.experimental.modernUI` true |
| Nothing covers the canvas by a setting (12) | `workbench.secondarySideBar.forceMaximized` false, `workbench.secondarySideBar.defaultVisibility` `visibleInWorkspace`, `workbench.panel.opensMaximized` `never`, `workbench.panel.defaultLocation` `bottom`, `workbench.editor.useModal` `some`, `workbench.startupEditor` `welcomePageInEmptyWorkbench`, `workbench.welcomePage.walkthroughs.openOnInstall` false, `workbench.welcomePage.experimentalOnboarding` false, `search.mode` `view`, `git.mergeEditor` false, `scm.workingSets.enabled` false, `scm.workingSets.default` `current` |
| Files save by themselves: nothing in BaseHalf shows an unsaved file, and agents read the disk (2) | `files.autoSave` `afterDelay`, `files.autoSaveDelay` 250 |
| The base's AI features stay off (14) | `chat.disableAIFeatures` true, and the 13 switches of the base's chat that BaseHalf sets today (`chat.agent.enabled`, `chat.agentsControl.enabled`, `chat.unifiedAgentsBar.enabled`, `chat.agentSessionProjection.enabled`, `chat.viewSessions.enabled`, `chat.agentsHandoffTip.mode`, `chat.titleBar.signIn.enabled`, `chat.titleBar.openInAgentsWindow.enabled`, `chat.agentHost.enabled`, `chat.agentHost.claudeAgent.enabled`, `chat.agentHost.codexAgent.enabled`, `chat.agents.claude.preferAgentHost`, `chat.editor.claude.preferAgentHost`) |
| Workspace trust stays off: BaseHalf has no surface for it, and an untrusted folder would run without Git (5) | `security.workspace.trust.*`, with `enabled` false and the prompts `never` |
| Hidden surfaces stay shut, and a folder starts no task by itself (5) | `task.allowAutomaticTasks` `off`, `debug.internalConsoleOptions` `neverOpen`, `testing.automaticallyOpenPeekView` `never`, `testing.automaticallyOpenTestResults` `neverOpen`, `testing.countBadge` `off` |

### Pending (29)

| What a user would expect | Settings | Why nothing follows them | The surface that owes the answer |
| --- | --- | --- | --- |
| A session of the Agent Area is named by what runs in it, or by the title an agent gives it (4) | `terminal.integrated.tabs.title`, `.description`, `.separator`, `.allowAgentCliTitle` | a session's name is fixed when it starts | [Agent Area terminal](agent-area-terminal.md) |
| A terminal is there again after the window reloads (3) | `terminal.integrated.enablePersistentSessions`, `terminal.integrated.persistentSession*` | a session is started as one that is not kept | Agent Area terminal |
| The bell of a program shows on its session (3) | `terminal.integrated.enableBell`, `.enableVisualBell`, `.bellDuration` | the bell sets a mark that only the base's tabs draw | Agent Area terminal |
| Closing the window or a session with something running asks first (2) | `terminal.integrated.confirmOnExit`, `.confirmOnKill` | the first counts only terminals of the base's groups; the second asks after the session is gone | Agent Area terminal |
| A secondary click and a middle click do what the setting says, a split starts where its session is, and a screen reader has the terminal's text (5) | `terminal.integrated.rightClickBehavior`, `.middleClickBehavior`, `.splitCwd`, `.accessibleView*` | the Agent Area has no menu on a terminal, a split starts a new session, and the accessible view looks for the base's active terminal | Agent Area terminal, [screen reader mode](screen-reader-mode.md) |
| A shell suggests commands and paths as they are typed (12) | `terminal.integrated.suggest.*` | the extension that provides them does not ship | Agent Area terminal, [what the package holds](what-the-package-holds.md) |

### Unlisted (676)

| Family | Count | What settles it |
| --- | --- | --- |
| The base's chat and agents: `chat.*`, `inlineChat.*`, `agents.*`, `mcp`, `github.copilot.*`, `onboarding.*`, `imageCarousel.*` | 198 | the Agent Area is BaseHalf's surface for agents ([architecture invariants](../harness/architecture-invariants.md#product-shell)) |
| What needs a language service in the editor: `editor.inlineSuggest.*`, `editor.parameterHints.*`, `editor.inlayHints.*`, `editor.gotoLocation.*`, the 27 kinds of `editor.suggest.show*` that only a language service produces, semantic highlighting, peek, rename, linked editing | 82 | D118 and D121: no language service runs, an agent answers those questions |
| Problems, Timeline, the merge editor, Outline, breadcrumbs: `problems.*`, `timeline.*`, `git.timeline.*`, `mergeEditor.*`, `outline.*`, `breadcrumbs.*`, `merge-conflict.diffViewPosition` | 76 | D118 for diagnostics and symbols; D123 for the merge editor; D73, the location in the title bar, for breadcrumbs; Timeline is hidden, and Git's Graph shows a file's commits |
| Notebooks: `notebook.*`, `interactiveWindow.*` | 61 | nothing ships that opens a notebook |
| Accessibility of what is unlisted here: the signals and the verbosity of chat, debug, notebooks, inline suggestions, and diagnostics | 42 | follows the rows of this table |
| Editor tabs and groups: the looks of tabs, pinned tabs, splitting, `explorer.openEditors.*` | 39 | a file opens in Card Detail, and there is one editor group (architecture invariants) |
| Debug: `debug.*`, `launch` | 34 | no debugger ships; the view is hidden |
| The stock terminal panel: the rest of `terminal.integrated.tabs.*`, where a terminal opens, sticky scroll, the marks of commands, the hint | 26 | terminals are the Agent Area's, which hides sticky scroll and the marks of commands |
| Tasks, the integrated browser, profiles: `task.*`, `workbench.browser.*`, and the two settings of profiles | 23 | D137: BaseHalf has none of the three. An agent runs a folder's commands in the Agent Area, a page opens in the system's browser, and there is one set of settings |
| The workbench without a service or a provider: cloud changes, the product icon theme, the chat entries of the Command Palette, AI search of settings | 20 | no service is configured and no provider ships |
| The Marketplace: recommendations, signatures, the gallery | 14 | D76 and D122: BaseHalf installs only the extensions it allows |
| Remote: `remote.*` | 14 | BaseHalf opens local folders |
| Testing: `testing.*` | 13 | no test provider ships; the view is hidden |
| Telemetry and experiments: `telemetry.*`, `workbench.enableExperiments`, `update.channel` | 11 | BaseHalf sends no telemetry and runs no experiments |
| What needs a formatter: `editor.formatOn*`, `editor.defaultFormatter`, `editor.codeActionsOnSave`, and three of `files.*` that depend on them | 10 | D118: a formatter comes with a language service |
| The Search Editor and AI search: `search.searchEditor.*`, `search.searchView.*` | 10 | the Search Editor would cover the canvas; AI search has no provider |
| Git's AI and commit diagnostics | 3 | no provider |

The rows that name D118 rest on one decision, no language service: about
130 settings ([what the decision settled](#what-the-decision-settled)).

### Advanced (708)

| Family | Count |
| --- | --- |
| The text editor: `editor.*`, `diffEditor.*` | 220 |
| Source control and Git: `scm.*`, `git.*`, `github.*`, `merge-conflict.*`, `mediaPreview.*` | 138 |
| The workbench: `workbench.*`, `zenMode.*`, `screencastMode.*` | 99 |
| The terminal: `terminal.*` | 78 |
| Files: `files.*`, `explorer.*` | 46 |
| Accessibility: `accessibility.*` | 31 |
| The application: `http.*`, `update.*`, `keyboard.*`, `security.*`, and the like | 29 |
| Search: `search.*` | 28 |
| The window: `window.*` | 24 |
| Agent extensions: `extensions.*`, `comments.*`, `output.*` | 15 |

- The color theme is advanced: the canvas and the Agent Area terminal keep
  their dark palette whatever the theme is
  ([workbench appearance](workbench-appearance.md)), so a light theme
  changes only the sidebar, the title bar, and the status bar.
- The shell of a terminal, the proxy, screen reader mode, and Git's fetching
  are advanced too: a user may look for them, and each needs the words of
  the base to be understood.
- The three settings of the shell's shape are locked though another
  arrangement works in the base: BaseHalf is described, drawn, and tested in
  one arrangement.
- `workbench.localHistory.*` is advanced: every save of a text file is
  recorded, and Local History: Find Entry to Restore of the Command Palette
  reads the record. A view of a file's history is no part of this
  specification.
- The settings an agent extension brings when the user installs it,
  `claudeCode.*` (23 on 2026-11-21) and `chatgpt.*` (8), are advanced. They
  are not in the counts: the registry was read without the extensions.

## Where a surface does not follow a listed setting

A shown or an advanced setting works in the base's own surfaces. These
surfaces of BaseHalf's do not follow it yet. Each is work for the
specification that owns the surface; none changes a class.

| Surface | Settings it does not follow | What happens instead |
| --- | --- | --- |
| The editor on a code card | every `editor.*` that says how typing behaves: the cursor's look and blinking, closing brackets and quotes, indenting, the key of several cursors, Find, the clipboard, word separators | the editor's own defaults. Its size, lines, and looks are fixed on purpose, so that it stands where the card's face stood ([code cards](code-cards.md)) |
| The canvas | `files.exclude` | a list of names of its own: a folder named `build`, `out`, `dist`, `target`, `vendor`, or `node_modules` has no card, and nothing a user sets brings it back; what the user excludes in Files still has a card |
| The excerpt on a text or code card | `files.encoding`, `files.autoGuessEncoding` | the file is read as UTF-8, while Card Detail reads it by the settings |
| What BaseHalf animates | `workbench.reduceMotion` set to `on` or `off` | 11 stylesheets ask the system's own preference; three places ask the setting |
| Going back and forward with the buttons of a mouse or a swipe | `workbench.editor.mouseBackForwardToNavigate`, `workbench.editor.swipeToNavigate` | they move through the base's history of editors, and Go Back in the title bar through BaseHalf's history of the canvas (read in the code, not run) |
| Files and Source Control, when a file opens in Card Detail | `explorer.autoReveal`, `scm.autoReveal` | they follow the base's active editor, which Card Detail is not (read in the code, not run) |
| The title of the window | the variables of `window.title` | they never name the note in Card Detail |
| The Agent Area and the canvas | `accessibility.dimUnfocused.*` | only the base's editors and terminals dim |
| A note in Rich, in Preview, and on its card | none exists | the size and the font of a note's text have no setting |
| The canvas's own keys | none exists | the keys of the canvas are not in Keyboard Shortcuts and cannot be changed |

One group of advanced settings stops at a note on purpose:
`files.trimTrailingWhitespace`, `files.insertFinalNewline`, and
`files.trimFinalNewlines` change what is saved of code and text files, and
never what is saved of a note. Two spaces at the end of a line are a line
break in Markdown, and a note is plain text to the base, so the exception
the base makes for Markdown does not reach it. This holds for every way a
note is saved: Rich, Source, the card, and BaseHalf's own writes.

BaseHalf's own code reads these advanced settings, and follows them:
`files.enableTrash` (what BaseHalf deletes is deleted for good when it is
off; every place that reads it reads it the same way), `git.enabled` and
`git.decorations.enabled` (no change marks without them),
`explorer.incrementalNaming` (the name of a copy),
`editor.accessibilitySupport` ([screen reader mode](screen-reader-mode.md)),
`terminal.integrated.cwd` (where an agent starts),
`terminal.integrated.sendKeybindingsToShell` and `.commandsToSkipShell`
(whether a key goes to the Agent Area or to the program in it),
`terminal.integrated.mouseWheelScrollSensitivity`,
`diffEditor.renderSideBySide` (written by Inline View of the Changes view),
and `http.proxy` with `http.noProxy` (followed by the requests to providers
and by the update check).

## What the decision settled

- **Language services stay out, but for JSON.** D118 and D121 stand: no
  language service runs, and an agent answers what one would. About 130
  unlisted settings follow from it. The JSON language service is the one
  exception, admitted by a decision of its own: a settings file, a
  `package.json`, and an agent's configuration are JSON, and those who edit
  them are those who use the advanced list. With it, completion, formatting,
  and marks for mistakes work in JSON files, and the settings that tune them
  move to advanced in the same change.
- **Tasks, the integrated browser, and profiles are not BaseHalf's.** Their
  settings are unlisted, and their commands and menu entries go
  ([not in this specification](#not-in-this-specification)).
- **The Agent Area follows the settings of a terminal** for the name of a
  session, the bell, closing with something running, and the clicks. Sessions
  after a reload, the place of a split, the accessible view, and the
  suggestions of a shell stay pending.
- **The surfaces of the table above follow their settings**, each by the
  specification that owns the surface.

## Not in this specification

- The pages of BaseHalf's Settings, their words, and their looks.
- What BaseHalf keeps outside settings files: providers with their regions,
  endpoints, and credentials, the last model used, the answer to the offer of
  the skill, and the preferences of the book reader are in the application's
  storage. BaseHalf's Settings shows some of them; they have no class.
- The commands and menus of hidden features. The Command Palette lists 609
  commands, and the application menu holds Run and Run Task; a command that
  only writes a locked setting is one of them.
- Removing the code of hidden features from the build.

## Implementation boundaries

- **One catalog** in `shell/common/`: ordered rules from a pattern of setting
  names to a class, for a locked setting its value, and for a pending one
  the surface that owes the answer. BaseHalf's Settings, the advanced list,
  and the lock read it. The defaults of `basehalfWorkbenchProfile.ts` that
  become locked move into it.
- **The lock** sits where the base already drops a value that a layer may
  not set, a setting of the application written in a folder's file, or a
  restricted one in an untrusted folder: at the reading of a settings file.
  It holds in the main process, which reads `window.*` before a window
  exists.
- **Locked, pending, and unlisted settings leave the lists** the way the base
  leaves out a setting that is not offered on a system: they are registered
  as not included.

## Acceptance criteria

1. Every setting the base and the shipped extensions register has exactly
   one class. A check lists the settings that no rule names, and fails on
   one, so a new setting of a base update is classified before it ships.
2. With each locked setting given another value in the user's
   `settings.json` and in a folder's `.vscode/settings.json`, the window is
   as without the lines: the title bar holds the location and its search,
   the Agent Area keeps its place and the canvas stays in view, an Output
   panel does not open maximized, no editor tabs show, and the base's chat
   commands stay away. The editor of the file marks each of the lines.
3. `window.titleBarStyle` as `native` in the user's `settings.json` leaves
   BaseHalf's one title bar after a restart.
4. The advanced list holds the 720 shown and advanced settings and no other:
   its table of contents has no group for chat, notebooks, debug, testing,
   or remote, and a search for a locked, a pending, or an unlisted setting
   finds nothing.
5. A shown setting changed in BaseHalf's Settings has the new value in the
   advanced list and in the user's `settings.json`, and the other way round.
6. With `files.trimTrailingWhitespace`, `files.insertFinalNewline`, and
   `files.trimFinalNewlines` on, a note whose line ends in two spaces and
   whose file ends without a line feed is saved byte for byte from Rich, from
   Source, and from its card, and a `.txt` file saved from Source loses its
   trailing spaces and gains the line feed.
7. A pending setting that its surface comes to follow moves to advanced or
   shown in the same change, and the check of criterion 1 names the class it
   has.

## Verification

- The registry was read from the window of a development build
  (`vscode-base/.build/rw-set/dump.mts`), and the rules of the catalog were run
  against it (`vscode-base/.build/rw-set/classes.mjs`): 12 shown, 49 locked,
  29 pending, 676 unlisted, 708 advanced, none without a rule. Both are tool
  state of the checkout, not part of the tree; the check of criterion 1
  replaces them.
- Run in the real window on 2026-11-21: the three settings of the problem
  that break the product, tabs and breadcrumbs that do not show, the editor's
  font size reaching a note's Source, word suggestions in a note's Source,
  and a split that is taken back.
- Read in the code and not run: the native title bar; the editor of a code
  card and its options; the canvas's list of names; the excerpt read as
  UTF-8; the rows of the Agent Area under Pending; and the rows marked so
  under "Where a surface does not follow a listed setting".
