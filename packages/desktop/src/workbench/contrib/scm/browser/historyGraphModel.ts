import { color } from '../../../browser/style/design.js';
import type { GitCommit, GitLogArgs, GitRefInfo } from '../common/git.js';
import { laneColor } from '../common/gitGraphLayout.js';
import type {
  ScmCurrentHistoryItemRefs,
  ScmHistoryItemRef,
  ScmHistoryProvider,
} from '../common/history.js';
import { type GitHistoryOptions, normalizeGitHistoryItemRefs } from './gitHistoryProvider.js';
import { type ScmHistoryFilter, scmHistoryFilterRefs } from './scmViewStore.js';

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

const HEAD_HISTORY_ITEM_REF: ScmHistoryItemRef = { id: 'HEAD', name: 'HEAD' };

export interface HistoryGraphPage {
  readonly commits: readonly GitCommit[];
  readonly done: boolean;
}

export interface HistoryGraphPageSource
  extends Pick<ScmHistoryProvider, 'provideCurrentHistoryItemRefs' | 'provideHistoryItemRefs'> {
  provideGitCommits(options: GitHistoryOptions): Promise<readonly GitCommit[]>;
}

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
  if (filter.kind === 'all') return { ...page, ref: 'HEAD' };
  const filterRefs = scmHistoryFilterRefs(filter);
  if (filterRefs !== undefined) {
    const refs = safeDirectHistoryRefs(filterRefs);
    if (refs.length > 1) return { ...page, refNames: refs };
    return { ...page, ref: refs[0] ?? 'HEAD' };
  }
  return { ...page, ref: 'HEAD' };
};

export const historyRefExists = (filter: ScmHistoryFilter, refs: readonly GitRefInfo[]): boolean =>
  scmHistoryFilterRefs(filter) === undefined ||
  availableHistoryFilterRefs(filter, refs).kind !== 'auto';

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
  filter.kind === 'all'
    ? historyLogArgsForHistoryRefs(refs, pageSize, skip)
    : historyLogArgsForFilter(
        availableHistoryFilterRefs(filter, refs),
        currentBranch,
        pageSize,
        skip,
      );

function historyLogArgsForHistoryRefs(
  refs: readonly GitRefInfo[],
  pageSize: number,
  skip: number,
): GitLogArgs {
  const refNames = refs.map(historyRefToProviderRef);
  if (refNames.length > 1) return { refNames, maxCount: pageSize, skip };
  return { ref: refNames[0] ?? 'HEAD', maxCount: pageSize, skip };
}

function historyRefToProviderRef(ref: GitRefInfo): string {
  return ref.commit ?? ref.id;
}

function availableHistoryFilterRefs(
  filter: ScmHistoryFilter,
  refs: readonly GitRefInfo[],
): ScmHistoryFilter {
  if (filter.kind === 'all' || filter.kind === 'auto') return filter;

  const filterRefs = scmHistoryFilterRefs(filter) ?? [];
  const normalizedRefs = normalizeGitHistoryItemRefs(filterRefs, refs, { dropUnknown: true });
  const availableRefs = normalizedRefs.flatMap((selectedRef) => {
    const match = refs.find((ref) =>
      selectedRef.startsWith('refs/')
        ? ref.id === selectedRef
        : ref.id === selectedRef || ref.commit === selectedRef,
    );
    return match === undefined ? [] : [historyRefToProviderRef(match)];
  });

  if (availableRefs.length === 0) return { kind: 'auto' };
  return { kind: 'refs', refs: [...new Set(availableRefs)] };
}

export function historyGraphOptionsForRefs(
  refs: readonly ScmHistoryItemRef[],
  pageSize: number,
  skip: number,
): GitHistoryOptions {
  const historyItemRefs = refs.map(historyGraphItemRefToProviderRef);
  return {
    historyItemRefs: historyItemRefs.length > 0 ? historyItemRefs : ['HEAD'],
    limit: pageSize,
    skip,
  };
}

export function historyGraphItemRefToProviderRef(ref: ScmHistoryItemRef): string {
  return ref.revision !== undefined && ref.revision !== ref.name ? ref.revision : ref.id;
}

export async function resolveHistoryGraphRefs(
  provider: Pick<ScmHistoryProvider, 'provideCurrentHistoryItemRefs' | 'provideHistoryItemRefs'>,
  filter: ScmHistoryFilter,
): Promise<readonly ScmHistoryItemRef[]> {
  if (filter.kind === 'all') return provider.provideHistoryItemRefs();

  const filterRefs = scmHistoryFilterRefs(filter);
  if (filterRefs !== undefined) {
    const refs = selectedHistoryGraphRefs(
      await provider.provideHistoryItemRefs([...filterRefs]),
      filterRefs,
    );
    return refs.length === 0
      ? currentHistoryItemRefsToArray(await provider.provideCurrentHistoryItemRefs())
      : refs;
  }

  return currentHistoryItemRefsToArray(await provider.provideCurrentHistoryItemRefs());
}

export async function historyGraphOptionsForFilter({
  provider,
  filter,
  pageSize,
  skip,
}: {
  readonly provider: Pick<
    ScmHistoryProvider,
    'provideCurrentHistoryItemRefs' | 'provideHistoryItemRefs'
  >;
  readonly filter: ScmHistoryFilter;
  readonly pageSize: number;
  readonly skip: number;
}): Promise<GitHistoryOptions> {
  return historyGraphOptionsForRefs(
    await resolveHistoryGraphRefs(provider, filter),
    pageSize,
    skip,
  );
}

export async function loadHistoryGraphPage({
  source,
  filter,
  pageSize,
  skip,
}: {
  readonly source: HistoryGraphPageSource;
  readonly filter: ScmHistoryFilter;
  readonly pageSize: number;
  readonly skip: number;
}): Promise<HistoryGraphPage> {
  const commits = await source.provideGitCommits(
    await historyGraphOptionsForFilter({ provider: source, filter, pageSize, skip }),
  );

  return {
    commits,
    done: commits.length < pageSize,
  };
}

function selectedHistoryGraphRefs(
  refs: readonly ScmHistoryItemRef[],
  selectedRefs: readonly string[],
): readonly ScmHistoryItemRef[] {
  return refs.filter((ref) =>
    selectedRefs.some((selectedRef) =>
      selectedRef.startsWith('refs/')
        ? ref.id === selectedRef
        : ref.id === selectedRef || ref.name === selectedRef || ref.revision === selectedRef,
    ),
  );
}

function currentHistoryItemRefsToArray(
  refs: ScmCurrentHistoryItemRefs,
): readonly ScmHistoryItemRef[] {
  const out = [refs.historyItemRef, refs.historyItemRemoteRef, refs.historyItemBaseRef].filter(
    (ref): ref is ScmHistoryItemRef => ref !== undefined,
  );
  if (out.length === 0) return [HEAD_HISTORY_ITEM_REF];

  const seen = new Set<string>();
  return out.filter((ref) => {
    const key = historyGraphItemRefToProviderRef(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function safeDirectHistoryRefs(refs: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  return refs
    .map((ref) => ref.trim())
    .filter((ref) => ref === 'HEAD' || ref.startsWith('refs/'))
    .filter((ref) => {
      if (seen.has(ref)) return false;
      seen.add(ref);
      return true;
    });
}

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
