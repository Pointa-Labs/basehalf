import { Buffer, isUtf8 } from 'node:buffer';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
  type Handler,
  PathEscape,
  assertReadContained,
  assertWorkspaceRelative,
  assertWriteContained,
  canonicalize,
  isContained,
  readBytesCappedMaybeNoFollow,
  readBytesMaybeNoFollow,
  writeMaybeNoFollow,
} from '../../kernel/index.js';
import { readWorkspaces } from './store.js';
import type {
  WorkspaceListFilesArgs,
  WorkspaceListFilesEntry,
  WorkspaceListFilesResult,
  WorkspaceReadFileArgs,
  WorkspaceReadFileResult,
  WorkspaceWriteFileArgs,
  WorkspaceWriteFileResult,
} from './types.js';

/**
 * The hardened user-file I/O door: read/write/listFiles. bh's only sanctioned
 * surface into user content — other modules (search, the editor, viewers)
 * drive it via ctx.run rather than touching node:fs. Every path here resolves
 * the current workspace root from the registry (lock-free read) and refuses
 * when there is no current, then routes the FS touch through the kernel's
 * realpath-containment + O_NOFOLLOW family so a planted symlink can't escape.
 */

/**
 * `workspace.listFiles({ path })` — single-level directory listing for the
 * desktop NavTree. Lazy by design: only direct children, sorted dirs-first
 * then alphabetical. The renderer drives recursion by calling again with a
 * child dir's path when the user expands it.
 *
 * Filtering (hidden files like .git / .bh / .DS_Store) is the renderer's
 * job — keeping core unopinionated about display lets the same data feed
 * different UIs (CLI, MCP, alternative shells).
 */
export const listFiles: Handler<WorkspaceListFilesArgs, WorkspaceListFilesResult> = async (
  args,
  ctx,
) => {
  const absPath = isAbsolute(args.path) ? args.path : resolve(args.path);
  const stat = await ctx.fs.stat(absPath);
  if (!stat) {
    // Tagged so the desktop NavTree can render a "workspace unreachable"
    // re-select / unregister modal instead of a raw error string.
    throw Object.assign(new Error(`Path does not exist: ${absPath}`), {
      code: 'PATH_NOT_FOUND',
    });
  }
  if (!stat.isDirectory) throw new Error(`Path is not a directory: ${absPath}`);

  // Contain enumeration to the current workspace: listFiles takes an absolute
  // path the renderer drives from NavTree clicks, and ctx.fs.stat FOLLOWS
  // symlinks — so a planted dir-symlink (docs -> /etc) would otherwise let the
  // tree enumerate an arbitrary OUTSIDE directory (a filename/structure oracle
  // even though readFile refuses the content). Require the listed dir to be
  // inside the current workspace root, and skip any child that escapes it.
  const data = await readWorkspaces(ctx.fs, ctx.configDir);
  const root = data.current !== null ? data.workspaces[data.current]?.path : undefined;
  // With NO current workspace there is no containment boundary — refuse rather
  // than fall through to enumerating an arbitrary absolute path (a planted
  // `listFiles({path:'/etc'})` would otherwise leak external dir structure).
  // Sibling reads (badge.list/view.list) already require a current workspace;
  // listFiles must not be the outlier.
  if (root === undefined) {
    throw new Error('No current workspace; call workspace.use first');
  }
  // Guard the anchor canonicalize (ELOOP/EACCES on the root or the listed dir
  // → refuse rather than crash with a raw fs error).
  let realRoot: string;
  let realDir: string;
  try {
    realRoot = await canonicalize(ctx.fs, root);
    realDir = await canonicalize(ctx.fs, absPath);
  } catch {
    throw new PathEscape(absPath);
  }
  if (!isContained(realRoot, realDir)) {
    throw new PathEscape(absPath);
  }

  const names = await ctx.fs.readdir(absPath);
  const entries: WorkspaceListFilesEntry[] = [];
  for (const name of names) {
    const child = join(absPath, name);
    // Filter a symlinked-out child so it never surfaces in the tree (and
    // can't be expanded into an external dir on the next listFiles call).
    let realChild: string;
    try {
      realChild = await canonicalize(ctx.fs, child);
    } catch {
      continue;
    }
    if (!isContained(realRoot, realChild)) continue;
    const childStat = await ctx.fs.stat(child);
    if (!childStat) continue;
    entries.push({ name, type: childStat.isDirectory ? 'dir' : 'file' });
  }
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return { path: absPath, entries };
};

function ensureInsideWorkspace(rel: string): void {
  // Path comes from renderer via IPC — defensively reject anything that
  // could escape the current workspace root. Delegates to the shared
  // kernel guard so workspace + badges enforce identical rules.
  assertWorkspaceRelative(rel);
}

function capTextPrefix(content: string, maxChars: number): string {
  const prefix = content.slice(0, maxChars);
  if (prefix.length === 0) return prefix;
  const last = prefix.charCodeAt(prefix.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? prefix.slice(0, -1) : prefix;
}

/** `workspace.readFile({ path })` — read a user file in the current
 * workspace. Path is POSIX-relative; absolute paths or `..` are rejected. */
export const readFile: Handler<WorkspaceReadFileArgs, WorkspaceReadFileResult> = async (
  args,
  ctx,
) => {
  ensureInsideWorkspace(args.path);
  const data = await readWorkspaces(ctx.fs, ctx.configDir);
  if (data.current === null) throw new Error('No current workspace');
  const entry = data.workspaces[data.current];
  if (!entry) throw new Error('Current workspace pointer is stale');
  // Realpath-contain: assertWorkspaceRelative (above) rejects ../absolute in
  // the request string, but a planted symlink whose NAME is innocuous still
  // escapes once node:fs follows it. Canonicalize and require containment, then
  // read the canonical path so check and open agree. (See kernel/contain.ts.)
  const abs = await assertReadContained(ctx.fs, entry.path, join(entry.path, args.path));
  // O_NOFOLLOW read closes the check-then-read TOCTOU: if the leaf is swapped
  // for a symlink between the guard above and this read, the open refuses it
  // rather than re-following. (Residual: an intermediate-component swap still
  // needs openat2/RESOLVE_BENEATH, which Node doesn't expose — see
  // kernel/contain.ts. Falls back to plain readFile under the legacy mock.)
  // Optional cap: a preview/viewer that only renders a slice asks for just that
  // slice. When it does, BOUND the bytes we read — UTF-8 is ≤4 bytes/char, so
  // `maxChars*4 (+4 for a boundary-split trailing char)` always decodes to ≥
  // maxChars chars, which we char-cap precisely below. This is the partial read
  // that makes it safe to optimistically route unknown files to the text viewer:
  // a mis-routed binary (or a multi-GB log) only ever puts this small prefix in
  // memory before the sniff/cap runs, instead of being slurped whole. Uncapped
  // callers (the editor) still read the full file.
  const maxChars =
    typeof args.maxChars === 'number' && args.maxChars >= 0 ? args.maxChars : undefined;
  const raw =
    maxChars !== undefined
      ? await readBytesCappedMaybeNoFollow(ctx.fs, abs, maxChars * 4 + 4)
      : await readBytesMaybeNoFollow(ctx.fs, abs);
  if (raw === null) {
    throw Object.assign(new Error(`Path does not exist: ${abs}`), { code: 'PATH_NOT_FOUND' });
  }
  const bytes = Buffer.from(raw);
  const content = bytes.toString('utf8');
  // `truncated` when the file held more than the requested prefix. With the
  // bounded read above, `content.length > maxChars` is exactly that signal: the
  // byte budget always over-reads past maxChars chars whenever more remained.
  let slice = content;
  let truncated = false;
  if (maxChars !== undefined && content.length > maxChars) {
    slice = capTextPrefix(content, maxChars);
    truncated = true;
  }
  // Content sniff: NUL bytes and invalid UTF-8 are not renderable text. Sniff
  // the same prefix the viewer gets, but on raw bytes before UTF-8 decoding has
  // a chance to replace invalid sequences with mojibake.
  const sniffBytes = truncated ? bytes.subarray(0, Buffer.byteLength(slice, 'utf8')) : bytes;
  const binary = sniffBytes.includes(0) || !isUtf8(sniffBytes);
  return {
    path: args.path,
    content: slice,
    ...(truncated && { truncated: true }),
    ...(binary && { binary: true }),
  };
};

/** `workspace.writeFile({ path, content })` — write a user file inside the
 * current workspace. The *only* path through which bh modifies user
 * content. Used exclusively by the BlockNote editor in PR 14; everything
 * else is observer-only per IR-v2-13. */
export const writeFile: Handler<WorkspaceWriteFileArgs, WorkspaceWriteFileResult> = async (
  args,
  ctx,
) => {
  ensureInsideWorkspace(args.path);
  const data = await readWorkspaces(ctx.fs, ctx.configDir);
  if (data.current === null) throw new Error('No current workspace');
  const entry = data.workspaces[data.current];
  if (!entry) throw new Error('Current workspace pointer is stale');
  // Realpath-contain the WRITE: this is bh's only user-file write path, so a
  // planted symlink (a `config.md -> ~/.ssh/authorized_keys` leaf, or a
  // `drafts -> ~/Library/LaunchAgents` parent dir for a brand-new note) must
  // not let an editor save / New-Note clobber or plant a file outside the
  // workspace. assertWriteContained proves the real parent is inside and
  // refuses a symlink leaf. (See kernel/contain.ts.)
  const abs = await assertWriteContained(ctx.fs, entry.path, join(entry.path, args.path));
  // Honor the desktop new-note dialog's "folders auto-created" promise:
  // mkdir -p the parent so a path like `subdir/new/note.md` succeeds even
  // when `subdir/new` doesn't exist yet. Top-level paths have an empty
  // dirname (".") and the mkdir is a no-op.
  const parent = dirname(abs);
  if (parent && parent !== abs) {
    await ctx.fs.mkdir(parent, { recursive: true });
  }
  // O_NOFOLLOW write closes the check-then-write TOCTOU at the leaf: a symlink
  // raced onto `abs` after the guard is refused, not written through.
  await writeMaybeNoFollow(ctx.fs, abs, args.content);
  return { path: args.path, bytes: Buffer.byteLength(args.content, 'utf8') };
};
