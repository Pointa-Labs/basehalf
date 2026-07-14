/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type { AIProjectWorkflowAnchor } from '../src/model';

export const WORKFLOW_CANVAS_SNAP_SCREEN_THRESHOLD = 5;

export type WorkflowCanvasOverlayPlacement = 'top' | 'right' | 'bottom' | 'left';

export interface WorkflowCanvasPoint {
	readonly x: number;
	readonly y: number;
}

export function workflowCanvasConnectionPath(
	from: WorkflowCanvasPoint,
	fromAnchor: AIProjectWorkflowAnchor,
	to: WorkflowCanvasPoint,
	toAnchor: AIProjectWorkflowAnchor
): string {
	const distance = Math.min(220, Math.max(48, (Math.abs(to.x - from.x) + Math.abs(to.y - from.y)) / 2));
	const fromControl = workflowCanvasControlPoint(from, fromAnchor, distance);
	const toControl = workflowCanvasControlPoint(to, toAnchor, distance);
	return `M ${formatWorkflowCanvasNumber(from.x)} ${formatWorkflowCanvasNumber(from.y)} C ${formatWorkflowCanvasNumber(fromControl.x)} ${formatWorkflowCanvasNumber(fromControl.y)} ${formatWorkflowCanvasNumber(toControl.x)} ${formatWorkflowCanvasNumber(toControl.y)} ${formatWorkflowCanvasNumber(to.x)} ${formatWorkflowCanvasNumber(to.y)}`;
}

function workflowCanvasControlPoint(point: WorkflowCanvasPoint, anchor: AIProjectWorkflowAnchor, distance: number): WorkflowCanvasPoint {
	if (anchor === 'north') {
		return { x: point.x, y: point.y - distance };
	}
	if (anchor === 'east') {
		return { x: point.x + distance, y: point.y };
	}
	if (anchor === 'south') {
		return { x: point.x, y: point.y + distance };
	}
	return { x: point.x - distance, y: point.y };
}

function formatWorkflowCanvasNumber(value: number): string {
	return String(Number(value.toFixed(4)));
}

export interface WorkflowCanvasNodeFrame {
	readonly id: string;
	readonly parentId?: string;
	readonly position: WorkflowCanvasPoint;
	readonly parentOffset: WorkflowCanvasPoint;
	readonly width: number;
	readonly height: number;
}

export interface WorkflowCanvasPositionChange {
	readonly id: string;
	readonly position?: WorkflowCanvasPoint;
	readonly positionAbsolute?: WorkflowCanvasPoint;
	readonly dragging?: boolean;
}

export type WorkflowCanvasSnapGuide =
	| { readonly orientation: 'vertical'; readonly x: number; readonly y1: number; readonly y2: number }
	| { readonly orientation: 'horizontal'; readonly y: number; readonly x1: number; readonly x2: number };

interface CanvasRect extends WorkflowCanvasPoint {
	readonly width: number;
	readonly height: number;
}

export interface WorkflowCanvasOverlayBounds {
	readonly width: number;
	readonly height: number;
}

export function clampWorkflowCanvasOverlay(
	point: WorkflowCanvasPoint,
	overlay: WorkflowCanvasOverlayBounds,
	canvas: WorkflowCanvasOverlayBounds,
	margin = 8
): WorkflowCanvasPoint {
	return {
		x: Math.min(Math.max(point.x, margin), Math.max(margin, canvas.width - overlay.width - margin)),
		y: Math.min(Math.max(point.y, margin), Math.max(margin, canvas.height - overlay.height - margin))
	};
}

export function workflowCanvasOverlayPlacement(
	node: CanvasRect,
	canvas: WorkflowCanvasOverlayBounds,
	overlay: WorkflowCanvasOverlayBounds,
	gap = 16
): WorkflowCanvasOverlayPlacement {
	const spaceRight = canvas.width - right(node);
	const spaceLeft = node.x;
	if (spaceRight >= overlay.width + gap) {
		return 'right';
	}
	if (spaceLeft >= overlay.width + gap) {
		return 'left';
	}
	const spaceBelow = canvas.height - bottom(node);
	const spaceAbove = node.y;
	return spaceBelow >= overlay.height + gap || spaceBelow >= spaceAbove ? 'bottom' : 'top';
}

interface AxisSnap {
	readonly nudge: number;
	readonly line: number;
	readonly target: CanvasRect;
}

function right(rect: CanvasRect): number {
	return rect.x + rect.width;
}

function bottom(rect: CanvasRect): number {
	return rect.y + rect.height;
}

function bounds(rects: readonly CanvasRect[]): CanvasRect | undefined {
	if (rects.length === 0) {
		return undefined;
	}
	const x1 = Math.min(...rects.map(rect => rect.x));
	const y1 = Math.min(...rects.map(rect => rect.y));
	const x2 = Math.max(...rects.map(right));
	const y2 = Math.max(...rects.map(bottom));
	return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function axisPoints(rect: CanvasRect, axis: 'x' | 'y'): readonly number[] {
	return axis === 'x'
		? [rect.x, rect.x + rect.width / 2, right(rect)]
		: [rect.y, rect.y + rect.height / 2, bottom(rect)];
}

function snapAxis(axis: 'x' | 'y', active: CanvasRect, targets: readonly CanvasRect[], threshold: number): AxisSnap | undefined {
	let best: { readonly distance: number; readonly value: AxisSnap } | undefined;
	for (const target of targets) {
		for (const targetPoint of axisPoints(target, axis)) {
			for (const activePoint of axisPoints(active, axis)) {
				const nudge = targetPoint - activePoint;
				const distance = Math.abs(nudge);
				if (distance <= threshold && (!best || distance < best.distance)) {
					best = { distance, value: { nudge, line: targetPoint, target } };
				}
			}
		}
	}
	return best?.value;
}

/**
 * Keeps motion continuous while applying a small screen-space alignment magnet
 * near sibling edges and centres. Project persistence remains a pointer-up concern.
 */
export function snapWorkflowCanvasNodeChanges<TChange extends WorkflowCanvasPositionChange>(
	nodes: readonly WorkflowCanvasNodeFrame[],
	changes: readonly TChange[],
	threshold: number
): { readonly changes: TChange[]; readonly guides: readonly WorkflowCanvasSnapGuide[] } {
	const next = changes.map(change => ({ ...change })) as TChange[];
	const moving = next.filter(change => change.position && change.dragging !== undefined);
	if (moving.length === 0) {
		return { changes: next, guides: [] };
	}

	const nodeById = new Map(nodes.map(node => [node.id, node]));
	const activeNodes = moving.map(change => nodeById.get(change.id)).filter((node): node is WorkflowCanvasNodeFrame => Boolean(node));
	const parentId = activeNodes[0]?.parentId;
	if (activeNodes.length !== moving.length || activeNodes.some(node => node.parentId !== parentId)) {
		return { changes: next, guides: [] };
	}

	const activeIds = new Set(activeNodes.map(node => node.id));
	const activeRects = moving.map(change => {
		const node = nodeById.get(change.id)!;
		return { x: change.position!.x, y: change.position!.y, width: node.width, height: node.height };
	});
	const activeBounds = bounds(activeRects);
	const targets = nodes
		.filter(node => node.parentId === parentId && !activeIds.has(node.id))
		.map(node => ({ x: node.position.x, y: node.position.y, width: node.width, height: node.height }));
	if (!activeBounds || targets.length === 0) {
		return { changes: next, guides: [] };
	}

	const xSnap = snapAxis('x', activeBounds, targets, threshold);
	const ySnap = snapAxis('y', activeBounds, targets, threshold);
	const dx = xSnap?.nudge ?? 0;
	const dy = ySnap?.nudge ?? 0;
	for (let index = 0; index < next.length; index++) {
		const change = next[index];
		if (!change?.position || !activeIds.has(change.id)) {
			continue;
		}
		next[index] = {
			...change,
			position: { x: change.position.x + dx, y: change.position.y + dy },
			...(change.positionAbsolute && { positionAbsolute: { x: change.positionAbsolute.x + dx, y: change.positionAbsolute.y + dy } })
		};
	}

	if (!moving.some(change => change.dragging === true)) {
		return { changes: next, guides: [] };
	}
	const offset = activeNodes[0].parentOffset;
	const snapped: CanvasRect = { ...activeBounds, x: activeBounds.x + dx, y: activeBounds.y + dy };
	const guides: WorkflowCanvasSnapGuide[] = [];
	if (xSnap) {
		guides.push({
			orientation: 'vertical',
			x: xSnap.line + offset.x,
			y1: Math.min(snapped.y, xSnap.target.y) + offset.y,
			y2: Math.max(bottom(snapped), bottom(xSnap.target)) + offset.y
		});
	}
	if (ySnap) {
		guides.push({
			orientation: 'horizontal',
			y: ySnap.line + offset.y,
			x1: Math.min(snapped.x, ySnap.target.x) + offset.x,
			x2: Math.max(right(snapped), right(ySnap.target)) + offset.x
		});
	}
	return { changes: next, guides };
}
