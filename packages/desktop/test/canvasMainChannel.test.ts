import { describe, expect, it, vi } from 'vitest';
import { CANVAS_IPC_CHANNELS } from '../src/workbench/services/mirror/common/canvas.js';
import { CanvasMainChannel } from '../src/workbench/services/mirror/electron-main/canvasMainChannel.js';
import type { CanvasMainService } from '../src/workbench/services/mirror/electron-main/canvasMainService.js';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

type Handler = (...args: unknown[]) => unknown;

function fakeIpc(): { handle: ReturnType<typeof vi.fn>; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    }),
  };
}

describe('CanvasMainChannel', () => {
  it('registers canvas IPC handlers around the canvas service', async () => {
    const ipc = fakeIpc();
    const event = { sender: {} };
    const canvas = { path: '', cards: [], edges: [] };
    const card = { path: 'a.md', kind: 'file' as const, x: 1, y: 2, width: 3, height: 4 };
    const canvasService = {
      get: vi.fn(async () => canvas),
      setCard: vi.fn(async () => canvas),
      removeCard: vi.fn(async () => ({ removed: true })),
      setSize: vi.fn(async () => canvas),
      connect: vi.fn(async () => canvas),
      disconnect: vi.fn(async () => canvas),
      reconnect: vi.fn(async () => canvas),
      revision: vi.fn(async () => ({ count: 1, maxMtimeMs: 2 })),
      relocate: vi.fn(async () => ({ moved: 1 })),
      purgeNode: vi.fn(async () => ({ removed: 2 })),
    } as unknown as CanvasMainService;

    new CanvasMainChannel(canvasService, () => '/repo', ipc).register();

    expect([...ipc.handlers.keys()]).toEqual(Object.values(CANVAS_IPC_CHANNELS));

    await expect(
      ipc.handlers.get(CANVAS_IPC_CHANNELS.get)?.(event, { folder: null }),
    ).resolves.toEqual(canvas);
    await expect(
      ipc.handlers.get(CANVAS_IPC_CHANNELS.setCard)?.(event, { folder: null, card }),
    ).resolves.toEqual(canvas);
    await expect(
      ipc.handlers.get(CANVAS_IPC_CHANNELS.removeCard)?.(event, { folder: null, path: 'a.md' }),
    ).resolves.toEqual({ removed: true });
    await expect(
      ipc.handlers.get(CANVAS_IPC_CHANNELS.setSize)?.(event, {
        folder: null,
        size: { width: 100, height: 80 },
      }),
    ).resolves.toEqual(canvas);
    await expect(
      ipc.handlers.get(CANVAS_IPC_CHANNELS.connect)?.(event, {
        folder: null,
        from: 'a.md',
        to: 'b.md',
        from_anchor: 'east',
        to_anchor: 'west',
      }),
    ).resolves.toEqual(canvas);
    await expect(
      ipc.handlers.get(CANVAS_IPC_CHANNELS.disconnect)?.(event, {
        folder: null,
        from: 'a.md',
        to: 'b.md',
      }),
    ).resolves.toEqual(canvas);
    await expect(
      ipc.handlers.get(CANVAS_IPC_CHANNELS.reconnect)?.(event, {
        folder: null,
        previous: { from: 'a.md', to: 'b.md' },
        next: { from: 'a.md', to: 'c.md', from_anchor: 'south', to_anchor: 'north' },
      }),
    ).resolves.toEqual(canvas);
    await expect(ipc.handlers.get(CANVAS_IPC_CHANNELS.revision)?.(event)).resolves.toEqual({
      count: 1,
      maxMtimeMs: 2,
    });
    await expect(
      ipc.handlers.get(CANVAS_IPC_CHANNELS.relocate)?.(event, { from: 'a.md', to: 'b.md' }),
    ).resolves.toEqual({ moved: 1 });
    await expect(
      ipc.handlers.get(CANVAS_IPC_CHANNELS.purgeNode)?.(event, { path: 'b.md' }),
    ).resolves.toEqual({ removed: 2 });

    expect(canvasService.get).toHaveBeenCalledWith('/repo', { folder: null });
    expect(canvasService.setCard).toHaveBeenCalledWith('/repo', { folder: null, card });
    expect(canvasService.removeCard).toHaveBeenCalledWith('/repo', { folder: null, path: 'a.md' });
    expect(canvasService.setSize).toHaveBeenCalledWith('/repo', {
      folder: null,
      size: { width: 100, height: 80 },
    });
    expect(canvasService.connect).toHaveBeenCalledWith('/repo', {
      folder: null,
      from: 'a.md',
      to: 'b.md',
      from_anchor: 'east',
      to_anchor: 'west',
    });
    expect(canvasService.disconnect).toHaveBeenCalledWith('/repo', {
      folder: null,
      from: 'a.md',
      to: 'b.md',
    });
    expect(canvasService.reconnect).toHaveBeenCalledWith('/repo', {
      folder: null,
      previous: { from: 'a.md', to: 'b.md' },
      next: { from: 'a.md', to: 'c.md', from_anchor: 'south', to_anchor: 'north' },
    });
    expect(canvasService.revision).toHaveBeenCalledWith('/repo');
    expect(canvasService.relocate).toHaveBeenCalledWith('/repo', { from: 'a.md', to: 'b.md' });
    expect(canvasService.purgeNode).toHaveBeenCalledWith('/repo', { path: 'b.md' });
  });

  it('rejects malformed canvas IPC payloads before service calls', async () => {
    const ipc = fakeIpc();
    const event = { sender: {} };
    const canvasService = {
      get: vi.fn(),
      setCard: vi.fn(),
      removeCard: vi.fn(),
      setSize: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      reconnect: vi.fn(),
      revision: vi.fn(),
      relocate: vi.fn(),
      purgeNode: vi.fn(),
    } as unknown as CanvasMainService;

    new CanvasMainChannel(canvasService, () => '/repo', ipc).register();

    await expect(
      ipc.handlers.get(CANVAS_IPC_CHANNELS.setCard)?.(event, {
        folder: null,
        card: { path: 'a.md', kind: 'file', x: 1, y: 2, width: 0, height: 4 },
      }),
    ).rejects.toThrow(/positive/i);
    await expect(
      ipc.handlers.get(CANVAS_IPC_CHANNELS.connect)?.(event, {
        folder: null,
        from: 'a.md',
        to: 'b.md',
        from_anchor: 'middle',
        to_anchor: 'west',
      }),
    ).rejects.toThrow(/anchor/i);
    expect(canvasService.setCard).not.toHaveBeenCalled();
    expect(canvasService.connect).not.toHaveBeenCalled();
  });
});
