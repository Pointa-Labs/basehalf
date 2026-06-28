import type { GitCommit, GitRefInfo } from '../common/git.js';

export type FullGraphRefKind = 'branch' | 'remote' | 'tag';

export interface FullGraphRefModel {
  readonly name: string;
  readonly kind: FullGraphRefKind;
  readonly targetRef: string;
  readonly current?: boolean;
  readonly activeRemote?: boolean;
  readonly pseudo?: boolean;
  readonly trackingLocal?: string;
}

export interface FullGraphRefIndex {
  readonly refsById: ReadonlyMap<string, GitRefInfo>;
  readonly refsByName: ReadonlyMap<string, readonly GitRefInfo[]>;
  readonly localBranches: ReadonlySet<string>;
  readonly activeRemoteRefs: ReadonlySet<string>;
  readonly trackingLocalBranches: ReadonlyMap<string, string>;
}

export function fullGraphDisplayRef(ref: string): string {
  if (ref.startsWith('refs/heads/')) return ref.slice('refs/heads/'.length);
  if (ref.startsWith('refs/remotes/')) return ref.slice('refs/remotes/'.length);
  if (ref.startsWith('refs/tags/')) return ref.slice('refs/tags/'.length);
  return ref;
}

export function fullGraphLocalBranches(branches: readonly GitRefInfo[]): ReadonlySet<string> {
  return new Set(branches.filter((branch) => branch.type === 'head').map((branch) => branch.name));
}

export function fullGraphRefIndex(refs: readonly GitRefInfo[]): FullGraphRefIndex {
  const refsById = new Map<string, GitRefInfo>();
  const refsByName = new Map<string, GitRefInfo[]>();
  const localBranches = new Set<string>();
  const activeRemoteRefs = new Set<string>();
  const remoteRefs = new Map<string, GitRefInfo>();

  for (const ref of refs) {
    refsById.set(ref.id, ref);
    const named = refsByName.get(ref.name);
    if (named) named.push(ref);
    else refsByName.set(ref.name, [ref]);

    if (ref.type === 'head') localBranches.add(ref.name);
    if (ref.type === 'head' && ref.current && ref.upstream !== undefined) {
      activeRemoteRefs.add(ref.upstream);
      activeRemoteRefs.add(`refs/remotes/${ref.upstream}`);
    }
    if (ref.type === 'remoteHead') {
      remoteRefs.set(ref.id, ref);
      remoteRefs.set(ref.name, ref);
    }
  }

  const trackingLocalBranches = new Map<string, string>();
  for (const branch of refs) {
    if (branch.type !== 'head' || branch.upstream === undefined) continue;
    const remote =
      remoteRefs.get(branch.upstream) ?? remoteRefs.get(`refs/remotes/${branch.upstream}`);
    trackingLocalBranches.set(branch.upstream, branch.name);
    if (remote !== undefined) {
      trackingLocalBranches.set(remote.id, branch.name);
      trackingLocalBranches.set(remote.name, branch.name);
    }
  }

  return { refsById, refsByName, localBranches, activeRemoteRefs, trackingLocalBranches };
}

export function fullGraphTrackingLocalBranches(
  branches: readonly GitRefInfo[],
): ReadonlyMap<string, string> {
  return fullGraphRefIndex(branches).trackingLocalBranches;
}

export function fullGraphRefKind(
  ref: string,
  localBranches: ReadonlySet<string>,
): Exclude<FullGraphRefKind, 'tag'> {
  if (ref.startsWith('refs/heads/')) return 'branch';
  if (ref.startsWith('refs/remotes/')) return 'remote';
  return localBranches.has(ref) ? 'branch' : 'remote';
}

export function fullGraphRefForDecoration(
  ref: string,
  index: FullGraphRefIndex,
): FullGraphRefModel {
  const found = fullGraphResolveRefInfo(ref, index);
  const name = found?.name ?? fullGraphDisplayRef(ref);
  const kind =
    found === undefined
      ? fullGraphRefKindForDecoration(ref, index.localBranches)
      : gitRefKind(found);
  const targetRef = found?.id ?? fullGraphDefaultTargetRef(name, kind);
  const trackingLocal =
    kind === 'remote'
      ? (index.trackingLocalBranches.get(targetRef) ?? index.trackingLocalBranches.get(name))
      : undefined;
  return {
    name,
    kind,
    targetRef,
    ...(found?.current === true && { current: true }),
    ...(kind === 'remote' &&
      (index.activeRemoteRefs.has(targetRef) || index.activeRemoteRefs.has(name)) && {
        activeRemote: true,
      }),
    ...(isRemoteHeadRef(targetRef) && { pseudo: true }),
    ...(trackingLocal !== undefined && { trackingLocal }),
  };
}

export function fullGraphRefsForCommit(
  commit: GitCommit,
  index: FullGraphRefIndex,
): readonly FullGraphRefModel[] {
  return [
    ...commit.refs
      .filter((ref) => !isRemoteHeadRef(ref))
      .map((ref) => fullGraphRefForDecoration(ref, index)),
    ...commit.tags.map((tag) => ({
      name: tag,
      kind: 'tag' as const,
      targetRef: `refs/tags/${tag}`,
    })),
  ];
}

function fullGraphResolveRefInfo(ref: string, index: FullGraphRefIndex): GitRefInfo | undefined {
  const byId = index.refsById.get(ref);
  if (byId !== undefined) return byId;

  const name = fullGraphDisplayRef(ref);
  const byName = index.refsByName.get(name);
  if (byName === undefined || byName.length === 0) return undefined;
  if (byName.length === 1) return byName[0];

  if (ref.startsWith('refs/heads/')) return byName.find((candidate) => candidate.type === 'head');
  if (ref.startsWith('refs/remotes/')) {
    return byName.find((candidate) => candidate.type === 'remoteHead');
  }
  if (ref.startsWith('refs/tags/')) return byName.find((candidate) => candidate.type === 'tag');

  return (
    byName.find((candidate) => candidate.type === (name.includes('/') ? 'remoteHead' : 'head')) ??
    byName.find((candidate) => candidate.type === 'head') ??
    byName[0]
  );
}

function gitRefKind(ref: GitRefInfo): FullGraphRefKind {
  if (ref.type === 'head') return 'branch';
  if (ref.type === 'remoteHead') return 'remote';
  return 'tag';
}

function fullGraphRefKindForDecoration(
  ref: string,
  localBranches: ReadonlySet<string>,
): FullGraphRefKind {
  if (ref.startsWith('refs/tags/')) return 'tag';
  return fullGraphRefKind(ref, localBranches);
}

function fullGraphDefaultTargetRef(name: string, kind: FullGraphRefKind): string {
  if (name.startsWith('refs/')) return name;
  if (kind === 'branch') return `refs/heads/${name}`;
  if (kind === 'remote') return `refs/remotes/${name}`;
  return `refs/tags/${name}`;
}

function isRemoteHeadRef(ref: string): boolean {
  return /^refs\/remotes\/[^/]+\/HEAD$/.test(ref) || /^[^/]+\/HEAD$/.test(ref);
}
