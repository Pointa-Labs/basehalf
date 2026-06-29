import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GitCommit } from '../common/git.js';
import { GitHistoryProvider, gitHistoryProvider } from './gitHistoryProvider.js';
import { loadGitHistoryLocalBranches, loadGitHistoryPage } from './gitHistoryViewModel.js';
import { type GitScmService, gitScmService } from './gitScmService.js';
import type { ScmHistoryFilter } from './scmViewStore.js';
import { historyErrorMessage, usePagedGitHistory } from './usePagedGitHistory.js';

export { historyErrorMessage };

export interface GitGraphHistoryState {
  readonly commits: readonly GitCommit[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly done: boolean;
  readonly localBranches: ReadonlySet<string>;
  readonly loadPage: (skip: number) => Promise<void>;
  readonly reload: () => Promise<void>;
}

export function useGitGraphHistory(
  pageSize: number,
  filter: ScmHistoryFilter,
  currentBranch: string | null,
  gitService: GitScmService = gitScmService,
): GitGraphHistoryState {
  const historyProvider = useMemo(
    () => (gitService === gitScmService ? gitHistoryProvider : new GitHistoryProvider(gitService)),
    [gitService],
  );
  const [localBranches, setLocalBranches] = useState<ReadonlySet<string>>(new Set());

  const pageLoader = useCallback(
    (skip: number) =>
      loadGitHistoryPage({
        source: historyProvider,
        filter,
        pageSize,
        skip,
      }),
    [filter, historyProvider, pageSize],
  );

  const onLoadError = useCallback((err: unknown) => {
    console.error('[GitGraphHistory] failed to load history items', err);
  }, []);

  const { commits, loading, error, done, loadPage } = usePagedGitHistory({
    pageLoader,
    onLoadError,
  });

  const loadLocalBranches = useCallback(async (): Promise<void> => {
    try {
      setLocalBranches(await loadGitHistoryLocalBranches(historyProvider));
    } catch {
      setLocalBranches(new Set());
    }
  }, [historyProvider]);

  const reload = useCallback(async (): Promise<void> => {
    await Promise.all([loadPage(0), loadLocalBranches()]);
  }, [loadPage, loadLocalBranches]);

  useEffect(() => {
    void currentBranch;
    void reload();
  }, [currentBranch, reload]);

  return {
    commits,
    loading,
    error,
    done,
    localBranches,
    loadPage,
    reload,
  };
}
