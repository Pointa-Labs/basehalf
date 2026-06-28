import { describe, expect, it, vi } from 'vitest';
import { GithubAuthenticationProvider } from '../src/workbench/contrib/githubPullRequests/electron-main/githubAuthenticationProvider.js';
import type { GithubMainService } from '../src/workbench/contrib/githubPullRequests/electron-main/githubMainService.js';
import { GITHUB_AUTH_PROVIDER_ID } from '../src/workbench/services/authentication/common/authentication.js';

describe('GithubAuthenticationProvider', () => {
  it('adapts GithubMainService sign-in state to authentication sessions', async () => {
    let login: string | null = null;
    const github = {
      viewer: vi.fn(async () => login),
      signIn: vi.fn(async () => {
        login = 'ada';
        return login;
      }),
      signOut: vi.fn(async () => {
        login = null;
      }),
    } as unknown as GithubMainService;
    const provider = new GithubAuthenticationProvider(github);

    await expect(provider.getSessions()).resolves.toEqual([]);
    await expect(provider.createSession('tok')).resolves.toMatchObject({
      id: 'github',
      providerId: GITHUB_AUTH_PROVIDER_ID,
      account: { label: 'ada' },
      scopes: ['repo'],
    });
    await expect(provider.getSessions()).resolves.toHaveLength(1);
    await provider.removeSession('github');
    await expect(provider.getSessions()).resolves.toEqual([]);
  });
});
