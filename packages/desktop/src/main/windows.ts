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

// ---------------------------------------------------------------------------
// Pure multi-window routing decisions (Phase 3). Kept free of BrowserWindow so
// they're unit-testable; index.ts performs the real focus/create/reload using
// these verdicts. A workspace's identity is its PATH (CLAUDE.md), and macOS is
// case-insensitive, so path comparison is case-insensitive — '/Foo' and '/foo'
// are the same folder and must map to ONE window.
// ---------------------------------------------------------------------------

/** True if two roots name the same workspace folder (case-insensitive; null is
 *  the welcome/unbound state and is never "the same path" as anything). */
export function samePath(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  return a.toLowerCase() === b.toLowerCase();
}

/** A live window as the routing decision sees it: its webContents id + bound root. */
export interface WindowRef {
  readonly id: number;
  readonly root: string | null;
}

export type OpenDecision =
  | { readonly action: 'focus'; readonly id: number }
  | { readonly action: 'reuse-sender' }
  | { readonly action: 'new-window' };

/**
 * Decide what opening `targetRoot` from the window `senderId` should do — the
 * one-window-per-workspace router:
 *  - a live window already shows that workspace → FOCUS it (no duplicate);
 *  - else the sender is the welcome/empty window (root null) → REUSE it
 *    (rebind + reload — the "Open Folder reuses the welcome window" default);
 *  - else → open a NEW window for it (the sender keeps its own workspace).
 * Pure: the caller performs the focus/reuse/create.
 */
export function decideOpen(
  windows: readonly WindowRef[],
  senderId: number,
  targetRoot: string,
): OpenDecision {
  const existing = windows.find((w) => samePath(w.root, targetRoot));
  if (existing) return { action: 'focus', id: existing.id };
  const sender = windows.find((w) => w.id === senderId);
  if (sender && sender.root === null) return { action: 'reuse-sender' };
  return { action: 'new-window' };
}

/** A registered workspace, as the recency ordering needs it. */
export interface RecencyEntry {
  readonly name: string;
  readonly path: string;
  readonly addedAt: string;
  readonly lastOpenedAt?: string;
}

/**
 * Order workspaces most-recently-opened first — the ordering for the main-side
 * recent surfaces (the macOS Dock menu + File ▸ Open Recent). Recency is
 * `lastOpenedAt`, falling back to `addedAt` for a workspace never opened since the
 * field landed; ISO timestamps compare lexicographically = chronologically. Ties
 * break by name so the order is stable. Pure; returns a new array.
 *
 * Mirrors the renderer's `lib/recentWorkspaces.sortByRecency` across the process
 * boundary (both consume the same core `lastOpenedAt`) — a deliberate small dup
 * rather than reaching across main↔renderer.
 */
export function sortWorkspacesByRecency<T extends RecencyEntry>(workspaces: readonly T[]): T[] {
  return [...workspaces].sort((a, b) => {
    const ra = a.lastOpenedAt ?? a.addedAt;
    const rb = b.lastOpenedAt ?? b.addedAt;
    if (ra !== rb) return ra < rb ? 1 : -1; // newer (greater ISO string) first
    return a.name.localeCompare(b.name);
  });
}

/**
 * Resolve the ordered list of workspace roots to open on launch (or dock-restore)
 * from the persisted session `openKeys` (workspace paths; `''` = welcome) against
 * the currently-`registeredPaths`. A since-removed workspace is dropped; the list
 * is de-duplicated by path (one window per workspace); if nothing survives, a
 * single welcome window (`[null]`). `null` entries = welcome windows.
 */
export function resolveSessionRoots(
  openKeys: readonly string[],
  registeredPaths: readonly string[],
): (string | null)[] {
  const registered = registeredPaths.map((p) => p.toLowerCase());
  const roots: (string | null)[] = [];
  const seen = new Set<string>();
  for (const key of openKeys) {
    if (key === '') continue; // a persisted welcome window isn't restored as its own window
    const lower = key.toLowerCase();
    if (seen.has(lower)) continue; // dedup: one window per workspace
    if (!registered.includes(lower)) continue; // workspace was removed since last quit
    seen.add(lower);
    roots.push(key);
  }
  // Nothing to restore (clean first run, or every open workspace was removed) →
  // a single welcome window.
  return roots.length > 0 ? roots : [null];
}
