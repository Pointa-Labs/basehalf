/**
 * The single decision behind what fills a window's working region. Kept pure so
 * Workbench and the render tree share one source of truth.
 *
 * Three mutually-exclusive states:
 * - `welcome`: no workspace open (`current === null`).
 * - `recovery`: a workspace is selected but its folder is gone
 *   (`currentReachable === false`).
 * - `canvas`: a reachable workspace. Workbench renders the docked workbench region
 *   (Sidebar | Canvas | Terminal).
 *
 * `currentReachable` is `null` (or `undefined`) while reachability is still
 * resolving; only an explicit `false` is "folder gone". Anything-but-false falls
 * through to `canvas`, so a just-opened workspace never flashes recovery first.
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
