import type { Handler } from '../../kernel/index.js';
import type { InboundGetResult } from '../inbound/types.js';
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
  BadgeMarkOrphanArgs,
  BadgeMarkOrphanResult,
  BadgeRemoveRefArgs,
  BadgeRenameArgs,
  BadgeRenameResult,
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

/**
 * Reconcile focus.md after a badge edit, exactly like badge.addRef/removeRef
 * already reconcile the inbound index: if `file` is in the active list,
 * focus.resync re-inlines the fresh prompt/refs so the agent's turn brief
 * doesn't go stale. Best-effort + tolerant — the badge write already
 * succeeded, so a focus refresh failure (module not registered, a hostile
 * symlinked focus.md → PathEscape, etc.) must never fail the badge op.
 * focus.resync itself no-ops when `file` isn't active, so this is cheap on the
 * common (eager-materialize) path.
 */
async function reconcileFocus(ctx: Parameters<Handler>[1], file: string): Promise<void> {
  try {
    await ctx.run('focus.resync', { file });
  } catch (err) {
    if (err instanceof Error && (err.name === 'UnknownCommand' || err.name === 'PathEscape')) {
      return;
    }
    console.warn('[bh:badges] focus.resync after badge edit failed (non-fatal):', err);
  }
}

/**
 * The FOLDER analog: a folder badge's prompt IS its agent-facing intent, so a
 * folder-sourced focus's brief must refresh when that prompt changes. focus.md's
 * active list is per-FILE, so focus.resync (keyed on the folder path) would
 * no-op — refreshFolderIntent re-reads the folder prompt by `# source-folder:`
 * identity instead. Same best-effort tolerance as reconcileFocus: a derived-.bh/
 * failure must never fail the badge write.
 */
async function reconcileFolderIntent(ctx: Parameters<Handler>[1], folder: string): Promise<void> {
  try {
    await ctx.run('focus.refreshFolderIntent', { folder });
  } catch (err) {
    if (err instanceof Error && (err.name === 'UnknownCommand' || err.name === 'PathEscape')) {
      return;
    }
    console.warn(
      '[bh:badges] focus.refreshFolderIntent after folder-badge edit failed (non-fatal):',
      err,
    );
  }
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
  // Only reconcile focus.md when the edit actually changes the INLINED BRIEF
  // (prompt or refs). A kind-only / canvas-only patch — e.g. every eager
  // materialize badge.set on workspace open, or a canvas drag of a focused
  // badge — leaves the brief identical, so skip the focus.md read+rewrite
  // entirely (no churn, no added latency on the hot open path).
  if (kind === 'folder') {
    // A folder badge's prompt is the intent of a folder-sourced focus; its
    // refs/canvas don't feed the brief. Refresh only on a prompt change.
    if (patch.prompt !== undefined) await reconcileFolderIntent(ctx, args.file);
  } else if (patch.prompt !== undefined || patch.references !== undefined) {
    await reconcileFocus(ctx, args.file);
  }
  return next;
};

export const list: Handler<BadgeListArgs, BadgeListResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  let badges = await listBadges(ctx.fs, root);
  // BadgeListArgs is fully optional — be defensive in case a caller
  // (CLI / MCP / a renderer that forgot the args object) hands us
  // undefined instead of {}. core.run normalizes, but a stray call
  // straight through ctx.run can still arrive bare.
  const kind = args?.kind;
  if (kind) {
    badges = badges.filter((b) => b.kind === kind);
  }
  const query = args?.query;
  if (query) {
    const q = query.toLowerCase();
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
  // A badge referencing itself is meaningless for the agent neighbourhood
  // walk (you're already at that file) and breaks badge.rename — the
  // self-ref's `to` doesn't get remapped, so the renamed badge keeps a dead
  // reference to its old name. This guard lived only in the desktop "+ Add"
  // dialog (a thin shell); per the one-door rule it belongs in core so the
  // canvas self-drag, the CLI, and any agent all enforce it.
  if (args.to === args.file) {
    throw new Error(`Badge cannot reference itself: ${args.file}`);
  }
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
  await reconcileFocus(ctx, args.file);
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
  await reconcileFocus(ctx, args.file);
  return next;
};

/**
 * Mark an existing badge as orphan (its underlying file was deleted on disk).
 * Preserves prompt / references / inbound so nothing is lost — the user can
 * either re-create the file or explicitly badge.delete to scrub. Called by
 * the watcher module on `unlink` events; no-op if the badge doesn't exist.
 */
export const markOrphan: Handler<BadgeMarkOrphanArgs, BadgeMarkOrphanResult> = async (
  args,
  ctx,
) => {
  const root = await currentWorkspaceRoot(ctx);
  const kind = args.kind ?? 'file';
  const existing = await readBadge(ctx.fs, root, args.file, kind);
  if (!existing) return null;
  const next: BadgeFile = {
    ...existing,
    orphan: true,
    modifiedAt: new Date().toISOString(),
  };
  await writeBadge(ctx.fs, root, next);
  return next;
};

/**
 * Atomic rename: move the badge from `from` to `to`, rewrite every
 * inbound reference (other badges pointing at `from` get rewritten to
 * point at `to`), and update focus.md if `from` was in the active list.
 *
 * Why all three updates in one command:
 *  - Leaving inbound refs stale would silently break the agent's
 *    neighbourhood walk: links to a missing badge are dead-ends.
 *  - Leaving focus.md stale points the agent at a badge that no longer
 *    exists.
 * Anything less would make rename an attractive nuisance.
 *
 * Used by the watcher's rename heuristic (Stage 2) but also exposable as
 * a deliberate user action ("rename this file via bh") if we ever want
 * a CLI/UI affordance.
 *
 * Errors:
 *  - Throws if the source badge doesn't exist.
 *  - Throws if a badge already exists at `to` (collision; caller must
 *    resolve before calling).
 */
export const rename: Handler<BadgeRenameArgs, BadgeRenameResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  const kind: BadgeKind = args.kind ?? 'file';
  if (args.from === args.to) {
    throw new Error(`badge.rename: from and to are the same (${args.from})`);
  }

  const source = await readBadge(ctx.fs, root, args.from, kind);
  if (!source) {
    throw new Error(`badge.rename: no badge at ${args.from}`);
  }
  const collision = await readBadge(ctx.fs, root, args.to, kind);
  if (collision) {
    throw new Error(`badge.rename: badge already exists at ${args.to}`);
  }

  // 1. Write a copy at the new path, preserving the user's prompt /
  // references / canvas position / createdAt. Clear orphan since the
  // underlying file just (re)appeared under a new name.
  const now = new Date().toISOString();
  const moved: BadgeFile = {
    bhVersion: 1,
    file: args.to,
    kind,
    ...(source.prompt !== undefined && { prompt: source.prompt }),
    references: source.references,
    ...(source.canvas !== undefined && { canvas: source.canvas }),
    createdAt: source.createdAt,
    modifiedAt: now,
  };
  await writeBadge(ctx.fs, root, moved);

  // 2. Delete the source badge file. (We intentionally write the new one
  // BEFORE deleting the source so a crash between steps leaves both —
  // bad — over a crash with neither, which loses the user's prompt and
  // references entirely.)
  await removeBadge(ctx.fs, root, args.from, kind);

  // 2b. Migrate the inbound index for the moved badge's OWN outbound refs.
  // The moved badge keeps its references (copied in step 1), but they were
  // written via writeBadge, which does NOT cascade to the inbound index — so
  // each target's inbound entry still records the OLD name (`from`), a
  // phantom backlink to a badge that no longer exists. Re-point each entry
  // from `from` to `to` directly on the index (the badge files are already
  // correct). Self-refs can't occur here — badge.addRef rejects them.
  for (const ref of moved.references) {
    try {
      await ctx.run('inbound.removeRef', { from: args.from, to: ref.to });
      await ctx.run('inbound.addRef', {
        from: args.to,
        to: ref.to,
        ...(ref.note !== undefined && { note: ref.note }),
      });
    } catch (err) {
      if (!(err instanceof Error && err.name === 'UnknownCommand')) throw err;
    }
  }

  // 3. Rewrite every inbound reference: for each badge that pointed at
  // `from`, removeRef(from) + addRef(to, note). Each pair cascades the
  // inbound index update via badge.addRef's existing inbound.addRef
  // sync. Inbound module may not be registered (tests wiring just
  // badges); swallow UnknownCommand the same way the rest of the module
  // does.
  const updatedRefs: string[] = [];
  let inbound: InboundGetResult = { entries: [] };
  try {
    inbound = await ctx.run<{ file: string }, InboundGetResult>('inbound.get', {
      file: args.from,
    });
  } catch (err) {
    if (!(err instanceof Error && err.name === 'UnknownCommand')) throw err;
  }
  for (const entry of inbound.entries) {
    try {
      await ctx.run('badge.removeRef', { file: entry.from, to: args.from });
      await ctx.run('badge.addRef', {
        file: entry.from,
        to: args.to,
        ...(entry.note !== undefined && { note: entry.note }),
      });
      updatedRefs.push(entry.from);
    } catch (err) {
      // A neighbour badge might have been deleted concurrently; don't
      // abort the whole rename — leave the orphan ref for the user to
      // notice in the canvas (we mark them visually).
      if (!(err instanceof Error)) throw err;
      console.warn(`[bh:badges] rename: failed to rewrite ref on ${entry.from}:`, err.message);
    }
  }

  // 4. Update focus.md if `from` is in the active list. focus.renameActiveFile
  // remaps the path in place UNDER the focus lock, preserving BOTH the turn
  // intent and the `# source-folder:` provenance — a bare focus.set({files})
  // would drop the intent block AND strip provenance (so editing the source
  // folder's prompt would stop refreshing the brief after a rename).
  let focusUpdated = false;
  try {
    const res = await ctx.run<{ from: string; to: string }, { renamed: boolean }>(
      'focus.renameActiveFile',
      { from: args.from, to: args.to },
    );
    focusUpdated = res.renamed;
  } catch (err) {
    // Best-effort, exactly like reconcileFocus for badge.set/addRef/removeRef:
    // tolerate a missing module AND a hostile/symlinked focus.md (PathEscape).
    // Otherwise a workspace-escaping focus.md symlink would abort badge.rename
    // AFTER steps 1-3 committed, leaving badge + inbound pointing at `to` while
    // focus.md still points at `from`.
    if (!(err instanceof Error && (err.name === 'UnknownCommand' || err.name === 'PathEscape'))) {
      throw err;
    }
  }

  return { badge: moved, updatedRefs, focusUpdated };
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
    ['badge.markOrphan', markOrphan as unknown as Handler<never, unknown>],
    ['badge.rename', rename as unknown as Handler<never, unknown>],
  ];
}
