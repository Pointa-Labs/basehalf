/**
 * Normalize any `node:path`-produced path to use POSIX forward-slash
 * separators. On Windows `path.join` emits backslashes; both Node.js `fs` and
 * the in-memory mock-fs test helper require forward slashes. Calling this on
 * every path produced by `path.join / path.resolve / path.normalize` makes
 * the modules work correctly on Windows without changing test fixtures.
 */
export function toPosix(p: string): string {
  return p.replaceAll('\\', '/');
}

/**
 * Shared workspace-relative path guard.
 *
 * Any user-supplied path that gets joined onto the workspace root (or a
 * `.bh/` subdir) MUST be validated first, or a value like
 * `../../../etc/passwd` collapses through `path.join` and escapes the
 * workspace entirely — letting a badge / file write land anywhere on disk.
 * `workspace.writeFile` already guarded this inline; the badge store did
 * not, so `badge.set({ file: '../../../etc/passwd' })` wrote
 * `/etc/passwd.json`. This is the single shared guard both use.
 *
 * Lives in the kernel (not a module) because path safety is cross-cutting
 * infrastructure — modules may not import each other's internals, but all
 * may depend on the kernel.
 */
export function assertWorkspaceRelative(rel: string): void {
  if (typeof rel !== 'string' || rel.length === 0) {
    throw new Error('Path must be a non-empty string');
  }
  // Reject Windows drive letters (C:\) and POSIX absolute paths.
  if (/^([a-zA-Z]:[\\/]|[\\/])/.test(rel)) {
    throw new Error(`Path must be relative, got: ${rel}`);
  }
  // Reject any `..` segment under either separator — this is what would
  // otherwise let `path.join` walk above the workspace root.
  if (rel.split(/[\\/]/).some((seg) => seg === '..')) {
    throw new Error(`Path traversal rejected: ${rel}`);
  }
}
