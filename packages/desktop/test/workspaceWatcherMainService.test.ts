import { describe, expect, it, vi } from 'vitest';
import type { WatcherEvent } from '../src/platform/files/common/files.js';
import {
  WorkspaceWatcherMainService,
  type WorkspaceWatcherMirrorParticipant,
  findCounterpart,
  safeRelativePath,
} from '../src/platform/files/electron-main/workspaceWatcherMainService.js';

describe('WorkspaceWatcherMainService', () => {
  it('starts one watcher per workspace and forwards scoped file events', async () => {
    const created: Array<{
      root: string;
      dispatch: (event: WatcherEvent) => void | Promise<void>;
    }> = [];
    const service = new WorkspaceWatcherMainService({
      createWatcher: async (root, dispatch) => {
        created.push({ root, dispatch });
        return { close: vi.fn(async () => undefined) };
      },
    });
    const events: WatcherEvent[] = [];
    service.on('event', (event) => events.push(event));

    await service.start('/repo');
    await service.start('/repo');
    expect(created).toHaveLength(1);
    await created[0]?.dispatch({
      type: 'change',
      absPath: '/repo/a.md',
      relPath: 'a.md',
      isDir: false,
    });

    expect(events).toEqual([
      {
        type: 'change',
        workspaceRoot: '/repo',
        absPath: '/repo/a.md',
        relPath: 'a.md',
        isDir: false,
      },
    ]);
    expect(service.status('/repo')).toEqual({ active: true, workspaceRoot: '/repo' });
  });

  it('pairs matching unlink/add events as a rename and drives mirror rename', async () => {
    const created: Array<{ dispatch: (event: WatcherEvent) => void | Promise<void> }> = [];
    const mirror = mirrorParticipant();
    const service = new WorkspaceWatcherMainService({
      mirror,
      createWatcher: async (_root, dispatch) => {
        created.push({ dispatch });
        return { close: vi.fn(async () => undefined) };
      },
    });
    const events: WatcherEvent[] = [];
    service.on('event', (event) => events.push(event));

    await service.start('/repo');
    await created[0]?.dispatch({
      type: 'unlink',
      absPath: '/repo/a.md',
      relPath: 'a.md',
      isDir: false,
    });
    await created[0]?.dispatch({
      type: 'add',
      absPath: '/repo/b.md',
      relPath: 'b.md',
      isDir: false,
    });

    expect(mirror.rename).toHaveBeenCalledWith('/repo', {
      from: 'a.md',
      to: 'b.md',
      kind: 'file',
    });
    expect(events.at(-1)).toEqual({
      type: 'rename',
      workspaceRoot: '/repo',
      fromRelPath: 'a.md',
      toRelPath: 'b.md',
      isDir: false,
    });
  });

  it('flushes pending unlink and add reconciliation on stop', async () => {
    const created: Array<{ dispatch: (event: WatcherEvent) => void | Promise<void> }> = [];
    const close = vi.fn(async () => undefined);
    const mirror = mirrorParticipant({ orphan: true });
    const service = new WorkspaceWatcherMainService({
      mirror,
      createWatcher: async (_root, dispatch) => {
        created.push({ dispatch });
        return { close };
      },
    });

    await service.start('/repo');
    await created[0]?.dispatch({
      type: 'unlink',
      absPath: '/repo/gone.md',
      relPath: 'gone.md',
      isDir: false,
    });
    await created[0]?.dispatch({
      type: 'add',
      absPath: '/repo/back.txt',
      relPath: 'back.txt',
      isDir: false,
    });
    await expect(service.stop('/repo')).resolves.toEqual({ stopped: true });

    expect(mirror.markOrphan).toHaveBeenCalledWith('/repo', {
      file: 'gone.md',
      kind: 'file',
    });
    expect(mirror.pruneDanglingFocus).toHaveBeenCalledWith('/repo');
    expect(mirror.setBadge).toHaveBeenCalledWith('/repo', {
      file: 'back.txt',
      patch: { kind: 'file', orphan: false },
    });
    expect(close).toHaveBeenCalled();
    expect(service.status('/repo')).toEqual({ active: false, workspaceRoot: null });
  });

  it('closes a watcher that finishes starting after the workspace was stopped', async () => {
    let resolveWatcher: ((watcher: { close: () => Promise<void> }) => void) | null = null;
    const close = vi.fn(async () => undefined);
    const service = new WorkspaceWatcherMainService({
      createWatcher: async () =>
        new Promise((resolve) => {
          resolveWatcher = resolve;
        }),
    });

    const start = service.start('/repo');
    await Promise.resolve();
    expect(service.status('/repo')).toEqual({ active: true, workspaceRoot: '/repo' });
    await expect(service.stop('/repo')).resolves.toEqual({ stopped: true });
    resolveWatcher?.({ close });
    await start;

    expect(close).toHaveBeenCalledTimes(1);
    expect(service.status('/repo')).toEqual({ active: false, workspaceRoot: null });
  });
});

describe('findCounterpart', () => {
  it('requires a unique same-parent same-extension counterpart', () => {
    const incoming = event('notes/c.md');
    expect(findCounterpart(new Map([['a', { event: event('notes/a.md') }]]), incoming)).toEqual({
      event: event('notes/a.md'),
    });
    expect(
      findCounterpart(
        new Map([
          ['a', { event: event('notes/a.md') }],
          ['b', { event: event('notes/b.md') }],
        ]),
        incoming,
      ),
    ).toBeNull();
    expect(findCounterpart(new Map([['a', { event: event('other/a.md') }]]), incoming)).toBeNull();
    expect(findCounterpart(new Map([['a', { event: event('notes/a.txt') }]]), incoming)).toBeNull();
  });
});

describe('safeRelativePath', () => {
  it('normalizes contained watcher paths and rejects paths escaping the workspace', () => {
    expect(safeRelativePath('/repo', '/repo/notes/a.md')).toBe('notes/a.md');
    expect(safeRelativePath('/repo', '/repo')).toBeNull();
    expect(safeRelativePath('/repo', '/repo-other/a.md')).toBeNull();
    expect(safeRelativePath('/repo', '/tmp/a.md')).toBeNull();
  });
});

function mirrorParticipant(existing: { readonly orphan?: boolean } | null = null): {
  readonly getBadge: ReturnType<typeof vi.fn>;
  readonly setBadge: ReturnType<typeof vi.fn>;
  readonly markOrphan: ReturnType<typeof vi.fn>;
  readonly rename: ReturnType<typeof vi.fn>;
  readonly pruneDanglingFocus: ReturnType<typeof vi.fn>;
} & WorkspaceWatcherMirrorParticipant {
  return {
    getBadge: vi.fn(async () => existing),
    setBadge: vi.fn(async () => undefined),
    markOrphan: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    pruneDanglingFocus: vi.fn(async () => undefined),
  };
}

function event(relPath: string): {
  readonly event: {
    readonly type: 'unlink';
    readonly absPath: string;
    readonly relPath: string;
    readonly isDir: false;
  };
}['event'] {
  return { type: 'unlink', absPath: `/repo/${relPath}`, relPath, isDir: false };
}
