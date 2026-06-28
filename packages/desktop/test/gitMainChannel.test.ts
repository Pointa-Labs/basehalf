import { describe, expect, it, vi } from 'vitest';
import { GIT_IPC_CHANNELS } from '../src/workbench/contrib/scm/common/git.js';
import { GitMainChannel } from '../src/workbench/contrib/scm/electron-main/gitMainChannel.js';
import type { GitMainService } from '../src/workbench/contrib/scm/electron-main/gitMainService.js';

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

describe('GitMainChannel', () => {
  it('registers Git IPC handlers around the main service', async () => {
    const ipc = fakeIpc();
    const service = {
      stage: vi.fn(async () => undefined),
      deleteWorkspaceEntry: vi.fn(async () => undefined),
      commit: vi.fn(async () => undefined),
      reset: vi.fn(async () => undefined),
      show: vi.fn(async () => 'content'),
      status: vi.fn(async () => ({ isRepo: true, files: [] })),
    } as unknown as GitMainService;
    const getWorkspaceRoot = vi.fn(() => '/repo');
    new GitMainChannel(service, getWorkspaceRoot, ipc).register();

    expect(ipc.handlers.has(GIT_IPC_CHANNELS.stage)).toBe(true);
    expect(ipc.handlers.has(GIT_IPC_CHANNELS.commit)).toBe(true);
    expect(ipc.handlers.has(GIT_IPC_CHANNELS.show)).toBe(true);
    expect(ipc.handlers.has(GIT_IPC_CHANNELS.status)).toBe(true);

    const event = { sender: { id: 7 } };
    await ipc.handlers.get(GIT_IPC_CHANNELS.stage)?.(event, ['a.ts']);
    await ipc.handlers.get(GIT_IPC_CHANNELS.deleteWorkspaceEntry)?.(event, {
      path: 'new.md',
      kind: 'file',
    });
    await ipc.handlers.get(GIT_IPC_CHANNELS.commit)?.(event, { message: 'msg', amend: true });
    await ipc.handlers.get(GIT_IPC_CHANNELS.reset)?.(event, { ref: 'HEAD~1', mode: 'soft' });
    await expect(
      ipc.handlers.get(GIT_IPC_CHANNELS.show)?.(event, { ref: 'HEAD', path: 'a.ts' }),
    ).resolves.toBe('content');
    await expect(ipc.handlers.get(GIT_IPC_CHANNELS.status)?.(event)).resolves.toEqual({
      isRepo: true,
      files: [],
    });

    expect(service.stage).toHaveBeenCalledWith('/repo', ['a.ts']);
    expect(service.deleteWorkspaceEntry).toHaveBeenCalledWith('/repo', 'new.md', 'file');
    expect(service.commit).toHaveBeenCalledWith('/repo', 'msg', { amend: true });
    expect(service.reset).toHaveBeenCalledWith('/repo', { ref: 'HEAD~1', mode: 'soft' });
    expect(service.show).toHaveBeenCalledWith('/repo', 'HEAD', 'a.ts');
    expect(service.status).toHaveBeenCalledWith('/repo');
    expect(getWorkspaceRoot).toHaveBeenCalledWith(event.sender);
  });

  it('rejects dangerous delete and reset payloads at the IPC boundary', async () => {
    const ipc = fakeIpc();
    const service = {
      deleteWorkspaceEntry: vi.fn(async () => undefined),
      reset: vi.fn(async () => undefined),
    } as unknown as GitMainService;
    new GitMainChannel(service, () => '/repo', ipc).register();

    const event = { sender: { id: 7 } };
    expect(() =>
      ipc.handlers.get(GIT_IPC_CHANNELS.deleteWorkspaceEntry)?.(event, {
        path: '.',
        kind: 'folder',
      }),
    ).toThrow('Delete path must name an entry inside the workspace.');
    expect(() =>
      ipc.handlers.get(GIT_IPC_CHANNELS.deleteWorkspaceEntry)?.(event, {
        path: 'draft.md',
        kind: 'directory',
      }),
    ).toThrow('Invalid delete kind.');
    expect(() =>
      ipc.handlers.get(GIT_IPC_CHANNELS.reset)?.(event, {
        ref: 'HEAD',
        mode: 'merge',
      }),
    ).toThrow('Invalid reset mode.');

    expect(service.deleteWorkspaceEntry).not.toHaveBeenCalled();
    expect(service.reset).not.toHaveBeenCalled();
  });
});
