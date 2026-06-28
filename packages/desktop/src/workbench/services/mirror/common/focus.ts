export type FocusKind = 'file' | 'folder';
export type LinePrecision = 'exact' | 'block_start' | 'estimated';

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
