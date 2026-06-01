// Per-workspace persistence of the right-panel layout (open tabs + splits +
// divider fractions + the active pane), so your editor layout survives a reload.
//
// Local + per-machine (localStorage, keyed by workspace name) — matching the
// architecture's intent that editor layout is ephemeral UI state, not content
// that travels with the folder. Guarded everywhere: any parse/quota failure
// silently falls back to a fresh empty pane.

import { type PaneNode, allLeaves } from './paneTree.js';

export interface PersistedPanes {
  paneTree: PaneNode;
  activePaneId: string;
}

const keyFor = (ws: string): string => `bh:panes:${ws}`;

/** Read the saved pane layout for a workspace, or null if none / unreadable. */
export const loadPanes = (ws: string | null): PersistedPanes | null => {
  if (!ws) return null;
  try {
    const raw = localStorage.getItem(keyFor(ws));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedPanes;
    // Shape sanity — a node with a `type`, a string active id, and at least one
    // leaf reachable. Anything off → treat as none (fresh start).
    if (parsed?.paneTree?.type !== 'leaf' && parsed?.paneTree?.type !== 'split') return null;
    if (typeof parsed.activePaneId !== 'string') return null;
    if (allLeaves(parsed.paneTree).length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
};

let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** Debounced write of the pane layout for a workspace (no-op without a workspace). */
export const savePanes = (ws: string | null, panes: PersistedPanes): void => {
  if (!ws) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(keyFor(ws), JSON.stringify(panes));
    } catch {
      // localStorage unavailable / over quota — layout just won't persist.
    }
  }, 400);
};
