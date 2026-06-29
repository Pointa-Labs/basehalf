import { nativeHostService } from '../../../../platform/native/browser/nativeHostService.js';
import {
  type RemoteSourceProviderRegistryLike,
  registerRemoteSourceProvider,
} from '../../scm/browser/remoteSourceRegistry.js';
import type { RemoteSourceAction, RemoteSourceProvider } from '../../scm/common/remoteSources.js';
import { type GithubChannel, githubChannel } from './githubChannel.js';

type GithubRemoteSourceChannel = Pick<GithubChannel, 'listRemoteSources' | 'listRemoteBranches'>;
type OpenExternal = (url: string) => unknown;

export type GithubRemoteSourceAction = RemoteSourceAction;

function parseGithubRemoteUrl(remoteUrl: string): { owner: string; repo: string } | null {
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
      const url = new URL(trimmed);
      host = url.host;
      path = url.pathname.replace(/^\/+/, '');
    } catch {
      return null;
    }
  }

  if (host.toLowerCase() !== 'github.com') return null;
  const cleaned = path.replace(/\.git$/i, '').replace(/\/+$/, '');
  const [owner, repo] = cleaned.split('/');
  if (owner === undefined || owner === '' || repo === undefined || repo === '') return null;
  return { owner, repo };
}

function encodePathComponentPreservingSlashes(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function githubRemoteSourceBranchUrl(
  remoteUrl: string,
  branch: string,
  hostPrefix = 'https://github.com',
): string | null {
  const repo = parseGithubRemoteUrl(remoteUrl);
  if (repo === null) return null;

  return `${hostPrefix}/${repo.owner}/${repo.repo}/tree/${encodePathComponentPreservingSlashes(branch)}`;
}

export class GithubRemoteSourceProvider implements RemoteSourceProvider {
  readonly id = 'github';
  readonly name = 'GitHub';
  readonly icon = 'github';
  readonly supportsQuery = true;

  constructor(
    private readonly channel: GithubRemoteSourceChannel = githubChannel,
    private readonly openExternal: OpenExternal = (url) => nativeHostService.openExternal(url),
  ) {}

  getRemoteSources(query?: string) {
    return this.channel.listRemoteSources(query);
  }

  getBranches(remoteUrl: string) {
    return this.channel.listRemoteBranches(remoteUrl);
  }

  getRemoteSourceActions(remoteUrl: string): readonly RemoteSourceAction[] {
    if (githubRemoteSourceBranchUrl(remoteUrl, 'main') === null) return [];

    return [
      {
        label: 'Open on GitHub',
        icon: 'github',
        run: (branch) => {
          const url = githubRemoteSourceBranchUrl(remoteUrl, branch);
          if (url !== null) void this.openExternal(url);
        },
      },
      {
        label: 'Checkout on vscode.dev',
        icon: 'globe',
        run: (branch) => {
          const url = githubRemoteSourceBranchUrl(remoteUrl, branch, 'https://vscode.dev/github');
          if (url !== null) void this.openExternal(url);
        },
      },
    ];
  }
}

export const githubRemoteSourceProvider = new GithubRemoteSourceProvider();

export function registerGithubRemoteSourceProvider(
  registry?: RemoteSourceProviderRegistryLike,
  provider: RemoteSourceProvider = githubRemoteSourceProvider,
): () => void {
  return registerRemoteSourceProvider(provider, registry);
}
