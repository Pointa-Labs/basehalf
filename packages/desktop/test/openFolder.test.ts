import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { workspaceFilesService } from '../src/platform/files/browser/workspaceFilesService.js';
import { useWorkspaceStore } from '../src/workbench/services/workspace/browser/workspaceStore.js';

// Pin the multi-window "Open Folder" semantics (pickAndAdd / addDroppedPaths /
// remove): opening a folder OPENS it (registers if needed, then open-or-focuses
// its window), re-opening a registered folder open-or-focuses without erroring,
// and removing the current workspace reloads THIS window to the welcome state —
// never auto-jumping to another one.
//
// Phase 3 split the single switch verb into two:
//  - `window.bh.openWorkspace(name)` = OPEN-OR-FOCUS (focus existing / reuse
//    welcome / new window); returns `{ reused }`. Recorded in `openCalls`.
//  - `window.bh.reopenWindow(name|null)` = REOPEN THIS window (remove-current →
//    welcome `null`; repath). Recorded in `reopenCalls`.
// The desktop registry behavior itself (path identity, name suffixing) is
// covered in main-service tests; this mock mirrors its contract.

interface WsEntry {
  name: string;
  path: string;
  addedAt: string;
}

let registry: WsEntry[];
let currentName: string | null;
let pickResult: string | null;
let runCalls: string[];
/** Workspaces opened-or-focused via window.bh.openWorkspace. */
let openCalls: string[];
/** This-window reopens via window.bh.reopenWindow (null = welcome). */
let reopenCalls: (string | null)[];

const bh = {
  pickWorkspace: async (): Promise<string | null> => pickResult,
  // Open-or-focus. In production main may focus another window / open a new one
  // (reused:false → this window stays) or reuse the welcome window (reused:true →
  // reload). The mock records the request and reports "not reused" (a new/focused
  // window), so the store takes its stays-alive path (reset busy + refresh).
  openWorkspace: async (name: string): Promise<{ reused: boolean }> => {
    openCalls.push(name);
    return { reused: false };
  },
  // Reopen THIS window bound to `name` (or welcome `null`) — reloads in production.
  reopenWindow: async (name: string | null): Promise<void> => {
    reopenCalls.push(name);
  },
  // Recent-surfaces signals (no-ops here): main rebuilds Open Recent / Dock on a
  // registry change; the welcome list reads the open set. The store calls
  // notifyWorkspacesChanged after add/remove/rename/repath.
  notifyWorkspacesChanged: (): void => {},
  getOpenWorkspaces: async (): Promise<string[]> => [],
  workspace: {
    startWatcher: async (): Promise<void> => {
      runCalls.push('watcher.start');
    },
    list: async (): Promise<unknown> => runWorkspace('workspace.list', {}),
    ensureSetup: async (): Promise<unknown> => runWorkspace('workspace.ensureSetup', {}),
    add: async (args: unknown): Promise<unknown> => runWorkspace('workspace.add', args),
    remove: async (args: unknown): Promise<unknown> => runWorkspace('workspace.remove', args),
  },
  focus: {
    pruneDangling: async (): Promise<unknown> => {
      runCalls.push('focus.pruneDangling');
      return {};
    },
  },
  badge: {
    pruneDangling: async (): Promise<unknown> => {
      runCalls.push('badge.pruneDangling');
      return {};
    },
  },
  run: async (name: string, args?: unknown): Promise<unknown> => runWorkspace(name, args),
};

async function runWorkspace(name: string, args?: unknown): Promise<unknown> {
  runCalls.push(name);
  const a = (args ?? {}) as { path?: string; name?: string };
  switch (name) {
    case 'workspace.add': {
      const path = a.path as string;
      const existing = registry.find((w) => w.path.toLowerCase() === path.toLowerCase());
      if (existing) {
        return { workspace: existing, bhDirCreated: false, alreadyRegistered: true };
      }
      const base = path.split('/').filter(Boolean).pop() ?? 'ws';
      let candidate = base;
      for (let i = 2; registry.some((w) => w.name === candidate); i++) {
        candidate = `${base}-${i}`;
      }
      const entry = { name: candidate, path, addedAt: 'now' };
      registry.push(entry);
      return { workspace: entry, bhDirCreated: true, alreadyRegistered: false };
    }
    case 'workspace.remove': {
      registry = registry.filter((w) => w.name !== a.name);
      return { removed: a.name };
    }
    case 'workspace.list':
      return { current: currentName, workspaces: [...registry] };
    default:
      return {}; // watcher.start, focus.pruneDangling, badge.pruneDangling, …
  }
}

beforeEach(() => {
  registry = [];
  currentName = null;
  pickResult = null;
  runCalls = [];
  openCalls = [];
  reopenCalls = [];
  (globalThis as { window?: unknown }).window = { bh };
  vi.spyOn(workspaceFilesService, 'listFiles').mockImplementation(async (path) => {
    runCalls.push('files.listFiles');
    return { path, entries: [] };
  });
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  useWorkspaceStore.setState({ workspaces: [], current: null, busy: false, error: '' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('refresh', () => {
  it('ensures BaseHalf setup for a reachable current workspace', async () => {
    registry = [{ name: 'docs', path: '/docs', addedAt: 'x' }];
    currentName = 'docs';

    await useWorkspaceStore.getState().refresh();

    expect(useWorkspaceStore.getState().currentReachable).toBe(true);
    expect(runCalls).toContain('files.listFiles');
    expect(runCalls).toContain('workspace.ensureSetup');
    expect(runCalls.indexOf('workspace.ensureSetup')).toBeGreaterThan(
      runCalls.indexOf('files.listFiles'),
    );
  });
});

describe('pickAndAdd (File ▸ Open Folder)', () => {
  it('first folder: registers it and opens it (no extra workspace.use)', async () => {
    pickResult = '/vault';
    await useWorkspaceStore.getState().pickAndAdd();
    expect(registry.map((w) => w.name)).toEqual(['vault']);
    expect(openCalls).toEqual(['vault']);
    expect(runCalls).not.toContain('workspace.use');
    expect(useWorkspaceStore.getState().error).toBe('');
  });

  it('opening a SECOND folder switches to it (open means open)', async () => {
    registry = [{ name: 'old', path: '/old', addedAt: 'x' }];
    useWorkspaceStore.setState({ current: 'old' });
    pickResult = '/fresh';
    await useWorkspaceStore.getState().pickAndAdd();
    expect(openCalls).toEqual(['fresh']);
  });

  it('re-opening an already-registered folder switches without erroring', async () => {
    registry = [
      { name: 'old', path: '/old', addedAt: 'x' },
      { name: 'docs', path: '/docs', addedAt: 'x' },
    ];
    useWorkspaceStore.setState({ current: 'old' });
    pickResult = '/docs';
    await useWorkspaceStore.getState().pickAndAdd();
    expect(openCalls).toEqual(['docs']);
    expect(useWorkspaceStore.getState().error).toBe('');
    expect(registry).toHaveLength(2); // no duplicate registration
  });

  it('cancelling the picker is a no-op', async () => {
    pickResult = null;
    await useWorkspaceStore.getState().pickAndAdd();
    expect(openCalls).toEqual([]);
    expect(runCalls).toHaveLength(0);
  });
});

describe('addDroppedPaths', () => {
  it('drops register all folders and open the last one', async () => {
    registry = [{ name: 'old', path: '/old', addedAt: 'x' }];
    useWorkspaceStore.setState({ current: 'old' });
    await useWorkspaceStore.getState().addDroppedPaths(['/one', '/two']);
    expect(registry.map((w) => w.name)).toEqual(['old', 'one', 'two']);
    expect(openCalls).toEqual(['two']);
  });

  it('re-dropping a registered folder just switches to it', async () => {
    registry = [
      { name: 'old', path: '/old', addedAt: 'x' },
      { name: 'docs', path: '/docs', addedAt: 'x' },
    ];
    useWorkspaceStore.setState({ current: 'old' });
    await useWorkspaceStore.getState().addDroppedPaths(['/docs']);
    expect(openCalls).toEqual(['docs']);
    expect(useWorkspaceStore.getState().error).toBe('');
  });
});

describe('remove', () => {
  it('removing the current workspace reloads this window to the welcome state', async () => {
    registry = [
      { name: 'a', path: '/a', addedAt: 'x' },
      { name: 'b', path: '/b', addedAt: 'x' },
    ];
    useWorkspaceStore.setState({ current: 'a' });
    await useWorkspaceStore.getState().remove('a');
    // The entry is unregistered, and THIS window reopens to welcome (null) rather
    // than auto-promoting a survivor.
    expect(registry.map((w) => w.name)).toEqual(['b']);
    expect(reopenCalls).toEqual([null]);
    expect(openCalls).toEqual([]); // not an open-or-focus
  });

  it('removing a NON-current workspace just refreshes (no reload)', async () => {
    registry = [
      { name: 'a', path: '/a', addedAt: 'x' },
      { name: 'b', path: '/b', addedAt: 'x' },
    ];
    useWorkspaceStore.setState({ current: 'a' });
    await useWorkspaceStore.getState().remove('b');
    expect(registry.map((w) => w.name)).toEqual(['a']);
    expect(reopenCalls).toEqual([]); // no window reload
    expect(openCalls).toEqual([]);
    expect(runCalls).toContain('workspace.list'); // refreshed instead
  });
});
