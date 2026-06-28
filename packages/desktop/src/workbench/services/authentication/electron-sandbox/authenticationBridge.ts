import type { IpcRendererLike } from '../../../../platform/ipc/electron-sandbox/ipcRenderer.js';
import {
  AUTHENTICATION_IPC_CHANNELS,
  type AuthenticationBridge,
  type AuthenticationChannelBridge,
  asAuthenticationProviderSessionsChangeEvent,
} from '../common/authentication.js';

export type { AuthenticationBridge } from '../common/authentication.js';

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
          const change = asAuthenticationProviderSessionsChangeEvent(event);
          if (change !== null) handler(change);
        };
        ipcRenderer.on(AUTHENTICATION_IPC_CHANNELS.sessionsChanged, wrapped);
        return () => ipcRenderer.off(AUTHENTICATION_IPC_CHANNELS.sessionsChanged, wrapped);
      },
    },
  };
}
