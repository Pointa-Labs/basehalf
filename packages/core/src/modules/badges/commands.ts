import { join } from 'node:path';
import {
  type Handler,
  assertReadContained,
  createKeyedMutex,
  patchMirror,
  requireWorkspaceRoot,
} from '../../kernel/index.js';
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
  BadgeRemoveRefArgs,
  BadgeRenameArgs,
  BadgeRenameResult,
  BadgeRevisionArgs,
  BadgeRevisionResult,
  BadgeSetArgs,
  BadgeSetResult,
} from './types.js';

// Serialize the read-modify-write of each workspace's badge.yaml files. A
// reference edit writes TWO badges (the source's `references` and the target's
// `referenced_by`); a description blur races the watcher's add-finalize. Without
// one lock the second write resurrects the first's stale fields, silently
// dropping a description (or a backlink). Keyed by ROOT (not per file) because
// reference + rename ops touch several badge files at once and must be atomic
// across them. [[bh-json-rmw-race]]
const withBadgeLock = createKeyedMutex();

// ── Embedded reverse-index (referenced_by) helpers ──────────────────────────
// These replace the old .bh/index/inbound.json module: a reference A→B is now
// recorded on BOTH A's badge (references[]) and B's badge (referenced_by[]) as
// plain paths. All run UNDER the root badge lock (the callers acquire it), using
// patchMirror (atomic per-file) — never ctx.run('badge.*') (that re-enters the lock).

function newBadge(path: string, kind: BadgeKind): BadgeFile {
  return { path, kind, references: [] };
}

/** A badge that carries no human-authored content — only its identity. Such a
 *  stub (materialized solely to hold a backlink) is pruned when its last backlink
 *  goes, keeping the overlay sparse. */
function isEmptyBadge(b: BadgeFile): boolean {
  return (
    b.description === undefined &&
    b.references.length === 0 &&
    (b.referenced_by?.length ?? 0) === 0 &&
    b.orphan !== true
  );
}

/**
 * Upsert `from`'s backlink onto the TARGET badge, MATERIALIZING a minimal badge
 * if the target had none — so "who points at me?" stays answerable for a sparse
 * (un-annotated) target. patchMirror is an ATOMIC field-scoped RMW under the
 * mirror file lock, so a concurrent EXTERNAL writer (an agent editing the
 * target's badge.yaml directly) can't be clobbered by a stale read. Target kind
 * defaults to 'file' (unknown here; the common canvas folder→file edge is fine).
 */
async function addBacklinkTo(
  ctx: Parameters<Handler>[1],
  root: string,
  target: string,
  from: string,
): Promise<void> {
  await patchMirror<BadgeFile>(ctx.fs, root, target, 'badge', (current) => {
    const base = current ?? newBadge(target, 'file');
    const links = (base.referenced_by ?? []).filter((b) => b !== from);
    links.push(from);
    return { ...base, referenced_by: links };
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
): Promise<void> {
  await patchMirror<BadgeFile>(ctx.fs, root, target, 'badge', (current) => {
    if (!current) return null;
    const links = (current.referenced_by ?? []).filter((b) => b !== from);
    const { referenced_by: _dropped, ...rest } = current;
    const nextBadge: BadgeFile = links.length > 0 ? { ...rest, referenced_by: links } : { ...rest };
    return isEmptyBadge(nextBadge) ? null : nextBadge;
  });
}

export const get: Handler<BadgeGetArgs, BadgeGetResult> = async (args, ctx) => {
  const root = requireWorkspaceRoot(ctx);
  return readBadge(ctx.fs, root, args.file);
};

export const set: Handler<BadgeSetArgs, BadgeSetResult> = async (args, ctx) => {
  const root = requireWorkspaceRoot(ctx);
  const kind: BadgeKind = args.patch?.kind ?? 'file';
  const patch = args.patch ?? {};

  // patchMirror = atomic field-scoped RMW under the mirror file lock, so a
  // concurrent EXTERNAL writer to this badge.yaml (an agent editing .bh/mirror)
  // can't be clobbered. withBadgeLock(root) still serializes app-level badge ops
  // (rename / addRef touch several files).
  const next = (await withBadgeLock(root, () =>
    patchMirror<BadgeFile>(ctx.fs, root, args.file, 'badge', (existing) => {
      if (existing) {
        const nextDescription =
          patch.description !== undefined ? patch.description : existing.description;
        return {
          path: existing.path,
          kind: existing.kind,
          ...(nextDescription !== undefined &&
            nextDescription !== '' && { description: nextDescription }),
          // references + referenced_by are managed ONLY by addRef/removeRef/rename
          // (which cascade both sides of the graph); set() preserves them verbatim
          // so a description edit can't break the invariant.
          references: existing.references,
          ...(existing.referenced_by !== undefined &&
            existing.referenced_by.length > 0 && { referenced_by: existing.referenced_by }),
          // PRESERVE orphan across ordinary edits — a description edit on a deleted
          // file must not silently un-orphan it. Cleared only by an explicit
          // `orphan:false` (the watcher's add when the file reappears).
          ...((patch.orphan ?? existing.orphan) === true && { orphan: true }),
        };
      }
      return {
        path: args.file,
        kind,
        ...(patch.description !== undefined &&
          patch.description !== '' && { description: patch.description }),
        references: [],
        ...(patch.orphan === true && { orphan: true }),
      };
    }),
  )) as BadgeFile;
  // Focus is a viewport mirror now (not a curated brief), so a badge edit no
  // longer reconciles focus — the agent reads the badge.yaml fresh each turn.
  return next;
};

export const list: Handler<BadgeListArgs, BadgeListResult> = async (args, ctx) => {
  const root = requireWorkspaceRoot(ctx);
  let badges = await listBadges(ctx.fs, root);
  const kind = args?.kind;
  if (kind) {
    badges = badges.filter((b) => b.kind === kind);
  }
  const query = args?.query;
  if (query) {
    const q = query.toLowerCase();
    badges = badges.filter(
      (b) => b.path.toLowerCase().includes(q) || (b.description ?? '').toLowerCase().includes(q),
    );
  }
  return { badges };
};

export const del: Handler<BadgeDeleteArgs, BadgeDeleteResult> = async (args, ctx) => {
  const root = requireWorkspaceRoot(ctx);
  // Under the lock: remove the badge, then scrub THIS file's backlink out of each
  // of its outbound targets (so a deleted badge leaves no phantom referenced_by
  // entry pointing FROM a badge that no longer exists). We do NOT rewrite
  // referrers' references[] — a dangling ref to a now-badge-less file is fine in
  // the sparse overlay.
  const deleted = await withBadgeLock(root, async () => {
    const existing = await readBadge(ctx.fs, root, args.file);
    const removed = await removeBadge(ctx.fs, root, args.file);
    if (existing) {
      for (const to of existing.references) {
        await removeBacklinkFrom(ctx, root, to, args.file);
      }
    }
    return removed;
  });
  return { deleted };
};

export const addRef: Handler<BadgeAddRefArgs, BadgeFile> = async (args, ctx) => {
  // A badge referencing itself is meaningless for the agent neighbourhood walk
  // and breaks badge.rename (the self-ref's target doesn't get remapped). This
  // guard belongs in core so the canvas self-drag, agents, all enforce it.
  if (args.to === args.file) {
    throw new Error(`Badge cannot reference itself: ${args.file}`);
  }
  const root = requireWorkspaceRoot(ctx);
  const kind = args.kind ?? 'file';
  const next = await withBadgeLock(root, async () => {
    const merged = (await patchMirror<BadgeFile>(ctx.fs, root, args.file, 'badge', (existing) => {
      const base = existing ?? newBadge(args.file, kind);
      const without = base.references.filter((r) => r !== args.to);
      return { ...base, references: [...without, args.to] };
    })) as BadgeFile;
    // Embed the reverse link on the TARGET badge (the old inbound.addRef).
    await addBacklinkTo(ctx, root, args.to, args.file);
    return merged;
  });
  return next;
};

export const removeRef: Handler<BadgeRemoveRefArgs, BadgeFile> = async (args, ctx) => {
  const root = requireWorkspaceRoot(ctx);
  const next = await withBadgeLock(root, async () => {
    const merged = (await patchMirror<BadgeFile>(ctx.fs, root, args.file, 'badge', (existing) => {
      if (!existing) throw new Error(`Badge not found: ${args.file}`);
      return { ...existing, references: existing.references.filter((r) => r !== args.to) };
    })) as BadgeFile;
    // Drop the reverse link from the TARGET badge (the old inbound.removeRef).
    await removeBacklinkFrom(ctx, root, args.to, args.file);
    return merged;
  });
  return next;
};

/**
 * Mark an existing badge as orphan (its underlying file was deleted on disk).
 * Preserves description / references / referenced_by so nothing is lost — the
 * user can re-create the file or explicitly badge.delete to scrub. Called by the
 * watcher on `unlink`; no-op if the badge doesn't exist.
 */
export const markOrphan: Handler<BadgeMarkOrphanArgs, BadgeMarkOrphanResult> = async (
  args,
  ctx,
) => {
  const root = requireWorkspaceRoot(ctx);
  const next = await withBadgeLock(root, () =>
    patchMirror<BadgeFile>(ctx.fs, root, args.file, 'badge', (existing) =>
      existing === null ? null : { ...existing, orphan: true },
    ),
  );
  return next;
};

/** Stat the disk target behind a badge: a file badge → its file, a folder badge
 *  → its directory. Containment-guarded; any error reads as "gone". */
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
  const root = requireWorkspaceRoot(ctx);
  return badgesRevision(ctx.fs, root);
};

/**
 * Stat-based liveness sweep for the whole badge graph (the badges analog of
 * focus.pruneDangling). Run on workspace open: mark every badge whose disk target
 * is gone as orphan (preserving the human note + excluding it from briefs).
 * Already-orphan badges are skipped. Best-effort per badge.
 */
export const pruneDangling: Handler<BadgePruneDanglingArgs, BadgePruneDanglingResult> = async (
  _args,
  ctx,
) => {
  const root = requireWorkspaceRoot(ctx);
  const badges = await listBadges(ctx.fs, root);
  const orphaned: string[] = [];
  for (const badge of badges) {
    if (badge.orphan === true) continue;
    if (await badgeTargetExists(ctx, root, badge.path, badge.kind)) continue;
    try {
      const res = await ctx.run('badge.markOrphan', { file: badge.path, kind: badge.kind });
      if (res !== null) orphaned.push(badge.path);
    } catch {
      /* best-effort: a cascade hiccup must not fail the whole sweep */
    }
  }
  return { orphaned };
};

/**
 * Move ONE badge from `from` to `to` (lock-protected) and cascade the reference
 * graph via the EMBEDDED backlinks (plain paths, both directions):
 *  - the moved badge's OUTBOUND refs: rewrite each target's referenced_by entry
 *    `from` → `to`;
 *  - the moved badge's INBOUND backlinks: rewrite each referrer's references[]
 *    entry `from` → `to`.
 * Both the copy and every neighbour edit happen under one root lock. Returns the
 * moved badge + the referrers rewritten, or moved:null when no badge existed at
 * `from`. Touches only the badge layer; the rest of the mirror node (canvas /
 * focus / adhd) is carried by the cascade in `rename` below.
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
    // Copy to the new path, preserving description / references / referenced_by;
    // orphan is dropped (the file just (re)appeared).
    const { orphan: _orphan, ...rest } = source;
    const copy: BadgeFile = { ...rest, path: to };
    // Write the new badge BEFORE deleting the source so a crash between leaves
    // both (recoverable) rather than neither (the user's note lost).
    await writeBadge(ctx.fs, root, copy);
    await removeBadge(ctx.fs, root, from);

    // Outbound: each target's backlink FROM `from` becomes FROM `to`. A missing
    // target is a no-op (don't materialize a badge just to repoint a non-existent
    // backlink).
    for (const target of source.references) {
      await patchMirror<BadgeFile>(ctx.fs, root, target, 'badge', (t) => {
        if (!t) return null;
        const links = (t.referenced_by ?? []).map((b) => (b === from ? to : b));
        return { ...t, referenced_by: links };
      });
    }

    // Inbound: each referrer's reference TO `from` becomes TO `to`. Track which
    // referrers ACTUALLY existed — a backlink whose referrer badge was externally
    // deleted is a phantom and must not survive.
    const updatedRefs: string[] = [];
    for (const referrerPath of source.referenced_by ?? []) {
      const rewritten = await patchMirror<BadgeFile>(ctx.fs, root, referrerPath, 'badge', (r) => {
        if (!r) return null;
        return { ...r, references: r.references.map((ref) => (ref === from ? to : ref)) };
      });
      if (rewritten !== null) updatedRefs.push(referrerPath);
    }

    // Drop phantom backlinks (referrer no longer exists) from the moved copy so
    // every referenced_by entry has a live reciprocal reference.
    const liveSet = new Set(updatedRefs);
    const allBacklinks = copy.referenced_by ?? [];
    const liveBacklinks = allBacklinks.filter((b) => liveSet.has(b));
    let moved: BadgeFile = copy;
    if (liveBacklinks.length !== allBacklinks.length) {
      const { referenced_by: _drop, ...restCopy } = copy;
      moved =
        liveBacklinks.length > 0 ? { ...restCopy, referenced_by: liveBacklinks } : { ...restCopy };
      await writeBadge(ctx.fs, root, moved);
    }
    return { moved, updatedRefs };
  });
}

/**
 * Atomic rename: move the badge from `from` to `to`, rewrite the reference graph
 * (both directions, via embedded backlinks), carry descendant badges on a folder
 * rename, then cascade the REST of the mirror node (canvas / focus / adhd) to the
 * new location via ctx.run — so the whole node follows the file/folder. This is
 * the shared rename choke point (workspace.renameEntry AND the watcher route
 * through it), so both paths get the full cascade.
 *
 * Errors:
 *  - Throws if the source badge doesn't exist (unless `ifExists`).
 *  - Throws if a badge already exists at `to` (collision).
 */
export const rename: Handler<BadgeRenameArgs, BadgeRenameResult> = async (args, ctx) => {
  const root = requireWorkspaceRoot(ctx);
  const kind: BadgeKind = args.kind ?? 'file';
  if (args.from === args.to) {
    throw new Error(`badge.rename: from and to are the same (${args.from})`);
  }

  const { moved, updatedRefs } = await moveBadgeAndCascadeRefs(ctx, root, args.from, args.to);
  if (moved === null && !args.ifExists) {
    throw new Error(`badge.rename: no badge at ${args.from}`);
  }

  // A FOLDER rename must carry every CHILD badge with it: the folder's own
  // badge.yaml move above leaves descendants stranded at the old prefix. List is
  // flat, so each descendant is remapped exactly once by string prefix.
  if (kind === 'folder') {
    const prefix = `${args.from}/`;
    const all = await listBadges(ctx.fs, root);
    const descendants = all.filter((b) => b.path.startsWith(prefix));
    for (const child of descendants) {
      const childTo = `${args.to}/${child.path.slice(prefix.length)}`;
      const res = await moveBadgeAndCascadeRefs(ctx, root, child.path, childTo);
      updatedRefs.push(...res.updatedRefs);
    }
  }

  // ── Carry the REST of the mirror node to the new location ──────────────────
  // badge.yaml + the reference graph moved above; the node's visual layer
  // (canvas card geometry + the parent's card/edges), its focus.yaml viewport
  // (+ the current_focus symlink), and its adhd reading aids must follow too, or
  // they go stale at the old path. Orchestrated HERE because badge.rename is the
  // single rename choke point (workspace.renameEntry AND the watcher both route
  // through it). Each owning module does its own subtree recursion, so one call
  // per kind covers a folder's descendants. Best-effort: an unregistered module
  // (a test wiring a subset) or a missing file must never fail the rename the
  // badge layer already committed.
  await cascadeRename(ctx, 'canvas.relocate', { from: args.from, to: args.to, kind });
  await cascadeRename(ctx, 'adhd.relocate', { from: args.from, to: args.to });
  const focusRes = (await cascadeRename(ctx, 'focus.relocate', {
    from: args.from,
    to: args.to,
  })) as { moved: number; repointed: boolean } | undefined;

  return { badge: moved, updatedRefs, focusUpdated: focusRes?.repointed ?? false };
};

/**
 * Run one rename-cascade command, tolerating a module that isn't registered (tests
 * wire a subset) and never letting a cascade hiccup fail the already-committed
 * badge rename. A non-`UnknownCommand` error is logged, not thrown — the cascade
 * touches DERIVED state (canvas geometry / focus viewport / reading aids) that
 * degrades gracefully when stale, whereas throwing here would surface a confusing
 * error after the file + badge already moved.
 */
async function cascadeRename(
  ctx: Parameters<Handler>[1],
  command: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  try {
    return await ctx.run(command, args);
  } catch (err) {
    if (err instanceof Error && err.name === 'UnknownCommand') return undefined;
    console.warn(`[bh] rename cascade ${command} failed:`, err);
    return undefined;
  }
}

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
    ['badge.pruneDangling', pruneDangling as unknown as Handler<never, unknown>],
    ['badge.revision', revision as unknown as Handler<never, unknown>],
    ['badge.rename', rename as unknown as Handler<never, unknown>],
  ];
}
