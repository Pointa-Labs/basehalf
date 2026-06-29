import { describe, expect, it } from 'vitest';
import { GithubRemoteSourceProvider } from '../src/workbench/contrib/githubPullRequests/browser/githubRemoteSourceProvider.js';

describe('GithubRemoteSourceProvider', () => {
  it('exposes GitHub remote sources and branches through the GitHub channel', async () => {
    const calls: Array<{ name: string; args: unknown[] }> = [];
    const provider = new GithubRemoteSourceProvider({
      listRemoteSources: async (query) => {
        calls.push({ name: 'listRemoteSources', args: [query] });
        return [{ name: 'o/r', icon: 'github', url: 'https://github.com/o/r.git' }];
      },
      listRemoteBranches: async (remoteUrl) => {
        calls.push({ name: 'listRemoteBranches', args: [remoteUrl] });
        return [{ name: 'main', isDefault: true }];
      },
    });

    expect(provider.id).toBe('github');
    expect(provider.name).toBe('GitHub');
    expect(provider.supportsQuery).toBe(true);
    await expect(provider.getRemoteSources('owner repo')).resolves.toEqual([
      { name: 'o/r', icon: 'github', url: 'https://github.com/o/r.git' },
    ]);
    await expect(provider.getBranches('https://github.com/o/r.git')).resolves.toEqual([
      { name: 'main', isDefault: true },
    ]);

    expect(calls).toEqual([
      { name: 'listRemoteSources', args: ['owner repo'] },
      { name: 'listRemoteBranches', args: ['https://github.com/o/r.git'] },
    ]);
  });
});
