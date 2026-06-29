import { describe, expect, it } from 'vitest';
import {
  RemoteSourceProviderRegistry,
  registerRemoteSourceProvider,
} from '../src/workbench/contrib/scm/browser/remoteSourceRegistry.js';
import type { RemoteSourceProvider } from '../src/workbench/contrib/scm/common/remoteSources.js';

function provider(
  id: string,
  sources: readonly string[],
  branches: readonly string[] = [],
): RemoteSourceProvider {
  return {
    id,
    name: id,
    supportsQuery: true,
    getRemoteSources: async (query) =>
      sources.map((name) => ({
        name: query === undefined ? name : `${name}:${query}`,
        url: `https://github.com/${name}.git`,
      })),
    getBranches: async () => branches.map((name) => ({ name })),
  };
}

describe('RemoteSourceProviderRegistry', () => {
  it('registers, enumerates by provider, and disposes providers', async () => {
    const registry = new RemoteSourceProviderRegistry();
    const disposeGithub = registerRemoteSourceProvider(
      provider('github', ['o/r'], ['main']),
      registry,
    );
    registerRemoteSourceProvider(provider('example', ['x/y']), registry);

    expect(registry.getRemoteSourceProviders().map((entry) => entry.id)).toEqual([
      'github',
      'example',
    ]);
    await expect(registry.getRemoteSources('github', 'query')).resolves.toEqual([
      { name: 'o/r:query', url: 'https://github.com/o/r.git' },
    ]);
    await expect(
      registry.getRemoteBranches('github', 'https://github.com/o/r.git'),
    ).resolves.toEqual([{ name: 'main' }]);
    await expect(registry.getRemoteSourcesByProvider()).resolves.toEqual([
      {
        provider: registry.getRemoteSourceProvider('github'),
        sources: [{ name: 'o/r', url: 'https://github.com/o/r.git' }],
      },
      {
        provider: registry.getRemoteSourceProvider('example'),
        sources: [{ name: 'x/y', url: 'https://github.com/x/y.git' }],
      },
    ]);

    disposeGithub();

    expect(registry.getRemoteSourceProviders().map((entry) => entry.id)).toEqual(['example']);
  });

  it('rejects duplicate ids and supports explicit unregister', () => {
    const registry = new RemoteSourceProviderRegistry();
    registry.registerRemoteSourceProvider(provider('github', []));

    expect(() => registry.registerRemoteSourceProvider(provider('github', []))).toThrow(
      /already registered/,
    );

    registry.unregisterRemoteSourceProvider('github');

    expect(registry.getRemoteSourceProviders()).toEqual([]);
  });
});
