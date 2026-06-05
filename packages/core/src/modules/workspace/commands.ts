import { basename, isAbsolute, resolve } from 'node:path';
import type { Context, Handler } from '../../kernel/index.js';
import { createDemo } from './demo.js';
import { listFiles, readFile, writeFile } from './files.js';
import { NAME_PATTERN, withConfigLock } from './lock.js';
import { materializeWorkspace } from './materialize.js';
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

/**
 * `workspace add <path> [--name <name>]`
 *  - Validates the path exists and is a directory.
 *  - Derives a name from basename (or uses `--name`); refuses duplicates.
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

  const name = args.name ?? basename(absPath);
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid workspace name: ${JSON.stringify(name)} (allowed: a-z, 0-9, . _ -, 1-64 chars, starts alnum)`,
    );
  }

  const addedAt = new Date().toISOString();
  const bhDir = `${absPath}/.bh`;
  // Atomic config section: dup-check + write must not interleave with a
  // concurrent add/use/setViewport or a workspace gets dropped. bhDir
  // creation lives inside too — cheap, and it's gated on this name winning
  // the dup-check.
  const { setAsCurrent, bhDirCreated } = await withConfigLock(ctx.configDir, async () => {
    const data = await readWorkspaces(ctx.fs, ctx.configDir);
    if (data.workspaces[name]) {
      throw new Error(`Workspace already exists: ${name}`);
    }
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
    return { setAsCurrent: becomesCurrent, bhDirCreated: created };
  });

  const setup = args.setup ? await runSetup(ctx.fs, absPath) : undefined;

  // Workspace-becoming-current = "opening" → materialize defaults (SR-v0
  // §3.1). For subsequent adds (not auto-current), materialization is
  // deferred to workspace.use.
  if (setAsCurrent) {
    await materializeWithFallback(ctx, absPath);
  }

  return {
    workspace: { name, path: absPath, addedAt },
    setAsCurrent,
    bhDirCreated,
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

/** `workspace use <name>` — switch the active workspace. Triggers eager
 * badge materialization (SR-v0 §3.1) so opening a workspace always leaves
 * every supported-type file with a default badge JSON. Idempotent on
 * re-use because existing badges are short-circuited via badge.get. */
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
  // Materialize outside the lock — it touches workspace files, not the
  // config, and can be slow; holding the config lock through it would stall
  // a concurrent setViewport for no correctness benefit.
  await materializeWithFallback(ctx, entry.path);
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
 * If the removed one was current, picks an alphabetically-first survivor (or null).
 */
export const remove: Handler<WorkspaceRemoveArgs, WorkspaceRemoveResult> = async (args, ctx) => {
  return withConfigLock(ctx.configDir, async () => {
    const data = await readWorkspaces(ctx.fs, ctx.configDir);
    if (!data.workspaces[args.name]) {
      throw new Error(`No such workspace: ${args.name}`);
    }
    const { [args.name]: _removed, ...rest } = data.workspaces;
    let newCurrent: string | null = data.current;
    if (data.current === args.name) {
      const survivors = Object.keys(rest).sort((a, b) => a.localeCompare(b));
      newCurrent = survivors[0] ?? null;
    }
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
    // Ensure .bh/ at the new path so subsequent badges/focus/inbound writes
    // have somewhere to live. Same lifecycle hook as workspace.add.
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
  // If this workspace is currently open, re-materialize at the new path
  // (eager badges + focus + inbound seeding). Mirrors workspace.use.
  if (isCurrent) {
    await materializeWithFallback(ctx, absPath);
  }
  return {
    workspace: { name: args.name, path: absPath, addedAt: existing.addedAt },
    bhDirCreated,
    ...(setup !== undefined && { setup }),
  };
};

/**
 * Materialize via the badges module + seed the focus.md contract surface
 * via the focus module. Both are "bootstrap on workspace open" work, and
 * both are tolerant of their module not being registered (tests can wire
 * only the workspace module; production createCore always has all five).
 *
 * Why focus.init lives here: an agent following the CLAUDE.md hint and
 * reading .bh/focus.md on a brand-new workspace used to get ENOENT before
 * any UI click ever happened. Seeding the empty template on every open
 * means the contract surface always exists.
 */
async function materializeWithFallback(ctx: Context, workspaceRoot: string): Promise<void> {
  // If the workspace folder vanished between add/use (e.g. user moved it
  // in Finder), short-circuit materialization. The renderer probes
  // reachability separately via workspace.listFiles and renders the
  // "Workspace folder not found" UI from there — bubbling a hard ENOENT
  // from use() would leave the renderer thinking the switch failed
  // outright and never flipping currentReachable to false in-session.
  const rootStat = await ctx.fs.stat(workspaceRoot);
  if (!rootStat) return;

  try {
    await materializeWorkspace(ctx.fs, ctx.run, workspaceRoot);
  } catch (err) {
    if (err instanceof Error && err.name === 'UnknownCommand') return;
    if (err instanceof Error && err.name === 'PathEscape') return;
    throw err;
  }
  try {
    await ctx.run('focus.init', {});
    // Re-entry liveness: prune any active file that vanished while we weren't
    // watching (git checkout, external rm, a delete with the app closed). The
    // watcher-driven dropOrphan handles LIVE deletes; this is the on-open
    // stat-based catch-up so a stale focus.md self-heals instead of pointing the
    // agent at deleted files. Runs after materialize, so present files keep
    // their (re)materialized badges and only truly-gone paths are pruned.
    await ctx.run('focus.pruneDangling', {});
  } catch (err) {
    if (err instanceof Error && err.name === 'UnknownCommand') return;
    // A planted symlink at .bh/focus.md escapes — skip seeding rather than
    // abort the whole workspace open (the hostile surface is neutralized).
    if (err instanceof Error && err.name === 'PathEscape') return;
    throw err;
  }
  try {
    await ctx.run('inbound.init', {});
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
    ['workspace.getViewport', getViewport as unknown as Handler<never, unknown>],
    ['workspace.setViewport', setViewport as unknown as Handler<never, unknown>],
    ['workspace.readFile', readFile as unknown as Handler<never, unknown>],
    ['workspace.writeFile', writeFile as unknown as Handler<never, unknown>],
  ];
}
