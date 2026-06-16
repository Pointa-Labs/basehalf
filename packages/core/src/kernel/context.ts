import { Buffer } from 'node:buffer';
import { constants } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { PathEscape } from './contain.js';
import type { Context, FsLike, Run } from './types.js';

/**
 * Build the Context handed to every command handler.
 *
 * `run` is injected here (late-bound through a closure in createCore) so
 * `ctx.run('other.command', args)` lets modules compose via the registry
 * rather than importing each other's internals. The `opts.fs` and
 * `opts.configDir` overrides keep tests off the user's real home dir.
 */
export function createContext(opts: {
  run: Run;
  fs?: FsLike;
  configDir?: string;
}): Context {
  return Object.freeze({
    fs: opts.fs ?? defaultFs(),
    configDir: opts.configDir ?? defaultConfigDir(),
    run: opts.run,
  });
}

/**
 * Wraps `node:fs/promises` into the lean `FsLike` shape modules see. Exported so
 * the desktop host can COMPOSE it — e.g. `{ ...defaultFs(), trash: shell.trashItem }`
 * — to add the Electron-only `trash` capability without core depending on Electron.
 */
export function defaultFs(): FsLike {
  return {
    async readFile(path) {
      try {
        return await readFile(path, 'utf8');
      } catch (err) {
        if (isENOENT(err)) return null;
        throw err;
      }
    },
    async readFileBytes(path) {
      try {
        return await readFile(path);
      } catch (err) {
        if (isENOENT(err)) return null;
        throw err;
      }
    },
    async writeFile(path, content) {
      await writeFile(path, content, 'utf8');
    },
    async mkdir(path, opts) {
      await mkdir(path, { recursive: opts?.recursive ?? false });
    },
    async stat(path) {
      try {
        const s = await stat(path);
        return { isFile: s.isFile(), isDirectory: s.isDirectory(), mtimeMs: s.mtimeMs };
      } catch (err) {
        if (isENOENT(err)) return null;
        throw err;
      }
    },
    async readdir(path) {
      return await readdir(path);
    },
    async unlink(path) {
      try {
        await unlink(path);
      } catch (err) {
        if (isENOENT(err)) return;
        throw err;
      }
    },
    async realpath(path) {
      // No ENOENT swallowing here: kernel/contain.ts relies on realpath
      // THROWING ENOENT to know it must walk up to the deepest existing
      // ancestor. Returns the fully symlink-resolved canonical path.
      return await realpath(path);
    },
    async lstat(path) {
      try {
        const s = await lstat(path);
        return { isSymbolicLink: s.isSymbolicLink() };
      } catch (err) {
        if (isENOENT(err)) return null;
        throw err;
      }
    },
    async readFileNoFollow(path) {
      // O_NOFOLLOW: if the trailing component is a symlink at open time, the
      // open fails ELOOP — so an attacker who races a symlink onto the (guard-
      // approved canonical) leaf between the check and this read is refused
      // instead of re-followed. Intermediate symlinks are still resolved
      // (POSIX O_NOFOLLOW only affects the trailing component), so a workspace
      // behind /var->/private/var is unaffected.
      let fh: Awaited<ReturnType<typeof open>>;
      try {
        fh = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      } catch (err) {
        if (isENOENT(err)) return null;
        if (isELOOP(err)) throw new PathEscape(path);
        throw err;
      }
      try {
        return await fh.readFile('utf8');
      } finally {
        await fh.close();
      }
    },
    async readFileBytesNoFollow(path) {
      let fh: Awaited<ReturnType<typeof open>>;
      try {
        fh = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      } catch (err) {
        if (isENOENT(err)) return null;
        if (isELOOP(err)) throw new PathEscape(path);
        throw err;
      }
      try {
        return await fh.readFile();
      } finally {
        await fh.close();
      }
    },
    async readFileBytesCappedNoFollow(path, maxBytes) {
      let fh: Awaited<ReturnType<typeof open>>;
      try {
        fh = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      } catch (err) {
        if (isENOENT(err)) return null;
        if (isELOOP(err)) throw new PathEscape(path);
        throw err;
      }
      try {
        if (maxBytes <= 0) return new Uint8Array(0);
        // A regular-file read from offset 0 fills the buffer up to maxBytes or
        // EOF, whichever comes first — so a huge file never lands in memory
        // whole, only this fixed prefix.
        const buf = Buffer.alloc(maxBytes);
        const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
        return buf.subarray(0, bytesRead);
      } finally {
        await fh.close();
      }
    },
    async writeFileNoFollow(path, content, opts) {
      // excl → O_EXCL (no O_TRUNC): create-or-fail, never clobber. Plain →
      // O_TRUNC: create-or-overwrite (the original write-back semantics).
      const flags = opts?.excl
        ? constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW
        : constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW;
      let fh: Awaited<ReturnType<typeof open>>;
      try {
        fh = await open(path, flags, 0o666);
      } catch (err) {
        if (isELOOP(err)) throw new PathEscape(path);
        throw err; // EEXIST (excl) propagates so the caller can re-pick a name
      }
      try {
        await fh.writeFile(content, 'utf8');
      } finally {
        await fh.close();
      }
    },
    async copyFile(src, dest, opts) {
      await copyFile(src, dest, opts?.excl ? constants.COPYFILE_EXCL : 0);
    },
    async rename(from, to) {
      await rename(from, to);
    },
    async rm(path, opts) {
      // force:false — surface a real ENOENT/EACCES rather than masking a delete
      // that didn't happen. recursive removes a non-empty dir + contents.
      await rm(path, { recursive: opts?.recursive ?? false, force: false });
    },
  };
}

/**
 * Resolve BaseHalf's user-global config directory:
 *  - `BH_CONFIG_DIR` env var wins (tests + power-users)
 *  - macOS:  ~/Library/Application Support/basehalf
 *  - Linux:  $XDG_CONFIG_HOME/basehalf  (fallback: ~/.config/basehalf)
 *  - Win:    %APPDATA%/basehalf  (fallback: ~/AppData/Roaming/basehalf)
 */
export function defaultConfigDir(): string {
  if (process.env.BH_CONFIG_DIR) return process.env.BH_CONFIG_DIR;
  const home = homedir();
  switch (platform()) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'basehalf');
    case 'win32':
      return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'basehalf');
    default:
      return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'basehalf');
  }
}

function isENOENT(err: unknown): boolean {
  return hasCode(err, 'ENOENT');
}

/** O_NOFOLLOW open of a symlink leaf fails ELOOP (EMLINK on some platforms). */
function isELOOP(err: unknown): boolean {
  return hasCode(err, 'ELOOP') || hasCode(err, 'EMLINK');
}

function hasCode(err: unknown, code: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === code
  );
}
