import { EventEmitter } from 'node:events';
import { extname } from 'node:path';
import { type Handler, requireWorkspaceRoot } from '../../kernel/index.js';
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
 * reload the editor?"). Listeners get a `WatcherHostEvent` — the normalized
 * event tagged with the `workspaceRoot` it came from, so the host can scope
 * the broadcast to the window(s) bound to that workspace.
 */
export const watcherEvents = new EventEmitter();

/**
 * Per-workspace watcher state. Everything that used to be a module-global
 * singleton (the chokidar handle, the rename buffers, the in-flight set) is
 * scoped to ONE root here, so N workspaces can be watched independently with
 * zero cross-root interference. Each window's `watcher.start` gets (or creates)
 * its own entry; a workspace switch is a window reload that starts a fresh
 * watcher for the new root, never a teardown of someone else's.
 *
 * `ctx` is captured at start time and carries this workspace's bound root, so
 * every cascade (badge.markOrphan / focus.pruneDangling / badge.rename) stays
 * in the watched workspace by construction — no global-current drift to guard.
 */
interface WatcherState {
  readonly root: string;
  readonly ctx: Parameters<Handler>[1];
  watcher: RunningWatcher | null;
  // unlinks wait for a matching add; adds wait for a matching unlink (handles
  // out-of-order arrival under FSEvents). See findCounterpart / the rename note.
  readonly pendingUnlinks: Map<string, PendingUnlink>;
  readonly pendingAdds: Map<string, PendingAdd>;
  // In-flight badge-writing work spawned by FS events: the chokidar callback's
  // handleEvent, and the rename-window timers' finalize(). Fire-and-forget, so
  // without tracking them a write could land AFTER the watcher is stopped —
  // clobbering a torn-down workspace ("No current workspace", ENOTEMPTY rmdir,
  // a badge read mid-write). drainInflight() lets stop/reset wait for them.
  readonly inflight: Set<Promise<unknown>>;
}

const watchers = new Map<string, WatcherState>();

function track(state: WatcherState, p: Promise<unknown>): void {
  const tracked = p.finally(() => state.inflight.delete(tracked));
  state.inflight.add(tracked);
}

async function drainInflight(state: WatcherState): Promise<void> {
  // Loop in case a settling task spawned another; bounded because no new FS
  // events arrive once chokidar is closed and the buffers are cleared.
  while (state.inflight.size > 0) {
    await Promise.allSettled([...state.inflight]);
  }
}

/** Emit a host-facing event tagged with this watcher's root, so the main
 *  process can deliver it only to windows bound to that workspace. */
function emit(state: WatcherState, event: WatcherEvent): void {
  watcherEvents.emit('event', { ...event, workspaceRoot: state.root });
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

function parentDir(relPath: string): string {
  const ix = relPath.lastIndexOf('/');
  return ix === -1 ? '' : relPath.slice(0, ix);
}

/** Find a pending entry (from either buffer) that matches the incoming
 *  event's parent dir + extension + isDir. Generic over the buffer's
 *  PendingEntry shape since both use `event: WatcherFsEvent`. The buffer is
 *  already per-workspace, so matching can never pair across roots.
 *
 *  Requires a UNIQUE match: if two or more buffered entries match the
 *  criteria, returns null. A rename is a 1:1 pairing — when several
 *  same-dir/same-ext files were deleted (or created) inside the window
 *  (e.g. a git branch switch rewriting many files), we cannot know which
 *  unlink the add actually corresponds to, or whether it's a rename at
 *  all. Per the module's safety principle ("err on miss over invent"),
 *  ambiguity falls through to the safe orphan-then-materialize path
 *  rather than inventing a rename that would move the wrong badge's
 *  prompt/refs onto the new file. Exported for unit testing. */
export function findCounterpart<T extends { event: WatcherFsEvent }>(
  buffer: Map<string, T>,
  incoming: WatcherFsEvent,
): T | null {
  const dir = parentDir(incoming.relPath);
  const ext = extname(incoming.relPath);
  let match: T | null = null;
  for (const pending of buffer.values()) {
    if (pending.event.isDir !== incoming.isDir) continue;
    if (parentDir(pending.event.relPath) !== dir) continue;
    if (extname(pending.event.relPath) !== ext) continue;
    if (pending.event.relPath === incoming.relPath) continue; // same path = not a rename
    if (match !== null) return null; // 2+ candidates → ambiguous, don't invent a rename
    match = pending;
  }
  return match;
}

async function emitRename(
  state: WatcherState,
  pending: PendingUnlink,
  add: WatcherFsEvent,
): Promise<void> {
  const kind = add.isDir ? 'folder' : 'file';
  const from = pending.event.relPath;
  const to = add.relPath;
  try {
    await state.ctx.run('badge.rename', { from, to, kind });
  } catch (err) {
    // UnknownCommand = the badges module isn't registered (a test wiring only
    // the watcher) — nothing to cascade, and no host needs the rename signal.
    if (err instanceof Error && err.name === 'UnknownCommand') return;
    console.warn('[bh:watcher] badge.rename fell back:', err);
    // markOrphan flags the source badge as gone (or no-ops when there was none).
    // Focus is a viewport mirror now, so there is no curated list to remap here;
    // a focused node that was renamed dangles until the watcher-cascade step moves
    // the whole mirror node + repoints current_focus (deferred). focus.pruneDangling
    // (run on workspace open) clears a current_focus left pointing at the gone file.
    await state.ctx.run('badge.markOrphan', { file: from, kind });
  }
  // Side-channel: tell hosts a rename happened (NavTree refresh, currentFile
  // rebinding, canvas re-render). Emitted for BOTH the badged-rename and the
  // sparse fallback, so an open editor/tab on an unannotated file rebinds to the
  // new path instead of staying stuck on the vanished one.
  emit(state, {
    type: 'rename',
    fromRelPath: from,
    toRelPath: to,
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
async function handleEvent(state: WatcherState, event: WatcherEvent): Promise<void> {
  if (event.type === 'rename') {
    // Synthetic events never come back through here — they're only
    // emitted out via watcherEvents. Defensive no-op.
    emit(state, event);
    return;
  }
  // Side-channel for hosts (Electron main) to react to FS events.
  emit(state, event);
  try {
    if (event.type === 'add') {
      // If an unlink for a matching path is already buffered, pair them
      // as a rename (unlink-first ordering — the common case).
      const unlinkMatch = findCounterpart(state.pendingUnlinks, event);
      if (unlinkMatch) {
        clearTimeout(unlinkMatch.timer);
        state.pendingUnlinks.delete(unlinkMatch.event.relPath);
        await emitRename(state, unlinkMatch, event);
        return;
      }
      // No pending unlink yet — buffer this add briefly in case the unlink
      // arrives shortly (add-first ordering, common under FSEvents on macOS).
      // If no unlink arrives in time, finalize the add.
      const finalize = async (): Promise<void> => {
        state.pendingAdds.delete(event.relPath);
        try {
          const kind = event.isDir ? 'folder' : 'file';
          // No eager materialization: a brand-new file gets NO badge — badges are
          // a sparse overlay, created lazily only on first annotation. The renderer
          // re-reads the folder on this event and shows the file from the filesystem
          // with defaults. The ONE thing to do here: if a previously deleted but
          // ANNOTATED file re-appeared at the same path, clear its orphan flag so it
          // is live again. (Focus is a viewport mirror — there is no folder brief to
          // re-join, so a brand-new unannotated file needs nothing further.)
          const existing = (await state.ctx.run('badge.get', {
            file: event.relPath,
            kind,
          })) as { orphan?: boolean } | null;
          if (existing?.orphan === true) {
            await state.ctx.run('badge.set', {
              file: event.relPath,
              patch: { kind, orphan: false },
            });
          }
        } catch (err) {
          if (err instanceof Error && err.name === 'UnknownCommand') return;
          console.error('[bh:watcher] add-finalize failed', event, err);
        }
      };
      const timer = setTimeout(() => {
        track(state, finalize());
      }, RENAME_WINDOW_MS);
      // Clear any prior timer for this path before overwriting its buffer
      // entry — a duplicate add within the window would otherwise leave the
      // old setTimeout running (it fires uselessly, and its finalize deletes
      // the entry the new timer is tracking).
      const prevAdd = state.pendingAdds.get(event.relPath);
      if (prevAdd) clearTimeout(prevAdd.timer);
      state.pendingAdds.set(event.relPath, { event, timer, finalize });
    } else if (event.type === 'unlink') {
      // If an add for a matching path is already buffered, pair them as
      // a rename (add-first ordering — the FSEvents-out-of-order case).
      const addMatch = findCounterpart(state.pendingAdds, event);
      if (addMatch) {
        clearTimeout(addMatch.timer);
        state.pendingAdds.delete(addMatch.event.relPath);
        // emitRename expects (unlink, add) ordering; build a synthetic
        // PendingUnlink wrapper around this event.
        await emitRename(
          state,
          { event, timer: setTimeout(() => undefined, 0), finalize: async () => undefined },
          addMatch.event,
        );
        return;
      }
      // No pending add — buffer the unlink. If nothing arrives, the
      // timer fires markOrphan as before.
      const finalize = async (): Promise<void> => {
        state.pendingUnlinks.delete(event.relPath);
        try {
          await state.ctx.run('badge.markOrphan', {
            file: event.relPath,
            kind: event.isDir ? 'folder' : 'file',
          });
          // If the deleted node was the CURRENT focus, clear the now-dangling
          // current_focus symlink (cheap: one readlink + one stat; no-ops otherwise).
          await state.ctx.run('focus.pruneDangling', {});
        } catch (err) {
          if (err instanceof Error && err.name === 'UnknownCommand') return;
          console.error('[bh:watcher] markOrphan failed on buffered unlink', event, err);
        }
      };
      const timer = setTimeout(() => {
        track(state, finalize());
      }, RENAME_WINDOW_MS);
      // Clear any prior timer for this path (see the matching note on the
      // add buffer above) so a duplicate unlink doesn't leak a timer.
      const prevUnlink = state.pendingUnlinks.get(event.relPath);
      if (prevUnlink) clearTimeout(prevUnlink.timer);
      state.pendingUnlinks.set(event.relPath, { event, timer, finalize });
    }
    // 'change' is renderer-side concern (file content changed); no badge state
    // change required at the core level.
  } catch (err) {
    if (err instanceof Error && err.name === 'UnknownCommand') return;
    console.error('[bh:watcher] failed to react to event', event, err);
  }
}

/** Flush all pending unlinks AND adds immediately (use on watcher.stop so
 *  buffered events don't get stranded mid-window when the watcher tears down). */
async function flushPendingBuffers(state: WatcherState): Promise<void> {
  const unlinks = Array.from(state.pendingUnlinks.values());
  state.pendingUnlinks.clear();
  for (const p of unlinks) {
    clearTimeout(p.timer);
    await p.finalize().catch(() => undefined);
  }
  const adds = Array.from(state.pendingAdds.values());
  state.pendingAdds.clear();
  for (const p of adds) {
    clearTimeout(p.timer);
    await p.finalize().catch(() => undefined);
  }
}

export const start: Handler<WatcherStartArgs, WatcherStartResult> = async (_args, ctx) => {
  const root = requireWorkspaceRoot(ctx);
  // Idempotent + concurrency-safe: a window calls watcher.start on every refresh,
  // and two overlapping refreshes for the same root must not EACH build a chokidar
  // instance (the second would clobber the map and leak the first). CLAIM the map
  // slot synchronously, BEFORE the async create — so a concurrent start sees it and
  // short-circuits instead of double-creating.
  if (watchers.has(root)) return { active: true, workspaceRoot: root };
  const state: WatcherState = {
    root,
    // ctx already carries `root` (desktop service injection / bound test core), so
    // its composing ctx.run keeps every cascade in this workspace.
    ctx,
    watcher: null,
    pendingUnlinks: new Map(),
    pendingAdds: new Map(),
    inflight: new Set(),
  };
  watchers.set(root, state);
  try {
    state.watcher = await createChokidarWatcher(root, (event) =>
      track(state, handleEvent(state, event)),
    );
  } catch (err) {
    // Creation failed — drop the half-built slot so a later start can retry. Guard
    // by identity: a concurrent stop+start may already have replaced our entry.
    if (watchers.get(root) === state) watchers.delete(root);
    throw err;
  }
  return { active: true, workspaceRoot: root };
};

export const stop: Handler<WatcherStopArgs, WatcherStopResult> = async (_args, ctx) => {
  // Stop only THIS call's workspace watcher — other windows' watchers keep running.
  const root = ctx.workspaceRoot;
  if (root == null) return { stopped: false };
  const state = watchers.get(root);
  if (!state) return { stopped: false };
  // Remove this state's slot UP-FRONT (before the async teardown), so a concurrent
  // start for the same root — e.g. a fast switch-away-then-back — creates a FRESH
  // watcher instead of short-circuiting onto this one as it closes (which would
  // leave the root silently unwatched once this stop deletes + closes it).
  watchers.delete(root);
  await flushPendingBuffers(state);
  if (state.watcher) await state.watcher.close();
  // Wait for any handler/finalize already in flight to land before declaring
  // the watcher stopped, so a teardown can't leave a write racing.
  await drainInflight(state);
  return { stopped: true };
};

export const status: Handler<WatcherStatusArgs, WatcherStatusResult> = async (_args, ctx) => {
  const root = ctx.workspaceRoot ?? null;
  const active = root != null && watchers.has(root);
  return { active, workspaceRoot: active ? root : null };
};

// Test-only: reset ALL watcher state. Exported so vitest can clean between tests
// without exposing a real `watcher.reset` to user-facing CLIs.
export async function _resetForTests(): Promise<void> {
  const all = [...watchers.values()];
  watchers.clear();
  for (const state of all) {
    // Eagerly drop any in-flight rename buffers so they don't fire against
    // the NEXT test's workspace.
    for (const p of state.pendingUnlinks.values()) clearTimeout(p.timer);
    state.pendingUnlinks.clear();
    for (const p of state.pendingAdds.values()) clearTimeout(p.timer);
    state.pendingAdds.clear();
    if (state.watcher) await state.watcher.close();
    // Drain in-flight handlers/finalizes so a write can't land in the NEXT
    // test's torn-down workspace (the source of "No current workspace" /
    // ENOTEMPTY / mid-write BadgeCorrupt flakes in watcher.test.ts).
    await drainInflight(state);
  }
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
