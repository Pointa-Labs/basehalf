import {
  type FsLike,
  mirrorRevision,
  patchMirror,
  readMirror,
  removeMirror,
  writeMirror,
} from '../../kernel/index.js';
import { CanvasCorrupt, type CanvasFile } from './types.js';

/**
 * Canvas persistence over the kernel `.bh/mirror/` YAML store. A folder's canvas
 * lives at `<workspace>/.bh/mirror/<folder>/canvas.yaml` (root folder → rel
 * `''`). Path containment, O_NOFOLLOW guards, and the field-scoped write lock all
 * live in the mirror store — this layer just maps canvas ⇄ mirror node and
 * normalizes the nullable folder arg.
 */

/** A nullable folder arg (`null`/`''`/`'.'` = workspace root) → mirror rel. */
export function canvasRel(folder: string | null | undefined): string {
  return folder == null ? '' : folder;
}

export async function readCanvas(
  fs: FsLike,
  workspaceRoot: string,
  folder: string | null,
): Promise<CanvasFile | null> {
  try {
    return await readMirror<CanvasFile>(fs, workspaceRoot, canvasRel(folder), 'canvas');
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'MirrorCorrupt') {
      throw new CanvasCorrupt(canvasRel(folder), { cause });
    }
    throw cause;
  }
}

export async function writeCanvas(
  fs: FsLike,
  workspaceRoot: string,
  canvas: CanvasFile,
): Promise<void> {
  await writeMirror(fs, workspaceRoot, canvas.path, 'canvas', canvas);
}

/** Atomic field-scoped RMW on a folder's canvas.yaml (external-writer safe). */
export async function patchCanvas(
  fs: FsLike,
  workspaceRoot: string,
  folder: string | null,
  patch: (current: CanvasFile | null) => CanvasFile | null,
): Promise<CanvasFile | null> {
  try {
    return await patchMirror<CanvasFile>(fs, workspaceRoot, canvasRel(folder), 'canvas', patch);
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'MirrorCorrupt') {
      throw new CanvasCorrupt(canvasRel(folder), { cause });
    }
    throw cause;
  }
}

export async function removeCanvas(
  fs: FsLike,
  workspaceRoot: string,
  folder: string | null,
): Promise<boolean> {
  return removeMirror(fs, workspaceRoot, canvasRel(folder), 'canvas');
}

/** Cheap signature (count + newest mtime) of the canvas store for a poll. */
export async function canvasRevision(
  fs: FsLike,
  workspaceRoot: string,
): Promise<{ count: number; maxMtimeMs: number }> {
  return mirrorRevision(fs, workspaceRoot, 'canvas');
}
