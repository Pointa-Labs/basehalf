import { afterEach, describe, expect, it } from 'vitest';
import { registerFlusher, unregisterFlusher } from '../src/renderer/src/lib/editorFlush.js';
import type { LeafPane } from '../src/renderer/src/lib/paneTree.js';
import { useWorkspaceStore } from '../src/renderer/src/store/workspace.js';

// The editor's flush is the navigation gatekeeper: it resolves `false` while a
// disk-conflict banner is unresolved. These tests pin the STORE half of that
// contract — that openInPanel (per-pane flush) and the workspace switches
// (flush-ALL across panes) refuse to leave the conflicted file (and surface a
// hint) instead of silently dropping the local edit OR clobbering the external
// write. With split panes the flush moved from a single store slot to the
// per-pane editorFlush registry; the contract is unchanged.
//
// Runs in the node env: the store reaches `window.bh` only inside actions, and
// every blocked path returns BEFORE any window access, so no DOM stub is needed.

const store = useWorkspaceStore;
const tick = (): Promise<void> => new Promise((r) => setTimeout(r));
const PANE = 'test-pane';

// A single-pane tree with `a.md` active, plus an optional registered flusher for
// that pane (the editor that would block on a conflict).
function setupActivePane(flush?: () => Promise<boolean>): void {
  const leaf: LeafPane = {
    type: 'leaf',
    id: PANE,
    tabs: ['a.md'],
    activeFile: 'a.md',
    previewFile: null,
  };
  store.setState({
    paneTree: leaf,
    activePaneId: PANE,
    currentFile: 'a.md',
    current: 'ws',
    busy: false,
    error: '',
  });
  unregisterFlusher(PANE);
  if (flush) registerFlusher(PANE, flush);
}

afterEach(() => unregisterFlusher(PANE));

describe('store navigation blocks on an unresolved editor conflict', () => {
  it('openInPanel switches when the pane flush resolves true (clean)', async () => {
    setupActivePane(async () => true);
    store.getState().openInPanel('b.md');
    await tick();
    expect(store.getState().currentFile).toBe('b.md');
    expect(store.getState().error).toBe('');
  });

  it('openInPanel does NOT switch when the flush resolves false (conflict open)', async () => {
    setupActivePane(async () => false);
    store.getState().openInPanel('b.md');
    await tick();
    expect(store.getState().currentFile).toBe('a.md'); // stayed — no silent drop
    expect(store.getState().error).toMatch(/save or resolve/i);
  });

  it('openInPanel switches when no editor is registered for the pane', async () => {
    setupActivePane(); // no flusher
    store.getState().openInPanel('b.md');
    await tick();
    expect(store.getState().currentFile).toBe('b.md');
  });

  it('a flush rejection never traps the user (rejection ⇒ proceed)', async () => {
    setupActivePane(async () => {
      throw new Error('editor torn down');
    });
    store.getState().openInPanel('b.md');
    await tick();
    expect(store.getState().currentFile).toBe('b.md');
  });

  it('use() refuses to switch workspace while a conflict is open (flush-all)', async () => {
    setupActivePane(async () => false);
    await store.getState().use('other-ws');
    expect(store.getState().current).toBe('ws'); // unchanged — no window.bh.run reached
    expect(store.getState().busy).toBe(false);
    expect(store.getState().error).toMatch(/save or resolve/i);
  });

  it('use() does not leak busy when a pre-switch flush REJECTS', async () => {
    setupActivePane(async () => {
      throw new Error('editor torn down');
    });
    await store.getState().use('other-ws');
    expect(store.getState().busy).toBe(false); // NOT stranded
  });

  it('addDroppedPaths refuses to proceed while a conflict is open', async () => {
    setupActivePane(async () => false);
    await store.getState().addDroppedPaths(['/some/dropped/folder']);
    expect(store.getState().busy).toBe(false);
    expect(store.getState().error).toMatch(/save or resolve/i);
  });

  it('createNote gates BEFORE writing the stub (no orphan note on a conflict)', async () => {
    setupActivePane(async () => false);
    await store.getState().createNote('fresh-note.md');
    expect(store.getState().error).toMatch(/save or resolve/i);
  });

  // rename rebind: a renamed-away file's old path is gone, so the rebind must NOT
  // be gated (else the editor is trapped on a vanished path). renameTab swaps the
  // path straight through, no flush.
  it('renameTab rebinds even while a conflict is open', () => {
    setupActivePane(async () => false);
    store.getState().renameTab('a.md', 'z.md');
    expect(store.getState().currentFile).toBe('z.md');
  });

  // The write-failed escape hatch routes through bypassFlush-close: even when the
  // gatekeeper would block, Discard-&-close must force the tab shut.
  it('closeTab(bypassFlush) force-closes past a blocking gate', () => {
    setupActivePane(async () => false);
    store.getState().closeTab(PANE, 'a.md', { bypassFlush: true });
    expect(store.getState().currentFile).toBe(null); // escaped (pane now empty)
  });

  // The refresh()-based workspace actions also honor the gate (each returns
  // before its window.bh.run, so a `false` flush blocks with busy reset).
  for (const action of ['remove', 'renameWorkspace', 'createDemo'] as const) {
    it(`${action}() refuses while a conflict is open`, async () => {
      setupActivePane(async () => false);
      if (action === 'remove') await store.getState().remove('ws');
      else if (action === 'renameWorkspace') await store.getState().renameWorkspace('ws', 'ws2');
      else await store.getState().createDemo('/some/demo/path');
      expect(store.getState().busy).toBe(false);
      expect(store.getState().error).toMatch(/save or resolve/i);
    });
  }
});
