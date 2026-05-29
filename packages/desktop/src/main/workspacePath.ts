import { realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';

/**
 * Resolve a workspace-relative path to an absolute path that is PROVABLY inside
 * the workspace root — the guard used before handing a path to the OS (e.g.
 * shell.openPath).
 *
 * A string-only check (reject absolute / `..`) is NOT enough: a malicious
 * workspace can plant a symlink whose name has no `..` and isn't absolute, but
 * whose target escapes the root (or points at a `.app`/`.command`/`.sh` the OS
 * would LAUNCH). So we canonicalize with fs.realpath and require the real target
 * to be the real root or strictly under it. Missing paths and realpath failures
 * are refused rather than guessed.
 *
 * Kept electron-free (only node:fs/path) so it's unit-testable without the
 * Electron runtime.
 */
export async function resolveInsideWorkspace(
  workspaceRoot: string,
  relPath: unknown,
): Promise<{ ok: true; abs: string } | { ok: false; error: string }> {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    return { ok: false, error: 'A path is required.' };
  }
  // Fast string pre-filter (belt-and-suspenders; realpath below is authoritative).
  if (
    relPath.startsWith('/') ||
    relPath.startsWith('\\') ||
    relPath.split(/[\\/]/).includes('..')
  ) {
    return { ok: false, error: 'Refusing to open a path outside the workspace.' };
  }
  try {
    const realRoot = await realpath(workspaceRoot);
    // realpath FOLLOWS symlinks, so a planted symlink resolves to its true
    // target — which the containment check below then rejects if it escaped.
    const realTarget = await realpath(join(realRoot, relPath));
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) {
      return { ok: false, error: 'Refusing to open a path outside the workspace.' };
    }
    return { ok: true, abs: realTarget };
  } catch (err) {
    // ENOENT (the file doesn't exist) or any realpath failure — refuse.
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
