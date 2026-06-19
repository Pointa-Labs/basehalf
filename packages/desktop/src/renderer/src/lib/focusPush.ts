/**
 * The one place that owns the `focus.set`-for-a-file contract: a debounced,
 * workspace-guarded writer of the user's viewport into focus.yaml. Both viewers of
 * a file's source — the read-only CodeReader (visible line) and the Markdown editor
 * (cursor + visible line) — push through this, so the guard / debounce / late-fire
 * handling live once instead of being re-derived per surface.
 *
 * focus.set is a FIELD-SCOPED merge in core, so a cursor-only and a visible-only
 * write compose without clobbering each other; we pass the captured workspace name
 * so a fire that lands AFTER a workspace switch is skipped by core rather than
 * planting this file's path under the new root (mirrors the watcher's guard).
 */
import { useWorkspaceStore } from '../store/workspace.js';

export interface FocusFields {
  readonly visible_lines?: { readonly start: number };
  /** Block ordinal of the first visible block (md editor only) — the block-space
   *  counterpart to visible_lines. */
  readonly visible_blocks?: { readonly start: number };
  readonly cursor?: {
    readonly line: number;
    readonly column: number;
    /** How trustworthy `line` is: 'exact' | 'block_start' | 'estimated'. */
    readonly line_precision?: string;
    /** Rendered block ordinal the cursor sits in. */
    readonly block?: number;
  };
}

export interface FileFocusPusher {
  /** Schedule a focus write. `compute` runs at FLUSH time (after the debounce) so
   *  the caller can read the latest editor state instead of capturing it at the
   *  event; return null to emit nothing this tick. */
  (compute: () => FocusFields | null): void;
  cancel(): void;
}

const FOCUS_DEBOUNCE = 400;

export function makeFileFocusPusher(file: string, debounceMs = FOCUS_DEBOUNCE): FileFocusPusher {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The last fields actually written, so a viewport that hasn't moved since the
  // last flush (re-settled scroll, caret back on the same spot) skips a redundant
  // focus.set IPC + its core-side mirror read-modify-write.
  let lastSent: string | null = null;
  const push = ((compute: () => FocusFields | null): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      // Only mirror while THIS file is still the open one in a live workspace — a
      // debounced late fire must not write after the user navigated away.
      const st = useWorkspaceStore.getState();
      if (st.openFile !== file || !st.current) return;
      const fields = compute();
      if (!fields || (!fields.visible_lines && !fields.cursor)) return;
      const key = JSON.stringify(fields);
      if (key === lastSent) return; // viewport unchanged since the last write
      lastSent = key;
      void window.bh
        .run('focus.set', { path: file, kind: 'file', ...fields, workspace: st.current })
        .catch(() => undefined);
    }, debounceMs);
  }) as FileFocusPusher;
  push.cancel = (): void => {
    if (timer) clearTimeout(timer);
  };
  return push;
}
