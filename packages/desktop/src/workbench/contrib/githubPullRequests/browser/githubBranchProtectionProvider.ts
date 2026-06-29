import {
  type AuthenticationService,
  authenticationService,
} from '../../../services/authentication/browser/authenticationService.js';
import { GITHUB_AUTH_PROVIDER_ID } from '../../../services/authentication/common/authentication.js';
import { useWorkspaceStore } from '../../../services/workspace/browser/workspaceStore.js';
import {
  type BranchProtectionProviderRegistryLike,
  branchProtectionProviderRegistry,
  registerBranchProtectionProvider,
} from '../../scm/browser/branchProtectionRegistry.js';
import {
  type BranchProtection,
  type BranchProtectionChangeEvent,
  type BranchProtectionChangeListener,
  type BranchProtectionProvider,
  noopBranchProtectionChangeEvent,
} from '../../scm/common/branchProtection.js';
import { type GithubChannel, githubChannel } from './githubChannel.js';

export interface GithubBranchProtectionSource {
  readonly onDidChangeBranchProtection?: BranchProtectionChangeEvent;
  provideBranchProtection(repositoryRoot: string): readonly BranchProtection[];
  refreshBranchProtection?(repositoryRoot: string): void | Promise<void>;
  dispose?(): void;
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
    void source.refreshBranchProtection?.(repositoryRoot);
  }

  provideBranchProtection(): readonly BranchProtection[] {
    return this.source.provideBranchProtection(this.repositoryRoot);
  }
}

type GithubBranchProtectionChannel = Pick<GithubChannel, 'branchProtection'>;
type GithubBranchProtectionAuthService = Pick<AuthenticationService, 'onDidChangeSessions'>;

export function createGithubBranchProtectionSource(
  channel: GithubBranchProtectionChannel = githubChannel,
  authService: GithubBranchProtectionAuthService = authenticationService,
): GithubBranchProtectionSource {
  return new GithubChannelBranchProtectionSource(channel, authService);
}

export interface GithubBranchProtectionWorkspaceSource {
  current(): string | null;
  onDidChangeCurrent(listener: (repositoryRoot: string | null) => void): () => void;
}

export function createGithubBranchProtectionWorkspaceSource(): GithubBranchProtectionWorkspaceSource {
  return {
    current: () => useWorkspaceStore.getState().current,
    onDidChangeCurrent: (listener) =>
      useWorkspaceStore.subscribe((state, previous) => {
        if (state.current !== previous.current) listener(state.current);
      }),
  };
}

export interface RegisterGithubBranchProtectionProvidersOptions {
  readonly registry?: BranchProtectionProviderRegistryLike;
  readonly workspace?: GithubBranchProtectionWorkspaceSource;
  readonly channel?: GithubBranchProtectionChannel;
  readonly authService?: GithubBranchProtectionAuthService;
}

export function registerGithubBranchProtectionProviders({
  registry = branchProtectionProviderRegistry,
  workspace = createGithubBranchProtectionWorkspaceSource(),
  channel = githubChannel,
  authService = authenticationService,
}: RegisterGithubBranchProtectionProvidersOptions = {}): () => void {
  let disposeCurrent: () => void = () => undefined;

  const registerCurrent = (repositoryRoot: string | null): void => {
    disposeCurrent();
    disposeCurrent = () => undefined;
    if (repositoryRoot === null) return;
    disposeCurrent = registerGithubBranchProtectionProvider(
      repositoryRoot,
      registry,
      createGithubBranchProtectionSource(channel, authService),
    );
  };

  registerCurrent(workspace.current());
  const disposeWorkspaceListener = workspace.onDidChangeCurrent(registerCurrent);

  return () => {
    disposeWorkspaceListener();
    disposeCurrent();
  };
}

export function registerGithubBranchProtectionProvider(
  repositoryRoot: string,
  registry: BranchProtectionProviderRegistryLike = branchProtectionProviderRegistry,
  source: GithubBranchProtectionSource = createGithubBranchProtectionSource(),
): () => void {
  const disposeProvider = registerBranchProtectionProvider(
    repositoryRoot,
    new GithubBranchProtectionProvider(repositoryRoot, source),
    registry,
  );
  return () => {
    disposeProvider();
    source.dispose?.();
  };
}

class GithubChannelBranchProtectionSource implements GithubBranchProtectionSource {
  private readonly listeners = new Set<BranchProtectionChangeListener>();
  private readonly cache = new Map<string, readonly BranchProtection[]>();
  private readonly refreshSeq = new Map<string, number>();
  private readonly disposeAuth: () => void;
  private disposed = false;

  readonly onDidChangeBranchProtection: BranchProtectionChangeEvent = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  constructor(
    private readonly channel: GithubBranchProtectionChannel,
    authService: GithubBranchProtectionAuthService,
  ) {
    this.disposeAuth = authService.onDidChangeSessions((event) => {
      if (event.providerId === GITHUB_AUTH_PROVIDER_ID) this.refreshAll();
    });
  }

  provideBranchProtection(repositoryRoot: string): readonly BranchProtection[] {
    if (!this.cache.has(repositoryRoot)) {
      const refreshPending = this.refreshSeq.has(repositoryRoot);
      this.cache.set(repositoryRoot, EMPTY_BRANCH_PROTECTION);
      if (!refreshPending) void this.refreshBranchProtection(repositoryRoot);
    }
    return this.cache.get(repositoryRoot) ?? EMPTY_BRANCH_PROTECTION;
  }

  async refreshBranchProtection(repositoryRoot: string): Promise<void> {
    const seq = (this.refreshSeq.get(repositoryRoot) ?? 0) + 1;
    this.refreshSeq.set(repositoryRoot, seq);

    let next: readonly BranchProtection[];
    try {
      next = await this.channel.branchProtection(repositoryRoot);
    } catch {
      next = EMPTY_BRANCH_PROTECTION;
    }

    if (this.disposed || this.refreshSeq.get(repositoryRoot) !== seq) return;
    const previous = this.cache.get(repositoryRoot) ?? EMPTY_BRANCH_PROTECTION;
    if (sameBranchProtection(previous, next)) return;

    this.cache.set(repositoryRoot, next);
    this.fire(repositoryRoot);
  }

  dispose(): void {
    this.disposed = true;
    this.disposeAuth();
    this.listeners.clear();
    this.cache.clear();
    this.refreshSeq.clear();
  }

  private refreshAll(): void {
    for (const repositoryRoot of this.cache.keys()) {
      void this.refreshBranchProtection(repositoryRoot);
    }
  }

  private fire(repositoryRoot: string): void {
    for (const listener of this.listeners) listener(repositoryRoot);
  }
}

function sameBranchProtection(
  a: readonly BranchProtection[],
  b: readonly BranchProtection[],
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
