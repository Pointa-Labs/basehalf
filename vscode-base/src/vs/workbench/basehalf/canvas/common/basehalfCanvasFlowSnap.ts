/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type { Node, NodeChange } from '@xyflow/react';
import {
	IBaseHalfCanvasSnapGuide,
	IBaseHalfCanvasSnapRect,
	snapBaseHalfCanvasResizeRect,
	snapBaseHalfCanvasTranslateRect
} from './basehalfCanvasSnap.js';

export const BASEHALF_CANVAS_SNAP_GUIDE_SCREEN_THRESHOLD = 5;

type BaseHalfCanvasPositionChange<TNode extends Node> = Extract<NodeChange<TNode>, { type: 'position' }>;
type BaseHalfCanvasDimensionChange<TNode extends Node> = Extract<NodeChange<TNode>, { type: 'dimensions' }>;

export interface IBaseHalfCanvasFlowSnapOptions {
	readonly threshold: number;
	readonly disabled?: boolean;
	readonly defaultWidth: number;
	readonly defaultHeight: number;
	readonly minWidth: number;
	readonly minHeight: number;
	readonly maxWidth?: number;
	readonly maxHeight?: number;
}

export function sameBaseHalfCanvasSnapGuides(
	a: readonly IBaseHalfCanvasSnapGuide[],
	b: readonly IBaseHalfCanvasSnapGuide[]
): boolean {
	if (a.length !== b.length) {
		return false;
	}
	return a.every((guide, index) => {
		const other = b[index];
		if (!other || guide.orientation !== other.orientation) {
			return false;
		}
		if (guide.orientation === 'vertical' && other.orientation === 'vertical') {
			return (
				Math.abs(guide.x - other.x) < 0.1
				&& Math.abs(guide.y1 - other.y1) < 0.1
				&& Math.abs(guide.y2 - other.y2) < 0.1
			);
		}
		if (guide.orientation === 'horizontal' && other.orientation === 'horizontal') {
			return (
				Math.abs(guide.y - other.y) < 0.1
				&& Math.abs(guide.x1 - other.x1) < 0.1
				&& Math.abs(guide.x2 - other.x2) < 0.1
			);
		}
		return false;
	});
}

function nodeWidth(node: Node | undefined): number | undefined {
	if (typeof node?.width === 'number') {
		return node.width;
	}
	const width = node?.style?.width;
	return typeof width === 'number' ? width : undefined;
}

function nodeHeight(node: Node | undefined): number | undefined {
	if (typeof node?.height === 'number') {
		return node.height;
	}
	const height = node?.style?.height;
	return typeof height === 'number' ? height : undefined;
}

function nodeRect<TNode extends Node>(node: TNode, options: IBaseHalfCanvasFlowSnapOptions): IBaseHalfCanvasSnapRect {
	return {
		id: node.id,
		x: node.position.x,
		y: node.position.y,
		width: nodeWidth(node) ?? options.defaultWidth,
		height: nodeHeight(node) ?? options.defaultHeight
	};
}

function nodeRectFromDraft<TNode extends Node>(
	node: TNode,
	options: IBaseHalfCanvasFlowSnapOptions,
	position?: { readonly x: number; readonly y: number },
	dimensions?: { readonly width: number; readonly height: number }
): IBaseHalfCanvasSnapRect {
	return {
		id: node.id,
		x: position?.x ?? node.position.x,
		y: position?.y ?? node.position.y,
		width: dimensions?.width ?? nodeWidth(node) ?? options.defaultWidth,
		height: dimensions?.height ?? nodeHeight(node) ?? options.defaultHeight
	};
}

function boundsForRects(rects: readonly IBaseHalfCanvasSnapRect[]): IBaseHalfCanvasSnapRect | null {
	if (rects.length === 0) {
		return null;
	}

	let x1 = Number.POSITIVE_INFINITY;
	let y1 = Number.POSITIVE_INFINITY;
	let x2 = Number.NEGATIVE_INFINITY;
	let y2 = Number.NEGATIVE_INFINITY;
	for (const rect of rects) {
		x1 = Math.min(x1, rect.x);
		y1 = Math.min(y1, rect.y);
		x2 = Math.max(x2, rect.x + rect.width);
		y2 = Math.max(y2, rect.y + rect.height);
	}
	return { id: '__selection__', x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function nudgePositionChange<TNode extends Node>(
	change: BaseHalfCanvasPositionChange<TNode>,
	dx: number,
	dy: number
): BaseHalfCanvasPositionChange<TNode> {
	if (!change.position) {
		return change;
	}
	return {
		...change,
		position: { x: change.position.x + dx, y: change.position.y + dy },
		...(change.positionAbsolute && {
			positionAbsolute: {
				x: change.positionAbsolute.x + dx,
				y: change.positionAbsolute.y + dy
			}
		})
	};
}

function dragGuidesForMovedAxes(
	guides: readonly IBaseHalfCanvasSnapGuide[],
	before: IBaseHalfCanvasSnapRect | null,
	draft: IBaseHalfCanvasSnapRect,
	snapped: IBaseHalfCanvasSnapRect
): readonly IBaseHalfCanvasSnapGuide[] {
	const movedX = before ? Math.abs(draft.x - before.x) > 0.5 : true;
	const movedY = before ? Math.abs(draft.y - before.y) > 0.5 : true;
	const snappedX = Math.abs(snapped.x - draft.x) > 0.5;
	const snappedY = Math.abs(snapped.y - draft.y) > 0.5;
	return guides.filter(guide => guide.orientation === 'vertical' ? movedX || snappedX : movedY || snappedY);
}

export function snapBaseHalfCanvasFlowNodeChanges<TNode extends Node>(
	previousNodes: readonly TNode[],
	changes: readonly NodeChange<TNode>[],
	options: IBaseHalfCanvasFlowSnapOptions
): { readonly changes: NodeChange<TNode>[]; readonly guides: readonly IBaseHalfCanvasSnapGuide[] } {
	const nextChanges = changes.map(change => ({ ...change })) as NodeChange<TNode>[];
	if (options.disabled) {
		return { changes: nextChanges, guides: [] };
	}

	const nodeById = new Map(previousNodes.map(node => [node.id, node]));
	let guides: readonly IBaseHalfCanvasSnapGuide[] = [];

	const dragChanges = nextChanges.filter(
		(change): change is BaseHalfCanvasPositionChange<TNode> =>
			change.type === 'position' && change.position !== undefined && change.dragging !== undefined
	);
	if (dragChanges.length > 0) {
		const activeIds = new Set(dragChanges.map(change => change.id));
		const activeRects = dragChanges
			.map(change => {
				const node = nodeById.get(change.id);
				return node ? nodeRectFromDraft(node, options, change.position) : null;
			})
			.filter((rect): rect is IBaseHalfCanvasSnapRect => rect !== null);
		const beforeRects = dragChanges
			.map(change => {
				const node = nodeById.get(change.id);
				return node ? nodeRect(node, options) : null;
			})
			.filter((rect): rect is IBaseHalfCanvasSnapRect => rect !== null);
		const selectionRect = boundsForRects(activeRects);
		const beforeSelectionRect = boundsForRects(beforeRects);
		const targets = previousNodes
			.filter(node => !activeIds.has(node.id))
			.map(node => nodeRect(node, options));
		if (selectionRect && targets.length > 0) {
			const snapped = snapBaseHalfCanvasTranslateRect(selectionRect, targets, options.threshold);
			const dx = snapped.rect.x - selectionRect.x;
			const dy = snapped.rect.y - selectionRect.y;
			if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
				for (let index = 0; index < nextChanges.length; index++) {
					const change = nextChanges[index];
					if (change?.type === 'position' && activeIds.has(change.id)) {
						nextChanges[index] = nudgePositionChange(change, dx, dy);
					}
				}
			}
			if (dragChanges.some(change => change.dragging === true)) {
				guides = dragGuidesForMovedAxes(snapped.guides, beforeSelectionRect, selectionRect, snapped.rect);
			}
		}
	}

	const dimensionChanges = nextChanges.filter(
		(change): change is BaseHalfCanvasDimensionChange<TNode> =>
			change.type === 'dimensions' && change.dimensions !== undefined && change.resizing !== undefined
	);
	for (const dimensionChange of dimensionChanges) {
		const node = nodeById.get(dimensionChange.id);
		if (!node || !dimensionChange.dimensions) {
			continue;
		}
		const positionChange = nextChanges.find(
			(change): change is BaseHalfCanvasPositionChange<TNode> =>
				change.type === 'position' && change.id === dimensionChange.id && change.position !== undefined
		);
		// XYResizer's pointer-up notification can carry its last raw dimensions
		// without the companion position change used by a north/west resize. The
		// controlled node already contains the last live, snapped rectangle; keep
		// that rectangle for the final commit instead of reinterpreting the raw
		// width as a resize of the opposite edge.
		if (dimensionChange.resizing === false) {
			dimensionChange.dimensions = {
				width: nodeWidth(node) ?? dimensionChange.dimensions.width,
				height: nodeHeight(node) ?? dimensionChange.dimensions.height
			};
			if (positionChange) {
				positionChange.position = { ...node.position };
			}
			continue;
		}
		const before = nodeRect(node, options);
		const draft = nodeRectFromDraft(node, options, positionChange?.position, dimensionChange.dimensions);
		const targets = previousNodes
			.filter(candidate => candidate.id !== dimensionChange.id)
			.map(candidate => nodeRect(candidate, options));
		if (targets.length === 0) {
			continue;
		}
		const snapped = snapBaseHalfCanvasResizeRect(before, draft, targets, options.threshold, {
			minWidth: options.minWidth,
			minHeight: options.minHeight,
			maxWidth: options.maxWidth,
			maxHeight: options.maxHeight
		});
		dimensionChange.dimensions = {
			width: snapped.rect.width,
			height: snapped.rect.height
		};
		if (positionChange) {
			const dx = snapped.rect.x - draft.x;
			const dy = snapped.rect.y - draft.y;
			if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
				const index = nextChanges.indexOf(positionChange);
				nextChanges[index] = nudgePositionChange(positionChange, dx, dy);
			}
		} else if (snapped.rect.x !== draft.x || snapped.rect.y !== draft.y) {
			nextChanges.push({
				id: dimensionChange.id,
				type: 'position',
				position: { x: snapped.rect.x, y: snapped.rect.y },
				dragging: false
			} as NodeChange<TNode>);
		}
		if (dimensionChange.resizing === true) {
			guides = snapped.guides;
		}
	}

	return { changes: nextChanges, guides };
}
