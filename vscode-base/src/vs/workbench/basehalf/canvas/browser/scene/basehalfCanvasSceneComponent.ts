/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { BASEHALF_CANVAS_MAX_ZOOM, BASEHALF_CANVAS_MIN_ZOOM } from '../../../shell/common/basehalfConfiguration.js';
import { IBaseHalfCanvasSnapGuide } from '../../common/basehalfCanvasSnap.js';
import {
	IBaseHalfCanvasSceneCard,
	IBaseHalfCanvasSceneEdge,
	IBaseHalfCanvasSceneSnapshot,
	IBaseHalfCanvasSceneVideoPanelSurface,
	IBaseHalfCanvasSceneViewport,
	baseHalfCanvasSceneSelectionSurface
} from '../../common/basehalfCanvasScene.js';
import type {
	EdgeChange,
	NodeTypes,
	EdgeTypes,
	ReactFlowInstance,
	ReactFlowProps,
	Viewport
} from '@xyflow/react';
import type { ReactElement } from 'react';
import { createBaseHalfCanvasCardNode } from './basehalfCanvasCardNode.js';
import { createBaseHalfCanvasNoteSelectionControls } from './basehalfCanvasNoteSelectionControls.js';
import { createBaseHalfCanvasReferenceEdge } from './basehalfCanvasReferenceEdge.js';
import { useBaseHalfCanvasSceneCancellation } from './basehalfCanvasSceneCancellation.js';
import { BaseHalfCanvasPendingConnectionState, BaseHalfCanvasPendingEdgeMutation, IBaseHalfCanvasDropLine, useBaseHalfCanvasSceneConnections } from './basehalfCanvasSceneConnections.js';
import { useBaseHalfCanvasSceneFolderDrop } from './basehalfCanvasSceneFolderDrop.js';
import { baseHalfCanvasSceneNodeSize, IBaseHalfCanvasPendingGeometry, useBaseHalfCanvasSceneGeometry } from './basehalfCanvasSceneGeometry.js';
import { CANVAS_GRAPH_CONTROL_SELECTOR, useBaseHalfCanvasSceneKeyboard } from './basehalfCanvasSceneKeyboard.js';
import { useBaseHalfCanvasSceneMouse } from './basehalfCanvasSceneMouse.js';
import { captureBaseHalfCanvasNodeDragOrigins, IBaseHalfCanvasNodeDragState } from './basehalfCanvasSceneNodeDrag.js';
import { createBaseHalfCanvasSceneOverlays } from './basehalfCanvasSceneOverlays.js';
import { useBaseHalfCanvasScenePressGesture } from './basehalfCanvasScenePressGesture.js';
import { useBaseHalfCanvasSceneRuntime } from './basehalfCanvasSceneRuntime.js';
import { BaseHalfCanvasSelectionIntentCoordinator, IBaseHalfCanvasPendingSelectionChanges, IBaseHalfCanvasPendingSelectionRequest, useBaseHalfCanvasSceneSelection } from './basehalfCanvasSceneSelection.js';
import {
	BaseHalfCanvasFlowEdge,
	BaseHalfCanvasFlowNode,
	baseHalfCanvasSceneVideoInputPickGesturePolicy,
	IBaseHalfCanvasConnectionStoreController,
	IBaseHalfCanvasSceneEnvironment,
	IBaseHalfCanvasSceneRuntime,
	IBaseHalfCanvasVideoPanelFollow
} from './basehalfCanvasSceneShared.js';
import { useBaseHalfCanvasSceneSnapshot } from './basehalfCanvasSceneSnapshot.js';
import { createBaseHalfCanvasSelectionToolbar } from './basehalfCanvasSelectionToolbar.js';
import { createBaseHalfCanvasVideoSelectionControls } from './basehalfCanvasVideoSelectionControls.js';

const CANVAS_NODE_CULL_THRESHOLD = 100;

/**
 * Makes the scene's root component for one mount: React Flow with the cards,
 * connections, and the controls of the selection. It makes the other parts of
 * the scene first, once, so that React keeps them between renders.
 */
export function createBaseHalfCanvasSceneComponent(environment: IBaseHalfCanvasSceneEnvironment) {
	const { vendor, h, host, delegate, onViewport, EdgeInteractionContext, SelectionSizeContext } = environment;

	// The parts of the scene, made once for this mount (README.md in this folder).
	const CardNode = createBaseHalfCanvasCardNode(environment);
	const ReferenceEdge = createBaseHalfCanvasReferenceEdge(environment);
	const nodeTypes: NodeTypes = { 'basehalf-card': CardNode };
	const edgeTypes: EdgeTypes = { 'basehalf-reference': ReferenceEdge };
	const { SelectionToolbar, SetBox } = createBaseHalfCanvasSelectionToolbar(environment);
	const { VideoSelectionControls, VideoPanelAdjacentSurface } = createBaseHalfCanvasVideoSelectionControls(environment);
	const NoteSelectionControls = createBaseHalfCanvasNoteSelectionControls(environment);
	const { ConnectionStoreBridge, ConnectCaptureLayer, ConnectionDropLine, SnapGuides } = createBaseHalfCanvasSceneOverlays(environment);

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
		const pendingGeometry = vendor.useRef(new Map<string, IBaseHalfCanvasPendingGeometry>());
		const pendingEdges = vendor.useRef(new Map<string, BaseHalfCanvasPendingEdgeMutation>());
		const pendingSelectionChanges = vendor.useRef<IBaseHalfCanvasPendingSelectionChanges>({
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
		const pendingSelectionRequest = vendor.useRef<IBaseHalfCanvasPendingSelectionRequest | undefined>(undefined);
		const lastPaneConnectionCancellationAt = vendor.useRef<number | undefined>(undefined);
		const paneDoubleClickStartedOnPane = vendor.useRef(false);
		const connectionStoreController = vendor.useRef<IBaseHalfCanvasConnectionStoreController | undefined>(undefined);
		const nodeDragState = vendor.useRef<IBaseHalfCanvasNodeDragState | undefined>(undefined);
		const nodeDragSelectionAtPointerDown = vendor.useRef<{ readonly primaryPath: string; readonly selection: readonly string[] } | undefined>(undefined);
		const nodeDragToken = vendor.useRef(0);
		const nodeDragChromeToken = vendor.useRef<number | undefined>(undefined);
		// Cards let go on a folder, hidden until their items have moved.
		const droppedPaths = vendor.useRef(new Set<string>());
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
		const [videoPanelFollow, setVideoPanelFollow] = vendor.useState<IBaseHalfCanvasVideoPanelFollow | undefined>(undefined);
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

		const [edges, setEdges] = vendor.useState<BaseHalfCanvasFlowEdge[]>(() => initialSnapshot.edges.map(edge => makeEdge(edge, initialSnapshot.key, initialSnapshot.structuralEpoch, initialSnapshot.selectedEdgeIds?.includes(edge.id) ?? false)));
		const edgesRef = vendor.useRef(edges);
		const setLiveEdges = vendor.useCallback((next: BaseHalfCanvasFlowEdge[]) => {
			edgesRef.current = next;
			setEdges(next);
		}, []);

		const { requestSelection, queueSelectionChanges } = useBaseHalfCanvasSceneSelection(environment, {
			sceneKeyRef, structuralEpochRef, pendingSelectionChanges, selectionIntents,
			pendingSelectionRequest, nodesRef, setLiveNodes, edgesRef, setLiveEdges
		});

		const registerConnectionStore = vendor.useCallback((controller: IBaseHalfCanvasConnectionStoreController | undefined) => {
			connectionStoreController.current = controller;
		}, []);

		const { cancelPendingConnection, cancelNodeDrag } = useBaseHalfCanvasSceneCancellation(environment, {
			sceneKeyRef, structuralEpochRef, viewportGestureSceneKey, interactionDepth,
			interactionGeneration, interactionSceneKey, interactionStructuralEpoch,
			pendingConnection, connectionStoreController, nodeDragState, interacting, setGuides,
			revealNodeDragChrome, endInteraction, nodesRef, setLiveNodes, requestSelection
		});

		const { updateSnapshot } = useBaseHalfCanvasSceneSnapshot(environment, {
			snapshotRef, sceneKeyRef, structuralEpochRef, pendingGeometry, pendingEdges,
			pendingSelectionChanges, interactionDepth, pendingConnection, selectionIntents,
			pendingSelectionRequest, connectionStoreController, nodeDragState, droppedPaths,
			keyboardGeometryTimer, keyboardGeometryInteractionActive, keyboardGeometryPath,
			keyboardGeometryPosition, interacting, setGuides, setVideoPanelFollow,
			revealNodeDragChrome, beginNodeResize, endNodeResize, makeNode, makeEdge, nodesRef,
			setLiveNodes, edgesRef, setLiveEdges
		});

		const { applyNodesChange, onNodesChange } = useBaseHalfCanvasSceneGeometry(environment, {
			snapshotRef, sceneKeyRef, structuralEpochRef, mutationSequence, viewportRef,
			pendingGeometry, interactionSceneKey, interactionStructuralEpoch, nodeDragState,
			snapEnabledRef, setGuides, nodesRef, setLiveNodes, queueSelectionChanges,
			updateSnapshot
		});

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

		const { autoPanOnNodeDrag, followNodeDrag, followSetMove, releaseDrop } = useBaseHalfCanvasSceneFolderDrop(environment, {
			sceneKeyRef, flowRef, nodeDragState, droppedPaths, nodesRef, setLiveNodes,
			endInteraction, revealNodeDragChrome, cancelNodeDrag
		});

		const { toggleSetCardAt, arrangeSet, followSceneGesture } = useBaseHalfCanvasScenePressGesture(environment, {
			sceneKeyRef, structuralEpochRef, flowRef, selectionIntents, pendingSelectionRequest,
			connectionStoreController, nodeDragState, nodeDragToken, suppressNodeDragChrome,
			settleNodeDragChrome, revealNodeDragChrome, beginInteraction, endInteraction, nodesRef,
			edgesRef, requestSelection, applyNodesChange, reportViewport, followSetMove, releaseDrop
		});

		const { beginConnection, optimisticConnect, finishPointerConnect, finishClickConnect, removeEdges, edgeInteraction } = useBaseHalfCanvasSceneConnections(environment, {
			snapshotRef, sceneKeyRef, structuralEpochRef, mutationSequence, flowRef, pendingEdges,
			pendingConnection, connectionStoreController, dropLine, setDropLine, dropLineToken,
			dropLineElement, beginInteraction, endInteraction, makeEdge, nodesRef, edges, edgesRef,
			setLiveEdges, requestSelection, updateSnapshot
		});

		const { invokeSelectionAction } = useBaseHalfCanvasSceneKeyboard(environment, {
			sceneKeyRef, structuralEpochRef, videoPanelFollowToken, keyboardGeometryTimer,
			keyboardGeometryInteractionActive, keyboardGeometryPath, keyboardGeometryPosition,
			videoPanelFollow, setVideoPanelFollow, beginInteraction, endInteraction, nodesRef,
			edgesRef, setLiveEdges, applyNodesChange, removeEdges
		});

		useBaseHalfCanvasSceneRuntime(environment, {
			ready, sceneKeyRef, viewportRef, flowRef, viewportCommandKey, viewportCommandQueue,
			interacting, snapEnabledRef, setGuides, setVideoPanelSurfaceState, nodesRef,
			requestSelection, updateSnapshot, reportViewport
		});

		const { onNodeContextMenu, onEdgeContextMenu, onPaneContextMenu, onNodeClick, onNodeDoubleClick } = useBaseHalfCanvasSceneMouse(environment, {
			sceneKeyRef, structuralEpochRef, viewportRef, lastPaneConnectionCancellationAt,
			paneDoubleClickStartedOnPane, nodesRef, edgesRef, requestSelection
		});

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
			onNodeDrag: followNodeDrag,
			onNodeDragStop: finishNodeDrag,
			// Near its edge, only while the pointer is inside it (dropping into a folder).
			autoPanOnNodeDrag,
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
				void requestSelection({ edgeIds: [edge.id] });
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
		// The panel stays under its card until the workbench replaces it or takes it away, also in the
		// frames between a new selection and the panel that follows it, so that none is without one (D91).
		const videoPanelNode = videoPanelSurface
			&& videoPanelSurface.sceneKey === sceneKeyRef.current
			&& videoPanelSurface.structuralEpoch === structuralEpochRef.current
				? nodes.find(node => node.id === videoPanelSurface.path)
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

	return SceneComponent;
}
