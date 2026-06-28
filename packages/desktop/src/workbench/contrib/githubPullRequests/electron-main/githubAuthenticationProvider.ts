import {
  type AuthenticationSession,
  GITHUB_AUTH_PROVIDER_ID,
} from '../../../services/authentication/common/authentication.js';
import type { AuthenticationProvider } from '../../../services/authentication/electron-main/authenticationMainService.js';
import type { GithubMainService } from './githubMainService.js';

const GITHUB_SESSION_ID = 'github';
const GITHUB_SESSION_SCOPES = ['repo'] as const;

export class GithubAuthenticationProvider implements AuthenticationProvider {
  readonly id = GITHUB_AUTH_PROVIDER_ID;
  readonly label = 'GitHub';

  constructor(private readonly github: Pick<GithubMainService, 'viewer' | 'signIn' | 'signOut'>) {}

  async getSessions(): Promise<readonly AuthenticationSession[]> {
    const login = await this.github.viewer();
    return login === null ? [] : [githubSession(login)];
  }

  async createSession(secret: string): Promise<AuthenticationSession | null> {
    const login = await this.github.signIn(secret);
    return login === null ? null : githubSession(login);
  }

  async removeSession(_sessionId: string): Promise<void> {
    await this.github.signOut();
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
