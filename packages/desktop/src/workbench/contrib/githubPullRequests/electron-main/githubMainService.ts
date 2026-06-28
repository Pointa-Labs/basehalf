import type {
  GhPrFile,
  GhPullRequest,
  GithubRemoteRepository,
  GithubRepo,
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

export interface GithubTokenProvider {
  getToken(): Promise<string | null>;
}

export interface GithubMainServiceOptions {
  readonly tokenProvider: GithubTokenProvider;
  readonly remoteProvider: GitRemoteProvider;
  readonly http?: GithubHttpRunner;
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
    const token = await this.opts.tokenProvider.getToken();
    if (token === null || token.trim() === '') {
      throw new Error('Not signed in to GitHub. Sign in from Settings.');
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
}
