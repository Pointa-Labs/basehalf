import type { GitCommit, GitLogArgs, GitRefInfo } from '../common/git.js';
import type { ScmCurrentHistoryItemRefs, ScmHistoryItemRef } from '../common/history.js';
import type { GitHistoryOptions, GitHistoryRawSource } from './gitHistoryProvider.js';
import { gitLogArgsForHistoryOptions } from './gitHistoryProvider.js';
import { historyRefExists } from './historyGraphModel.js';
import type { ScmHistoryFilter } from './scmViewStore.js';

const GIT_OBJECT_ID = /^[0-9a-f]{7,64}$/i;

export interface GitHistoryPage {
  readonly commits: readonly GitCommit[];
  readonly refs: readonly GitRefInfo[];
  readonly done: boolean;
}

export function gitHistoryOptionsForFilter(
  filter: ScmHistoryFilter,
  pageSize: number,
  skip: number,
): GitHistoryOptions {
  const page = { limit: pageSize, skip };
  if (filter.kind === 'all') return { ...page, all: true };
  if (filter.kind === 'ref') return { ...page, historyItemRefs: [filter.ref] };
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
  return gitHistoryOptionsForFilter(
    historyRefExists(filter, refs) ? filter : { kind: 'auto' },
    pageSize,
    skip,
  );
}

export async function gitHistoryOptionsForSourceFilter({
  source,
  filter,
  refs,
  pageSize,
  skip,
}: {
  readonly source: GitHistoryRawSource;
  readonly filter: ScmHistoryFilter;
  readonly refs: readonly GitRefInfo[];
  readonly pageSize: number;
  readonly skip: number;
}): Promise<GitHistoryOptions> {
  if (filter.kind === 'all') return gitHistoryOptionsForFilter(filter, pageSize, skip);
  if (filter.kind === 'ref' && historyRefExists(filter, refs)) {
    return gitHistoryOptionsForFilter(filter, pageSize, skip);
  }
  const currentRefs = currentHistoryItemRefsToArray(await source.provideCurrentHistoryItemRefs());
  return {
    historyItemRefs: currentRefs.map(gitHistoryItemRefToProviderRef),
    limit: pageSize,
    skip,
  };
}

export function gitHistoryItemRefToProviderRef(ref: ScmHistoryItemRef): string {
  return ref.revision !== undefined && GIT_OBJECT_ID.test(ref.revision) ? ref.revision : ref.id;
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
  readonly source: GitHistoryRawSource;
  readonly filter: ScmHistoryFilter;
  readonly pageSize: number;
  readonly skip: number;
}): Promise<GitHistoryPage> {
  const refs = await source.provideGitRefs({ includeRemote: true, includeTags: true });
  const commits = await source.provideGitCommits(
    await gitHistoryOptionsForSourceFilter({ source, filter, refs, pageSize, skip }),
  );

  return {
    commits,
    refs,
    done: commits.length < pageSize,
  };
}

export async function loadGitHistoryLocalBranches(
  source: Pick<GitHistoryRawSource, 'provideGitRefs'>,
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
