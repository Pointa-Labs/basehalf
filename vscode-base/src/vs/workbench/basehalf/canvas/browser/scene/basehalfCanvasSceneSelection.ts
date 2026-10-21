/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IBaseHalfCanvasSceneSelection } from '../../common/basehalfCanvasScene.js';
import type { RefObject } from 'react';
import { BaseHalfCanvasFlowEdge, BaseHalfCanvasFlowNode, IBaseHalfCanvasSceneEnvironment } from './basehalfCanvasSceneShared.js';

export class BaseHalfCanvasSelectionIntentCoordinator {
	private sequence = 0;
	private queue: Promise<void> = Promise.resolve();

	invalidate(): void {
		this.sequence++;
	}

	request(prepare: () => Promise<boolean>, commit: () => unknown): Promise<boolean> {
		const sequence = ++this.sequence;
		let resolveResult!: (value: boolean) => void;
		let rejectResult!: (reason: unknown) => void;
		const result = new Promise<boolean>((resolve, reject) => {
			resolveResult = resolve;
			rejectResult = reject;
		});
		const run = async (): Promise<void> => {
			try {
				const allowed = await prepare();
				if (!allowed || sequence !== this.sequence) {
					resolveResult(false);
					return;
				}
				resolveResult(commit() !== false);
			} catch (error) {
				rejectResult(error);
				throw error;
			}
		};
		this.queue = this.queue.then(run, run).then(() => undefined, () => undefined);
		return result;
	}
}

/** The selection last asked of the canvas view, while its answer is awaited. */
export interface IBaseHalfCanvasPendingSelectionRequest {
	readonly key: string;
	readonly promise: Promise<boolean>;
}

/** The changes of the selection that React Flow reported in this task, applied together. */
export interface IBaseHalfCanvasPendingSelectionChanges {
	readonly nodes: Map<string, boolean>;
	readonly edges: Map<string, boolean>;
	/** Whether a card or a connection was selected last; the other is then deselected. */
	lastPositive: 'node' | 'edge' | undefined;
	scheduled: boolean;
}

/**
 * Changing the selection. Every change of the selected cards and connection is
 * asked of the canvas view first, which may refuse it, for example while a
 * Note cannot close; requests run in order and a newer one wins. Changes that
 * React Flow reports in one task are applied together.
 */
export function useBaseHalfCanvasSceneSelection(environment: IBaseHalfCanvasSceneEnvironment, scene: {
	readonly sceneKeyRef: RefObject<string>;
	readonly structuralEpochRef: RefObject<number>;
	readonly pendingSelectionChanges: RefObject<IBaseHalfCanvasPendingSelectionChanges>;
	readonly selectionIntents: RefObject<BaseHalfCanvasSelectionIntentCoordinator>;
	readonly pendingSelectionRequest: RefObject<IBaseHalfCanvasPendingSelectionRequest | undefined>;
	readonly nodesRef: RefObject<BaseHalfCanvasFlowNode[]>;
	readonly setLiveNodes: (next: BaseHalfCanvasFlowNode[]) => void;
	readonly edgesRef: RefObject<BaseHalfCanvasFlowEdge[]>;
	readonly setLiveEdges: (next: BaseHalfCanvasFlowEdge[]) => void;
}) {
	const { vendor, delegate } = environment;
	const {
		sceneKeyRef, structuralEpochRef, pendingSelectionChanges, selectionIntents,
		pendingSelectionRequest, nodesRef, setLiveNodes, edgesRef, setLiveEdges
	} = scene;

	const requestSelection = vendor.useCallback((selection: IBaseHalfCanvasSceneSelection): Promise<boolean> => {
		const sceneKey = sceneKeyRef.current;
		const structuralEpoch = structuralEpochRef.current;
		const selectedCards = new Set(selection.cardPaths ?? []);
		const selectedEdgeId = selection.edgeId;
		const requestKey = JSON.stringify({ sceneKey, structuralEpoch, cards: [...selectedCards].sort(), edge: selectedEdgeId });
		const pending = pendingSelectionRequest.current;
		if (pending?.key === requestKey) {
			return pending.promise;
		}
		const currentCards = nodesRef.current.filter(node => node.selected).map(node => node.id);
		const currentEdgeId = edgesRef.current.find(edge => edge.selected)?.id;
		if (currentCards.length === selectedCards.size
			&& currentCards.every(path => selectedCards.has(path))
			&& currentEdgeId === selectedEdgeId) {
			selectionIntents.current.invalidate();
			pendingSelectionRequest.current = undefined;
			return Promise.resolve(true);
		}
		const promise = selectionIntents.current.request(
			() => delegate.prepareSelectionChange(sceneKey, structuralEpoch, [...selectedCards]),
			() => {
				if (sceneKeyRef.current !== sceneKey || structuralEpochRef.current !== structuralEpoch) {
					return false;
				}
				setLiveNodes(nodesRef.current.map(node => ({ ...node, selected: selectedCards.has(node.id) })));
				setLiveEdges(edgesRef.current.map(edge => ({ ...edge, selected: edge.id === selectedEdgeId })));
				return true;
			}
		).catch(error => {
			delegate.reportError(error);
			return false;
		});
		const request = { key: requestKey, promise };
		pendingSelectionRequest.current = request;
		void promise.finally(() => {
			if (pendingSelectionRequest.current === request) {
				pendingSelectionRequest.current = undefined;
			}
		});
		return promise;
	}, [setLiveEdges, setLiveNodes]);
	const queueSelectionChanges = vendor.useCallback((
		nodeChanges: readonly { readonly id: string; readonly selected: boolean }[] = [],
		edgeChanges: readonly { readonly id: string; readonly selected: boolean }[] = []
	): void => {
		const pending = pendingSelectionChanges.current;
		for (const change of nodeChanges) {
			pending.nodes.set(change.id, change.selected);
			if (change.selected) {
				pending.lastPositive = 'node';
			}
		}
		for (const change of edgeChanges) {
			pending.edges.set(change.id, change.selected);
			if (change.selected) {
				pending.lastPositive = 'edge';
			}
		}
		if (pending.scheduled) {
			return;
		}
		pending.scheduled = true;
		queueMicrotask(() => {
			const batch = pendingSelectionChanges.current;
			batch.scheduled = false;
			const selectedCards = new Set(nodesRef.current.filter(node => node.selected).map(node => node.id));
			let selectedEdgeId = edgesRef.current.find(edge => edge.selected)?.id;
			for (const [id, selected] of batch.nodes) {
				if (selected) {
					selectedCards.add(id);
				} else {
					selectedCards.delete(id);
				}
			}
			for (const [id, selected] of batch.edges) {
				if (selected) {
					selectedEdgeId = id;
				} else if (selectedEdgeId === id) {
					selectedEdgeId = undefined;
				}
			}
			if (batch.lastPositive === 'node' && selectedCards.size > 0) {
				selectedEdgeId = undefined;
			} else if (batch.lastPositive === 'edge' && selectedEdgeId) {
				selectedCards.clear();
			}
			batch.nodes.clear();
			batch.edges.clear();
			batch.lastPositive = undefined;
			void requestSelection({
				cardPaths: [...selectedCards],
				...(selectedEdgeId ? { edgeId: selectedEdgeId } : {})
			});
		});
	}, [requestSelection]);

	return { requestSelection, queueSelectionChanges };
}
