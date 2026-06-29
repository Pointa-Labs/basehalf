import {
  type AuthenticationSession,
  GITHUB_AUTH_PROVIDER_ID,
} from '../../../services/authentication/common/authentication.js';
import type { RemoteSource, RemoteSourceBranch } from '../../scm/common/remoteSources.js';
import {
  type GhPrFile,
  type GhPullRequest,
  GithubAuthenticationRequiredError,
  type GithubRemoteRepository,
  type GithubRepo,
} from '../common/githubPullRequests.js';
import { GithubApiClient, type GithubHttpRunner, defaultGithubHttp } from './githubApiClient.js';
import { parsePrPayload, parseReviewArgs } from './githubPayloads.js';
import {
  type GitRemoteInfoLike,
  createGithubPullRequestUrl,
  githubRepositoryFromRemote,
  parseGithubRepo,
  remoteUrlCandidates,
  repoOf,
  sameGithubRepo,
  selectHeadRepository,
  sortBaseRepositories,
} from './githubRepositoryModel.js';

export {
  API_VERSION,
  defaultGithubHttp,
  type GithubHttpRequest,
  type GithubHttpResponse,
  type GithubHttpRunner,
} from './githubApiClient.js';
export { parseGithubRepo, type GitRemoteInfoLike } from './githubRepositoryModel.js';

export interface GitRemoteProvider {
  getRemotes(workspaceRoot: string | null): Promise<readonly GitRemoteInfoLike[]>;
}

export const GITHUB_PULL_REQUEST_SCOPES = ['repo'] as const;

export interface GithubAuthenticationSessionProvider {
  getSessions(
    providerId: string,
    scopes?: readonly string[],
  ): Promise<readonly AuthenticationSession[]>;
}

export interface GithubMainServiceOptions {
  readonly authentication: GithubAuthenticationSessionProvider;
  readonly remoteProvider: GitRemoteProvider;
  readonly http?: GithubHttpRunner;
}

interface GithubRemoteSourceResponse {
  readonly full_name: string;
  readonly description: string | null;
  readonly stargazers_count?: number;
  readonly clone_url?: string;
  readonly ssh_url?: string;
  readonly html_url?: string;
}

function asRemoteSource(raw: GithubRemoteSourceResponse): RemoteSource {
  const cloneUrls = [raw.clone_url, raw.ssh_url].filter(
    (url): url is string => typeof url === 'string' && url.trim() !== '',
  );
  const urls =
    cloneUrls.length > 0
      ? cloneUrls
      : [raw.html_url].filter((url): url is string => typeof url === 'string' && url.trim() !== '');
  const firstUrl = urls[0];
  if (firstUrl === undefined) {
    throw new Error('GitHub returned a repository without a clone URL.');
  }

  const stars = raw.stargazers_count ?? 0;
  return {
    name: raw.full_name,
    ...(stars > 0 && { description: `${stars} stars` }),
    ...(raw.description !== null && raw.description.trim() !== '' && { detail: raw.description }),
    icon: 'github',
    url: urls.length === 1 ? firstUrl : urls,
  };
}

function parseOptionalQuery(query: unknown): string | undefined {
  if (query === undefined || query === null) return undefined;
  if (typeof query !== 'string') throw new Error('Invalid GitHub remote source query.');
  const trimmed = query.trim();
  return trimmed === '' ? undefined : trimmed;
}

function parseGithubRepoQuery(query: string): GithubRepo | null {
  const match = /^([^/\s]+)\/([^/\s]+)$/.exec(query);
  if (match === null) return null;
  const [, owner, repo] = match;
  return owner !== undefined && repo !== undefined ? { owner, repo } : null;
}

export class GithubMainService {
  private readonly api: GithubApiClient;

  constructor(private readonly opts: GithubMainServiceOptions) {
    this.api = new GithubApiClient(opts.http ?? defaultGithubHttp);
  }

  async repository(workspaceRoot: string | null): Promise<GithubRemoteRepository | null> {
    return (await this.githubRepositories(workspaceRoot))[0] ?? null;
  }

  async createPullRequestUrl(
    workspaceRoot: string | null,
    branch: unknown,
  ): Promise<string | null> {
    if (typeof branch !== 'string') return null;
    const trimmedBranch = branch.trim();
    if (trimmedBranch === '') return null;
    const repos = await this.githubRepositories(workspaceRoot);
    const base = repos[0];
    if (base === undefined) return null;
    const head = selectHeadRepository(repos);
    return createGithubPullRequestUrl(
      { owner: base.owner, repo: base.repo },
      trimmedBranch,
      head !== undefined ? { owner: head.owner, repo: head.repo } : undefined,
    );
  }

  async listRemoteSources(query?: unknown): Promise<readonly RemoteSource[]> {
    const trimmedQuery = parseOptionalQuery(query);
    const token = await this.requireToken();

    if (trimmedQuery === undefined) {
      return this.listUserRemoteSources(token);
    }

    const repo = parseGithubRepo(trimmedQuery);
    if (repo !== null) {
      const res = await this.api.request(token, 'GET', `/repos/${repo.owner}/${repo.repo}`);
      return [asRemoteSource(JSON.parse(res.body) as GithubRemoteSourceResponse)];
    }

    const queryRepo = parseGithubRepoQuery(trimmedQuery);
    const githubQuery =
      queryRepo === null
        ? `${trimmedQuery} fork:true`
        : `user:${queryRepo.owner}+${queryRepo.repo} fork:true`;
    const q = encodeURIComponent(githubQuery);
    const res = await this.api.request(token, 'GET', `/search/repositories?q=${q}&sort=stars`);
    const raw = JSON.parse(res.body) as { items?: GithubRemoteSourceResponse[] };
    if (!Array.isArray(raw.items)) throw new Error('GitHub returned an unexpected response.');
    return raw.items.map(asRemoteSource);
  }

  async listRemoteBranches(remoteUrl: unknown): Promise<readonly RemoteSourceBranch[]> {
    if (typeof remoteUrl !== 'string') throw new Error('Invalid GitHub remote URL.');
    const { owner, repo } = repoOf(remoteUrl);
    const token = await this.requireToken();
    const rawBranches = await this.api.arrayPages<{ name?: string }>(
      token,
      `/repos/${owner}/${repo}/branches`,
    );
    const repoRes = await this.api.request(token, 'GET', `/repos/${owner}/${repo}`);
    const defaultBranch = (JSON.parse(repoRes.body) as { default_branch?: string }).default_branch;

    return rawBranches
      .filter((branch): branch is { name: string } => typeof branch.name === 'string')
      .map((branch) => ({
        name: branch.name,
        ...(branch.name === defaultBranch && { isDefault: true }),
      }))
      .sort((a, b) => (a.name === defaultBranch ? -1 : b.name === defaultBranch ? 1 : 0));
  }

  async listPullRequests(
    workspaceRoot: string | null,
    remoteUrl: unknown,
  ): Promise<readonly GhPullRequest[]> {
    if (typeof remoteUrl !== 'string') throw new Error('Invalid GitHub remote URL.');
    const { owner, repo } = await this.repoForWorkspaceRemote(workspaceRoot, remoteUrl);
    const token = await this.requireToken();
    const raw = await this.api.arrayPages<{
      number: number;
      title: string;
      state: string;
      draft?: boolean;
      html_url: string;
      updated_at: string;
      user?: { login?: string };
      head?: { ref?: string };
      base?: { ref?: string };
    }>(token, `/repos/${owner}/${repo}/pulls?state=open&sort=updated&direction=desc`);
    return raw.map((p) => ({
      number: p.number,
      title: p.title,
      author: p.user?.login ?? '',
      state: p.state,
      draft: p.draft === true,
      headRef: p.head?.ref ?? '',
      baseRef: p.base?.ref ?? '',
      url: p.html_url,
      updatedAt: p.updated_at,
    }));
  }

  async pullRequestFiles(
    workspaceRoot: string | null,
    payload: unknown,
  ): Promise<readonly GhPrFile[]> {
    const { remoteUrl, number } = parsePrPayload(payload);
    const { owner, repo } = await this.repoForWorkspaceRemote(workspaceRoot, remoteUrl);
    const token = await this.requireToken();
    const raw = await this.api.arrayPages<{
      filename: string;
      status: string;
      additions: number;
      deletions: number;
      patch?: string;
      previous_filename?: string;
    }>(token, `/repos/${owner}/${repo}/pulls/${number}/files`);
    return raw.map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      ...(f.patch !== undefined && { patch: f.patch }),
      ...(f.previous_filename !== undefined && { previousFilename: f.previous_filename }),
    }));
  }

  async reviewPullRequest(workspaceRoot: string | null, payload: unknown): Promise<void> {
    const args = parseReviewArgs(payload);
    const body = (args.body ?? '').trim();
    if (args.event !== 'APPROVE' && body === '') {
      throw new Error('Request Changes and Comment require a message.');
    }
    const { owner, repo } = await this.repoForWorkspaceRemote(workspaceRoot, args.remoteUrl);
    const token = await this.requireToken();
    await this.api.request(token, 'POST', `/repos/${owner}/${repo}/pulls/${args.number}/reviews`, {
      event: args.event,
      ...(body !== '' && { body }),
    });
  }

  private async requireToken(): Promise<string> {
    const sessions = await this.opts.authentication.getSessions(
      GITHUB_AUTH_PROVIDER_ID,
      GITHUB_PULL_REQUEST_SCOPES,
    );
    const token = sessions[0]?.accessToken ?? null;
    if (token === null || token.trim() === '') {
      throw new GithubAuthenticationRequiredError();
    }
    return token;
  }

  private async repoForWorkspaceRemote(
    workspaceRoot: string | null,
    remoteUrl: string,
  ): Promise<GithubRepo> {
    const repo = repoOf(remoteUrl);
    if (workspaceRoot === null) throw new Error('No workspace is open.');
    const remotes = await this.opts.remoteProvider.getRemotes(workspaceRoot);
    const allowed = remotes.some((remote) =>
      remoteUrlCandidates(remote).some((candidate) => {
        const candidateRepo = parseGithubRepo(candidate);
        return candidateRepo !== null && sameGithubRepo(candidateRepo, repo);
      }),
    );
    if (!allowed) {
      throw new Error('This GitHub remote is not configured for the current workspace.');
    }
    return repo;
  }

  private async githubRepositories(
    workspaceRoot: string | null,
  ): Promise<readonly GithubRemoteRepository[]> {
    const remotes = await this.opts.remoteProvider.getRemotes(workspaceRoot);
    return sortBaseRepositories(
      remotes
        .map(githubRepositoryFromRemote)
        .filter((repo): repo is GithubRemoteRepository => repo !== null),
    );
  }

  private async listUserRemoteSources(token: string): Promise<readonly RemoteSource[]> {
    const raw = await this.api.arrayPages<GithubRemoteSourceResponse>(
      token,
      '/user/repos?sort=updated',
    );
    return raw.map(asRemoteSource);
  }
}
