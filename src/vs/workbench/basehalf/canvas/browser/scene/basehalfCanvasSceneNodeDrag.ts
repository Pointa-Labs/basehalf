/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type { IBaseHalfCanvasHeldSnap } from '../../common/basehalfCanvasFlowSnap.js';

export interface IBaseHalfCanvasNodeDragOrigin {
	readonly id: string;
	readonly x: number;
	readonly y: number;
}

export interface IBaseHalfCanvasNodeDragState {
	readonly sceneKey: string;
	readonly structuralEpoch: number;
	readonly token: number;
	readonly primaryPath: string;
	readonly selectionAtStart: readonly string[];
	readonly origins: readonly IBaseHalfCanvasNodeDragOrigin[];
	cancelled: boolean;
	/** A folder takes the dragged cards now (dropping into a folder): nothing snaps them. */
	takenByFolder?: boolean;
	/** What the drag keeps of snapping from one move to the next. */
	heldSnap?: IBaseHalfCanvasHeldSnap;
}

export function captureBaseHalfCanvasNodeDragOrigins(
	nodes: readonly { readonly id: string; readonly position: { readonly x: number; readonly y: number } }[],
	ids: ReadonlySet<string>
): readonly IBaseHalfCanvasNodeDragOrigin[] {
	return Object.freeze(nodes
		.filter(node => ids.has(node.id))
		.map(node => Object.freeze({ id: node.id, x: node.position.x, y: node.position.y })));
}

export function restoreBaseHalfCanvasNodeDragOrigins<T extends { readonly id: string; readonly position: { readonly x: number; readonly y: number }; readonly dragging?: boolean }>(
	nodes: readonly T[],
	origins: readonly IBaseHalfCanvasNodeDragOrigin[]
): T[] {
	const byId = new Map(origins.map(origin => [origin.id, origin]));
	return nodes.map(node => {
		const origin = byId.get(node.id);
		if (!origin || (node.position.x === origin.x && node.position.y === origin.y && !node.dragging)) {
			return node;
		}
		// The drag is over for this card. The changes that would say so are
		// dropped once a drag is cancelled, and a card that still counted as
		// dragged would get no capture circles.
		return { ...node, position: { x: origin.x, y: origin.y }, ...(node.dragging ? { dragging: false } : {}) };
	});
}

export function filterBaseHalfCanvasCancelledNodeDragChanges<T extends { readonly type: string; readonly id?: string }>(
	changes: readonly T[],
	origins: readonly IBaseHalfCanvasNodeDragOrigin[]
): T[] {
	const cancelledIds = new Set(origins.map(origin => origin.id));
	return changes.filter(change => {
		if (change.type !== 'position' && change.type !== 'dimensions') {
			return true;
		}
		return change.id === undefined || !cancelledIds.has(change.id);
	});
}