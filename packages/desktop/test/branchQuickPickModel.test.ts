import { describe, expect, it } from 'vitest';
import {
  branchOption,
  branchQuickAccessHint,
  canDeleteBranch,
  checkoutTargetForRef,
  createBranchCheckoutCommandModel,
  createBranchFromPickOptions,
  createCheckoutPickOptions,
  createDetachedCheckoutPickOptions,
  defaultBranchNameFromRef,
  detachedCheckoutTargetForRef,
  filterBranches,
  isBranchPickDisabled,
  isCheckoutBlockedError,
  orderCheckoutPickOptions,
} from '../src/workbench/contrib/scm/browser/branchQuickPickModel.js';
import type { GitRefInfo } from '../src/workbench/contrib/scm/common/git.js';

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
  it('models the checkout branch command as a VS Code-style command entry', () => {
    expect(createBranchCheckoutCommandModel({ branch: 'main', detached: false })).toEqual({
      label: 'main',
      icon: 'git-branch',
      iconSpin: false,
      tooltip: 'main, Checkout Branch/Tag...',
      ariaLabel: 'Checkout Branch/Tag',
      disabled: false,
    });
    expect(createBranchCheckoutCommandModel({ branch: null, detached: true })).toMatchObject({
      label: 'detached',
      icon: 'git-commit',
      tooltip: 'detached, Checkout Branch/Tag...',
      disabled: false,
    });
  });

  it('models checkout command busy states for shared header and status bar entries', () => {
    expect(
      createBranchCheckoutCommandModel({ branch: 'main', detached: false }, 'checkout'),
    ).toEqual({
      label: 'main',
      icon: 'loading',
      iconSpin: true,
      tooltip: 'main, Checking Out Branch/Tag...',
      ariaLabel: 'Checkout Branch/Tag',
      disabled: true,
    });
    expect(
      createBranchCheckoutCommandModel({ branch: 'main', detached: false }, 'sync'),
    ).toMatchObject({
      tooltip: 'main, Synchronizing Changes...',
      disabled: true,
    });
    expect(
      createBranchCheckoutCommandModel({ branch: 'main', detached: false }, 'operation'),
    ).toMatchObject({
      tooltip: 'main, Git operation in progress...',
      disabled: true,
    });
  });

  it('filters refs case-insensitively and keeps empty filters as identity', () => {
    const refs = [branch('main'), branch('feature/Auth'), branch('release')];

    expect(filterBranches(refs, '')).toBe(refs);
    expect(filterBranches(refs, 'auth').map((item) => item.name)).toEqual(['feature/Auth']);
  });

  it('checks out the local branch that already tracks a selected remote ref', () => {
    expect(
      checkoutTargetForRef(remote('origin/feature-x'), [
        branch('feature-x', { upstream: 'origin/feature-x' }),
      ]),
    ).toEqual({
      branch: 'feature-x',
    });
    expect(checkoutTargetForRef(remote('origin/feature-x'), [branch('feature-x')])).toEqual({
      branch: 'origin/feature-x',
      track: true,
    });
    expect(checkoutTargetForRef(remote('origin/new-x'), [])).toEqual({
      branch: 'origin/new-x',
      track: true,
    });
    expect(checkoutTargetForRef(branch('feature-x'))).toEqual({ branch: 'feature-x' });
  });

  it('adds VS Code-style branch commands and detached targets to checkout picks', () => {
    const refs = [
      branch('main', { current: true, commit: 'abcdef123456' }),
      remote('origin/feature-x', { commit: '1234567890ab' }),
    ];

    expect(createCheckoutPickOptions(refs).map((option) => option.value)).toEqual([
      'cmd:create',
      'cmd:createFrom',
      'cmd:checkoutDetached',
      'refs/heads/main',
      'refs/remotes/origin/feature-x',
    ]);
    expect(branchOption(refs[0] as GitRefInfo)).toMatchObject({
      label: 'main',
      hint: 'current branch',
      detail: 'abcdef1',
    });
    expect(detachedCheckoutTargetForRef(refs[1] as GitRefInfo)).toEqual({
      branch: '1234567890ab',
      detached: true,
    });
    expect(defaultBranchNameFromRef(refs[1] as GitRefInfo)).toBe('feature-x');
  });

  it('owns command-palette branch hints for SCM quick access rows', () => {
    expect(branchQuickAccessHint(branch('main', { current: true }))).toBe('current branch');
    expect(branchQuickAccessHint(remote('origin/feature-x'))).toBe('remote');
    expect(branchQuickAccessHint(branch('feature-x'))).toBe('Switch branch');
  });

  it('moves always-show command rows after refs once the user types', () => {
    const options = createCheckoutPickOptions([branch('main'), remote('origin/feature-x')]);

    expect(orderCheckoutPickOptions('', options).map((option) => option.value)).toEqual([
      'cmd:create',
      'cmd:createFrom',
      'cmd:checkoutDetached',
      'refs/heads/main',
      'refs/remotes/origin/feature-x',
    ]);
    expect(orderCheckoutPickOptions('feat', options).map((option) => option.value)).toEqual([
      'refs/heads/main',
      'refs/remotes/origin/feature-x',
      'cmd:create',
      'cmd:createFrom',
      'cmd:checkoutDetached',
    ]);
  });

  it('uses VS Code-style create-from and detached source lists', () => {
    const refs = [
      branch('main'),
      remote('origin/feature-x'),
      { id: 'refs/tags/v1.0', name: 'v1.0', type: 'tag' as const, current: false },
    ];

    expect(createBranchFromPickOptions(refs).map((option) => option.value)).toEqual([
      'HEAD',
      'refs/heads/main',
      'refs/remotes/origin/feature-x',
      'refs/tags/v1.0',
    ]);
    expect(createDetachedCheckoutPickOptions(refs).map((option) => option.value)).toEqual([
      'refs/heads/main',
      'refs/remotes/origin/feature-x',
    ]);
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
