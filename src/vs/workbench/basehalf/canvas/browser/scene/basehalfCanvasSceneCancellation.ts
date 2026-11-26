/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IBaseHalfCanvasSnapGuide } from '../../common/basehalfCanvasSnap.js';
import { IBaseHalfCanvasSceneSelection } from '../../common/basehalfCanvasScene.js';
import type { Dispatch, SetStateAction, RefObject } from 'react';
import { BaseHalfCanvasPendingConnectionState } from './basehalfCanvasSceneConnections.js';
import { IBaseHalfCanvasNodeDragState, restoreBaseHalfCanvasNodeDragOrigins } from './basehalfCanvasSceneNodeDrag.js';
import { BaseHalfCanvasFlowNode, baseHalfCanvasInteractionOwnsEscape, IBaseHalfCanvasConnectionStoreController, IBaseHalfCanvasSceneEnvironment } from './basehalfCanvasSceneShared.js';

/**
 * Ending what the user is doing when it is cancelled: Escape cancels a pending
 * connection or puts dragged cards back, and a pointer that is lost, a release
 * that never reaches the scene, or the window losing focus ends every gesture.
 */
export function useBaseHalfCanvasSceneCancellation(environment: IBaseHalfCanvasSceneEnvironment, scene: {
	readonly sceneKeyRef: RefObject<string>;
	readonly structuralEpochRef: RefObject<number>;
	readonly viewportGestureSceneKey: RefObject<string | undefined>;
	readonly interactionDepth: RefObject<number>;
	readonly interactionGeneration: RefObject<number>;
	readonly interactionSceneKey: RefObject<string | undefined>;
	readonly interactionStructuralEpoch: RefObject<number | undefined>;
	readonly pendingConnection: RefObject<BaseHalfCanvasPendingConnectionState>;
	readonly connectionStoreController: RefObject<IBaseHalfCanvasConnectionStoreController | undefined>;
	readonly nodeDragState: RefObject<IBaseHalfCanvasNodeDragState | undefined>;
	readonly interacting: RefObject<boolean>;
	readonly setGuides: Dispatch<SetStateAction<readonly IBaseHalfCanvasSnapGuide[]>>;
	readonly revealNodeDragChrome: (drag: IBaseHalfCanvasNodeDragState) => void;
	readonly endInteraction: () => void;
	readonly nodesRef: RefObject<BaseHalfCanvasFlowNode[]>;
	readonly setLiveNodes: (next: BaseHalfCanvasFlowNode[]) => void;
	readonly requestSelection: (selection: IBaseHalfCanvasSceneSelection) => Promise<boolean>;
}) {
	const { vendor, host, delegate } = environment;
	const {
		sceneKeyRef, structuralEpochRef, viewportGestureSceneKey, interactionDepth,
		interactionGeneration, interactionSceneKey, interactionStructuralEpoch, pendingConnection,
		connectionStoreController, nodeDragState, interacting, setGuides, revealNodeDragChrome,
		endInteraction, nodesRef, setLiveNodes, requestSelection
	} = scene;

	const resetInteraction = vendor.useCallback(() => {
		if (!interacting.current) {
			return;
		}
		interactionDepth.current = 0;
		interacting.current = false;
		interactionSceneKey.current = undefined;
		interactionStructuralEpoch.current = undefined;
		viewportGestureSceneKey.current = undefined;
		setGuides([]);
		delegate.didEndInteraction();
	}, []);
	const cancelPendingConnection = vendor.useCallback((rejectTrailingClickStart = false) => {
		const owner = pendingConnection.current.cancel(rejectTrailingClickStart);
		connectionStoreController.current?.cancel();
		if (owner) {
			endInteraction();
		}
	}, [endInteraction]);
	const cancelNodeDrag = vendor.useCallback(() => {
		const drag = nodeDragState.current;
		if (!drag || drag.cancelled) {
			return false;
		}
		drag.cancelled = true;
		if (drag.sceneKey === sceneKeyRef.current && drag.structuralEpoch === structuralEpochRef.current) {
			setLiveNodes(restoreBaseHalfCanvasNodeDragOrigins(nodesRef.current, drag.origins));
		}
		setGuides([]);
		endInteraction();
		const restoreSelection = drag.sceneKey === sceneKeyRef.current && drag.structuralEpoch === structuralEpochRef.current
			? requestSelection({ cardPaths: drag.selectionAtStart })
			: Promise.resolve(false);
		void restoreSelection.finally(() => revealNodeDragChrome(drag));
		return true;
	}, [endInteraction, requestSelection, revealNodeDragChrome, setLiveNodes]);
	const cancelAllInteractions = vendor.useCallback(() => {
		const drag = nodeDragState.current;
		if (drag && !drag.cancelled) {
			drag.cancelled = true;
			if (drag.sceneKey === sceneKeyRef.current && drag.structuralEpoch === structuralEpochRef.current) {
				setLiveNodes(restoreBaseHalfCanvasNodeDragOrigins(nodesRef.current, drag.origins));
			}
			const restoreSelection = drag.sceneKey === sceneKeyRef.current && drag.structuralEpoch === structuralEpochRef.current
				? requestSelection({ cardPaths: drag.selectionAtStart })
				: Promise.resolve(false);
			void restoreSelection.finally(() => revealNodeDragChrome(drag));
		}
		pendingConnection.current.cancel();
		connectionStoreController.current?.cancel();
		resetInteraction();
	}, [requestSelection, resetInteraction, revealNodeDragChrome, setLiveNodes]);
	vendor.useEffect(() => {
		const window = host.ownerDocument.defaultView;
		if (!window) {
			return;
		}
		let finishTimer: number | undefined;
		let dragReleaseTimer: number | undefined;
		const releaseCancelledDrag = (drag: IBaseHalfCanvasNodeDragState | undefined) => {
			if (drag?.cancelled && nodeDragState.current === drag) {
				nodeDragState.current = undefined;
			}
		};
		const finishSoon = () => {
			if (!interacting.current) {
				const drag = nodeDragState.current;
				if (drag?.cancelled) {
					if (dragReleaseTimer !== undefined) {
						window.clearTimeout(dragReleaseTimer);
					}
					dragReleaseTimer = window.setTimeout(() => releaseCancelledDrag(drag), 0);
				}
				return;
			}
			const generation = interactionGeneration.current;
			if (finishTimer !== undefined) {
				window.clearTimeout(finishTimer);
			}
			finishTimer = window.setTimeout(() => {
				if (interacting.current && interactionGeneration.current === generation) {
					const drag = nodeDragState.current;
					cancelAllInteractions();
					releaseCancelledDrag(drag);
				}
			}, 0);
		};
		const cancelImmediately = () => {
			const drag = nodeDragState.current;
			cancelAllInteractions();
			if (dragReleaseTimer !== undefined) {
				window.clearTimeout(dragReleaseTimer);
			}
			dragReleaseTimer = window.setTimeout(() => releaseCancelledDrag(drag), 0);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (!baseHalfCanvasInteractionOwnsEscape(event)) {
				return;
			}
			if (pendingConnection.current.peek()) {
				event.preventDefault();
				event.stopImmediatePropagation();
				cancelPendingConnection(true);
				return;
			}
			if (cancelNodeDrag()) {
				event.preventDefault();
				event.stopImmediatePropagation();
			}
		};
		window.addEventListener('pointerup', finishSoon, true);
		window.addEventListener('pointercancel', cancelImmediately, true);
		window.addEventListener('mouseup', finishSoon, true);
		window.addEventListener('touchend', finishSoon, true);
		window.addEventListener('keydown', onKeyDown, true);
		window.addEventListener('blur', cancelImmediately);
		return () => {
			if (finishTimer !== undefined) {
				window.clearTimeout(finishTimer);
			}
			if (dragReleaseTimer !== undefined) {
				window.clearTimeout(dragReleaseTimer);
			}
			window.removeEventListener('pointerup', finishSoon, true);
			window.removeEventListener('pointercancel', cancelImmediately, true);
			window.removeEventListener('mouseup', finishSoon, true);
			window.removeEventListener('touchend', finishSoon, true);
			window.removeEventListener('keydown', onKeyDown, true);
			window.removeEventListener('blur', cancelImmediately);
		};
	}, [cancelAllInteractions, cancelNodeDrag, cancelPendingConnection]);

	return { cancelPendingConnection, cancelNodeDrag };
}
