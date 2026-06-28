import { describe, expect, it, vi } from 'vitest';
import { AUTHENTICATION_IPC_CHANNELS } from '../src/workbench/services/authentication/common/authentication.js';
import { AuthenticationMainChannel } from '../src/workbench/services/authentication/electron-main/authenticationMainChannel.js';
import type { AuthenticationMainService } from '../src/workbench/services/authentication/electron-main/authenticationMainService.js';

const electronMock = vi.hoisted(() => ({
  sent: [] as Array<{ channel: string; event: unknown }>,
  windows: [] as Array<{
    isDestroyed: () => boolean;
    webContents: { send: (channel: string, event: unknown) => void };
  }>,
  BrowserWindow: {
    getAllWindows: vi.fn(() => electronMock.windows),
  },
  ipcMain: { handle: vi.fn() },
}));

vi.mock('electron', () => ({
  BrowserWindow: electronMock.BrowserWindow,
  ipcMain: electronMock.ipcMain,
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

describe('AuthenticationMainChannel', () => {
  it('registers session IPC handlers and forwards provider session changes', async () => {
    const ipc = fakeIpc();
    let sessionListener: ((event: { providerId: string }) => void) | null = null;
    const service = {
      getSessions: vi.fn(async () => []),
      createSession: vi.fn(async () => ({ id: 'github' })),
      removeSession: vi.fn(async () => undefined),
      onDidChangeSessions: vi.fn((listener) => {
        sessionListener = listener;
        return () => undefined;
      }),
    } as unknown as AuthenticationMainService;
    electronMock.sent = [];
    electronMock.windows = [
      {
        isDestroyed: () => false,
        webContents: {
          send: (channel, event) => electronMock.sent.push({ channel, event }),
        },
      },
    ];

    new AuthenticationMainChannel(service, ipc).register();

    await expect(
      ipc.handlers.get(AUTHENTICATION_IPC_CHANNELS.getSessions)?.({}, 'github'),
    ).resolves.toEqual([]);
    await expect(
      ipc.handlers.get(AUTHENTICATION_IPC_CHANNELS.createSession)?.(
        {},
        {
          providerId: 'github',
          secret: 'tok',
        },
      ),
    ).resolves.toEqual({ id: 'github' });
    await ipc.handlers.get(AUTHENTICATION_IPC_CHANNELS.removeSession)?.(
      {},
      {
        providerId: 'github',
        sessionId: 'github',
      },
    );
    sessionListener?.({ providerId: 'github' });

    expect(service.getSessions).toHaveBeenCalledWith('github');
    expect(service.createSession).toHaveBeenCalledWith('github', 'tok');
    expect(service.removeSession).toHaveBeenCalledWith('github', 'github');
    expect(electronMock.sent).toEqual([
      {
        channel: AUTHENTICATION_IPC_CHANNELS.sessionsChanged,
        event: { providerId: 'github' },
      },
    ]);
  });
});
