import {
  objectPayload,
  optionalBoolean,
  optionalNodeKind,
  optionalObjectField,
  optionalObjectPayload,
  optionalString,
  pathField,
} from './ipcPayloadValidation.js';

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

export interface BadgeBridge {
  readonly badge: BadgeChannelBridge;
}

export interface BadgeService {
  get(file: string, kind?: BadgeKind): Promise<BadgeGetResult>;
  set(file: string, patch?: BadgePatch): Promise<BadgeFile>;
  list(args?: { readonly kind?: BadgeKind; readonly query?: string }): Promise<
    readonly BadgeFile[]
  >;
  addReference(file: string, to: string, kind?: BadgeKind): Promise<BadgeFile>;
  removeReference(file: string, to: string, kind?: BadgeKind): Promise<BadgeFile>;
  pruneDangling(): Promise<BadgePruneDanglingResult>;
  revision(): Promise<BadgeRevisionResult>;
}

export function asBadgeGetArgs(payload: unknown): BadgeGetArgs {
  const p = objectPayload(payload, 'badge.get');
  return {
    file: pathField(p, 'file', 'badge.get', { allowEmpty: true }),
    ...optionalNodeKind(p, 'kind', 'badge.get'),
  };
}

export function asBadgeSetArgs(payload: unknown): BadgeSetArgs {
  const p = objectPayload(payload, 'badge.set');
  const patch = optionalObjectField(p, 'patch', 'badge.set');
  if (patch === undefined) {
    return { file: pathField(p, 'file', 'badge.set', { allowEmpty: true }) };
  }
  return {
    file: pathField(p, 'file', 'badge.set', { allowEmpty: true }),
    patch: {
      ...optionalString(patch, 'description', 'badge.set.patch'),
      ...optionalNodeKind(patch, 'kind', 'badge.set.patch'),
      ...optionalBoolean(patch, 'orphan', 'badge.set.patch'),
    },
  };
}

export function asBadgeListArgs(payload: unknown): BadgeListArgs {
  const p = optionalObjectPayload(payload, 'badge.list') ?? {};
  return {
    ...optionalNodeKind(p, 'kind', 'badge.list'),
    ...optionalString(p, 'query', 'badge.list'),
  };
}

export function asBadgeDeleteArgs(payload: unknown): BadgeDeleteArgs {
  const p = objectPayload(payload, 'badge.delete');
  return {
    file: pathField(p, 'file', 'badge.delete', { allowEmpty: true }),
    ...optionalNodeKind(p, 'kind', 'badge.delete'),
  };
}

export function asBadgeRefArgs(
  payload: unknown,
  name: string,
): BadgeAddRefArgs | BadgeRemoveRefArgs {
  const p = objectPayload(payload, name);
  return {
    file: pathField(p, 'file', name, { allowEmpty: true }),
    to: pathField(p, 'to', name, { allowEmpty: true }),
    ...optionalNodeKind(p, 'kind', name),
  };
}

export function asBadgeMarkOrphanArgs(payload: unknown): BadgeMarkOrphanArgs {
  const p = objectPayload(payload, 'badge.markOrphan');
  return {
    file: pathField(p, 'file', 'badge.markOrphan', { allowEmpty: true }),
    ...optionalNodeKind(p, 'kind', 'badge.markOrphan'),
  };
}

export function asBadgeRenameArgs(payload: unknown): BadgeRenameArgs {
  const p = objectPayload(payload, 'badge.rename');
  return {
    from: pathField(p, 'from', 'badge.rename', { allowEmpty: true }),
    to: pathField(p, 'to', 'badge.rename', { allowEmpty: true }),
    ...optionalNodeKind(p, 'kind', 'badge.rename'),
    ...optionalBoolean(p, 'ifExists', 'badge.rename'),
  };
}
