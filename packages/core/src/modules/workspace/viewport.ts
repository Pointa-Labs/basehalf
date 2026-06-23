import type { Handler } from '../../kernel/index.js';
import { withConfigLock } from './lock.js';
import { readWorkspaces, writeWorkspaces } from './store.js';
import type {
  WorkspaceGetViewportArgs,
  WorkspaceGetViewportResult,
  WorkspaceSetViewportArgs,
  WorkspaceSetViewportResult,
} from './types.js';

/**
 * Per-workspace canvas viewport (pan + zoom) persistence. setViewport is a
 * workspaces.json mutator, so it MUST take the SAME `withConfigLock` instance
 * the registry CRUD handlers use (imported from lock.ts) — the desktop fires
 * it debounced + un-awaited, racing a workspace switch. A second mutex here
 * would reopen the documented lost-update race
 * (test/workspace-config-concurrency.test.ts).
 */

/** The registry `[name, entry]` for the workspace THIS call is bound to (by
 *  path), or null. Viewport is stored keyed by NAME, so we resolve the bound
 *  root back to its name here. Path compare is case-insensitive (mirrors the
 *  registry's folder-identity rule). */
function boundNamed<T extends { path: string }>(
  ctx: Parameters<Handler>[1],
  workspaces: Record<string, T>,
): [string, T] | null {
  const root = ctx.workspaceRoot;
  if (root === null) return null;
  const lower = root.toLowerCase();
  return Object.entries(workspaces).find(([, e]) => e.path.toLowerCase() === lower) ?? null;
}

/** `workspace.getViewport()` — last persisted canvas viewport for the bound
 * workspace; null if never set / none bound. */
export const getViewport: Handler<WorkspaceGetViewportArgs, WorkspaceGetViewportResult> = async (
  _args,
  ctx,
) => {
  const data = await readWorkspaces(ctx.fs, ctx.configDir);
  const found = boundNamed(ctx, data.workspaces);
  return found?.[1].viewport ?? null;
};

/** `workspace.setViewport({ viewport })` — persist canvas viewport for the
 * bound workspace. No-op if none bound. */
export const setViewport: Handler<WorkspaceSetViewportArgs, WorkspaceSetViewportResult> = async (
  args,
  ctx,
) => {
  return withConfigLock(ctx.configDir, async () => {
    const data = await readWorkspaces(ctx.fs, ctx.configDir);
    const found = boundNamed(ctx, data.workspaces);
    if (!found) return {};
    const [name, entry] = found;
    await writeWorkspaces(ctx.fs, ctx.configDir, {
      version: 1,
      workspaces: {
        ...data.workspaces,
        [name]: { ...entry, viewport: args.viewport },
      },
    });
    return {};
  });
};
