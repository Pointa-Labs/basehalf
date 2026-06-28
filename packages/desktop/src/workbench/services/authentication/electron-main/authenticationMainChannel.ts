import { BrowserWindow, ipcMain } from 'electron';
import {
  AUTHENTICATION_IPC_CHANNELS,
  type AuthenticationProviderSessionsChangeEvent,
  type AuthenticationSession,
  type AuthenticationSessionsChangeEvent,
  asAuthenticationCreateSessionPayload,
  asAuthenticationGetSessionsPayload,
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
    this.ipc.handle(AUTHENTICATION_IPC_CHANNELS.getSessions, async (_event, payload) => {
      const p = asAuthenticationGetSessionsPayload(payload);
      return redactSessions(await this.authentication.getSessions(p.providerId, p.scopes));
    });
    this.ipc.handle(AUTHENTICATION_IPC_CHANNELS.createSession, async (_event, payload) => {
      const p = asAuthenticationCreateSessionPayload(payload);
      const session = await this.authentication.createSession(p.providerId, p.secret, p.scopes);
      return session === null ? null : redactSession(session);
    });
    this.ipc.handle(AUTHENTICATION_IPC_CHANNELS.removeSession, (_event, payload) => {
      const p = asAuthenticationRemoveSessionPayload(payload);
      return this.authentication.removeSession(p.providerId, p.sessionId);
    });
    this.authentication.onDidChangeSessions((event) => {
      const redactedEvent = redactProviderSessionsChangeEvent(event);
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(AUTHENTICATION_IPC_CHANNELS.sessionsChanged, redactedEvent);
        }
      }
    });
  }
}

function redactProviderSessionsChangeEvent(
  event: AuthenticationProviderSessionsChangeEvent,
): AuthenticationProviderSessionsChangeEvent {
  return {
    providerId: event.providerId,
    label: event.label,
    event: redactSessionsChangeEvent(event.event),
  };
}

function redactSessionsChangeEvent(
  event: AuthenticationSessionsChangeEvent,
): AuthenticationSessionsChangeEvent {
  const out: {
    added?: readonly AuthenticationSession[];
    removed?: readonly AuthenticationSession[];
    changed?: readonly AuthenticationSession[];
  } = {};
  if (event.added !== undefined) out.added = redactSessions(event.added);
  if (event.removed !== undefined) out.removed = redactSessions(event.removed);
  if (event.changed !== undefined) out.changed = redactSessions(event.changed);
  return out;
}

function redactSessions(
  sessions: readonly AuthenticationSession[],
): readonly AuthenticationSession[] {
  return sessions.map(redactSession);
}

function redactSession(session: AuthenticationSession): AuthenticationSession {
  return { ...session, accessToken: '' };
}
