# The install command

Status: Active (2026-11-26)
Decisions: [D156](../decisions.md#d156--one-command-installs-basehalf-opens-the-folder-and-installs-the-skill-new-2026-11-26),
[D43](../decisions.md#d43--agents-learn-a-basehalf-workspace-from-a-skill-the-user-installs-new-2026-10-11),
[D83](../decisions.md#d83--the-agent-skill-is-a-link-to-basehalfs-own-copy-which-follows-each-release-and-its-offer-stays-until-it-is-answered-new-2026-10-26)
Related: [agent skill](agent-skill.md#commands) for the option of the
application that installs the skill, [app update](app-update.md) for the feed
and the signatures, [verification and delivery](../harness/verification-and-delivery.md)

## Problem

Installing BaseHalf takes four steps by hand: download a disk image, drag the
application into place, run a command in a terminal so that the system opens
an application that is not notarized, and open a folder. A fifth follows in
the window: answering the offer of the agent skill.

The people BaseHalf is for first already work with an agent, in a terminal or
in an agent's own application. They have something that runs a command, and
most of them are in the folder they want to see when they hear of BaseHalf.

Read on 2026-11-26 from the counts of the releases: in the week of release
0.7.0, which was announced in four places, its disk image was downloaded 7
times, and the disk images of four releases 11 times together.

## Goals

- One command, which a person types or their agent runs, ends with the folder
  they are in shown as a canvas and the skill installed for their agents.
- It does the same each time, says what it did, and changes nothing that it
  does not name.
- It installs only what an installed BaseHalf would accept as an update.
- Installing the skill stays one implementation, the application's.

## Non-goals

- Updating a BaseHalf that is installed. [App update](app-update.md) owns it.
- Removing BaseHalf or the skill.
- Systems BaseHalf is not released for.
- Installing the skill through an installer of skills, or listing it in a
  directory. The repository publishes the skill for those
  ([agent skill](agent-skill.md#the-published-copy), D157). What such an
  installer writes is a copy that no release reaches; the command has
  BaseHalf install the skill, which makes the entries links to its own copy
  and takes such a copy's place
  ([agent skill](agent-skill.md#installing-and-removing)).
- Replacing the disk image. It stays the way for someone without a terminal.
- Counting runs. The command sends nothing but its two requests for files.

## The command

```bash
npx basehalf [folder] [--no-skill]
```

- `folder` is the folder to open. Without it, the folder the command runs in.
- `--no-skill` leaves the skill as it is.
- `--help` prints the usage, and `--version` the version of the package.
  Neither does anything else.
- Any other option, or a second folder, is refused with the usage, before
  anything is read or written.

The command is the package `basehalf` of the npm registry. Its source is
`packages/install/`, a project of its own beside the VS Code tree, with its
own lockfile (D158). It has no dependencies, and it runs on Node 20.3 and
later; an older Node is told so in one line.
It asks nothing while it runs: an agent that runs it is never left waiting for
an answer.

The package has a version of its own. It installs the release that the feed
names when it runs, so a release of BaseHalf needs no new package.

## What it does, in order

### 1. The folder

- A folder that was named has to exist and be a folder. Otherwise the command
  stops, before anything is downloaded.
- The user's home folder and the root of a disk are not opened: a canvas of
  everything a person has is not what they asked for, and it would be the
  first thing they see of BaseHalf. BaseHalf is then opened without a folder,
  and the command says so. The root of a disk is the root of all folders, and
  any folder that is on another disk than the folder it is in, as a disk that
  was attached is.
- When the folder the command runs in was removed meanwhile, BaseHalf is
  opened without a folder. A folder that is named beside it has to be named
  by its whole path.

### 2. The system

BaseHalf is released for one system and one kind of processor. On anything
else the command says that BaseHalf is not released for this computer, with
the address of the page that says which it runs on, changes nothing, and ends
with status 1. A Node that the system translates for another processor
on a supported computer counts as supported.

### 3. Finding BaseHalf

The command looks for `BaseHalf.app` in the applications folder of the
computer and then in the one of the user's home folder.

- An application there whose product file names BaseHalf, and which has its
  command-line launcher, is used as it is. Nothing is downloaded, and its
  version is not changed: BaseHalf updates itself.
- Something else of that name, such as a copy that is not whole, is left as
  it is. When no place holds a usable BaseHalf, the command names that path,
  asks the user to move it away, and ends with status 1.
- A BaseHalf kept anywhere else is not found. The command then installs a
  second one. This is a known limit.

### 4. Installing

Only when no BaseHalf was found.

- **Where.** The applications folder of the computer when the user may write
  there, and otherwise the one of their home folder. This is settled before
  the download, and nothing is made then: a missing folder of the home
  folder counts when it can be made, is made when the application is placed,
  and goes again when the run placed nothing in it.
- **The feed.** The command reads the manifest of the latest release from the
  address the application's own update reads. It accepts the manifest only as
  the application does: every field of the shape the application requires,
  and the signature of the manifest right under the key of the releases. A
  feed that does not answer in 60 seconds is given up.
- **No older release.** An installed BaseHalf takes no update older than
  itself. A computer without BaseHalf has no version to compare with, so the
  package holds one, the release that was the latest when the package was
  made, and refuses a manifest that names an older one.
- **The archive** is downloaded into a temporary folder of the run. A
  download that says it has another length than the manifest, that grows
  past that length, or that brings no byte for 60 seconds is given up. The
  whole file is then checked: its length, and its signature under the same
  key. Nothing is unpacked before both are right.
- **Unpacking.** The archive is unpacked into a folder of the run inside the
  applications folder, so that the last step is one rename within a folder.
  The folder has to hold exactly one application, BaseHalf of the version
  the manifest names. It is then renamed to `BaseHalf.app`. A folder of that
  kind which a run that was killed left there, and which is older than an
  hour, is removed first.
- **Something appeared meanwhile.** When `BaseHalf.app` is there at the
  rename, such as from a second run, the command removes what it unpacked
  and goes on as in step 3.
- A file that a command downloads carries no mark of a download from the
  web, so the system opens the application without the terminal step of the
  disk image.

### 5. The skill

Unless `--no-skill` was given:

- When both of the agents' entries are links to BaseHalf's own copy already,
  the command says that the skill is installed and passes nothing on.
- Otherwise it asks the launcher for its help and looks for the option
  `--install-agent-skill` there. A BaseHalf released before that option does
  not have it. The command then passes nothing on and says that BaseHalf
  asks in its window.
- Otherwise it passes `--install-agent-skill` to the launcher in step 6.

The command never writes a link or a file of the skill itself.

### 6. Opening

The command runs the launcher of the application with the folder, or without
one (step 1). A BaseHalf that is running takes the request as it takes any
other from its command line.

BaseHalf takes the environment it is started with for its own, and its
terminals inherit it. So the launcher is started without what this run added
to the environment: what `npx` sets for the program it runs (the variables
that begin with `npm_`, and the folders of packages' programs at the front
of `PATH`), and what this Node was told to load. When the launcher fails, the command says that
BaseHalf is installed and could not be opened, with the launcher's words, and
ends with status 1.

### 7. Waiting for the skill

When the option was passed, the command looks at the agents' two entries, for
at most 60 seconds. An agent has the skill while its entry is a link to
BaseHalf's own copy and that copy holds the skill. The command waits until
both have it, or until BaseHalf gave it to one and two more seconds brought
no second: BaseHalf makes the links one after the other, and one of them can
be refused by something of the user's own in its place. An entry that was a
link before BaseHalf was asked is not its answer, and starts no such wait. It then says for which agents
the skill is installed. When the time passes with none, it says that BaseHalf
has not confirmed the skill and that the window says why. The status is 0
either way: BaseHalf is installed and open.

## What it prints

One line for each thing it did, on standard output, in this order: the
download, with the version and the size, when there is one; BaseHalf found or
installed, with its version and its place; what was opened; the skill. While
it downloads, a terminal shows the progress as a percentage on one line of
standard error, which is cleared before the next line. Without a terminal,
such as under an agent, nothing is printed between the line of the download
and the next.

A failure is one line on standard error that says what could not be done and
what the user can do, and status 1. This holds for every failure, also one
the command did not foresee: it never prints a trace. A download that cannot
be written says where it could not be written, not that the connection
failed. An interrupt prints nothing and ends with status 130; a second
interrupt while the run removes what it made does not end it early.

## What it leaves

- After a success: the application, when it installed one, and nothing else.
  The temporary folder of the download is removed.
- After a failure or an interrupt: nothing of its own. The temporary folder
  and the folder it unpacked into are removed. An application that was
  renamed into place stays: it is whole and checked.
- It writes nothing into the folder it opens. What BaseHalf writes there when
  it shows a canvas is
  [BaseHalf's own](canvas-card-placement.md#what-showing-a-canvas-writes).

## The key of the releases

The package holds the public key of the releases, as the application does.
When the key changes, a package with the new key is published before the
first release that is signed with it.

## Publishing

The owner publishes the package from `packages/install/`. It is not part of a
release of BaseHalf. Before a version is published, the package's tests pass
and the command is run once for real, as [Verification](#verification) says.

## Acceptance criteria

1. **Arguments.** No argument means the folder of the run; one path is the
   folder; `--no-skill`, `--help`, and `--version` are read anywhere on the
   line. An unknown option and a second folder are refused with the usage
   and status 1. Unit test.
2. **The folder.** A path that does not exist, and a file, stop the command
   before any request. The home folder and the root of a disk are opened as
   no folder, and the output says so. Unit test.
3. **The system.** Another system or processor ends with status 1 and
   changes nothing; a translated Node on a supported computer goes on. Unit
   test.
4. **Finding.** A usable BaseHalf in either place is used, the computer's
   first, and no request is made. A folder of that name that is not a whole
   BaseHalf stops the command with its path when no place holds a usable
   one. Unit test on folders of the test's own.
5. **The manifest.** The manifest of a real release is accepted under the
   key the package holds. A manifest with one field changed, with a field of
   a wrong shape, with an address that is not `https`, or with a length
   above the application's limit is refused. Unit test with the manifest of
   release 0.7.2 as it was served.
6. **The archive.** An archive of the right length and signature is
   accepted. One of another length, one with a changed byte, one that grows
   past its length, and one that stalls are refused, and nothing is
   unpacked. Unit test with a key of the test's own.
7. **Placing.** What is unpacked becomes `BaseHalf.app` by one rename. An
   archive that holds something else, or another version, is refused and
   leaves nothing. A `BaseHalf.app` that appeared meanwhile is used and what
   was unpacked is removed. A place that may not be written falls back to
   the home folder's. Unit test.
8. **The skill.** With both entries linked, nothing is passed on. Without
   the option in the launcher's help, nothing is passed on and the output
   says that BaseHalf asks in its window. Otherwise the option is passed,
   and the output names the agents whose entries became links, or says that
   BaseHalf has not confirmed the skill when none did in time. With one
   entry linked before, the command waits for the second and not for the
   grace of the first. `--no-skill` passes nothing and looks at nothing.
   Unit test.
9. **Leaving nothing.** After each failure of criteria 5 to 7, and after an
   interrupt during the download, the temporary folder and the folder that
   was unpacked into are gone, and so is a folder of the home folder that
   the run made for an application it did not place. Choosing the place
   makes nothing. What a killed run left for more than an hour is removed,
   and what a run of now unpacks into is not. Unit test.
10. **Words for every failure.** A temporary folder that cannot be made, a
    download that cannot be written, a launcher that cannot be started, that
    fails, or that takes too long, a feed that does not answer or that names
    an older release, and a folder of the run that is gone each end in one
    line. Unit test; the last also by hand, from a folder that was removed.
11. **The environment of the launch** holds no variable that begins with
    `npm_`, no folder of packages' programs in `PATH`, and nothing this Node
    was told to load, and keeps everything else. Unit test.
12. **For real**, recorded once for each published version of the package,
    not automated: on a computer BaseHalf is released for, with the two
    places and the home folder of the run's own, the command downloads the
    latest release, accepts it, places it, and the placed application
    prints its version. See [recorded runs](#recorded-runs).
13. **The option of the application**: see
    [agent skill](agent-skill.md#acceptance-criteria), criterion 14.

## Verification

```bash
cd packages/install
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm lint
```

The tests read only the files of the package and what they write, and make
no request to the network, so they pass in CI on a fresh checkout and on any
system. Criterion 12 is run by hand:

```bash
node packages/install/test/real-run.js
```

It downloads the latest release (about 160 MB) into a folder of its own,
places it there, asks the placed application for its version where the
command would open it, and removes the folder at its end. It opens no window
and changes nothing of the computer.

## Recorded runs

**Version 0.1.0, before it was published, 2026-11-26.** On the owner's
computer, with Node 24.17.0. The package's tests passed on Node 20.20.0,
22.12.0, and 24.17.0 (35 tests each).

| Since the start | What the run printed or did |
| --- | --- |
| 3.8 s | The manifest was read and accepted: `Downloading BaseHalf 0.7.2 (160 MB).` |
| 17.6 s | The archive was downloaded, its length and signature were right, and it was unpacked and renamed into place: `BaseHalf 0.7.2 installed in <the run's place>.` |
| 19.7 s | The placed application's launcher printed its help, which has no `--install-agent-skill` in 0.7.2, and then its version (`1.128.0`, the commit of the release, `arm64`). The run printed that BaseHalf asks in its window about the skill. |
| 19.9 s | The folder of the run was removed. |

The placed application carried no mark of a download. By hand the same day:
run from a folder that was removed, the command refused a folder named by a
part of its path in one line, with status 1; and of the folders of that
computer, the root, and each disk under the folder where disks are attached,
counted as the root of a disk, and the home folder, a project in it, and the
temporary folder did not. The option of the
application was tried the same day in a development build
([agent skill](agent-skill.md#recorded-trials)); the two were not run
together, because no release holds the option yet.
