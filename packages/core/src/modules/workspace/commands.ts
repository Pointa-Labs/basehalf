import { basename, isAbsolute, join, resolve } from 'node:path';
import type { Context, Handler } from '../../kernel/index.js';
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
  WorkspaceListFilesArgs,
  WorkspaceListFilesEntry,
  WorkspaceListFilesResult,
  WorkspaceListResult,
  WorkspaceRemoveArgs,
  WorkspaceRemoveResult,
  WorkspaceUseArgs,
  WorkspaceUseResult,
} from './types.js';

const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

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

  const data = await readWorkspaces(ctx.fs, ctx.configDir);
  if (data.workspaces[name]) {
    throw new Error(`Workspace already exists: ${name}`);
  }

  const addedAt = new Date().toISOString();
  const bhDir = `${absPath}/.bh`;
  const bhStat = await ctx.fs.stat(bhDir);
  const bhDirCreated = bhStat === null;
  if (bhDirCreated) {
    await ctx.fs.mkdir(bhDir, { recursive: true });
  }

  const setAsCurrent = data.current === null;
  await writeWorkspaces(ctx.fs, ctx.configDir, {
    version: 1,
    current: setAsCurrent ? name : data.current,
    workspaces: { ...data.workspaces, [name]: { path: absPath, addedAt } },
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
    .map(([name, entry]) => ({ name, path: entry.path, addedAt: entry.addedAt }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { current: data.current, workspaces };
};

/** `workspace use <name>` — switch the active workspace. Triggers eager
 * badge materialization (SR-v0 §3.1) so opening a workspace always leaves
 * every supported-type file with a default badge JSON. Idempotent on
 * re-use because existing badges are short-circuited via badge.get. */
export const use: Handler<WorkspaceUseArgs, WorkspaceUseResult> = async (args, ctx) => {
  const data = await readWorkspaces(ctx.fs, ctx.configDir);
  const entry = data.workspaces[args.name];
  if (!entry) {
    throw new Error(`No such workspace: ${args.name}`);
  }
  await writeWorkspaces(ctx.fs, ctx.configDir, { ...data, current: args.name });
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
};

/**
 * `workspace.listFiles({ path })` — single-level directory listing for the
 * desktop NavTree. Lazy by design: only direct children, sorted dirs-first
 * then alphabetical. The renderer drives recursion by calling again with a
 * child dir's path when the user expands it.
 *
 * Filtering (hidden files like .git / .bh / .DS_Store) is the renderer's
 * job — keeping core unopinionated about display lets the same data feed
 * different UIs (CLI, MCP, alternative shells).
 */
export const listFiles: Handler<WorkspaceListFilesArgs, WorkspaceListFilesResult> = async (
  args,
  ctx,
) => {
  const absPath = isAbsolute(args.path) ? args.path : resolve(args.path);
  const stat = await ctx.fs.stat(absPath);
  if (!stat) {
    // Tagged so the desktop NavTree can render a "workspace unreachable"
    // re-select / unregister modal instead of a raw error string.
    throw Object.assign(new Error(`Path does not exist: ${absPath}`), {
      code: 'PATH_NOT_FOUND',
    });
  }
  if (!stat.isDirectory) throw new Error(`Path is not a directory: ${absPath}`);

  const names = await ctx.fs.readdir(absPath);
  const entries: WorkspaceListFilesEntry[] = [];
  for (const name of names) {
    const childStat = await ctx.fs.stat(join(absPath, name));
    if (!childStat) continue;
    entries.push({ name, type: childStat.isDirectory ? 'dir' : 'file' });
  }
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return { path: absPath, entries };
};

/**
 * Helper for `createCore()` — registers all workspace commands.
 * Modules expose a single `register*Module(core)` function so static composition
 * stays trivial; when external plugins arrive, the same shape is what they emit.
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
    ['workspace.listFiles', listFiles as unknown as Handler<never, unknown>],
  ];
}

export function _coerceContext(ctx: unknown): asserts ctx is Context {
  if (!ctx || typeof ctx !== 'object') throw new TypeError('invalid context');
}

/**
 * Materialize via the badges module, but tolerate it not being registered.
 * Tests can wire only the workspace module without dragging badges in;
 * production createCore always has both.
 */
async function materializeWithFallback(ctx: Context, workspaceRoot: string): Promise<void> {
  try {
    await materializeWorkspace(ctx.fs, ctx.run, workspaceRoot);
  } catch (err) {
    if (err instanceof Error && err.name === 'UnknownCommand') return;
    throw err;
  }
}
