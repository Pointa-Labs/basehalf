import { nativeHostService } from '../../../../platform/native/browser/nativeHostService.js';
import type { NativeHostResult } from '../../../../platform/native/common/native.js';
import { toast } from '../../../../platform/notification/browser/notificationService.js';
import type { ScmViewContribution } from '../../scm/browser/scmViewContributions.js';
import type { GitStatusResult } from '../../scm/common/git.js';
import { PullRequestsSection } from './PullRequestsSection.js';
import {
  type GithubPullRequestService,
  githubErrorMessage,
  githubPullRequestService,
} from './githubPullRequestService.js';

export interface CreateGithubPullRequestOptions {
  readonly status: GitStatusResult | null;
  readonly service?: GithubPullRequestService;
  readonly openExternal?: (url: string) => Promise<NativeHostResult>;
  readonly toastError?: (message: string) => void;
}

export async function createGithubPullRequest({
  status,
  service = githubPullRequestService,
  openExternal = (url) => nativeHostService.openExternal(url),
  toastError = toast.error,
}: CreateGithubPullRequestOptions): Promise<void> {
  const branch = status?.branch;
  if (!branch) {
    toastError('A current branch is required to create a pull request.');
    return;
  }

  try {
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
