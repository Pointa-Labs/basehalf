import { describe, expect, it } from 'vitest';
import {
  isPublishBranchState,
  scmRemoteOperation,
} from '../src/workbench/contrib/scm/browser/useScmRemoteCommands.js';
import type { GitStatusResult } from '../src/workbench/contrib/scm/common/git.js';

function status(overrides: Partial<GitStatusResult> = {}): GitStatusResult {
  return {
    isRepo: true,
    branch: 'main',
    detached: false,
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    files: [],
    ...overrides,
  };
}

describe('useScmRemoteCommands model helpers', () => {
  it('keeps publish as the primary action for attached branches without upstream', () => {
    const unpublished = status({ upstream: null });

    expect(isPublishBranchState(unpublished)).toBe(true);
    expect(scmRemoteOperation('publish', unpublished)).toEqual({ kind: 'publish' });
  });

  it('keeps explicit push commands as push so push-specific Git errors stay command-scoped', () => {
    const unpublished = status({ upstream: null });

    expect(scmRemoteOperation('push', unpublished)).toEqual({ kind: 'push' });
    expect(scmRemoteOperation('pushForce', unpublished)).toEqual({ kind: 'push', force: true });
  });

  it('routes pull on an unpublished branch through publish instead of raw git pull', () => {
    const unpublished = status({ upstream: null });

    expect(scmRemoteOperation('pull', unpublished)).toEqual({ kind: 'publish' });
    expect(scmRemoteOperation('pullRebase', unpublished)).toEqual({ kind: 'publish' });
  });

  it('routes unpublished sync through publish so the status-bar remote action selects a remote', () => {
    const unpublished = status({ upstream: null });

    expect(scmRemoteOperation('sync', unpublished)).toEqual({ kind: 'publish' });
  });

  it('keeps regular upstream operations direct', () => {
    const tracked = status({ upstream: 'origin/main' });

    expect(isPublishBranchState(tracked)).toBe(false);
    expect(scmRemoteOperation('push', tracked)).toEqual({ kind: 'push' });
    expect(scmRemoteOperation('pushForce', tracked)).toEqual({ kind: 'push', force: true });
    expect(scmRemoteOperation('fetch', tracked)).toEqual({ kind: 'fetch' });
  });
});
