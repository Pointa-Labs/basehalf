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

/**
 * GitHub provider IPC uses its own small result envelope: Git CLI metadata stays
 * in GitError, while GitHub renderer callers depend on ordinary Error fields.
 */
export interface GithubErrorData {
  readonly name?: string;
  readonly message: string;
  readonly code?: string;
}

export type GithubIpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: GithubErrorData };

export const GITHUB_AUTH_REQUIRED_ERROR_CODE = 'GITHUB_AUTH_REQUIRED';

export class GithubAuthenticationRequiredError extends Error {
  override name = 'GithubAuthenticationRequiredError';
  readonly code = GITHUB_AUTH_REQUIRED_ERROR_CODE;

  constructor(message = 'Not signed in to GitHub. Sign in from Settings.') {
    super(message);
  }
}

export function githubIpcSuccess<T>(value: T): GithubIpcResult<T> {
  return { ok: true, value };
}

export function githubIpcFailure(err: unknown): GithubIpcResult<never> {
  return { ok: false, error: githubErrorToData(err) };
}

export function unwrapGithubIpcResult<T>(raw: unknown): T {
  if (!isGithubIpcResult(raw)) return raw as T;
  if (raw.ok) return raw.value as T;
  throw githubErrorFromData(raw.error);
}

export interface GithubChannelBridge {
  repository(): Promise<GithubRemoteRepository | null>;
  createPullRequestUrl(branch: string): Promise<string | null>;
  listRemoteSources(query?: string): Promise<readonly RemoteSource[]>;
  listRemoteBranches(remoteUrl: string): Promise<readonly RemoteSourceBranch[]>;
  listPullRequests(remoteUrl: string): Promise<readonly GhPullRequest[]>;
  pullRequestFiles(remoteUrl: string, number: number): Promise<readonly GhPrFile[]>;
  reviewPullRequest(args: GithubReviewArgs): Promise<void>;
}

function githubErrorToData(err: unknown): GithubErrorData {
  if (typeof err !== 'object' || err === null) {
    return { message: String(err) };
  }

  const record = err as Record<string, unknown>;
  return {
    ...(typeof record.name === 'string' && { name: record.name }),
    message: typeof record.message === 'string' ? record.message : String(err),
    ...(typeof record.code === 'string' && { code: record.code }),
  };
}

function githubErrorFromData(data: GithubErrorData): Error {
  const error = new Error(data.message);
  if (data.name !== undefined) {
    error.name = data.name;
  }
  if (data.code !== undefined) {
    (error as Error & { code?: string }).code = data.code;
  }
  return error;
}

function isGithubIpcResult(raw: unknown): raw is GithubIpcResult<unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
  const value = raw as Record<string, unknown>;
  if (value.ok === true) return 'value' in value;
  if (value.ok !== false) return false;
  const error = value.error;
  return (
    typeof error === 'object' &&
    error !== null &&
    !Array.isArray(error) &&
    typeof (error as Record<string, unknown>).message === 'string'
  );
}
