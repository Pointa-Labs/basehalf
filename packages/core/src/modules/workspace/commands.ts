import { basename, isAbsolute, resolve } from 'node:path';
import type { Context, Handler } from '../../kernel/index.js';
import { createDemo } from './demo.js';
import {
  createFile,
  createFolder,
  deleteEntry,
  importFile,
  listCanvas,
  listFiles,
  listSupportedFiles,
  readFile,
  renameEntry,
  renameFile,
  writeFile,
} from './files.js';
import { NAME_PATTERN, withConfigLock } from './lock.js';
import { runSetup } from './setup.js';
import { readWorkspaces, writeWorkspaces } from './store.js';
import type {
  WorkspaceAddArgs,
  WorkspaceAddResult,
  WorkspaceCurrentArgs,
  WorkspaceCurrentResult,
  WorkspaceEntry,
  WorkspaceListArgs,
  WorkspaceListResult,
  WorkspaceRemoveArgs,
  WorkspaceRemoveResult,
  WorkspaceRenameArgs,
  WorkspaceRenameResult,
  WorkspaceRepathArgs,
  WorkspaceRepathResult,
  WorkspaceUseArgs,
  WorkspaceUseResult,
} from './types.js';
import { getViewport, setViewport } from './viewport.js';

/**
 * The workspaces.json registry: add/list/use/current/remove/rename/repath —
 * the read-modify-write transaction family over the single config file, plus
 * the open-time bootstrap (materializeWithFallback) the becoming-current paths
 * funnel through. The user-file I/O door, viewport persistence and demo
 * seeding live in sibling files (files.ts / viewport.ts / demo.ts); the shared
 * name-pattern + config mutex live in lock.ts so every mutator closes over the
 * same lock. The commands() table at the bottom re-exports every handler under
 * its workspace.* name regardless of which file defines it.
 */

/** Folder identity is the PATH, compared case-insensitively — the default
 *  macOS/Windows filesystems are case-insensitive, so `/Users/X/Notes` and
 *  `/users/x/notes` are the same folder and must hit the same registration.
 *  (Symlink aliasing is not chased here; the rare false-negative just yields
 *  a second registration, which is harmless.) */
function samePath(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** The workspace THIS call is bound to (by path), as a registry entry — or null
 *  if no root is bound or the bound path isn't registered. The replacement for
 *  the old global `current` pointer: `workspace.current` / `workspace.list`
 *  surface this (derived from `ctx.workspaceRoot`, which the host injects per
 *  call), so each window/call sees its own active workspace, race-free. */
function boundEntry(
  ctx: Context,
  data: { workspaces: Record<string, { path: string; addedAt: string }> },
): WorkspaceEntry | null {
  if (ctx.workspaceRoot === null) return null;
  const root = ctx.workspaceRoot;
  const found = Object.entries(data.workspaces).find(([, e]) => samePath(e.path, root));
  if (!found) return null;
  const [name, entry] = found;
  return { name, path: entry.path, addedAt: entry.addedAt };
}

/** Derive a registry name that doesn't collide: basename, then basename-2,
 *  -3, … — names are just labels; the folder path is the identity, so a
 *  label clash must never block opening a folder. Keeps NAME_PATTERN's
 *  64-char cap by trimming the base before suffixing. */
function uniqueName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const suffix = `-${i}`;
    const candidate = `${base.slice(0, 64 - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * `workspace add <path> [--name <name>]`
 *  - Validates the path exists and is a directory.
 *  - Folder identity is the PATH: re-adding a registered folder is a no-op
 *    that returns the existing entry (`alreadyRegistered: true`) instead of
 *    erroring — "open folder" must be idempotent, the way a mature editor
 *    focuses the existing window for a folder that's already open.
 *  - Derives a name from basename; a name taken by a DIFFERENT folder gets
 *    auto-suffixed (-2, -3, …). An EXPLICIT `--name` collision still errors
 *    (the user asked for that exact label).
 *  - Creates `<path>/.bh/` if missing (eager init; lazier feels surprising).
 *  - Pure registry mutation: there is no global "current" to set, and the
 *    on-open liveness sweep runs when a WINDOW opens the workspace (bound to its
 *    root), not here.
 */
export const add: Handler<WorkspaceAddArgs, WorkspaceAddResult> = async (args, ctx) => {
  const absPath = isAbsolute(args.path) ? args.path : resolve(args.path);
  const stat = await ctx.fs.stat(absPath);
  if (!stat) {
    throw new Error(`Path does not exist: ${absPath}`);
  }
  if (!stat.isDirectory) {
    throw new Error(`Path is not a directory: ${absPath}`);
  }

  const requestedName = args.name ?? basename(absPath);
  if (!NAME_PATTERN.test(requestedName)) {
    throw new Error(
      `Invalid workspace name: ${JSON.stringify(requestedName)} (allowed: a-z, 0-9, . _ -, 1-64 chars, starts alnum)`,
    );
  }

  const addedAt = new Date().toISOString();
  const bhDir = `${absPath}/.bh`;
  // Atomic config section: identity/name resolution + write must not
  // interleave with a concurrent add/use/setViewport or a workspace gets
  // dropped. bhDir creation lives inside too — cheap, and gated on the
  // resolution winning.
  const { workspace, bhDirCreated, alreadyRegistered } = await withConfigLock(
    ctx.configDir,
    async () => {
      const data = await readWorkspaces(ctx.fs, ctx.configDir);

      // Path identity first: this folder may already be registered (under
      // any name). Return that registration as-is (folder identity is the path).
      const existing = Object.entries(data.workspaces).find(([, e]) => samePath(e.path, absPath));
      if (existing) {
        const [existingName, entry] = existing;
        return {
          workspace: { name: existingName, path: entry.path, addedAt: entry.addedAt },
          bhDirCreated: false,
          alreadyRegistered: true,
        };
      }

      const taken = new Set(Object.keys(data.workspaces));
      if (args.name !== undefined && taken.has(args.name)) {
        throw new Error(`Workspace already exists: ${args.name}`);
      }
      const name = uniqueName(requestedName, taken);

      const bhStat = await ctx.fs.stat(bhDir);
      const created = bhStat === null;
      if (created) {
        await ctx.fs.mkdir(bhDir, { recursive: true });
      }
      await writeWorkspaces(ctx.fs, ctx.configDir, {
        version: 1,
        workspaces: { ...data.workspaces, [name]: { path: absPath, addedAt } },
      });
      return {
        workspace: { name, path: absPath, addedAt },
        bhDirCreated: created,
        alreadyRegistered: false,
      };
    },
  );

  const setup = args.setup ? await runSetup(ctx.fs, workspace.path) : undefined;

  // No "becoming current" and no on-open liveness sweep here: registering a folder
  // is pure registry mutation. The sweep (focus/badge pruneDangling) runs when a
  // WINDOW opens the workspace bound to its root — running it here would prune the
  // CALLER's bound workspace, not this newly-registered one.

  return {
    workspace,
    bhDirCreated,
    alreadyRegistered,
    ...(setup !== undefined && { setup }),
  };
};

/** `workspace list` — all registered workspaces + which one THIS call is bound to
 * (`current`, derived from ctx.workspaceRoot — not a stored pointer). */
export const list: Handler<WorkspaceListArgs, WorkspaceListResult> = async (_args, ctx) => {
  const data = await readWorkspaces(ctx.fs, ctx.configDir);
  const workspaces: WorkspaceEntry[] = Object.entries(data.workspaces)
    .map(([name, entry]) => ({
      name,
      path: entry.path,
      addedAt: entry.addedAt,
      ...(entry.viewport !== undefined && { viewport: entry.viewport }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { current: boundEntry(ctx, data)?.name ?? null, workspaces };
};

/** `workspace use <name>` — validate the workspace exists and return its entry.
 * It no longer writes a global pointer (there isn't one): the active workspace is
 * bound per WINDOW, so the desktop routes a switch to opening that workspace's
 * window (rebind + reload), where the on-open liveness sweep runs. Kept as a thin
 * validate-and-return so CLI/MCP string callers stay valid. */
export const use: Handler<WorkspaceUseArgs, WorkspaceUseResult> = async (args, ctx) => {
  const data = await readWorkspaces(ctx.fs, ctx.configDir);
  const found = data.workspaces[args.name];
  if (!found) {
    throw new Error(`No such workspace: ${args.name}`);
  }
  return { current: { name: args.name, path: found.path, addedAt: found.addedAt } };
};

/** `workspace current` — the workspace THIS call is bound to (or null). Derived
 * from ctx.workspaceRoot (the host injects the sender window's bound root), NOT a
 * global pointer, so each window/call sees its own active workspace. */
export const current: Handler<WorkspaceCurrentArgs, WorkspaceCurrentResult> = async (
  _args,
  ctx,
) => {
  const data = await readWorkspaces(ctx.fs, ctx.configDir);
  const entry = boundEntry(ctx, data);
  return entry === null ? { current: null } : { current: entry };
};

/**
 * `workspace remove <name>` — unregister. Does NOT delete files or `.bh/` —
 * BaseHalf is an "observer", never an owner of user files. There is no global
 * current pointer to clear; if the removed workspace was the one a window had
 * open, the desktop reloads that window to its welcome state (it owns the
 * window↔workspace binding), the way a mature editor closes a folder to an
 * empty window rather than yanking in an arbitrary survivor.
 */
export const remove: Handler<WorkspaceRemoveArgs, WorkspaceRemoveResult> = async (args, ctx) => {
  return withConfigLock(ctx.configDir, async () => {
    const data = await readWorkspaces(ctx.fs, ctx.configDir);
    if (!data.workspaces[args.name]) {
      throw new Error(`No such workspace: ${args.name}`);
    }
    const { [args.name]: _removed, ...rest } = data.workspaces;
    await writeWorkspaces(ctx.fs, ctx.configDir, {
      version: 1,
      workspaces: rest,
    });
    return { removed: args.name };
  });
};

/**
 * `workspace.rename(from, to)` — change a workspace's name without
 * touching its path / .bh/ / files. The window↔workspace binding is by PATH
 * (unchanged here), so an open window keeps tracking the same folder — it just
 * re-derives the new name on its next `workspace.list`.
 *
 * Why a dedicated command (vs remove + re-add): the obvious DIY recipe
 * is `workspace.remove(from) + workspace.add(path, name: to)`, but that
 * isn't atomic — if the add fails (e.g., the new name is taken by
 * another workspace, or `path` no longer exists on disk), the user is
 * left with no workspace registration at all. A single config-update
 * write makes the operation safe.
 */
export const rename: Handler<WorkspaceRenameArgs, WorkspaceRenameResult> = async (args, ctx) => {
  if (args.from === args.to) {
    throw new Error(`workspace.rename: from and to are the same (${args.from})`);
  }
  if (!NAME_PATTERN.test(args.to)) {
    throw new Error(
      `Invalid workspace name: ${JSON.stringify(args.to)} (allowed: a-z, 0-9, . _ -, 1-64 chars, starts alnum)`,
    );
  }
  return withConfigLock(ctx.configDir, async () => {
    const data = await readWorkspaces(ctx.fs, ctx.configDir);
    const source = data.workspaces[args.from];
    if (!source) {
      throw new Error(`No such workspace: ${args.from}`);
    }
    if (data.workspaces[args.to]) {
      throw new Error(`Workspace name already taken: ${args.to}`);
    }
    // Build the new workspaces map; we re-insert the renamed entry to
    // preserve insertion order on JSON serialization. Other entries are
    // unchanged.
    const next: Record<string, (typeof data.workspaces)[string]> = {};
    for (const [name, entry] of Object.entries(data.workspaces)) {
      if (name === args.from) {
        next[args.to] = entry;
      } else {
        next[name] = entry;
      }
    }
    await writeWorkspaces(ctx.fs, ctx.configDir, {
      version: 1,
      workspaces: next,
    });
    return {
      workspace: { name: args.to, path: source.path, addedAt: source.addedAt },
    };
  });
};

/**
 * `workspace.repath(name, path)` — rebind an existing workspace to a new
 * folder path. Atomic config-update; preserves name + addedAt; creates
 * `.bh/` at the new path if missing; runs setup if requested.
 *
 * Why a dedicated command (vs remove + re-add): the obvious DIY recipe
 * is `workspace.remove(name)` + `workspace.add(newPath, name)`, but if
 * the add fails (invalid path, missing folder, ...), the user is left
 * with NO workspace registration at all. A single config rewrite
 * skips that danger. The window↔workspace binding is by PATH; a window that had
 * this workspace open at the OLD path is stale after a repath, so the desktop
 * re-opens it at the new path (rebind + reload), where the liveness sweep runs.
 */
export const repath: Handler<WorkspaceRepathArgs, WorkspaceRepathResult> = async (args, ctx) => {
  const absPath = isAbsolute(args.path) ? args.path : resolve(args.path);
  const stat = await ctx.fs.stat(absPath);
  if (!stat) {
    throw new Error(`Path does not exist: ${absPath}`);
  }
  if (!stat.isDirectory) {
    throw new Error(`Path is not a directory: ${absPath}`);
  }
  const bhDir = `${absPath}/.bh`;
  // Atomic config section: validate against the live config + rewrite the
  // entry without interleaving with a concurrent config write. bhDir
  // creation is inside too (cheap, gated on validation).
  const { existing, bhDirCreated } = await withConfigLock(ctx.configDir, async () => {
    const data = await readWorkspaces(ctx.fs, ctx.configDir);
    const found = data.workspaces[args.name];
    if (!found) {
      throw new Error(`No such workspace: ${args.name}`);
    }
    if (found.path === absPath) {
      throw new Error(`Workspace ${args.name} is already at ${absPath}`);
    }
    // Ensure .bh/ at the new path so subsequent mirror writes (badge / canvas /
    // focus / adhd YAML) have somewhere to live. Same lifecycle hook as workspace.add.
    const bhStat = await ctx.fs.stat(bhDir);
    const created = bhStat === null;
    if (created) {
      await ctx.fs.mkdir(bhDir, { recursive: true });
    }
    await writeWorkspaces(ctx.fs, ctx.configDir, {
      version: 1,
      workspaces: {
        ...data.workspaces,
        [args.name]: { path: absPath, addedAt: found.addedAt },
      },
    });
    return { existing: found, bhDirCreated: created };
  });
  const setup = args.setup ? await runSetup(ctx.fs, absPath) : undefined;
  return {
    workspace: { name: args.name, path: absPath, addedAt: existing.addedAt },
    bhDirCreated,
    ...(setup !== undefined && { setup }),
  };
};

/**
 * Helper for `createCore()` — registers all workspace commands.
 * Modules expose a single `register*Module(core)` function so static composition
 * stays trivial; when external plugins arrive, the same shape is what they emit.
 *
 * Handlers are imported from sibling files (demo/files/viewport) but registered
 * here under their existing workspace.* names — the registration surface is
 * unchanged, so CLI/desktop/MCP string callers are untouched by the file split.
 */
export function commands(): ReadonlyArray<
  readonly [name: string, handler: Handler<never, unknown>]
> {
  return [
    ['workspace.add', add as unknown as Handler<never, unknown>],
    ['workspace.list', list as unknown as Handler<never, unknown>],
    ['workspace.use', use as unknown as Handler<never, unknown>],
    ['workspace.current', current as unknown as Handler<never, unknown>],
    ['workspace.remove', remove as unknown as Handler<never, unknown>],
    ['workspace.rename', rename as unknown as Handler<never, unknown>],
    ['workspace.repath', repath as unknown as Handler<never, unknown>],
    ['workspace.createDemo', createDemo as unknown as Handler<never, unknown>],
    ['workspace.listFiles', listFiles as unknown as Handler<never, unknown>],
    ['workspace.listCanvas', listCanvas as unknown as Handler<never, unknown>],
    ['workspace.listSupportedFiles', listSupportedFiles as unknown as Handler<never, unknown>],
    ['workspace.getViewport', getViewport as unknown as Handler<never, unknown>],
    ['workspace.setViewport', setViewport as unknown as Handler<never, unknown>],
    ['workspace.readFile', readFile as unknown as Handler<never, unknown>],
    ['workspace.writeFile', writeFile as unknown as Handler<never, unknown>],
    ['workspace.renameFile', renameFile as unknown as Handler<never, unknown>],
    ['workspace.importFile', importFile as unknown as Handler<never, unknown>],
    ['workspace.createFile', createFile as unknown as Handler<never, unknown>],
    ['workspace.createFolder', createFolder as unknown as Handler<never, unknown>],
    ['workspace.deleteEntry', deleteEntry as unknown as Handler<never, unknown>],
    ['workspace.renameEntry', renameEntry as unknown as Handler<never, unknown>],
  ];
}
