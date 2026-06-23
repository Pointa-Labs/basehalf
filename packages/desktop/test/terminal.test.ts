import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Per-window terminal isolation. Each pty is OWNED by the window that spawned
// it: its output goes only to that window, and only that window may
// write/resize/kill it — so one window can't reach into another's shell by
// guessing the global, sequential session id. We mock node-pty (no native
// binary) and electron (capture ipc handlers + per-window sends), then drive the
// registered handlers directly.

interface FakePty {
  write: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  onData: (cb: (d: string) => void) => void;
  onExit: (cb: (e: { exitCode: number }) => void) => void;
  emitData: (d: string) => void;
  emitExit: (code: number) => void;
}

const ptys: FakePty[] = [];
function makeFakePty(): FakePty {
  let dataCb: ((d: string) => void) | undefined;
  let exitCb: ((e: { exitCode: number }) => void) | undefined;
  return {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: (cb) => {
      dataCb = cb;
    },
    onExit: (cb) => {
      exitCb = cb;
    },
    emitData: (d) => dataCb?.(d),
    emitExit: (code) => exitCb?.({ exitCode: code }),
  };
}

// Captured ipc handlers/listeners and per-window sends.
const handlers = new Map<string, (...a: unknown[]) => unknown>();
const listeners = new Map<string, (...a: unknown[]) => unknown>();
const sends: Array<{ wcId: number; channel: string; payload: unknown }> = [];

vi.mock('@lydell/node-pty', () => ({
  spawn: vi.fn(() => {
    const p = makeFakePty();
    ptys.push(p);
    return p;
  }),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...a: unknown[]) => unknown) => handlers.set(channel, fn),
    on: (channel: string, fn: (...a: unknown[]) => unknown) => listeners.set(channel, fn),
  },
  webContents: {
    fromId: (id: number) => ({
      id,
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => sends.push({ wcId: id, channel, payload }),
    }),
  },
}));

const { registerTerminalIpc, disposeTerminalsForWindow } = await import('../src/main/terminal.js');

// A fake ipc event whose sender carries the window's webContents id.
const evt = (wcId: number) => ({ sender: { id: wcId } });

async function spawnFor(wcId: number): Promise<string> {
  const handler = handlers.get('terminal:spawn');
  if (!handler) throw new Error('terminal:spawn not registered');
  const { id } = (await handler(evt(wcId), {})) as { id: string };
  return id;
}

describe('per-window terminal isolation', () => {
  beforeEach(() => {
    ptys.length = 0;
    sends.length = 0;
    handlers.clear();
    listeners.clear();
    registerTerminalIpc();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('routes a pty’s output ONLY to the window that spawned it', async () => {
    await spawnFor(1); // ptys[0] owned by window 1
    await spawnFor(2); // ptys[1] owned by window 2
    ptys[0].emitData('from-A');
    ptys[1].emitData('from-B');
    const dataSends = sends.filter((s) => s.channel === 'terminal:data');
    expect(dataSends).toContainEqual({
      wcId: 1,
      channel: 'terminal:data',
      payload: { id: 't1', data: 'from-A' },
    });
    expect(dataSends).toContainEqual({
      wcId: 2,
      channel: 'terminal:data',
      payload: { id: 't2', data: 'from-B' },
    });
    // Crucially, window 1 NEVER receives window 2's output and vice versa.
    const dataOf = (p: unknown): string | undefined => (p as { data?: string }).data;
    expect(dataSends.some((s) => s.wcId === 1 && dataOf(s.payload) === 'from-B')).toBe(false);
    expect(dataSends.some((s) => s.wcId === 2 && dataOf(s.payload) === 'from-A')).toBe(false);
  });

  it('lets a window write to its OWN session', async () => {
    const id = await spawnFor(1);
    listeners.get('terminal:write')?.(evt(1), { id, data: 'ls\n' });
    expect(ptys[0].write).toHaveBeenCalledWith('ls\n');
  });

  it('refuses a write to ANOTHER window’s session (owner guard)', async () => {
    const id = await spawnFor(1); // owned by window 1
    listeners.get('terminal:write')?.(evt(2), { id, data: 'rm -rf /\n' });
    expect(ptys[0].write).not.toHaveBeenCalled();
  });

  it('refuses a kill of another window’s session, but allows its own', async () => {
    const id = await spawnFor(1);
    listeners.get('terminal:kill')?.(evt(2), { id }); // not the owner → ignored
    expect(ptys[0].kill).not.toHaveBeenCalled();
    listeners.get('terminal:kill')?.(evt(1), { id }); // owner → killed
    expect(ptys[0].kill).toHaveBeenCalledTimes(1);
  });

  it('disposeTerminalsForWindow kills only that window’s ptys', async () => {
    await spawnFor(1); // ptys[0]
    await spawnFor(1); // ptys[1]
    await spawnFor(2); // ptys[2]
    disposeTerminalsForWindow(1);
    expect(ptys[0].kill).toHaveBeenCalledTimes(1);
    expect(ptys[1].kill).toHaveBeenCalledTimes(1);
    expect(ptys[2].kill).not.toHaveBeenCalled();
  });

  it('a resize from a non-owner is ignored', async () => {
    const id = await spawnFor(1);
    listeners.get('terminal:resize')?.(evt(2), { id, cols: 10, rows: 10 });
    expect(ptys[0].resize).not.toHaveBeenCalled();
    listeners.get('terminal:resize')?.(evt(1), { id, cols: 10, rows: 10 });
    expect(ptys[0].resize).toHaveBeenCalledTimes(1);
  });
});
