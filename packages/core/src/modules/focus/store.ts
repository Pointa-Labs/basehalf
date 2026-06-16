import { dirname, isAbsolute, join } from 'node:path';
import { parse } from 'yaml';
import {
  type FsLike,
  assertReadContained,
  patchMirror,
  readMaybeNoFollow,
  readMirror,
  removeMirror,
  writeMirror,
} from '../../kernel/index.js';
import { FocusCorrupt, type FocusNode } from './types.js';

/**
 * Focus persistence over the kernel `.bh/mirror/` YAML store + the
 * `.bh/current_focus.yaml` SYMLINK. A node's focus lives at
 * `.bh/mirror/<path>/focus.yaml` (root folder → `.bh/mirror/focus.yaml`); the
 * current-focus symlink points the agent at the active node. The brief/Markdown
 * machinery this file used to hold (renderFocus/parseFocus/served receipt) is
 * gone — focus is a viewport mirror now, not a curated brief.
 */

const CURRENT_FOCUS = '.bh/current_focus.yaml';
const MIRROR_REL = 'mirror';

/** `<workspace>/.bh/current_focus.yaml` (the symlink itself). */
export function currentFocusLink(workspaceRoot: string): string {
  return join(workspaceRoot, CURRENT_FOCUS);
}

/** Relative symlink target (resolved against `.bh/`) → the node's focus.yaml.
 *  `''` is the workspace-root folder → `mirror/focus.yaml`. Always POSIX `/`
 *  (workspace-relative paths are POSIX, and a relative symlink target is too). */
function relTargetFor(path: string): string {
  return path === '' ? `${MIRROR_REL}/focus.yaml` : `${MIRROR_REL}/${path}/focus.yaml`;
}

export async function writeFocusNode(
  fs: FsLike,
  workspaceRoot: string,
  node: FocusNode,
): Promise<void> {
  await writeMirror(fs, workspaceRoot, node.path, 'focus', node);
}

/**
 * FIELD-SCOPED write: merge `node`'s provided fields onto whatever the node's
 * focus.yaml already holds, atomically (read-modify-write under the mirror lock).
 * The spec requires "写回时只更新对应字段，避免覆盖同一文件中其他来源刚写入的内容":
 * scroll (visible_lines) and cursor-move (cursor) arrive as SEPARATE focus.set
 * calls, so a whole-file overwrite would let a cursor update wipe the just-written
 * visible_lines (and vice-versa). `node` carries only the fields the caller meant
 * to change (buildNode already drops cross-kind + un-provided fields), so spreading
 * it over the prior value preserves the rest. A node-switch (path+kind only) keeps
 * the node's last-known viewport until a real scroll/move refreshes it. Kind never
 * changes for a given path (a path is a file XOR a folder); if it somehow differs
 * (a path reused as the other kind), we start clean from `node`. */
export async function patchFocusNode(
  fs: FsLike,
  workspaceRoot: string,
  node: FocusNode,
): Promise<FocusNode> {
  const written = await patchMirror<FocusNode>(fs, workspaceRoot, node.path, 'focus', (prev) =>
    prev && prev.kind === node.kind ? ({ ...prev, ...node } as FocusNode) : node,
  );
  return written ?? node;
}

export async function readFocusNode(
  fs: FsLike,
  workspaceRoot: string,
  path: string,
): Promise<FocusNode | null> {
  try {
    return await readMirror<FocusNode>(fs, workspaceRoot, path, 'focus');
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'MirrorCorrupt') {
      throw new FocusCorrupt(path, { cause });
    }
    throw cause;
  }
}

export async function removeFocusNode(
  fs: FsLike,
  workspaceRoot: string,
  path: string,
): Promise<boolean> {
  return removeMirror(fs, workspaceRoot, path, 'focus');
}

/** Repoint `.bh/current_focus.yaml` → the node's focus.yaml (a RELATIVE symlink,
 *  so it survives the workspace folder being moved). Replaces any existing
 *  link/file at that path. */
export async function repointCurrentFocus(
  fs: FsLike,
  workspaceRoot: string,
  path: string,
): Promise<void> {
  if (!fs.symlink) {
    throw new Error('focus: this filesystem cannot create the current_focus symlink');
  }
  const link = currentFocusLink(workspaceRoot);
  await fs.mkdir(dirname(link), { recursive: true });
  // symlink() fails EEXIST if the path is taken — clear any prior link/file first.
  // unlink no-ops (caught) when nothing is there.
  try {
    await fs.unlink(link);
  } catch {
    /* nothing to replace */
  }
  await fs.symlink(relTargetFor(path), link);
}

/** Remove the current_focus symlink. Returns whether it existed. */
export async function clearCurrentFocus(fs: FsLike, workspaceRoot: string): Promise<boolean> {
  try {
    await fs.unlink(currentFocusLink(workspaceRoot));
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve + read `.bh/current_focus.yaml`. SECURITY: an external agent could
 * repoint the symlink anywhere, so we readlink the RAW target (never let the OS
 * follow it for us), resolve it against `.bh/`, then realpath-canonicalize and
 * REFUSE anything that escapes the workspace before reading a byte. Returns null
 * for every benign "no focus" case: no symlink, not a symlink, an escaping or
 * dangling target. Throws FocusCorrupt only when the target exists, is contained,
 * and won't parse.
 */
export async function readCurrentFocus(
  fs: FsLike,
  workspaceRoot: string,
): Promise<FocusNode | null> {
  if (!fs.readlink) return null;
  const link = currentFocusLink(workspaceRoot);
  let target: string | null;
  try {
    target = await fs.readlink(link);
  } catch {
    return null;
  }
  if (target === null) return null; // absent, or a regular file (not a symlink)
  const bhDir = dirname(link); // <root>/.bh
  const abs = isAbsolute(target) ? target : join(bhDir, target);
  // Canonicalize + require containment (throws PathEscape on escape), then read
  // the returned canonical path with O_NOFOLLOW — same hardening as every other
  // mirror read. Any failure (escape, missing, unreadable) → "no focus".
  let safe: string;
  try {
    safe = await assertReadContained(fs, workspaceRoot, abs);
  } catch {
    return null;
  }
  let raw: string | null;
  try {
    raw = await readMaybeNoFollow(fs, safe);
  } catch {
    return null;
  }
  if (raw === null) return null; // dangling symlink (target focus.yaml is gone)
  try {
    return (parse(raw) ?? null) as FocusNode | null;
  } catch (cause) {
    throw new FocusCorrupt('<current_focus>', { cause });
  }
}
