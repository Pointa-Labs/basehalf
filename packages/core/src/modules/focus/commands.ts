import { join } from 'node:path';
import { type Handler, assertReadContained, createKeyedMutex } from '../../kernel/index.js';
import type { WorkspaceCurrentResult } from '../workspace/types.js';
import {
  clearCurrentFocus,
  readCurrentFocus,
  repointCurrentFocus,
  writeFocusNode,
} from './store.js';
import type {
  FocusClearArgs,
  FocusClearResult,
  FocusGetArgs,
  FocusGetResult,
  FocusNode,
  FocusPruneDanglingArgs,
  FocusPruneDanglingResult,
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

// Serialize focus writes per workspace ROOT. focus.set writes the node's
// focus.yaml AND repoints the current_focus symlink (a two-step unlink+symlink);
// clear/prune touch the symlink. One lock keeps a set from racing a clear so the
// symlink is never observed torn between its unlink and re-creation.
const withFocusLock = createKeyedMutex();

/** Build the per-node focus.yaml object, keeping only the fields that apply to
 *  the node's kind and were actually provided (state is OPTIONAL this round). */
function buildNode(args: FocusSetArgs): FocusNode {
  if (args.kind === 'folder') {
    return {
      path: args.path,
      kind: 'folder',
      ...(args.viewport_center !== undefined && { viewport_center: args.viewport_center }),
      ...(args.zoom !== undefined && { zoom: args.zoom }),
    };
  }
  return {
    path: args.path,
    kind: 'file',
    ...(args.visible_lines !== undefined && { visible_lines: args.visible_lines }),
    ...(args.cursor !== undefined && { cursor: args.cursor }),
  };
}

/** Does the focused node still exist on disk (containment-guarded)? */
async function nodeExists(
  ctx: Parameters<Handler>[1],
  root: string,
  node: FocusNode,
): Promise<boolean> {
  try {
    const abs = await assertReadContained(ctx.fs, root, join(root, node.path));
    const st = await ctx.fs.stat(abs);
    if (st === null) return false;
    return node.kind === 'folder' ? st.isDirectory === true : st.isFile === true;
  } catch {
    return false;
  }
}

/**
 * Mirror the user's current viewport: write the node's focus.yaml and repoint
 * `.bh/current_focus.yaml` at it. The single signal the agent reads to know what
 * the user is looking at.
 */
export const set: Handler<FocusSetArgs, FocusSetResult> = async (args, ctx) => {
  const current = await ctx.run<Record<string, never>, WorkspaceCurrentResult>(
    'workspace.current',
    {},
  );
  if (current.current === null) {
    throw new Error('No current workspace; call workspace.use first');
  }
  const node = buildNode(args);
  // The desktop fires focus.set un-awaited; if the user switched workspaces while
  // it was in flight (the root resolves late, here), SKIP rather than plant this
  // workspace's relative path under the now-current one. Mirrors the watcher's
  // eventRoot/stillCurrent guard. [[pr113-followup]] Report the node either way.
  if (args.workspace !== undefined && current.current.name !== args.workspace) {
    return node;
  }
  const root = current.current.path;
  return withFocusLock(root, async () => {
    await writeFocusNode(ctx.fs, root, node);
    await repointCurrentFocus(ctx.fs, root, args.path);
    return node;
  });
};

/** Read the node `.bh/current_focus.yaml` points at (null when nothing focused). */
export const get: Handler<FocusGetArgs, FocusGetResult> = async (_args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  // Read UNDER the focus lock so a concurrent focus.set's non-atomic symlink
  // retarget (unlink → symlink) is never observed mid-gap as a spurious "no focus".
  return withFocusLock(root, () => readCurrentFocus(ctx.fs, root));
};

/** Drop the current focus (remove the symlink). The per-node focus.yaml files are
 *  left as each node's last-known viewport. */
export const clear: Handler<FocusClearArgs, FocusClearResult> = async (_args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  const cleared = await withFocusLock(root, () => clearCurrentFocus(ctx.fs, root));
  return { cleared };
};

/**
 * Clear the current focus if it points at a node whose file/folder is gone on
 * disk (a delete / external rm / git checkout). The viewport-mirror analog of the
 * old brief's dangling-prune; called on workspace open + after deleteEntry.
 */
export const pruneDangling: Handler<FocusPruneDanglingArgs, FocusPruneDanglingResult> = async (
  _args,
  ctx,
) => {
  const root = await currentWorkspaceRoot(ctx);
  return withFocusLock(root, async () => {
    const node = await readCurrentFocus(ctx.fs, root);
    if (node === null) return { cleared: false };
    if (await nodeExists(ctx, root, node)) return { cleared: false };
    const cleared = await clearCurrentFocus(ctx.fs, root);
    return { cleared };
  });
};

export function commands(): ReadonlyArray<
  readonly [name: string, handler: Handler<never, unknown>]
> {
  return [
    ['focus.set', set as unknown as Handler<never, unknown>],
    ['focus.get', get as unknown as Handler<never, unknown>],
    ['focus.clear', clear as unknown as Handler<never, unknown>],
    ['focus.pruneDangling', pruneDangling as unknown as Handler<never, unknown>],
  ];
}
