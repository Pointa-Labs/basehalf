import type { ContextMenuItem } from '../../../../platform/contextview/common/contextMenu.js';
import type { GitCommit } from '../common/git.js';
import type { FullGraphCommitMenuCommand, GitGraphActionRunner } from './gitGraphActionTypes.js';

export function fullGraphCommitMenu(
  commit: GitCommit,
  runner: GitGraphActionRunner,
): ContextMenuItem[] {
  const command = (
    id: FullGraphCommitMenuCommand,
    label: string,
    options: { readonly danger?: boolean } = {},
  ): ContextMenuItem => ({
    id,
    label,
    ...(options.danger === true && { danger: true }),
    run: () => runner.executeCommitAction(id, commit),
  });

  return [
    command('checkout', 'Checkout Commit…'),
    command('branch', 'Create Branch from Commit…'),
    command('tag', 'Create Tag at Commit…'),
    { separator: true },
    command('cherrypick', 'Cherry-Pick onto Current Branch'),
    command('revert', 'Revert Commit'),
    command('merge', 'Merge into Current Branch'),
    { separator: true },
    command('reset-mixed', 'Reset Current Branch to Here (Keep Changes)'),
    command('reset-hard', 'Reset Current Branch to Here (Discard Changes)', { danger: true }),
    { separator: true },
    command('rebase', 'Rebase Commits After This…'),
    { separator: true },
    command('copy-sha', 'Copy Commit Hash'),
    command('copy-subject', 'Copy Commit Message'),
  ];
}
