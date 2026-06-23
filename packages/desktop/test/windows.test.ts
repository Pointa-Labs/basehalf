import { describe, expect, it } from 'vitest';
import {
  type WindowRef,
  clearWorkspaceRoot,
  decideOpen,
  getWorkspaceRoot,
  resolveSessionRoots,
  samePath,
  setWorkspaceRoot,
} from '../src/main/windows.js';

// The window↔workspace binding (main's per-window replacement for core's old
// global current-workspace pointer). Keyed by webContents id; the bh:run handler
// reads it to inject `{ workspaceRoot }` into core.run. We fake a WebContents as
// `{ id }` — the module only ever reads `.id`.
const wc = (id: number) => ({ id }) as never;

describe('window↔workspace binding', () => {
  it('an unbound webContents reads as null (the welcome window)', () => {
    expect(getWorkspaceRoot(wc(901))).toBeNull();
  });

  it('binds and reads back a workspace root per webContents', () => {
    setWorkspaceRoot(wc(902), '/ws/a');
    setWorkspaceRoot(wc(903), '/ws/b');
    expect(getWorkspaceRoot(wc(902))).toBe('/ws/a');
    expect(getWorkspaceRoot(wc(903))).toBe('/ws/b');
  });

  it('rebinds the same webContents (a switch reloads with a new root)', () => {
    setWorkspaceRoot(wc(904), '/ws/old');
    setWorkspaceRoot(wc(904), '/ws/new');
    expect(getWorkspaceRoot(wc(904))).toBe('/ws/new');
  });

  it('binds null for the welcome state', () => {
    setWorkspaceRoot(wc(905), '/ws/x');
    setWorkspaceRoot(wc(905), null);
    expect(getWorkspaceRoot(wc(905))).toBeNull();
  });

  it('clears a binding by id (called on window close)', () => {
    setWorkspaceRoot(wc(906), '/ws/gone');
    clearWorkspaceRoot(906);
    expect(getWorkspaceRoot(wc(906))).toBeNull();
  });
});

describe('samePath (case-insensitive workspace identity)', () => {
  it('matches the same folder regardless of case (macOS is case-insensitive)', () => {
    expect(samePath('/Users/me/Notes', '/users/me/notes')).toBe(true);
  });
  it('distinguishes different folders', () => {
    expect(samePath('/ws/a', '/ws/b')).toBe(false);
  });
  it('null (welcome/unbound) is never the same path as anything', () => {
    expect(samePath(null, '/ws/a')).toBe(false);
    expect(samePath('/ws/a', null)).toBe(false);
    expect(samePath(null, null)).toBe(false);
  });
});

describe('decideOpen (one-window-per-workspace router)', () => {
  const win = (id: number, root: string | null): WindowRef => ({ id, root });

  it('focuses the existing window when the workspace is already open', () => {
    const windows = [win(1, '/ws/a'), win(2, '/ws/b')];
    expect(decideOpen(windows, 2, '/ws/a')).toEqual({ action: 'focus', id: 1 });
  });

  it('focuses case-insensitively (no duplicate window for a re-cased path)', () => {
    expect(decideOpen([win(1, '/ws/A')], 1, '/ws/a')).toEqual({ action: 'focus', id: 1 });
  });

  it('reuses the sender when it is the welcome window (Open Folder from welcome)', () => {
    const windows = [win(7, null)];
    expect(decideOpen(windows, 7, '/ws/new')).toEqual({ action: 'reuse-sender' });
  });

  it('opens a NEW window when the sender already has a different workspace', () => {
    const windows = [win(1, '/ws/a')];
    expect(decideOpen(windows, 1, '/ws/b')).toEqual({ action: 'new-window' });
  });

  it('focuses an existing window even when the sender is welcome (dedup wins over reuse)', () => {
    // A welcome window opening a workspace that's ALREADY open elsewhere focuses
    // the existing one rather than consuming the welcome window for a duplicate.
    const windows = [win(1, '/ws/a'), win(9, null)];
    expect(decideOpen(windows, 9, '/ws/a')).toEqual({ action: 'focus', id: 1 });
  });
});

describe('resolveSessionRoots (launch / dock session restore)', () => {
  it('restores every still-registered open workspace, in order', () => {
    expect(resolveSessionRoots(['/ws/a', '/ws/b'], ['/ws/a', '/ws/b', '/ws/c'])).toEqual([
      '/ws/a',
      '/ws/b',
    ]);
  });

  it('drops a since-removed workspace', () => {
    expect(resolveSessionRoots(['/ws/a', '/ws/gone'], ['/ws/a'])).toEqual(['/ws/a']);
  });

  it('de-duplicates by path (one window per workspace)', () => {
    expect(resolveSessionRoots(['/ws/a', '/WS/A'], ['/ws/a'])).toEqual(['/ws/a']);
  });

  it('skips the welcome sentinel key but yields one welcome window when nothing survives', () => {
    expect(resolveSessionRoots([''], [])).toEqual([null]);
    expect(resolveSessionRoots(['/ws/gone'], ['/ws/a'])).toEqual([null]);
  });

  it('empty session → a single welcome window', () => {
    expect(resolveSessionRoots([], ['/ws/a'])).toEqual([null]);
  });

  it('a lone welcome window alongside workspaces is not restored as its own window', () => {
    expect(resolveSessionRoots(['', '/ws/a'], ['/ws/a'])).toEqual(['/ws/a']);
  });
});
