import { BrowserWindow, ipcMain } from 'electron';
import { AUTHENTICATION_IPC_CHANNELS } from '../common/authentication.js';
import type { AuthenticationMainService } from './authenticationMainService.js';

type AuthenticationIpcHandler = (_event: unknown, payload?: unknown) => unknown;

export interface IpcMainAuthenticationLike {
  handle(channel: string, listener: AuthenticationIpcHandler): void;
}

export class AuthenticationMainChannel {
  constructor(
    private readonly authentication: AuthenticationMainService,
    private readonly ipc: IpcMainAuthenticationLike = ipcMain,
  ) {}

  register(): void {
    this.ipc.handle(AUTHENTICATION_IPC_CHANNELS.getSessions, (_event, providerId) =>
      this.authentication.getSessions(asProviderId(providerId)),
    );
    this.ipc.handle(AUTHENTICATION_IPC_CHANNELS.createSession, (_event, payload) => {
      const p = asCreateSessionPayload(payload);
      return this.authentication.createSession(p.providerId, p.secret);
    });
    this.ipc.handle(AUTHENTICATION_IPC_CHANNELS.removeSession, (_event, payload) => {
      const p = asRemoveSessionPayload(payload);
      return this.authentication.removeSession(p.providerId, p.sessionId);
    });
    this.authentication.onDidChangeSessions((event) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(AUTHENTICATION_IPC_CHANNELS.sessionsChanged, event);
        }
      }
    });
  }
}

function asProviderId(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('Invalid authentication provider.');
  }
  return value;
}

function asCreateSessionPayload(payload: unknown): { providerId: string; secret: string } {
  if (typeof payload !== 'object' || payload === null) throw new Error('Invalid sign-in payload.');
  const p = payload as Record<string, unknown>;
  const providerId = asProviderId(p.providerId);
  if (typeof p.secret !== 'string' || p.secret.trim() === '') throw new Error('Invalid secret.');
  return { providerId, secret: p.secret };
}

function asRemoveSessionPayload(payload: unknown): { providerId: string; sessionId: string } {
  if (typeof payload !== 'object' || payload === null) throw new Error('Invalid sign-out payload.');
  const p = payload as Record<string, unknown>;
  const providerId = asProviderId(p.providerId);
  if (typeof p.sessionId !== 'string' || p.sessionId.trim() === '') {
    throw new Error('Invalid authentication session.');
  }
  return { providerId, sessionId: p.sessionId };
}
