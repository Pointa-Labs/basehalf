import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../src/renderer/src/store/workspace.js';

// The editor's flush is the navigation gatekeeper: it resolves `false` while a
// disk-conflict banner is unresolved. These tests pin the STORE half of that
// contract — that setCurrentFile / use / addDroppedPaths refuse to leave the
// conflicted file (and surface a hint) instead of silently dropping the local
// edit OR clobbering the external write. This is the exact decision point codex
// flagged P1 (workspace.ts setCurrentFile + the two workspace switches).
//
// Runs in the node env: the store reaches `window.bh` only inside actions, and
// every blocked path returns BEFORE any window access, so no DOM stub is needed.
// noteOpenedFile's localStorage access is itself try/catch-guarded → a no-op here.

const store = useWorkspaceStore;
// Let the async flushEditor().then(...) settle before asserting.
const tick = (): Promise<void> => new Promise((r) => setTimeout(r));

describe('store navigation blocks on an unresolved editor conflict', () => {
  beforeEach(() => {
    store.setState({
      currentFile: 'a.md',
      current: 'ws',
      busy: false,
      error: '',
      flushEditor: null,
    });
  });

  it('setCurrentFile switches when the flush resolves true (flushed/clean)', async () => {
    store.setState({ flushEditor: async () => true });
    store.getState().setCurrentFile('b.md');
    await tick();
    expect(store.getState().currentFile).toBe('b.md');
    expect(store.getState().error).toBe('');
  });

  it('setCurrentFile does NOT switch when the flush resolves false (conflict open)', async () => {
    store.setState({ flushEditor: async () => false });
    store.getState().setCurrentFile('b.md');
    await tick();
    // Stayed on the conflicted file — no silent drop/clobber — and nudged the user.
    expect(store.getState().currentFile).toBe('a.md');
    expect(store.getState().error).toMatch(/disk conflict/i);
  });

  it('setCurrentFile still switches when no editor is mounted (flushEditor null)', async () => {
    store.setState({ flushEditor: null });
    store.getState().setCurrentFile('b.md');
    await tick();
    expect(store.getState().currentFile).toBe('b.md');
  });

  it('a flush error never traps the user (rejection ⇒ proceed)', async () => {
    store.setState({
      flushEditor: async () => {
        throw new Error('editor torn down');
      },
    });
    store.getState().setCurrentFile('b.md');
    await tick();
    expect(store.getState().currentFile).toBe('b.md');
  });

  it('use() refuses to switch workspace while a conflict is open', async () => {
    store.setState({ flushEditor: async () => false });
    await store.getState().use('other-ws');
    expect(store.getState().current).toBe('ws'); // unchanged — no window.bh.run reached
    expect(store.getState().busy).toBe(false);
    expect(store.getState().error).toMatch(/disk conflict/i);
  });

  it('addDroppedPaths refuses to proceed while a conflict is open', async () => {
    store.setState({ flushEditor: async () => false });
    await store.getState().addDroppedPaths(['/some/dropped/folder']);
    expect(store.getState().busy).toBe(false);
    expect(store.getState().error).toMatch(/disk conflict/i);
  });
});
