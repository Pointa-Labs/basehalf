import { Buffer, isUtf8 } from 'node:buffer';
import { constants } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, normalize, sep } from 'node:path';
import { assertWorkspaceRelativePath } from '../../workspace/node/workspacePath.js';
import type {
  WorkspaceCreateFileArgs,
  WorkspaceCreateFileResult,
  WorkspaceCreateFolderArgs,
  WorkspaceCreateFolderResult,
  WorkspaceDeleteEntryArgs,
  WorkspaceDeleteEntryResult,
  WorkspaceImportFileArgs,
  WorkspaceImportFileResult,
  WorkspaceListFilesEntry,
  WorkspaceListFilesResult,
  WorkspaceListSupportedFilesArgs,
  WorkspaceListSupportedFilesResult,
  WorkspaceReadFileArgs,
  WorkspaceReadFileResult,
  WorkspaceRenameFileArgs,
  WorkspaceRenameFileResult,
  WorkspaceWriteFileArgs,
  WorkspaceWriteFileResult,
} from '../../workspaces/common/workspaces.js';

export const SKIP_NAMES: ReadonlySet<string> = new Set([
  '.git',
  '.bh',
  '.DS_Store',
  'Thumbs.db',
  '.idea',
  '.vscode',
  '.turbo',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'node_modules',
  'dist',
  'build',
  'out',
  '__pycache__',
  '.pytest_cache',
  'target',
  'vendor',
]);

const HIDDEN_FILE_NAMES: ReadonlySet<string> = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

export async function listWorkspaceFiles(
  workspaceRoot: string | null,
  path: string,
): Promise<WorkspaceListFilesResult> {
  const root = requireWorkspaceRoot(workspaceRoot);
  if (!isAbsolute(path)) assertWorkspaceRelative(path);
  const absPath = isAbsolute(path) ? path : join(root, path);
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(absPath);
  } catch (err) {
    if (isENOENT(err)) {
      throw Object.assign(new Error(`Path does not exist: ${absPath}`), {
        code: 'PATH_NOT_FOUND',
      });
    }
    throw err;
  }
  if (!info.isDirectory()) throw new Error(`Path is not a directory: ${absPath}`);

  let realRoot: string;
  let realDir: string;
  try {
    realRoot = await canonicalize(root);
    realDir = await canonicalize(absPath);
  } catch {
    throw new PathEscape(absPath);
  }
  if (!isContained(realRoot, realDir)) {
    throw new PathEscape(absPath);
  }

  const names = await readdir(absPath);
  const entries: WorkspaceListFilesEntry[] = [];
  for (const name of names) {
    const child = join(absPath, name);
    let realChild: string;
    try {
      realChild = await canonicalize(child);
    } catch {
      continue;
    }
    if (!isContained(realRoot, realChild)) continue;
    const childInfo = await stat(child).catch((err: unknown) => {
      if (isENOENT(err)) return null;
      throw err;
    });
    if (childInfo === null) continue;
    entries.push({ name, type: childInfo.isDirectory() ? 'dir' : 'file' });
  }
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return { path: absPath, entries };
}

export async function listWorkspaceSupportedFiles(
  workspaceRoot: string | null,
  args: WorkspaceListSupportedFilesArgs,
): Promise<WorkspaceListSupportedFilesResult> {
  const root = requireWorkspaceRoot(workspaceRoot);
  const folder = args.folder;
  if (folder !== null) assertWorkspaceRelative(folder);
  const files: string[] = [];
  const visited = new Set<string>();
  const startAbs = folder === null ? root : join(root, folder);
  const startRel = folder === null ? '' : toPosix(folder);
  const stack: Array<{ abs: string; rel: string }> = [{ abs: startAbs, rel: startRel }];
  while (stack.length > 0) {
    const { abs, rel } = stack.pop() as { abs: string; rel: string };
    let real: string;
    try {
      real = await canonicalize(abs);
    } catch {
      continue;
    }
    if (visited.has(real)) continue;
    visited.add(real);
    let entries: readonly WorkspaceListFilesEntry[];
    try {
      ({ entries } = await listWorkspaceFiles(root, abs));
    } catch {
      continue;
    }
    for (const entry of entries) {
      const childRel = rel === '' ? entry.name : toPosix(`${rel}/${entry.name}`);
      if (entry.type === 'dir') {
        if (SKIP_NAMES.has(entry.name)) continue;
        stack.push({ abs: join(abs, entry.name), rel: childRel });
      } else if (isCanvasFile(entry.name)) {
        files.push(childRel);
      }
    }
  }
  files.sort((a, b) => a.localeCompare(b));
  return { files };
}

export async function readWorkspaceFile(
  workspaceRoot: string | null,
  args: WorkspaceReadFileArgs,
): Promise<WorkspaceReadFileResult> {
  assertWorkspaceRelative(args.path);
  const root = requireWorkspaceRoot(workspaceRoot);
  const abs = await assertReadContained(root, join(root, args.path));
  const maxChars =
    typeof args.maxChars === 'number' && args.maxChars >= 0 ? args.maxChars : undefined;
  const raw =
    maxChars !== undefined
      ? await readBytesCappedNoFollow(abs, maxChars * 4 + 4)
      : await readBytesNoFollow(abs);
  if (raw === null) {
    throw Object.assign(new Error(`Path does not exist: ${abs}`), {
      code: 'PATH_NOT_FOUND',
    });
  }
  const bytes = Buffer.from(raw);
  const content = bytes.toString('utf8');
  let slice = content;
  let truncated = false;
  if (maxChars !== undefined && content.length > maxChars) {
    slice = capTextPrefix(content, maxChars);
    truncated = true;
  }
  const sniffBytes = truncated ? bytes.subarray(0, Buffer.byteLength(slice, 'utf8')) : bytes;
  const binary = sniffBytes.includes(0) || !isUtf8(sniffBytes);
  return {
    path: args.path,
    content: slice,
    ...(truncated && { truncated: true }),
    ...(binary && { binary: true }),
  };
}

export async function writeWorkspaceFile(
  workspaceRoot: string | null,
  args: WorkspaceWriteFileArgs,
): Promise<WorkspaceWriteFileResult> {
  assertWorkspaceRelative(args.path);
  const root = requireWorkspaceRoot(workspaceRoot);
  const abs = await assertWriteContained(root, join(root, args.path));
  const parent = dirname(abs);
  if (parent && parent !== abs) {
    await mkdir(parent, { recursive: true });
  }
  const checkedAbs = await assertWriteContained(root, join(root, args.path));
  await writeNoFollow(checkedAbs, args.content);
  return { path: args.path, bytes: Buffer.byteLength(args.content, 'utf8') };
}

export async function writeWorkspaceFileIfMissing(
  workspaceRoot: string | null,
  args: WorkspaceWriteFileArgs,
): Promise<boolean> {
  assertWorkspaceRelative(args.path);
  const root = requireWorkspaceRoot(workspaceRoot);
  const abs = await assertWriteContained(root, join(root, args.path));
  const parent = dirname(abs);
  if (parent && parent !== abs) {
    await mkdir(parent, { recursive: true });
  }
  try {
    const checkedAbs = await assertWriteContained(root, join(root, args.path));
    await writeNoFollow(checkedAbs, args.content, { excl: true });
    return true;
  } catch (err) {
    if (errnoCode(err) === 'EEXIST') return false;
    throw err;
  }
}

export async function renameWorkspaceFile(
  workspaceRoot: string | null,
  args: WorkspaceRenameFileArgs,
  expectedKind: 'file' | 'folder' = 'file',
): Promise<WorkspaceRenameFileResult> {
  assertWorkspaceRelative(args.from);
  assertWorkspaceRelative(args.to);
  if (args.from === args.to) return { from: args.from, to: args.to, renamed: false };
  const root = requireWorkspaceRoot(workspaceRoot);
  const absFrom = await assertWriteContained(root, join(root, args.from));
  await assertEntryKind(absFrom, expectedKind);
  const { dir, base } = splitRel(args.to);
  const destDirAbs = dir === '' ? root : join(root, dir);
  const freeBase = await freeImportName(destDirAbs, base);
  const finalRel = dir === '' ? freeBase : toPosix(`${dir}/${freeBase}`);
  const absTo = await assertWriteContained(root, join(root, finalRel));
  await rename(absFrom, absTo);
  return { from: args.from, to: finalRel, renamed: true };
}

export async function importWorkspaceFile(
  workspaceRoot: string | null,
  args: WorkspaceImportFileArgs,
): Promise<WorkspaceImportFileResult> {
  if (typeof args.from !== 'string' || !isAbsolute(args.from)) {
    throw new Error(`Import source must be an absolute path: ${String(args.from)}`);
  }
  const root = requireWorkspaceRoot(workspaceRoot);
  const srcStat = await stat(args.from).catch((err: unknown) => {
    if (isENOENT(err)) return null;
    throw err;
  });
  if (srcStat === null) {
    throw Object.assign(new Error(`Path does not exist: ${args.from}`), {
      code: 'PATH_NOT_FOUND',
    });
  }
  if (srcStat.isDirectory()) {
    throw Object.assign(new Error(`Cannot import a folder: ${args.from}`), {
      code: 'IS_DIRECTORY',
    });
  }

  const realRoot = await canonicalize(root);
  let realFrom: string;
  try {
    realFrom = await canonicalize(args.from);
  } catch {
    throw Object.assign(new Error(`Path does not exist: ${args.from}`), {
      code: 'PATH_NOT_FOUND',
    });
  }
  if (isContained(realRoot, realFrom)) {
    const rel = toPosix(realFrom.slice(realRoot.length + 1));
    const name = basename(realFrom);
    return { path: rel, name, imported: false, supported: isCanvasFile(name) };
  }

  const toFolder = args.to ?? null;
  if (toFolder !== null) assertWorkspaceRelative(toFolder);
  const destDir = toFolder === null ? root : join(root, toFolder);
  const realDestDir = await assertReadContained(root, destDir);
  const destDirStat = await stat(realDestDir).catch((err: unknown) => {
    if (isENOENT(err)) return null;
    throw err;
  });
  if (!destDirStat?.isDirectory()) {
    throw new Error(`Import destination is not a folder: ${toFolder ?? '.'}`);
  }

  let name = '';
  for (let attempt = 0; attempt < 10; attempt++) {
    name = await freeImportName(realDestDir, basename(args.from));
    const destAbs = await assertWriteContained(root, join(realDestDir, name));
    try {
      await copyFile(realFrom, destAbs, constants.COPYFILE_EXCL);
      break;
    } catch (err) {
      if (errnoCode(err) === 'EEXIST' && attempt < 9) continue;
      throw err;
    }
  }
  const rel = toFolder === null ? name : toPosix(`${toFolder}/${name}`);
  return { path: rel, name, imported: true, supported: isCanvasFile(name) };
}

export async function createWorkspaceFile(
  workspaceRoot: string | null,
  args: WorkspaceCreateFileArgs,
): Promise<WorkspaceCreateFileResult> {
  assertWorkspaceRelative(args.path);
  const root = requireWorkspaceRoot(workspaceRoot);
  const { dir, base } = splitRel(args.path);
  const destDirAbs = dir === '' ? root : join(root, dir);
  await ensureContainedDirectory(root, destDirAbs);
  for (let attempt = 0; attempt < 10; attempt++) {
    const freeBase = await freeImportName(destDirAbs, base);
    const finalRel = dir === '' ? freeBase : toPosix(`${dir}/${freeBase}`);
    const abs = await assertWriteContained(root, join(root, finalRel));
    try {
      await writeNoFollow(abs, args.content ?? '', { excl: true });
      return { path: finalRel };
    } catch (err) {
      if (errnoCode(err) === 'EEXIST' && attempt < 9) continue;
      throw err;
    }
  }
  throw new Error(`Could not create "${base}" — too many colliding files.`);
}

export async function createWorkspaceFolder(
  workspaceRoot: string | null,
  args: WorkspaceCreateFolderArgs,
): Promise<WorkspaceCreateFolderResult> {
  assertWorkspaceRelative(args.path);
  const root = requireWorkspaceRoot(workspaceRoot);
  const { dir, base } = splitRel(args.path);
  const destDirAbs = dir === '' ? root : join(root, dir);
  await ensureContainedDirectory(root, destDirAbs);
  for (let attempt = 0; attempt < 10; attempt++) {
    const freeBase = await freeImportName(destDirAbs, base);
    const finalRel = dir === '' ? freeBase : toPosix(`${dir}/${freeBase}`);
    const abs = await assertWriteContained(root, join(root, finalRel));
    try {
      await mkdir(abs, { recursive: false });
      return { path: finalRel };
    } catch (err) {
      if (errnoCode(err) === 'EEXIST' && attempt < 9) continue;
      throw err;
    }
  }
  throw new Error(`Could not create folder "${base}" — too many colliding entries.`);
}

export async function deleteWorkspaceEntry(
  workspaceRoot: string | null,
  args: WorkspaceDeleteEntryArgs,
  trash?: (path: string) => Promise<void>,
): Promise<WorkspaceDeleteEntryResult> {
  assertWorkspaceRelative(args.path);
  const root = requireWorkspaceRoot(workspaceRoot);
  const abs = await assertWriteContained(root, join(root, args.path));
  await assertEntryKind(abs, args.kind);
  if (trash !== undefined) {
    await trash(abs);
  } else {
    await rm(abs, { recursive: args.kind === 'folder' });
  }
  return { deleted: true };
}

class PathEscape extends Error {
  override readonly name = 'PathEscape';
  constructor(public readonly rel: string) {
    super(`Refusing to access a path outside the workspace: ${rel}`);
  }
}

function requireWorkspaceRoot(workspaceRoot: string | null): string {
  if (workspaceRoot === null) {
    throw new Error('No workspace bound. Register/use a workspace first.');
  }
  return workspaceRoot;
}

export function assertWorkspaceRelative(rel: string): void {
  assertWorkspaceRelativePath(rel);
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

function isContained(realRoot: string, real: string): boolean {
  return real === realRoot || real.startsWith(realRoot + sep);
}

async function assertReadContained(root: string, lexicalPath: string): Promise<string> {
  const realRoot = await canonicalize(root);
  const real = await canonicalize(lexicalPath);
  if (!isContained(realRoot, real)) {
    throw new PathEscape(relLabel(root, lexicalPath));
  }
  return real;
}

async function assertWriteContained(root: string, lexicalPath: string): Promise<string> {
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

async function ensureContainedDirectory(root: string, dir: string): Promise<void> {
  await assertWriteContained(root, join(dir, '.keep'));
  await mkdir(dir, { recursive: true });
  await assertWriteContained(root, join(dir, '.keep'));
}

async function assertEntryKind(path: string, kind: 'file' | 'folder'): Promise<void> {
  const info = await lstat(path).catch((err: unknown) => {
    if (isENOENT(err)) return null;
    throw err;
  });
  if (info === null) {
    throw Object.assign(new Error(`Path does not exist: ${path}`), {
      code: 'PATH_NOT_FOUND',
    });
  }
  if (info.isSymbolicLink()) {
    throw new PathEscape(path);
  }
  if (kind === 'file' && !info.isFile()) {
    throw new Error(`Path is not a file: ${path}`);
  }
  if (kind === 'folder' && !info.isDirectory()) {
    throw new Error(`Path is not a folder: ${path}`);
  }
}

async function readBytesNoFollow(path: string): Promise<Uint8Array | null> {
  let fh: Awaited<ReturnType<typeof open>>;
  try {
    fh = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (err) {
    if (isENOENT(err)) return null;
    if (isELOOP(err)) throw new PathEscape(path);
    throw err;
  }
  try {
    return await fh.readFile();
  } finally {
    await fh.close();
  }
}

async function readBytesCappedNoFollow(path: string, maxBytes: number): Promise<Uint8Array | null> {
  let fh: Awaited<ReturnType<typeof open>>;
  try {
    fh = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (err) {
    if (isENOENT(err)) return null;
    if (isELOOP(err)) throw new PathEscape(path);
    throw err;
  }
  try {
    if (maxBytes <= 0) return new Uint8Array(0);
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

async function writeNoFollow(
  path: string,
  content: string,
  opts?: { excl?: boolean },
): Promise<void> {
  let fh: Awaited<ReturnType<typeof open>>;
  const flags = opts?.excl
    ? constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW
    : constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW;
  try {
    fh = await open(path, flags, 0o666);
  } catch (err) {
    if (isELOOP(err)) throw new PathEscape(path);
    throw err;
  }
  try {
    await fh.writeFile(content, 'utf8');
  } finally {
    await fh.close();
  }
}

function capTextPrefix(content: string, maxChars: number): string {
  const prefix = content.slice(0, maxChars);
  if (prefix.length === 0) return prefix;
  const last = prefix.charCodeAt(prefix.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? prefix.slice(0, -1) : prefix;
}

async function freeImportName(dir: string, base: string): Promise<string> {
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  for (let i = 1; i <= 1000; i++) {
    const candidate = i === 1 ? base : `${stem}-${i}${ext}`;
    const exists = await stat(join(dir, candidate)).catch((err: unknown) => {
      if (isENOENT(err)) return null;
      throw err;
    });
    if (exists === null) return candidate;
  }
  throw new Error(`Could not find a free name for "${base}" — too many copies exist.`);
}

function splitRel(rel: string): { dir: string; base: string } {
  const slash = rel.lastIndexOf('/');
  return slash === -1
    ? { dir: '', base: rel }
    : { dir: rel.slice(0, slash), base: rel.slice(slash + 1) };
}

export function isCanvasFile(name: string): boolean {
  return !HIDDEN_FILE_NAMES.has(name);
}

export function toPosix(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).join('/');
}

function relLabel(root: string, lexicalPath: string): string {
  const r = normalize(root);
  const p = normalize(lexicalPath);
  return p.startsWith(r + sep) ? p.slice(r.length + 1) : p;
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
