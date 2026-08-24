# Verification and delivery

Verification follows the owning specification's acceptance criteria. Choose
checks by the affected boundary, record anything that remains manual, and do not
describe a change as complete when a required check has not run or is failing.

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

The smoke currently covers canvas startup, hidden Open Editors, Quick Open,
Quick Text Search, and folder routing. Extend its acceptance coverage when a
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
