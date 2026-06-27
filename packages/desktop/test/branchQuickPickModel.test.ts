import type { GitRefInfo } from '@basehalf/core';
import { describe, expect, it } from 'vitest';
import {
  canDeleteBranch,
  checkoutTargetForRef,
  filterBranches,
  isBranchPickDisabled,
  isCheckoutBlockedError,
} from '../src/renderer/src/components/source-control/branchQuickPickModel.js';

const branch = (name: string, props: Partial<GitRefInfo> = {}): GitRefInfo => ({
  id: `refs/heads/${name}`,
  name,
  type: 'head',
  current: false,
  ...props,
});

const remote = (name: string, props: Partial<GitRefInfo> = {}): GitRefInfo => ({
  id: `refs/remotes/${name}`,
  name,
  type: 'remoteHead',
  remote: name.split('/')[0],
  current: false,
  ...props,
});

describe('branchQuickPickModel', () => {
  it('filters refs case-insensitively and keeps empty filters as identity', () => {
    const refs = [branch('main'), branch('feature/Auth'), branch('release')];

    expect(filterBranches(refs, '')).toBe(refs);
    expect(filterBranches(refs, 'auth').map((item) => item.name)).toEqual(['feature/Auth']);
  });

  it('checks out remote-tracking refs by existing local branch or tracking target', () => {
    expect(checkoutTargetForRef(remote('origin/feature-x'), [branch('feature-x')])).toEqual({
      branch: 'feature-x',
    });
    expect(checkoutTargetForRef(remote('origin/new-x'), [])).toEqual({
      branch: 'origin/new-x',
      track: true,
    });
    expect(checkoutTargetForRef(branch('feature-x'))).toEqual({ branch: 'feature-x' });
  });

  it('only allows deleting local non-current branches in switch mode', () => {
    expect(canDeleteBranch(branch('topic'), 'switch')).toBe(true);
    expect(canDeleteBranch(branch('main', { current: true }), 'switch')).toBe(false);
    expect(canDeleteBranch(remote('origin/topic'), 'switch')).toBe(false);
    expect(canDeleteBranch(branch('topic'), 'merge')).toBe(false);
  });

  it('disables the current branch in merge mode but not normal switch mode', () => {
    const current = branch('main', { current: true });

    expect(isBranchPickDisabled(current, 'merge', false)).toBe(true);
    expect(isBranchPickDisabled(current, 'switch', false)).toBe(false);
    expect(isBranchPickDisabled(branch('topic'), 'switch', true)).toBe(true);
  });

  it('recognizes dirty checkout blocker messages', () => {
    expect(
      isCheckoutBlockedError('Your local changes to the following files would be overwritten'),
    ).toBe(true);
    expect(
      isCheckoutBlockedError('untracked working tree files would be overwritten by checkout'),
    ).toBe(true);
    expect(isCheckoutBlockedError('fatal: not a git repository')).toBe(false);
  });
});
