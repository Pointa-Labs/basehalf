import { describe, expect, it, vi } from 'vitest';
import { ADHD_IPC_CHANNELS } from '../src/workbench/services/mirror/common/adhd.js';
import { AdhdMainChannel } from '../src/workbench/services/mirror/electron-main/adhdMainChannel.js';
import type { AdhdMainService } from '../src/workbench/services/mirror/electron-main/adhdMainService.js';

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

describe('AdhdMainChannel', () => {
  it('registers ADHD IPC handlers around the ADHD service', async () => {
    const ipc = fakeIpc();
    const event = { sender: {} };
    const state = { path: 'a.md', kind: 'file' as const, highlight_keywords: ['term'] };
    const adhd = {
      get: vi.fn(async () => state),
      set: vi.fn(async () => state),
      addKeyword: vi.fn(async () => state),
      removeKeyword: vi.fn(async () => null),
      markRead: vi.fn(async () => state),
      markUnread: vi.fn(async () => null),
      revision: vi.fn(async () => ({ count: 1, maxMtimeMs: 2 })),
      relocate: vi.fn(async () => ({ moved: 1 })),
      purgeNode: vi.fn(async () => ({ removed: 1 })),
    } as unknown as AdhdMainService;

    new AdhdMainChannel(adhd, () => '/repo', ipc).register();

    expect([...ipc.handlers.keys()]).toEqual(Object.values(ADHD_IPC_CHANNELS));

    await expect(ipc.handlers.get(ADHD_IPC_CHANNELS.get)?.(event, 'a.md')).resolves.toEqual(state);
    await expect(
      ipc.handlers.get(ADHD_IPC_CHANNELS.set)?.(event, { file: 'a.md' }),
    ).resolves.toEqual(state);
    await expect(
      ipc.handlers.get(ADHD_IPC_CHANNELS.addKeyword)?.(event, { file: 'a.md', keyword: 'term' }),
    ).resolves.toEqual(state);
    await expect(
      ipc.handlers.get(ADHD_IPC_CHANNELS.removeKeyword)?.(event, { file: 'a.md', keyword: 'term' }),
    ).resolves.toBeNull();
    await expect(
      ipc.handlers.get(ADHD_IPC_CHANNELS.markRead)?.(event, { file: 'a.md', start: 1, end: 3 }),
    ).resolves.toEqual(state);
    await expect(
      ipc.handlers.get(ADHD_IPC_CHANNELS.markUnread)?.(event, { file: 'a.md', start: 2, end: 2 }),
    ).resolves.toBeNull();
    await expect(ipc.handlers.get(ADHD_IPC_CHANNELS.revision)?.(event)).resolves.toEqual({
      count: 1,
      maxMtimeMs: 2,
    });
    await expect(
      ipc.handlers.get(ADHD_IPC_CHANNELS.relocate)?.(event, { from: 'a.md', to: 'b.md' }),
    ).resolves.toEqual({ moved: 1 });
    await expect(
      ipc.handlers.get(ADHD_IPC_CHANNELS.purgeNode)?.(event, { path: 'b.md' }),
    ).resolves.toEqual({ removed: 1 });

    expect(adhd.get).toHaveBeenCalledWith('/repo', 'a.md');
    expect(adhd.set).toHaveBeenCalledWith('/repo', { file: 'a.md' });
    expect(adhd.addKeyword).toHaveBeenCalledWith('/repo', { file: 'a.md', keyword: 'term' });
    expect(adhd.removeKeyword).toHaveBeenCalledWith('/repo', { file: 'a.md', keyword: 'term' });
    expect(adhd.markRead).toHaveBeenCalledWith('/repo', { file: 'a.md', start: 1, end: 3 });
    expect(adhd.markUnread).toHaveBeenCalledWith('/repo', { file: 'a.md', start: 2, end: 2 });
    expect(adhd.revision).toHaveBeenCalledWith('/repo');
    expect(adhd.relocate).toHaveBeenCalledWith('/repo', { from: 'a.md', to: 'b.md' });
    expect(adhd.purgeNode).toHaveBeenCalledWith('/repo', { path: 'b.md' });
  });

  it('rejects malformed ADHD IPC payloads before service calls', async () => {
    const ipc = fakeIpc();
    const event = { sender: {} };
    const adhd = {
      get: vi.fn(),
      set: vi.fn(),
      addKeyword: vi.fn(),
      removeKeyword: vi.fn(),
      markRead: vi.fn(),
      markUnread: vi.fn(),
      revision: vi.fn(),
      relocate: vi.fn(),
      purgeNode: vi.fn(),
    } as unknown as AdhdMainService;

    new AdhdMainChannel(adhd, () => '/repo', ipc).register();

    await expect(ipc.handlers.get(ADHD_IPC_CHANNELS.get)?.(event, 123)).rejects.toThrow(/string/i);
    await expect(
      ipc.handlers.get(ADHD_IPC_CHANNELS.markRead)?.(event, {
        file: 'a.md',
        start: 4,
        end: 3,
      }),
    ).rejects.toThrow(/greater than or equal/i);
    expect(adhd.get).not.toHaveBeenCalled();
    expect(adhd.markRead).not.toHaveBeenCalled();
  });
});
