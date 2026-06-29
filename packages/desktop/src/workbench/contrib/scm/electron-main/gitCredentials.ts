import type { GitRunOptions, GitRunner } from '../common/git.js';

export interface GitCredentialsEnvironment {
  readonly env: Readonly<Record<string, string>>;
  dispose?(): Promise<void>;
}

export interface GitCredentialsProvider {
  readonly id: string;
  provideGitEnvironment(
    args: readonly string[],
    opts: GitRunOptions,
    base: GitRunner,
  ): Promise<GitCredentialsEnvironment | null>;
}

export interface GitCredentialsProviderRegistration {
  dispose(): void;
}

/**
 * Main-process Git credentials registry. VS Code lets extensions register Git
 * credential providers against the Git extension API; BaseHalf keeps the same
 * shape locally so GitHub integration composes with Git instead of wrapping it.
 */
export class GitCredentialsProviderRegistry {
  private readonly providers: GitCredentialsProvider[] = [];

  register(provider: GitCredentialsProvider): GitCredentialsProviderRegistration {
    this.providers.push(provider);
    return {
      dispose: () => {
        const idx = this.providers.indexOf(provider);
        if (idx >= 0) this.providers.splice(idx, 1);
      },
    };
  }

  async provideEnvironment(
    args: readonly string[],
    opts: GitRunOptions,
    base: GitRunner,
  ): Promise<GitCredentialsEnvironment | null> {
    for (const provider of this.providers) {
      const provided = await provider.provideGitEnvironment(args, opts, base);
      if (provided !== null) return provided;
    }
    return null;
  }
}

export function createCredentialedGitRunner(
  registry: GitCredentialsProviderRegistry,
  base: GitRunner,
): GitRunner {
  return async (args, opts) => {
    const provided = await registry.provideEnvironment(args, opts, base);
    if (provided === null) return base(args, opts);

    try {
      return await base(args, {
        ...opts,
        env: {
          ...(opts.env ?? {}),
          ...provided.env,
        },
      });
    } finally {
      await provided.dispose?.();
    }
  };
}
