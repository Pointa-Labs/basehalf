import type { GitStatusResult } from '../common/git.js';
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
  return {
    count: totalChangeCount(groups),
    hasStaged,
    hasCommitMessage,
    canCommit: !busy && hasStaged,
    canCommitAmend: !busy,
    canPublish:
      !busy && status.detached !== true && status.branch !== null && status.upstream === null,
    canPull:
      !busy && status.detached !== true && status.branch !== null && status.upstream !== null,
    canSync:
      !busy && status.detached !== true && status.branch !== null && status.upstream !== null,
    commitBranch: status.detached ? 'detached' : (status.branch ?? ''),
  };
}
