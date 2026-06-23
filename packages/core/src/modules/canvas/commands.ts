import {
  type Handler,
  createKeyedMutex,
  isMirrorSubtree,
  purgeMirrorKind,
  relocateMirrorKind,
  remapSubtreeRel,
  requireWorkspaceRoot,
} from '../../kernel/index.js';
import { canvasRel, canvasRevision, patchCanvas, readCanvas } from './store.js';
import {
  CANVAS_ANCHORS,
  type CanvasAnchor,
  type CanvasCard,
  type CanvasConnectArgs,
  type CanvasConnectResult,
  type CanvasDisconnectArgs,
  type CanvasDisconnectResult,
  type CanvasEdge,
  type CanvasFile,
  type CanvasGetArgs,
  type CanvasGetResult,
  type CanvasPurgeNodeArgs,
  type CanvasPurgeNodeResult,
  type CanvasReconnectArgs,
  type CanvasReconnectResult,
  type CanvasRelocateArgs,
  type CanvasRelocateResult,
  type CanvasRemoveCardArgs,
  type CanvasRemoveCardResult,
  type CanvasSetCardArgs,
  type CanvasSetCardResult,
  type CanvasSetSizeArgs,
  type CanvasSetSizeResult,
} from './types.js';

/** The folder a node lives in (its parent), as a canvas rel (`''` = root). */
function parentRel(rel: string): string {
  const i = rel.lastIndexOf('/');
  return i === -1 ? '' : rel.slice(0, i);
}

/** Whether `from` already has an outbound reference to `to` — read before a
 *  lockstep edge+ref write so a compensation on failure only undoes a ref WE
 *  created (badge.addRef is idempotent and can't tell a fresh add from a no-op). */
async function referenceExists(
  ctx: Parameters<Handler>[1],
  from: string,
  to: string,
  kind: 'file' | 'folder' | undefined,
): Promise<boolean> {
  const badge = (await ctx.run('badge.get', {
    file: from,
    ...(kind !== undefined && { kind }),
  })) as { references?: readonly string[] } | null;
  return badge?.references?.includes(to) ?? false;
}

// Serialize app-level canvas mutations per workspace ROOT. canvas.connect /
// disconnect / reconnect each touch the canvas.yaml AND the badge graph (two
// files); the root lock keeps those multi-file ops atomic against each other.
// patchCanvas adds per-file atomicity against EXTERNAL writers (an agent editing
// .bh/mirror directly). The lock must NOT wrap a badge ctx.run that re-enters its
// own lock — acquire → canvas RMW → release → then run badge ops, OR run badge
// ops first then canvas RMW. We do badge-first so a validation throw (self-ref)
// leaves no orphan edge. [[bh-json-rmw-race]]
const withCanvasLock = createKeyedMutex();

function validateAnchor(anchor: unknown, field: string): asserts anchor is CanvasAnchor {
  if (typeof anchor !== 'string' || !CANVAS_ANCHORS.includes(anchor as CanvasAnchor)) {
    throw new Error(`${field} must be one of ${CANVAS_ANCHORS.join(', ')}`);
  }
}

function emptyCanvas(folderRel: string): CanvasFile {
  return { path: folderRel, cards: [], edges: [] };
}

/** An untouched canvas — no cards, edges, or size — is pruned to keep the overlay
 *  sparse (patchCanvas removes the file when the patch returns null). */
function isEmptyCanvas(c: CanvasFile): boolean {
  return c.cards.length === 0 && c.edges.length === 0 && c.size === undefined;
}

function upsertCard(cards: readonly CanvasCard[], card: CanvasCard): CanvasCard[] {
  return [...cards.filter((c) => c.path !== card.path), card];
}

function upsertEdge(edges: readonly CanvasEdge[], edge: CanvasEdge): CanvasEdge[] {
  return [...edges.filter((e) => !(e.from === edge.from && e.to === edge.to)), edge];
}

function removeEdge(edges: readonly CanvasEdge[], from: string, to: string): CanvasEdge[] {
  return edges.filter((e) => !(e.from === from && e.to === to));
}

function makeEdge(
  from: string,
  to: string,
  fromAnchor: CanvasAnchor,
  toAnchor: CanvasAnchor,
  label: string | undefined,
): CanvasEdge {
  const trimmed = label?.trim();
  return {
    from,
    from_anchor: fromAnchor,
    to,
    to_anchor: toAnchor,
    ...(trimmed !== undefined && trimmed !== '' && { label: trimmed }),
  };
}

export const get: Handler<CanvasGetArgs, CanvasGetResult> = async (args, ctx) => {
  const root = requireWorkspaceRoot(ctx);
  return readCanvas(ctx.fs, root, args.folder);
};

export const setCard: Handler<CanvasSetCardArgs, CanvasSetCardResult> = async (args, ctx) => {
  const root = requireWorkspaceRoot(ctx);
  const folderRel = canvasRel(args.folder);
  return (await withCanvasLock(root, () =>
    patchCanvas(ctx.fs, root, args.folder, (current) => {
      const base = current ?? emptyCanvas(folderRel);
      return { ...base, cards: upsertCard(base.cards, args.card) };
    }),
  )) as CanvasFile;
};

export const removeCard: Handler<CanvasRemoveCardArgs, CanvasRemoveCardResult> = async (
  args,
  ctx,
) => {
  const root = requireWorkspaceRoot(ctx);
  let removed = false;
  await withCanvasLock(root, () =>
    patchCanvas(ctx.fs, root, args.folder, (current) => {
      if (!current) return null;
      const cards = current.cards.filter((c) => c.path !== args.path);
      removed = cards.length !== current.cards.length;
      const next: CanvasFile = { ...current, cards };
      return isEmptyCanvas(next) ? null : next;
    }),
  );
  return { removed };
};

export const setSize: Handler<CanvasSetSizeArgs, CanvasSetSizeResult> = async (args, ctx) => {
  const root = requireWorkspaceRoot(ctx);
  const folderRel = canvasRel(args.folder);
  return (await withCanvasLock(root, () =>
    patchCanvas(ctx.fs, root, args.folder, (current) => {
      const base = current ?? emptyCanvas(folderRel);
      return { ...base, size: args.size };
    }),
  )) as CanvasFile;
};

export const connect: Handler<CanvasConnectArgs, CanvasConnectResult> = async (args, ctx) => {
  if (args.from === args.to) {
    throw new Error(`Canvas edge cannot connect a card to itself: ${args.from}`);
  }
  validateAnchor(args.from_anchor, 'from_anchor');
  validateAnchor(args.to_anchor, 'to_anchor');
  const root = requireWorkspaceRoot(ctx);
  const folderRel = canvasRel(args.folder);
  const edge = makeEdge(args.from, args.to, args.from_anchor, args.to_anchor, args.label);
  // The WHOLE edge+ref pair runs under withCanvasLock so a concurrent canvas op
  // can't observe a half-applied state (ref written but edge not, or vice versa).
  // badge.addRef re-enters only withBadgeLock/withMirrorLock — NEVER withCanvasLock
  // — and no path ever locks badge→canvas, so holding the canvas lock across it
  // cannot deadlock. Semantic link first; if the canvas write then throws,
  // compensate by dropping the just-added reference so the two layers can't
  // durably drift out of lockstep.
  return (await withCanvasLock(root, async () => {
    // Did the reference already exist (e.g. added via the badge panel, no edge
    // yet)? badge.addRef is IDEMPOTENT, so on a canvas-write failure we must only
    // compensate-remove a ref WE created — removing a pre-existing one would
    // destroy a user reference (and any other edge that depends on it).
    const refExisted = await referenceExists(ctx, args.from, args.to, args.kind);
    await ctx.run('badge.addRef', {
      file: args.from,
      to: args.to,
      ...(args.kind !== undefined && { kind: args.kind }),
    });
    try {
      return await patchCanvas(ctx.fs, root, args.folder, (current) => {
        const base = current ?? emptyCanvas(folderRel);
        return { ...base, edges: upsertEdge(base.edges, edge) };
      });
    } catch (err) {
      if (!refExisted) {
        await ctx.run('badge.removeRef', { file: args.from, to: args.to }).catch(() => {});
      }
      throw err;
    }
  })) as CanvasFile;
};

export const disconnect: Handler<CanvasDisconnectArgs, CanvasDisconnectResult> = async (
  args,
  ctx,
) => {
  const root = requireWorkspaceRoot(ctx);
  // Whole pair under withCanvasLock (see connect). Drop the semantic link first,
  // tolerating a missing badge (a canvas edge can outlive an externally-deleted
  // badge). If the canvas write then throws, re-add the ref so we never leave a
  // reference removed without its edge.
  const next = (await withCanvasLock(root, async () => {
    let refRemoved = false;
    try {
      await ctx.run('badge.removeRef', { file: args.from, to: args.to });
      refRemoved = true;
    } catch {
      /* source badge already gone — still remove the visual edge */
    }
    try {
      return await patchCanvas(ctx.fs, root, args.folder, (current) => {
        if (!current) return null;
        const edges = removeEdge(current.edges, args.from, args.to);
        const updated: CanvasFile = { ...current, edges };
        return isEmptyCanvas(updated) ? null : updated;
      });
    } catch (err) {
      if (refRemoved) {
        await ctx.run('badge.addRef', { file: args.from, to: args.to }).catch(() => {});
      }
      throw err;
    }
  })) as CanvasFile | null;
  return next ?? emptyCanvas(canvasRel(args.folder));
};

export const reconnect: Handler<CanvasReconnectArgs, CanvasReconnectResult> = async (args, ctx) => {
  if (args.next.from === args.next.to) {
    throw new Error(`Canvas edge cannot connect a card to itself: ${args.next.from}`);
  }
  validateAnchor(args.next.from_anchor, 'from_anchor');
  validateAnchor(args.next.to_anchor, 'to_anchor');
  const root = requireWorkspaceRoot(ctx);
  const folderRel = canvasRel(args.folder);
  const endpointsChanged =
    args.previous.from !== args.next.from || args.previous.to !== args.next.to;
  const edge = makeEdge(
    args.next.from,
    args.next.to,
    args.next.from_anchor,
    args.next.to_anchor,
    args.next.label,
  );
  // Whole pair under withCanvasLock (see connect). When endpoints change, move the
  // semantic link (add new first so a validation throw aborts before dropping the
  // old), then rewrite the edge; if the canvas write throws, restore the previous
  // ref state so the layers don't drift. An anchor/label-only edit (endpoints
  // unchanged) touches no badge ref at all.
  return (await withCanvasLock(root, async () => {
    // Whether the NEW ref already existed independently — so a canvas-write
    // failure doesn't compensate by removing a ref we didn't create (idempotent
    // addRef again). The previous ref always existed (we're moving an edge off it).
    let nextRefExisted = false;
    if (endpointsChanged) {
      nextRefExisted = await referenceExists(ctx, args.next.from, args.next.to, args.next.kind);
      await ctx.run('badge.addRef', {
        file: args.next.from,
        to: args.next.to,
        ...(args.next.kind !== undefined && { kind: args.next.kind }),
      });
      try {
        await ctx.run('badge.removeRef', { file: args.previous.from, to: args.previous.to });
      } catch {
        /* previous source badge already gone — the new ref is what matters */
      }
    }
    try {
      return await patchCanvas(ctx.fs, root, args.folder, (current) => {
        const base = current ?? emptyCanvas(folderRel);
        const withoutPrev = removeEdge(base.edges, args.previous.from, args.previous.to);
        return { ...base, edges: upsertEdge(withoutPrev, edge) };
      });
    } catch (err) {
      if (endpointsChanged) {
        await ctx
          .run('badge.addRef', { file: args.previous.from, to: args.previous.to })
          .catch(() => {});
        if (!nextRefExisted) {
          await ctx
            .run('badge.removeRef', { file: args.next.from, to: args.next.to })
            .catch(() => {});
        }
      }
      throw err;
    }
  })) as CanvasFile;
};

/** Cheap canvas-store signature (count + newest mtime) for an external-edit poll. */
export const revision: Handler<{ _?: never }, { count: number; maxMtimeMs: number }> = async (
  _args,
  ctx,
) => {
  const root = requireWorkspaceRoot(ctx);
  return canvasRevision(ctx.fs, root);
};

/**
 * RENAME CASCADE: a node moved `from` → `to`. Carry the visual layer:
 *  - the node's OWN canvas.yaml subtree (a folder's child layout) re-roots to the
 *    new location, with every card path + edge endpoint inside the subtree swapped
 *    `from` → `to`;
 *  - the PARENT folder's canvas card for this node is renamed in place (geometry
 *    kept) when the parent is unchanged, or pulled out and dropped (bare, for
 *    auto-layout) into the new parent on a cross-folder move.
 * Called by badge.rename. The badge reference graph (and thus the DERIVED edges in
 * listCanvas) is moved separately by badge.rename — this only carries the stored
 * card geometry + anchor/label styling that would otherwise go stale.
 */
export const relocate: Handler<CanvasRelocateArgs, CanvasRelocateResult> = async (args, ctx) => {
  const root = requireWorkspaceRoot(ctx);
  const { from, to } = args;
  const swap = (p: string): string => (isMirrorSubtree(p, from) ? remapSubtreeRel(p, from, to) : p);
  return withCanvasLock(root, async () => {
    // The node's own subtree canvas.yaml files (folders only; a file has none).
    const moved = await relocateMirrorKind<CanvasFile>(
      ctx.fs,
      root,
      'canvas',
      from,
      to,
      (data) => ({
        ...data,
        path: remapSubtreeRel(data.path, from, to),
        cards: data.cards.map((c) => ({ ...c, path: swap(c.path) })),
        edges: data.edges.map((e) => ({ ...e, from: swap(e.from), to: swap(e.to) })),
      }),
    );

    // The parent folder's card for this node.
    const oldParent = parentRel(from);
    const newParent = parentRel(to);
    if (oldParent === newParent) {
      await patchCanvas(ctx.fs, root, oldParent, (cur) => {
        if (!cur) return null;
        const cards = cur.cards.map((c) => (c.path === from ? { ...c, path: to } : c));
        const edges = cur.edges.map((e) => ({
          ...e,
          from: e.from === from ? to : e.from,
          to: e.to === from ? to : e.to,
        }));
        const next: CanvasFile = { ...cur, cards, edges };
        return isEmptyCanvas(next) ? null : next;
      });
    } else {
      let carried: CanvasCard | undefined;
      await patchCanvas(ctx.fs, root, oldParent, (cur) => {
        if (!cur) return null;
        carried = cur.cards.find((c) => c.path === from);
        const cards = cur.cards.filter((c) => c.path !== from);
        // Cross-folder move breaks any in-parent edge to this node — its siblings changed.
        const edges = cur.edges.filter((e) => e.from !== from && e.to !== from);
        const next: CanvasFile = { ...cur, cards, edges };
        return isEmptyCanvas(next) ? null : next;
      });
      if (carried) {
        const placed: CanvasCard = { ...carried, path: to };
        await patchCanvas(ctx.fs, root, newParent, (cur) => {
          const base = cur ?? emptyCanvas(canvasRel(newParent));
          return { ...base, cards: upsertCard(base.cards, placed) };
        });
      }
    }
    return { moved: moved.length };
  });
};

/**
 * DELETE CASCADE: a node was deleted. Drop the visual layer:
 *  - remove the node's own canvas.yaml subtree;
 *  - remove the parent folder's card for it + any edges touching it.
 * The derived reference edges fall away with the badges (purgeBadgesForDelete).
 */
export const purgeNode: Handler<CanvasPurgeNodeArgs, CanvasPurgeNodeResult> = async (args, ctx) => {
  const root = requireWorkspaceRoot(ctx);
  const { path } = args;
  return withCanvasLock(root, async () => {
    const removed = await purgeMirrorKind(ctx.fs, root, 'canvas', path);
    await patchCanvas(ctx.fs, root, parentRel(path), (cur) => {
      if (!cur) return null;
      const cards = cur.cards.filter((c) => c.path !== path);
      const edges = cur.edges.filter((e) => e.from !== path && e.to !== path);
      const next: CanvasFile = { ...cur, cards, edges };
      return isEmptyCanvas(next) ? null : next;
    });
    return { removed };
  });
};

export function commands(): ReadonlyArray<
  readonly [name: string, handler: Handler<never, unknown>]
> {
  return [
    ['canvas.get', get as unknown as Handler<never, unknown>],
    ['canvas.setCard', setCard as unknown as Handler<never, unknown>],
    ['canvas.removeCard', removeCard as unknown as Handler<never, unknown>],
    ['canvas.setSize', setSize as unknown as Handler<never, unknown>],
    ['canvas.connect', connect as unknown as Handler<never, unknown>],
    ['canvas.disconnect', disconnect as unknown as Handler<never, unknown>],
    ['canvas.reconnect', reconnect as unknown as Handler<never, unknown>],
    ['canvas.revision', revision as unknown as Handler<never, unknown>],
    ['canvas.relocate', relocate as unknown as Handler<never, unknown>],
    ['canvas.purgeNode', purgeNode as unknown as Handler<never, unknown>],
  ];
}
