import type { RemoteSource, RemoteSourceBranch } from '../../scm/common/remoteSources.js';

export interface GithubRepo {
  readonly owner: string;
  readonly repo: string;
}

export interface GithubRemoteRepository {
  readonly remoteName: string;
  readonly remoteUrl: string;
  readonly owner: string;
  readonly repo: string;
  readonly webUrl: string;
  readonly isReadOnly: boolean;
}

export interface GhPullRequest {
  readonly number: number;
  readonly title: string;
  readonly author: string;
  readonly state: string;
  readonly draft: boolean;
  readonly headRef: string;
  readonly baseRef: string;
  readonly url: string;
  readonly updatedAt: string;
}

export interface GhPrFile {
  readonly filename: string;
  readonly status: string;
  readonly additions: number;
  readonly deletions: number;
  readonly patch?: string;
  readonly previousFilename?: string;
}

export interface GithubReviewArgs {
  readonly remoteUrl: string;
  readonly number: number;
  readonly event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  readonly body?: string;
}

export const GITHUB_IPC_CHANNELS = {
  repository: 'github:repository',
  createPullRequestUrl: 'github:create-pull-request-url',
  listRemoteSources: 'github:list-remote-sources',
  listRemoteBranches: 'github:list-remote-branches',
  listPullRequests: 'github:list-pull-requests',
  pullRequestFiles: 'github:pull-request-files',
  reviewPullRequest: 'github:review-pull-request',
} as const;

export type GithubIpcChannel = (typeof GITHUB_IPC_CHANNELS)[keyof typeof GITHUB_IPC_CHANNELS];

export interface GithubChannelBridge {
  repository(): Promise<GithubRemoteRepository | null>;
  createPullRequestUrl(branch: string): Promise<string | null>;
  listRemoteSources(query?: string): Promise<readonly RemoteSource[]>;
  listRemoteBranches(remoteUrl: string): Promise<readonly RemoteSourceBranch[]>;
  listPullRequests(remoteUrl: string): Promise<readonly GhPullRequest[]>;
  pullRequestFiles(remoteUrl: string, number: number): Promise<readonly GhPrFile[]>;
  reviewPullRequest(args: GithubReviewArgs): Promise<void>;
}
