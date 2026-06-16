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
 *  - First workspace added becomes `current` automatically.
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
  const { workspace, setAsCurrent, bhDirCreated, alreadyRegistered } = await withConfigLock(
    ctx.configDir,
    async () => {
      const data = await readWorkspaces(ctx.fs, ctx.configDir);

      // Path identity first: this folder may already be registered (under
      // any name). Return that registration; make it current if nothing is.
      const existing = Object.entries(data.workspaces).find(([, e]) => samePath(e.path, absPath));
      if (existing) {
        const [existingName, entry] = existing;
        const becomesCurrent = data.current === null;
        if (becomesCurrent) {
          await writeWorkspaces(ctx.fs, ctx.configDir, { ...data, current: existingName });
        }
        return {
          workspace: { name: existingName, path: entry.path, addedAt: entry.addedAt },
          setAsCurrent: becomesCurrent,
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
      const becomesCurrent = data.current === null;
      await writeWorkspaces(ctx.fs, ctx.configDir, {
        version: 1,
        current: becomesCurrent ? name : data.current,
        workspaces: { ...data.workspaces, [name]: { path: absPath, addedAt } },
      });
      return {
        workspace: { name, path: absPath, addedAt },
        setAsCurrent: becomesCurrent,
        bhDirCreated: created,
        alreadyRegistered: false,
      };
    },
  );

  const setup = args.setup ? await runSetup(ctx.fs, workspace.path) : undefined;

  // Workspace-becoming-current = "opening" → run the on-open liveness sweep.
  // For subsequent adds (not auto-current), this is deferred to workspace.use.
  if (setAsCurrent) {
    await bootstrapWorkspace(ctx, workspace.path);
  }

  return {
    workspace,
    setAsCurrent,
    bhDirCreated,
    alreadyRegistered,
    ...(setup !== undefined && { setup }),
  };
};

/** `workspace list` — returns all workspaces + which is current. */
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
  return { current: data.current, workspaces };
};

/** `workspace use <name>` — switch the active workspace. Runs the on-open
 * liveness sweep (focus + badge dangling prune); the canvas reads the filesystem
 * per folder (workspace.listCanvas), so there is no eager badge materialization. */
export const use: Handler<WorkspaceUseArgs, WorkspaceUseResult> = async (args, ctx) => {
  const entry = await withConfigLock(ctx.configDir, async () => {
    const data = await readWorkspaces(ctx.fs, ctx.configDir);
    const found = data.workspaces[args.name];
    if (!found) {
      throw new Error(`No such workspace: ${args.name}`);
    }
    await writeWorkspaces(ctx.fs, ctx.configDir, { ...data, current: args.name });
    return found;
  });
  // Bootstrap outside the lock — it touches workspace files, not the config;
  // holding the config lock through it would stall a concurrent setViewport
  // for no correctness benefit.
  await bootstrapWorkspace(ctx, entry.path);
  return { current: { name: args.name, path: entry.path, addedAt: entry.addedAt } };
};

/** `workspace current` — show active workspace (or null if none). */
export const current: Handler<WorkspaceCurrentArgs, WorkspaceCurrentResult> = async (
  _args,
  ctx,
) => {
  const data = await readWorkspaces(ctx.fs, ctx.configDir);
  if (data.current === null) return { current: null };
  const entry = data.workspaces[data.current];
  if (!entry) {
    // Stale pointer: current name no longer in workspaces. Treat as none.
    return { current: null };
  }
  return { current: { name: data.current, path: entry.path, addedAt: entry.addedAt } };
};

/**
 * `workspace remove <name>` — unregister. Does NOT delete files or `.bh/` —
 * BaseHalf is an "observer", never an owner of user files.
 * Removing the CURRENT workspace leaves none current — the app shows its
 * empty/welcome state and the user picks what to open next. (Auto-promoting
 * an arbitrary survivor used to yank a folder the user never asked for into
 * view; closing a folder must end in an empty window, like a mature editor.)
 */
export const remove: Handler<WorkspaceRemoveArgs, WorkspaceRemoveResult> = async (args, ctx) => {
  return withConfigLock(ctx.configDir, async () => {
    const data = await readWorkspaces(ctx.fs, ctx.configDir);
    if (!data.workspaces[args.name]) {
      throw new Error(`No such workspace: ${args.name}`);
    }
    const { [args.name]: _removed, ...rest } = data.workspaces;
    const newCurrent = data.current === args.name ? null : data.current;
    await writeWorkspaces(ctx.fs, ctx.configDir, {
      version: 1,
      current: newCurrent,
      workspaces: rest,
    });
    return { removed: args.name, newCurrent };
  });
};

/**
 * `workspace.rename(from, to)` — change a workspace's name without
 * touching its path / .bh/ / files. Updates the `current` pointer if it
 * was the renamed one.
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
    const currentUpdated = data.current === args.from;
    await writeWorkspaces(ctx.fs, ctx.configDir, {
      version: 1,
      current: currentUpdated ? args.to : data.current,
      workspaces: next,
    });
    return {
      workspace: { name: args.to, path: source.path, addedAt: source.addedAt },
      currentUpdated,
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
 * skips that danger and the round-trip through `current` demotion.
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
  // creation is inside too (cheap, gated on validation). isCurrent is
  // captured for the post-lock materialization decision.
  const { existing, bhDirCreated, isCurrent } = await withConfigLock(ctx.configDir, async () => {
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
    // current pointer stays put (still pointing at this name if it was).
    await writeWorkspaces(ctx.fs, ctx.configDir, {
      version: 1,
      current: data.current,
      workspaces: {
        ...data.workspaces,
        [args.name]: { path: absPath, addedAt: found.addedAt },
      },
    });
    return { existing: found, bhDirCreated: created, isCurrent: data.current === args.name };
  });
  const setup = args.setup ? await runSetup(ctx.fs, absPath) : undefined;
  // If this workspace is currently open, re-run the on-open liveness sweep at the
  // new path. Mirrors workspace.use.
  if (isCurrent) {
    await bootstrapWorkspace(ctx, absPath);
  }
  return {
    workspace: { name: args.name, path: absPath, addedAt: existing.addedAt },
    bhDirCreated,
    ...(setup !== undefined && { setup }),
  };
};

/**
 * The on-open LIVENESS SWEEP. Nothing is seeded — the mirror is sparse (the canvas
 * reads the filesystem per folder via workspace.listCanvas; badges/focus/adhd are
 * created lazily on first annotation, and `.bh/current_focus.yaml` is simply absent
 * until the first node is focused). What this DOES is reconcile the derived state
 * against the disk after time away (a git checkout, an external rm, edits with the
 * app closed): clear a dangling current_focus symlink and mark orphan any badge
 * whose file vanished. Tolerant of a module not being registered (tests can wire
 * only the workspace module; production createCore always has all of them).
 */
async function bootstrapWorkspace(ctx: Context, workspaceRoot: string): Promise<void> {
  // If the workspace folder vanished between add/use (e.g. user moved it in
  // Finder), short-circuit. The renderer probes reachability separately via
  // workspace.listFiles and renders the "Workspace folder not found" UI from
  // there — bubbling a hard ENOENT here would leave the renderer thinking the
  // switch failed outright and never flip currentReachable to false in-session.
  const rootStat = await ctx.fs.stat(workspaceRoot);
  if (!rootStat) return;

  try {
    // Re-entry liveness: if the current focus points at a node whose file/folder
    // vanished while we weren't watching (git checkout, external rm, a delete with
    // the app closed), clear the dangling current_focus symlink.
    await ctx.run('focus.pruneDangling', {});
  } catch (err) {
    if (err instanceof Error && err.name === 'UnknownCommand') return;
    // A planted symlink at .bh/current_focus.yaml escapes — skip rather than abort
    // the whole workspace open (the hostile surface is neutralized).
    if (err instanceof Error && err.name === 'PathEscape') return;
    throw err;
  }
  try {
    // Re-entry liveness for the DEEP graph (badges + embedded referenced_by), the analog of
    // focus.pruneDangling above: a badge whose file was deleted while the watcher
    // wasn't running carries no orphan flag, so an agent following the hint into
    // .bh/mirror/<path>/badge.yaml would be pointed at files that don't exist. Mark
    // them orphan on open so the graph stays as live as the focus.
    await ctx.run('badge.pruneDangling', {});
  } catch (err) {
    if (err instanceof Error && err.name === 'UnknownCommand') return;
    if (err instanceof Error && err.name === 'PathEscape') return;
    throw err;
  }
}

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
