import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  registerFlusher,
  unregisterFlusher,
} from '../src/workbench/services/editor/common/editorFlush.js';
import { textFileService } from '../src/workbench/services/textfile/browser/textFileService.js';
import { workspaceFileOperationService } from '../src/workbench/services/workspace/browser/workspaceFileOperationService.js';
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// The overlay open on `a.md`, plus an optional registered flusher for it (the
// editor that would block on a conflict).
function setupOpenFile(flush?: () => Promise<boolean>): void {
  store.setState({
    openFile: 'a.md',
    currentFile: 'a.md',
    current: 'ws',
    busy: false,
    error: '',
    gitDiff: null,
    gitGraphOpen: false,
    mergeFile: null,
    prView: null,
    folderScope: null,
    renamingPath: null,
  });
  unregisterFlusher(PANE);
  if (flush) registerFlusher(PANE, flush);
}

afterEach(() => {
  unregisterFlusher(PANE);
  vi.restoreAllMocks();
});

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

  it('read-only overlays do not open into a workspace that changed during flush', async () => {
    const cases = [
      {
        open: () => store.getState().openGitDiff('b.md', false),
        assertClosed: () => expect(store.getState().gitDiff).toBe(null),
      },
      {
        open: () => store.getState().openCommitDiff('b.md', 'abc123'),
        assertClosed: () => expect(store.getState().gitDiff).toBe(null),
      },
      {
        open: () => store.getState().openGitGraph(),
        assertClosed: () => expect(store.getState().gitGraphOpen).toBe(false),
      },
      {
        open: () => store.getState().openMerge('b.md'),
        assertClosed: () => expect(store.getState().mergeFile).toBe(null),
      },
      {
        open: () =>
          store.getState().openPr({
            number: 1,
            title: 'Ship',
            remoteUrl: 'https://github.com/acme/repo.git',
            url: 'https://github.com/acme/repo/pull/1',
          }),
        assertClosed: () => expect(store.getState().prView).toBe(null),
      },
    ];

    for (const testCase of cases) {
      const gate = deferred<boolean>();
      setupOpenFile(() => gate.promise);
      testCase.open();
      store.setState({ current: 'other' });
      gate.resolve(true);
      await tick();
      testCase.assertClosed();
    }
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

  it('createNote does not open a relative path in a new workspace after write returns', async () => {
    setupOpenFile(async () => true);
    vi.spyOn(textFileService, 'read').mockRejectedValue(new Error('[PATH_NOT_FOUND] missing'));
    vi.spyOn(textFileService, 'write').mockImplementation(async (path) => {
      store.setState({ current: 'other' });
      return { path, bytes: 0 };
    });

    await store.getState().createNote('fresh-note.md');

    expect(store.getState().openFile).toBe('a.md');
    expect(store.getState().error).toBe('');
  });

  it('deleteEntry does not restore an old open file after the workspace changes on failure', async () => {
    setupOpenFile(async () => true);
    vi.spyOn(workspaceFileOperationService, 'deleteEntry').mockImplementation(async () => {
      store.setState({ current: 'other' });
      throw new Error('trash failed');
    });

    await store.getState().deleteEntry('a.md', 'file');

    expect(store.getState().openFile).toBe(null);
    expect(store.getState().error).toBe('');
  });

  it('setFolderScope does not apply an old scope after the workspace changes during flush', async () => {
    const gate = deferred<boolean>();
    setupOpenFile(() => gate.promise);
    const pending = store.getState().setFolderScope('docs');
    store.setState({ current: 'other' });
    gate.resolve(true);
    await pending;
    expect(store.getState().folderScope).toBe(null);
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
