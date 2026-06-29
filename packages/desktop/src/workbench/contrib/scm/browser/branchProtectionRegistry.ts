import type { BranchProtection, BranchProtectionProvider } from '../common/branchProtection.js';

export type BranchProtectionProvidersChangeListener = (repositoryRoot: string) => void;

export interface BranchProtectionProviderRegistryLike {
  onDidChangeBranchProtectionProviders(
    listener: BranchProtectionProvidersChangeListener,
  ): () => void;
  registerBranchProtectionProvider(
    repositoryRoot: string,
    provider: BranchProtectionProvider,
  ): () => void;
  getBranchProtectionProviders(repositoryRoot: string): readonly BranchProtectionProvider[];
  provideBranchProtection(repositoryRoot: string): readonly BranchProtection[];
}

export class BranchProtectionProviderRegistry implements BranchProtectionProviderRegistryLike {
  private readonly providers = new Map<string, Set<BranchProtectionProvider>>();
  private readonly listeners = new Set<BranchProtectionProvidersChangeListener>();

  onDidChangeBranchProtectionProviders(
    listener: BranchProtectionProvidersChangeListener,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  registerBranchProtectionProvider(
    repositoryRoot: string,
    provider: BranchProtectionProvider,
  ): () => void {
    const root = normalizedRepositoryRoot(repositoryRoot);
    const providers = this.providers.get(root) ?? new Set<BranchProtectionProvider>();
    providers.add(provider);
    this.providers.set(root, providers);

    const disposeProviderChange = provider.onDidChangeBranchProtection((changedRoot) => {
      this.fire(normalizedRepositoryRoot(changedRoot));
    });

    this.fire(root);

    return () => {
      const current = this.providers.get(root);
      if (current === undefined || !current.has(provider)) return;

      current.delete(provider);
      if (current.size === 0) {
        this.providers.delete(root);
      } else {
        this.providers.set(root, current);
      }
      disposeProviderChange();
      this.fire(root);
    };
  }

  getBranchProtectionProviders(repositoryRoot: string): readonly BranchProtectionProvider[] {
    return [...(this.providers.get(normalizedRepositoryRoot(repositoryRoot)) ?? [])];
  }

  provideBranchProtection(repositoryRoot: string): readonly BranchProtection[] {
    const groups = this.getBranchProtectionProviders(repositoryRoot).map((provider) =>
      provider.provideBranchProtection(),
    );
    return groups.flat();
  }

  private fire(repositoryRoot: string): void {
    for (const listener of this.listeners) listener(repositoryRoot);
  }
}

export const branchProtectionProviderRegistry = new BranchProtectionProviderRegistry();

export function registerBranchProtectionProvider(
  repositoryRoot: string,
  provider: BranchProtectionProvider,
  registry: BranchProtectionProviderRegistryLike = branchProtectionProviderRegistry,
): () => void {
  return registry.registerBranchProtectionProvider(repositoryRoot, provider);
}

function normalizedRepositoryRoot(repositoryRoot: string): string {
  const normalized = repositoryRoot.trim();
  if (normalized === '') throw new Error('Repository root is required.');
  return normalized;
}
