import {
  type JsonObject,
  finiteNumberField,
  folderField,
  nodeKindField,
  objectPayload,
  objectValue,
  optionalNodeKind,
  optionalString,
  pathField,
  positiveNumberField,
} from './ipcPayloadValidation.js';

export type CanvasAnchor = 'north' | 'east' | 'south' | 'west';

const CANVAS_ANCHORS: readonly CanvasAnchor[] = ['north', 'east', 'south', 'west'];

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

export interface CanvasBridge {
  readonly canvas: CanvasChannelBridge;
}

export interface CanvasMirrorService {
  setCard(folder: string | null, card: CanvasCard): Promise<CanvasFile>;
  connect(args: CanvasConnectArgs): Promise<CanvasFile>;
  disconnect(args: CanvasDisconnectArgs): Promise<CanvasFile>;
  reconnect(args: CanvasReconnectArgs): Promise<CanvasFile>;
}

export function asCanvasGetArgs(payload: unknown): CanvasGetArgs {
  const p = objectPayload(payload, 'canvas.get');
  return { folder: folderField(p, 'folder', 'canvas.get') };
}

export function asCanvasSetCardArgs(payload: unknown): CanvasSetCardArgs {
  const p = objectPayload(payload, 'canvas.setCard');
  return {
    folder: folderField(p, 'folder', 'canvas.setCard'),
    card: canvasCard(p.card, 'canvas.setCard.card'),
  };
}

export function asCanvasRemoveCardArgs(payload: unknown): CanvasRemoveCardArgs {
  const p = objectPayload(payload, 'canvas.removeCard');
  return {
    folder: folderField(p, 'folder', 'canvas.removeCard'),
    path: pathField(p, 'path', 'canvas.removeCard', { allowEmpty: false }),
  };
}

export function asCanvasSetSizeArgs(payload: unknown): CanvasSetSizeArgs {
  const p = objectPayload(payload, 'canvas.setSize');
  const size = objectValue(p.size, 'canvas.setSize.size');
  return {
    folder: folderField(p, 'folder', 'canvas.setSize'),
    size: {
      width: positiveNumberField(size, 'width', 'canvas.setSize.size'),
      height: positiveNumberField(size, 'height', 'canvas.setSize.size'),
    },
  };
}

export function asCanvasConnectArgs(payload: unknown): CanvasConnectArgs {
  const p = objectPayload(payload, 'canvas.connect');
  return {
    folder: folderField(p, 'folder', 'canvas.connect'),
    from: pathField(p, 'from', 'canvas.connect', { allowEmpty: false }),
    to: pathField(p, 'to', 'canvas.connect', { allowEmpty: false }),
    from_anchor: anchorField(p, 'from_anchor', 'canvas.connect'),
    to_anchor: anchorField(p, 'to_anchor', 'canvas.connect'),
    ...optionalString(p, 'label', 'canvas.connect'),
    ...optionalNodeKind(p, 'kind', 'canvas.connect'),
  };
}

export function asCanvasDisconnectArgs(payload: unknown): CanvasDisconnectArgs {
  const p = objectPayload(payload, 'canvas.disconnect');
  return {
    folder: folderField(p, 'folder', 'canvas.disconnect'),
    from: pathField(p, 'from', 'canvas.disconnect', { allowEmpty: false }),
    to: pathField(p, 'to', 'canvas.disconnect', { allowEmpty: false }),
  };
}

export function asCanvasReconnectArgs(payload: unknown): CanvasReconnectArgs {
  const p = objectPayload(payload, 'canvas.reconnect');
  const previous = objectValue(p.previous, 'canvas.reconnect.previous');
  const next = objectValue(p.next, 'canvas.reconnect.next');
  return {
    folder: folderField(p, 'folder', 'canvas.reconnect'),
    previous: {
      from: pathField(previous, 'from', 'canvas.reconnect.previous', { allowEmpty: false }),
      to: pathField(previous, 'to', 'canvas.reconnect.previous', { allowEmpty: false }),
    },
    next: {
      from: pathField(next, 'from', 'canvas.reconnect.next', { allowEmpty: false }),
      to: pathField(next, 'to', 'canvas.reconnect.next', { allowEmpty: false }),
      from_anchor: anchorField(next, 'from_anchor', 'canvas.reconnect.next'),
      to_anchor: anchorField(next, 'to_anchor', 'canvas.reconnect.next'),
      ...optionalString(next, 'label', 'canvas.reconnect.next'),
      ...optionalNodeKind(next, 'kind', 'canvas.reconnect.next'),
    },
  };
}

export function asCanvasRelocateArgs(payload: unknown): CanvasRelocateArgs {
  const p = objectPayload(payload, 'canvas.relocate');
  return {
    from: pathField(p, 'from', 'canvas.relocate', { allowEmpty: false }),
    to: pathField(p, 'to', 'canvas.relocate', { allowEmpty: false }),
    ...optionalNodeKind(p, 'kind', 'canvas.relocate'),
  };
}

export function asCanvasPurgeNodeArgs(payload: unknown): CanvasPurgeNodeArgs {
  const p = objectPayload(payload, 'canvas.purgeNode');
  return {
    path: pathField(p, 'path', 'canvas.purgeNode', { allowEmpty: false }),
    ...optionalNodeKind(p, 'kind', 'canvas.purgeNode'),
  };
}

function anchorField(obj: JsonObject, field: string, label: string): CanvasAnchor {
  const value = obj[field];
  if (typeof value !== 'string' || !CANVAS_ANCHORS.includes(value as CanvasAnchor)) {
    throw new Error(`${label}.${field} must be a valid canvas anchor.`);
  }
  return value as CanvasAnchor;
}

function canvasCard(value: unknown, label: string): CanvasCard {
  const card = objectValue(value, label);
  return {
    path: pathField(card, 'path', label, { allowEmpty: false }),
    kind: nodeKindField(card, 'kind', label),
    x: finiteNumberField(card, 'x', label),
    y: finiteNumberField(card, 'y', label),
    width: positiveNumberField(card, 'width', label),
    height: positiveNumberField(card, 'height', label),
  };
}
