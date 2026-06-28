import { useCallback, useRef, useState } from 'react';
import type { GitCommit } from '../common/git.js';

export interface PagedGitHistoryPage {
  readonly commits: readonly GitCommit[];
  readonly done: boolean;
}

export interface PagedGitHistoryState {
  readonly commits: readonly GitCommit[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly done: boolean;
  readonly loadPage: (skip: number) => Promise<void>;
}

export function historyErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function usePagedGitHistory({
  pageLoader,
  onLoadError,
}: {
  readonly pageLoader: (skip: number) => Promise<PagedGitHistoryPage>;
  readonly onLoadError?: (err: unknown) => void;
}): PagedGitHistoryState {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
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
        const result = await pageLoader(skip);
        if (seq !== loadSeq.current) return;
        setCommits((prev) => (skip === 0 ? [...result.commits] : [...prev, ...result.commits]));
        setDone(result.done);
      } catch (err) {
        if (seq !== loadSeq.current) return;
        onLoadError?.(err);
        if (skip === 0) setCommits([]);
        setDone(true);
        setError(historyErrorMessage(err));
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    [onLoadError, pageLoader],
  );

  return { commits, loading, error, done, loadPage };
}
