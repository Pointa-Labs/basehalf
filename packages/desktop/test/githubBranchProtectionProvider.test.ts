import { describe, expect, it } from 'vitest';
import {
  GithubBranchProtectionProvider,
  registerGithubBranchProtectionProvider,
} from '../src/workbench/contrib/githubPullRequests/browser/githubBranchProtectionProvider.js';
import { BranchProtectionProviderRegistry } from '../src/workbench/contrib/scm/browser/branchProtectionRegistry.js';
import type {
  BranchProtectionChangeListener,
  BranchProtectionProvider,
} from '../src/workbench/contrib/scm/common/branchProtection.js';

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
});
