import { describe, expect, it } from 'vitest';
import type { HttpRequest, HttpResponse } from '../src/index.js';
import { createCore } from '../src/index.js';
import { parseGithubRepo } from '../src/modules/github/commands.js';

const ROOT = { workspaceRoot: '/repo' };

/** A fake HttpRunner that records requests and replies from a router. */
function makeFakeHttp(reply: (req: HttpRequest) => Partial<HttpResponse>): {
  http: (req: HttpRequest) => Promise<HttpResponse>;
  calls: HttpRequest[];
} {
  const calls: HttpRequest[] = [];
  const http = async (req: HttpRequest): Promise<HttpResponse> => {
    calls.push(req);
    const r = reply(req);
    return { status: r.status ?? 200, headers: r.headers ?? {}, body: r.body ?? '' };
  };
  return { http, calls };
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

describe('github.listPullRequests', () => {
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
    const core = createCore({ http, configDir: '/cfg' });
    const r = (await core.run(
      'github.listPullRequests',
      { token: 'tok', remoteUrl: 'git@github.com:o/r.git' },
      ROOT,
    )) as { pullRequests: Array<{ number: number; author: string; headRef: string }> };
    expect(calls[0]?.url).toBe(
      'https://api.github.com/repos/o/r/pulls?state=open&per_page=50&sort=updated&direction=desc',
    );
    expect(calls[0]?.headers?.Authorization).toBe('Bearer tok');
    expect(calls[0]?.headers?.['X-GitHub-Api-Version']).toBe('2022-11-28');
    expect(r.pullRequests).toEqual([
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

  it('maps 401 to a clear credential error', async () => {
    const { http } = makeFakeHttp(() => ({ status: 401, body: '{"message":"Bad credentials"}' }));
    const core = createCore({ http, configDir: '/cfg' });
    await expect(
      core.run(
        'github.listPullRequests',
        { token: 'x', remoteUrl: 'https://github.com/o/r' },
        ROOT,
      ),
    ).rejects.toThrow(/凭证无效/);
  });

  it('refuses a non-github remote before any request', async () => {
    const { http, calls } = makeFakeHttp(() => ({}));
    const core = createCore({ http, configDir: '/cfg' });
    await expect(
      core.run(
        'github.listPullRequests',
        { token: 'x', remoteUrl: 'https://gitlab.com/o/r' },
        ROOT,
      ),
    ).rejects.toThrow(/不是 github\.com/);
    expect(calls).toHaveLength(0);
  });
});

describe('github.pullRequestFiles', () => {
  it('parses the files endpoint incl. patch + rename', async () => {
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
    const core = createCore({ http, configDir: '/cfg' });
    const r = (await core.run(
      'github.pullRequestFiles',
      { token: 't', remoteUrl: 'https://github.com/o/r.git', number: 7 },
      ROOT,
    )) as { files: Array<{ filename: string; patch?: string; previousFilename?: string }> };
    expect(calls[0]?.url).toBe('https://api.github.com/repos/o/r/pulls/7/files?per_page=100');
    expect(r.files[0]).toMatchObject({ filename: 'a.ts', additions: 3, patch: '@@ -1 +1 @@' });
    expect(r.files[1]).toMatchObject({ filename: 'b.ts', previousFilename: 'old.ts' });
  });

  it('rejects a bad PR number', async () => {
    const { http } = makeFakeHttp(() => ({}));
    const core = createCore({ http, configDir: '/cfg' });
    await expect(
      core.run(
        'github.pullRequestFiles',
        { token: 't', remoteUrl: 'https://github.com/o/r', number: 0 },
        ROOT,
      ),
    ).rejects.toThrow(/无效的 PR 编号/);
  });
});

describe('github.viewer', () => {
  it('returns the login for a valid token, null for invalid', async () => {
    const okHttp = makeFakeHttp(() => ({ body: '{"login":"ada"}' }));
    const core1 = createCore({ http: okHttp.http, configDir: '/cfg' });
    expect(
      ((await core1.run('github.viewer', { token: 't' }, ROOT)) as { login: string }).login,
    ).toBe('ada');

    const badHttp = makeFakeHttp(() => ({ status: 401, body: '{"message":"Bad credentials"}' }));
    const core2 = createCore({ http: badHttp.http, configDir: '/cfg' });
    expect(
      ((await core2.run('github.viewer', { token: 'x' }, ROOT)) as { login: null }).login,
    ).toBeNull();
    // An empty token short-circuits without a request.
    expect(
      ((await core2.run('github.viewer', { token: '  ' }, ROOT)) as { login: null }).login,
    ).toBeNull();
  });
});
