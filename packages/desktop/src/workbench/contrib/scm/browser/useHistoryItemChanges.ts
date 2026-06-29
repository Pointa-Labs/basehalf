import { useEffect, useMemo, useState } from 'react';
import type { ScmHistoryItemChange, ScmHistoryProvider } from '../common/history.js';
import { GitHistoryProvider, gitHistoryProvider } from './gitHistoryProvider.js';
import { type GitScmService, gitScmService } from './gitScmService.js';

export interface HistoryItemChangesState {
  readonly files: readonly ScmHistoryItemChange[] | null;
  readonly error: string | null;
  readonly setError: (message: string | null) => void;
}

export function useGitHistoryProvider(gitService: GitScmService): ScmHistoryProvider {
  return useMemo(
    () => (gitService === gitScmService ? gitHistoryProvider : new GitHistoryProvider(gitService)),
    [gitService],
  );
}

export function useHistoryItemChanges(
  provider: ScmHistoryProvider,
  historyItemId: string | null,
  historyItemParentId: string | undefined,
  opts: { readonly swallowErrors?: boolean } = {},
): HistoryItemChangesState {
  const [files, setFiles] = useState<readonly ScmHistoryItemChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (historyItemId === null) return;
    let cancelled = false;
    setFiles(null);
    setError(null);
    void (async () => {
      try {
        const files = await provider.provideHistoryItemChanges(historyItemId, historyItemParentId);
        if (!cancelled) setFiles(files);
      } catch (err) {
        if (cancelled) return;
        if (opts.swallowErrors === true) {
          setFiles([]);
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [historyItemId, historyItemParentId, opts.swallowErrors, provider]);

  return { files, error, setError };
}
