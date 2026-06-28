import type { SecretStore } from '../../../../platform/secrets/common/secrets.js';
import type {
  GhPrFile,
  GhPullRequest,
  GithubRemoteRepository,
  GithubRepo,
  GithubReviewArgs,
} from '../common/githubPullRequests.js';
import { GITHUB_TOKEN_SECRET_KEY } from './githubGitCredentials.js';

const API_BASE = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const GITHUB_PAGE_SIZE = 100;

export interface GithubHttpRequest {
  readonly method: 'GET' | 'POST' | 'PATCH';
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeoutMs?: number;
}

export interface GithubHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export type GithubHttpRunner = (req: GithubHttpRequest) => Promise<GithubHttpResponse>;

export type GithubSecretStore = SecretStore;

export interface GitRemoteInfoLike {
  readonly name: string;
  readonly fetchUrl?: string;
  readonly pushUrl?: string;
  readonly isReadOnly: boolean;
}

export interface GitRemoteProvider {
  getRemotes(workspaceRoot: string | null): Promise<readonly GitRemoteInfoLike[]>;
}

export interface GithubMainServiceOptions {
  readonly secrets: GithubSecretStore;
  readonly remoteProvider: GitRemoteProvider;
  readonly http?: GithubHttpRunner;
}

export async function defaultGithubHttp(req: GithubHttpRequest): Promise<GithubHttpResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), req.timeoutMs ?? 20_000);
  try {
    const init: RequestInit = {
      method: req.method,
      signal: controller.signal,
    };
    if (req.headers !== undefined) init.headers = { ...req.headers };
    if (req.body !== undefined) init.body = req.body;
    const res = await fetch(req.url, init);
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return {
      status: res.status,
      headers,
      body: await res.text(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function parseGithubRepo(remoteUrl: string): GithubRepo | null {
  const trimmed = remoteUrl.trim();
  if (trimmed === '') return null;
  let host: string;
  let path: string;
  const scp = /^[\w.-]+@([^:/]+):(.+)$/.exec(trimmed);
  if (scp) {
    host = scp[1] ?? '';
    path = scp[2] ?? '';
  } else {
    try {
      const u = new URL(trimmed);
      host = u.host;
      path = u.pathname.replace(/^\/+/, '');
    } catch {
      return null;
    }
  }
  if (host.toLowerCase() !== 'github.com') return null;
  const cleaned = path.replace(/\.git$/i, '').replace(/\/+$/, '');
  const parts = cleaned.split('/');
  if (parts.length < 2) return null;
  const owner = parts[0] ?? '';
  const repo = parts[1] ?? '';
  if (owner === '' || repo === '') return null;
  return { owner, repo };
}

const githubWebUrl = ({ owner, repo }: GithubRepo): string => `https://github.com/${owner}/${repo}`;

const createGithubPullRequestUrl = (
  base: GithubRepo,
  branch: string,
  head?: GithubRepo,
): string | null => {
  const trimmedBranch = branch.trim();
  if (trimmedBranch === '') return null;
  const compareHead =
    head !== undefined && !sameGithubRepo(base, head)
      ? `${head.owner}:${trimmedBranch}`
      : trimmedBranch;
  return `${githubWebUrl(base)}/compare/${encodeURIComponent(compareHead)}?expand=1`;
};

const remoteUrlCandidates = (remote: GitRemoteInfoLike): string[] =>
  [remote.pushUrl, remote.fetchUrl].filter(
    (url): url is string => typeof url === 'string' && url.trim() !== '',
  );

function githubRepositoryFromRemote(remote: GitRemoteInfoLike): GithubRemoteRepository | null {
  for (const remoteUrl of remoteUrlCandidates(remote)) {
    const repo = parseGithubRepo(remoteUrl);
    if (repo !== null) {
      return {
        remoteName: remote.name,
        remoteUrl,
        owner: repo.owner,
        repo: repo.repo,
        webUrl: githubWebUrl(repo),
        isReadOnly: remote.isReadOnly,
      };
    }
  }
  return null;
}

const baseRemotePriority = (remoteName: string): number =>
  remoteName === 'upstream' ? 0 : remoteName === 'origin' ? 1 : 2;

const headRemotePriority = (remoteName: string): number =>
  remoteName === 'origin' ? 0 : remoteName === 'upstream' ? 1 : 2;

function sameGithubRepo(a: GithubRepo, b: GithubRepo): boolean {
  return (
    a.owner.toLowerCase() === b.owner.toLowerCase() && a.repo.toLowerCase() === b.repo.toLowerCase()
  );
}

function repoOf(remoteUrl: string): GithubRepo {
  const r = parseGithubRepo(remoteUrl);
  if (r === null)
    throw new Error("This repository's remote is not github.com (not supported yet).");
  return r;
}

function appendPage(path: string, page: number): string {
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}per_page=${GITHUB_PAGE_SIZE}&page=${page}`;
}

export class GithubMainService {
  private readonly http: GithubHttpRunner;

  constructor(private readonly opts: GithubMainServiceOptions) {
    this.http = opts.http ?? defaultGithubHttp;
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
    const head = repos
      .filter((repo) => !repo.isReadOnly)
      .sort(
        (a, b) =>
          headRemotePriority(a.remoteName) - headRemotePriority(b.remoteName) ||
          a.remoteName.localeCompare(b.remoteName),
      )[0];
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
    const raw = await this.ghArrayPages<{
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
    const raw = await this.ghArrayPages<{
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
    await this.gh(token, 'POST', `/repos/${owner}/${repo}/pulls/${args.number}/reviews`, {
      event: args.event,
      ...(body !== '' && { body }),
    });
  }

  async signIn(token: unknown): Promise<string | null> {
    if (typeof token !== 'string') throw new Error('The GitHub token is invalid.');
    const login = await this.loginFor(token);
    if (login === null) {
      throw new Error(
        'The GitHub token is invalid or missing permissions (repo access is required for private repositories and pull request reviews).',
      );
    }
    await this.opts.secrets.set(GITHUB_TOKEN_SECRET_KEY, token);
    return login;
  }

  async signOut(): Promise<void> {
    await this.opts.secrets.delete(GITHUB_TOKEN_SECRET_KEY);
  }

  async viewer(): Promise<string | null> {
    const token = await this.opts.secrets.get(GITHUB_TOKEN_SECRET_KEY);
    if (token === null) return null;
    return this.loginFor(token);
  }

  private async requireToken(): Promise<string> {
    const token = await this.opts.secrets.get(GITHUB_TOKEN_SECRET_KEY);
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
    return remotes
      .map(githubRepositoryFromRemote)
      .filter((repo): repo is GithubRemoteRepository => repo !== null)
      .sort(
        (a, b) =>
          baseRemotePriority(a.remoteName) - baseRemotePriority(b.remoteName) ||
          a.remoteName.localeCompare(b.remoteName),
      );
  }

  private async ghArrayPages<T>(token: string, path: string): Promise<readonly T[]> {
    const all: T[] = [];
    for (let page = 1; ; page += 1) {
      const res = await this.gh(token, 'GET', appendPage(path, page));
      const raw = JSON.parse(res.body) as unknown;
      if (!Array.isArray(raw)) throw new Error('GitHub returned an unexpected response.');
      const items = raw as T[];
      all.push(...items);
      if (items.length < GITHUB_PAGE_SIZE) return all;
    }
  }

  private async gh(
    token: string,
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
  ): Promise<GithubHttpResponse> {
    const res = await this.http({
      method,
      url: `${API_BASE}${path}`,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': API_VERSION,
        'User-Agent': 'BaseHalf',
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    if (res.status >= 200 && res.status < 300) return res;
    if (res.status === 401)
      throw new Error('Your GitHub credentials are invalid or expired. Sign in again.');
    if (res.status === 403) {
      const rl = res.headers['x-ratelimit-remaining'];
      throw new Error(
        rl === '0'
          ? 'GitHub API rate limit reached. Try again later.'
          : 'GitHub denied access (insufficient permissions).',
      );
    }
    if (res.status === 404)
      throw new Error('Not found (the repository does not exist or the token cannot access it).');
    let detail = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(res.body) as { message?: string };
      if (typeof j.message === 'string' && j.message !== '') detail = j.message;
    } catch {
      // Non-JSON body.
    }
    throw new Error(`GitHub request failed: ${detail}`);
  }

  private async loginFor(token: string): Promise<string | null> {
    if (token.trim() === '') return null;
    try {
      const res = await this.gh(token, 'GET', '/user');
      const j = JSON.parse(res.body) as { login?: string };
      return typeof j.login === 'string' ? j.login : null;
    } catch {
      return null;
    }
  }
}

function parsePrPayload(payload: unknown): { remoteUrl: string; number: number } {
  if (typeof payload !== 'object' || payload === null) throw new Error('Invalid pull request.');
  const p = payload as { remoteUrl?: unknown; number?: unknown };
  if (typeof p.remoteUrl !== 'string') throw new Error('Invalid GitHub remote URL.');
  if (!Number.isInteger(p.number) || (p.number as number) <= 0) {
    throw new Error('Invalid pull request number.');
  }
  return { remoteUrl: p.remoteUrl, number: p.number as number };
}

function parseReviewArgs(payload: unknown): GithubReviewArgs {
  const { remoteUrl, number } = parsePrPayload(payload);
  const p = payload as { event?: unknown; body?: unknown };
  if (p.event !== 'APPROVE' && p.event !== 'REQUEST_CHANGES' && p.event !== 'COMMENT') {
    throw new Error('Invalid review event.');
  }
  return {
    remoteUrl,
    number,
    event: p.event,
    ...(typeof p.body === 'string' && { body: p.body }),
  };
}
