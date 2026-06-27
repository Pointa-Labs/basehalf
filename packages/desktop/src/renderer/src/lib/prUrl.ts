/**
 * Derive a hosting platform's web URLs from a git remote URL — no API, no auth,
 * just URL math. Powers the "Create Pull Request" action, which opens the host's
 * compare/new-PR page in the browser for the current branch (the decision-free
 * slice of remote integration; in-app PR review needs an auth'd provider).
 *
 * Handles both forms git emits:
 *   scp-like ssh : git@github.com:owner/repo.git
 *   url          : https://github.com/owner/repo.git  /  ssh://git@host/owner/repo.git
 */

/** The `https://<host>/<owner>/<repo>` web base, or null if unparseable. */
export function webBaseUrl(remote: string): string | null {
  const trimmed = remote.trim();
  if (trimmed === '') return null;
  let host: string;
  let path: string;
  const scp = /^[\w.-]+@([^:/]+):(.+)$/.exec(trimmed);
  if (scp) {
    host = scp[1] ?? '';
    path = scp[2] ?? '';
  } else {
    try {
      const u = new URL(trimmed);
      host = u.host;
      path = u.pathname.replace(/^\/+/, '');
    } catch {
      return null;
    }
  }
  path = path.replace(/\.git$/i, '').replace(/\/+$/, '');
  if (host === '' || path === '') return null;
  return `https://${host}/${path}`;
}

/** A "create pull/merge request" URL for `branch`, per the detected host. */
export function createPrUrl(remote: string, branch: string): string | null {
  const base = webBaseUrl(remote);
  if (base === null || branch.trim() === '') return null;
  const b = encodeURIComponent(branch);
  if (/(^|\/\/)([\w.-]*\.)?gitlab\b/i.test(base)) {
    return `${base}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${b}`;
  }
  if (/bitbucket\b/i.test(base)) {
    return `${base}/pull-requests/new?source=${b}`;
  }
  // GitHub + a sensible generic default (the compare page with the PR form open).
  return `${base}/compare/${b}?expand=1`;
}
