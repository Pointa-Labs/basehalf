/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import '../../../shell/browser/media/basehalfSidewaysScrollbar.css';
import { isHTMLElement } from '../../../../../base/browser/dom.js';
import { BaseHalfCanvasSceneContextMenuRequest, IBaseHalfCanvasSceneSelection, IBaseHalfCanvasSceneViewport } from '../../common/basehalfCanvasScene.js';
import { installBaseHalfCanvasWheelGestures } from '../basehalfCanvasWheelGestures.js';
import { installBaseHalfSidewaysScrollbar } from '../../../shell/browser/basehalfSidewaysScrollbar.js';
import type { RefObject, MouseEvent as ReactMouseEvent } from 'react';
import { baseHalfCanvasTargetBlocksGraphShortcuts } from './basehalfCanvasSceneKeyboard.js';
import { BaseHalfCanvasFlowEdge, BaseHalfCanvasFlowNode, IBaseHalfCanvasSceneEnvironment, isCanvasElement } from './basehalfCanvasSceneShared.js';

export function baseHalfCanvasShouldOpenCreateMenu(
	event: Pick<MouseEvent, 'altKey' | 'button' | 'ctrlKey' | 'detail' | 'metaKey' | 'shiftKey'>,
	connectionPending: boolean
): boolean {
	return !connectionPending
		&& event.detail === 2
		&& event.button === 0
		&& !event.altKey
		&& !event.ctrlKey
		&& !event.metaKey
		&& !event.shiftKey;
}

export type BaseHalfCanvasCardDoubleClickAction = 'rename' | 'editNote' | 'open';

/**
 * What a double click on a card does, from where it lands (canvas card name).
 * A name that can be changed in place is renamed. A Note is edited from its
 * body only, and every other card is opened.
 */
export function baseHalfCanvasCardDoubleClickAction(input: {
	readonly onRenamableName: boolean;
	readonly modifier: boolean;
	readonly note: boolean;
	readonly onNoteBody: boolean;
}): BaseHalfCanvasCardDoubleClickAction | undefined {
	if (input.onRenamableName && !input.modifier) {
		return 'rename';
	}
	if (input.note) {
		return input.onNoteBody ? 'editNote' : undefined;
	}
	return 'open';
}

function isDirectCardControl(target: EventTarget | null): boolean {
	if (!isCanvasElement(target)) {
		return false;
	}
	const media = target.closest<HTMLMediaElement>('audio, video');
	if (media && !media.controls) {
		return false;
	}
	return baseHalfCanvasTargetBlocksGraphShortcuts(target);
}

/**
 * Clicks on the scene: a click selects a card, a double click renames it,
 * edits a Note, or opens the card, a double click on the canvas offers to
 * create a card, and the context menus of cards, connections, and the canvas.
 * The wheel scrolls a card's content or moves the canvas.
 */
export function useBaseHalfCanvasSceneMouse(environment: IBaseHalfCanvasSceneEnvironment, scene: {
	readonly sceneKeyRef: RefObject<string>;
	readonly structuralEpochRef: RefObject<number>;
	readonly viewportRef: RefObject<IBaseHalfCanvasSceneViewport>;
	readonly lastPaneConnectionCancellationAt: RefObject<number | undefined>;
	readonly paneDoubleClickStartedOnPane: RefObject<boolean>;
	readonly nodesRef: RefObject<BaseHalfCanvasFlowNode[]>;
	readonly requestSelection: (selection: IBaseHalfCanvasSceneSelection) => Promise<boolean>;
}) {
	const { vendor, host, delegate } = environment;
	const {
		sceneKeyRef, structuralEpochRef, viewportRef, lastPaneConnectionCancellationAt,
		paneDoubleClickStartedOnPane, nodesRef, requestSelection
	} = scene;

	const showContextMenu = vendor.useCallback((request: BaseHalfCanvasSceneContextMenuRequest) => {
		delegate.showContextMenu(sceneKeyRef.current, structuralEpochRef.current, request);
	}, []);
	const contextMenuAnchor = vendor.useCallback((event: { readonly clientX: number; readonly clientY: number }, fallback: HTMLElement): HTMLElement | { readonly x: number; readonly y: number } => {
		return event.clientX === 0 && event.clientY === 0 ? fallback : { x: event.clientX, y: event.clientY };
	}, []);
	const onNodeContextMenu = vendor.useCallback((event: ReactMouseEvent<Element>, node: BaseHalfCanvasFlowNode) => {
		event.preventDefault();
		event.stopPropagation();
		host.focus({ preventScroll: true });
		const anchor = contextMenuAnchor(event, node.data.card.element);
		void requestSelection({ cardPaths: [node.id] }).then(selected => {
			if (selected) {
				showContextMenu({ kind: 'card', path: node.id, anchor });
			}
		});
	}, [contextMenuAnchor, requestSelection, showContextMenu]);
	const onEdgeContextMenu = vendor.useCallback((event: ReactMouseEvent<Element>, flowEdge: BaseHalfCanvasFlowEdge) => {
		const edge = flowEdge.data?.edge;
		if (!edge) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		host.focus({ preventScroll: true });
		const anchor = contextMenuAnchor(event, host);
		void requestSelection({ edgeId: flowEdge.id }).then(selected => {
			if (selected) {
				showContextMenu({ kind: 'edge', edge, anchor });
			}
		});
	}, [contextMenuAnchor, requestSelection, showContextMenu]);
	const onPaneContextMenu = vendor.useCallback((event: globalThis.MouseEvent | ReactMouseEvent<Element>) => {
		event.preventDefault();
		event.stopPropagation();
		host.focus({ preventScroll: true });
		const anchor = contextMenuAnchor(event, host);
		void requestSelection({}).then(selected => {
			if (selected) {
				showContextMenu({ kind: 'pane', anchor });
			}
		});
	}, [contextMenuAnchor, requestSelection, showContextMenu]);
	const onNodeClick = vendor.useCallback((event: ReactMouseEvent<Element>, node: BaseHalfCanvasFlowNode) => {
		if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || isDirectCardControl(event.target)) {
			return;
		}
		const noteBody = node.data.card.controls?.kind === 'note' && isHTMLElement(event.target)
			? event.target.closest<HTMLElement>('.basehalf-canvas-card-body')
			: undefined;
		const notePoint = noteBody ? (() => {
			const bounds = noteBody.getBoundingClientRect();
			const scaleX = bounds.width > 0 ? noteBody.clientWidth / bounds.width : 1;
			const scaleY = bounds.height > 0 ? noteBody.clientHeight / bounds.height : 1;
			return {
				x: Math.max(0, (event.clientX - bounds.left) * scaleX),
				y: Math.max(0, (event.clientY - bounds.top) * scaleY)
			};
		})() : undefined;
		void requestSelection({ cardPaths: [node.id] }).then(selected => {
			if (selected) {
				delegate.cancelPendingCardOpen();
				if (notePoint) {
					delegate.rememberNoteEditPoint(node.data.sceneKey, node.data.structuralEpoch, node.id, notePoint);
				}
			}
		});
	}, [requestSelection]);
	const onNodeDoubleClick = vendor.useCallback((event: ReactMouseEvent<Element>, node: BaseHalfCanvasFlowNode) => {
		if (isDirectCardControl(event.target)) {
			return;
		}
		const noteBody = isHTMLElement(event.target) && event.target.closest<HTMLElement>('.basehalf-canvas-card-body');
		const action = baseHalfCanvasCardDoubleClickAction({
			onRenamableName: isHTMLElement(event.target) && !!event.target.closest('.basehalf-canvas-card-label.renamable'),
			modifier: event.shiftKey || event.metaKey || event.ctrlKey || event.altKey,
			note: node.data.card.controls?.kind === 'note',
			onNoteBody: !!noteBody
		});
		if (!action) {
			return;
		}
		const noteFocusPoint = noteBody ? (() => {
			const bounds = noteBody.getBoundingClientRect();
			const scaleX = bounds.width > 0 ? noteBody.clientWidth / bounds.width : 1;
			const scaleY = bounds.height > 0 ? noteBody.clientHeight / bounds.height : 1;
			return {
				x: Math.max(0, (event.clientX - bounds.left) * scaleX),
				y: Math.max(0, (event.clientY - bounds.top) * scaleY)
			};
		})() : undefined;
		// Changing a name selects no card, and it ends the selection there is.
		void requestSelection({ cardPaths: action === 'rename' ? [] : [node.id] }).then(selected => {
			if (!selected) {
				return;
			}
			const result = action === 'rename'
				? delegate.performSelectionAction(node.data.sceneKey, node.data.structuralEpoch, 'rename', [node.id])
				: action === 'editNote'
					? delegate.editNote(node.data.sceneKey, node.data.structuralEpoch, node.id, noteFocusPoint)
					: delegate.openCard(node.data.sceneKey, node.data.structuralEpoch, node.id);
			void result.catch(error => delegate.reportError(error));
		});
	}, [requestSelection]);
	const onPaneDoubleClick = vendor.useCallback((event: MouseEvent) => {
		const startedOnPane = paneDoubleClickStartedOnPane.current;
		paneDoubleClickStartedOnPane.current = false;
		if (!startedOnPane || !isHTMLElement(event.target) || !event.target.classList.contains('react-flow__pane')) {
			return;
		}
		const cancellationAt = lastPaneConnectionCancellationAt.current;
		lastPaneConnectionCancellationAt.current = undefined;
		const recentlyCancelledConnection = cancellationAt !== undefined && event.timeStamp - cancellationAt < 750;
		if (!baseHalfCanvasShouldOpenCreateMenu(event, recentlyCancelledConnection)) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		const sceneKey = sceneKeyRef.current;
		const structuralEpoch = structuralEpochRef.current;
		const position = { x: event.clientX, y: event.clientY };
		void requestSelection({}).then(selected => {
			if (selected && sceneKeyRef.current === sceneKey && structuralEpochRef.current === structuralEpoch) {
				delegate.showCreateMenu(sceneKey, structuralEpoch, position);
			}
		});
		host.focus({ preventScroll: true });
	}, [requestSelection]);
	vendor.useEffect(() => {
		const onClickCapture = (event: MouseEvent) => {
			if (event.detail === 1) {
				paneDoubleClickStartedOnPane.current = isHTMLElement(event.target)
					&& event.target.classList.contains('react-flow__pane');
			}
		};
		host.addEventListener('click', onClickCapture, true);
		host.addEventListener('dblclick', onPaneDoubleClick, true);
		return () => {
			host.removeEventListener('click', onClickCapture, true);
			host.removeEventListener('dblclick', onPaneDoubleClick, true);
		};
	}, [onPaneDoubleClick]);
	vendor.useEffect(() => {
		const wheelGestures = installBaseHalfCanvasWheelGestures(host, {
			zoom: () => viewportRef.current.zoom,
			card: path => nodesRef.current.find(node => node.id === path)?.data.card.element,
			scrollableContent: card => delegate.cardScrollableContent(card)
		});
		// A table or a code block of a note shows one bar while it is scrolled
		// sideways, at rest and in the card's editor (note rendering).
		const sidewaysScrollbar = installBaseHalfSidewaysScrollbar(host, {
			boxSelector: '.bh-md-preview table, .bh-md-preview pre',
			container: box => box.closest<HTMLElement>('.bh-md-preview')
		});
		return () => {
			wheelGestures.dispose();
			sidewaysScrollbar.dispose();
		};
	}, []);

	return { onNodeContextMenu, onEdgeContextMenu, onPaneContextMenu, onNodeClick, onNodeDoubleClick };
}
