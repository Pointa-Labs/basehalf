import { useEffect, useState } from 'react';
import { workspaceService } from '../../../../platform/workspaces/browser/workspaceService.js';
import { gitScmService } from '../../scm/browser/gitScmService.js';
import { type DiffRow, computeUnifiedDiff } from './unifiedDiffModel.js';

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

// monaco.colorize tokenizes on the MAIN thread, so a canvas full of changed cards
// mounting together would fire dozens in one frame and freeze. Cap how many files
// colorize at once; the rest queue (total work is unchanged — colorize can't run
// in parallel anyway — but it's spread across frames instead of one big stall).
const MAX_CONCURRENT_COLORIZE = 3;
let colorizeActive = 0;
const colorizeQueue: Array<() => void> = [];
async function withColorizeSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (colorizeActive >= MAX_CONCURRENT_COLORIZE) {
    await new Promise<void>((resolve) => colorizeQueue.push(resolve));
  }
  colorizeActive++;
  try {
    return await fn();
  } finally {
    colorizeActive--;
    colorizeQueue.shift()?.();
  }
}

export type FileDiffState =
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready';
      readonly rows: DiffRow[];
      // Per-line syntax-highlighted HTML (monaco colorize) for each side, indexed
      // by lineNumber-1. Undefined when the language is unknown / colorize failed —
      // the renderer falls back to plain text.
      readonly oldHtml: readonly string[] | undefined;
      readonly newHtml: readonly string[] | undefined;
    }
  | { readonly status: 'error'; readonly message: string };

export function useFileDiff(
  path: string,
  opts: {
    leftRef: string;
    rightWorktree: boolean;
    rightRef?: string;
    context?: number;
    ignoreWhitespace?: boolean;
  },
  revision?: unknown,
): FileDiffState {
  const { leftRef, rightWorktree, rightRef, context, ignoreWhitespace } = opts;
  const [state, setState] = useState<FileDiffState>({ status: 'loading' });
  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` is an intentional refetch trigger (not read in the body).
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    void (async () => {
      try {
        const leftP = gitScmService.show(leftRef, path);
        const rightP: Promise<string | null> = rightWorktree
          ? workspaceService
              .readFile(path)
              .then((result) => result.content ?? '')
              .catch((err: unknown): string => {
                // A deleted working-tree file → the right side is simply empty.
                if (err instanceof Error && err.message.startsWith('[PATH_NOT_FOUND]')) {
                  return '';
                }
                throw err;
              })
          : // rightRef set → a historical commit's version (commit diff); else the
            // index version (ref ''). Lets one hook serve worktree, staged, and
            // commit-to-commit diffs.
            gitScmService.show(rightRef ?? '', path);
        const [left, right] = await Promise.all([leftP, rightP]);
        if (cancelled) return;
        const original = left ?? '';
        const modified = right ?? '';
        if (original.length > MAX_DIFF_CHARS || modified.length > MAX_DIFF_CHARS) {
          setState({ status: 'error', message: 'File is too large to show a diff.' });
          return;
        }
        const rows = computeUnifiedDiff(original, modified, { context, ignoreWhitespace });
        // Syntax-highlight both sides (monaco colorize → one HTML string per side,
        // lines joined by <br/>). Best-effort: an unknown language / failure falls
        // back to plain text in the renderer.
        let oldHtml: string[] | undefined;
        let newHtml: string[] | undefined;
        try {
          // Lazy-load monaco (a browser-only module that touches `window` at import
          // time) only when the hook actually runs, so node test graphs that
          // transitively import this hook don't eagerly pull it in.
          const [monaco, { languageOf }] = await Promise.all([
            import('monaco-editor'),
            import('../../../browser/parts/editor/monacoSetup.js'),
          ]);
          const language = languageOf(path);
          const [o, m] = await withColorizeSlot(() =>
            Promise.all([
              monaco.editor.colorize(original, language, { tabSize: 2 }),
              monaco.editor.colorize(modified, language, { tabSize: 2 }),
            ]),
          );
          if (cancelled) return;
          oldHtml = o.split('<br/>');
          newHtml = m.split('<br/>');
        } catch {
          // unknown language / colorize failure → plain fallback
        }
        setState({ status: 'ready', rows, oldHtml, newHtml });
      } catch (err) {
        if (!cancelled)
          setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, leftRef, rightWorktree, rightRef, context, ignoreWhitespace, revision]);
  return state;
}
