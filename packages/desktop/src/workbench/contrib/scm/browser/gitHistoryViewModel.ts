import type { GitCommit, GitLogArgs, GitRefInfo, GitRefsArgs } from '../common/git.js';
import type {
  ScmCurrentHistoryItemRefs,
  ScmHistoryItemRef,
  ScmHistoryProvider,
} from '../common/history.js';
import type { GitHistoryOptions } from './gitHistoryProvider.js';
import {
  gitCommitFromHistoryItem,
  gitLogArgsForHistoryOptions,
  normalizeGitHistoryItemRefs,
} from './gitHistoryProvider.js';
import { type ScmHistoryFilter, scmHistoryFilterRefs } from './scmViewStore.js';

export interface GitHistoryPage {
  readonly commits: readonly GitCommit[];
  readonly refs: readonly GitRefInfo[];
  readonly done: boolean;
}

export interface GitHistoryPageSource
  extends Pick<ScmHistoryProvider, 'provideCurrentHistoryItemRefs' | 'provideHistoryItems'> {
  provideGitRefs(args?: GitRefsArgs): Promise<readonly GitRefInfo[]>;
}

export function gitHistoryOptionsForFilter(
  filter: ScmHistoryFilter,
  pageSize: number,
  skip: number,
): GitHistoryOptions {
  const page = { limit: pageSize, skip };
  if (filter.kind === 'all') return { ...page, historyItemRefs: ['HEAD'] };
  const filterRefs = scmHistoryFilterRefs(filter);
  if (filterRefs !== undefined) return { ...page, historyItemRefs: filterRefs };
  return { ...page, historyItemRefs: ['HEAD'] };
}

export function gitHistoryOptionsForAvailableFilter({
  filter,
  refs,
  pageSize,
  skip,
}: {
  readonly filter: ScmHistoryFilter;
  readonly refs: readonly GitRefInfo[];
  readonly pageSize: number;
  readonly skip: number;
}): GitHistoryOptions {
  const page = { limit: pageSize, skip };
  if (filter.kind === 'all') {
    const allRefs = allGitHistoryRefs(refs);
    return { ...page, historyItemRefs: allRefs.length > 0 ? allRefs : ['HEAD'] };
  }
  const filterRefs = scmHistoryFilterRefs(filter);
  if (filterRefs !== undefined) {
    const availableRefs = availableGitHistoryRefs(filterRefs, refs);
    if (availableRefs.length > 0) return { ...page, historyItemRefs: availableRefs };
  }
  return { ...page, historyItemRefs: ['HEAD'] };
}

export async function gitHistoryOptionsForSourceFilter({
  source,
  filter,
  refs,
  pageSize,
  skip,
}: {
  readonly source: Pick<ScmHistoryProvider, 'provideCurrentHistoryItemRefs'>;
  readonly filter: ScmHistoryFilter;
  readonly refs: readonly GitRefInfo[];
  readonly pageSize: number;
  readonly skip: number;
}): Promise<GitHistoryOptions> {
  if (filter.kind === 'all') {
    const allRefs = allGitHistoryRefs(refs);
    if (allRefs.length > 0) return { historyItemRefs: allRefs, limit: pageSize, skip };
  }
  const filterRefs = scmHistoryFilterRefs(filter);
  if (filterRefs !== undefined) {
    const availableRefs = availableGitHistoryRefs(filterRefs, refs);
    if (availableRefs.length > 0) {
      return {
        historyItemRefs: availableRefs,
        limit: pageSize,
        skip,
      };
    }
  }
  const currentRefs = currentHistoryItemRefsToArray(await source.provideCurrentHistoryItemRefs());
  return {
    historyItemRefs: currentRefs.map(gitHistoryItemRefToProviderRef),
    limit: pageSize,
    skip,
  };
}

function gitHistoryRefExists(ref: string, refs: readonly GitRefInfo[]): boolean {
  return gitHistoryRefMatch(ref, refs) !== undefined;
}

function gitHistoryRefMatch(ref: string, refs: readonly GitRefInfo[]): GitRefInfo | undefined {
  return refs.find((candidate) => candidate.id === ref || candidate.commit === ref);
}

function availableGitHistoryRefs(
  historyItemRefs: readonly string[],
  refs: readonly GitRefInfo[],
): readonly string[] {
  return normalizeGitHistoryItemRefs(historyItemRefs, refs).flatMap((ref) => {
    const match = gitHistoryRefMatch(ref, refs);
    return match === undefined ? [] : [gitRefInfoToProviderRef(match)];
  });
}

export function gitHistoryItemRefToProviderRef(ref: ScmHistoryItemRef): string {
  return ref.revision !== undefined && ref.revision !== ref.name ? ref.revision : ref.id;
}

function gitRefInfoToProviderRef(ref: GitRefInfo): string {
  return ref.commit ?? ref.id;
}

function allGitHistoryRefs(refs: readonly GitRefInfo[]): readonly string[] {
  const seen = new Set<string>();
  return refs.map(gitRefInfoToProviderRef).filter((ref) => {
    if (seen.has(ref)) return false;
    seen.add(ref);
    return true;
  });
}

export function gitHistoryLogArgsForFilter(
  filter: ScmHistoryFilter,
  pageSize: number,
  skip: number,
): GitLogArgs {
  return gitLogArgsForHistoryOptions(gitHistoryOptionsForFilter(filter, pageSize, skip));
}

export function gitHistoryLogArgsForAvailableFilter({
  filter,
  refs,
  pageSize,
  skip,
}: {
  readonly filter: ScmHistoryFilter;
  readonly refs: readonly GitRefInfo[];
  readonly pageSize: number;
  readonly skip: number;
}): GitLogArgs {
  return gitLogArgsForHistoryOptions(
    gitHistoryOptionsForAvailableFilter({ filter, refs, pageSize, skip }),
  );
}

export async function loadGitHistoryPage({
  source,
  filter,
  pageSize,
  skip,
}: {
  readonly source: GitHistoryPageSource;
  readonly filter: ScmHistoryFilter;
  readonly pageSize: number;
  readonly skip: number;
}): Promise<GitHistoryPage> {
  const refs = await source.provideGitRefs({ includeRemote: true, includeTags: true });
  const historyItems = await source.provideHistoryItems(
    await gitHistoryOptionsForSourceFilter({ source, filter, refs, pageSize, skip }),
  );
  const commits = historyItems.map(gitCommitFromHistoryItem);

  return {
    commits,
    refs,
    done: commits.length < pageSize,
  };
}

export async function loadGitHistoryLocalBranches(
  source: Pick<GitHistoryPageSource, 'provideGitRefs'>,
): Promise<ReadonlySet<string>> {
  const refs = await source.provideGitRefs({ includeRemote: true });
  return new Set(refs.filter((ref) => ref.type === 'head').map((ref) => ref.name));
}

function currentHistoryItemRefsToArray(
  refs: ScmCurrentHistoryItemRefs,
): readonly ScmHistoryItemRef[] {
  const out = [refs.historyItemRef, refs.historyItemRemoteRef, refs.historyItemBaseRef].filter(
    (ref): ref is ScmHistoryItemRef => ref !== undefined,
  );
  if (out.length === 0) return [{ id: 'HEAD', name: 'HEAD' }];

  const seen = new Set<string>();
  return out.filter((ref) => {
    const key = gitHistoryItemRefToProviderRef(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
