import { describe, expect, it, vi } from 'vitest';
import { UPDATE_IPC_CHANNELS, type UpdateState } from '../src/platform/update/common/update.js';
import { UpdateMainChannel } from '../src/platform/update/electron-main/updateMainChannel.js';

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

describe('UpdateMainChannel', () => {
  it('registers update IPC handlers around the update service', async () => {
    const ipc = fakeIpc();
    const state: UpdateState = { phase: 'available', version: '1.2.3' };
    const updater = {
      getState: vi.fn(() => state),
      check: vi.fn(async () => undefined),
      download: vi.fn(async () => undefined),
      install: vi.fn(async () => undefined),
      consumeJustInstalled: vi.fn(() => ({ version: '1.2.3', notes: 'Done' })),
    };

    new UpdateMainChannel(updater, ipc).register();

    expect([...ipc.handlers.keys()]).toEqual([
      UPDATE_IPC_CHANNELS.getState,
      UPDATE_IPC_CHANNELS.check,
      UPDATE_IPC_CHANNELS.download,
      UPDATE_IPC_CHANNELS.install,
      UPDATE_IPC_CHANNELS.justInstalled,
    ]);
    expect(ipc.handlers.get(UPDATE_IPC_CHANNELS.getState)?.()).toBe(state);
    await ipc.handlers.get(UPDATE_IPC_CHANNELS.check)?.();
    await ipc.handlers.get(UPDATE_IPC_CHANNELS.download)?.();
    await ipc.handlers.get(UPDATE_IPC_CHANNELS.install)?.();
    expect(ipc.handlers.get(UPDATE_IPC_CHANNELS.justInstalled)?.()).toEqual({
      version: '1.2.3',
      notes: 'Done',
    });

    expect(updater.check).toHaveBeenCalledWith({ background: false });
    expect(updater.download).toHaveBeenCalledTimes(1);
    expect(updater.install).toHaveBeenCalledTimes(1);
  });
});
