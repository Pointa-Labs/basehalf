import type { WorkspaceEntry } from '../../../../platform/workspaces/common/workspaces.js';

/**
 * Order workspaces most-recently-opened first — the shared ordering for every
 * "recent workspaces" surface (the welcome list; the Dock recent menu and File ▸
 * Open Recent are built main-side from the same `lastOpenedAt`). Recency is
 * `lastOpenedAt`, falling back to `addedAt` for a workspace never opened since the
 * field landed; ISO timestamps compare lexicographically = chronologically. Ties
 * break by name so the order is stable. Pure — returns a new array, never mutates.
 */
export function sortByRecency(workspaces: readonly WorkspaceEntry[]): WorkspaceEntry[] {
  return [...workspaces].sort((a, b) => {
    const ra = a.lastOpenedAt ?? a.addedAt;
    const rb = b.lastOpenedAt ?? b.addedAt;
    if (ra !== rb) return ra < rb ? 1 : -1; // newer (greater ISO string) first
    return a.name.localeCompare(b.name);
  });
}
