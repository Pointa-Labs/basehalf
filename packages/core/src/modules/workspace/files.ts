import { Buffer, isUtf8 } from 'node:buffer';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
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
import type { BadgeFile } from '../badges/types.js';
import { readWorkspaces } from './store.js';
import { SKIP_NAMES, hasSupportedExt, toPosix } from './supported.js';
import type {
  CanvasBadge,
  CanvasFolderPreview,
  WorkspaceImportFileArgs,
  WorkspaceImportFileResult,
  WorkspaceListCanvasArgs,
  WorkspaceListCanvasResult,
  WorkspaceListFilesArgs,
  WorkspaceListFilesEntry,
  WorkspaceListFilesResult,
  WorkspaceListSupportedFilesArgs,
  WorkspaceListSupportedFilesResult,
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
  // Sibling reads (badge.list) already require a current workspace;
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

/**
 * `workspace.listCanvas({ folder })` — the canvas's data source. Returns the
 * DIRECT children (one level) of `folder` (null = workspace root) as badge
 * objects: each supported-type file + subfolder, merged with its sparse badge
 * overlay if one exists, else a synthesized default. The filesystem IS the tree
 * — we read one level on demand (like the NavTree) instead of a materialized
 * mirror, so a huge or deeply-nested workspace stays fast and there is no eager
 * badge-per-file. Read-only: it never writes a badge.
 */
/** The canvas-surface filter: a subfolder (minus tooling dirs) or a
 *  supported-type file. Shared by listCanvas and its folder-contents preview so
 *  the card's "what's inside" list matches exactly what entering the folder shows. */
const isCanvasEntry = (entry: WorkspaceListFilesEntry): boolean =>
  entry.type === 'dir' ? !SKIP_NAMES.has(entry.name) : hasSupportedExt(entry.name);

/** The agent-protocol pointer files setup installs at the workspace root.
 *  They are scaffolding, not content — the canvas is the user's map of THEIR
 *  material, so these don't get cards (the sidebar, which is the truthful
 *  filesystem view, still shows them). Root level only: a nested AGENTS.md
 *  is the user's own and stays visible. */
const AGENT_HINT_FILES = new Set(['CLAUDE.md', 'AGENTS.md']);

/** Most child rows a folder card previews; the rest collapse to "+N more". Kept
 *  small so a folder of thousands never bloats the canvas payload — the card is a
 *  peek, not the folder. listFiles already sorts folders-first then alpha, so the
 *  slice is the same order you see on entering the folder. */
const FOLDER_PREVIEW_LIMIT = 6;

/** Peek at a folder's DIRECT contents for its card. Reuses the hardened,
 *  symlink-contained listFiles (escaped children already dropped there); a read
 *  failure degrades to an empty preview rather than blanking the whole canvas. */
const folderPreview = async (
  ctx: Parameters<Handler<WorkspaceListCanvasArgs, WorkspaceListCanvasResult>>[1],
  absChildDir: string,
): Promise<CanvasFolderPreview> => {
  let children: readonly WorkspaceListFilesEntry[];
  try {
    ({ entries: children } = (await ctx.run('workspace.listFiles', {
      path: absChildDir,
    })) as WorkspaceListFilesResult);
  } catch {
    return { total: 0, items: [] };
  }
  const supported = children.filter(isCanvasEntry);
  return {
    total: supported.length,
    items: supported.slice(0, FOLDER_PREVIEW_LIMIT).map((e) => ({
      name: e.name,
      kind: e.type === 'dir' ? 'folder' : 'file',
    })),
  };
};

export const listCanvas: Handler<WorkspaceListCanvasArgs, WorkspaceListCanvasResult> = async (
  args,
  ctx,
) => {
  const folder = args.folder;
  if (folder !== null) assertWorkspaceRelative(folder);
  const data = await readWorkspaces(ctx.fs, ctx.configDir);
  const root = data.current !== null ? data.workspaces[data.current]?.path : undefined;
  if (root === undefined) {
    throw new Error('No current workspace; call workspace.use first');
  }
  const absDir = folder === null ? root : join(root, folder);
  // Reuse listFiles for the single-level, realpath-contained, symlink-hardened
  // readdir — escaped children are already dropped there.
  const { entries } = (await ctx.run('workspace.listFiles', {
    path: absDir,
  })) as WorkspaceListFilesResult;

  const badges: CanvasBadge[] = [];
  for (const entry of entries) {
    if (!isCanvasEntry(entry)) continue;
    if (folder === null && entry.type === 'file' && AGENT_HINT_FILES.has(entry.name)) continue;
    const isDir = entry.type === 'dir';
    const rel = folder === null ? entry.name : toPosix(`${folder}/${entry.name}`);
    const kind = isDir ? 'folder' : 'file';
    // A folder card shows its direct contents — peek one more level (the same
    // on-demand readdir the NavTree does), bounded by FOLDER_PREVIEW_LIMIT.
    const preview = isDir ? await folderPreview(ctx, join(absDir, entry.name)) : undefined;
    let badge: BadgeFile | null = null;
    try {
      badge = (await ctx.run('badge.get', { file: rel, kind })) as BadgeFile | null;
    } catch (err) {
      // A corrupt badge or a symlinked-out badge path must not blank the folder;
      // fall back to a synthesized default (same skip-and-warn as listBadges).
      if (err instanceof Error && (err.name === 'BadgeCorrupt' || err.name === 'PathEscape')) {
        console.warn(`[bh] skipping unreadable badge for canvas: ${rel}`);
      } else {
        throw err;
      }
    }
    // Synthesized default for an unannotated file: structurally a BadgeFile, but
    // NEVER written to disk (empty timestamps signal "not persisted"). The
    // renderer's badgeToNode + badgesToConnectionEdges only read
    // file/kind/canvas/orphan/prompt/references, so this is sufficient.
    const base: BadgeFile = badge ?? {
      bhVersion: 1,
      file: rel,
      kind,
      references: [],
      createdAt: '',
      modifiedAt: '',
    };
    badges.push(preview ? { ...base, preview } : base);
  }
  badges.sort((a, b) => a.file.localeCompare(b.file));
  return { badges };
};

/**
 * `workspace.listSupportedFiles({ folder })` — all canvas-supported files under
 * `folder` (null = root), RECURSIVELY, as sorted workspace-relative POSIX paths.
 * Walks the filesystem (reusing listFiles per level for containment), skipping
 * SKIP_NAMES dirs. Powers focus-folder and the ⌘K picker — it sees every file
 * on disk, not just annotated ones. A canonical-path `visited` set breaks
 * symlink loops inside the workspace.
 */
export const listSupportedFiles: Handler<
  WorkspaceListSupportedFilesArgs,
  WorkspaceListSupportedFilesResult
> = async (args, ctx) => {
  const folder = args.folder;
  if (folder !== null) assertWorkspaceRelative(folder);
  const data = await readWorkspaces(ctx.fs, ctx.configDir);
  const root = data.current !== null ? data.workspaces[data.current]?.path : undefined;
  if (root === undefined) {
    throw new Error('No current workspace; call workspace.use first');
  }
  const files: string[] = [];
  const visited = new Set<string>();
  const startAbs = folder === null ? root : join(root, folder);
  const startRel = folder === null ? '' : toPosix(folder);
  const stack: Array<{ abs: string; rel: string }> = [{ abs: startAbs, rel: startRel }];
  while (stack.length > 0) {
    const { abs, rel } = stack.pop() as { abs: string; rel: string };
    let real: string;
    try {
      real = await canonicalize(ctx.fs, abs);
    } catch {
      continue; // unreachable/escaped dir → skip
    }
    if (visited.has(real)) continue; // symlink-loop guard
    visited.add(real);
    let entries: readonly WorkspaceListFilesEntry[];
    try {
      ({ entries } = (await ctx.run('workspace.listFiles', {
        path: abs,
      })) as WorkspaceListFilesResult);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const childRel = rel === '' ? entry.name : toPosix(`${rel}/${entry.name}`);
      if (entry.type === 'dir') {
        if (SKIP_NAMES.has(entry.name)) continue;
        stack.push({ abs: join(abs, entry.name), rel: childRel });
      } else if (hasSupportedExt(entry.name)) {
        files.push(childRel);
      }
    }
  }
  files.sort((a, b) => a.localeCompare(b));
  return { files };
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

/** Collision-free basename in `dir`: `report.pdf`, then `report-2.pdf`,
 *  `report-3.pdf`, … (same suffix convention as workspace-name collisions).
 *  Existence is re-checked per candidate; the EXCL copy below still closes
 *  the pick-then-copy race. */
async function freeImportName(
  fs: Parameters<Handler>[1]['fs'],
  dir: string,
  base: string,
): Promise<string> {
  const dot = base.lastIndexOf('.');
  // A leading dot (.env) is a hidden-file marker, not an extension separator.
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  for (let i = 1; i <= 1000; i++) {
    const candidate = i === 1 ? base : `${stem}-${i}${ext}`;
    if ((await fs.stat(join(dir, candidate))) === null) return candidate;
  }
  throw new Error(`Could not find a free name for "${base}" — too many copies exist.`);
}

/**
 * `workspace.importFile({ from, to })` — COPY an external file into the
 * current workspace (drag-a-file-onto-the-canvas/window). Deliberate
 * semantics, per the product's first rule about other people's folders:
 *  - always a copy — the source file is never moved, renamed, or deleted;
 *  - the copy lands in the user's own folder (visible to the file manager,
 *    git, and agents — not an app-internal store);
 *  - never clobbers — a name collision picks `-2`/`-3`, and the copy itself
 *    is EXCL so a race can't overwrite either;
 *  - a source already inside the workspace is returned as-is (no duplicate).
 * The destination is realpath-contained like every other write; the source is
 * wherever the user dragged from, which is the point — it's an explicit user
 * action, same trust level as picking a folder in the OS dialog.
 */
export const importFile: Handler<WorkspaceImportFileArgs, WorkspaceImportFileResult> = async (
  args,
  ctx,
) => {
  if (typeof args.from !== 'string' || !isAbsolute(args.from)) {
    throw new Error(`Import source must be an absolute path: ${String(args.from)}`);
  }
  const data = await readWorkspaces(ctx.fs, ctx.configDir);
  const root = data.current !== null ? data.workspaces[data.current]?.path : undefined;
  if (root === undefined) {
    throw new Error('No current workspace; call workspace.use first');
  }
  const srcStat = await ctx.fs.stat(args.from);
  if (!srcStat) {
    throw Object.assign(new Error(`Path does not exist: ${args.from}`), {
      code: 'PATH_NOT_FOUND',
    });
  }
  if (srcStat.isDirectory) {
    // Tagged so the desktop drop handler can route folders to the
    // add-as-workspace flow instead of surfacing a raw error.
    throw Object.assign(new Error(`Cannot import a folder: ${args.from}`), {
      code: 'IS_DIRECTORY',
    });
  }
  // Resolve both ends to canonical paths. A source that already lives inside
  // the workspace (directly or via symlink) needs no copy — importing your own
  // file back into the same folder would just breed `-2` duplicates.
  const realRoot = await canonicalize(ctx.fs, root);
  let realFrom: string;
  try {
    realFrom = await canonicalize(ctx.fs, args.from);
  } catch {
    throw Object.assign(new Error(`Path does not exist: ${args.from}`), {
      code: 'PATH_NOT_FOUND',
    });
  }
  if (isContained(realRoot, realFrom)) {
    const rel = toPosix(realFrom.slice(realRoot.length + 1));
    const name = basename(realFrom);
    return { path: rel, name, imported: false, supported: hasSupportedExt(name) };
  }
  const toFolder = args.to ?? null;
  if (toFolder !== null) assertWorkspaceRelative(toFolder);
  const destDir = toFolder === null ? root : join(root, toFolder);
  const destDirStat = await ctx.fs.stat(destDir);
  if (!destDirStat?.isDirectory) {
    throw new Error(`Import destination is not a folder: ${toFolder ?? '.'}`);
  }
  // Pick a free name, then copy with EXCL so a concurrent import racing onto
  // the same name can't clobber — the loser sees EEXIST and re-picks (the
  // re-stat sees the winner's file and suffixes past it).
  let name = '';
  for (let attempt = 0; attempt < 10; attempt++) {
    name = await freeImportName(ctx.fs, destDir, basename(args.from));
    // Same write containment as workspace.writeFile: the real parent must be
    // inside the root, and a symlink leaf is refused.
    const destAbs = await assertWriteContained(ctx.fs, root, join(destDir, name));
    if (ctx.fs.copyFile) {
      try {
        await ctx.fs.copyFile(realFrom, destAbs, { excl: true });
        break;
      } catch (err) {
        const code = (err as { code?: unknown }).code;
        if (code === 'EEXIST' && attempt < 9) continue;
        throw err;
      }
    } else {
      // Legacy-mock fallback (no binary fidelity — mocks carry no binaries,
      // and no concurrent writers either, so the stat in freeImportName is
      // sufficient).
      const content = await ctx.fs.readFile(realFrom);
      if (content === null) {
        throw Object.assign(new Error(`Path does not exist: ${args.from}`), {
          code: 'PATH_NOT_FOUND',
        });
      }
      await writeMaybeNoFollow(ctx.fs, destAbs, content);
      break;
    }
  }
  const rel = toFolder === null ? name : toPosix(`${toFolder}/${name}`);
  return { path: rel, name, imported: true, supported: hasSupportedExt(name) };
};
