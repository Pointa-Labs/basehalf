import type { Handler } from '../../kernel/index.js';
import type { BadgeListResult } from '../badges/types.js';
import type { WorkspaceCurrentResult } from '../workspace/types.js';
import { readInbound, writeInbound } from './store.js';
import type {
  InboundAddRefArgs,
  InboundEntry,
  InboundGetArgs,
  InboundGetResult,
  InboundIndex,
  InboundRebuildArgs,
  InboundRebuildResult,
  InboundRemoveRefArgs,
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

function withEntry(
  index: InboundIndex,
  to: string,
  mutate: (entries: readonly InboundEntry[]) => readonly InboundEntry[],
): InboundIndex {
  const current = index.entries[to] ?? [];
  const next = mutate(current);
  const entries: Record<string, readonly InboundEntry[]> = { ...index.entries };
  if (next.length === 0) {
    delete entries[to];
  } else {
    entries[to] = next;
  }
  return { ...index, entries, rebuildAt: index.rebuildAt };
}

export const get: Handler<InboundGetArgs, InboundGetResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  const index = await readInbound(ctx.fs, root);
  return { entries: index.entries[args.file] ?? [] };
};

export const addRef: Handler<InboundAddRefArgs, InboundGetResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  const index = await readInbound(ctx.fs, root);
  const next = withEntry(index, args.to, (existing) => {
    const without = existing.filter((e) => e.from !== args.from);
    const newEntry: InboundEntry =
      args.note !== undefined ? { from: args.from, note: args.note } : { from: args.from };
    return [...without, newEntry];
  });
  await writeInbound(ctx.fs, root, next);
  return { entries: next.entries[args.to] ?? [] };
};

export const removeRef: Handler<InboundRemoveRefArgs, InboundGetResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  const index = await readInbound(ctx.fs, root);
  const next = withEntry(index, args.to, (existing) =>
    existing.filter((e) => e.from !== args.from),
  );
  await writeInbound(ctx.fs, root, next);
  return { entries: next.entries[args.to] ?? [] };
};

/**
 * Full rebuild: walk all badges, re-derive entries from their references.
 * Use when index is stale, missing, or corrupt; or as the bootstrap after
 * the user adds a workspace whose badges already have references.
 */
export const rebuild: Handler<InboundRebuildArgs, InboundRebuildResult> = async (_args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  const { badges } = await ctx.run<Record<string, never>, BadgeListResult>('badge.list', {});

  const entries: Record<string, InboundEntry[]> = {};
  for (const badge of badges) {
    for (const ref of badge.references) {
      const list = entries[ref.to] ?? [];
      const entry: InboundEntry =
        ref.note !== undefined ? { from: badge.file, note: ref.note } : { from: badge.file };
      list.push(entry);
      entries[ref.to] = list;
    }
  }
  const rebuildAt = new Date().toISOString();
  await writeInbound(ctx.fs, root, { bhVersion: 1, entries, rebuildAt });
  return { rebuildAt, entryCount: Object.keys(entries).length };
};

export function commands(): ReadonlyArray<
  readonly [name: string, handler: Handler<never, unknown>]
> {
  return [
    ['inbound.get', get as unknown as Handler<never, unknown>],
    ['inbound.addRef', addRef as unknown as Handler<never, unknown>],
    ['inbound.removeRef', removeRef as unknown as Handler<never, unknown>],
    ['inbound.rebuild', rebuild as unknown as Handler<never, unknown>],
  ];
}
