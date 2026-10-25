# BaseHalf agent skill

Status: Active (2026-10-11; version 6 of the text, 2026-10-22: generation
cards, drafts, `generation.yaml`, `made.yaml`, and `basehalf --generate`
replace the Video node, and an image an agent makes itself goes into the
canvas's folder; version 7, 2026-10-23, D67: only a draft has a
`generation.yaml`, a generated file keeps its inputs, every input of a draft
is sent, and `--generate` on a generated file makes a new draft first;
version 8, 2026-10-24, D74: a prompt mentions an input as `@[<entry>]`;
version 9, 2026-10-25, D78: a generation card is an image, a video, or a
sound, and a sound an agent makes itself goes where an image does;
version 10, 2026-10-25, D81: selected text in a PDF names its pages and in
a book its chapter; installed as a link to BaseHalf's own copy, which
follows every release, and offered until the user answers, 2026-10-26, D83)
Decisions: [D43](../decisions.md#d43--agents-learn-a-basehalf-workspace-from-a-skill-the-user-installs-new-2026-10-11),
[D57](../decisions.md#d57--agents-can-read-what-the-user-selected-and-the-window-shows-it-new-2026-10-14),
[D58](../decisions.md#d58--a-video-node-is-a-prompt-over-its-connections-run-by-the-users-own-providers-new-2026-10-15),
[D59](../decisions.md#d59--video-providers-are-built-in-integrations-with-each-models-exact-settings-users-bring-their-own-keys-new-2026-10-19),
[D63](../decisions.md#d63--a-generated-file-is-its-card-new-2026-10-22),
[D64](../decisions.md#d64--basehalf-generates-images-with-the-same-cards-panel-and-providers-new-2026-10-22),
[D67](../decisions.md#d67--a-draft-is-what-will-be-made-a-generated-file-shows-what-made-it-new-2026-10-23),
[D74](../decisions.md#d74--a-prompt-mentions-its-inputs-files-and-each-provider-module-names-them-as-its-model-reads-them-new-2026-10-24),
[D78](../decisions.md#d78--basehalf-makes-speech-music-and-sound-effects-with-the-same-cards-panel-and-providers-new-2026-10-25),
[D81](../decisions.md#d81--a-pdf-or-a-book-shows-its-cover-at-one-size-and-a-book-opens-to-be-read-new-2026-10-25),
[D83](../decisions.md#d83--the-agent-skill-is-a-link-to-basehalfs-own-copy-which-follows-each-release-and-its-offer-stays-until-it-is-answered-new-2026-10-26)
Related: [agent launch context](agent-launch-context.md),
[the selection agents can see](selection-for-agents.md),
[reference graph](reference-graph.md),
[workspace state and legacy cleanup](workspace-state-and-legacy-cleanup.md),
[generation cards](generation-cards.md#agents)

## Problem

A card's badge is its description and its upstream and downstream
connections. An agent needs it to work on a card: what the item is for, what
it builds on, and what uses it.

Today only one kind of agent session is told where the badge is. A Claude Code
session that Agent Area starts gets the
[launch instruction](agent-launch-context.md). Codex, extension agents, and an
agent the user starts in any other terminal get nothing. They see the
`upstream` list inside a Markdown note, but not a card's description or the
upstream list of a PDF or a folder, which are under the hidden `.bh/` folder.

BaseHalf is the container that intelligence flows through, not an intelligence
layer. It should not reach into an agent to make this work, and it stopped
writing into the user's `AGENTS.md` and `CLAUDE.md` (D36). The agents
themselves now share an open format for exactly this kind of knowledge: a
skill, which the user installs and the agent loads when a task calls for it.

## Goals

- One skill that tells any agent which supports the Agent Skills format where
  a card's badge is and how to keep it intact.
- The user installs it. BaseHalf offers it when a workspace opens and never
  installs it unasked.
- Once installed, it follows every release of BaseHalf, and BaseHalf never
  changes the agents' folders again unless the user asks.
- It works for an agent started anywhere, not only in Agent Area.
- Where BaseHalf stores a badge does not change.

## Non-goals

- Making an agent use the skill. An agent loads a skill when it judges that
  the task matches the skill's description.
- Telling a running agent session that a badge changed. The skill says to read
  the badge from disk again; nothing is pushed.
- Writing anything into the workspace.
- Agents that keep skills in a location other than the two below.

## The skill

The skill is one folder named `basehalf` that holds one file, `SKILL.md`. Its
text is part of the application bundle. BaseHalf writes it into a folder of
its own, which the agents' folders link to
([where it is installed](#where-it-is-installed)).

**Front matter.** The opening `---` is the first line of the file.

- `name`: `basehalf`.
- `description`: at most 1,024 characters. It leads with the one sign of a
  BaseHalf workspace, a hidden `.bh/` directory, and tells the agent to look
  for it in its working folder before reading, writing, moving, or renaming
  notes and files. An agent does not see a hidden directory unless it lists
  it, so the description has to say to check. It does not mention the folders
  above; see [the sign of a workspace](#the-sign-of-a-workspace). It also
  names the second sign, a Markdown note whose frontmatter has an `upstream`
  list, and the questions the skill answers: what a file is for, what it
  builds on, and what uses it. Last, it says that in such a workspace the
  skill also applies to a request that does not say which file or text it
  is about, such as "this", "here", or "improve it", because BaseHalf
  records what the user selected.
- `metadata.version`: a whole number, written as a string, that grows
  whenever the text changes. BaseHalf compares versions as numbers.

**Body.** In this order:

1. **Whether this is a BaseHalf workspace.** A folder is one when it contains
   `.bh/`. The working directory is usually the workspace folder; when it has
   no `.bh/` and a folder above it has one, that folder is the workspace
   folder. Every path in the skill is relative to it. With `.bh/` present the
   skill applies to
   everything the agent does there, whether or not BaseHalf is running.
   Without it, only what the skill says about a note's `upstream` list
   applies. Then what a workspace is: the user arranges files and folders as
   cards on a canvas and connects them, and ordinary files are the content.
2. **A card's badge.**
   - *Description*: one line on what the item is for, under `description` in
     `.bh/mirror/<path>/badge.yaml`, where `<path>` is the item's path
     relative to the workspace folder. Many cards have none.
   - *Upstream*: the items whose content flows into this one. They are the
     context the user chose for it.
   - *Downstream*: the items this one flows into. It is stored nowhere and is
     found by searching.
   - The user can change a badge while the agent works. Read it from disk when
     it is needed, and again before relying on it later.
3. **What the user selected.** The record of
   [the selection agents can see](selection-for-agents.md#the-record): where
   it is, that a request that does not say what it is about is about it, that
   the request wins when it names something else, that it exists only while
   BaseHalf is open and changes with every selection, that agents never
   write it, and what each field means. It is not in the launch
   instruction: without the skill there is no record.
4. **The sections of the launch instruction**, word for word: where BaseHalf
   keeps its metadata, relationships, preserving relationships, and canvas
   workflows ([content contract](agent-launch-context.md#content-contract)).
   They are written once in the source and used by both texts. Canvas
   workflows describe generation cards and drafts, what an agent writes in a
   draft's `generation.yaml`, that it never writes `made.yaml` and leaves a
   generated file's `generation.yaml` and `upstream.yaml` alone, how it
   deletes a draft, the inputs in the order of `upstream.yaml`, that every
   one is sent and the mode that is used, that a prompt mentions an input as
   `@[<entry>]`, `host.modelCatalog`, and
   `basehalf --generate`, which makes a new draft from a generated file
   ([generation cards](generation-cards.md#what-an-agent-may-write)).
5. **An image or a sound the agent makes itself.** An image or a sound that
   an agent makes with a tool of its own, such as its own image generation,
   is put in the folder of the canvas the user works on, where it is a card
   ([generation cards](generation-cards.md#agents)). That folder is the one
   the record of what the user selected names: the folder itself, or the
   folder of the selected cards or note. Without a record, the agent asks the
   user which folder. This section is not in the launch instruction, which
   goes only to Claude Code sessions, and it names no tool.

The body describes where things are and what they mean. Following D36, it
does not tell an agent what to read or in what order. It stays under 500
lines.

## The sign of a workspace

The skill recognizes a BaseHalf workspace by its `.bh/` directory and by
nothing else that BaseHalf writes.

- `.bh/` appears when a folder's canvas is first shown, because BaseHalf
  saves the place of every card then
  ([canvas card placement](canvas-card-placement.md#what-showing-a-canvas-writes)).
  A folder that BaseHalf never showed has none. A folder that was only shown
  holds card places and nothing an agent has to keep intact: places are not
  shared through git, and BaseHalf follows a file that an agent moves.
- There is no file that says BaseHalf is running. What the skill asks of an
  agent holds while BaseHalf is closed too: a file moved then still has a
  badge to carry along. The one thing that needs the running application, the
  `basehalf` command, reports by itself when it cannot be reached, and the
  skill says what to do then.
- BaseHalf therefore writes no marker file, and opening a folder changes
  nothing that git shows
  ([workspace state](workspace-state-and-legacy-cleanup.md)).
- The description asks about the working folder only. Every agent session on
  the machine reads the description, also in folders that have nothing to do
  with BaseHalf. An agent may not read above its working folder without
  asking the user, so a description that says to look there makes agents ask
  in every such folder. The body, which an agent reads only once the skill
  applies, says that the workspace folder can be above the working directory.

## Where it is installed

| For | Entry |
| --- | --- |
| Claude Code | `<home>/.claude/skills/basehalf` |
| Codex, and other agents that read the shared location | `<home>/.agents/skills/basehalf` |

`<home>` is the user's home folder on this machine. Each entry is a symbolic
link to BaseHalf's own copy of the skill, the folder
`<home>/.basehalf/agent-skill/basehalf/`, which holds `SKILL.md`. Claude
Code and Codex both read a skill folder through a link: their documentation
says so, and the [recorded trials](#recorded-trials) show it. Installing
writes the copy and the two links. Nothing is written into a workspace.

The copy is not inside the application bundle: macOS may run an application
from a temporary path, and a development build's bundle is somewhere else.
Every BaseHalf on the machine uses the same folder, a development build
included.

Each entry is in one of four states:

- **missing**: nothing is there;
- **linked**: a link to BaseHalf's own copy;
- **copy**: a folder, such as the copy that an earlier release wrote there;
- **other**: a link to anywhere else, or a file.

The skill is **installed** while at least one entry is linked.

## Keeping it current

**A release changes only BaseHalf's own copy.** The agents' folders change
only when the user installs or removes the skill.

- When a window starts, and whenever it gains focus, BaseHalf writes the
  bundled text into its own copy if at least one entry is linked and the
  copy holds neither this text nor a higher version. A copy that is missing
  is written again: the link is the user's choice, and the copy is
  BaseHalf's.
- A copy of a higher version is left as it is. The copy therefore holds the
  text of the newest BaseHalf that ran on this machine, and an older
  BaseHalf beside a newer one, such as a release beside a development build,
  never writes an older text over it. A copy of the same version with other
  bytes takes the bundled text.
- The copy is written whole through a temporary file, so that an agent never
  reads half of it.
- An agent reads the new text the next time it loads the skill. Claude Code
  notices a changed skill within a session. Codex notices it too, and
  otherwise after a restart.

## Offer

BaseHalf offers the skill while all of these hold:

- a workspace folder is open;
- the window is local and runs on the desktop (not a remote connection, not
  the web);
- no workspace folder is marked with `.basehalf-no-workspace-setup`;
- the setting `basehalf.agents.offerSkill` is `true` (the default; a
  workspace can turn it off for itself);
- no entry is linked;
- the user has not answered with **Don't Ask Again** and has not removed the
  skill with **Remove Agent Skill**.

The offer is one information notification. It appears once per window,
after the workbench has restored, and **it stays until the user chooses one
of its buttons or closes it**: it does not hide after a time.

> Install the BaseHalf skill for your agents? It tells Claude Code and Codex
> what you select and where a card's description and connections are. It is
> added to your agents' own settings on this computer, not to this folder,
> and BaseHalf keeps it up to date.
>
> Install · Not Now · Don't Ask Again

When no entry is missing, which means that an earlier release left its copy
there, it reads:

> Update the BaseHalf skill for your agents? It tells Claude Code and Codex
> what you select and where a card's description and connections are. After
> this update, BaseHalf keeps it up to date by itself.
>
> Update · Not Now · Don't Ask Again

- **Install** or **Update** installs the skill.
- **Not Now**, or closing the notification, closes it in this window. The
  status bar entry stays, and the next window offers the skill again.
- **Don't Ask Again** stores the answer in application storage. No version of
  the skill is offered again, and the status bar entry goes.
  **Install Agent Skill** still installs it.

**While the offer is unanswered**, the status bar entry of
[the selection agents can see](selection-for-agents.md#what-the-window-shows)
says that agents cannot see the selection, and a click on it shows the
offer again. That notification is shown even while Do Not Disturb is on,
because the user asked for it.

The notification follows the wording rules of D41: it names no path, no file
format, and no hidden folder.

## Commands

- **BaseHalf: Install Agent Skill** installs the skill whatever the setting
  and the stored answer are, and forgets a stored Don't Ask Again.
- **BaseHalf: Remove Agent Skill** removes both links, a copy that an earlier
  release left in an agent's folder, and BaseHalf's own copy. It counts as
  Don't Ask Again.
- The status bar entry runs a command that shows the offer. It is not listed
  in the Command Palette.

## Installing and removing

- Installing writes BaseHalf's own copy first, unless it holds a higher
  version, and then makes each link on its own: missing folders are created,
  and a link to anywhere else is replaced.
- A copy that an earlier release left in an agent's folder is replaced by the
  link: BaseHalf deletes its `SKILL.md` and the folder. When the folder holds
  anything else, BaseHalf changes nothing there and reports that location
  with the reason "a folder of that name holds files of your own". A file at
  the entry is reported with "a file of that name is in the way".
- A location that cannot be made does not stop the other. BaseHalf then says
  "The BaseHalf skill could not be installed for <agent>: <reason>", with a
  plain reason from
  [mirror file resilience](mirror-file-resilience.md#failure-reasons-in-messages)
  or one of the two above. When its own copy cannot be written, both
  locations are reported with that reason.
- When both are made it says "The BaseHalf skill is installed for Claude Code
  and Codex, and BaseHalf keeps it up to date. Agent sessions you start from
  now on can use it. To take it away, use Remove Agent Skill in the Command
  Palette."
- Removing deletes the links, never what they point at, then an earlier
  release's copy where one is (its `SKILL.md`, and the folder when it is
  then empty), then BaseHalf's own copy and those of its folders that are
  then empty. A link to anywhere else is left. Removing a skill that is not
  installed says "The BaseHalf skill is not installed." Otherwise it says
  "The BaseHalf skill was removed. BaseHalf won't offer it again; Install
  Agent Skill brings it back."
- A window cannot make a link. A service in the shared process inspects,
  makes, and removes links (`platform/basehalfFiles/`, beside the setting of
  file times of D82). It changes links only, never a file or a folder.
- Moving BaseHalf to the Trash leaves the links and the copy, as it leaves
  the other folders that BaseHalf keeps on the machine. Remove Agent Skill
  takes them away.

## Agent Area sessions

A Claude Code session that Agent Area starts still receives launch context.
When the skill is installed for Claude Code, in any state other than missing,
that context is the short pointer to the skill instead of the full
instruction. See [agent launch context](agent-launch-context.md#mechanism).

## Source-tree guard

A marked workspace gets no offer and no status bar entry for it, as it gets
no launch context. The commands still work there, because they write only to
the user's home folder.

## Acceptance criteria

1. The skill text starts with `---`, has `name: basehalf`, a `description` of
   at most 1,024 characters, and a `metadata.version`. The description starts
   with the `.bh/` sign, asks about the working folder and not the folders
   above, mentions `upstream`, and names a request that does not say which
   file or text it is about. The body has "What the user selected" with
   `.bh/cache/selection.yaml` and each of its fields. The body starts with how to tell a
   BaseHalf workspace. Its body names `.bh/mirror/<path>/badge.yaml`,
   `.bh/mirror/<path>/upstream.yaml`, `.bh/mirror/<path>/generation.yaml`,
   `made.yaml`, and the `upstream` frontmatter key, says that files can be
   moved with ordinary tools, says where an image or a sound the agent made
   itself goes,
   contains every line of the launch instruction's shared sections, and has
   fewer than 500 lines. It names no `.bhnode` and no `--run-node`. Its
   version is `10`. Unit test.
2. Installing writes BaseHalf's own copy with exactly the bundled bytes and
   links both entries to its folder, creating missing folders. The states
   are missing before and linked after. An earlier copy that holds only
   `SKILL.md` becomes the link; one that holds other files is left as it is
   and reported, and the other location is still linked. A link to anywhere
   else is replaced. Removing deletes both links, the earlier copies, and the
   own copy, and leaves a link to anywhere else; removing again reports that
   the skill is not installed. Unit test on an in-memory file system, with
   the link service faked.
3. Keeping it current: while an entry is linked, the copy takes the bundled
   text when it is missing, of a lower version, or of the same version with
   other bytes, and keeps a higher version. Without a link nothing is
   written. Unit test.
4. The link service, on the disk: it tells a missing entry, a link with its
   target, and a file or a folder apart; it makes a link and its parent
   folders, replaces a link, refuses a file or a folder, and changes nothing
   when the link is there already; removing a link leaves what it pointed
   at; it refuses what is not on the disk. Unit test.
5. The offer is a notification that stays (sticky), shown once per window:
   Install when an entry is missing, Update when an earlier copy is in
   every place, and none when an entry is linked, when the setting is off,
   in a marked workspace, without a workspace folder, after Don't Ask Again,
   or after Remove Agent Skill. Install Agent Skill installs after Don't Ask
   Again and forgets it. Shown on demand, it has the priority that Do Not
   Disturb does not hold back. The unanswered offer that the status bar
   shows follows each of these. Unit test.
6. Nothing is written into the workspace by the offer, the install, or the
   removal. Unit test; the smoke's fixture turns the offer off and still
   finds nothing installed after the session.
7. Launch configuration: see
   [agent launch context](agent-launch-context.md#acceptance-criteria).
8. Recorded once per release of the skill text, not automated. The skill is
   available to Claude Code and no request mentions it or BaseHalf:
   - a task in a folder that has `.bh/` makes Claude Code load the skill;
   - so does a task on a note that has an `upstream` list;
   - a task in a folder with neither sign does not, and the agent looks
     nowhere outside that folder.
9. Recorded once, not automated: Claude Code and Codex each load a skill
   whose folder is a link, from the place they read skills from (see
   [recorded trials](#recorded-trials)).
10. Checked in the real window, not automated, because the smoke's driver
    shows no notification over the window: the offer is still there 30
    seconds after it appeared, with the window in front.

## Recorded trials

The trials below are of version 1 of the skill text, which told agents to
move files through `basehalf.workspace.move`. Version 2 says that ordinary
tools are fine, because BaseHalf follows a moved item by itself
([following moved items](following-moved-items.md)). Its trial is criterion
26 of that specification and is recorded there.

**Version 1, 2026-10-11, Claude Code with `claude-opus-5-5`.** Each run is
one non-interactive session in a scratch copy of a seven-file workspace: a
note with two upstream entries, a spreadsheet whose upstream list is under
`.bh/`, and two descriptions under `.bh/`. The skill is a project skill of
the scratch folder, so nothing is written to the home folder. The session may
edit files and run `mv`, `ls`, `grep`, `find`, `cat`, and `basehalf`. No
request names BaseHalf or the skill. `basehalf` is not installed in these
sessions, as in any terminal outside Agent Area.

| Folder and request | What the agent did |
| --- | --- |
| Has `.bh/`. "Rename sources/interview.txt to sources/interview-april.txt." | Loaded the skill as its first step. Tried the move operation, found no `basehalf`, renamed the file itself, and updated both lists that named it: the note's and the spreadsheet's under `.bh/`. Told the user that the description stayed at the old path and how to restore it. |
| The same, without the skill. | Listed and read all of `.bh/`, renamed the file, updated both lists, and also moved the description's folder and rewrote the path stored in it by hand. |
| No `.bh/`, a note with an `upstream` list. The same request. | Listed the folder, then loaded the skill. Renamed with `mv`, updated the note's list, and created no `.bh/`. |
| Has `.bh/`; started in `notes/` and may not read above it. "Rename research.md to survey.md." | Loaded the skill, renamed, updated the note's list in `notes/`, and told the user that it could not search the rest of the workspace and that the description stayed behind. |
| The same, allowed to read the workspace folder. | Loaded the skill as its first step, found `.bh/` above, used paths relative to the workspace folder, updated the list, and reported the description left behind. |
| Has `.bh/`. "Make notes/plan.md more concrete: fill in the two bullets with specifics." | Loaded the skill as its first step, read both upstream files and both descriptions, used them, and left the frontmatter unchanged. |
| A three-file JavaScript project, no `.bh/`, no notes. "Rename src/util.js to src/helpers.js and fix the import." | Listed the folder once, did not load the skill, and looked nowhere else. |

**Version 1, 2026-10-11, Codex CLI 0.162.0.** The same workspace and the
rename request, with BaseHalf not running, in Codex's `workspace-write`
sandbox. One run has the skill in the workspace's own `.agents/skills/`. The
other has it in `.agents/skills/` of a stand-in home folder, which is the
location BaseHalf installs to.

| Where the skill is | What the agent did |
| --- | --- |
| In the workspace | Listed the folder with hidden entries, read the skill, and said the folder is a BaseHalf workspace. Tried the move operation, found no `basehalf`, renamed the file, updated both lists that named it, and told the user that the description stayed at the old path. |
| In the home folder's shared location | The same, reading the skill from the home folder. |

What the trials show, and what they do not:

- Codex reads the skill from the shared location in the home folder and
  recognizes the workspace by `.bh/` while BaseHalf is closed. The Codex
  desktop application was not tried.

- Claude Code loaded the skill unprompted in the 5 runs where a sign was
  present and not in the unrelated project. One run each is a small sample.
- An earlier wording of the description said to look for `.bh/` in the
  folders above as well. With it, the run in the folder without `.bh/` began
  by probing the folders above, which Claude Code refused. That is why the
  description asks about the working folder only.
- Outside Agent Area a rename still leaves the card's description at the old
  path, with either agent, because the move operation is out of reach there
  ([reference graph](reference-graph.md#agent-moves)). The skill keeps the
  upstream lists right and has the agent say so. It does not remove the loss.
- The run without the skill reached the same files by listing a workspace of
  seven files in full, and repaired `.bh/` by hand from what it guessed of
  the format. The trial does not show what either does in a large workspace.
