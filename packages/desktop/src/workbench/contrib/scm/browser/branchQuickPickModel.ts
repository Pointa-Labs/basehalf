import type { PickOption } from '../../../browser/parts/dialogs/Dialog.js';
import type { GitRefInfo } from '../common/git.js';

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

export const checkoutTargetForRef = (
  ref: GitRefInfo,
  refs: readonly GitRefInfo[] = [],
): CheckoutTarget => {
  if (ref.type !== 'remoteHead') return { branch: ref.name };
  const tracking = trackingBranchForRemote(ref, refs);
  if (tracking !== undefined) return { branch: tracking.name };
  return { branch: ref.name, track: true };
};

export function trackingBranchForRemote(
  remoteRef: GitRefInfo,
  refs: readonly GitRefInfo[],
): GitRefInfo | undefined {
  if (remoteRef.type !== 'remoteHead') return undefined;
  return refs.find(
    (candidate) => candidate.type === 'head' && candidate.upstream === remoteRef.name,
  );
}

export const canDeleteBranch = (branch: GitRefInfo, mode: BranchQuickPickMode): boolean =>
  !branch.current && branch.type === 'head' && mode === 'switch';

export const isBranchPickDisabled = (
  branch: GitRefInfo,
  mode: BranchQuickPickMode,
  working: boolean,
): boolean => working || (mode === 'merge' && branch.current);
