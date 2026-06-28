import { describe, expect, it, vi } from 'vitest';
import { NATIVE_HOST_IPC_CHANNELS } from '../src/platform/native/common/native.js';
import { NativeHostMainChannel } from '../src/platform/native/electron-main/nativeHostMainChannel.js';
import type { NativeHostMainService } from '../src/platform/native/electron-main/nativeHostMainService.js';

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

describe('NativeHostMainChannel', () => {
  it('registers native host IPC handlers around the native host service', async () => {
    const ipc = fakeIpc();
    const service = {
      pickWorkspace: vi.fn(async () => '/tmp/demo'),
      openPath: vi.fn(async () => ({ ok: true })),
      pathKind: vi.fn(async () => 'file'),
      openExternal: vi.fn(async () => ({ ok: true })),
    } as unknown as NativeHostMainService;
    const getWorkspaceRoot = vi.fn(() => '/ws');
    new NativeHostMainChannel(service, getWorkspaceRoot, ipc).register();

    expect([...ipc.handlers.keys()]).toEqual(Object.values(NATIVE_HOST_IPC_CHANNELS));

    const event = { sender: { id: 7 } };
    await expect(ipc.handlers.get(NATIVE_HOST_IPC_CHANNELS.pickWorkspace)?.(event)).resolves.toBe(
      '/tmp/demo',
    );
    await expect(
      ipc.handlers.get(NATIVE_HOST_IPC_CHANNELS.openPath)?.(event, 'a.md'),
    ).resolves.toEqual({
      ok: true,
    });
    await expect(
      ipc.handlers.get(NATIVE_HOST_IPC_CHANNELS.pathKind)?.(event, '/tmp/a.md'),
    ).resolves.toBe('file');
    await expect(
      ipc.handlers.get(NATIVE_HOST_IPC_CHANNELS.openExternal)?.(event, 'https://github.com/x/y'),
    ).resolves.toEqual({ ok: true });
    expect(service.pickWorkspace).toHaveBeenCalledWith(event.sender);
    expect(getWorkspaceRoot).toHaveBeenCalledWith(event.sender);
    expect(service.openPath).toHaveBeenCalledWith('/ws', 'a.md');
    expect(service.pathKind).toHaveBeenCalledWith('/tmp/a.md');
    expect(service.openExternal).toHaveBeenCalledWith('https://github.com/x/y');
  });
});
