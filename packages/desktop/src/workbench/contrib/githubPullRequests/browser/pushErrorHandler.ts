import { toast } from '../../../../platform/notification/browser/notificationService.js';
import { registerPushErrorHandler } from '../../scm/browser/pushErrorRegistry.js';
import type { GitError, GitRemoteInfo } from '../../scm/common/git.js';
import { GitErrorCodes } from '../../scm/common/git.js';
import type {
  PushErrorHandler,
  PushErrorHandlerRegistry,
  PushErrorRepository,
} from '../../scm/common/pushError.js';
import { parseGithubRemoteUrl } from '../common/githubRemote.js';
export { parseGithubRemoteUrl } from '../common/githubRemote.js';

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

export interface GithubPushErrorDelegateOptions {
  readonly toastError?: (message: string) => void;
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

export function createGithubPushErrorDelegate({
  toastError = toast.error,
}: GithubPushErrorDelegateOptions = {}): GithubPushErrorDelegate {
  return {
    handleGithubPushError: (error) => {
      toastError(githubPushErrorMessage(error));
      return true;
    },
  };
}

export const githubPushErrorHandler = new GithubPushErrorHandler(createGithubPushErrorDelegate());

export function registerGithubPushErrorHandler(
  registry?: PushErrorHandlerRegistry,
  handler: PushErrorHandler = githubPushErrorHandler,
): () => void {
  return registerPushErrorHandler(handler, registry);
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

function githubPushErrorMessage(error: GithubPushError): string {
  if (error.kind === GithubPushErrorKinds.PermissionDenied) {
    return `You don't have permission to push to "${error.owner}/${error.repo}" on GitHub.`;
  }
  return `Your push to "${error.owner}/${error.repo}" was rejected by GitHub push protection because one or more secrets were detected.`;
}
