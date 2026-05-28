import type { Handler } from '../../kernel/index.js';
import type { WorkspaceCurrentResult } from '../workspace/types.js';
import { readFocus, writeFocus } from './store.js';
import type {
  FocusClearArgs,
  FocusClearResult,
  FocusGetArgs,
  FocusGetResult,
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

// Minimal shape of view.get for focus.set({ viewId }) expansion. Avoids
// importing the views module's full types (which lands in PR 11-4 and
// keeps the dep arrow one-way).
interface ViewGetMinimal {
  readonly members: readonly { readonly file: string }[];
}

export const set: Handler<FocusSetArgs, FocusSetResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  let active: readonly string[];
  if (args.viewId !== undefined) {
    const view = await ctx.run<{ id: string }, ViewGetMinimal | null>('view.get', {
      id: args.viewId,
    });
    if (!view) {
      throw new Error(`View not found: ${args.viewId}`);
    }
    active = view.members.map((m) => m.file);
  } else {
    active = args.files ?? [];
  }
  await writeFocus(ctx.fs, root, active);
  return { active };
};

export const get: Handler<FocusGetArgs, FocusGetResult> = async (_args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  const active = await readFocus(ctx.fs, root);
  return { active };
};

export const clear: Handler<FocusClearArgs, FocusClearResult> = async (_args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  await writeFocus(ctx.fs, root, []);
  return { cleared: true };
};

export function commands(): ReadonlyArray<
  readonly [name: string, handler: Handler<never, unknown>]
> {
  return [
    ['focus.set', set as unknown as Handler<never, unknown>],
    ['focus.get', get as unknown as Handler<never, unknown>],
    ['focus.clear', clear as unknown as Handler<never, unknown>],
  ];
}
