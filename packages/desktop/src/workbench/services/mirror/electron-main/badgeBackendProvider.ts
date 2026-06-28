import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { AdhdRelocateArgs, AdhdRelocateResult } from '../common/adhd.js';
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
  BadgePruneDanglingResult,
  BadgeRemoveRefArgs,
  BadgeRenameArgs,
  BadgeRenameResult,
  BadgeRevisionResult,
  BadgeSetArgs,
} from '../common/badge.js';
import type { CanvasRelocateArgs, CanvasRelocateResult } from '../common/canvas.js';
import type { FocusRelocateArgs, FocusRelocateResult } from '../common/focus.js';
import {
  MirrorCorrupt,
  YamlMirrorStore,
  assertReadContained,
  createKeyedMutex,
} from './yamlMirrorStore.js';

export interface BadgeBackendProvider {
  get(workspaceRoot: string | null, args: BadgeGetArgs): Promise<BadgeGetResult>;
  set(workspaceRoot: string | null, args: BadgeSetArgs): Promise<BadgeFile>;
  list(workspaceRoot: string | null, args?: BadgeListArgs): Promise<BadgeListResult>;
  delete(workspaceRoot: string | null, args: BadgeDeleteArgs): Promise<BadgeDeleteResult>;
  addRef(workspaceRoot: string | null, args: BadgeAddRefArgs): Promise<BadgeFile>;
  removeRef(workspaceRoot: string | null, args: BadgeRemoveRefArgs): Promise<BadgeFile>;
  markOrphan(
    workspaceRoot: string | null,
    args: BadgeMarkOrphanArgs,
  ): Promise<BadgeMarkOrphanResult>;
  pruneDangling(workspaceRoot: string | null): Promise<BadgePruneDanglingResult>;
  revision(workspaceRoot: string | null): Promise<BadgeRevisionResult>;
  rename(workspaceRoot: string | null, args: BadgeRenameArgs): Promise<BadgeRenameResult>;
}

export interface BadgeRenameCascadeBridge {
  readonly relocateCanvas?: (
    workspaceRoot: string,
    args: CanvasRelocateArgs,
  ) => Promise<CanvasRelocateResult>;
  readonly relocateAdhd?: (
    workspaceRoot: string,
    args: AdhdRelocateArgs,
  ) => Promise<AdhdRelocateResult>;
  readonly relocateFocus?: (
    workspaceRoot: string,
    args: FocusRelocateArgs,
  ) => Promise<FocusRelocateResult>;
}

export interface BadgeYamlBackendProviderOptions {
  readonly store?: YamlMirrorStore;
  readonly cascade?: BadgeRenameCascadeBridge;
}

export class BadgeCorrupt extends Error {
  readonly code = 'BADGE_CORRUPT';
  override readonly name = 'BadgeCorrupt';

  constructor(
    public readonly file: string,
    opts?: { cause?: unknown },
  ) {
    super(`Badge corrupt: ${file}`, opts);
  }
}

const DEFAULT_STORE = new YamlMirrorStore();
const withBadgeLock = createKeyedMutex();

/**
 * Desktop-native badge backend for `<workspace>/.bh/mirror/<path>/badge.yaml`.
 * It owns the semantic reference graph and receives narrow rename-cascade hooks
 * for visual/editor mirror state, matching VS Code's service wiring rather than
 * routing workbench state through a generic command dispatcher.
 */
export class BadgeYamlBackendProvider implements BadgeBackendProvider {
  private readonly store: YamlMirrorStore;
  private readonly cascade: BadgeRenameCascadeBridge;

  constructor(opts: BadgeYamlBackendProviderOptions = {}) {
    this.store = opts.store ?? DEFAULT_STORE;
    this.cascade = opts.cascade ?? {};
  }

  async get(workspaceRoot: string | null, args: BadgeGetArgs): Promise<BadgeGetResult> {
    const root = requireWorkspaceRoot(workspaceRoot);
    return this.readBadge(root, args.file);
  }

  async set(workspaceRoot: string | null, args: BadgeSetArgs): Promise<BadgeFile> {
    const root = requireWorkspaceRoot(workspaceRoot);
    const kind: BadgeKind = args.patch?.kind ?? 'file';
    const patch = args.patch ?? {};
    const next = await withBadgeLock(root, () =>
      this.patchBadge(root, args.file, (existing) => {
        if (existing) {
          const nextDescription =
            patch.description !== undefined ? patch.description : existing.description;
          return {
            path: existing.path,
            kind: existing.kind,
            ...(nextDescription !== undefined &&
              nextDescription !== '' && { description: nextDescription }),
            references: existing.references,
            ...(existing.referenced_by !== undefined &&
              existing.referenced_by.length > 0 && { referenced_by: existing.referenced_by }),
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
    );
    return next as BadgeFile;
  }

  async list(workspaceRoot: string | null, args: BadgeListArgs = {}): Promise<BadgeListResult> {
    const root = requireWorkspaceRoot(workspaceRoot);
    let badges = await this.listBadges(root);
    if (args.kind !== undefined) {
      badges = badges.filter((badge) => badge.kind === args.kind);
    }
    if (args.query !== undefined && args.query !== '') {
      const query = args.query.toLowerCase();
      badges = badges.filter(
        (badge) =>
          badge.path.toLowerCase().includes(query) ||
          (badge.description ?? '').toLowerCase().includes(query),
      );
    }
    return { badges };
  }

  async delete(workspaceRoot: string | null, args: BadgeDeleteArgs): Promise<BadgeDeleteResult> {
    const root = requireWorkspaceRoot(workspaceRoot);
    const deleted = await withBadgeLock(root, async () => {
      const existing = await this.readBadge(root, args.file);
      const removed = await this.removeBadge(root, args.file);
      if (existing) {
        for (const target of existing.references) {
          await this.removeBacklinkFrom(root, target, args.file);
        }
      }
      return removed;
    });
    return { deleted };
  }

  async addRef(workspaceRoot: string | null, args: BadgeAddRefArgs): Promise<BadgeFile> {
    if (args.to === args.file) {
      throw new Error(`Badge cannot reference itself: ${args.file}`);
    }
    const root = requireWorkspaceRoot(workspaceRoot);
    const kind = args.kind ?? 'file';
    return withBadgeLock(root, async () => {
      const merged = (await this.patchBadge(root, args.file, (existing) => {
        const base = existing ?? newBadge(args.file, kind);
        const without = base.references.filter((ref) => ref !== args.to);
        return { ...base, references: [...without, args.to] };
      })) as BadgeFile;
      await this.addBacklinkTo(root, args.to, args.file);
      return merged;
    });
  }

  async removeRef(workspaceRoot: string | null, args: BadgeRemoveRefArgs): Promise<BadgeFile> {
    const root = requireWorkspaceRoot(workspaceRoot);
    return withBadgeLock(root, async () => {
      const merged = (await this.patchBadge(root, args.file, (existing) => {
        if (!existing) throw new Error(`Badge not found: ${args.file}`);
        return { ...existing, references: existing.references.filter((ref) => ref !== args.to) };
      })) as BadgeFile;
      await this.removeBacklinkFrom(root, args.to, args.file);
      return merged;
    });
  }

  async markOrphan(
    workspaceRoot: string | null,
    args: BadgeMarkOrphanArgs,
  ): Promise<BadgeMarkOrphanResult> {
    const root = requireWorkspaceRoot(workspaceRoot);
    return withBadgeLock(root, () =>
      this.patchBadge(root, args.file, (existing) =>
        existing === null ? null : { ...existing, orphan: true },
      ),
    );
  }

  async pruneDangling(workspaceRoot: string | null): Promise<BadgePruneDanglingResult> {
    const root = requireWorkspaceRoot(workspaceRoot);
    const badges = await this.listBadges(root);
    const orphaned: string[] = [];
    for (const badge of badges) {
      if (badge.orphan === true) continue;
      if (await badgeTargetExists(root, badge.path, badge.kind)) continue;
      try {
        const result = await this.markOrphan(root, { file: badge.path, kind: badge.kind });
        if (result !== null) orphaned.push(badge.path);
      } catch {
        // Best effort: a single stale/corrupt badge must not fail the sweep.
      }
    }
    return { orphaned };
  }

  async revision(workspaceRoot: string | null): Promise<BadgeRevisionResult> {
    const root = requireWorkspaceRoot(workspaceRoot);
    return this.store.revision(root, 'badge');
  }

  async rename(workspaceRoot: string | null, args: BadgeRenameArgs): Promise<BadgeRenameResult> {
    const root = requireWorkspaceRoot(workspaceRoot);
    const kind: BadgeKind = args.kind ?? 'file';
    if (args.from === args.to) {
      throw new Error(`badge.rename: from and to are the same (${args.from})`);
    }

    const { moved, updatedRefs } = await this.moveBadgeAndCascadeRefs(root, args.from, args.to);
    if (moved === null && !args.ifExists) {
      throw new Error(`badge.rename: no badge at ${args.from}`);
    }

    if (kind === 'folder') {
      const prefix = `${args.from}/`;
      const descendants = (await this.listBadges(root)).filter((badge) =>
        badge.path.startsWith(prefix),
      );
      for (const child of descendants) {
        const childTo = `${args.to}/${child.path.slice(prefix.length)}`;
        const result = await this.moveBadgeAndCascadeRefs(root, child.path, childTo);
        updatedRefs.push(...result.updatedRefs);
      }
    }

    await this.cascadeRename('canvas.relocate', () =>
      this.cascade.relocateCanvas?.(root, { from: args.from, to: args.to, kind }),
    );
    await this.cascadeRename('adhd.relocate', () =>
      this.cascade.relocateAdhd?.(root, { from: args.from, to: args.to }),
    );
    const focusResult = await this.cascadeRename('focus.relocate', () =>
      this.cascade.relocateFocus?.(root, { from: args.from, to: args.to }),
    );

    return { badge: moved, updatedRefs, focusUpdated: focusResult?.repointed ?? false };
  }

  private async moveBadgeAndCascadeRefs(
    root: string,
    from: string,
    to: string,
  ): Promise<{ moved: BadgeFile | null; updatedRefs: string[] }> {
    return withBadgeLock(root, async () => {
      const source = await this.readBadge(root, from);
      if (!source) return { moved: null, updatedRefs: [] };
      const collision = await this.readBadge(root, to);
      if (collision) {
        throw new Error(`badge.rename: badge already exists at ${to}`);
      }

      const { orphan: _orphan, ...rest } = source;
      const copy: BadgeFile = { ...rest, path: to };
      await this.writeBadge(root, copy);
      await this.removeBadge(root, from);

      for (const target of source.references) {
        await this.patchBadge(root, target, (targetBadge) => {
          if (!targetBadge) return null;
          const links = (targetBadge.referenced_by ?? []).map((backlink) =>
            backlink === from ? to : backlink,
          );
          return { ...targetBadge, referenced_by: links };
        });
      }

      const updatedRefs: string[] = [];
      for (const referrerPath of source.referenced_by ?? []) {
        const rewritten = await this.patchBadge(root, referrerPath, (referrer) => {
          if (!referrer) return null;
          return {
            ...referrer,
            references: referrer.references.map((ref) => (ref === from ? to : ref)),
          };
        });
        if (rewritten !== null) updatedRefs.push(referrerPath);
      }

      const liveSet = new Set(updatedRefs);
      const allBacklinks = copy.referenced_by ?? [];
      const liveBacklinks = allBacklinks.filter((backlink) => liveSet.has(backlink));
      let moved: BadgeFile = copy;
      if (liveBacklinks.length !== allBacklinks.length) {
        const { referenced_by: _drop, ...restCopy } = copy;
        moved =
          liveBacklinks.length > 0
            ? { ...restCopy, referenced_by: liveBacklinks }
            : { ...restCopy };
        await this.writeBadge(root, moved);
      }
      return { moved, updatedRefs };
    });
  }

  private async cascadeRename(
    label: string,
    op: () => Promise<FocusRelocateResult | CanvasRelocateResult | AdhdRelocateResult> | undefined,
  ): Promise<FocusRelocateResult | undefined> {
    try {
      const pending = op();
      const result = pending === undefined ? undefined : await pending;
      return isFocusRelocateResult(result) ? result : undefined;
    } catch (err) {
      console.warn(`[bh] rename cascade ${label} failed:`, err);
      return undefined;
    }
  }

  private async addBacklinkTo(root: string, target: string, from: string): Promise<void> {
    await this.patchBadge(root, target, (current) => {
      const base = current ?? newBadge(target, 'file');
      const links = (base.referenced_by ?? []).filter((backlink) => backlink !== from);
      links.push(from);
      return { ...base, referenced_by: links };
    });
  }

  private async removeBacklinkFrom(root: string, target: string, from: string): Promise<void> {
    await this.patchBadge(root, target, (current) => {
      if (!current) return null;
      const links = (current.referenced_by ?? []).filter((backlink) => backlink !== from);
      const { referenced_by: _dropped, ...rest } = current;
      const nextBadge: BadgeFile = links.length > 0 ? { ...rest, referenced_by: links } : rest;
      return isEmptyBadge(nextBadge) ? null : nextBadge;
    });
  }

  private async readBadge(root: string, file: string): Promise<BadgeFile | null> {
    try {
      return await this.store.read<BadgeFile>(root, file, 'badge');
    } catch (cause) {
      if (cause instanceof MirrorCorrupt) throw new BadgeCorrupt(file, { cause });
      throw cause;
    }
  }

  private async writeBadge(root: string, badge: BadgeFile): Promise<void> {
    await this.store.write(root, badge.path, 'badge', badge);
  }

  private async patchBadge(
    root: string,
    file: string,
    patch: (current: BadgeFile | null) => BadgeFile | null,
  ): Promise<BadgeFile | null> {
    try {
      return await this.store.patch<BadgeFile>(root, file, 'badge', patch);
    } catch (cause) {
      if (cause instanceof MirrorCorrupt) throw new BadgeCorrupt(file, { cause });
      throw cause;
    }
  }

  private async removeBadge(root: string, file: string): Promise<boolean> {
    return this.store.remove(root, file, 'badge');
  }

  private async listBadges(root: string): Promise<BadgeFile[]> {
    const nodes = await this.store.list<BadgeFile>(root, 'badge');
    return nodes.map((node) => node.data).sort((a, b) => a.path.localeCompare(b.path));
  }
}

function requireWorkspaceRoot(workspaceRoot: string | null): string {
  if (workspaceRoot === null) {
    throw new Error('No workspace bound. Register/use a workspace first.');
  }
  return workspaceRoot;
}

function newBadge(path: string, kind: BadgeKind): BadgeFile {
  return { path, kind, references: [] };
}

function isEmptyBadge(badge: BadgeFile): boolean {
  return (
    badge.description === undefined &&
    badge.references.length === 0 &&
    (badge.referenced_by?.length ?? 0) === 0 &&
    badge.orphan !== true
  );
}

async function badgeTargetExists(root: string, file: string, kind: BadgeKind): Promise<boolean> {
  try {
    const abs = await assertReadContained(root, join(root, file));
    const info = await stat(abs).catch((err: unknown) => {
      if (isENOENT(err)) return null;
      throw err;
    });
    if (info === null) return false;
    return kind === 'folder' ? info.isDirectory() : info.isFile();
  } catch {
    return false;
  }
}

function isFocusRelocateResult(
  result: FocusRelocateResult | CanvasRelocateResult | AdhdRelocateResult | undefined,
): result is FocusRelocateResult {
  return result !== undefined && 'repointed' in result;
}

function isENOENT(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'ENOENT'
  );
}
