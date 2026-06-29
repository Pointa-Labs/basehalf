import type { GithubRepo } from './githubPullRequests.js';

export function parseGithubRemoteUrl(remoteUrl: string): GithubRepo | null {
  const trimmed = remoteUrl.trim();
  if (trimmed === '') return null;

  let host: string;
  let path: string;
  const scp = /^[\w.-]+@([^:/]+):(.+)$/.exec(trimmed);
  if (scp !== null) {
    host = scp[1] ?? '';
    path = scp[2] ?? '';
  } else {
    try {
      const url = new URL(trimmed);
      host = url.host;
      path = url.pathname.replace(/^\/+/, '');
    } catch {
      return null;
    }
  }

  if (host.toLowerCase() !== 'github.com') return null;
  const cleaned = path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
  const [owner, repo] = cleaned.split('/');
  if (owner === undefined || owner === '' || repo === undefined || repo === '') return null;
  return { owner, repo };
}

export function githubRemoteBranchUrl(
  remoteUrl: string,
  branch: string,
  hostPrefix = 'https://github.com',
): string | null {
  const repo = parseGithubRemoteUrl(remoteUrl);
  if (repo === null) return null;

  return `${hostPrefix}/${repo.owner}/${repo.repo}/tree/${encodePathComponentPreservingSlashes(branch)}`;
}

function encodePathComponentPreservingSlashes(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}
