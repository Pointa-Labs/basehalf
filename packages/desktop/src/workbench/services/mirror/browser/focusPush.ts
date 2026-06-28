import { useWorkspaceStore } from '../../workspace/browser/workspaceStore.js';
import type { FocusNode, FocusSetArgs, LinePrecision } from '../common/focus.js';
import { focusService } from './focusService.js';
/**
 * The one place that owns the `focus.set`-for-a-file contract: a debounced writer
 * of the user's viewport into focus.yaml. Both editors of a file's source — the
 * Monaco code editor (cursor + visible line) and the Markdown editor (cursor +
 * visible line) — push through this, so the debounce / late-fire handling lives
 * once instead of being re-derived per surface.
 *
 * focus.set is a FIELD-SCOPED merge in the mirror service, so a cursor-only and a
 * visible-only write compose without clobbering each other. main injects this window's bound
 * root, so the write is workspace-immutable; the one race is a switch (a window
 * reload), which sets `mirrorWritesSuspended()` — a debounced fire in the
 * reload-commit gap then skips instead of landing in the newly-bound workspace.
 */
import { mirrorWritesSuspended } from './mirrorWrites.js';

export interface FocusFields {
  readonly visible_lines?: { readonly start: number };
  /** Block ordinal of the first visible block (md editor only) — the block-space
   *  counterpart to visible_lines. */
  readonly visible_blocks?: { readonly start: number };
  readonly cursor?: {
    readonly line: number;
    readonly column: number;
    /** How trustworthy `line` is: 'exact' | 'block_start' | 'estimated'. */
    readonly line_precision?: LinePrecision;
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

export interface FileFocusPushContext {
  readonly currentWorkspace: string | null;
  readonly openFile: string | null;
  readonly mirrorWritesSuspended: boolean;
}

export interface FileFocusPusherOptions {
  readonly debounceMs?: number;
  readonly getContext?: () => FileFocusPushContext;
  readonly setFocus?: (args: FocusSetArgs) => Promise<FocusNode>;
}

export function defaultFileFocusPushContext(): FileFocusPushContext {
  const st = useWorkspaceStore.getState();
  return {
    currentWorkspace: st.current,
    openFile: st.openFile,
    mirrorWritesSuspended: mirrorWritesSuspended(),
  };
}

export function canPushFileFocus(file: string, context: FileFocusPushContext): boolean {
  return (
    !context.mirrorWritesSuspended && context.currentWorkspace !== null && context.openFile === file
  );
}

export function makeFileFocusPusher(
  file: string,
  optionsOrDebounceMs: number | FileFocusPusherOptions = FOCUS_DEBOUNCE,
): FileFocusPusher {
  const options =
    typeof optionsOrDebounceMs === 'number'
      ? { debounceMs: optionsOrDebounceMs }
      : optionsOrDebounceMs;
  const debounceMs = options.debounceMs ?? FOCUS_DEBOUNCE;
  const getContext = options.getContext ?? defaultFileFocusPushContext;
  const setFocus = options.setFocus ?? focusService.set;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The last fields actually written, so a viewport that hasn't moved since the
  // last flush (re-settled scroll, caret back on the same spot) skips a redundant
  // focus.set IPC + its mirror read-modify-write.
  let lastSent: string | null = null;
  const push = ((compute: () => FocusFields | null): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      // Only mirror while THIS file is still the open one in a live workspace — a
      // debounced late fire must not write after the user navigated away — and not
      // during a workspace switch's reload-commit gap (would land in the new root).
      if (!canPushFileFocus(file, getContext())) return;
      const fields = compute();
      if (!fields || (!fields.visible_lines && !fields.visible_blocks && !fields.cursor)) return;
      const key = JSON.stringify(fields);
      if (key === lastSent) return; // viewport unchanged since the last write
      lastSent = key;
      void setFocus({ path: file, kind: 'file', ...fields }).catch(() => undefined);
    }, debounceMs);
  }) as FileFocusPusher;
  push.cancel = (): void => {
    if (timer) clearTimeout(timer);
  };
  return push;
}
