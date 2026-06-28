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
