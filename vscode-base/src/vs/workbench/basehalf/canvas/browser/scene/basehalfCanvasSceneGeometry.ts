/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { BaseHalfCanvasAnchor, BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT, BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH, BASEHALF_CANVAS_MIN_CARD_HEIGHT, BASEHALF_CANVAS_MIN_CARD_WIDTH } from '../../common/basehalfCanvasModel.js';
import { BASEHALF_CANVAS_HELD_SNAP_NONE, BASEHALF_CANVAS_SNAP_GUIDE_SCREEN_THRESHOLD, sameBaseHalfCanvasSnapGuides, snapBaseHalfCanvasFlowNodeChanges, snapBaseHalfCanvasHeldCards } from '../../common/basehalfCanvasFlowSnap.js';
import { IBaseHalfCanvasSnapGuide } from '../../common/basehalfCanvasSnap.js';
import {
	IBaseHalfCanvasSceneCard,
	BaseHalfCanvasSceneGeometryReason,
	IBaseHalfCanvasSceneGeometry,
	IBaseHalfCanvasSceneSnapshot,
	IBaseHalfCanvasSceneViewport
} from '../../common/basehalfCanvasScene.js';
import type { NodeChange, NodeHandle } from '@xyflow/react';
import type { Dispatch, SetStateAction, RefObject } from 'react';
import { filterBaseHalfCanvasCancelledNodeDragChanges, IBaseHalfCanvasNodeDragState } from './basehalfCanvasSceneNodeDrag.js';
import { BaseHalfCanvasFlowNode, BaseHalfCanvasReactVendor, flowPosition, IBaseHalfCanvasSceneEnvironment, numericStyle } from './basehalfCanvasSceneShared.js';

export function baseHalfCanvasSceneNodeSize(
	card: Pick<IBaseHalfCanvasSceneCard, 'width' | 'height'>
): Pick<BaseHalfCanvasFlowNode, 'initialWidth' | 'initialHeight' | 'measured' | 'style'> {
	return {
		initialWidth: card.width,
		initialHeight: card.height,
		// XYResizer snapshots `measured` at pointer-down and falls back to zero
		// when it is absent. A controlled snapshot can arrive just before the
		// ResizeObserver does, so seed the known persisted rectangle as the first
		// measured value instead of exposing a transient minimum-size resize.
		measured: { width: card.width, height: card.height },
		style: { width: card.width, height: card.height }
	};
}

/** The side of the box React Flow measures for a handle of a card: its smallest handle (basehalfCanvasCardNode.css). */
const FLOW_HANDLE_BOX = 5;

/** A handle of a card where React Flow measures it, relative to the card. */
export interface IBaseHalfCanvasSceneHandleBox {
	readonly anchor: BaseHalfCanvasAnchor;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/**
 * Where React Flow measures the handles of a card: a box of 5 by 5 pixels
 * whose middle is the middle of each side.
 */
export function baseHalfCanvasSceneHandleBoxes(card: Pick<IBaseHalfCanvasSceneCard, 'width' | 'height'>): readonly IBaseHalfCanvasSceneHandleBox[] {
	const half = FLOW_HANDLE_BOX / 2;
	const box = (anchor: BaseHalfCanvasAnchor, x: number, y: number): IBaseHalfCanvasSceneHandleBox => ({ anchor, x: x - half, y: y - half, width: FLOW_HANDLE_BOX, height: FLOW_HANDLE_BOX });
	return [
		box('north', card.width / 2, 0),
		box('east', card.width, card.height / 2),
		box('south', card.width / 2, card.height),
		box('west', 0, card.height / 2)
	];
}

/**
 * The handles a card that appears is given, so that its lines are drawn in
 * the frame it appears in: React Flow draws a line only between cards whose
 * handles it knows, and it measures them a frame after a card is drawn
 * (canvas card name, "After the rename").
 */
export function baseHalfCanvasSceneNodeHandles(vendor: BaseHalfCanvasReactVendor, card: Pick<IBaseHalfCanvasSceneCard, 'width' | 'height'>): NodeHandle[] {
	return baseHalfCanvasSceneHandleBoxes(card).map(box => ({
		id: box.anchor,
		type: 'source',
		position: flowPosition(vendor, box.anchor),
		x: box.x,
		y: box.y,
		width: box.width,
		height: box.height
	}));
}

export function baseHalfCanvasSceneGeometryForCommit(
	geometry: IBaseHalfCanvasSceneGeometry,
	fallback: Pick<IBaseHalfCanvasSceneCard, 'x' | 'y' | 'width' | 'height'>
): IBaseHalfCanvasSceneGeometry {
	const finiteOr = (value: number, fallbackValue: number, finalFallback: number): number =>
		Number.isFinite(value) ? value : Number.isFinite(fallbackValue) ? fallbackValue : finalFallback;
	// The layout keeps four decimal places. A geometry is committed as it is
	// stored, so that undo finds the row that the commit wrote.
	const stored = (value: number): number => Number(value.toFixed(4));
	return {
		...geometry,
		x: stored(finiteOr(geometry.x, fallback.x, 0)),
		y: stored(finiteOr(geometry.y, fallback.y, 0)),
		width: stored(Math.max(BASEHALF_CANVAS_MIN_CARD_WIDTH, finiteOr(geometry.width, fallback.width, BASEHALF_CANVAS_MIN_CARD_WIDTH))),
		height: stored(Math.max(BASEHALF_CANVAS_MIN_CARD_HEIGHT, finiteOr(geometry.height, fallback.height, BASEHALF_CANVAS_MIN_CARD_HEIGHT)))
	};
}

/** A place or size of a card that is being saved, and the save it belongs to. */
export interface IBaseHalfCanvasPendingGeometry {
	readonly token: number;
	readonly geometry: IBaseHalfCanvasSceneGeometry;
}

/**
 * Moving and resizing cards: the changes React Flow reports are snapped to the
 * other cards, drawn at once, and the final places and sizes saved through the
 * canvas view as one step of undo.
 */
export function useBaseHalfCanvasSceneGeometry(environment: IBaseHalfCanvasSceneEnvironment, scene: {
	readonly snapshotRef: RefObject<IBaseHalfCanvasSceneSnapshot>;
	readonly sceneKeyRef: RefObject<string>;
	readonly structuralEpochRef: RefObject<number>;
	readonly mutationSequence: RefObject<number>;
	readonly viewportRef: RefObject<IBaseHalfCanvasSceneViewport>;
	readonly pendingGeometry: RefObject<Map<string, IBaseHalfCanvasPendingGeometry>>;
	readonly interactionSceneKey: RefObject<string | undefined>;
	readonly interactionStructuralEpoch: RefObject<number | undefined>;
	readonly nodeDragState: RefObject<IBaseHalfCanvasNodeDragState | undefined>;
	readonly snapEnabledRef: RefObject<boolean>;
	readonly setGuides: Dispatch<SetStateAction<readonly IBaseHalfCanvasSnapGuide[]>>;
	readonly nodesRef: RefObject<BaseHalfCanvasFlowNode[]>;
	readonly setLiveNodes: (next: BaseHalfCanvasFlowNode[]) => void;
	readonly queueSelectionChanges: (nodeChanges?: readonly { readonly id: string; readonly selected: boolean }[], edgeChanges?: readonly { readonly id: string; readonly selected: boolean }[]) => void;
	readonly updateSnapshot: (snapshot: IBaseHalfCanvasSceneSnapshot) => void;
}) {
	const { vendor, delegate } = environment;
	const {
		snapshotRef, sceneKeyRef, structuralEpochRef, mutationSequence, viewportRef,
		pendingGeometry, interactionSceneKey, interactionStructuralEpoch, nodeDragState,
		snapEnabledRef, setGuides, nodesRef, setLiveNodes, queueSelectionChanges, updateSnapshot
	} = scene;

	const commitFinalGeometry = vendor.useCallback((nextNodes: readonly BaseHalfCanvasFlowNode[], changes: readonly NodeChange<BaseHalfCanvasFlowNode>[], reason?: BaseHalfCanvasSceneGeometryReason) => {
		const finalIds = new Set<string>();
		for (const change of changes) {
			if (change.type === 'position' && change.position && change.dragging === false) {
				finalIds.add(change.id);
			} else if (change.type === 'dimensions' && change.dimensions && change.resizing === false) {
				finalIds.add(change.id);
			}
		}
		if (finalIds.size === 0) {
			return;
		}
		const geometries: IBaseHalfCanvasSceneGeometry[] = [];
		let operationKey: string | undefined;
		let operationEpoch: number | undefined;
		for (const id of finalIds) {
			const node = nextNodes.find(candidate => candidate.id === id);
			if (!node) {
				continue;
			}
			operationKey ??= node.data.sceneKey;
			operationEpoch ??= node.data.structuralEpoch;
			if (node.data.sceneKey !== operationKey || node.data.structuralEpoch !== operationEpoch) {
				return;
			}
			geometries.push(baseHalfCanvasSceneGeometryForCommit({
				path: id,
				kind: node.data.card.kind,
				x: node.position.x,
				y: node.position.y,
				width: node.width ?? node.measured?.width ?? numericStyle(node.style?.width) ?? node.data.card.width,
				height: node.height ?? node.measured?.height ?? numericStyle(node.style?.height) ?? node.data.card.height
			}, node.data.card));
		}
		if (geometries.length === 0 || !operationKey || operationEpoch === undefined) {
			return;
		}
		const token = ++mutationSequence.current;
		for (const geometry of geometries) {
			pendingGeometry.current.set(geometry.path, { token, geometry });
		}
		void delegate.commitGeometry(operationKey, operationEpoch, geometries, reason).catch(error => {
			if (sceneKeyRef.current !== operationKey || structuralEpochRef.current !== operationEpoch) {
				return;
			}
			let shouldReconcile = false;
			for (const geometry of geometries) {
				if (pendingGeometry.current.get(geometry.path)?.token === token) {
					pendingGeometry.current.delete(geometry.path);
					shouldReconcile = true;
				}
			}
			if (shouldReconcile) {
				updateSnapshot(snapshotRef.current);
			}
			delegate.reportError(error);
		});
	}, [updateSnapshot]);

	const applyNodesChange = vendor.useCallback((changes: NodeChange<BaseHalfCanvasFlowNode>[], disableSnap: boolean, reason?: BaseHalfCanvasSceneGeometryReason) => {
		const drag = nodeDragState.current;
		const acceptedChanges = drag?.cancelled
			? filterBaseHalfCanvasCancelledNodeDragChanges(changes, drag.origins)
			: changes;
		if (acceptedChanges.length === 0) {
			return;
		}
		const selectionChanges = acceptedChanges.filter(change => change.type === 'select');
		if (selectionChanges.length > 0) {
			queueSelectionChanges(selectionChanges);
		}
		const nonSelectionChanges = acceptedChanges.filter(change => change.type !== 'select');
		if (nonSelectionChanges.length === 0) {
			return;
		}
		const changesGeometry = nonSelectionChanges.some(change => change.type === 'position' || change.type === 'dimensions');
		if (changesGeometry) {
			const ownerKey = interactionSceneKey.current ?? sceneKeyRef.current;
			const ownerEpoch = interactionStructuralEpoch.current ?? structuralEpochRef.current;
			if (ownerKey !== sceneKeyRef.current || ownerEpoch !== structuralEpochRef.current || nonSelectionChanges.some(change => {
				if (change.type !== 'position' && change.type !== 'dimensions') {
					return false;
				}
				const data = nodesRef.current.find(node => node.id === change.id)?.data;
				return data?.sceneKey !== ownerKey || data.structuralEpoch !== ownerEpoch;
			})) {
				return;
			}
		}
		const options = {
			threshold: BASEHALF_CANVAS_SNAP_GUIDE_SCREEN_THRESHOLD / Math.max(0.2, viewportRef.current.zoom),
			disabled: disableSnap || !snapEnabledRef.current,
			defaultWidth: BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH,
			defaultHeight: BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT,
			minWidth: BASEHALF_CANVAS_MIN_CARD_WIDTH,
			minHeight: BASEHALF_CANVAS_MIN_CARD_HEIGHT
		};
		// Cards that are dragged are not snapped while a folder takes them, and
		// never jump when it takes them or lets go of them (dropping into a folder).
		let snapped: { readonly changes: NodeChange<BaseHalfCanvasFlowNode>[]; readonly guides: readonly IBaseHalfCanvasSnapGuide[] };
		if (drag && !drag.cancelled) {
			const held = snapBaseHalfCanvasHeldCards(nodesRef.current, nonSelectionChanges, options, drag.heldSnap ?? BASEHALF_CANVAS_HELD_SNAP_NONE, !!drag.takenByFolder);
			drag.heldSnap = held.held;
			snapped = held;
		} else {
			snapped = snapBaseHalfCanvasFlowNodeChanges(nodesRef.current, nonSelectionChanges, options);
		}
		setGuides(current => sameBaseHalfCanvasSnapGuides(current, snapped.guides) ? current : snapped.guides);
		const next = vendor.applyNodeChanges(snapped.changes, nodesRef.current);
		setLiveNodes(next);
		commitFinalGeometry(next, snapped.changes, reason);
	}, [commitFinalGeometry, queueSelectionChanges, setLiveNodes]);
	const onNodesChange = vendor.useCallback((changes: NodeChange<BaseHalfCanvasFlowNode>[]) => {
		applyNodesChange(changes, false);
	}, [applyNodesChange]);

	return { applyNodesChange, onNodesChange };
}
