import { describe, expect, it } from 'vitest';
import {
  ScmHistoryItemDetailsProviderRegistry,
  provideScmHistoryItemAvatar,
  provideScmHistoryItemHoverCommands,
  provideScmHistoryItemMessageLinks,
  registerScmHistoryItemDetailsProvider,
} from '../src/workbench/contrib/scm/browser/historyItemDetailsProviderRegistry.js';

const repository = { root: '/repo' };
const avatarQuery = {
  commits: [{ hash: 'abc', authorName: 'Ada', authorEmail: 'ada@example.com' }],
  size: 32,
};

describe('ScmHistoryItemDetailsProviderRegistry', () => {
  it('registers, enumerates, and disposes history item details providers', () => {
    const registry = new ScmHistoryItemDetailsProviderRegistry();
    const first = {};
    const second = {};

    const disposeFirst = registerScmHistoryItemDetailsProvider(first, registry);
    registerScmHistoryItemDetailsProvider(second, registry);

    expect(registry.getScmHistoryItemDetailsProviders()).toEqual([first, second]);

    disposeFirst();

    expect(registry.getScmHistoryItemDetailsProviders()).toEqual([second]);
  });

  it('returns the first provider avatar result', async () => {
    const registry = new ScmHistoryItemDetailsProviderRegistry();
    const calls: string[] = [];
    const avatar = new Map([['abc', 'https://example.com/avatar.png']]);

    registerScmHistoryItemDetailsProvider(
      {
        provideAvatar: async () => {
          calls.push('empty');
          return undefined;
        },
      },
      registry,
    );
    registerScmHistoryItemDetailsProvider(
      {
        provideAvatar: async (currentRepository, query) => {
          calls.push(`${currentRepository.root}:${query.size}`);
          return avatar;
        },
      },
      registry,
    );
    registerScmHistoryItemDetailsProvider(
      {
        provideAvatar: async () => {
          calls.push('ignored');
          return new Map();
        },
      },
      registry,
    );

    await expect(provideScmHistoryItemAvatar(registry, repository, avatarQuery)).resolves.toBe(
      avatar,
    );
    expect(calls).toEqual(['empty', '/repo:32']);
  });

  it('returns the first provider hover commands result', async () => {
    const registry = new ScmHistoryItemDetailsProviderRegistry();
    const commands = [{ id: 'git.openCommit', title: 'Open Commit', arguments: ['abc'] }];

    registerScmHistoryItemDetailsProvider(
      { provideHoverCommands: async () => undefined },
      registry,
    );
    registerScmHistoryItemDetailsProvider({ provideHoverCommands: async () => commands }, registry);

    await expect(provideScmHistoryItemHoverCommands(registry, repository)).resolves.toBe(commands);
  });

  it('returns the first provider message links result', async () => {
    const registry = new ScmHistoryItemDetailsProviderRegistry();

    registerScmHistoryItemDetailsProvider({ provideMessageLinks: async () => '' }, registry);
    registerScmHistoryItemDetailsProvider(
      {
        provideMessageLinks: async (_repository, message) =>
          message.replace(/#(\d+)/g, 'https://github.com/o/r/pull/$1'),
      },
      registry,
    );

    await expect(
      provideScmHistoryItemMessageLinks(registry, repository, 'Fixes #12'),
    ).resolves.toBe('Fixes https://github.com/o/r/pull/12');
  });

  it('returns undefined when no provider has a result', async () => {
    const registry = new ScmHistoryItemDetailsProviderRegistry();
    registerScmHistoryItemDetailsProvider({}, registry);

    await expect(provideScmHistoryItemAvatar(registry, repository, avatarQuery)).resolves.toBe(
      undefined,
    );
    await expect(provideScmHistoryItemHoverCommands(registry, repository)).resolves.toBe(undefined);
    await expect(provideScmHistoryItemMessageLinks(registry, repository, 'message')).resolves.toBe(
      undefined,
    );
  });
});
