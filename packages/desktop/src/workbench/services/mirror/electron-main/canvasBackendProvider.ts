import type {
  BadgeAddRefArgs,
  BadgeFile,
  BadgeGetArgs,
  BadgeGetResult,
  BadgeRemoveRefArgs,
} from '../common/badge.js';
import type {
  CanvasAnchor,
  CanvasConnectArgs,
  CanvasDisconnectArgs,
  CanvasFile,
  CanvasGetArgs,
  CanvasGetResult,
  CanvasPurgeNodeArgs,
  CanvasPurgeNodeResult,
  CanvasReconnectArgs,
  CanvasRelocateArgs,
  CanvasRelocateResult,
  CanvasRemoveCardArgs,
  CanvasRemoveCardResult,
  CanvasRevisionResult,
  CanvasSetCardArgs,
  CanvasSetSizeArgs,
} from '../common/canvas.js';
import { MirrorCorrupt, YamlMirrorStore, createKeyedMutex } from './yamlMirrorStore.js';

export interface CanvasBackendProvider {
  get(workspaceRoot: string | null, args: CanvasGetArgs): Promise<CanvasGetResult>;
  setCard(workspaceRoot: string | null, args: CanvasSetCardArgs): Promise<CanvasFile>;
  removeCard(
    workspaceRoot: string | null,
    args: CanvasRemoveCardArgs,
  ): Promise<CanvasRemoveCardResult>;
  setSize(workspaceRoot: string | null, args: CanvasSetSizeArgs): Promise<CanvasFile>;
  connect(workspaceRoot: string | null, args: CanvasConnectArgs): Promise<CanvasFile>;
  disconnect(workspaceRoot: string | null, args: CanvasDisconnectArgs): Promise<CanvasFile>;
  reconnect(workspaceRoot: string | null, args: CanvasReconnectArgs): Promise<CanvasFile>;
  revision(workspaceRoot: string | null): Promise<CanvasRevisionResult>;
  relocate(workspaceRoot: string | null, args: CanvasRelocateArgs): Promise<CanvasRelocateResult>;
  purgeNode(
    workspaceRoot: string | null,
    args: CanvasPurgeNodeArgs,
  ): Promise<CanvasPurgeNodeResult>;
}

export interface CanvasBadgeBridge {
  get(workspaceRoot: string | null, args: BadgeGetArgs): Promise<BadgeGetResult>;
  addRef(workspaceRoot: string | null, args: BadgeAddRefArgs): Promise<BadgeFile>;
  removeRef(workspaceRoot: string | null, args: BadgeRemoveRefArgs): Promise<BadgeFile>;
}

export interface CanvasYamlBackendProviderOptions {
  readonly store?: YamlMirrorStore;
  readonly badges?: CanvasBadgeBridge;
}

export class CanvasCorrupt extends Error {
  readonly code = 'CANVAS_CORRUPT';
  override readonly name = 'CanvasCorrupt';

  constructor(
    public readonly folder: string,
    opts?: { cause?: unknown },
  ) {
    super(`Canvas corrupt: ${folder || '<root>'}`, opts);
  }
}

const CANVAS_ANCHORS: readonly CanvasAnchor[] = ['north', 'east', 'south', 'west'];
const DEFAULT_STORE = new YamlMirrorStore();
const withCanvasLock = createKeyedMutex();

/**
 * Desktop-native canvas backend for `<workspace>/.bh/mirror/<folder>/canvas.yaml`.
 * Visual edges stay in lockstep with badge references through a narrow bridge,
 * matching VS Code's service/provider style instead of routing workbench state
 * through a generic command dispatcher.
 */
export class CanvasYamlBackendProvider implements CanvasBackendProvider {
  private readonly store: YamlMirrorStore;
  private readonly badges: CanvasBadgeBridge | undefined;

  constructor(opts: CanvasYamlBackendProviderOptions = {}) {
    this.store = opts.store ?? DEFAULT_STORE;
    this.badges = opts.badges;
  }

  async get(workspaceRoot: string | null, args: CanvasGetArgs): Promise<CanvasGetResult> {
    const root = requireWorkspaceRoot(workspaceRoot);
    return this.read(root, args.folder);
  }

  async setCard(workspaceRoot: string | null, args: CanvasSetCardArgs): Promise<CanvasFile> {
    const root = requireWorkspaceRoot(workspaceRoot);
    const folderRel = canvasRel(args.folder);
    const next = await withCanvasLock(root, () =>
      this.patch(root, args.folder, (current) => {
        const base = current ?? emptyCanvas(folderRel);
        return { ...base, cards: upsertCard(base.cards, args.card) };
      }),
    );
    return next as CanvasFile;
  }

  async removeCard(
    workspaceRoot: string | null,
    args: CanvasRemoveCardArgs,
  ): Promise<CanvasRemoveCardResult> {
    const root = requireWorkspaceRoot(workspaceRoot);
    let removed = false;
    await withCanvasLock(root, () =>
      this.patch(root, args.folder, (current) => {
        if (!current) return null;
        const cards = current.cards.filter((card) => card.path !== args.path);
        removed = cards.length !== current.cards.length;
        const next: CanvasFile = { ...current, cards };
        return isEmptyCanvas(next) ? null : next;
      }),
    );
    return { removed };
  }

  async setSize(workspaceRoot: string | null, args: CanvasSetSizeArgs): Promise<CanvasFile> {
    const root = requireWorkspaceRoot(workspaceRoot);
    const folderRel = canvasRel(args.folder);
    const next = await withCanvasLock(root, () =>
      this.patch(root, args.folder, (current) => {
        const base = current ?? emptyCanvas(folderRel);
        return { ...base, size: args.size };
      }),
    );
    return next as CanvasFile;
  }

  async connect(workspaceRoot: string | null, args: CanvasConnectArgs): Promise<CanvasFile> {
    if (args.from === args.to) {
      throw new Error(`Canvas edge cannot connect a card to itself: ${args.from}`);
    }
    validateAnchor(args.from_anchor, 'from_anchor');
    validateAnchor(args.to_anchor, 'to_anchor');
    const root = requireWorkspaceRoot(workspaceRoot);
    const badges = requireBadgeBridge(this.badges);
    const folderRel = canvasRel(args.folder);
    const edge = makeEdge(args.from, args.to, args.from_anchor, args.to_anchor, args.label);
    const next = await withCanvasLock(root, async () => {
      const refExisted = await referenceExists(badges, root, args.from, args.to, args.kind);
      await badges.addRef(root, {
        file: args.from,
        to: args.to,
        ...(args.kind !== undefined && { kind: args.kind }),
      });
      try {
        return await this.patch(root, args.folder, (current) => {
          const base = current ?? emptyCanvas(folderRel);
          return { ...base, edges: upsertEdge(base.edges, edge) };
        });
      } catch (err) {
        if (!refExisted) {
          await badges.removeRef(root, { file: args.from, to: args.to }).catch(() => {});
        }
        throw err;
      }
    });
    return next as CanvasFile;
  }

  async disconnect(workspaceRoot: string | null, args: CanvasDisconnectArgs): Promise<CanvasFile> {
    const root = requireWorkspaceRoot(workspaceRoot);
    const badges = requireBadgeBridge(this.badges);
    const next = await withCanvasLock(root, async () => {
      let refRemoved = false;
      try {
        await badges.removeRef(root, { file: args.from, to: args.to });
        refRemoved = true;
      } catch {
        // The visual edge can outlive an externally removed source badge.
      }
      try {
        return await this.patch(root, args.folder, (current) => {
          if (!current) return null;
          const edges = removeEdge(current.edges, args.from, args.to);
          const updated: CanvasFile = { ...current, edges };
          return isEmptyCanvas(updated) ? null : updated;
        });
      } catch (err) {
        if (refRemoved) {
          await badges.addRef(root, { file: args.from, to: args.to }).catch(() => {});
        }
        throw err;
      }
    });
    return next ?? emptyCanvas(canvasRel(args.folder));
  }

  async reconnect(workspaceRoot: string | null, args: CanvasReconnectArgs): Promise<CanvasFile> {
    if (args.next.from === args.next.to) {
      throw new Error(`Canvas edge cannot connect a card to itself: ${args.next.from}`);
    }
    validateAnchor(args.next.from_anchor, 'from_anchor');
    validateAnchor(args.next.to_anchor, 'to_anchor');
    const root = requireWorkspaceRoot(workspaceRoot);
    const badges = requireBadgeBridge(this.badges);
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
    const next = await withCanvasLock(root, async () => {
      let nextRefExisted = false;
      if (endpointsChanged) {
        nextRefExisted = await referenceExists(
          badges,
          root,
          args.next.from,
          args.next.to,
          args.next.kind,
        );
        await badges.addRef(root, {
          file: args.next.from,
          to: args.next.to,
          ...(args.next.kind !== undefined && { kind: args.next.kind }),
        });
        await badges
          .removeRef(root, { file: args.previous.from, to: args.previous.to })
          .catch(() => {});
      }
      try {
        return await this.patch(root, args.folder, (current) => {
          const base = current ?? emptyCanvas(folderRel);
          const withoutPrevious = removeEdge(base.edges, args.previous.from, args.previous.to);
          return { ...base, edges: upsertEdge(withoutPrevious, edge) };
        });
      } catch (err) {
        if (endpointsChanged) {
          await badges
            .addRef(root, { file: args.previous.from, to: args.previous.to })
            .catch(() => {});
          if (!nextRefExisted) {
            await badges
              .removeRef(root, { file: args.next.from, to: args.next.to })
              .catch(() => {});
          }
        }
        throw err;
      }
    });
    return next as CanvasFile;
  }

  async revision(workspaceRoot: string | null): Promise<CanvasRevisionResult> {
    const root = requireWorkspaceRoot(workspaceRoot);
    return this.store.revision(root, 'canvas');
  }

  async relocate(
    workspaceRoot: string | null,
    args: CanvasRelocateArgs,
  ): Promise<CanvasRelocateResult> {
    const root = requireWorkspaceRoot(workspaceRoot);
    const { from, to } = args;
    const swap = (path: string): string =>
      isMirrorSubtree(path, from) ? remapSubtreeRel(path, from, to) : path;
    return withCanvasLock(root, async () => {
      const moved = await this.store.relocateKind<CanvasFile>(root, 'canvas', from, to, (data) => ({
        ...data,
        path: remapSubtreeRel(data.path, from, to),
        cards: data.cards.map((card) => ({ ...card, path: swap(card.path) })),
        edges: data.edges.map((edge) => ({
          ...edge,
          from: swap(edge.from),
          to: swap(edge.to),
        })),
      }));

      const oldParent = parentRel(from);
      const newParent = parentRel(to);
      if (oldParent === newParent) {
        await this.patch(root, oldParent, (current) => {
          if (!current) return null;
          const cards = current.cards.map((card) =>
            card.path === from ? { ...card, path: to } : card,
          );
          const edges = current.edges.map((edge) => ({
            ...edge,
            from: edge.from === from ? to : edge.from,
            to: edge.to === from ? to : edge.to,
          }));
          const next: CanvasFile = { ...current, cards, edges };
          return isEmptyCanvas(next) ? null : next;
        });
      } else {
        let carried: CanvasFile['cards'][number] | undefined;
        await this.patch(root, oldParent, (current) => {
          if (!current) return null;
          carried = current.cards.find((card) => card.path === from);
          const cards = current.cards.filter((card) => card.path !== from);
          const edges = current.edges.filter((edge) => edge.from !== from && edge.to !== from);
          const next: CanvasFile = { ...current, cards, edges };
          return isEmptyCanvas(next) ? null : next;
        });
        if (carried) {
          const placed = { ...carried, path: to };
          await this.patch(root, newParent, (current) => {
            const base = current ?? emptyCanvas(canvasRel(newParent));
            return { ...base, cards: upsertCard(base.cards, placed) };
          });
        }
      }
      return { moved: moved.length };
    });
  }

  async purgeNode(
    workspaceRoot: string | null,
    args: CanvasPurgeNodeArgs,
  ): Promise<CanvasPurgeNodeResult> {
    const root = requireWorkspaceRoot(workspaceRoot);
    return withCanvasLock(root, async () => {
      const removed = await this.store.purgeKind(root, 'canvas', args.path);
      await this.patch(root, parentRel(args.path), (current) => {
        if (!current) return null;
        const cards = current.cards.filter((card) => card.path !== args.path);
        const edges = current.edges.filter(
          (edge) => edge.from !== args.path && edge.to !== args.path,
        );
        const next: CanvasFile = { ...current, cards, edges };
        return isEmptyCanvas(next) ? null : next;
      });
      return { removed };
    });
  }

  private async read(root: string, folder: string | null): Promise<CanvasFile | null> {
    try {
      return await this.store.read<CanvasFile>(root, canvasRel(folder), 'canvas');
    } catch (cause) {
      if (cause instanceof MirrorCorrupt) {
        throw new CanvasCorrupt(canvasRel(folder), { cause });
      }
      throw cause;
    }
  }

  private async patch(
    root: string,
    folder: string | null,
    patch: (current: CanvasFile | null) => CanvasFile | null,
  ): Promise<CanvasFile | null> {
    try {
      return await this.store.patch<CanvasFile>(root, canvasRel(folder), 'canvas', patch);
    } catch (cause) {
      if (cause instanceof MirrorCorrupt) {
        throw new CanvasCorrupt(canvasRel(folder), { cause });
      }
      throw cause;
    }
  }
}

function requireWorkspaceRoot(workspaceRoot: string | null): string {
  if (workspaceRoot === null) {
    throw new Error('No workspace bound. Register/use a workspace first.');
  }
  return workspaceRoot;
}

function requireBadgeBridge(badges: CanvasBadgeBridge | undefined): CanvasBadgeBridge {
  if (badges === undefined) {
    throw new Error('Canvas edge operations require a badge bridge.');
  }
  return badges;
}

function canvasRel(folder: string | null | undefined): string {
  return folder == null ? '' : folder;
}

function parentRel(rel: string): string {
  const index = rel.lastIndexOf('/');
  return index === -1 ? '' : rel.slice(0, index);
}

function emptyCanvas(folderRel: string): CanvasFile {
  return { path: folderRel, cards: [], edges: [] };
}

function isEmptyCanvas(canvas: CanvasFile): boolean {
  return canvas.cards.length === 0 && canvas.edges.length === 0 && canvas.size === undefined;
}

function upsertCard(
  cards: readonly CanvasFile['cards'][number][],
  card: CanvasFile['cards'][number],
): CanvasFile['cards'][number][] {
  return [...cards.filter((current) => current.path !== card.path), card];
}

function upsertEdge(
  edges: readonly CanvasFile['edges'][number][],
  edge: CanvasFile['edges'][number],
): CanvasFile['edges'][number][] {
  return [
    ...edges.filter((current) => !(current.from === edge.from && current.to === edge.to)),
    edge,
  ];
}

function removeEdge(
  edges: readonly CanvasFile['edges'][number][],
  from: string,
  to: string,
): CanvasFile['edges'][number][] {
  return edges.filter((edge) => !(edge.from === from && edge.to === to));
}

function validateAnchor(anchor: unknown, field: string): asserts anchor is CanvasAnchor {
  if (typeof anchor !== 'string' || !CANVAS_ANCHORS.includes(anchor as CanvasAnchor)) {
    throw new Error(`${field} must be one of ${CANVAS_ANCHORS.join(', ')}`);
  }
}

function makeEdge(
  from: string,
  to: string,
  fromAnchor: CanvasAnchor,
  toAnchor: CanvasAnchor,
  label: string | undefined,
): CanvasFile['edges'][number] {
  const trimmed = label?.trim();
  return {
    from,
    from_anchor: fromAnchor,
    to,
    to_anchor: toAnchor,
    ...(trimmed !== undefined && trimmed !== '' && { label: trimmed }),
  };
}

async function referenceExists(
  badges: CanvasBadgeBridge,
  workspaceRoot: string,
  from: string,
  to: string,
  kind: 'file' | 'folder' | undefined,
): Promise<boolean> {
  const badge = await badges.get(workspaceRoot, {
    file: from,
    ...(kind !== undefined && { kind }),
  });
  return badge?.references?.includes(to) ?? false;
}

function isMirrorSubtree(rel: string, root: string): boolean {
  return rel === root || rel.startsWith(`${root}/`);
}

function remapSubtreeRel(rel: string, from: string, to: string): string {
  return rel === from ? to : `${to}${rel.slice(from.length)}`;
}
