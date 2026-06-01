import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../src/renderer/src/store/workspace.js';

// The editor's flush is the navigation gatekeeper: it resolves `false` while a
// disk-conflict banner is unresolved. These tests pin the STORE half of that
// contract — that openInPanel / use / addDroppedPaths refuse to leave the
// conflicted file (and surface a hint) instead of silently dropping the local
// edit OR clobbering the external write. This is the exact decision point codex
// flagged P1 (workspace.ts open/switch path + the two workspace switches).
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
      tabs: ['a.md'],
      previewFile: null,
      current: 'ws',
      busy: false,
      error: '',
      flushEditor: null,
    });
  });

  it('openInPanel switches when the flush resolves true (flushed/clean)', async () => {
    store.setState({ flushEditor: async () => true });
    store.getState().openInPanel('b.md');
    await tick();
    expect(store.getState().currentFile).toBe('b.md');
    expect(store.getState().error).toBe('');
  });

  it('openInPanel does NOT switch when the flush resolves false (conflict open)', async () => {
    store.setState({ flushEditor: async () => false });
    store.getState().openInPanel('b.md');
    await tick();
    // Stayed on the conflicted file — no silent drop/clobber — and nudged the user.
    expect(store.getState().currentFile).toBe('a.md');
    expect(store.getState().error).toMatch(/save or resolve/i);
  });

  it('openInPanel still switches when no editor is mounted (flushEditor null)', async () => {
    store.setState({ flushEditor: null });
    store.getState().openInPanel('b.md');
    await tick();
    expect(store.getState().currentFile).toBe('b.md');
  });

  it('a flush error never traps the user (rejection ⇒ proceed)', async () => {
    store.setState({
      flushEditor: async () => {
        throw new Error('editor torn down');
      },
    });
    store.getState().openInPanel('b.md');
    await tick();
    expect(store.getState().currentFile).toBe('b.md');
  });

  it('use() refuses to switch workspace while a conflict is open', async () => {
    store.setState({ flushEditor: async () => false });
    await store.getState().use('other-ws');
    expect(store.getState().current).toBe('ws'); // unchanged — no window.bh.run reached
    expect(store.getState().busy).toBe(false);
    expect(store.getState().error).toMatch(/save or resolve/i);
  });

  it('use() does not leak busy when the pre-switch flush REJECTS (torn-down editor)', async () => {
    // A rejecting flush is non-blocking: use() proceeds (the `.catch` keeps the
    // rejection from escaping the await and stranding busy=true), reaches the
    // try/finally, and resets busy even though window.bh.run isn't available here.
    store.setState({
      current: 'ws',
      flushEditor: async () => {
        throw new Error('editor torn down');
      },
    });
    await store.getState().use('other-ws');
    expect(store.getState().busy).toBe(false); // NOT stranded
  });

  it('addDroppedPaths refuses to proceed while a conflict is open', async () => {
    store.setState({ flushEditor: async () => false });
    await store.getState().addDroppedPaths(['/some/dropped/folder']);
    expect(store.getState().busy).toBe(false);
    expect(store.getState().error).toMatch(/save or resolve/i);
  });

  it('createNote gates BEFORE writing the stub (no orphan note on a conflict)', async () => {
    // The gate is the first statement, so it returns before any window.bh.run
    // (workspace.writeFile) — proving no stub is written. If it fell through,
    // window.bh would be undefined here and throw a different error.
    store.setState({ flushEditor: async () => false });
    await store.getState().createNote('fresh-note.md');
    expect(store.getState().error).toMatch(/save or resolve/i);
  });

  // C — rename rebind: a renamed-away file's old path is gone, so the rebind
  // must NOT be gated (else the editor is trapped on a vanished path and
  // keepMine would resurrect it). renameTab swaps the path straight through.
  it('renameTab rebinds even while a conflict is open', () => {
    store.setState({ currentFile: 'a.md', tabs: ['a.md'], flushEditor: async () => false });
    store.getState().renameTab('a.md', 'b.md');
    expect(store.getState().currentFile).toBe('b.md'); // not blocked, no flush
    expect(store.getState().tabs).toEqual(['b.md']);
  });

  // The write-failed escape hatch routes through bypassFlush-close: even when the
  // gatekeeper would block (a persistently-unwritable file), Discard-&-close must
  // force the tab shut so the user is never trapped.
  it('closeTab(bypassFlush) force-closes past a blocking gate', () => {
    store.setState({ currentFile: 'a.md', tabs: ['a.md'], flushEditor: async () => false });
    store.getState().closeTab('a.md', { bypassFlush: true });
    expect(store.getState().currentFile).toBe(null); // escaped
  });

  // B — the refresh()-based workspace actions also honor the gate (each returns
  // before its window.bh.run, so a `false` flush blocks with busy reset).
  for (const action of ['remove', 'renameWorkspace', 'createDemo'] as const) {
    it(`${action}() refuses while a conflict is open`, async () => {
      store.setState({ current: 'ws', flushEditor: async () => false });
      // Each takes different args; the gate fires first regardless.
      if (action === 'remove') await store.getState().remove('ws');
      else if (action === 'renameWorkspace') await store.getState().renameWorkspace('ws', 'ws2');
      else await store.getState().createDemo('/some/demo/path');
      expect(store.getState().busy).toBe(false);
      expect(store.getState().error).toMatch(/save or resolve/i);
    });
  }
});
