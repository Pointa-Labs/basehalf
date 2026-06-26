import type { GitShowResult, WorkspaceReadFileResult } from '@basehalf/core';
import { useEffect, useState } from 'react';
import { type DiffRow, computeUnifiedDiff } from './unifiedDiff.js';

/**
 * Fetch a file's two sides and compute its unified-diff rows — shared by the
 * single-file diff view and the canvas-card diff preview.
 *   left  = `git.show <leftRef>:./path`  (ref '' = the index version)
 *   right = the working-tree file (rightWorktree) or the index version
 * A deleted working-tree file → an empty right side (the deletion). Inputs above
 * a generous char cap skip the diff. `revision` forces a refetch (pass the file's
 * git-status signature so the card refreshes when the file changes).
 */
const MAX_DIFF_CHARS = 2 * 1024 * 1024;

export type FileDiffState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly rows: DiffRow[] }
  | { readonly status: 'error'; readonly message: string };

export function useFileDiff(
  path: string,
  opts: { leftRef: string; rightWorktree: boolean; context?: number },
  revision?: unknown,
): FileDiffState {
  const { leftRef, rightWorktree, context } = opts;
  const [state, setState] = useState<FileDiffState>({ status: 'loading' });
  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` is an intentional refetch trigger (not read in the body).
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    void (async () => {
      try {
        const leftP = window.bh.run('git.show', { ref: leftRef, path }) as Promise<GitShowResult>;
        const rightP = rightWorktree
          ? (
              window.bh.run('workspace.readFile', { path }) as Promise<WorkspaceReadFileResult>
            ).catch((err: unknown): WorkspaceReadFileResult => {
              // A deleted working-tree file → the right side is simply empty.
              if (err instanceof Error && err.message.startsWith('[PATH_NOT_FOUND]')) {
                return { content: '' } as WorkspaceReadFileResult;
              }
              throw err;
            })
          : (window.bh.run('git.show', { ref: '', path }) as Promise<GitShowResult>);
        const [left, right] = await Promise.all([leftP, rightP]);
        if (cancelled) return;
        const original = left.content ?? '';
        const modified = right.content ?? '';
        if (original.length > MAX_DIFF_CHARS || modified.length > MAX_DIFF_CHARS) {
          setState({ status: 'error', message: 'File is too large to show a diff.' });
          return;
        }
        setState({ status: 'ready', rows: computeUnifiedDiff(original, modified, { context }) });
      } catch (err) {
        if (!cancelled)
          setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, leftRef, rightWorktree, context, revision]);
  return state;
}
