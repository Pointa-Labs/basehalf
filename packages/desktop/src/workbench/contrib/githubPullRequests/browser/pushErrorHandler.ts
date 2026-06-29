import type { GitError, GitRemoteInfo } from '../../scm/common/git.js';
import { GitErrorCodes } from '../../scm/common/git.js';
import type { PushErrorHandler, PushErrorRepository } from '../../scm/common/pushError.js';
import type { GithubRepo } from '../common/githubPullRequests.js';

export const GithubPushErrorKinds = {
  PermissionDenied: 'permissionDenied',
  PushProtection: 'pushProtection',
} as const;

export type GithubPushErrorKind = (typeof GithubPushErrorKinds)[keyof typeof GithubPushErrorKinds];

export interface GithubPushError {
  readonly kind: GithubPushErrorKind;
  readonly owner: string;
  readonly repo: string;
  readonly remoteName: string;
  readonly remoteUrl: string;
  readonly refspec: string;
  readonly stderr: string;
}

export interface GithubPushErrorDelegate {
  handleGithubPushError(
    error: GithubPushError,
    repository: PushErrorRepository,
  ): Promise<boolean> | boolean;
}

export class GithubPushErrorHandler implements PushErrorHandler {
  constructor(private readonly delegate: GithubPushErrorDelegate) {}

  async handlePushError(
    repository: PushErrorRepository,
    remote: GitRemoteInfo,
    refspec: string,
    error: GitError,
  ): Promise<boolean> {
    const githubError = classifyGithubPushError(remote, refspec, error);
    if (githubError === null) return false;
    return this.delegate.handleGithubPushError(githubError, repository);
  }
}

export function classifyGithubPushError(
  remote: GitRemoteInfo,
  refspec: string,
  error: Pick<GitError, 'gitErrorCode' | 'stderr'>,
): GithubPushError | null {
  if (
    error.gitErrorCode !== GitErrorCodes.PermissionDenied &&
    error.gitErrorCode !== GitErrorCodes.PushRejected
  ) {
    return null;
  }

  const remoteUrl = remote.pushUrl?.trim();
  if (remoteUrl === undefined || remoteUrl === '') return null;

  const repo = parseGithubRemoteUrl(remoteUrl);
  if (repo === null) return null;

  if (refspec.startsWith(':')) return null;

  const base = {
    owner: repo.owner,
    repo: repo.repo,
    remoteName: remote.name,
    remoteUrl,
    refspec,
    stderr: error.stderr ?? '',
  };

  if (error.gitErrorCode === GitErrorCodes.PermissionDenied) {
    return { ...base, kind: GithubPushErrorKinds.PermissionDenied };
  }

  if (/GH009: Secrets detected!/i.test(error.stderr ?? '')) {
    return { ...base, kind: GithubPushErrorKinds.PushProtection };
  }

  return null;
}

export function parseGithubRemoteUrl(remoteUrl: string): GithubRepo | null {
  const trimmed = remoteUrl.trim();
  if (trimmed === '') return null;

  const scp = /^[\w.-]+@([^:/]+):(.+)$/.exec(trimmed);
  if (scp !== null) {
    return repoFromHostAndPath(scp[1] ?? '', scp[2] ?? '');
  }

  try {
    const url = new URL(trimmed);
    return repoFromHostAndPath(url.host, url.pathname);
  } catch {
    return null;
  }
}

function repoFromHostAndPath(host: string, rawPath: string): GithubRepo | null {
  if (host.toLowerCase() !== 'github.com') return null;
  const path = rawPath
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
  const [owner, repo] = path.split('/');
  if (owner === undefined || owner === '' || repo === undefined || repo === '') return null;
  return { owner, repo };
}
