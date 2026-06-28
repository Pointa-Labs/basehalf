import type { SecretStore } from '../../../../platform/secrets/common/secrets.js';
import {
  type AuthenticationSession,
  type AuthenticationSessionsChangeEvent,
  GITHUB_AUTH_PROVIDER_ID,
} from '../../../services/authentication/common/authentication.js';
import type { AuthenticationProvider } from '../../../services/authentication/electron-main/authenticationMainService.js';
import {
  type GithubAccountInfo,
  GithubApiClient,
  type GithubHttpRunner,
  defaultGithubHttp,
} from './githubApiClient.js';
import { GITHUB_TOKEN_SECRET_KEY } from './githubGitCredentials.js';

const GITHUB_SESSION_ID = 'github';
const GITHUB_SESSION_SCOPES = ['repo'] as const;
const GITHUB_SESSIONS_SECRET_KEY = 'github.sessions';

export type GithubSecretStore = SecretStore;

export interface GithubAuthenticationProviderOptions {
  readonly secrets: GithubSecretStore;
  readonly http?: GithubHttpRunner;
}

export class GithubAuthenticationProvider implements AuthenticationProvider {
  readonly id = GITHUB_AUTH_PROVIDER_ID;
  readonly label = 'GitHub';
  readonly supportsMultipleAccounts = false;
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

  async getSessions(scopes?: readonly string[]): Promise<readonly AuthenticationSession[]> {
    const session = await this.viewer();
    this.currentSession = session;
    return this.currentSession === null || !sessionScopesMatch(this.currentSession, scopes)
      ? []
      : [this.currentSession];
  }

  async createSession(
    secret: string,
    scopes: readonly string[] = GITHUB_SESSION_SCOPES,
  ): Promise<AuthenticationSession | null> {
    const previous = this.currentSession;
    const session = await this.signIn(secret, scopes);
    if (session === null) return null;
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
    const removed =
      this.currentSession ??
      (await this.storedSession()) ??
      (token === null ? null : githubSession('github', token));
    await this.clearStoredCredentials();
    this.currentSession = null;
    if (removed !== null) {
      this.fire({ added: [], removed: [removed], changed: [] });
    }
  }

  async getToken(): Promise<string | null> {
    const session = await this.viewer();
    if (session === null) return null;
    const token = session.accessToken;
    try {
      if (token === this.verifiedToken) return token;
      const account = await this.api.accountFor(token);
      if (account === null) {
        await this.clearStoredSession();
        return null;
      }
      this.currentSession = sessionForToken(this.currentSession, account, token, session.scopes);
      this.verifiedToken = token;
      return token;
    } catch {
      // Git should not be blocked by transient GitHub API failures while the
      // stored token may still work for HTTPS credentials.
      return token;
    }
  }

  private async signIn(
    token: unknown,
    scopes: readonly string[],
  ): Promise<AuthenticationSession | null> {
    if (typeof token !== 'string') throw new Error('The GitHub token is invalid.');
    const trimmedToken = token.trim();
    const account = await this.api.accountFor(trimmedToken);
    if (account === null) {
      throw new Error(
        'The GitHub token is invalid or missing permissions (repo access is required for private repositories and pull request reviews).',
      );
    }
    const session = githubSession(account, trimmedToken, scopes);
    await this.storeSession(session);
    this.verifiedToken = trimmedToken;
    return session;
  }

  private async viewer(): Promise<AuthenticationSession | null> {
    const storedSession = await this.storedSession();
    const token = (await this.storedToken()) ?? storedSession?.accessToken ?? null;
    if (token === null) return null;
    if (token === this.verifiedToken && this.currentSession !== null) return this.currentSession;
    try {
      const account = await this.api.accountFor(token);
      if (account === null) {
        await this.clearStoredSession();
        return null;
      }
      this.verifiedToken = token;
      const session = sessionForToken(
        this.currentSession,
        account,
        token,
        storedSession?.accessToken === token ? storedSession.scopes : GITHUB_SESSION_SCOPES,
      );
      await this.storeSession(session);
      return session;
    } catch {
      return this.currentSession?.accessToken === token
        ? this.currentSession
        : storedSession?.accessToken === token
          ? storedSession
          : githubSession('github', token);
    }
  }

  private async storedToken(): Promise<string | null> {
    return this.opts.secrets.get(GITHUB_TOKEN_SECRET_KEY);
  }

  private async storedSession(): Promise<AuthenticationSession | null> {
    const raw = await this.opts.secrets.get(GITHUB_SESSIONS_SECRET_KEY);
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return null;
      for (const item of parsed) {
        const session = toGithubSession(item);
        if (session !== null) return session;
      }
    } catch {
      await this.opts.secrets.delete(GITHUB_SESSIONS_SECRET_KEY);
    }
    return null;
  }

  private async storeSession(session: AuthenticationSession): Promise<void> {
    await Promise.all([
      this.opts.secrets.set(GITHUB_TOKEN_SECRET_KEY, session.accessToken),
      this.opts.secrets.set(GITHUB_SESSIONS_SECRET_KEY, JSON.stringify([session])),
    ]);
  }

  private async clearStoredSession(): Promise<void> {
    const removed = this.currentSession;
    await this.clearStoredCredentials();
    this.currentSession = null;
    this.verifiedToken = null;
    if (removed !== null) {
      this.fire({ added: [], removed: [removed], changed: [] });
    }
  }

  private async clearStoredCredentials(): Promise<void> {
    await Promise.all([
      this.opts.secrets.delete(GITHUB_TOKEN_SECRET_KEY),
      this.opts.secrets.delete(GITHUB_SESSIONS_SECRET_KEY),
    ]);
  }

  private fire(event: AuthenticationSessionsChangeEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function githubSession(
  account: GithubAccountInfo | string,
  token: string,
  scopes: readonly string[] = GITHUB_SESSION_SCOPES,
): AuthenticationSession {
  const accountInfo = typeof account === 'string' ? { id: account, login: account } : account;
  return {
    id: GITHUB_SESSION_ID,
    accessToken: token,
    providerId: GITHUB_AUTH_PROVIDER_ID,
    account: { id: accountInfo.id, label: accountInfo.login },
    scopes: [...scopes],
  };
}

function sessionForToken(
  currentSession: AuthenticationSession | null,
  account: GithubAccountInfo,
  token: string,
  scopes: readonly string[] = GITHUB_SESSION_SCOPES,
): AuthenticationSession {
  return currentSession?.accessToken === token
    ? currentSession
    : githubSession(account, token, scopes);
}

function sessionScopesMatch(session: AuthenticationSession, scopes?: readonly string[]): boolean {
  if (scopes === undefined || scopes.length === 0) return true;
  const requested = [...scopes].sort();
  const actual = [...session.scopes].sort();
  return (
    requested.length === actual.length && requested.every((scope, index) => actual[index] === scope)
  );
}

function toGithubSession(value: unknown): AuthenticationSession | null {
  if (typeof value !== 'object' || value === null) return null;
  const session = value as Record<string, unknown>;
  const account = session.account as Record<string, unknown> | undefined;
  if (
    typeof session.id === 'string' &&
    typeof session.accessToken === 'string' &&
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
      accessToken: session.accessToken,
      providerId: session.providerId,
      account: { id: account.id, label: account.label },
      scopes: [...session.scopes],
    };
  }
  return null;
}
