import {
  GitPostCommitCommandsProvider,
  type PostCommitCommandsProvider,
  type PostCommitCommandsProviderRegistry as PostCommitCommandsProviderRegistryLike,
  type PostCommitCommandsProvidersChangeListener,
  type ScmPostCommitCommand,
  type ScmPostCommitRepository,
  postCommitCommandGroups,
} from '../common/postCommitCommands.js';

export class PostCommitCommandsProviderRegistry implements PostCommitCommandsProviderRegistryLike {
  private readonly providers = new Set<PostCommitCommandsProvider>();
  private readonly listeners = new Set<PostCommitCommandsProvidersChangeListener>();

  onDidChangePostCommitCommandsProviders(
    listener: PostCommitCommandsProvidersChangeListener,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  registerPostCommitCommandsProvider(provider: PostCommitCommandsProvider): () => void {
    this.providers.add(provider);
    this.fire();

    return () => {
      if (this.providers.delete(provider)) this.fire();
    };
  }

  getPostCommitCommandsProviders(): readonly PostCommitCommandsProvider[] {
    return [...this.providers];
  }

  getPostCommitCommandGroups(
    repository: ScmPostCommitRepository,
  ): readonly (readonly ScmPostCommitCommand[])[] {
    return postCommitCommandGroups(this, repository);
  }

  private fire(): void {
    for (const listener of this.listeners) listener();
  }
}

export const postCommitCommandsProviderRegistry = new PostCommitCommandsProviderRegistry();
postCommitCommandsProviderRegistry.registerPostCommitCommandsProvider(
  new GitPostCommitCommandsProvider(),
);

export function registerPostCommitCommandsProvider(
  provider: PostCommitCommandsProvider,
  registry: PostCommitCommandsProviderRegistryLike = postCommitCommandsProviderRegistry,
): () => void {
  return registry.registerPostCommitCommandsProvider(provider);
}

export function getPostCommitCommandGroups(
  repository: ScmPostCommitRepository,
  registry: Pick<
    PostCommitCommandsProviderRegistryLike,
    'getPostCommitCommandsProviders'
  > = postCommitCommandsProviderRegistry,
): readonly (readonly ScmPostCommitCommand[])[] {
  return postCommitCommandGroups(registry, repository);
}
