/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { FileAccess } from '../../../base/common/network.js';
import { isMacintosh, isWindows } from '../../../base/common/platform.js';
import { URI } from '../../../base/common/uri.js';
import { isHTMLElement, isSVGElement } from '../../../base/browser/dom.js';
import { localize } from '../../../nls.js';
import {
	BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT,
	BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH,
	BASEHALF_CANVAS_MIN_CARD_HEIGHT,
	BASEHALF_CANVAS_MIN_CARD_WIDTH,
	BaseHalfCanvasAnchor,
	baseHalfCanvasAnchorPoint,
	baseHalfCanvasEdgePath
} from '../common/basehalfCanvasModel.js';
import { baseHalfCanvasCardPresentation } from '../common/basehalfCanvasCardPresentation.js';
import { BASEHALF_CANVAS_MAX_ZOOM, BASEHALF_CANVAS_MIN_ZOOM } from '../common/basehalfConfiguration.js';
import {
	BASEHALF_CANVAS_SNAP_GUIDE_SCREEN_THRESHOLD,
	sameBaseHalfCanvasSnapGuides,
	snapBaseHalfCanvasFlowNodeChanges
} from '../common/basehalfCanvasFlowSnap.js';
import {
	baseHalfCanvasReconnectEndForPath,
	baseHalfCanvasReconnectSnapForHit,
	BaseHalfCanvasReconnectHit,
	BaseHalfCanvasEdgeReconnectEnd,
	IBaseHalfCanvasReconnectSnap,
	resolveBaseHalfCanvasReconnectPoint
} from '../common/basehalfCanvasEdgeReconnect.js';
import { IBaseHalfCanvasSnapGuide } from '../common/basehalfCanvasSnap.js';
import {
	BaseHalfCanvasArrangement,
	IBaseHalfCanvasArrangeCard,
	baseHalfCanvasArrange,
	baseHalfCanvasBoundingRect,
	baseHalfCanvasCardsInMarquee
} from '../common/basehalfCanvasArrangement.js';
import {
	IBaseHalfCanvasSceneCard,
	IBaseHalfCanvasSceneConnection,
	BaseHalfCanvasSceneSelectionAction,
	baseHalfCanvasConnectHandleReachLimit,
	baseHalfCanvasOppositeAnchor,
	baseHalfCanvasSceneConnectionRefusal,
	baseHalfCanvasSceneSelectionActions,
	baseHalfCanvasSceneVideoSelectionActions,
	BaseHalfCanvasSceneContextMenuRequest,
	BaseHalfCanvasSceneGeometryReason,
	IBaseHalfCanvasSceneDelegate,
	IBaseHalfCanvasSceneEdge,
	IBaseHalfCanvasSceneFitOptions,
	IBaseHalfCanvasSceneGeometry,
	IBaseHalfCanvasSceneRenderer,
	IBaseHalfCanvasSceneSelection,
	IBaseHalfCanvasSceneSnapshot,
	IBaseHalfCanvasSceneVideoPanelLayout,
	IBaseHalfCanvasSceneVideoPanelSurface,
	IBaseHalfCanvasSceneViewport,
	BaseHalfCanvasSceneVideoAction,
	BaseHalfCanvasSceneVideoFrame,
	BaseHalfCanvasNoteBackground,
	BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP,
	BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT,
	BASEHALF_CANVAS_CARD_CORNER_RADIUS,
	BASEHALF_CANVAS_VIDEO_PANEL_LAYOUT_EVENT,
	BASEHALF_CANVAS_VIDEO_TOOLBAR_SCREEN_GAP,
	BASEHALF_CANVAS_VIDEO_TOOLBAR_SCREEN_HEIGHT,
	BASEHALF_CANVAS_NOTE_DEFAULT_FORMAT_STATE,
	BASEHALF_CANVAS_NOTE_FORMAT_STATE_EVENT,
	BASEHALF_CANVAS_NOTE_TOOLBAR_FOCUS_EVENT,
	IBaseHalfCanvasNoteFormatState,
	baseHalfCanvasSceneSelectionSurface,
	resolveBaseHalfCanvasSceneConnectionDrop
} from '../common/basehalfCanvasScene.js';
import {
	BaseHalfVideoPanelSide,
	IBaseHalfVideoPanelLayout,
	resolveBaseHalfVideoPanelPlacement
} from '../common/basehalfVideoNodePanelPlacement.js';
import type { BaseHalfMarkdownFormatCommand, BaseHalfMarkdownFormatToggleState } from '../common/basehalfMarkdownFormatting.js';
import { buildBaseHalfCanvasNotePartsTo } from './basehalfCanvasNoteParts.js';
import { installBaseHalfCanvasWheelGestures } from './basehalfCanvasWheelGestures.js';
import { installBaseHalfSidewaysScrollbar } from './basehalfSidewaysScrollbar.js';
import type {
	Connection,
	Edge,
	EdgeChange,
	EdgeProps,
	Node,
	NodeChange,
	NodeProps,
	NodeTypes,
	EdgeTypes,
	FinalConnectionState,
	ReactFlowInstance,
	ReactFlowProps,
	Viewport
} from '@xyflow/react';
import type { ComponentType, CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactElement, ReactNode, RefObject } from 'react';
import type { Root } from 'react-dom/client';

interface IBaseHalfCanvasToolbarIconProps {
	readonly size?: number | string;
	readonly className?: string;
	readonly 'aria-hidden'?: boolean;
	readonly focusable?: boolean;
	readonly 'data-basehalf-icon'?: string;
}

type BaseHalfCanvasToolbarIcon = ComponentType<IBaseHalfCanvasToolbarIconProps>;

interface IBaseHalfCanvasToolbarIcons {
	readonly heading1: BaseHalfCanvasToolbarIcon;
	readonly heading2: BaseHalfCanvasToolbarIcon;
	readonly heading3: BaseHalfCanvasToolbarIcon;
	readonly paragraph: BaseHalfCanvasToolbarIcon;
	readonly bold: BaseHalfCanvasToolbarIcon;
	readonly italic: BaseHalfCanvasToolbarIcon;
	readonly bulletList: BaseHalfCanvasToolbarIcon;
	readonly orderedList: BaseHalfCanvasToolbarIcon;
	readonly divider: BaseHalfCanvasToolbarIcon;
	readonly copy: BaseHalfCanvasToolbarIcon;
	readonly copied: BaseHalfCanvasToolbarIcon;
	readonly expand: BaseHalfCanvasToolbarIcon;
	readonly information: BaseHalfCanvasToolbarIcon;
	readonly more: BaseHalfCanvasToolbarIcon;
}

type BaseHalfCanvasReactVendor = typeof import('react') & typeof import('react-dom/client') & typeof import('@xyflow/react') & {
	readonly BaseHalfCanvasToolbarIcons: IBaseHalfCanvasToolbarIcons;
};

interface IBaseHalfCanvasFlowNodeData extends Record<string, unknown> {
	readonly card: IBaseHalfCanvasSceneCard;
	readonly sceneKey: string;
	readonly structuralEpoch: number;
	readonly beginResize: () => void;
	readonly endResize: () => void;
}

interface IBaseHalfCanvasFlowEdgeData extends Record<string, unknown> {
	readonly edge: IBaseHalfCanvasSceneEdge;
	readonly sceneKey: string;
	readonly structuralEpoch: number;
}

export type BaseHalfCanvasConnectionGesture = 'pointer' | 'click';

export interface IBaseHalfCanvasPendingConnectionOwner {
	readonly token: number;
	readonly sceneKey: string;
	readonly structuralEpoch: number;
	readonly gesture: BaseHalfCanvasConnectionGesture;
}

export type BaseHalfCanvasPendingConnectionStart =
	| { readonly kind: 'owned'; readonly previous: IBaseHalfCanvasPendingConnectionOwner | undefined }
	| { readonly kind: 'deferred-to-click' }
	| { readonly kind: 'rejected-trailing-click' };

export type BaseHalfCanvasPendingPointerFinish =
	| { readonly kind: 'owned'; readonly owner: IBaseHalfCanvasPendingConnectionOwner }
	| { readonly kind: 'deferred-to-click' }
	| { readonly kind: 'none' };

/**
 * Owns the one connection gesture that may mutate the live scene. Clearing the
 * owner is synchronous so a trailing library callback cannot complete a
 * gesture after the user has cancelled it.
 */
export class BaseHalfCanvasPendingConnectionState {
	private sequence = 0;
	private owner: IBaseHalfCanvasPendingConnectionOwner | undefined;
	private pointerAttemptDuringClick = false;
	private rejectTrailingClickStart = false;

	begin(
		sceneKey: string,
		structuralEpoch: number,
		gesture: BaseHalfCanvasConnectionGesture,
		options?: { readonly rejectableTrailingClick?: boolean }
	): BaseHalfCanvasPendingConnectionStart {
		if (gesture === 'pointer') {
			this.rejectTrailingClickStart = false;
			if (this.owner?.gesture === 'click') {
				// The destination click emits pointer start/end before click completion.
				// Keep the original click owner and reject mutations from that transient attempt.
				this.pointerAttemptDuringClick = true;
				return Object.freeze({ kind: 'deferred-to-click' });
			}
		} else if (this.rejectTrailingClickStart) {
			this.rejectTrailingClickStart = false;
			if (options?.rejectableTrailingClick) {
				return Object.freeze({ kind: 'rejected-trailing-click' });
			}
		}

		this.pointerAttemptDuringClick = false;
		const previous = this.owner;
		this.owner = Object.freeze({ token: ++this.sequence, sceneKey, structuralEpoch, gesture });
		return Object.freeze({ kind: 'owned', previous });
	}

	peek(): IBaseHalfCanvasPendingConnectionOwner | undefined {
		return this.owner;
	}

	peekMutationOwner(): IBaseHalfCanvasPendingConnectionOwner | undefined {
		return this.pointerAttemptDuringClick ? undefined : this.owner;
	}

	finishPointer(): BaseHalfCanvasPendingPointerFinish {
		if (this.pointerAttemptDuringClick) {
			this.pointerAttemptDuringClick = false;
			return Object.freeze({ kind: 'deferred-to-click' });
		}
		if (this.owner?.gesture !== 'pointer') {
			return Object.freeze({ kind: 'none' });
		}
		const owner = this.owner;
		this.owner = undefined;
		return Object.freeze({ kind: 'owned', owner });
	}

	take(gesture: BaseHalfCanvasConnectionGesture): IBaseHalfCanvasPendingConnectionOwner | undefined {
		if (this.owner?.gesture !== gesture) {
			return undefined;
		}
		const owner = this.owner;
		this.owner = undefined;
		return owner;
	}

	cancel(rejectTrailingClickStart = false): IBaseHalfCanvasPendingConnectionOwner | undefined {
		const owner = this.owner;
		this.owner = undefined;
		this.rejectTrailingClickStart ||= rejectTrailingClickStart
			&& (owner?.gesture === 'pointer' || this.pointerAttemptDuringClick);
		this.pointerAttemptDuringClick = false;
		return owner;
	}

	reset(): IBaseHalfCanvasPendingConnectionOwner | undefined {
		const owner = this.cancel();
		this.rejectTrailingClickStart = false;
		return owner;
	}
}

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

export interface IBaseHalfCanvasNodeDragOrigin {
	readonly id: string;
	readonly x: number;
	readonly y: number;
}

interface IBaseHalfCanvasNodeDragState {
	readonly sceneKey: string;
	readonly structuralEpoch: number;
	readonly token: number;
	readonly primaryPath: string;
	readonly selectionAtStart: readonly string[];
	readonly origins: readonly IBaseHalfCanvasNodeDragOrigin[];
	cancelled: boolean;
}

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
	drag: IBaseHalfCanvasNodeDragState | undefined;
	panned: boolean;
	frame: number | undefined;
}

interface IBaseHalfCanvasConnectionStoreController {
	cancel(): void;
	clearClickStart(): void;
	/** Moves the canvas by this many screen pixels. */
	panBy(x: number, y: number): void;
}

type BaseHalfCanvasPendingEdgeMutation =
	| { readonly token: number; readonly kind: 'upsert'; readonly edge: IBaseHalfCanvasSceneEdge }
	| { readonly token: number; readonly kind: 'delete' };

type BaseHalfCanvasFlowNode = Node<IBaseHalfCanvasFlowNodeData, 'basehalf-card'>;
type BaseHalfCanvasFlowEdge = Edge<IBaseHalfCanvasFlowEdgeData, 'basehalf-reference'>;

export function baseHalfCanvasSceneNodeSize(
	card: Pick<IBaseHalfCanvasSceneCard, 'width' | 'height'>
): Pick<BaseHalfCanvasFlowNode, 'initialWidth' | 'initialHeight' | 'measured' | 'style'> {
	return {
		initialWidth: card.width,
		initialHeight: card.height,
		// XYResizer snapshots `measured` at pointer-down and falls back to zero
		// when it is absent. A controlled snapshot can arrive just before the
		// ResizeObserver does, so seed the known persisted rectangle as the first
		// measured value instead of exposing a transient minimum-size resize.
		measured: { width: card.width, height: card.height },
		style: { width: card.width, height: card.height }
	};
}

export function baseHalfCanvasSceneGeometryForCommit(
	geometry: IBaseHalfCanvasSceneGeometry,
	fallback: Pick<IBaseHalfCanvasSceneCard, 'x' | 'y' | 'width' | 'height'>
): IBaseHalfCanvasSceneGeometry {
	const finiteOr = (value: number, fallbackValue: number, finalFallback: number): number =>
		Number.isFinite(value) ? value : Number.isFinite(fallbackValue) ? fallbackValue : finalFallback;
	// The layout keeps four decimal places. A geometry is committed as it is
	// stored, so that undo finds the row that the commit wrote.
	const stored = (value: number): number => Number(value.toFixed(4));
	return {
		...geometry,
		x: stored(finiteOr(geometry.x, fallback.x, 0)),
		y: stored(finiteOr(geometry.y, fallback.y, 0)),
		width: stored(Math.max(BASEHALF_CANVAS_MIN_CARD_WIDTH, finiteOr(geometry.width, fallback.width, BASEHALF_CANVAS_MIN_CARD_WIDTH))),
		height: stored(Math.max(BASEHALF_CANVAS_MIN_CARD_HEIGHT, finiteOr(geometry.height, fallback.height, BASEHALF_CANVAS_MIN_CARD_HEIGHT)))
	};
}

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

export function captureBaseHalfCanvasNodeDragOrigins(
	nodes: readonly { readonly id: string; readonly position: { readonly x: number; readonly y: number } }[],
	ids: ReadonlySet<string>
): readonly IBaseHalfCanvasNodeDragOrigin[] {
	return Object.freeze(nodes
		.filter(node => ids.has(node.id))
		.map(node => Object.freeze({ id: node.id, x: node.position.x, y: node.position.y })));
}

export function restoreBaseHalfCanvasNodeDragOrigins<T extends { readonly id: string; readonly position: { readonly x: number; readonly y: number }; readonly dragging?: boolean }>(
	nodes: readonly T[],
	origins: readonly IBaseHalfCanvasNodeDragOrigin[]
): T[] {
	const byId = new Map(origins.map(origin => [origin.id, origin]));
	return nodes.map(node => {
		const origin = byId.get(node.id);
		if (!origin || (node.position.x === origin.x && node.position.y === origin.y && !node.dragging)) {
			return node;
		}
		// The drag is over for this card. The changes that would say so are
		// dropped once a drag is cancelled, and a card that still counted as
		// dragged would get no capture circles.
		return { ...node, position: { x: origin.x, y: origin.y }, ...(node.dragging ? { dragging: false } : {}) };
	});
}

export function filterBaseHalfCanvasCancelledNodeDragChanges<T extends { readonly type: string; readonly id?: string }>(
	changes: readonly T[],
	origins: readonly IBaseHalfCanvasNodeDragOrigin[]
): T[] {
	const cancelledIds = new Set(origins.map(origin => origin.id));
	return changes.filter(change => {
		if (change.type !== 'position' && change.type !== 'dimensions') {
			return true;
		}
		return change.id === undefined || !cancelledIds.has(change.id);
	});
}

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

interface IBaseHalfCanvasEdgeInteraction {
	begin(flowEdge: BaseHalfCanvasFlowEdge): boolean;
	end(): void;
	select(flowEdge: BaseHalfCanvasFlowEdge, preserveFocus?: boolean): void;
	reconnect(flowEdge: BaseHalfCanvasFlowEdge, connection: Connection): void;
	remove(flowEdge: BaseHalfCanvasFlowEdge): void;
}

interface IBaseHalfCanvasSceneRuntime {
	update(snapshot: IBaseHalfCanvasSceneSnapshot): void;
	setVideoPanelSurface(surface: IBaseHalfCanvasSceneVideoPanelSurface): void;
	clearVideoPanelSurface(element: HTMLElement): void;
	setSnapEnabled(enabled: boolean): void;
	setZoom(zoom: number): Promise<void>;
	zoomBy(factor: number): Promise<void>;
	setViewportCenter(x: number, y: number, zoom?: number): Promise<void>;
	fit(paths?: readonly string[], options?: IBaseHalfCanvasSceneFitOptions): Promise<void>;
	reveal(path: string): Promise<void>;
	screenToCanvasPosition(x: number, y: number): { readonly x: number; readonly y: number };
	select(selection: IBaseHalfCanvasSceneSelection): void;
	getViewport(): IBaseHalfCanvasSceneViewport;
	isInteracting(): boolean;
}

const CANVAS_REACT_VENDOR_ROOT = 'vs/../../extensions/basehalf/canvas-react-vendor-out';
const CANVAS_REACT_VENDOR_SCRIPT = 'canvasReactVendor.js';
const CANVAS_REACT_VENDOR_STYLES = 'canvasReactVendor.css';
const CANVAS_NODE_CULL_THRESHOLD = 100;
const CANVAS_PREVIEW_OVERSCAN_VIEWPORTS = 0.75;
const EDGE_RECONNECT_DRAG_THRESHOLD = 4;
const EDGE_RECONNECT_PATH_SAMPLES = 80;
const EDGE_RECONNECT_CURSOR_CLASS = 'basehalf-canvas-edge-reconnecting';
const SELECTION_TOOLBAR_SCREEN_GAP = 10;
const SELECTION_TOOLBAR_SCREEN_HEIGHT = 36;
const SELECTION_TOOLBAR_SCREEN_MARGIN = 8;
const NOTE_CONTROLS_SCREEN_MARGIN = 8;
const NOTE_CONTROLS_SCREEN_GAP = 10;
const NOTE_TOOLBAR_SCREEN_WIDTH = 392;
const NOTE_TOOLBAR_SCREEN_HEIGHT = 36;
const NOTE_BACKGROUND_PALETTE_SCREEN_HEIGHT = 72;
const VIDEO_UPLOAD_TOOLBAR_SCREEN_WIDTH = 112;
/** The padding of the video toolbar and the gap between its buttons, in screen pixels. */
const VIDEO_TOOLBAR_SCREEN_PADDING = 3;
const VIDEO_TOOLBAR_SCREEN_BUTTON_GAP = 2;
/** Capture Frame carries a chevron for its menu beside its icon. */
const VIDEO_TOOLBAR_CAPTURE_BUTTON_WIDTH = 42;
const VIDEO_TOOLBAR_BUTTON_WIDTH = 28;
const VIDEO_CAPTURE_FRAMES: readonly BaseHalfCanvasSceneVideoFrame[] = Object.freeze(['first', 'current', 'last']);
/** The menu of frames: three items of 26 pixels, its padding, and its border. */
const VIDEO_CAPTURE_MENU_SCREEN_HEIGHT = 88;
const VIDEO_CAPTURE_MENU_SCREEN_GAP = 6;
const CANVAS_GRAPH_CONTROL_SELECTOR = 'button, input, textarea, select, a, audio, video, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="slider"], [role="spinbutton"], .nodrag, .nopan, .basehalf-canvas-card-connect-handle';
/** A press that moves no further than this, in screen pixels, is a click. */
const CANVAS_PRESS_CLICK_DISTANCE = 4;
/** The canvas moves while the pointer of a marquee or of a moved set is this near to the scene's edge, in screen pixels. */
const CANVAS_AUTO_PAN_EDGE = 40;
/** The furthest the canvas moves in one frame, in screen pixels. */
const CANVAS_AUTO_PAN_SPEED = 15;
/** With Shift held, a press on one of these still belongs to it and begins no marquee. */
const CANVAS_SHIFT_MARQUEE_BLOCKED_SELECTOR = 'button, input, textarea, select, a, audio, video, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="slider"], [role="spinbutton"], .nodrag, .basehalf-canvas-adjacent-chrome, .basehalf-canvas-card-connect-handle, .basehalf-canvas-card[data-note-editing="true"]';

interface IBaseHalfCanvasScreenSpaceStyle extends CSSProperties {
	readonly '--basehalf-canvas-zoom': string;
	readonly '--basehalf-adjacent-chrome-travel': string;
}

/** How long a kept connection line waits for the chosen node's edge. */
const CONNECTION_DROP_LINE_EDGE_TIMEOUT_MS = 2000;

interface IBaseHalfCanvasDropLine {
	readonly token: number;
	readonly sceneKey: string;
	readonly source: string;
	readonly path: string;
	/** Edges from the source when the line was released; a new one replaces the line. */
	readonly knownEdgeIds: ReadonlySet<string>;
	readonly awaitingEdge: boolean;
}

interface IBaseHalfCanvasConnectCaptureStyle extends CSSProperties {
	readonly '--bh-connect-reach-limit': string;
}

function screenSpaceCanvasStyle(zoom: number, style: CSSProperties): IBaseHalfCanvasScreenSpaceStyle {
	const safeZoom = Math.max(BASEHALF_CANVAS_MIN_ZOOM, zoom);
	return {
		...style,
		'--basehalf-canvas-zoom': String(safeZoom),
		'--basehalf-adjacent-chrome-travel': `${6 / safeZoom}px`
	};
}

export interface IBaseHalfCanvasSelectionToolbarPlacement {
	readonly left: number;
	readonly top: number;
	readonly side: 'above' | 'below';
}

export function resolveBaseHalfCanvasSelectionToolbarPlacement(options: {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
	readonly viewport: IBaseHalfCanvasSceneViewport;
	readonly viewportWidth: number;
	readonly viewportHeight: number;
	readonly toolbarWidth: number;
}): IBaseHalfCanvasSelectionToolbarPlacement {
	const zoom = Math.max(0.2, options.viewport.zoom);
	const centerScreen = ((options.left + options.right) / 2) * zoom + options.viewport.x;
	const halfToolbar = options.toolbarWidth / 2;
	const minimumCenter = SELECTION_TOOLBAR_SCREEN_MARGIN + halfToolbar;
	const maximumCenter = Math.max(minimumCenter, options.viewportWidth - SELECTION_TOOLBAR_SCREEN_MARGIN - halfToolbar);
	const clampedCenter = Math.min(maximumCenter, Math.max(minimumCenter, centerScreen));
	const topScreen = (options.top - BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP - BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT) * zoom + options.viewport.y;
	const bottomScreen = options.bottom * zoom + options.viewport.y;
	const required = SELECTION_TOOLBAR_SCREEN_HEIGHT + SELECTION_TOOLBAR_SCREEN_GAP + SELECTION_TOOLBAR_SCREEN_MARGIN;
	const aboveSpace = topScreen;
	const belowSpace = options.viewportHeight - bottomScreen;
	const side = aboveSpace >= required || aboveSpace >= belowSpace ? 'above' : 'below';
	const unclampedAnchor = side === 'above' ? topScreen : bottomScreen;
	const anchorScreen = side === 'above'
		? Math.max(SELECTION_TOOLBAR_SCREEN_HEIGHT + SELECTION_TOOLBAR_SCREEN_GAP, unclampedAnchor)
		: Math.min(options.viewportHeight - SELECTION_TOOLBAR_SCREEN_HEIGHT - SELECTION_TOOLBAR_SCREEN_GAP, unclampedAnchor);
	return {
		left: (clampedCenter - options.viewport.x) / zoom,
		top: (anchorScreen - options.viewport.y) / zoom,
		side
	};
}

export interface IBaseHalfCanvasNoteSelectionPlacement {
	readonly visible: boolean;
	readonly side: 'above' | 'below';
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

interface IBaseHalfCanvasAnchoredToolbarPlacementOptions {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
	readonly viewport: IBaseHalfCanvasSceneViewport;
	readonly viewportWidth: number;
	readonly viewportHeight: number;
}

function resolveBaseHalfCanvasAnchoredToolbarPlacement(
	options: IBaseHalfCanvasAnchoredToolbarPlacementOptions,
	requestedWidth: number,
	toolbarHeight: number
): IBaseHalfCanvasNoteSelectionPlacement {
	const zoom = Math.max(BASEHALF_CANVAS_MIN_ZOOM, options.viewport.zoom);
	const viewportWidth = Math.max(0, options.viewportWidth);
	const viewportHeight = Math.max(0, options.viewportHeight);
	const leftScreen = options.left * zoom + options.viewport.x;
	const topScreen = (options.top - BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP - BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT) * zoom + options.viewport.y;
	const rightScreen = options.right * zoom + options.viewport.x;
	const bottomScreen = options.bottom * zoom + options.viewport.y;
	const visible = rightScreen >= 0
		&& leftScreen <= viewportWidth
		&& bottomScreen >= 0
		&& topScreen <= viewportHeight
		&& viewportWidth > NOTE_CONTROLS_SCREEN_MARGIN * 2
		&& viewportHeight > NOTE_CONTROLS_SCREEN_MARGIN * 2;
	const toolbarWidth = Math.max(0, Math.min(requestedWidth, viewportWidth - NOTE_CONTROLS_SCREEN_MARGIN * 2));
	const halfToolbar = toolbarWidth / 2;
	const minimumCenter = NOTE_CONTROLS_SCREEN_MARGIN + halfToolbar;
	const maximumCenter = Math.max(minimumCenter, viewportWidth - NOTE_CONTROLS_SCREEN_MARGIN - halfToolbar);
	const nodeCenterScreen = (leftScreen + rightScreen) / 2;
	const centerScreen = Math.min(maximumCenter, Math.max(minimumCenter, nodeCenterScreen));
	const aboveSpace = topScreen - NOTE_CONTROLS_SCREEN_MARGIN;
	const belowSpace = viewportHeight - bottomScreen - NOTE_CONTROLS_SCREEN_MARGIN;
	const requiredSpace = NOTE_CONTROLS_SCREEN_GAP + toolbarHeight;
	const side: IBaseHalfCanvasNoteSelectionPlacement['side'] = aboveSpace >= requiredSpace || aboveSpace >= belowSpace ? 'above' : 'below';
	const unclampedTop = side === 'above'
		? topScreen - NOTE_CONTROLS_SCREEN_GAP - toolbarHeight
		: bottomScreen + NOTE_CONTROLS_SCREEN_GAP;
	const maximumTop = Math.max(NOTE_CONTROLS_SCREEN_MARGIN, viewportHeight - NOTE_CONTROLS_SCREEN_MARGIN - toolbarHeight);
	const toolbarTopScreen = Math.min(maximumTop, Math.max(NOTE_CONTROLS_SCREEN_MARGIN, unclampedTop));
	const toFlowX = (screen: number): number => (screen - options.viewport.x) / zoom;
	const toFlowY = (screen: number): number => (screen - options.viewport.y) / zoom;
	return {
		visible,
		side,
		left: toFlowX(centerScreen - toolbarWidth / 2),
		top: toFlowY(toolbarTopScreen),
		width: toolbarWidth,
		height: toolbarHeight
	};
}

export function resolveBaseHalfCanvasNoteSelectionPlacement(options: IBaseHalfCanvasAnchoredToolbarPlacementOptions): IBaseHalfCanvasNoteSelectionPlacement {
	return resolveBaseHalfCanvasAnchoredToolbarPlacement(options, NOTE_TOOLBAR_SCREEN_WIDTH, NOTE_TOOLBAR_SCREEN_HEIGHT);
}

export function resolveBaseHalfCanvasVideoSelectionPlacement(
	options: IBaseHalfCanvasAnchoredToolbarPlacementOptions & { readonly toolbarWidth: number }
): IBaseHalfCanvasNoteSelectionPlacement {
	const placement = resolveBaseHalfCanvasAnchoredToolbarPlacement(options, options.toolbarWidth, BASEHALF_CANVAS_VIDEO_TOOLBAR_SCREEN_HEIGHT);
	const zoom = Math.max(BASEHALF_CANVAS_MIN_ZOOM, options.viewport.zoom);
	const topScreen = (options.top - BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP - BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT) * zoom + options.viewport.y;
	const hasUnobstructedSpaceAbove = topScreen - NOTE_CONTROLS_SCREEN_MARGIN
		>= BASEHALF_CANVAS_VIDEO_TOOLBAR_SCREEN_GAP + BASEHALF_CANVAS_VIDEO_TOOLBAR_SCREEN_HEIGHT;
	return {
		...placement,
		visible: placement.visible && hasUnobstructedSpaceAbove,
		side: 'above'
	};
}

export function baseHalfCanvasVideoToolbarWidth(actions: readonly BaseHalfCanvasSceneVideoAction[]): number {
	const canonicalActions = baseHalfCanvasSceneVideoSelectionActions(actions);
	if (canonicalActions.length === 0) {
		return 0;
	}
	if (canonicalActions.length === 1 && canonicalActions[0] === 'importResult') {
		return VIDEO_UPLOAD_TOOLBAR_SCREEN_WIDTH;
	}
	return VIDEO_TOOLBAR_SCREEN_PADDING * 2
		+ canonicalActions.reduce((width, action) => width + (action === 'captureFrame' ? VIDEO_TOOLBAR_CAPTURE_BUTTON_WIDTH : VIDEO_TOOLBAR_BUTTON_WIDTH), 0)
		+ (canonicalActions.length - 1) * VIDEO_TOOLBAR_SCREEN_BUTTON_GAP;
}

/** The label of the toolbar's Reveal action, as the platform's file manager is called. */
export function baseHalfCanvasRevealVideoLabel(): string {
	return isMacintosh
		? localize('basehalf.canvas.video.revealInFinder', "Reveal in Finder")
		: isWindows
			? localize('basehalf.canvas.video.revealInExplorer', "Reveal in File Explorer")
			: localize('basehalf.canvas.video.openContainingFolder', "Open Containing Folder");
}

export interface IBaseHalfCanvasVideoPanelPlacement extends IBaseHalfVideoPanelLayout {
	/** The panel's top left corner in canvas coordinates, where the scene's portal puts it. */
	readonly flowLeft: number;
	readonly flowTop: number;
}

/**
 * Places the panel of a selected Video card in screen space by
 * {@link resolveBaseHalfVideoPanelPlacement} and adds its position in canvas
 * coordinates. The card's name, and the toolbar when it shows, are above the
 * card, so a panel above the card goes above them.
 */
export function resolveBaseHalfCanvasVideoPanelPlacement(
	options: IBaseHalfCanvasAnchoredToolbarPlacementOptions & {
		readonly height: number;
		readonly toolbarShown: boolean;
		readonly keepSide?: BaseHalfVideoPanelSide;
	}
): IBaseHalfCanvasVideoPanelPlacement {
	const zoom = Math.max(BASEHALF_CANVAS_MIN_ZOOM, options.viewport.zoom);
	const card = {
		left: options.left * zoom + options.viewport.x,
		top: options.top * zoom + options.viewport.y,
		right: options.right * zoom + options.viewport.x,
		bottom: options.bottom * zoom + options.viewport.y
	};
	const aboveClearance = (BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP + BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT) * zoom
		+ (options.toolbarShown ? BASEHALF_CANVAS_VIDEO_TOOLBAR_SCREEN_GAP + BASEHALF_CANVAS_VIDEO_TOOLBAR_SCREEN_HEIGHT : 0);
	const layout = resolveBaseHalfVideoPanelPlacement(card, { width: options.viewportWidth, height: options.viewportHeight }, {
		height: options.height,
		aboveClearance,
		...(options.keepSide ? { keepSide: options.keepSide } : {})
	});
	return {
		...layout,
		flowLeft: (layout.left - options.viewport.x) / zoom,
		flowTop: (layout.top - options.viewport.y) / zoom
	};
}

export function baseHalfCanvasSceneSelectionRenameLabel(renameChangesPathOnly: boolean): string {
	return renameChangesPathOnly
		? localize('basehalf.canvas.selection.renameFile', "Rename file")
		: localize('basehalf.canvas.selection.rename', "Rename");
}

export function baseHalfCanvasSceneCardIsNoteEditing(
	card: Pick<IBaseHalfCanvasSceneCard, 'controls' | 'noteEditing'>
): boolean {
	return card.controls?.kind === 'note' && card.noteEditing === true;
}

export function baseHalfCanvasSceneProjectsSelection(selected: boolean, noteEditing: boolean): boolean {
	return selected && !noteEditing;
}

export function baseHalfCanvasSceneVideoInputPickGesturePolicy(videoInputPickActive: boolean): {
	readonly nodesDraggable: boolean;
	readonly nodesResizable: boolean;
	readonly viewportNavigationAllowed: boolean;
} {
	return Object.freeze({
		nodesDraggable: !videoInputPickActive,
		nodesResizable: !videoInputPickActive,
		viewportNavigationAllowed: true
	});
}

export function baseHalfCanvasSceneShowsResizeControls(
	selected: boolean,
	noteEditing: boolean,
	selectionSize: number,
	videoInputPickActive = false
): boolean {
	return baseHalfCanvasSceneVideoInputPickGesturePolicy(videoInputPickActive).nodesResizable
		&& baseHalfCanvasSceneProjectsSelection(selected, noteEditing)
		&& selectionSize === 1;
}

export function baseHalfCanvasInteractionOwnsEscape(event: Pick<KeyboardEvent, 'key' | 'isComposing' | 'keyCode'>): boolean {
	return event.key === 'Escape' && !event.isComposing && event.keyCode !== 229;
}

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

let vendorPromise: Promise<BaseHalfCanvasReactVendor> | undefined;
const stylePromises = new WeakMap<Document, Promise<void>>();
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

const EDGE_RECONNECT_ANCHORS: readonly BaseHalfCanvasAnchor[] = ['north', 'east', 'south', 'west'];

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

function isCanvasElement(target: unknown): target is Element {
	return isHTMLElement(target) || isSVGElement(target);
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

/** Tells the panel of a Video card where the scene put it, so it can keep its menus inside the canvas. */
function dispatchBaseHalfCanvasVideoPanelLayout(element: HTMLElement, detail: IBaseHalfCanvasSceneVideoPanelLayout): void {
	const EventConstructor = element.ownerDocument.defaultView?.CustomEvent;
	if (EventConstructor) {
		element.dispatchEvent(new EventConstructor<IBaseHalfCanvasSceneVideoPanelLayout>(BASEHALF_CANVAS_VIDEO_PANEL_LAYOUT_EVENT, { detail, bubbles: false }));
	}
}

/**
 * Workbench-side host for the build-time bundled React Flow island. Commands
 * issued before the bundle has loaded are serialized behind `whenReady`; the
 * latest snapshot always wins.
 */
export class BaseHalfCanvasReactScene implements IBaseHalfCanvasSceneRenderer {
	private readonly whenReady: Promise<IBaseHalfCanvasSceneRuntime>;
	private runtime: IBaseHalfCanvasSceneRuntime | undefined;
	private snapEnabled = true;
	private latestSnapshot: IBaseHalfCanvasSceneSnapshot | undefined;
	private videoPanelSurface: IBaseHalfCanvasSceneVideoPanelSurface | undefined;
	private latestViewport: IBaseHalfCanvasSceneViewport = { x: 0, y: 0, zoom: 1 };
	private root: Root | undefined;
	private rejectReady: ((error: unknown) => void) | undefined;
	private readyError: unknown;
	private disposed = false;

	constructor(
		private readonly host: HTMLElement,
		private readonly delegate: IBaseHalfCanvasSceneDelegate
	) {
		this.host.classList.add('basehalf-canvas-react-island');
		this.host.tabIndex = -1;
		this.whenReady = this.initialize();
		// `update()` is intentionally synchronous and may be the only API called
		// while the island boots. Always observe a load/mount failure so it cannot
		// become an unhandled rejection just because no imperative command followed.
		void this.whenReady.catch(error => {
			this.readyError = error;
			if (!this.disposed) {
				this.delegate.reportError(error);
			}
		});
	}

	update(snapshot: IBaseHalfCanvasSceneSnapshot): void {
		this.latestSnapshot = snapshot;
		this.runtime?.update(snapshot);
	}

	setVideoPanelSurface(surface: IBaseHalfCanvasSceneVideoPanelSurface): void {
		if (this.disposed) {
			return;
		}
		this.videoPanelSurface = surface;
		this.runtime?.setVideoPanelSurface(surface);
	}

	clearVideoPanelSurface(element: HTMLElement): void {
		if (this.videoPanelSurface?.element !== element) {
			return;
		}
		this.videoPanelSurface = undefined;
		this.runtime?.clearVideoPanelSurface(element);
	}

	setSnapEnabled(enabled: boolean): void {
		this.snapEnabled = enabled;
		this.runtime?.setSnapEnabled(enabled);
	}

	setZoom(zoom: number): Promise<void> {
		return this.run(runtime => runtime.setZoom(zoom));
	}

	zoomBy(factor: number): Promise<void> {
		return this.run(runtime => runtime.zoomBy(factor));
	}

	setViewportCenter(x: number, y: number, zoom?: number): Promise<void> {
		return this.run(runtime => runtime.setViewportCenter(x, y, zoom));
	}

	fit(paths?: readonly string[], options?: IBaseHalfCanvasSceneFitOptions): Promise<void> {
		return this.run(runtime => runtime.fit(paths, options));
	}

	reveal(path: string): Promise<void> {
		return this.run(runtime => runtime.reveal(path));
	}

	screenToCanvasPosition(x: number, y: number): { readonly x: number; readonly y: number } {
		if (this.runtime) {
			return this.runtime.screenToCanvasPosition(x, y);
		}
		const rect = this.host.getBoundingClientRect();
		return {
			x: (x - rect.left - this.latestViewport.x) / this.latestViewport.zoom,
			y: (y - rect.top - this.latestViewport.y) / this.latestViewport.zoom
		};
	}

	select(selection: IBaseHalfCanvasSceneSelection): void {
		if (this.runtime) {
			this.runtime.select(selection);
			return;
		}
		void this.whenReady.then(runtime => runtime.select(selection)).catch(() => {
			// Constructor-level observation reports renderer initialization failure.
		});
	}

	getViewport(): IBaseHalfCanvasSceneViewport {
		return this.runtime?.getViewport() ?? this.latestViewport;
	}

	isInteracting(): boolean {
		return this.runtime?.isInteracting() ?? false;
	}

	dispose(): void {
		this.disposed = true;
		this.videoPanelSurface = undefined;
		this.rejectReady?.(new Error('BaseHalf canvas scene was disposed before its renderer became ready.'));
		this.rejectReady = undefined;
		this.root?.unmount();
		this.root = undefined;
		this.runtime = undefined;
		this.host.classList.remove('basehalf-canvas-react-island');
	}

	private async initialize(): Promise<IBaseHalfCanvasSceneRuntime> {
		const [vendor] = await Promise.all([
			loadCanvasReactVendor(),
			loadCanvasReactStyles(this.host.ownerDocument)
		]);
		if (this.disposed) {
			throw new Error('BaseHalf canvas scene was disposed before its renderer loaded.');
		}

		return new Promise<IBaseHalfCanvasSceneRuntime>((resolve, reject) => {
			let settled = false;
			const resolveReady = (runtime: IBaseHalfCanvasSceneRuntime) => {
				if (settled) {
					return;
				}
				settled = true;
				this.rejectReady = undefined;
				resolve(runtime);
			};
			const rejectReady = (error: unknown) => {
				if (settled) {
					if (!this.disposed) {
						this.delegate.reportError(error);
					}
					return;
				}
				settled = true;
				this.rejectReady = undefined;
				reject(error);
			};
			this.rejectReady = rejectReady;
			try {
				const root = vendor.createRoot(this.host, {
					onUncaughtError: rejectReady
				});
				this.root = root;
				const mount = createCanvasSceneMount(vendor, this.host, this.delegate, viewport => {
					this.latestViewport = viewport;
				});
				root.render(vendor.createElement(mount.Component, {
					initialSnapshot: this.latestSnapshot ?? emptySceneSnapshot(),
					onReady: runtime => {
						if (this.disposed) {
							rejectReady(new Error('BaseHalf canvas scene was disposed while its renderer mounted.'));
							return;
						}
						this.runtime = runtime;
						runtime.setSnapEnabled(this.snapEnabled);
						if (this.latestSnapshot) {
							runtime.update(this.latestSnapshot);
						}
						if (this.videoPanelSurface) {
							runtime.setVideoPanelSurface(this.videoPanelSurface);
						}
						resolveReady(runtime);
					}
				}));
			} catch (error) {
				rejectReady(error);
			}
		});
	}

	private async run(operation: (runtime: IBaseHalfCanvasSceneRuntime) => Promise<void>): Promise<void> {
		if (this.disposed) {
			return;
		}
		try {
			await operation(await this.whenReady);
		} catch (error) {
			if (!this.disposed && error !== this.readyError) {
				this.delegate.reportError(error);
			}
			throw error;
		}
	}
}

function emptySceneSnapshot(): IBaseHalfCanvasSceneSnapshot {
	return { key: 'loading', structuralEpoch: 0, revision: 0, cards: [], edges: [] };
}

async function loadCanvasReactVendor(): Promise<BaseHalfCanvasReactVendor> {
	if (!vendorPromise) {
		const root = FileAccess.asBrowserUri(CANVAS_REACT_VENDOR_ROOT);
		const moduleUrl = URI.joinPath(root, CANVAS_REACT_VENDOR_SCRIPT).toString(true);
		vendorPromise = import(moduleUrl).then(
			module => module as unknown as BaseHalfCanvasReactVendor,
			error => {
				vendorPromise = undefined;
				throw error;
			}
		);
	}
	return vendorPromise;
}

function loadCanvasReactStyles(document: Document): Promise<void> {
	const current = stylePromises.get(document);
	if (current) {
		return current;
	}
	const loading = new Promise<void>((resolve, reject) => {
		const existing = document.querySelector<HTMLLinkElement>('link[data-basehalf-canvas-react-vendor]');
		if (existing?.dataset.loaded === 'true' || existing?.sheet) {
			resolve();
			return;
		}
		const link = existing ?? document.createElement('link');
		link.rel = 'stylesheet';
		link.dataset.basehalfCanvasReactVendor = 'true';
		const onLoad = () => {
			link.dataset.loaded = 'true';
			resolve();
		};
		const onError = () => {
			link.remove();
			reject(new Error(`Unable to load BaseHalf canvas styles from ${link.href}`));
		};
		link.addEventListener('load', onLoad, { once: true });
		link.addEventListener('error', onError, { once: true });
		if (!existing) {
			const root = FileAccess.asBrowserUri(CANVAS_REACT_VENDOR_ROOT);
			link.href = URI.joinPath(root, CANVAS_REACT_VENDOR_STYLES).toString(true);
			document.head.appendChild(link);
		}
	});
	stylePromises.set(document, loading);
	void loading.catch(() => stylePromises.delete(document));
	return loading;
}

function createCanvasSceneMount(
	vendor: BaseHalfCanvasReactVendor,
	host: HTMLElement,
	delegate: IBaseHalfCanvasSceneDelegate,
	onViewport: (viewport: IBaseHalfCanvasSceneViewport) => void
): {
	readonly Component: (props: {
		readonly initialSnapshot: IBaseHalfCanvasSceneSnapshot;
		readonly onReady: (runtime: IBaseHalfCanvasSceneRuntime) => void;
	}) => ReactElement;
} {
	const h = vendor.createElement;
	const EdgeInteractionContext = vendor.createContext<IBaseHalfCanvasEdgeInteraction | undefined>(undefined);
	const SelectionSizeContext = vendor.createContext(0);

	interface ICardResizeControlsProps {
		readonly onResizeStart: () => void;
		readonly onResize: (corner: BaseHalfCanvasResizeCorner | undefined) => void;
		readonly onResizeEnd: () => void;
	}

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
			!!host.dataset.videoInputPickActive
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

	const nodeTypes: NodeTypes = { 'basehalf-card': CardNode };
	const edgeTypes: EdgeTypes = { 'basehalf-reference': ReferenceEdge };

	function SelectionToolbar({ nodes, invoke, arrange, suppressed }: {
		readonly nodes: readonly BaseHalfCanvasFlowNode[];
		readonly invoke: (action: BaseHalfCanvasSceneSelectionAction, paths: readonly string[]) => void;
		readonly arrange: (arrangement: BaseHalfCanvasArrangement) => void;
		readonly suppressed: boolean;
	}): ReactElement {
		const actions = baseHalfCanvasSceneSelectionActions(nodes.length);
		// A set can be arranged. One card has nothing to arrange.
		const arranges = nodes.length >= 2;
		const firstAction = arranges ? 1 : 0;
		const itemCount = actions.length + firstAction;
		const viewport = vendor.useViewport();
		const [focusIndex, setFocusIndex] = vendor.useState(0);
		const [arrangeOpen, setArrangeOpen] = vendor.useState(false);
		const arrangeRef = vendor.useRef<HTMLSpanElement>(null);
		const toolbarRef = vendor.useRef<HTMLDivElement>(null);
		// The buttons of a set carry their names, so the width depends on the
		// language. It is measured, and it keeps the toolbar inside the view.
		const [measuredWidth, setMeasuredWidth] = vendor.useState<number | undefined>(undefined);
		vendor.useLayoutEffect(() => {
			const width = toolbarRef.current?.offsetWidth;
			if (width && width !== measuredWidth) {
				setMeasuredWidth(width);
			}
		});
		const paths = nodes.map(node => node.id);
		const key = paths.join('\0');
		vendor.useEffect(() => {
			setFocusIndex(0);
			setArrangeOpen(false);
		}, [key, itemCount]);
		vendor.useEffect(() => {
			if (suppressed) {
				setArrangeOpen(false);
			}
		}, [suppressed]);
		vendor.useEffect(() => {
			if (!arrangeOpen) {
				return;
			}
			arrangeRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
			const closeOutside = (event: PointerEvent): void => {
				if (!isCanvasElement(event.target) || !arrangeRef.current?.contains(event.target)) {
					setArrangeOpen(false);
				}
			};
			host.ownerDocument.addEventListener('pointerdown', closeOutside, true);
			return () => host.ownerDocument.removeEventListener('pointerdown', closeOutside, true);
		}, [arrangeOpen]);
		const box = baseHalfCanvasBoundingRect(nodes.map(flowNodeRect));
		if (!box || actions.length === 0) {
			return h(vendor.Fragment);
		}
		const placement = resolveBaseHalfCanvasSelectionToolbarPlacement({
			left: box.x,
			top: box.y,
			right: box.x + box.width,
			bottom: box.y + box.height,
			viewport,
			viewportWidth: host.clientWidth,
			viewportHeight: host.clientHeight,
			toolbarWidth: measuredWidth ?? (arranges ? 380 : 96)
		});
		const metadata: Record<BaseHalfCanvasSceneSelectionAction, { readonly label: string; readonly icon: string }> = {
			rename: { label: baseHalfCanvasSceneSelectionRenameLabel(nodes.length === 1 && nodes[0].data.card.renameChangesPathOnly === true), icon: 'edit' },
			duplicate: { label: localize('basehalf.canvas.selection.duplicate', "Duplicate"), icon: 'files' },
			copyReferences: { label: localize('basehalf.canvas.selection.copyPaths', "Copy Paths"), icon: 'copy' },
			delete: { label: localize('basehalf.canvas.selection.delete', "Delete"), icon: 'trash' }
		};
		const arrangeLabel = localize('basehalf.canvas.selection.arrange', "Arrange");
		const arrangements: readonly { readonly id: BaseHalfCanvasArrangement; readonly label: string }[] = [
			{ id: 'grid', label: localize('basehalf.canvas.selection.arrangeGrid', "Grid") },
			{ id: 'row', label: localize('basehalf.canvas.selection.arrangeRow', "Row") },
			{ id: 'column', label: localize('basehalf.canvas.selection.arrangeColumn', "Column") }
		];
		const moveFocus = (event: ReactKeyboardEvent<HTMLElement>, index: number): void => {
			let next: number | undefined;
			if (event.key === 'ArrowRight') {
				next = (index + 1) % itemCount;
			} else if (event.key === 'ArrowLeft') {
				next = (index - 1 + itemCount) % itemCount;
			} else if (event.key === 'Home') {
				next = 0;
			} else if (event.key === 'End') {
				next = itemCount - 1;
			}
			if (next === undefined) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			setFocusIndex(next);
			const toolbar = event.currentTarget.closest<HTMLElement>('.basehalf-canvas-selection-toolbar');
			toolbar?.querySelectorAll<HTMLButtonElement>('button[data-toolbar-item]')[next]?.focus();
		};
		const focusArrangeButton = (): void => {
			arrangeRef.current?.querySelector<HTMLButtonElement>('button[data-toolbar-item]')?.focus({ preventScroll: true });
		};
		const moveInArrangeMenu = (event: ReactKeyboardEvent<HTMLElement>): void => {
			const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
			const index = items.findIndex(item => item === event.currentTarget.ownerDocument.activeElement);
			let next: number | undefined;
			if (event.key === 'ArrowDown') {
				next = (index + 1) % items.length;
			} else if (event.key === 'ArrowUp') {
				next = (index - 1 + items.length) % items.length;
			} else if (event.key === 'Home') {
				next = 0;
			} else if (event.key === 'End') {
				next = items.length - 1;
			} else if (event.key === 'Escape' || event.key === 'Tab') {
				event.preventDefault();
				event.stopPropagation();
				setArrangeOpen(false);
				focusArrangeButton();
				return;
			}
			if (next === undefined) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			items[next]?.focus({ preventScroll: true });
		};

		// What a button shows. The buttons of a set carry their names beside the
		// icon: a set has no card of its own to say what the icons mean.
		const face = (icon: string, label: string, menu = false): ReactNode[] => arranges
			? [
				h('span', { key: 'icon', className: `codicon codicon-${icon}`, 'aria-hidden': true }),
				h('span', { key: 'label', className: 'basehalf-canvas-selection-action-label' }, label),
				menu ? h('span', { key: 'menu', className: 'basehalf-canvas-selection-action-menu codicon codicon-chevron-down', 'aria-hidden': true }) : null
			]
			: [];
		const separator = (name: string): ReactNode => h('span', { key: name, className: 'basehalf-canvas-selection-separator', 'aria-hidden': true });

		return h(vendor.ViewportPortal, null,
			h('div', {
				ref: toolbarRef,
				className: `basehalf-canvas-selection-toolbar basehalf-canvas-adjacent-chrome ${placement.side}${arranges ? ' for-set' : ''} nodrag nopan nowheel`,
				role: 'toolbar',
				'data-selected-count': nodes.length,
				'aria-label': nodes.length === 1
					? localize('basehalf.canvas.selection.one', "Selected card actions")
					: localize('basehalf.canvas.selection.many', "Actions for {0} selected cards", nodes.length),
				'data-chrome-state': suppressed ? 'suppressed' : 'present',
				'data-placement': placement.side,
				'aria-hidden': suppressed,
				inert: suppressed,
				style: screenSpaceCanvasStyle(viewport.zoom, { left: placement.left, top: placement.top }),
				onPointerDown: (event: ReactPointerEvent<HTMLElement>) => event.stopPropagation(),
				onClick: (event: ReactMouseEvent<HTMLElement>) => event.stopPropagation()
			},
				arranges ? h('span', { ref: arrangeRef, className: 'basehalf-canvas-selection-arrange' },
					h('button', {
						type: 'button',
						className: 'basehalf-canvas-selection-action labeled',
						'data-toolbar-item': 'arrange',
						title: arrangeLabel,
						'aria-label': arrangeLabel,
						'aria-haspopup': 'menu',
						'aria-expanded': arrangeOpen,
						tabIndex: !suppressed && focusIndex === 0 ? 0 : -1,
						onFocus: () => setFocusIndex(0),
						onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
							if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
								event.preventDefault();
								event.stopPropagation();
								setArrangeOpen(true);
								return;
							}
							moveFocus(event, 0);
						},
						onClick: (event: ReactMouseEvent<HTMLElement>) => {
							event.preventDefault();
							event.stopPropagation();
							setArrangeOpen(open => !open);
						}
					}, ...face('layout', arrangeLabel, true)),
					arrangeOpen ? h('div', {
						className: 'basehalf-canvas-arrange-menu',
						role: 'menu',
						'aria-label': arrangeLabel,
						onKeyDown: moveInArrangeMenu
					}, ...arrangements.map(item => h('button', {
						key: item.id,
						type: 'button',
						role: 'menuitem',
						className: 'basehalf-canvas-arrange-menu-item',
						'data-arrangement': item.id,
						tabIndex: -1,
						onClick: (event: ReactMouseEvent<HTMLElement>) => {
							event.preventDefault();
							event.stopPropagation();
							setArrangeOpen(false);
							focusArrangeButton();
							arrange(item.id);
						}
					}, item.label))) : null
				) : null,
				arranges ? separator('after-arrange') : null,
				...actions.flatMap((action, actionIndex) => {
					const index = actionIndex + firstAction;
					const button = h('button', {
						key: action,
						type: 'button',
						className: arranges
							? `basehalf-canvas-selection-action labeled${action === 'delete' ? ' danger' : ''}`
							: `basehalf-canvas-selection-action codicon codicon-${metadata[action].icon}${action === 'delete' ? ' danger' : ''}`,
						'data-toolbar-item': action,
						title: metadata[action].label,
						'aria-label': metadata[action].label,
						tabIndex: !suppressed && index === focusIndex ? 0 : -1,
						onFocus: () => setFocusIndex(index),
						onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => moveFocus(event, index),
						onClick: (event: ReactMouseEvent<HTMLElement>) => {
							event.preventDefault();
							event.stopPropagation();
							invoke(action, paths);
						}
					}, ...face(metadata[action].icon, metadata[action].label));
					// Delete stands apart from the actions that keep the cards.
					return arranges && action === 'delete' ? [separator('before-delete'), button] : [button];
				})
			)
		);
	}

	/**
	 * The box of a set. It is worked out from the cards of this drawing, so it
	 * is never anywhere but around them. It takes the pointer in its whole area:
	 * the scene moves the set from a press on it, and a click changes nothing.
	 */
	function SetBox({ nodes, onToggleAt }: {
		readonly nodes: readonly BaseHalfCanvasFlowNode[];
		readonly onToggleAt: (clientX: number, clientY: number) => void;
	}): ReactElement {
		const viewport = vendor.useViewport();
		const box = baseHalfCanvasBoundingRect(nodes.map(flowNodeRectWithCaption));
		if (!box) {
			return h(vendor.Fragment);
		}
		return h(vendor.ViewportPortal, null,
			h('div', {
				className: 'basehalf-canvas-set-box',
				role: 'group',
				'aria-label': localize('basehalf.canvas.setBox', "{0} cards selected", nodes.length),
				style: { left: box.x, top: box.y, width: box.width, height: box.height, borderWidth: 1 / viewport.zoom },
				onClick: (event: ReactMouseEvent<HTMLElement>) => {
					event.stopPropagation();
					if (event.shiftKey) {
						onToggleAt(event.clientX, event.clientY);
					}
				},
				onDoubleClick: (event: ReactMouseEvent<HTMLElement>) => {
					event.preventDefault();
					event.stopPropagation();
				},
				onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
					event.preventDefault();
					event.stopPropagation();
				}
			})
		);
	}

	/** The size of the canvas's host, kept up to date. */
	function useHostSize(): { readonly width: number; readonly height: number } {
		const [size, setSize] = vendor.useState(() => ({ width: host.clientWidth, height: host.clientHeight }));
		vendor.useEffect(() => {
			const update = (width = host.clientWidth, height = host.clientHeight): void => {
				setSize(current => current.width === width && current.height === height ? current : { width, height });
			};
			update();
			const ResizeObserverConstructor = host.ownerDocument.defaultView?.ResizeObserver;
			if (!ResizeObserverConstructor) {
				return;
			}
			const observer = new ResizeObserverConstructor(entries => {
				const box = entries[0]?.contentRect;
				update(box?.width, box?.height);
			});
			observer.observe(host);
			return () => observer.disconnect();
		}, []);
		return size;
	}

	function flowNodeBounds(node: BaseHalfCanvasFlowNode): { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number } {
		const width = node.width ?? node.measured?.width ?? numericStyle(node.style?.width) ?? node.data.card.width;
		const height = node.height ?? node.measured?.height ?? numericStyle(node.style?.height) ?? node.data.card.height;
		return { left: node.position.x, top: node.position.y, right: node.position.x + width, bottom: node.position.y + height };
	}

	/**
	 * The toolbar above a selected Video card: Upload Video for an empty node;
	 * Capture Frame (with its menu of frames), Reveal, and Open for a node with
	 * a video. The workbench runs the actions.
	 */
	function VideoSelectionControls({ node, suppressed }: {
		readonly node: BaseHalfCanvasFlowNode;
		readonly suppressed: boolean;
	}): ReactElement {
		const viewport = vendor.useViewport();
		const viewportSize = useHostSize();
		const [focusIndex, setFocusIndex] = vendor.useState(0);
		const [captureOpen, setCaptureOpen] = vendor.useState(false);
		const toolbarRef = vendor.useRef<HTMLDivElement | null>(null);
		const buttonRefs = vendor.useRef<(HTMLButtonElement | null)[]>([]);
		const frameRefs = vendor.useRef<(HTMLButtonElement | null)[]>([]);
		const controls = node.data.card.controls?.kind === 'video' ? node.data.card.controls : undefined;
		const actions = baseHalfCanvasSceneVideoSelectionActions(controls?.actions ?? []);
		const actionKey = actions.join('\0');
		const captureIndex = actions.indexOf('captureFrame');
		vendor.useEffect(() => {
			setFocusIndex(0);
			setCaptureOpen(false);
		}, [actionKey, node.id]);
		vendor.useEffect(() => {
			if (suppressed) {
				setCaptureOpen(false);
			}
		}, [suppressed]);
		vendor.useEffect(() => {
			const element = node.data.card.element;
			const focusToolbar = (event: KeyboardEvent): void => {
				if (event.isComposing || event.keyCode === 229
					|| !event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || event.key !== 'F10') {
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				setFocusIndex(0);
				element.ownerDocument.defaultView?.setTimeout(() => buttonRefs.current[0]?.focus(), 0);
			};
			element.addEventListener('keydown', focusToolbar);
			return () => element.removeEventListener('keydown', focusToolbar);
		}, [node.data.card.element]);
		vendor.useEffect(() => {
			if (!captureOpen) {
				return;
			}
			frameRefs.current[0]?.focus({ preventScroll: true });
			const closeOutside = (event: PointerEvent): void => {
				if (!isCanvasElement(event.target) || !toolbarRef.current?.contains(event.target)) {
					setCaptureOpen(false);
				}
			};
			host.ownerDocument.addEventListener('pointerdown', closeOutside, true);
			return () => host.ownerDocument.removeEventListener('pointerdown', closeOutside, true);
		}, [captureOpen]);

		if (!controls || actions.length === 0) {
			return h(vendor.Fragment);
		}

		const bounds = flowNodeBounds(node);
		const importOnly = actions.length === 1 && actions[0] === 'importResult';
		const placement = resolveBaseHalfCanvasVideoSelectionPlacement({
			...bounds,
			viewport,
			viewportWidth: viewportSize.width,
			viewportHeight: viewportSize.height,
			toolbarWidth: baseHalfCanvasVideoToolbarWidth(actions)
		});
		if (!placement.visible) {
			return h(vendor.Fragment);
		}

		const labels: Readonly<Record<BaseHalfCanvasSceneVideoAction, string>> = {
			importResult: localize('basehalf.canvas.video.uploadVideo', "Upload Video"),
			captureFrame: localize('basehalf.canvas.video.captureFrame', "Capture Frame"),
			revealVideo: baseHalfCanvasRevealVideoLabel(),
			openFullPreview: localize('basehalf.canvas.video.open', "Open")
		};
		const frameLabels: Readonly<Record<BaseHalfCanvasSceneVideoFrame, string>> = {
			first: localize('basehalf.canvas.video.firstFrame', "First Frame"),
			current: localize('basehalf.canvas.video.currentFrame', "Current Frame"),
			last: localize('basehalf.canvas.video.lastFrame', "Last Frame")
		};
		const invoke = (action: BaseHalfCanvasSceneVideoAction, anchor: HTMLElement, frame?: BaseHalfCanvasSceneVideoFrame): void => {
			void delegate.invokeVideoAction(
				node.data.sceneKey,
				node.data.structuralEpoch,
				node.id,
				action,
				anchor,
				frame
			).catch(error => delegate.reportError(error));
		};
		const focusButton = (index: number): void => {
			setFocusIndex(index);
			buttonRefs.current[index]?.focus({ preventScroll: true });
		};
		const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>, index: number): void => {
			if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				node.data.card.element.focus({ preventScroll: true });
				return;
			}
			if (index === captureIndex && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
				event.preventDefault();
				event.stopPropagation();
				setCaptureOpen(true);
				return;
			}
			let next: number | undefined;
			if (event.key === 'ArrowRight') {
				next = (index + 1) % actions.length;
			} else if (event.key === 'ArrowLeft') {
				next = (index - 1 + actions.length) % actions.length;
			} else if (event.key === 'Home') {
				next = 0;
			} else if (event.key === 'End') {
				next = actions.length - 1;
			}
			if (next === undefined) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			focusButton(next);
		};
		const onFrameKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
			const items = frameRefs.current.filter((item): item is HTMLButtonElement => !!item);
			const index = items.findIndex(item => item === host.ownerDocument.activeElement);
			let next: number | undefined;
			if (event.key === 'ArrowDown') {
				next = (index + 1) % items.length;
			} else if (event.key === 'ArrowUp') {
				next = (index - 1 + items.length) % items.length;
			} else if (event.key === 'Home') {
				next = 0;
			} else if (event.key === 'End') {
				next = items.length - 1;
			} else if (event.key === 'Escape' || event.key === 'Tab') {
				event.preventDefault();
				event.stopPropagation();
				setCaptureOpen(false);
				focusButton(captureIndex);
				return;
			}
			if (next === undefined) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			items[next]?.focus({ preventScroll: true });
		};
		const zoom = Math.max(BASEHALF_CANVAS_MIN_ZOOM, viewport.zoom);
		// The menu of frames opens upward, over the canvas above the toolbar,
		// when it fits there; otherwise it opens over the card.
		const menuOpensAbove = placement.top * zoom + viewport.y - VIDEO_CAPTURE_MENU_SCREEN_GAP - VIDEO_CAPTURE_MENU_SCREEN_HEIGHT >= NOTE_CONTROLS_SCREEN_MARGIN;
		const codicon = (name: string, extra = ''): ReactElement => h('span', { className: `codicon codicon-${name}${extra}`, 'aria-hidden': true });
		const face = (action: BaseHalfCanvasSceneVideoAction): ReactNode => {
			switch (action) {
				case 'importResult':
					return h(vendor.Fragment, null, codicon('cloud-upload'), h('span', { className: 'basehalf-video-upload-label' }, labels.importResult));
				case 'captureFrame':
					return h(vendor.Fragment, null, codicon('device-camera'), codicon('chevron-down', ' basehalf-video-capture-chevron'));
				case 'revealVideo':
					return codicon('folder-opened');
				case 'openFullPreview':
					return h(vendor.BaseHalfCanvasToolbarIcons.expand, {
						size: 18,
						className: 'basehalf-canvas-note-toolbar-icon',
						'data-basehalf-icon': 'expand',
						'aria-hidden': true,
						focusable: false
					});
			}
		};
		const buttons = actions.map((action, index) => h('button', {
			key: action,
			ref: (element: HTMLButtonElement | null) => { buttonRefs.current[index] = element; },
			type: 'button',
			className: `basehalf-video-result-toolbar-action basehalf-canvas-note-toolbar-action${action === 'importResult' ? ' basehalf-video-upload-action' : ' icon'}${action === 'captureFrame' ? ' basehalf-video-capture-action' : ''}`,
			title: labels[action],
			'aria-label': labels[action],
			...(action === 'captureFrame' ? { 'aria-haspopup': 'menu', 'aria-expanded': captureOpen } : {}),
			'data-video-action': action,
			tabIndex: !suppressed && index === focusIndex ? 0 : -1,
			onFocus: () => setFocusIndex(index),
			onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => onKeyDown(event, index),
			onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
				event.preventDefault();
				event.stopPropagation();
			},
			onClick: (event: ReactMouseEvent<HTMLButtonElement>) => {
				event.preventDefault();
				event.stopPropagation();
				if (action === 'captureFrame') {
					setCaptureOpen(open => !open);
					return;
				}
				invoke(action, event.currentTarget);
			}
		}, face(action)));
		const frameMenu = captureOpen && captureIndex >= 0
			? h('div', {
				key: 'frames',
				className: `basehalf-video-capture-menu ${menuOpensAbove ? 'above' : 'below'}`,
				role: 'menu',
				'aria-label': labels.captureFrame,
				onKeyDown: onFrameKeyDown
			}, ...VIDEO_CAPTURE_FRAMES.map((frame, index) => h('button', {
				key: frame,
				ref: (element: HTMLButtonElement | null) => { frameRefs.current[index] = element; },
				type: 'button',
				role: 'menuitem',
				className: 'basehalf-video-capture-menu-item',
				'data-video-frame': frame,
				tabIndex: -1,
				onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
					event.preventDefault();
					event.stopPropagation();
				},
				onClick: (event: ReactMouseEvent<HTMLElement>) => {
					event.preventDefault();
					event.stopPropagation();
					setCaptureOpen(false);
					const anchor = buttonRefs.current[captureIndex];
					focusButton(captureIndex);
					if (anchor) {
						invoke('captureFrame', anchor, frame);
					}
				}
			}, frameLabels[frame])))
			: null;
		const stopEvent = (event: ReactMouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>): void => {
			event.stopPropagation();
		};
		return h(vendor.ViewportPortal, null,
			h('div', {
				ref: toolbarRef,
				className: `basehalf-video-context-toolbar ${importOnly ? 'basehalf-video-draft-toolbar' : 'basehalf-video-result-toolbar'}${frameMenu ? ' menu-open' : ''} basehalf-canvas-note-toolbar basehalf-canvas-note-surface basehalf-canvas-adjacent-chrome nodrag nopan nowheel`,
				role: 'toolbar',
				'aria-label': localize('basehalf.canvas.video.actions', "Video actions for {0}", node.id),
				'data-node-path': node.id,
				'data-video-surface': importOnly ? 'empty' : 'video',
				'data-placement': placement.side,
				'data-chrome-state': suppressed ? 'suppressed' : 'present',
				'aria-hidden': suppressed,
				inert: suppressed,
				style: screenSpaceCanvasStyle(viewport.zoom, {
					left: placement.left,
					top: placement.top,
					width: placement.width,
					height: placement.height
				}),
				onPointerDown: stopEvent,
				onClick: stopEvent,
				onDoubleClick: stopEvent
			}, ...buttons, frameMenu)
		);
	}

	/**
	 * Places the panel that the workbench built for the selected Video card:
	 * at a constant screen size, below the card, above it, or clamped inside
	 * the canvas, and hidden while the card is off the canvas. It follows the
	 * card while the card moves or is resized, and it never moves the canvas.
	 */
	function VideoPanelAdjacentSurface({ node, surface, following }: {
		readonly node: BaseHalfCanvasFlowNode;
		readonly surface: IBaseHalfCanvasSceneVideoPanelSurface;
		readonly following: boolean;
	}): ReactElement {
		const viewport = vendor.useViewport();
		const viewportSize = useHostSize();
		const mountRef = vendor.useRef<HTMLDivElement>(null);
		const keptSide = vendor.useRef<BaseHalfVideoPanelSide | undefined>(undefined);
		const lastSide = vendor.useRef<BaseHalfVideoPanelSide | undefined>(undefined);
		const bounds = flowNodeBounds(node);
		const toolbarActions = baseHalfCanvasSceneVideoSelectionActions(node.data.card.controls?.kind === 'video' ? node.data.card.controls.actions : []);
		const toolbarShown = toolbarActions.length > 0 && resolveBaseHalfCanvasVideoSelectionPlacement({
			...bounds,
			viewport,
			viewportWidth: viewportSize.width,
			viewportHeight: viewportSize.height,
			toolbarWidth: baseHalfCanvasVideoToolbarWidth(toolbarActions)
		}).visible;
		if (!following) {
			keptSide.current = undefined;
		} else if (!keptSide.current) {
			keptSide.current = lastSide.current;
		}
		const placement = resolveBaseHalfCanvasVideoPanelPlacement({
			...bounds,
			viewport,
			viewportWidth: viewportSize.width,
			viewportHeight: viewportSize.height,
			height: surface.screenHeight,
			toolbarShown,
			...(keptSide.current ? { keepSide: keptSide.current } : {})
		});
		lastSide.current = placement.side;
		vendor.useLayoutEffect(() => {
			const mount = mountRef.current;
			const element = surface.element;
			if (!mount) {
				return;
			}
			mount.replaceChildren(element);
			return () => {
				dispatchBaseHalfCanvasVideoPanelLayout(element, {
					placement: 'below',
					visible: false,
					following: false,
					left: 0,
					top: 0,
					width: 0,
					height: 0,
					canvasWidth: host.clientWidth,
					canvasHeight: host.clientHeight
				});
				if (element.parentElement === mount) {
					element.remove();
				}
			};
		}, [surface.element]);
		vendor.useLayoutEffect(() => {
			dispatchBaseHalfCanvasVideoPanelLayout(surface.element, {
				placement: placement.placement,
				visible: placement.visible,
				following,
				left: placement.left,
				top: placement.top,
				width: placement.width,
				height: placement.height,
				canvasWidth: viewportSize.width,
				canvasHeight: viewportSize.height
			});
		}, [
			surface.element,
			following,
			placement.placement,
			placement.visible,
			placement.left,
			placement.top,
			placement.width,
			placement.height,
			viewportSize.width,
			viewportSize.height
		]);

		const stopEvent = (event: ReactMouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>): void => {
			event.stopPropagation();
		};
		return h(vendor.ViewportPortal, null,
			h('div', {
				ref: mountRef,
				className: 'basehalf-canvas-video-panel-surface basehalf-canvas-adjacent-chrome nodrag nopan nowheel',
				'data-basehalf-card-path': surface.path,
				'data-placement': placement.side,
				'data-panel-placement': placement.placement,
				'data-visible': String(placement.visible),
				'data-chrome-state': following ? 'following' : placement.visible ? 'present' : 'suspended',
				'aria-hidden': !placement.visible,
				inert: !placement.visible,
				style: screenSpaceCanvasStyle(viewport.zoom, {
					left: placement.flowLeft,
					top: placement.flowTop,
					width: placement.width,
					height: placement.height,
					visibility: placement.visible ? 'visible' : 'hidden',
					pointerEvents: placement.visible && !following ? 'auto' : 'none'
				}),
				onPointerDown: stopEvent,
				onClick: stopEvent,
				onDoubleClick: stopEvent
			})
		);
	}

	function NoteSelectionControls({ node, suppressed }: {
		readonly node: BaseHalfCanvasFlowNode;
		readonly suppressed: boolean;
	}): ReactElement {
		const viewport = vendor.useViewport();
		const [viewportSize, setViewportSize] = vendor.useState(() => ({ width: host.clientWidth, height: host.clientHeight }));
		const initialControls = node.data.card.controls?.kind === 'note' ? node.data.card.controls : undefined;
		const [formatState, setFormatState] = vendor.useState<IBaseHalfCanvasNoteFormatState>(() => initialControls?.formatState ?? BASEHALF_CANVAS_NOTE_DEFAULT_FORMAT_STATE);
		const [background, setBackground] = vendor.useState<BaseHalfCanvasNoteBackground>(() => initialControls?.background ?? 'default');
		const [backgroundOpen, setBackgroundOpen] = vendor.useState(false);
		const [copied, setCopied] = vendor.useState(false);
		const [focusIndex, setFocusIndex] = vendor.useState(0);
		const buttonRef = vendor.useRef<HTMLButtonElement | null>(null);
		const copiedTimer = vendor.useRef<number | undefined>(undefined);
		vendor.useEffect(() => {
			const controls = node.data.card.controls?.kind === 'note' ? node.data.card.controls : undefined;
			setFormatState(controls?.formatState ?? BASEHALF_CANVAS_NOTE_DEFAULT_FORMAT_STATE);
			setBackground(controls?.background ?? 'default');
		}, [node.data.card.controls]);
		vendor.useEffect(() => {
			const updateSize = (width = host.clientWidth, height = host.clientHeight): void => {
				setViewportSize(current => current.width === width && current.height === height ? current : { width, height });
			};
			updateSize();
			const ResizeObserverConstructor = host.ownerDocument.defaultView?.ResizeObserver;
			if (!ResizeObserverConstructor) {
				return;
			}
			const observer = new ResizeObserverConstructor(entries => {
				const size = entries[0]?.contentRect;
				updateSize(size?.width, size?.height);
			});
			observer.observe(host);
			return () => observer.disconnect();
		}, []);
		vendor.useEffect(() => {
			const element = node.data.card.element;
			const focusToolbar = (): void => {
				element.ownerDocument.defaultView?.setTimeout(() => buttonRef.current?.focus(), 0);
			};
			element.addEventListener(BASEHALF_CANVAS_NOTE_TOOLBAR_FOCUS_EVENT, focusToolbar);
			const updateFormatState = (event: Event): void => {
				const detail = (event as CustomEvent<IBaseHalfCanvasNoteFormatState>).detail;
				if (detail) {
					setFormatState(detail);
				}
			};
			element.addEventListener(BASEHALF_CANVAS_NOTE_FORMAT_STATE_EVENT, updateFormatState);
			return () => {
				element.removeEventListener(BASEHALF_CANVAS_NOTE_TOOLBAR_FOCUS_EVENT, focusToolbar);
				element.removeEventListener(BASEHALF_CANVAS_NOTE_FORMAT_STATE_EVENT, updateFormatState);
			};
		}, [node.data.card.element]);
		vendor.useEffect(() => () => {
			if (copiedTimer.current !== undefined) {
				host.ownerDocument.defaultView?.clearTimeout(copiedTimer.current);
			}
		}, []);
		const nodeWidth = node.width ?? node.measured?.width ?? numericStyle(node.style?.width) ?? node.data.card.width;
		const nodeHeight = node.height ?? node.measured?.height ?? numericStyle(node.style?.height) ?? node.data.card.height;
		const placement = resolveBaseHalfCanvasNoteSelectionPlacement({
			left: node.position.x,
			top: node.position.y,
			right: node.position.x + nodeWidth,
			bottom: node.position.y + nodeHeight,
			viewport,
			viewportWidth: viewportSize.width,
			viewportHeight: viewportSize.height
		});
		const stopEvent = (event: ReactMouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>): void => {
			event.stopPropagation();
		};
		const actionCount = 12;
		const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>, index: number): void => {
			if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				setBackgroundOpen(false);
				delegate.focusNoteEditor(node.data.sceneKey, node.data.structuralEpoch, node.id);
				return;
			}
			let next: number | undefined;
			if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
				next = (index + 1) % actionCount;
			} else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
				next = (index - 1 + actionCount) % actionCount;
			} else if (event.key === 'Home') {
				next = 0;
			} else if (event.key === 'End') {
				next = actionCount - 1;
			}
			if (next !== undefined) {
				event.preventDefault();
				event.stopPropagation();
				setFocusIndex(next);
				event.currentTarget.closest<HTMLElement>('.basehalf-canvas-note-toolbar')
					?.querySelectorAll<HTMLButtonElement>(':scope > button')[next]?.focus();
			}
		};
		if (!placement.visible) {
			return h(vendor.Fragment);
		}
		const invokeFormat = (command: BaseHalfMarkdownFormatCommand): void => {
			setBackgroundOpen(false);
			void delegate.formatNote(node.data.sceneKey, node.data.structuralEpoch, node.id, command).catch(error => delegate.reportError(error));
		};
		const button = (
			index: number,
			key: string,
			label: string,
			className: string,
			content: ReactNode,
			onClick: () => void,
			active?: BaseHalfMarkdownFormatToggleState
		): ReactElement => h('button', {
			...(index === 0 ? { ref: buttonRef } : {}),
			key,
			type: 'button',
			className: `basehalf-canvas-note-toolbar-action ${className}${active === true ? ' active' : active === 'mixed' ? ' mixed' : ''}`,
			title: label,
			'aria-label': label,
			...(active !== undefined ? { 'aria-pressed': active } : {}),
			tabIndex: !suppressed && index === focusIndex ? 0 : -1,
			onFocus: () => setFocusIndex(index),
			onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => onKeyDown(event, index),
			onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
				event.preventDefault();
				event.stopPropagation();
			},
			onClick: (event: ReactMouseEvent<HTMLElement>) => {
				event.preventDefault();
				event.stopPropagation();
				onClick();
			}
		}, content);
		const divider = (key: string): ReactElement => h('span', { key, className: 'basehalf-canvas-note-toolbar-divider', 'aria-hidden': 'true' });
		const icon = (name: keyof IBaseHalfCanvasToolbarIcons): ReactElement => {
			const Icon = vendor.BaseHalfCanvasToolbarIcons[name];
			return h(Icon, {
				size: 18,
				className: 'basehalf-canvas-note-toolbar-icon',
				'data-basehalf-icon': name,
				'aria-hidden': true,
				focusable: false
			});
		};
		const formatActive = (type: IBaseHalfCanvasNoteFormatState['blockType']): boolean => formatState.ready && formatState.blockType === type;
		const backgroundLabels: Readonly<Record<BaseHalfCanvasNoteBackground, string>> = {
			default: localize('basehalf.canvas.note.background.default', "Default background"),
			red: localize('basehalf.canvas.note.background.red', "Red background"),
			orange: localize('basehalf.canvas.note.background.orange', "Orange background"),
			yellow: localize('basehalf.canvas.note.background.yellow', "Yellow background"),
			green: localize('basehalf.canvas.note.background.green', "Green background"),
			cyan: localize('basehalf.canvas.note.background.cyan', "Cyan background"),
			blue: localize('basehalf.canvas.note.background.blue', "Blue background"),
			purple: localize('basehalf.canvas.note.background.purple', "Purple background")
		};
		const paletteTop = placement.side === 'above'
			? placement.top + (NOTE_TOOLBAR_SCREEN_HEIGHT + 6) / Math.max(BASEHALF_CANVAS_MIN_ZOOM, viewport.zoom)
			: placement.top - (NOTE_BACKGROUND_PALETTE_SCREEN_HEIGHT + 6) / Math.max(BASEHALF_CANVAS_MIN_ZOOM, viewport.zoom);
		const actions: ReactElement[] = [
			button(0, 'background', localize('basehalf.canvas.note.background', "Background color"), 'background', h('span', { className: `basehalf-canvas-note-background-swatch ${background}` }), () => setBackgroundOpen(open => !open), backgroundOpen),
			divider('block-divider'),
			button(1, 'h1', localize('basehalf.canvas.note.heading1', "Heading 1"), 'icon', icon('heading1'), () => invokeFormat('setHeading1'), formatActive('heading1')),
			button(2, 'h2', localize('basehalf.canvas.note.heading2', "Heading 2"), 'icon', icon('heading2'), () => invokeFormat('setHeading2'), formatActive('heading2')),
			button(3, 'h3', localize('basehalf.canvas.note.heading3', "Heading 3"), 'icon', icon('heading3'), () => invokeFormat('setHeading3'), formatActive('heading3')),
			button(4, 'paragraph', localize('basehalf.canvas.note.paragraph', "Paragraph"), 'icon', icon('paragraph'), () => invokeFormat('setParagraph'), formatActive('paragraph')),
			divider('format-divider'),
			button(5, 'bold', localize('basehalf.canvas.note.bold', "Bold"), 'icon', icon('bold'), () => invokeFormat('toggleBold'), formatState.bold),
			button(6, 'italic', localize('basehalf.canvas.note.italic', "Italic"), 'icon', icon('italic'), () => invokeFormat('toggleItalic'), formatState.italic),
			button(7, 'bullet', localize('basehalf.canvas.note.bulletList', "Bulleted list"), 'icon', icon('bulletList'), () => invokeFormat('toggleBulletList'), formatActive('bulletList')),
			button(8, 'ordered', localize('basehalf.canvas.note.orderedList', "Numbered list"), 'icon', icon('orderedList'), () => invokeFormat('toggleOrderedList'), formatActive('orderedList')),
			button(9, 'divider', localize('basehalf.canvas.note.divider', "Divider"), 'icon', icon('divider'), () => invokeFormat('insertDivider')),
			divider('content-divider'),
			button(10, 'copy', copied ? localize('basehalf.canvas.note.copied', "Copied") : localize('basehalf.canvas.note.copy', "Copy all"), 'icon', icon(copied ? 'copied' : 'copy'), () => {
				setBackgroundOpen(false);
				void delegate.copyNote(node.data.sceneKey, node.data.structuralEpoch, node.id).then(() => {
					setCopied(true);
					if (copiedTimer.current !== undefined) {
						host.ownerDocument.defaultView?.clearTimeout(copiedTimer.current);
					}
					copiedTimer.current = host.ownerDocument.defaultView?.setTimeout(() => setCopied(false), 1400);
				}, error => delegate.reportError(error));
			}),
			button(11, 'open', localize('basehalf.canvas.note.expand', "Expand {0}", node.id), 'open icon', icon('expand'), () => {
				void delegate.openCard(node.data.sceneKey, node.data.structuralEpoch, node.id).catch(error => delegate.reportError(error));
			})
		];

		return h(vendor.ViewportPortal, null,
			h('div', {
				className: 'basehalf-canvas-note-toolbar basehalf-canvas-note-surface basehalf-canvas-adjacent-chrome nodrag nopan nowheel',
				role: 'toolbar',
				'aria-label': localize('basehalf.canvas.note.actions', "Actions for {0}", node.id),
				'data-placement': placement.side,
				'data-chrome-state': suppressed ? 'suppressed' : 'present',
				'aria-hidden': suppressed,
				inert: suppressed,
				style: screenSpaceCanvasStyle(viewport.zoom, {
					left: placement.left,
					top: placement.top,
					width: placement.width,
					height: placement.height
				}),
				onPointerDown: stopEvent,
				onClick: stopEvent,
				onDoubleClick: stopEvent
			}, ...actions),
			backgroundOpen ? h('div', {
				className: 'basehalf-canvas-note-background-palette basehalf-canvas-note-surface basehalf-canvas-adjacent-chrome nodrag nopan nowheel',
				role: 'menu',
				'aria-label': localize('basehalf.canvas.note.backgroundOptions', "Card background colors"),
				'data-placement': placement.side,
				'data-chrome-state': suppressed ? 'suppressed' : 'present',
				'aria-hidden': suppressed,
				inert: suppressed,
				style: screenSpaceCanvasStyle(viewport.zoom, { left: placement.left, top: paletteTop }),
				onPointerDown: stopEvent,
				onClick: stopEvent
			}, ...(['default', 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple'] as const).map(value => h('button', {
				key: value,
				type: 'button',
				className: `basehalf-canvas-note-background-option ${value}${value === background ? ' active' : ''}`,
				title: backgroundLabels[value],
				'aria-label': backgroundLabels[value],
				'aria-checked': value === background,
				role: 'menuitemradio',
				onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
					event.preventDefault();
					event.stopPropagation();
				},
				onClick: (event: ReactMouseEvent<HTMLElement>) => {
					event.preventDefault();
					event.stopPropagation();
					void delegate.setNoteBackground(node.data.sceneKey, node.data.structuralEpoch, node.id, value).then(() => {
						setBackground(value);
						setBackgroundOpen(false);
					}, error => delegate.reportError(error));
				}
				}))) : null
		);
	}

	function SceneComponent({ initialSnapshot, onReady: ready }: {
		readonly initialSnapshot: IBaseHalfCanvasSceneSnapshot;
		readonly onReady: (runtime: IBaseHalfCanvasSceneRuntime) => void;
	}): ReactElement {
		const snapshotRef = vendor.useRef(initialSnapshot);
		const sceneKeyRef = vendor.useRef(initialSnapshot.key);
		const structuralEpochRef = vendor.useRef(initialSnapshot.structuralEpoch);
		const mutationSequence = vendor.useRef(0);
		const viewportRef = vendor.useRef<IBaseHalfCanvasSceneViewport>({ x: 0, y: 0, zoom: 1 });
		const flowRef = vendor.useRef<ReactFlowInstance<BaseHalfCanvasFlowNode, BaseHalfCanvasFlowEdge> | undefined>(undefined);
		const viewportCommandKey = vendor.useRef<string | undefined>(undefined);
		const viewportGestureSceneKey = vendor.useRef<string | undefined>(undefined);
		const viewportCommandQueue = vendor.useRef<Promise<void>>(Promise.resolve());
		const pendingGeometry = vendor.useRef(new Map<string, {
			readonly token: number;
			readonly geometry: IBaseHalfCanvasSceneGeometry;
		}>());
		const pendingEdges = vendor.useRef(new Map<string, BaseHalfCanvasPendingEdgeMutation>());
		const pendingSelectionChanges = vendor.useRef({
			nodes: new Map<string, boolean>(),
			edges: new Map<string, boolean>(),
			lastPositive: undefined as 'node' | 'edge' | undefined,
			scheduled: false
		});
		const interactionDepth = vendor.useRef(0);
		const interactionGeneration = vendor.useRef(0);
		const interactionSceneKey = vendor.useRef<string | undefined>(undefined);
		const interactionStructuralEpoch = vendor.useRef<number | undefined>(undefined);
		const pendingConnection = vendor.useRef(new BaseHalfCanvasPendingConnectionState());
		const selectionIntents = vendor.useRef(new BaseHalfCanvasSelectionIntentCoordinator());
		const pendingSelectionRequest = vendor.useRef<{ readonly key: string; readonly promise: Promise<boolean> } | undefined>(undefined);
		const lastPaneConnectionCancellationAt = vendor.useRef<number | undefined>(undefined);
		const paneDoubleClickStartedOnPane = vendor.useRef(false);
		const connectionStoreController = vendor.useRef<IBaseHalfCanvasConnectionStoreController | undefined>(undefined);
		const nodeDragState = vendor.useRef<IBaseHalfCanvasNodeDragState | undefined>(undefined);
		const nodeDragSelectionAtPointerDown = vendor.useRef<{ readonly primaryPath: string; readonly selection: readonly string[] } | undefined>(undefined);
		const nodeDragToken = vendor.useRef(0);
		const nodeDragChromeToken = vendor.useRef<number | undefined>(undefined);
		const videoPanelFollowToken = vendor.useRef(0);
		const keyboardGeometryTimer = vendor.useRef<number | undefined>(undefined);
		const keyboardGeometryInteractionActive = vendor.useRef(false);
		const keyboardGeometryPath = vendor.useRef<string | undefined>(undefined);
		const keyboardGeometryPosition = vendor.useRef<{ x: number; y: number } | undefined>(undefined);
		const interacting = vendor.useRef(false);
		const snapEnabledRef = vendor.useRef(true);
		const [guides, setGuides] = vendor.useState<readonly IBaseHalfCanvasSnapGuide[]>([]);
		// The released connection line, kept while the Create from Connection
		// menu is open and until the chosen node's edge replaces it.
		const [dropLine, setDropLine] = vendor.useState<IBaseHalfCanvasDropLine | undefined>(undefined);
		const dropLineToken = vendor.useRef(0);
		const dropLineElement = vendor.useRef<SVGSVGElement>(null);
		const [nodeDragChromePhase, setNodeDragChromePhase] = vendor.useState<{ readonly token: number; readonly phase: 'dragging' | 'settling' } | undefined>(undefined);
		const [videoPanelSurface, setVideoPanelSurfaceState] = vendor.useState<IBaseHalfCanvasSceneVideoPanelSurface | undefined>(undefined);
		// While the user moves or resizes the card of the Video panel, the panel
		// follows it on the side it was on.
		const [videoPanelFollow, setVideoPanelFollow] = vendor.useState<{
			readonly token: number;
			readonly path: string;
			readonly kind: 'node-move' | 'node-resize' | 'keyboard-geometry';
		} | undefined>(undefined);
		const [videoInputPickActive, setVideoInputPickActive] = vendor.useState(!!host.dataset.videoInputPickActive);
		vendor.useEffect(() => {
			const MutationObserver = host.ownerDocument.defaultView?.MutationObserver;
			if (!MutationObserver) {
				return;
			}
			const update = () => setVideoInputPickActive(!!host.dataset.videoInputPickActive);
			const observer = new MutationObserver(update);
			observer.observe(host, { attributes: true, attributeFilter: ['data-video-input-pick-active'] });
			update();
			return () => observer.disconnect();
		}, []);
		const suppressNodeDragChrome = vendor.useCallback((drag: IBaseHalfCanvasNodeDragState): void => {
			const activeElement = host.ownerDocument.activeElement;
			if (activeElement instanceof Element && activeElement.closest('.basehalf-canvas-adjacent-chrome')) {
				const primaryCard = nodesRef.current.find(node => node.id === drag.primaryPath)?.data.card.element;
				(primaryCard ?? host).focus({ preventScroll: true });
			}
			nodeDragChromeToken.current = drag.token;
			host.dataset.nodeDragChrome = 'dragging';
			setNodeDragChromePhase({ token: drag.token, phase: 'dragging' });
			setVideoPanelFollow({ token: drag.token, path: drag.primaryPath, kind: 'node-move' });
		}, []);
		const settleNodeDragChrome = vendor.useCallback((drag: IBaseHalfCanvasNodeDragState): void => {
			if (nodeDragChromeToken.current !== drag.token) {
				return;
			}
			host.dataset.nodeDragChrome = 'settling';
			setNodeDragChromePhase(current => current?.token === drag.token ? { token: drag.token, phase: 'settling' } : current);
		}, []);
		const revealNodeDragChrome = vendor.useCallback((drag: IBaseHalfCanvasNodeDragState): void => {
			if (nodeDragChromeToken.current !== drag.token) {
				return;
			}
			nodeDragChromeToken.current = undefined;
			delete host.dataset.nodeDragChrome;
			setNodeDragChromePhase(current => current?.token === drag.token ? undefined : current);
			setVideoPanelFollow(current => current?.token === drag.token ? undefined : current);
		}, []);
		vendor.useEffect(() => () => {
			delete host.dataset.nodeDragChrome;
			if (keyboardGeometryTimer.current !== undefined) {
				host.ownerDocument.defaultView?.clearTimeout(keyboardGeometryTimer.current);
			}
		}, []);
		vendor.useEffect(() => {
			const captureSelectionBeforeDrag = (event: PointerEvent): void => {
				if (event.button !== 0 || !(event.target instanceof Element)
					|| event.target.closest(CANVAS_GRAPH_CONTROL_SELECTOR)) {
					nodeDragSelectionAtPointerDown.current = undefined;
					return;
				}
				const card = event.target.closest<HTMLElement>('.basehalf-canvas-card[data-basehalf-card-path]');
				if (!card?.dataset.basehalfCardPath) {
					nodeDragSelectionAtPointerDown.current = undefined;
					return;
				}
				nodeDragSelectionAtPointerDown.current = {
					primaryPath: card.dataset.basehalfCardPath,
					selection: Object.freeze(nodesRef.current.filter(node => node.selected).map(node => node.id))
				};
			};
			host.addEventListener('pointerdown', captureSelectionBeforeDrag, true);
			return () => host.removeEventListener('pointerdown', captureSelectionBeforeDrag, true);
		}, []);

		const beginInteraction = vendor.useCallback(() => {
			if (interactionDepth.current === 0) {
				interactionGeneration.current++;
				interactionSceneKey.current = sceneKeyRef.current;
				interactionStructuralEpoch.current = structuralEpochRef.current;
			}
			interactionDepth.current++;
			interacting.current = true;
		}, []);
		const endInteraction = vendor.useCallback(() => {
			if (interactionDepth.current === 0) {
				return;
			}
			interactionDepth.current = Math.max(0, interactionDepth.current - 1);
			if (interactionDepth.current === 0) {
				interacting.current = false;
				interactionSceneKey.current = undefined;
				interactionStructuralEpoch.current = undefined;
				setGuides([]);
				delegate.didEndInteraction();
			}
		}, []);
		vendor.useEffect(() => () => {
			if (keyboardGeometryInteractionActive.current) {
				keyboardGeometryInteractionActive.current = false;
				keyboardGeometryPath.current = undefined;
				keyboardGeometryPosition.current = undefined;
				endInteraction();
			}
		}, [endInteraction]);
		const beginNodeResize = vendor.useCallback((path: string): void => {
			if (host.dataset.videoInputPickActive) {
				return;
			}
			beginInteraction();
			const token = ++videoPanelFollowToken.current;
			setVideoPanelFollow({ token, path, kind: 'node-resize' });
		}, [beginInteraction]);
		const endNodeResize = vendor.useCallback((path: string): void => {
			endInteraction();
			const view = host.ownerDocument.defaultView;
			// The panel keeps following until the resized card has its final size.
			const settle = () => {
				setVideoPanelFollow(current => current?.path === path && current.kind === 'node-resize' ? undefined : current);
			};
			if (!view) {
				settle();
				return;
			}
			view.requestAnimationFrame(() => view.requestAnimationFrame(settle));
		}, [endInteraction]);
		const makeNode = vendor.useCallback((card: IBaseHalfCanvasSceneCard, sceneKey: string, structuralEpoch: number, selected = false): BaseHalfCanvasFlowNode => ({
			id: card.path,
			type: 'basehalf-card',
			position: { x: card.x, y: card.y },
			...baseHalfCanvasSceneNodeSize(card),
			data: { card, sceneKey, structuralEpoch, beginResize: () => beginNodeResize(card.path), endResize: () => endNodeResize(card.path) },
			deletable: false,
			selected
		}), [beginNodeResize, endNodeResize]);

		const makeEdge = vendor.useCallback((edge: IBaseHalfCanvasSceneEdge, sceneKey: string, structuralEpoch: number, selected = false): BaseHalfCanvasFlowEdge => ({
			id: edge.id,
			type: 'basehalf-reference',
			source: edge.from,
			target: edge.to,
			sourceHandle: edge.from_anchor,
			targetHandle: edge.to_anchor,
			data: { edge, sceneKey, structuralEpoch },
			ariaLabel: localize('basehalf.canvas.reference.contextFlow', "Context flows from {0} to {1}", edge.from, edge.to),
			ariaRole: 'group',
			markerEnd: { type: vendor.MarkerType.ArrowClosed, width: 14, height: 14 },
			deletable: true,
			// The product reconnect gesture starts from either half of the line.
			// React Flow's endpoint-only reconnect controls would compete with it.
			reconnectable: false,
			selected
		}), []);

		const [nodes, setNodes] = vendor.useState<BaseHalfCanvasFlowNode[]>(() => {
			const selected = new Set(initialSnapshot.selectedCardPaths ?? []);
			return initialSnapshot.cards.map(card => makeNode(card, initialSnapshot.key, initialSnapshot.structuralEpoch, selected.has(card.path)));
		});
		const nodesRef = vendor.useRef(nodes);
		const setLiveNodes = vendor.useCallback((next: BaseHalfCanvasFlowNode[]) => {
			nodesRef.current = next;
			setNodes(next);
		}, []);

		// Every change of the selected cards ends here, however it was made, and
		// the workbench learns the result (the selection agents can see).
		const selectedCardPathsKey = vendor.useMemo(() => JSON.stringify(nodes.filter(node => node.selected).map(node => node.id)), [nodes]);
		vendor.useEffect(() => {
			delegate.didChangeSelection(sceneKeyRef.current, structuralEpochRef.current, JSON.parse(selectedCardPathsKey) as string[]);
		}, [selectedCardPathsKey]);

		const [edges, setEdges] = vendor.useState<BaseHalfCanvasFlowEdge[]>(() => initialSnapshot.edges.map(edge => makeEdge(edge, initialSnapshot.key, initialSnapshot.structuralEpoch, edge.id === initialSnapshot.selectedEdgeId)));
		const edgesRef = vendor.useRef(edges);
		const setLiveEdges = vendor.useCallback((next: BaseHalfCanvasFlowEdge[]) => {
			edgesRef.current = next;
			setEdges(next);
		}, []);
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
		const registerConnectionStore = vendor.useCallback((controller: IBaseHalfCanvasConnectionStoreController | undefined) => {
			connectionStoreController.current = controller;
		}, []);
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

		const updateSnapshot = vendor.useCallback((snapshot: IBaseHalfCanvasSceneSnapshot) => {
			const keyChanged = sceneKeyRef.current !== snapshot.key;
			const structureChanged = structuralEpochRef.current !== snapshot.structuralEpoch;
			const identityChanged = keyChanged || structureChanged;
			const selectionControlledByHost = snapshot.selectedCardPaths !== undefined || snapshot.selectedEdgeId !== undefined;
			if (!identityChanged && snapshot.revision < snapshotRef.current.revision) {
				return;
			}
			sceneKeyRef.current = snapshot.key;
			structuralEpochRef.current = snapshot.structuralEpoch;
			snapshotRef.current = snapshot;
			if (identityChanged || selectionControlledByHost) {
				selectionIntents.current.invalidate();
				pendingSelectionRequest.current = undefined;
				pendingSelectionChanges.current.nodes.clear();
				pendingSelectionChanges.current.edges.clear();
				pendingSelectionChanges.current.lastPositive = undefined;
			}
			if (identityChanged) {
				if (keyboardGeometryTimer.current !== undefined) {
					host.ownerDocument.defaultView?.clearTimeout(keyboardGeometryTimer.current);
					keyboardGeometryTimer.current = undefined;
				}
				keyboardGeometryInteractionActive.current = false;
				keyboardGeometryPath.current = undefined;
				keyboardGeometryPosition.current = undefined;
				pendingGeometry.current.clear();
				pendingEdges.current.clear();
				interactionDepth.current = 0;
				interacting.current = false;
				pendingConnection.current.reset();
				connectionStoreController.current?.cancel();
				const drag = nodeDragState.current;
				nodeDragState.current = undefined;
				if (drag) {
					revealNodeDragChrome(drag);
				}
				setVideoPanelFollow(undefined);
				setGuides([]);
			}

			const currentNodeById = new Map(nodesRef.current.map(node => [node.id, node]));
			const selectedCards = selectionControlledByHost ? new Set(snapshot.selectedCardPaths ?? []) : undefined;
			const nextNodes = snapshot.cards.map(card => {
				const current = currentNodeById.get(card.path);
				const selected = selectedCards ? selectedCards.has(card.path) : current?.selected ?? false;
				const pending = pendingGeometry.current.get(card.path);
				if (pending
					&& pending.geometry.x === card.x
					&& pending.geometry.y === card.y
					&& pending.geometry.width === card.width
					&& pending.geometry.height === card.height) {
					pendingGeometry.current.delete(card.path);
				}
				if (!identityChanged && current
					&& (pending !== undefined || keyboardGeometryPath.current === card.path)) {
					return {
						...current,
						data: {
							card,
							sceneKey: snapshot.key,
							structuralEpoch: snapshot.structuralEpoch,
							beginResize: () => beginNodeResize(card.path),
							endResize: () => endNodeResize(card.path)
						},
						selected
					};
				}
				return makeNode(card, snapshot.key, snapshot.structuralEpoch, selected);
			});
			setLiveNodes(nextNodes);

			const currentEdgeById = new Map(edgesRef.current.map(edge => [edge.id, edge]));
			const incomingIds = new Set(snapshot.edges.map(edge => edge.id));
			const nextEdges: BaseHalfCanvasFlowEdge[] = [];
			for (const edge of snapshot.edges) {
				const mutation = identityChanged ? undefined : pendingEdges.current.get(edge.id);
				if (mutation?.kind === 'delete') {
					continue;
				}
				const projected = mutation?.kind === 'upsert' ? mutation.edge : edge;
				const current = currentEdgeById.get(projected.id);
					nextEdges.push(makeEdge(
						projected,
						snapshot.key,
						snapshot.structuralEpoch,
						selectionControlledByHost ? projected.id === snapshot.selectedEdgeId : current?.selected ?? false
					));
			}
			if (!identityChanged) {
				for (const [id, mutation] of pendingEdges.current) {
					if (mutation.kind !== 'upsert' || incomingIds.has(id)) {
						continue;
					}
					const current = currentEdgeById.get(id);
					nextEdges.push(makeEdge(mutation.edge, snapshot.key, snapshot.structuralEpoch, current?.selected ?? true));
				}
			}
			setLiveEdges(nextEdges);
		}, [beginNodeResize, endNodeResize, makeEdge, makeNode, revealNodeDragChrome, setLiveEdges, setLiveNodes]);

		const commitFinalGeometry = vendor.useCallback((nextNodes: readonly BaseHalfCanvasFlowNode[], changes: readonly NodeChange<BaseHalfCanvasFlowNode>[], reason?: BaseHalfCanvasSceneGeometryReason) => {
			const finalIds = new Set<string>();
			for (const change of changes) {
				if (change.type === 'position' && change.position && change.dragging === false) {
					finalIds.add(change.id);
				} else if (change.type === 'dimensions' && change.dimensions && change.resizing === false) {
					finalIds.add(change.id);
				}
			}
			if (finalIds.size === 0) {
				return;
			}
			const geometries: IBaseHalfCanvasSceneGeometry[] = [];
			let operationKey: string | undefined;
			let operationEpoch: number | undefined;
			for (const id of finalIds) {
				const node = nextNodes.find(candidate => candidate.id === id);
				if (!node) {
					continue;
				}
				operationKey ??= node.data.sceneKey;
				operationEpoch ??= node.data.structuralEpoch;
				if (node.data.sceneKey !== operationKey || node.data.structuralEpoch !== operationEpoch) {
					return;
				}
				geometries.push(baseHalfCanvasSceneGeometryForCommit({
					path: id,
					kind: node.data.card.kind,
					x: node.position.x,
					y: node.position.y,
					width: node.width ?? node.measured?.width ?? numericStyle(node.style?.width) ?? node.data.card.width,
					height: node.height ?? node.measured?.height ?? numericStyle(node.style?.height) ?? node.data.card.height
				}, node.data.card));
			}
			if (geometries.length === 0 || !operationKey || operationEpoch === undefined) {
				return;
			}
			const token = ++mutationSequence.current;
			for (const geometry of geometries) {
				pendingGeometry.current.set(geometry.path, { token, geometry });
			}
			void delegate.commitGeometry(operationKey, operationEpoch, geometries, reason).catch(error => {
				if (sceneKeyRef.current !== operationKey || structuralEpochRef.current !== operationEpoch) {
					return;
				}
				let shouldReconcile = false;
				for (const geometry of geometries) {
					if (pendingGeometry.current.get(geometry.path)?.token === token) {
						pendingGeometry.current.delete(geometry.path);
						shouldReconcile = true;
					}
				}
				if (shouldReconcile) {
					updateSnapshot(snapshotRef.current);
				}
				delegate.reportError(error);
			});
		}, [updateSnapshot]);

		const applyNodesChange = vendor.useCallback((changes: NodeChange<BaseHalfCanvasFlowNode>[], disableSnap: boolean, reason?: BaseHalfCanvasSceneGeometryReason) => {
			const drag = nodeDragState.current;
			const acceptedChanges = drag?.cancelled
				? filterBaseHalfCanvasCancelledNodeDragChanges(changes, drag.origins)
				: changes;
			if (acceptedChanges.length === 0) {
				return;
			}
			const selectionChanges = acceptedChanges.filter(change => change.type === 'select');
			if (selectionChanges.length > 0) {
				queueSelectionChanges(selectionChanges);
			}
			const nonSelectionChanges = acceptedChanges.filter(change => change.type !== 'select');
			if (nonSelectionChanges.length === 0) {
				return;
			}
			const changesGeometry = nonSelectionChanges.some(change => change.type === 'position' || change.type === 'dimensions');
			if (changesGeometry) {
				const ownerKey = interactionSceneKey.current ?? sceneKeyRef.current;
				const ownerEpoch = interactionStructuralEpoch.current ?? structuralEpochRef.current;
				if (ownerKey !== sceneKeyRef.current || ownerEpoch !== structuralEpochRef.current || nonSelectionChanges.some(change => {
					if (change.type !== 'position' && change.type !== 'dimensions') {
						return false;
					}
					const data = nodesRef.current.find(node => node.id === change.id)?.data;
					return data?.sceneKey !== ownerKey || data.structuralEpoch !== ownerEpoch;
				})) {
					return;
				}
			}
			const snapped = snapBaseHalfCanvasFlowNodeChanges(nodesRef.current, nonSelectionChanges, {
				threshold: BASEHALF_CANVAS_SNAP_GUIDE_SCREEN_THRESHOLD / Math.max(0.2, viewportRef.current.zoom),
				disabled: disableSnap || !snapEnabledRef.current,
				defaultWidth: BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH,
				defaultHeight: BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT,
				minWidth: BASEHALF_CANVAS_MIN_CARD_WIDTH,
				minHeight: BASEHALF_CANVAS_MIN_CARD_HEIGHT
			});
			setGuides(current => sameBaseHalfCanvasSnapGuides(current, snapped.guides) ? current : snapped.guides);
			const next = vendor.applyNodeChanges(snapped.changes, nodesRef.current);
			setLiveNodes(next);
			commitFinalGeometry(next, snapped.changes, reason);
		}, [commitFinalGeometry, queueSelectionChanges, setLiveNodes]);
		const onNodesChange = vendor.useCallback((changes: NodeChange<BaseHalfCanvasFlowNode>[]) => {
			applyNodesChange(changes, false);
		}, [applyNodesChange]);
		const reportViewport = vendor.useCallback((sceneKey: string, viewport: Viewport, final: boolean) => {
			if (sceneKeyRef.current !== sceneKey) {
				return;
			}
			const next = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
			viewportRef.current = next;
			onViewport(next);
			delegate.reportViewport(sceneKey, next, final);
		}, []);
		const beginNodeDrag = vendor.useCallback((_event: MouseEvent | TouchEvent, node: BaseHalfCanvasFlowNode, draggedNodes: BaseHalfCanvasFlowNode[]) => {
			if (host.dataset.videoInputPickActive) {
				return;
			}
			const capturedSelection = nodeDragSelectionAtPointerDown.current;
			nodeDragSelectionAtPointerDown.current = undefined;
			const selectionAtStart = capturedSelection?.primaryPath === node.id
				? capturedSelection.selection
				: nodesRef.current.filter(candidate => candidate.selected).map(candidate => candidate.id);
			selectionIntents.current.invalidate();
			pendingSelectionRequest.current = undefined;
			const ids = new Set([
				node.id,
				...draggedNodes.map(candidate => candidate.id),
				...selectionAtStart
			]);
			const drag: IBaseHalfCanvasNodeDragState = {
				sceneKey: sceneKeyRef.current,
				structuralEpoch: structuralEpochRef.current,
				token: ++nodeDragToken.current,
				primaryPath: node.id,
				selectionAtStart,
				origins: captureBaseHalfCanvasNodeDragOrigins(nodesRef.current, ids),
				cancelled: false
			};
			nodeDragState.current = drag;
			suppressNodeDragChrome(drag);
			beginInteraction();
		}, [beginInteraction, suppressNodeDragChrome]);
		const finishNodeDrag = vendor.useCallback(() => {
			const drag = nodeDragState.current;
			nodeDragState.current = undefined;
			if (!drag || drag.cancelled) {
				return;
			}
			endInteraction();
			settleNodeDragChrome(drag);
			// A set that was moved is still the set. One card that was dragged is
			// the one selected card.
			const movedSet = drag.selectionAtStart.length >= 2 && drag.selectionAtStart.includes(drag.primaryPath);
			const settleSelection = drag.sceneKey === sceneKeyRef.current && drag.structuralEpoch === structuralEpochRef.current
				? requestSelection({ cardPaths: movedSet ? drag.selectionAtStart : [drag.primaryPath] })
				: Promise.resolve(false);
			void settleSelection
				.catch(error => delegate.reportError(error))
				.finally(() => revealNodeDragChrome(drag));
		}, [endInteraction, requestSelection, revealNodeDragChrome, settleNodeDragChrome]);

		const onEdgesChange = vendor.useCallback((changes: EdgeChange<BaseHalfCanvasFlowEdge>[]) => {
			const selectionChanges = changes.filter(change => change.type === 'select');
			if (selectionChanges.length > 0) {
				queueSelectionChanges([], selectionChanges);
			}
			const nonSelectionChanges = changes.filter(change => change.type !== 'select');
			if (nonSelectionChanges.length > 0) {
				setLiveEdges(vendor.applyEdgeChanges(nonSelectionChanges, edgesRef.current));
			}
		}, [queueSelectionChanges, setLiveEdges]);

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
			const drawMarquee = (current: IBaseHalfCanvasScenePressGesture): void => {
				const flow = flowRef.current;
				if (!flow || !current.startFlow) {
					return;
				}
				const pointer = flow.screenToFlowPosition({ x: current.clientX, y: current.clientY });
				const next = new Set(baseHalfCanvasCardsInMarquee(nodesRef.current.map(flowNodeRect), {
					x: Math.min(current.startFlow.x, pointer.x),
					y: Math.min(current.startFlow.y, pointer.y),
					width: Math.abs(pointer.x - current.startFlow.x),
					height: Math.abs(pointer.y - current.startFlow.y)
				}));
				showBoxed(next, current.boxed);
				current.boxed = next;
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
					showBoxed(new Set(), boxed);
					marquee.hidden = true;
					const selects = current.phase === 'active' && !cancelled;
					endInteraction();
					if (selects) {
						void sceneGesture.current.requestSelection({ cardPaths: nodesRef.current.filter(node => boxed.has(node.id)).map(node => node.id) });
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

		const beginConnection = vendor.useCallback((gesture: BaseHalfCanvasConnectionGesture, event?: MouseEvent | TouchEvent) => {
			const start = pendingConnection.current.begin(sceneKeyRef.current, structuralEpochRef.current, gesture, {
				rejectableTrailingClick: gesture === 'click' && (event?.detail ?? 0) > 0
			});
			if (start.kind === 'deferred-to-click') {
				return;
			}
			if (start.kind === 'rejected-trailing-click') {
				host.ownerDocument.defaultView?.queueMicrotask(() => connectionStoreController.current?.cancel());
				return;
			}
			if (start.previous) {
				endInteraction();
			}
			if (gesture === 'pointer') {
				connectionStoreController.current?.clearClickStart();
			} else {
				connectionStoreController.current?.cancel();
			}
			beginInteraction();
		}, [beginInteraction, endInteraction]);

		const optimisticConnect = vendor.useCallback((connection: Connection) => {
			if (!connection.source || !connection.target) {
				return;
			}
			if (connection.source === connection.target) {
				delegate.reportError(new Error('A node cannot provide context to itself.'));
				return;
			}
			const owner = pendingConnection.current.peekMutationOwner();
			const operationKey = owner?.sceneKey;
			const operationEpoch = owner?.structuralEpoch;
			const sourceNode = nodesRef.current.find(node => node.id === connection.source);
			const targetNode = nodesRef.current.find(node => node.id === connection.target);
			if (!operationKey || operationEpoch === undefined || operationKey !== sceneKeyRef.current || operationEpoch !== structuralEpochRef.current
				|| sourceNode?.data.sceneKey !== operationKey || sourceNode.data.structuralEpoch !== operationEpoch
				|| targetNode?.data.sceneKey !== operationKey || targetNode.data.structuralEpoch !== operationEpoch) {
				return;
			}
			const refusal = baseHalfCanvasSceneConnectionRefusal(targetNode.data.card);
			if (refusal) {
				delegate.reportError(new Error(refusal));
				return;
			}
			const intent: IBaseHalfCanvasSceneConnection = {
				from: connection.source,
				fromKind: sourceNode.data.card.kind,
				fromAnchor: anchorFromHandle(connection.sourceHandle, 'east'),
				to: connection.target,
				toKind: targetNode.data.card.kind,
				toAnchor: anchorFromHandle(connection.targetHandle, 'west')
			};
			const edge: IBaseHalfCanvasSceneEdge = {
				id: sceneEdgeId(intent.from, intent.to),
				from: intent.from,
				fromKind: intent.fromKind,
				from_anchor: intent.fromAnchor,
				to: intent.to,
				toKind: intent.toKind,
				to_anchor: intent.toAnchor
			};
			if (edgesRef.current.some(candidate => candidate.id === edge.id)) {
				delegate.reportError(new Error('This context connection already exists.'));
				return;
			}
			const token = ++mutationSequence.current;
			pendingEdges.current.set(edge.id, { token, kind: 'upsert', edge });
			setLiveEdges([...edgesRef.current.filter(candidate => candidate.id !== edge.id), makeEdge(edge, operationKey, operationEpoch, true)]);
			void delegate.connect(operationKey, operationEpoch, intent).then(() => {
				if (sceneKeyRef.current === operationKey && structuralEpochRef.current === operationEpoch && pendingEdges.current.get(edge.id)?.token === token) {
					pendingEdges.current.delete(edge.id);
				}
			}).catch(error => {
				if (sceneKeyRef.current !== operationKey || structuralEpochRef.current !== operationEpoch || pendingEdges.current.get(edge.id)?.token !== token) {
					return;
				}
				pendingEdges.current.delete(edge.id);
				updateSnapshot(snapshotRef.current);
				delegate.reportError(error);
			});
		}, [makeEdge, setLiveEdges, updateSnapshot]);

		const finishPointerConnect = vendor.useCallback((_event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
			const finish = pendingConnection.current.finishPointer();
			if (finish.kind !== 'owned') {
				return;
			}
			const owner = finish.owner;
			const operationKey = owner.sceneKey;
			const operationEpoch = owner.structuralEpoch;
			endInteraction();

			if (operationKey !== sceneKeyRef.current || operationEpoch !== structuralEpochRef.current
				|| !state.fromNode || state.toNode) {
				return;
			}
			const sourceNode = nodesRef.current.find(node => node.id === state.fromNode?.id);
			if (sourceNode?.data.sceneKey !== operationKey || sourceNode.data.structuralEpoch !== operationEpoch) {
				return;
			}
			const bounds = host.getBoundingClientRect();
			const client = {
				x: bounds.left + state.pointer.x,
				y: bounds.top + state.pointer.y
			};
			if (client.x < bounds.left || client.x > bounds.right || client.y < bounds.top || client.y > bounds.bottom) {
				return;
			}
			const hit = host.ownerDocument.elementFromPoint(client.x, client.y);
			if (hit?.closest('.react-flow__node, .react-flow__edge, .basehalf-canvas-set-box')) {
				return;
			}
			const flow = flowRef.current;
			if (!flow) {
				return;
			}
			const drop = resolveBaseHalfCanvasSceneConnectionDrop({
				from: sourceNode.id,
				fromKind: sourceNode.data.card.kind,
				fromAnchor: anchorFromHandle(state.fromHandle?.id, 'east')
			}, false, flow.screenToFlowPosition(client), client);
			if (!drop) {
				return;
			}
			const token = ++dropLineToken.current;
			// `state.from` is in flow coordinates but `state.to` is relative to the
			// container in screen pixels; the drop position is the release point
			// in flow coordinates.
			const [path] = vendor.getBezierPath({
				sourceX: state.from.x,
				sourceY: state.from.y,
				sourcePosition: state.fromPosition,
				targetX: drop.position.x,
				targetY: drop.position.y,
				targetPosition: state.toPosition ?? flowPosition(vendor, baseHalfCanvasOppositeAnchor(drop.fromAnchor))
			});
			setDropLine({
				token,
				sceneKey: operationKey,
				source: drop.from,
				path,
				knownEdgeIds: new Set(edgesRef.current.filter(edge => edge.source === drop.from).map(edge => edge.id)),
				awaitingEdge: false
			});
			const clear = () => setDropLine(current => current?.token === token ? undefined : current);
			void delegate.showConnectionCreateMenu(operationKey, operationEpoch, drop).then(created => {
				if (!created) {
					// Hide it in the task that closed the menu; React removes it
					// on its next render.
					if (dropLineToken.current === token) {
						dropLineElement.current?.style.setProperty('display', 'none');
					}
					clear();
					return;
				}
				setDropLine(current => current?.token === token ? { ...current, awaitingEdge: true } : current);
				host.ownerDocument.defaultView?.setTimeout(clear, CONNECTION_DROP_LINE_EDGE_TIMEOUT_MS);
			}, error => {
				clear();
				delegate.reportError(error);
			});
		}, [endInteraction]);
		vendor.useEffect(() => {
			// The chosen node's edge replaces the kept line as soon as it is drawn.
			if (dropLine?.awaitingEdge && edges.some(edge => edge.source === dropLine.source && !dropLine.knownEdgeIds.has(edge.id))) {
				setDropLine(current => current?.token === dropLine.token ? undefined : current);
			}
		}, [dropLine, edges]);
		const finishClickConnect = vendor.useCallback(() => {
			const owner = pendingConnection.current.take('click');
			if (owner) {
				endInteraction();
			}
		}, [endInteraction]);

		const optimisticReconnect = vendor.useCallback((flowEdge: BaseHalfCanvasFlowEdge, connection: Connection) => {
			const previous = flowEdge.data?.edge;
			const operationKey = flowEdge.data?.sceneKey;
			const operationEpoch = flowEdge.data?.structuralEpoch;
			if (!previous || !operationKey || operationEpoch === undefined || operationKey !== sceneKeyRef.current || operationEpoch !== structuralEpochRef.current
				|| !connection.source || !connection.target) {
				return;
			}
			if (connection.source === connection.target) {
				delegate.reportError(new Error('A node cannot provide context to itself.'));
				return;
			}
			const sourceNode = nodesRef.current.find(node => node.id === connection.source);
			const targetNode = nodesRef.current.find(node => node.id === connection.target);
			if (sourceNode?.data.sceneKey !== operationKey || sourceNode.data.structuralEpoch !== operationEpoch
				|| targetNode?.data.sceneKey !== operationKey || targetNode.data.structuralEpoch !== operationEpoch) {
				return;
			}
			const refusal = baseHalfCanvasSceneConnectionRefusal(targetNode.data.card, previous.to);
			if (refusal) {
				delegate.reportError(new Error(refusal));
				return;
			}
			const next: IBaseHalfCanvasSceneConnection = {
				from: connection.source,
				fromKind: sourceNode.data.card.kind,
				fromAnchor: anchorFromHandle(connection.sourceHandle, previous.from_anchor),
				to: connection.target,
				toKind: targetNode.data.card.kind,
				toAnchor: anchorFromHandle(connection.targetHandle, previous.to_anchor)
			};
			const nextEdge: IBaseHalfCanvasSceneEdge = {
				id: sceneEdgeId(next.from, next.to),
				from: next.from,
				fromKind: next.fromKind,
				from_anchor: next.fromAnchor,
				to: next.to,
				toKind: next.toKind,
				to_anchor: next.toAnchor
			};
			if (nextEdge.id !== previous.id && edgesRef.current.some(candidate => candidate.id === nextEdge.id)) {
				delegate.reportError(new Error('This context connection already exists.'));
				return;
			}
			const token = ++mutationSequence.current;
			if (previous.id !== nextEdge.id) {
				pendingEdges.current.set(previous.id, { token, kind: 'delete' });
			}
			pendingEdges.current.set(nextEdge.id, { token, kind: 'upsert', edge: nextEdge });
			setLiveEdges([
				...edgesRef.current.filter(candidate => candidate.id !== previous.id && candidate.id !== nextEdge.id),
				makeEdge(nextEdge, operationKey, operationEpoch, true)
			]);
			void delegate.reconnect(operationKey, operationEpoch, { previous, next }).then(() => {
				if (sceneKeyRef.current !== operationKey || structuralEpochRef.current !== operationEpoch) {
					return;
				}
				for (const id of new Set([previous.id, nextEdge.id])) {
					if (pendingEdges.current.get(id)?.token === token) {
						pendingEdges.current.delete(id);
					}
				}
			}).catch(error => {
				if (sceneKeyRef.current !== operationKey || structuralEpochRef.current !== operationEpoch) {
					return;
				}
				let shouldReconcile = false;
				for (const id of new Set([previous.id, nextEdge.id])) {
					if (pendingEdges.current.get(id)?.token === token) {
						pendingEdges.current.delete(id);
						shouldReconcile = true;
					}
				}
				if (shouldReconcile) {
					updateSnapshot(snapshotRef.current);
				}
				delegate.reportError(error);
			});
		}, [makeEdge, setLiveEdges, updateSnapshot]);

		const removeEdges = vendor.useCallback((deleted: readonly BaseHalfCanvasFlowEdge[]) => {
			for (const flowEdge of deleted) {
				const edge = flowEdge.data?.edge;
				const operationKey = flowEdge.data?.sceneKey;
				const operationEpoch = flowEdge.data?.structuralEpoch;
				if (!edge || !operationKey || operationEpoch === undefined || operationKey !== sceneKeyRef.current || operationEpoch !== structuralEpochRef.current) {
					continue;
				}
				const token = ++mutationSequence.current;
				pendingEdges.current.set(edge.id, { token, kind: 'delete' });
				void delegate.removeEdge(operationKey, operationEpoch, edge).then(() => {
					if (sceneKeyRef.current === operationKey && structuralEpochRef.current === operationEpoch && pendingEdges.current.get(edge.id)?.token === token) {
						pendingEdges.current.delete(edge.id);
					}
				}).catch(error => {
					if (sceneKeyRef.current !== operationKey || structuralEpochRef.current !== operationEpoch || pendingEdges.current.get(edge.id)?.token !== token) {
						return;
					}
					pendingEdges.current.delete(edge.id);
					updateSnapshot(snapshotRef.current);
					delegate.reportError(error);
				});
			}
		}, [updateSnapshot]);

		const ownsCurrentEdge = vendor.useCallback((flowEdge: BaseHalfCanvasFlowEdge): boolean => {
			const data = flowEdge.data;
			return !!data
				&& data.sceneKey === sceneKeyRef.current
				&& data.structuralEpoch === structuralEpochRef.current
				&& edgesRef.current.some(candidate => candidate.id === flowEdge.id
					&& candidate.data?.sceneKey === data.sceneKey
					&& candidate.data.structuralEpoch === data.structuralEpoch);
		}, []);
		const edgeInteraction = vendor.useMemo<IBaseHalfCanvasEdgeInteraction>(() => ({
			begin(flowEdge): boolean {
				if (!ownsCurrentEdge(flowEdge)) {
					return false;
				}
				host.focus({ preventScroll: true });
				beginInteraction();
				return true;
			},
			end: endInteraction,
			select(flowEdge, preserveFocus = false): void {
				if (!ownsCurrentEdge(flowEdge)) {
					return;
				}
				if (!preserveFocus) {
					host.focus({ preventScroll: true });
				}
				void requestSelection({ edgeId: flowEdge.id });
			},
			reconnect: optimisticReconnect,
			remove(flowEdge): void {
				if (!ownsCurrentEdge(flowEdge)) {
					return;
				}
				setLiveEdges(edgesRef.current.filter(candidate => candidate.id !== flowEdge.id));
				removeEdges([flowEdge]);
			}
		}), [beginInteraction, endInteraction, optimisticReconnect, ownsCurrentEdge, removeEdges, requestSelection, setLiveEdges]);

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

		const runViewportCommand = vendor.useCallback(async (operation: () => Promise<void>): Promise<void> => {
			const operationKey = sceneKeyRef.current;
			const queued = viewportCommandQueue.current.catch(() => undefined).then(async () => {
				if (sceneKeyRef.current !== operationKey) {
					return;
				}
				viewportCommandKey.current = operationKey;
				try {
					await operation();
					await new Promise<void>(resolve => host.ownerDocument.defaultView?.setTimeout(resolve, 0) ?? resolve());
					const flow = flowRef.current;
					if (flow && sceneKeyRef.current === operationKey) {
						// React Flow can deliver the null-event onMove/onMoveEnd pair after
						// an imperative command's promise settles. Publish the authoritative
						// viewport before releasing its owner so the workbench always
						// receives the final geometry.
						reportViewport(operationKey, flow.getViewport(), true);
					}
				} finally {
					if (viewportCommandKey.current === operationKey) {
						viewportCommandKey.current = undefined;
					}
				}
			});
			viewportCommandQueue.current = queued;
			await queued;
		}, [reportViewport]);

		const runtime = vendor.useMemo<IBaseHalfCanvasSceneRuntime>(() => ({
			update: updateSnapshot,
			setVideoPanelSurface(surface: IBaseHalfCanvasSceneVideoPanelSurface): void {
				setVideoPanelSurfaceState(surface);
			},
			clearVideoPanelSurface(element: HTMLElement): void {
				setVideoPanelSurfaceState(current => current?.element === element ? undefined : current);
			},
			setSnapEnabled(enabled: boolean): void {
				snapEnabledRef.current = enabled;
				if (!enabled) {
					setGuides(current => current.length === 0 ? current : []);
				}
			},
			async setZoom(zoom: number): Promise<void> {
				await runViewportCommand(async () => {
					const flow = flowRef.current;
					if (!flow) {
						return;
					}
					const rect = host.getBoundingClientRect();
					const center = flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
					await flow.setCenter(center.x, center.y, { zoom, duration: 0 });
				});
			},
			async zoomBy(factor: number): Promise<void> {
				await this.setZoom(viewportRef.current.zoom * factor);
			},
			async setViewportCenter(x: number, y: number, zoom?: number): Promise<void> {
				await runViewportCommand(async () => {
					await flowRef.current?.setCenter(x, y, { zoom: zoom ?? viewportRef.current.zoom, duration: 0 });
				});
			},
			async fit(paths?: readonly string[], options?: IBaseHalfCanvasSceneFitOptions): Promise<void> {
				const flow = flowRef.current;
				if (!flow) {
					return;
				}
				const wanted = paths ? new Set(paths) : undefined;
				const fitNodes = wanted ? nodesRef.current.filter(node => wanted.has(node.id)) : nodesRef.current;
				if (fitNodes.length === 0) {
					return;
				}
				const bounds = vendor.getNodesBounds(fitNodes);
				const visualBounds = {
					...bounds,
					y: bounds.y - BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP - BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT,
					height: bounds.height + BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP + BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT
				};
				const viewport = vendor.getViewportForBounds(
					visualBounds,
					host.clientWidth,
					host.clientHeight,
					BASEHALF_CANVAS_MIN_ZOOM,
					options?.maxZoom ?? BASEHALF_CANVAS_MAX_ZOOM,
					options?.padding ?? 0.12
				);
				await runViewportCommand(async () => {
					await flow.setViewport(viewport, { duration: 0 });
				});
			},
			async reveal(path: string): Promise<void> {
				const node = nodesRef.current.find(candidate => candidate.id === path);
				if (node) {
					const bounds = vendor.getNodesBounds([node]);
					const visualBounds = {
						...bounds,
						y: bounds.y - BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP - BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT,
						height: bounds.height + BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP + BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT
					};
					const viewport = vendor.getViewportForBounds(
						visualBounds,
						host.clientWidth,
						host.clientHeight,
						BASEHALF_CANVAS_MIN_ZOOM,
						viewportRef.current.zoom,
						0.18
					);
					await runViewportCommand(async () => {
						await flowRef.current?.setViewport(viewport, { duration: 0 });
					});
				}
			},
			screenToCanvasPosition(x: number, y: number): { readonly x: number; readonly y: number } {
				return flowRef.current?.screenToFlowPosition({ x, y }) ?? { x, y };
			},
			select(selection: IBaseHalfCanvasSceneSelection): void {
				void requestSelection(selection);
			},
			getViewport: () => viewportRef.current,
			isInteracting: () => interacting.current
		}), [requestSelection, runViewportCommand, updateSnapshot]);

		vendor.useEffect(() => ready(runtime), [runtime]);

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

		const videoInputPickGesturePolicy = baseHalfCanvasSceneVideoInputPickGesturePolicy(videoInputPickActive);
		const flowProps: ReactFlowProps<BaseHalfCanvasFlowNode, BaseHalfCanvasFlowEdge> = {
			nodes,
			edges,
			nodeTypes,
			edgeTypes,
			onNodesChange,
			onEdgesChange,
			onConnect: optimisticConnect,
			onConnectStart: () => beginConnection('pointer'),
			onConnectEnd: finishPointerConnect,
			onClickConnectStart: event => beginConnection('click', event),
			onClickConnectEnd: finishClickConnect,
			onEdgesDelete: removeEdges,
			onNodeDragStart: beginNodeDrag,
			onNodeDragStop: finishNodeDrag,
			onNodeClick,
			onNodeDoubleClick,
			onNodeContextMenu,
			onEdgeContextMenu,
			onPaneContextMenu,
			onPaneClick: event => {
				const connectionPending = pendingConnection.current.peek()?.gesture === 'click';
				if (connectionPending) {
					lastPaneConnectionCancellationAt.current = event.timeStamp;
					cancelPendingConnection();
				}
				void requestSelection({});
				host.focus({ preventScroll: true });
			},
			onEdgeClick: (_event, edge) => {
				host.focus({ preventScroll: true });
				void requestSelection({ edgeId: edge.id });
			},
			onInit: flow => {
				flowRef.current = flow;
				reportViewport(sceneKeyRef.current, flow.getViewport(), false);
			},
			onMoveStart: event => {
				// React Flow reports `null` for imperative viewport commands. Those
				// already carry their immutable owner in viewportCommandKey.
				if (!event || viewportCommandKey.current) {
					return;
				}
				delegate.didStartViewportInteraction();
				viewportGestureSceneKey.current = sceneKeyRef.current;
				beginInteraction();
			},
			onMove: (_event, viewport) => {
				const owner = viewportCommandKey.current ?? viewportGestureSceneKey.current;
				if (owner) {
					reportViewport(owner, viewport, false);
				}
				followSceneGesture.current?.();
			},
			onMoveEnd: (_event, viewport) => {
				const commandOwner = viewportCommandKey.current;
				const gestureOwner = viewportGestureSceneKey.current;
				const owner = commandOwner ?? gestureOwner;
				if (owner) {
					reportViewport(owner, viewport, true);
				}
				if (!commandOwner && gestureOwner) {
					viewportGestureSceneKey.current = undefined;
					endInteraction();
				}
			},
			connectionMode: vendor.ConnectionMode.Loose,
			nodesDraggable: videoInputPickGesturePolicy.nodesDraggable,
			connectOnClick: true,
			connectionRadius: 48,
			edgesReconnectable: false,
			deleteKeyCode: null,
			minZoom: BASEHALF_CANVAS_MIN_ZOOM,
			maxZoom: BASEHALF_CANVAS_MAX_ZOOM,
			panOnScroll: videoInputPickGesturePolicy.viewportNavigationAllowed,
			panOnScrollSpeed: 1,
			zoomOnScroll: false,
			zoomOnPinch: videoInputPickGesturePolicy.viewportNavigationAllowed,
			zoomOnDoubleClick: false,
			// The scene draws the marquee and the box of a set itself. The
			// library's marquee also marks connections, and its rectangle around
			// selected cards is a second state beside the selection.
			selectionOnDrag: false,
			selectionKeyCode: null,
			panOnDrag: videoInputPickGesturePolicy.viewportNavigationAllowed ? [1, 2] : false,
			multiSelectionKeyCode: 'Shift',
			onlyRenderVisibleElements: nodes.length > CANVAS_NODE_CULL_THRESHOLD
				&& !nodes.some(node => node.data.card.controls?.kind === 'note' && node.data.card.forceInteractive === true),
			proOptions: { hideAttribution: true },
			defaultEdgeOptions: { type: 'basehalf-reference', animated: false },
			fitView: false
		};
		const ReactFlowComponent = vendor.ReactFlow as unknown as (props: ReactFlowProps<BaseHalfCanvasFlowNode, BaseHalfCanvasFlowEdge>) => ReactElement;
		const selectedNodes = nodes.filter(node => node.selected);
		const selectionSurface = baseHalfCanvasSceneSelectionSurface(selectedNodes.map(node => node.data.card));
		const adjacentChromeSuppressed = nodeDragChromePhase !== undefined;
		const videoPanelNode = videoPanelSurface
			&& videoPanelSurface.sceneKey === sceneKeyRef.current
			&& videoPanelSurface.structuralEpoch === structuralEpochRef.current
			&& selectedNodes.length === 1
			&& selectedNodes[0].id === videoPanelSurface.path
				? selectedNodes[0]
				: undefined;
		return h(EdgeInteractionContext.Provider, { value: edgeInteraction },
			h(SelectionSizeContext.Provider, { value: selectedNodes.length },
				h(ReactFlowComponent, flowProps,
					h(ConnectionStoreBridge, { register: registerConnectionStore }),
					h(vendor.Background, {
						variant: vendor.BackgroundVariant.Lines,
						gap: 40,
						size: 1,
						color: 'color-mix(in srgb, var(--vscode-foreground) 4.5%, transparent)'
					}),
					h(SnapGuides, { guides, zoom: viewportRef.current.zoom }),
					dropLine && dropLine.sceneKey === sceneKeyRef.current ? h(ConnectionDropLine, { key: dropLine.token, path: dropLine.path, elementRef: dropLineElement }) : null,
					h(ConnectCaptureLayer, { nodes, disabled: videoInputPickActive || nodeDragChromePhase !== undefined }),
					videoPanelNode && videoPanelSurface
						? h(VideoPanelAdjacentSurface, {
							key: videoPanelSurface.path,
							node: videoPanelNode,
							surface: videoPanelSurface,
							following: videoPanelFollow?.path === videoPanelNode.id
						})
						: null,
					selectionSurface === 'note'
						? h(NoteSelectionControls, { node: selectedNodes[0], suppressed: adjacentChromeSuppressed })
						: selectionSurface === 'video'
							? h(VideoSelectionControls, { node: selectedNodes[0], suppressed: adjacentChromeSuppressed })
						: selectionSurface === 'structural'
								? h(SelectionToolbar, { nodes: selectedNodes, invoke: invokeSelectionAction, arrange: arrangeSet, suppressed: adjacentChromeSuppressed })
								: null,
					selectedNodes.length >= 2
						? h(SetBox, { nodes: selectedNodes, onToggleAt: toggleSetCardAt })
						: null
				)
			)
		);
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

	return { Component: SceneComponent };
}

function flowPosition(vendor: BaseHalfCanvasReactVendor, anchor: BaseHalfCanvasAnchor) {
	switch (anchor) {
		case 'north': return vendor.Position.Top;
		case 'east': return vendor.Position.Right;
		case 'south': return vendor.Position.Bottom;
		case 'west': return vendor.Position.Left;
	}
}

function anchorFromHandle(value: string | null | undefined, fallback: BaseHalfCanvasAnchor): BaseHalfCanvasAnchor {
	return value === 'north' || value === 'east' || value === 'south' || value === 'west' ? value : fallback;
}

function sceneEdgeId(from: string, to: string): string {
	return `${from}\u0000${to}`;
}

/**
 * The rectangle of a card with the caption above it. The caption takes the
 * pointer, so the box of a set holds it: a press on the name of a card of a
 * set is a press on the box.
 */
function flowNodeRectWithCaption(node: BaseHalfCanvasFlowNode): IBaseHalfCanvasArrangeCard {
	const rect = flowNodeRect(node);
	const caption = BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP + BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT;
	return { ...rect, y: rect.y - caption, height: rect.height + caption };
}

/** The rectangle of a card as the scene has it now. */
function flowNodeRect(node: BaseHalfCanvasFlowNode): IBaseHalfCanvasArrangeCard {
	return {
		path: node.id,
		x: node.position.x,
		y: node.position.y,
		width: node.width ?? node.measured?.width ?? numericStyle(node.style?.width) ?? node.data.card.width,
		height: node.height ?? node.measured?.height ?? numericStyle(node.style?.height) ?? node.data.card.height
	};
}

function numericStyle(value: string | number | undefined): number | undefined {
	if (typeof value === 'number') {
		return value;
	}
	if (typeof value === 'string') {
		const parsed = Number.parseFloat(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}
