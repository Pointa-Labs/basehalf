import {
  type Handler,
  assertReadContained,
  createKeyedMutex,
  readMaybeNoFollow,
} from '../../kernel/index.js';
import type { WorkspaceCurrentResult } from '../workspace/types.js';
import { focusPath, readFocusBrief, writeFocus } from './store.js';
import type {
  FocusClearArgs,
  FocusClearResult,
  FocusGetArgs,
  FocusGetResult,
  FocusInitArgs,
  FocusInitResult,
  FocusItem,
  FocusResyncArgs,
  FocusResyncResult,
  FocusSetArgs,
  FocusSetResult,
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

// Serialize every WRITE to a workspace's focus.md. focus.resync is a genuine
// read-modify-write (read the active list, re-render with fresh badge data,
// write back), so two concurrent badge edits racing resync could interleave a
// stale read with a fresh write and lose the newer brief. set/clear take the
// same lock so a resync can't clobber a just-issued set (or vice versa). Same
// kernel mutex the inbound index uses for its RMW. [[bh-json-rmw-race]]
const withFocusLock = createKeyedMutex();

/**
 * Inline each active file's curated MEANING (prompt + outbound ref-notes) so
 * the agent reads the whole brief in one pass instead of re-reading N badge
 * JSONs. Composed via ctx.run only (module isolation); a file with no badge
 * (or a folder) contributes its bare path. Shared by focus.set + focus.resync
 * so they assemble identical briefs.
 */
async function assembleItems(
  ctx: Parameters<Handler>[1],
  files: readonly string[],
): Promise<FocusItem[]> {
  const items: FocusItem[] = [];
  for (const file of files) {
    let badge: BadgeGetMinimal | null = null;
    try {
      badge = await ctx.run<{ file: string }, BadgeGetMinimal | null>('badge.get', { file });
    } catch {
      badge = null;
    }
    const refs = (badge?.references ?? [])
      .filter((r) => r.to)
      .map((r) => ({ to: r.to, ...(r.note !== undefined && r.note !== '' && { note: r.note }) }));
    items.push({
      file,
      ...(badge?.prompt !== undefined && badge.prompt !== '' && { prompt: badge.prompt }),
      ...(refs.length > 0 && { refs }),
    });
  }
  return items;
}

// Minimal shapes for the cross-module reads focus.set composes via ctx.run
// (never imports another module's internals — keeps the dep arrow one-way).
interface ViewGetMinimal {
  readonly prompt?: string;
  readonly members: readonly { readonly file: string }[];
}
interface BadgeGetMinimal {
  readonly prompt?: string;
  readonly references?: readonly { readonly to: string; readonly note?: string }[];
}

export const set: Handler<FocusSetArgs, FocusSetResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  let files: readonly string[];
  let intent: string | undefined = args.intent;
  if (args.viewId !== undefined) {
    const view = await ctx.run<{ id: string }, ViewGetMinimal | null>('view.get', {
      id: args.viewId,
    });
    if (!view) {
      throw new Error(`View not found: ${args.viewId}`);
    }
    files = view.members.map((m) => m.file);
    // Carry the view's prompt as the turn's intent. It's the human's
    // strongest "here's what I'm thinking" artifact and was previously
    // dropped on the floor here (only m.file survived).
    if (intent === undefined && view.prompt !== undefined && view.prompt.trim() !== '') {
      intent = view.prompt;
    }
  } else {
    files = args.files ?? [];
  }

  const items = await assembleItems(ctx, files);
  await withFocusLock(root, () => writeFocus(ctx.fs, root, items, intent));
  return { active: files };
};

/**
 * Re-render focus.md from its CURRENT active list with FRESH badge data,
 * preserving the `intent:` line. This is the core reconcile the renderer used
 * to fake in `resyncFocusForFile`: an in-app / CLI / agent edit to a badge's
 * prompt or refs (`badge.set/addRef/removeRef`) doesn't touch focus.md, so the
 * agent would keep reading the OLD inlined brief until the user re-set focus.
 * Wiring badge edits to focus.resync keeps the brief fresh everywhere, not
 * just in the desktop. No-op (no write) unless `args.file` is in the active
 * list, so eager-materialize badge writes don't churn focus.md.
 */
export const resync: Handler<FocusResyncArgs, FocusResyncResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  return withFocusLock(root, async () => {
    const { active, intent } = await readFocusBrief(ctx.fs, root);
    if (active.length === 0) return { resynced: false };
    if (args.file !== undefined && !active.includes(args.file)) return { resynced: false };
    const items = await assembleItems(ctx, active);
    await writeFocus(ctx.fs, root, items, intent);
    return { resynced: true };
  });
};

export const get: Handler<FocusGetArgs, FocusGetResult> = async (_args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  return readFocusBrief(ctx.fs, root);
};

export const clear: Handler<FocusClearArgs, FocusClearResult> = async (_args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  await withFocusLock(root, () => writeFocus(ctx.fs, root, []));
  return { cleared: true };
};

/**
 * Seed `.bh/focus.md` with the empty template if it doesn't exist yet.
 * Idempotent — re-running on a workspace with a populated focus.md is a
 * no-op so user state is never clobbered. Called by workspace.add/use so
 * the agent contract surface always exists; without it an agent following
 * the CLAUDE.md hint and reading focus.md on a brand-new workspace gets
 * ENOENT before any UI click ever happens.
 */
export const init: Handler<FocusInitArgs, FocusInitResult> = async (_args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  const existing = await readMaybeNoFollow(
    ctx.fs,
    await assertReadContained(ctx.fs, root, focusPath(root)),
  );
  if (existing !== null) return { created: false };
  await writeFocus(ctx.fs, root, []);
  return { created: true };
};

export function commands(): ReadonlyArray<
  readonly [name: string, handler: Handler<never, unknown>]
> {
  return [
    ['focus.set', set as unknown as Handler<never, unknown>],
    ['focus.get', get as unknown as Handler<never, unknown>],
    ['focus.clear', clear as unknown as Handler<never, unknown>],
    ['focus.resync', resync as unknown as Handler<never, unknown>],
    ['focus.init', init as unknown as Handler<never, unknown>],
  ];
}
