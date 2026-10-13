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

For VS Code-base client changes:

```bash
cd vscode-base
npm run typecheck-client
```

Run the narrowest relevant Node, browser, or Electron tests for the affected
service. Do not substitute an unrelated passing suite for the specified
behavior.

For BaseHalf UI, workbench, canvas, or routing changes:

```bash
cd vscode-base
npm run basehalf:smoke
```

When `out/` is already current, `npm run basehalf:smoke-no-compile` may be used
for iteration. The compile-backed smoke remains the delivery check. Use
disposable fixture workspaces; never point a setup or smoke flow at the
repository root or `vscode-base/` as a product workspace.

For changes to the rich Markdown projection (what it reads, which blocks it
edits, and what it writes back):

```bash
cd vscode-base
npm run basehalf:fidelity
```

It opens each note of `scripts/basehalf-fidelity-corpus/` in the real editor,
makes the editor write it back, and fails when a byte of a file changes. A
new corpus file needs an entry in the script's list of texts to wait for.
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
card resizing with its rounded corner targets and indicator, renaming a card
from its name with an editor that stays as it is while files of the folder
change, selecting cards
with a marquee, the set of several selected cards with its box (moving it,
arranging it, undo), Tidy Canvas with its question that keeps or reverts,
the sidebar showing exactly Files, Git, and Search with no plugin command,
and the video node flows of the built-in AI Video. Extend its acceptance coverage when a
changed workbench flow is not represented there.

The broader VS Code-base suite is:

```bash
cd vscode-base
./scripts/test.sh
```

Package a macOS arm64 release build when release/package behavior is in scope:

```bash
cd vscode-base
build/basehalf/package-darwin.sh arm64
```

Before a release is published, an installed application is updated to it for
real, as the [app update](../specs/app-update.md#verification) specification
requires. The packaging script refuses an archive that installed applications
would not accept. Then:

```bash
cd vscode-base
npm run basehalf:update-e2e -- --app ../VSCode-darwin-arm64/BaseHalf.app \
  --archive ../basehalf-dist/BaseHalf-<version>-darwin-arm64.zip \
  --from ../basehalf-dist/BaseHalf-<version before>-darwin-arm64.zip
```

`--from` is the release that users have installed: it is updated by the update
service it was released with. The run needs the release key, opens BaseHalf
windows, and takes several minutes. It is not part of CI.

Package-specific work should run that package's lint, typecheck, and test
scripts in addition to any cross-package acceptance checks defined by the
owning specification.

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

Committing locally does not imply permission to push. Push only when the user or
maintainer has requested it.

## External contributor path

External contributors use a branch and pull request, complete the CLA, wait for
required checks, and merge through the normal review path. See
[CONTRIBUTING.md](../../CONTRIBUTING.md).
