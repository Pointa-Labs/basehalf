import { EventEmitter } from 'node:events';
import { extname } from 'node:path';
import type { Handler } from '../../kernel/index.js';
import type { WorkspaceCurrentResult } from '../workspace/types.js';
import { type RunningWatcher, createChokidarWatcher } from './chokidar.js';
import type {
  WatcherEvent,
  WatcherFsEvent,
  WatcherStartArgs,
  WatcherStartResult,
  WatcherStatusArgs,
  WatcherStatusResult,
  WatcherStopArgs,
  WatcherStopResult,
} from './types.js';

/**
 * Process-wide event bus the main process subscribes to so it can fan out
 * file events to renderer webContents (e.g. "file changed externally —
 * reload the editor?"). Listeners get the same normalized WatcherEvent
 * that's already going to the badges module via ctx.run.
 */
export const watcherEvents = new EventEmitter();

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
 * Rename heuristic: when chokidar fires `unlink` for foo.md and then
 * `add` for bar.md within RENAME_WINDOW_MS in the same parent dir + same
 * extension, treat the pair as a rename and call badge.rename atomically
 * instead of markOrphan + materialize. Without this, a Finder rename
 * leaves an orphan badge AND every neighbour's references broken.
 *
 * Tuned for safety: requires same parent dir + same extension before
 * matching. Cross-dir moves and extension changes fall through to the
 * (slower but safer) orphan-then-add path. False positives would
 * silently corrupt refs, so we err on the side of "miss a rename"
 * over "invent one."
 */
const RENAME_WINDOW_MS = 250;

interface PendingUnlink {
  event: WatcherFsEvent;
  timer: ReturnType<typeof setTimeout>;
  finalize: () => Promise<void>;
}

/** Module-private buffer of unlink events awaiting a matching add. */
const pendingUnlinks = new Map<string, PendingUnlink>();

function parentDir(relPath: string): string {
  const ix = relPath.lastIndexOf('/');
  return ix === -1 ? '' : relPath.slice(0, ix);
}

function matchPendingRename(add: WatcherFsEvent): PendingUnlink | null {
  const addDir = parentDir(add.relPath);
  const addExt = extname(add.relPath);
  for (const pending of pendingUnlinks.values()) {
    if (pending.event.isDir !== add.isDir) continue;
    if (parentDir(pending.event.relPath) !== addDir) continue;
    if (extname(pending.event.relPath) !== addExt) continue;
    // First match wins — real-world renames are 1:1 within the window.
    return pending;
  }
  return null;
}

async function emitRename(
  ctx: Parameters<Handler>[1],
  pending: PendingUnlink,
  add: WatcherFsEvent,
): Promise<void> {
  try {
    await ctx.run('badge.rename', {
      from: pending.event.relPath,
      to: add.relPath,
      kind: add.isDir ? 'folder' : 'file',
    });
  } catch (err) {
    // The atomic rename failed (e.g. no source badge yet, or destination
    // collision because materialize already wrote one). Fall back to the
    // safe path: markOrphan the old, materialize the new. The user sees
    // the same visual result they would have without the heuristic.
    if (err instanceof Error && err.name === 'UnknownCommand') return;
    console.warn('[bh:watcher] badge.rename failed; falling back:', err);
    await ctx.run('badge.markOrphan', {
      file: pending.event.relPath,
      kind: pending.event.isDir ? 'folder' : 'file',
    });
    const existing = await ctx.run('badge.get', {
      file: add.relPath,
      kind: add.isDir ? 'folder' : 'file',
    });
    if (!existing) {
      await ctx.run('badge.set', {
        file: add.relPath,
        patch: { kind: add.isDir ? 'folder' : 'file' },
      });
    }
    return;
  }
  // Side-channel: tell hosts a rename happened so they can update UI
  // (NavTree refresh, currentFile rebinding, canvas re-render) without a
  // markOrphan flicker.
  watcherEvents.emit('event', {
    type: 'rename',
    fromRelPath: pending.event.relPath,
    toRelPath: add.relPath,
    toAbsPath: add.absPath,
    isDir: add.isDir,
  });
}

/**
 * Dispatch normalized file events into the badges module so a default
 * badge gets materialized on `add`, marked orphan on `unlink`, etc.
 * Tolerates badges not being registered (e.g. in tests that wire only
 * watcher) — the missing UnknownCommand is swallowed.
 *
 * unlinks are briefly buffered so a follow-up add in the same parent
 * dir + same extension can be reinterpreted as a rename (see
 * matchPendingRename + emitRename above).
 */
async function handleEvent(ctx: Parameters<Handler>[1], event: WatcherEvent): Promise<void> {
  if (event.type === 'rename') {
    // Synthetic events never come back through here — they're only
    // emitted out via watcherEvents. Defensive no-op.
    watcherEvents.emit('event', event);
    return;
  }
  // Side-channel for hosts (Electron main) to react to FS events.
  watcherEvents.emit('event', event);
  try {
    if (event.type === 'add') {
      const renameMatch = matchPendingRename(event);
      if (renameMatch) {
        clearTimeout(renameMatch.timer);
        pendingUnlinks.delete(renameMatch.event.relPath);
        await emitRename(ctx, renameMatch, event);
        return;
      }
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
      // Buffer briefly — if a matching add arrives within the rename
      // window, the pair is reinterpreted as a rename instead of an
      // orphan. If nothing arrives, the timer fires markOrphan as before.
      const finalize = async (): Promise<void> => {
        pendingUnlinks.delete(event.relPath);
        try {
          await ctx.run('badge.markOrphan', {
            file: event.relPath,
            kind: event.isDir ? 'folder' : 'file',
          });
        } catch (err) {
          if (err instanceof Error && err.name === 'UnknownCommand') return;
          console.error('[bh:watcher] markOrphan failed on buffered unlink', event, err);
        }
      };
      const timer = setTimeout(() => {
        void finalize();
      }, RENAME_WINDOW_MS);
      pendingUnlinks.set(event.relPath, { event, timer, finalize });
    }
    // 'change' is renderer-side concern (file content changed); no badge state
    // change required at the core level.
  } catch (err) {
    if (err instanceof Error && err.name === 'UnknownCommand') return;
    console.error('[bh:watcher] failed to react to event', event, err);
  }
}

/** Flush all pending unlinks immediately (use on watcher.stop / restart so
 *  buffered orphans don't get applied to the wrong workspace). */
async function flushPendingUnlinks(): Promise<void> {
  const pending = Array.from(pendingUnlinks.values());
  pendingUnlinks.clear();
  for (const p of pending) {
    clearTimeout(p.timer);
    await p.finalize().catch(() => undefined);
  }
}

export const start: Handler<WatcherStartArgs, WatcherStartResult> = async (args, ctx) => {
  const root = await resolveWorkspaceRoot(ctx, args.workspaceRoot);
  if (runningWatcher && runningRoot === root) {
    return { active: true, workspaceRoot: root };
  }
  if (runningWatcher) {
    // Flush buffered unlinks before tearing down — otherwise an unlink that
    // arrived just before a workspace switch could fire markOrphan against
    // the new workspace's root.
    await flushPendingUnlinks();
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
  await flushPendingUnlinks();
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
  // Eagerly drop any in-flight rename buffers so they don't fire against
  // the NEXT test's workspace.
  for (const p of pendingUnlinks.values()) clearTimeout(p.timer);
  pendingUnlinks.clear();
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
