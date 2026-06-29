import type {
  ScmHistoryAvatarQuery,
  ScmHistoryItemCommand,
  ScmHistoryItemDetailsProvider,
  ScmHistoryItemDetailsProviderRegistry as ScmHistoryItemDetailsProviderRegistryLike,
  ScmHistoryRepository,
} from '../common/historyItemDetails.js';

export class ScmHistoryItemDetailsProviderRegistry
  implements ScmHistoryItemDetailsProviderRegistryLike
{
  private readonly providers = new Set<ScmHistoryItemDetailsProvider>();

  registerScmHistoryItemDetailsProvider(provider: ScmHistoryItemDetailsProvider): () => void {
    this.providers.add(provider);
    return () => this.providers.delete(provider);
  }

  getScmHistoryItemDetailsProviders(): readonly ScmHistoryItemDetailsProvider[] {
    return [...this.providers];
  }
}

export const scmHistoryItemDetailsProviderRegistry = new ScmHistoryItemDetailsProviderRegistry();

export function registerScmHistoryItemDetailsProvider(
  provider: ScmHistoryItemDetailsProvider,
  registry: ScmHistoryItemDetailsProviderRegistryLike = scmHistoryItemDetailsProviderRegistry,
): () => void {
  return registry.registerScmHistoryItemDetailsProvider(provider);
}

export async function provideScmHistoryItemAvatar(
  registry: Pick<ScmHistoryItemDetailsProviderRegistryLike, 'getScmHistoryItemDetailsProviders'>,
  repository: ScmHistoryRepository,
  query: ScmHistoryAvatarQuery,
): Promise<Map<string, string | undefined> | undefined> {
  for (const provider of registry.getScmHistoryItemDetailsProviders()) {
    const result = await provider.provideAvatar?.(repository, query);
    if (result) return result;
  }

  return undefined;
}

export async function provideScmHistoryItemHoverCommands(
  registry: Pick<ScmHistoryItemDetailsProviderRegistryLike, 'getScmHistoryItemDetailsProviders'>,
  repository: ScmHistoryRepository,
): Promise<readonly ScmHistoryItemCommand[] | undefined> {
  for (const provider of registry.getScmHistoryItemDetailsProviders()) {
    const result = await provider.provideHoverCommands?.(repository);
    if (result) return result;
  }

  return undefined;
}

export async function provideScmHistoryItemMessageLinks(
  registry: Pick<ScmHistoryItemDetailsProviderRegistryLike, 'getScmHistoryItemDetailsProviders'>,
  repository: ScmHistoryRepository,
  message: string,
): Promise<string | undefined> {
  for (const provider of registry.getScmHistoryItemDetailsProviders()) {
    const result = await provider.provideMessageLinks?.(repository, message);
    if (result) return result;
  }

  return undefined;
}
