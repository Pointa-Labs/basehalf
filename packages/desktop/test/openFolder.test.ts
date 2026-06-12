import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../src/renderer/src/store/workspace.js';

// Pin the "Open Folder" semantics (pickAndAdd / addDroppedPaths / remove):
// opening a folder OPENS it (registers if needed, then switches), re-opening
// a registered folder switches without erroring, and removing the current
// workspace ends in the empty state — never auto-jumping to another one.
// The core registry behavior itself (path identity, name suffixing) is
// unit-tested in @basehalf/core; this mock mirrors its contract.

interface WsEntry {
  name: string;
  path: string;
  addedAt: string;
}

let registry: WsEntry[];
let current: string | null;
let pickResult: string | null;
let runCalls: string[];

const bh = {
  pickWorkspace: async (): Promise<string | null> => pickResult,
  run: async (name: string, args?: unknown): Promise<unknown> => {
    runCalls.push(name);
    const a = (args ?? {}) as { path?: string; name?: string };
    switch (name) {
      case 'workspace.add': {
        const path = a.path as string;
        const existing = registry.find((w) => w.path.toLowerCase() === path.toLowerCase());
        if (existing) {
          const becomesCurrent = current === null;
          if (becomesCurrent) current = existing.name;
          return {
            workspace: existing,
            setAsCurrent: becomesCurrent,
            bhDirCreated: false,
            alreadyRegistered: true,
          };
        }
        const base = path.split('/').filter(Boolean).pop() ?? 'ws';
        let candidate = base;
        for (let i = 2; registry.some((w) => w.name === candidate); i++) {
          candidate = `${base}-${i}`;
        }
        const entry = { name: candidate, path, addedAt: 'now' };
        registry.push(entry);
        const becomesCurrent = current === null;
        if (becomesCurrent) current = candidate;
        return {
          workspace: entry,
          setAsCurrent: becomesCurrent,
          bhDirCreated: true,
          alreadyRegistered: false,
        };
      }
      case 'workspace.use': {
        const found = registry.find((w) => w.name === a.name);
        if (!found) throw new Error(`No such workspace: ${a.name}`);
        current = found.name;
        return { current: found };
      }
      case 'workspace.remove': {
        registry = registry.filter((w) => w.name !== a.name);
        current = current === a.name ? null : current;
        return { removed: a.name, newCurrent: current };
      }
      case 'workspace.list':
        return { current, workspaces: [...registry] };
      case 'workspace.listFiles':
        return { files: [] };
      default:
        return {}; // watcher.start, focus.pruneDangling, …
    }
  },
};

beforeEach(() => {
  registry = [];
  current = null;
  pickResult = null;
  runCalls = [];
  (globalThis as { window?: unknown }).window = { bh };
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  useWorkspaceStore.setState({ workspaces: [], current: null, busy: false, error: '' });
});

describe('pickAndAdd (File ▸ Open Folder)', () => {
  it('first folder: registers and becomes current without an extra use', async () => {
    pickResult = '/vault';
    await useWorkspaceStore.getState().pickAndAdd();
    expect(useWorkspaceStore.getState().current).toBe('vault');
    expect(runCalls.filter((c) => c === 'workspace.use')).toHaveLength(0);
    expect(useWorkspaceStore.getState().error).toBe('');
  });

  it('opening a SECOND folder switches to it (open means open)', async () => {
    registry = [{ name: 'old', path: '/old', addedAt: 'x' }];
    current = 'old';
    useWorkspaceStore.setState({ current: 'old' });
    pickResult = '/fresh';
    await useWorkspaceStore.getState().pickAndAdd();
    expect(useWorkspaceStore.getState().current).toBe('fresh');
  });

  it('re-opening an already-registered folder switches without erroring', async () => {
    registry = [
      { name: 'old', path: '/old', addedAt: 'x' },
      { name: 'docs', path: '/docs', addedAt: 'x' },
    ];
    current = 'old';
    useWorkspaceStore.setState({ current: 'old' });
    pickResult = '/docs';
    await useWorkspaceStore.getState().pickAndAdd();
    expect(useWorkspaceStore.getState().current).toBe('docs');
    expect(useWorkspaceStore.getState().error).toBe('');
    expect(registry).toHaveLength(2); // no duplicate registration
  });

  it('cancelling the picker is a no-op', async () => {
    pickResult = null;
    await useWorkspaceStore.getState().pickAndAdd();
    expect(useWorkspaceStore.getState().current).toBeNull();
    expect(runCalls).toHaveLength(0);
  });
});

describe('addDroppedPaths', () => {
  it('drops register all folders and open the last one', async () => {
    registry = [{ name: 'old', path: '/old', addedAt: 'x' }];
    current = 'old';
    useWorkspaceStore.setState({ current: 'old' });
    await useWorkspaceStore.getState().addDroppedPaths(['/one', '/two']);
    expect(registry.map((w) => w.name)).toEqual(['old', 'one', 'two']);
    expect(useWorkspaceStore.getState().current).toBe('two');
  });

  it('re-dropping a registered folder just switches to it', async () => {
    registry = [
      { name: 'old', path: '/old', addedAt: 'x' },
      { name: 'docs', path: '/docs', addedAt: 'x' },
    ];
    current = 'old';
    useWorkspaceStore.setState({ current: 'old' });
    await useWorkspaceStore.getState().addDroppedPaths(['/docs']);
    expect(useWorkspaceStore.getState().current).toBe('docs');
    expect(useWorkspaceStore.getState().error).toBe('');
  });
});

describe('remove', () => {
  it('removing the current workspace lands on the empty state (current null)', async () => {
    registry = [
      { name: 'a', path: '/a', addedAt: 'x' },
      { name: 'b', path: '/b', addedAt: 'x' },
    ];
    current = 'a';
    useWorkspaceStore.setState({ current: 'a' });
    await useWorkspaceStore.getState().remove('a');
    expect(useWorkspaceStore.getState().current).toBeNull();
    expect(useWorkspaceStore.getState().workspaces.map((w) => w.name)).toEqual(['b']);
  });
});
