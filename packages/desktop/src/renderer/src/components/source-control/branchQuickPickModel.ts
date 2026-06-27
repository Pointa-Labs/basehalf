import type { GitRefInfo } from '@basehalf/core';
import type { PickOption } from '../Dialog.js';

export type BranchQuickPickMode = 'switch' | 'merge';

export interface CheckoutTarget {
  readonly branch: string;
  readonly track?: boolean;
}

const CHECKOUT_BLOCKED_RE =
  /would be overwritten by checkout|local changes to the following files would be overwritten|untracked working tree files would be overwritten|please commit your changes or stash/i;

export const CHECKOUT_RECOVERY_OPTIONS = [
  {
    value: 'stash',
    label: 'Stash & Checkout',
    hint: 'Keep changes in stash',
    detail: 'Switch branches and leave the stash for later.',
  },
  {
    value: 'migrate',
    label: 'Migrate Changes',
    hint: 'Carry changes to target',
    detail: 'Stash, checkout, then apply the stash.',
  },
  {
    value: 'force',
    label: 'Force Checkout',
    hint: 'Discard local changes',
    detail: 'Overwrite files that block checkout.',
  },
] satisfies readonly PickOption[];

export const isCheckoutBlockedError = (message: string): boolean =>
  CHECKOUT_BLOCKED_RE.test(message);

export const filterBranches = (
  branches: readonly GitRefInfo[],
  filter: string,
): readonly GitRefInfo[] => {
  const needle = filter.trim().toLowerCase();
  if (needle === '') return branches;
  return branches.filter((branch) => branch.name.toLowerCase().includes(needle));
};

// Picking a remote-tracking branch mirrors VS Code:
// if a local tracking branch already exists, switch to it; otherwise create a
// tracking branch from the remote ref.
export const checkoutTargetForRef = (
  ref: GitRefInfo,
  refs: readonly GitRefInfo[] = [],
): CheckoutTarget => {
  if (ref.type !== 'remoteHead') return { branch: ref.name };
  const prefix = ref.remote !== undefined ? `${ref.remote}/` : '';
  const localName =
    prefix !== '' && ref.name.startsWith(prefix) ? ref.name.slice(prefix.length) : ref.name;
  const hasLocal = refs.some((item) => item.type === 'head' && item.name === localName);
  return hasLocal ? { branch: localName } : { branch: ref.name, track: true };
};

export const canDeleteBranch = (branch: GitRefInfo, mode: BranchQuickPickMode): boolean =>
  !branch.current && branch.type === 'head' && mode === 'switch';

export const isBranchPickDisabled = (
  branch: GitRefInfo,
  mode: BranchQuickPickMode,
  working: boolean,
): boolean => working || (mode === 'merge' && branch.current);
