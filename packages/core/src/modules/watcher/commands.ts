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
 * `add` for bar.md in the same parent dir + same extension within
 * RENAME_WINDOW_MS, treat the pair as a rename and call badge.rename
 * atomically instead of markOrphan + materialize. Without this, a
 * Finder rename leaves an orphan badge AND every neighbour's references
 * broken.
 *
 * Bidirectional buffering: both adds AND unlinks are held briefly. On
 * receipt of either, we check the *opposite* buffer for a matching
 * counterpart and pair them. This handles two real-world cases the
 * earlier "buffer unlinks only" design missed:
 *   - macOS FSEvents can deliver add before unlink (out of order).
 *   - macOS FSEvents has variable latency (up to ~500ms under load) so
 *     the pair can straddle a tight window.
 *
 * Window bumped to 600ms — empirically covers FSEvents jitter on a busy
 * Electron host while still feeling instant for orphan flagging (real
 * deletions appear as orphans within ~0.6s, well under the eye's
 * tolerance for "did something happen?").
 *
 * Tuned for safety: requires same parent dir + same extension + same
 * isDir before matching. Cross-dir moves and extension changes fall
 * through to the safer orphan-then-add path. False positives would
 * silently corrupt refs, so we err on "miss a rename" over "invent one."
 */
const RENAME_WINDOW_MS = 600;

interface PendingUnlink {
  event: WatcherFsEvent;
  timer: ReturnType<typeof setTimeout>;
  finalize: () => Promise<void>;
}

interface PendingAdd {
  event: WatcherFsEvent;
  timer: ReturnType<typeof setTimeout>;
  finalize: () => Promise<void>;
}

/** Module-private buffers. unlinks wait for a matching add; adds wait
 *  for a matching unlink (handles out-of-order arrival). */
const pendingUnlinks = new Map<string, PendingUnlink>();
const pendingAdds = new Map<string, PendingAdd>();

function parentDir(relPath: string): string {
  const ix = relPath.lastIndexOf('/');
  return ix === -1 ? '' : relPath.slice(0, ix);
}

/** Find a pending entry (from either buffer) that matches the incoming
 *  event's parent dir + extension + isDir. Generic over the buffer's
 *  PendingEntry shape since both use `event: WatcherFsEvent`. */
function findCounterpart<T extends { event: WatcherFsEvent }>(
  buffer: Map<string, T>,
  incoming: WatcherFsEvent,
): T | null {
  const dir = parentDir(incoming.relPath);
  const ext = extname(incoming.relPath);
  for (const pending of buffer.values()) {
    if (pending.event.isDir !== incoming.isDir) continue;
    if (parentDir(pending.event.relPath) !== dir) continue;
    if (extname(pending.event.relPath) !== ext) continue;
    if (pending.event.relPath === incoming.relPath) continue; // same path = not a rename
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
 * Both adds AND unlinks are briefly buffered (RENAME_WINDOW_MS) so a
 * matching counterpart in the same parent dir + same extension can be
 * reinterpreted as a rename instead of an orphan + materialize pair.
 * Buffering both directions handles macOS FSEvents delivering events
 * out of order or with variable latency.
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
      // If an unlink for a matching path is already buffered, pair them
      // as a rename (unlink-first ordering — the common case).
      const unlinkMatch = findCounterpart(pendingUnlinks, event);
      if (unlinkMatch) {
        clearTimeout(unlinkMatch.timer);
        pendingUnlinks.delete(unlinkMatch.event.relPath);
        await emitRename(ctx, unlinkMatch, event);
        return;
      }
      // No pending unlink yet — buffer this add briefly in case the
      // unlink arrives shortly (add-first ordering, common under FSEvents
      // on macOS). If no unlink arrives in time, materialize normally.
      const finalize = async (): Promise<void> => {
        pendingAdds.delete(event.relPath);
        try {
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
        } catch (err) {
          if (err instanceof Error && err.name === 'UnknownCommand') return;
          console.error('[bh:watcher] materialize failed on buffered add', event, err);
        }
      };
      const timer = setTimeout(() => {
        void finalize();
      }, RENAME_WINDOW_MS);
      pendingAdds.set(event.relPath, { event, timer, finalize });
    } else if (event.type === 'unlink') {
      // If an add for a matching path is already buffered, pair them as
      // a rename (add-first ordering — the FSEvents-out-of-order case).
      const addMatch = findCounterpart(pendingAdds, event);
      if (addMatch) {
        clearTimeout(addMatch.timer);
        pendingAdds.delete(addMatch.event.relPath);
        // emitRename expects (unlink, add) ordering; build a synthetic
        // PendingUnlink wrapper around this event.
        await emitRename(
          ctx,
          { event, timer: setTimeout(() => undefined, 0), finalize: async () => undefined },
          addMatch.event,
        );
        return;
      }
      // No pending add — buffer the unlink. If nothing arrives, the
      // timer fires markOrphan as before.
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

/** Flush all pending unlinks AND adds immediately (use on
 *  watcher.stop / restart so buffered events don't get applied to the
 *  wrong workspace after a switch). */
async function flushPendingBuffers(): Promise<void> {
  const unlinks = Array.from(pendingUnlinks.values());
  pendingUnlinks.clear();
  for (const p of unlinks) {
    clearTimeout(p.timer);
    await p.finalize().catch(() => undefined);
  }
  const adds = Array.from(pendingAdds.values());
  pendingAdds.clear();
  for (const p of adds) {
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
    await flushPendingBuffers();
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
  await flushPendingBuffers();
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
  for (const p of pendingAdds.values()) clearTimeout(p.timer);
  pendingAdds.clear();
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
