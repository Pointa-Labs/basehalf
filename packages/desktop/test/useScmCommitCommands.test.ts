import { describe, expect, it } from 'vitest';
import {
  type ScmPostCommitRemoteOperation,
  scmPostCommitRemoteOperation,
} from '../src/workbench/contrib/scm/browser/useScmCommitCommands.js';
import type { GitStatusResult } from '../src/workbench/contrib/scm/common/git.js';

const status = (props: Partial<GitStatusResult> = {}): GitStatusResult => ({
  isRepo: true,
  branch: 'feature/scm',
  detached: false,
  upstream: 'origin/feature/scm',
  ahead: 0,
  behind: 0,
  files: [],
  ...props,
});

describe('useScmCommitCommands', () => {
  it.each([
    ['push', 'publish'],
    ['sync', 'publish'],
  ] satisfies readonly [
    NonNullable<Parameters<typeof scmPostCommitRemoteOperation>[0]>,
    ScmPostCommitRemoteOperation,
  ][])('publishes after commit %s when the current branch has no upstream', (after, expected) => {
    expect(scmPostCommitRemoteOperation(after, status({ upstream: null }))).toBe(expected);
  });

  it('keeps push and sync for tracked branches', () => {
    expect(scmPostCommitRemoteOperation('push', status())).toBe('push');
    expect(scmPostCommitRemoteOperation('sync', status())).toBe('sync');
  });

  it('does not publish detached or missing branches after commit', () => {
    expect(scmPostCommitRemoteOperation('sync', status({ branch: null, detached: true }))).toBe(
      'sync',
    );
    expect(scmPostCommitRemoteOperation(undefined, status())).toBeNull();
  });
});
