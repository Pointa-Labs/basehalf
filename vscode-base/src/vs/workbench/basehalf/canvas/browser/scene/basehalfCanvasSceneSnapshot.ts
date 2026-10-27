/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IBaseHalfCanvasSnapGuide } from '../../common/basehalfCanvasSnap.js';
import { IBaseHalfCanvasSceneCard, IBaseHalfCanvasSceneEdge, IBaseHalfCanvasSceneSnapshot } from '../../common/basehalfCanvasScene.js';
import type { Dispatch, SetStateAction, RefObject } from 'react';
import { BaseHalfCanvasPendingConnectionState, BaseHalfCanvasPendingEdgeMutation } from './basehalfCanvasSceneConnections.js';
import { IBaseHalfCanvasPendingGeometry } from './basehalfCanvasSceneGeometry.js';
import { IBaseHalfCanvasNodeDragState } from './basehalfCanvasSceneNodeDrag.js';
import { BaseHalfCanvasSelectionIntentCoordinator, IBaseHalfCanvasPendingSelectionChanges, IBaseHalfCanvasPendingSelectionRequest } from './basehalfCanvasSceneSelection.js';
import {
	BaseHalfCanvasFlowEdge,
	BaseHalfCanvasFlowNode,
	IBaseHalfCanvasConnectionStoreController,
	IBaseHalfCanvasSceneEnvironment,
	IBaseHalfCanvasVideoPanelFollow
} from './basehalfCanvasSceneShared.js';

/**
 * Taking a new snapshot from the canvas view. A snapshot of another folder or
 * another structure ends whatever was going on; otherwise the scene keeps the
 * places, connections, and selection that are still being saved.
 */
export function useBaseHalfCanvasSceneSnapshot(environment: IBaseHalfCanvasSceneEnvironment, scene: {
	readonly snapshotRef: RefObject<IBaseHalfCanvasSceneSnapshot>;
	readonly sceneKeyRef: RefObject<string>;
	readonly structuralEpochRef: RefObject<number>;
	readonly pendingGeometry: RefObject<Map<string, IBaseHalfCanvasPendingGeometry>>;
	readonly pendingEdges: RefObject<Map<string, BaseHalfCanvasPendingEdgeMutation>>;
	readonly pendingSelectionChanges: RefObject<IBaseHalfCanvasPendingSelectionChanges>;
	readonly interactionDepth: RefObject<number>;
	readonly pendingConnection: RefObject<BaseHalfCanvasPendingConnectionState>;
	readonly selectionIntents: RefObject<BaseHalfCanvasSelectionIntentCoordinator>;
	readonly pendingSelectionRequest: RefObject<IBaseHalfCanvasPendingSelectionRequest | undefined>;
	readonly connectionStoreController: RefObject<IBaseHalfCanvasConnectionStoreController | undefined>;
	readonly nodeDragState: RefObject<IBaseHalfCanvasNodeDragState | undefined>;
	/** The cards let go on a folder, which stay hidden until their items have moved (dropping into a folder). */
	readonly droppedPaths: RefObject<ReadonlySet<string>>;
	readonly keyboardGeometryTimer: RefObject<number | undefined>;
	readonly keyboardGeometryInteractionActive: RefObject<boolean>;
	readonly keyboardGeometryPath: RefObject<string | undefined>;
	readonly keyboardGeometryPosition: RefObject<{ x: number; y: number } | undefined>;
	readonly interacting: RefObject<boolean>;
	readonly setGuides: Dispatch<SetStateAction<readonly IBaseHalfCanvasSnapGuide[]>>;
	readonly setVideoPanelFollow: Dispatch<SetStateAction<IBaseHalfCanvasVideoPanelFollow | undefined>>;
	readonly revealNodeDragChrome: (drag: IBaseHalfCanvasNodeDragState) => void;
	readonly beginNodeResize: (path: string) => void;
	readonly endNodeResize: (path: string) => void;
	readonly makeNode: (card: IBaseHalfCanvasSceneCard, sceneKey: string, structuralEpoch: number, selected?: boolean) => BaseHalfCanvasFlowNode;
	readonly makeEdge: (edge: IBaseHalfCanvasSceneEdge, sceneKey: string, structuralEpoch: number, selected?: boolean) => BaseHalfCanvasFlowEdge;
	readonly nodesRef: RefObject<BaseHalfCanvasFlowNode[]>;
	readonly setLiveNodes: (next: BaseHalfCanvasFlowNode[]) => void;
	readonly edgesRef: RefObject<BaseHalfCanvasFlowEdge[]>;
	readonly setLiveEdges: (next: BaseHalfCanvasFlowEdge[]) => void;
}) {
	const { vendor, host } = environment;
	const {
		snapshotRef, sceneKeyRef, structuralEpochRef, pendingGeometry, pendingEdges,
		pendingSelectionChanges, interactionDepth, pendingConnection, selectionIntents,
		pendingSelectionRequest, connectionStoreController, nodeDragState, droppedPaths, keyboardGeometryTimer,
		keyboardGeometryInteractionActive, keyboardGeometryPath, keyboardGeometryPosition,
		interacting, setGuides, setVideoPanelFollow, revealNodeDragChrome, beginNodeResize,
		endNodeResize, makeNode, makeEdge, nodesRef, setLiveNodes, edgesRef, setLiveEdges
	} = scene;

	const updateSnapshot = vendor.useCallback((snapshot: IBaseHalfCanvasSceneSnapshot) => {
		const keyChanged = sceneKeyRef.current !== snapshot.key;
		const structureChanged = structuralEpochRef.current !== snapshot.structuralEpoch;
		const identityChanged = keyChanged || structureChanged;
		const selectionControlledByHost = snapshot.selectedCardPaths !== undefined || snapshot.selectedEdgeIds !== undefined;
		if (!identityChanged && snapshot.revision < snapshotRef.current.revision) {
			return;
		}
		sceneKeyRef.current = snapshot.key;
		structuralEpochRef.current = snapshot.structuralEpoch;
		snapshotRef.current = snapshot;
		// A selection asked before the canvas was drawn again still counts, unless
		// another folder is shown or the workbench sets the selection itself.
		if (keyChanged || selectionControlledByHost) {
			selectionIntents.current.invalidate();
			pendingSelectionRequest.current = undefined;
			pendingSelectionChanges.current.nodes.clear();
			pendingSelectionChanges.current.edges.clear();
			pendingSelectionChanges.current.lastPositive = undefined;
		}
		if (identityChanged) {
			if (keyboardGeometryTimer.current !== undefined) {
				host.ownerDocument.defaultView?.clearTimeout(keyboardGeometryTimer.current);
				keyboardGeometryTimer.current = undefined;
			}
			keyboardGeometryInteractionActive.current = false;
			keyboardGeometryPath.current = undefined;
			keyboardGeometryPosition.current = undefined;
			pendingGeometry.current.clear();
			pendingEdges.current.clear();
			interactionDepth.current = 0;
			interacting.current = false;
			pendingConnection.current.reset();
			connectionStoreController.current?.cancel();
			const drag = nodeDragState.current;
			nodeDragState.current = undefined;
			if (drag) {
				revealNodeDragChrome(drag);
			}
			setVideoPanelFollow(undefined);
			setGuides([]);
		}

		const currentNodeById = new Map(nodesRef.current.map(node => [node.id, node]));
		const selectedCards = selectionControlledByHost ? new Set(snapshot.selectedCardPaths ?? []) : undefined;
		const nextNodes = snapshot.cards.map(card => {
			const current = currentNodeById.get(card.path);
			const selected = selectedCards ? selectedCards.has(card.path) : current?.selected ?? false;
			const pending = pendingGeometry.current.get(card.path);
			if (pending
				&& pending.geometry.x === card.x
				&& pending.geometry.y === card.y
				&& pending.geometry.width === card.width
				&& pending.geometry.height === card.height) {
				pendingGeometry.current.delete(card.path);
			}
			if (!identityChanged && current
				&& (pending !== undefined || keyboardGeometryPath.current === card.path)) {
				return {
					...current,
					data: {
						card,
						sceneKey: snapshot.key,
						structuralEpoch: snapshot.structuralEpoch,
						beginResize: () => beginNodeResize(card.path),
						endResize: () => endNodeResize(card.path)
					},
					selected
				};
			}
			return makeNode(card, snapshot.key, snapshot.structuralEpoch, selected);
		}).map(node => droppedPaths.current.has(node.id) ? { ...node, hidden: true, selected: false } : node);
		setLiveNodes(nextNodes);

		const currentEdgeById = new Map(edgesRef.current.map(edge => [edge.id, edge]));
		const incomingIds = new Set(snapshot.edges.map(edge => edge.id));
		const nextEdges: BaseHalfCanvasFlowEdge[] = [];
		for (const edge of snapshot.edges) {
			const mutation = identityChanged ? undefined : pendingEdges.current.get(edge.id);
			if (mutation?.kind === 'delete') {
				continue;
			}
			const projected = mutation?.kind === 'upsert' ? mutation.edge : edge;
			const current = currentEdgeById.get(projected.id);
				nextEdges.push(makeEdge(
					projected,
					snapshot.key,
					snapshot.structuralEpoch,
					selectionControlledByHost ? snapshot.selectedEdgeIds?.includes(projected.id) ?? false : current?.selected ?? false
				));
		}
		if (!identityChanged) {
			for (const [id, mutation] of pendingEdges.current) {
				if (mutation.kind !== 'upsert' || incomingIds.has(id)) {
					continue;
				}
				const current = currentEdgeById.get(id);
				nextEdges.push(makeEdge(mutation.edge, snapshot.key, snapshot.structuralEpoch, current?.selected ?? true));
			}
		}
		setLiveEdges(nextEdges);
	}, [beginNodeResize, endNodeResize, makeEdge, makeNode, revealNodeDragChrome, setLiveEdges, setLiveNodes]);

	return { updateSnapshot };
}
