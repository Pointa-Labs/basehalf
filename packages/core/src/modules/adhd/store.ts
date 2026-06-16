import { type FsLike, mirrorRevision, patchMirror, readMirror } from '../../kernel/index.js';
import { AdhdCorrupt, type AdhdFile } from './types.js';

/**
 * ADHD persistence over the kernel `.bh/mirror/` YAML store. A file's reading
 * aids live at `<workspace>/.bh/mirror/<file>/adhd.yaml`. Path containment,
 * O_NOFOLLOW guards, and the field-scoped write lock all live in the mirror store.
 */

export async function readAdhd(
  fs: FsLike,
  workspaceRoot: string,
  file: string,
): Promise<AdhdFile | null> {
  try {
    return await readMirror<AdhdFile>(fs, workspaceRoot, file, 'adhd');
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'MirrorCorrupt') {
      throw new AdhdCorrupt(file, { cause });
    }
    throw cause;
  }
}

/** Atomic field-scoped RMW on a file's adhd.yaml (external-writer safe). */
export async function patchAdhd(
  fs: FsLike,
  workspaceRoot: string,
  file: string,
  patch: (current: AdhdFile | null) => AdhdFile | null,
): Promise<AdhdFile | null> {
  try {
    return await patchMirror<AdhdFile>(fs, workspaceRoot, file, 'adhd', patch);
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'MirrorCorrupt') {
      throw new AdhdCorrupt(file, { cause });
    }
    throw cause;
  }
}

/** Cheap signature (count + newest mtime) of the adhd store for a poll. */
export async function adhdRevision(
  fs: FsLike,
  workspaceRoot: string,
): Promise<{ count: number; maxMtimeMs: number }> {
  return mirrorRevision(fs, workspaceRoot, 'adhd');
}
