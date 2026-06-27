import { type JSX, useCallback, useEffect, useState } from 'react';
import { color, font, radius, space } from '../../design.js';
import { toast } from '../../store/toast.js';
import { Button } from '../primitives/Button.js';
import { sectionLabelStyle } from './primitives.js';

/**
 * The GitHub account section in Settings — sign in with a Personal Access Token
 * (verified + stored OS-encrypted in the main process; it never returns to the
 * renderer after this), or sign out. The signed-in login powers the in-app Pull
 * Requests view. `undefined` = still resolving the stored session.
 */
export const GithubAccount = (): JSX.Element => {
  const [login, setLogin] = useState<string | null | undefined>(undefined);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const r = (await window.bh.run('github.viewer', {})) as { login: string | null };
      setLogin(r.login);
    } catch {
      setLogin(null);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(async (): Promise<void> => {
    const t = token.trim();
    if (t === '') return;
    setBusy(true);
    try {
      const r = (await window.bh.run('github.signIn', { token: t })) as { login: string | null };
      setLogin(r.login);
      setToken('');
      toast.success(`Signed in to GitHub: ${r.login}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [token]);

  const signOut = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      await window.bh.run('github.signOut', {});
      setLogin(null);
      toast.info('Signed out of GitHub.');
    } finally {
      setBusy(false);
    }
  }, []);

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
        {login === undefined ? (
          <span style={{ color: color.textTertiary, fontSize: font.size.caption }}>
            Checking sign-in…
          </span>
        ) : login !== null ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: space[3] }}>
            <span style={{ color: color.textSecondary, fontSize: font.size.caption }}>
              Signed in as <strong style={{ color: color.textPrimary }}>{login}</strong>
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
              Paste a Personal Access Token with <code>repo</code> read scope to view pull requests
              in-app. The token is encrypted on this device and never leaves it.
            </span>
            <div style={{ display: 'flex', gap: space[2] }}>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void signIn();
                }}
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
