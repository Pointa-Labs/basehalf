import type {
  ScmCurrentHistoryItemRefs,
  ScmHistoryItem,
  ScmHistoryItemRef,
  ScmHistoryOptions,
  ScmHistoryProvider,
} from '../common/history.js';
import type { ScmHistoryFilter } from './scmViewStore.js';

const HEAD_HISTORY_ITEM_REF: ScmHistoryItemRef = { id: 'HEAD', name: 'HEAD' };

export interface ScmHistoryPage {
  readonly historyItems: readonly ScmHistoryItem[];
  readonly refs: readonly ScmHistoryItemRef[];
  readonly selectedRefs: readonly ScmHistoryItemRef[];
  readonly done: boolean;
}

export function scmHistoryOptionsForRefs(
  refs: readonly ScmHistoryItemRef[],
  pageSize: number,
  skip: number,
): ScmHistoryOptions {
  return {
    historyItemRefs: refs.map((ref) => ref.revision ?? ref.id),
    limit: pageSize,
    skip,
  };
}

export async function resolveScmHistoryItemRefs(
  provider: Pick<ScmHistoryProvider, 'provideCurrentHistoryItemRefs' | 'provideHistoryItemRefs'>,
  filter: ScmHistoryFilter,
): Promise<readonly ScmHistoryItemRef[]> {
  if (filter.kind === 'all') {
    return provider.provideHistoryItemRefs();
  }

  if (filter.kind === 'ref') {
    const refs = selectedHistoryItemRefs(
      await provider.provideHistoryItemRefs([filter.ref]),
      filter.ref,
    );
    return refs.length === 0
      ? currentHistoryItemRefsToArray(await provider.provideCurrentHistoryItemRefs())
      : refs;
  }

  return currentHistoryItemRefsToArray(await provider.provideCurrentHistoryItemRefs());
}

export async function scmHistoryOptionsForFilter({
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
}): Promise<ScmHistoryOptions> {
  const refs = await resolveScmHistoryItemRefs(provider, filter);
  return scmHistoryOptionsForRefs(refs, pageSize, skip);
}

export async function loadScmHistoryPage({
  provider,
  filter,
  pageSize,
  skip,
}: {
  readonly provider: ScmHistoryProvider;
  readonly filter: ScmHistoryFilter;
  readonly pageSize: number;
  readonly skip: number;
}): Promise<ScmHistoryPage> {
  const refs = await provider.provideHistoryItemRefs();
  const selectedRefs =
    filter.kind === 'all' ? refs : await resolveScmHistoryItemRefs(provider, filter);
  const historyItems = await provider.provideHistoryItems(
    scmHistoryOptionsForRefs(selectedRefs, pageSize, skip),
  );

  return {
    historyItems,
    refs,
    selectedRefs,
    done: historyItems.length < pageSize,
  };
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
    const key = ref.revision ?? ref.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function selectedHistoryItemRefs(
  refs: readonly ScmHistoryItemRef[],
  selectedRef: string,
): readonly ScmHistoryItemRef[] {
  if (selectedRef.startsWith('refs/')) {
    return refs.filter((ref) => ref.id === selectedRef);
  }
  return refs.filter((ref) => ref.id === selectedRef || ref.name === selectedRef);
}
