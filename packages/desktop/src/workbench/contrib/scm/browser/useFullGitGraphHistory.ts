import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GitCommit, GitLogArgs, GitRefInfo, GitStashEntry } from '../common/git.js';
import type { ScmHistoryProvider } from '../common/history.js';
import { FULL_GRAPH_PAGE_SIZE } from './gitGraphViewModel.js';
import {
  type GitHistoryOptions,
  GitHistoryProvider,
  gitHistoryProvider,
  gitLogArgsForHistoryOptions,
  normalizeGitHistoryItemRefs,
} from './gitHistoryProvider.js';
import {
  gitHistoryLogArgsForAvailableFilter,
  gitHistoryOptionsForSourceFilter,
  loadGitHistoryPage,
} from './gitHistoryViewModel.js';
import { type GitScmService, gitScmService } from './gitScmService.js';
import { historyLogArgsForFilter } from './historyGraphModel.js';
import type { ScmHistoryFilter } from './scmViewStore.js';
import { historyErrorMessage, usePagedGitHistory } from './usePagedGitHistory.js';

export type FullGraphHistoryFilter =
  | ScmHistoryFilter
  | { readonly kind: 'refs'; readonly refs: readonly string[] };

export interface FullGitGraphHistoryState {
  readonly commits: readonly GitCommit[];
  readonly loading: boolean;
  readonly done: boolean;
  readonly error: string | null;
  readonly branches: readonly GitRefInfo[];
  readonly uncommitted: number;
  readonly stashes: readonly GitStashEntry[];
  readonly loadPage: (skip: number) => Promise<void>;
  readonly loadAux: () => Promise<void>;
  readonly runGraphMutation: (fn: () => Promise<unknown>) => void;
}

export function fullGraphLogArgs(filter: FullGraphHistoryFilter, skip: number): GitLogArgs {
  if (filter.kind === 'refs') {
    const refs = filter.refs.filter((ref) => ref === 'HEAD' || ref.startsWith('refs/'));
    return gitLogArgsForHistoryOptions({
      historyItemRefs: refs.length > 0 ? refs : ['HEAD'],
      limit: FULL_GRAPH_PAGE_SIZE,
      skip,
    });
  }
  return historyLogArgsForFilter(filter, null, FULL_GRAPH_PAGE_SIZE, skip);
}

export const fullGraphAvailableLogArgs = (
  filter: FullGraphHistoryFilter,
  refs: readonly GitRefInfo[],
  skip: number,
): GitLogArgs => {
  if (filter.kind === 'refs') {
    const normalized = normalizeGitHistoryItemRefs(filter.refs, refs).filter((ref) =>
      fullGraphRefExists(ref, refs),
    );
    return gitLogArgsForHistoryOptions({
      historyItemRefs: normalized,
      limit: FULL_GRAPH_PAGE_SIZE,
      skip,
    });
  }

  return gitHistoryLogArgsForAvailableFilter({
    filter,
    refs,
    pageSize: FULL_GRAPH_PAGE_SIZE,
    skip,
  });
};

function fullGraphRefExists(ref: string, refs: readonly GitRefInfo[]): boolean {
  return refs.some((candidate) => candidate.id === ref || candidate.commit === ref);
}

export const fullGraphHistoryOptionsForSource = ({
  source,
  filter,
  refs,
  skip,
}: {
  readonly source: Pick<ScmHistoryProvider, 'provideCurrentHistoryItemRefs'>;
  readonly filter: ScmHistoryFilter;
  readonly refs: readonly GitRefInfo[];
  readonly skip: number;
}): Promise<GitHistoryOptions> =>
  gitHistoryOptionsForSourceFilter({
    source,
    filter,
    refs,
    pageSize: FULL_GRAPH_PAGE_SIZE,
    skip,
  });

export const fullGraphErrorMessage = historyErrorMessage;

export function useFullGitGraphHistory({
  historyFilter,
  showRemote,
  gitService = gitScmService,
  refreshScmStatus,
  onError,
}: {
  readonly historyFilter: ScmHistoryFilter;
  readonly showRemote: boolean;
  readonly gitService?: GitScmService;
  readonly refreshScmStatus: () => Promise<void> | void;
  readonly onError: (message: string) => void;
}): FullGitGraphHistoryState {
  const historyProvider = useMemo(
    () => (gitService === gitScmService ? gitHistoryProvider : new GitHistoryProvider(gitService)),
    [gitService],
  );
  const [branches, setBranches] = useState<GitRefInfo[]>([]);
  const [uncommitted, setUncommitted] = useState(0);
  const [stashes, setStashes] = useState<readonly GitStashEntry[]>([]);

  const pageLoader = useCallback(
    (skip: number) =>
      loadGitHistoryPage({
        source: historyProvider,
        filter: historyFilter,
        pageSize: FULL_GRAPH_PAGE_SIZE,
        skip,
      }),
    [historyFilter, historyProvider],
  );

  const { commits, loading, done, error, loadPage } = usePagedGitHistory({ pageLoader });

  useEffect(() => {
    void loadPage(0);
  }, [loadPage]);

  const loadAux = useCallback(async (): Promise<void> => {
    try {
      const result = await historyProvider.provideGitRefs({
        includeRemote: showRemote,
      });
      setBranches(result.filter((ref) => ref.type === 'head' || ref.type === 'remoteHead'));
    } catch {
      /* optional graph side data */
    }
    try {
      const status = await gitService.status();
      setUncommitted(status.isRepo ? status.files.length : 0);
    } catch {
      /* optional graph side data */
    }
    try {
      setStashes([...(await gitService.stashList())]);
    } catch {
      /* optional graph side data */
    }
  }, [gitService, historyProvider, showRemote]);

  useEffect(() => {
    void loadAux();
  }, [loadAux]);

  const runGraphMutation = useCallback(
    (fn: () => Promise<unknown>): void => {
      void (async () => {
        try {
          await fn();
          await loadPage(0);
          await loadAux();
          await refreshScmStatus();
        } catch (err) {
          onError(fullGraphErrorMessage(err));
        }
      })();
    },
    [loadPage, loadAux, onError, refreshScmStatus],
  );

  return {
    commits,
    loading,
    done,
    error,
    branches,
    uncommitted,
    stashes,
    loadPage,
    loadAux,
    runGraphMutation,
  };
}
