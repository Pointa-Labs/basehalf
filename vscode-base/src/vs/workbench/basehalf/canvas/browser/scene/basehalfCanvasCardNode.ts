/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfCanvasCardNode.css';
import { isHTMLElement, isSVGElement } from '../../../../../base/browser/dom.js';
import { BASEHALF_CANVAS_MIN_CARD_HEIGHT, BASEHALF_CANVAS_MIN_CARD_WIDTH } from '../../common/basehalfCanvasModel.js';
import { baseHalfCanvasCardPresentation } from '../../common/basehalfCanvasCardPresentation.js';
import { BASEHALF_CANVAS_MIN_ZOOM } from '../../../shell/common/basehalfConfiguration.js';
import { IBaseHalfCanvasSceneCard, BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP, BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT, BASEHALF_CANVAS_CARD_CORNER_RADIUS } from '../../common/basehalfCanvasScene.js';
import { buildBaseHalfCanvasNotePartsTo } from '../basehalfCanvasNoteParts.js';
import type { NodeProps } from '@xyflow/react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import { BaseHalfCanvasFlowEdge, BaseHalfCanvasFlowNode, baseHalfCanvasSceneCardIsNoteEditing, baseHalfCanvasSceneVideoInputPickGesturePolicy, flowPosition, IBaseHalfCanvasSceneEnvironment } from './basehalfCanvasSceneShared.js';

export function baseHalfCanvasResizeStartSize(
	bounds: Pick<DOMRect, 'width' | 'height'>,
	zoom: number,
	fallback: Pick<IBaseHalfCanvasSceneCard, 'width' | 'height'>
): Pick<IBaseHalfCanvasSceneCard, 'width' | 'height'> {
	const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
	const width = bounds.width / safeZoom;
	const height = bounds.height / safeZoom;
	const safeDimension = (value: number, fallbackValue: number, minimum: number): number => Math.max(
		minimum,
		Number.isFinite(value) && value > 0
			? value
			: Number.isFinite(fallbackValue) && fallbackValue > 0 ? fallbackValue : minimum
	);
	return {
		width: safeDimension(width, fallback.width, BASEHALF_CANVAS_MIN_CARD_WIDTH),
		height: safeDimension(height, fallback.height, BASEHALF_CANVAS_MIN_CARD_HEIGHT)
	};
}

export type BaseHalfCanvasResizeCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

type BaseHalfCanvasResizeSide = 'top' | 'right' | 'bottom' | 'left';

const RESIZE_CORNERS: readonly BaseHalfCanvasResizeCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const RESIZE_SIDES: readonly BaseHalfCanvasResizeSide[] = ['top', 'right', 'bottom', 'left'];
const RESIZE_CORNER_BAND_SCREEN_OUTSET = 12;
const RESIZE_CORNER_BAND_SCREEN_INSET = 8;
const RESIZE_CORNER_BAND_SCREEN_SEAM = 1;
const RESIZE_CORNER_INDICATOR_SCREEN_GAP = 5;
const RESIZE_CORNER_INDICATOR_SCREEN_STROKE = 3;
const RESIZE_CORNER_INDICATOR_SPAN = Math.PI * 50 / 180;

/**
 * Side resize targets cover only the straight part of each side; the rounded
 * ends belong to the corner targets.
 */
const RESIZE_SIDE_STYLES: Readonly<Record<BaseHalfCanvasResizeSide, CSSProperties>> = {
	top: { left: BASEHALF_CANVAS_CARD_CORNER_RADIUS, width: `calc(100% - ${2 * BASEHALF_CANVAS_CARD_CORNER_RADIUS}px)` },
	bottom: { left: BASEHALF_CANVAS_CARD_CORNER_RADIUS, width: `calc(100% - ${2 * BASEHALF_CANVAS_CARD_CORNER_RADIUS}px)` },
	left: { top: BASEHALF_CANVAS_CARD_CORNER_RADIUS, height: `calc(100% - ${2 * BASEHALF_CANVAS_CARD_CORNER_RADIUS}px)` },
	right: { top: BASEHALF_CANVAS_CARD_CORNER_RADIUS, height: `calc(100% - ${2 * BASEHALF_CANVAS_CARD_CORNER_RADIUS}px)` }
};

export interface IBaseHalfCanvasResizeCornerGeometry {
	/** Node-local placement of the control box, whose corner is the arc center. */
	readonly style: {
		readonly left: number | string;
		readonly top: number | string;
		readonly width: number;
		readonly height: number;
		readonly translate: 'none';
	};
	readonly viewBox: string;
	/** The part of the hit band outside the card edge, which stacks below the card. */
	readonly outerBandPath: string;
	readonly outerBandWidth: number;
	/** The part of the hit band inside the card edge, which stacks above the card's content. */
	readonly innerBandPath: string;
	readonly innerBandWidth: number;
	/** The visible arc: the middle of the corner, its round caps included. */
	readonly indicatorPath: string;
	readonly indicatorWidth: number;
}

/**
 * Resolves one corner's resize target and indicator in flow units. Both are
 * concentric with the card's rounded corner and keep constant screen sizes at
 * every zoom, so the target follows the painted silhouette instead of the
 * bounding rectangle.
 */
export function resolveBaseHalfCanvasResizeCornerGeometry(corner: BaseHalfCanvasResizeCorner, zoom: number): IBaseHalfCanvasResizeCornerGeometry {
	const safeZoom = Number.isFinite(zoom) && zoom > 0 ? Math.max(BASEHALF_CANVAS_MIN_ZOOM, zoom) : 1;
	const round = (value: number): number => Math.round(value * 1000) / 1000;
	const radius = BASEHALF_CANVAS_CARD_CORNER_RADIUS;
	const bandInner = Math.max(0, radius - RESIZE_CORNER_BAND_SCREEN_INSET / safeZoom);
	const bandOuter = radius + RESIZE_CORNER_BAND_SCREEN_OUTSET / safeZoom;
	// The inner part reaches just past the edge so no seam opens between the
	// part above the card and the part below it.
	const innerBandOuter = radius + RESIZE_CORNER_BAND_SCREEN_SEAM / safeZoom;
	const indicatorWidth = RESIZE_CORNER_INDICATOR_SCREEN_STROKE / safeZoom;
	const indicatorRadius = radius + RESIZE_CORNER_INDICATOR_SCREEN_GAP / safeZoom + indicatorWidth / 2;
	// A round cap reaches half the stroke past its end point, so pull each end
	// in by that reach to keep the painted mark inside its span.
	const capAngle = Math.min(RESIZE_CORNER_INDICATOR_SPAN / 2, Math.asin(Math.min(1, indicatorWidth / 2 / indicatorRadius)));
	const indicatorFrom = Math.PI / 4 - RESIZE_CORNER_INDICATOR_SPAN / 2 + capAngle;
	const indicatorTo = Math.PI / 4 + RESIZE_CORNER_INDICATOR_SPAN / 2 - capAngle;
	const [vertical, horizontal] = corner.split('-');
	const xSign = horizontal === 'right' ? 1 : -1;
	const ySign = vertical === 'bottom' ? 1 : -1;
	// Angles run from the side tangent point (0) to the top or bottom tangent
	// point (π/2). Mirroring one axis reverses the sweep direction.
	const sweep = xSign * ySign > 0 ? 1 : 0;
	const point = (arcRadius: number, angle: number): string => `${round(xSign * arcRadius * Math.cos(angle))} ${round(ySign * arcRadius * Math.sin(angle))}`;
	const arc = (arcRadius: number, from: number, to: number): string => `M ${point(arcRadius, from)} A ${round(arcRadius)} ${round(arcRadius)} 0 0 ${sweep} ${point(arcRadius, to)}`;
	const extent = round(bandOuter);
	return {
		style: {
			left: xSign > 0 ? `calc(100% - ${radius}px)` : round(radius - bandOuter),
			top: ySign > 0 ? `calc(100% - ${radius}px)` : round(radius - bandOuter),
			width: extent,
			height: extent,
			translate: 'none'
		},
		viewBox: `${xSign > 0 ? 0 : -extent} ${ySign > 0 ? 0 : -extent} ${extent} ${extent}`,
		outerBandPath: arc((radius + bandOuter) / 2, 0, Math.PI / 2),
		outerBandWidth: round(bandOuter - radius),
		innerBandPath: arc((bandInner + innerBandOuter) / 2, 0, Math.PI / 2),
		innerBandWidth: round(innerBandOuter - bandInner),
		indicatorPath: arc(indicatorRadius, indicatorFrom, indicatorTo),
		indicatorWidth: round(indicatorWidth)
	};
}

/** Clears the resizing state and the active corner at the same boundary. */
function clearCardResizeState(element: HTMLElement, host: HTMLElement): void {
	delete element.dataset.cardResizing;
	delete element.dataset.cardResizeCorner;
	delete host.dataset.cardResizing;
}
const CANVAS_PREVIEW_OVERSCAN_VIEWPORTS = 0.75;

export function baseHalfCanvasSceneProjectsSelection(selected: boolean, noteEditing: boolean): boolean {
	return selected && !noteEditing;
}

/**
 * Whether a card shows its resize controls (canvas card resize, "Which cards
 * resize"): the only selected card, not a note being edited, while no video
 * input is being picked, and not a card that keeps its shape.
 */
export function baseHalfCanvasSceneShowsResizeControls(
	selected: boolean,
	noteEditing: boolean,
	selectionSize: number,
	videoInputPickActive = false,
	keepsShape = false
): boolean {
	return !keepsShape
		&& baseHalfCanvasSceneVideoInputPickGesturePolicy(videoInputPickActive).nodesResizable
		&& baseHalfCanvasSceneProjectsSelection(selected, noteEditing)
		&& selectionSize === 1;
}

export function captureBaseHalfCanvasCardFocusPath(root: Element, target: Element | null): readonly number[] | undefined {
	const reversed: number[] = [];
	let current = target;
	while (current && current !== root) {
		const parent = current.parentElement;
		if (!parent) {
			return undefined;
		}
		const index = Array.prototype.indexOf.call(parent.children, current) as number;
		if (index < 0) {
			return undefined;
		}
		reversed.push(index);
		current = parent;
	}
	return current === root ? Object.freeze(reversed.reverse()) : undefined;
}

export function resolveBaseHalfCanvasCardFocusPath(root: Element, path: readonly number[]): Element | undefined {
	let current = root;
	for (const index of path) {
		const child = current.children[index];
		if (!child) {
			return undefined;
		}
		current = child;
	}
	return current;
}

interface ICardResizeControlsProps {
	readonly onResizeStart: () => void;
	readonly onResize: (corner: BaseHalfCanvasResizeCorner | undefined) => void;
	readonly onResizeEnd: () => void;
}

/**
 * Makes the node of a card: the element the canvas view built for the card,
 * put into React Flow, with the corners and sides that resize it and the focus
 * it keeps when its preview is replaced.
 */
export function createBaseHalfCanvasCardNode(environment: IBaseHalfCanvasSceneEnvironment) {
	const { vendor, h, host, delegate, SelectionSizeContext } = environment;

	function CardResizeCorner({ corner, zoom, onResizeStart, onResize, onResizeEnd }: ICardResizeControlsProps & {
		readonly corner: BaseHalfCanvasResizeCorner;
		readonly zoom: number;
	}): ReactElement {
		const markCornerResizing = vendor.useCallback(() => onResize(corner), [corner, onResize]);
		const geometry = resolveBaseHalfCanvasResizeCornerGeometry(corner, zoom);
		// The control box only places the band. It neither paints nor takes the
		// pointer; the band inherits React Flow's diagonal cursor and its press
		// bubbles to the control's drag handler. The band's two parts live in
		// two layers: the outer one stacks below the card, the inner one above it.
		return h(vendor.NodeResizeControl, {
			position: corner,
			variant: vendor.ResizeControlVariant.Handle,
			className: 'basehalf-canvas-node-resizer-handle',
			style: geometry.style,
			autoScale: false,
			minWidth: BASEHALF_CANVAS_MIN_CARD_WIDTH,
			minHeight: BASEHALF_CANVAS_MIN_CARD_HEIGHT,
			onResizeStart,
			onResize: markCornerResizing,
			onResizeEnd
		},
			h('svg', {
				className: 'basehalf-canvas-node-resize-corner',
				viewBox: geometry.viewBox,
				'aria-hidden': true,
				focusable: false
			},
				h('path', {
					className: 'basehalf-canvas-node-resize-corner-band',
					d: geometry.outerBandPath,
					strokeWidth: geometry.outerBandWidth
				}),
				h('path', {
					className: 'basehalf-canvas-node-resize-corner-indicator',
					d: geometry.indicatorPath,
					strokeWidth: geometry.indicatorWidth
				})
			),
			h('svg', {
				className: 'basehalf-canvas-node-resize-corner inner',
				viewBox: geometry.viewBox,
				'aria-hidden': true,
				focusable: false
			},
				h('path', {
					className: 'basehalf-canvas-node-resize-corner-band',
					d: geometry.innerBandPath,
					strokeWidth: geometry.innerBandWidth
				})
			)
		);
	}

	function CardResizeControls({ onResizeStart, onResize, onResizeEnd }: ICardResizeControlsProps): ReactElement {
		// Only the single selected card renders these controls, so following the
		// live zoom here does not re-render the rest of the scene.
		const zoom = vendor.useStore(state => state.transform[2]);
		const markSideResizing = vendor.useCallback(() => onResize(undefined), [onResize]);
		return h(vendor.Fragment, null,
			...RESIZE_SIDES.map(side => h(vendor.NodeResizeControl, {
				key: side,
				position: side,
				variant: vendor.ResizeControlVariant.Line,
				className: 'basehalf-canvas-node-resizer-line',
				style: RESIZE_SIDE_STYLES[side],
				minWidth: BASEHALF_CANVAS_MIN_CARD_WIDTH,
				minHeight: BASEHALF_CANVAS_MIN_CARD_HEIGHT,
				onResizeStart,
				onResize: markSideResizing,
				onResizeEnd
			})),
			...RESIZE_CORNERS.map(corner => h(CardResizeCorner, {
				key: corner,
				corner,
				zoom,
				onResizeStart,
				onResize,
				onResizeEnd
			}))
		);
	}

	function CardNode({ id, data, selected }: NodeProps<BaseHalfCanvasFlowNode>): ReactElement {
		const hostRef = vendor.useRef<HTMLDivElement>(null);
		const replacementFocusPath = vendor.useRef<readonly number[] | undefined>(undefined);
		const replacementScrollPosition = vendor.useRef<number | undefined>(undefined);
		const mountedCardRef = vendor.useRef({ card: data.card, height: data.card.height, retainPresentation: false });
		const activeResizeRef = vendor.useRef<{
			readonly card: IBaseHalfCanvasSceneCard;
			readonly end: () => void;
			readonly removeBoundaryListeners: () => void;
		} | undefined>(undefined);
		const updateNodeInternals = vendor.useUpdateNodeInternals();
		const store = vendor.useStoreApi<BaseHalfCanvasFlowNode, BaseHalfCanvasFlowEdge>();
		const selectionSize = vendor.useContext(SelectionSizeContext);
		const clickConnectionInProgress = vendor.useStore(state => Boolean(state.connectionClickStartHandle));
		const nearViewport = vendor.useStore(state => {
			const node = state.nodeLookup.get(id);
			if (!node) {
				return false;
			}
			const [viewportX, viewportY, viewportZoom] = state.transform;
			const nodeWidth = node.measured.width ?? node.width ?? data.card.width;
			const nodeHeight = node.measured.height ?? node.height ?? data.card.height;
			const left = node.internals.positionAbsolute.x * viewportZoom + viewportX;
			const top = (node.internals.positionAbsolute.y
				- BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP
				- BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT) * viewportZoom + viewportY;
			const right = left + nodeWidth * viewportZoom;
			const bottom = top + nodeHeight * viewportZoom;
			const overscanX = host.clientWidth * CANVAS_PREVIEW_OVERSCAN_VIEWPORTS;
			const overscanY = host.clientHeight * CANVAS_PREVIEW_OVERSCAN_VIEWPORTS;
			return right >= -overscanX
				&& left <= host.clientWidth + overscanX
				&& bottom >= -overscanY
				&& top <= host.clientHeight + overscanY;
		});
		const height = vendor.useStore(state => {
			const node = state.nodeLookup.get(id);
			return node?.measured.height ?? node?.height ?? data.card.height;
		});
		const note = data.card.controls?.kind === 'note';
		const noteEditing = baseHalfCanvasSceneCardIsNoteEditing(data.card);
		const structuralSelectionVisible = baseHalfCanvasSceneProjectsSelection(selected, noteEditing);
		const resizeControlsVisible = baseHalfCanvasSceneShowsResizeControls(
			selected,
			noteEditing,
			selectionSize,
			!!host.dataset.videoInputPickActive,
			data.card.keepsShape === true
		);
		const presentation = noteEditing
			? 'preview'
			: baseHalfCanvasCardPresentation({
				forceInteractive: data.card.forceInteractive === true,
				nearViewport,
				selected: selected && !note,
				selectionSize
			});
		mountedCardRef.current = {
			card: data.card,
			height,
			retainPresentation: data.card.forceInteractive === true && note
		};
		const finishCardResize = vendor.useCallback((): void => {
			const active = activeResizeRef.current;
			if (!active) {
				return;
			}
			activeResizeRef.current = undefined;
			active.removeBoundaryListeners();
			clearCardResizeState(active.card.element, host);
			active.end();
		}, []);
		const beginCardResize = vendor.useCallback((): void => {
			if (activeResizeRef.current || host.dataset.videoInputPickActive) {
				return;
			}
			const view = data.card.element.ownerDocument.defaultView;
			let pointerBoundaryReached = false;
			const settleAtPointerBoundary = (): void => {
				pointerBoundaryReached = true;
				view?.queueMicrotask(() => finishCardResize());
			};
			const settleAtLostPointerCapture = (event: globalThis.PointerEvent): void => {
				// The resizer transfers capture to its window-level drag owner while
				// the pointer gesture is still active. Ignore only that originating
				// handle loss; a later loss from the active owner must settle exactly
				// like pointer-up, cancel, or window blur.
				const target = event.target;
				const transferringFromHandle = event.buttons !== 0
					&& (isHTMLElement(target) || isSVGElement(target))
					&& !!target.closest('.react-flow__resize-control');
				if (pointerBoundaryReached || !transferringFromHandle) {
					settleAtPointerBoundary();
				}
			};
			const settleAtWindowBlur = (event: FocusEvent): void => {
				// A capture listener on the window also sees every element's blur.
				// The press itself moves focus off a focused card, so only the
				// window losing focus may settle the gesture.
				if (event.target === view) {
					settleAtPointerBoundary();
				}
			};
			const removeBoundaryListeners = (): void => {
				view?.removeEventListener('pointerup', settleAtPointerBoundary, true);
				view?.removeEventListener('pointercancel', settleAtPointerBoundary, true);
				view?.removeEventListener('lostpointercapture', settleAtLostPointerCapture, true);
				view?.removeEventListener('blur', settleAtWindowBlur, true);
			};
			view?.addEventListener('pointerup', settleAtPointerBoundary, true);
			view?.addEventListener('pointercancel', settleAtPointerBoundary, true);
			view?.addEventListener('lostpointercapture', settleAtLostPointerCapture, true);
			view?.addEventListener('blur', settleAtWindowBlur, true);
			activeResizeRef.current = {
				card: data.card,
				end: data.endResize,
				removeBoundaryListeners
			};
			data.beginResize();
		}, [data.beginResize, data.card, data.endResize, finishCardResize]);
		const markCardResizing = vendor.useCallback((corner: BaseHalfCanvasResizeCorner | undefined): void => {
			const active = activeResizeRef.current;
			if (!active) {
				return;
			}
			// Runs on every resize frame; write only changes so selectors keyed on
			// these attributes are not invalidated per frame.
			const dataset = active.card.element.dataset;
			if (dataset.cardResizing !== 'true') {
				dataset.cardResizing = 'true';
				// Capture circles take no pointer while a card is resized.
				host.dataset.cardResizing = 'true';
			}
			if (corner && dataset.cardResizeCorner !== corner) {
				dataset.cardResizeCorner = corner;
			}
		}, []);
		const prepareCardResizeMeasurement = vendor.useCallback((event: globalThis.PointerEvent): void => {
			const target = event.target;
			if (host.dataset.videoInputPickActive
				|| (!isHTMLElement(target) && !isSVGElement(target))
				|| !target.closest('.react-flow__resize-control')) {
				return;
			}
			const nodeElement = hostRef.current?.closest('.react-flow__node');
			const internalNode = store.getState().nodeLookup.get(id);
			if (!isHTMLElement(nodeElement) || !internalNode) {
				return;
			}
			const measured = baseHalfCanvasResizeStartSize(nodeElement.getBoundingClientRect(), store.getState().transform[2], data.card);
			// XYResizer snapshots only the internal measured box at native drag
			// start. A controlled-node reconciliation can temporarily clear that
			// box while the already-painted DOM still has the correct live size.
			// Refresh it synchronously in capture phase, before d3-drag observes the
			// same pointer, so a second resize cannot start from zero/minimum size.
			internalNode.measured.width = measured.width;
			internalNode.measured.height = measured.height;
		}, [data.card, id, store]);

		vendor.useLayoutEffect(() => () => {
			const mounted = mountedCardRef.current;
			finishCardResize();
			clearCardResizeState(mounted.card.element, host);
			const active = mounted.card.element.ownerDocument.activeElement;
			if (isHTMLElement(active) && mounted.card.element.contains(active)) {
				active.blur();
			}
			if (!mounted.retainPresentation) {
				mounted.card.updatePresentation({
					level: 'shell',
					height: mounted.height
				});
			}
		}, []);

		vendor.useLayoutEffect(() => {
			const mount = hostRef.current;
			if (!mount) {
				return;
			}
			mount.replaceChildren(data.card.element);
			data.card.didMountElement?.();
			const focusPath = replacementFocusPath.current;
			replacementFocusPath.current = undefined;
			// A control that took the focus while its card was mounted keeps it:
			// the rename editor of a card that was focused itself.
			if (focusPath && !data.card.element.contains(data.card.element.ownerDocument.activeElement)) {
				const target = resolveBaseHalfCanvasCardFocusPath(data.card.element, focusPath);
				const focusTarget = isHTMLElement(target)
					&& (target === data.card.element || target.matches('button, input, textarea, select, [tabindex]'))
					? target
					: data.card.element;
				focusTarget.focus({ preventScroll: true });
			}
			return () => {
				finishCardResize();
				clearCardResizeState(data.card.element, host);
				if (data.card.element.parentElement === mount) {
					const active = data.card.element.ownerDocument.activeElement;
					replacementFocusPath.current = isHTMLElement(active)
						? captureBaseHalfCanvasCardFocusPath(data.card.element, active)
						: undefined;
					// A drawing without scrollable content, such as the badge face,
					// keeps the place for the drawing that shows the content again.
					const scrollableContent = delegate.cardScrollableContent(data.card.element);
					if (scrollableContent) {
						replacementScrollPosition.current = scrollableContent.scrollTop;
					}
					data.card.element.remove();
				}
			};
		}, [data.card.element]);

		vendor.useLayoutEffect(() => {
			const nodeElement = hostRef.current?.closest('.react-flow__node');
			if (!isHTMLElement(nodeElement)) {
				return;
			}
			nodeElement.addEventListener('pointerdown', prepareCardResizeMeasurement, true);
			return () => nodeElement.removeEventListener('pointerdown', prepareCardResizeMeasurement, true);
		}, [prepareCardResizeMeasurement]);

		vendor.useLayoutEffect(() => {
			const frame = host.ownerDocument.defaultView?.requestAnimationFrame(() => updateNodeInternals(id));
			return () => {
				if (frame !== undefined) {
					host.ownerDocument.defaultView?.cancelAnimationFrame(frame);
				}
			};
		}, [data.card.element, id, updateNodeInternals]);

		vendor.useLayoutEffect(() => {
			const element = data.card.element;
			if (presentation === 'shell') {
				const active = element.ownerDocument.activeElement;
				if (isHTMLElement(active)
					&& active.closest('.basehalf-canvas-card-badge-face')
					&& element.contains(active)) {
					active.blur();
				}
			}
			// Editing is a document interaction, not a structural Canvas
			// interaction. Keep the React Flow selection internally so clicking the
			// pane can close the editor through the normal selection transaction,
			// but do not project structural selection chrome over editable text.
			element.classList.toggle('selected', structuralSelectionVisible);
			element.dataset.previewLevel = presentation;
			element.dataset.cardHeight = String(height);
			data.card.updatePresentation({
				level: presentation,
				height
			});
			// A redrawn card shows the place its scrollable content was at. The
			// content exists only now, after the presentation drew it.
			const scrollPosition = replacementScrollPosition.current;
			const scrollableContent = scrollPosition !== undefined ? delegate.cardScrollableContent(element) : undefined;
			if (scrollableContent && scrollPosition !== undefined) {
				replacementScrollPosition.current = undefined;
				// A note built in parts builds the parts that place shows first.
				buildBaseHalfCanvasNotePartsTo(scrollableContent, scrollPosition);
				scrollableContent.scrollTop = scrollPosition;
			}
		}, [data.card, data.card.element, height, presentation, structuralSelectionVisible]);

		return h(vendor.Fragment, null,
			resizeControlsVisible
				? h(CardResizeControls, {
					onResizeStart: beginCardResize,
					onResize: markCardResizing,
					onResizeEnd: finishCardResize
				})
				: null,
			...(['north', 'east', 'south', 'west'] as const).map(anchor => h(vendor.Handle, {
				key: anchor,
				id: anchor,
				type: 'source',
				position: flowPosition(vendor, anchor),
				className: `basehalf-canvas-card-connect-handle ${anchor}${noteEditing ? ' editing' : ''}`,
				isConnectable: !noteEditing,
				tabIndex: !noteEditing && (selected || clickConnectionInProgress) ? 0 : -1,
				role: 'button',
				'aria-label': `Create or finish a context connection at the ${anchor} side of ${id}`,
				onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
					if (event.key !== 'Enter' && event.key !== ' ') {
						return;
					}
					event.preventDefault();
					event.stopPropagation();
					event.currentTarget.click();
				}
			})),
			h('div', {
				ref: hostRef,
				className: 'basehalf-canvas-card-host',
				style: { width: '100%', height: '100%' }
			})
		);
	}

	return CardNode;
}
