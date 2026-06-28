import type {
  GhPrFile,
  GhPullRequest,
  GithubRemoteRepository,
  GithubReviewArgs,
} from '../common/githubPullRequests.js';
import { type GithubChannel, githubChannel } from './githubChannel.js';

export interface GithubPullRequestService {
  repository(): Promise<GithubRemoteRepository | null>;
  createPullRequestUrl(branch: string): Promise<string | null>;
  listPullRequests(remoteUrl: string): Promise<readonly GhPullRequest[]>;
  pullRequestFiles(remoteUrl: string, number: number): Promise<readonly GhPrFile[]>;
  reviewPullRequest(args: GithubReviewArgs): Promise<void>;
}

export function createGithubPullRequestService(channel: GithubChannel): GithubPullRequestService {
  return {
    repository: () => channel.repository(),

    createPullRequestUrl: (branch) => channel.createPullRequestUrl(branch),

    listPullRequests: (remoteUrl) => channel.listPullRequests(remoteUrl),

    pullRequestFiles: (remoteUrl, number) => channel.pullRequestFiles(remoteUrl, number),

    reviewPullRequest: (args) => channel.reviewPullRequest(args),
  };
}

export const githubPullRequestService = createGithubPullRequestService(githubChannel);

export const githubErrorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);
