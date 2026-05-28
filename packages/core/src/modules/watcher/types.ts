/**
 * Watcher module — observes user files in the active workspace and emits
 * normalized events. Wraps chokidar so the bus surface stays small and
 * testable. Module-level singleton: one active watcher per process.
 */

export type WatcherEventType = 'add' | 'change' | 'unlink';

export interface WatcherEvent {
  readonly type: WatcherEventType;
  /** Absolute path on disk. */
  readonly absPath: string;
  /** POSIX relative path inside the workspace root. */
  readonly relPath: string;
  /** True if the event is for a folder; chokidar reports `addDir`/`unlinkDir`
   * which we collapse to add/unlink with this flag. */
  readonly isDir: boolean;
}

export interface WatcherStartArgs {
  /** Absolute workspace path. Defaults to the current workspace's path. */
  readonly workspaceRoot?: string;
}
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
