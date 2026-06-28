import type {
  AuthenticationSession,
  AuthenticationProviderSessionsChangeEvent,
  AuthenticationSessionsChangeEvent,
} from '../common/authentication.js';

export interface AuthenticationProvider {
  readonly id: string;
  readonly label: string;
  readonly supportsMultipleAccounts?: boolean;
  onDidChangeSessions?(listener: (event: AuthenticationSessionsChangeEvent) => void): () => void;
  getSessions(): Promise<readonly AuthenticationSession[]>;
  createSession(secret: string): Promise<AuthenticationSession | null>;
  removeSession(sessionId: string): Promise<void>;
}

interface RegisteredAuthenticationProvider {
  readonly provider: AuthenticationProvider;
  readonly disposeSessionListener?: () => void;
}

type AuthenticationListener = (event: AuthenticationProviderSessionsChangeEvent) => void;

/**
 * Main-process authentication registry, matching VS Code's provider/session
 * ownership boundary: features consume sessions through provider IDs instead
 * of depending directly on a product-specific token store.
 */
export class AuthenticationMainService {
  private readonly providers = new Map<string, RegisteredAuthenticationProvider>();
  private readonly listeners = new Set<AuthenticationListener>();

  registerProvider(provider: AuthenticationProvider): () => void {
    this.providers.get(provider.id)?.disposeSessionListener?.();
    const registered: RegisteredAuthenticationProvider = {
      provider,
      disposeSessionListener: provider.onDidChangeSessions?.((event) => {
        this.fire({
          providerId: provider.id,
          label: provider.label,
          event,
        });
      }),
    };
    this.providers.set(provider.id, registered);
    return () => {
      if (this.providers.get(provider.id) === registered) {
        this.providers.delete(provider.id);
        registered.disposeSessionListener?.();
      }
    };
  }

  onDidChangeSessions(listener: AuthenticationListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getProviderIds(): readonly string[] {
    return [...this.providers.keys()];
  }

  async getSessions(providerId: string): Promise<readonly AuthenticationSession[]> {
    return this.provider(providerId).getSessions();
  }

  async createSession(providerId: string, secret: string): Promise<AuthenticationSession | null> {
    const provider = this.provider(providerId);
    const before = provider.onDidChangeSessions === undefined ? await provider.getSessions() : [];
    const session = await provider.createSession(secret);
    if (provider.onDidChangeSessions === undefined && session !== null) {
      this.fireLegacyProviderChange(provider, sessionChangeEvent(before, upsertSession(before, session)));
    }
    return session;
  }

  async removeSession(providerId: string, sessionId: string): Promise<void> {
    const provider = this.provider(providerId);
    const before = provider.onDidChangeSessions === undefined ? await provider.getSessions() : [];
    await provider.removeSession(sessionId);
    if (provider.onDidChangeSessions === undefined) {
      const after = before.filter((session) => session.id !== sessionId);
      this.fireLegacyProviderChange(provider, sessionChangeEvent(before, after));
    }
  }

  private provider(providerId: string): AuthenticationProvider {
    const registered = this.providers.get(providerId);
    if (registered === undefined) throw new Error(`Authentication provider not found: ${providerId}`);
    return registered.provider;
  }

  private fireLegacyProviderChange(
    provider: AuthenticationProvider,
    event: AuthenticationSessionsChangeEvent | null,
  ): void {
    if (event === null) return;
    this.fire({
      providerId: provider.id,
      label: provider.label,
      event,
    });
  }

  private fire(event: AuthenticationProviderSessionsChangeEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function upsertSession(
  sessions: readonly AuthenticationSession[],
  next: AuthenticationSession,
): readonly AuthenticationSession[] {
  let replaced = false;
  const updated = sessions.map((session) => {
    if (session.id !== next.id) return session;
    replaced = true;
    return next;
  });
  return replaced ? updated : [...sessions, next];
}

function sessionChangeEvent(
  before: readonly AuthenticationSession[],
  after: readonly AuthenticationSession[],
): AuthenticationSessionsChangeEvent | null {
  const beforeById = new Map(before.map((session) => [session.id, session]));
  const afterById = new Map(after.map((session) => [session.id, session]));
  const added = after.filter((session) => !beforeById.has(session.id));
  const removed = before.filter((session) => !afterById.has(session.id));
  const changed = after.filter((session) => {
    const previous = beforeById.get(session.id);
    return previous !== undefined && !sameSession(previous, session);
  });
  if (added.length === 0 && removed.length === 0 && changed.length === 0) return null;
  return { added, removed, changed };
}

function sameSession(a: AuthenticationSession, b: AuthenticationSession): boolean {
  return (
    a.id === b.id &&
    a.providerId === b.providerId &&
    a.account.id === b.account.id &&
    a.account.label === b.account.label &&
    sameStringList(a.scopes, b.scopes)
  );
}

function sameStringList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
