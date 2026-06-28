export interface AuthenticationSessionAccount {
  readonly id: string;
  readonly label: string;
}

export interface AuthenticationSession {
  readonly id: string;
  readonly providerId: string;
  readonly account: AuthenticationSessionAccount;
  readonly scopes: readonly string[];
}

export interface AuthenticationSessionsChangeEvent {
  readonly added?: readonly AuthenticationSession[];
  readonly removed?: readonly AuthenticationSession[];
  readonly changed?: readonly AuthenticationSession[];
}

export interface AuthenticationProviderSessionsChangeEvent {
  readonly providerId: string;
  readonly label: string;
  readonly event: AuthenticationSessionsChangeEvent;
}

export const GITHUB_AUTH_PROVIDER_ID = 'github';

export const AUTHENTICATION_IPC_CHANNELS = {
  getSessions: 'authentication:get-sessions',
  createSession: 'authentication:create-session',
  removeSession: 'authentication:remove-session',
  sessionsChanged: 'authentication:sessions-changed',
} as const;

export type AuthenticationIpcChannel =
  (typeof AUTHENTICATION_IPC_CHANNELS)[keyof typeof AUTHENTICATION_IPC_CHANNELS];

export type AuthenticationDisposable = () => void;

export interface AuthenticationChannelBridge {
  getSessions(providerId: string): Promise<readonly AuthenticationSession[]>;
  createSession(providerId: string, secret: string): Promise<AuthenticationSession | null>;
  removeSession(providerId: string, sessionId: string): Promise<void>;
  onDidChangeSessions(
    listener: (event: AuthenticationProviderSessionsChangeEvent) => void,
  ): AuthenticationDisposable;
}
