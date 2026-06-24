/**
 * The single decision behind what fills a window's working region. Kept pure so
 * App and the render tree share ONE source of truth (no more split branching
 * across App + Canvas) and it's unit-tested (the renderer has no React-render
 * harness; pure helpers are how we test it).
 *
 * Three mutually-exclusive states:
 *   - `welcome`  — no workspace open (`current === null`). App renders <Welcome/>.
 *   - `recovery` — a workspace is selected but its folder is gone
 *                  (`currentReachable === false`). App renders <WorkspaceMissing/>.
 *   - `canvas`   — a reachable workspace. App renders the docked region
 *                  (Sidebar | Canvas | Terminal).
 *
 * `currentReachable` is `null` (or `undefined`) while reachability is still
 * resolving; only an explicit `false` is "folder gone". Anything-but-false falls
 * through to `canvas` (the load effects there already gate on it), so a
 * just-opened workspace never flashes the recovery surface before its check runs.
 */
export type AppRegion = 'welcome' | 'recovery' | 'canvas';

export function selectRegion(
  current: string | null,
  currentReachable: boolean | null | undefined,
): AppRegion {
  if (current === null) return 'welcome';
  if (currentReachable === false) return 'recovery';
  return 'canvas';
}
