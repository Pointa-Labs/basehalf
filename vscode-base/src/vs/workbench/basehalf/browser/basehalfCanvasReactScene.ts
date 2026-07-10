/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { FileAccess } from '../../../base/common/network.js';
import { URI } from '../../../base/common/uri.js';
import {
	BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT,
	BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH,
	BASEHALF_CANVAS_MIN_CARD_HEIGHT,
	BASEHALF_CANVAS_MIN_CARD_WIDTH,
	BaseHalfCanvasAnchor,
	baseHalfCanvasEdgePath
} from '../common/basehalfCanvasModel.js';
import { BASEHALF_CANVAS_MAX_ZOOM, BASEHALF_CANVAS_MIN_ZOOM } from '../common/basehalfConfiguration.js';
import {
	BASEHALF_CANVAS_SNAP_GUIDE_SCREEN_THRESHOLD,
	sameBaseHalfCanvasSnapGuides,
	snapBaseHalfCanvasFlowNodeChanges
} from '../common/basehalfCanvasFlowSnap.js';
import {
	baseHalfCanvasReconnectEndForPath,
	BaseHalfCanvasReconnectHit,
	BaseHalfCanvasEdgeReconnectEnd,
	IBaseHalfCanvasReconnectSnap,
	resolveBaseHalfCanvasReconnectPoint
} from '../common/basehalfCanvasEdgeReconnect.js';
import { IBaseHalfCanvasSnapGuide } from '../common/basehalfCanvasSnap.js';
import {
	IBaseHalfCanvasSceneCard,
	IBaseHalfCanvasSceneConnection,
	IBaseHalfCanvasSceneDelegate,
	IBaseHalfCanvasSceneEdge,
	IBaseHalfCanvasSceneFitOptions,
	IBaseHalfCanvasSceneGeometry,
	IBaseHalfCanvasSceneRenderer,
	IBaseHalfCanvasSceneSelection,
	IBaseHalfCanvasSceneSnapshot,
	IBaseHalfCanvasSceneViewport
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
	ReactFlowInstance,
	ReactFlowProps,
	Viewport
} from '@xyflow/react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react';
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

type BaseHalfCanvasPendingEdgeMutation =
	| { readonly token: number; readonly kind: 'upsert'; readonly edge: IBaseHalfCanvasSceneEdge }
	| { readonly token: number; readonly kind: 'delete' };

type BaseHalfCanvasFlowNode = Node<IBaseHalfCanvasFlowNodeData, 'basehalf-card'>;
type BaseHalfCanvasFlowEdge = Edge<IBaseHalfCanvasFlowEdgeData, 'basehalf-reference'>;

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
	edit(flowEdge: BaseHalfCanvasFlowEdge): void;
}

interface IBaseHalfCanvasSceneRuntime {
	update(snapshot: IBaseHalfCanvasSceneSnapshot): void;
	setZoom(zoom: number): Promise<void>;
	zoomBy(factor: number): Promise<void>;
	setViewportCenter(x: number, y: number, zoom?: number): Promise<void>;
	fit(paths?: readonly string[], options?: IBaseHalfCanvasSceneFitOptions): Promise<void>;
	reveal(path: string): Promise<void>;
	select(selection: IBaseHalfCanvasSceneSelection): void;
	getViewport(): IBaseHalfCanvasSceneViewport;
	isInteracting(): boolean;
}

const CANVAS_REACT_VENDOR_ROOT = 'vs/../../extensions/basehalf/canvas-react-vendor-out';
const CANVAS_REACT_VENDOR_SCRIPT = 'canvasReactVendor.js';
const CANVAS_REACT_VENDOR_STYLES = 'canvasReactVendor.css';
const CARD_LOD_MIN_HEIGHT_PX = 150;
const CARD_LOD_MIN_ZOOM = 0.5;
const MINI_LABEL_MIN_FLOW_PX = 12;
const MINI_LABEL_CARD_HEIGHT_FRACTION = 0.18;
const EDGE_RECONNECT_DRAG_THRESHOLD = 4;
const EDGE_RECONNECT_PATH_SAMPLES = 80;
const EDGE_RECONNECT_CURSOR_CLASS = 'basehalf-canvas-edge-reconnecting';

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

	function CardNode({ id, data, selected }: NodeProps<BaseHalfCanvasFlowNode>): ReactElement {
		const hostRef = vendor.useRef<HTMLDivElement>(null);
		const zoom = vendor.useStore(state => state.transform[2]);
		const height = vendor.useStore(state => {
			const node = state.nodeLookup.get(id);
			return node?.measured.height ?? node?.height ?? data.card.height;
		});
		const lod = height < CARD_LOD_MIN_HEIGHT_PX || zoom < CARD_LOD_MIN_ZOOM ? 'mini' : 'full';

		vendor.useLayoutEffect(() => {
			const mount = hostRef.current;
			if (!mount) {
				return;
			}
			mount.replaceChildren(data.card.element);
			return () => {
				if (data.card.element.parentElement === mount) {
					data.card.element.remove();
				}
			};
		}, [data.card.element]);

		vendor.useLayoutEffect(() => {
			const element = data.card.element;
			element.classList.toggle('selected', selected);
			element.dataset.lod = lod;
			element.dataset.cardHeight = String(height);
			element.style.setProperty('--bh-mini-label-cap', `${Math.round(Math.max(MINI_LABEL_MIN_FLOW_PX, height * MINI_LABEL_CARD_HEIGHT_FRACTION))}px`);
		}, [data.card.element, height, lod, selected]);

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
				isConnectable: true
			})),
			h('div', {
				ref: hostRef,
				className: 'basehalf-canvas-card-host',
				style: { width: '100%', height: '100%' }
			})
		);
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

				const hit = snapForPointer(event);
				if (hit.kind === 'invalid-card') {
					finishReconnect();
					return;
				}
				if (hit.kind === 'blank') {
					interaction.remove(reconnect.flowEdge);
					finishReconnect();
					return;
				}
				const snapped = hit.snap;
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
				if (event.key !== 'Escape') {
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
		const labelX = (displaySource.x + displayTarget.x) / 2;
		const labelY = (displaySource.y + displayTarget.y) / 2 - 8;
		const active = hover || props.selected || reconnecting;
		const accessibleLabel = edge.label
			? `Edit relationship label “${edge.label}” from ${edge.from} to ${edge.to}`
			: `Add relationship label from ${edge.from} to ${edge.to}`;
		const edit = (event: { preventDefault(): void; stopPropagation(): void }) => {
			event.preventDefault();
			event.stopPropagation();
			// A click sequence can dispatch `dblclick` before React commits the
			// null reconnect state from its second pointerup. The synchronous latch
			// is the gesture authority; render state only draws the preview.
			if (!reconnectInteractionActiveRef.current) {
				interaction.edit(flowEdge);
			}
		};
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
				onPointerDown: beginReconnect,
				onDoubleClick: edit
			}),
			h(vendor.EdgeLabelRenderer, null,
				h('button', {
					type: 'button',
					className: `basehalf-canvas-flow-edge-label nodrag nopan${active ? ' active' : ''}${edge.label ? '' : ' empty'}`,
					'data-edge-id': edge.id,
					style: {
						transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`
					} as CSSProperties,
					onPointerDown: beginReconnect,
					onDoubleClick: edit,
					onFocus: () => interaction.select(flowEdge, true),
					onClick: (event: { detail: number; preventDefault(): void; stopPropagation(): void }) => {
						if (event.detail === 0) {
							edit(event);
						}
					},
					'aria-label': accessibleLabel,
					title: edge.label ?? 'Double-click or press Enter to say why'
				}, edge.label ?? 'Double-click to say why')
		)
		);
	}

	const nodeTypes: NodeTypes = { 'basehalf-card': CardNode };
	const edgeTypes: EdgeTypes = { 'basehalf-reference': ReferenceEdge };

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
		const interactionSceneKey = vendor.useRef<string | undefined>(undefined);
		const interactionStructuralEpoch = vendor.useRef<number | undefined>(undefined);
		const connectSceneKey = vendor.useRef<string | undefined>(undefined);
		const connectStructuralEpoch = vendor.useRef<number | undefined>(undefined);
		const interacting = vendor.useRef(false);
		const [guides, setGuides] = vendor.useState<readonly IBaseHalfCanvasSnapGuide[]>([]);

		const beginInteraction = vendor.useCallback(() => {
			if (interactionDepth.current === 0) {
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
		const cancelInteraction = vendor.useCallback(() => {
			if (!interacting.current) {
				return;
			}
			interactionDepth.current = 0;
			interacting.current = false;
			interactionSceneKey.current = undefined;
			interactionStructuralEpoch.current = undefined;
			connectSceneKey.current = undefined;
			connectStructuralEpoch.current = undefined;
			viewportGestureSceneKey.current = undefined;
			setGuides([]);
			delegate.didEndInteraction();
		}, []);
		vendor.useEffect(() => {
			const window = host.ownerDocument.defaultView;
			if (!window) {
				return;
			}
			let finishTimer: number | undefined;
			const finishSoon = () => {
				if (finishTimer !== undefined) {
					window.clearTimeout(finishTimer);
				}
				finishTimer = window.setTimeout(cancelInteraction, 0);
			};
			window.addEventListener('pointerup', finishSoon, true);
			window.addEventListener('pointercancel', finishSoon, true);
			window.addEventListener('mouseup', finishSoon, true);
			window.addEventListener('touchend', finishSoon, true);
			window.addEventListener('blur', cancelInteraction);
			return () => {
				if (finishTimer !== undefined) {
					window.clearTimeout(finishTimer);
				}
				window.removeEventListener('pointerup', finishSoon, true);
				window.removeEventListener('pointercancel', finishSoon, true);
				window.removeEventListener('mouseup', finishSoon, true);
				window.removeEventListener('touchend', finishSoon, true);
				window.removeEventListener('blur', cancelInteraction);
			};
		}, [cancelInteraction]);

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
				connectSceneKey.current = undefined;
				connectStructuralEpoch.current = undefined;
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
			const changesGeometry = changes.some(change => change.type === 'position' || change.type === 'dimensions');
			if (changesGeometry) {
				const ownerKey = interactionSceneKey.current ?? sceneKeyRef.current;
				const ownerEpoch = interactionStructuralEpoch.current ?? structuralEpochRef.current;
				if (ownerKey !== sceneKeyRef.current || ownerEpoch !== structuralEpochRef.current || changes.some(change => {
					if (change.type !== 'position' && change.type !== 'dimensions') {
						return false;
					}
					const data = nodesRef.current.find(node => node.id === change.id)?.data;
					return data?.sceneKey !== ownerKey || data.structuralEpoch !== ownerEpoch;
				})) {
					return;
				}
			}
			const snapped = snapBaseHalfCanvasFlowNodeChanges(nodesRef.current, changes, {
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

		const onEdgesChange = vendor.useCallback((changes: EdgeChange<BaseHalfCanvasFlowEdge>[]) => {
			setLiveEdges(vendor.applyEdgeChanges(changes, edgesRef.current));
		}, [setLiveEdges]);

		const optimisticConnect = vendor.useCallback((connection: Connection) => {
			if (!connection.source || !connection.target || connection.source === connection.target) {
				return;
			}
			const operationKey = connectSceneKey.current;
			const operationEpoch = connectStructuralEpoch.current;
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

		const optimisticReconnect = vendor.useCallback((flowEdge: BaseHalfCanvasFlowEdge, connection: Connection) => {
			const previous = flowEdge.data?.edge;
			const operationKey = flowEdge.data?.sceneKey;
			const operationEpoch = flowEdge.data?.structuralEpoch;
			if (!previous || !operationKey || operationEpoch === undefined || operationKey !== sceneKeyRef.current || operationEpoch !== structuralEpochRef.current
				|| !connection.source || !connection.target || connection.source === connection.target) {
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
				to_anchor: next.toAnchor,
				...(previous.label !== undefined ? { label: previous.label } : {})
			};
			if (nextEdge.id !== previous.id && edgesRef.current.some(candidate => candidate.id === nextEdge.id)) {
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
				setLiveEdges(edgesRef.current.map(candidate => ({ ...candidate, selected: candidate.id === flowEdge.id })));
			},
			reconnect: optimisticReconnect,
			remove(flowEdge): void {
				if (!ownsCurrentEdge(flowEdge)) {
					return;
				}
				setLiveEdges(edgesRef.current.filter(candidate => candidate.id !== flowEdge.id));
				removeEdges([flowEdge]);
			},
			edit(flowEdge): void {
				if (!ownsCurrentEdge(flowEdge)) {
					return;
				}
				const data = flowEdge.data!;
				void delegate.editEdgeLabel(data.sceneKey, data.structuralEpoch, data.edge).catch(error => delegate.reportError(error));
			}
		}), [beginInteraction, endInteraction, optimisticReconnect, ownsCurrentEdge, removeEdges, setLiveEdges]);

		vendor.useEffect(() => {
			const onKeyDown = (event: KeyboardEvent) => {
				const target = event.target;
				const focusedEdgeLabelId = target instanceof Element && host.contains(target)
					? target.closest<HTMLElement>('.basehalf-canvas-flow-edge-label')?.dataset.edgeId
					: undefined;
				const focusedSelectedEdge = target instanceof Element && host.contains(target) && (
					!!target.closest('.react-flow__edge.selected')
					|| (!!focusedEdgeLabelId && edgesRef.current.some(edge => edge.id === focusedEdgeLabelId && edge.selected))
				);
				if ((event.key !== 'Delete' && event.key !== 'Backspace') || (target !== host && !focusedSelectedEdge)) {
					return;
				}
				if (host.closest('.basehalf-canvas-workbench')?.classList.contains('basehalf-card-detail-open')) {
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
		}, [removeEdges, setLiveEdges]);

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
			select(selection: IBaseHalfCanvasSceneSelection): void {
				const selectedCards = new Set(selection.cardPaths ?? []);
				setLiveNodes(nodesRef.current.map(node => ({ ...node, selected: selectedCards.has(node.id) })));
				setLiveEdges(edgesRef.current.map(edge => ({ ...edge, selected: selection.edgeId === edge.id })));
			},
			getViewport: () => viewportRef.current,
			isInteracting: () => interacting.current
		}), [runViewportCommand, setLiveEdges, setLiveNodes, updateSnapshot]);

		vendor.useEffect(() => ready(runtime), [runtime]);

		const flowProps: ReactFlowProps<BaseHalfCanvasFlowNode, BaseHalfCanvasFlowEdge> = {
			nodes,
			edges,
			nodeTypes,
			edgeTypes,
			onNodesChange,
			onEdgesChange,
			onConnect: optimisticConnect,
			onConnectStart: () => {
				connectSceneKey.current = sceneKeyRef.current;
				connectStructuralEpoch.current = structuralEpochRef.current;
				beginInteraction();
			},
			onConnectEnd: () => {
				connectSceneKey.current = undefined;
				connectStructuralEpoch.current = undefined;
				endInteraction();
			},
			onEdgesDelete: removeEdges,
			onNodeDragStart: beginInteraction,
			onNodeDragStop: endInteraction,
			onSelectionStart: beginInteraction,
			onSelectionEnd: endInteraction,
			onNodeDoubleClick: (_event, node) => delegate.openCard(node.data.sceneKey, node.data.structuralEpoch, node.id),
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
			connectOnClick: false,
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
			onlyRenderVisibleElements: true,
			proOptions: { hideAttribution: true },
			defaultEdgeOptions: { type: 'basehalf-reference', animated: false },
			fitView: false
		};
		const ReactFlowComponent = vendor.ReactFlow as unknown as (props: ReactFlowProps<BaseHalfCanvasFlowNode, BaseHalfCanvasFlowEdge>) => ReactElement;
		return h(EdgeInteractionContext.Provider, { value: edgeInteraction },
			h(ReactFlowComponent, flowProps,
				h(vendor.Background, {
					variant: vendor.BackgroundVariant.Lines,
					gap: 32,
					size: 1,
					color: 'color-mix(in srgb, var(--vscode-foreground) 4%, transparent)'
				}),
				h(SnapGuides, { guides, zoom: viewportRef.current.zoom })
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
