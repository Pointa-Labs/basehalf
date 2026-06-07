// Shared filesystem-walk filters for the canvas view of a workspace.
//
// These decide what shows up AS A BADGE on the canvas: supported-type files get
// a tile; tooling/cruft directories are never recursed into. The NavTree shows
// the raw tree (any file), so a file outside SUPPORTED_FILE_EXTENSIONS still
// appears in the sidebar — it just doesn't get a canvas tile.
//
// Manually kept in sync with the renderer NavTree's HIDDEN_NAMES, search's
// SKIP_DIRS, and chokidar's IGNORED_GLOBS (acceptable while all are tiny; v0.x
// consolidates into .bh/config.json).

// SR-v0 §4.5 default canvas whitelist (v0 hardcoded; v0.x will move to config).
export const SUPPORTED_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.md',
  '.pdf',
  '.txt',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.mp4',
  '.mov',
  '.webm',
  '.mp3',
  '.wav',
  '.m4a',
  '.docx',
  '.pptx',
  '.xlsx',
]);

// Tooling cruft never gets a tile or is recursed into.
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

export function hasSupportedExt(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return false;
  return SUPPORTED_FILE_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

// POSIX paths on disk regardless of host (SR-v0 §3.1: relative paths use /).
export function toPosix(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).join('/');
}
