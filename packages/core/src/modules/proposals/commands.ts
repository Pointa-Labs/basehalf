import { type Handler, createKeyedMutex } from '../../kernel/index.js';
import type { WorkspaceCurrentResult } from '../workspace/types.js';
import { readProposals, writeProposals } from './store.js';
import type {
  ProposalsClearArgs,
  ProposalsClearResult,
  ProposalsDismissArgs,
  ProposalsDismissResult,
  ProposalsListArgs,
  ProposalsListResult,
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

// Serialize the read-modify-write of proposals.md so a dismiss can't race a
// concurrent dismiss/clear and resurrect a removed line. Same kernel mutex the
// other .bh/ stores use. [[bh-json-rmw-race]]
const withProposalsLock = createKeyedMutex();

export const list: Handler<ProposalsListArgs, ProposalsListResult> = async (_args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  return { proposals: await readProposals(ctx.fs, root) };
};

export const dismiss: Handler<ProposalsDismissArgs, ProposalsDismissResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  return withProposalsLock(root, async () => {
    const proposals = await readProposals(ctx.fs, root);
    const kept = proposals.filter((p) => p.line !== args.line);
    if (kept.length === proposals.length) {
      // Out-of-range index — nothing removed; return the current list unchanged.
      return { dismissed: false, proposals };
    }
    // Re-index the survivors so `line` stays a contiguous 0-based handle.
    const reindexed = kept.map((p, i) => ({ ...p, line: i }));
    await writeProposals(ctx.fs, root, reindexed);
    return { dismissed: true, proposals: reindexed };
  });
};

export const clear: Handler<ProposalsClearArgs, ProposalsClearResult> = async (_args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  return withProposalsLock(root, async () => {
    const proposals = await readProposals(ctx.fs, root);
    if (proposals.length === 0) return { cleared: 0 };
    await writeProposals(ctx.fs, root, []);
    return { cleared: proposals.length };
  });
};

export function commands(): ReadonlyArray<
  readonly [name: string, handler: Handler<never, unknown>]
> {
  return [
    ['proposals.list', list as unknown as Handler<never, unknown>],
    ['proposals.dismiss', dismiss as unknown as Handler<never, unknown>],
    ['proposals.clear', clear as unknown as Handler<never, unknown>],
  ];
}
