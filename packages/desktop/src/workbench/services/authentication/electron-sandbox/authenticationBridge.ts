import type { IpcRendererLike } from '../../../../platform/ipc/electron-sandbox/ipcRenderer.js';
import {
  AUTHENTICATION_IPC_CHANNELS,
  type AuthenticationChannelBridge,
  type AuthenticationProviderSessionsChangeEvent,
  type AuthenticationSession,
  type AuthenticationSessionsChangeEvent,
} from '../common/authentication.js';

export interface AuthenticationBridge {
  readonly authentication: AuthenticationChannelBridge;
}

export function createAuthenticationBridge(ipcRenderer: IpcRendererLike): AuthenticationBridge {
  return {
    authentication: {
      getSessions: (providerId) =>
        ipcRenderer.invoke(AUTHENTICATION_IPC_CHANNELS.getSessions, providerId) as ReturnType<
          AuthenticationChannelBridge['getSessions']
        >,
      createSession: (providerId, secret) =>
        ipcRenderer.invoke(AUTHENTICATION_IPC_CHANNELS.createSession, {
          providerId,
          secret,
        }) as ReturnType<AuthenticationChannelBridge['createSession']>,
      removeSession: (providerId, sessionId) =>
        ipcRenderer.invoke(AUTHENTICATION_IPC_CHANNELS.removeSession, {
          providerId,
          sessionId,
        }) as ReturnType<AuthenticationChannelBridge['removeSession']>,
      onDidChangeSessions: (handler) => {
        const wrapped = (_event: unknown, event: unknown): void => {
          if (isAuthenticationProviderSessionsChangeEvent(event)) handler(event);
        };
        ipcRenderer.on(AUTHENTICATION_IPC_CHANNELS.sessionsChanged, wrapped);
        return () => ipcRenderer.off(AUTHENTICATION_IPC_CHANNELS.sessionsChanged, wrapped);
      },
    },
  };
}

function isAuthenticationProviderSessionsChangeEvent(
  event: unknown,
): event is AuthenticationProviderSessionsChangeEvent {
  if (typeof event !== 'object' || event === null) return false;
  const record = event as Record<string, unknown>;
  if (typeof record.providerId !== 'string') return false;

  // Older tests and preloaded windows may send the former providerId-only event
  // while the main-process session provider migration is in flight.
  if (record.label === undefined && record.event === undefined) return true;

  return typeof record.label === 'string' && isAuthenticationSessionsChangeEvent(record.event);
}

function isAuthenticationSessionsChangeEvent(
  event: unknown,
): event is AuthenticationSessionsChangeEvent {
  if (typeof event !== 'object' || event === null) return false;
  const record = event as Record<string, unknown>;
  return (
    isSessionListOrUndefined(record.added) &&
    isSessionListOrUndefined(record.removed) &&
    isSessionListOrUndefined(record.changed)
  );
}

function isSessionListOrUndefined(
  value: unknown,
): value is readonly AuthenticationSession[] | undefined {
  return value === undefined || (Array.isArray(value) && value.every(isAuthenticationSession));
}

function isAuthenticationSession(value: unknown): value is AuthenticationSession {
  if (typeof value !== 'object' || value === null) return false;
  const session = value as Record<string, unknown>;
  const account = session.account as Record<string, unknown> | undefined;
  return (
    typeof session.id === 'string' &&
    typeof session.providerId === 'string' &&
    typeof account === 'object' &&
    account !== null &&
    typeof account.id === 'string' &&
    typeof account.label === 'string' &&
    Array.isArray(session.scopes) &&
    session.scopes.every((scope) => typeof scope === 'string')
  );
}
