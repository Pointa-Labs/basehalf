/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Pure split tree for ONE Agent Area tab's panes: a recursive tree whose every
// LEAF is a PANE (one Agent Area session — TUI agent, extension agent, or
// shell). Each tab owns its own tree; splitting divides a pane in two. Kept
// PURE + deterministic (ids are passed in, never generated here) so it is
// unit-testable and the service owns id minting. Ported from the original
// BaseHalf terminal dock split tree (migration baseline).
//
// dir 'row'    → side-by-side  (a = left,  b = right)  ← "split right" (⌘D)
// dir 'column' → stacked       (a = top,   b = bottom) ← "split down"  (⌘⇧D)

export interface IBaseHalfPaneLeaf {
	readonly type: 'leaf';
	/** The pane id — one Agent Area session. */
	readonly id: string;
}

export interface IBaseHalfPaneSplit {
	readonly type: 'split';
	readonly id: string;
	readonly dir: 'row' | 'column';
	readonly a: BaseHalfPaneNode;
	readonly b: BaseHalfPaneNode;
	/** Fraction [0..1] of the primary axis given to `a`. */
	readonly fraction: number;
}

export type BaseHalfPaneNode = IBaseHalfPaneLeaf | IBaseHalfPaneSplit;

export type BaseHalfSplitDir = 'right' | 'down';
export type BaseHalfFocusDir = 'left' | 'right' | 'up' | 'down';

export function paneLeaf(id: string): IBaseHalfPaneLeaf {
	return { type: 'leaf', id };
}

const FRACTION_MIN = 0.1;
const FRACTION_MAX = 0.9;

function clampFraction(fraction: number): number {
	return Math.max(FRACTION_MIN, Math.min(FRACTION_MAX, fraction));
}

/**
 * Split `leafId` in two: the existing pane keeps side `a`, the new pane
 * (`newId`) takes side `b`. `right` → a row, `down` → a column.
 */
export function splitLeaf(root: BaseHalfPaneNode, leafId: string, dir: BaseHalfSplitDir, newId: string, splitId: string): BaseHalfPaneNode {
	const replace = (node: BaseHalfPaneNode): BaseHalfPaneNode => {
		if (node.type === 'leaf') {
			if (node.id !== leafId) {
				return node;
			}
			return {
				type: 'split',
				id: splitId,
				dir: dir === 'right' ? 'row' : 'column',
				a: node,
				b: paneLeaf(newId),
				fraction: 0.5
			};
		}
		return { ...node, a: replace(node.a), b: replace(node.b) };
	};
	return replace(root);
}

/**
 * Remove `leafId`; the parent split collapses into the sibling subtree.
 * null when the closed leaf was the whole tree.
 */
function removeLeaf(root: BaseHalfPaneNode, leafId: string): BaseHalfPaneNode | null {
	if (root.type === 'leaf') {
		return root.id === leafId ? null : root;
	}
	if (root.a.type === 'leaf' && root.a.id === leafId) {
		return root.b;
	}
	if (root.b.type === 'leaf' && root.b.id === leafId) {
		return root.a;
	}
	const inA = containsLeaf(root.a, leafId);
	if (!inA && !containsLeaf(root.b, leafId)) {
		return root; // not found
	}
	const collapsed = removeLeaf(inA ? root.a : root.b, leafId);
	// `side` has >1 leaf here, so collapse never nulls it.
	if (collapsed === null) {
		return root;
	}
	return inA ? { ...root, a: collapsed } : { ...root, b: collapsed };
}

/**
 * The id to focus after `leafId` closes — the convention: the previous leaf,
 * unless we closed the leftmost (then the next) — computed over the PRE-close
 * in-order leaf list. The result survives the removal (it is never the closed
 * leaf). null if `leafId` is the whole tree.
 */
function focusAfterClose(root: BaseHalfPaneNode, leafId: string): string | null {
	const ids = orderedLeafIds(root);
	if (ids.length <= 1) {
		return null;
	}
	const i = ids.indexOf(leafId);
	if (i < 0) {
		return null;
	}
	return i === 0 ? (ids[1] ?? null) : (ids[i - 1] ?? null);
}

/**
 * Remove `leafId`. The parent split collapses into the sibling subtree.
 * Returns the new root (null if the closed leaf was the whole tree) and the id
 * to focus next — the previous-unless-leftmost-then-next rule.
 */
export function closeLeaf(root: BaseHalfPaneNode, leafId: string): { root: BaseHalfPaneNode | null; focusId: string | null } {
	if (!containsLeaf(root, leafId)) {
		return { root, focusId: null };
	}
	const focusId = focusAfterClose(root, leafId);
	const next = removeLeaf(root, leafId);
	return { root: next, focusId: next ? focusId : null };
}

export function setFraction(root: BaseHalfPaneNode, splitId: string, fraction: number): BaseHalfPaneNode {
	const walk = (node: BaseHalfPaneNode): BaseHalfPaneNode => {
		if (node.type === 'leaf') {
			return node;
		}
		if (node.id === splitId) {
			return { ...node, fraction: clampFraction(fraction) };
		}
		return { ...node, a: walk(node.a), b: walk(node.b) };
	};
	return walk(root);
}

export function findLeaf(root: BaseHalfPaneNode, id: string): IBaseHalfPaneLeaf | null {
	if (root.type === 'leaf') {
		return root.id === id ? root : null;
	}
	return findLeaf(root.a, id) ?? findLeaf(root.b, id);
}

function containsLeaf(root: BaseHalfPaneNode, id: string): boolean {
	return findLeaf(root, id) !== null;
}

export function findSplit(root: BaseHalfPaneNode, id: string): IBaseHalfPaneSplit | null {
	if (root.type === 'leaf') {
		return null;
	}
	if (root.id === id) {
		return root;
	}
	return findSplit(root.a, id) ?? findSplit(root.b, id);
}

export function firstLeaf(root: BaseHalfPaneNode): IBaseHalfPaneLeaf {
	let node = root;
	while (node.type === 'split') {
		node = node.a;
	}
	return node;
}

/** All leaf ids, left-to-right / top-to-bottom in-order — the ⌘[ / ⌘] ring. */
export function orderedLeafIds(root: BaseHalfPaneNode): string[] {
	if (root.type === 'leaf') {
		return [root.id];
	}
	return [...orderedLeafIds(root.a), ...orderedLeafIds(root.b)];
}

/** The next (or previous) leaf in the in-order ring, wrapping around. */
export function ringNeighbor(root: BaseHalfPaneNode, leafId: string, delta: 1 | -1): string {
	const ids = orderedLeafIds(root);
	const i = ids.indexOf(leafId);
	if (i < 0) {
		return leafId;
	}
	return ids[(i + delta + ids.length) % ids.length];
}

export interface IBaseHalfPaneRect {
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
}

/**
 * Normalized [0..1] rectangle for every leaf, derived from split fractions —
 * the basis for geometric directional navigation + resize.
 */
export function leafRects(root: BaseHalfPaneNode): Map<string, IBaseHalfPaneRect> {
	const out = new Map<string, IBaseHalfPaneRect>();
	const walk = (node: BaseHalfPaneNode, r: IBaseHalfPaneRect): void => {
		if (node.type === 'leaf') {
			out.set(node.id, r);
			return;
		}
		if (node.dir === 'row') {
			const wa = r.w * node.fraction;
			walk(node.a, { x: r.x, y: r.y, w: wa, h: r.h });
			walk(node.b, { x: r.x + wa, y: r.y, w: r.w - wa, h: r.h });
		} else {
			const ha = r.h * node.fraction;
			walk(node.a, { x: r.x, y: r.y, w: r.w, h: ha });
			walk(node.b, { x: r.x, y: r.y + ha, w: r.w, h: r.h - ha });
		}
	};
	walk(root, { x: 0, y: 0, w: 1, h: 1 });
	return out;
}

/**
 * The normalized [0..1] rect of a split node (its enclosing sub-rectangle) —
 * the scale a divider drag / keyboard resize must be measured against, so a
 * nested split moves relative to its OWN bounds, not the whole area.
 */
export function splitBounds(root: BaseHalfPaneNode, splitId: string): IBaseHalfPaneRect | null {
	let found: IBaseHalfPaneRect | null = null;
	const walk = (node: BaseHalfPaneNode, r: IBaseHalfPaneRect): void => {
		if (found || node.type === 'leaf') {
			return;
		}
		if (node.id === splitId) {
			found = r;
			return;
		}
		if (node.dir === 'row') {
			const wa = r.w * node.fraction;
			walk(node.a, { x: r.x, y: r.y, w: wa, h: r.h });
			walk(node.b, { x: r.x + wa, y: r.y, w: r.w - wa, h: r.h });
		} else {
			const ha = r.h * node.fraction;
			walk(node.a, { x: r.x, y: r.y, w: r.w, h: ha });
			walk(node.b, { x: r.x, y: r.y + ha, w: r.w, h: r.h - ha });
		}
	};
	walk(root, { x: 0, y: 0, w: 1, h: 1 });
	return found;
}

export interface IBaseHalfPaneDivider {
	readonly splitId: string;
	readonly dir: 'row' | 'column';
	/**
	 * A zero-width (row) / zero-height (column) line in [0..1] space; the UI
	 * draws a fixed-thickness grab strip centered on it.
	 */
	readonly rect: IBaseHalfPaneRect;
	/**
	 * The enclosing split's full [0..1] sub-rectangle — the denominator a drag
	 * must scale by so nested splits resize relative to their own bounds.
	 */
	readonly bounds: IBaseHalfPaneRect;
}

/**
 * The draggable boundary line for every split, in normalized [0..1] space —
 * drives the resize handles. Each divider also carries its split's enclosing
 * `bounds` so a drag scales by the split's own sub-rectangle (not the whole
 * area), which is what makes nested same-axis splits resize correctly.
 */
export function splitDividers(root: BaseHalfPaneNode): IBaseHalfPaneDivider[] {
	const out: IBaseHalfPaneDivider[] = [];
	const walk = (node: BaseHalfPaneNode, r: IBaseHalfPaneRect): void => {
		if (node.type === 'leaf') {
			return;
		}
		if (node.dir === 'row') {
			const wa = r.w * node.fraction;
			out.push({
				splitId: node.id,
				dir: 'row',
				rect: { x: r.x + wa, y: r.y, w: 0, h: r.h },
				bounds: r
			});
			walk(node.a, { x: r.x, y: r.y, w: wa, h: r.h });
			walk(node.b, { x: r.x + wa, y: r.y, w: r.w - wa, h: r.h });
		} else {
			const ha = r.h * node.fraction;
			out.push({
				splitId: node.id,
				dir: 'column',
				rect: { x: r.x, y: r.y + ha, w: r.w, h: 0 },
				bounds: r
			});
			walk(node.a, { x: r.x, y: r.y, w: r.w, h: ha });
			walk(node.b, { x: r.x, y: r.y + ha, w: r.w, h: r.h - ha });
		}
	};
	walk(root, { x: 0, y: 0, w: 1, h: 1 });
	return out;
}

/**
 * The nearest leaf in a spatial direction — the directional split-focus
 * algorithm: keep only candidates lying ENTIRELY beyond our edge in `dir` (a
 * half-plane filter — NO perpendicular-overlap gate, so a diagonal pane still
 * qualifies), then pick the one whose TOP-LEFT corner is Euclidean-nearest to
 * ours. No wrap — null at the edge.
 */
export function directionalNeighbor(root: BaseHalfPaneNode, leafId: string, dir: BaseHalfFocusDir): string | null {
	const rects = leafRects(root);
	const me = rects.get(leafId);
	if (!me) {
		return null;
	}
	const E = 1e-9;
	let best: string | null = null;
	let bestDist = Number.POSITIVE_INFINITY;
	for (const [id, r] of rects) {
		if (id === leafId) {
			continue;
		}
		// Half-plane: candidate entirely beyond our edge (maxX ≤ refMinX for left,
		// minX ≥ refMaxX for right, etc. — at-or-beyond, shared edges count).
		const beyond =
			dir === 'left'
				? r.x + r.w <= me.x + E
				: dir === 'right'
					? r.x + E >= me.x + me.w
					: dir === 'up'
						? r.y + r.h <= me.y + E
						: r.y + E >= me.y + me.h;
		if (!beyond) {
			continue;
		}
		// Nearest by Euclidean distance between TOP-LEFT corners.
		const dx = r.x - me.x;
		const dy = r.y - me.y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		if (dist < bestDist - E) {
			bestDist = dist;
			best = id;
		}
	}
	return best;
}

/**
 * The id of the split parent whose axis matches `dir`, for resizing — the
 * nearest ancestor split that controls movement in that direction, plus
 * whether `leafId` sits on its `a` side (grow vs shrink).
 */
export function resizeTarget(root: BaseHalfPaneNode, leafId: string, dir: BaseHalfFocusDir): { splitId: string; onSideA: boolean } | null {
	const wantRow = dir === 'left' || dir === 'right';
	let found: { splitId: string; onSideA: boolean } | null = null;
	const walk = (node: BaseHalfPaneNode): boolean => {
		if (node.type === 'leaf') {
			return node.id === leafId;
		}
		const inA = walk(node.a);
		const inB = inA ? false : walk(node.b);
		if (!inA && !inB) {
			return false;
		}
		if (found === null && ((wantRow && node.dir === 'row') || (!wantRow && node.dir === 'column'))) {
			found = { splitId: node.id, onSideA: inA };
		}
		return true;
	};
	walk(root);
	return found;
}

/**
 * Direction-aware leaf weight: a leaf weighs 1; a split nested along the SAME
 * axis contributes the sum of its children's weights; a split along the
 * PERPENDICULAR axis counts as 1.
 */
function weightForDir(node: BaseHalfPaneNode, dir: 'row' | 'column'): number {
	if (node.type === 'leaf') {
		return 1;
	}
	if (node.dir === dir) {
		return weightForDir(node.a, dir) + weightForDir(node.b, dir);
	}
	return 1;
}

/**
 * Reset every split's fraction so panes are evenly sized by leaf weight —
 * the equalize-splits action (⌘⌃=). Children are equalized first, then each
 * split's fraction = left weight / total weight.
 */
export function equalize(root: BaseHalfPaneNode): BaseHalfPaneNode {
	if (root.type === 'leaf') {
		return root;
	}
	const a = equalize(root.a);
	const b = equalize(root.b);
	const wa = weightForDir(a, root.dir);
	const wb = weightForDir(b, root.dir);
	return { ...root, a, b, fraction: clampFraction(wa / (wa + wb)) };
}

/**
 * Split `targetId` in two, placing leaf `newId` beside it on `side`. `left`/`up`
 * put the new pane on the NEAR side (a); `right`/`down` on the FAR side (b).
 * Used to restore a soft-closed pane on its original side when undoing a close.
 * `left`/`right` → a row; `up`/`down` → a column.
 */
export function insertBeside(root: BaseHalfPaneNode, targetId: string, side: BaseHalfFocusDir, newId: string, splitId: string): BaseHalfPaneNode {
	const dir: 'row' | 'column' = side === 'left' || side === 'right' ? 'row' : 'column';
	const near = side === 'left' || side === 'up';
	const replace = (node: BaseHalfPaneNode): BaseHalfPaneNode => {
		if (node.type === 'leaf') {
			if (node.id !== targetId) {
				return node;
			}
			const created = paneLeaf(newId);
			return {
				type: 'split',
				id: splitId,
				dir,
				a: near ? created : node,
				b: near ? node : created,
				fraction: 0.5
			};
		}
		return { ...node, a: replace(node.a), b: replace(node.b) };
	};
	return replace(root);
}

/**
 * Which edge of a pane a point in its [0..1] space is nearest — a 4-triangle
 * partition (the view's diagonals), ties broken left→right→up→down. Drives the
 * drag-a-pane-to-rearrange drop zones: the dropped pane lands on this edge.
 */
export function dropEdge(px: number, py: number): BaseHalfFocusDir {
	const candidates: ReadonlyArray<readonly [BaseHalfFocusDir, number]> = [
		['left', px],
		['right', 1 - px],
		['up', py],
		['down', 1 - py]
	];
	let best: BaseHalfFocusDir = 'left';
	let bestDist = Number.POSITIVE_INFINITY;
	for (const [edge, dist] of candidates) {
		if (dist < bestDist - 1e-9) {
			bestDist = dist;
			best = edge;
		}
	}
	return best;
}
