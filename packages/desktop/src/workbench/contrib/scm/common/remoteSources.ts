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

export interface RemoteSourceProvider {
  readonly id: string;
  readonly name: string;
  readonly icon?: string;
  readonly label?: string;
  readonly placeholder?: string;
  readonly supportsQuery?: boolean;

  getRemoteSources(query?: string): Promise<readonly RemoteSource[]>;
  getBranches?(remoteUrl: string): Promise<readonly RemoteSourceBranch[]>;
}

export interface RemoteSourcesByProvider {
  readonly provider: RemoteSourceProvider;
  readonly sources: readonly RemoteSource[];
}
