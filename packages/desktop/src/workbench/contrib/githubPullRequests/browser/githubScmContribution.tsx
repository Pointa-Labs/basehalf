import { nativeHostService } from '../../../../platform/native/browser/nativeHostService.js';
import type { NativeHostResult } from '../../../../platform/native/common/native.js';
import { toast } from '../../../../platform/notification/browser/notificationService.js';
import { type GitScmService, gitScmService } from '../../scm/browser/gitScmService.js';
import {
  type ScmViewContribution,
  type ScmViewContributionRegistryLike,
  registerScmViewContribution,
  scmViewContributionRegistry,
} from '../../scm/browser/scmViewContributions.js';
import { choosePublishRemote } from '../../scm/browser/useScmRemoteCommands.js';
import type { GitStatusResult } from '../../scm/common/git.js';
import { PullRequestsSection } from './PullRequestsSection.js';
import {
  type GithubPullRequestService,
  githubErrorMessage,
  githubPullRequestService,
} from './githubPullRequestService.js';
import { registerGithubRemoteSourceProvider } from './githubRemoteSourceProvider.js';

export interface CreateGithubPullRequestOptions {
  readonly status: GitStatusResult | null;
  readonly service?: GithubPullRequestService;
  readonly git?: Pick<GitScmService, 'publish' | 'remotes'>;
  readonly selectPublishRemote?: (git: Pick<GitScmService, 'remotes'>) => Promise<string | null>;
  readonly openExternal?: (url: string) => Promise<NativeHostResult>;
  readonly toastError?: (message: string) => void;
}

export async function createGithubPullRequest({
  status,
  service = githubPullRequestService,
  git = gitScmService,
  selectPublishRemote = choosePublishRemote,
  openExternal = (url) => nativeHostService.openExternal(url),
  toastError = toast.error,
}: CreateGithubPullRequestOptions): Promise<void> {
  const branch = status?.branch;
  if (!branch) {
    toastError('A current branch is required to create a pull request.');
    return;
  }

  try {
    if (status.upstream === null) {
      const remote = await selectPublishRemote(git);
      if (remote === null) return;
      await git.publish({ remote });
    }

    const url = await service.createPullRequestUrl(branch);
    if (url === null) {
      toastError('No GitHub remote is configured.');
      return;
    }

    const result = await openExternal(url);
    if (!result.ok) toastError(result.error ?? 'Failed to open the browser.');
  } catch (err) {
    toastError(githubErrorMessage(err));
  }
}

export const githubPullRequestsScmContribution: ScmViewContribution = {
  id: 'github.pullRequests',
  when: ({ model }) => model.status?.isRepo === true,
  menuActions: ({ status }) => [
    {
      label: 'Create Pull Request…',
      onClick: () => {
        void createGithubPullRequest({ status });
      },
    },
  ],
  renderSection: () => <PullRequestsSection />,
};

export function registerGithubPullRequestsScmContribution(
  registry?: ScmViewContributionRegistryLike,
): () => void {
  const scmRegistry = registry ?? scmViewContributionRegistry;
  const disposables = [
    registerScmViewContribution(githubPullRequestsScmContribution, scmRegistry),
    ...(scmRegistry === scmViewContributionRegistry ? [registerGithubRemoteSourceProvider()] : []),
  ];
  return () => {
    for (const dispose of [...disposables].reverse()) dispose();
  };
}
