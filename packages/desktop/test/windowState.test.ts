import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  WELCOME_KEY,
  geometryFor,
  readWindowStates,
  saveWindowState,
  saveWindowStateSync,
} from '../src/main/window-state.js';

// The per-workspace window-state map — main's persistence of "which workspace's
// window had what geometry, and which were open at quit". Phase 2 makes this a
// keyed map (was a single record) so N windows (Phase 3) restore independently.
// Pure node fs + path, no Electron runtime, so we drive it against a real tmpdir.

const FILE = 'window-state.json';
const geom = (over: Partial<{ width: number; height: number; x: number; y: number }> = {}) => ({
  width: 1000,
  height: 700,
  ...over,
});

describe('window-state per-workspace map', () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'bh-winstate-'));
  });
  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it('a missing file reads as the empty map', async () => {
    const file = await readWindowStates(configDir);
    expect(file).toEqual({ version: 1, windows: {}, open: [] });
  });

  it('geometryFor returns defaults for an unknown key', async () => {
    const file = await readWindowStates(configDir);
    expect(geometryFor(file, '/never/sized')).toEqual({ width: 800, height: 600 });
  });

  it('saves a window under its workspace key (geometry only; sync writers own `open`)', async () => {
    await saveWindowState(configDir, '/ws/a', geom({ x: 10, y: 20 }));
    const file = await readWindowStates(configDir);
    expect(file.windows['/ws/a']).toEqual({ width: 1000, height: 700, x: 10, y: 20 });
    // A geometry write does NOT touch the session set — that's the close/quit writers'.
    expect(file.open).toEqual([]);
  });

  it('a second workspace gets its own slot without clobbering the first', async () => {
    await saveWindowState(configDir, '/ws/a', geom({ x: 1 }));
    await saveWindowState(configDir, '/ws/b', geom({ x: 2 }));
    const file = await readWindowStates(configDir);
    expect(file.windows['/ws/a']).toMatchObject({ x: 1 });
    expect(file.windows['/ws/b']).toMatchObject({ x: 2 });
  });

  it('a geometry write does not clobber the `open` set a sync (close/quit) write owns', async () => {
    // The fix for the sync-vs-async race: after a window-close sync write records
    // open=['/ws/b'] (A deliberately closed), a still-pending geometry debounce for
    // B must NOT rewrite open back to include A and resurrect it next launch.
    saveWindowStateSync(configDir, '/ws/b', geom({ x: 2 }), ['/ws/b']);
    await saveWindowState(configDir, '/ws/b', geom({ x: 3 }));
    const file = await readWindowStates(configDir);
    expect(file.open).toEqual(['/ws/b']); // preserved, not resurrected
    expect(file.windows['/ws/b']).toMatchObject({ x: 3 }); // geometry still updated
  });

  it('serializes concurrent async saves so neither slot is lost', async () => {
    // Fire both without awaiting between them — the write chain must merge both.
    await Promise.all([
      saveWindowState(configDir, '/ws/a', geom({ x: 1 })),
      saveWindowState(configDir, '/ws/b', geom({ x: 2 })),
    ]);
    const file = await readWindowStates(configDir);
    expect(file.windows['/ws/a']).toMatchObject({ x: 1 });
    expect(file.windows['/ws/b']).toMatchObject({ x: 2 });
  });

  it('a failed save does not poison later saves (the chain recovers)', async () => {
    // Force the first save to fail: aim it at a configDir that can't be created —
    // a path UNDER a regular file → ENOTDIR on mkdir. The write chain is module-
    // global, so this rejection must not disable a subsequent good save.
    const fileAsDir = join(configDir, 'not-a-dir');
    await writeFile(fileAsDir, 'x');
    await expect(saveWindowState(join(fileAsDir, 'sub'), '/ws/a', geom())).rejects.toBeTruthy();
    // The later save to a GOOD dir still runs despite the chain having just rejected.
    await saveWindowState(configDir, '/ws/b', geom({ x: 9 }));
    const file = await readWindowStates(configDir);
    expect(file.windows['/ws/b']).toMatchObject({ x: 9 });
  });

  it('drops a non-finite size (Infinity serializes to null in JSON) on read', async () => {
    // JSON.stringify(Infinity) → null; Number.isFinite(null) is false → slot dropped.
    await writeFile(
      join(configDir, FILE),
      JSON.stringify({ version: 1, windows: { '/ws/a': { width: null, height: 700 } }, open: [] }),
    );
    const file = await readWindowStates(configDir);
    expect(file.windows['/ws/a']).toBeUndefined();
  });

  it('the welcome window stores under the empty-string sentinel key', async () => {
    await saveWindowState(configDir, WELCOME_KEY, geom());
    const file = await readWindowStates(configDir);
    expect(file.windows[WELCOME_KEY]).toBeDefined();
  });

  it('the sync save preserves OTHER workspaces’ remembered slots', async () => {
    await saveWindowState(configDir, '/ws/a', geom({ x: 1 }));
    // Quit-time sync write for window B must not drop A's remembered geometry.
    saveWindowStateSync(configDir, '/ws/b', geom({ x: 2 }), ['/ws/b']);
    const file = await readWindowStates(configDir);
    expect(file.windows['/ws/a']).toMatchObject({ x: 1 });
    expect(file.windows['/ws/b']).toMatchObject({ x: 2 });
    expect(file.open).toEqual(['/ws/b']);
  });

  it('drops NaN / non-finite geometry on read (corruption tolerance)', async () => {
    await writeFile(
      join(configDir, FILE),
      JSON.stringify({ version: 1, windows: { '/ws/a': { width: 'x', height: 700 } }, open: [] }),
    );
    const file = await readWindowStates(configDir);
    // The bad slot is dropped; geometryFor falls back to defaults.
    expect(file.windows['/ws/a']).toBeUndefined();
    expect(geometryFor(file, '/ws/a')).toEqual({ width: 800, height: 600 });
  });
});

describe('window-state migration from the old single-record format', () => {
  let configDir: string;
  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'bh-winstate-mig-'));
  });
  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it('migrates an old record WITH a workspaceRoot into a keyed map + open list', async () => {
    // The shape a pre-Phase-2 build wrote: geometry fields + an inline workspaceRoot.
    await writeFile(
      join(configDir, 'window-state.json'),
      JSON.stringify({
        width: 1200,
        height: 800,
        x: 5,
        y: 6,
        zoomLevel: 2,
        workspaceRoot: '/old/ws',
      }),
    );
    const file = await readWindowStates(configDir);
    expect(file.windows['/old/ws']).toEqual({
      width: 1200,
      height: 800,
      x: 5,
      y: 6,
      zoomLevel: 2,
    });
    // The migrated workspace is treated as the one open at quit (so launch reopens it).
    expect(file.open).toEqual(['/old/ws']);
  });

  it('migrates an old record WITHOUT a workspaceRoot under the welcome key', async () => {
    await writeFile(
      join(configDir, 'window-state.json'),
      JSON.stringify({ width: 900, height: 650 }),
    );
    const file = await readWindowStates(configDir);
    expect(file.windows[WELCOME_KEY]).toMatchObject({ width: 900, height: 650 });
    expect(file.open).toEqual([WELCOME_KEY]);
  });
});
