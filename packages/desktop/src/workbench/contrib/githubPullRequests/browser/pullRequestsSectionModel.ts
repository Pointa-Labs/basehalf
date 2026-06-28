import type { GhPullRequest, GithubRemoteRepository } from '../common/githubPullRequests.js';
import { type GithubPullRequestService, githubErrorMessage } from './githubPullRequestService.js';

export interface PullRequestContext {
  readonly repository: GithubRemoteRepository | null;
  readonly login: string | null;
}

export interface PullRequestLoadResult {
  readonly pullRequests: GhPullRequest[];
  readonly error: string | null;
}

export async function resolvePullRequestContext(
  service: GithubPullRequestService,
): Promise<PullRequestContext> {
  let repository: GithubRemoteRepository | null = null;
  let login: string | null = null;
  try {
    repository = await service.repository();
  } catch {
    repository = null;
  }
  try {
    login = await service.viewer();
  } catch {
    login = null;
  }
  return { repository, login };
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
