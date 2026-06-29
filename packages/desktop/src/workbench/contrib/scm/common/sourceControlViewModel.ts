import type { GitStatusResult } from './git.js';
import { type GitGroups, totalChangeCount } from './gitStatusModel.js';

export interface SourceControlViewModel {
  readonly count: number;
  readonly hasStaged: boolean;
  readonly hasCommitMessage: boolean;
  readonly canCommit: boolean;
  readonly canCommitAmend: boolean;
  readonly canPublish: boolean;
  readonly canPull: boolean;
  readonly canSync: boolean;
  readonly commitBranch: string;
}

export function sourceControlViewModel(
  status: GitStatusResult,
  groups: GitGroups,
  message: string,
  busy: boolean,
): SourceControlViewModel {
  const hasStaged = groups.staged.length > 0;
  const hasCommitMessage = message.trim().length > 0;
  const hasBranch = status.detached !== true && status.branch !== null;
  const hasUpstream = hasBranch && status.upstream !== null;
  const branchIsAheadOrBehind = status.ahead > 0 || status.behind > 0;
  return {
    count: totalChangeCount(groups),
    hasStaged,
    hasCommitMessage,
    canCommit: !busy && hasStaged,
    canCommitAmend: !busy && hasBranch,
    canPublish: !busy && hasBranch && status.upstream === null,
    canPull: !busy && hasUpstream,
    canSync: !busy && hasUpstream && branchIsAheadOrBehind,
    commitBranch: status.detached ? 'detached' : (status.branch ?? ''),
  };
}
