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
  viewer: 'github:viewer',
  createPullRequestUrl: 'github:create-pull-request-url',
  listPullRequests: 'github:list-pull-requests',
  pullRequestFiles: 'github:pull-request-files',
  reviewPullRequest: 'github:review-pull-request',
  signIn: 'github:sign-in',
  signOut: 'github:sign-out',
} as const;

export type GithubIpcChannel = (typeof GITHUB_IPC_CHANNELS)[keyof typeof GITHUB_IPC_CHANNELS];

export interface GithubChannelBridge {
  repository(): Promise<GithubRemoteRepository | null>;
  viewer(): Promise<string | null>;
  createPullRequestUrl(branch: string): Promise<string | null>;
  listPullRequests(remoteUrl: string): Promise<readonly GhPullRequest[]>;
  pullRequestFiles(remoteUrl: string, number: number): Promise<readonly GhPrFile[]>;
  reviewPullRequest(args: GithubReviewArgs): Promise<void>;
  signIn(token: string): Promise<string | null>;
  signOut(): Promise<void>;
}
