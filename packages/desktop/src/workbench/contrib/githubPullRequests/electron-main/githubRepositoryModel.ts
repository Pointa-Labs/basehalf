import type { GithubRemoteRepository, GithubRepo } from '../common/githubPullRequests.js';

export interface GitRemoteInfoLike {
  readonly name: string;
  readonly fetchUrl?: string;
  readonly pushUrl?: string;
  readonly isReadOnly: boolean;
}

export function parseGithubRepo(remoteUrl: string): GithubRepo | null {
  const trimmed = remoteUrl.trim();
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
  if (host.toLowerCase() !== 'github.com') return null;
  const cleaned = path.replace(/\.git$/i, '').replace(/\/+$/, '');
  const parts = cleaned.split('/');
  if (parts.length < 2) return null;
  const owner = parts[0] ?? '';
  const repo = parts[1] ?? '';
  if (owner === '' || repo === '') return null;
  return { owner, repo };
}

export const githubWebUrl = ({ owner, repo }: GithubRepo): string =>
  `https://github.com/${owner}/${repo}`;

export function sameGithubRepo(a: GithubRepo, b: GithubRepo): boolean {
  return (
    a.owner.toLowerCase() === b.owner.toLowerCase() && a.repo.toLowerCase() === b.repo.toLowerCase()
  );
}

export function repoOf(remoteUrl: string): GithubRepo {
  const repo = parseGithubRepo(remoteUrl);
  if (repo === null) {
    throw new Error("This repository's remote is not github.com (not supported yet).");
  }
  return repo;
}

export const remoteUrlCandidates = (remote: GitRemoteInfoLike): string[] =>
  [remote.pushUrl, remote.fetchUrl].filter(
    (url): url is string => typeof url === 'string' && url.trim() !== '',
  );

export function githubRepositoryFromRemote(
  remote: GitRemoteInfoLike,
): GithubRemoteRepository | null {
  for (const remoteUrl of remoteUrlCandidates(remote)) {
    const repo = parseGithubRepo(remoteUrl);
    if (repo !== null) {
      return {
        remoteName: remote.name,
        remoteUrl,
        owner: repo.owner,
        repo: repo.repo,
        webUrl: githubWebUrl(repo),
        isReadOnly: remote.isReadOnly,
      };
    }
  }
  return null;
}

const baseRemotePriority = (remoteName: string): number =>
  remoteName === 'upstream' ? 0 : remoteName === 'origin' ? 1 : 2;

const headRemotePriority = (remoteName: string): number =>
  remoteName === 'origin' ? 0 : remoteName === 'upstream' ? 1 : 2;

export function sortBaseRepositories(
  repos: readonly GithubRemoteRepository[],
): readonly GithubRemoteRepository[] {
  return [...repos].sort(
    (a, b) =>
      baseRemotePriority(a.remoteName) - baseRemotePriority(b.remoteName) ||
      a.remoteName.localeCompare(b.remoteName),
  );
}

export function selectHeadRepository(
  repos: readonly GithubRemoteRepository[],
): GithubRemoteRepository | undefined {
  return repos
    .filter((repo) => !repo.isReadOnly)
    .sort(
      (a, b) =>
        headRemotePriority(a.remoteName) - headRemotePriority(b.remoteName) ||
        a.remoteName.localeCompare(b.remoteName),
    )[0];
}

export function createGithubPullRequestUrl(
  base: GithubRepo,
  branch: string,
  head?: GithubRepo,
): string | null {
  const trimmedBranch = branch.trim();
  if (trimmedBranch === '') return null;
  const compareHead =
    head !== undefined && !sameGithubRepo(base, head)
      ? `${head.owner}:${trimmedBranch}`
      : trimmedBranch;
  return `${githubWebUrl(base)}/compare/${encodeURIComponent(compareHead)}?expand=1`;
}
