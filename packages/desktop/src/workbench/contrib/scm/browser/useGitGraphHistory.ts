import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GitCommit } from '../common/git.js';
import { GitHistoryProvider } from './gitHistoryProvider.js';
import { loadGitHistoryLocalBranches, loadGitHistoryPage } from './gitHistoryViewModel.js';
import { type GitScmService, gitScmService } from './gitScmService.js';
import type { ScmHistoryFilter } from './scmViewStore.js';

export interface GitGraphHistoryState {
  readonly commits: readonly GitCommit[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly done: boolean;
  readonly localBranches: ReadonlySet<string>;
  readonly loadPage: (skip: number) => Promise<void>;
  readonly reload: () => Promise<void>;
}

export function historyErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function useGitGraphHistory(
  pageSize: number,
  filter: ScmHistoryFilter,
  currentBranch: string | null,
  gitService: GitScmService = gitScmService,
): GitGraphHistoryState {
  const historyProvider = useMemo(() => new GitHistoryProvider(gitService), [gitService]);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [localBranches, setLocalBranches] = useState<ReadonlySet<string>>(new Set());
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
          filter,
          pageSize,
          skip,
        });
        if (seq !== loadSeq.current) return;
        setCommits((prev) => (skip === 0 ? [...result.commits] : [...prev, ...result.commits]));
        if (result.done) setDone(true);
      } catch (err) {
        if (seq !== loadSeq.current) return;
        console.error('[GitGraphHistory] failed to load history items', err);
        if (skip === 0) setCommits([]);
        setDone(true);
        setError(historyErrorMessage(err));
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    [filter, historyProvider, pageSize],
  );

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
