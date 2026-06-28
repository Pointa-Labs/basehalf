import type {
  Disposable,
  IpcRendererLike,
} from '../../../../platform/ipc/electron-sandbox/ipcRenderer.js';
import {
  AUTHENTICATION_IPC_CHANNELS,
  type AuthenticationChannelBridge,
  type AuthenticationSessionsChangeEvent,
} from '../common/authentication.js';

export interface AuthenticationBridge {
  readonly authentication: AuthenticationChannelBridge & {
    onDidChangeSessions(handler: (event: AuthenticationSessionsChangeEvent) => void): Disposable;
  };
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
          if (isAuthenticationSessionsChangeEvent(event)) handler(event);
        };
        ipcRenderer.on(AUTHENTICATION_IPC_CHANNELS.sessionsChanged, wrapped);
        return () => ipcRenderer.off(AUTHENTICATION_IPC_CHANNELS.sessionsChanged, wrapped);
      },
    },
  };
}

function isAuthenticationSessionsChangeEvent(
  event: unknown,
): event is AuthenticationSessionsChangeEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    typeof (event as Record<string, unknown>).providerId === 'string'
  );
}
