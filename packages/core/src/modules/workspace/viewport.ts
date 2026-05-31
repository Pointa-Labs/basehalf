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

/** `workspace.getViewport()` — last persisted canvas viewport for the current
 * workspace; null if never set. */
export const getViewport: Handler<WorkspaceGetViewportArgs, WorkspaceGetViewportResult> = async (
  _args,
  ctx,
) => {
  const data = await readWorkspaces(ctx.fs, ctx.configDir);
  if (data.current === null) return null;
  const entry = data.workspaces[data.current];
  return entry?.viewport ?? null;
};

/** `workspace.setViewport({ viewport })` — persist canvas viewport for the
 * current workspace. No-op if no current workspace. */
export const setViewport: Handler<WorkspaceSetViewportArgs, WorkspaceSetViewportResult> = async (
  args,
  ctx,
) => {
  return withConfigLock(ctx.configDir, async () => {
    const data = await readWorkspaces(ctx.fs, ctx.configDir);
    if (data.current === null) return {};
    const entry = data.workspaces[data.current];
    if (!entry) return {};
    await writeWorkspaces(ctx.fs, ctx.configDir, {
      ...data,
      workspaces: {
        ...data.workspaces,
        [data.current]: { ...entry, viewport: args.viewport },
      },
    });
    return {};
  });
};
