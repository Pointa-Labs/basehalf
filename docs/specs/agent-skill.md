# BaseHalf agent skill

Status: Active (2026-10-11)
Decision: [D43](../decisions.md#d43--agents-learn-a-basehalf-workspace-from-a-skill-the-user-installs-new-2026-10-11)
Related: [agent launch context](agent-launch-context.md),
[reference graph](reference-graph.md),
[workspace state and legacy cleanup](workspace-state-and-legacy-cleanup.md)

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
text is part of the application bundle, so no local process can change it.

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
  builds on, and what uses it.
- `metadata.version`: a string that changes whenever the text changes.

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
3. **The sections of the launch instruction**, word for word: where BaseHalf
   keeps its metadata, relationships, preserving relationships, and canvas
   workflows ([content contract](agent-launch-context.md#content-contract)).
   They are written once in the source and used by both texts.

The body describes where things are and what they mean. Following D36, it
does not tell an agent what to read or in what order. It stays under 500
lines.

## The sign of a workspace

The skill recognizes a BaseHalf workspace by its `.bh/` directory and by
nothing else that BaseHalf writes.

- `.bh/` appears when the user first arranges a card, describes one, or
  connects into a file that keeps its list there. A folder that was only
  opened has none, and has nothing of BaseHalf's for an agent to keep intact.
- There is no file that says BaseHalf is running. What the skill asks of an
  agent holds while BaseHalf is closed too: a file moved then still has a
  badge to carry along. The one thing that needs the running application, the
  `basehalf` command, reports by itself when it cannot be reached, and the
  skill says what to do then.
- BaseHalf therefore writes no marker file, and opening a folder still writes
  nothing ([workspace state](workspace-state-and-legacy-cleanup.md)).
- The description asks about the working folder only. Every agent session on
  the machine reads the description, also in folders that have nothing to do
  with BaseHalf. An agent may not read above its working folder without
  asking the user, so a description that says to look there makes agents ask
  in every such folder. The body, which an agent reads only once the skill
  applies, says that the workspace folder can be above the working directory.

## Where it is installed

| For | File |
| --- | --- |
| Claude Code | `<home>/.claude/skills/basehalf/SKILL.md` |
| Codex, and other agents that read the shared location | `<home>/.agents/skills/basehalf/SKILL.md` |

`<home>` is the user's home folder on this machine. Installing writes both
files. Nothing is written into a workspace.

Each location is in one of three states:

- **missing**: the file does not exist;
- **current**: its bytes equal the bundled text;
- **outdated**: anything else, including a file the user edited.

## Offer

BaseHalf offers the skill once per window, after the workbench has restored,
when all of these hold:

- a workspace folder is open;
- the window is local and runs on the desktop (not a remote connection, not
  the web);
- no workspace folder is marked with `.basehalf-no-workspace-setup`;
- the setting `basehalf.agents.offerSkill` is `true` (the default; a
  workspace can turn it off for itself);
- at least one location is not current;
- the user has not chosen **Don't Ask Again** for this version of the skill.

The offer is one information notification:

> Install the BaseHalf skill for your agents? It tells Claude Code and Codex
> where a card's description and connections are. It is added to your agents'
> own settings on this computer, not to this folder.
>
> Install · Not Now · Don't Ask Again

When no location is missing and at least one is outdated, the first sentence
reads "A newer BaseHalf skill is available for your agents." and the first
button reads **Update**.

- **Install** or **Update** installs the skill.
- **Not Now**, or closing the notification, asks again in the next window.
- **Don't Ask Again** stores the declined version in application storage. A
  later version of the skill is offered again.

The notification follows the wording rules of D41: it names no path, no file
format, and no hidden folder.

## Commands

- **BaseHalf: Install Agent Skill** installs the skill whatever the setting
  and the stored answer are.
- **BaseHalf: Remove Agent Skill** deletes both `SKILL.md` files and each
  `basehalf` folder that is then empty.

## Installing and removing

- Each location is written on its own: missing folders are created and the
  file replaces any earlier one.
- A location that cannot be written does not stop the other. BaseHalf then
  says "The BaseHalf skill could not be installed for <agent>: <plain failure
  reason>", with the reason from
  [mirror file resilience](mirror-file-resilience.md#failure-reasons-in-messages).
- When both are written it says "The BaseHalf skill is installed for Claude
  Code and Codex. Agent sessions you start from now on can use it."
- Removing a skill that is not installed says "The BaseHalf skill is not
  installed." Otherwise it says "The BaseHalf skill was removed."

## Agent Area sessions

A Claude Code session that Agent Area starts still receives launch context.
When the skill is installed for Claude Code, in any state other than missing,
that context is the short pointer to the skill instead of the full
instruction. See [agent launch context](agent-launch-context.md#mechanism).

## Source-tree guard

A marked workspace gets no offer, as it gets no launch context. The commands
still work there, because they write only to the user's home folder.

## Acceptance criteria

1. The skill text starts with `---`, has `name: basehalf`, a `description` of
   at most 1,024 characters, and a `metadata.version`. The description starts
   with the `.bh/` sign, asks about the working folder and not the folders
   above, and mentions `upstream`. The body starts with how to tell a
   BaseHalf workspace. Its body names `.bh/mirror/<path>/badge.yaml`,
   `.bh/mirror/<path>/upstream.yaml`, and the `upstream` frontmatter key,
   says that files can be moved with ordinary tools, contains every line of
   the launch instruction's shared sections, and has fewer than 500 lines.
   Unit test.
2. Installing writes both files with exactly the bundled bytes and creates
   missing folders. The states are missing before, current after, and
   outdated after the file is changed. Removing deletes both files and the
   empty folders. A location that cannot be written is reported and does not
   stop the other. Unit test on an in-memory file system.
3. The offer appears once when a location is missing, says Update when one is
   outdated and none is missing, and does not appear when both are current,
   when the setting is off, in a marked workspace, without a workspace folder,
   or after Don't Ask Again for this version. A newer version is offered
   again. Unit test.
4. Nothing is written into the workspace by the offer, the install, or the
   removal. Unit test; the smoke's fixture turns the offer off and still
   finds nothing installed after the session.
5. Launch configuration: see
   [agent launch context](agent-launch-context.md#acceptance-criteria).
6. Recorded once per release of the skill text, not automated. The skill is
   available to Claude Code and no request mentions it or BaseHalf:
   - a task in a folder that has `.bh/` makes Claude Code load the skill;
   - so does a task on a note that has an `upstream` list;
   - a task in a folder with neither sign does not, and the agent looks
     nowhere outside that folder.

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
