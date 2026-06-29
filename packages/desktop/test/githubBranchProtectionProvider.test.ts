import { describe, expect, it, vi } from 'vitest';
import {
  GithubBranchProtectionProvider,
  createGithubBranchProtectionSource,
  registerGithubBranchProtectionProvider,
  registerGithubBranchProtectionProviders,
} from '../src/workbench/contrib/githubPullRequests/browser/githubBranchProtectionProvider.js';
import { BranchProtectionProviderRegistry } from '../src/workbench/contrib/scm/browser/branchProtectionRegistry.js';
import type {
  BranchProtectionChangeListener,
  BranchProtectionProvider,
} from '../src/workbench/contrib/scm/common/branchProtection.js';
import type { AuthenticationProviderSessionsChangeEvent } from '../src/workbench/services/authentication/common/authentication.js';

function branchProtectionEvent(): {
  readonly event: BranchProtectionProvider['onDidChangeBranchProtection'];
  fire(repositoryRoot: string): void;
} {
  const listeners = new Set<BranchProtectionChangeListener>();
  return {
    event: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    fire: (repositoryRoot) => {
      for (const listener of listeners) listener(repositoryRoot);
    },
  };
}

describe('GithubBranchProtectionProvider', () => {
  it('defaults to an empty provider without making GitHub requests', () => {
    const provider = new GithubBranchProtectionProvider('/workspace');

    expect(provider.provideBranchProtection()).toEqual([]);
  });

  it('adapts an injected GitHub branch protection source to the SCM registry', () => {
    const registry = new BranchProtectionProviderRegistry();
    const calls: string[] = [];

    const dispose = registerGithubBranchProtectionProvider('/workspace', registry, {
      provideBranchProtection: (repositoryRoot) => {
        calls.push(repositoryRoot);
        return [{ remote: 'origin', rules: [{ include: ['main'] }] }];
      },
    });

    expect(registry.provideBranchProtection('/workspace')).toEqual([
      { remote: 'origin', rules: [{ include: ['main'] }] },
    ]);
    expect(calls).toEqual(['/workspace']);

    dispose();
    expect(registry.provideBranchProtection('/workspace')).toEqual([]);
  });

  it('forwards source change events through the registered provider', () => {
    const registry = new BranchProtectionProviderRegistry();
    const change = branchProtectionEvent();
    const events: string[] = [];
    registry.onDidChangeBranchProtectionProviders((root) => events.push(root));

    const dispose = registerGithubBranchProtectionProvider('/workspace', registry, {
      onDidChangeBranchProtection: change.event,
      provideBranchProtection: () => [],
    });

    change.fire('/workspace');
    dispose();
    change.fire('/workspace');

    expect(events).toEqual(['/workspace', '/workspace', '/workspace']);
  });

  it('loads branch protection through the GitHub channel and refreshes on auth changes', async () => {
    const registry = new BranchProtectionProviderRegistry();
    const listeners = new Set<(event: AuthenticationProviderSessionsChangeEvent) => void>();
    let revision = 0;
    const channel = {
      branchProtection: vi.fn(async () => {
        revision += 1;
        return [
          { remote: 'origin', rules: [{ include: [revision === 1 ? 'main' : 'release/*'] }] },
        ];
      }),
    };
    const source = createGithubBranchProtectionSource(channel, {
      onDidChangeSessions: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });

    const dispose = registerGithubBranchProtectionProvider('/workspace', registry, source);

    await vi.waitFor(() => {
      expect(registry.provideBranchProtection('/workspace')).toEqual([
        { remote: 'origin', rules: [{ include: ['main'] }] },
      ]);
    });

    for (const listener of listeners) {
      listener({ providerId: 'github', label: 'GitHub', event: {} });
    }

    await vi.waitFor(() => {
      expect(registry.provideBranchProtection('/workspace')).toEqual([
        { remote: 'origin', rules: [{ include: ['release/*'] }] },
      ]);
    });

    dispose();
    for (const listener of listeners) {
      listener({ providerId: 'github', label: 'GitHub', event: {} });
    }

    expect(channel.branchProtection).toHaveBeenCalledTimes(2);
    expect(listeners.size).toBe(0);
  });

  it('registers branch protection for the active workspace root and rebinds on workspace changes', async () => {
    const registry = new BranchProtectionProviderRegistry();
    const listeners = new Set<(repositoryRoot: string | null) => void>();
    let current: string | null = '/one';
    const channel = {
      branchProtection: vi.fn(async (repositoryRoot: string) => [
        { remote: 'origin', rules: [{ include: [repositoryRoot] }] },
      ]),
    };
    const workspace = {
      current: () => current,
      onDidChangeCurrent: (listener: (repositoryRoot: string | null) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const authService = {
      onDidChangeSessions: (_listener: (event: unknown) => void) => () => undefined,
    };

    const dispose = registerGithubBranchProtectionProviders({
      registry,
      workspace,
      channel,
      authService,
    });

    await vi.waitFor(() => {
      expect(registry.provideBranchProtection('/one')).toEqual([
        { remote: 'origin', rules: [{ include: ['/one'] }] },
      ]);
    });

    current = '/two';
    for (const listener of listeners) listener(current);

    await vi.waitFor(() => {
      expect(registry.provideBranchProtection('/one')).toEqual([]);
      expect(registry.provideBranchProtection('/two')).toEqual([
        { remote: 'origin', rules: [{ include: ['/two'] }] },
      ]);
    });

    dispose();
    expect(registry.provideBranchProtection('/two')).toEqual([]);
    expect(listeners.size).toBe(0);
  });
});
