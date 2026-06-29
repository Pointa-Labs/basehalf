import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '../../../../platform/notification/browser/notificationService.js';
import { color, font, radius, space } from '../../../browser/style/design.js';
import { Button } from '../../../browser/ui/primitives/Button.js';
import { authenticationService } from '../../../services/authentication/browser/authenticationService.js';
import {
  GITHUB_AUTH_PROVIDER_ID,
  type PublicAuthenticationSession,
} from '../../../services/authentication/common/authentication.js';
import { githubErrorMessage } from '../../githubPullRequests/browser/githubPullRequestService.js';
import { sectionLabelStyle } from './primitives.js';

const githubAccountErrorMessage = (err: unknown): string => {
  const message = githubErrorMessage(err);
  if (
    message.includes('needs repo read access') ||
    message.includes('invalid or missing permissions')
  ) {
    return 'The GitHub token could not be verified. Check that it is valid and can access the repositories you want to use.';
  }
  return message;
};

/**
 * The GitHub account section in Settings — sign in with a Personal Access Token
 * (verified + stored OS-encrypted in the main process), or sign out. The signed-in
 * login powers the in-app Pull Requests view. `undefined` = still resolving the
 * stored session.
 */
export const GithubAccount = (): JSX.Element => {
  const [session, setSession] = useState<PublicAuthenticationSession | null | undefined>(undefined);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const requestSeq = useRef(0);
  const mounted = useRef(true);

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const isCurrentRequest = useCallback(
    (seq: number): boolean => mounted.current && seq === requestSeq.current,
    [],
  );

  const refresh = useCallback(async (): Promise<void> => {
    const seq = ++requestSeq.current;
    try {
      const sessions = await authenticationService.getSessions(GITHUB_AUTH_PROVIDER_ID);
      if (isCurrentRequest(seq)) setSession(sessions[0] ?? null);
    } catch {
      if (isCurrentRequest(seq)) setSession(null);
    }
  }, [isCurrentRequest]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(
    () =>
      authenticationService.onDidChangeSessions((event) => {
        if (event.providerId === GITHUB_AUTH_PROVIDER_ID) void refresh();
      }),
    [refresh],
  );

  const signIn = useCallback(async (): Promise<void> => {
    if (busy) return;
    const t = token.trim();
    if (t === '') return;
    const seq = ++requestSeq.current;
    setBusy(true);
    try {
      const nextSession = await authenticationService.createSession(GITHUB_AUTH_PROVIDER_ID, t);
      if (nextSession === null) throw new Error('GitHub did not return an account for this token.');
      if (isCurrentRequest(seq)) {
        setSession(nextSession);
        setToken('');
        toast.success(`Signed in to GitHub: ${nextSession.account.label}`);
      }
    } catch (e) {
      if (isCurrentRequest(seq)) toast.error(githubAccountErrorMessage(e));
    } finally {
      if (isCurrentRequest(seq)) setBusy(false);
    }
  }, [busy, isCurrentRequest, token]);

  const signOut = useCallback(async (): Promise<void> => {
    if (busy) return;
    const seq = ++requestSeq.current;
    setBusy(true);
    try {
      await authenticationService.removeSession(GITHUB_AUTH_PROVIDER_ID, session?.id ?? 'github');
      if (isCurrentRequest(seq)) {
        setSession(null);
        toast.info('Signed out of GitHub.');
      }
    } finally {
      if (isCurrentRequest(seq)) setBusy(false);
    }
  }, [busy, isCurrentRequest, session?.id]);

  return (
    <div data-testid="github-account">
      <div style={sectionLabelStyle}>GitHub</div>
      <div
        style={{
          padding: `${space[3]}px ${space[4]}px`,
          display: 'flex',
          flexDirection: 'column',
          gap: space[2],
        }}
      >
        {session === undefined ? (
          <span style={{ color: color.textTertiary, fontSize: font.size.caption }}>
            Checking sign-in…
          </span>
        ) : session !== null ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: space[3] }}>
            <span style={{ color: color.textSecondary, fontSize: font.size.caption }}>
              Signed in as{' '}
              <strong style={{ color: color.textPrimary }}>{session.account.label}</strong>
            </span>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void signOut()}>
              Sign Out
            </Button>
          </div>
        ) : (
          <>
            <span
              style={{ color: color.textTertiary, fontSize: font.size.caption, lineHeight: 1.5 }}
            >
              Paste a GitHub Personal Access Token to view and review pull requests in-app.
              Fine-grained tokens need repository metadata and pull request access for the
              repositories you use; classic tokens need repository access. The token is verified and
              stored by the main process, then used there for GitHub API and Git HTTPS credential
              requests.
            </span>
            <div style={{ display: 'flex', gap: space[2] }}>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void signIn();
                }}
                disabled={busy}
                placeholder="ghp_… or github_pat_…"
                aria-label="GitHub Personal Access Token"
                data-testid="github-token-input"
                style={{
                  flex: 1,
                  height: 28,
                  boxSizing: 'border-box',
                  background: color.bg,
                  border: `1px solid ${color.border}`,
                  borderRadius: radius.md,
                  color: color.textPrimary,
                  fontFamily: font.mono,
                  fontSize: font.size.caption,
                  padding: `0 ${space[2]}px`,
                  outline: 'none',
                }}
              />
              <Button
                variant="primary"
                size="sm"
                disabled={busy || token.trim() === ''}
                onClick={() => void signIn()}
              >
                Sign In
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
