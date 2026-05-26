import type { FsLike } from '../../src/index.js';

/**
 * In-memory FsLike for tests. Tracks files (with content) + dirs (existence
 * only). `readdir` returns basenames of any child file or dir.
 *
 * - `mkdir(p, { recursive: true })` records p and all ancestor dirs.
 * - `writeFile` creates intermediate dirs implicitly (so handlers don't have
 *   to `mkdir` before every write).
 * - `readdir` on a missing path throws (real fs behavior).
 */
export function mockFs(): {
  fs: FsLike;
  files: Map<string, string>;
  dirs: Set<string>;
} {
  const files = new Map<string, string>();
  const dirs = new Set<string>();

  function addAncestors(path: string): void {
    let parent = path;
    while (parent.includes('/') && parent !== '/') {
      parent = parent.slice(0, parent.lastIndexOf('/'));
      if (parent) dirs.add(parent);
    }
  }

  const fs: FsLike = {
    async readFile(path) {
      return files.has(path) ? (files.get(path) as string) : null;
    },
    async writeFile(path, content) {
      files.set(path, content);
      addAncestors(path);
    },
    async mkdir(path, opts) {
      dirs.add(path);
      if (opts?.recursive) addAncestors(path);
    },
    async stat(path) {
      if (files.has(path)) return { isFile: true, isDirectory: false };
      if (dirs.has(path)) return { isFile: false, isDirectory: true };
      return null;
    },
    async readdir(path) {
      if (!dirs.has(path)) {
        const err = Object.assign(new Error(`ENOENT: no such directory, scandir '${path}'`), {
          code: 'ENOENT',
        });
        throw err;
      }
      const prefix = `${path}/`;
      const childNames = new Set<string>();
      for (const f of files.keys()) {
        if (f.startsWith(prefix)) {
          const rest = f.slice(prefix.length);
          const slashIdx = rest.indexOf('/');
          childNames.add(slashIdx === -1 ? rest : rest.slice(0, slashIdx));
        }
      }
      for (const d of dirs) {
        if (d.startsWith(prefix)) {
          const rest = d.slice(prefix.length);
          const slashIdx = rest.indexOf('/');
          if (slashIdx === -1 && rest.length > 0) childNames.add(rest);
        }
      }
      return Array.from(childNames).sort((a, b) => a.localeCompare(b));
    },
  };

  return { fs, files, dirs };
}
