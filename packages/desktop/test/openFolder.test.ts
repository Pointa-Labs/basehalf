import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../src/renderer/src/store/workspace.js';

// Pin the "Open Folder" semantics (pickAndAdd / addDroppedPaths / remove):
// opening a folder OPENS it (registers if needed, then switches), re-opening a
// registered folder switches without erroring, and removing the current
// workspace ends in the empty state — never auto-jumping to another one.
//
// After the per-window refactor a SWITCH is `window.bh.openWorkspace(name)` —
// main rebinds the window to that workspace and RELOADS it (so the new bound
// root rebuilds all state). There is no in-place `current` mutation to assert
// anymore; the observable is "openWorkspace was called with the right name"
// (or `null` for the welcome state). The core registry behavior itself (path
// identity, name suffixing) is unit-tested in @basehalf/core; this mock mirrors
// its contract.

interface WsEntry {
  name: string;
  path: string;
  addedAt: string;
}

let registry: WsEntry[];
let pickResult: string | null;
let runCalls: string[];
/** The switches requested via window.bh.openWorkspace (the reload primitive). */
let openCalls: (string | null)[];

const bh = {
  pickWorkspace: async (): Promise<string | null> => pickResult,
  // A switch reloads the window in production; here we just record the request.
  openWorkspace: async (name: string | null): Promise<void> => {
    openCalls.push(name);
  },
  run: async (name: string, args?: unknown): Promise<unknown> => {
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
        return { current: null, workspaces: [...registry] };
      case 'workspace.listFiles':
        return { files: [] };
      default:
        return {}; // watcher.start, focus.pruneDangling, badge.pruneDangling, …
    }
  },
};

beforeEach(() => {
  registry = [];
  pickResult = null;
  runCalls = [];
  openCalls = [];
  (globalThis as { window?: unknown }).window = { bh };
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  useWorkspaceStore.setState({ workspaces: [], current: null, busy: false, error: '' });
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
    // The entry is unregistered, and the window reloads to welcome (null) rather
    // than auto-promoting a survivor.
    expect(registry.map((w) => w.name)).toEqual(['b']);
    expect(openCalls).toEqual([null]);
  });

  it('removing a NON-current workspace just refreshes (no reload)', async () => {
    registry = [
      { name: 'a', path: '/a', addedAt: 'x' },
      { name: 'b', path: '/b', addedAt: 'x' },
    ];
    useWorkspaceStore.setState({ current: 'a' });
    await useWorkspaceStore.getState().remove('b');
    expect(registry.map((w) => w.name)).toEqual(['a']);
    expect(openCalls).toEqual([]); // no window reload
    expect(runCalls).toContain('workspace.list'); // refreshed instead
  });
});
