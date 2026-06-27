import type { GitCommit, GitLogResult, GitRefsResult } from '@basehalf/core';
import { useCallback, useEffect, useState } from 'react';
import type { ScmHistoryFilter } from '../../store/scmView.js';
import { historyLogArgsForFilter } from './historyGraphModel.js';

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
): GitGraphHistoryState {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [localBranches, setLocalBranches] = useState<ReadonlySet<string>>(new Set());

  const loadPage = useCallback(
    async (skip: number): Promise<void> => {
      setLoading(true);
      setError(null);
      if (skip === 0) {
        setDone(false);
        setCommits([]);
      }
      try {
        const result = (await window.bh.run('git.log', {
          ...historyLogArgsForFilter(filter, currentBranch, pageSize, skip),
        })) as GitLogResult;
        setCommits((prev) => (skip === 0 ? [...result.commits] : [...prev, ...result.commits]));
        if (result.commits.length < pageSize) setDone(true);
      } catch (err) {
        console.error('[GitGraphHistory] failed to load history items', err);
        if (skip === 0) setCommits([]);
        setDone(true);
        setError(null);
      } finally {
        setLoading(false);
      }
    },
    [currentBranch, filter, pageSize],
  );

  const loadLocalBranches = useCallback(async (): Promise<void> => {
    try {
      const result = (await window.bh.run('git.refs', {
        includeRemote: true,
      })) as GitRefsResult;
      setLocalBranches(
        new Set(result.refs.filter((ref) => ref.type === 'head').map((ref) => ref.name)),
      );
    } catch {
      setLocalBranches(new Set());
    }
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    await Promise.all([loadPage(0), loadLocalBranches()]);
  }, [loadPage, loadLocalBranches]);

  useEffect(() => {
    void reload();
  }, [reload]);

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
