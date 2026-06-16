import { join } from 'node:path';
import {
  type Handler,
  assertReadContained,
  createKeyedMutex,
  patchMirror,
} from '../../kernel/index.js';
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

// Serialize the read-modify-write of each workspace's badge.yaml files. A
// reference edit now writes TWO badges (the source's `references` and the
// target's `referenced_by`); a canvas drag's `badge.set {canvas}` may race a
// prompt blur's `badge.set {prompt}`; the watcher's add-finalize races a user
// edit. Without one lock the second write resurrects the first's stale fields,
// silently dropping the user's note (or a backlink). Keyed by ROOT (not per
// file) because reference + rename ops touch several badge files at once and
// must be atomic across them. [[bh-json-rmw-race]]
//
// The lock wraps the badge RMW (now including the embedded referenced_by
// writes, all direct fs ops). It must NOT wrap a `ctx.run('focus.*')` cascade —
// that takes the focus lock / re-enters and could nest. Acquire → RMW →
// release → then cascade to focus.
const withBadgeLock = createKeyedMutex();

/**
 * Reconcile focus.md after a badge edit: if `file` is in the active list,
 * focus.resync re-inlines the fresh prompt/refs so the agent's turn brief
 * doesn't go stale. Best-effort + tolerant — the badge write already succeeded,
 * so a focus refresh failure (module not registered, a hostile symlinked
 * focus.md → PathEscape) must never fail the badge op. focus.resync no-ops when
 * `file` isn't active, so edits to unfocused badges stay cheap.
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
 * folder-sourced focus's brief must refresh when that prompt changes. Same
 * best-effort tolerance as reconcileFocus.
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
 * brief when it landed under the focused folder. focus.reconcileNewFile no-ops
 * unless a containing folder is the active focus source, so this is cheap.
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
 * A focused file's badge just went orphan (its file was deleted on disk).
 * Re-render the brief so the agent never reads a vanished file. Best-effort —
 * focus.resync no-ops when the file isn't focused.
 */
async function resyncFocusAfterOrphan(ctx: Parameters<Handler>[1], file: string): Promise<void> {
  try {
    await ctx.run('focus.resync', { file });
  } catch (err) {
    console.warn('[bh:badges] focus.resync after markOrphan failed (non-fatal):', err);
  }
}

// ── Embedded reverse-index (referenced_by) helpers ──────────────────────────
// These replace the old .bh/index/inbound.json module: a reference A→B is now
// recorded on BOTH A's badge (references[]) and B's badge (referenced_by[]).
// All run UNDER the root badge lock (the callers acquire it), using direct
// fs reads/writes — never ctx.run('badge.*') (that would re-enter the lock).

function newBadge(file: string, kind: BadgeKind, now: string): BadgeFile {
  return { bhVersion: 1, file, kind, references: [], createdAt: now, modifiedAt: now };
}

/** A badge that carries no human-authored content — only its identity. Such a
 *  stub (materialized solely to hold a backlink) is pruned when its last
 *  backlink goes, keeping the overlay sparse. */
function isEmptyBadge(b: BadgeFile): boolean {
  return (
    b.prompt === undefined &&
    b.references.length === 0 &&
    (b.referenced_by?.length ?? 0) === 0 &&
    b.canvas === undefined &&
    b.orphan !== true
  );
}

/**
 * Upsert `from`'s backlink onto the TARGET badge, MATERIALIZING a minimal badge
 * if the target had none — so "who points at me?" stays answerable for a sparse
 * (un-annotated) target, exactly as the old inbound.json recorded backlinks for
 * files without badges. Target kind defaults to 'file' (unknown here; the common
 * canvas folder→file edge is unaffected).
 */
async function addBacklinkTo(
  ctx: Parameters<Handler>[1],
  root: string,
  target: string,
  from: string,
  note: string | undefined,
  now: string,
): Promise<void> {
  // patchMirror is an ATOMIC field-scoped RMW under the mirror file lock — so a
  // concurrent EXTERNAL writer (an agent editing the target's badge.yaml
  // directly, exactly the race the spec calls out) can't be clobbered by a
  // read-then-write that materialized a stale stub. The materialize default
  // kind is 'file' (unknown here; the common canvas folder→file edge is fine).
  await patchMirror<BadgeFile>(ctx.fs, root, target, 'badge', (current) => {
    const base = current ?? newBadge(target, 'file', now);
    const links = (base.referenced_by ?? []).filter((b) => b.from !== from);
    links.push({ from, ...(note !== undefined && { note }) });
    return { ...base, referenced_by: links, modifiedAt: now };
  });
}

/**
 * Remove `from`'s backlink from the TARGET badge. If that empties a stub badge
 * that existed only to hold backlinks, delete its badge.yaml to keep the overlay
 * sparse (patchMirror removes the file when the patch returns null).
 */
async function removeBacklinkFrom(
  ctx: Parameters<Handler>[1],
  root: string,
  target: string,
  from: string,
  now: string,
): Promise<void> {
  await patchMirror<BadgeFile>(ctx.fs, root, target, 'badge', (current) => {
    if (!current) return null;
    const links = (current.referenced_by ?? []).filter((b) => b.from !== from);
    const { referenced_by: _dropped, ...rest } = current;
    const nextBadge: BadgeFile =
      links.length > 0
        ? { ...rest, referenced_by: links, modifiedAt: now }
        : { ...rest, modifiedAt: now };
    return isEmptyBadge(nextBadge) ? null : nextBadge;
  });
}

export const get: Handler<BadgeGetArgs, BadgeGetResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  return readBadge(ctx.fs, root, args.file);
};

export const set: Handler<BadgeSetArgs, BadgeSetResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  const kind: BadgeKind = args.patch?.kind ?? 'file';
  const patch = args.patch ?? {};

  // patchMirror = atomic field-scoped RMW under the mirror file lock, so a
  // concurrent EXTERNAL writer to this badge.yaml (an agent editing .bh/mirror)
  // can't be clobbered. withBadgeLock(root) still serializes app-level badge ops
  // (rename / addRef touch several files). `existed` is captured from the patch.
  let existed = false;
  const next = (await withBadgeLock(root, () =>
    patchMirror<BadgeFile>(ctx.fs, root, args.file, 'badge', (existing) => {
      existed = existing !== null;
      const now = new Date().toISOString();
      // The prompt's OWN timestamp moves only when the prompt text actually
      // changes — never on canvas drags / kind patches. It anchors the brief's
      // freshness comparison, which `modifiedAt` cannot (every write bumps it).
      const promptChanged = patch.prompt !== undefined && patch.prompt !== existing?.prompt;
      const promptAt = promptChanged ? now : existing?.promptModifiedAt;
      return existing
        ? {
            bhVersion: 1,
            file: existing.file,
            kind: existing.kind,
            ...(patch.prompt !== undefined
              ? { prompt: patch.prompt }
              : existing.prompt !== undefined && { prompt: existing.prompt }),
            ...(promptAt !== undefined && { promptModifiedAt: promptAt }),
            // references + referenced_by are managed ONLY by addRef/removeRef/
            // rename (which cascade both sides of the graph); set() preserves
            // them verbatim so a prompt/canvas edit can't break the invariant.
            references: existing.references,
            ...(existing.referenced_by !== undefined &&
              existing.referenced_by.length > 0 && { referenced_by: existing.referenced_by }),
            ...(patch.canvas !== undefined
              ? { canvas: patch.canvas }
              : existing.canvas !== undefined && { canvas: existing.canvas }),
            // PRESERVE orphan across ordinary edits — a prompt/canvas edit on a
            // deleted file must not silently un-orphan it. Cleared only by an
            // explicit `orphan:false` (the watcher's add when the file reappears).
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
            references: [],
            ...(patch.canvas !== undefined && { canvas: patch.canvas }),
            ...(patch.orphan === true && { orphan: true }),
            createdAt: now,
            modifiedAt: now,
          };
    }),
  )) as BadgeFile;

  // Only reconcile focus.md when the edit changes the INLINED BRIEF (the prompt;
  // references no longer arrive through set()). A kind-only / canvas-only patch
  // leaves the brief identical — skip.
  if (kind === 'folder') {
    if (patch.prompt !== undefined) await reconcileFolderIntent(ctx, args.file);
  } else {
    if (patch.prompt !== undefined) {
      await reconcileFocus(ctx, args.file);
    }
    if (!existed) await reconcileNewFile(ctx, args.file);
  }
  return next;
};

export const list: Handler<BadgeListArgs, BadgeListResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  let badges = await listBadges(ctx.fs, root);
  // BadgeListArgs is fully optional — be defensive in case a caller hands us
  // undefined instead of {}.
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
  // Under the lock: remove the badge, then scrub THIS file's backlink out of
  // each of its outbound targets (so a deleted badge leaves no phantom
  // referenced_by entry pointing FROM a badge that no longer exists). We do NOT
  // rewrite referrers' references[] — that matches the old delete (a dangling
  // ref to a now-badge-less file is fine in the sparse overlay).
  const deleted = await withBadgeLock(root, async () => {
    const now = new Date().toISOString();
    const existing = await readBadge(ctx.fs, root, args.file);
    const removed = await removeBadge(ctx.fs, root, args.file);
    if (existing) {
      for (const ref of existing.references) {
        await removeBacklinkFrom(ctx, root, ref.to, args.file, now);
      }
    }
    return removed;
  });
  if (deleted && kind === 'file') await reconcileFocus(ctx, args.file);
  return { deleted };
};

export const addRef: Handler<BadgeAddRefArgs, BadgeFile> = async (args, ctx) => {
  // A badge referencing itself is meaningless for the agent neighbourhood walk
  // and breaks badge.rename (the self-ref's `to` doesn't get remapped). This
  // guard belongs in core so the canvas self-drag, agents, all enforce it.
  if (args.to === args.file) {
    throw new Error(`Badge cannot reference itself: ${args.file}`);
  }
  validateSide(args.fromSide, 'fromSide');
  validateSide(args.toSide, 'toSide');
  const root = await currentWorkspaceRoot(ctx);
  const kind = args.kind ?? 'file';
  const next = await withBadgeLock(root, async () => {
    const now = new Date().toISOString();
    const newRef = {
      to: args.to,
      ...(args.note !== undefined && { note: args.note }),
      ...(args.fromSide !== undefined && { fromSide: args.fromSide }),
      ...(args.toSide !== undefined && { toSide: args.toSide }),
    };
    const merged = (await patchMirror<BadgeFile>(ctx.fs, root, args.file, 'badge', (existing) => {
      const base = existing ?? newBadge(args.file, kind, now);
      const without = base.references.filter((r) => r.to !== args.to);
      return { ...base, references: [...without, newRef], modifiedAt: now };
    })) as BadgeFile;
    // Embed the reverse link on the TARGET badge (the old inbound.addRef).
    await addBacklinkTo(ctx, root, args.to, args.file, args.note, now);
    return merged;
  });
  await reconcileFocus(ctx, args.file);
  return next;
};

export const removeRef: Handler<BadgeRemoveRefArgs, BadgeFile> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  const next = await withBadgeLock(root, async () => {
    const now = new Date().toISOString();
    const merged = (await patchMirror<BadgeFile>(ctx.fs, root, args.file, 'badge', (existing) => {
      if (!existing) throw new Error(`Badge not found: ${args.file}`);
      return {
        ...existing,
        references: existing.references.filter((r) => r.to !== args.to),
        modifiedAt: now,
      };
    })) as BadgeFile;
    // Drop the reverse link from the TARGET badge (the old inbound.removeRef).
    await removeBacklinkFrom(ctx, root, args.to, args.file, now);
    return merged;
  });
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
 * Preserves prompt / references / referenced_by so nothing is lost — the user
 * can re-create the file or explicitly badge.delete to scrub. Called by the
 * watcher on `unlink`; no-op if the badge doesn't exist.
 */
export const markOrphan: Handler<BadgeMarkOrphanArgs, BadgeMarkOrphanResult> = async (
  args,
  ctx,
) => {
  const root = await currentWorkspaceRoot(ctx);
  const kind = args.kind ?? 'file';
  const next = await withBadgeLock(root, () =>
    patchMirror<BadgeFile>(ctx.fs, root, args.file, 'badge', (existing) =>
      existing === null
        ? null
        : { ...existing, orphan: true, modifiedAt: new Date().toISOString() },
    ),
  );
  if (next === null) return null;
  // A focused file that just vanished must leave the brief. File badges only —
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

/** Cheap badge-store signature (count + newest mtime) for an external-edit poll. */
export const revision: Handler<BadgeRevisionArgs, BadgeRevisionResult> = async (_args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  return badgesRevision(ctx.fs, root);
};

/**
 * Stat-based liveness sweep for the whole badge graph (the badges analog of
 * focus.pruneDangling). Run on workspace open: mark every badge whose disk
 * target is gone as orphan (preserving the human note + excluding it from
 * briefs). Already-orphan badges are skipped. Best-effort per badge.
 */
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
 * Move ONE badge from `from` to `to` (lock-protected) and cascade the reference
 * graph via the EMBEDDED backlinks — no inbound index any more:
 *  - the moved badge's OUTBOUND refs: rewrite each target's referenced_by entry
 *    `from` → `to`;
 *  - the moved badge's INBOUND backlinks: rewrite each referrer's references[]
 *    entry `to: from` → `to: to` (preserving note + sides).
 * Both the copy and every neighbour edit happen under one root lock with direct
 * fs writes. Returns the moved badge + the referrers rewritten, or moved:null
 * when no badge existed at `from` (a missing descendant in a folder rename).
 * Does NOT touch focus.md (the caller does that once, at the right granularity).
 */
async function moveBadgeAndCascadeRefs(
  ctx: Parameters<Handler>[1],
  root: string,
  from: string,
  to: string,
): Promise<{ moved: BadgeFile | null; updatedRefs: string[] }> {
  return withBadgeLock(root, async () => {
    const source = await readBadge(ctx.fs, root, from);
    if (!source) return { moved: null, updatedRefs: [] };
    const collision = await readBadge(ctx.fs, root, to);
    if (collision) {
      throw new Error(`badge.rename: badge already exists at ${to}`);
    }
    const now = new Date().toISOString();
    // Copy to the new path, preserving prompt / references / referenced_by /
    // canvas / createdAt; orphan is dropped (the file just (re)appeared).
    const { orphan: _orphan, ...rest } = source;
    const copy: BadgeFile = { ...rest, file: to, modifiedAt: now };
    // Write the new badge BEFORE deleting the source so a crash between leaves
    // both (recoverable) rather than neither (the user's note lost).
    await writeBadge(ctx.fs, root, copy);
    await removeBadge(ctx.fs, root, from);

    // Outbound: each target's backlink FROM `from` becomes FROM `to`. patchMirror
    // for atomic per-file RMW (external-writer safety); a missing target is a
    // no-op (don't materialize a badge just to repoint a non-existent backlink).
    for (const ref of source.references) {
      await patchMirror<BadgeFile>(ctx.fs, root, ref.to, 'badge', (target) => {
        if (!target) return null;
        const links = (target.referenced_by ?? []).map((b) =>
          b.from === from ? { ...b, from: to } : b,
        );
        return { ...target, referenced_by: links, modifiedAt: now };
      });
    }

    // Inbound: each referrer's reference TO `from` becomes TO `to` (note + sides
    // preserved). Track which referrers ACTUALLY existed — a backlink whose
    // referrer badge was externally deleted is a phantom and must not survive.
    const updatedRefs: string[] = [];
    for (const back of source.referenced_by ?? []) {
      const rewritten = await patchMirror<BadgeFile>(
        ctx.fs,
        root,
        back.from,
        'badge',
        (referrer) => {
          if (!referrer) return null;
          const refs = referrer.references.map((r) => (r.to === from ? { ...r, to } : r));
          return { ...referrer, references: refs, modifiedAt: now };
        },
      );
      if (rewritten !== null) updatedRefs.push(back.from);
    }

    // Drop phantom backlinks (referrer no longer exists) from the moved copy so
    // every referenced_by entry has a live reciprocal reference.
    const liveSet = new Set(updatedRefs);
    const allBacklinks = copy.referenced_by ?? [];
    const liveBacklinks = allBacklinks.filter((b) => liveSet.has(b.from));
    let moved: BadgeFile = copy;
    if (liveBacklinks.length !== allBacklinks.length) {
      const { referenced_by: _drop, ...restCopy } = copy;
      moved =
        liveBacklinks.length > 0
          ? { ...restCopy, referenced_by: liveBacklinks, modifiedAt: now }
          : { ...restCopy, modifiedAt: now };
      await writeBadge(ctx.fs, root, moved);
    }
    return { moved, updatedRefs };
  });
}

/**
 * Atomic rename: move the badge from `from` to `to`, rewrite the reference graph
 * (both directions, via embedded backlinks), carry descendant badges on a folder
 * rename, and update focus.md if `from` was active.
 *
 * Errors:
 *  - Throws if the source badge doesn't exist (unless `ifExists`).
 *  - Throws if a badge already exists at `to` (collision).
 */
export const rename: Handler<BadgeRenameArgs, BadgeRenameResult> = async (args, ctx) => {
  const root = await currentWorkspaceRoot(ctx);
  const kind: BadgeKind = args.kind ?? 'file';
  if (args.from === args.to) {
    throw new Error(`badge.rename: from and to are the same (${args.from})`);
  }

  const { moved, updatedRefs } = await moveBadgeAndCascadeRefs(ctx, root, args.from, args.to);
  if (moved === null && !args.ifExists) {
    throw new Error(`badge.rename: no badge at ${args.from}`);
  }

  // A FOLDER rename must carry every CHILD badge with it: the folder's own
  // badge.yaml move above leaves descendants stranded at the old prefix. List
  // is flat, so each descendant is remapped exactly once by string prefix.
  if (kind === 'folder') {
    const prefix = `${args.from}/`;
    const all = await listBadges(ctx.fs, root);
    const descendants = all.filter((b) => b.file.startsWith(prefix));
    for (const child of descendants) {
      const childTo = `${args.to}/${child.file.slice(prefix.length)}`;
      const res = await moveBadgeAndCascadeRefs(ctx, root, child.file, childTo);
      updatedRefs.push(...res.updatedRefs);
    }
  }

  // Update focus.md if `from` is focused. Best-effort (tolerate missing module
  // / a hostile symlinked focus.md → PathEscape), exactly like reconcileFocus.
  let focusUpdated = false;
  try {
    const cmd = kind === 'folder' ? 'focus.renameActiveFolder' : 'focus.renameActiveFile';
    const res = await ctx.run<{ from: string; to: string }, { renamed: boolean }>(cmd, {
      from: args.from,
      to: args.to,
    });
    focusUpdated = res.renamed;
  } catch (err) {
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
