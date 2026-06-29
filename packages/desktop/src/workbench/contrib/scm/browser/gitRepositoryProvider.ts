import type { GitStatusResult } from '../common/git.js';
import { type GitGroups, classifyStatus } from '../common/gitStatusModel.js';
import {
  type SourceControlActionButtonModel,
  sourceControlActionButtonModel,
} from '../common/sourceControlActionButtonModel.js';
import {
  type SourceControlProvider,
  type SourceControlRepository,
  type SourceControlViewModel,
  sourceControlViewModel,
} from '../common/sourceControlViewModel.js';

const EMPTY_GROUPS: GitGroups = Object.freeze({
  merge: Object.freeze([]),
  staged: Object.freeze([]),
  changes: Object.freeze([]),
});

export interface GitSourceControlProvider
  extends SourceControlProvider<GitGroups, SourceControlActionButtonModel> {
  readonly status: GitStatusResult;
}

export type GitSourceControlRepository = SourceControlRepository<GitSourceControlProvider>;

export interface GitRepositoryProviderModel {
  readonly status: GitStatusResult | null;
  readonly loading: boolean;
  readonly isRepository: boolean;
  readonly repository: GitSourceControlRepository | null;
  readonly provider: GitSourceControlProvider | null;
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
      repository: null,
      provider: null,
      groups,
      view: null,
    };
  }

  if (!status.isRepo) {
    return {
      status,
      loading: false,
      isRepository: false,
      repository: null,
      provider: null,
      groups,
      view: null,
    };
  }

  const view = sourceControlViewModel(status, groups, message, busy);
  const provider: GitSourceControlProvider = {
    id: 'git',
    providerId: 'git',
    label: 'Git',
    name: 'Git',
    status,
    groups,
    view,
    action: sourceControlActionButtonModel(view),
  };

  return {
    status,
    loading: false,
    isRepository: true,
    repository: {
      id: 'git',
      provider,
    },
    provider,
    groups,
    view,
  };
}
