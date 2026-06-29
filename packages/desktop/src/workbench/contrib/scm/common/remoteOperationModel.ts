import type { GitFetchArgs, GitStatusResult } from './git.js';

export type ScmRemoteCommandKind =
  | 'publish'
  | 'pull'
  | 'pullRebase'
  | 'push'
  | 'fetch'
  | 'sync'
  | 'pushForce';

export type ScmRemoteOperation =
  | { readonly kind: 'publish' }
  | { readonly kind: 'pull'; readonly rebase?: boolean }
  | { readonly kind: 'push'; readonly force?: boolean }
  | { readonly kind: 'fetch' }
  | { readonly kind: 'sync' };

export type ScmPostCommitRemoteOperation = 'publish' | 'push' | 'sync' | null;

export const FETCH_ALL_REMOTES_VALUE = '__all__';

export function isPublishBranchState(status: GitStatusResult | null): boolean {
  return (
    status !== null &&
    status.detached !== true &&
    status.branch !== null &&
    status.upstream === null
  );
}

export function scmRemoteOperation(
  command: ScmRemoteCommandKind,
  status: GitStatusResult | null,
): ScmRemoteOperation {
  switch (command) {
    case 'publish':
      return { kind: 'publish' };
    case 'pull':
      return { kind: 'pull' };
    case 'pullRebase':
      return { kind: 'pull', rebase: true };
    case 'push':
      return { kind: 'push' };
    case 'fetch':
      return { kind: 'fetch' };
    case 'sync':
      return isPublishBranchState(status) ? { kind: 'publish' } : { kind: 'sync' };
    case 'pushForce':
      return { kind: 'push', force: true };
  }
}

export function scmPostCommitRemoteOperation(
  after: 'push' | 'sync' | undefined,
  status: GitStatusResult | null,
): ScmPostCommitRemoteOperation {
  if (after === undefined) return null;
  if ((after === 'push' || after === 'sync') && isPublishBranchState(status)) return 'publish';
  return after;
}

export function fetchArgsForRemotePick(value: string): GitFetchArgs {
  return value === FETCH_ALL_REMOTES_VALUE ? { all: true } : { remote: value };
}
