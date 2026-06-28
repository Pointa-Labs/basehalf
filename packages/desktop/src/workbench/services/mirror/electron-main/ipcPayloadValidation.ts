import type {
  AdhdAddKeywordArgs,
  AdhdMarkReadArgs,
  AdhdMarkUnreadArgs,
  AdhdPurgeNodeArgs,
  AdhdRelocateArgs,
  AdhdRemoveKeywordArgs,
  AdhdSetArgs,
  LineRange,
} from '../common/adhd.js';
import type {
  BadgeAddRefArgs,
  BadgeDeleteArgs,
  BadgeGetArgs,
  BadgeKind,
  BadgeListArgs,
  BadgeMarkOrphanArgs,
  BadgeRemoveRefArgs,
  BadgeRenameArgs,
  BadgeSetArgs,
} from '../common/badge.js';
import type {
  CanvasAnchor,
  CanvasCard,
  CanvasConnectArgs,
  CanvasDisconnectArgs,
  CanvasGetArgs,
  CanvasPurgeNodeArgs,
  CanvasReconnectArgs,
  CanvasRelocateArgs,
  CanvasRemoveCardArgs,
  CanvasSetCardArgs,
  CanvasSetSizeArgs,
} from '../common/canvas.js';
import type { FocusPurgeNodeArgs, FocusRelocateArgs, FocusSetArgs } from '../common/focus.js';

type JsonObject = Record<string, unknown>;
type FocusCursor = NonNullable<FocusSetArgs['cursor']>;
type FocusCursorLinePrecision = NonNullable<FocusCursor['line_precision']>;

const BADGE_KINDS: readonly BadgeKind[] = ['file', 'folder'];
const CANVAS_ANCHORS: readonly CanvasAnchor[] = ['north', 'east', 'south', 'west'];
const LINE_PRECISIONS = ['exact', 'block_start', 'estimated'] as const;

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

export function asBadgeGetArgs(payload: unknown): BadgeGetArgs {
  const p = objectPayload(payload, 'badge.get');
  return {
    file: pathField(p, 'file', 'badge.get', { allowEmpty: true }),
    ...optionalKind(p, 'kind', 'badge.get'),
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
      ...optionalKind(patch, 'kind', 'badge.set.patch'),
      ...optionalBoolean(patch, 'orphan', 'badge.set.patch'),
    },
  };
}

export function asBadgeListArgs(payload: unknown): BadgeListArgs {
  const p = optionalObjectPayload(payload, 'badge.list') ?? {};
  return {
    ...optionalKind(p, 'kind', 'badge.list'),
    ...optionalString(p, 'query', 'badge.list'),
  };
}

export function asBadgeDeleteArgs(payload: unknown): BadgeDeleteArgs {
  const p = objectPayload(payload, 'badge.delete');
  return {
    file: pathField(p, 'file', 'badge.delete', { allowEmpty: true }),
    ...optionalKind(p, 'kind', 'badge.delete'),
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
    ...optionalKind(p, 'kind', name),
  };
}

export function asBadgeMarkOrphanArgs(payload: unknown): BadgeMarkOrphanArgs {
  const p = objectPayload(payload, 'badge.markOrphan');
  return {
    file: pathField(p, 'file', 'badge.markOrphan', { allowEmpty: true }),
    ...optionalKind(p, 'kind', 'badge.markOrphan'),
  };
}

export function asBadgeRenameArgs(payload: unknown): BadgeRenameArgs {
  const p = objectPayload(payload, 'badge.rename');
  return {
    from: pathField(p, 'from', 'badge.rename', { allowEmpty: true }),
    to: pathField(p, 'to', 'badge.rename', { allowEmpty: true }),
    ...optionalKind(p, 'kind', 'badge.rename'),
    ...optionalBoolean(p, 'ifExists', 'badge.rename'),
  };
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
    ...optionalKind(p, 'kind', 'canvas.connect'),
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
      ...optionalKind(next, 'kind', 'canvas.reconnect.next'),
    },
  };
}

export function asCanvasRelocateArgs(payload: unknown): CanvasRelocateArgs {
  const p = objectPayload(payload, 'canvas.relocate');
  return {
    from: pathField(p, 'from', 'canvas.relocate', { allowEmpty: false }),
    to: pathField(p, 'to', 'canvas.relocate', { allowEmpty: false }),
    ...optionalKind(p, 'kind', 'canvas.relocate'),
  };
}

export function asCanvasPurgeNodeArgs(payload: unknown): CanvasPurgeNodeArgs {
  const p = objectPayload(payload, 'canvas.purgeNode');
  return {
    path: pathField(p, 'path', 'canvas.purgeNode', { allowEmpty: false }),
    ...optionalKind(p, 'kind', 'canvas.purgeNode'),
  };
}

export function asFocusSetArgs(payload: unknown): FocusSetArgs {
  const p = objectPayload(payload, 'focus.set');
  const path = pathField(p, 'path', 'focus.set', { allowEmpty: true });
  const kind = focusKindField(p, 'kind', 'focus.set');
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

function objectPayload(payload: unknown, name: string): JsonObject {
  return objectValue(payload, name);
}

function optionalObjectPayload(payload: unknown, name: string): JsonObject | undefined {
  if (payload === undefined || payload === null) return undefined;
  return objectValue(payload, name);
}

function objectValue(value: unknown, label: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as JsonObject;
}

function optionalObjectField(
  obj: JsonObject,
  field: string,
  label: string,
): JsonObject | undefined {
  const value = obj[field];
  if (value === undefined) return undefined;
  return objectValue(value, `${label}.${field}`);
}

function pathField(
  obj: JsonObject,
  field: string,
  label: string,
  opts: { allowEmpty: boolean },
): string {
  return pathValue(obj[field], `${label}.${field}`, opts);
}

function pathValue(value: unknown, label: string, opts: { allowEmpty: boolean }): string {
  const path = stringValue(value, label);
  if (path.includes('\0')) throw new Error(`${label} must not contain NUL bytes.`);
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!opts.allowEmpty && (normalized === '' || normalized === '.')) {
    throw new Error(`${label} must name a workspace entry.`);
  }
  if (/^([a-zA-Z]:[\\/]|[\\/])/.test(path)) {
    throw new Error(`${label} must be workspace-relative.`);
  }
  if (normalized.split('/').some((segment) => segment === '..')) {
    throw new Error(`${label} must not contain path traversal.`);
  }
  return path;
}

function folderField(obj: JsonObject, field: string, label: string): string | null {
  const value = obj[field];
  if (value === null) return null;
  if (typeof value === 'string') return pathValue(value, `${label}.${field}`, { allowEmpty: true });
  throw new Error(`${label}.${field} must be a workspace-relative path or null.`);
}

function stringField(obj: JsonObject, field: string, label: string): string {
  return stringValue(obj[field], `${label}.${field}`);
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  return value;
}

function optionalString(obj: JsonObject, field: string, label: string): { [key: string]: string } {
  const value = obj[field];
  if (value === undefined) return {};
  if (typeof value !== 'string') throw new Error(`${label}.${field} must be a string.`);
  return { [field]: value };
}

function optionalStringArray(
  obj: JsonObject,
  field: string,
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
  field: string,
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

function optionalKind(
  obj: JsonObject,
  field: string,
  label: string,
): { readonly kind?: BadgeKind } {
  const value = obj[field];
  if (value === undefined) return {};
  if (typeof value !== 'string' || !BADGE_KINDS.includes(value as BadgeKind)) {
    throw new Error(`${label}.${field} must be "file" or "folder".`);
  }
  return { kind: value as BadgeKind };
}

function focusKindField(obj: JsonObject, field: string, label: string): FocusSetArgs['kind'] {
  const value = obj[field];
  if (value !== 'file' && value !== 'folder') {
    throw new Error(`${label}.${field} must be "file" or "folder".`);
  }
  return value;
}

function anchorField(obj: JsonObject, field: string, label: string): CanvasAnchor {
  const value = obj[field];
  if (typeof value !== 'string' || !CANVAS_ANCHORS.includes(value as CanvasAnchor)) {
    throw new Error(`${label}.${field} must be a valid canvas anchor.`);
  }
  return value as CanvasAnchor;
}

function optionalBoolean(
  obj: JsonObject,
  field: string,
  label: string,
): { [key: string]: boolean } {
  const value = obj[field];
  if (value === undefined) return {};
  if (typeof value !== 'boolean') throw new Error(`${label}.${field} must be a boolean.`);
  return { [field]: value };
}

function positiveIntegerField(obj: JsonObject, field: string, label: string): number {
  return positiveIntegerValue(obj[field], `${label}.${field}`);
}

function positiveIntegerValue(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value as number;
}

function finiteNumberField(obj: JsonObject, field: string, label: string): number {
  const value = obj[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label}.${field} must be a finite number.`);
  }
  return value;
}

function positiveNumberField(obj: JsonObject, field: string, label: string): number {
  const value = finiteNumberField(obj, field, label);
  if (value <= 0) throw new Error(`${label}.${field} must be positive.`);
  return value;
}

function optionalPositiveNumber(
  obj: JsonObject,
  field: string,
  label: string,
): { [key: string]: number } {
  const value = obj[field];
  if (value === undefined) return {};
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label}.${field} must be a positive number.`);
  }
  return { [field]: value };
}

function optionalPoint(
  obj: JsonObject,
  field: string,
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
  field: string,
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

function optionalPositiveInteger(
  obj: JsonObject,
  field: string,
  label: string,
): { [key: string]: number } {
  const value = obj[field];
  if (value === undefined) return {};
  return { [field]: positiveIntegerValue(value, `${label}.${field}`) };
}

function canvasCard(value: unknown, label: string): CanvasCard {
  const card = objectValue(value, label);
  return {
    path: pathField(card, 'path', label, { allowEmpty: false }),
    kind: focusKindField(card, 'kind', label),
    x: finiteNumberField(card, 'x', label),
    y: finiteNumberField(card, 'y', label),
    width: positiveNumberField(card, 'width', label),
    height: positiveNumberField(card, 'height', label),
  };
}
