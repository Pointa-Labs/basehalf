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

export interface SourceControlProvider<TGroups = unknown, TAction = unknown> {
  readonly id: string;
  readonly providerId: string;
  readonly label: string;
  readonly name: string;
  readonly groups: TGroups;
  readonly view: SourceControlViewModel;
  readonly action: TAction;
}

export interface SourceControlRepository<
  TProvider extends SourceControlProvider<unknown, unknown> = SourceControlProvider,
> {
  readonly id: string;
  readonly provider: TProvider;
}

export interface SourceControlBranchState {
  readonly detached?: boolean;
  readonly branch: string | null;
  readonly upstream: string | null;
  readonly ahead: number;
  readonly behind: number;
}

export interface SourceControlChangeGroups {
  readonly merge: readonly unknown[];
  readonly staged: readonly unknown[];
  readonly changes: readonly unknown[];
}

export function sourceControlViewModel(
  status: SourceControlBranchState,
  groups: SourceControlChangeGroups,
  message: string,
  busy: boolean,
): SourceControlViewModel {
  const hasStaged = groups.staged.length > 0;
  const hasCommitMessage = message.trim().length > 0;
  const hasBranch = status.detached !== true && status.branch !== null;
  const hasUpstream = hasBranch && status.upstream !== null;
  const branchIsAheadOrBehind = status.ahead > 0 || status.behind > 0;
  return {
    count: groups.merge.length + groups.staged.length + groups.changes.length,
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
