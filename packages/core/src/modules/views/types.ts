/**
 * Saved view = a named, free-position grouping of badges that need to
 * sit together in their own canvas even though they live in different
 * workspace folders. Implements IR-v2-02 ("compound 重组") — references,
 * not copies. SR-v0 §3.7.
 *
 * On disk: <workspace>/.bh/views/<view-id>.json
 */

export interface ViewMember {
  readonly file: string;
  readonly x?: number;
  readonly y?: number;
  readonly collapsed?: boolean;
}

export interface SavedView {
  readonly bhVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly prompt?: string;
  readonly members: readonly ViewMember[];
  readonly createdAt: string;
  readonly modifiedAt: string;
}

// ── Command args / results ──────────────────────────────────────────────────

export interface ViewCreateArgs {
  readonly name: string;
  readonly id?: string;
  readonly prompt?: string;
}
export type ViewCreateResult = SavedView;

export type ViewListArgs = Record<string, never>;
export interface ViewListResult {
  readonly views: readonly SavedView[];
}

export interface ViewGetArgs {
  readonly id: string;
}
export type ViewGetResult = SavedView | null;

export interface ViewUpdateArgs {
  readonly id: string;
  readonly patch: Partial<Pick<SavedView, 'name' | 'prompt'>>;
}
export type ViewUpdateResult = SavedView;

export interface ViewDeleteArgs {
  readonly id: string;
}
export interface ViewDeleteResult {
  readonly deleted: boolean;
}

export interface ViewAddMemberArgs {
  readonly id: string;
  readonly file: string;
  readonly position?: { readonly x: number; readonly y: number };
  readonly collapsed?: boolean;
}
export type ViewAddMemberResult = SavedView;

export interface ViewRemoveMemberArgs {
  readonly id: string;
  readonly file: string;
}
export type ViewRemoveMemberResult = SavedView;
