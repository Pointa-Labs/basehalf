import { describe, expect, it } from 'vitest';
import { fetchRemotePickOptions } from '../src/workbench/contrib/scm/browser/useScmRemoteCommands.js';
import type { GitRemoteInfo, GitStatusResult } from '../src/workbench/contrib/scm/common/git.js';
import {
  FETCH_ALL_REMOTES_VALUE,
  fetchArgsForRemotePick,
  isPublishBranchState,
  scmRemoteOperation,
} from '../src/workbench/contrib/scm/common/remoteOperationModel.js';

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

const remote = (name: string, props: Partial<GitRemoteInfo> = {}): GitRemoteInfo => ({
  name,
  fetchUrl: `https://github.com/example/${name}.git`,
  pushUrl: `https://github.com/example/${name}.git`,
  isReadOnly: false,
  ...props,
});

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

  it('keeps pull on an unpublished branch as pull so no-upstream errors stay pull-scoped', () => {
    const unpublished = status({ upstream: null });

    expect(scmRemoteOperation('pull', unpublished)).toEqual({ kind: 'pull' });
    expect(scmRemoteOperation('pullRebase', unpublished)).toEqual({ kind: 'pull', rebase: true });
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

  it('builds VS Code-style fetch remote choices and maps them to git args', () => {
    expect(
      fetchRemotePickOptions([remote('origin'), remote('upstream')]).map((option) => option.value),
    ).toEqual([FETCH_ALL_REMOTES_VALUE, 'origin', 'upstream']);
    expect(fetchArgsForRemotePick(FETCH_ALL_REMOTES_VALUE)).toEqual({ all: true });
    expect(fetchArgsForRemotePick('origin')).toEqual({ remote: 'origin' });
  });
});
