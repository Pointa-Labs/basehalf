/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfCanvasReferenceEdge.css';
import { baseHalfCanvasEdgePath } from '../../common/basehalfCanvasModel.js';
import {
	baseHalfCanvasReconnectEndForPath,
	baseHalfCanvasReconnectSnapForHit,
	BaseHalfCanvasReconnectHit,
	BaseHalfCanvasEdgeReconnectEnd,
	IBaseHalfCanvasReconnectSnap,
	resolveBaseHalfCanvasReconnectPoint
} from '../../common/basehalfCanvasEdgeReconnect.js';
import type { EdgeProps } from '@xyflow/react';
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import { BaseHalfCanvasFlowEdge, BaseHalfCanvasFlowNode, baseHalfCanvasInteractionOwnsEscape, EDGE_RECONNECT_ANCHORS, IBaseHalfCanvasSceneEnvironment } from './basehalfCanvasSceneShared.js';

interface IBaseHalfCanvasEdgeReconnectState {
	readonly end: BaseHalfCanvasEdgeReconnectEnd;
	readonly pointerId: number;
	readonly started: boolean;
	readonly startClient: { readonly x: number; readonly y: number };
	readonly currentClient: { readonly x: number; readonly y: number };
	readonly snapped: IBaseHalfCanvasReconnectSnap | null;
	/** The immutable scene owner captured at pointer-down. */
	readonly flowEdge: BaseHalfCanvasFlowEdge;
}
const EDGE_RECONNECT_DRAG_THRESHOLD = 4;
const EDGE_RECONNECT_PATH_SAMPLES = 80;
const EDGE_RECONNECT_CURSOR_CLASS = 'basehalf-canvas-edge-reconnecting';
const edgeReconnectCursorLocks = new WeakMap<Document, number>();

function lockEdgeReconnectCursor(document: Document): () => void {
	const next = (edgeReconnectCursorLocks.get(document) ?? 0) + 1;
	edgeReconnectCursorLocks.set(document, next);
	document.body.classList.add(EDGE_RECONNECT_CURSOR_CLASS);
	let released = false;
	return () => {
		if (released) {
			return;
		}
		released = true;
		const remaining = Math.max(0, (edgeReconnectCursorLocks.get(document) ?? 1) - 1);
		if (remaining === 0) {
			edgeReconnectCursorLocks.delete(document);
			document.body.classList.remove(EDGE_RECONNECT_CURSOR_CLASS);
		} else {
			edgeReconnectCursorLocks.set(document, remaining);
		}
	};
}

function reconnectEndForSvgPath(
	path: SVGPathElement,
	clientX: number,
	clientY: number
): BaseHalfCanvasEdgeReconnectEnd | undefined {
	const total = path.getTotalLength();
	const ctm = path.getScreenCTM();
	if (!ctm || total <= 0) {
		return undefined;
	}
	const samples = [];
	for (let index = 0; index <= EDGE_RECONNECT_PATH_SAMPLES; index++) {
		const ratio = index / EDGE_RECONNECT_PATH_SAMPLES;
		const pathPoint = path.getPointAtLength(total * ratio);
		const svgPoint = path.ownerSVGElement?.createSVGPoint();
		if (!svgPoint) {
			continue;
		}
		svgPoint.x = pathPoint.x;
		svgPoint.y = pathPoint.y;
		const screenPoint = svgPoint.matrixTransform(ctm);
		samples.push({ x: screenPoint.x, y: screenPoint.y, ratio });
	}
	return baseHalfCanvasReconnectEndForPath(samples, { x: clientX, y: clientY });
}

function snapReconnectPointer(
	host: HTMLElement,
	clientX: number,
	clientY: number,
	excludedNodeId: string
): BaseHalfCanvasReconnectHit {
	const rects = [];
	for (const card of host.querySelectorAll<HTMLElement>('.basehalf-canvas-card[data-basehalf-card-path]')) {
		const nodeId = card.dataset.basehalfCardPath;
		const node = card.closest<HTMLElement>('.react-flow__node');
		if (!nodeId || !node) {
			continue;
		}
		const rect = node.getBoundingClientRect();
		rects.push({ nodeId, left: rect.left, top: rect.top, width: rect.width, height: rect.height });
	}
	return resolveBaseHalfCanvasReconnectPoint(
		{ x: clientX, y: clientY },
		rects,
		new Set([excludedNodeId])
	);
}

function clearEdgeReconnectTarget(host: HTMLElement, edgeId: string): void {
	for (const card of host.querySelectorAll<HTMLElement>('.basehalf-canvas-card.connection-target')) {
		if (card.dataset.basehalfReconnectEdgeId !== edgeId) {
			continue;
		}
		card.classList.remove('connection-target', ...EDGE_RECONNECT_ANCHORS);
		delete card.dataset.basehalfReconnectEdgeId;
	}
	for (const node of host.querySelectorAll<HTMLElement>('.react-flow__node.connection-target')) {
		if (node.dataset.basehalfReconnectEdgeId !== edgeId) {
			continue;
		}
		node.classList.remove('connection-target');
		delete node.dataset.basehalfReconnectEdgeId;
	}
	for (const handle of host.querySelectorAll<HTMLElement>('.basehalf-canvas-card-connect-handle.connection-target')) {
		if (handle.dataset.basehalfReconnectEdgeId !== edgeId) {
			continue;
		}
		handle.classList.remove('connection-target');
		delete handle.dataset.basehalfReconnectEdgeId;
	}
}

function showEdgeReconnectTarget(host: HTMLElement, edgeId: string, snap: IBaseHalfCanvasReconnectSnap): void {
	clearEdgeReconnectTarget(host, edgeId);
	const card = Array.from(host.querySelectorAll<HTMLElement>('.basehalf-canvas-card[data-basehalf-card-path]'))
		.find(candidate => candidate.dataset.basehalfCardPath === snap.nodeId);
	const node = card?.closest<HTMLElement>('.react-flow__node');
	if (!card || !node) {
		return;
	}
	card.classList.add('connection-target', snap.anchor);
	node.classList.add('connection-target');
	card.dataset.basehalfReconnectEdgeId = edgeId;
	node.dataset.basehalfReconnectEdgeId = edgeId;
	const handle = node.querySelector<HTMLElement>(`:scope > .basehalf-canvas-card-connect-handle.${snap.anchor}`);
	handle?.classList.add('connection-target');
	if (handle) {
		handle.dataset.basehalfReconnectEdgeId = edgeId;
	}
}

/**
 * Makes the edge of a reference: the line between two cards, and reconnecting
 * it by dragging either half of the line to another card.
 */
export function createBaseHalfCanvasReferenceEdge(environment: IBaseHalfCanvasSceneEnvironment) {
	const { vendor, h, host, EdgeInteractionContext } = environment;

	function ReferenceEdge(props: EdgeProps<BaseHalfCanvasFlowEdge>): ReactElement {
		const edge = props.data?.edge;
		const [hover, setHover] = vendor.useState(false);
		const [reconnect, setReconnect] = vendor.useState<IBaseHalfCanvasEdgeReconnectState | null>(null);
		const hitPathRef = vendor.useRef<SVGPathElement>(null);
		const releaseCursorRef = vendor.useRef<(() => void) | undefined>(undefined);
		const interaction = vendor.useContext(EdgeInteractionContext);
		const interactionRef = vendor.useRef(interaction);
		interactionRef.current = interaction;
		const reconnectInteractionActiveRef = vendor.useRef(false);
		const flow = vendor.useReactFlow<BaseHalfCanvasFlowNode, BaseHalfCanvasFlowEdge>();

		const finishReconnect = vendor.useCallback(() => {
			releaseCursorRef.current?.();
			releaseCursorRef.current = undefined;
			clearEdgeReconnectTarget(host, props.id);
			setReconnect(null);
			if (reconnectInteractionActiveRef.current) {
				reconnectInteractionActiveRef.current = false;
				interactionRef.current?.end();
			}
		}, []);

		vendor.useEffect(() => () => {
			releaseCursorRef.current?.();
			releaseCursorRef.current = undefined;
			clearEdgeReconnectTarget(host, props.id);
			if (reconnectInteractionActiveRef.current) {
				reconnectInteractionActiveRef.current = false;
				interactionRef.current?.end();
			}
		}, []);

		vendor.useLayoutEffect(() => {
			if (reconnect?.started && reconnect.snapped) {
				showEdgeReconnectTarget(host, props.id, reconnect.snapped);
			} else {
				clearEdgeReconnectTarget(host, props.id);
			}
			return () => clearEdgeReconnectTarget(host, props.id);
		}, [reconnect?.snapped, reconnect?.started]);

		vendor.useEffect(() => {
			if (!reconnect || !interaction) {
				return;
			}
			const window = host.ownerDocument.defaultView;
			if (!window) {
				return;
			}
			const previous = reconnect.flowEdge.data?.edge;
			if (!previous) {
				finishReconnect();
				return;
			}
			const snapForPointer = (event: globalThis.PointerEvent) => snapReconnectPointer(
				host,
				event.clientX,
				event.clientY,
				reconnect.end === 'source' ? previous.to : previous.from
			);
			const movedFarEnough = (event: globalThis.PointerEvent) => Math.hypot(
				event.clientX - reconnect.startClient.x,
				event.clientY - reconnect.startClient.y
			) >= EDGE_RECONNECT_DRAG_THRESHOLD;

			const onPointerMove = (event: globalThis.PointerEvent) => {
				if (!reconnectInteractionActiveRef.current || event.pointerId !== reconnect.pointerId) {
					return;
				}
				setReconnect(current => {
					if (current?.pointerId !== event.pointerId) {
						return current;
					}
					const started = current.started || movedFarEnough(event);
					const hit = started ? snapForPointer(event) : undefined;
					return {
						...current,
						started,
						currentClient: { x: event.clientX, y: event.clientY },
						snapped: hit?.kind === 'snap' ? hit.snap : null
					};
				});
			};
			const onPointerUp = (event: globalThis.PointerEvent) => {
				// Escape flips the synchronous active latch before React commits the
				// state/effect cleanup. A trailing pointerup from that same physical
				// gesture must therefore be rejected here, not by render timing.
				if (!reconnectInteractionActiveRef.current || event.pointerId !== reconnect.pointerId) {
					return;
				}
				const started = reconnect.started || movedFarEnough(event);
				if (!started) {
					interaction.select(reconnect.flowEdge);
					finishReconnect();
					return;
				}

				const snapped = baseHalfCanvasReconnectSnapForHit(snapForPointer(event));
				if (!snapped) {
					finishReconnect();
					return;
				}
				interaction.reconnect(reconnect.flowEdge, {
					source: reconnect.end === 'source' ? snapped.nodeId : previous.from,
					sourceHandle: reconnect.end === 'source' ? snapped.anchor : previous.from_anchor,
					target: reconnect.end === 'target' ? snapped.nodeId : previous.to,
					targetHandle: reconnect.end === 'target' ? snapped.anchor : previous.to_anchor
				});
				finishReconnect();
			};
			const onPointerCancel = (event: globalThis.PointerEvent) => {
				if (!reconnectInteractionActiveRef.current || event.pointerId !== reconnect.pointerId) {
					return;
				}
				finishReconnect();
			};
			const onKeyDown = (event: KeyboardEvent) => {
				if (!baseHalfCanvasInteractionOwnsEscape(event)) {
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				finishReconnect();
			};

			window.addEventListener('pointermove', onPointerMove, true);
			window.addEventListener('pointerup', onPointerUp, true);
			window.addEventListener('pointercancel', onPointerCancel, true);
			window.addEventListener('keydown', onKeyDown, true);
			window.addEventListener('blur', finishReconnect);
			return () => {
				window.removeEventListener('pointermove', onPointerMove, true);
				window.removeEventListener('pointerup', onPointerUp, true);
				window.removeEventListener('pointercancel', onPointerCancel, true);
				window.removeEventListener('keydown', onKeyDown, true);
				window.removeEventListener('blur', finishReconnect);
			};
		}, [finishReconnect, interaction, reconnect]);

		if (!edge || !props.data || !interaction) {
			return h(vendor.Fragment);
		}
		const flowEdge: BaseHalfCanvasFlowEdge = {
			id: props.id,
			type: 'basehalf-reference',
			source: props.source,
			target: props.target,
			sourceHandle: props.sourceHandleId,
			targetHandle: props.targetHandleId,
			data: props.data,
			selected: props.selected,
			reconnectable: false
		};
		const staticPath = baseHalfCanvasEdgePath(
			{ x: props.sourceX, y: props.sourceY },
			edge.from_anchor,
			{ x: props.targetX, y: props.targetY },
			edge.to_anchor
		);
		const reconnecting = reconnect?.started === true;
		const reconnectClientPoint = reconnecting
			? reconnect.snapped?.clientPoint ?? reconnect.currentClient
			: undefined;
		const reconnectFlowPoint = reconnectClientPoint ? flow.screenToFlowPosition(reconnectClientPoint) : undefined;
		const displaySource = reconnecting && reconnect.end === 'source' && reconnectFlowPoint
			? reconnectFlowPoint
			: { x: props.sourceX, y: props.sourceY };
		const displayTarget = reconnecting && reconnect.end === 'target' && reconnectFlowPoint
			? reconnectFlowPoint
			: { x: props.targetX, y: props.targetY };
		const displaySourceAnchor = reconnecting && reconnect.end === 'source' && reconnect.snapped
			? reconnect.snapped.anchor
			: edge.from_anchor;
		const displayTargetAnchor = reconnecting && reconnect.end === 'target' && reconnect.snapped
			? reconnect.snapped.anchor
			: edge.to_anchor;
		const displayPath = reconnecting ? baseHalfCanvasEdgePath(
			displaySource,
			displaySourceAnchor,
			displayTarget,
			displayTargetAnchor
		) : staticPath;
		const beginReconnect = (event: ReactPointerEvent<Element>) => {
			if (event.button !== 0 || reconnect) {
				return;
			}
			const path = hitPathRef.current;
			const end = path ? reconnectEndForSvgPath(path, event.clientX, event.clientY) : undefined;
			if (!end || !interaction.begin(flowEdge)) {
				return;
			}
			reconnectInteractionActiveRef.current = true;
			event.preventDefault();
			event.stopPropagation();
			releaseCursorRef.current?.();
			releaseCursorRef.current = lockEdgeReconnectCursor(host.ownerDocument);
			setReconnect({
				end,
				pointerId: event.pointerId,
				started: false,
				startClient: { x: event.clientX, y: event.clientY },
				currentClient: { x: event.clientX, y: event.clientY },
				snapped: null,
				flowEdge
			});
		};

		return h(vendor.Fragment, null,
			h('path', {
				className: `basehalf-canvas-edge-path${hover ? ' hover' : ''}${props.selected ? ' selected' : ''}${reconnecting ? ' reconnecting' : ''}`,
				d: displayPath,
				markerEnd: props.markerEnd,
				'data-edge-id': edge.id,
				'data-reconnect-end': reconnecting ? reconnect.end : undefined
			}),
			h('path', {
				ref: hitPathRef,
				className: `basehalf-canvas-edge-hit${props.selected ? ' selected' : ''}`,
				d: staticPath,
				'data-edge-id': edge.id,
				onMouseEnter: () => setHover(true),
				onMouseLeave: () => setHover(false),
				onPointerDown: beginReconnect
			})
		);
	}

	return ReferenceEdge;
}
