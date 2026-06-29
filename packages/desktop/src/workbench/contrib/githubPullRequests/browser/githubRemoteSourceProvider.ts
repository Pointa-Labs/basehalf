import {
  type RemoteSourceProviderRegistryLike,
  registerRemoteSourceProvider,
} from '../../scm/browser/remoteSourceRegistry.js';
import type { RemoteSourceProvider } from '../../scm/common/remoteSources.js';
import { type GithubChannel, githubChannel } from './githubChannel.js';

type GithubRemoteSourceChannel = Pick<GithubChannel, 'listRemoteSources' | 'listRemoteBranches'>;

export class GithubRemoteSourceProvider implements RemoteSourceProvider {
  readonly id = 'github';
  readonly name = 'GitHub';
  readonly icon = 'github';
  readonly supportsQuery = true;

  constructor(private readonly channel: GithubRemoteSourceChannel = githubChannel) {}

  getRemoteSources(query?: string) {
    return this.channel.listRemoteSources(query);
  }

  getBranches(remoteUrl: string) {
    return this.channel.listRemoteBranches(remoteUrl);
  }
}

export const githubRemoteSourceProvider = new GithubRemoteSourceProvider();

export function registerGithubRemoteSourceProvider(
  registry?: RemoteSourceProviderRegistryLike,
  provider: RemoteSourceProvider = githubRemoteSourceProvider,
): () => void {
  return registerRemoteSourceProvider(provider, registry);
}
