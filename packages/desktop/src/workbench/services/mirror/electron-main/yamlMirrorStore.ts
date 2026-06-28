import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, stat, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import { parse, stringify } from 'yaml';
import { createKeyedMutex } from '../../../../platform/async/common/keyedMutex.js';

export type MirrorKind = 'badge' | 'canvas' | 'focus' | 'adhd';

const MIRROR_DIR = '.bh/mirror';

export class PathEscape extends Error {
  override readonly name = 'PathEscape';

  constructor(public readonly rel: string) {
    super(`Refusing to access a path outside the workspace: ${rel}`);
  }
}

export class MirrorCorrupt extends Error {
  override readonly name = 'MirrorCorrupt';

  constructor(
    public readonly rel: string,
    public readonly kind: MirrorKind,
    opts?: { cause?: unknown },
  ) {
    super(`Corrupt ${kind}.yaml for "${rel || '<root>'}"`, opts);
  }
}

const withMirrorLock = createKeyedMutex();

export class YamlMirrorStore {
  read<T = unknown>(workspaceRoot: string, rel: string, kind: MirrorKind): Promise<T | null> {
    return readMirror<T>(workspaceRoot, rel, kind);
  }

  write<T>(workspaceRoot: string, rel: string, kind: MirrorKind, data: T): Promise<void> {
    return writeMirror(workspaceRoot, rel, kind, data);
  }

  patch<T>(
    workspaceRoot: string,
    rel: string,
    kind: MirrorKind,
    patch: (current: T | null) => T | null,
  ): Promise<T | null> {
    return patchMirror(workspaceRoot, rel, kind, patch);
  }

  remove(workspaceRoot: string, rel: string, kind: MirrorKind): Promise<boolean> {
    return removeMirror(workspaceRoot, rel, kind);
  }

  list<T = unknown>(
    workspaceRoot: string,
    kind: MirrorKind,
  ): Promise<Array<{ rel: string; data: T }>> {
    return listMirror<T>(workspaceRoot, kind);
  }

  revision(
    workspaceRoot: string,
    kind: MirrorKind,
  ): Promise<{ count: number; maxMtimeMs: number }> {
    return mirrorRevision(workspaceRoot, kind);
  }

  relocateKind<T extends { path: string }>(
    workspaceRoot: string,
    kind: MirrorKind,
    from: string,
    to: string,
    remap?: (data: T, newRel: string) => T,
  ): Promise<Array<{ from: string; to: string }>> {
    return relocateMirrorKind(workspaceRoot, kind, from, to, remap);
  }

  purgeKind(workspaceRoot: string, kind: MirrorKind, path: string): Promise<number> {
    return purgeMirrorKind(workspaceRoot, kind, path);
  }
}

export function mirrorPath(workspaceRoot: string, rel: string, kind: MirrorKind): string {
  return join(mirrorNodeDir(workspaceRoot, rel), `${kind}.yaml`);
}

export function mirrorNodeDir(workspaceRoot: string, rel: string): string {
  const norm = normalizeRel(rel);
  return norm ? join(workspaceRoot, MIRROR_DIR, norm) : join(workspaceRoot, MIRROR_DIR);
}

export function isMirrorSubtree(rel: string, root: string): boolean {
  return rel === root || rel.startsWith(`${root}/`);
}

export function remapSubtreeRel(rel: string, from: string, to: string): string {
  return rel === from ? to : `${to}${rel.slice(from.length)}`;
}

export async function assertReadContained(root: string, lexicalPath: string): Promise<string> {
  const realRoot = await canonicalize(root);
  const real = await canonicalize(lexicalPath);
  if (!isContained(realRoot, real)) {
    throw new PathEscape(relLabel(root, lexicalPath));
  }
  return real;
}

export async function assertWriteContained(root: string, lexicalPath: string): Promise<string> {
  const realRoot = await canonicalize(root);
  const realParent = await canonicalize(dirname(lexicalPath));
  if (!isContained(realRoot, realParent)) {
    throw new PathEscape(relLabel(root, lexicalPath));
  }
  const leaf = join(realParent, basename(lexicalPath));
  const ls = await lstat(leaf).catch((err: unknown) => {
    if (isENOENT(err)) return null;
    throw err;
  });
  if (ls?.isSymbolicLink()) {
    throw new PathEscape(relLabel(root, lexicalPath));
  }
  return leaf;
}

export async function readNoFollow(abs: string): Promise<string | null> {
  let fh: Awaited<ReturnType<typeof open>>;
  try {
    fh = await open(abs, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (err) {
    if (isENOENT(err)) return null;
    if (isELOOP(err)) throw new PathEscape(abs);
    throw err;
  }
  try {
    return await fh.readFile('utf8');
  } finally {
    await fh.close();
  }
}

export async function writeNoFollow(abs: string, content: string): Promise<void> {
  let fh: Awaited<ReturnType<typeof open>>;
  try {
    fh = await open(
      abs,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
    );
  } catch (err) {
    if (isELOOP(err)) throw new PathEscape(abs);
    throw err;
  }
  try {
    await fh.writeFile(content, 'utf8');
  } finally {
    await fh.close();
  }
}

async function readMirror<T = unknown>(
  workspaceRoot: string,
  rel: string,
  kind: MirrorKind,
): Promise<T | null> {
  const path = await assertMirrorReadContained(workspaceRoot, rel, kind);
  const raw = await readNoFollow(path);
  if (raw === null) return null;
  try {
    return (parse(raw) ?? null) as T | null;
  } catch (cause) {
    throw new MirrorCorrupt(normalizeRel(rel), kind, { cause });
  }
}

async function writeMirror<T>(
  workspaceRoot: string,
  rel: string,
  kind: MirrorKind,
  data: T,
): Promise<void> {
  const lexical = mirrorPath(workspaceRoot, rel, kind);
  await withMirrorLock(lexical, async () => {
    const path = await assertMirrorWriteContained(workspaceRoot, lexical);
    await mkdir(dirname(path), { recursive: true });
    await writeNoFollow(path, serialize(data));
  });
}

async function patchMirror<T>(
  workspaceRoot: string,
  rel: string,
  kind: MirrorKind,
  patch: (current: T | null) => T | null,
): Promise<T | null> {
  const lexical = mirrorPath(workspaceRoot, rel, kind);
  return withMirrorLock(lexical, async () => {
    const readPath = await assertMirrorReadPath(workspaceRoot, lexical);
    const raw = await readNoFollow(readPath);
    let current: T | null = null;
    if (raw !== null) {
      try {
        current = (parse(raw) ?? null) as T | null;
      } catch (cause) {
        throw new MirrorCorrupt(normalizeRel(rel), kind, { cause });
      }
    }
    const next = patch(current);
    const writePath = await assertMirrorWriteContained(workspaceRoot, lexical);
    if (next === null) {
      if (await exists(writePath)) await unlink(writePath);
    } else {
      await mkdir(dirname(writePath), { recursive: true });
      await writeNoFollow(writePath, serialize(next));
    }
    return next;
  });
}

async function removeMirror(
  workspaceRoot: string,
  rel: string,
  kind: MirrorKind,
): Promise<boolean> {
  const lexical = mirrorPath(workspaceRoot, rel, kind);
  return withMirrorLock(lexical, async () => {
    const path = await assertMirrorWriteContained(workspaceRoot, lexical);
    if (!(await exists(path))) return false;
    await unlink(path);
    return true;
  });
}

async function listMirror<T = unknown>(
  workspaceRoot: string,
  kind: MirrorKind,
): Promise<Array<{ rel: string; data: T }>> {
  const mirrorRoot = join(workspaceRoot, MIRROR_DIR);
  const out: Array<{ rel: string; data: T }> = [];
  let realRoot: string;
  let realMirror: string;
  try {
    await assertMirrorRootSafe(workspaceRoot, mirrorRoot);
    realRoot = await canonicalize(workspaceRoot);
    realMirror = await canonicalize(mirrorRoot);
  } catch {
    return out;
  }
  if (!isContained(realRoot, realMirror)) return out;
  const visited = new Set<string>();
  await walkDirs(realRoot, mirrorRoot, realMirror, visited, async (lexicalDir) => {
    const rel = toPosix(relative(mirrorRoot, lexicalDir));
    let data: T | null;
    try {
      data = await readMirror<T>(workspaceRoot, rel, kind);
    } catch {
      console.warn(`[bh] skipping corrupt ${kind}.yaml: ${rel || '<root>'}`);
      return;
    }
    if (data !== null) out.push({ rel, data });
  });
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

async function mirrorRevision(
  workspaceRoot: string,
  kind: MirrorKind,
): Promise<{ count: number; maxMtimeMs: number }> {
  const mirrorRoot = join(workspaceRoot, MIRROR_DIR);
  let realRoot: string;
  let realMirror: string;
  try {
    await assertMirrorRootSafe(workspaceRoot, mirrorRoot);
    realRoot = await canonicalize(workspaceRoot);
    realMirror = await canonicalize(mirrorRoot);
  } catch {
    return { count: 0, maxMtimeMs: 0 };
  }
  if (!isContained(realRoot, realMirror)) return { count: 0, maxMtimeMs: 0 };
  let count = 0;
  let maxMtimeMs = 0;
  const visited = new Set<string>();
  await walkDirs(realRoot, mirrorRoot, realMirror, visited, async (lexicalDir) => {
    const info = await lstat(join(lexicalDir, `${kind}.yaml`)).catch((err: unknown) => {
      if (isENOENT(err)) return null;
      throw err;
    });
    if (!info?.isFile()) return;
    count++;
    if (info.mtimeMs > maxMtimeMs) maxMtimeMs = info.mtimeMs;
  });
  return { count, maxMtimeMs };
}

async function relocateMirrorKind<T extends { path: string }>(
  workspaceRoot: string,
  kind: MirrorKind,
  from: string,
  to: string,
  remap?: (data: T, newRel: string) => T,
): Promise<Array<{ from: string; to: string }>> {
  if (from === to) return [];
  if (isMirrorSubtree(to, from)) {
    throw new Error(`relocateMirrorKind: cannot move "${from}" into its own subtree "${to}"`);
  }
  const all = await listMirror<T>(workspaceRoot, kind);
  const moved: Array<{ from: string; to: string }> = [];
  for (const { rel, data } of all) {
    if (!isMirrorSubtree(rel, from)) continue;
    const newRel = remapSubtreeRel(rel, from, to);
    const next = remap ? remap(data, newRel) : ({ ...data, path: newRel } as T);
    await writeMirror(workspaceRoot, newRel, kind, next);
    await removeMirror(workspaceRoot, rel, kind);
    moved.push({ from: rel, to: newRel });
  }
  return moved;
}

async function purgeMirrorKind(
  workspaceRoot: string,
  kind: MirrorKind,
  path: string,
): Promise<number> {
  const all = await listMirror<{ path: string }>(workspaceRoot, kind);
  let removed = 0;
  for (const { rel } of all) {
    if (!isMirrorSubtree(rel, path)) continue;
    if (await removeMirror(workspaceRoot, rel, kind)) removed++;
  }
  return removed;
}

async function canonicalize(p: string): Promise<string> {
  const norm = normalize(p);
  const suffix: string[] = [];
  let cur = norm;
  for (;;) {
    try {
      const real = await realpath(cur);
      return suffix.length > 0 ? join(real, ...suffix) : real;
    } catch (err) {
      if (!isENOENT(err)) throw new PathEscape(cur);
      const ls = await lstat(cur).catch((lstatErr: unknown) => {
        if (isENOENT(lstatErr)) return null;
        throw lstatErr;
      });
      if (ls?.isSymbolicLink()) throw new PathEscape(cur);
      const parent = dirname(cur);
      if (parent === cur) {
        return suffix.length > 0 ? join(cur, ...suffix) : cur;
      }
      suffix.unshift(basename(cur));
      cur = parent;
    }
  }
}

async function assertMirrorReadContained(
  workspaceRoot: string,
  rel: string,
  kind: MirrorKind,
): Promise<string> {
  return assertMirrorReadPath(workspaceRoot, mirrorPath(workspaceRoot, rel, kind));
}

async function assertMirrorReadPath(workspaceRoot: string, lexicalPath: string): Promise<string> {
  await assertMirrorPathSafe(workspaceRoot, lexicalPath);
  return lexicalPath;
}

async function assertMirrorWriteContained(
  workspaceRoot: string,
  lexicalPath: string,
): Promise<string> {
  await assertMirrorPathSafe(workspaceRoot, lexicalPath);
  return assertWriteContained(workspaceRoot, lexicalPath);
}

async function assertMirrorRootSafe(workspaceRoot: string, mirrorRoot: string): Promise<void> {
  assertLexicallyContained(workspaceRoot, mirrorRoot, workspaceRoot);
  await assertNoSymlinkedExistingParents(workspaceRoot, mirrorRoot, true);
}

async function assertMirrorPathSafe(workspaceRoot: string, lexicalPath: string): Promise<void> {
  const mirrorRoot = join(workspaceRoot, MIRROR_DIR);
  assertLexicallyContained(workspaceRoot, lexicalPath, workspaceRoot);
  assertLexicallyContained(mirrorRoot, lexicalPath, workspaceRoot);
  await assertNoSymlinkedExistingParents(workspaceRoot, lexicalPath, false);

  const realRoot = await canonicalize(workspaceRoot);
  const realParent = await canonicalize(dirname(lexicalPath));
  if (!isContained(realRoot, realParent)) {
    throw new PathEscape(relLabel(workspaceRoot, lexicalPath));
  }
}

async function assertNoSymlinkedExistingParents(
  root: string,
  lexicalPath: string,
  includeLeaf: boolean,
): Promise<void> {
  const rootNorm = normalize(root);
  const pathNorm = normalize(lexicalPath);
  const rel = relative(rootNorm, pathNorm);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new PathEscape(relLabel(root, lexicalPath));
  }
  const parts = rel.split(sep).filter(Boolean);
  const limit = includeLeaf ? parts.length : Math.max(0, parts.length - 1);
  let cur = rootNorm;
  for (let i = 0; i < limit; i++) {
    const part = parts[i];
    if (part === undefined) break;
    cur = join(cur, part);
    const info = await lstat(cur).catch((err: unknown) => {
      if (isENOENT(err)) return null;
      throw err;
    });
    if (info === null) return;
    if (info.isSymbolicLink()) {
      throw new PathEscape(relLabel(root, cur));
    }
    if (!info.isDirectory()) {
      throw new PathEscape(relLabel(root, cur));
    }
  }
}

function assertLexicallyContained(root: string, child: string, labelRoot: string): void {
  const rel = relative(normalize(root), normalize(child));
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return;
  throw new PathEscape(relLabel(labelRoot, child));
}

async function walkDirs(
  realRoot: string,
  dir: string,
  realDir: string,
  visited: Set<string>,
  visit: (lexicalDir: string) => Promise<void>,
): Promise<void> {
  const dirStat = await lstat(dir).catch((err: unknown) => {
    if (isENOENT(err)) return null;
    throw err;
  });
  if (!dirStat?.isDirectory() || dirStat.isSymbolicLink()) return;
  let actualRealDir = realDir;
  try {
    actualRealDir = await realpath(dir);
  } catch {
    return;
  }
  if (!isContained(realRoot, actualRealDir)) return;
  if (visited.has(actualRealDir)) return;
  visited.add(actualRealDir);
  await visit(dir);
  const names = await readdir(dir).catch(() => []);
  for (const name of names) {
    const child = join(dir, name);
    const childStat = await lstat(child).catch((err: unknown) => {
      if (isENOENT(err)) return null;
      throw err;
    });
    if (!childStat?.isDirectory() || childStat.isSymbolicLink()) continue;
    let realChild: string;
    try {
      realChild = await realpath(child);
    } catch {
      continue;
    }
    if (isContained(realRoot, realChild)) {
      await walkDirs(realRoot, child, realChild, visited, visit);
    }
  }
}

function normalizeRel(rel: string): string {
  if (rel === '' || rel === '.' || rel === './') return '';
  const trimmed = rel.replace(/^\.\//, '');
  assertWorkspaceRelative(trimmed);
  return trimmed;
}

function assertWorkspaceRelative(rel: string): void {
  if (typeof rel !== 'string' || rel.length === 0) {
    throw new Error('Path must be a non-empty string');
  }
  if (/^([a-zA-Z]:[\\/]|[\\/])/.test(rel)) {
    throw new Error(`Path must be relative, got: ${rel}`);
  }
  if (rel.split(/[\\/]/).some((seg) => seg === '..')) {
    throw new Error(`Path traversal rejected: ${rel}`);
  }
}

function serialize(data: unknown): string {
  return stringify(data, { lineWidth: 0 });
}

function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/');
}

function isContained(realRoot: string, real: string): boolean {
  return real === realRoot || real.startsWith(realRoot + sep);
}

function relLabel(root: string, lexicalPath: string): string {
  const r = normalize(root);
  const p = normalize(lexicalPath);
  return p.startsWith(r + sep) ? p.slice(r.length + 1) : p;
}

async function exists(path: string): Promise<boolean> {
  const info = await lstat(path).catch((err: unknown) => {
    if (isENOENT(err)) return null;
    throw err;
  });
  return info !== null;
}

function errnoCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

function isENOENT(err: unknown): boolean {
  return errnoCode(err) === 'ENOENT';
}

function isELOOP(err: unknown): boolean {
  const code = errnoCode(err);
  return code === 'ELOOP' || code === 'EMLINK';
}
