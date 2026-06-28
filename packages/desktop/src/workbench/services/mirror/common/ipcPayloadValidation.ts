export type JsonObject = Record<string, unknown>;
export type MirrorNodeKind = 'file' | 'folder';

const MIRROR_NODE_KINDS: readonly MirrorNodeKind[] = ['file', 'folder'];

export function objectPayload(payload: unknown, name: string): JsonObject {
  return objectValue(payload, name);
}

export function optionalObjectPayload(payload: unknown, name: string): JsonObject | undefined {
  if (payload === undefined || payload === null) return undefined;
  return objectValue(payload, name);
}

export function objectValue(value: unknown, label: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as JsonObject;
}

export function optionalObjectField(
  obj: JsonObject,
  field: string,
  label: string,
): JsonObject | undefined {
  const value = obj[field];
  if (value === undefined) return undefined;
  return objectValue(value, `${label}.${field}`);
}

export function pathField(
  obj: JsonObject,
  field: string,
  label: string,
  opts: { allowEmpty: boolean },
): string {
  return pathValue(obj[field], `${label}.${field}`, opts);
}

export function pathValue(value: unknown, label: string, opts: { allowEmpty: boolean }): string {
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

export function folderField(obj: JsonObject, field: string, label: string): string | null {
  const value = obj[field];
  if (value === null) return null;
  if (typeof value === 'string') return pathValue(value, `${label}.${field}`, { allowEmpty: true });
  throw new Error(`${label}.${field} must be a workspace-relative path or null.`);
}

export function stringField(obj: JsonObject, field: string, label: string): string {
  return stringValue(obj[field], `${label}.${field}`);
}

export function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  return value;
}

export function optionalString<T extends string>(
  obj: JsonObject,
  field: T,
  label: string,
): { readonly [K in T]?: string } {
  const value = obj[field];
  if (value === undefined) return {};
  if (typeof value !== 'string') throw new Error(`${label}.${field} must be a string.`);
  return { [field]: value } as { readonly [K in T]?: string };
}

export function optionalNodeKind<T extends string>(
  obj: JsonObject,
  field: T,
  label: string,
): { readonly [K in T]?: MirrorNodeKind } {
  const value = obj[field];
  if (value === undefined) return {};
  if (!isMirrorNodeKind(value)) {
    throw new Error(`${label}.${field} must be "file" or "folder".`);
  }
  return { [field]: value } as { readonly [K in T]?: MirrorNodeKind };
}

export function nodeKindField(obj: JsonObject, field: string, label: string): MirrorNodeKind {
  const value = obj[field];
  if (!isMirrorNodeKind(value)) {
    throw new Error(`${label}.${field} must be "file" or "folder".`);
  }
  return value;
}

export function optionalBoolean<T extends string>(
  obj: JsonObject,
  field: T,
  label: string,
): { readonly [K in T]?: boolean } {
  const value = obj[field];
  if (value === undefined) return {};
  if (typeof value !== 'boolean') throw new Error(`${label}.${field} must be a boolean.`);
  return { [field]: value } as { readonly [K in T]?: boolean };
}

export function positiveIntegerField(obj: JsonObject, field: string, label: string): number {
  return positiveIntegerValue(obj[field], `${label}.${field}`);
}

export function positiveIntegerValue(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value as number;
}

export function finiteNumberField(obj: JsonObject, field: string, label: string): number {
  const value = obj[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label}.${field} must be a finite number.`);
  }
  return value;
}

export function positiveNumberField(obj: JsonObject, field: string, label: string): number {
  const value = finiteNumberField(obj, field, label);
  if (value <= 0) throw new Error(`${label}.${field} must be positive.`);
  return value;
}

export function optionalPositiveNumber<T extends string>(
  obj: JsonObject,
  field: T,
  label: string,
): { readonly [K in T]?: number } {
  const value = obj[field];
  if (value === undefined) return {};
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label}.${field} must be a positive number.`);
  }
  return { [field]: value } as { readonly [K in T]?: number };
}

export function optionalPositiveInteger<T extends string>(
  obj: JsonObject,
  field: T,
  label: string,
): { readonly [K in T]?: number } {
  const value = obj[field];
  if (value === undefined) return {};
  return { [field]: positiveIntegerValue(value, `${label}.${field}`) } as {
    readonly [K in T]?: number;
  };
}

function isMirrorNodeKind(value: unknown): value is MirrorNodeKind {
  return typeof value === 'string' && MIRROR_NODE_KINDS.includes(value as MirrorNodeKind);
}
