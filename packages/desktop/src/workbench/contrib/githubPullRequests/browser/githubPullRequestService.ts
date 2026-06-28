import type {
  GhPrFile,
  GhPullRequest,
  GithubRemoteRepository,
  GithubReviewArgs,
} from '../common/githubPullRequests.js';
import { type GithubChannel, githubChannel } from './githubChannel.js';

export interface GithubPullRequestService {
  repository(): Promise<GithubRemoteRepository | null>;
  viewer(): Promise<string | null>;
  createPullRequestUrl(branch: string): Promise<string | null>;
  listPullRequests(remoteUrl: string): Promise<readonly GhPullRequest[]>;
  pullRequestFiles(remoteUrl: string, number: number): Promise<readonly GhPrFile[]>;
  reviewPullRequest(args: GithubReviewArgs): Promise<void>;
  signIn(token: string): Promise<string | null>;
  signOut(): Promise<void>;
  onDidChangeAuthentication?: (listener: () => void) => () => void;
}

export function createGithubPullRequestService(channel: GithubChannel): GithubPullRequestService {
  const authListeners = new Set<() => void>();
  const fireAuthenticationChanged = (): void => {
    for (const listener of authListeners) listener();
  };
  return {
    repository: () => channel.repository(),

    viewer: () => channel.viewer(),

    createPullRequestUrl: (branch) => channel.createPullRequestUrl(branch),

    listPullRequests: (remoteUrl) => channel.listPullRequests(remoteUrl),

    pullRequestFiles: (remoteUrl, number) => channel.pullRequestFiles(remoteUrl, number),

    reviewPullRequest: (args) => channel.reviewPullRequest(args),

    signIn: async (token) => {
      const login = await channel.signIn(token);
      fireAuthenticationChanged();
      return login;
    },

    signOut: async () => {
      await channel.signOut();
      fireAuthenticationChanged();
    },

    onDidChangeAuthentication: (listener) => {
      authListeners.add(listener);
      return () => authListeners.delete(listener);
    },
  };
}

export const githubPullRequestService = createGithubPullRequestService(githubChannel);

export const githubErrorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);
