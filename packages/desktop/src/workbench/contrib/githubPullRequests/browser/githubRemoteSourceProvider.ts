import { nativeHostService } from '../../../../platform/native/browser/nativeHostService.js';
import {
  type RemoteSourceProviderRegistryLike,
  registerRemoteSourceProvider,
} from '../../scm/browser/remoteSourceRegistry.js';
import type { RemoteSourceAction, RemoteSourceProvider } from '../../scm/common/remoteSources.js';
import { githubRemoteBranchUrl } from '../common/githubRemote.js';
import { type GithubChannel, githubChannel } from './githubChannel.js';

type GithubRemoteSourceChannel = Pick<GithubChannel, 'listRemoteSources' | 'listRemoteBranches'>;
type OpenExternal = (url: string) => unknown;

export type GithubRemoteSourceAction = RemoteSourceAction;

export function githubRemoteSourceBranchUrl(
  remoteUrl: string,
  branch: string,
  hostPrefix = 'https://github.com',
): string | null {
  return githubRemoteBranchUrl(remoteUrl, branch, hostPrefix);
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
