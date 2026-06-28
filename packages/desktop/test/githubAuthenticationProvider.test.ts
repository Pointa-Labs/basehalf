import { describe, expect, it } from 'vitest';
import {
  GithubAuthenticationProvider,
  type GithubSecretStore,
} from '../src/workbench/contrib/githubPullRequests/electron-main/githubAuthenticationProvider.js';
import type {
  GithubHttpRequest,
  GithubHttpResponse,
} from '../src/workbench/contrib/githubPullRequests/electron-main/githubMainService.js';
import { GITHUB_AUTH_PROVIDER_ID } from '../src/workbench/services/authentication/common/authentication.js';

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

describe('GithubAuthenticationProvider', () => {
  it('verifies + stores tokens, then exposes a GitHub authentication session', async () => {
    const { http } = makeFakeHttp(() => ({ body: '{"login":"ada"}' }));
    const secrets = secretsWithToken();
    const provider = new GithubAuthenticationProvider({ http, secrets });
    const events: unknown[] = [];
    provider.onDidChangeSessions((event) => events.push(event));

    await expect(provider.getSessions()).resolves.toEqual([]);
    const signedIn = await provider.createSession('tok');
    await expect(secrets.get('github.token')).resolves.toBe('tok');
    await expect(provider.getToken()).resolves.toBe('tok');
    expect(signedIn).toMatchObject({
      id: 'github',
      providerId: GITHUB_AUTH_PROVIDER_ID,
      account: { label: 'ada' },
      scopes: ['repo'],
    });
    expect(signedIn).not.toHaveProperty('accessToken');
    await expect(provider.getSessions()).resolves.toHaveLength(1);
    await provider.removeSession('github');
    await expect(secrets.get('github.token')).resolves.toBeNull();
    await expect(provider.getSessions()).resolves.toEqual([]);
    expect(events).toEqual([
      { added: [signedIn], removed: [], changed: [] },
      { added: [], removed: [signedIn], changed: [] },
    ]);
  });

  it('rejects an invalid token and does not store it', async () => {
    const { http } = makeFakeHttp(() => ({ status: 401, body: '{"message":"Bad credentials"}' }));
    const secrets = secretsWithToken();
    const provider = new GithubAuthenticationProvider({ http, secrets });

    await expect(provider.createSession('bad')).rejects.toThrow(/invalid or missing permissions/);
    await expect(secrets.get('github.token')).resolves.toBeNull();
  });

  it('prunes invalid stored tokens when sessions are read', async () => {
    const { http } = makeFakeHttp(() => ({ status: 401, body: '{"message":"Bad credentials"}' }));
    const secrets = secretsWithToken('expired');
    const provider = new GithubAuthenticationProvider({ http, secrets });

    await expect(provider.getSessions()).resolves.toEqual([]);
    await expect(secrets.get('github.token')).resolves.toBeNull();
    await expect(provider.getToken()).resolves.toBeNull();
  });

  it('does not hand invalid stored tokens to Git credentials', async () => {
    const { http } = makeFakeHttp(() => ({ status: 401, body: '{"message":"Bad credentials"}' }));
    const secrets = secretsWithToken('expired');
    const provider = new GithubAuthenticationProvider({ http, secrets });

    await expect(provider.getToken()).resolves.toBeNull();
    await expect(secrets.get('github.token')).resolves.toBeNull();
  });

  it('propagates non-auth GitHub API failures during sign-in', async () => {
    const { http } = makeFakeHttp(() => ({
      status: 403,
      headers: { 'x-ratelimit-remaining': '0' },
      body: '{"message":"API rate limit exceeded"}',
    }));
    const secrets = secretsWithToken();
    const provider = new GithubAuthenticationProvider({ http, secrets });

    await expect(provider.createSession('tok')).rejects.toThrow(/rate limit/);
    await expect(secrets.get('github.token')).resolves.toBeNull();
  });

  it('rejects unknown sign-out session ids without deleting the token', async () => {
    const provider = new GithubAuthenticationProvider({
      http: makeFakeHttp(() => ({ body: '{"login":"ada"}' })).http,
      secrets: secretsWithToken('tok'),
    });

    await expect(provider.removeSession('other')).rejects.toThrow(/session not found/);
    await expect(provider.getToken()).resolves.toBe('tok');
  });

  it('reports no session without touching the network when no token is stored', async () => {
    const { http, calls } = makeFakeHttp(() => ({}));
    const provider = new GithubAuthenticationProvider({ http, secrets: secretsWithToken() });

    await expect(provider.getSessions()).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
