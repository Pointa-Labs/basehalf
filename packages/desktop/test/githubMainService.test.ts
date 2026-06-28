import { describe, expect, it } from 'vitest';
import type { GithubReviewArgs } from '../src/workbench/contrib/githubPullRequests/common/githubPullRequests.js';
import {
  type GithubHttpRequest,
  type GithubHttpResponse,
  GithubMainService,
  type GithubSecretStore,
  parseGithubRepo,
} from '../src/workbench/contrib/githubPullRequests/electron-main/githubMainService.js';

const ROOT = '/repo';

function makeFakeHttp(reply: (req: GithubHttpRequest) => Partial<GithubHttpResponse>): {
  http: (req: GithubHttpRequest) => Promise<GithubHttpResponse>;
  calls: GithubHttpRequest[];
} {
  const calls: GithubHttpRequest[] = [];
  const http = async (req: GithubHttpRequest): Promise<GithubHttpResponse> => {
    calls.push(req);
    const r = reply(req);
    return { status: r.status ?? 200, headers: r.headers ?? {}, body: r.body ?? '' };
  };
  return { http, calls };
}

function secretsWithToken(token: string | null = null): GithubSecretStore {
  let current = token;
  return {
    async get() {
      return current;
    },
    async set(_key, value) {
      current = value;
    },
    async delete() {
      current = null;
    },
  };
}

const emptyRemoteProvider = {
  getRemotes: async () => [],
};

const GITHUB_OR_REMOTE =
  'origin\thttps://github.com/o/r.git (fetch)\norigin\thttps://github.com/o/r.git (push)\n';

const serviceWithRemotes = (
  remoteVerbose: string,
  options: { http?: (req: GithubHttpRequest) => Promise<GithubHttpResponse>; token?: string } = {},
): GithubMainService =>
  new GithubMainService({
    secrets: secretsWithToken(options.token ?? null),
    http: options.http,
    remoteProvider: {
      getRemotes: async (workspaceRoot) => {
        expect(workspaceRoot).toBe(ROOT);
        return parseGitRemoteVerbose(remoteVerbose);
      },
    },
  });

function parseGitRemoteVerbose(text: string) {
  const byName = new Map<
    string,
    { name: string; fetchUrl?: string; pushUrl?: string; isReadOnly: boolean }
  >();
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line);
    if (!match) continue;
    const [, name = '', url = '', kind = ''] = match;
    const existing = byName.get(name) ?? { name, isReadOnly: false };
    if (kind === 'fetch') existing.fetchUrl = url;
    else existing.pushUrl = url === 'no_push' ? undefined : url;
    existing.isReadOnly = existing.pushUrl === undefined;
    byName.set(name, existing);
  }
  return [...byName.values()];
}

describe('parseGithubRepo', () => {
  it('parses https / ssh github.com URLs', () => {
    expect(parseGithubRepo('https://github.com/o/r.git')).toEqual({ owner: 'o', repo: 'r' });
    expect(parseGithubRepo('git@github.com:o/r.git')).toEqual({ owner: 'o', repo: 'r' });
  });
  it('rejects non-github hosts and junk', () => {
    expect(parseGithubRepo('https://gitlab.com/o/r.git')).toBeNull();
    expect(parseGithubRepo('nonsense')).toBeNull();
  });
});

describe('GithubMainService repository / createPullRequestUrl', () => {
  it('selects upstream as the preferred GitHub base remote when a fork origin exists', async () => {
    const service = serviceWithRemotes(
      'upstream\thttps://github.com/upstream/repo.git (fetch)\nupstream\tno_push (push)\norigin\tgit@github.com:owner/repo.git (fetch)\norigin\tgit@github.com:owner/repo.git (push)\n',
    );
    await expect(service.repository(ROOT)).resolves.toEqual({
      remoteName: 'upstream',
      remoteUrl: 'https://github.com/upstream/repo.git',
      owner: 'upstream',
      repo: 'repo',
      webUrl: 'https://github.com/upstream/repo',
      isReadOnly: true,
    });
  });

  it('falls back to upstream when origin is not a GitHub remote', async () => {
    const service = serviceWithRemotes(
      'origin\thttps://gitlab.com/o/r.git (fetch)\norigin\thttps://gitlab.com/o/r.git (push)\nupstream\thttps://github.com/upstream/repo.git (fetch)\nupstream\tno_push (push)\n',
    );
    await expect(service.repository(ROOT)).resolves.toEqual({
      remoteName: 'upstream',
      remoteUrl: 'https://github.com/upstream/repo.git',
      owner: 'upstream',
      repo: 'repo',
      webUrl: 'https://github.com/upstream/repo',
      isReadOnly: true,
    });
  });

  it('creates the GitHub pull request action URL from the selected remote', async () => {
    const service = serviceWithRemotes(
      'origin\thttps://github.com/owner/repo.git (fetch)\norigin\thttps://github.com/owner/repo.git (push)\n',
    );
    await expect(service.createPullRequestUrl(ROOT, 'feature/x')).resolves.toBe(
      'https://github.com/owner/repo/compare/feature%2Fx?expand=1',
    );
  });

  it('creates pull request URLs against upstream with an origin fork head when available', async () => {
    const service = serviceWithRemotes(
      'upstream\thttps://github.com/base/repo.git (fetch)\nupstream\tno_push (push)\norigin\tgit@github.com:fork/repo.git (fetch)\norigin\tgit@github.com:fork/repo.git (push)\n',
    );
    await expect(service.createPullRequestUrl(ROOT, 'feature/x')).resolves.toBe(
      'https://github.com/base/repo/compare/fork%3Afeature%2Fx?expand=1',
    );
  });

  it('returns null when no GitHub remote is configured', async () => {
    const service = serviceWithRemotes(
      'origin\thttps://gitlab.com/owner/repo.git (fetch)\norigin\thttps://gitlab.com/owner/repo.git (push)\n',
    );
    await expect(service.repository(ROOT)).resolves.toBeNull();
    await expect(service.createPullRequestUrl(ROOT, 'feature/x')).resolves.toBeNull();
  });
});

describe('GithubMainService pull request API', () => {
  it('calls the pulls endpoint with auth + parses the response', async () => {
    const { http, calls } = makeFakeHttp(() => ({
      body: JSON.stringify([
        {
          number: 7,
          title: 'Add thing',
          state: 'open',
          draft: false,
          html_url: 'https://github.com/o/r/pull/7',
          updated_at: '2026-06-27T10:00:00Z',
          user: { login: 'ada' },
          head: { ref: 'feature/x' },
          base: { ref: 'main' },
        },
      ]),
    }));
    const service = serviceWithRemotes(GITHUB_OR_REMOTE, { http, token: 'tok' });
    const pullRequests = await service.listPullRequests(ROOT, 'git@github.com:o/r.git');

    expect(calls[0]?.url).toBe(
      'https://api.github.com/repos/o/r/pulls?state=open&sort=updated&direction=desc&per_page=100&page=1',
    );
    expect(calls[0]?.headers?.Authorization).toBe('Bearer tok');
    expect(calls[0]?.headers?.['X-GitHub-Api-Version']).toBe('2022-11-28');
    expect(pullRequests).toEqual([
      {
        number: 7,
        title: 'Add thing',
        author: 'ada',
        state: 'open',
        draft: false,
        headRef: 'feature/x',
        baseRef: 'main',
        url: 'https://github.com/o/r/pull/7',
        updatedAt: '2026-06-27T10:00:00Z',
      },
    ]);
  });

  it('paginates pull request results instead of truncating at the first page', async () => {
    const { http, calls } = makeFakeHttp((req) => {
      const page = new URL(req.url).searchParams.get('page');
      const count = page === '1' ? 100 : 1;
      return {
        body: JSON.stringify(
          Array.from({ length: count }, (_, i) => ({
            number: page === '1' ? i + 1 : 101,
            title: `PR ${page}-${i}`,
            state: 'open',
            html_url: 'https://github.com/o/r/pull/x',
            updated_at: '2026-06-27T10:00:00Z',
          })),
        ),
      };
    });
    const service = serviceWithRemotes(GITHUB_OR_REMOTE, { http, token: 'tok' });
    const pullRequests = await service.listPullRequests(ROOT, 'https://github.com/o/r.git');

    expect(calls.map((c) => new URL(c.url).searchParams.get('page'))).toEqual(['1', '2']);
    expect(pullRequests).toHaveLength(101);
    expect(pullRequests.at(-1)?.number).toBe(101);
  });

  it('maps credential and remote errors without touching the network unnecessarily', async () => {
    const badAuth = serviceWithRemotes(GITHUB_OR_REMOTE, {
      http: makeFakeHttp(() => ({ status: 401, body: '{"message":"Bad credentials"}' })).http,
      token: 'x',
    });
    await expect(badAuth.listPullRequests(ROOT, 'https://github.com/o/r')).rejects.toThrow(
      /invalid or expired/,
    );

    const { http, calls } = makeFakeHttp(() => ({}));
    const service = serviceWithRemotes(GITHUB_OR_REMOTE, { http, token: 'x' });
    await expect(service.listPullRequests(ROOT, 'https://gitlab.com/o/r')).rejects.toThrow(
      /not github\.com/,
    );
    expect(calls).toHaveLength(0);

    const signedOut = serviceWithRemotes(GITHUB_OR_REMOTE, { http });
    await expect(signedOut.listPullRequests(ROOT, 'https://github.com/o/r')).rejects.toThrow(
      /Not signed in/,
    );
  });

  it('rejects renderer-supplied GitHub remotes that are not in the workspace', async () => {
    const { http, calls } = makeFakeHttp(() => ({}));
    const service = serviceWithRemotes(GITHUB_OR_REMOTE, { http, token: 'tok' });

    await expect(
      service.listPullRequests(ROOT, 'https://github.com/other/repo.git'),
    ).rejects.toThrow(/not configured/);
    await expect(service.listPullRequests(null, 'https://github.com/o/r.git')).rejects.toThrow(
      /No workspace/,
    );
    expect(calls).toHaveLength(0);
  });

  it('parses pull request files and rejects invalid PR numbers before token lookup', async () => {
    const { http, calls } = makeFakeHttp(() => ({
      body: JSON.stringify([
        { filename: 'a.ts', status: 'modified', additions: 3, deletions: 1, patch: '@@ -1 +1 @@' },
        {
          filename: 'b.ts',
          status: 'renamed',
          additions: 0,
          deletions: 0,
          previous_filename: 'old.ts',
        },
      ]),
    }));
    const service = serviceWithRemotes(GITHUB_OR_REMOTE, { http, token: 't' });
    const files = await service.pullRequestFiles(ROOT, {
      remoteUrl: 'https://github.com/o/r.git',
      number: 7,
    });
    expect(calls[0]?.url).toBe(
      'https://api.github.com/repos/o/r/pulls/7/files?per_page=100&page=1',
    );
    expect(files[0]).toMatchObject({ filename: 'a.ts', additions: 3, patch: '@@ -1 +1 @@' });
    expect(files[1]).toMatchObject({ filename: 'b.ts', previousFilename: 'old.ts' });

    const noTokenNeeded = new GithubMainService({
      http,
      secrets: secretsWithToken(),
      remoteProvider: emptyRemoteProvider,
    });
    await expect(
      noTokenNeeded.pullRequestFiles(null, { remoteUrl: 'https://github.com/o/r', number: 0 }),
    ).rejects.toThrow(/Invalid pull request number/);
  });

  it('posts reviews and validates non-approve bodies', async () => {
    const { http, calls } = makeFakeHttp(() => ({ body: '{"state":"APPROVED","html_url":"u"}' }));
    const service = serviceWithRemotes(GITHUB_OR_REMOTE, { http, token: 't' });
    await service.reviewPullRequest(ROOT, {
      remoteUrl: 'https://github.com/o/r',
      number: 7,
      event: 'APPROVE',
    });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('https://api.github.com/repos/o/r/pulls/7/reviews');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ event: 'APPROVE' });

    const comment: GithubReviewArgs = {
      remoteUrl: 'https://github.com/o/r',
      number: 7,
      event: 'COMMENT',
      body: 'nice',
    };
    await service.reviewPullRequest(ROOT, comment);
    expect(JSON.parse(calls[1]?.body ?? '{}')).toEqual({ event: 'COMMENT', body: 'nice' });

    await expect(
      service.reviewPullRequest(ROOT, {
        remoteUrl: 'https://github.com/o/r',
        number: 7,
        event: 'REQUEST_CHANGES',
        body: '  ',
      }),
    ).rejects.toThrow(/require a message/);
  });
});

describe('GithubMainService signIn / signOut / viewer', () => {
  it('signIn verifies + stores the token; viewer then reports the login; signOut clears', async () => {
    const { http } = makeFakeHttp(() => ({ body: '{"login":"ada"}' }));
    const secrets = secretsWithToken();
    const service = new GithubMainService({ http, secrets, remoteProvider: emptyRemoteProvider });

    await expect(service.signIn('tok')).resolves.toBe('ada');
    await expect(secrets.get('github.token')).resolves.toBe('tok');
    await expect(service.viewer()).resolves.toBe('ada');
    await service.signOut();
    await expect(secrets.get('github.token')).resolves.toBeNull();
    await expect(service.viewer()).resolves.toBeNull();
  });

  it('signIn rejects an invalid token and does NOT store it', async () => {
    const { http } = makeFakeHttp(() => ({ status: 401, body: '{"message":"Bad credentials"}' }));
    const secrets = secretsWithToken();
    const service = new GithubMainService({ http, secrets, remoteProvider: emptyRemoteProvider });
    await expect(service.signIn('bad')).rejects.toThrow(/invalid or missing permissions/);
    await expect(secrets.get('github.token')).resolves.toBeNull();
  });

  it('viewer is null when nothing is stored (no request)', async () => {
    const { http, calls } = makeFakeHttp(() => ({}));
    const service = new GithubMainService({
      http,
      secrets: secretsWithToken(),
      remoteProvider: emptyRemoteProvider,
    });
    await expect(service.viewer()).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });
});
