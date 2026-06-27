import { describe, expect, it } from 'vitest';
import type { GitRunner, HttpRequest, HttpResponse, SecretStore } from '../src/index.js';
import { createCore, createInMemorySecrets } from '../src/index.js';
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

function makeFakeGit(remoteVerbose: string): GitRunner {
  return async (args, opts) => {
    expect(opts.cwd).toBe(ROOT.workspaceRoot);
    if (args[0] === 'remote' && args[1] === '--verbose') {
      return { stdout: remoteVerbose, stderr: '', exitCode: 0 };
    }
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  };
}

/** An in-memory secret store pre-seeded with a github token. */
async function secretsWithToken(token: string): Promise<SecretStore> {
  const s = createInMemorySecrets();
  await s.set('github.token', token);
  return s;
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

describe('github.repository / createPullRequestUrl', () => {
  it('selects the preferred GitHub remote using the provider boundary', async () => {
    const git = makeFakeGit(
      'upstream\thttps://github.com/upstream/repo.git (fetch)\nupstream\tno_push (push)\norigin\tgit@github.com:owner/repo.git (fetch)\norigin\tgit@github.com:owner/repo.git (push)\n',
    );
    const core = createCore({ git, configDir: '/cfg' });
    expect(await core.run('github.repository', {}, ROOT)).toEqual({
      repository: {
        remoteName: 'origin',
        remoteUrl: 'git@github.com:owner/repo.git',
        owner: 'owner',
        repo: 'repo',
        webUrl: 'https://github.com/owner/repo',
        isReadOnly: false,
      },
    });
  });

  it('falls back to upstream when origin is not a GitHub remote', async () => {
    const git = makeFakeGit(
      'origin\thttps://gitlab.com/o/r.git (fetch)\norigin\thttps://gitlab.com/o/r.git (push)\nupstream\thttps://github.com/upstream/repo.git (fetch)\nupstream\tno_push (push)\n',
    );
    const core = createCore({ git, configDir: '/cfg' });
    expect(await core.run('github.repository', {}, ROOT)).toEqual({
      repository: {
        remoteName: 'upstream',
        remoteUrl: 'https://github.com/upstream/repo.git',
        owner: 'upstream',
        repo: 'repo',
        webUrl: 'https://github.com/upstream/repo',
        isReadOnly: true,
      },
    });
  });

  it('creates the GitHub pull request action URL from the selected remote', async () => {
    const git = makeFakeGit(
      'origin\thttps://github.com/owner/repo.git (fetch)\norigin\thttps://github.com/owner/repo.git (push)\n',
    );
    const core = createCore({ git, configDir: '/cfg' });
    expect(await core.run('github.createPullRequestUrl', { branch: 'feature/x' }, ROOT)).toEqual({
      url: 'https://github.com/owner/repo/compare/feature%2Fx?expand=1',
      repository: {
        remoteName: 'origin',
        remoteUrl: 'https://github.com/owner/repo.git',
        owner: 'owner',
        repo: 'repo',
        webUrl: 'https://github.com/owner/repo',
        isReadOnly: false,
      },
    });
  });

  it('returns null when no GitHub remote is configured', async () => {
    const git = makeFakeGit(
      'origin\thttps://gitlab.com/owner/repo.git (fetch)\norigin\thttps://gitlab.com/owner/repo.git (push)\n',
    );
    const core = createCore({ git, configDir: '/cfg' });
    expect(await core.run('github.repository', {}, ROOT)).toEqual({ repository: null });
    expect(await core.run('github.createPullRequestUrl', { branch: 'feature/x' }, ROOT)).toEqual({
      url: null,
    });
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
    const core = createCore({ http, secrets: await secretsWithToken('tok'), configDir: '/cfg' });
    const r = (await core.run(
      'github.listPullRequests',
      { remoteUrl: 'git@github.com:o/r.git' },
      ROOT,
    )) as { pullRequests: Array<{ number: number; author: string; headRef: string }> };
    expect(calls[0]?.url).toBe(
      'https://api.github.com/repos/o/r/pulls?state=open&sort=updated&direction=desc&per_page=100&page=1',
    );
    expect(calls[0]?.headers?.Authorization).toBe('Bearer tok'); // from the STORED token
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
    const core = createCore({ http, secrets: await secretsWithToken('tok'), configDir: '/cfg' });
    const r = (await core.run(
      'github.listPullRequests',
      { remoteUrl: 'https://github.com/o/r.git' },
      ROOT,
    )) as { pullRequests: Array<{ number: number }> };

    expect(calls.map((c) => new URL(c.url).searchParams.get('page'))).toEqual(['1', '2']);
    expect(r.pullRequests).toHaveLength(101);
    expect(r.pullRequests.at(-1)?.number).toBe(101);
  });

  it('maps 401 to a clear credential error', async () => {
    const { http } = makeFakeHttp(() => ({ status: 401, body: '{"message":"Bad credentials"}' }));
    const core = createCore({ http, secrets: await secretsWithToken('x'), configDir: '/cfg' });
    await expect(
      core.run('github.listPullRequests', { remoteUrl: 'https://github.com/o/r' }, ROOT),
    ).rejects.toThrow(/invalid or expired/);
  });

  it('refuses a non-github remote (after the token check, before any request)', async () => {
    const { http, calls } = makeFakeHttp(() => ({}));
    const core = createCore({ http, secrets: await secretsWithToken('x'), configDir: '/cfg' });
    await expect(
      core.run('github.listPullRequests', { remoteUrl: 'https://gitlab.com/o/r' }, ROOT),
    ).rejects.toThrow(/not github\.com/);
    expect(calls).toHaveLength(0);
  });

  it('requires sign-in (no stored token → clear error, no request)', async () => {
    const { http, calls } = makeFakeHttp(() => ({}));
    const core = createCore({ http, configDir: '/cfg' }); // in-memory secrets, empty
    await expect(
      core.run('github.listPullRequests', { remoteUrl: 'https://github.com/o/r' }, ROOT),
    ).rejects.toThrow(/Not signed in/);
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
    const core = createCore({ http, secrets: await secretsWithToken('t'), configDir: '/cfg' });
    const r = (await core.run(
      'github.pullRequestFiles',
      { remoteUrl: 'https://github.com/o/r.git', number: 7 },
      ROOT,
    )) as { files: Array<{ filename: string; patch?: string; previousFilename?: string }> };
    expect(calls[0]?.url).toBe(
      'https://api.github.com/repos/o/r/pulls/7/files?per_page=100&page=1',
    );
    expect(r.files[0]).toMatchObject({ filename: 'a.ts', additions: 3, patch: '@@ -1 +1 @@' });
    expect(r.files[1]).toMatchObject({ filename: 'b.ts', previousFilename: 'old.ts' });
  });

  it('paginates pull request files', async () => {
    const { http, calls } = makeFakeHttp((req) => {
      const page = new URL(req.url).searchParams.get('page');
      const count = page === '1' ? 100 : 1;
      return {
        body: JSON.stringify(
          Array.from({ length: count }, (_, i) => ({
            filename: `file-${page}-${i}.ts`,
            status: 'modified',
            additions: 1,
            deletions: 0,
          })),
        ),
      };
    });
    const core = createCore({ http, secrets: await secretsWithToken('t'), configDir: '/cfg' });
    const r = (await core.run(
      'github.pullRequestFiles',
      { remoteUrl: 'https://github.com/o/r.git', number: 7 },
      ROOT,
    )) as { files: Array<{ filename: string }> };

    expect(calls.map((c) => new URL(c.url).searchParams.get('page'))).toEqual(['1', '2']);
    expect(r.files).toHaveLength(101);
    expect(r.files.at(-1)?.filename).toBe('file-2-0.ts');
  });

  it('rejects a bad PR number (before the token check)', async () => {
    const { http } = makeFakeHttp(() => ({}));
    const core = createCore({ http, configDir: '/cfg' });
    await expect(
      core.run('github.pullRequestFiles', { remoteUrl: 'https://github.com/o/r', number: 0 }, ROOT),
    ).rejects.toThrow(/Invalid pull request number/);
  });
});

describe('github.reviewPullRequest', () => {
  it('APPROVE posts to /reviews with no body required', async () => {
    const { http, calls } = makeFakeHttp(() => ({ body: '{"state":"APPROVED","html_url":"u"}' }));
    const core = createCore({ http, secrets: await secretsWithToken('t'), configDir: '/cfg' });
    const r = (await core.run(
      'github.reviewPullRequest',
      { remoteUrl: 'https://github.com/o/r', number: 7, event: 'APPROVE' },
      ROOT,
    )) as { state: string };
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('https://api.github.com/repos/o/r/pulls/7/reviews');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ event: 'APPROVE' });
    expect(r.state).toBe('APPROVED');
  });

  it('COMMENT/REQUEST_CHANGES include the body; empty body is rejected before any request', async () => {
    const { http, calls } = makeFakeHttp(() => ({ body: '{"state":"COMMENTED"}' }));
    const core = createCore({ http, secrets: await secretsWithToken('t'), configDir: '/cfg' });
    await core.run(
      'github.reviewPullRequest',
      { remoteUrl: 'https://github.com/o/r', number: 7, event: 'COMMENT', body: 'nice' },
      ROOT,
    );
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ event: 'COMMENT', body: 'nice' });

    await expect(
      core.run(
        'github.reviewPullRequest',
        { remoteUrl: 'https://github.com/o/r', number: 7, event: 'REQUEST_CHANGES', body: '  ' },
        ROOT,
      ),
    ).rejects.toThrow(/require a message/);
    expect(calls).toHaveLength(1); // the rejected one never hit the network
  });
});

describe('github.signIn / signOut / viewer (secrets-backed)', () => {
  it('signIn verifies + stores the token; viewer then reports the login; signOut clears', async () => {
    const { http } = makeFakeHttp(() => ({ body: '{"login":"ada"}' }));
    const secrets = createInMemorySecrets();
    const core = createCore({ http, secrets, configDir: '/cfg' });

    const si = (await core.run('github.signIn', { token: 'tok' }, ROOT)) as { login: string };
    expect(si.login).toBe('ada');
    expect(await secrets.get('github.token')).toBe('tok'); // persisted

    const v = (await core.run('github.viewer', {}, ROOT)) as { login: string | null };
    expect(v.login).toBe('ada');

    await core.run('github.signOut', {}, ROOT);
    expect(await secrets.get('github.token')).toBeNull();
    expect(((await core.run('github.viewer', {}, ROOT)) as { login: null }).login).toBeNull();
  });

  it('signIn rejects an invalid token and does NOT store it', async () => {
    const { http } = makeFakeHttp(() => ({ status: 401, body: '{"message":"Bad credentials"}' }));
    const secrets = createInMemorySecrets();
    const core = createCore({ http, secrets, configDir: '/cfg' });
    await expect(core.run('github.signIn', { token: 'bad' }, ROOT)).rejects.toThrow(
      /invalid or missing scope/,
    );
    expect(await secrets.get('github.token')).toBeNull();
  });

  it('viewer is null when nothing is stored (no request)', async () => {
    const { http, calls } = makeFakeHttp(() => ({}));
    const core = createCore({ http, configDir: '/cfg' });
    expect(((await core.run('github.viewer', {}, ROOT)) as { login: null }).login).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
