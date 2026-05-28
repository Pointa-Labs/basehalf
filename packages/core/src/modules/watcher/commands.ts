import type { Handler } from '../../kernel/index.js';
import type { WorkspaceCurrentResult } from '../workspace/types.js';
import { type RunningWatcher, createChokidarWatcher } from './chokidar.js';
import type {
  WatcherEvent,
  WatcherStartArgs,
  WatcherStartResult,
  WatcherStatusArgs,
  WatcherStatusResult,
  WatcherStopArgs,
  WatcherStopResult,
} from './types.js';

// Module-private state. One watcher per process; v0 only opens one workspace
// at a time anyway (SR-Open-01).
let runningWatcher: RunningWatcher | null = null;
let runningRoot: string | null = null;

async function resolveWorkspaceRoot(
  ctx: Parameters<Handler>[1],
  explicit?: string,
): Promise<string> {
  if (explicit !== undefined) return explicit;
  const current = await ctx.run<Record<string, never>, WorkspaceCurrentResult>(
    'workspace.current',
    {},
  );
  if (current.current === null) {
    throw new Error('No current workspace; pass workspaceRoot or call workspace.use first');
  }
  return current.current.path;
}

/**
 * Dispatch normalized file events into the badges module so a default
 * badge gets materialized on `add`, marked orphan on `unlink`, etc.
 * Tolerates badges not being registered (e.g. in tests that wire only
 * watcher) — the missing UnknownCommand is swallowed.
 */
async function handleEvent(ctx: Parameters<Handler>[1], event: WatcherEvent): Promise<void> {
  try {
    if (event.type === 'add') {
      const existing = await ctx.run('badge.get', {
        file: event.relPath,
        kind: event.isDir ? 'folder' : 'file',
      });
      if (!existing) {
        await ctx.run('badge.set', {
          file: event.relPath,
          patch: { kind: event.isDir ? 'folder' : 'file' },
        });
      }
    } else if (event.type === 'unlink') {
      await ctx.run('badge.markOrphan', {
        file: event.relPath,
        kind: event.isDir ? 'folder' : 'file',
      });
    }
    // 'change' is renderer-side concern (file content changed); no badge state
    // change required at the core level.
  } catch (err) {
    if (err instanceof Error && err.name === 'UnknownCommand') return;
    console.error('[bh:watcher] failed to react to event', event, err);
  }
}

export const start: Handler<WatcherStartArgs, WatcherStartResult> = async (args, ctx) => {
  const root = await resolveWorkspaceRoot(ctx, args.workspaceRoot);
  if (runningWatcher && runningRoot === root) {
    return { active: true, workspaceRoot: root };
  }
  if (runningWatcher) {
    await runningWatcher.close();
    runningWatcher = null;
    runningRoot = null;
  }
  runningWatcher = await createChokidarWatcher(root, (event) => handleEvent(ctx, event));
  runningRoot = root;
  return { active: true, workspaceRoot: root };
};

export const stop: Handler<WatcherStopArgs, WatcherStopResult> = async () => {
  if (!runningWatcher) return { stopped: false };
  await runningWatcher.close();
  runningWatcher = null;
  runningRoot = null;
  return { stopped: true };
};

export const status: Handler<WatcherStatusArgs, WatcherStatusResult> = async () => ({
  active: runningWatcher !== null,
  workspaceRoot: runningRoot,
});

// Test-only: reset module state. Exported so vitest can clean between tests
// without exposing a real `watcher.reset` to user-facing CLIs.
export async function _resetForTests(): Promise<void> {
  if (runningWatcher) await runningWatcher.close();
  runningWatcher = null;
  runningRoot = null;
}

export function commands(): ReadonlyArray<
  readonly [name: string, handler: Handler<never, unknown>]
> {
  return [
    ['watcher.start', start as unknown as Handler<never, unknown>],
    ['watcher.stop', stop as unknown as Handler<never, unknown>],
    ['watcher.status', status as unknown as Handler<never, unknown>],
  ];
}
