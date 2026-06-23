import type { WebContents } from 'electron';

/**
 * The window↔workspace binding — main's authoritative map from a window's
 * webContents to the workspace folder it shows. This is the per-window
 * replacement for core's old global "current workspace" pointer: the `bh:run`
 * IPC handler reads the sender window's bound root and injects it into
 * `core.run(name, args, { workspaceRoot })`, so every core command operates on
 * THIS window's workspace.
 *
 * The binding is immutable for a window LOAD: a workspace switch is a reload
 * that rebinds (see the `workspace:open` handler), never an in-place re-point —
 * so no in-flight operation from the old page can observe a changed root. (Phase
 * 1 still runs a single window; the map generalizes to N windows in Phase 3.)
 *
 * Keyed by `webContents.id`, which is stable across a reload (same WebContents),
 * so the binding survives the reload that effects a switch. `null` = the
 * welcome/empty window (no workspace bound; core refuses workspace-scoped calls).
 */
const rootByWebContentsId = new Map<number, string | null>();

/** Bind (or rebind) a window's webContents to a workspace root (null = welcome). */
export function setWorkspaceRoot(wc: WebContents, workspaceRoot: string | null): void {
  rootByWebContentsId.set(wc.id, workspaceRoot);
}

/** The workspace root bound to this webContents, or null (welcome / unbound). */
export function getWorkspaceRoot(wc: WebContents): string | null {
  return rootByWebContentsId.get(wc.id) ?? null;
}

/** The workspace root bound to a webContents id. Used in the `closed` handler,
 *  where the WebContents object is already destroyed but its id was captured at
 *  bind time — to decide whether the closing window's watcher is now orphaned. */
export function getWorkspaceRootById(webContentsId: number): string | null {
  return rootByWebContentsId.get(webContentsId) ?? null;
}

/** Drop a window's binding when it's destroyed, so a stale id can't linger. Takes
 *  the numeric webContents id (captured at bind time) because the WebContents
 *  object is already destroyed by the time the window's `closed` event fires. */
export function clearWorkspaceRoot(webContentsId: number): void {
  rootByWebContentsId.delete(webContentsId);
}
