# Verification and delivery

This harness document follows the owning specification's acceptance criteria.
Choose checks by the affected boundary, record anything that remains manual,
and do not describe a change as complete when a required check has not run or is
failing.

## Scoped verification

For documentation-only changes:

```bash
git diff --check
cmp -s AGENTS.md CLAUDE.md
```

Also verify that new relative Markdown links resolve and that instructions do
not conflict with their owning specification or decision.

For client changes:

```bash
npm run typecheck-client
```

Run the narrowest relevant Node, browser, or Electron tests for the affected
service. Do not substitute an unrelated passing suite for the specified
behavior.

For BaseHalf UI, workbench, canvas, or routing changes:

```bash
npm run basehalf:smoke
```

When `out/` is already current, `npm run basehalf:smoke-no-compile` may be used
for iteration. The compile-backed smoke remains the delivery check. Use
disposable fixture workspaces; never point a setup or smoke flow at the
repository root as a product workspace.

The smoke is organized as VS Code's own smoke tests are
(`test/smoke/src/areas/`). Its steps are in suites by area under
`scripts/basehalf-smoke/`, and each suite starts a BaseHalf of its
own on a fresh fixture workspace, so that no suite depends on what another one
did. The whole smoke runs every suite, one after another. While working, run
the suites of the areas a change touches:

```bash
npm run basehalf:smoke-no-compile -- --suite canvas,cardDetail
```

The suites are `workbench` (the window at startup, the surfaces BaseHalf
hides, the Agent Area, Source Control, and Settings), `canvas`, `cardDetail`
(Card Detail and its projections, the rich editor among them), `navigation`
(Quick Open, Quick Text Search, the Explorer, back and forward, and what
happens to the files of the workspace), and `video` (generation cards of
images and videos: drafts, the panel, a generation against the local test
provider, Providers, the starter template, and Sequence). A new step goes
into the suite of its area. A suite that needs something done first
does it itself, never relying on another suite.

A step that compares the frames of a window and of a page inside it reads one
clock on both sides (`lib/framesClock.mts`). `performance.timeOrigin +
performance.now()` is not one: a document keeps the wall clock of the moment it
was made, and the system corrects its wall clock, so that two documents read
times apart by whatever it corrected between their starts.

Every suite starts BaseHalf as on a system that shows scroll bars always, as
the system does by itself while a mouse is attached, so that a run finds the
same with and without a mouse (`lib/scrollBars.mts`, D127). Before each launch
the run sets one key in the preferences of BaseHalf's application, which
BaseHalf replaces at its start; the smoke's README says how.

For changes to the rich Markdown projection (what it reads, which blocks it
edits, and what it writes back):

```bash
npm run basehalf:fidelity
```

It opens each note of `scripts/basehalf-fidelity-corpus/` in the real editor,
makes the editor write it back, and fails when a byte of a file changes. A
second pass types one letter at the place each note marks, and fails unless
the file changed by that letter and by the canonical form of the block it is
in ([formats of a note](../specs/note-formats.md)). A new corpus file needs
an entry in the script's list of texts to wait for, and its place to type.

For changes to what Rich reads, writes, offers, pastes, or copies:

```bash
npm run basehalf:test-markdown-rich-formats
```

It runs Rich's real editor in a headless browser over the formats of a
note, with paste, copy, undo, and the state of toggles. The smoke runs it
first, as it runs the test of the card's editor.
The rich editor's bundle is rebuilt by the watch when a file under
`extensions/basehalf/markdown-rich-src/` changes; after a change to a file it
imports from `src/`, run `node extensions/basehalf/esbuild.markdownRich.mts`.

The smoke currently covers canvas startup, hidden Open Editors, Quick Open,
Quick Text Search, folder routing, the reference-graph flows (connect,
disconnect, both reconnects, canvas undo after closing a note, Create from
Connection, the badge editor's Upstream and Downstream, Rebuild List on a list
BaseHalf cannot read, a note whose list BaseHalf keeps because the note cannot
hold it, PDF branch, rename refactor, and migration of
a seeded legacy pair), legacy workspace cleanup, folders whose names look like
numbers (create, move a card beside them, delete), a description file that
cannot be read recovering on the next save, cards that follow files renamed
from outside the window (one file, the folder whose canvas is open, and many
files at once), a long note at rest that a scroll moves while a scroll that
started on the canvas keeps moving the canvas, the rich reveal highlight,
the formats of a note in Rich (each written, read back after Card Detail
opens the note again, and shown on the card and in Preview), links that
open from Rich, the card, and Preview,
card resizing with its rounded corner targets and indicator, renaming a card
from its name with an editor that stays as it is while files of the folder
change, selecting cards
with a marquee, the set of several selected cards with its box (moving it,
arranging it, undo), Tidy Canvas with its question that keeps or reverts,
the sidebar showing exactly Files, Git, and Search with no plugin command,
the button of the sidebar at the left end of the title bar and none in Card
Detail, More and the Agent Area's button at its right end with what the More
menu holds, and the generation card flows against the local test provider. Extend its
acceptance coverage when a changed workbench flow is not represented there.

The whole unit suite is:

```bash
./scripts/test.sh
```

Package a macOS arm64 release build when release/package behavior is in scope:

```bash
build/basehalf/package-darwin.sh arm64
```

The script refuses a package that holds more than BaseHalf runs
([what the package holds](../specs/what-the-package-holds.md)). The same check runs
by itself with `npm run basehalf:package:layout-check -- --app <BaseHalf.app>`. A
development host checks no signature of an extension, so that only a package shows
whether the agent extensions install:

```bash
npm run basehalf:package:agent-install -- --app VSCode-darwin-arm64/BaseHalf.app
```

It needs the network and opens a window on a new profile. It is not part of CI.

Before a release is published, an installed application is updated to it for
real, as the [app update](../specs/app-update.md#verification) specification
requires. The packaging script refuses an archive that installed applications
would not accept. Then:

```bash
npm run basehalf:update-e2e -- --app VSCode-darwin-arm64/BaseHalf.app \
  --archive basehalf-dist/BaseHalf-<version>-darwin-arm64.zip \
  --from basehalf-dist/BaseHalf-<version before>-darwin-arm64.zip
```

`--from` is the release that users have installed: it is updated by the update
service it was released with. The run needs the release key, opens BaseHalf
windows, and takes several minutes. It is not part of CI.

Package-specific work should run that package's lint, typecheck, and test
scripts in addition to any cross-package acceptance checks defined by the
owning specification.

## GitHub CI

GitHub's CI (`.github/workflows/ci.yml`) runs on every push to `main` and on
every pull request, from a fresh checkout. Its jobs:

- `product`, on a hosted runner: `npm ci`, then what a developer runs before a push:

  ```bash
  npm run typecheck-client
  NODE_OPTIONS=--max-old-space-size=8192 npm run valid-layers-check
  npm run transpile-client
  npm run test-node
  ```

  The layers check needs more than Node's default heap.
- `install`, on Node 22.12 and 24: the package of the install command, as
  [its specification](../specs/install-command.md#verification) runs it.
- `action-pins`: every action of every workflow is pinned to a full commit
  (`node scripts/basehalf-workflow-action-pins.mts`, which needs Node 24).
- `ci-summary`, the one check that branch protection requires, fails when any
  job did not pass.

The Electron unit tests (`./scripts/test.sh`), eslint, and the smoke are not
in CI. They run on the developer's machine before a push, as the [maintainer path](#maintainer-path)
says. A change to `.github/workflows/` or to `packages/install/` runs that
job's commands before the push.

`license-check.yml` checks the licenses of the production dependencies of
the product, from `package.json` at the root, and of `packages/install/`,
which has none. Two of the product's are outside its allowlist and are
excepted by name and version, jschardet (LGPL-2.1+) and the codicons
(CC-BY-4.0), as the [dependency policy](../dependency-policy.md#reviewed-exceptions)
records (D160). To run the product's check by hand, at the root:

```bash
npx --yes license-checker@25.0.1 --production --excludePrivatePackages \
  --excludePackages "jschardet@3.1.4;@vscode/codicons@0.0.46-21" \
  --onlyAllow "MIT;ISC;Apache-2.0;BSD-2-Clause;BSD-3-Clause;0BSD;CC0-1.0;Unlicense;BlueOak-1.0.0;Python-2.0" --summary
```

A test reads only the files of a fresh checkout and the files it writes
itself. From 2026-08-24 to 2026-10-24 every CI run failed on tests that read
built files which only a developer's checkout had.

## The commit hook

Git runs VS Code's hygiene check before each commit (`npm run precommit`, which is `build/hygiene.ts`), on the
files of the commit as they are staged. A finding stops the commit. It checks:

- the copyright header: Pointa Labs' in BaseHalf's own folders, VS Code's everywhere else, as
  [code organization](code-organization.md#one-root-a-folder-per-feature) has it;
- indentation by tabs, and the format of VS Code's formatter for TypeScript;
- characters outside ASCII. Chinese text and a few marks are allowed. Another character in a string is written as
  an escape when it cannot be told from an ASCII one or cannot be seen (a no-break space, a minus sign), and
  otherwise has `// allow-any-unicode-next-line` on the line before. A file whose comments need such characters
  says `allow-any-unicode-comment-file` once;
- eslint, where a warning counts as an error;
- the names of CSS variables: a `var(--name)` must name a variable in
  `build/lib/stylelint/vscode-known-variables.json`, whose colors and sizes VS Code's release test writes
  (`./scripts/test.sh --runGlob "**/colorRegistry.releaseTest.js"`), or one in
  `build/lib/stylelint/basehalf-known-variables.json`, where a variable that a stylesheet of BaseHalf's declares
  itself is added by hand;
- that no JavaScript file is new, and that `product.json` does not name Microsoft's Marketplace.

Bundles of other projects' code, films, and license texts are left out in `build/filters.ts`. To run the check by
hand on some files, name them: `node --experimental-strip-types build/hygiene.ts <files>`. Never pass
`--no-verify`: a finding is fixed, or the rule that does not fit BaseHalf is changed in the open, with its reason
(D159).

## Before commit

- Review the diff for accidental generated files, workspace initialization,
  secret material, unrelated user changes, and stale documentation.
- Confirm each acceptance criterion is verified or explicitly reported as not
  run, with the reason.
- Keep the specification in the same commit as, or earlier than, the behavior
  it governs.
- Make one coherent commit per completed scope. Do not mix unrelated work merely
  to obtain a clean tree.

## Maintainer path

Maintainers and agents working for them develop on `main` and use direct pushes,
not pull requests. Before a push, lint, typecheck, and the full test
suite must be green. Substantive changes also receive an in-session adversarial
review because there is no PR-time review gate on this path.

`.github/workflows/maintainer-fastlane.yml` satisfies the `CLAAssistant` check
for allowlisted direct pushes. CI still runs on `main`, but it cannot block a
change that has already landed, so the quality gate belongs before the push.
After a push, read CI's result for the pushed commit
(`gh run list --commit <sha>`). CI is the only check of a fresh checkout, and
on this path nobody else sees its result. A red run is fixed before other work.

Committing locally does not imply permission to push. Push only when the user or
maintainer has requested it.

## External contributor path

External contributors use a branch and pull request, complete the CLA, wait for
required checks, and merge through the normal review path. See
[CONTRIBUTING.md](../../CONTRIBUTING.md).
