export interface AuthenticationSessionAccount {
  readonly id: string;
  readonly label: string;
}

export interface PublicAuthenticationSession {
  readonly id: string;
  readonly providerId: string;
  readonly account: AuthenticationSessionAccount;
  readonly scopes: readonly string[];
}

export interface AuthenticationSession extends PublicAuthenticationSession {
  readonly accessToken: string;
}

export interface AuthenticationSessionsChangeEvent<
  TSession extends PublicAuthenticationSession = PublicAuthenticationSession,
> {
  readonly added?: readonly TSession[];
  readonly removed?: readonly TSession[];
  readonly changed?: readonly TSession[];
}

export interface AuthenticationProviderSessionsChangeEvent<
  TSession extends PublicAuthenticationSession = PublicAuthenticationSession,
> {
  readonly providerId: string;
  readonly label: string;
  readonly event: AuthenticationSessionsChangeEvent<TSession>;
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
  getSessions(
    providerId: string,
    scopes?: readonly string[],
  ): Promise<readonly PublicAuthenticationSession[]>;
  createSession(
    providerId: string,
    secret: string,
    scopes?: readonly string[],
  ): Promise<PublicAuthenticationSession | null>;
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
  readonly scopes?: readonly string[];
}

export interface AuthenticationGetSessionsPayload {
  readonly providerId: string;
  readonly scopes?: readonly string[];
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
  const scopes = asOptionalScopes(value.scopes);
  return scopes === undefined
    ? { providerId, secret: value.secret }
    : { providerId, secret: value.secret, scopes };
}

export function asAuthenticationGetSessionsPayload(
  payload: unknown,
): AuthenticationGetSessionsPayload {
  if (typeof payload === 'string') return { providerId: asAuthenticationProviderId(payload) };
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Invalid get sessions payload.');
  }
  const value = payload as Record<string, unknown>;
  const providerId = asAuthenticationProviderId(value.providerId);
  const scopes = asOptionalScopes(value.scopes);
  return scopes === undefined ? { providerId } : { providerId, scopes };
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

function asOptionalScopes(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((scope) => typeof scope === 'string')) {
    throw new Error('Invalid scopes.');
  }
  return [...value];
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

  const changeEvent = toAuthenticationSessionsChangeEvent(record.event);
  return typeof record.label === 'string' && changeEvent !== null
    ? { providerId: record.providerId, label: record.label, event: changeEvent }
    : null;
}

function toAuthenticationSessionsChangeEvent(
  event: unknown,
): AuthenticationSessionsChangeEvent | null {
  if (typeof event !== 'object' || event === null) return null;
  const record = event as Record<string, unknown>;
  const added = toSessionListOrUndefined(record.added);
  const removed = toSessionListOrUndefined(record.removed);
  const changed = toSessionListOrUndefined(record.changed);
  if (added === null || removed === null || changed === null) return null;

  const out: {
    added?: readonly PublicAuthenticationSession[];
    removed?: readonly PublicAuthenticationSession[];
    changed?: readonly PublicAuthenticationSession[];
  } = {};
  if (added !== undefined) out.added = added;
  if (removed !== undefined) out.removed = removed;
  if (changed !== undefined) out.changed = changed;
  return out;
}

function toSessionListOrUndefined(
  value: unknown,
): readonly PublicAuthenticationSession[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  const sessions: PublicAuthenticationSession[] = [];
  for (const item of value) {
    const session = toPublicAuthenticationSession(item);
    if (session === null) return null;
    sessions.push(session);
  }
  return sessions;
}

function toPublicAuthenticationSession(value: unknown): PublicAuthenticationSession | null {
  if (typeof value !== 'object' || value === null) return null;
  const session = value as Record<string, unknown>;
  const account = session.account as Record<string, unknown> | undefined;
  if (
    typeof session.id === 'string' &&
    typeof session.providerId === 'string' &&
    typeof account === 'object' &&
    account !== null &&
    typeof account.id === 'string' &&
    typeof account.label === 'string' &&
    Array.isArray(session.scopes) &&
    session.scopes.every((scope) => typeof scope === 'string')
  ) {
    return {
      id: session.id,
      providerId: session.providerId,
      account: { id: account.id, label: account.label },
      scopes: [...session.scopes],
    };
  }
  return null;
}
