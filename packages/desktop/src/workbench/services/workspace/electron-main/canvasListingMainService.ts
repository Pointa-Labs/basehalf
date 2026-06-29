import { join } from 'node:path';
import type { WorkspaceListFilesEntry } from '../../../../platform/files/common/workspaceFiles.js';
import {
  SKIP_NAMES,
  assertWorkspaceRelative,
  isCanvasFile,
  listWorkspaceFiles,
  toPosix,
} from '../../../../platform/files/electron-main/workspaceFileOperations.js';
import type {
  CanvasChildBadge,
  CanvasFolderPreview,
  WorkspaceCanvasEdge,
  WorkspaceListCanvasArgs,
  WorkspaceListCanvasResult,
} from '../../../../platform/workspaces/common/workspaces.js';
import type { BadgeFile } from '../../mirror/common/badge.js';
import type { CanvasEdge, CanvasFile } from '../../mirror/common/canvas.js';

const AGENT_HINT_FILES = new Set(['CLAUDE.md', 'AGENTS.md']);
const FOLDER_PREVIEW_LIMIT = 6;
const CANVAS_CHILD_LIMIT = 300;

export interface CanvasListingMirrorProvider {
  getBadge(
    workspaceRoot: string,
    args: { readonly file: string; readonly kind: 'file' | 'folder' },
  ): Promise<BadgeFile | null>;
  getCanvas(
    workspaceRoot: string,
    args: { readonly folder: string | null },
  ): Promise<CanvasFile | null>;
}

export interface CanvasListingMainServiceOptions {
  readonly mirror: CanvasListingMirrorProvider;
}

/**
 * Workbench data provider for the BaseHalf canvas. This mirrors VS Code's files
 * workbench shape: platform services enumerate files, while the workbench view
 * service composes file entries with view-specific metadata.
 */
export class CanvasListingMainService {
  constructor(private readonly opts: CanvasListingMainServiceOptions) {}

  async listCanvas(
    workspaceRoot: string | null,
    args: WorkspaceListCanvasArgs,
  ): Promise<WorkspaceListCanvasResult> {
    const root = requireWorkspaceRoot(workspaceRoot);
    const folder = args.folder;
    if (folder !== null) assertWorkspaceRelative(folder);
    const absDir = folder === null ? root : join(root, folder);
    const { entries } = await listWorkspaceFiles(root, absDir);

    let canvas: CanvasFile | null = null;
    try {
      canvas = await this.opts.mirror.getCanvas(root, { folder });
    } catch (err) {
      if (!isSkippableMirrorError(err, 'CanvasCorrupt')) throw err;
      console.warn(`[bh] skipping unreadable canvas: ${folder ?? '<root>'}`);
    }
    const cardByPath = new Map((canvas?.cards ?? []).map((card) => [card.path, card]));

    const built: CanvasChildBadge[] = [];
    for (const entry of entries) {
      if (!isCanvasEntry(entry)) continue;
      if (folder === null && entry.type === 'file' && AGENT_HINT_FILES.has(entry.name)) continue;
      const isDir = entry.type === 'dir';
      const rel = folder === null ? entry.name : toPosix(`${folder}/${entry.name}`);
      const kind = isDir ? 'folder' : 'file';
      const preview = isDir ? await this.folderPreview(root, join(absDir, entry.name)) : undefined;
      let badge: BadgeFile | null = null;
      try {
        badge = await this.opts.mirror.getBadge(root, { file: rel, kind });
      } catch (err) {
        if (!isSkippableMirrorError(err, 'BadgeCorrupt')) throw err;
        console.warn(`[bh] skipping unreadable badge for canvas: ${rel}`);
      }
      const card = cardByPath.get(rel);
      built.push({
        path: rel,
        kind,
        ...(badge?.description !== undefined && { description: badge.description }),
        references: badge?.references ?? [],
        referenced_by: badge?.referenced_by ?? [],
        ...(badge?.orphan === true && { orphan: true }),
        ...(card !== undefined && {
          card: { x: card.x, y: card.y, width: card.width, height: card.height },
        }),
        ...(preview !== undefined && { preview }),
      });
    }

    built.sort((a, b) => a.path.localeCompare(b.path));
    const { children, truncated } = capCanvasChildren(built);
    return {
      folder,
      ...(canvas?.size !== undefined && { size: canvas.size }),
      children,
      edges: deriveEdges(children, canvas?.edges ?? []),
      ...(truncated > 0 && { truncated }),
    };
  }

  private async folderPreview(root: string, absChildDir: string): Promise<CanvasFolderPreview> {
    let children: readonly WorkspaceListFilesEntry[];
    try {
      ({ entries: children } = await listWorkspaceFiles(root, absChildDir));
    } catch {
      return { total: 0, items: [] };
    }
    const supported = children.filter(isCanvasEntry);
    return {
      total: supported.length,
      items: supported.slice(0, FOLDER_PREVIEW_LIMIT).map((entry) => ({
        name: entry.name,
        kind: entry.type === 'dir' ? 'folder' : 'file',
      })),
    };
  }
}

function requireWorkspaceRoot(workspaceRoot: string | null): string {
  if (workspaceRoot === null) {
    throw new Error('No workspace bound. Register/use a workspace first.');
  }
  return workspaceRoot;
}

function isCanvasEntry(entry: WorkspaceListFilesEntry): boolean {
  return entry.type === 'dir' ? !SKIP_NAMES.has(entry.name) : isCanvasFile(entry.name);
}

function capCanvasChildren(all: readonly CanvasChildBadge[]): {
  children: CanvasChildBadge[];
  truncated: number;
} {
  if (all.length <= CANVAS_CHILD_LIMIT) return { children: [...all], truncated: 0 };
  const annotated = all.filter(isAnnotatedChild);
  const plain = all.filter((child) => !isAnnotatedChild(child));
  const keepPlain = Math.max(0, CANVAS_CHILD_LIMIT - annotated.length);
  const children = [...annotated, ...plain.slice(0, keepPlain)].sort((a, b) =>
    a.path.localeCompare(b.path),
  );
  return { children, truncated: all.length - children.length };
}

function isAnnotatedChild(child: CanvasChildBadge): boolean {
  return (
    child.description !== undefined ||
    child.references.length > 0 ||
    child.referenced_by.length > 0 ||
    child.card !== undefined ||
    child.orphan === true
  );
}

function deriveEdges(
  children: readonly CanvasChildBadge[],
  styledEdges: readonly CanvasEdge[],
): WorkspaceCanvasEdge[] {
  const childPaths = new Set(children.map((child) => child.path));
  const styleByPair = new Map(
    styledEdges.map((edge) => [JSON.stringify([edge.from, edge.to]), edge]),
  );
  const edges: WorkspaceCanvasEdge[] = [];
  for (const child of children) {
    for (const to of child.references) {
      if (to === child.path) continue;
      if (!childPaths.has(to)) continue;
      const styled = styleByPair.get(JSON.stringify([child.path, to]));
      edges.push(styled ?? { from: child.path, from_anchor: 'east', to, to_anchor: 'west' });
    }
  }
  return edges;
}

function isSkippableMirrorError(err: unknown, corruptName: string): boolean {
  return err instanceof Error && (err.name === corruptName || err.name === 'PathEscape');
}
