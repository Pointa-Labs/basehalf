import { describe, expect, it, vi } from 'vitest';
import { BADGE_IPC_CHANNELS } from '../src/workbench/services/mirror/common/badge.js';
import { BadgeMainChannel } from '../src/workbench/services/mirror/electron-main/badgeMainChannel.js';
import type { BadgeMainService } from '../src/workbench/services/mirror/electron-main/badgeMainService.js';

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

describe('BadgeMainChannel', () => {
  it('registers badge IPC handlers around the badge service', async () => {
    const ipc = fakeIpc();
    const event = { sender: {} };
    const badge = { path: 'a.md', kind: 'file' as const, references: [] };
    const badgeService = {
      get: vi.fn(async () => badge),
      set: vi.fn(async () => badge),
      list: vi.fn(async () => ({ badges: [badge] })),
      delete: vi.fn(async () => ({ deleted: true })),
      addRef: vi.fn(async () => ({ ...badge, references: ['b.md'] })),
      removeRef: vi.fn(async () => badge),
      markOrphan: vi.fn(async () => null),
      pruneDangling: vi.fn(async () => ({ orphaned: ['missing.md'] })),
      revision: vi.fn(async () => ({ count: 1, maxMtimeMs: 2 })),
      rename: vi.fn(async () => ({ badge, updatedRefs: ['ref.md'], focusUpdated: true })),
    } as unknown as BadgeMainService;

    new BadgeMainChannel(badgeService, () => '/repo', ipc).register();

    expect([...ipc.handlers.keys()]).toEqual(Object.values(BADGE_IPC_CHANNELS));

    await expect(
      ipc.handlers.get(BADGE_IPC_CHANNELS.get)?.(event, { file: 'a.md' }),
    ).resolves.toEqual(badge);
    await expect(
      ipc.handlers.get(BADGE_IPC_CHANNELS.set)?.(event, {
        file: 'a.md',
        patch: { description: 'note' },
      }),
    ).resolves.toEqual(badge);
    await expect(
      ipc.handlers.get(BADGE_IPC_CHANNELS.list)?.(event, { query: 'a' }),
    ).resolves.toEqual({
      badges: [badge],
    });
    await expect(
      ipc.handlers.get(BADGE_IPC_CHANNELS.delete)?.(event, { file: 'a.md' }),
    ).resolves.toEqual({
      deleted: true,
    });
    await expect(
      ipc.handlers.get(BADGE_IPC_CHANNELS.addRef)?.(event, { file: 'a.md', to: 'b.md' }),
    ).resolves.toMatchObject({ references: ['b.md'] });
    await expect(
      ipc.handlers.get(BADGE_IPC_CHANNELS.removeRef)?.(event, { file: 'a.md', to: 'b.md' }),
    ).resolves.toEqual(badge);
    await expect(
      ipc.handlers.get(BADGE_IPC_CHANNELS.markOrphan)?.(event, { file: 'a.md' }),
    ).resolves.toBeNull();
    await expect(ipc.handlers.get(BADGE_IPC_CHANNELS.pruneDangling)?.(event)).resolves.toEqual({
      orphaned: ['missing.md'],
    });
    await expect(ipc.handlers.get(BADGE_IPC_CHANNELS.revision)?.(event)).resolves.toEqual({
      count: 1,
      maxMtimeMs: 2,
    });
    await expect(
      ipc.handlers.get(BADGE_IPC_CHANNELS.rename)?.(event, { from: 'a.md', to: 'b.md' }),
    ).resolves.toEqual({ badge, updatedRefs: ['ref.md'], focusUpdated: true });

    expect(badgeService.get).toHaveBeenCalledWith('/repo', { file: 'a.md' });
    expect(badgeService.set).toHaveBeenCalledWith('/repo', {
      file: 'a.md',
      patch: { description: 'note' },
    });
    expect(badgeService.list).toHaveBeenCalledWith('/repo', { query: 'a' });
    expect(badgeService.delete).toHaveBeenCalledWith('/repo', { file: 'a.md' });
    expect(badgeService.addRef).toHaveBeenCalledWith('/repo', { file: 'a.md', to: 'b.md' });
    expect(badgeService.removeRef).toHaveBeenCalledWith('/repo', { file: 'a.md', to: 'b.md' });
    expect(badgeService.markOrphan).toHaveBeenCalledWith('/repo', { file: 'a.md' });
    expect(badgeService.pruneDangling).toHaveBeenCalledWith('/repo');
    expect(badgeService.revision).toHaveBeenCalledWith('/repo');
    expect(badgeService.rename).toHaveBeenCalledWith('/repo', { from: 'a.md', to: 'b.md' });
  });

  it('rejects malformed badge IPC payloads before service calls', async () => {
    const ipc = fakeIpc();
    const event = { sender: {} };
    const badgeService = {
      get: vi.fn(),
      set: vi.fn(),
      list: vi.fn(),
      delete: vi.fn(),
      addRef: vi.fn(),
      removeRef: vi.fn(),
      markOrphan: vi.fn(),
      pruneDangling: vi.fn(),
      revision: vi.fn(),
      rename: vi.fn(),
    } as unknown as BadgeMainService;

    new BadgeMainChannel(badgeService, () => '/repo', ipc).register();

    await expect(
      ipc.handlers.get(BADGE_IPC_CHANNELS.set)?.(event, {
        file: 'a.md',
        patch: { description: 42 },
      }),
    ).rejects.toThrow(/description.*string/i);
    await expect(
      ipc.handlers.get(BADGE_IPC_CHANNELS.addRef)?.(event, {
        file: 'a.md',
        to: '../b.md',
      }),
    ).rejects.toThrow(/traversal/i);
    expect(badgeService.set).not.toHaveBeenCalled();
    expect(badgeService.addRef).not.toHaveBeenCalled();
  });
});
