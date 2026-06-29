import { nativeHostService } from '../../../../platform/native/browser/nativeHostService.js';
import {
  type ScmHistoryItemDetailsProviderRegistry as ScmHistoryItemDetailsProviderRegistryLike,
  registerScmHistoryItemDetailsProvider,
  scmHistoryItemDetailsProviderRegistry,
} from '../../scm/browser/historyItemDetailsProviderRegistry.js';
import type {
  ScmHistoryAvatarQuery,
  ScmHistoryItemCommand,
  ScmHistoryItemDetailsProvider,
  ScmHistoryRepository,
} from '../../scm/common/historyItemDetails.js';
import { type GithubChannel, githubChannel } from './githubChannel.js';

const ISSUE_EXPRESSION = /(([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+))?(#|GH-)([1-9][0-9]*)($|\b)/g;

type GithubHistoryItemDetailsChannel = Pick<GithubChannel, 'repository'>;
type OpenExternal = (url: string) => unknown;

export class GithubHistoryItemDetailsProvider implements ScmHistoryItemDetailsProvider {
  constructor(
    private readonly channel: GithubHistoryItemDetailsChannel = githubChannel,
    private readonly openExternal: OpenExternal = (url) => nativeHostService.openExternal(url),
  ) {}

  provideAvatar(
    _repository: ScmHistoryRepository,
    query: ScmHistoryAvatarQuery,
  ): Map<string, string | undefined> | undefined {
    const avatars = new Map<string, string | undefined>();

    for (const commit of query.commits) {
      const userId = githubUserIdFromNoReplyEmail(commit.authorEmail);
      if (userId !== undefined) {
        avatars.set(commit.hash, githubAvatarUrl(userId, query.size));
      }
    }

    return avatars.size === 0 ? undefined : avatars;
  }

  async provideHoverCommands(
    repository: ScmHistoryRepository,
  ): Promise<readonly ScmHistoryItemCommand[] | undefined> {
    const githubRepository = await this.repositoryFor(repository);
    if (githubRepository === null) return undefined;

    return [
      {
        id: 'github.openOnGitHub',
        title: 'Open on GitHub',
        arguments: [githubRepository.webUrl],
      },
    ];
  }

  async provideMessageLinks(
    repository: ScmHistoryRepository,
    message: string,
  ): Promise<string | undefined> {
    const githubRepository = await this.repositoryFor(repository);
    if (githubRepository === null) return undefined;

    return message.replace(
      ISSUE_EXPRESSION,
      (
        match,
        _full,
        owner: string | undefined,
        repo: string | undefined,
        _kind,
        number: string,
      ) => {
        const label =
          owner !== undefined && repo !== undefined ? `${owner}/${repo}#${number}` : `#${number}`;
        const issueOwner = owner ?? githubRepository.owner;
        const issueRepo = repo ?? githubRepository.repo;
        return `[${label}](https://github.com/${issueOwner}/${issueRepo}/issues/${number})`;
      },
    );
  }

  openOnGitHub(url: string): void {
    void this.openExternal(url);
  }

  private async repositoryFor(repository: ScmHistoryRepository) {
    if (repository.root !== null && repository.root.trim() === '') return null;
    try {
      return await this.channel.repository();
    } catch {
      return null;
    }
  }
}

export const githubHistoryItemDetailsProvider = new GithubHistoryItemDetailsProvider();

export function registerGithubHistoryItemDetailsProvider(
  registry: ScmHistoryItemDetailsProviderRegistryLike = scmHistoryItemDetailsProviderRegistry,
  provider: ScmHistoryItemDetailsProvider = githubHistoryItemDetailsProvider,
): () => void {
  return registerScmHistoryItemDetailsProvider(provider, registry);
}

function githubUserIdFromNoReplyEmail(email: string | undefined): string | undefined {
  return email?.match(/^([0-9]+)\+[^@]+@users\.noreply\.github\.com$/)?.[1];
}

function githubAvatarUrl(userId: string, size: number): string {
  return `https://avatars.githubusercontent.com/u/${encodeURIComponent(userId)}?s=${size}`;
}
