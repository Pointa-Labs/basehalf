import type { Handler } from '../../kernel/index.js';
import type { WorkspaceCurrentResult } from '../workspace/types.js';
import { listBadges, readBadge, removeBadge, writeBadge } from './store.js';
import type {
  BadgeAddRefArgs,
  BadgeDeleteArgs,
  BadgeDeleteResult,
  BadgeFile,
  BadgeGetArgs,
  BadgeGetResult,
  BadgeKind,
  BadgeListArgs,
  BadgeListResult,
  BadgeRemoveRefArgs,
  BadgeSetArgs,
  BadgeSetResult,
} from './types.js';

/**
 * Helper: every badge command operates on a workspace. We delegate to
 * `workspace.current` rather than threading the path through args so
 * callers don't have to repeat the lookup. `ctx.run` keeps the dep
 * arrow pointing inward (badges → workspace, not workspace → badges).
 */
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

export const get: Handler<BadgeGetArgs, BadgeGetResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  return readBadge(ctx.fs, root, args.file, args.kind ?? 'file');
};

export const set: Handler<BadgeSetArgs, BadgeSetResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  const kind: BadgeKind = args.patch?.kind ?? 'file';
  const existing = await readBadge(ctx.fs, root, args.file, kind);
  const now = new Date().toISOString();
  const patch = args.patch ?? {};

  const next: BadgeFile = existing
    ? {
        bhVersion: 1,
        file: existing.file,
        kind: existing.kind,
        ...(patch.prompt !== undefined
          ? { prompt: patch.prompt }
          : existing.prompt !== undefined && { prompt: existing.prompt }),
        references: patch.references ?? existing.references,
        ...(patch.canvas !== undefined
          ? { canvas: patch.canvas }
          : existing.canvas !== undefined && { canvas: existing.canvas }),
        createdAt: existing.createdAt,
        modifiedAt: now,
      }
    : {
        bhVersion: 1,
        file: args.file,
        kind,
        ...(patch.prompt !== undefined && { prompt: patch.prompt }),
        references: patch.references ?? [],
        ...(patch.canvas !== undefined && { canvas: patch.canvas }),
        createdAt: now,
        modifiedAt: now,
      };

  await writeBadge(ctx.fs, root, next);
  return next;
};

export const list: Handler<BadgeListArgs, BadgeListResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  let badges = await listBadges(ctx.fs, root);
  if (args.kind) {
    badges = badges.filter((b) => b.kind === args.kind);
  }
  if (args.query) {
    const q = args.query.toLowerCase();
    badges = badges.filter(
      (b) => b.file.toLowerCase().includes(q) || (b.prompt ?? '').toLowerCase().includes(q),
    );
  }
  return { badges };
};

export const del: Handler<BadgeDeleteArgs, BadgeDeleteResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  const deleted = await removeBadge(ctx.fs, root, args.file, args.kind ?? 'file');
  return { deleted };
};

export const addRef: Handler<BadgeAddRefArgs, BadgeFile> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  const kind = args.kind ?? 'file';
  const existing = await readBadge(ctx.fs, root, args.file, kind);
  const base: BadgeFile = existing ?? {
    bhVersion: 1,
    file: args.file,
    kind,
    references: [],
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  };
  const newRef = args.note !== undefined ? { to: args.to, note: args.note } : { to: args.to };
  const without = base.references.filter((r) => r.to !== args.to);
  const next: BadgeFile = {
    ...base,
    references: [...without, newRef],
    modifiedAt: new Date().toISOString(),
  };
  await writeBadge(ctx.fs, root, next);
  // Inbound index sync — best-effort; AR-PR11-2 lands the module.
  try {
    await ctx.run('inbound.addRef', { from: args.file, to: args.to, note: args.note });
  } catch (err) {
    // Inbound module may not be registered yet (PR11-2). Don't fail the badge op.
    if (!(err instanceof Error && err.name === 'UnknownCommand')) throw err;
  }
  return next;
};

export const removeRef: Handler<BadgeRemoveRefArgs, BadgeFile> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  const kind = args.kind ?? 'file';
  const existing = await readBadge(ctx.fs, root, args.file, kind);
  if (!existing) {
    throw new Error(`Badge not found: ${args.file}`);
  }
  const next: BadgeFile = {
    ...existing,
    references: existing.references.filter((r) => r.to !== args.to),
    modifiedAt: new Date().toISOString(),
  };
  await writeBadge(ctx.fs, root, next);
  try {
    await ctx.run('inbound.removeRef', { from: args.file, to: args.to });
  } catch (err) {
    if (!(err instanceof Error && err.name === 'UnknownCommand')) throw err;
  }
  return next;
};

export function commands(): ReadonlyArray<
  readonly [name: string, handler: Handler<never, unknown>]
> {
  return [
    ['badge.get', get as unknown as Handler<never, unknown>],
    ['badge.set', set as unknown as Handler<never, unknown>],
    ['badge.list', list as unknown as Handler<never, unknown>],
    ['badge.delete', del as unknown as Handler<never, unknown>],
    ['badge.addRef', addRef as unknown as Handler<never, unknown>],
    ['badge.removeRef', removeRef as unknown as Handler<never, unknown>],
  ];
}
