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
  WorkspaceGetViewportArgs,
  WorkspaceGetViewportResult,
  WorkspaceListArgs,
  WorkspaceListFilesArgs,
  WorkspaceListFilesEntry,
  WorkspaceListFilesResult,
  WorkspaceListResult,
  WorkspaceReadFileArgs,
  WorkspaceReadFileResult,
  WorkspaceRemoveArgs,
  WorkspaceRemoveResult,
  WorkspaceRenameArgs,
  WorkspaceRenameResult,
  WorkspaceSetViewportArgs,
  WorkspaceSetViewportResult,
  WorkspaceUseArgs,
  WorkspaceUseResult,
  WorkspaceWriteFileArgs,
  WorkspaceWriteFileResult,
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

/** `workspace.getViewport()` — last persisted canvas viewport for the current
 * workspace; null if never set. */
export const getViewport: Handler<WorkspaceGetViewportArgs, WorkspaceGetViewportResult> = async (
  _args,
  ctx,
) => {
  const data = await readWorkspaces(ctx.fs, ctx.configDir);
  if (data.current === null) return null;
  const entry = data.workspaces[data.current];
  return entry?.viewport ?? null;
};

/** `workspace.setViewport({ viewport })` — persist canvas viewport for the
 * current workspace. No-op if no current workspace. */
export const setViewport: Handler<WorkspaceSetViewportArgs, WorkspaceSetViewportResult> = async (
  args,
  ctx,
) => {
  const data = await readWorkspaces(ctx.fs, ctx.configDir);
  if (data.current === null) return {};
  const entry = data.workspaces[data.current];
  if (!entry) return {};
  await writeWorkspaces(ctx.fs, ctx.configDir, {
    ...data,
    workspaces: {
      ...data.workspaces,
      [data.current]: { ...entry, viewport: args.viewport },
    },
  });
  return {};
};

function ensureInsideWorkspace(rel: string): void {
  // Path comes from renderer via IPC — defensively reject anything that
  // could escape the current workspace root.
  if (rel.length === 0) throw new Error('Empty path');
  if (isAbsolute(rel)) throw new Error(`Path must be relative, got: ${rel}`);
  if (rel.split(/[\\/]/).some((seg) => seg === '..')) {
    throw new Error(`Path traversal rejected: ${rel}`);
  }
}

/** `workspace.readFile({ path })` — read a user file in the current
 * workspace. Path is POSIX-relative; absolute paths or `..` are rejected. */
export const readFile: Handler<WorkspaceReadFileArgs, WorkspaceReadFileResult> = async (
  args,
  ctx,
) => {
  ensureInsideWorkspace(args.path);
  const data = await readWorkspaces(ctx.fs, ctx.configDir);
  if (data.current === null) throw new Error('No current workspace');
  const entry = data.workspaces[data.current];
  if (!entry) throw new Error('Current workspace pointer is stale');
  const abs = join(entry.path, args.path);
  const content = await ctx.fs.readFile(abs);
  if (content === null) {
    throw Object.assign(new Error(`Path does not exist: ${abs}`), { code: 'PATH_NOT_FOUND' });
  }
  return { path: args.path, content };
};

/** `workspace.writeFile({ path, content })` — write a user file inside the
 * current workspace. The *only* path through which bh modifies user
 * content. Used exclusively by the BlockNote editor in PR 14; everything
 * else is observer-only per IR-v2-13. */
export const writeFile: Handler<WorkspaceWriteFileArgs, WorkspaceWriteFileResult> = async (
  args,
  ctx,
) => {
  ensureInsideWorkspace(args.path);
  const data = await readWorkspaces(ctx.fs, ctx.configDir);
  if (data.current === null) throw new Error('No current workspace');
  const entry = data.workspaces[data.current];
  if (!entry) throw new Error('Current workspace pointer is stale');
  const abs = join(entry.path, args.path);
  await ctx.fs.writeFile(abs, args.content);
  return { path: args.path, bytes: Buffer.byteLength(args.content, 'utf8') };
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
    ['workspace.rename', rename as unknown as Handler<never, unknown>],
    ['workspace.listFiles', listFiles as unknown as Handler<never, unknown>],
    ['workspace.getViewport', getViewport as unknown as Handler<never, unknown>],
    ['workspace.setViewport', setViewport as unknown as Handler<never, unknown>],
    ['workspace.readFile', readFile as unknown as Handler<never, unknown>],
    ['workspace.writeFile', writeFile as unknown as Handler<never, unknown>],
  ];
}

export function _coerceContext(ctx: unknown): asserts ctx is Context {
  if (!ctx || typeof ctx !== 'object') throw new TypeError('invalid context');
}

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
  try {
    await materializeWorkspace(ctx.fs, ctx.run, workspaceRoot);
  } catch (err) {
    if (err instanceof Error && err.name === 'UnknownCommand') return;
    throw err;
  }
  try {
    await ctx.run('focus.init', {});
  } catch (err) {
    if (err instanceof Error && err.name === 'UnknownCommand') return;
    throw err;
  }
  try {
    await ctx.run('inbound.init', {});
  } catch (err) {
    if (err instanceof Error && err.name === 'UnknownCommand') return;
    throw err;
  }
}
