import { type JSX, type ReactNode, useEffect, useState } from 'react';
import { color, font, space } from '../../../browser/style/design.js';
import { Disclosure } from '../../../browser/ui/primitives/Disclosure.js';
import { useWorkspaceStore } from '../../../services/workspace/browser/workspaceStore.js';
import { openSettings } from '../../preferences/browser/Settings.js';
import type { GhPullRequest, GithubRemoteRepository } from '../common/githubPullRequests.js';
import {
  type GithubPullRequestService,
  githubPullRequestService,
} from './githubPullRequestService.js';
import {
  loadPullRequests,
  resolvePullRequestContext,
  shouldLoadPullRequests,
} from './pullRequestsSectionModel.js';

/**
 * The Pull Requests section in Source Control — VS Code's GitHub Pull Requests
 * view, scoped to the current repo. Shows nothing unless the repo's remote is
 * github.com. Signed out → a one-click jump to Settings to sign in; signed in →
 * the open PRs (title · #number · author → branch), each opening the PR.
 *
 * Reads a GitHub PR service to decide visibility and list PRs. The default
 * service is the IPC-backed provider; tests and future extensions can swap it.
 */

export const PullRequestsSection = ({
  service = githubPullRequestService,
}: {
  service?: GithubPullRequestService;
}): JSX.Element | null => {
  const [open, setOpen] = useState(true);
  const [login, setLogin] = useState<string | null | undefined>(undefined);
  const [repository, setRepository] = useState<GithubRemoteRepository | null | undefined>(
    undefined,
  );
  const [prs, setPrs] = useState<GhPullRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openPr = useWorkspaceStore((s) => s.openPr);

  useEffect(() => {
    let cancelled = false;
    const refreshContext = (): void => {
      setPrs(null);
      setError(null);
      void (async () => {
        const context = await resolvePullRequestContext(service);
        if (cancelled) return;
        setRepository(context.repository);
        setLogin(context.login);
      })();
    };
    refreshContext();
    const unsubscribe = service.onDidChangeAuthentication?.(refreshContext);
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [service]);

  useEffect(() => {
    if (!shouldLoadPullRequests(repository, login, open)) {
      return;
    }
    let cancelled = false;
    void (async () => {
      setError(null);
      const result = await loadPullRequests(service, repository.remoteUrl);
      if (cancelled) return;
      setError(result.error);
      setPrs(result.pullRequests);
    })();
    return () => {
      cancelled = true;
    };
  }, [repository, login, open, service]);

  // Still resolving, or not a github repo → render nothing.
  if (repository === undefined || login === undefined) return null;
  if (repository === null) return null;

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
            Sign in to GitHub to see pull requests here.{' '}
            <button type="button" onClick={() => openSettings()} style={linkStyle}>
              Open Settings
            </button>
          </Hint>
        ) : prs === null ? (
          <Hint>Loading pull requests…</Hint>
        ) : error !== null ? (
          <Hint>{error}</Hint>
        ) : prs.length === 0 ? (
          <Hint>No open pull requests.</Hint>
        ) : (
          prs.map((pr) => (
            <button
              key={pr.number}
              type="button"
              data-testid="pr-row"
              title={`#${pr.number} · ${pr.headRef} → ${pr.baseRef}`}
              onClick={() =>
                openPr({
                  number: pr.number,
                  title: pr.title,
                  remoteUrl: repository.remoteUrl,
                  url: pr.url,
                })
              }
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
                {pr.draft ? 'Draft · ' : ''}
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
