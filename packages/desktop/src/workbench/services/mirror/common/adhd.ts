import {
  type JsonObject,
  objectPayload,
  pathField,
  pathValue,
  positiveIntegerField,
  positiveIntegerValue,
  stringField,
  stringValue,
} from './ipcPayloadValidation.js';

export type LineRange = readonly [start: number, end: number];

export interface AdhdFile {
  readonly path: string;
  readonly kind: 'file';
  readonly highlight_keywords?: readonly string[];
  readonly read_paragraphs?: readonly LineRange[];
}

export interface AdhdGetArgs {
  readonly file: string;
}
export type AdhdGetResult = AdhdFile | null;

export interface AdhdSetArgs {
  readonly file: string;
  readonly highlight_keywords?: readonly string[];
  readonly read_paragraphs?: readonly LineRange[];
}

export interface AdhdAddKeywordArgs {
  readonly file: string;
  readonly keyword: string;
}

export interface AdhdRemoveKeywordArgs {
  readonly file: string;
  readonly keyword: string;
}

export interface AdhdMarkReadArgs {
  readonly file: string;
  readonly start: number;
  readonly end: number;
}

export interface AdhdMarkUnreadArgs {
  readonly file: string;
  readonly start: number;
  readonly end: number;
}

export interface AdhdRevisionResult {
  readonly count: number;
  readonly maxMtimeMs: number;
}

export interface AdhdRelocateArgs {
  readonly from: string;
  readonly to: string;
}

export interface AdhdRelocateResult {
  readonly moved: number;
}

export interface AdhdPurgeNodeArgs {
  readonly path: string;
}

export interface AdhdPurgeNodeResult {
  readonly removed: number;
}

export const ADHD_IPC_CHANNELS = {
  get: 'adhd:get',
  set: 'adhd:set',
  addKeyword: 'adhd:add-keyword',
  removeKeyword: 'adhd:remove-keyword',
  markRead: 'adhd:mark-read',
  markUnread: 'adhd:mark-unread',
  revision: 'adhd:revision',
  relocate: 'adhd:relocate',
  purgeNode: 'adhd:purge-node',
} as const;

export type AdhdIpcChannel = (typeof ADHD_IPC_CHANNELS)[keyof typeof ADHD_IPC_CHANNELS];

export interface AdhdChannelBridge {
  get(file: string): Promise<AdhdGetResult>;
  set(args: AdhdSetArgs): Promise<AdhdFile>;
  addKeyword(args: AdhdAddKeywordArgs): Promise<AdhdFile>;
  removeKeyword(args: AdhdRemoveKeywordArgs): Promise<AdhdFile | null>;
  markRead(args: AdhdMarkReadArgs): Promise<AdhdFile>;
  markUnread(args: AdhdMarkUnreadArgs): Promise<AdhdFile | null>;
  revision(): Promise<AdhdRevisionResult>;
  relocate(args: AdhdRelocateArgs): Promise<AdhdRelocateResult>;
  purgeNode(args: AdhdPurgeNodeArgs): Promise<AdhdPurgeNodeResult>;
}

export interface AdhdBridge {
  readonly adhd: AdhdChannelBridge;
}

export interface AdhdService {
  get(file: string): Promise<AdhdFile | null>;
  addKeyword(file: string, keyword: string): Promise<AdhdFile>;
  removeKeyword(file: string, keyword: string): Promise<AdhdFile | null>;
  markRead(
    file: string,
    range: { readonly start: number; readonly end: number },
  ): Promise<AdhdFile>;
  markUnread(
    file: string,
    range: { readonly start: number; readonly end: number },
  ): Promise<AdhdFile | null>;
  set(
    file: string,
    state: {
      readonly highlight_keywords?: readonly string[];
      readonly read_paragraphs?: readonly LineRange[];
    },
  ): Promise<AdhdFile>;
}

export function asAdhdFile(payload: unknown): string {
  return pathValue(payload, 'adhd.get.file', { allowEmpty: false });
}

export function asAdhdSetArgs(payload: unknown): AdhdSetArgs {
  const p = objectPayload(payload, 'adhd.set');
  return {
    file: pathField(p, 'file', 'adhd.set', { allowEmpty: false }),
    ...optionalStringArray(p, 'highlight_keywords', 'adhd.set'),
    ...optionalRanges(p, 'read_paragraphs', 'adhd.set'),
  };
}

export function asAdhdKeywordArgs(
  payload: unknown,
  name: string,
): AdhdAddKeywordArgs | AdhdRemoveKeywordArgs {
  const p = objectPayload(payload, name);
  return {
    file: pathField(p, 'file', name, { allowEmpty: false }),
    keyword: stringField(p, 'keyword', name),
  };
}

export function asAdhdRangeArgs(
  payload: unknown,
  name: string,
): AdhdMarkReadArgs | AdhdMarkUnreadArgs {
  const p = objectPayload(payload, name);
  const start = positiveIntegerField(p, 'start', name);
  const end = positiveIntegerField(p, 'end', name);
  if (end < start) throw new Error(`${name}.end must be greater than or equal to start.`);
  return {
    file: pathField(p, 'file', name, { allowEmpty: false }),
    start,
    end,
  };
}

export function asAdhdRelocateArgs(payload: unknown): AdhdRelocateArgs {
  const p = objectPayload(payload, 'adhd.relocate');
  return {
    from: pathField(p, 'from', 'adhd.relocate', { allowEmpty: false }),
    to: pathField(p, 'to', 'adhd.relocate', { allowEmpty: false }),
  };
}

export function asAdhdPurgeNodeArgs(payload: unknown): AdhdPurgeNodeArgs {
  const p = objectPayload(payload, 'adhd.purgeNode');
  return { path: pathField(p, 'path', 'adhd.purgeNode', { allowEmpty: false }) };
}

function optionalStringArray(
  obj: JsonObject,
  field: 'highlight_keywords',
  label: string,
): { readonly highlight_keywords?: readonly string[] } {
  const value = obj[field];
  if (value === undefined) return {};
  if (!Array.isArray(value)) throw new Error(`${label}.${field} must be an array.`);
  return {
    highlight_keywords: value.map((item, index) =>
      stringValue(item, `${label}.${field}[${index}]`),
    ),
  };
}

function optionalRanges(
  obj: JsonObject,
  field: 'read_paragraphs',
  label: string,
): { readonly read_paragraphs?: readonly LineRange[] } {
  const value = obj[field];
  if (value === undefined) return {};
  if (!Array.isArray(value)) throw new Error(`${label}.${field} must be an array.`);
  return {
    read_paragraphs: value.map((item, index) => lineRange(item, `${label}.${field}[${index}]`)),
  };
}

function lineRange(value: unknown, label: string): LineRange {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`${label} must be a [start, end] pair.`);
  }
  const start = positiveIntegerValue(value[0], `${label}[0]`);
  const end = positiveIntegerValue(value[1], `${label}[1]`);
  if (end < start) throw new Error(`${label}[1] must be greater than or equal to [0].`);
  return [start, end];
}
