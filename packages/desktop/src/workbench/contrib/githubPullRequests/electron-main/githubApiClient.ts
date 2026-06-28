const API_BASE = 'https://api.github.com';
export const API_VERSION = '2022-11-28';
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

function appendPage(path: string, page: number): string {
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}per_page=${GITHUB_PAGE_SIZE}&page=${page}`;
}

export class GithubApiClient {
  constructor(private readonly http: GithubHttpRunner = defaultGithubHttp) {}

  async arrayPages<T>(token: string, path: string): Promise<readonly T[]> {
    const all: T[] = [];
    for (let page = 1; ; page += 1) {
      const res = await this.request(token, 'GET', appendPage(path, page));
      const raw = JSON.parse(res.body) as unknown;
      if (!Array.isArray(raw)) throw new Error('GitHub returned an unexpected response.');
      const items = raw as T[];
      all.push(...items);
      if (items.length < GITHUB_PAGE_SIZE) return all;
    }
  }

  async request(
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
    if (res.status === 401) {
      throw new Error('Your GitHub credentials are invalid or expired. Sign in again.');
    }
    if (res.status === 403) {
      const rl = res.headers['x-ratelimit-remaining'];
      throw new Error(
        rl === '0'
          ? 'GitHub API rate limit reached. Try again later.'
          : 'GitHub denied access (insufficient permissions).',
      );
    }
    if (res.status === 404) {
      throw new Error('Not found (the repository does not exist or the token cannot access it).');
    }
    let detail = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(res.body) as { message?: string };
      if (typeof j.message === 'string' && j.message !== '') detail = j.message;
    } catch {
      // Non-JSON body.
    }
    throw new Error(`GitHub request failed: ${detail}`);
  }

  async loginFor(token: string): Promise<string | null> {
    if (token.trim() === '') return null;
    let res: GithubHttpResponse;
    try {
      res = await this.request(token, 'GET', '/user');
    } catch (err) {
      if (err instanceof Error && /invalid or expired/i.test(err.message)) return null;
      throw err;
    }
    const j = JSON.parse(res.body) as { login?: string };
    if (typeof j.login !== 'string' || j.login === '') {
      throw new Error('GitHub returned an unexpected user response.');
    }
    return j.login;
  }
}
