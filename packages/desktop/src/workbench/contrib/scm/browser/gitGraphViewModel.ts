import type { GitCommit, GitStashEntry } from '../common/git.js';
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
