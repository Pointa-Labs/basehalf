/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { BaseHalfCanvasSceneSelectionAction, BaseHalfCanvasSceneGeometryReason } from '../../common/basehalfCanvasScene.js';
import type { NodeChange } from '@xyflow/react';
import type { Dispatch, SetStateAction, RefObject } from 'react';
import {
	BaseHalfCanvasFlowEdge,
	BaseHalfCanvasFlowNode,
	IBaseHalfCanvasSceneEnvironment,
	IBaseHalfCanvasVideoPanelFollow,
	isCanvasElement
} from './basehalfCanvasSceneShared.js';

export const CANVAS_GRAPH_CONTROL_SELECTOR = 'button, input, textarea, select, a, audio, video, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="slider"], [role="spinbutton"], .nodrag, .nopan, .basehalf-canvas-card-connect-handle';

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
 * The keys of the scene: the arrow keys move the one selected card, Command-D
 * duplicates the selection, and Delete deletes the selected cards or
 * connection. A control inside a card keeps its own keys.
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
	const { vendor, host, delegate } = environment;
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
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target;
			if (event.isComposing || event.keyCode === 229
				|| !isCanvasElement(target) || !host.contains(target)
				|| host.closest('.basehalf-canvas-workbench')?.classList.contains('basehalf-card-detail-open')) {
				return;
			}
			const toolbarOwnsFocus = baseHalfCanvasTargetOwnsSelectionShortcuts(target);
			const focusedSelectedEdge = baseHalfCanvasTargetOwnsSelectedEdgeShortcuts(target);
			if (!toolbarOwnsFocus && !focusedSelectedEdge && baseHalfCanvasTargetBlocksGraphShortcuts(target)) {
				return;
			}
			const selectedNodes = nodesRef.current.filter(node => node.selected);
			if (selectedNodes.length >= 2 && !toolbarOwnsFocus
				&& ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
				// The canvas library would move every selected card by the arrow
				// keys of a focused card. A set is not moved by the keys.
				event.preventDefault();
				event.stopPropagation();
				return;
			}
			if (!event.metaKey && !event.ctrlKey && !event.altKey
				&& ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
				&& selectedNodes.length === 1
				&& !host.dataset.videoInputPickActive) {
				const selectedNode = selectedNodes[0];
				const focusedCard = isCanvasElement(target)
					? target.closest<HTMLElement>('.basehalf-canvas-card[data-basehalf-card-path]')
					: undefined;
				if ((target === host || focusedCard?.dataset.basehalfCardPath === selectedNode.id)
					&& !baseHalfCanvasTargetBlocksGraphShortcuts(target)) {
					event.preventDefault();
					event.stopPropagation();
					const step = event.shiftKey ? 10 : 1;
					const basePosition = keyboardGeometryPath.current === selectedNode.id
						? keyboardGeometryPosition.current ?? selectedNode.position
						: selectedNode.position;
					const position = {
						x: basePosition.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
						y: basePosition.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0)
					};
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
					return;
				}
			}
			if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'd' && selectedNodes.length > 0) {
				event.preventDefault();
				event.stopPropagation();
				invokeSelectionAction('duplicate', selectedNodes.map(node => node.id));
				return;
			}
			if (event.key !== 'Delete' && event.key !== 'Backspace') {
				return;
			}
			if (selectedNodes.length > 0) {
				event.preventDefault();
				event.stopPropagation();
				invokeSelectionAction('delete', selectedNodes.map(node => node.id));
				return;
			}
			if (target !== host && !focusedSelectedEdge) {
				return;
			}
			const selected = edgesRef.current.filter(edge => edge.selected);
			if (selected.length === 0) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			setLiveEdges(edgesRef.current.filter(edge => !edge.selected));
			removeEdges(selected);
		};
		host.addEventListener('keydown', onKeyDown, true);
		return () => host.removeEventListener('keydown', onKeyDown, true);
	}, [applyNodesChange, beginInteraction, endInteraction, invokeSelectionAction, removeEdges, setLiveEdges, videoPanelFollow]);

	return { invokeSelectionAction };
}
