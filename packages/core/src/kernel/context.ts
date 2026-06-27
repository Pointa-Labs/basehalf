import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { PathEscape } from './contain.js';
import type {
  Context,
  FsLike,
  GitRunResult,
  GitRunner,
  HttpRunner,
  Run,
  SecretStore,
} from './types.js';

/**
 * Build the Context handed to every command handler.
 *
 * `run` is injected here (late-bound through a closure in createCore) so
 * `ctx.run('other.command', args)` lets modules compose via the registry
 * rather than importing each other's internals. The `opts.fs` and
 * `opts.configDir` overrides keep tests off the user's real home dir.
 *
 * `workspaceRoot` defaults to `null` here — this builds the BASE context (whose
 * fs/configDir are authoritative). The actual per-call root is set when
 * `createCore`'s run closure derives a fresh Context per `run({ workspaceRoot })`.
 */
export function createContext(opts: {
  run: Run;
  fs?: FsLike;
  configDir?: string;
  workspaceRoot?: string | null;
  git?: GitRunner;
  http?: HttpRunner;
  secrets?: SecretStore;
}): Context {
  return Object.freeze({
    fs: opts.fs ?? defaultFs(),
    configDir: opts.configDir ?? defaultConfigDir(),
    workspaceRoot: opts.workspaceRoot ?? null,
    run: opts.run,
    git: opts.git ?? defaultGit(),
    http: opts.http ?? defaultHttp(),
    secrets: opts.secrets ?? createInMemorySecrets(),
  });
}

/** The default secret store — in-memory, non-persistent. The desktop host
 *  overrides this with an OS-encrypted (safeStorage) store; tests inject a fake. */
export function createInMemorySecrets(): SecretStore {
  const map = new Map<string, string>();
  return {
    async get(key) {
      return map.get(key) ?? null;
    },
    async set(key, value) {
      map.set(key, value);
    },
    async delete(key) {
      map.delete(key);
    },
  };
}

/**
 * The default HTTP runner — global fetch with a timeout. Wired by the host into
 * Context; the remote-provider modules call it via `ctx.http`. Kept dependency-
 * free (no axios/node-fetch) so core stays light; tests inject a fake instead.
 */
export function defaultHttp(): HttpRunner {
  return async (req) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 20_000);
    try {
      const res = await fetch(req.url, {
        method: req.method,
        ...(req.headers !== undefined && { headers: { ...req.headers } }),
        ...(req.body !== undefined && { body: req.body }),
        signal: controller.signal,
      });
      const body = await res.text();
      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return { status: res.status, headers, body };
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * The bound workspace root for THIS call, or throw if none. Every module that
 * operates on a workspace's files / mirror anchors here — the replacement for
 * the old `ctx.run('workspace.current')` lookup against a mutable global. The
 * root is immutable for a call tree, so consumers are race-free by construction.
 */
export function requireWorkspaceRoot(ctx: Context): string {
  if (ctx.workspaceRoot === null) {
    throw new Error('No workspace bound to this call; pass { workspaceRoot } to run()');
  }
  return ctx.workspaceRoot;
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
    async symlink(target, path) {
      await symlink(target, path);
    },
    async readlink(path) {
      try {
        return await readlink(path);
      } catch (err) {
        // ENOENT (missing) and EINVAL (exists but not a symlink) both mean
        // "no symlink target here" — the caller treats that as "no current
        // focus set" rather than an error.
        if (isENOENT(err) || hasCode(err, 'EINVAL')) return null;
        throw err;
      }
    },
  };
}

/** Thrown by defaultGit when git exits with an unaccepted code. Carries the
 *  exit code + stderr so the git module can classify (conflict / auth / not-a-repo). */
export class GitError extends Error {
  override readonly name = 'GitError';
  constructor(
    readonly exitCode: number,
    readonly stderr: string,
    readonly args: readonly string[],
  ) {
    super(`git ${args.join(' ')} failed (exit ${exitCode}): ${stderr.trim().split('\n')[0] ?? ''}`);
  }
}

const GIT_DEFAULT_TIMEOUT_MS = 30_000;
// Diffs / logs can be large; cap stdout so a pathological repo can't OOM the host.
const GIT_MAX_OUTPUT_BYTES = 50 * 1024 * 1024;

/**
 * The production GitRunner: spawns the system `git`. Every call gets
 * `-c core.quotepath=false` (UTF-8 paths, no octal-escaping), `GIT_OPTIONAL_LOCKS=0`
 * (a read never fights another process for index.lock), and a forced English +
 * UTF-8 locale so stderr classification (not-a-repo / auth / conflict …) matches
 * regardless of the host's locale. Rejects with GitError when the exit code isn't
 * accepted (default `[0]`), or a plain Error on spawn failure (git not installed),
 * timeout, or output overflow. Exported so the desktop host can wire it into
 * createCore — core never imports child_process elsewhere, keeping git mockable.
 */
export function defaultGit(): GitRunner {
  return (args, opts) =>
    new Promise<GitRunResult>((resolve, reject) => {
      const accept = opts.acceptExitCodes ?? [0];
      const timeoutMs = opts.timeoutMs ?? GIT_DEFAULT_TIMEOUT_MS;
      const child = spawn('git', ['-c', 'core.quotepath=false', ...args], {
        cwd: opts.cwd,
        // Force English + UTF-8 (so we can match git's stderr text on any locale)
        // and disable the pager (a TTY-less spawn could otherwise hang). Mirrors
        // VS Code's git extension (extensions/git/src/git.ts spawn env).
        env: {
          ...process.env,
          ...(opts.env ?? {}),
          GIT_OPTIONAL_LOCKS: '0',
          LC_ALL: 'en_US.UTF-8',
          LANG: 'en_US.UTF-8',
          LANGUAGE: 'en',
          GIT_PAGER: 'cat',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const outChunks: Buffer[] = [];
      const errChunks: Buffer[] = [];
      let outLen = 0;
      let errLen = 0;
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      // Overflow on EITHER stream → kill + reject, never silently truncate. A half
      // stdout fed to the porcelain parser corrupts the result (a cut-off `-z`
      // field); an UNBOUNDED stderr is just as dangerous — push/pull/fetch stream
      // progress to stderr under the 120s remote timeout, so it must be capped too.
      const overflow = (): void => {
        child.kill('SIGKILL');
        finish(() =>
          reject(new Error(`git ${args.join(' ')} output exceeded ${GIT_MAX_OUTPUT_BYTES} bytes`)),
        );
      };
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(() => reject(new Error(`git ${args.join(' ')} timed out after ${timeoutMs}ms`)));
      }, timeoutMs);
      child.stdout.on('data', (c: Buffer) => {
        outLen += c.length;
        if (outLen > GIT_MAX_OUTPUT_BYTES) {
          overflow();
          return;
        }
        outChunks.push(c);
      });
      child.stderr.on('data', (c: Buffer) => {
        errLen += c.length;
        if (errLen > GIT_MAX_OUTPUT_BYTES) {
          overflow();
          return;
        }
        errChunks.push(c);
      });
      child.on('error', (err) => finish(() => reject(err)));
      // Swallow stdin write errors: if git exits before draining stdin (a rejected
      // commit, an empty/over-buffer message), the write end gets EPIPE — an
      // unhandled 'error' on the stream would crash the host. The real failure is
      // reported by the close handler's exit code.
      child.stdin.on('error', () => undefined);
      child.on('close', (code) => {
        const exitCode = code ?? -1;
        const stdout = Buffer.concat(outChunks).toString('utf8');
        const stderr = Buffer.concat(errChunks).toString('utf8');
        finish(() =>
          accept.includes(exitCode)
            ? resolve({ stdout, stderr, exitCode })
            : reject(new GitError(exitCode, stderr, args)),
        );
      });
      child.stdin.end(opts.stdin ?? '');
    });
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
