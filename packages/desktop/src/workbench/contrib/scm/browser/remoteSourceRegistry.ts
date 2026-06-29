import type {
  RemoteSource,
  RemoteSourceAction,
  RemoteSourceBranch,
  RemoteSourceProvider,
  RemoteSourcesByProvider,
} from '../common/remoteSources.js';

export interface RemoteSourceProviderRegistryLike {
  registerRemoteSourceProvider(provider: RemoteSourceProvider): () => void;
  unregisterRemoteSourceProvider(providerId: string): void;
  getRemoteSourceProvider(providerId: string): RemoteSourceProvider | undefined;
  getRemoteSourceProviders(): readonly RemoteSourceProvider[];
  getRemoteSources(providerId: string, query?: string): Promise<readonly RemoteSource[]>;
  getRemoteBranches(providerId: string, remoteUrl: string): Promise<readonly RemoteSourceBranch[]>;
  getRemoteSourceActions(remoteUrl: string): Promise<readonly RemoteSourceAction[]>;
  getRemoteSourcesByProvider(query?: string): Promise<readonly RemoteSourcesByProvider[]>;
}

export class RemoteSourceProviderRegistry implements RemoteSourceProviderRegistryLike {
  private readonly providers = new Map<string, RemoteSourceProvider>();

  registerRemoteSourceProvider(provider: RemoteSourceProvider): () => void {
    const providerId = normalizedProviderId(provider.id);
    if (this.providers.has(providerId)) {
      throw new Error(`Remote source provider '${providerId}' is already registered.`);
    }

    this.providers.set(providerId, provider);
    return () => {
      if (this.providers.get(providerId) === provider) this.providers.delete(providerId);
    };
  }

  unregisterRemoteSourceProvider(providerId: string): void {
    this.providers.delete(normalizedProviderId(providerId));
  }

  getRemoteSourceProvider(providerId: string): RemoteSourceProvider | undefined {
    return this.providers.get(normalizedProviderId(providerId));
  }

  getRemoteSourceProviders(): readonly RemoteSourceProvider[] {
    return [...this.providers.values()];
  }

  async getRemoteSources(providerId: string, query?: string): Promise<readonly RemoteSource[]> {
    return this.requireProvider(providerId).getRemoteSources(query);
  }

  async getRemoteBranches(
    providerId: string,
    remoteUrl: string,
  ): Promise<readonly RemoteSourceBranch[]> {
    return (await this.requireProvider(providerId).getBranches?.(remoteUrl)) ?? [];
  }

  async getRemoteSourceActions(remoteUrl: string): Promise<readonly RemoteSourceAction[]> {
    const actionGroups = await Promise.all(
      this.getRemoteSourceProviders().map(
        async (provider) => (await provider.getRemoteSourceActions?.(remoteUrl)) ?? [],
      ),
    );
    return actionGroups.flat();
  }

  async getRemoteSourcesByProvider(query?: string): Promise<readonly RemoteSourcesByProvider[]> {
    return Promise.all(
      this.getRemoteSourceProviders().map(async (provider) => ({
        provider,
        sources: await provider.getRemoteSources(query),
      })),
    );
  }

  private requireProvider(providerId: string): RemoteSourceProvider {
    const normalized = normalizedProviderId(providerId);
    const provider = this.providers.get(normalized);
    if (provider === undefined) {
      throw new Error(`Remote source provider '${normalized}' is not registered.`);
    }
    return provider;
  }
}

export const remoteSourceProviderRegistry = new RemoteSourceProviderRegistry();

export function registerRemoteSourceProvider(
  provider: RemoteSourceProvider,
  registry: RemoteSourceProviderRegistryLike = remoteSourceProviderRegistry,
): () => void {
  return registry.registerRemoteSourceProvider(provider);
}

function normalizedProviderId(providerId: string): string {
  const normalized = providerId.trim();
  if (normalized === '') throw new Error('Remote source provider id is required.');
  return normalized;
}
