import type { Handler } from '../../kernel/index.js';
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

  // Inline each active file's curated meaning (prompt + outbound ref notes)
  // so the agent reads the whole brief in one pass instead of re-reading N
  // badge JSONs every turn. Composed via ctx.run only (module isolation); a
  // file with no badge (or a folder) just contributes its bare path.
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

  await writeFocus(ctx.fs, root, items, intent);
  return { active: files };
};

export const get: Handler<FocusGetArgs, FocusGetResult> = async (_args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  return readFocusBrief(ctx.fs, root);
};

export const clear: Handler<FocusClearArgs, FocusClearResult> = async (_args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  await writeFocus(ctx.fs, root, []);
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
  const existing = await ctx.fs.readFile(focusPath(root));
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
    ['focus.init', init as unknown as Handler<never, unknown>],
  ];
}
