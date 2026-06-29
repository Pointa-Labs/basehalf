import { EventEmitter } from 'node:events';
import { isAbsolute, relative } from 'node:path';
import type { FSWatcher } from 'chokidar';
import type { WatcherEvent, WatcherFsEvent, WatcherHostEvent } from '../common/files.js';

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

const RENAME_WINDOW_MS = 600;

export interface WorkspaceWatcherMirrorParticipant {
  getBadge(
    workspaceRoot: string,
    args: { readonly file: string; readonly kind: 'file' | 'folder' },
  ): Promise<{ readonly orphan?: boolean } | null>;
  setBadge(
    workspaceRoot: string,
    args: {
      readonly file: string;
      readonly patch: { readonly kind: 'file' | 'folder'; readonly orphan: false };
    },
  ): Promise<unknown>;
  markOrphan(
    workspaceRoot: string,
    args: { readonly file: string; readonly kind: 'file' | 'folder' },
  ): Promise<unknown>;
  rename(
    workspaceRoot: string,
    args: { readonly from: string; readonly to: string; readonly kind: 'file' | 'folder' },
  ): Promise<unknown>;
  pruneDanglingFocus(workspaceRoot: string): Promise<unknown>;
}

export interface WorkspaceWatcherMainServiceOptions {
  readonly mirror?: WorkspaceWatcherMirrorParticipant;
  readonly createWatcher?: WatcherFactory;
}

type WatcherFactory = (
  workspaceRoot: string,
  dispatch: (event: WatcherEvent) => void | Promise<void>,
) => Promise<RunningWatcher>;

export interface RunningWatcher {
  close(): Promise<void>;
}

interface WatcherState {
  readonly root: string;
  watcher: RunningWatcher | null;
  active: boolean;
  readonly pendingUnlinks: Map<string, PendingUnlink>;
  readonly pendingAdds: Map<string, PendingAdd>;
  readonly inflight: Set<Promise<unknown>>;
}

interface PendingUnlink {
  readonly event: WatcherFsEvent;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly finalize: () => Promise<void>;
}

interface PendingAdd {
  readonly event: WatcherFsEvent;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly finalize: () => Promise<void>;
}

/**
 * Main-process file watcher service. VS Code keeps recursive workspace watching
 * inside its file service and lets workbench participants react to events; this
 * service follows that shape while preserving BaseHalf's rename heuristic and
 * mirror reconcile hook through a narrow injected participant.
 */
export class WorkspaceWatcherMainService {
  private readonly events = new EventEmitter();
  private readonly watchers = new Map<string, WatcherState>();
  private readonly createWatcher: WatcherFactory;

  constructor(private readonly opts: WorkspaceWatcherMainServiceOptions = {}) {
    this.createWatcher = opts.createWatcher ?? createChokidarWatcher;
  }

  on(event: 'event', listener: (event: WatcherHostEvent) => void): unknown {
    return this.events.on(event, listener);
  }

  async start(workspaceRoot: string | null): Promise<void> {
    const root = requireWorkspaceRoot(workspaceRoot);
    if (this.watchers.has(root)) return;
    const state: WatcherState = {
      root,
      watcher: null,
      active: true,
      pendingUnlinks: new Map(),
      pendingAdds: new Map(),
      inflight: new Set(),
    };
    this.watchers.set(root, state);
    try {
      const watcher = await this.createWatcher(root, (event) =>
        this.track(state, this.handleEvent(state, event)),
      );
      if (this.watchers.get(root) !== state || !state.active) {
        await watcher.close();
        return;
      }
      state.watcher = watcher;
    } catch (err) {
      if (this.watchers.get(root) !== state) return;
      this.watchers.delete(root);
      state.active = false;
      throw err;
    }
  }

  async stop(workspaceRoot: string | null): Promise<{ stopped: boolean }> {
    if (workspaceRoot === null) return { stopped: false };
    const state = this.watchers.get(workspaceRoot);
    if (!state) return { stopped: false };
    this.watchers.delete(workspaceRoot);
    state.active = false;
    await this.flushPendingBuffers(state);
    if (state.watcher) await state.watcher.close();
    await this.drainInflight(state);
    return { stopped: true };
  }

  status(workspaceRoot: string | null): { active: boolean; workspaceRoot: string | null } {
    const active = workspaceRoot !== null && this.watchers.has(workspaceRoot);
    return { active, workspaceRoot: active ? workspaceRoot : null };
  }

  async dispose(): Promise<void> {
    const roots = [...this.watchers.keys()];
    await Promise.all(roots.map((root) => this.stop(root)));
  }

  private track(state: WatcherState, promise: Promise<unknown>): void {
    const tracked = promise.finally(() => state.inflight.delete(tracked));
    state.inflight.add(tracked);
  }

  private async drainInflight(state: WatcherState): Promise<void> {
    while (state.inflight.size > 0) {
      await Promise.allSettled([...state.inflight]);
    }
  }

  private emit(state: WatcherState, event: WatcherEvent): void {
    if (!state.active || this.watchers.get(state.root) !== state) return;
    this.events.emit('event', { ...event, workspaceRoot: state.root });
  }

  private async handleEvent(state: WatcherState, event: WatcherEvent): Promise<void> {
    if (!state.active || this.watchers.get(state.root) !== state) return;
    if (event.type === 'rename') {
      this.emit(state, event);
      return;
    }
    this.emit(state, event);
    if (event.type === 'add') {
      await this.handleAdd(state, event);
    } else if (event.type === 'unlink') {
      await this.handleUnlink(state, event);
    }
  }

  private async handleAdd(state: WatcherState, event: WatcherFsEvent): Promise<void> {
    const unlinkMatch = findCounterpart(state.pendingUnlinks, event);
    if (unlinkMatch) {
      clearTimeout(unlinkMatch.timer);
      state.pendingUnlinks.delete(unlinkMatch.event.relPath);
      await this.emitRename(state, unlinkMatch, event);
      return;
    }

    const finalize = async (): Promise<void> => {
      state.pendingAdds.delete(event.relPath);
      const mirror = this.opts.mirror;
      if (mirror === undefined) return;
      try {
        const kind = event.isDir ? 'folder' : 'file';
        const existing = await mirror.getBadge(state.root, { file: event.relPath, kind });
        if (existing?.orphan === true) {
          await mirror.setBadge(state.root, {
            file: event.relPath,
            patch: { kind, orphan: false },
          });
        }
      } catch (err) {
        console.error('[bh:watcher] add-finalize failed', event, err);
      }
    };
    const timer = setTimeout(() => {
      this.track(state, finalize());
    }, RENAME_WINDOW_MS);
    const previous = state.pendingAdds.get(event.relPath);
    if (previous) clearTimeout(previous.timer);
    state.pendingAdds.set(event.relPath, { event, timer, finalize });
  }

  private async handleUnlink(state: WatcherState, event: WatcherFsEvent): Promise<void> {
    const addMatch = findCounterpart(state.pendingAdds, event);
    if (addMatch) {
      clearTimeout(addMatch.timer);
      state.pendingAdds.delete(addMatch.event.relPath);
      await this.emitRename(
        state,
        { event, timer: setTimeout(() => undefined, 0), finalize: async () => undefined },
        addMatch.event,
      );
      return;
    }

    const finalize = async (): Promise<void> => {
      state.pendingUnlinks.delete(event.relPath);
      const mirror = this.opts.mirror;
      if (mirror === undefined) return;
      try {
        await mirror.markOrphan(state.root, {
          file: event.relPath,
          kind: event.isDir ? 'folder' : 'file',
        });
        await mirror.pruneDanglingFocus(state.root);
      } catch (err) {
        console.error('[bh:watcher] markOrphan failed on buffered unlink', event, err);
      }
    };
    const timer = setTimeout(() => {
      this.track(state, finalize());
    }, RENAME_WINDOW_MS);
    const previous = state.pendingUnlinks.get(event.relPath);
    if (previous) clearTimeout(previous.timer);
    state.pendingUnlinks.set(event.relPath, { event, timer, finalize });
  }

  private async emitRename(
    state: WatcherState,
    pending: PendingUnlink,
    add: WatcherFsEvent,
  ): Promise<void> {
    const kind = add.isDir ? 'folder' : 'file';
    const from = pending.event.relPath;
    const to = add.relPath;
    const mirror = this.opts.mirror;
    if (mirror !== undefined) {
      try {
        await mirror.rename(state.root, { from, to, kind });
      } catch (err) {
        console.warn('[bh:watcher] badge rename fell back:', err);
        await mirror.markOrphan(state.root, { file: from, kind }).catch(() => undefined);
      }
    }
    this.emit(state, {
      type: 'rename',
      fromRelPath: from,
      toRelPath: to,
      isDir: add.isDir,
    });
  }

  private async flushPendingBuffers(state: WatcherState): Promise<void> {
    const unlinks = [...state.pendingUnlinks.values()];
    state.pendingUnlinks.clear();
    for (const pending of unlinks) {
      clearTimeout(pending.timer);
      await pending.finalize().catch(() => undefined);
    }
    const adds = [...state.pendingAdds.values()];
    state.pendingAdds.clear();
    for (const pending of adds) {
      clearTimeout(pending.timer);
      await pending.finalize().catch(() => undefined);
    }
  }
}

export function findCounterpart<T extends { readonly event: WatcherFsEvent }>(
  buffer: Map<string, T>,
  incoming: WatcherFsEvent,
): T | null {
  const dir = parentDir(incoming.relPath);
  const ext = extension(incoming.relPath);
  let match: T | null = null;
  for (const pending of buffer.values()) {
    if (pending.event.isDir !== incoming.isDir) continue;
    if (parentDir(pending.event.relPath) !== dir) continue;
    if (extension(pending.event.relPath) !== ext) continue;
    if (pending.event.relPath === incoming.relPath) continue;
    if (match !== null) return null;
    match = pending;
  }
  return match;
}

export async function createChokidarWatcher(
  workspaceRoot: string,
  dispatch: (event: WatcherEvent) => void | Promise<void>,
): Promise<RunningWatcher> {
  const chokidar = await import('chokidar');
  const watcher: FSWatcher = chokidar.watch(workspaceRoot, {
    ignored: IGNORED_GLOBS,
    ignoreInitial: true,
    persistent: true,
    followSymlinks: false,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 25 },
  });

  function fire(type: WatcherFsEvent['type'], isDir: boolean): (absPath: string) => void {
    return (absPath) => {
      const relPath = safeRelativePath(workspaceRoot, absPath);
      if (relPath === null) return;
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
  watcher.on('error', (err: unknown) => {
    console.error('[bh:watcher] chokidar error:', err);
  });

  await new Promise<void>((resolve) => {
    watcher.once('ready', () => resolve());
  });

  return {
    async close() {
      await watcher.close();
    },
  };
}

function requireWorkspaceRoot(workspaceRoot: string | null): string {
  if (workspaceRoot === null) {
    throw new Error('No workspace bound. Register/use a workspace first.');
  }
  return workspaceRoot;
}

function parentDir(relPath: string): string {
  const index = relPath.lastIndexOf('/');
  return index === -1 ? '' : relPath.slice(0, index);
}

function extension(relPath: string): string {
  const base = relPath.slice(parentDir(relPath).length + (parentDir(relPath) === '' ? 0 : 1));
  const index = base.lastIndexOf('.');
  return index === -1 ? '' : base.slice(index);
}

function toPosix(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).join('/');
}

export function safeRelativePath(workspaceRoot: string, absPath: string): string | null {
  const raw = relative(workspaceRoot, absPath);
  if (raw === '' || raw.split(/[\\/]/)[0] === '..') return null;
  if (isAbsolute(raw) || /^[a-zA-Z]:/.test(raw)) return null;
  const rel = toPosix(raw);
  if (rel === '' || rel.split('/').some((segment) => segment === '..')) return null;
  return rel;
}
