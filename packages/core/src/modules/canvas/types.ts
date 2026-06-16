/**
 * Canvas = a FOLDER's visual layer. Per private-docs/focus_mode_spec, each
 * folder owns a `canvas.yaml` at `<workspace>/.bh/mirror/<folder>/canvas.yaml`
 * (the workspace root folder is rel `''`) holding the spatial state the badge
 * graph deliberately does NOT carry:
 *
 *   path: docs
 *   size:
 *     width: 2400
 *     height: 1600
 *   cards:
 *     - path: docs/chapter-01.md
 *       kind: file
 *       x: 120
 *       y: 80
 *       width: 260
 *       height: 140
 *   edges:
 *     - from: docs/chapter-01.md
 *       from_anchor: east
 *       to: docs/chapter-02.md
 *       to_anchor: west
 *       label: "概念延伸"
 *
 * `cards` are the positions/sizes of the folder's DIRECT children (a card with
 * no entry falls back to the renderer's auto-layout — positions are sparse). An
 * `edge` is the VISUAL face of a reference between two siblings: its existence is
 * mirrored by a `badge.references` entry (kept in lockstep by the canvas.connect
 * / disconnect / reconnect commands), while the anchors + label live here only.
 */

/** Compass anchor: which edge-midpoint of a card a connection attaches to. */
export type CanvasAnchor = 'north' | 'east' | 'south' | 'west';

export const CANVAS_ANCHORS: readonly CanvasAnchor[] = ['north', 'east', 'south', 'west'];

export interface CanvasSize {
  readonly width: number;
  readonly height: number;
}

export interface CanvasCard {
  /** Workspace-relative path of the child this card represents. */
  readonly path: string;
  readonly kind: 'file' | 'folder';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CanvasEdge {
  readonly from: string;
  readonly from_anchor: CanvasAnchor;
  readonly to: string;
  readonly to_anchor: CanvasAnchor;
  /** Optional connection label. Absent when blank. */
  readonly label?: string;
}

export interface CanvasFile {
  /** The folder this canvas belongs to (workspace-relative; `''` is the root). */
  readonly path: string;
  /** Overall canvas dimensions, when the user has sized it. */
  readonly size?: CanvasSize;
  readonly cards: readonly CanvasCard[];
  readonly edges: readonly CanvasEdge[];
}

// ── Command args / results ──────────────────────────────────────────────────

/** `folder` is workspace-relative; `null` (or `''`) is the workspace root. */
export interface CanvasGetArgs {
  readonly folder: string | null;
}
export type CanvasGetResult = CanvasFile | null;

export interface CanvasSetCardArgs {
  readonly folder: string | null;
  readonly card: CanvasCard;
}
export type CanvasSetCardResult = CanvasFile;

export interface CanvasRemoveCardArgs {
  readonly folder: string | null;
  readonly path: string;
}
export interface CanvasRemoveCardResult {
  readonly removed: boolean;
}

export interface CanvasSetSizeArgs {
  readonly folder: string | null;
  readonly size: CanvasSize;
}
export type CanvasSetSizeResult = CanvasFile;

/** Draw a connection between two sibling cards: writes the canvas edge AND the
 *  semantic `badge.references` link (source → target) so the agent's
 *  referenced_by graph stays in lockstep with what the user drew. */
export interface CanvasConnectArgs {
  readonly folder: string | null;
  readonly from: string;
  readonly to: string;
  readonly from_anchor: CanvasAnchor;
  readonly to_anchor: CanvasAnchor;
  readonly label?: string;
  /** Kind of the SOURCE node (for materializing its badge). Defaults to 'file'. */
  readonly kind?: 'file' | 'folder';
}
export type CanvasConnectResult = CanvasFile;

/** Remove a connection: drops the canvas edge AND the badge reference. */
export interface CanvasDisconnectArgs {
  readonly folder: string | null;
  readonly from: string;
  readonly to: string;
}
export type CanvasDisconnectResult = CanvasFile;

/** Move/relabel a connection. When the endpoints change, the badge reference is
 *  moved too (removeRef previous + addRef next); when only anchors/label change,
 *  only the canvas edge is rewritten. */
export interface CanvasReconnectArgs {
  readonly folder: string | null;
  readonly previous: { readonly from: string; readonly to: string };
  readonly next: {
    readonly from: string;
    readonly to: string;
    readonly from_anchor: CanvasAnchor;
    readonly to_anchor: CanvasAnchor;
    readonly label?: string;
    readonly kind?: 'file' | 'folder';
  };
}
export type CanvasReconnectResult = CanvasFile;

/**
 * Thrown when a canvas.yaml on disk fails to parse. Re-skinned from the kernel's
 * MirrorCorrupt so canvas callers catch by a name they own.
 */
export class CanvasCorrupt extends Error {
  readonly code = 'CANVAS_CORRUPT';
  readonly folder: string;
  constructor(folder: string, options?: { cause?: unknown }) {
    super(`Canvas corrupt: ${folder || '<root>'}`, options);
    this.name = 'CanvasCorrupt';
    this.folder = folder;
  }
}
