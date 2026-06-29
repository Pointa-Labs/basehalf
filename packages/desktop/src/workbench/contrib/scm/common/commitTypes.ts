export type CommitAfter = 'push' | 'sync';

export interface CommitActionOptions {
  readonly after?: CommitAfter;
  readonly amend?: boolean;
}
