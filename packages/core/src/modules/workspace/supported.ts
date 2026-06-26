// Shared filesystem-walk filters for the canvas view of a workspace.
//
// The canvas shows EVERY file as a card — code, config, and extensionless files
// (Dockerfile, Makefile, LICENSE) included. Only two things are held back: a
// tooling/cruft DIRECTORY (SKIP_NAMES, never recursed into) and an OS/editor
// JUNK file (HIDDEN_FILE_NAMES, e.g. .DS_Store). This is a denylist — a node
// earns a tile unless it's one of those — so the canvas and the NavTree (which
// shows the same raw tree) now agree by construction: neither filters by
// extension. (Until 2026-06 the canvas applied an extension whitelist that hid
// code files; "code = first-class" removed it.)
//
// Manually kept in sync with the renderer NavTree's HIDDEN_NAMES, search's
// SKIP_DIRS, and chokidar's IGNORED_GLOBS (acceptable while all are tiny; v0.x
// consolidates into .bh/config.json).

// Tooling cruft directories: never get a tile, never recursed into.
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

// OS / editor junk files: real on disk but never the user's content, so they
// get no canvas card even though the canvas otherwise shows every file. The
// file-level counterpart to SKIP_NAMES (which the canvas walk applies to dirs).
export const HIDDEN_FILE_NAMES: ReadonlySet<string> = new Set([
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
]);

/**
 * Does this file earn a canvas tile? Everything that isn't OS/editor cruft —
 * the canvas stopped filtering by extension, so code, config, and
 * extensionless files all get cards now. Directory-level skipping is
 * SKIP_NAMES, applied by the caller (a dir is not a file).
 */
export function isCanvasFile(name: string): boolean {
  return !HIDDEN_FILE_NAMES.has(name);
}

// POSIX paths on disk regardless of host (SR-v0 §3.1: relative paths use /).
export function toPosix(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).join('/');
}
