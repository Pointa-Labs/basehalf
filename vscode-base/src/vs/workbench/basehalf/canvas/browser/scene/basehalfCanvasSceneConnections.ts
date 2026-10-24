/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { BaseHalfCanvasAnchor } from '../../common/basehalfCanvasModel.js';
import {
	IBaseHalfCanvasSceneConnection,
	baseHalfCanvasOppositeAnchor,
	baseHalfCanvasSceneConnectionRefusal,
	IBaseHalfCanvasSceneEdge,
	IBaseHalfCanvasSceneSelection,
	IBaseHalfCanvasSceneSnapshot,
	resolveBaseHalfCanvasSceneConnectionDrop
} from '../../common/basehalfCanvasScene.js';
import type { Connection, FinalConnectionState, ReactFlowInstance } from '@xyflow/react';
import type { Dispatch, SetStateAction, RefObject } from 'react';
import {
	BaseHalfCanvasFlowEdge,
	BaseHalfCanvasFlowNode,
	flowPosition,
	IBaseHalfCanvasConnectionStoreController,
	IBaseHalfCanvasEdgeInteraction,
	IBaseHalfCanvasSceneEnvironment
} from './basehalfCanvasSceneShared.js';

export type BaseHalfCanvasConnectionGesture = 'pointer' | 'click';

export interface IBaseHalfCanvasPendingConnectionOwner {
	readonly token: number;
	readonly sceneKey: string;
	readonly structuralEpoch: number;
	readonly gesture: BaseHalfCanvasConnectionGesture;
}

export type BaseHalfCanvasPendingConnectionStart =
	| { readonly kind: 'owned'; readonly previous: IBaseHalfCanvasPendingConnectionOwner | undefined }
	| { readonly kind: 'deferred-to-click' }
	| { readonly kind: 'rejected-trailing-click' };

export type BaseHalfCanvasPendingPointerFinish =
	| { readonly kind: 'owned'; readonly owner: IBaseHalfCanvasPendingConnectionOwner }
	| { readonly kind: 'deferred-to-click' }
	| { readonly kind: 'none' };

/**
 * Owns the one connection gesture that may mutate the live scene. Clearing the
 * owner is synchronous so a trailing library callback cannot complete a
 * gesture after the user has cancelled it.
 */
export class BaseHalfCanvasPendingConnectionState {
	private sequence = 0;
	private owner: IBaseHalfCanvasPendingConnectionOwner | undefined;
	private pointerAttemptDuringClick = false;
	private rejectTrailingClickStart = false;

	begin(
		sceneKey: string,
		structuralEpoch: number,
		gesture: BaseHalfCanvasConnectionGesture,
		options?: { readonly rejectableTrailingClick?: boolean }
	): BaseHalfCanvasPendingConnectionStart {
		if (gesture === 'pointer') {
			this.rejectTrailingClickStart = false;
			if (this.owner?.gesture === 'click') {
				// The destination click emits pointer start/end before click completion.
				// Keep the original click owner and reject mutations from that transient attempt.
				this.pointerAttemptDuringClick = true;
				return Object.freeze({ kind: 'deferred-to-click' });
			}
		} else if (this.rejectTrailingClickStart) {
			this.rejectTrailingClickStart = false;
			if (options?.rejectableTrailingClick) {
				return Object.freeze({ kind: 'rejected-trailing-click' });
			}
		}

		this.pointerAttemptDuringClick = false;
		const previous = this.owner;
		this.owner = Object.freeze({ token: ++this.sequence, sceneKey, structuralEpoch, gesture });
		return Object.freeze({ kind: 'owned', previous });
	}

	peek(): IBaseHalfCanvasPendingConnectionOwner | undefined {
		return this.owner;
	}

	peekMutationOwner(): IBaseHalfCanvasPendingConnectionOwner | undefined {
		return this.pointerAttemptDuringClick ? undefined : this.owner;
	}

	finishPointer(): BaseHalfCanvasPendingPointerFinish {
		if (this.pointerAttemptDuringClick) {
			this.pointerAttemptDuringClick = false;
			return Object.freeze({ kind: 'deferred-to-click' });
		}
		if (this.owner?.gesture !== 'pointer') {
			return Object.freeze({ kind: 'none' });
		}
		const owner = this.owner;
		this.owner = undefined;
		return Object.freeze({ kind: 'owned', owner });
	}

	take(gesture: BaseHalfCanvasConnectionGesture): IBaseHalfCanvasPendingConnectionOwner | undefined {
		if (this.owner?.gesture !== gesture) {
			return undefined;
		}
		const owner = this.owner;
		this.owner = undefined;
		return owner;
	}

	cancel(rejectTrailingClickStart = false): IBaseHalfCanvasPendingConnectionOwner | undefined {
		const owner = this.owner;
		this.owner = undefined;
		this.rejectTrailingClickStart ||= rejectTrailingClickStart
			&& (owner?.gesture === 'pointer' || this.pointerAttemptDuringClick);
		this.pointerAttemptDuringClick = false;
		return owner;
	}

	reset(): IBaseHalfCanvasPendingConnectionOwner | undefined {
		const owner = this.cancel();
		this.rejectTrailingClickStart = false;
		return owner;
	}
}

export type BaseHalfCanvasPendingEdgeMutation =
	| { readonly token: number; readonly kind: 'upsert'; readonly edge: IBaseHalfCanvasSceneEdge }
	| { readonly token: number; readonly kind: 'delete' };

/** How long a kept connection line waits for the chosen node's edge. */
const CONNECTION_DROP_LINE_EDGE_TIMEOUT_MS = 2000;

export interface IBaseHalfCanvasDropLine {
	readonly token: number;
	readonly sceneKey: string;
	readonly source: string;
	readonly path: string;
	/** Edges from the source when the line was released; a new one replaces the line. */
	readonly knownEdgeIds: ReadonlySet<string>;
	readonly awaitingEdge: boolean;
}

function anchorFromHandle(value: string | null | undefined, fallback: BaseHalfCanvasAnchor): BaseHalfCanvasAnchor {
	return value === 'north' || value === 'east' || value === 'south' || value === 'west' ? value : fallback;
}

function sceneEdgeId(from: string, to: string): string {
	return `${from}\u0000${to}`;
}

/**
 * Connections on the scene: connecting two cards by dragging or clicking, the
 * line that is kept while Create from Connection asks what to make,
 * reconnecting and removing connections. Each change shows at once and is
 * undone on the scene when the canvas view cannot save it.
 */
export function useBaseHalfCanvasSceneConnections(environment: IBaseHalfCanvasSceneEnvironment, scene: {
	readonly snapshotRef: RefObject<IBaseHalfCanvasSceneSnapshot>;
	readonly sceneKeyRef: RefObject<string>;
	readonly structuralEpochRef: RefObject<number>;
	readonly mutationSequence: RefObject<number>;
	readonly flowRef: RefObject<ReactFlowInstance<BaseHalfCanvasFlowNode, BaseHalfCanvasFlowEdge> | undefined>;
	readonly pendingEdges: RefObject<Map<string, BaseHalfCanvasPendingEdgeMutation>>;
	readonly pendingConnection: RefObject<BaseHalfCanvasPendingConnectionState>;
	readonly connectionStoreController: RefObject<IBaseHalfCanvasConnectionStoreController | undefined>;
	readonly dropLine: IBaseHalfCanvasDropLine | undefined;
	readonly setDropLine: Dispatch<SetStateAction<IBaseHalfCanvasDropLine | undefined>>;
	readonly dropLineToken: RefObject<number>;
	readonly dropLineElement: RefObject<SVGSVGElement | null>;
	readonly beginInteraction: () => void;
	readonly endInteraction: () => void;
	readonly makeEdge: (edge: IBaseHalfCanvasSceneEdge, sceneKey: string, structuralEpoch: number, selected?: boolean) => BaseHalfCanvasFlowEdge;
	readonly nodesRef: RefObject<BaseHalfCanvasFlowNode[]>;
	readonly edges: BaseHalfCanvasFlowEdge[];
	readonly edgesRef: RefObject<BaseHalfCanvasFlowEdge[]>;
	readonly setLiveEdges: (next: BaseHalfCanvasFlowEdge[]) => void;
	readonly requestSelection: (selection: IBaseHalfCanvasSceneSelection) => Promise<boolean>;
	readonly updateSnapshot: (snapshot: IBaseHalfCanvasSceneSnapshot) => void;
}) {
	const { vendor, host, delegate } = environment;
	const {
		snapshotRef, sceneKeyRef, structuralEpochRef, mutationSequence, flowRef, pendingEdges,
		pendingConnection, connectionStoreController, dropLine, setDropLine, dropLineToken,
		dropLineElement, beginInteraction, endInteraction, makeEdge, nodesRef, edges, edgesRef,
		setLiveEdges, requestSelection, updateSnapshot
	} = scene;

	const beginConnection = vendor.useCallback((gesture: BaseHalfCanvasConnectionGesture, event?: MouseEvent | TouchEvent) => {
		const start = pendingConnection.current.begin(sceneKeyRef.current, structuralEpochRef.current, gesture, {
			rejectableTrailingClick: gesture === 'click' && (event?.detail ?? 0) > 0
		});
		if (start.kind === 'deferred-to-click') {
			return;
		}
		if (start.kind === 'rejected-trailing-click') {
			host.ownerDocument.defaultView?.queueMicrotask(() => connectionStoreController.current?.cancel());
			return;
		}
		if (start.previous) {
			endInteraction();
		}
		if (gesture === 'pointer') {
			connectionStoreController.current?.clearClickStart();
		} else {
			connectionStoreController.current?.cancel();
		}
		beginInteraction();
	}, [beginInteraction, endInteraction]);

	const optimisticConnect = vendor.useCallback((connection: Connection) => {
		if (!connection.source || !connection.target) {
			return;
		}
		if (connection.source === connection.target) {
			delegate.reportError(new Error('A node cannot provide context to itself.'));
			return;
		}
		const owner = pendingConnection.current.peekMutationOwner();
		const operationKey = owner?.sceneKey;
		const operationEpoch = owner?.structuralEpoch;
		const sourceNode = nodesRef.current.find(node => node.id === connection.source);
		const targetNode = nodesRef.current.find(node => node.id === connection.target);
		if (!operationKey || operationEpoch === undefined || operationKey !== sceneKeyRef.current || operationEpoch !== structuralEpochRef.current
			|| sourceNode?.data.sceneKey !== operationKey || sourceNode.data.structuralEpoch !== operationEpoch
			|| targetNode?.data.sceneKey !== operationKey || targetNode.data.structuralEpoch !== operationEpoch) {
			return;
		}
		const refusal = baseHalfCanvasSceneConnectionRefusal(targetNode.data.card);
		if (refusal) {
			delegate.reportError(new Error(refusal));
			return;
		}
		const intent: IBaseHalfCanvasSceneConnection = {
			from: connection.source,
			fromKind: sourceNode.data.card.kind,
			fromAnchor: anchorFromHandle(connection.sourceHandle, 'east'),
			to: connection.target,
			toKind: targetNode.data.card.kind,
			toAnchor: anchorFromHandle(connection.targetHandle, 'west')
		};
		const edge: IBaseHalfCanvasSceneEdge = {
			id: sceneEdgeId(intent.from, intent.to),
			from: intent.from,
			fromKind: intent.fromKind,
			from_anchor: intent.fromAnchor,
			to: intent.to,
			toKind: intent.toKind,
			to_anchor: intent.toAnchor
		};
		if (edgesRef.current.some(candidate => candidate.id === edge.id)) {
			delegate.reportError(new Error('This context connection already exists.'));
			return;
		}
		const token = ++mutationSequence.current;
		pendingEdges.current.set(edge.id, { token, kind: 'upsert', edge });
		setLiveEdges([...edgesRef.current.filter(candidate => candidate.id !== edge.id), makeEdge(edge, operationKey, operationEpoch, true)]);
		void delegate.connect(operationKey, operationEpoch, intent).then(() => {
			if (sceneKeyRef.current === operationKey && structuralEpochRef.current === operationEpoch && pendingEdges.current.get(edge.id)?.token === token) {
				pendingEdges.current.delete(edge.id);
			}
		}).catch(error => {
			if (sceneKeyRef.current !== operationKey || structuralEpochRef.current !== operationEpoch || pendingEdges.current.get(edge.id)?.token !== token) {
				return;
			}
			pendingEdges.current.delete(edge.id);
			updateSnapshot(snapshotRef.current);
			delegate.reportError(error);
		});
	}, [makeEdge, setLiveEdges, updateSnapshot]);

	const finishPointerConnect = vendor.useCallback((_event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
		const finish = pendingConnection.current.finishPointer();
		if (finish.kind !== 'owned') {
			return;
		}
		const owner = finish.owner;
		const operationKey = owner.sceneKey;
		const operationEpoch = owner.structuralEpoch;
		endInteraction();

		if (operationKey !== sceneKeyRef.current || operationEpoch !== structuralEpochRef.current
			|| !state.fromNode || state.toNode) {
			return;
		}
		const sourceNode = nodesRef.current.find(node => node.id === state.fromNode?.id);
		if (sourceNode?.data.sceneKey !== operationKey || sourceNode.data.structuralEpoch !== operationEpoch) {
			return;
		}
		const bounds = host.getBoundingClientRect();
		const client = {
			x: bounds.left + state.pointer.x,
			y: bounds.top + state.pointer.y
		};
		if (client.x < bounds.left || client.x > bounds.right || client.y < bounds.top || client.y > bounds.bottom) {
			return;
		}
		const hit = host.ownerDocument.elementFromPoint(client.x, client.y);
		if (hit?.closest('.react-flow__node, .react-flow__edge, .basehalf-canvas-set-box')) {
			return;
		}
		const flow = flowRef.current;
		if (!flow) {
			return;
		}
		const drop = resolveBaseHalfCanvasSceneConnectionDrop({
			from: sourceNode.id,
			fromKind: sourceNode.data.card.kind,
			fromAnchor: anchorFromHandle(state.fromHandle?.id, 'east')
		}, false, flow.screenToFlowPosition(client), client);
		if (!drop) {
			return;
		}
		const token = ++dropLineToken.current;
		// `state.from` is in flow coordinates but `state.to` is relative to the
		// container in screen pixels; the drop position is the release point
		// in flow coordinates.
		const [path] = vendor.getBezierPath({
			sourceX: state.from.x,
			sourceY: state.from.y,
			sourcePosition: state.fromPosition,
			targetX: drop.position.x,
			targetY: drop.position.y,
			targetPosition: state.toPosition ?? flowPosition(vendor, baseHalfCanvasOppositeAnchor(drop.fromAnchor))
		});
		setDropLine({
			token,
			sceneKey: operationKey,
			source: drop.from,
			path,
			knownEdgeIds: new Set(edgesRef.current.filter(edge => edge.source === drop.from).map(edge => edge.id)),
			awaitingEdge: false
		});
		const clear = () => setDropLine(current => current?.token === token ? undefined : current);
		void delegate.showConnectionCreateMenu(operationKey, operationEpoch, drop).then(created => {
			if (!created) {
				// Hide it in the task that closed the menu; React removes it
				// on its next render.
				if (dropLineToken.current === token) {
					dropLineElement.current?.style.setProperty('display', 'none');
				}
				clear();
				return;
			}
			setDropLine(current => current?.token === token ? { ...current, awaitingEdge: true } : current);
			host.ownerDocument.defaultView?.setTimeout(clear, CONNECTION_DROP_LINE_EDGE_TIMEOUT_MS);
		}, error => {
			clear();
			delegate.reportError(error);
		});
	}, [endInteraction]);
	vendor.useEffect(() => {
		// The chosen node's edge replaces the kept line as soon as it is drawn.
		if (dropLine?.awaitingEdge && edges.some(edge => edge.source === dropLine.source && !dropLine.knownEdgeIds.has(edge.id))) {
			setDropLine(current => current?.token === dropLine.token ? undefined : current);
		}
	}, [dropLine, edges]);
	const finishClickConnect = vendor.useCallback(() => {
		const owner = pendingConnection.current.take('click');
		if (owner) {
			endInteraction();
		}
	}, [endInteraction]);

	const optimisticReconnect = vendor.useCallback((flowEdge: BaseHalfCanvasFlowEdge, connection: Connection) => {
		const previous = flowEdge.data?.edge;
		const operationKey = flowEdge.data?.sceneKey;
		const operationEpoch = flowEdge.data?.structuralEpoch;
		if (!previous || !operationKey || operationEpoch === undefined || operationKey !== sceneKeyRef.current || operationEpoch !== structuralEpochRef.current
			|| !connection.source || !connection.target) {
			return;
		}
		if (connection.source === connection.target) {
			delegate.reportError(new Error('A node cannot provide context to itself.'));
			return;
		}
		const sourceNode = nodesRef.current.find(node => node.id === connection.source);
		const targetNode = nodesRef.current.find(node => node.id === connection.target);
		if (sourceNode?.data.sceneKey !== operationKey || sourceNode.data.structuralEpoch !== operationEpoch
			|| targetNode?.data.sceneKey !== operationKey || targetNode.data.structuralEpoch !== operationEpoch) {
			return;
		}
		const refusal = baseHalfCanvasSceneConnectionRefusal(targetNode.data.card, previous.to);
		if (refusal) {
			delegate.reportError(new Error(refusal));
			return;
		}
		const next: IBaseHalfCanvasSceneConnection = {
			from: connection.source,
			fromKind: sourceNode.data.card.kind,
			fromAnchor: anchorFromHandle(connection.sourceHandle, previous.from_anchor),
			to: connection.target,
			toKind: targetNode.data.card.kind,
			toAnchor: anchorFromHandle(connection.targetHandle, previous.to_anchor)
		};
		const nextEdge: IBaseHalfCanvasSceneEdge = {
			id: sceneEdgeId(next.from, next.to),
			from: next.from,
			fromKind: next.fromKind,
			from_anchor: next.fromAnchor,
			to: next.to,
			toKind: next.toKind,
			to_anchor: next.toAnchor
		};
		if (nextEdge.id !== previous.id && edgesRef.current.some(candidate => candidate.id === nextEdge.id)) {
			delegate.reportError(new Error('This context connection already exists.'));
			return;
		}
		const token = ++mutationSequence.current;
		if (previous.id !== nextEdge.id) {
			pendingEdges.current.set(previous.id, { token, kind: 'delete' });
		}
		pendingEdges.current.set(nextEdge.id, { token, kind: 'upsert', edge: nextEdge });
		setLiveEdges([
			...edgesRef.current.filter(candidate => candidate.id !== previous.id && candidate.id !== nextEdge.id),
			makeEdge(nextEdge, operationKey, operationEpoch, true)
		]);
		void delegate.reconnect(operationKey, operationEpoch, { previous, next }).then(() => {
			if (sceneKeyRef.current !== operationKey || structuralEpochRef.current !== operationEpoch) {
				return;
			}
			for (const id of new Set([previous.id, nextEdge.id])) {
				if (pendingEdges.current.get(id)?.token === token) {
					pendingEdges.current.delete(id);
				}
			}
		}).catch(error => {
			if (sceneKeyRef.current !== operationKey || structuralEpochRef.current !== operationEpoch) {
				return;
			}
			let shouldReconcile = false;
			for (const id of new Set([previous.id, nextEdge.id])) {
				if (pendingEdges.current.get(id)?.token === token) {
					pendingEdges.current.delete(id);
					shouldReconcile = true;
				}
			}
			if (shouldReconcile) {
				updateSnapshot(snapshotRef.current);
			}
			delegate.reportError(error);
		});
	}, [makeEdge, setLiveEdges, updateSnapshot]);

	// Every edge removed together is one disconnect, one step of undo.
	const removeEdges = vendor.useCallback((deleted: readonly BaseHalfCanvasFlowEdge[]) => {
		const operationKey = sceneKeyRef.current;
		const operationEpoch = structuralEpochRef.current;
		const edges = deleted.flatMap(flowEdge => flowEdge.data?.edge && flowEdge.data.sceneKey === operationKey && flowEdge.data.structuralEpoch === operationEpoch
			? [flowEdge.data.edge]
			: []);
		if (edges.length === 0) {
			return;
		}
		const token = ++mutationSequence.current;
		for (const edge of edges) {
			pendingEdges.current.set(edge.id, { token, kind: 'delete' });
		}
		const settle = (): boolean => {
			if (sceneKeyRef.current !== operationKey || structuralEpochRef.current !== operationEpoch) {
				return false;
			}
			let settled = false;
			for (const edge of edges) {
				if (pendingEdges.current.get(edge.id)?.token === token) {
					pendingEdges.current.delete(edge.id);
					settled = true;
				}
			}
			return settled;
		};
		void delegate.removeEdges(operationKey, operationEpoch, edges).then(settle).catch(error => {
			if (settle()) {
				updateSnapshot(snapshotRef.current);
				delegate.reportError(error);
			}
		});
	}, [updateSnapshot]);

	const ownsCurrentEdge = vendor.useCallback((flowEdge: BaseHalfCanvasFlowEdge): boolean => {
		const data = flowEdge.data;
		return !!data
			&& data.sceneKey === sceneKeyRef.current
			&& data.structuralEpoch === structuralEpochRef.current
			&& edgesRef.current.some(candidate => candidate.id === flowEdge.id
				&& candidate.data?.sceneKey === data.sceneKey
				&& candidate.data.structuralEpoch === data.structuralEpoch);
	}, []);
	const edgeInteraction = vendor.useMemo<IBaseHalfCanvasEdgeInteraction>(() => ({
		begin(flowEdge): boolean {
			if (!ownsCurrentEdge(flowEdge)) {
				return false;
			}
			host.focus({ preventScroll: true });
			beginInteraction();
			return true;
		},
		end: endInteraction,
		select(flowEdge, preserveFocus = false): void {
			if (!ownsCurrentEdge(flowEdge)) {
				return;
			}
			if (!preserveFocus) {
				host.focus({ preventScroll: true });
			}
			void requestSelection({ edgeIds: [flowEdge.id] });
		},
		reconnect: optimisticReconnect,
		remove(flowEdge): void {
			if (!ownsCurrentEdge(flowEdge)) {
				return;
			}
			setLiveEdges(edgesRef.current.filter(candidate => candidate.id !== flowEdge.id));
			removeEdges([flowEdge]);
		}
	}), [beginInteraction, endInteraction, optimisticReconnect, ownsCurrentEdge, removeEdges, requestSelection, setLiveEdges]);

	return { beginConnection, optimisticConnect, finishPointerConnect, finishClickConnect, removeEdges, edgeInteraction };
}
