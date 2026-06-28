import type { BaseHalfSandboxApi } from '../../../../code/electron-sandbox/sandboxApi.js';
import { createLazySandboxChannel } from '../../../../platform/ipc/browser/sandboxApi.js';
import type {
  AuthenticationProviderSessionsChangeEvent,
  AuthenticationSession,
} from '../common/authentication.js';
import type { AuthenticationBridge } from '../electron-sandbox/authenticationBridge.js';

export interface AuthenticationService {
  getSessions(providerId: string): Promise<readonly AuthenticationSession[]>;
  createSession(providerId: string, secret: string): Promise<AuthenticationSession | null>;
  removeSession(providerId: string, sessionId: string): Promise<void>;
  onDidChangeSessions(
    listener: (event: AuthenticationProviderSessionsChangeEvent) => void,
  ): () => void;
}

type AuthenticationChannel = AuthenticationBridge['authentication'];

export function createAuthenticationService(channel: AuthenticationChannel): AuthenticationService {
  return {
    getSessions: (providerId) => channel.getSessions(providerId),
    createSession: (providerId, secret) => channel.createSession(providerId, secret),
    removeSession: (providerId, sessionId) => channel.removeSession(providerId, sessionId),
    onDidChangeSessions: (listener) => channel.onDidChangeSessions(listener),
  };
}

export function createAuthenticationChannel(bridge: BaseHalfSandboxApi): AuthenticationChannel {
  return bridge.authentication;
}

export const authenticationService = createAuthenticationService(
  createLazySandboxChannel(createAuthenticationChannel),
);
