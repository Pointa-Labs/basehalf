import { color } from '../../../browser/style/design.js';
import type { GitLogArgs, GitRefInfo } from '../common/git.js';
import { laneColor } from './gitGraphLayout.js';
import type { ScmHistoryFilter } from './scmViewStore.js';

// VS Code SCM History renderer constants:
// reference/vscode/src/vs/workbench/contrib/scm/browser/scmHistory.ts
export const SWIMLANE_HEIGHT = 22;
export const SWIMLANE_WIDTH = 11;
export const SWIMLANE_CURVE_RADIUS = 5;
export const CIRCLE_RADIUS = 4;
export const CIRCLE_STROKE_WIDTH = 2;

export const SCM_GRAPH_COLORS = ['#FFB000', '#DC267F', '#994F00', '#40B0A6', '#B66DFF'] as const;

export const HISTORY_REF_COLORS = {
  local: '#59a4f9',
  remote: '#B180D7',
  base: '#EA5C00',
  tag: '#CCA700',
} as const;

export type HistoryRefTone = 'head' | 'local' | 'remote' | 'tag';

export const historyLaneX = (lane: number): number => SWIMLANE_WIDTH * (lane + 1);

export const historyGraphWidth = (laneCount: number): number =>
  SWIMLANE_WIDTH * (Math.max(laneCount, 1) + 1);

export const historyLaneColor = (lane: number): string =>
  SCM_GRAPH_COLORS[laneColor(lane, SCM_GRAPH_COLORS.length)] ?? SCM_GRAPH_COLORS[0];

export const historyRefTone = (
  ref: string,
  localBranches: ReadonlySet<string>,
): Exclude<HistoryRefTone, 'head' | 'tag'> =>
  localBranches.has(ref) || !ref.includes('/') ? 'local' : 'remote';

export const historyStatusTone = (status: string): string =>
  status === 'A'
    ? color.success
    : status === 'D'
      ? color.danger
      : status === 'R' || status === 'C'
        ? color.accent
        : color.warning;

export const historyLogArgsForFilter = (
  filter: ScmHistoryFilter,
  _currentBranch: string | null,
  pageSize: number,
  skip: number,
): GitLogArgs => {
  const page = { maxCount: pageSize, skip };
  if (filter.kind === 'all') return { ...page, all: true };
  if (filter.kind === 'ref') return { ...page, ref: filter.ref };
  return { ...page, ref: 'HEAD' };
};

export const historyRefExists = (filter: ScmHistoryFilter, refs: readonly GitRefInfo[]): boolean =>
  filter.kind !== 'ref' ||
  refs.some(
    (ref) => ref.id === filter.ref || (ref.commit !== undefined && ref.commit === filter.ref),
  );

export const historyLogArgsForAvailableFilter = ({
  filter,
  refs,
  pageSize,
  skip,
  currentBranch,
}: {
  readonly filter: ScmHistoryFilter;
  readonly refs: readonly GitRefInfo[];
  readonly pageSize: number;
  readonly skip: number;
  readonly currentBranch: string | null;
}): GitLogArgs =>
  historyLogArgsForFilter(
    historyRefExists(filter, refs) ? filter : { kind: 'auto' },
    currentBranch,
    pageSize,
    skip,
  );

/** Compact relative time from an ISO date, matching the terse VS Code tree style. */
export function historyTimeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
