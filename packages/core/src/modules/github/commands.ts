import type { Context, Handler, HttpResponse } from '../../kernel/index.js';
import type {
  GhPrFile,
  GhPullRequest,
  GithubListPullRequestsArgs,
  GithubListPullRequestsResult,
  GithubPullRequestFilesArgs,
  GithubPullRequestFilesResult,
  GithubRepo,
  GithubViewerArgs,
  GithubViewerResult,
} from './types.js';

/**
 * The `github` remote provider — GitHub REST API over the injected `ctx.http`.
 * No SDK: a thin, faithful client (one shared request helper that adds the auth +
 * versioning headers and maps error statuses to clear messages). The token is an
 * argument the host supplies from secure storage; this layer never persists it.
 */

const API_BASE = 'https://api.github.com';
const API_VERSION = '2022-11-28';

/** Parse `{ owner, repo }` from a github.com git remote URL (https / scp-ssh /
 *  ssh://). Returns null for a non-github.com host or an unparseable URL. */
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

function repoOf(remoteUrl: string): GithubRepo {
  const r = parseGithubRepo(remoteUrl);
  if (r === null) throw new Error('当前仓库的远程地址不是 github.com，暂不支持。');
  return r;
}

/** One authenticated GitHub API call. Throws a clear, localized error on failure. */
async function gh(
  ctx: Context,
  token: string,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown,
): Promise<HttpResponse> {
  const res = await ctx.http({
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
  if (res.status === 401) throw new Error('GitHub 凭证无效或已过期，请重新登录。');
  if (res.status === 403) {
    const rl = res.headers['x-ratelimit-remaining'];
    throw new Error(
      rl === '0' ? 'GitHub API 速率受限，请稍后再试。' : 'GitHub 拒绝访问（权限不足）。',
    );
  }
  if (res.status === 404) throw new Error('找不到该资源（仓库不存在或 token 无访问权限）。');
  // Surface GitHub's own message when present.
  let detail = `HTTP ${res.status}`;
  try {
    const j = JSON.parse(res.body) as { message?: string };
    if (typeof j.message === 'string' && j.message !== '') detail = j.message;
  } catch {
    /* non-JSON body */
  }
  throw new Error(`GitHub 请求失败：${detail}`);
}

export const listPullRequests: Handler<
  GithubListPullRequestsArgs,
  GithubListPullRequestsResult
> = async (args, ctx) => {
  const { owner, repo } = repoOf(args.remoteUrl);
  const state = args.state ?? 'open';
  const res = await gh(
    ctx,
    args.token,
    'GET',
    `/repos/${owner}/${repo}/pulls?state=${state}&per_page=50&sort=updated&direction=desc`,
  );
  const raw = JSON.parse(res.body) as Array<{
    number: number;
    title: string;
    state: string;
    draft?: boolean;
    html_url: string;
    updated_at: string;
    user?: { login?: string };
    head?: { ref?: string };
    base?: { ref?: string };
  }>;
  const pullRequests: GhPullRequest[] = raw.map((p) => ({
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
  return { pullRequests };
};

export const pullRequestFiles: Handler<
  GithubPullRequestFilesArgs,
  GithubPullRequestFilesResult
> = async (args, ctx) => {
  if (!Number.isInteger(args.number) || args.number <= 0) {
    throw new Error('无效的 PR 编号。');
  }
  const { owner, repo } = repoOf(args.remoteUrl);
  const res = await gh(
    ctx,
    args.token,
    'GET',
    `/repos/${owner}/${repo}/pulls/${args.number}/files?per_page=100`,
  );
  const raw = JSON.parse(res.body) as Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    patch?: string;
    previous_filename?: string;
  }>;
  const files: GhPrFile[] = raw.map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    ...(f.patch !== undefined && { patch: f.patch }),
    ...(f.previous_filename !== undefined && { previousFilename: f.previous_filename }),
  }));
  return { files };
};

export const viewer: Handler<GithubViewerArgs, GithubViewerResult> = async (args, ctx) => {
  if (args.token.trim() === '') return { login: null };
  try {
    const res = await gh(ctx, args.token, 'GET', '/user');
    const j = JSON.parse(res.body) as { login?: string };
    return { login: typeof j.login === 'string' ? j.login : null };
  } catch {
    // An invalid token (401) or any failure → not authenticated.
    return { login: null };
  }
};
