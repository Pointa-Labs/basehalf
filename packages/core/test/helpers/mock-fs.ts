import { Buffer } from 'node:buffer';
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
  fileBytes: Map<string, Uint8Array>;
  dirs: Set<string>;
  /** maxBytes of every `readFileBytesCappedNoFollow` call, for boundedness assertions. */
  capRequests: number[];
} {
  const files = new Map<string, string>();
  const fileBytes = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  const capRequests: number[] = [];

  function addAncestors(path: string): void {
    let parent = path;
    while (parent.includes('/') && parent !== '/') {
      parent = parent.slice(0, parent.lastIndexOf('/'));
      if (parent) dirs.add(parent);
    }
  }

  const fs: FsLike = {
    async readFile(path) {
      if (fileBytes.has(path))
        return Buffer.from(fileBytes.get(path) as Uint8Array).toString('utf8');
      return files.has(path) ? (files.get(path) as string) : null;
    },
    async readFileBytes(path) {
      if (fileBytes.has(path)) return Buffer.from(fileBytes.get(path) as Uint8Array);
      return files.has(path) ? Buffer.from(files.get(path) as string, 'utf8') : null;
    },
    async writeFile(path, content) {
      files.set(path, content);
      fileBytes.delete(path);
      addAncestors(path);
    },
    async mkdir(path, opts) {
      dirs.add(path);
      if (opts?.recursive) addAncestors(path);
    },
    async stat(path) {
      if (files.has(path) || fileBytes.has(path)) return { isFile: true, isDirectory: false };
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
      for (const f of fileBytes.keys()) {
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
    async unlink(path) {
      files.delete(path);
      fileBytes.delete(path);
    },
    // This in-memory fs has no symlinks, so realpath is identity for an
    // existing path and ENOENT otherwise — exactly what kernel/contain.ts
    // expects (it walks up to the deepest existing ancestor on ENOENT). The
    // containment guards therefore pass through cleanly under mockFs; real
    // symlink-escape behavior is covered by tests that use the actual fs.
    async realpath(path) {
      if (files.has(path) || fileBytes.has(path) || dirs.has(path)) return path;
      throw Object.assign(new Error(`ENOENT: no such file, realpath '${path}'`), {
        code: 'ENOENT',
      });
    },
    async lstat(path) {
      if (files.has(path) || fileBytes.has(path)) return { isSymbolicLink: false };
      if (dirs.has(path)) return { isSymbolicLink: false };
      return null;
    },
    // No symlinks in-memory, so O_NOFOLLOW reads/writes are just the plain ops.
    async readFileNoFollow(path) {
      return fs.readFile(path);
    },
    async readFileBytesNoFollow(path) {
      return fs.readFileBytes ? fs.readFileBytes(path) : null;
    },
    // Bounded prefix read (records the requested budget so tests can assert the
    // caller never asks for the whole file).
    async readFileBytesCappedNoFollow(path, maxBytes) {
      capRequests.push(maxBytes);
      const whole = fileBytes.has(path)
        ? Buffer.from(fileBytes.get(path) as Uint8Array)
        : files.has(path)
          ? Buffer.from(files.get(path) as string, 'utf8')
          : null;
      return whole === null ? null : whole.subarray(0, maxBytes);
    },
    async writeFileNoFollow(path, content) {
      files.set(path, content);
      fileBytes.delete(path);
      addAncestors(path);
    },
  };

  return { fs, files, fileBytes, dirs, capRequests };
}
