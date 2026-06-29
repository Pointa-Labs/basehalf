import {
  type BranchProtectionProviderRegistryLike,
  branchProtectionProviderRegistry,
  registerBranchProtectionProvider,
} from '../../scm/browser/branchProtectionRegistry.js';
import {
  type BranchProtection,
  type BranchProtectionChangeEvent,
  type BranchProtectionProvider,
  noopBranchProtectionChangeEvent,
} from '../../scm/common/branchProtection.js';

export interface GithubBranchProtectionSource {
  readonly onDidChangeBranchProtection?: BranchProtectionChangeEvent;
  provideBranchProtection(repositoryRoot: string): readonly BranchProtection[];
}

const EMPTY_BRANCH_PROTECTION: readonly BranchProtection[] = Object.freeze([]);

export const githubBranchProtectionSource: GithubBranchProtectionSource = {
  onDidChangeBranchProtection: noopBranchProtectionChangeEvent,
  provideBranchProtection: () => EMPTY_BRANCH_PROTECTION,
};

export class GithubBranchProtectionProvider implements BranchProtectionProvider {
  readonly onDidChangeBranchProtection: BranchProtectionChangeEvent;

  constructor(
    private readonly repositoryRoot: string,
    private readonly source: GithubBranchProtectionSource = githubBranchProtectionSource,
  ) {
    this.onDidChangeBranchProtection =
      source.onDidChangeBranchProtection ?? noopBranchProtectionChangeEvent;
  }

  provideBranchProtection(): readonly BranchProtection[] {
    return this.source.provideBranchProtection(this.repositoryRoot);
  }
}

export function registerGithubBranchProtectionProvider(
  repositoryRoot: string,
  registry: BranchProtectionProviderRegistryLike = branchProtectionProviderRegistry,
  source: GithubBranchProtectionSource = githubBranchProtectionSource,
): () => void {
  return registerBranchProtectionProvider(
    repositoryRoot,
    new GithubBranchProtectionProvider(repositoryRoot, source),
    registry,
  );
}
