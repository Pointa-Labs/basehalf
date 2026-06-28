import type { GitStatusResult } from '../common/git.js';
import { type GitGroups, classifyStatus } from './gitStatusModel.js';
import { type SourceControlViewModel, sourceControlViewModel } from './sourceControlViewModel.js';

const EMPTY_GROUPS: GitGroups = Object.freeze({
  merge: Object.freeze([]),
  staged: Object.freeze([]),
  changes: Object.freeze([]),
});

export interface GitRepositoryProviderModel {
  readonly status: GitStatusResult | null;
  readonly loading: boolean;
  readonly isRepository: boolean;
  readonly groups: GitGroups;
  readonly view: SourceControlViewModel | null;
}

export function gitRepositoryGroups(status: GitStatusResult | null): GitGroups {
  return status?.isRepo ? classifyStatus(status.files) : EMPTY_GROUPS;
}

export function gitRepositoryProviderModel(
  status: GitStatusResult | null,
  message: string,
  busy: boolean,
  groups: GitGroups = gitRepositoryGroups(status),
): GitRepositoryProviderModel {
  if (status === null) {
    return {
      status,
      loading: true,
      isRepository: false,
      groups,
      view: null,
    };
  }

  if (!status.isRepo) {
    return {
      status,
      loading: false,
      isRepository: false,
      groups,
      view: null,
    };
  }

  return {
    status,
    loading: false,
    isRepository: true,
    groups,
    view: sourceControlViewModel(status, groups, message, busy),
  };
}
