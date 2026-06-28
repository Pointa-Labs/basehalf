import { describe, expect, it, vi } from 'vitest';
import {
  AUTHENTICATION_IPC_CHANNELS,
  type AuthenticationProviderSessionsChangeEvent,
  type AuthenticationSession,
  asAuthenticationProviderSessionsChangeEvent,
} from '../src/workbench/services/authentication/common/authentication.js';
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

const session = (accessToken: string): AuthenticationSession => ({
  id: 'github',
  accessToken,
  providerId: 'github',
  account: { id: 'ada', label: 'ada' },
  scopes: ['repo'],
});

describe('AuthenticationMainChannel', () => {
  it('parses provider session events into VS Code authentication session objects', () => {
    const parsed = asAuthenticationProviderSessionsChangeEvent({
      providerId: 'github',
      label: 'GitHub',
      event: {
        added: [
          {
            id: 'github',
            providerId: 'github',
            account: { id: 'ada', label: 'ada' },
            scopes: ['repo'],
            accessToken: 'tok',
          },
        ],
        removed: [],
        changed: [],
      },
    });

    expect(parsed).toEqual({
      providerId: 'github',
      label: 'GitHub',
      event: {
        added: [
          {
            id: 'github',
            accessToken: 'tok',
            providerId: 'github',
            account: { id: 'ada', label: 'ada' },
            scopes: ['repo'],
          },
        ],
        removed: [],
        changed: [],
      },
    });
    expect(parsed?.event.added?.[0]?.accessToken).toBe('tok');
  });

  it('registers session IPC handlers and forwards provider session changes', async () => {
    const ipc = fakeIpc();
    let sessionListener: ((event: AuthenticationProviderSessionsChangeEvent) => void) | null = null;
    const service = {
      getSessions: vi.fn(async () => [session('stored-token')]),
      createSession: vi.fn(async () => session('new-token')),
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
    ).resolves.toEqual([session('')]);
    await expect(
      ipc.handlers.get(AUTHENTICATION_IPC_CHANNELS.createSession)?.(
        {},
        {
          providerId: 'github',
          secret: 'tok',
        },
      ),
    ).resolves.toEqual(session(''));
    await ipc.handlers.get(AUTHENTICATION_IPC_CHANNELS.removeSession)?.(
      {},
      {
        providerId: 'github',
        sessionId: 'github',
      },
    );
    const changeEvent = {
      providerId: 'github',
      label: 'GitHub',
      event: {
        added: [
          {
            id: 'github',
            accessToken: 'event-token',
            providerId: 'github',
            account: { id: 'ada', label: 'ada' },
            scopes: ['repo'],
          },
        ],
        removed: [],
        changed: [],
      },
    };
    sessionListener?.(changeEvent);

    expect(service.getSessions).toHaveBeenCalledWith('github', undefined);
    expect(service.createSession).toHaveBeenCalledWith('github', 'tok', undefined);
    expect(service.removeSession).toHaveBeenCalledWith('github', 'github');
    expect(electronMock.sent).toEqual([
      {
        channel: AUTHENTICATION_IPC_CHANNELS.sessionsChanged,
        event: {
          providerId: 'github',
          label: 'GitHub',
          event: { added: [session('')], removed: [], changed: [] },
        },
      },
    ]);
  });

  it('passes VS Code-style scopes through authentication IPC payloads', async () => {
    const ipc = fakeIpc();
    const service = {
      getSessions: vi.fn(async () => []),
      createSession: vi.fn(async () => null),
      removeSession: vi.fn(async () => undefined),
      onDidChangeSessions: vi.fn(() => () => undefined),
    } as unknown as AuthenticationMainService;
    new AuthenticationMainChannel(service, ipc).register();

    await ipc.handlers.get(AUTHENTICATION_IPC_CHANNELS.getSessions)?.(
      {},
      { providerId: 'github', scopes: ['repo'] },
    );
    await ipc.handlers.get(AUTHENTICATION_IPC_CHANNELS.createSession)?.(
      {},
      { providerId: 'github', secret: 'tok', scopes: ['repo'] },
    );

    expect(service.getSessions).toHaveBeenCalledWith('github', ['repo']);
    expect(service.createSession).toHaveBeenCalledWith('github', 'tok', ['repo']);
  });
});
