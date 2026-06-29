import type { PublicAuthenticationSession } from '../../../services/authentication/common/authentication.js';
import type { GhPullRequest, GithubRemoteRepository } from '../common/githubPullRequests.js';
import { type GithubPullRequestService, githubErrorMessage } from './githubPullRequestService.js';

export interface PullRequestLoadResult {
  readonly pullRequests: GhPullRequest[];
  readonly error: string | null;
}

export async function resolvePullRequestRepository(
  service: GithubPullRequestService,
): Promise<GithubRemoteRepository | null> {
  try {
    return await service.repository();
  } catch {
    return null;
  }
}

export function loginFromAuthenticationSessions(
  sessions: readonly PublicAuthenticationSession[],
): string | null {
  return sessions[0]?.account.label ?? null;
}

export function shouldLoadPullRequests(
  repository: GithubRemoteRepository | null | undefined,
  login: string | null | undefined,
  open: boolean,
): repository is GithubRemoteRepository {
  return (
    repository !== null && repository !== undefined && login !== null && login !== undefined && open
  );
}

export async function loadPullRequests(
  service: GithubPullRequestService,
  remoteUrl: string,
): Promise<PullRequestLoadResult> {
  try {
    return {
      pullRequests: [...(await service.listPullRequests(remoteUrl))],
      error: null,
    };
  } catch (err) {
    return {
      pullRequests: [],
      error: githubErrorMessage(err),
    };
  }
}
