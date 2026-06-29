import { describe, expect, it } from 'vitest';
import { BranchProtectionProviderRegistry } from '../src/workbench/contrib/scm/browser/branchProtectionRegistry.js';
import {
  type BranchProtection,
  type BranchProtectionChangeListener,
  type BranchProtectionProvider,
  noopBranchProtectionChangeEvent,
} from '../src/workbench/contrib/scm/common/branchProtection.js';

function provider(branchProtection: readonly BranchProtection[]): BranchProtectionProvider {
  return {
    onDidChangeBranchProtection: noopBranchProtectionChangeEvent,
    provideBranchProtection: () => branchProtection,
  };
}

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

describe('BranchProtectionProviderRegistry', () => {
  it('registers providers by repository root and aggregates their branch protection', async () => {
    const registry = new BranchProtectionProviderRegistry();
    const events: string[] = [];
    registry.onDidChangeBranchProtectionProviders((root) => events.push(root));

    const disposeOrigin = registry.registerBranchProtectionProvider(
      ' /workspace ',
      provider([{ remote: 'origin', rules: [{ include: ['main'] }] }]),
    );
    const disposeUpstream = registry.registerBranchProtectionProvider(
      '/workspace',
      provider([
        { remote: 'upstream', rules: [{ include: ['release/*'], exclude: ['release/wip'] }] },
      ]),
    );

    expect(registry.getBranchProtectionProviders('/workspace')).toHaveLength(2);
    expect(registry.provideBranchProtection('/workspace')).toEqual([
      { remote: 'origin', rules: [{ include: ['main'] }] },
      { remote: 'upstream', rules: [{ include: ['release/*'], exclude: ['release/wip'] }] },
    ]);
    expect(registry.provideBranchProtection('/other')).toEqual([]);
    expect(events).toEqual(['/workspace', '/workspace']);

    disposeOrigin();
    expect(registry.provideBranchProtection('/workspace')).toEqual([
      { remote: 'upstream', rules: [{ include: ['release/*'], exclude: ['release/wip'] }] },
    ]);

    disposeUpstream();
    expect(registry.getBranchProtectionProviders('/workspace')).toEqual([]);
    expect(events).toEqual(['/workspace', '/workspace', '/workspace', '/workspace']);
  });

  it('forwards provider branch protection change events with the changed root', () => {
    const registry = new BranchProtectionProviderRegistry();
    const change = branchProtectionEvent();
    const events: string[] = [];
    registry.onDidChangeBranchProtectionProviders((root) => events.push(root));

    const dispose = registry.registerBranchProtectionProvider('/workspace', {
      onDidChangeBranchProtection: change.event,
      provideBranchProtection: () => [],
    });

    change.fire(' /workspace ');
    change.fire('/other');
    dispose();
    change.fire('/workspace');

    expect(events).toEqual(['/workspace', '/workspace', '/other', '/workspace']);
  });

  it('requires a repository root for registry operations', () => {
    const registry = new BranchProtectionProviderRegistry();

    expect(() => registry.registerBranchProtectionProvider(' ', provider([]))).toThrow(
      'Repository root is required.',
    );
    expect(() => registry.getBranchProtectionProviders('')).toThrow('Repository root is required.');
  });
});
