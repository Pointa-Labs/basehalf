export interface ScmHistoryRepository {
  readonly root: string | null;
}

export interface ScmHistoryAvatarQueryCommit {
  readonly hash: string;
  readonly authorName?: string;
  readonly authorEmail?: string;
}

export interface ScmHistoryAvatarQuery {
  readonly commits: readonly ScmHistoryAvatarQueryCommit[];
  readonly size: number;
}

export interface ScmHistoryItemCommand {
  readonly id: string;
  readonly title: string;
  readonly arguments?: readonly unknown[];
}

export type ScmHistoryItemDetailsProviderResult<T> =
  | T
  | null
  | undefined
  | Promise<T | null | undefined>;

export interface ScmHistoryItemDetailsProvider {
  provideAvatar?(
    repository: ScmHistoryRepository,
    query: ScmHistoryAvatarQuery,
  ): ScmHistoryItemDetailsProviderResult<Map<string, string | undefined>>;
  provideHoverCommands?(
    repository: ScmHistoryRepository,
  ): ScmHistoryItemDetailsProviderResult<readonly ScmHistoryItemCommand[]>;
  provideMessageLinks?(
    repository: ScmHistoryRepository,
    message: string,
  ): ScmHistoryItemDetailsProviderResult<string>;
}

export interface ScmHistoryItemDetailsProviderRegistry {
  registerScmHistoryItemDetailsProvider(provider: ScmHistoryItemDetailsProvider): () => void;
  getScmHistoryItemDetailsProviders(): readonly ScmHistoryItemDetailsProvider[];
}
