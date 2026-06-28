import type { GitRefInfo } from '../common/git.js';

export interface CheckoutTarget {
  readonly branch: string;
  readonly track?: boolean;
  readonly detached?: boolean;
}

export const checkoutTargetForRef = (
  ref: GitRefInfo,
  refs: readonly GitRefInfo[] = [],
): CheckoutTarget => {
  if (ref.type !== 'remoteHead') return { branch: ref.name };
  const tracking = trackingBranchForRemote(ref, refs);
  if (tracking !== undefined) return { branch: tracking.name };
  return { branch: ref.name, track: true };
};

export const detachedCheckoutTargetForRef = (ref: {
  readonly name: string;
  readonly commit?: string;
}): CheckoutTarget => ({
  branch: ref.commit ?? ref.name,
  detached: true,
});

export function defaultBranchNameFromRef(ref: GitRefInfo): string {
  if (ref.type !== 'remoteHead' || ref.remote === undefined) return ref.name;
  const prefix = `${ref.remote}/`;
  return ref.name.startsWith(prefix) ? ref.name.slice(prefix.length) : ref.name;
}

export function trackingBranchForRemote(
  remoteRef: GitRefInfo,
  refs: readonly GitRefInfo[],
): GitRefInfo | undefined {
  if (remoteRef.type !== 'remoteHead') return undefined;
  return refs.find(
    (candidate) => candidate.type === 'head' && candidate.upstream === remoteRef.name,
  );
}
