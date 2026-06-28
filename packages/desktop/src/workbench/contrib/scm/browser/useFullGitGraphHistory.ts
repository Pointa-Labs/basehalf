import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GitCommit, GitLogArgs, GitRefInfo, GitStashEntry } from '../common/git.js';
import { FULL_GRAPH_PAGE_SIZE } from './gitGraphViewModel.js';
import { GitHistoryProvider } from './gitHistoryProvider.js';
import {
  gitHistoryLogArgsForAvailableFilter,
  gitHistoryLogArgsForFilter,
  loadGitHistoryPage,
} from './gitHistoryViewModel.js';
import { type GitScmService, gitScmService } from './gitScmService.js';
import type { ScmHistoryFilter } from './scmViewStore.js';

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

export function fullGraphLogArgs(filter: ScmHistoryFilter, skip: number): GitLogArgs {
  return gitHistoryLogArgsForFilter(filter, FULL_GRAPH_PAGE_SIZE, skip);
}

export const fullGraphAvailableLogArgs = (
  filter: ScmHistoryFilter,
  refs: readonly GitRefInfo[],
  skip: number,
): GitLogArgs =>
  gitHistoryLogArgsForAvailableFilter({
    filter,
    refs,
    pageSize: FULL_GRAPH_PAGE_SIZE,
    skip,
  });

export const fullGraphErrorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

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
  const historyProvider = useMemo(() => new GitHistoryProvider(gitService), [gitService]);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branches, setBranches] = useState<GitRefInfo[]>([]);
  const [uncommitted, setUncommitted] = useState(0);
  const [stashes, setStashes] = useState<readonly GitStashEntry[]>([]);
  const loadSeq = useRef(0);

  const loadPage = useCallback(
    async (skip: number): Promise<void> => {
      loadSeq.current += 1;
      const seq = loadSeq.current;
      setLoading(true);
      setError(null);
      if (skip === 0) {
        setDone(false);
        setCommits([]);
      }
      try {
        const result = await loadGitHistoryPage({
          source: historyProvider,
          filter: historyFilter,
          pageSize: FULL_GRAPH_PAGE_SIZE,
          skip,
        });
        if (seq !== loadSeq.current) return;
        setCommits((prev) => (skip === 0 ? [...result.commits] : [...prev, ...result.commits]));
        setDone(result.done);
      } catch (err) {
        if (seq !== loadSeq.current) return;
        if (skip === 0) setCommits([]);
        setDone(true);
        setError(fullGraphErrorMessage(err));
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    [historyFilter, historyProvider],
  );

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
