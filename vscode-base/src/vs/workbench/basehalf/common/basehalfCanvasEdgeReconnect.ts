/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type { BaseHalfCanvasAnchor } from './basehalfCanvasModel.js';

export type BaseHalfCanvasEdgeReconnectEnd = 'source' | 'target';

export interface IBaseHalfCanvasClientPoint {
	readonly x: number;
	readonly y: number;
}

export interface IBaseHalfCanvasPathSample extends IBaseHalfCanvasClientPoint {
	/** Position along the directed SVG path, normalized to [0, 1]. */
	readonly ratio: number;
}

export interface IBaseHalfCanvasReconnectClientRect {
	readonly nodeId: string;
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

export interface IBaseHalfCanvasReconnectSnap {
	readonly nodeId: string;
	readonly anchor: BaseHalfCanvasAnchor;
	readonly clientPoint: IBaseHalfCanvasClientPoint;
	readonly distance: number;
}

export type BaseHalfCanvasReconnectHit =
	| { readonly kind: 'snap'; readonly snap: IBaseHalfCanvasReconnectSnap }
	| { readonly kind: 'invalid-card' }
	| { readonly kind: 'blank' };

/** Matches the established card-side target depth used by connection drags. */
export const BASEHALF_CANVAS_EDGE_RECONNECT_TARGET_DEPTH = 48;

/**
 * Finds the closest sampled position on a directed path. This deliberately
 * reasons about path order, rather than screen x/y, because a curved or
 * backtracking edge can put its source half to the right of its target half.
 */
export function nearestBaseHalfCanvasPathRatio(
	samples: readonly IBaseHalfCanvasPathSample[],
	pointer: IBaseHalfCanvasClientPoint
): number | undefined {
	let bestRatio: number | undefined;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const sample of samples) {
		if (!Number.isFinite(sample.x) || !Number.isFinite(sample.y) || !Number.isFinite(sample.ratio)) {
			continue;
		}
		const distance = Math.hypot(sample.x - pointer.x, sample.y - pointer.y);
		if (distance < bestDistance) {
			bestDistance = distance;
			bestRatio = Math.min(1, Math.max(0, sample.ratio));
		}
	}
	return bestRatio;
}

export function baseHalfCanvasReconnectEndForPath(
	samples: readonly IBaseHalfCanvasPathSample[],
	pointer: IBaseHalfCanvasClientPoint
): BaseHalfCanvasEdgeReconnectEnd | undefined {
	const ratio = nearestBaseHalfCanvasPathRatio(samples, pointer);
	return ratio === undefined ? undefined : ratio < 0.5 ? 'source' : 'target';
}

/**
 * Snaps a reconnect pointer to the nearest eligible card, then to the card
 * side selected by the pointer's position. The opposite endpoint is supplied
 * as an exclusion so a relationship can never reconnect to itself. A dragged
 * endpoint's own card intentionally remains eligible, allowing side changes.
 */
export function resolveBaseHalfCanvasReconnectPoint(
	pointer: IBaseHalfCanvasClientPoint,
	rects: readonly IBaseHalfCanvasReconnectClientRect[],
	excludedNodeIds: ReadonlySet<string>,
	targetDepth = BASEHALF_CANVAS_EDGE_RECONNECT_TARGET_DEPTH
): BaseHalfCanvasReconnectHit {
	let best: IBaseHalfCanvasReconnectSnap | null = null;
	let hitInvalidCard = false;
	for (const rect of rects) {
		if (rect.width <= 0 || rect.height <= 0) {
			continue;
		}
		const anchor = reconnectAnchorForPoint(rect, pointer, targetDepth);
		if (!anchor) {
			continue;
		}
		if (excludedNodeIds.has(rect.nodeId)) {
			hitInvalidCard = true;
			continue;
		}
		const distance = distanceToRect(rect, pointer);
		const candidate: IBaseHalfCanvasReconnectSnap = {
			nodeId: rect.nodeId,
			anchor,
			clientPoint: reconnectAnchorPoint(rect, anchor),
			distance
		};
		if (!best || candidate.distance < best.distance) {
			best = candidate;
		}
	}
	return best
		? { kind: 'snap', snap: best }
		: hitInvalidCard
			? { kind: 'invalid-card' }
			: { kind: 'blank' };
}

function reconnectAnchorForPoint(
	rect: IBaseHalfCanvasReconnectClientRect,
	pointer: IBaseHalfCanvasClientPoint,
	targetDepth: number
): BaseHalfCanvasAnchor | undefined {
	const margin = targetDepth / 2;
	const x = pointer.x - rect.left;
	const y = pointer.y - rect.top;
	if (x < -margin || x > rect.width + margin || y < -margin || y > rect.height + margin) {
		return undefined;
	}

	if (x >= 0 && x <= rect.width && y >= 0 && y <= rect.height) {
		const sides: readonly { readonly anchor: BaseHalfCanvasAnchor; readonly distance: number }[] = [
			{ anchor: 'north', distance: y },
			{ anchor: 'east', distance: rect.width - x },
			{ anchor: 'south', distance: rect.height - y },
			{ anchor: 'west', distance: x }
		];
		return sides.reduce((nearest, candidate) => candidate.distance < nearest.distance ? candidate : nearest).anchor;
	}

	// Keep the established target-affordance ordering at corners. It prevents
	// the chosen side from oscillating as a pointer crosses a card corner.
	if (y <= targetDepth) {
		return 'north';
	}
	if (y >= rect.height - targetDepth) {
		return 'south';
	}
	if (x <= targetDepth) {
		return 'west';
	}
	if (x >= rect.width - targetDepth) {
		return 'east';
	}
	return undefined;
}

function reconnectAnchorPoint(
	rect: IBaseHalfCanvasReconnectClientRect,
	anchor: BaseHalfCanvasAnchor
): IBaseHalfCanvasClientPoint {
	switch (anchor) {
		case 'north': return { x: rect.left + rect.width / 2, y: rect.top };
		case 'east': return { x: rect.left + rect.width, y: rect.top + rect.height / 2 };
		case 'south': return { x: rect.left + rect.width / 2, y: rect.top + rect.height };
		case 'west': return { x: rect.left, y: rect.top + rect.height / 2 };
	}
}

function distanceToRect(
	rect: IBaseHalfCanvasReconnectClientRect,
	pointer: IBaseHalfCanvasClientPoint
): number {
	const right = rect.left + rect.width;
	const bottom = rect.top + rect.height;
	const dx = Math.max(rect.left - pointer.x, 0, pointer.x - right);
	const dy = Math.max(rect.top - pointer.y, 0, pointer.y - bottom);
	return Math.hypot(dx, dy);
}
