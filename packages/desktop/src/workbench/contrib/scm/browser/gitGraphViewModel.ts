import type { GitCommit, GitRefInfo, GitStashEntry } from '../common/git.js';
import type { GraphRow } from './gitGraphLayout.js';

export const FULL_GRAPH_ROW_HEIGHT = 24;
export const FULL_GRAPH_LANE_GAP = 14;
export const FULL_GRAPH_LEFT_OFFSET = 12;
export const FULL_GRAPH_PAGE_SIZE = 200;

// Git Graph's default branch palette (vivid, cycled by lane).
export const FULL_GRAPH_PALETTE = [
  '#0085d9',
  '#d9008c',
  '#00d90a',
  '#d98500',
  '#a300d9',
  '#00d9cc',
  '#e138e8',
  '#85d900',
  '#dc5b23',
  '#6f24d6',
] as const;

export type FullGraphDateMode = 'absolute' | 'relative';
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

export interface FullGraphStashModel {
  readonly graphCommits: readonly GitCommit[];
  readonly stashByHash: ReadonlyMap<string, GitStashEntry>;
}

export interface FullGraphPath {
  readonly d: string;
  readonly c: string;
}

export const fullGraphLaneColor = (lane: number): string =>
  FULL_GRAPH_PALETTE[
    ((lane % FULL_GRAPH_PALETTE.length) + FULL_GRAPH_PALETTE.length) % FULL_GRAPH_PALETTE.length
  ] ??
  FULL_GRAPH_PALETTE[0] ??
  '#888';

export const fullGraphLaneX = (lane: number): number =>
  FULL_GRAPH_LEFT_OFFSET + lane * FULL_GRAPH_LANE_GAP;

/** One curve/line segment path. Vertical -> straight; column change -> bezier. */
export function fullGraphSegmentPath(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const d = (y2 - y1) * 0.8;
  return `M ${x1} ${y1} C ${x1} ${y1 + d} ${x2} ${y2 - d} ${x2} ${y2}`;
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

export function fullGraphCommitMatches(commit: GitCommit, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return false;
  return (
    commit.subject.toLowerCase().includes(needle) || commit.shortHash.toLowerCase().includes(needle)
  );
}

/**
 * Git Graph draws each stash as a node hanging off its base commit. Inject a
 * synthetic commit before that base, then keep hash -> stash metadata for rows.
 */
export function fullGraphInjectStashes(
  commits: readonly GitCommit[],
  stashes: readonly GitStashEntry[],
): FullGraphStashModel {
  const byHash = new Map<string, GitStashEntry>();
  const stashCommitsByBase = new Map<string, GitCommit[]>();

  for (const stash of stashes) {
    if (stash.hash === '') continue;
    byHash.set(stash.hash, stash);
    const base = stash.parents[0] ?? '';
    const synthetic: GitCommit = {
      hash: stash.hash,
      shortHash: stash.hash.slice(0, 7),
      parents: base === '' ? [] : [base],
      author: { name: stash.authorName, email: stash.authorEmail, date: stash.date },
      committer: { name: stash.authorName, email: stash.authorEmail, date: stash.date },
      subject: stash.message,
      body: '',
      refs: [],
      tags: [],
      head: false,
    };
    const existing = stashCommitsByBase.get(base);
    if (existing) existing.push(synthetic);
    else stashCommitsByBase.set(base, [synthetic]);
  }

  if (byHash.size === 0) return { graphCommits: commits, stashByHash: byHash };

  const merged: GitCommit[] = [];
  const placed = new Set<string>();
  for (const commit of commits) {
    const attached = stashCommitsByBase.get(commit.hash);
    if (attached) {
      merged.push(...attached);
      placed.add(commit.hash);
    }
    merged.push(commit);
  }

  for (const [base, attached] of stashCommitsByBase) {
    if (!placed.has(base)) merged.unshift(...attached);
  }

  return { graphCommits: merged, stashByHash: byHash };
}

export function fullGraphPaths(
  rows: readonly GraphRow[],
  {
    rowOffset,
    hasUncommitted,
  }: {
    readonly rowOffset: number;
    readonly hasUncommitted: boolean;
  },
): readonly FullGraphPath[] {
  const out: FullGraphPath[] = [];
  rows.forEach((row, i) => {
    const cy = (i + rowOffset) * FULL_GRAPH_ROW_HEIGHT + FULL_GRAPH_ROW_HEIGHT / 2;
    const node = row.lane;
    row.lanesBefore.forEach((hash, lane) => {
      if (hash == null) return;
      const toLane = hash === row.commit.hash ? node : lane;
      out.push({
        d: fullGraphSegmentPath(
          fullGraphLaneX(lane),
          cy - FULL_GRAPH_ROW_HEIGHT / 2,
          fullGraphLaneX(toLane),
          cy,
        ),
        c: fullGraphLaneColor(toLane),
      });
    });
    row.lanesAfter.forEach((hash, lane) => {
      if (hash !== null && row.lanesBefore[lane] === hash && lane !== node) {
        out.push({
          d: fullGraphSegmentPath(
            fullGraphLaneX(lane),
            cy,
            fullGraphLaneX(lane),
            cy + FULL_GRAPH_ROW_HEIGHT / 2,
          ),
          c: fullGraphLaneColor(lane),
        });
      }
    });
    for (const lane of row.outgoing) {
      out.push({
        d: fullGraphSegmentPath(
          fullGraphLaneX(node),
          cy,
          fullGraphLaneX(lane),
          cy + FULL_GRAPH_ROW_HEIGHT / 2,
        ),
        c: fullGraphLaneColor(lane),
      });
    }
  });

  if (hasUncommitted) {
    const headRow = rows.findIndex((row) => row.commit.head);
    if (headRow !== -1) {
      const lane = rows[headRow]?.lane ?? 0;
      out.push({
        d: fullGraphSegmentPath(
          fullGraphLaneX(lane),
          FULL_GRAPH_ROW_HEIGHT / 2,
          fullGraphLaneX(lane),
          (headRow + rowOffset) * FULL_GRAPH_ROW_HEIGHT + FULL_GRAPH_ROW_HEIGHT / 2,
        ),
        c: '#808080',
      });
    }
  }

  return out;
}

/** Compact absolute date: "15 Jan 2024 14:30". */
export function fullGraphFormatDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
    d.getMonth()
  ];
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getDate())} ${mon} ${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fullGraphFormatRelativeDate(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const secs = Math.max(0, Math.round((now - t) / 1000));
  const units: [number, string][] = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [7, 'day'],
    [4.34524, 'week'],
    [12, 'month'],
    [Number.POSITIVE_INFINITY, 'year'],
  ];
  let n = secs;
  let unit = 'second';
  for (const [span, name] of units) {
    if (n < span) {
      unit = name;
      break;
    }
    n = Math.floor(n / span);
    unit = name;
  }
  if (unit === 'second' && n < 10) return 'just now';
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}

export function fullGraphFormatWhen(
  iso: string,
  mode: FullGraphDateMode,
  now = Date.now(),
): string {
  return mode === 'relative' ? fullGraphFormatRelativeDate(iso, now) : fullGraphFormatDate(iso);
}
