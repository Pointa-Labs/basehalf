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

// PER-WORKSPACE debounce timers. A single shared timer let a save for workspace B
// (e.g. the restored layout right after a switch) cancel workspace A's still-pending
// save — so A's last layout was lost on reload. Keyed timers isolate them.
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Debounced write of the pane layout for a workspace (no-op without a workspace). */
export const savePanes = (ws: string | null, panes: PersistedPanes): void => {
  if (!ws) return;
  const existing = saveTimers.get(ws);
  if (existing) clearTimeout(existing);
  saveTimers.set(
    ws,
    setTimeout(() => {
      saveTimers.delete(ws);
      try {
        localStorage.setItem(keyFor(ws), JSON.stringify(panes));
      } catch {
        // localStorage unavailable / over quota — layout just won't persist.
      }
    }, 400),
  );
};

/** Migrate a workspace's saved layout to a new name (on rename), so its tabs +
 *  splits survive — otherwise `bh:panes:<old>` is orphaned and the renamed
 *  workspace loads an empty layout. Stops any pending save under the old name (it
 *  would re-create the orphan), and prefers `currentLayout` when given (the live
 *  layout of the active workspace — captures a rearrange still in the debounce). */
export const renamePanes = (from: string, to: string, currentLayout?: PersistedPanes): void => {
  const pending = saveTimers.get(from);
  if (pending) clearTimeout(pending);
  saveTimers.delete(from);
  try {
    const data = currentLayout ? JSON.stringify(currentLayout) : localStorage.getItem(keyFor(from));
    if (data != null) localStorage.setItem(keyFor(to), data);
    localStorage.removeItem(keyFor(from));
  } catch {
    // localStorage unavailable — nothing to migrate.
  }
};
