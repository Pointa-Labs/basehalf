/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { BaseHalfCanvasAnchor, baseHalfCanvasAnchorPoint } from '../../common/basehalfCanvasModel.js';
import { IBaseHalfCanvasSnapGuide } from '../../common/basehalfCanvasSnap.js';
import { baseHalfCanvasConnectHandleReachLimit } from '../../common/basehalfCanvasScene.js';
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactElement, ReactNode, RefObject } from 'react';
import { BaseHalfCanvasFlowEdge, BaseHalfCanvasFlowNode, baseHalfCanvasSceneCardIsNoteEditing, EDGE_RECONNECT_ANCHORS, IBaseHalfCanvasConnectionStoreController, IBaseHalfCanvasSceneEnvironment } from './basehalfCanvasSceneShared.js';

interface IBaseHalfCanvasConnectCaptureStyle extends CSSProperties {
	readonly '--bh-connect-reach-limit': string;
}

/**
 * Makes what the scene draws over the cards: the circles that begin a
 * connection, the line kept after a connection is let go on the canvas, and
 * the snap guides; and the bridge that gives the scene React Flow's store.
 */
export function createBaseHalfCanvasSceneOverlays(environment: IBaseHalfCanvasSceneEnvironment) {
	const { vendor, h, host } = environment;

	function ConnectionStoreBridge({ register }: {
		readonly register: (controller: IBaseHalfCanvasConnectionStoreController | undefined) => void;
	}): ReactElement {
		const store = vendor.useStoreApi<BaseHalfCanvasFlowNode, BaseHalfCanvasFlowEdge>();
		const controller = vendor.useMemo<IBaseHalfCanvasConnectionStoreController>(() => ({
			cancel: () => {
				const state = store.getState();
				state.cancelConnection();
				store.setState({ connectionClickStartHandle: null });
			},
			clearClickStart: () => store.setState({ connectionClickStartHandle: null }),
			panBy: (x, y) => {
				void store.getState().panBy({ x, y });
			}
		}), [store]);
		vendor.useLayoutEffect(() => {
			register(controller);
			return () => register(undefined);
		}, [controller, register]);
		return h(vendor.Fragment);
	}

	function connectHandleElement(nodeId: string, anchor: BaseHalfCanvasAnchor): HTMLElement | null {
		return host.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(nodeId)}"] > .basehalf-canvas-card-connect-handle.${anchor}`);
	}

	function forwardToConnectHandle(event: ReactMouseEvent<HTMLElement>, nodeId: string, anchor: BaseHalfCanvasAnchor): void {
		const handle = connectHandleElement(nodeId, anchor);
		if (!handle) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		// The handle owns the gesture: React Flow starts a drag from its
		// mousedown and click-to-connect from its click.
		handle.dispatchEvent(new MouseEvent(event.type, {
			bubbles: true,
			cancelable: true,
			composed: true,
			view: event.nativeEvent.view,
			detail: event.detail,
			clientX: event.clientX,
			clientY: event.clientY,
			screenX: event.screenX,
			screenY: event.screenY,
			button: event.button,
			buttons: event.buttons,
			altKey: event.altKey,
			ctrlKey: event.ctrlKey,
			metaKey: event.metaKey,
			shiftKey: event.shiftKey
		}));
	}

	/**
	 * One handle's capture circle. It lies below edges and cards, so it takes
	 * the pointer only where nothing else on the canvas does, and hands every
	 * press and click to its handle.
	 */
	const ConnectCapture = vendor.memo(function ConnectCapture({ nodeId, anchor, x, y, reachLimit }: {
		readonly nodeId: string;
		readonly anchor: BaseHalfCanvasAnchor;
		readonly x: number;
		readonly y: number;
		readonly reachLimit: number;
	}): ReactElement {
		const setSnapped = vendor.useCallback((snapped: boolean) => {
			const handle = connectHandleElement(nodeId, anchor);
			handle?.classList.toggle('snapped', snapped);
			// The node class shows all of the card's handles.
			handle?.parentElement?.classList.toggle('basehalf-canvas-connect-near', snapped);
		}, [nodeId, anchor]);
		vendor.useEffect(() => () => setSnapped(false), [setSnapped]);
		const style: IBaseHalfCanvasConnectCaptureStyle = { left: x, top: y, '--bh-connect-reach-limit': `${reachLimit}px` };
		return h('div', {
			// Not `nopan`: middle- and right-button drags still pan from here.
			className: `basehalf-canvas-connect-capture ${anchor}`,
			'data-node-id': nodeId,
			'data-anchor': anchor,
			style,
			onPointerEnter: () => setSnapped(true),
			onPointerLeave: () => setSnapped(false),
			onMouseDown: (event: ReactMouseEvent<HTMLElement>) => {
				if (event.button === 0) {
					forwardToConnectHandle(event, nodeId, anchor);
				}
			},
			onClick: (event: ReactMouseEvent<HTMLElement>) => forwardToConnectHandle(event, nodeId, anchor)
		});
	});

	function ConnectCaptureLayer({ nodes, disabled }: { readonly nodes: readonly BaseHalfCanvasFlowNode[]; readonly disabled: boolean }): ReactElement {
		if (disabled) {
			return h(vendor.Fragment);
		}
		const captures: ReactNode[] = [];
		// The cards of a set show no handles. The box covers only the inner half
		// of a capture circle, so the circles of those cards are not drawn.
		const set = nodes.filter(node => node.selected).length >= 2;
		for (const node of nodes) {
			if (node.dragging || (set && node.selected) || baseHalfCanvasSceneCardIsNoteEditing(node.data.card)) {
				continue;
			}
			const bounds = {
				x: node.position.x,
				y: node.position.y,
				width: node.measured?.width ?? node.width ?? node.data.card.width,
				height: node.measured?.height ?? node.height ?? node.data.card.height
			};
			for (const anchor of EDGE_RECONNECT_ANCHORS) {
				const point = baseHalfCanvasAnchorPoint(bounds, anchor);
				captures.push(h(ConnectCapture, {
					key: `${node.id}\0${anchor}`,
					nodeId: node.id,
					anchor,
					x: point.x,
					y: point.y,
					reachLimit: baseHalfCanvasConnectHandleReachLimit(anchor, bounds)
				}));
			}
		}
		// A negative z-index places the layer below the viewport's edges and
		// nodes: cards and edges keep the pointer over it.
		return h(vendor.ViewportPortal, null,
			h('div', { className: 'basehalf-canvas-connect-capture-layer' }, ...captures)
		);
	}

	function ConnectionDropLine({ path, elementRef }: { readonly path: string; readonly elementRef: RefObject<SVGSVGElement | null> }): ReactElement {
		return h(vendor.ViewportPortal, null,
			h('svg', {
				ref: elementRef,
				className: 'basehalf-canvas-connection-drop-line',
				width: 1,
				height: 1,
				style: { position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }
			}, h('path', { 'data-testid': 'canvas-connection-drop-line', d: path }))
		);
	}

	function SnapGuides({ guides, zoom }: { readonly guides: readonly IBaseHalfCanvasSnapGuide[]; readonly zoom: number }): ReactElement {
		if (guides.length === 0) {
			return h(vendor.Fragment);
		}
		const thickness = 1 / Math.max(0.2, zoom);
		return h(vendor.ViewportPortal, null,
			h('svg', {
				className: 'basehalf-canvas-snap-guides',
				width: 1,
				height: 1,
				style: { position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }
			}, ...guides.map((guide, index): ReactNode => guide.orientation === 'vertical'
				? h('line', {
					key: `v:${index}`,
					'data-testid': 'canvas-snap-guide',
					className: 'basehalf-canvas-snap-guide-line',
					x1: guide.x,
					x2: guide.x,
					y1: guide.y1 - 10,
					y2: guide.y2 + 10,
					strokeWidth: thickness
				})
				: h('line', {
					key: `h:${index}`,
					'data-testid': 'canvas-snap-guide',
					className: 'basehalf-canvas-snap-guide-line',
					x1: guide.x1 - 10,
					x2: guide.x2 + 10,
					y1: guide.y,
					y2: guide.y,
					strokeWidth: thickness
				})))
		);
	}

	return { ConnectionStoreBridge, ConnectCaptureLayer, ConnectionDropLine, SnapGuides };
}
