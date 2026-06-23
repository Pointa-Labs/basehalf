import { describe, expect, it } from 'vitest';
import { clearWorkspaceRoot, getWorkspaceRoot, setWorkspaceRoot } from '../src/main/windows.js';

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
