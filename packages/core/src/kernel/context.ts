import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
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

/** Wraps `node:fs/promises` into the lean `FsLike` shape modules see. */
function defaultFs(): FsLike {
  return {
    async readFile(path) {
      try {
        return await readFile(path, 'utf8');
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
        return { isFile: s.isFile(), isDirectory: s.isDirectory() };
      } catch (err) {
        if (isENOENT(err)) return null;
        throw err;
      }
    },
    async readdir(path) {
      return await readdir(path);
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
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'ENOENT'
  );
}
