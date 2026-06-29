export type CommitAfter = 'push' | 'sync';

export interface CommitActionOptions {
  readonly after?: CommitAfter;
  readonly amend?: boolean;
}

export interface RowAction {
  label: string;
  glyph: string;
  onClick: () => void;
  danger?: boolean;
}
