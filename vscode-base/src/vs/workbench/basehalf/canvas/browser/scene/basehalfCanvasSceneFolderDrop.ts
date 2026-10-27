/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import {
	BASEHALF_CANVAS_DROP_FOLDER_ATTRIBUTE,
	BASEHALF_CANVAS_DROP_TARGET_ATTRIBUTE,
	BASEHALF_CANVAS_DROPPING_ATTRIBUTE,
	BaseHalfCanvasDropFolder,
	baseHalfCanvasFolderDropTarget,
	IBaseHalfCanvasTakingFolder
} from '../../common/basehalfCanvasFolderDrop.js';
import type { ReactFlowInstance } from '@xyflow/react';
import type { RefObject } from 'react';
import { IBaseHalfCanvasNodeDragState, restoreBaseHalfCanvasNodeDragOrigins } from './basehalfCanvasSceneNodeDrag.js';
import { BaseHalfCanvasFlowEdge, BaseHalfCanvasFlowNode, flowNodeRect, IBaseHalfCanvasSceneEnvironment } from './basehalfCanvasSceneShared.js';

/** What letting go at a point does with dragged cards (dropping into a folder, "The rule"). */
export type BaseHalfCanvasSceneDropDecision =
	| { readonly kind: 'place' }
	| { readonly kind: 'folder'; readonly folder: BaseHalfCanvasDropFolder; readonly element: HTMLElement | undefined }
	| { readonly kind: 'outside' };

/** Whether a point of the window is inside the rectangle of an element. */
function isInside(bounds: DOMRect, clientX: number, clientY: number): boolean {
	return clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom;
}

/**
 * Dropping into a folder: while cards are dragged, the folder that would
 * take them shows it and the cards are drawn half transparent; let go on a
 * folder's card or on a folder of the path in the title bar, the cards leave
 * the canvas and the workbench moves their items into that folder; let go
 * outside the canvas anywhere else, they go back as with Escape. The canvas
 * moves for a card dragged near its edge only while the pointer is inside it.
 */
export function useBaseHalfCanvasSceneFolderDrop(environment: IBaseHalfCanvasSceneEnvironment, scene: {
	readonly sceneKeyRef: RefObject<string>;
	readonly flowRef: RefObject<ReactFlowInstance<BaseHalfCanvasFlowNode, BaseHalfCanvasFlowEdge> | undefined>;
	readonly nodeDragState: RefObject<IBaseHalfCanvasNodeDragState | undefined>;
	/** The cards let go on a folder, hidden until their items have moved. */
	readonly droppedPaths: RefObject<Set<string>>;
	readonly nodesRef: RefObject<BaseHalfCanvasFlowNode[]>;
	readonly setLiveNodes: (next: BaseHalfCanvasFlowNode[]) => void;
	readonly endInteraction: () => void;
	readonly revealNodeDragChrome: (drag: IBaseHalfCanvasNodeDragState) => void;
	readonly cancelNodeDrag: () => boolean;
}) {
	const { vendor, host, delegate } = environment;
	const {
		sceneKeyRef, flowRef, nodeDragState, droppedPaths, nodesRef, setLiveNodes,
		endInteraction, revealNodeDragChrome, cancelNodeDrag
	} = scene;

	// The canvas library moves the canvas for a dragged card while this is on.
	const [autoPanOnNodeDrag, setAutoPanOnNodeDrag] = vendor.useState(true);
	const autoPanOn = vendor.useRef(true);
	const look = vendor.useRef<{ readonly target: HTMLElement | undefined; readonly dropping: readonly HTMLElement[] }>({ target: undefined, dropping: [] });
	// The drag of one card by the canvas library that the scene follows. A set
	// moved by its box ends in the scene's own gesture.
	const followedNodeDrag = vendor.useRef<number | undefined>(undefined);

	const setAutoPan = vendor.useCallback((on: boolean) => {
		if (autoPanOn.current !== on) {
			autoPanOn.current = on;
			setAutoPanOnNodeDrag(on);
		}
	}, []);

	/**
	 * The folder's card that takes the dragged cards now, where it is drawn:
	 * it grows while it takes them, and it takes them over what shows.
	 */
	const takingFolder = (flow: ReactFlowInstance<BaseHalfCanvasFlowNode, BaseHalfCanvasFlowEdge>): IBaseHalfCanvasTakingFolder | undefined => {
		const target = look.current.target;
		const path = target?.dataset.basehalfCardPath;
		// A card drawn again while it takes them is marked anew at the next move.
		if (!target?.isConnected || !path) {
			return undefined;
		}
		const drawn = target.getBoundingClientRect();
		const start = flow.screenToFlowPosition({ x: drawn.left, y: drawn.top });
		const end = flow.screenToFlowPosition({ x: drawn.right, y: drawn.bottom });
		return { path, x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y };
	};

	const decide = vendor.useCallback((clientX: number, clientY: number, dragged: ReadonlySet<string>): BaseHalfCanvasSceneDropDecision => {
		if (!isInside(host.getBoundingClientRect(), clientX, clientY)) {
			const element = host.ownerDocument.elementFromPoint(clientX, clientY)?.closest<HTMLElement>(`[${BASEHALF_CANVAS_DROP_FOLDER_ATTRIBUTE}]`);
			const resource = element?.getAttribute(BASEHALF_CANVAS_DROP_FOLDER_ATTRIBUTE);
			return element && resource ? { kind: 'folder', folder: { kind: 'path', resource }, element } : { kind: 'outside' };
		}
		const flow = flowRef.current;
		if (!flow) {
			return { kind: 'place' };
		}
		// By the place of the cards, not by what is under the pointer: the
		// dragged cards are there.
		const point = flow.screenToFlowPosition({ x: clientX, y: clientY });
		const shown = nodesRef.current.filter(node => !node.hidden);
		const path = baseHalfCanvasFolderDropTarget(shown.map(node => ({
			...flowNodeRect(node),
			folder: node.data.card.kind === 'folder',
			selected: !!node.selected
		})), dragged, point, takingFolder(flow));
		return path
			? { kind: 'folder', folder: { kind: 'card', path }, element: shown.find(node => node.id === path)?.data.card.element }
			: { kind: 'place' };
	}, []);

	const showLook = vendor.useCallback((target: HTMLElement | undefined, dropping: readonly HTMLElement[]): void => {
		const current = look.current;
		if (current.target !== target) {
			current.target?.removeAttribute(BASEHALF_CANVAS_DROP_TARGET_ATTRIBUTE);
			target?.setAttribute(BASEHALF_CANVAS_DROP_TARGET_ATTRIBUTE, '');
		}
		for (const element of current.dropping) {
			if (!dropping.includes(element)) {
				element.removeAttribute(BASEHALF_CANVAS_DROPPING_ATTRIBUTE);
			}
		}
		for (const element of dropping) {
			element.setAttribute(BASEHALF_CANVAS_DROPPING_ATTRIBUTE, '');
		}
		look.current = { target, dropping };
	}, []);

	const follow = vendor.useCallback((clientX: number, clientY: number, drag: IBaseHalfCanvasNodeDragState): void => {
		const dragged = new Set(drag.origins.map(origin => origin.id));
		const decision = decide(clientX, clientY, dragged);
		const dropping = decision.kind === 'folder'
			? nodesRef.current.filter(node => dragged.has(node.id)).map(node => node.data.card.element)
			: [];
		// The cards go into the folder: nothing snaps them while it takes them.
		drag.takenByFolder = decision.kind === 'folder';
		showLook(decision.kind === 'folder' ? decision.element : undefined, dropping);
	}, [decide, showLook]);

	/** Follows the drag of one card by the canvas library. */
	const followNodeDrag = vendor.useCallback((event: MouseEvent | TouchEvent): void => {
		const drag = nodeDragState.current;
		// A touch has no point of its own here: the drop follows the mouse.
		const { clientX, clientY } = event as Partial<MouseEvent>;
		if (!drag || drag.cancelled || clientX === undefined || clientY === undefined) {
			return;
		}
		followedNodeDrag.current = drag.token;
		setAutoPan(isInside(host.getBoundingClientRect(), clientX, clientY));
		follow(clientX, clientY, drag);
	}, [follow, setAutoPan]);

	/**
	 * Lets go of dragged cards at a point. Returns false when they stay where
	 * they were let go; true when the drop took them: into a folder, or back to
	 * their places outside the canvas.
	 */
	const releaseDrop = vendor.useCallback((clientX: number, clientY: number, drag: IBaseHalfCanvasNodeDragState): boolean => {
		const dragged = new Set(drag.origins.map(origin => origin.id));
		const decision = decide(clientX, clientY, dragged);
		showLook(undefined, []);
		followedNodeDrag.current = undefined;
		setAutoPan(true);
		if (decision.kind === 'place' || drag.cancelled) {
			return false;
		}
		if (decision.kind === 'outside') {
			// Back as with Escape: the user dragged out of the canvas on the way
			// to a folder, and a card let go elsewhere is not left out of sight.
			return cancelNodeDrag();
		}
		drag.cancelled = true;
		const paths = drag.origins.map(origin => origin.id);
		for (const path of paths) {
			droppedPaths.current.add(path);
		}
		// The cards leave the canvas when they are let go. They wait hidden at
		// their places until their items have moved, and no card is selected.
		setLiveNodes(restoreBaseHalfCanvasNodeDragOrigins(nodesRef.current, drag.origins)
			.map(node => dragged.has(node.id) ? { ...node, hidden: true, selected: false } : node));
		endInteraction();
		revealNodeDragChrome(drag);
		const restore = (): void => {
			for (const path of paths) {
				droppedPaths.current.delete(path);
			}
			if (sceneKeyRef.current === drag.sceneKey) {
				setLiveNodes(nodesRef.current.map(node => dragged.has(node.id) && node.hidden ? { ...node, hidden: false } : node));
			}
		};
		void delegate.dropCardsIntoFolder(drag.sceneKey, drag.structuralEpoch, paths, decision.folder).then(() => {
			// The drawing after the move has the cards that went in no more, and
			// the cards of items that could not be moved at their places again.
			for (const path of paths) {
				droppedPaths.current.delete(path);
			}
		}, error => {
			restore();
			delegate.reportError(error);
		});
		return true;
	}, [decide, endInteraction, revealNodeDragChrome, setAutoPan, showLook, cancelNodeDrag]);

	// The release of a card that the canvas library drags reaches the window
	// before the library hears of it, so the drop is decided before the card's
	// new place is saved.
	vendor.useEffect(() => {
		const view = host.ownerDocument.defaultView;
		if (!view) {
			return;
		}
		// A move of the pointer reaches the window before the canvas library moves
		// the card for it (on the mouse event after it), so the card is not
		// snapped on the move that takes it over a folder.
		const onPointerMove = (event: PointerEvent): void => {
			const drag = nodeDragState.current;
			if (drag && !drag.cancelled && followedNodeDrag.current === drag.token) {
				follow(event.clientX, event.clientY, drag);
			}
		};
		const onPointerUp = (event: PointerEvent): void => {
			const drag = nodeDragState.current;
			if (drag && !drag.cancelled && followedNodeDrag.current === drag.token) {
				releaseDrop(event.clientX, event.clientY, drag);
			}
		};
		const clear = (): void => {
			followedNodeDrag.current = undefined;
			const drag = nodeDragState.current;
			if (drag) {
				drag.takenByFolder = false;
			}
			showLook(undefined, []);
			setAutoPan(true);
		};
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') {
				clear();
			}
		};
		view.addEventListener('pointermove', onPointerMove, true);
		view.addEventListener('pointerup', onPointerUp, true);
		view.addEventListener('pointercancel', clear, true);
		view.addEventListener('keydown', onKeyDown, true);
		view.addEventListener('blur', clear);
		return () => {
			view.removeEventListener('pointermove', onPointerMove, true);
			view.removeEventListener('pointerup', onPointerUp, true);
			view.removeEventListener('pointercancel', clear, true);
			view.removeEventListener('keydown', onKeyDown, true);
			view.removeEventListener('blur', clear);
			clear();
		};
	}, [follow, releaseDrop, setAutoPan, showLook]);

	return { autoPanOnNodeDrag, followNodeDrag, followSetMove: follow, releaseDrop };
}
