/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfCanvasScenePressGesture.css';
import { BaseHalfCanvasArrangement, baseHalfCanvasArrange, baseHalfCanvasCardsInMarquee, baseHalfCanvasLinesInMarquee, IBaseHalfCanvasArrangeLine, IBaseHalfCanvasArrangeRect } from '../../common/basehalfCanvasArrangement.js';
import { BaseHalfCanvasSceneGeometryReason, IBaseHalfCanvasSceneSelection } from '../../common/basehalfCanvasScene.js';
import type { NodeChange, ReactFlowInstance, Viewport } from '@xyflow/react';
import type { RefObject } from 'react';
import { captureBaseHalfCanvasNodeDragOrigins, IBaseHalfCanvasNodeDragState } from './basehalfCanvasSceneNodeDrag.js';
import { BaseHalfCanvasSelectionIntentCoordinator, IBaseHalfCanvasPendingSelectionRequest } from './basehalfCanvasSceneSelection.js';
import {
	BaseHalfCanvasFlowEdge,
	BaseHalfCanvasFlowNode,
	flowNodeRect,
	IBaseHalfCanvasConnectionStoreController,
	IBaseHalfCanvasSceneEnvironment,
	isCanvasElement
} from './basehalfCanvasSceneShared.js';

/** A press on the scene that may become a marquee or a move of the set. */
interface IBaseHalfCanvasScenePressGesture {
	readonly kind: 'marquee' | 'move';
	readonly pointerId: number;
	readonly startClientX: number;
	readonly startClientY: number;
	/** The press was kept from the card, connection, or box under it. */
	readonly taken: boolean;
	clientX: number;
	clientY: number;
	phase: 'pressed' | 'opening' | 'active';
	/** The button was released while the marquee waited for the selection to clear. */
	released: boolean;
	startFlow: { readonly x: number; readonly y: number } | undefined;
	boxed: ReadonlySet<string>;
	/** The connections whose lines the marquee crosses while it touches no card. */
	boxedLines: ReadonlySet<string>;
	drag: IBaseHalfCanvasNodeDragState | undefined;
	panned: boolean;
	frame: number | undefined;
}

/**
 * What a press of the primary button on the scene becomes once it moves: a
 * marquee, a move of the set by its box, or nothing that the scene owns.
 * With Shift held a marquee begins anywhere on the scene, also on a card.
 */
export function baseHalfCanvasScenePressGesture(target: Element, shiftKey: boolean): 'marquee' | 'move' | undefined {
	if (target.classList.contains('react-flow__pane')) {
		return 'marquee';
	}
	const box = target.closest('.basehalf-canvas-set-box');
	if (!shiftKey) {
		return box ? 'move' : undefined;
	}
	if (!target.closest('.react-flow') || (!box && target.closest(CANVAS_SHIFT_MARQUEE_BLOCKED_SELECTOR))) {
		return undefined;
	}
	return 'marquee';
}

/**
 * How far the canvas moves in one frame for a pointer at `position` along a
 * scene that is `size` long: towards the pointer's edge, faster the nearer
 * the pointer is to it, and not at all away from the edges.
 */
export function baseHalfCanvasAutoPanStep(position: number, size: number): number {
	if (position < CANVAS_AUTO_PAN_EDGE) {
		return Math.min(1, (CANVAS_AUTO_PAN_EDGE - position) / CANVAS_AUTO_PAN_EDGE) * CANVAS_AUTO_PAN_SPEED;
	}
	if (position > size - CANVAS_AUTO_PAN_EDGE) {
		return -Math.min(1, (position - (size - CANVAS_AUTO_PAN_EDGE)) / CANVAS_AUTO_PAN_EDGE) * CANVAS_AUTO_PAN_SPEED;
	}
	return 0;
}
/** A press that moves no further than this, in screen pixels, is a click. */
const CANVAS_PRESS_CLICK_DISTANCE = 4;
/** The canvas moves while the pointer of a marquee or of a moved set is this near to the scene's edge, in screen pixels. */
const CANVAS_AUTO_PAN_EDGE = 40;
/** The furthest the canvas moves in one frame, in screen pixels. */
const CANVAS_AUTO_PAN_SPEED = 15;
/** Marks a connection whose line a marquee crosses, before it is selected. */
const MARQUEE_SELECTED_LINE_ATTRIBUTE = 'data-marquee-selected';
/** With Shift held, a press on one of these still belongs to it and begins no marquee. */
const CANVAS_SHIFT_MARQUEE_BLOCKED_SELECTOR = 'button, input, textarea, select, a, audio, video, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="slider"], [role="spinbutton"], .nodrag, .basehalf-canvas-adjacent-chrome, .basehalf-canvas-card-connect-handle, .basehalf-canvas-card[data-note-editing="true"]';

/**
 * The scene's own gesture of the pointer: a marquee, or moving the set by its
 * box, with the canvas moving along while the pointer is near its edge; and
 * the other ways a set changes, Shift-click on its box and Arrange.
 */
export function useBaseHalfCanvasScenePressGesture(environment: IBaseHalfCanvasSceneEnvironment, scene: {
	readonly sceneKeyRef: RefObject<string>;
	readonly structuralEpochRef: RefObject<number>;
	readonly flowRef: RefObject<ReactFlowInstance<BaseHalfCanvasFlowNode, BaseHalfCanvasFlowEdge> | undefined>;
	readonly selectionIntents: RefObject<BaseHalfCanvasSelectionIntentCoordinator>;
	readonly pendingSelectionRequest: RefObject<IBaseHalfCanvasPendingSelectionRequest | undefined>;
	readonly connectionStoreController: RefObject<IBaseHalfCanvasConnectionStoreController | undefined>;
	readonly nodeDragState: RefObject<IBaseHalfCanvasNodeDragState | undefined>;
	readonly nodeDragToken: RefObject<number>;
	readonly suppressNodeDragChrome: (drag: IBaseHalfCanvasNodeDragState) => void;
	readonly settleNodeDragChrome: (drag: IBaseHalfCanvasNodeDragState) => void;
	readonly revealNodeDragChrome: (drag: IBaseHalfCanvasNodeDragState) => void;
	readonly beginInteraction: () => void;
	readonly endInteraction: () => void;
	readonly nodesRef: RefObject<BaseHalfCanvasFlowNode[]>;
	readonly edgesRef: RefObject<BaseHalfCanvasFlowEdge[]>;
	readonly requestSelection: (selection: IBaseHalfCanvasSceneSelection) => Promise<boolean>;
	readonly applyNodesChange: (changes: NodeChange<BaseHalfCanvasFlowNode>[], disableSnap: boolean, reason?: BaseHalfCanvasSceneGeometryReason) => void;
	readonly reportViewport: (sceneKey: string, viewport: Viewport, final: boolean) => void;
}) {
	const { vendor, host } = environment;
	const {
		sceneKeyRef, structuralEpochRef, flowRef, selectionIntents, pendingSelectionRequest,
		connectionStoreController, nodeDragState, nodeDragToken, suppressNodeDragChrome,
		settleNodeDragChrome, revealNodeDragChrome, beginInteraction, endInteraction, nodesRef,
		edgesRef, requestSelection, applyNodesChange, reportViewport
	} = scene;

	const toggleSetCardAt = vendor.useCallback((clientX: number, clientY: number): void => {
		const flow = flowRef.current;
		if (!flow) {
			return;
		}
		const point = flow.screenToFlowPosition({ x: clientX, y: clientY });
		// A selected card is drawn over the others, and a later card over an
		// earlier one.
		let card: BaseHalfCanvasFlowNode | undefined;
		for (const node of nodesRef.current) {
			const rect = flowNodeRect(node);
			if (point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height
				&& (!card?.selected || node.selected)) {
				card = node;
			}
		}
		if (!card) {
			return;
		}
		const selected = new Set(nodesRef.current.filter(node => node.selected).map(node => node.id));
		if (!selected.delete(card.id)) {
			selected.add(card.id);
		}
		void requestSelection({ cardPaths: nodesRef.current.filter(node => selected.has(node.id)).map(node => node.id) });
	}, [requestSelection]);

	// Arrange moves only the cards of the set, in one change of the layout.
	const arrangeSet = vendor.useCallback((arrangement: BaseHalfCanvasArrangement): void => {
		const set = nodesRef.current.filter(node => node.selected);
		if (set.length < 2 || set.some(node => node.data.sceneKey !== sceneKeyRef.current || node.data.structuralEpoch !== structuralEpochRef.current)) {
			return;
		}
		applyNodesChange(baseHalfCanvasArrange(arrangement, set.map(flowNodeRect)).map(place => ({
			id: place.path,
			type: 'position' as const,
			position: { x: place.x, y: place.y },
			dragging: false
		})), true, 'arrange');
	}, [applyNodesChange]);

	const followSceneGesture = vendor.useRef<(() => void) | undefined>(undefined);
	// What the gesture below calls. A gesture outlives the render it began in.
	const sceneGesture = vendor.useRef({ applyNodesChange, requestSelection, reportViewport, suppressNodeDragChrome, settleNodeDragChrome, revealNodeDragChrome });
	sceneGesture.current = { applyNodesChange, requestSelection, reportViewport, suppressNodeDragChrome, settleNodeDragChrome, revealNodeDragChrome };

	// One gesture of the pointer on the scene at a time: a marquee, or a move
	// of the set by its box (canvas selection and arrangement). While a
	// marquee is drawn the workbench is asked nothing: the selection is
	// cleared when it begins and set when the button is released.
	vendor.useEffect(() => {
		const view = host.ownerDocument.defaultView;
		if (!view) {
			return;
		}
		let gesture: IBaseHalfCanvasScenePressGesture | undefined;
		let swallowClickUntil = 0;
		// A wheel can move the canvas while the button is held.
		followSceneGesture.current = () => {
			if (gesture?.phase === 'active' && !gesture.released) {
				follow(gesture);
			}
		};
		const marquee = host.ownerDocument.createElement('div');
		marquee.className = 'basehalf-canvas-marquee';
		marquee.hidden = true;
		host.appendChild(marquee);

		const showBoxed = (next: ReadonlySet<string>, previous: ReadonlySet<string>): void => {
			if (next.size === 0 && previous.size === 0) {
				return;
			}
			const elementOf = new Map(nodesRef.current.map(node => [node.id, node.data.card.element]));
			for (const path of previous) {
				if (!next.has(path)) {
					elementOf.get(path)?.classList.remove('marquee-selected');
				}
			}
			for (const path of next) {
				if (!previous.has(path)) {
					elementOf.get(path)?.classList.add('marquee-selected');
				}
			}
		};
		// A line is marked by an attribute that the canvas library never
		// writes, so a render of the connection during the marquee keeps it.
		const showBoxedLines = (next: ReadonlySet<string>, previous: ReadonlySet<string>): void => {
			if (next.size === 0 && previous.size === 0) {
				return;
			}
			for (const element of host.querySelectorAll<SVGElement>('.react-flow__edge')) {
				const id = element.dataset.id;
				element.toggleAttribute(MARQUEE_SELECTED_LINE_ATTRIBUTE, id !== undefined && next.has(id));
			}
		};
		const linesInMarquee = (rect: IBaseHalfCanvasArrangeRect): Set<string> => {
			const rectOf = new Map(nodesRef.current.map(node => [node.id, flowNodeRect(node)]));
			const lines: IBaseHalfCanvasArrangeLine[] = [];
			for (const flowEdge of edgesRef.current) {
				const edge = flowEdge.data?.edge;
				const from = rectOf.get(flowEdge.source);
				const to = rectOf.get(flowEdge.target);
				if (edge && from && to) {
					lines.push({ id: flowEdge.id, from, fromAnchor: edge.from_anchor, to, toAnchor: edge.to_anchor });
				}
			}
			return new Set(baseHalfCanvasLinesInMarquee(lines, rect));
		};
		const drawMarquee = (current: IBaseHalfCanvasScenePressGesture): void => {
			const flow = flowRef.current;
			if (!flow || !current.startFlow) {
				return;
			}
			const pointer = flow.screenToFlowPosition({ x: current.clientX, y: current.clientY });
			const rect = {
				x: Math.min(current.startFlow.x, pointer.x),
				y: Math.min(current.startFlow.y, pointer.y),
				width: Math.abs(pointer.x - current.startFlow.x),
				height: Math.abs(pointer.y - current.startFlow.y)
			};
			const next = new Set(baseHalfCanvasCardsInMarquee(nodesRef.current.map(flowNodeRect), rect));
			showBoxed(next, current.boxed);
			current.boxed = next;
			// Connections only while no card is touched: cards and connections
			// are never selected together.
			const nextLines = next.size === 0 ? linesInMarquee(rect) : new Set<string>();
			showBoxedLines(nextLines, current.boxedLines);
			current.boxedLines = nextLines;
			// The point of the press stays where it was on the canvas.
			const start = flow.flowToScreenPosition(current.startFlow);
			const bounds = host.getBoundingClientRect();
			marquee.style.transform = `translate(${Math.min(start.x, current.clientX) - bounds.left}px, ${Math.min(start.y, current.clientY) - bounds.top}px)`;
			marquee.style.width = `${Math.abs(current.clientX - start.x)}px`;
			marquee.style.height = `${Math.abs(current.clientY - start.y)}px`;
		};
		const moveSet = (current: IBaseHalfCanvasScenePressGesture, final: boolean): void => {
			const flow = flowRef.current;
			const drag = current.drag;
			if (!flow || !drag || drag.cancelled || !current.startFlow) {
				return;
			}
			const pointer = flow.screenToFlowPosition({ x: current.clientX, y: current.clientY });
			const dx = pointer.x - current.startFlow.x;
			const dy = pointer.y - current.startFlow.y;
			sceneGesture.current.applyNodesChange(drag.origins.map(origin => ({
				id: origin.id,
				type: 'position' as const,
				position: { x: origin.x + dx, y: origin.y + dy },
				dragging: !final
			})), false);
		};
		const follow = (current: IBaseHalfCanvasScenePressGesture): void => {
			if (current.kind === 'marquee') {
				drawMarquee(current);
			} else {
				moveSet(current, false);
			}
		};
		const autoPan = (current: IBaseHalfCanvasScenePressGesture): void => {
			if (gesture !== current || current.phase !== 'active') {
				return;
			}
			const bounds = host.getBoundingClientRect();
			const x = baseHalfCanvasAutoPanStep(current.clientX - bounds.left, bounds.width);
			const y = baseHalfCanvasAutoPanStep(current.clientY - bounds.top, bounds.height);
			if (x !== 0 || y !== 0) {
				connectionStoreController.current?.panBy(x, y);
				current.panned = true;
				follow(current);
			}
			current.frame = view.requestAnimationFrame(() => autoPan(current));
		};
		const capturePointer = (current: IBaseHalfCanvasScenePressGesture): void => {
			try {
				host.setPointerCapture(current.pointerId);
			} catch {
				// The pointer is gone. Its release ends the gesture.
			}
		};
		const finish = (current: IBaseHalfCanvasScenePressGesture, cancelled: boolean): void => {
			gesture = undefined;
			if (current.frame !== undefined) {
				view.cancelAnimationFrame(current.frame);
			}
			if (current.phase === 'pressed') {
				return;
			}
			if (host.hasPointerCapture(current.pointerId)) {
				host.releasePointerCapture(current.pointerId);
			}
			if (!current.released) {
				// The click that follows the release belongs to the gesture.
				swallowClickUntil = view.performance.now() + 350;
			}
			if (current.kind === 'marquee' && current.phase === 'opening' && !cancelled && !current.released) {
				// The selection is still being cleared, for example while a Note
				// closes. The marquee selects when that is done.
				current.released = true;
				gesture = current;
				return;
			}
			if (current.kind === 'marquee') {
				const boxed = current.boxed;
				const boxedLines = current.boxedLines;
				showBoxed(new Set(), boxed);
				showBoxedLines(new Set(), boxedLines);
				marquee.hidden = true;
				const selects = current.phase === 'active' && !cancelled;
				endInteraction();
				if (selects) {
					void sceneGesture.current.requestSelection(boxed.size > 0 || boxedLines.size === 0
						? { cardPaths: nodesRef.current.filter(node => boxed.has(node.id)).map(node => node.id) }
						: { edgeIds: edgesRef.current.filter(edge => boxedLines.has(edge.id)).map(edge => edge.id) });
					host.focus({ preventScroll: true });
				}
			} else {
				const drag = current.drag;
				if (drag && !drag.cancelled && !cancelled) {
					moveSet(current, true);
					nodeDragState.current = undefined;
					endInteraction();
					sceneGesture.current.settleNodeDragChrome(drag);
					view.requestAnimationFrame(() => sceneGesture.current.revealNodeDragChrome(drag));
				}
			}
			if (current.panned && flowRef.current) {
				sceneGesture.current.reportViewport(sceneKeyRef.current, flowRef.current.getViewport(), true);
			}
		};
		const open = (current: IBaseHalfCanvasScenePressGesture): void => {
			const flow = flowRef.current;
			if (!flow) {
				gesture = undefined;
				return;
			}
			current.startFlow = flow.screenToFlowPosition({ x: current.startClientX, y: current.startClientY });
			if (current.kind === 'move') {
				const set = nodesRef.current.filter(node => node.selected);
				if (set.length < 2) {
					gesture = undefined;
					return;
				}
				selectionIntents.current.invalidate();
				pendingSelectionRequest.current = undefined;
				const drag: IBaseHalfCanvasNodeDragState = {
					sceneKey: sceneKeyRef.current,
					structuralEpoch: structuralEpochRef.current,
					token: ++nodeDragToken.current,
					primaryPath: set[0].id,
					selectionAtStart: set.map(node => node.id),
					origins: captureBaseHalfCanvasNodeDragOrigins(nodesRef.current, new Set(set.map(node => node.id))),
					cancelled: false
				};
				nodeDragState.current = drag;
				current.drag = drag;
				sceneGesture.current.suppressNodeDragChrome(drag);
				beginInteraction();
				capturePointer(current);
				current.phase = 'active';
				moveSet(current, false);
				autoPan(current);
				return;
			}
			current.phase = 'opening';
			beginInteraction();
			capturePointer(current);
			void sceneGesture.current.requestSelection({}).then(cleared => {
				if (gesture !== current) {
					return;
				}
				if (!cleared) {
					// A Note that is being edited could not be closed.
					finish(current, true);
					return;
				}
				current.phase = 'active';
				if (current.released) {
					drawMarquee(current);
					finish(current, false);
					return;
				}
				marquee.hidden = false;
				drawMarquee(current);
				autoPan(current);
			});
		};

		const onPointerDown = (event: PointerEvent): void => {
			swallowClickUntil = 0;
			if (gesture?.phase === 'pressed') {
				// Its release never came. A new press takes its place.
				gesture = undefined;
			}
			if (gesture?.released) {
				// A new press does not wait for a marquee that was let go.
				finish(gesture, true);
			}
			if (gesture || event.button !== 0 || !event.isPrimary || host.dataset.videoInputPickActive || !isCanvasElement(event.target)) {
				return;
			}
			const kind = baseHalfCanvasScenePressGesture(event.target, event.shiftKey);
			if (!kind) {
				return;
			}
			const taken = event.shiftKey && !event.target.classList.contains('react-flow__pane');
			gesture = {
				kind,
				pointerId: event.pointerId,
				startClientX: event.clientX,
				startClientY: event.clientY,
				taken,
				clientX: event.clientX,
				clientY: event.clientY,
				phase: 'pressed',
				released: false,
				startFlow: undefined,
				boxed: new Set(),
				boxedLines: new Set(),
				drag: undefined,
				panned: false,
				frame: undefined
			};
			if (taken) {
				// With Shift this press is a marquee or a Shift-click. It never
				// drags the card or the connection under it.
				event.stopPropagation();
			}
		};
		const onMouseDown = (event: MouseEvent): void => {
			// The canvas library begins the drag of a card from the mouse event.
			if (gesture?.taken && event.button === 0) {
				event.stopPropagation();
			}
		};
		const onPointerMove = (event: PointerEvent): void => {
			const current = gesture;
			if (!current || event.pointerId !== current.pointerId) {
				return;
			}
			if (current.released) {
				return;
			}
			if (event.buttons === 0) {
				// The button was released where no release reached the window.
				finish(current, false);
				return;
			}
			current.clientX = event.clientX;
			current.clientY = event.clientY;
			if (current.phase === 'pressed') {
				if (Math.hypot(event.clientX - current.startClientX, event.clientY - current.startClientY) > CANVAS_PRESS_CLICK_DISTANCE) {
					open(current);
				}
			} else if (current.phase === 'active') {
				follow(current);
			}
		};
		const onPointerUp = (event: PointerEvent): void => {
			if (gesture && !gesture.released && event.pointerId === gesture.pointerId) {
				finish(gesture, false);
			}
		};
		const onPointerCancel = (event: PointerEvent): void => {
			if (gesture && event.pointerId === gesture.pointerId) {
				finish(gesture, true);
			}
		};
		const onBlur = (): void => {
			if (gesture) {
				finish(gesture, true);
			}
		};
		const onClick = (event: MouseEvent): void => {
			if (view.performance.now() < swallowClickUntil) {
				swallowClickUntil = 0;
				event.stopPropagation();
				event.preventDefault();
			}
		};
		host.addEventListener('pointerdown', onPointerDown, true);
		host.addEventListener('mousedown', onMouseDown, true);
		host.addEventListener('click', onClick, true);
		view.addEventListener('pointermove', onPointerMove, true);
		view.addEventListener('pointerup', onPointerUp, true);
		view.addEventListener('pointercancel', onPointerCancel, true);
		view.addEventListener('blur', onBlur);
		return () => {
			host.removeEventListener('pointerdown', onPointerDown, true);
			host.removeEventListener('mousedown', onMouseDown, true);
			host.removeEventListener('click', onClick, true);
			view.removeEventListener('pointermove', onPointerMove, true);
			view.removeEventListener('pointerup', onPointerUp, true);
			view.removeEventListener('pointercancel', onPointerCancel, true);
			view.removeEventListener('blur', onBlur);
			if (gesture) {
				finish(gesture, true);
			}
			followSceneGesture.current = undefined;
			marquee.remove();
		};
	}, [beginInteraction, endInteraction]);

	return { toggleSetCardAt, arrangeSet, followSceneGesture };
}
