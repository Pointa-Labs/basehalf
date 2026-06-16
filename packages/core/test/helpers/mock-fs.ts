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
  /** In-memory symlink table: path → raw target string. The mock has no real
   *  symlink resolution (realpath stays identity), but focus.get resolves the
   *  current_focus target MANUALLY via readlink, so in-bounds focus round-trips
   *  work. A symlink ESCAPE (target outside the workspace) can't be simulated
   *  here — those cases use a real fs temp dir (see path-escape.test.ts). */
  links: Map<string, string>;
  /** Optional per-file mtime (epoch ms) returned by `stat`. Empty by default —
   *  seeding via `files.set` leaves mtime ABSENT (stat omits `mtimeMs`), so
   *  freshness-comparing code degrades instead of firing on every legacy test.
   *  Tests that exercise freshness set explicit epoch values here. */
  mtimes: Map<string, number>;
  /** maxBytes of every `readFileBytesCappedNoFollow` call, for boundedness assertions. */
  capRequests: number[];
} {
  const files = new Map<string, string>();
  const fileBytes = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  const links = new Map<string, string>();
  const mtimes = new Map<string, number>();
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
      if (files.has(path) || fileBytes.has(path)) {
        const mtimeMs = mtimes.get(path);
        return { isFile: true, isDirectory: false, ...(mtimeMs !== undefined && { mtimeMs }) };
      }
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
      // Real fs.unlink throws ENOENT on a missing path — focus.clear relies on
      // that to report cleared:false when no current_focus symlink exists. A
      // symlink is removed by unlink too (so focus.clear / repoint works).
      const removed = files.delete(path) || fileBytes.delete(path) || links.delete(path);
      if (!removed) {
        throw Object.assign(new Error(`ENOENT: no such file, unlink '${path}'`), {
          code: 'ENOENT',
        });
      }
    },
    // Atomic move. Handles a single file AND a directory (moving every
    // descendant file/dir by prefix) so folder rename via workspace.renameEntry
    // is exercised under the mock, not just single-file note renames.
    async rename(from, to) {
      if (files.has(from)) {
        files.set(to, files.get(from) as string);
        files.delete(from);
        fileBytes.delete(from);
        addAncestors(to);
        return;
      }
      if (fileBytes.has(from)) {
        fileBytes.set(to, fileBytes.get(from) as Uint8Array);
        fileBytes.delete(from);
        files.delete(from);
        addAncestors(to);
        return;
      }
      if (dirs.has(from)) {
        const prefix = `${from}/`;
        const remap = (p: string): string => to + p.slice(from.length);
        for (const [k, v] of [...files]) {
          if (k.startsWith(prefix)) {
            files.set(remap(k), v);
            files.delete(k);
          }
        }
        for (const [k, v] of [...fileBytes]) {
          if (k.startsWith(prefix)) {
            fileBytes.set(remap(k), v);
            fileBytes.delete(k);
          }
        }
        for (const d of [...dirs]) {
          if (d === from || d.startsWith(prefix)) {
            dirs.add(remap(d));
            dirs.delete(d);
          }
        }
        dirs.add(to);
        addAncestors(to);
        return;
      }
      throw Object.assign(new Error(`ENOENT: no such file, rename '${from}'`), { code: 'ENOENT' });
    },
    // Permanent delete. recursive removes a directory + all descendants by
    // prefix; a file ignores recursive. Mirrors node fs.rm(force:false): a
    // missing path throws ENOENT.
    async rm(path, opts) {
      let removed = files.delete(path) || fileBytes.delete(path);
      if (dirs.has(path)) {
        dirs.delete(path);
        removed = true;
        if (opts?.recursive) {
          const prefix = `${path}/`;
          for (const k of [...files.keys()]) if (k.startsWith(prefix)) files.delete(k);
          for (const k of [...fileBytes.keys()]) if (k.startsWith(prefix)) fileBytes.delete(k);
          for (const d of [...dirs]) if (d.startsWith(prefix)) dirs.delete(d);
        }
      }
      if (!removed) {
        throw Object.assign(new Error(`ENOENT: no such file or directory, rm '${path}'`), {
          code: 'ENOENT',
        });
      }
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
    async writeFileNoFollow(path, content, opts) {
      if (opts?.excl && (files.has(path) || fileBytes.has(path) || dirs.has(path))) {
        throw Object.assign(new Error(`EEXIST: file already exists, open '${path}'`), {
          code: 'EEXIST',
        });
      }
      files.set(path, content);
      fileBytes.delete(path);
      addAncestors(path);
    },
    // ── Minimal in-memory symlinks (focus current_focus support) ──────────────
    // Record links[path] = target. The real fs throws EEXIST when `path` is
    // already taken by a file or link; the focus store always unlinks first, so
    // matching that contract keeps focus.set's (unlink-then-symlink) cycle happy.
    async symlink(target, path) {
      if (files.has(path) || fileBytes.has(path) || links.has(path)) {
        throw Object.assign(new Error(`EEXIST: file already exists, symlink '${path}'`), {
          code: 'EEXIST',
        });
      }
      links.set(path, target);
      addAncestors(path);
    },
    // Return the raw target if `path` is a symlink; null for ENOENT (absent) or
    // EINVAL (a regular file / dir, not a symlink) — matches defaultFs.readlink.
    async readlink(path) {
      return links.has(path) ? (links.get(path) as string) : null;
    },
  };

  return { fs, files, fileBytes, dirs, links, mtimes, capRequests };
}
