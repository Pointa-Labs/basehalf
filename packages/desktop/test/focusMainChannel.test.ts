import { describe, expect, it, vi } from 'vitest';
import { FOCUS_IPC_CHANNELS } from '../src/workbench/services/mirror/common/focus.js';
import { FocusMainChannel } from '../src/workbench/services/mirror/electron-main/focusMainChannel.js';
import type { FocusMainService } from '../src/workbench/services/mirror/electron-main/focusMainService.js';

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

describe('FocusMainChannel', () => {
  it('registers focus IPC handlers around the focus service', async () => {
    const ipc = fakeIpc();
    const event = { sender: {} };
    const node = { path: 'docs', kind: 'folder' as const };
    const focus = {
      set: vi.fn(async () => node),
      get: vi.fn(async () => node),
      clear: vi.fn(async () => ({ cleared: true })),
      pruneDangling: vi.fn(async () => ({ cleared: true })),
      relocate: vi.fn(async () => ({ moved: 1, repointed: true })),
      purgeNode: vi.fn(async () => ({ removed: 1, cleared: false })),
    } as unknown as FocusMainService;

    new FocusMainChannel(focus, () => '/repo', ipc).register();

    expect([...ipc.handlers.keys()]).toEqual(Object.values(FOCUS_IPC_CHANNELS));
    await expect(ipc.handlers.get(FOCUS_IPC_CHANNELS.set)?.(event, node)).resolves.toEqual(node);
    await expect(ipc.handlers.get(FOCUS_IPC_CHANNELS.get)?.(event)).resolves.toEqual(node);
    await expect(ipc.handlers.get(FOCUS_IPC_CHANNELS.clear)?.(event)).resolves.toEqual({
      cleared: true,
    });
    await expect(ipc.handlers.get(FOCUS_IPC_CHANNELS.pruneDangling)?.(event)).resolves.toEqual({
      cleared: true,
    });
    await expect(
      ipc.handlers.get(FOCUS_IPC_CHANNELS.relocate)?.(event, { from: 'a.md', to: 'b.md' }),
    ).resolves.toEqual({ moved: 1, repointed: true });
    await expect(
      ipc.handlers.get(FOCUS_IPC_CHANNELS.purgeNode)?.(event, { path: 'b.md' }),
    ).resolves.toEqual({ removed: 1, cleared: false });

    expect(focus.set).toHaveBeenCalledWith('/repo', node);
    expect(focus.get).toHaveBeenCalledWith('/repo');
    expect(focus.clear).toHaveBeenCalledWith('/repo');
    expect(focus.pruneDangling).toHaveBeenCalledWith('/repo');
    expect(focus.relocate).toHaveBeenCalledWith('/repo', { from: 'a.md', to: 'b.md' });
    expect(focus.purgeNode).toHaveBeenCalledWith('/repo', { path: 'b.md' });
  });

  it('rejects malformed focus IPC payloads before service calls', async () => {
    const ipc = fakeIpc();
    const event = { sender: {} };
    const focus = {
      set: vi.fn(),
      get: vi.fn(),
      clear: vi.fn(),
      pruneDangling: vi.fn(),
      relocate: vi.fn(),
      purgeNode: vi.fn(),
    } as unknown as FocusMainService;

    new FocusMainChannel(focus, () => '/repo', ipc).register();

    await expect(
      ipc.handlers.get(FOCUS_IPC_CHANNELS.set)?.(event, {
        path: '../outside.md',
        kind: 'file',
      }),
    ).rejects.toThrow(/traversal/i);
    await expect(
      ipc.handlers.get(FOCUS_IPC_CHANNELS.set)?.(event, {
        path: 'a.md',
        kind: 'file',
        cursor: { line: 0, column: 1 },
      }),
    ).rejects.toThrow(/positive integer/i);
    expect(focus.set).not.toHaveBeenCalled();
  });
});
