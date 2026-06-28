export type CanvasAnchor = 'north' | 'east' | 'south' | 'west';

export interface CanvasSize {
  readonly width: number;
  readonly height: number;
}

export interface CanvasCard {
  readonly path: string;
  readonly kind: 'file' | 'folder';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CanvasEdge {
  readonly from: string;
  readonly from_anchor: CanvasAnchor;
  readonly to: string;
  readonly to_anchor: CanvasAnchor;
  readonly label?: string;
}

export interface CanvasFile {
  readonly path: string;
  readonly size?: CanvasSize;
  readonly cards: readonly CanvasCard[];
  readonly edges: readonly CanvasEdge[];
}

export interface CanvasGetArgs {
  readonly folder: string | null;
}
export type CanvasGetResult = CanvasFile | null;

export interface CanvasSetCardArgs {
  readonly folder: string | null;
  readonly card: CanvasCard;
}

export interface CanvasRemoveCardArgs {
  readonly folder: string | null;
  readonly path: string;
}

export interface CanvasRemoveCardResult {
  readonly removed: boolean;
}

export interface CanvasSetSizeArgs {
  readonly folder: string | null;
  readonly size: CanvasSize;
}

export interface CanvasConnectArgs {
  readonly folder: string | null;
  readonly from: string;
  readonly to: string;
  readonly from_anchor: CanvasAnchor;
  readonly to_anchor: CanvasAnchor;
  readonly label?: string;
  readonly kind?: 'file' | 'folder';
}

export interface CanvasDisconnectArgs {
  readonly folder: string | null;
  readonly from: string;
  readonly to: string;
}

export interface CanvasReconnectArgs {
  readonly folder: string | null;
  readonly previous: { readonly from: string; readonly to: string };
  readonly next: {
    readonly from: string;
    readonly to: string;
    readonly from_anchor: CanvasAnchor;
    readonly to_anchor: CanvasAnchor;
    readonly label?: string;
    readonly kind?: 'file' | 'folder';
  };
}

export interface CanvasRevisionResult {
  readonly count: number;
  readonly maxMtimeMs: number;
}

export interface CanvasRelocateArgs {
  readonly from: string;
  readonly to: string;
  readonly kind?: 'file' | 'folder';
}

export interface CanvasRelocateResult {
  readonly moved: number;
}

export interface CanvasPurgeNodeArgs {
  readonly path: string;
  readonly kind?: 'file' | 'folder';
}

export interface CanvasPurgeNodeResult {
  readonly removed: number;
}

export const CANVAS_IPC_CHANNELS = {
  get: 'canvas:get',
  setCard: 'canvas:set-card',
  removeCard: 'canvas:remove-card',
  setSize: 'canvas:set-size',
  connect: 'canvas:connect',
  disconnect: 'canvas:disconnect',
  reconnect: 'canvas:reconnect',
  revision: 'canvas:revision',
  relocate: 'canvas:relocate',
  purgeNode: 'canvas:purge-node',
} as const;

export type CanvasIpcChannel = (typeof CANVAS_IPC_CHANNELS)[keyof typeof CANVAS_IPC_CHANNELS];

export interface CanvasChannelBridge {
  get(args: CanvasGetArgs): Promise<CanvasGetResult>;
  setCard(args: CanvasSetCardArgs): Promise<CanvasFile>;
  removeCard(args: CanvasRemoveCardArgs): Promise<CanvasRemoveCardResult>;
  setSize(args: CanvasSetSizeArgs): Promise<CanvasFile>;
  connect(args: CanvasConnectArgs): Promise<CanvasFile>;
  disconnect(args: CanvasDisconnectArgs): Promise<CanvasFile>;
  reconnect(args: CanvasReconnectArgs): Promise<CanvasFile>;
  revision(): Promise<CanvasRevisionResult>;
  relocate(args: CanvasRelocateArgs): Promise<CanvasRelocateResult>;
  purgeNode(args: CanvasPurgeNodeArgs): Promise<CanvasPurgeNodeResult>;
}
