import type { CanvasFolderPreview } from '../../../../../platform/workspaces/common/workspaces.js';
import type { BadgeType } from '../../../../browser/labels/FileGlyph.js';

// A tile reads (and renders) at most this many characters: enough that a taller
// card reveals more real content as you resize it, bounded so a multi-MB file
// neither crosses IPC whole nor blows up the Markdown parse.
export const PREVIEW_CHARS = 8000;

// Cards can shrink all the way down to a title chip (glyph + name). The
// minimums are deliberately small so the size-aware LOD is reachable by resizing.
export const CARD_MIN_WIDTH = 140;
export const CARD_MIN_HEIGHT = 48;
export const DEFAULT_FILE_CARD_WIDTH = 300;
export const DEFAULT_FILE_CARD_HEIGHT = 220;
export const DEFAULT_FOLDER_CARD_WIDTH = 248;
// Tall enough to seat the header + a few contents rows without the user having
// to resize it first.
export const DEFAULT_FOLDER_CARD_HEIGHT = 188;

export interface BadgeNodeData extends Record<string, unknown> {
  label: string;
  kind: 'file' | 'folder';
  orphan?: boolean;
  prompt?: string;
  /** Folder kind only: a peek at the folder's direct contents (see listCanvas). */
  preview?: CanvasFolderPreview;
  /** File kind: how many outbound references carry a human-written note. */
  notedRefs?: number;
  /** Folder kind: annotation coverage of supported files under this folder. */
  coverage?: { annotated: number; total: number };
}

export const splitBadgePath = (label: string): { basename: string; dirname: string } => {
  const lastSlash = label.lastIndexOf('/');
  return {
    basename: lastSlash === -1 ? label : label.slice(lastSlash + 1),
    dirname: lastSlash === -1 ? '' : label.slice(0, lastSlash),
  };
};

export const renameTargetForBadgeBasename = (label: string, name: string): string | null => {
  // Inline rename retitles in place. A typed '/' (or '.'/'..') would turn it into
  // a cross-folder move — surprising here, and it leaves a stale card at the old
  // scope until reload — so reject anything that isn't a plain basename.
  const trimmed = name.trim();
  if (trimmed === '' || trimmed.includes('/') || trimmed === '.' || trimmed === '..') return null;
  const { dirname } = splitBadgePath(label);
  return dirname === '' ? trimmed : `${dirname}/${trimmed}`;
};

export const isPreviewableBadgeType = (type: BadgeType): boolean =>
  type === 'image' || type === 'text' || type === 'code';

export const shouldShowCodeDiffPreview = ({
  previewable,
  type,
  x,
  y,
}: {
  previewable: boolean;
  type: BadgeType;
  x: string | undefined;
  y: string | undefined;
}): boolean => previewable && type === 'code' && x !== undefined && x !== 'U' && y !== 'U';

// Short, uppercased-by-KindChip count for the folder header: "EMPTY" / "1 ITEM"
// / "12 ITEMS". Tells you the size at a glance even when the card is too short.
export const countLabel = (total: number): string =>
  total === 0 ? 'empty' : total === 1 ? '1 item' : `${total} items`;
