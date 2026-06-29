export type RemoteSourceUrl = string | readonly string[];

export interface RemoteSource {
  readonly name: string;
  readonly description?: string;
  readonly detail?: string;
  readonly icon?: string;
  readonly url: RemoteSourceUrl;
}

export interface RemoteSourceBranch {
  readonly name: string;
  readonly isDefault?: boolean;
}

export interface RemoteSourceAction {
  readonly label: string;
  readonly icon: string;
  run(branch: string): void;
}

export type RemoteSourceProviderResult<T> = T | Promise<T>;

export interface RemoteSourceProvider {
  readonly id: string;
  readonly name: string;
  readonly icon?: string;
  readonly label?: string;
  readonly placeholder?: string;
  readonly supportsQuery?: boolean;

  getRemoteSources(query?: string): RemoteSourceProviderResult<readonly RemoteSource[]>;
  getBranches?(remoteUrl: string): RemoteSourceProviderResult<readonly RemoteSourceBranch[]>;
  getRemoteSourceActions?(
    remoteUrl: string,
  ): RemoteSourceProviderResult<readonly RemoteSourceAction[]>;
}

export interface RemoteSourcesByProvider {
  readonly provider: RemoteSourceProvider;
  readonly sources: readonly RemoteSource[];
}
