import { relative } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type { WatcherEvent, WatcherFsEvent } from './types.js';

// Tooling cruft we never want to wake the dispatcher for. Kept in sync with
// workspace/materialize.ts SKIP_NAMES (the eager-materialization blacklist).
const IGNORED_GLOBS = [
  /(^|[/\\])\.git([/\\]|$)/,
  /(^|[/\\])\.bh([/\\]|$)/,
  /(^|[/\\])node_modules([/\\]|$)/,
  /(^|[/\\])\.DS_Store$/,
  /(^|[/\\])Thumbs\.db$/,
  /(^|[/\\])dist([/\\]|$)/,
  /(^|[/\\])build([/\\]|$)/,
  /(^|[/\\])out([/\\]|$)/,
  /(^|[/\\])\.turbo([/\\]|$)/,
  /(^|[/\\])__pycache__([/\\]|$)/,
];

type Dispatch = (event: WatcherEvent) => void | Promise<void>;

export interface RunningWatcher {
  close(): Promise<void>;
}

export async function createChokidarWatcher(
  workspaceRoot: string,
  dispatch: Dispatch,
): Promise<RunningWatcher> {
  const watcher: FSWatcher = chokidar.watch(workspaceRoot, {
    ignored: IGNORED_GLOBS,
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 25 },
  });

  function fire(type: WatcherFsEvent['type'], isDir: boolean): (absPath: string) => void {
    return (absPath) => {
      const relPath = toPosix(relative(workspaceRoot, absPath));
      // Best-effort dispatch; we never let one bad handler kill the watcher.
      // Chokidar only emits FS events here; the 'rename' synthetic event is
      // assembled downstream in commands.ts handleEvent.
      void Promise.resolve(dispatch({ type, absPath, relPath, isDir })).catch((err) => {
        console.error('[bh:watcher] handler threw:', err);
      });
    };
  }

  watcher.on('add', fire('add', false));
  watcher.on('change', fire('change', false));
  watcher.on('unlink', fire('unlink', false));
  watcher.on('addDir', fire('add', true));
  watcher.on('unlinkDir', fire('unlink', true));
  watcher.on('error', (err) => {
    console.error('[bh:watcher] chokidar error:', err);
  });

  // chokidar's `ready` resolves after the initial scan completes.
  await new Promise<void>((resolve) => {
    watcher.once('ready', () => resolve());
  });

  return {
    async close() {
      await watcher.close();
    },
  };
}

function toPosix(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).join('/');
}
