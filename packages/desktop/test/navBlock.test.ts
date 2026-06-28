import { afterEach, describe, expect, it } from 'vitest';
import {
  registerFlusher,
  unregisterFlusher,
} from '../src/workbench/services/editor/browser/editorFlush.js';
import {
  EDITOR_OVERLAY_PANE_ID,
  useWorkspaceStore,
} from '../src/workbench/services/workspace/browser/workspaceStore.js';

// The editor's flush is the navigation gatekeeper: it resolves `false` while a
// disk-conflict banner is unresolved. These tests pin the STORE half of that
// contract — that opening another file (per-overlay flush) and the workspace
// switches (flush-ALL) refuse to leave the conflicted file (and surface a hint)
// instead of silently dropping the local edit OR clobbering the external write.
// With the single full-canvas editor overlay, the flush is keyed by one stable
// synthetic pane id; the contract is unchanged.
//
// Runs in the node env: the store reaches `window.bh` only inside actions, and
// every blocked path returns BEFORE any window access, so no DOM stub is needed.

const store = useWorkspaceStore;
const tick = (): Promise<void> => new Promise((r) => setTimeout(r));
const PANE = EDITOR_OVERLAY_PANE_ID;

// The overlay open on `a.md`, plus an optional registered flusher for it (the
// editor that would block on a conflict).
function setupOpenFile(flush?: () => Promise<boolean>): void {
  store.setState({
    openFile: 'a.md',
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
  it('openInPanel switches when the overlay flush resolves true (clean)', async () => {
    setupOpenFile(async () => true);
    store.getState().openInPanel('b.md');
    await tick();
    expect(store.getState().openFile).toBe('b.md');
    expect(store.getState().currentFile).toBe('b.md');
    expect(store.getState().error).toBe('');
  });

  it('openInPanel does NOT switch when the flush resolves false (conflict open)', async () => {
    setupOpenFile(async () => false);
    store.getState().openInPanel('b.md');
    await tick();
    expect(store.getState().openFile).toBe('a.md'); // stayed — no silent drop
    expect(store.getState().error).toMatch(/save or resolve/i);
  });

  it('openInPanel switches when no editor is registered', async () => {
    setupOpenFile(); // no flusher
    store.getState().openInPanel('b.md');
    await tick();
    expect(store.getState().openFile).toBe('b.md');
  });

  it('a flush rejection never traps the user (rejection ⇒ proceed)', async () => {
    setupOpenFile(async () => {
      throw new Error('editor torn down');
    });
    store.getState().openInPanel('b.md');
    await tick();
    expect(store.getState().openFile).toBe('b.md');
  });

  it('closeEditor blocks on an unresolved conflict, closes on a clean flush', async () => {
    setupOpenFile(async () => false);
    store.getState().closeEditor();
    await tick();
    expect(store.getState().openFile).toBe('a.md'); // stayed — conflict gate held
    expect(store.getState().error).toMatch(/save or resolve/i);

    // Resolve the conflict (flush now clean) → close succeeds.
    setupOpenFile(async () => true);
    store.getState().closeEditor();
    await tick();
    expect(store.getState().openFile).toBe(null);
  });

  // NOTE: use() / addDroppedPaths() / createDemo() no longer gate on this window's
  // editor conflict. In the multi-window model they OPEN-OR-FOCUS a DIFFERENT
  // window (or reuse the editor-less welcome window) — THIS window's conflicted
  // editor is never torn down, so there's nothing to flush or lose. Their
  // open-or-focus behavior is covered in openFolder.test.ts (with a window.bh
  // mock). Only the flows that RELOAD this window in place (remove-current,
  // repath) — and renameWorkspace's refresh — still honor the conflict gate below.

  it('createNote gates BEFORE writing the stub (no orphan note on a conflict)', async () => {
    setupOpenFile(async () => false);
    await store.getState().createNote('fresh-note.md');
    expect(store.getState().error).toMatch(/save or resolve/i);
  });

  // rename rebind: a renamed-away file's old path is gone, so the rebind must NOT
  // be gated (else the editor is trapped on a vanished path). renameTab swaps the
  // path straight through, no flush — even while a conflict is open.
  it('renameTab rebinds even while a conflict is open', () => {
    setupOpenFile(async () => false);
    store.getState().renameTab('a.md', 'z.md');
    expect(store.getState().openFile).toBe('z.md');
    expect(store.getState().currentFile).toBe('z.md');
  });

  // remove-current reloads this window (→ welcome) and renameWorkspace refreshes
  // it, so both still honor the gate (each returns before its window.bh reaches a
  // reload, so a `false` flush blocks with busy reset).
  for (const action of ['remove', 'renameWorkspace'] as const) {
    it(`${action}() refuses while a conflict is open`, async () => {
      setupOpenFile(async () => false);
      if (action === 'remove') await store.getState().remove('ws');
      else await store.getState().renameWorkspace('ws', 'ws2');
      expect(store.getState().busy).toBe(false);
      expect(store.getState().error).toMatch(/save or resolve/i);
    });
  }
});
