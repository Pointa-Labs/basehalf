import { BrowserWindow, ipcMain } from 'electron';
import {
  AUTHENTICATION_IPC_CHANNELS,
  asAuthenticationCreateSessionPayload,
  asAuthenticationProviderId,
  asAuthenticationRemoveSessionPayload,
} from '../common/authentication.js';
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
      this.authentication.getSessions(asAuthenticationProviderId(providerId)),
    );
    this.ipc.handle(AUTHENTICATION_IPC_CHANNELS.createSession, (_event, payload) => {
      const p = asAuthenticationCreateSessionPayload(payload);
      return this.authentication.createSession(p.providerId, p.secret);
    });
    this.ipc.handle(AUTHENTICATION_IPC_CHANNELS.removeSession, (_event, payload) => {
      const p = asAuthenticationRemoveSessionPayload(payload);
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
