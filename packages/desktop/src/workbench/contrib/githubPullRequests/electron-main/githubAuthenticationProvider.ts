import type { SecretStore } from '../../../../platform/secrets/common/secrets.js';
import {
  type AuthenticationSession,
  type AuthenticationSessionsChangeEvent,
  GITHUB_AUTH_PROVIDER_ID,
} from '../../../services/authentication/common/authentication.js';
import type { AuthenticationProvider } from '../../../services/authentication/electron-main/authenticationMainService.js';
import { GithubApiClient, type GithubHttpRunner, defaultGithubHttp } from './githubApiClient.js';
import { GITHUB_TOKEN_SECRET_KEY } from './githubGitCredentials.js';
import type { GithubTokenProvider } from './githubMainService.js';

const GITHUB_SESSION_ID = 'github';
const GITHUB_SESSION_SCOPES = ['repo'] as const;

export type GithubSecretStore = SecretStore;

export interface GithubAuthenticationProviderOptions {
  readonly secrets: GithubSecretStore;
  readonly http?: GithubHttpRunner;
}

export class GithubAuthenticationProvider implements AuthenticationProvider, GithubTokenProvider {
  readonly id = GITHUB_AUTH_PROVIDER_ID;
  readonly label = 'GitHub';
  private readonly api: GithubApiClient;
  private readonly listeners = new Set<(event: AuthenticationSessionsChangeEvent) => void>();
  private currentSession: AuthenticationSession | null = null;
  private verifiedToken: string | null = null;

  constructor(private readonly opts: GithubAuthenticationProviderOptions) {
    this.api = new GithubApiClient(opts.http ?? defaultGithubHttp);
  }

  onDidChangeSessions(listener: (event: AuthenticationSessionsChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async getSessions(): Promise<readonly AuthenticationSession[]> {
    const login = await this.viewer();
    this.currentSession = login === null ? null : githubSession(login);
    return this.currentSession === null ? [] : [this.currentSession];
  }

  async createSession(secret: string): Promise<AuthenticationSession | null> {
    const previous = this.currentSession;
    const login = await this.signIn(secret);
    if (login === null) return null;
    const session = githubSession(login);
    this.currentSession = session;
    this.fire({
      added: [session],
      removed: previous === null ? [] : [previous],
      changed: [],
    });
    return session;
  }

  async removeSession(sessionId: string): Promise<void> {
    if (sessionId !== GITHUB_SESSION_ID) throw new Error('GitHub session not found.');
    const token = await this.getToken();
    const removed = this.currentSession ?? (token === null ? null : githubSession('github'));
    await this.opts.secrets.delete(GITHUB_TOKEN_SECRET_KEY);
    this.currentSession = null;
    if (removed !== null) {
      this.fire({ added: [], removed: [removed], changed: [] });
    }
  }

  async getToken(): Promise<string | null> {
    const token = await this.storedToken();
    if (token === null) return null;
    if (token === this.verifiedToken) return token;
    try {
      const login = await this.api.loginFor(token);
      if (login === null) {
        await this.clearStoredSession();
        return null;
      }
      this.currentSession = githubSession(login);
      this.verifiedToken = token;
      return token;
    } catch {
      // Git should not be blocked by transient GitHub API failures while the
      // stored token may still work for HTTPS credentials.
      return token;
    }
  }

  private async signIn(token: unknown): Promise<string | null> {
    if (typeof token !== 'string') throw new Error('The GitHub token is invalid.');
    const login = await this.api.loginFor(token);
    if (login === null) {
      throw new Error(
        'The GitHub token is invalid or missing permissions (repo access is required for private repositories and pull request reviews).',
      );
    }
    await this.opts.secrets.set(GITHUB_TOKEN_SECRET_KEY, token);
    this.verifiedToken = token;
    return login;
  }

  private async viewer(): Promise<string | null> {
    const token = await this.storedToken();
    if (token === null) return null;
    const login = await this.api.loginFor(token);
    if (login === null) {
      await this.clearStoredSession();
      return null;
    }
    this.verifiedToken = token;
    return login;
  }

  private async storedToken(): Promise<string | null> {
    return this.opts.secrets.get(GITHUB_TOKEN_SECRET_KEY);
  }

  private async clearStoredSession(): Promise<void> {
    const removed = this.currentSession;
    await this.opts.secrets.delete(GITHUB_TOKEN_SECRET_KEY);
    this.currentSession = null;
    this.verifiedToken = null;
    if (removed !== null) {
      this.fire({ added: [], removed: [removed], changed: [] });
    }
  }

  private fire(event: AuthenticationSessionsChangeEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function githubSession(login: string): AuthenticationSession {
  return {
    id: GITHUB_SESSION_ID,
    providerId: GITHUB_AUTH_PROVIDER_ID,
    account: { id: login, label: login },
    scopes: GITHUB_SESSION_SCOPES,
  };
}
