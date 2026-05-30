import { type Handler, assertReadContained, createKeyedMutex } from '../../kernel/index.js';
import type { BadgeListResult } from '../badges/types.js';
import type { WorkspaceCurrentResult } from '../workspace/types.js';
import { inboundPath, readInbound, writeInbound } from './store.js';
import type {
  InboundAddRefArgs,
  InboundEntry,
  InboundGetArgs,
  InboundGetResult,
  InboundIndex,
  InboundInitArgs,
  InboundInitResult,
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

// Serialize read → mutate → write on the SINGLE shared inbound.json per
// workspace root. Without it, two concurrent addRef calls to the same
// workspace both read the pre-write state and the second write clobbers the
// first (lost update — reproduced by test/inbound-concurrency.test.ts). The
// shared kernel mutex makes each op atomic within this process; cross-
// process `bh` CLI races at the filesystem level are out of scope.
const withIndexLock = createKeyedMutex();

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
  // Preserve a previously-recorded rebuildAt; never invent one. Incremental
  // addRef/removeRef writes are not "rebuilds" and shouldn't claim a fresh
  // timestamp — only inbound.rebuild does that.
  return index.rebuildAt !== undefined
    ? { ...index, entries, rebuildAt: index.rebuildAt }
    : { ...index, entries };
}

export const get: Handler<InboundGetArgs, InboundGetResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  const index = await readInbound(ctx.fs, root);
  return { entries: index.entries[args.file] ?? [] };
};

export const addRef: Handler<InboundAddRefArgs, InboundGetResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  return withIndexLock(root, async () => {
    const index = await readInbound(ctx.fs, root);
    const next = withEntry(index, args.to, (existing) => {
      const without = existing.filter((e) => e.from !== args.from);
      const newEntry: InboundEntry =
        args.note !== undefined ? { from: args.from, note: args.note } : { from: args.from };
      return [...without, newEntry];
    });
    await writeInbound(ctx.fs, root, next);
    return { entries: next.entries[args.to] ?? [] };
  });
};

export const removeRef: Handler<InboundRemoveRefArgs, InboundGetResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  return withIndexLock(root, async () => {
    const index = await readInbound(ctx.fs, root);
    const next = withEntry(index, args.to, (existing) =>
      existing.filter((e) => e.from !== args.from),
    );
    await writeInbound(ctx.fs, root, next);
    return { entries: next.entries[args.to] ?? [] };
  });
};

/**
 * Full rebuild: walk all badges, re-derive entries from their references.
 * Use when index is stale, missing, or corrupt; or as the bootstrap after
 * the user adds a workspace whose badges already have references.
 */
export const rebuild: Handler<InboundRebuildArgs, InboundRebuildResult> = async (_args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  // badge.list is a pure read; gather it before taking the lock so we hold
  // the write queue for the minimum time. The full-index overwrite itself
  // runs inside the lock so it can't interleave with a concurrent
  // addRef/removeRef (which would otherwise be lost or resurrected).
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
  await withIndexLock(root, () => writeInbound(ctx.fs, root, { bhVersion: 1, entries, rebuildAt }));
  return { rebuildAt, entryCount: Object.keys(entries).length };
};

/**
 * Seed `.bh/index/inbound.json` with an empty index if it doesn't exist
 * yet. Idempotent — re-running on a populated index is a no-op so an
 * existing reverse map is never clobbered. Called by workspace.add/use so
 * the agent contract surface always exists; without it an agent following
 * the CLAUDE.md hint and reading inbound.json on a brand-new workspace
 * (zero refs yet) gets ENOENT, which is ambiguous with "the index is
 * broken." An empty `{entries: {}}` answers "no inbound refs" cleanly.
 */
export const init: Handler<InboundInitArgs, InboundInitResult> = async (_args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  // Existence check + seed must be atomic against a concurrent addRef:
  // otherwise init could read "missing", an addRef could write the populated
  // index, and init's empty `{entries:{}}` would then clobber it. Doing the
  // check-then-write inside the lock closes that window.
  return withIndexLock(root, async () => {
    const existing = await ctx.fs.readFile(
      await assertReadContained(ctx.fs, root, inboundPath(root)),
    );
    if (existing !== null) return { created: false };
    await writeInbound(ctx.fs, root, { bhVersion: 1, entries: {} });
    return { created: true };
  });
};

export function commands(): ReadonlyArray<
  readonly [name: string, handler: Handler<never, unknown>]
> {
  return [
    ['inbound.get', get as unknown as Handler<never, unknown>],
    ['inbound.addRef', addRef as unknown as Handler<never, unknown>],
    ['inbound.removeRef', removeRef as unknown as Handler<never, unknown>],
    ['inbound.rebuild', rebuild as unknown as Handler<never, unknown>],
    ['inbound.init', init as unknown as Handler<never, unknown>],
  ];
}
