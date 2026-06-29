import { describe, expect, it } from 'vitest';
import {
  GithubRemoteSourceProvider,
  githubRemoteSourceBranchUrl,
  registerGithubRemoteSourceProvider,
} from '../src/workbench/contrib/githubPullRequests/browser/githubRemoteSourceProvider.js';
import { RemoteSourceProviderRegistry } from '../src/workbench/contrib/scm/browser/remoteSourceRegistry.js';

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

  it('exposes VS Code-style remote source action metadata for GitHub remotes', () => {
    const opened: string[] = [];
    const provider = new GithubRemoteSourceProvider(
      {
        listRemoteSources: async () => [],
        listRemoteBranches: async () => [],
      },
      (url) => opened.push(url),
    );

    const actions = provider.getRemoteSourceActions('git@github.com:o/r.git');

    expect(actions.map(({ label, icon }) => ({ label, icon }))).toEqual([
      { label: 'Open on GitHub', icon: 'github' },
      { label: 'Checkout on vscode.dev', icon: 'globe' },
    ]);

    actions[0]?.run('feature/a b#1');
    actions[1]?.run('feature/a b#1');

    expect(opened).toEqual([
      'https://github.com/o/r/tree/feature/a%20b%231',
      'https://vscode.dev/github/o/r/tree/feature/a%20b%231',
    ]);
  });

  it('registers GitHub remote source actions with the SCM remote source registry', async () => {
    const opened: string[] = [];
    const registry = new RemoteSourceProviderRegistry();
    const provider = new GithubRemoteSourceProvider(
      {
        listRemoteSources: async () => [],
        listRemoteBranches: async () => [],
      },
      (url) => opened.push(url),
    );

    const dispose = registerGithubRemoteSourceProvider(registry, provider);

    const actions = await registry.getRemoteSourceActions('git@github.com:o/r.git');
    expect(actions.map(({ label, icon }) => ({ label, icon }))).toEqual([
      { label: 'Open on GitHub', icon: 'github' },
      { label: 'Checkout on vscode.dev', icon: 'globe' },
    ]);

    actions[0]?.run('main');
    expect(opened).toEqual(['https://github.com/o/r/tree/main']);

    dispose();
    await expect(registry.getRemoteSourceActions('git@github.com:o/r.git')).resolves.toEqual([]);
  });

  it('does not offer GitHub remote source actions for non-GitHub remotes', () => {
    const provider = new GithubRemoteSourceProvider({
      listRemoteSources: async () => [],
      listRemoteBranches: async () => [],
    });

    expect(provider.getRemoteSourceActions('https://gitlab.com/o/r.git')).toEqual([]);
    expect(githubRemoteSourceBranchUrl('nonsense', 'main')).toBeNull();
  });
});
