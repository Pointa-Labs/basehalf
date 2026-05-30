import { type Handler, createKeyedMutex } from '../../kernel/index.js';
import type { WorkspaceCurrentResult } from '../workspace/types.js';
import { listViews, readView, removeView, slugifyId, viewPath, writeView } from './store.js';
import type {
  SavedView,
  ViewAddMemberArgs,
  ViewAddMemberResult,
  ViewCreateArgs,
  ViewCreateResult,
  ViewDeleteArgs,
  ViewDeleteResult,
  ViewGetArgs,
  ViewGetResult,
  ViewListArgs,
  ViewListResult,
  ViewMember,
  ViewRemoveMemberArgs,
  ViewRemoveMemberResult,
  ViewUpdateArgs,
  ViewUpdateResult,
} from './types.js';

async function currentWorkspaceRoot(ctx: Parameters<Handler>[1]): Promise<string> {
  const current = await ctx.run<Record<string, never>, WorkspaceCurrentResult>(
    'workspace.current',
    {},
  );
  if (current.current === null) {
    throw new Error('No current workspace; call workspace.use first');
  }
  return current.current.path;
}

// Serialize read → mutate → write on each view's JSON file. create / update
// / addMember / removeMember / delete all do this dance, and the desktop
// fires them concurrently: a canvas drag persists position via addMember
// while badge.rename rewrites the same view's membership (removeMember +
// addMember), or two rapid drags overlap. Without serialization both read
// the pre-write view and the second write clobbers the first — silently
// dropping a member or a drag (reproduced by test/views-concurrency.test.ts).
// Keyed by the view's on-disk path so ops on DIFFERENT views still run
// concurrently. Single-process scope, like inbound — see kernel/mutex.ts.
const withViewLock = createKeyedMutex();

export const create: Handler<ViewCreateArgs, ViewCreateResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  const id = args.id ?? slugifyId(args.name);
  // Existence-check + write must be atomic, or two concurrent creates of the
  // same id both pass the check and both write.
  return withViewLock(viewPath(root, id), async () => {
    const existing = await readView(ctx.fs, root, id);
    if (existing) {
      throw new Error(`View already exists: ${id}`);
    }
    const now = new Date().toISOString();
    const view: SavedView = {
      bhVersion: 1,
      id,
      name: args.name,
      ...(args.prompt !== undefined && { prompt: args.prompt }),
      members: [],
      createdAt: now,
      modifiedAt: now,
    };
    await writeView(ctx.fs, root, view);
    return view;
  });
};

export const list: Handler<ViewListArgs, ViewListResult> = async (_args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  const views = await listViews(ctx.fs, root);
  return { views };
};

export const get: Handler<ViewGetArgs, ViewGetResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  return readView(ctx.fs, root, args.id);
};

export const update: Handler<ViewUpdateArgs, ViewUpdateResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  const next = await withViewLock(viewPath(root, args.id), async () => {
    const existing = await readView(ctx.fs, root, args.id);
    if (!existing) {
      throw new Error(`View not found: ${args.id}`);
    }
    const updated: SavedView = {
      ...existing,
      name: args.patch.name ?? existing.name,
      ...(args.patch.prompt !== undefined
        ? { prompt: args.patch.prompt }
        : existing.prompt !== undefined && { prompt: existing.prompt }),
      modifiedAt: new Date().toISOString(),
    };
    await writeView(ctx.fs, root, updated);
    return updated;
  });
  // A view's prompt IS its agent-facing intent: focus.set({viewId}) carries it
  // into focus.md's `intent:` line. So when the prompt changes, a brief focused
  // FROM this view would keep the stale intent (the agent + the "Copy brief"
  // button read it). focus.refreshViewIntent re-publishes it — but ONLY when
  // focus.md's `# source-view:` provenance is exactly this view (set by focus.set
  // for a view-derived focus), atomically under the focus lock. Best-effort: a
  // derived-.bh/-state failure must not turn a saved prompt into a failed
  // view.update (mirrors how badge edits treat focus.resync as non-fatal).
  if (args.patch.prompt !== undefined) {
    try {
      await ctx.run('focus.refreshViewIntent', { viewId: args.id });
    } catch {
      // focus.md unreachable/hostile etc. — the view edit still succeeded.
    }
  }
  return next;
};

export const del: Handler<ViewDeleteArgs, ViewDeleteResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  // Under the lock so a concurrent addMember can't read the view, delete
  // races in, then addMember's write resurrects the just-deleted view.
  return withViewLock(viewPath(root, args.id), async () => {
    const deleted = await removeView(ctx.fs, root, args.id);
    return { deleted };
  });
};

export const addMember: Handler<ViewAddMemberArgs, ViewAddMemberResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  return withViewLock(viewPath(root, args.id), async () => {
    const existing = await readView(ctx.fs, root, args.id);
    if (!existing) {
      throw new Error(`View not found: ${args.id}`);
    }
    const without = existing.members.filter((m) => m.file !== args.file);
    const member: ViewMember = {
      file: args.file,
      ...(args.position !== undefined && { x: args.position.x, y: args.position.y }),
      ...(args.collapsed !== undefined && { collapsed: args.collapsed }),
    };
    const next: SavedView = {
      ...existing,
      members: [...without, member],
      modifiedAt: new Date().toISOString(),
    };
    await writeView(ctx.fs, root, next);
    return next;
  });
};

export const removeMember: Handler<ViewRemoveMemberArgs, ViewRemoveMemberResult> = async (
  args,
  ctx,
) => {
  const root = await currentWorkspaceRoot(ctx);
  return withViewLock(viewPath(root, args.id), async () => {
    const existing = await readView(ctx.fs, root, args.id);
    if (!existing) {
      throw new Error(`View not found: ${args.id}`);
    }
    const next: SavedView = {
      ...existing,
      members: existing.members.filter((m) => m.file !== args.file),
      modifiedAt: new Date().toISOString(),
    };
    await writeView(ctx.fs, root, next);
    return next;
  });
};

export function commands(): ReadonlyArray<
  readonly [name: string, handler: Handler<never, unknown>]
> {
  return [
    ['view.create', create as unknown as Handler<never, unknown>],
    ['view.list', list as unknown as Handler<never, unknown>],
    ['view.get', get as unknown as Handler<never, unknown>],
    ['view.update', update as unknown as Handler<never, unknown>],
    ['view.delete', del as unknown as Handler<never, unknown>],
    ['view.addMember', addMember as unknown as Handler<never, unknown>],
    ['view.removeMember', removeMember as unknown as Handler<never, unknown>],
  ];
}
