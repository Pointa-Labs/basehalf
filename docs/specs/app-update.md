# App update

Status: Active (2026-10-12). Implemented. Installed copies up to 0.5.0 still
do what [the first version](#the-first-version) describes.
Decision: [D47](../decisions.md#d47--an-update-is-downloaded-once-and-is-there-at-the-next-start-new-2026-10-12)
Related: [verification and delivery](../harness/verification-and-delivery.md),
[architecture invariants](../harness/architecture-invariants.md)

## The rule

**An update is downloaded once. Once it is ready, the next start of BaseHalf
is the new version, however the running one ended.**

BaseHalf shows its own version wherever it shows a version.

Everything below follows from these sentences or says how one part of them
is carried out.

## Problem

BaseHalf on macOS is distributed without a platform signing identity. The
updater that the VS Code base uses on macOS is Electron's, and Electron's
needs a signed application. So BaseHalf has an update service of its own. It
keeps the state machine and the interface of the base, and replaces how an
update is fetched, checked, and installed.

On 2026-10-12, version 0.5.0 was published and the maintainer updated an
installed 0.4.1. The log of the application shows what happened:

| Time | What happened |
| --- | --- |
| 00:06:49 | 0.4.1 is started. |
| 00:07:19 | It finds 0.5.0 and starts to download 460 MB in the background. |
| 00:07:22 | The application is quit. The download is thrown away. |
| 00:07:31 | 0.4.1 is started again. Nothing says that an update was on its way. |
| 00:08:02 | After its 30 seconds it checks again and downloads from the first byte. |
| 00:08:59 | The download is checked and unpacked. The title bar shows "Update". |
| 00:09:17 | The maintainer chooses it. The application restarts. |
| 00:09:20 | 0.5.0 runs. Nothing says so. |

The replacement worked. What the maintainer saw was an application that was
restarted and was still the old one, then one that had been updated and
looked the same.

### The first version

- **A download belongs to one run.** The archive is written below the
  temporary folder, in a folder named after the process. When the process
  ends, the next one deletes that folder and starts again. With 460 MB that is
  a minute on a fast line and much more on a slow one.
- **The unpacked application belongs to one run too.** It is placed beside
  the installed one under a name that holds the process number, and only that
  process knows about it. It is swapped in when the application quits in an
  orderly way. After a forced quit or a crash, the next start deletes it and
  downloads again.
- **A start knows nothing of what the run before it did.** It begins idle and
  checks after 30 seconds.
- **The version that is shown is the version of the VS Code base.** The About
  dialog, the update tooltip, and the bundle's own version in Finder all say
  1.128.0, before the update and after it. BaseHalf's version appears only on
  the Release Notes page.
- **The Release Notes page can be skipped for good.** It opens once after the
  version changed, in the window that had focus last. The version is stored
  before that is checked, so a start without such a window never shows it.
- **The Release Notes page is blank.** Found on 2026-10-12, after the rest of
  this specification was implemented: up to 0.5.0 the page opens, the title
  bar names it, and the main surface shows nothing, also when the page is
  opened by its command. The page is put over the editor area by an element
  that clips it to that area. An element that clips is a layer of its own,
  and it had no level, while BaseHalf gives the editor area one so that the
  canvas can be above or below it. The page was behind the editor area. The
  smoke asked whether the page was there and not whether it could be seen.
  The clipping element takes the level now. The page itself is gone since
  [D48](../decisions.md#d48--release-notes-are-written-once-on-the-releases-page-new-2026-10-12).
- **Installed applications refuse an archive above 500 MiB.** The limit is
  built into every release so far. The archive of 0.5.0 is 438 MiB.
- **Nothing tests an update.** The unit tests cover versions, the manifest,
  and signatures. The smoke runs with updates switched off. 0.5.0 was
  published without one update of an installed application having been tried.

## What other implementations do

Read on 2026-10-12, in source and in documentation.

- **The updater of the base on macOS** hands the download and the
  installation to Electron's updater. According to its documentation, a
  download that was interrupted continues where it stopped, an update is
  installed when the application terminates, and "a successfully downloaded
  update will always be applied the next time the application starts". It
  requires a signed application.
- **The updater of the base on Windows** is the base's own code. It keeps the
  downloaded package in a folder that outlives the run, under a name that
  holds the version, writes it under a temporary name until it is checked,
  uses a package that is already there, and removes the packages of other
  versions. A separate program applies the update.
- **An open-source desktop application that is distributed without platform
  signing** uses the updater of its application framework. Updates are signed
  with a key of the project, and the feed is a small file beside the release.
  That is what BaseHalf took over in its first version. Its updater replaces
  the installed application as soon as the download is checked, while the
  application runs. That works there because the running program reads
  nothing more from its folder. BaseHalf reads from its bundle for as long as
  it runs, so it cannot replace the bundle under itself.
- **The common update framework for native macOS applications** signs
  updates with a key of the project too, and treats platform signing as
  recommended, not required. It is a native framework, and applications on
  Electron rarely embed it.

For an Electron application without platform signing there is no ready-made
updater. BaseHalf keeps its own and takes these two things from the others:
what was downloaded is kept by version, and a ready update takes effect at
the next start.

## Goals

- A download that was interrupted continues, and one that is complete is
  never fetched again.
- An update that is ready survives the run that prepared it.
- A start that finds a ready update runs the new version.
- BaseHalf's own version is what the user reads.
- An update of an installed application is tried before a release is
  published.

## Non-goals

- **Another interface.** The update interface stays the one of the VS Code
  base: the entry in the title bar, its tooltip, the Manage menu, the
  application menu, and the commands. No dialog is added. A download that
  BaseHalf started by itself stays as quiet as the base makes it.
- **Asking before a download.** BaseHalf downloads an update by itself, as
  the base does, unless the connection is metered.
- **Platform signing and notarization.** They would make Electron's updater
  usable and are not part of this work.
- **Smaller updates.** Every update is the whole archive.
- **A second download address.**
- **Other platforms.** BaseHalf is released for macOS on Apple silicon.

## Terms

- **Bundle**: the installed application, `BaseHalf.app`.
- **Archive**: the signed zip of a release.
- **Staged copy**: the unpacked application of a newer version, complete and
  placed beside the bundle, waiting to take its place.
- **Update store**: the folder in which BaseHalf keeps an archive while it
  downloads and unpacks it. It is below the user data folder and outlives a
  run.
- **Swap**: the bundle is renamed aside and the staged copy is renamed to the
  bundle's name. Both renames are in one folder.

## Required behavior

### What is kept, and under which name

- The archive of version *V* is written to the update store as
  `BaseHalf-V.zip.part`. When its length and its signature are right, it is
  renamed to `BaseHalf-V.zip`. A file with the final name is a checked
  archive.
- The staged copy of version *V* is `.bh-staged-V.app` beside the bundle. It
  is built under another name, which holds the process number, and renamed
  when it is complete. A folder with the final name is a complete staged
  copy.
- No name holds anything that belongs to one run, except the name under which
  a staged copy is built and the name the old bundle is renamed to.

### Downloading

- **A checked archive is not downloaded again.** When `BaseHalf-V.zip` is
  there with the length the manifest says, BaseHalf checks its signature
  again and unpacks it. The update store is a folder like any other of the
  user, and what is unpacked from it becomes the application. One of another
  length, or one that is not what it was when it was checked, is removed and
  downloaded.
- **An interrupted download continues.** When `BaseHalf-V.zip.part` is there
  and shorter than the manifest says, BaseHalf asks for the bytes after it.
  When the server answers with the whole file instead, BaseHalf starts the
  file again. When the server says that it has no bytes after it, the partial
  file is deleted, and the next check starts with nothing.
- **An answer that says it is something else is refused**, and the partial
  file is left as it is: a whole file of another length, or a part that
  starts elsewhere or belongs to a file of another length. Some networks put
  a page of their own in place of a file, with a success status.
- **A wrong archive is deleted.** One that is longer than the manifest says,
  or whose signature is wrong, is deleted, and the update fails as before.
  The next check starts with nothing.
- The length and the signature are checked as in the first version, on the
  whole file, before anything is unpacked.
- **An archive that was signed and holds something else stays.** When it does
  not hold exactly one application of the manifest's version, the update
  fails, and the archive is kept: a download would bring the same bytes. The
  next check fails without the network. A release with such an archive is a
  mistake of the release, which the [check before a release](#before-a-release)
  finds.
- **Whether BaseHalf may write beside its bundle is asked before the
  download**, not after it, and before a staged copy that is there is called
  ready. A user who may not write there cannot swap, and is not shown an
  update that a restart would not bring.

### Staging

- **A complete staged copy is used.** When `.bh-staged-V.app` is there for the
  version the feed offers, BaseHalf is ready at once.
- A staged copy is trusted like the bundle itself: both are in the folder the
  application is installed in.
- Two runs that stage the same version do not disturb each other. Each builds
  under its own name, and the one that finishes second finds the final name
  taken and removes its own.
- When the staged copy is complete, the archive is removed.

### At a start

Before the application is created, once BaseHalf knows that it is the only
run with its data folder:

1. BaseHalf looks beside the bundle for complete staged copies.
2. **A staged copy of a newer version takes the bundle's place now**, and
   BaseHalf starts again as that version. This happens when the run before
   ended without the swap: it was killed, it crashed, or the swap failed.
   - The version is read from the staged copy itself and has to be the one in
     its name.
   - Not while another BaseHalf runs from the same bundle. That one still
     reads from it. BaseHalf's own processes are not another one, and
     neither are helper processes that a killed run has not ended yet: they
     load nothing more from the bundle.
   - Only where updates are switched on, and where this user may write
     beside the bundle.
   - Not in a start that something waits for: a command line that waits
     until its files are closed, and a start for developing or testing an
     extension. It would take the end of this process for the end of the
     run.
   - The list of processes is asked for with a limit of a few seconds. What
     cannot be told in that time is taken as another BaseHalf.
   - When the swap fails, BaseHalf starts as it is, and the staged copy
     stays.
   - What this start was asked to open, by the command line or by Finder,
     is opened by the start that follows the swap.

When the update service has started:

- **A staged copy of a newer version that is still there makes BaseHalf
  ready at once.** The title bar shows "Update" without a check and without
  a download.
- A staged copy of the running version or of an older one is
  [removed](#what-is-removed).

### At a quit

- A ready update is swapped in when the application quits, as in the first
  version: by "Restart to Update", by a restart for another reason, and by a
  plain quit.
- A swap that fails is logged, and the bundle is left as it was. The staged
  copy stays, so the next start tries.
- When the staged copy is gone, because another run from the same bundle
  swapped it in, nothing is done.
- "Restart to Update" starts BaseHalf again also when nothing was swapped.
  The user asked for a restart, and the next start tries the swap.

### What is removed

- Archives and partial archives of the running version and of older ones.
- Staged copies of the running version and of older ones.
- What a run that has ended left under a name with its process number: a
  staged copy that was being built, the bundle it renamed aside, and what the
  first version wrote below the temporary folder.
- Nothing of a run that is still alive.
- A bundle that was renamed aside stays while another BaseHalf runs from the
  same place. That one may be the run that still executes from it.

### The version that is shown

BaseHalf's version is `basehalfVersion` of the product configuration. The
version of the VS Code base stays what extensions are checked against, and is
not changed.

- **About**: "Version" is BaseHalf's version. The version of the base is on a
  line of its own.
- **The update tooltip**: "Current Version" is BaseHalf's version. "Latest
  Version" is the version of the update, shown once, and "Released" is the
  date of the update or nothing: not the date of the running version.
- **The bundle**: its short version string, which Finder shows, is BaseHalf's
  version.

### After an update

Decision: [D48](../decisions.md#d48--release-notes-are-written-once-on-the-releases-page-new-2026-10-12).

- **Nothing opens after an update.** The first start of a new version shows
  what every start shows. No page, no card, and no notice tells that the
  version changed.
- **Release notes are written once, on the releases page**, with the release
  they belong to. BaseHalf holds no text of its own about what changed.
- **"Release Notes" in the application opens that page in the browser.** The
  command in the Help menu opens the notes of the running version, and the
  button in the update tooltip those of the version that is offered. The
  address is the releases page of the product configuration
  (`basehalfReleasesUrl`) followed by `/tag/v` and the version. It opens
  without a question: the pages of the project are among the addresses the
  product configuration trusts.
- The base's own ways to show something after an update are off: its page of
  release notes, its card in the title bar, and the two settings that choose
  between them. Both would show what the publisher of the base wrote about
  the base.
- **A page that the main surface shows in a webview is shown**: on top of the
  editor area and of the canvas, not behind them. Up to 0.5.0 it was behind
  the editor area ([the first version](#the-first-version)).

### Before a release

- The archive is not larger than what installed applications accept. The
  release script refuses a larger one. Its limit is that of the applications
  that are installed, not of the tree that is released.
- The update of an installed application is tried
  ([verification](#verification)).

## Limits

- **The next update still runs the first version.** The service that fetches
  an update is the one in the installed application. Installed copies of
  0.4.1 and 0.5.0 behave as described under
  [the first version](#the-first-version) until they have been updated once.
- **500 MiB.** Installed copies up to 0.5.0 refuse a larger archive, and can
  then not be updated by themselves. A later version can accept more, and
  only the versions after it benefit.
- **A background download is quiet.** As in the base, a download that
  BaseHalf started by itself shows a progress badge on the Manage entry and
  no text. The title bar shows it when the user asked for the check.
- **The whole archive is read into memory** to check its signature. The
  signature is over the bytes of the archive, and installed copies check it
  that way.
- **A folder that BaseHalf cannot write to.** When BaseHalf may not write
  beside its bundle, it cannot stage, and reports the error as before.
- **Two runs from one bundle.** When one of them swaps at its quit, the other
  one keeps running on a bundle that was renamed aside, as in the first
  version. That bundle is removed by a start at which no other BaseHalf runs
  from the place.
- **Two copies of BaseHalf in one folder** share what is staged there. The
  name of a staged copy holds the version and not the copy it is for.
- **A link that started BaseHalf** is not opened when that start swaps a
  staged copy in. Files and folders are.
- **The temporary copy that macOS makes of a downloaded application.** An
  application that runs from it is not updated, as before. It says so when
  the user checks.

## Acceptance criteria

Unit tests unless another kind is named.

1. **Kept by version.** An archive is written under the partial name and has
   the final name only when its length and signature are right. A staged copy
   has its final name only when it is complete.
2. **Not again.** With a checked archive in the update store, nothing is
   requested from the network, its signature is checked again, and the update
   becomes ready. With something else under its name and of its length, the
   archive is requested.
3. **Continues.** With a partial archive of 40% in the update store, the
   request asks for the bytes after it, and the result is the whole archive.
   When the server sends the whole file, the result is the whole archive
   too. An answer that says it is something else leaves the partial archive
   as it is.
4. **Wrong archive.** An archive with a wrong signature is deleted, nothing is
   staged, and the next check requests the whole archive. One that was signed
   and holds another version stays and is not requested again. A partial
   archive after which the server has no bytes is deleted. When BaseHalf may
   not write beside its bundle, nothing is requested.
5. **Used when there.** With a complete staged copy of the offered version
   beside the bundle, the service is ready without a request for the archive.
6. **Which staged copy.** Of the staged copies beside a bundle, the one with
   the highest version above the running one is chosen. One whose own version
   differs from its name is not. One of the running version or below is
   removed.
7. **Not under a running one.** With another BaseHalf running from the same
   bundle, a start does not swap. BaseHalf's own processes, and the helper
   processes a killed run left, are not another one. The swap puts the bundle
   back when it cannot finish.
8. **What is removed.** Archives, partial archives, and staged copies of the
   running version and below are removed, and what a dead run left under its
   process number. What a living run owns stays, and a bundle that was renamed
   aside stays beside another run.
9. **The version.** About, the update tooltip, and the bundle's short version
   string show BaseHalf's version.
10. **Release notes.** The address for a version is the releases page of the
    product configuration, `/tag/v`, and the version, and "Release Notes"
    opens it outside the application. Nothing is registered that opens a
    page at a start. An overlay that clips takes the level that puts it above
    what it is placed over.
11. **The size.** The release script refuses an archive above the limit that
    installed applications accept.
12. **An installed application is updated.** Recorded for each release, with
    the real application and not automated in CI: a packaged application that
    reports an older version, given a feed that offers the packaged one,
    - becomes ready, is quit, and is the new version at the next start;
    - is killed while it downloads, is started again, and continues instead
      of starting over;
    - is killed when it is ready, and is the new version at the next start;
    - is killed when it is ready and started while another BaseHalf runs from
      the same bundle: it is ready at once, without a request, and is the new
      version after its quit.

    And the application of the release before, with the update service it
    was released with, becomes ready, is quit, and is the new version at the
    next start, which removes what that service left.

## Verification

- Unit tests of the update store and of the choice among staged copies, on a
  temporary folder, with the network replaced by a function.
- `npm run basehalf:update-e2e -- --app <BaseHalf.app> --from <the release
  before>` for criterion 12. It copies the packaged application, makes the
  copy report an older version, signs the archive of the packaged
  application for a local feed with the release key, serves the archive from
  this machine, slowly enough to interrupt it, and drives the four cases.
  Then it does the same with a copy of the release before, which is what its
  users will go through. It needs the release key, so it runs on the release
  machine. For it, a feed that is a local file may name an archive at an
  address on this machine. No other feed may.
- The smoke stays as it is and keeps updates switched off.

## Open questions

1. **The size of the archive.** 0.5.0 is 438 MiB of the 500 that installed
   copies accept. What may leave the package is a question of its own.
2. **A second download address** for users who cannot reach the first.
