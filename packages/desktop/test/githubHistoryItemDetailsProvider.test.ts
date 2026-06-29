import { describe, expect, it, vi } from 'vitest';
import {
  GithubHistoryItemDetailsProvider,
  registerGithubHistoryItemDetailsProvider,
} from '../src/workbench/contrib/githubPullRequests/browser/githubHistoryItemDetailsProvider.js';
import { ScmHistoryItemDetailsProviderRegistry } from '../src/workbench/contrib/scm/browser/historyItemDetailsProviderRegistry.js';

const githubRepository = {
  remoteName: 'origin',
  remoteUrl: 'https://github.com/basehalf/app.git',
  owner: 'basehalf',
  repo: 'app',
  webUrl: 'https://github.com/basehalf/app',
  isReadOnly: false,
};

describe('GithubHistoryItemDetailsProvider', () => {
  it('resolves GitHub noreply avatars without exposing a token to the renderer', () => {
    const provider = new GithubHistoryItemDetailsProvider({
      repository: async () => githubRepository,
    });

    expect(
      provider.provideAvatar(
        { root: '/repo' },
        {
          size: 32,
          commits: [
            {
              hash: 'abc',
              authorName: 'Ada',
              authorEmail: '42+ada@users.noreply.github.com',
            },
            {
              hash: 'def',
              authorName: 'Grace',
              authorEmail: 'grace@example.com',
            },
          ],
        },
      ),
    ).toEqual(new Map([['abc', 'https://avatars.githubusercontent.com/u/42?s=32']]));
  });

  it('adds GitHub hover command metadata for the current repository', async () => {
    const opened: string[] = [];
    const provider = new GithubHistoryItemDetailsProvider(
      {
        repository: async () => githubRepository,
      },
      (url) => opened.push(url),
    );

    await expect(provider.provideHoverCommands({ root: '/repo' })).resolves.toEqual([
      {
        id: 'github.openOnGitHub',
        title: 'Open on GitHub',
        arguments: ['https://github.com/basehalf/app'],
      },
    ]);

    provider.openOnGitHub('https://github.com/basehalf/app/commit/abc');
    expect(opened).toEqual(['https://github.com/basehalf/app/commit/abc']);
  });

  it('links GitHub issue references in history messages using the repository remote', async () => {
    const provider = new GithubHistoryItemDetailsProvider({
      repository: async () => githubRepository,
    });

    await expect(
      provider.provideMessageLinks({ root: '/repo' }, 'Fixes #12 and owner/other#34 plus GH-56.'),
    ).resolves.toBe(
      'Fixes [#12](https://github.com/basehalf/app/issues/12) and [owner/other#34](https://github.com/owner/other/issues/34) plus [#56](https://github.com/basehalf/app/issues/56).',
    );
  });

  it('registers and disposes through the SCM history item details provider registry', async () => {
    const registry = new ScmHistoryItemDetailsProviderRegistry();
    const provider = new GithubHistoryItemDetailsProvider({
      repository: async () => githubRepository,
    });

    const dispose = registerGithubHistoryItemDetailsProvider(registry, provider);

    await expect(
      registry
        .getScmHistoryItemDetailsProviders()[0]
        ?.provideMessageLinks?.({ root: '/repo' }, 'Fixes #1'),
    ).resolves.toBe('Fixes [#1](https://github.com/basehalf/app/issues/1)');

    dispose();
    expect(registry.getScmHistoryItemDetailsProviders()).toEqual([]);
  });

  it('does not produce GitHub details when no GitHub repository is available', async () => {
    const provider = new GithubHistoryItemDetailsProvider({
      repository: vi.fn(async () => null),
    });

    await expect(provider.provideHoverCommands({ root: '/repo' })).resolves.toBeUndefined();
    await expect(provider.provideMessageLinks({ root: '/repo' }, 'Fixes #1')).resolves.toBe(
      undefined,
    );
  });
});
