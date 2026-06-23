/**
 * Watcher module — observes user files in a workspace and emits normalized
 * events. Wraps chokidar so the bus surface stays small and testable. State is
 * keyed PER workspace root (`Map<root, …>`): each window binds its own root, so
 * multiple workspaces can be watched independently at once with no cross-root
 * leakage (the per-window replacement for the old single-process watcher).
 */

export type WatcherEventType = 'add' | 'change' | 'unlink' | 'rename';

/** Standard add/change/unlink shape — one path involved. */
export interface WatcherFsEvent {
  readonly type: 'add' | 'change' | 'unlink';
  /** Absolute path on disk. */
  readonly absPath: string;
  /** POSIX relative path inside the workspace root. */
  readonly relPath: string;
  /** True if the event is for a folder; chokidar reports `addDir`/`unlinkDir`
   * which we collapse to add/unlink with this flag. */
  readonly isDir: boolean;
}

/** Synthetic rename event — emitted when a buffered unlink is matched by
 *  a subsequent add in the same parent dir with the same extension within
 *  the rename window. Hosts (Electron main, renderer) use this to react
 *  to file moves without the markOrphan-then-add flicker. */
export interface WatcherRenameEvent {
  readonly type: 'rename';
  readonly fromRelPath: string;
  readonly toRelPath: string;
  readonly toAbsPath: string;
  readonly isDir: boolean;
}

export type WatcherEvent = WatcherFsEvent | WatcherRenameEvent;

/** The host-facing event shape emitted on `watcherEvents` — a WatcherEvent
 *  tagged with the workspace root it originated from. The Electron main process
 *  scopes the `bh:file-event` broadcast to the window(s) bound to that root, so
 *  a file change in workspace A never reaches a window showing workspace B. */
export type WatcherHostEvent = WatcherEvent & { readonly workspaceRoot: string };

/** No args: a watcher always roots at the call's bound workspace
 *  (`ctx.workspaceRoot`), never an explicit path — the bound root IS the
 *  per-window scope. (The old optional `workspaceRoot` arg was vestigial once
 *  the per-call Context carried the root, and no caller passed it.) */
export type WatcherStartArgs = Record<string, never>;
export interface WatcherStartResult {
  readonly active: true;
  readonly workspaceRoot: string;
}

export type WatcherStopArgs = Record<string, never>;
export interface WatcherStopResult {
  readonly stopped: boolean;
}

export type WatcherStatusArgs = Record<string, never>;
export interface WatcherStatusResult {
  readonly active: boolean;
  readonly workspaceRoot: string | null;
}
