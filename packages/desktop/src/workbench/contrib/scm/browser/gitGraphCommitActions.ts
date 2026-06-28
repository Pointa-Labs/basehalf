import type { ContextMenuItem } from '../../../../platform/contextview/common/contextMenu.js';
import type { GitCommit } from '../common/git.js';
import type { GitGraphActionDeps } from './gitGraphActionTypes.js';

export function fullGraphCommitMenu(
  commit: GitCommit,
  deps: GitGraphActionDeps,
): ContextMenuItem[] {
  const sha = commit.hash;
  const short = commit.shortHash;
  return [
    {
      id: 'checkout',
      label: 'Checkout Commit…',
      run: () =>
        void deps
          .confirm({
            title: `Checkout ${short}?`,
            body: 'This enters a detached HEAD state.',
            confirmText: 'Checkout',
          })
          .then((ok) => {
            if (ok) deps.runGit(() => deps.git.checkout(sha));
          }),
    },
    {
      id: 'branch',
      label: 'Create Branch from Commit…',
      run: () =>
        void deps
          .prompt({
            title: `Create branch from ${short}`,
            label: 'Branch name',
            placeholder: 'feature/x',
          })
          .then((name) => {
            const branch = name?.trim();
            if (branch) deps.runGit(() => deps.git.createBranch(branch, { ref: sha }));
          }),
    },
    {
      id: 'tag',
      label: 'Create Tag at Commit…',
      run: () =>
        void deps
          .prompt({
            title: `Create tag at ${short}`,
            label: 'Tag name',
            placeholder: 'v1.0',
          })
          .then((name) => {
            const tag = name?.trim();
            if (tag) deps.runGit(() => deps.git.tag(tag, sha));
          }),
    },
    { separator: true },
    {
      id: 'cherrypick',
      label: 'Cherry-Pick onto Current Branch',
      run: () =>
        deps.runGit(async () => {
          const result = await deps.git.cherryPick(sha);
          if (result.conflicts)
            deps.toastError('The cherry-pick hit conflicts — resolve them in Merge Changes.');
        }),
    },
    {
      id: 'revert',
      label: 'Revert Commit',
      run: () =>
        deps.runGit(async () => {
          const result = await deps.git.revert(sha);
          if (result.conflicts)
            deps.toastError('The revert hit conflicts — resolve them in Merge Changes.');
        }),
    },
    {
      id: 'merge',
      label: 'Merge into Current Branch',
      run: () =>
        deps.runGit(async () => {
          const result = await deps.git.merge(sha);
          if (result.conflicts)
            deps.toastError('The merge hit conflicts — resolve them in Merge Changes.');
        }),
    },
    { separator: true },
    {
      id: 'reset-mixed',
      label: 'Reset Current Branch to Here (Keep Changes)',
      run: () => deps.runGit(() => deps.git.reset({ ref: sha, mode: 'mixed' })),
    },
    {
      id: 'reset-hard',
      label: 'Reset Current Branch to Here (Discard Changes)',
      danger: true,
      run: () =>
        void deps
          .confirm({
            title: `Hard-reset to ${short}?`,
            body: 'All changes after this commit on the current branch are permanently discarded. This is IRREVERSIBLE.',
            confirmText: 'Hard Reset',
            destructive: true,
          })
          .then((ok) => {
            if (ok) deps.runGit(() => deps.git.reset({ ref: sha, mode: 'hard' }));
          }),
    },
    { separator: true },
    {
      id: 'rebase',
      label: 'Rebase Commits After This…',
      run: () => deps.setRebaseBase(sha),
    },
    { separator: true },
    {
      id: 'copy-sha',
      label: 'Copy Commit Hash',
      run: () => void deps.writeClipboard(sha).then(() => deps.toastSuccess(`Copied ${short}`)),
    },
    {
      id: 'copy-subject',
      label: 'Copy Commit Message',
      run: () => void deps.writeClipboard(commit.subject).then(() => deps.toastSuccess('Copied')),
    },
  ];
}
