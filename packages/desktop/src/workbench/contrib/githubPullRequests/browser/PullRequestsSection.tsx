import type { JSX, ReactNode } from 'react';
import { color, font, space } from '../../../browser/style/design.js';
import { Disclosure } from '../../../browser/ui/primitives/Disclosure.js';
import type { PullRequestsSectionModel } from './pullRequestsSectionModel.js';

/**
 * The Pull Requests section in Source Control — VS Code's GitHub Pull Requests
 * view, scoped to the current repo. Shows nothing unless the repo's remote is
 * github.com. Signed out → a one-click jump to Settings to sign in; signed in →
 * the open PRs (title · #number · author → branch), each opening the PR.
 *
 * Renders the GitHub-owned PR section model. Provider/service/auth loading stays
 * in `pullRequestsSectionModel`, so the SCM view only receives view state and
 * commands.
 */

export const PullRequestsSection = ({
  model,
}: {
  model: PullRequestsSectionModel;
}): JSX.Element | null => {
  const { repository, login, pullRequests, error, open, count } = model;

  // Still resolving, or not a github repo → render nothing.
  if (repository === undefined || login === undefined) return null;
  if (repository === null) return null;

  return (
    <Disclosure title="Pull Requests" count={count} open={open} onToggle={model.toggleOpen}>
      <div data-testid="pull-requests">
        {login === null ? (
          <Hint>
            Sign in to GitHub to see pull requests here.{' '}
            <button type="button" onClick={model.openSettings} style={linkStyle}>
              Open Settings
            </button>
          </Hint>
        ) : pullRequests === null ? (
          <Hint>Loading pull requests…</Hint>
        ) : error !== null ? (
          <Hint>{error}</Hint>
        ) : pullRequests.length === 0 ? (
          <Hint>No open pull requests.</Hint>
        ) : (
          pullRequests.map((pr) => (
            <button
              key={pr.number}
              type="button"
              data-testid="pr-row"
              title={`#${pr.number} · ${pr.headRef} → ${pr.baseRef}`}
              onClick={() => model.openPullRequest(pr)}
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
