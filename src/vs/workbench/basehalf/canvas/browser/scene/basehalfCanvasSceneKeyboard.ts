/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { BaseHalfCanvasSceneSelectionAction, BaseHalfCanvasSceneGeometryReason, baseHalfCanvasSceneSelectionSurface } from '../../common/basehalfCanvasScene.js';
import type { NodeChange } from '@xyflow/react';
import type { Dispatch, SetStateAction, RefObject } from 'react';
import {
	BaseHalfCanvasFlowEdge,
	BaseHalfCanvasFlowNode,
	IBaseHalfCanvasSceneEnvironment,
	IBaseHalfCanvasSceneKeys,
	IBaseHalfCanvasVideoPanelFollow,
	isCanvasElement
} from './basehalfCanvasSceneShared.js';

export const CANVAS_GRAPH_CONTROL_SELECTOR = 'button, input, textarea, select, a, audio, video, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="slider"], [role="spinbutton"], .nodrag, .nopan, .basehalf-canvas-card-connect-handle';

/** Whether the element is in a control: something on the canvas that takes a press, and so a key, for itself. */
export function baseHalfCanvasTargetBlocksGraphShortcuts(target: EventTarget | null): boolean {
	if (!isCanvasElement(target)) {
		return false;
	}
	const blocker = target.closest(CANVAS_GRAPH_CONTROL_SELECTOR);
	return blocker !== null && !blocker.classList.contains('react-flow__node');
}

export function baseHalfCanvasTargetOwnsSelectedEdgeShortcuts(target: EventTarget | null): boolean {
	return isCanvasElement(target) && target.closest('.react-flow__edge.selected') !== null;
}

export function baseHalfCanvasTargetOwnsSelectionShortcuts(target: EventTarget | null): boolean {
	return isCanvasElement(target)
		&& target.closest('.basehalf-canvas-selection-toolbar, .basehalf-canvas-note-toolbar, .basehalf-video-context-toolbar') !== null;
}

/**
 * What the keys of the canvas ask of the scene (the keys of the canvas): the
 * selection as the scene holds it at a key press, and the commands that work
 * on it. Move Card moves the one selected card, Duplicate duplicates the
 * selected cards, and Delete deletes the selected cards or, without one, the
 * selected connections. Where a key acts is the canvas view's to say: the
 * scene has no key of its own.
 */
export function useBaseHalfCanvasSceneKeyboard(environment: IBaseHalfCanvasSceneEnvironment, scene: {
	readonly sceneKeyRef: RefObject<string>;
	readonly structuralEpochRef: RefObject<number>;
	readonly videoPanelFollowToken: RefObject<number>;
	readonly keyboardGeometryTimer: RefObject<number | undefined>;
	readonly keyboardGeometryInteractionActive: RefObject<boolean>;
	readonly keyboardGeometryPath: RefObject<string | undefined>;
	readonly keyboardGeometryPosition: RefObject<{ x: number; y: number } | undefined>;
	readonly videoPanelFollow: IBaseHalfCanvasVideoPanelFollow | undefined;
	readonly setVideoPanelFollow: Dispatch<SetStateAction<IBaseHalfCanvasVideoPanelFollow | undefined>>;
	readonly beginInteraction: () => void;
	readonly endInteraction: () => void;
	readonly nodesRef: RefObject<BaseHalfCanvasFlowNode[]>;
	readonly edgesRef: RefObject<BaseHalfCanvasFlowEdge[]>;
	readonly setLiveEdges: (next: BaseHalfCanvasFlowEdge[]) => void;
	readonly applyNodesChange: (changes: NodeChange<BaseHalfCanvasFlowNode>[], disableSnap: boolean, reason?: BaseHalfCanvasSceneGeometryReason) => void;
	readonly removeEdges: (deleted: readonly BaseHalfCanvasFlowEdge[]) => void;
}) {
	const { vendor, host, delegate, sceneKeys } = environment;
	const {
		sceneKeyRef, structuralEpochRef, videoPanelFollowToken, keyboardGeometryTimer,
		keyboardGeometryInteractionActive, keyboardGeometryPath, keyboardGeometryPosition,
		videoPanelFollow, setVideoPanelFollow, beginInteraction, endInteraction, nodesRef, edgesRef,
		setLiveEdges, applyNodesChange, removeEdges
	} = scene;

	const invokeSelectionAction = vendor.useCallback((action: BaseHalfCanvasSceneSelectionAction, paths: readonly string[]) => {
		const selected = paths.map(path => nodesRef.current.find(node => node.id === path));
		if (selected.some(node => !node)
			|| selected.some(node => node!.data.sceneKey !== sceneKeyRef.current || node!.data.structuralEpoch !== structuralEpochRef.current)) {
			return;
		}
		void delegate.performSelectionAction(sceneKeyRef.current, structuralEpochRef.current, action, paths)
			.catch(error => delegate.reportError(error));
	}, []);

	vendor.useEffect(() => {
		const keys: IBaseHalfCanvasSceneKeys = {
			selection: () => {
				const selectedNodes = nodesRef.current.filter(node => node.selected);
				return {
					cards: selectedNodes.map(node => node.id),
					connections: edgesRef.current.filter(edge => edge.selected).length,
					toolbar: baseHalfCanvasSceneSelectionSurface(selectedNodes.map(node => node.data.card))
				};
			},
			moveSelectedCard: (x, y) => {
				const selectedNodes = nodesRef.current.filter(node => node.selected);
				if (selectedNodes.length !== 1) {
					return;
				}
				const selectedNode = selectedNodes[0];
				const basePosition = keyboardGeometryPath.current === selectedNode.id
					? keyboardGeometryPosition.current ?? selectedNode.position
					: selectedNode.position;
				const position = { x: basePosition.x + x, y: basePosition.y + y };
				const token = videoPanelFollow?.kind === 'keyboard-geometry' && videoPanelFollow.path === selectedNode.id
					? videoPanelFollow.token
					: ++videoPanelFollowToken.current;
				if (!keyboardGeometryInteractionActive.current) {
					keyboardGeometryInteractionActive.current = true;
					beginInteraction();
				}
				keyboardGeometryPath.current = selectedNode.id;
				keyboardGeometryPosition.current = position;
				setVideoPanelFollow({ token, path: selectedNode.id, kind: 'keyboard-geometry' });
				applyNodesChange([{ id: selectedNode.id, type: 'position', position, dragging: true }], true);
				const view = host.ownerDocument.defaultView;
				if (view) {
					if (keyboardGeometryTimer.current !== undefined) {
						view.clearTimeout(keyboardGeometryTimer.current);
					}
					keyboardGeometryTimer.current = view.setTimeout(() => {
						keyboardGeometryTimer.current = undefined;
						const current = nodesRef.current.find(node => node.id === selectedNode.id);
						const finalPosition = keyboardGeometryPath.current === selectedNode.id
							? keyboardGeometryPosition.current
							: undefined;
						if (!current || !finalPosition) {
							if (keyboardGeometryInteractionActive.current) {
								keyboardGeometryInteractionActive.current = false;
								keyboardGeometryPath.current = undefined;
								keyboardGeometryPosition.current = undefined;
								endInteraction();
							}
							setVideoPanelFollow(state => state?.token === token ? undefined : state);
							return;
						}
						applyNodesChange([{ id: current.id, type: 'position', position: finalPosition, dragging: false }], true);
						keyboardGeometryPath.current = undefined;
						keyboardGeometryPosition.current = undefined;
						if (keyboardGeometryInteractionActive.current) {
							keyboardGeometryInteractionActive.current = false;
							endInteraction();
						}
						view.requestAnimationFrame(() => {
							setVideoPanelFollow(state => state?.token === token ? undefined : state);
							current.data.card.element.focus({ preventScroll: true });
						});
					}, 100);
				}
			},
			duplicateSelection: () => {
				const selectedNodes = nodesRef.current.filter(node => node.selected);
				if (selectedNodes.length > 0) {
					invokeSelectionAction('duplicate', selectedNodes.map(node => node.id));
				}
			},
			deleteSelection: () => {
				const selectedNodes = nodesRef.current.filter(node => node.selected);
				if (selectedNodes.length > 0) {
					invokeSelectionAction('delete', selectedNodes.map(node => node.id));
					return;
				}
				const selected = edgesRef.current.filter(edge => edge.selected);
				if (selected.length === 0) {
					return;
				}
				setLiveEdges(edgesRef.current.filter(edge => !edge.selected));
				removeEdges(selected);
			}
		};
		sceneKeys.current = keys;
		return () => {
			if (sceneKeys.current === keys) {
				sceneKeys.current = undefined;
			}
		};
	}, [applyNodesChange, beginInteraction, endInteraction, invokeSelectionAction, removeEdges, setLiveEdges, videoPanelFollow]);

	return { invokeSelectionAction };
}
