import type { DiscardPlan } from '../common/discardModel.js';
import { GitError, GitErrorCodes, type GitStashEntry, gitErrorMessage } from '../common/git.js';
import type { GitRow } from '../common/gitStatusModel.js';
import type { GitScmService } from './gitScmService.js';

type MaybePromise = Promise<void> | void;
export type ScmActionRunner = (action: () => Promise<unknown>) => Promise<void>;

export type ScmBranchMenuActionId =
  | 'merge'
  | 'rebase'
  | 'createBranch'
  | 'createBranchFrom'
  | 'renameBranch'
  | 'deleteBranch';

export type ScmBranchMenuGroup = '1_merge' | '2_branch' | '3_modify';

export interface ScmBranchMenuActionDescriptor {
  readonly id: ScmBranchMenuActionId;
  readonly command: `git.${string}`;
  readonly label: string;
  readonly group: ScmBranchMenuGroup;
  readonly order: number;
  readonly danger?: boolean;
}

export const SCM_BRANCH_MENU_ACTION_DESCRIPTORS = [
  {
    id: 'merge',
    command: 'git.merge',
    label: 'Merge…',
    group: '1_merge',
    order: 1,
  },
  {
    id: 'rebase',
    command: 'git.rebase',
    label: 'Rebase Branch…',
    group: '1_merge',
    order: 2,
  },
  {
    id: 'createBranch',
    command: 'git.branch',
    label: 'Create Branch…',
    group: '2_branch',
    order: 1,
  },
  {
    id: 'createBranchFrom',
    command: 'git.branchFrom',
    label: 'Create Branch From…',
    group: '2_branch',
    order: 2,
  },
  {
    id: 'renameBranch',
    command: 'git.renameBranch',
    label: 'Rename Branch…',
    group: '3_modify',
    order: 1,
  },
  {
    id: 'deleteBranch',
    command: 'git.deleteBranch',
    label: 'Delete Branch…',
    group: '3_modify',
    order: 2,
    danger: true,
  },
] as const satisfies readonly ScmBranchMenuActionDescriptor[];

export interface ScmActionEffects {
  readonly setBusy: (busy: boolean) => void;
  readonly setError: (message: string) => void;
  readonly toastError: (message: string) => void;
  readonly refresh: () => MaybePromise;
  readonly loadStashes: () => MaybePromise;
}

export const scmErrorMessage = (err: unknown): string =>
  err instanceof GitError
    ? scmGitErrorMessage(err)
    : err instanceof Error
      ? err.message
      : String(err);

export function scmGitErrorMessage(err: GitError): string {
  switch (err.gitErrorCode) {
    case GitErrorCodes.DirtyWorkTree:
      return 'Please clean your repository working tree before checkout.';
    case GitErrorCodes.PushRejected:
      return 'Can\'t push refs to remote. Try running "Pull" first to integrate your changes.';
    case GitErrorCodes.ForcePushWithLeaseRejected:
    case GitErrorCodes.ForcePushWithLeaseIfIncludesRejected:
      return 'Can\'t force push refs to remote. The tip of the remote-tracking branch has been updated since the last checkout. Try running "Pull" first to pull the latest changes from the remote branch first.';
    case GitErrorCodes.Conflict:
      return 'There are merge conflicts. Please resolve them before committing your changes.';
    case GitErrorCodes.NoUserNameConfigured:
      return 'Make sure you configure your "user.name" and "user.email" in git.';
    case GitErrorCodes.NoUpstreamBranch:
      return noUpstreamGitErrorMessage(err);
    default:
      return gitErrorMessage(err);
  }
}

function noUpstreamGitErrorMessage(err: GitError): string {
  const command = err.gitCommand ?? err.gitArgs?.[0];
  if (command === 'pull') {
    return 'The current branch has no upstream branch. Publish this branch or set an upstream branch before pulling.';
  }
  if (command === 'sync') {
    return 'The current branch has no upstream branch. Publish this branch before syncing.';
  }
  return 'The current branch has no remote branch. Publish this branch first.';
}

export async function runScmAction(
  action: () => Promise<unknown>,
  effects: ScmActionEffects,
): Promise<void> {
  effects.setBusy(true);
  try {
    await action();
    await effects.refresh();
    await effects.loadStashes();
  } catch (err) {
    const message = scmErrorMessage(err);
    await effects.refresh();
    await effects.loadStashes();
    effects.setError(message);
    effects.toastError(message);
  } finally {
    effects.setBusy(false);
  }
}

export function discardRowPrompt(row: GitRow): string {
  return row.untracked
    ? `Move “${row.path}” to the Trash?\n\nIt’s untracked — recoverable from the Trash.`
    : `Discard changes in “${row.path}”?\n\nThis reverts to the last commit and can’t be undone.`;
}

export function discardManyPrompt(plan: DiscardPlan): string {
  const tracked = plan.trackedPaths.length;
  const untracked = plan.untrackedEntries.length;
  const parts: string[] = [];
  if (tracked > 0) {
    parts.push(
      `This will permanently discard changes in ${tracked} tracked file(s). Tracked changes cannot be undone.`,
    );
  }
  if (untracked > 0) {
    parts.push(`This will move ${untracked} untracked file/folder(s) to the Trash.`);
  }
  return parts.join('\n\n');
}

export function discardAllPrompt(count: number): string {
  return `Discard all ${count} unstaged change(s)? This is IRREVERSIBLE.`;
}

export function dropStashPrompt(ref: GitStashEntry['ref']): string {
  return `Delete stash ${ref}? This is IRREVERSIBLE.`;
}

export async function applyDiscardPlan(
  plan: DiscardPlan,
  git: Pick<GitScmService, 'discard' | 'deleteWorkspaceEntry'>,
): Promise<void> {
  if (plan.trackedPaths.length > 0) await git.discard(plan.trackedPaths);
  for (const entry of plan.untrackedEntries) {
    await git.deleteWorkspaceEntry(entry.path, entry.kind);
  }
}
