import type { BaseHalfSandboxApi } from '../../../../code/electron-sandbox/sandboxApi.js';
import { createLazySandboxChannel } from '../../../../platform/ipc/browser/sandboxApi.js';
import type {
  AuthenticationChannelBridge,
  AuthenticationService as AuthenticationServiceContract,
} from '../common/authentication.js';

export type { AuthenticationService } from '../common/authentication.js';

export function createAuthenticationService(
  channel: AuthenticationChannelBridge,
): AuthenticationServiceContract {
  return {
    getSessions: (providerId) => channel.getSessions(providerId),
    createSession: (providerId, secret) => channel.createSession(providerId, secret),
    removeSession: (providerId, sessionId) => channel.removeSession(providerId, sessionId),
    onDidChangeSessions: (listener) => channel.onDidChangeSessions(listener),
  };
}

export function createAuthenticationChannel(
  bridge: BaseHalfSandboxApi,
): AuthenticationChannelBridge {
  return bridge.authentication;
}

export const authenticationService = createAuthenticationService(
  createLazySandboxChannel(createAuthenticationChannel),
);
