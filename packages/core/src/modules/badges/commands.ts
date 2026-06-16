import { join } from 'node:path';
import { type Handler, assertReadContained, createKeyedMutex } from '../../kernel/index.js';
import type { InboundGetResult } from '../inbound/types.js';
import type { WorkspaceCurrentResult } from '../workspace/types.js';
import { badgesRevision, listBadges, readBadge, removeBadge, writeBadge } from './store.js';
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
  BadgePruneDanglingArgs,
  BadgePruneDanglingResult,
  BadgeReconnectRefArgs,
  BadgeReconnectRefResult,
  BadgeRemoveRefArgs,
  BadgeRenameArgs,
  BadgeRenameResult,
  BadgeRevisionArgs,
  BadgeRevisionResult,
  BadgeSetArgs,
  BadgeSetResult,
} from './types.js';

const BADGE_SIDES = new Set(['top', 'right', 'bottom', 'left']);

function validateSide(side: unknown, field: string): void {
  if (side === undefined) return;
  if (typeof side !== 'string' || !BADGE_SIDES.has(side)) {
    throw new Error(`${field} must be one of top, right, bottom, left`);
  }
}

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

// Serialize the read-modify-write of each workspace's badge JSONs. Badge files
// were the one .bh/ store without this guard, so concurrent writers — a canvas
// drag's `badge.set {canvas}` racing a prompt blur's `badge.set {prompt}`, or
// the watcher's add-finalize `badge.set {orphan:false}` — each read the same
// pre-write badge and the second write resurrected the first's stale fields,
// silently dropping the user's just-typed note (or new position). Same kernel
// mutex inbound/focus/workspaces.json use. [[bh-json-rmw-race]]
//
// CRITICAL — the lock wraps ONLY the badge JSON RMW, never the cascade. The
// cascade (ctx.run('focus.resync' / 'inbound.addRef' / 'badge.addRef' …)) takes
// OTHER locks (focus, inbound) or re-enters badge.* — holding the badge lock
// across it would nest locks and can deadlock. Acquire → RMW → release → then
// cascade. Keyed by root: rename touches multiple badge files at once, so
// root-level (not per-file) is the safe granularity.
const withBadgeLock = createKeyedMutex();

/**
 * Reconcile focus.md after a badge edit, exactly like badge.addRef/removeRef
 * already reconcile the inbound index: if `file` is in the active list,
 * focus.resync re-inlines the fresh prompt/refs so the agent's turn brief
 * doesn't go stale. Best-effort + tolerant — the badge write already
 * succeeded, so a focus refresh failure (module not registered, a hostile
 * symlinked focus.md → PathEscape, etc.) must never fail the badge op.
 * focus.resync itself no-ops when `file` isn't active, so edits to unfocused
 * badges stay cheap.
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

/**
 * After a brand-NEW file badge is materialized, pull it into a folder-sourced
 * brief when it landed under the focused folder — so "Focus this folder" keeps
 * meaning "read all its files" as files appear mid-session. focus.reconcileNewFile
 * no-ops unless a containing folder is the active focus source, so this is cheap.
 * Same best-effort tolerance as reconcileFocus.
 */
async function reconcileNewFile(ctx: Parameters<Handler>[1], file: string): Promise<void> {
  try {
    await ctx.run('focus.reconcileNewFile', { file });
  } catch (err) {
    if (err instanceof Error && (err.name === 'UnknownCommand' || err.name === 'PathEscape')) {
      return;
    }
    console.warn('[bh:badges] focus.reconcileNewFile after new-file materialize failed:', err);
  }
}

/**
 * A focused file's badge just went orphan (its file was deleted on disk). Re-render
 * the brief so the agent never reads a vanished file: focus.resync re-assembles
 * through the liveness choke point, which now EXCLUDES the just-orphaned file (and
 * leaves a heal note). Best-effort — a derived-.bh/ hiccup must never fail the badge
 * op. focus.resync no-ops when the file isn't focused.
 */
async function resyncFocusAfterOrphan(ctx: Parameters<Handler>[1], file: string): Promise<void> {
  try {
    await ctx.run('focus.resync', { file });
  } catch (err) {
    console.warn('[bh:badges] focus.resync after markOrphan failed (non-fatal):', err);
  }
}

export const get: Handler<BadgeGetArgs, BadgeGetResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  return readBadge(ctx.fs, root, args.file, args.kind ?? 'file');
};

export const set: Handler<BadgeSetArgs, BadgeSetResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  const kind: BadgeKind = args.patch?.kind ?? 'file';
  const patch = args.patch ?? {};

  // Lock the read→merge→write so a concurrent set on the same badge can't
  // interleave a stale read with a fresh write and drop a field. `existing` is
  // captured here too — derive `!existing` from the result for the cascade.
  const { next, existed } = await withBadgeLock(root, async () => {
    const existing = await readBadge(ctx.fs, root, args.file, kind);
    const now = new Date().toISOString();

    // The prompt's OWN timestamp moves only when the prompt text actually
    // changes — never on canvas drags / kind patches / re-saves of the same
    // text. It anchors the brief's freshness comparison (focus assembleItems),
    // which `modifiedAt` cannot (every write bumps it).
    const promptChanged = patch.prompt !== undefined && patch.prompt !== existing?.prompt;
    const promptAt = promptChanged ? now : existing?.promptModifiedAt;

    const merged: BadgeFile = existing
      ? {
          bhVersion: 1,
          file: existing.file,
          kind: existing.kind,
          ...(patch.prompt !== undefined
            ? { prompt: patch.prompt }
            : existing.prompt !== undefined && { prompt: existing.prompt }),
          ...(promptAt !== undefined && { promptModifiedAt: promptAt }),
          references: patch.references ?? existing.references,
          ...(patch.canvas !== undefined
            ? { canvas: patch.canvas }
            : existing.canvas !== undefined && { canvas: existing.canvas }),
          // PRESERVE orphan across ordinary edits — a prompt/ref/canvas edit on a
          // deleted file must not silently un-orphan it (that would let a vanished
          // path back into the agent's brief). Cleared only by an explicit
          // `orphan:false` (the watcher's add when the file re-appears); set only by
          // badge.markOrphan.
          ...((patch.orphan ?? existing.orphan) === true && { orphan: true }),
          createdAt: existing.createdAt,
          modifiedAt: now,
        }
      : {
          bhVersion: 1,
          file: args.file,
          kind,
          ...(patch.prompt !== undefined && { prompt: patch.prompt }),
          ...(patch.prompt !== undefined && { promptModifiedAt: now }),
          references: patch.references ?? [],
          ...(patch.canvas !== undefined && { canvas: patch.canvas }),
          ...(patch.orphan === true && { orphan: true }),
          createdAt: now,
          modifiedAt: now,
        };

    await writeBadge(ctx.fs, root, merged);
    return { next: merged, existed: existing !== null };
  });

  // Only reconcile focus.md when the edit actually changes the INLINED BRIEF
  // (prompt or refs). A kind-only / canvas-only patch — e.g. every eager
  // materialize badge.set on workspace open, or a canvas drag of a focused
  // badge — leaves the brief identical, so skip the focus.md read+rewrite
  // entirely (no churn, no added latency on the hot open path).
  if (kind === 'folder') {
    // A folder badge's prompt is the intent of a folder-sourced focus; its
    // refs/canvas don't feed the brief. Refresh only on a prompt change.
    if (patch.prompt !== undefined) await reconcileFolderIntent(ctx, args.file);
  } else {
    if (patch.prompt !== undefined || patch.references !== undefined) {
      await reconcileFocus(ctx, args.file);
    }
    // A brand-NEW file may have appeared under a focused folder — pull it into
    // the brief. Gated on creation so the idempotent re-materialize on re-open
    // (badges already exist) stays off the focus.md path.
    if (!existed) await reconcileNewFile(ctx, args.file);
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
  const kind = args.kind ?? 'file';
  // Capture the badge's outbound refs (under the lock) BEFORE deleting, so we can
  // clean them out of the inbound index afterward. Without this, deleting a badge
  // left phantom backlinks in inbound.json pointing FROM a badge that no longer
  // exists — the delete path was systematically weaker than rename's cascade.
  const { deleted, refs } = await withBadgeLock(root, async () => {
    const existing = await readBadge(ctx.fs, root, args.file, kind);
    const removed = await removeBadge(ctx.fs, root, args.file, kind);
    return { deleted: removed, refs: existing?.references ?? [] };
  });
  if (deleted) {
    // Cascade OUTSIDE the lock (inbound/focus take their own locks): drop this
    // badge's outbound entries from the index, and refresh the brief if the
    // deleted file was focused — matching the discipline badge.rename already has.
    for (const ref of refs) {
      try {
        await ctx.run('inbound.removeRef', { from: args.file, to: ref.to });
      } catch (err) {
        if (!(err instanceof Error && err.name === 'UnknownCommand')) throw err;
      }
    }
    if (kind === 'file') await reconcileFocus(ctx, args.file);
  }
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
  validateSide(args.fromSide, 'fromSide');
  validateSide(args.toSide, 'toSide');
  const root = await currentWorkspaceRoot(ctx);
  const kind = args.kind ?? 'file';
  const next = await withBadgeLock(root, async () => {
    const existing = await readBadge(ctx.fs, root, args.file, kind);
    const base: BadgeFile = existing ?? {
      bhVersion: 1,
      file: args.file,
      kind,
      references: [],
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    };
    const newRef = {
      to: args.to,
      ...(args.note !== undefined && { note: args.note }),
      ...(args.fromSide !== undefined && { fromSide: args.fromSide }),
      ...(args.toSide !== undefined && { toSide: args.toSide }),
    };
    const without = base.references.filter((r) => r.to !== args.to);
    const merged: BadgeFile = {
      ...base,
      references: [...without, newRef],
      modifiedAt: new Date().toISOString(),
    };
    await writeBadge(ctx.fs, root, merged);
    return merged;
  });
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
  const next = await withBadgeLock(root, async () => {
    const existing = await readBadge(ctx.fs, root, args.file, kind);
    if (!existing) {
      throw new Error(`Badge not found: ${args.file}`);
    }
    const merged: BadgeFile = {
      ...existing,
      references: existing.references.filter((r) => r.to !== args.to),
      modifiedAt: new Date().toISOString(),
    };
    await writeBadge(ctx.fs, root, merged);
    return merged;
  });
  try {
    await ctx.run('inbound.removeRef', { from: args.file, to: args.to });
  } catch (err) {
    if (!(err instanceof Error && err.name === 'UnknownCommand')) throw err;
  }
  await reconcileFocus(ctx, args.file);
  return next;
};

export const reconnectRef: Handler<BadgeReconnectRefArgs, BadgeReconnectRefResult> = async (
  args,
  ctx,
) => {
  if (args.next.file === args.next.to) {
    throw new Error(`Badge cannot reference itself: ${args.next.file}`);
  }
  validateSide(args.next.fromSide, 'fromSide');
  validateSide(args.next.toSide, 'toSide');

  await ctx.run('badge.addRef', {
    file: args.next.file,
    to: args.next.to,
    ...(args.next.kind !== undefined && { kind: args.next.kind }),
    ...(args.next.note !== undefined && { note: args.next.note }),
    ...(args.next.fromSide !== undefined && { fromSide: args.next.fromSide }),
    ...(args.next.toSide !== undefined && { toSide: args.next.toSide }),
  });

  if (args.previous.file !== args.next.file || args.previous.to !== args.next.to) {
    await ctx.run('badge.removeRef', {
      file: args.previous.file,
      to: args.previous.to,
      ...(args.previous.kind !== undefined && { kind: args.previous.kind }),
    });
  }

  return ctx.run<Record<string, never>, BadgeReconnectRefResult>('badge.list', {});
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
  const next = await withBadgeLock(root, async () => {
    const existing = await readBadge(ctx.fs, root, args.file, kind);
    if (!existing) return null;
    const merged: BadgeFile = {
      ...existing,
      orphan: true,
      modifiedAt: new Date().toISOString(),
    };
    await writeBadge(ctx.fs, root, merged);
    return merged;
  });
  if (next === null) return null;
  // Cascade to focus.md: a focused file that just vanished must leave the brief,
  // exactly like badge.rename cascades via renameActiveFile. File badges only —
  // a folder badge is never an active focus item.
  if (kind === 'file') await resyncFocusAfterOrphan(ctx, args.file);
  return next;
};

/** Stat the disk target behind a badge: a file badge → its file, a folder
 *  badge → its directory. Containment-guarded; any error reads as "gone". */
async function badgeTargetExists(
  ctx: Parameters<Handler>[1],
  root: string,
  file: string,
  kind: BadgeKind,
): Promise<boolean> {
  try {
    const abs = await assertReadContained(ctx.fs, root, join(root, file));
    const st = await ctx.fs.stat(abs);
    if (st === null) return false;
    return kind === 'folder' ? st.isDirectory === true : st.isFile === true;
  } catch {
    return false;
  }
}

/**
 * Stat-based liveness sweep for the WHOLE badge graph — the badges analog of
 * focus.pruneDangling. The brief layer self-heals on workspace open, but badges
 * and the inbound index had NO such discipline: a file deleted while the watcher
 * wasn't running (app closed, git checkout) left its badge + inbound entries
 * behind with no orphan flag, so an agent following the CLAUDE.md hint into
 * `.bh/badges/` + `inbound.json` got pointed at files that don't exist — worse
 * than grep. Run on workspace open: mark every badge whose disk target is gone
 * as orphan (markOrphan preserves the human note and excludes it from briefs +
 * lets the canvas show MISSING), so the deep graph stays as live as the brief.
 * Already-orphan badges are skipped (no churn). Best-effort per badge.
 */
/** Cheap badge-store signature (count + newest mtime) for an external-edit poll. */
export const revision: Handler<BadgeRevisionArgs, BadgeRevisionResult> = async (_args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  return badgesRevision(ctx.fs, root);
};

export const pruneDangling: Handler<BadgePruneDanglingArgs, BadgePruneDanglingResult> = async (
  _args,
  ctx,
) => {
  const root = await currentWorkspaceRoot(ctx);
  const badges = await listBadges(ctx.fs, root);
  const orphaned: string[] = [];
  for (const badge of badges) {
    if (badge.orphan === true) continue;
    if (await badgeTargetExists(ctx, root, badge.file, badge.kind)) continue;
    try {
      const res = await ctx.run('badge.markOrphan', { file: badge.file, kind: badge.kind });
      if (res !== null) orphaned.push(badge.file);
    } catch {
      /* best-effort: a cascade hiccup must not fail the whole sweep */
    }
  }
  return { orphaned };
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
/**
 * Read a badge whose KIND we don't know from the inbound index (entries carry
 * no kind). Try file first (the common case), then folder — so a folder badge
 * that references a file (canvas folder→file edge) is found when its target is
 * renamed, instead of silently dropping the dead ref (the old code hard-coded
 * 'file' and lost folder referrers).
 */
async function readBadgeEitherKind(
  ctx: Parameters<Handler>[1],
  root: string,
  file: string,
): Promise<BadgeFile | null> {
  return (
    (await readBadge(ctx.fs, root, file, 'file')) ?? (await readBadge(ctx.fs, root, file, 'folder'))
  );
}

/**
 * Move ONE badge's JSON from `from` to `to` (lock-protected RMW) and cascade
 * the reference graph: migrate the moved badge's own outbound inbound entries,
 * then rewrite every OTHER badge that referenced `from` to point at `to`. Does
 * NOT touch focus.md (the caller does that once, at the right granularity).
 *
 * Returns the moved badge + the list of referrers rewritten, or moved:null when
 * no badge existed at `from` (a missing descendant during a folder rename — skip
 * it rather than abort the whole folder move).
 */
async function moveBadgeAndCascadeRefs(
  ctx: Parameters<Handler>[1],
  root: string,
  from: string,
  to: string,
  kind: BadgeKind,
): Promise<{ moved: BadgeFile | null; updatedRefs: string[] }> {
  // The badge-file move itself is the RMW that must be serialized against
  // concurrent badge.set/addRef on the same root. The cascade below calls
  // ctx.run('inbound.*' / 'badge.*'), which take other locks or re-enter
  // badge.* — so they run AFTER the lock releases (holding it across them would
  // nest locks → deadlock).
  const moved = await withBadgeLock(root, async () => {
    const source = await readBadge(ctx.fs, root, from, kind);
    if (!source) return null;
    const collision = await readBadge(ctx.fs, root, to, kind);
    if (collision) {
      throw new Error(`badge.rename: badge already exists at ${to}`);
    }
    // Write a copy at the new path, preserving the user's prompt / references /
    // canvas / createdAt; orphan is dropped since the file just (re)appeared.
    const now = new Date().toISOString();
    const copy: BadgeFile = {
      bhVersion: 1,
      file: to,
      kind,
      ...(source.prompt !== undefined && { prompt: source.prompt }),
      ...(source.promptModifiedAt !== undefined && { promptModifiedAt: source.promptModifiedAt }),
      references: source.references,
      ...(source.canvas !== undefined && { canvas: source.canvas }),
      createdAt: source.createdAt,
      modifiedAt: now,
    };
    await writeBadge(ctx.fs, root, copy);
    // Write the new one BEFORE deleting the source so a crash between leaves
    // both (recoverable) rather than neither (the user's note lost).
    await removeBadge(ctx.fs, root, from, kind);
    return copy;
  });
  if (moved === null) return { moved: null, updatedRefs: [] };

  // Migrate the inbound index for the moved badge's OWN outbound refs: writeBadge
  // doesn't cascade, so each target's inbound entry still records the OLD name.
  for (const ref of moved.references) {
    try {
      await ctx.run('inbound.removeRef', { from, to: ref.to });
      await ctx.run('inbound.addRef', {
        from: to,
        to: ref.to,
        ...(ref.note !== undefined && { note: ref.note }),
      });
    } catch (err) {
      if (!(err instanceof Error && err.name === 'UnknownCommand')) throw err;
    }
  }

  // Rewrite every badge that pointed AT `from` to point at `to` (removeRef +
  // addRef, which cascade the inbound index). Inbound module may not be
  // registered (tests wiring just badges); swallow UnknownCommand.
  const updatedRefs: string[] = [];
  let inbound: InboundGetResult = { entries: [] };
  try {
    inbound = await ctx.run<{ file: string }, InboundGetResult>('inbound.get', { file: from });
  } catch (err) {
    if (!(err instanceof Error && err.name === 'UnknownCommand')) throw err;
  }
  for (const entry of inbound.entries) {
    try {
      const referringBadge = await readBadgeEitherKind(ctx, root, entry.from);
      const oldRef = referringBadge?.references.find((r) => r.to === from);
      await ctx.run('badge.removeRef', {
        file: entry.from,
        to: from,
        ...(referringBadge?.kind !== undefined && { kind: referringBadge.kind }),
      });
      await ctx.run('badge.addRef', {
        file: entry.from,
        to,
        ...(referringBadge?.kind !== undefined && { kind: referringBadge.kind }),
        ...(entry.note !== undefined && { note: entry.note }),
        ...(oldRef?.fromSide !== undefined && { fromSide: oldRef.fromSide }),
        ...(oldRef?.toSide !== undefined && { toSide: oldRef.toSide }),
      });
      updatedRefs.push(entry.from);
    } catch (err) {
      // A neighbour badge might have been deleted concurrently; don't abort the
      // whole rename — leave the orphan ref for the user to notice on the canvas.
      if (!(err instanceof Error)) throw err;
      console.warn(`[bh:badges] rename: failed to rewrite ref on ${entry.from}:`, err.message);
    }
  }
  return { moved, updatedRefs };
}

export const rename: Handler<BadgeRenameArgs, BadgeRenameResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  const kind: BadgeKind = args.kind ?? 'file';
  if (args.from === args.to) {
    throw new Error(`badge.rename: from and to are the same (${args.from})`);
  }

  // Move the badge itself (folder's .badge.json, or the file badge) + its refs.
  const { moved, updatedRefs } = await moveBadgeAndCascadeRefs(ctx, root, args.from, args.to, kind);
  if (moved === null && !args.ifExists) {
    throw new Error(`badge.rename: no badge at ${args.from}`);
  }
  // With `ifExists`, a missing source badge is the SPARSE common case (most files
  // carry no badge): don't abort. We still fall through to the descendant carry
  // (a folder may be unannotated yet hold annotated children) and the focus remap,
  // so the rename isn't lossy. Only the throw is gated — the cascade below is not.

  // A FOLDER rename must carry every CHILD badge with it. The folder's own
  // .badge.json move above leaves all `<from>/<child>.json` stranded at the old
  // path: their files now live under `<to>/`, but their badges (prompt + refs)
  // would vanish from the canvas and the brief, and their referrers would dangle.
  // Enumerate every descendant badge and move it too — flat (listBadges returns
  // all descendants), so nested folders and their files are each moved exactly
  // once by string-prefix remap, no recursion / double-processing.
  if (kind === 'folder') {
    const prefix = `${args.from}/`;
    const all = await listBadges(ctx.fs, root);
    const descendants = all.filter((b) => b.file.startsWith(prefix));
    for (const child of descendants) {
      const childTo = `${args.to}/${child.file.slice(prefix.length)}`;
      const res = await moveBadgeAndCascadeRefs(ctx, root, child.file, childTo, child.kind);
      updatedRefs.push(...res.updatedRefs);
    }
  }

  // Update focus.md if `from` is focused. A FILE rename remaps the exact
  // active path; a FOLDER rename remaps every active CHILD path under it AND
  // re-stamps the `# source-folder:` provenance (else editing the renamed
  // folder's prompt would stop refreshing the brief). Both preserve the turn
  // intent + provenance UNDER the focus lock — a bare focus.set({files}) would
  // drop the intent block AND strip provenance.
  let focusUpdated = false;
  try {
    const cmd = kind === 'folder' ? 'focus.renameActiveFolder' : 'focus.renameActiveFile';
    const res = await ctx.run<{ from: string; to: string }, { renamed: boolean }>(cmd, {
      from: args.from,
      to: args.to,
    });
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
    ['badge.reconnectRef', reconnectRef as unknown as Handler<never, unknown>],
    ['badge.markOrphan', markOrphan as unknown as Handler<never, unknown>],
    ['badge.pruneDangling', pruneDangling as unknown as Handler<never, unknown>],
    ['badge.revision', revision as unknown as Handler<never, unknown>],
    ['badge.rename', rename as unknown as Handler<never, unknown>],
  ];
}
