import {
  type JsonObject,
  finiteNumberField,
  nodeKindField,
  objectPayload,
  objectValue,
  optionalPositiveInteger,
  optionalPositiveNumber,
  pathField,
  positiveIntegerField,
} from './ipcPayloadValidation.js';

export type FocusKind = 'file' | 'folder';
export type LinePrecision = 'exact' | 'block_start' | 'estimated';

const LINE_PRECISIONS = ['exact', 'block_start', 'estimated'] as const;

type FocusCursor = NonNullable<FocusSetArgs['cursor']>;
type FocusCursorLinePrecision = NonNullable<FocusCursor['line_precision']>;

export interface FileFocus {
  readonly path: string;
  readonly kind: 'file';
  readonly visible_lines?: { readonly start: number };
  readonly visible_blocks?: { readonly start: number };
  readonly cursor?: {
    readonly line: number;
    readonly column: number;
    readonly line_precision?: LinePrecision;
    readonly block?: number;
  };
}

export interface FolderFocus {
  readonly path: string;
  readonly kind: 'folder';
  readonly viewport_center?: { readonly x: number; readonly y: number };
  readonly zoom?: number;
}

export type FocusNode = FileFocus | FolderFocus;

export interface FocusSetArgs {
  readonly path: string;
  readonly kind: FocusKind;
  readonly visible_lines?: { readonly start: number };
  readonly visible_blocks?: { readonly start: number };
  readonly cursor?: {
    readonly line: number;
    readonly column: number;
    readonly line_precision?: LinePrecision;
    readonly block?: number;
  };
  readonly viewport_center?: { readonly x: number; readonly y: number };
  readonly zoom?: number;
}

export type FocusGetResult = FocusNode | null;

export interface FocusClearResult {
  readonly cleared: boolean;
}

export interface FocusPruneDanglingResult {
  readonly cleared: boolean;
}

export interface FocusRelocateArgs {
  readonly from: string;
  readonly to: string;
}

export interface FocusRelocateResult {
  readonly moved: number;
  readonly repointed: boolean;
}

export interface FocusPurgeNodeArgs {
  readonly path: string;
}

export interface FocusPurgeNodeResult {
  readonly removed: number;
  readonly cleared: boolean;
}

export const FOCUS_IPC_CHANNELS = {
  set: 'focus:set',
  get: 'focus:get',
  clear: 'focus:clear',
  pruneDangling: 'focus:prune-dangling',
  relocate: 'focus:relocate',
  purgeNode: 'focus:purge-node',
} as const;

export type FocusIpcChannel = (typeof FOCUS_IPC_CHANNELS)[keyof typeof FOCUS_IPC_CHANNELS];

export interface FocusChannelBridge {
  set(args: FocusSetArgs): Promise<FocusNode>;
  get(): Promise<FocusGetResult>;
  clear(): Promise<FocusClearResult>;
  pruneDangling(): Promise<FocusPruneDanglingResult>;
  relocate(args: FocusRelocateArgs): Promise<FocusRelocateResult>;
  purgeNode(args: FocusPurgeNodeArgs): Promise<FocusPurgeNodeResult>;
}

export interface FocusBridge {
  readonly focus: FocusChannelBridge;
}

export interface FocusService {
  set(args: FocusSetArgs): Promise<FocusNode>;
  pruneDangling(): Promise<FocusPruneDanglingResult>;
}

export function asFocusSetArgs(payload: unknown): FocusSetArgs {
  const p = objectPayload(payload, 'focus.set');
  const path = pathField(p, 'path', 'focus.set', { allowEmpty: true });
  const kind = nodeKindField(p, 'kind', 'focus.set');
  if (kind === 'folder') {
    return {
      path,
      kind,
      ...optionalPoint(p, 'viewport_center', 'focus.set'),
      ...optionalPositiveNumber(p, 'zoom', 'focus.set'),
    };
  }
  return {
    path,
    kind,
    ...optionalStartObject(p, 'visible_lines', 'focus.set'),
    ...optionalStartObject(p, 'visible_blocks', 'focus.set'),
    ...optionalCursor(p, 'cursor', 'focus.set'),
  };
}

export function asFocusRelocateArgs(payload: unknown): FocusRelocateArgs {
  const p = objectPayload(payload, 'focus.relocate');
  return {
    from: pathField(p, 'from', 'focus.relocate', { allowEmpty: false }),
    to: pathField(p, 'to', 'focus.relocate', { allowEmpty: false }),
  };
}

export function asFocusPurgeNodeArgs(payload: unknown): FocusPurgeNodeArgs {
  const p = objectPayload(payload, 'focus.purgeNode');
  return { path: pathField(p, 'path', 'focus.purgeNode', { allowEmpty: false }) };
}

function optionalPoint(
  obj: JsonObject,
  field: 'viewport_center',
  label: string,
): { readonly viewport_center?: { readonly x: number; readonly y: number } } {
  const value = obj[field];
  if (value === undefined) return {};
  const point = objectValue(value, `${label}.${field}`);
  return {
    viewport_center: {
      x: finiteNumberField(point, 'x', `${label}.${field}`),
      y: finiteNumberField(point, 'y', `${label}.${field}`),
    },
  };
}

function optionalStartObject(
  obj: JsonObject,
  field: 'visible_lines' | 'visible_blocks',
  label: string,
): {
  readonly visible_lines?: { readonly start: number };
  readonly visible_blocks?: { readonly start: number };
} {
  const value = obj[field];
  if (value === undefined) return {};
  const start = objectValue(value, `${label}.${field}`);
  return { [field]: { start: positiveIntegerField(start, 'start', `${label}.${field}`) } };
}

function optionalCursor(
  obj: JsonObject,
  field: 'cursor',
  label: string,
): { readonly cursor?: FocusCursor } {
  const value = obj[field];
  if (value === undefined) return {};
  const cursor = objectValue(value, `${label}.${field}`);
  const precision = cursor.line_precision;
  if (
    precision !== undefined &&
    (typeof precision !== 'string' ||
      !LINE_PRECISIONS.includes(precision as (typeof LINE_PRECISIONS)[number]))
  ) {
    throw new Error(`${label}.${field}.line_precision is invalid.`);
  }
  return {
    cursor: {
      line: positiveIntegerField(cursor, 'line', `${label}.${field}`),
      column: positiveIntegerField(cursor, 'column', `${label}.${field}`),
      ...(precision !== undefined && {
        line_precision: precision as FocusCursorLinePrecision,
      }),
      ...optionalPositiveInteger(cursor, 'block', `${label}.${field}`),
    },
  };
}
