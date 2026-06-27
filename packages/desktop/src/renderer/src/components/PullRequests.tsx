import type { GhPullRequest } from '@basehalf/core';
import { type JSX, type ReactNode, useEffect, useState } from 'react';
import { color, font, space } from '../design.js';
import { openSettings } from './Settings.js';
import { Disclosure } from './primitives/Disclosure.js';

/**
 * The Pull Requests section in Source Control — VS Code's GitHub Pull Requests
 * view, scoped to the current repo. Shows nothing unless the repo's remote is
 * github.com. Signed out → a one-click jump to Settings to sign in; signed in →
 * the open PRs (title · #number · author → branch), each opening the PR.
 *
 * Reads git.remoteUrl + github.viewer to decide visibility, then github.list-
 * PullRequests (token-gated in core; the renderer never sees the token).
 */

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const PullRequests = (): JSX.Element | null => {
  const [open, setOpen] = useState(true);
  const [login, setLogin] = useState<string | null | undefined>(undefined);
  const [remoteUrl, setRemoteUrl] = useState<string | null | undefined>(undefined);
  const [prs, setPrs] = useState<GhPullRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const r = (await window.bh.run('git.remoteUrl', {})) as { url: string | null };
        setRemoteUrl(r.url);
      } catch {
        setRemoteUrl(null);
      }
      try {
        const v = (await window.bh.run('github.viewer', {})) as { login: string | null };
        setLogin(v.login);
      } catch {
        setLogin(null);
      }
    })();
  }, []);

  const isGithub = typeof remoteUrl === 'string' && /(^|@|\/\/)github\.com[:/]/i.test(remoteUrl);

  useEffect(() => {
    if (!isGithub || login === null || login === undefined || !open) return;
    let cancelled = false;
    void (async () => {
      setError(null);
      try {
        const r = (await window.bh.run('github.listPullRequests', { remoteUrl })) as {
          pullRequests: GhPullRequest[];
        };
        if (!cancelled) setPrs(r.pullRequests);
      } catch (e) {
        if (!cancelled) {
          setError(msg(e));
          setPrs([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isGithub, login, remoteUrl, open]);

  // Still resolving, or not a github repo → render nothing.
  if (remoteUrl === undefined || login === undefined) return null;
  if (!isGithub) return null;

  return (
    <Disclosure
      title="Pull Requests"
      count={prs?.length ?? 0}
      open={open}
      onToggle={() => setOpen(!open)}
    >
      <div data-testid="pull-requests">
        {login === null ? (
          <Hint>
            登录 GitHub 后可在此查看 Pull Request。{' '}
            <button type="button" onClick={() => openSettings()} style={linkStyle}>
              前往设置
            </button>
          </Hint>
        ) : prs === null ? (
          <Hint>载入 Pull Request…</Hint>
        ) : error !== null ? (
          <Hint>{error}</Hint>
        ) : prs.length === 0 ? (
          <Hint>没有开放的 Pull Request。</Hint>
        ) : (
          prs.map((pr) => (
            <button
              key={pr.number}
              type="button"
              data-testid="pr-row"
              title={`#${pr.number} · ${pr.headRef} → ${pr.baseRef}`}
              onClick={() => void window.bh.openExternal(pr.url)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                width: '100%',
                padding: `${space[1]}px ${space[2]}px ${space[1]}px ${space[4]}px`,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = color.divider;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'none';
              }}
            >
              <span
                style={{
                  color: color.textPrimary,
                  fontFamily: font.sans,
                  fontSize: font.size.caption,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  width: '100%',
                }}
              >
                {pr.draft ? '草稿 · ' : ''}
                {pr.title}
              </span>
              <span style={{ color: color.textGhost, fontSize: font.size.micro }}>
                #{pr.number} · {pr.author} · {pr.headRef} → {pr.baseRef}
              </span>
            </button>
          ))
        )}
      </div>
    </Disclosure>
  );
};

const linkStyle = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: color.accent,
  cursor: 'pointer',
  font: 'inherit',
} as const;

const Hint = ({ children }: { children: ReactNode }): JSX.Element => (
  <div
    style={{
      padding: `${space[2]}px ${space[4]}px`,
      color: color.textTertiary,
      fontFamily: font.sans,
      fontSize: font.size.micro,
      lineHeight: 1.5,
    }}
  >
    {children}
  </div>
);
