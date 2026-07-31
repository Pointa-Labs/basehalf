/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { FileAccess } from '../../../base/common/network.js';
import { URI } from '../../../base/common/uri.js';
import { isHTMLElement, isSVGElement } from '../../../base/browser/dom.js';
import { localize } from '../../../nls.js';
import {
	BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT,
	BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH,
	BASEHALF_CANVAS_MIN_CARD_HEIGHT,
	BASEHALF_CANVAS_MIN_CARD_WIDTH,
	BaseHalfCanvasAnchor,
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
	IBaseHalfCanvasSceneCard,
	IBaseHalfCanvasSceneConnection,
	BaseHalfCanvasSceneSelectionAction,
	baseHalfCanvasSceneSelectionActions,
	BaseHalfCanvasSceneContextMenuRequest,
	IBaseHalfCanvasSceneDelegate,
	IBaseHalfCanvasSceneEdge,
	IBaseHalfCanvasSceneFitOptions,
	IBaseHalfCanvasSceneGeometry,
	IBaseHalfCanvasSceneRenderer,
	IBaseHalfCanvasSceneSelection,
	IBaseHalfCanvasSceneSnapshot,
	IBaseHalfCanvasSceneViewport,
	resolveBaseHalfCanvasSceneConnectionDrop
} from '../common/basehalfCanvasScene.js';
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
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react';
import type { Root } from 'react-dom/client';

type BaseHalfCanvasReactVendor = typeof import('react') & typeof import('react-dom/client') & typeof import('@xyflow/react');

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

export interface IBaseHalfCanvasNodeDragOrigin {
	readonly id: string;
	readonly x: number;
	readonly y: number;
}

interface IBaseHalfCanvasNodeDragState {
	readonly sceneKey: string;
	readonly structuralEpoch: number;
	readonly origins: readonly IBaseHalfCanvasNodeDragOrigin[];
	cancelled: boolean;
}

interface IBaseHalfCanvasConnectionStoreController {
	cancel(): void;
	clearClickStart(): void;
}

type BaseHalfCanvasPendingEdgeMutation =
	| { readonly token: number; readonly kind: 'upsert'; readonly edge: IBaseHalfCanvasSceneEdge }
	| { readonly token: number; readonly kind: 'delete' };

type BaseHalfCanvasFlowNode = Node<IBaseHalfCanvasFlowNodeData, 'basehalf-card'>;
type BaseHalfCanvasFlowEdge = Edge<IBaseHalfCanvasFlowEdgeData, 'basehalf-reference'>;

export function captureBaseHalfCanvasNodeDragOrigins(
	nodes: readonly { readonly id: string; readonly position: { readonly x: number; readonly y: number } }[],
	ids: ReadonlySet<string>
): readonly IBaseHalfCanvasNodeDragOrigin[] {
	return Object.freeze(nodes
		.filter(node => ids.has(node.id))
		.map(node => Object.freeze({ id: node.id, x: node.position.x, y: node.position.y })));
}

export function restoreBaseHalfCanvasNodeDragOrigins<T extends { readonly id: string; readonly position: { readonly x: number; readonly y: number } }>(
	nodes: readonly T[],
	origins: readonly IBaseHalfCanvasNodeDragOrigin[]
): T[] {
	const byId = new Map(origins.map(origin => [origin.id, origin]));
	return nodes.map(node => {
		const origin = byId.get(node.id);
		if (!origin || (node.position.x === origin.x && node.position.y === origin.y)) {
			return node;
		}
		return { ...node, position: { x: origin.x, y: origin.y } };
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
const SELECTION_TOOLBAR_SCREEN_HEIGHT = 32;
const SELECTION_TOOLBAR_SCREEN_MARGIN = 8;
const CANVAS_GRAPH_CONTROL_SELECTOR = 'button, input, textarea, select, a, audio, video, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="slider"], [role="spinbutton"], .nodrag, .nopan, .basehalf-canvas-card-connect-handle';

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
	const topScreen = options.top * zoom + options.viewport.y;
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

export function baseHalfCanvasSceneSelectionRenameLabel(renameChangesPathOnly: boolean): string {
	return renameChangesPathOnly
		? localize('basehalf.canvas.selection.renameFile', "Rename file")
		: localize('basehalf.canvas.selection.rename', "Rename");
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

/**
 * Workbench-side host for the build-time bundled React Flow island. Commands
 * issued before the bundle has loaded are serialized behind `whenReady`; the
 * latest snapshot always wins.
 */
export class BaseHalfCanvasReactScene implements IBaseHalfCanvasSceneRenderer {
	private readonly whenReady: Promise<IBaseHalfCanvasSceneRuntime>;
	private runtime: IBaseHalfCanvasSceneRuntime | undefined;
	private latestSnapshot: IBaseHalfCanvasSceneSnapshot | undefined;
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
						if (this.latestSnapshot) {
							runtime.update(this.latestSnapshot);
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

	function CardNode({ id, data, selected }: NodeProps<BaseHalfCanvasFlowNode>): ReactElement {
		const hostRef = vendor.useRef<HTMLDivElement>(null);
		const replacementFocusPath = vendor.useRef<readonly number[] | undefined>(undefined);
		const mountedCardRef = vendor.useRef({ card: data.card, height: data.card.height });
		const updateNodeInternals = vendor.useUpdateNodeInternals();
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
			const top = node.internals.positionAbsolute.y * viewportZoom + viewportY;
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
		const presentation = baseHalfCanvasCardPresentation({
			forceInteractive: data.card.forceInteractive === true,
			nearViewport,
			selected,
			selectionSize
		});
		mountedCardRef.current = { card: data.card, height };

		vendor.useLayoutEffect(() => () => {
			const mounted = mountedCardRef.current;
			const active = mounted.card.element.ownerDocument.activeElement;
			if (isHTMLElement(active) && mounted.card.element.contains(active)) {
				active.blur();
			}
			mounted.card.updatePresentation({
				level: 'shell',
				height: mounted.height
			});
		}, []);

		vendor.useLayoutEffect(() => {
			const mount = hostRef.current;
			if (!mount) {
				return;
			}
			mount.replaceChildren(data.card.element);
			const focusPath = replacementFocusPath.current;
			replacementFocusPath.current = undefined;
			if (focusPath) {
				const target = resolveBaseHalfCanvasCardFocusPath(data.card.element, focusPath);
				const focusTarget = isHTMLElement(target)
					&& (target === data.card.element || target.matches('button, input, textarea, select, [tabindex]'))
					? target
					: data.card.element;
				focusTarget.focus({ preventScroll: true });
			}
			return () => {
				if (data.card.element.parentElement === mount) {
					const active = data.card.element.ownerDocument.activeElement;
					replacementFocusPath.current = isHTMLElement(active)
						? captureBaseHalfCanvasCardFocusPath(data.card.element, active)
						: undefined;
					data.card.element.remove();
				}
			};
		}, [data.card.element]);

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
			element.classList.toggle('selected', selected);
			element.dataset.previewLevel = presentation;
			element.dataset.cardHeight = String(height);
			data.card.updatePresentation({
				level: presentation,
				height
			});
		}, [data.card, data.card.element, height, presentation, selected]);

		return h(vendor.Fragment, null,
			h(vendor.NodeResizer, {
				minWidth: BASEHALF_CANVAS_MIN_CARD_WIDTH,
				minHeight: BASEHALF_CANVAS_MIN_CARD_HEIGHT,
				isVisible: selected,
				lineClassName: 'basehalf-canvas-node-resizer-line',
				handleClassName: 'basehalf-canvas-node-resizer-handle',
				onResizeStart: data.beginResize,
				onResizeEnd: data.endResize
			}),
			...(['north', 'east', 'south', 'west'] as const).map(anchor => h(vendor.Handle, {
				key: anchor,
				id: anchor,
				type: 'source',
				position: flowPosition(vendor, anchor),
				className: `basehalf-canvas-card-connect-handle ${anchor}`,
				isConnectable: true,
				tabIndex: selected || clickConnectionInProgress ? 0 : -1,
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
			clearClickStart: () => store.setState({ connectionClickStartHandle: null })
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

	function SelectionToolbar({ nodes, invoke }: {
		readonly nodes: readonly BaseHalfCanvasFlowNode[];
		readonly invoke: (action: BaseHalfCanvasSceneSelectionAction, paths: readonly string[]) => void;
	}): ReactElement {
		const actions = baseHalfCanvasSceneSelectionActions(nodes.length);
		const viewport = vendor.useViewport();
		const [focusIndex, setFocusIndex] = vendor.useState(0);
		const paths = nodes.map(node => node.id);
		const key = paths.join('\0');
		vendor.useEffect(() => setFocusIndex(0), [key, actions.length]);
		if (nodes.length === 0 || actions.length === 0) {
			return h(vendor.Fragment);
		}
		const left = Math.min(...nodes.map(node => node.position.x));
		const top = Math.min(...nodes.map(node => node.position.y));
		const right = Math.max(...nodes.map(node => node.position.x + (node.width ?? node.measured?.width ?? numericStyle(node.style?.width) ?? node.data.card.width)));
		const bottom = Math.max(...nodes.map(node => node.position.y + (node.height ?? node.measured?.height ?? numericStyle(node.style?.height) ?? node.data.card.height)));
		const placement = resolveBaseHalfCanvasSelectionToolbarPlacement({
			left,
			top,
			right,
			bottom,
			viewport,
			viewportWidth: host.clientWidth,
			viewportHeight: host.clientHeight,
			toolbarWidth: nodes.length > 1 ? 116 : 92
		});
		const metadata: Record<BaseHalfCanvasSceneSelectionAction, { readonly label: string; readonly icon: string }> = {
			rename: { label: baseHalfCanvasSceneSelectionRenameLabel(nodes.length === 1 && nodes[0].data.card.renameChangesPathOnly === true), icon: 'edit' },
			duplicate: { label: localize('basehalf.canvas.selection.duplicate', "Duplicate"), icon: 'files' },
			copyReferences: { label: localize('basehalf.canvas.selection.copyReferences', "Copy references"), icon: 'copy' },
			delete: { label: localize('basehalf.canvas.selection.delete', "Delete"), icon: 'trash' }
		};
		const moveFocus = (event: ReactKeyboardEvent<HTMLElement>, index: number): void => {
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
			setFocusIndex(next);
			const toolbar = event.currentTarget.closest<HTMLElement>('.basehalf-canvas-selection-toolbar');
			toolbar?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
		};

		return h(vendor.ViewportPortal, null,
			h('div', {
				className: `basehalf-canvas-selection-toolbar ${placement.side} nodrag nopan nowheel`,
				role: 'toolbar',
				'aria-label': nodes.length === 1
					? localize('basehalf.canvas.selection.one', "Selected card actions")
					: localize('basehalf.canvas.selection.many', "Actions for {0} selected cards", nodes.length),
				style: { left: placement.left, top: placement.top },
				onPointerDown: (event: ReactPointerEvent<HTMLElement>) => event.stopPropagation(),
				onClick: (event: ReactMouseEvent<HTMLElement>) => event.stopPropagation()
			},
				nodes.length > 1 ? h('span', { className: 'basehalf-canvas-selection-count' }, String(nodes.length)) : null,
				...actions.map((action, index) => h('button', {
					key: action,
					type: 'button',
					className: `basehalf-canvas-selection-action codicon codicon-${metadata[action].icon}${action === 'delete' ? ' danger' : ''}`,
					title: metadata[action].label,
					'aria-label': metadata[action].label,
					tabIndex: index === focusIndex ? 0 : -1,
					onFocus: () => setFocusIndex(index),
					onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => moveFocus(event, index),
					onClick: (event: ReactMouseEvent<HTMLElement>) => {
						event.preventDefault();
						event.stopPropagation();
						invoke(action, paths);
					}
				}))
			)
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
		const pendingGeometry = vendor.useRef(new Map<string, number>());
		const pendingEdges = vendor.useRef(new Map<string, BaseHalfCanvasPendingEdgeMutation>());
		const interactionDepth = vendor.useRef(0);
		const interactionGeneration = vendor.useRef(0);
		const interactionSceneKey = vendor.useRef<string | undefined>(undefined);
		const interactionStructuralEpoch = vendor.useRef<number | undefined>(undefined);
		const pendingConnection = vendor.useRef(new BaseHalfCanvasPendingConnectionState());
		const lastPaneConnectionCancellationAt = vendor.useRef<number | undefined>(undefined);
		const paneDoubleClickStartedOnPane = vendor.useRef(false);
		const connectionStoreController = vendor.useRef<IBaseHalfCanvasConnectionStoreController | undefined>(undefined);
		const nodeDragState = vendor.useRef<IBaseHalfCanvasNodeDragState | undefined>(undefined);
		const interacting = vendor.useRef(false);
		const [guides, setGuides] = vendor.useState<readonly IBaseHalfCanvasSnapGuide[]>([]);

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
		const makeNode = vendor.useCallback((card: IBaseHalfCanvasSceneCard, sceneKey: string, structuralEpoch: number, selected = false): BaseHalfCanvasFlowNode => ({
			id: card.path,
			type: 'basehalf-card',
			position: { x: card.x, y: card.y },
			initialWidth: card.width,
			initialHeight: card.height,
			style: { width: card.width, height: card.height },
			data: { card, sceneKey, structuralEpoch, beginResize: beginInteraction, endResize: endInteraction },
			deletable: false,
			selected
		}), [beginInteraction, endInteraction]);

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

		const [edges, setEdges] = vendor.useState<BaseHalfCanvasFlowEdge[]>(() => initialSnapshot.edges.map(edge => makeEdge(edge, initialSnapshot.key, initialSnapshot.structuralEpoch, edge.id === initialSnapshot.selectedEdgeId)));
		const edgesRef = vendor.useRef(edges);
		const setLiveEdges = vendor.useCallback((next: BaseHalfCanvasFlowEdge[]) => {
			edgesRef.current = next;
			setEdges(next);
		}, []);
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
			return true;
		}, [endInteraction, setLiveNodes]);
		const cancelAllInteractions = vendor.useCallback(() => {
			const drag = nodeDragState.current;
			if (drag && !drag.cancelled) {
				drag.cancelled = true;
				if (drag.sceneKey === sceneKeyRef.current && drag.structuralEpoch === structuralEpochRef.current) {
					setLiveNodes(restoreBaseHalfCanvasNodeDragOrigins(nodesRef.current, drag.origins));
				}
			}
			pendingConnection.current.cancel();
			connectionStoreController.current?.cancel();
			resetInteraction();
		}, [resetInteraction, setLiveNodes]);
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
			if (!identityChanged && snapshot.revision < snapshotRef.current.revision) {
				return;
			}
			sceneKeyRef.current = snapshot.key;
			structuralEpochRef.current = snapshot.structuralEpoch;
			snapshotRef.current = snapshot;
			if (identityChanged) {
				pendingGeometry.current.clear();
				pendingEdges.current.clear();
				interactionDepth.current = 0;
				interacting.current = false;
				pendingConnection.current.reset();
				connectionStoreController.current?.cancel();
				nodeDragState.current = undefined;
				setGuides([]);
			}

			const currentNodeById = new Map(nodesRef.current.map(node => [node.id, node]));
			const selectedCards = snapshot.selectedCardPaths ? new Set(snapshot.selectedCardPaths) : undefined;
			const nextNodes = snapshot.cards.map(card => {
				const current = currentNodeById.get(card.path);
				const selected = selectedCards ? selectedCards.has(card.path) : current?.selected ?? false;
				if (!identityChanged && current && pendingGeometry.current.has(card.path)) {
					return {
						...current,
						data: { card, sceneKey: snapshot.key, structuralEpoch: snapshot.structuralEpoch, beginResize: beginInteraction, endResize: endInteraction },
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
				nextEdges.push(makeEdge(projected, snapshot.key, snapshot.structuralEpoch, snapshot.selectedEdgeId ? projected.id === snapshot.selectedEdgeId : current?.selected ?? false));
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
		}, [beginInteraction, endInteraction, makeEdge, makeNode, setLiveEdges, setLiveNodes]);

		const commitFinalGeometry = vendor.useCallback((nextNodes: readonly BaseHalfCanvasFlowNode[], changes: readonly NodeChange<BaseHalfCanvasFlowNode>[]) => {
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
				geometries.push({
					path: id,
					kind: node.data.card.kind,
					x: node.position.x,
					y: node.position.y,
					width: node.width ?? node.measured?.width ?? numericStyle(node.style?.width) ?? node.data.card.width,
					height: node.height ?? node.measured?.height ?? numericStyle(node.style?.height) ?? node.data.card.height
				});
			}
			if (geometries.length === 0 || !operationKey || operationEpoch === undefined) {
				return;
			}
			const token = ++mutationSequence.current;
			for (const geometry of geometries) {
				pendingGeometry.current.set(geometry.path, token);
			}
			void delegate.commitGeometry(operationKey, operationEpoch, geometries).then(() => {
				if (sceneKeyRef.current !== operationKey || structuralEpochRef.current !== operationEpoch) {
					return;
				}
				for (const geometry of geometries) {
					if (pendingGeometry.current.get(geometry.path) === token) {
						pendingGeometry.current.delete(geometry.path);
					}
				}
			}).catch(error => {
				if (sceneKeyRef.current !== operationKey || structuralEpochRef.current !== operationEpoch) {
					return;
				}
				let shouldReconcile = false;
				for (const geometry of geometries) {
					if (pendingGeometry.current.get(geometry.path) === token) {
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

		const onNodesChange = vendor.useCallback((changes: NodeChange<BaseHalfCanvasFlowNode>[]) => {
			const drag = nodeDragState.current;
			const acceptedChanges = drag?.cancelled
				? filterBaseHalfCanvasCancelledNodeDragChanges(changes, drag.origins)
				: changes;
			if (acceptedChanges.length === 0) {
				return;
			}
			const changesGeometry = acceptedChanges.some(change => change.type === 'position' || change.type === 'dimensions');
			if (changesGeometry) {
				const ownerKey = interactionSceneKey.current ?? sceneKeyRef.current;
				const ownerEpoch = interactionStructuralEpoch.current ?? structuralEpochRef.current;
				if (ownerKey !== sceneKeyRef.current || ownerEpoch !== structuralEpochRef.current || acceptedChanges.some(change => {
					if (change.type !== 'position' && change.type !== 'dimensions') {
						return false;
					}
					const data = nodesRef.current.find(node => node.id === change.id)?.data;
					return data?.sceneKey !== ownerKey || data.structuralEpoch !== ownerEpoch;
				})) {
					return;
				}
			}
			const snapped = snapBaseHalfCanvasFlowNodeChanges(nodesRef.current, acceptedChanges, {
				threshold: BASEHALF_CANVAS_SNAP_GUIDE_SCREEN_THRESHOLD / Math.max(0.2, viewportRef.current.zoom),
				defaultWidth: BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH,
				defaultHeight: BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT,
				minWidth: BASEHALF_CANVAS_MIN_CARD_WIDTH,
				minHeight: BASEHALF_CANVAS_MIN_CARD_HEIGHT
			});
			setGuides(current => sameBaseHalfCanvasSnapGuides(current, snapped.guides) ? current : snapped.guides);
			const next = vendor.applyNodeChanges(snapped.changes, nodesRef.current);
			setLiveNodes(next);
			commitFinalGeometry(next, snapped.changes);
		}, [commitFinalGeometry, setLiveNodes]);
		const beginNodeDrag = vendor.useCallback((_event: MouseEvent | TouchEvent, node: BaseHalfCanvasFlowNode, draggedNodes: BaseHalfCanvasFlowNode[]) => {
			const ids = new Set([
				node.id,
				...draggedNodes.map(candidate => candidate.id),
				...nodesRef.current.filter(candidate => candidate.selected).map(candidate => candidate.id)
			]);
			nodeDragState.current = {
				sceneKey: sceneKeyRef.current,
				structuralEpoch: structuralEpochRef.current,
				origins: captureBaseHalfCanvasNodeDragOrigins(nodesRef.current, ids),
				cancelled: false
			};
			beginInteraction();
		}, [beginInteraction]);
		const finishNodeDrag = vendor.useCallback(() => {
			const drag = nodeDragState.current;
			nodeDragState.current = undefined;
			if (!drag?.cancelled) {
				endInteraction();
			}
		}, [endInteraction]);

		const onEdgesChange = vendor.useCallback((changes: EdgeChange<BaseHalfCanvasFlowEdge>[]) => {
			setLiveEdges(vendor.applyEdgeChanges(changes, edgesRef.current));
		}, [setLiveEdges]);

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
			if (hit?.closest('.react-flow__node, .react-flow__edge')) {
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
			}, false, flow.screenToFlowPosition(client));
			if (drop) {
				void delegate.createFromConnection(operationKey, operationEpoch, drop).catch(error => delegate.reportError(error));
			}
		}, [endInteraction]);
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
				setLiveNodes(nodesRef.current.map(candidate => ({ ...candidate, selected: false })));
				setLiveEdges(edgesRef.current.map(candidate => ({ ...candidate, selected: candidate.id === flowEdge.id })));
			},
			reconnect: optimisticReconnect,
			remove(flowEdge): void {
				if (!ownsCurrentEdge(flowEdge)) {
					return;
				}
				setLiveEdges(edgesRef.current.filter(candidate => candidate.id !== flowEdge.id));
				removeEdges([flowEdge]);
			}
		}), [beginInteraction, endInteraction, optimisticReconnect, ownsCurrentEdge, removeEdges, setLiveEdges, setLiveNodes]);

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
				const toolbarOwnsFocus = !!target.closest('.basehalf-canvas-selection-toolbar');
				const focusedSelectedEdge = baseHalfCanvasTargetOwnsSelectedEdgeShortcuts(target);
				if (!toolbarOwnsFocus && !focusedSelectedEdge && baseHalfCanvasTargetBlocksGraphShortcuts(target)) {
					return;
				}
				const selectedNodes = nodesRef.current.filter(node => node.selected);
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
			host.addEventListener('keydown', onKeyDown);
			return () => host.removeEventListener('keydown', onKeyDown);
		}, [invokeSelectionAction, removeEdges, setLiveEdges]);

		const reportViewport = vendor.useCallback((sceneKey: string, viewport: Viewport, final: boolean) => {
			if (sceneKeyRef.current !== sceneKey) {
				return;
			}
			const next = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
			viewportRef.current = next;
			onViewport(next);
			delegate.reportViewport(sceneKey, next, final);
		}, []);

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
				} finally {
					if (viewportCommandKey.current === operationKey) {
						viewportCommandKey.current = undefined;
					}
				}
			});
			viewportCommandQueue.current = queued;
			await queued;
		}, []);

		const runtime = vendor.useMemo<IBaseHalfCanvasSceneRuntime>(() => ({
			update: updateSnapshot,
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
				await runViewportCommand(async () => {
					await flow.fitView({
						nodes: fitNodes,
						padding: options?.padding ?? 0.12,
						maxZoom: options?.maxZoom,
						duration: 0
					});
				});
			},
			async reveal(path: string): Promise<void> {
				const node = nodesRef.current.find(candidate => candidate.id === path);
				if (node) {
					await runViewportCommand(async () => {
						await flowRef.current?.fitView({ nodes: [node], padding: 0.18, maxZoom: viewportRef.current.zoom, duration: 0 });
					});
				}
			},
			screenToCanvasPosition(x: number, y: number): { readonly x: number; readonly y: number } {
				return flowRef.current?.screenToFlowPosition({ x, y }) ?? { x, y };
			},
			select(selection: IBaseHalfCanvasSceneSelection): void {
				const selectedCards = new Set(selection.cardPaths ?? []);
				setLiveNodes(nodesRef.current.map(node => ({ ...node, selected: selectedCards.has(node.id) })));
				setLiveEdges(edgesRef.current.map(edge => ({ ...edge, selected: selection.edgeId === edge.id })));
			},
			getViewport: () => viewportRef.current,
			isInteracting: () => interacting.current
		}), [runViewportCommand, setLiveEdges, setLiveNodes, updateSnapshot]);

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
			setLiveNodes(nodesRef.current.map(candidate => ({ ...candidate, selected: candidate.id === node.id })));
			setLiveEdges(edgesRef.current.map(candidate => ({ ...candidate, selected: false })));
			showContextMenu({
				kind: 'card',
				path: node.id,
				anchor: contextMenuAnchor(event, node.data.card.element)
			});
		}, [contextMenuAnchor, setLiveEdges, setLiveNodes, showContextMenu]);
		const onEdgeContextMenu = vendor.useCallback((event: ReactMouseEvent<Element>, flowEdge: BaseHalfCanvasFlowEdge) => {
			const edge = flowEdge.data?.edge;
			if (!edge) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			host.focus({ preventScroll: true });
			setLiveNodes(nodesRef.current.map(candidate => ({ ...candidate, selected: false })));
			setLiveEdges(edgesRef.current.map(candidate => ({ ...candidate, selected: candidate.id === flowEdge.id })));
			showContextMenu({
				kind: 'edge',
				edge,
				anchor: contextMenuAnchor(event, host)
			});
		}, [contextMenuAnchor, setLiveEdges, setLiveNodes, showContextMenu]);
		const onPaneContextMenu = vendor.useCallback((event: globalThis.MouseEvent | ReactMouseEvent<Element>) => {
			event.preventDefault();
			event.stopPropagation();
			host.focus({ preventScroll: true });
			setLiveNodes(nodesRef.current.map(candidate => ({ ...candidate, selected: false })));
			setLiveEdges(edgesRef.current.map(candidate => ({ ...candidate, selected: false })));
			showContextMenu({
				kind: 'pane',
				anchor: contextMenuAnchor(event, host)
			});
		}, [contextMenuAnchor, setLiveEdges, setLiveNodes, showContextMenu]);
		const onNodeClick = vendor.useCallback((event: ReactMouseEvent<Element>, node: BaseHalfCanvasFlowNode) => {
			if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || isDirectCardControl(event.target)) {
				return;
			}
			delegate.activateCard(node.data.sceneKey, node.data.structuralEpoch, node.id);
		}, []);
		const onNodeDoubleClick = vendor.useCallback((event: ReactMouseEvent<Element>, node: BaseHalfCanvasFlowNode) => {
			if (isDirectCardControl(event.target)) {
				return;
			}
			delegate.openCard(node.data.sceneKey, node.data.structuralEpoch, node.id);
		}, []);
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
			setLiveNodes(nodesRef.current.map(candidate => ({ ...candidate, selected: false })));
			setLiveEdges(edgesRef.current.map(candidate => ({ ...candidate, selected: false })));
			delegate.showCreateMenu(sceneKeyRef.current, structuralEpochRef.current, {
				x: event.clientX,
				y: event.clientY
			});
			host.focus({ preventScroll: true });
		}, [setLiveEdges, setLiveNodes]);
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
			onSelectionStart: beginInteraction,
			onSelectionEnd: endInteraction,
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
				host.focus({ preventScroll: true });
			},
			onEdgeClick: () => host.focus({ preventScroll: true }),
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
			connectOnClick: true,
			connectionRadius: 48,
			edgesReconnectable: false,
			deleteKeyCode: null,
			minZoom: BASEHALF_CANVAS_MIN_ZOOM,
			maxZoom: BASEHALF_CANVAS_MAX_ZOOM,
			panOnScroll: true,
			panOnScrollSpeed: 1,
			zoomOnScroll: false,
			zoomOnPinch: true,
			zoomOnDoubleClick: false,
			selectionOnDrag: true,
			selectionMode: vendor.SelectionMode.Partial,
			panOnDrag: [1, 2],
			multiSelectionKeyCode: 'Shift',
			onlyRenderVisibleElements: nodes.length > CANVAS_NODE_CULL_THRESHOLD,
			proOptions: { hideAttribution: true },
			defaultEdgeOptions: { type: 'basehalf-reference', animated: false },
			fitView: false
		};
		const ReactFlowComponent = vendor.ReactFlow as unknown as (props: ReactFlowProps<BaseHalfCanvasFlowNode, BaseHalfCanvasFlowEdge>) => ReactElement;
		const selectedNodes = nodes.filter(node => node.selected);
		return h(EdgeInteractionContext.Provider, { value: edgeInteraction },
			h(SelectionSizeContext.Provider, { value: selectedNodes.length },
				h(ReactFlowComponent, flowProps,
					h(ConnectionStoreBridge, { register: registerConnectionStore }),
					h(vendor.Background, {
						variant: vendor.BackgroundVariant.Lines,
						gap: 40,
						size: 1,
						color: 'color-mix(in srgb, var(--vscode-foreground) 2.5%, transparent)'
					}),
					h(SnapGuides, { guides, zoom: viewportRef.current.zoom }),
					h(SelectionToolbar, { nodes: selectedNodes, invoke: invokeSelectionAction })
				)
			)
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
