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

export interface AuthenticationService extends AuthenticationChannelBridge {}

export interface AuthenticationBridge {
  readonly authentication: AuthenticationChannelBridge;
}

export interface AuthenticationCreateSessionPayload {
  readonly providerId: string;
  readonly secret: string;
}

export interface AuthenticationRemoveSessionPayload {
  readonly providerId: string;
  readonly sessionId: string;
}

export function asAuthenticationProviderId(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('Invalid authentication provider.');
  }
  return value;
}

export function asAuthenticationCreateSessionPayload(
  payload: unknown,
): AuthenticationCreateSessionPayload {
  if (typeof payload !== 'object' || payload === null) throw new Error('Invalid sign-in payload.');
  const value = payload as Record<string, unknown>;
  const providerId = asAuthenticationProviderId(value.providerId);
  if (typeof value.secret !== 'string' || value.secret.trim() === '') {
    throw new Error('Invalid secret.');
  }
  return { providerId, secret: value.secret };
}

export function asAuthenticationRemoveSessionPayload(
  payload: unknown,
): AuthenticationRemoveSessionPayload {
  if (typeof payload !== 'object' || payload === null) throw new Error('Invalid sign-out payload.');
  const value = payload as Record<string, unknown>;
  const providerId = asAuthenticationProviderId(value.providerId);
  if (typeof value.sessionId !== 'string' || value.sessionId.trim() === '') {
    throw new Error('Invalid authentication session.');
  }
  return { providerId, sessionId: value.sessionId };
}

export function asAuthenticationProviderSessionsChangeEvent(
  event: unknown,
): AuthenticationProviderSessionsChangeEvent | null {
  if (typeof event !== 'object' || event === null) return null;
  const record = event as Record<string, unknown>;
  if (typeof record.providerId !== 'string') return null;

  // Older tests and preloaded windows may send the former providerId-only event
  // while the main-process session provider migration is in flight.
  if (record.label === undefined && record.event === undefined) {
    return { providerId: record.providerId, label: record.providerId, event: {} };
  }

  return typeof record.label === 'string' && isAuthenticationSessionsChangeEvent(record.event)
    ? { providerId: record.providerId, label: record.label, event: record.event }
    : null;
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
