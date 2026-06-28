export type BadgeKind = 'file' | 'folder';

export interface BadgeFile {
  readonly path: string;
  readonly kind: BadgeKind;
  readonly description?: string;
  readonly references: readonly string[];
  readonly referenced_by?: readonly string[];
  readonly orphan?: boolean;
}

export interface BadgeGetArgs {
  readonly file: string;
  readonly kind?: BadgeKind;
}
export type BadgeGetResult = BadgeFile | null;

export type BadgePatch = Partial<Pick<BadgeFile, 'description'>> & {
  readonly kind?: BadgeKind;
  readonly orphan?: boolean;
};

export interface BadgeSetArgs {
  readonly file: string;
  readonly patch?: BadgePatch;
}

export interface BadgeListArgs {
  readonly kind?: BadgeKind;
  readonly query?: string;
}

export interface BadgeListResult {
  readonly badges: readonly BadgeFile[];
}

export interface BadgeDeleteArgs {
  readonly file: string;
  readonly kind?: BadgeKind;
}

export interface BadgeDeleteResult {
  readonly deleted: boolean;
}

export interface BadgeAddRefArgs {
  readonly file: string;
  readonly to: string;
  readonly kind?: BadgeKind;
}

export interface BadgeRemoveRefArgs {
  readonly file: string;
  readonly to: string;
  readonly kind?: BadgeKind;
}

export interface BadgeMarkOrphanArgs {
  readonly file: string;
  readonly kind?: BadgeKind;
}
export type BadgeMarkOrphanResult = BadgeFile | null;

export interface BadgeRenameArgs {
  readonly from: string;
  readonly to: string;
  readonly kind?: BadgeKind;
  readonly ifExists?: boolean;
}

export interface BadgeRenameResult {
  readonly badge: BadgeFile | null;
  readonly updatedRefs: readonly string[];
  readonly focusUpdated: boolean;
}

export interface BadgeRevisionResult {
  readonly count: number;
  readonly maxMtimeMs: number;
}

export interface BadgePruneDanglingResult {
  readonly orphaned: readonly string[];
}

export const BADGE_IPC_CHANNELS = {
  get: 'badge:get',
  set: 'badge:set',
  list: 'badge:list',
  delete: 'badge:delete',
  addRef: 'badge:add-ref',
  removeRef: 'badge:remove-ref',
  markOrphan: 'badge:mark-orphan',
  pruneDangling: 'badge:prune-dangling',
  revision: 'badge:revision',
  rename: 'badge:rename',
} as const;

export type BadgeIpcChannel = (typeof BADGE_IPC_CHANNELS)[keyof typeof BADGE_IPC_CHANNELS];

export interface BadgeChannelBridge {
  get(args: BadgeGetArgs): Promise<BadgeGetResult>;
  set(args: BadgeSetArgs): Promise<BadgeFile>;
  list(args?: BadgeListArgs): Promise<BadgeListResult>;
  delete(args: BadgeDeleteArgs): Promise<BadgeDeleteResult>;
  addRef(args: BadgeAddRefArgs): Promise<BadgeFile>;
  removeRef(args: BadgeRemoveRefArgs): Promise<BadgeFile>;
  markOrphan(args: BadgeMarkOrphanArgs): Promise<BadgeMarkOrphanResult>;
  pruneDangling(): Promise<BadgePruneDanglingResult>;
  revision(): Promise<BadgeRevisionResult>;
  rename(args: BadgeRenameArgs): Promise<BadgeRenameResult>;
}
