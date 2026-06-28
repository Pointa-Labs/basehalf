import type {
  AuthenticationSession,
  AuthenticationSessionsChangeEvent,
} from '../common/authentication.js';

export interface AuthenticationProvider {
  readonly id: string;
  readonly label: string;
  getSessions(): Promise<readonly AuthenticationSession[]>;
  createSession(secret: string): Promise<AuthenticationSession | null>;
  removeSession(sessionId: string): Promise<void>;
}

type AuthenticationListener = (event: AuthenticationSessionsChangeEvent) => void;

/**
 * Main-process authentication registry, matching VS Code's provider/session
 * ownership boundary: features consume sessions through provider IDs instead
 * of depending directly on a product-specific token store.
 */
export class AuthenticationMainService {
  private readonly providers = new Map<string, AuthenticationProvider>();
  private readonly listeners = new Set<AuthenticationListener>();

  registerProvider(provider: AuthenticationProvider): void {
    this.providers.set(provider.id, provider);
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
    const session = await this.provider(providerId).createSession(secret);
    this.fire({ providerId });
    return session;
  }

  async removeSession(providerId: string, sessionId: string): Promise<void> {
    await this.provider(providerId).removeSession(sessionId);
    this.fire({ providerId });
  }

  private provider(providerId: string): AuthenticationProvider {
    const provider = this.providers.get(providerId);
    if (provider === undefined) throw new Error(`Authentication provider not found: ${providerId}`);
    return provider;
  }

  private fire(event: AuthenticationSessionsChangeEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
