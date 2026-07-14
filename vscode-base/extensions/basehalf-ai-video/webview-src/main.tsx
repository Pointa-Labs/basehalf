/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-no-unexternalized-strings -- This bundled official-plugin webview does not load the workbench localization runtime. */

import {
	Background,
	BackgroundVariant,
	BaseEdge,
	applyNodeChanges,
	ConnectionMode,
	ConnectionLineType,
	Handle,
	MarkerType,
	MiniMap,
	NodeResizeControl,
	Position,
	ReactFlow,
	ReactFlowProvider,
	SelectionMode,
	useReactFlow,
	ViewportPortal,
	type Connection,
	type ConnectionLineComponentProps,
	type Edge,
	type EdgeProps,
	type EdgeTypes,
	type FinalConnectionState,
	type Node,
	type NodeChange,
	type NodeProps,
	type NodeTypes,
	type ReactFlowInstance,
	type Viewport
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import { StrictMode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from 'react';
import { createRoot } from 'react-dom/client';
import {
	AI_TEXT_NODE_DEFAULT_HEIGHT,
	AI_TEXT_NODE_DEFAULT_WIDTH,
	AI_TEXT_NODE_MAX_HEIGHT,
	AI_TEXT_NODE_MAX_WIDTH,
	AI_TEXT_NODE_MIN_HEIGHT,
	AI_TEXT_NODE_MIN_WIDTH,
	createId,
	createMediaNode,
	createShotGroup,
	createWorkflowEdgeId,
	connectWorkflowNodes,
	invalidateDownstreamNodes,
	insertWorkflowNodeOnEdge,
	isExecutableNode,
	mediaKindLabel,
	nodeById,
	nodePrompt,
	nodeReadiness,
	selectedOutputPaths,
	selectedRun,
	oppositeWorkflowAnchor,
	validateWorkflowConnection,
	workflowIntermediateKindsForConnection,
	workflowTargetKindsForSource,
	type AIProject,
	type AIMediaProviderOption,
	type AIProjectAudioNode,
	type AIProjectExecutableNode,
	type AIProjectImageNode,
	type AIProjectMediaKind,
	type AIProjectNode,
	type AIProjectShotGroup,
	type AIProjectTextNode,
	type AITextModelServiceOption,
	type AIProjectVideoNode,
	type AIProjectWorkflowAnchor,
	type AIProjectWorkflowPosition
} from '../src/model';
import './styles.css';
import {
	clampWorkflowCanvasOverlay,
	WORKFLOW_CANVAS_SNAP_SCREEN_THRESHOLD,
	snapWorkflowCanvasNodeChanges,
	workflowCanvasConnectionPath,
	type WorkflowCanvasNodeFrame,
	type WorkflowCanvasSnapGuide
} from './workflowCanvasInteraction';

interface InitialState {
	readonly project: AIProject;
	readonly revision: string;
	readonly providers: readonly AIMediaProviderOption[];
	readonly textModelServices: readonly AITextModelServiceOption[];
	readonly mediaUris: Readonly<Record<string, string>>;
}

interface PersistedCanvasState {
	readonly viewport?: Viewport;
	readonly focusedVideoId?: string;
}

interface CanvasContextMenuState {
	readonly left: number;
	readonly top: number;
	readonly flowPosition: AIProjectWorkflowPosition;
	readonly mode: 'quick' | 'context' | 'connect' | 'insert';
	readonly sourceNodeId?: string;
	readonly sourceAnchor?: AIProjectWorkflowAnchor;
	readonly targetNodeId?: string;
	readonly edgeId?: string;
}

interface CanvasNodeContextMenuState {
	readonly left: number;
	readonly top: number;
	readonly nodeId: string;
}

interface CanvasEdgeContextMenuState {
	readonly left: number;
	readonly top: number;
	readonly edgeId: string;
}

interface MediaNodeData extends Record<string, unknown> {
	readonly project: AIProject;
	readonly providers: readonly AIMediaProviderOption[];
	readonly textModelServices: readonly AITextModelServiceOption[];
	readonly node: AIProjectNode;
	readonly readiness: string;
	readonly summary: string;
	readonly previewUri?: string;
	readonly previewUris?: readonly string[];
	readonly previewKind?: AIProjectMediaKind;
	readonly canRun: boolean;
	readonly isRunning: boolean;
	readonly locked: boolean;
	readonly showActions: boolean;
	readonly textEditing: boolean;
	readonly detailView?: NodeDetailView;
	readonly editProject: (mutation: ProjectMutation) => void;
	readonly onShowComposer: (nodeId: string) => void;
	readonly onShowDetail: (nodeId: string, view: NodeDetailView) => void;
	readonly onImportFiles: (nodeId: string) => void;
	readonly onAddToSequence: (nodeId: string) => void;
	readonly onOpenOutput: (path: string) => void;
	readonly onRun: (nodeId: string) => void;
	readonly onRunText: (nodeId: string, instruction: string, serviceId: string) => void;
	readonly onConfigureTextModel: () => void;
	readonly onTextDraftChange: () => void;
	readonly onFinishTextEditing: () => void;
	readonly onCancel: () => void;
}

interface GroupNodeData extends Record<string, unknown> {
	readonly group: AIProjectShotGroup;
}

interface WorkflowEdgeData extends Record<string, unknown> {
	readonly onInsert: (edgeId: string, clientX: number, clientY: number) => void;
	readonly actionPosition?: AIProjectWorkflowPosition;
}

type MediaFlowNode = Node<MediaNodeData, 'media'>;
type GroupFlowNode = Node<GroupNodeData, 'shotGroup'>;
type WorkflowFlowNode = MediaFlowNode | GroupFlowNode;
type WorkflowFlowEdge = Edge<WorkflowEdgeData, 'workflow'>;
type ProjectMutation = (project: AIProject) => void;
type StatusTone = 'normal' | 'running' | 'error';
type NodeDetailView = 'settings' | 'runs';

interface ActiveNodeDetail {
	readonly nodeId: string;
	readonly view: NodeDetailView;
}

interface SelectedEdgeAction {
	readonly edgeId: string;
	readonly position: AIProjectWorkflowPosition;
}

const vscode = acquireVsCodeApi<PersistedCanvasState>();
const rootElement = document.getElementById('root');
if (!rootElement) {
	throw new Error('AI Video workflow root is missing.');
}
const initialState = JSON.parse(rootElement.dataset.initialState ?? '') as InitialState;
const persistedCanvasState = vscode.getState();
const initialFocusedVideoId = persistedCanvasState?.focusedVideoId && initialState.project.sequence.some(item => item.videoNodeId === persistedCanvasState.focusedVideoId)
	? persistedCanvasState.focusedVideoId
	: initialState.project.sequence[0]?.videoNodeId;
const mediaKinds: readonly AIProjectMediaKind[] = ['text', 'image', 'video', 'audio'];
const workflowAnchors: readonly AIProjectWorkflowAnchor[] = ['north', 'east', 'south', 'west'];
const workflowAnchorPositions: Readonly<Record<AIProjectWorkflowAnchor, Position>> = {
	north: Position.Top,
	east: Position.Right,
	south: Position.Bottom,
	west: Position.Left
};
const nodeTypes: NodeTypes = { media: MediaNodeCard, shotGroup: ShotGroupCard };
const edgeTypes: EdgeTypes = { workflow: WorkflowEdge };

function App(): JSX.Element {
	return <ReactFlowProvider><WorkflowEditor /></ReactFlowProvider>;
}

function WorkflowEditor(): JSX.Element {
	const [project, setProject] = useState<AIProject>(initialState.project);
	const [revision, setRevision] = useState(initialState.revision);
	const [providers, setProviders] = useState<readonly AIMediaProviderOption[]>(initialState.providers);
	const [textModelServices, setTextModelServices] = useState<readonly AITextModelServiceOption[]>(initialState.textModelServices ?? []);
	const [mediaUris, setMediaUris] = useState<Readonly<Record<string, string>>>(initialState.mediaUris);
	const [dirty, setDirty] = useState(false);
	const [runningNodeId, setRunningNodeId] = useState<string>();
	const [status, setStatus] = useState<{ label: string; tone: StatusTone }>({ label: 'Saved locally', tone: 'normal' });
	const [banner, setBanner] = useState<{ message: string; action?: 'reload' }>();
	const [notice, setNotice] = useState<string>();
	const [selectedNodeIds, setSelectedNodeIds] = useState<readonly string[]>([]);
	const [activeNodeControlsId, setActiveNodeControlsId] = useState<string>();
	const [editingTextNodeId, setEditingTextNodeId] = useState<string>();
	const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
	const [selectedEdgeAction, setSelectedEdgeAction] = useState<SelectedEdgeAction>();
	const [focusedVideoId, setFocusedVideoId] = useState<string | undefined>(initialFocusedVideoId);
	const [addMenuOpen, setAddMenuOpen] = useState(false);
	const [contextAddMenu, setContextAddMenu] = useState<CanvasContextMenuState>();
	const [contextNodeMenu, setContextNodeMenu] = useState<CanvasNodeContextMenuState>();
	const [contextEdgeMenu, setContextEdgeMenu] = useState<CanvasEdgeContextMenuState>();
	const [activeNodeDetail, setActiveNodeDetail] = useState<ActiveNodeDetail>();
	const [nodeSearchOpen, setNodeSearchOpen] = useState(false);
	const [sequencePreviewOpen, setSequencePreviewOpen] = useState(false);
	const [canvasZoom, setCanvasZoom] = useState(validViewport(persistedCanvasState?.viewport)?.zoom ?? 1);
	const [past, setPast] = useState<AIProject[]>([]);
	const [future, setFuture] = useState<AIProject[]>([]);
	const canvasRef = useRef<HTMLDivElement>(null);
	const projectRef = useRef(project);
	const revisionRef = useRef(revision);
	const dirtyRef = useRef(dirty);
	const saveSnapshotRef = useRef('');
	const initialViewportSetRef = useRef(false);
	const initialViewportFrameRef = useRef<number | undefined>(undefined);
	const suppressNextPaneClickRef = useRef(false);
	const suppressNextNodeClickRef = useRef(false);
	const reactFlow = useReactFlow<WorkflowFlowNode, WorkflowFlowEdge>();
	const running = runningNodeId !== undefined;
	const locked = running;
	projectRef.current = project;
	revisionRef.current = revision;
	dirtyRef.current = dirty;

	const updateDirty = useCallback((value: boolean): void => {
		dirtyRef.current = value;
		setDirty(value);
		setStatus(value ? { label: 'Unsaved changes', tone: 'normal' } : { label: 'Saved locally', tone: 'normal' });
		vscode.postMessage({ type: 'dirty', dirty: value });
	}, []);

	const editProject = useCallback((mutation: ProjectMutation): void => {
		if (locked) {
			return;
		}
		setProject(current => {
			setPast(history => [...history.slice(-79), structuredClone(current)]);
			setFuture([]);
			const next = structuredClone(current);
			mutation(next);
			return next;
		});
		if (!dirtyRef.current) {
			updateDirty(true);
		}
	}, [locked, updateDirty]);
	const markTextDraftChanged = useCallback((): void => {
		if (!dirtyRef.current) {
			updateDirty(true);
		}
	}, [updateDirty]);

	const showNodeDetail = useCallback((nodeId: string, view: NodeDetailView): void => {
		setActiveNodeDetail(current => current?.nodeId === nodeId && current.view === view ? undefined : { nodeId, view });
	}, []);
	const showNodeComposer = useCallback((_nodeId: string): void => {
		setActiveNodeDetail(undefined);
	}, []);

	const importFiles = useCallback((nodeId: string): void => {
		vscode.postMessage({ type: 'importFiles', project: projectRef.current, revision: revisionRef.current, nodeId });
	}, []);

	const addToSequence = useCallback((nodeId: string): void => {
		editProject(next => {
			if (nodeById(next, nodeId)?.kind === 'video' && !next.sequence.some(item => item.videoNodeId === nodeId)) {
				next.sequence.push({ id: createId('sequence'), videoNodeId: nodeId });
			}
		});
	}, [editProject]);

	const openOutput = useCallback((path: string): void => {
		vscode.postMessage({ type: 'openOutput', path });
	}, []);

	const save = useCallback((): void => {
		if (!dirtyRef.current || locked) {
			return;
		}
		saveSnapshotRef.current = JSON.stringify(projectRef.current);
		setStatus({ label: 'Saving locally', tone: 'running' });
		vscode.postMessage({ type: 'save', project: projectRef.current, revision: revisionRef.current });
	}, [locked]);

	useEffect(() => {
		if (!dirty || locked || editingTextNodeId !== undefined) {
			return;
		}
		const handle = window.setTimeout(save, 700);
		return () => window.clearTimeout(handle);
	}, [dirty, editingTextNodeId, locked, project, save]);

	const undo = useCallback((): void => {
		setPast(history => {
			const previous = history.at(-1);
			if (!previous) {
				return history;
			}
			setFuture(items => [structuredClone(projectRef.current), ...items].slice(0, 80));
			setProject(structuredClone(previous));
			updateDirty(true);
			return history.slice(0, -1);
		});
	}, [updateDirty]);

	const redo = useCallback((): void => {
		setFuture(items => {
			const next = items[0];
			if (!next) {
				return items;
			}
			setPast(history => [...history.slice(-79), structuredClone(projectRef.current)]);
			setProject(structuredClone(next));
			updateDirty(true);
			return items.slice(1);
		});
	}, [updateDirty]);

	const runNode = useCallback((nodeId: string): void => {
		setContextNodeMenu(undefined);
		setContextEdgeMenu(undefined);
		setActiveNodeDetail(undefined);
		setRunningNodeId(nodeId);
		setStatus({ label: 'Starting run', tone: 'running' });
		vscode.postMessage({ type: 'runNode', project: projectRef.current, revision: revisionRef.current, nodeId });
	}, []);

	const runTextNode = useCallback((nodeId: string, instruction: string, serviceId: string): void => {
		setContextNodeMenu(undefined);
		setContextEdgeMenu(undefined);
		setRunningNodeId(nodeId);
		setStatus({ label: 'Starting text generation', tone: 'running' });
		vscode.postMessage({ type: 'runTextNode', project: projectRef.current, revision: revisionRef.current, nodeId, instruction, serviceId });
	}, []);

	const configureTextModel = useCallback((): void => {
		vscode.postMessage({ type: 'configureTextModel' });
	}, []);

	const cancelRun = useCallback((): void => {
		vscode.postMessage({ type: 'cancel' });
	}, []);

	useEffect(() => {
		const listener = (event: MessageEvent): void => {
			const message = event.data as Record<string, unknown>;
			switch (message.type) {
				case 'saved': {
					setRevision(String(message.revision ?? ''));
					setMediaUris(current => (message.mediaUris as Readonly<Record<string, string>> | undefined) ?? current);
					const unchanged = JSON.stringify(projectRef.current) === saveSnapshotRef.current;
					if (unchanged) {
						updateDirty(false);
					} else {
						setStatus({ label: 'Unsaved changes', tone: 'normal' });
					}
					break;
				}
				case 'project': {
					const incoming = message.project as AIProject;
					setProject(incoming);
					setFocusedVideoId(current => {
						const next = incoming.sequence.some(item => item.videoNodeId === current) ? current : incoming.sequence[0]?.videoNodeId;
						persistCanvasState({ focusedVideoId: next });
						return next;
					});
					setRevision(String(message.revision ?? ''));
					setProviders((message.providers as readonly AIMediaProviderOption[] | undefined) ?? []);
					setTextModelServices((message.textModelServices as readonly AITextModelServiceOption[] | undefined) ?? []);
					setMediaUris((message.mediaUris as Readonly<Record<string, string>> | undefined) ?? {});
					setSelectedNodeIds(current => current.filter(id => incoming.nodes.some(node => node.id === id)));
					setActiveNodeControlsId(current => incoming.nodes.some(node => node.id === current) ? current : undefined);
					setEditingTextNodeId(current => incoming.nodes.some(node => node.id === current && node.kind === 'text') ? current : undefined);
					setSelectedEdgeId(current => incoming.edges.some(edge => edge.id === current) ? current : undefined);
					setActiveNodeDetail(current => incoming.nodes.some(node => node.id === current?.nodeId) ? current : undefined);
					setContextAddMenu(undefined);
					setContextNodeMenu(undefined);
					setContextEdgeMenu(undefined);
					setPast([]);
					setFuture([]);
					updateDirty(false);
					if (message.running !== true) {
						setRunningNodeId(undefined);
					}
					setBanner(undefined);
					break;
				}
				case 'providers':
					setProviders((message.providers as readonly AIMediaProviderOption[] | undefined) ?? []);
					break;
				case 'textModelServices':
					setTextModelServices((message.textModelServices as readonly AITextModelServiceOption[] | undefined) ?? []);
					break;
				case 'running':
					setRunningNodeId(String(message.nodeId ?? 'running'));
					setStatus({ label: String(message.label ?? 'Running'), tone: 'running' });
					break;
				case 'cancelled':
					setRunningNodeId(undefined);
					setStatus({ label: 'Run cancelled', tone: 'normal' });
					break;
				case 'error':
					if (typeof message.revision === 'string') {
						setRevision(message.revision);
					}
					if (message.running !== true) {
						setRunningNodeId(undefined);
					}
					setStatus(message.running === true ? { label: 'Running', tone: 'running' } : { label: 'Action failed', tone: 'error' });
					setBanner({ message: String(message.message ?? 'The workflow action could not be completed.') });
					break;
				case 'externalChange':
					setBanner({ message: 'The Agent or another editor changed this project while local edits were pending.', action: 'reload' });
					break;
			}
		};
		window.addEventListener('message', listener);
		return () => window.removeEventListener('message', listener);
	}, [updateDirty]);

	useEffect(() => {
		const listener = (event: KeyboardEvent): void => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
				event.preventDefault();
				save();
			} else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
				event.preventDefault();
				setNodeSearchOpen(true);
			} else if (!locked && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
				event.preventDefault();
				event.shiftKey ? redo() : undo();
			} else if (event.key === 'Escape') {
				setSelectedNodeIds([]);
				setActiveNodeControlsId(undefined);
				setEditingTextNodeId(undefined);
				setSelectedEdgeId(undefined);
				setAddMenuOpen(false);
				setContextAddMenu(undefined);
				setContextNodeMenu(undefined);
				setContextEdgeMenu(undefined);
				setActiveNodeDetail(undefined);
				setNodeSearchOpen(false);
			}
		};
		window.addEventListener('keydown', listener);
		return () => window.removeEventListener('keydown', listener);
	}, [locked, redo, save, undo]);

	const projectedFlowNodes = useMemo<WorkflowFlowNode[]>(() => {
		const groups: GroupFlowNode[] = project.groups.map(group => ({
			id: group.id,
			type: 'shotGroup',
			position: group.position,
			data: { group },
			style: { width: group.width, height: group.height },
			dragHandle: '.shot-group-drag-handle',
			selectable: false,
			zIndex: -1
		}));
		const nodes: MediaFlowNode[] = project.nodes.map(node => {
			const outputs = isExecutableNode(node) ? selectedOutputPaths(node) : [];
			const previewPaths = outputs.filter(path => isPreviewablePath(path, node.kind));
			const previewUris = previewPaths.map(path => mediaUris[path]).filter((uri): uri is string => Boolean(uri));
			const readiness = nodeReadiness(project, node.id);
			return {
				id: node.id,
				type: 'media',
				className: `kind-${node.kind}`,
				position: node.position,
				...(node.groupId ? { parentId: node.groupId, extent: 'parent' as const } : {}),
				...(node.kind === 'text' ? { style: { width: node.width ?? AI_TEXT_NODE_DEFAULT_WIDTH, height: node.height ?? AI_TEXT_NODE_DEFAULT_HEIGHT } } : {}),
				selected: selectedNodeIds.includes(node.id),
				data: {
					project,
					providers,
					textModelServices,
					node,
					readiness: readiness.label,
					summary: node.kind === 'text' ? node.content : nodePrompt(project, node.id),
					previewUri: previewUris[0],
					previewUris,
					previewKind: previewUris.length ? node.kind : undefined,
					canRun: isExecutableNode(node) && node.source === 'generate' && readiness.ready && !locked,
					isRunning: runningNodeId === node.id,
					locked,
					showActions: selectedNodeIds.length === 1
						&& selectedNodeIds[0] === node.id
						&& activeNodeControlsId === node.id
						&& contextAddMenu === undefined
						&& contextNodeMenu === undefined
						&& contextEdgeMenu === undefined,
					textEditing: editingTextNodeId === node.id,
					detailView: activeNodeDetail?.nodeId === node.id ? activeNodeDetail.view : undefined,
					editProject,
					onShowComposer: showNodeComposer,
					onShowDetail: showNodeDetail,
					onImportFiles: importFiles,
					onAddToSequence: addToSequence,
					onOpenOutput: openOutput,
					onRun: runNode,
					onRunText: runTextNode,
					onConfigureTextModel: configureTextModel,
					onTextDraftChange: markTextDraftChanged,
					onFinishTextEditing: () => setEditingTextNodeId(undefined),
					onCancel: cancelRun
				},
				zIndex: selectedNodeIds.includes(node.id) ? 20 : 2
			};
		});
		return [...groups, ...nodes];
	}, [activeNodeControlsId, activeNodeDetail, addToSequence, cancelRun, configureTextModel, contextAddMenu, contextEdgeMenu, contextNodeMenu, editProject, editingTextNodeId, importFiles, locked, markTextDraftChanged, mediaUris, openOutput, project, providers, runNode, runTextNode, runningNodeId, selectedNodeIds, showNodeComposer, showNodeDetail, textModelServices]);
	const [flowNodes, setFlowNodes] = useState<WorkflowFlowNode[]>(projectedFlowNodes);
	const flowNodesRef = useRef<WorkflowFlowNode[]>(projectedFlowNodes);
	const [snapGuides, setSnapGuides] = useState<readonly WorkflowCanvasSnapGuide[]>([]);
	useEffect(() => {
		const next = reconcileWorkflowFlowNodes(flowNodesRef.current, projectedFlowNodes);
		flowNodesRef.current = next;
		setFlowNodes(next);
	}, [projectedFlowNodes]);
	const openEdgeInsertMenu = useCallback((edgeId: string, clientX: number, clientY: number): void => {
		const edge = projectRef.current.edges.find(candidate => candidate.id === edgeId);
		const bounds = canvasRef.current?.getBoundingClientRect();
		if (!edge || !bounds) {
			return;
		}
		const position = clampWorkflowCanvasOverlay(
			{ x: clientX - bounds.left, y: clientY - bounds.top },
			{ width: 250, height: 270 },
			{ width: bounds.width, height: bounds.height }
		);
		setSelectedNodeIds([]);
		setActiveNodeControlsId(undefined);
		setSelectedEdgeId(edgeId);
		setActiveNodeDetail(undefined);
		setAddMenuOpen(false);
		setContextNodeMenu(undefined);
		setContextEdgeMenu(undefined);
		setNotice(undefined);
		setContextAddMenu({
			left: position.x,
			top: position.y,
			flowPosition: reactFlow.screenToFlowPosition({ x: clientX, y: clientY }),
			mode: 'insert',
			sourceNodeId: edge.source,
			targetNodeId: edge.target,
			edgeId
		});
	}, [reactFlow]);

	const flowEdges = useMemo<WorkflowFlowEdge[]>(() => project.edges.map(edge => ({
		id: edge.id,
		source: edge.source,
		target: edge.target,
		sourceHandle: edge.sourceAnchor,
		targetHandle: edge.targetAnchor,
		type: 'workflow',
		data: { onInsert: openEdgeInsertMenu, actionPosition: selectedEdgeAction?.edgeId === edge.id ? selectedEdgeAction.position : undefined },
		className: 'workflow-edge',
		selected: selectedEdgeId === edge.id,
		animated: edge.target === runningNodeId,
		interactionWidth: 20,
		markerEnd: { type: MarkerType.ArrowClosed },
		ariaLabel: `${nodeById(project, edge.source)?.title ?? edge.source} provides ${edge.media} to ${nodeById(project, edge.target)?.title ?? edge.target}`
	})), [openEdgeInsertMenu, project, runningNodeId, selectedEdgeAction, selectedEdgeId]);

	const viewportCenter = useCallback((): AIProjectWorkflowPosition => {
		const bounds = canvasRef.current?.getBoundingClientRect();
		return bounds ? reactFlow.screenToFlowPosition({ x: bounds.left + bounds.width * 0.5, y: bounds.top + bounds.height * 0.45 }) : { x: 480, y: 260 };
	}, [reactFlow]);

	const addMedia = useCallback((kind: AIProjectMediaKind): void => {
		const menu = contextAddMenu;
		let position = menu?.flowPosition ?? viewportCenter();
		let groupId: string | undefined;
		if (menu?.edgeId) {
			const edge = projectRef.current.edges.find(candidate => candidate.id === menu.edgeId);
			const source = edge ? nodeById(projectRef.current, edge.source) : undefined;
			const target = edge ? nodeById(projectRef.current, edge.target) : undefined;
			if (source?.groupId && source.groupId === target?.groupId) {
				const group = projectRef.current.groups.find(candidate => candidate.id === source.groupId);
				if (group) {
					groupId = group.id;
					position = { x: position.x - group.position.x, y: position.y - group.position.y };
				}
			}
		}
		const node = createMediaNode(kind, position, groupId);
		if (menu?.edgeId) {
			const validationProject = structuredClone(projectRef.current);
			const validation = insertWorkflowNodeOnEdge(validationProject, menu.edgeId, structuredClone(node));
			if (!validation.valid) {
				setNotice(validation.reason ?? 'This node cannot be inserted on the connection.');
				setContextAddMenu(undefined);
				return;
			}
		}
		editProject(next => {
			if (menu?.edgeId) {
				insertWorkflowNodeOnEdge(next, menu.edgeId, node);
			} else {
				next.nodes.push(node);
				if (node.groupId) {
					next.groups.find(group => group.id === node.groupId)?.nodeIds.push(node.id);
				}
			}
			if (!menu?.edgeId && menu?.sourceNodeId) {
				const sourceAnchor = menu.sourceAnchor ?? 'east';
				connectWorkflowNodes(next, menu.sourceNodeId, node.id, sourceAnchor, oppositeWorkflowAnchor(sourceAnchor));
			}
		});
		setSelectedEdgeId(undefined);
		setSelectedNodeIds([node.id]);
		setActiveNodeControlsId(undefined);
		setActiveNodeDetail(undefined);
		setAddMenuOpen(false);
		setContextAddMenu(undefined);
		setContextNodeMenu(undefined);
		setContextEdgeMenu(undefined);
	}, [contextAddMenu, editProject, viewportCenter]);

	const addShot = useCallback((): void => {
		const center = contextAddMenu?.flowPosition ?? viewportCenter();
		const group = createShotGroup(projectRef.current.groups.length + 1, { x: center.x - 860, y: center.y - 250 });
		const storyboard: AIProjectTextNode = { ...createMediaNode('text', { x: 32, y: 82 }, group.id), role: 'storyboard', title: 'Storyboard' };
		const imagePrompt: AIProjectTextNode = { ...createMediaNode('text', { x: 412, y: 82 }, group.id), role: 'imagePrompt', title: 'Image prompt' };
		const image: AIProjectImageNode = { ...createMediaNode('image', { x: 792, y: 82 }, group.id), title: 'Storyboard image' };
		const videoPrompt: AIProjectTextNode = { ...createMediaNode('text', { x: 1070, y: 82 }, group.id), role: 'videoPrompt', title: 'Video prompt' };
		const video: AIProjectVideoNode = { ...createMediaNode('video', { x: 1450, y: 82 }, group.id), title: 'Generated clip' };
		const nodes: AIProjectNode[] = [storyboard, imagePrompt, image, videoPrompt, video];
		group.nodeIds = nodes.map(node => node.id);
		editProject(next => {
			next.groups.push(group);
			next.nodes.push(...nodes);
			for (const [source, target] of [[storyboard.id, imagePrompt.id], [imagePrompt.id, image.id], [storyboard.id, videoPrompt.id], [videoPrompt.id, video.id], [image.id, video.id]]) {
				const sourceNode = nodeById(next, source)!;
				next.edges.push({ id: createWorkflowEdgeId(source, target), source, target, media: sourceNode.kind, sourceAnchor: 'east', targetAnchor: 'west' });
			}
			next.sequence.push({ id: createId('sequence'), videoNodeId: video.id });
		});
		setSelectedNodeIds([storyboard.id]);
		setActiveNodeControlsId(undefined);
		setActiveNodeDetail(undefined);
		setFocusedVideoId(video.id);
		persistCanvasState({ focusedVideoId: video.id });
		setSelectedEdgeId(undefined);
		setAddMenuOpen(false);
		setContextAddMenu(undefined);
		setContextNodeMenu(undefined);
		setContextEdgeMenu(undefined);
	}, [contextAddMenu, editProject, viewportCenter]);

	const removeNodes = useCallback((ids: readonly string[]): void => {
		const removed = new Set(ids);
		const fallbackVideoId = projectRef.current.sequence.find(item => !removed.has(item.videoNodeId))?.videoNodeId;
		editProject(next => {
			next.nodes = next.nodes.filter(node => !removed.has(node.id));
			next.edges = next.edges.filter(edge => !removed.has(edge.source) && !removed.has(edge.target));
			next.sequence = next.sequence.filter(item => !removed.has(item.videoNodeId));
			for (const group of next.groups) {
				group.nodeIds = group.nodeIds.filter(id => !removed.has(id));
			}
			next.groups = next.groups.filter(group => group.nodeIds.length > 0);
		});
		setSelectedNodeIds([]);
		setActiveNodeControlsId(undefined);
		setSelectedEdgeId(undefined);
		setActiveNodeDetail(current => current && removed.has(current.nodeId) ? undefined : current);
		setFocusedVideoId(current => {
			const next = removed.has(current ?? '') ? fallbackVideoId : current;
			persistCanvasState({ focusedVideoId: next });
			return next;
		});
		setContextAddMenu(undefined);
		setContextNodeMenu(undefined);
		setContextEdgeMenu(undefined);
	}, [editProject]);

	const removeEdges = useCallback((ids: readonly string[]): void => {
		const removed = new Set(ids);
		editProject(next => {
			const targets = next.edges.filter(edge => removed.has(edge.id)).map(edge => edge.target);
			next.edges = next.edges.filter(edge => !removed.has(edge.id));
			invalidateDownstreamNodes(next, targets);
		});
		setSelectedEdgeId(undefined);
		setContextEdgeMenu(undefined);
	}, [editProject]);

	const connect = useCallback((connection: Connection): void => {
		if (!connection.source || !connection.target) {
			return;
		}
		const validation = validateWorkflowConnection(projectRef.current, connection.source, connection.target);
		if (!validation.valid || !validation.media) {
			setNotice(validation.reason ?? 'These nodes cannot be connected.');
			return;
		}
		editProject(next => {
			connectWorkflowNodes(
				next,
				connection.source!,
				connection.target!,
				workflowAnchorFromHandle(connection.sourceHandle, 'east'),
				workflowAnchorFromHandle(connection.targetHandle, 'west')
			);
		});
		setNotice(undefined);
	}, [editProject]);

	const moveNodes = useCallback((movedNodes: readonly WorkflowFlowNode[]): void => {
		editProject(next => {
			for (const movedNode of movedNodes) {
				const node = nodeById(next, movedNode.id);
				if (node) {
					node.position = movedNode.position;
					continue;
				}
				const group = next.groups.find(candidate => candidate.id === movedNode.id);
				if (group) {
					group.position = movedNode.position;
				}
			}
		});
	}, [editProject]);
	const onNodesChange = useCallback((changes: NodeChange<WorkflowFlowNode>[]): void => {
		const previous = flowNodesRef.current;
		const positionChanges = changes.filter((change): change is Extract<NodeChange<WorkflowFlowNode>, { type: 'position' }> => change.type === 'position' && Boolean(change.position));
		let nextChanges = changes;
		if (positionChanges.length > 0) {
			const snapped = snapWorkflowCanvasNodeChanges(
				workflowCanvasNodeFrames(previous),
				positionChanges,
				WORKFLOW_CANVAS_SNAP_SCREEN_THRESHOLD / Math.max(0.2, reactFlow.getZoom())
			);
			const snappedById = new Map(snapped.changes.map(change => [change.id, change]));
			nextChanges = changes.map(change => change.type === 'position' ? snappedById.get(change.id) ?? change : change);
			setSnapGuides(snapped.guides);
		}
		const next = applyNodeChanges(nextChanges, previous);
		flowNodesRef.current = next;
		setFlowNodes(next);
	}, [reactFlow]);
	const rememberViewport = useCallback((viewport: Viewport): void => {
		setCanvasZoom(viewport.zoom);
		persistCanvasState({ viewport });
	}, []);
	const cancelInitialViewport = useCallback((): void => {
		if (initialViewportFrameRef.current !== undefined) {
			window.cancelAnimationFrame(initialViewportFrameRef.current);
			initialViewportFrameRef.current = undefined;
		}
	}, []);
	useEffect(() => cancelInitialViewport, [cancelInitialViewport]);
	const focusShot = useCallback(async (videoNodeId: string, instance: ReactFlowInstance<WorkflowFlowNode, WorkflowFlowEdge> = reactFlow): Promise<void> => {
		const video = nodeById(projectRef.current, videoNodeId);
		const group = video?.groupId ? instance.getNode(video.groupId) : undefined;
		const target = group ?? instance.getNode(videoNodeId);
		if (target) {
			await instance.fitView({ nodes: [target], padding: group ? 0.1 : 0.7, minZoom: 0.55, maxZoom: 1.05, duration: 0 });
			rememberViewport(instance.getViewport());
		}
	}, [reactFlow, rememberViewport]);
	const focusNode = useCallback(async (nodeId: string, edit = false): Promise<void> => {
		const target = reactFlow.getNode(nodeId);
		if (!target) {
			return;
		}
		setSelectedNodeIds([nodeId]);
		setActiveNodeControlsId(edit ? nodeId : undefined);
		if (edit && nodeById(projectRef.current, nodeId)?.kind === 'text') {
			setEditingTextNodeId(nodeId);
		}
		setSelectedEdgeId(undefined);
		setActiveNodeDetail(undefined);
		setNodeSearchOpen(false);
		await reactFlow.fitView({ nodes: [target], padding: 0.9, minZoom: 0.65, maxZoom: 1, duration: 0 });
		rememberViewport(reactFlow.getViewport());
		if (edit) {
			window.requestAnimationFrame(() => {
				const element = [...(canvasRef.current?.querySelectorAll<HTMLElement>('.react-flow__node[data-id]') ?? [])]
					.find(candidate => candidate.dataset.id === nodeId);
				const node = nodeById(projectRef.current, nodeId);
				const editor = node?.kind === 'text'
					? element?.querySelector<HTMLElement>('.text-node-content-editor')
					: node?.kind === 'image'
						? element?.querySelector<HTMLTextAreaElement>('.image-node-prompt') ?? element?.querySelector<HTMLInputElement>('.image-node-title-input')
						: element?.querySelector<HTMLTextAreaElement>('.node-prompt-input');
				editor?.focus();
				if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
					editor.select();
				}
			});
		}
	}, [reactFlow, rememberViewport]);
	const duplicateNode = useCallback((nodeId: string): void => {
		const source = nodeById(projectRef.current, nodeId);
		if (!source) {
			return;
		}
		const copy = structuredClone(source);
		copy.id = createId(source.kind);
		copy.title = `${source.title} copy`;
		copy.position = { x: source.position.x + 36, y: source.position.y + 36 };
		if (isExecutableNode(copy)) {
			copy.status = 'draft';
			copy.runs = [];
			delete copy.selectedRunId;
			delete copy.error;
		}
		editProject(next => {
			next.nodes.push(copy);
			if (copy.groupId) {
				next.groups.find(group => group.id === copy.groupId)?.nodeIds.push(copy.id);
			}
		});
		setSelectedNodeIds([copy.id]);
		setActiveNodeControlsId(undefined);
		setSelectedEdgeId(undefined);
		setActiveNodeDetail(undefined);
		setContextNodeMenu(undefined);
	}, [editProject]);
	const contextNode = contextNodeMenu ? nodeById(project, contextNodeMenu.nodeId) : undefined;
	const contextEdge = contextEdgeMenu ? project.edges.find(edge => edge.id === contextEdgeMenu.edgeId) : undefined;
	const contextOutputPath = contextNode && isExecutableNode(contextNode) ? selectedOutputPaths(contextNode)[0] : undefined;
	const contextShotVideoId = contextNode?.groupId
		? project.sequence.find(item => nodeById(project, item.videoNodeId)?.groupId === contextNode.groupId)?.videoNodeId
		: undefined;
	const initializeViewport = useCallback((instance: ReactFlowInstance<WorkflowFlowNode, WorkflowFlowEdge>): void => {
		if (initialViewportSetRef.current) {
			return;
		}
		initialViewportSetRef.current = true;
		const savedViewport = validViewport(persistedCanvasState?.viewport);
		const firstVideoId = initialFocusedVideoId ?? projectRef.current.sequence[0]?.videoNodeId;
		initialViewportFrameRef.current = window.requestAnimationFrame(() => {
			initialViewportFrameRef.current = undefined;
			if (savedViewport) {
				void instance.setViewport(savedViewport, { duration: 0 }).then(() => rememberViewport(instance.getViewport()));
			} else if (firstVideoId) {
				void focusShot(firstVideoId, instance);
			} else {
				void instance.fitView({ padding: 0.16, maxZoom: 1.08, duration: 0 }).then(() => rememberViewport(instance.getViewport()));
			}
		});
	}, [focusShot, rememberViewport]);
	const navigateToShot = useCallback((videoNodeId: string): void => {
		setFocusedVideoId(videoNodeId);
		persistCanvasState({ focusedVideoId: videoNodeId });
		setSelectedNodeIds([]);
		setActiveNodeControlsId(undefined);
		setSelectedEdgeId(undefined);
		setActiveNodeDetail(undefined);
		setContextAddMenu(undefined);
		setContextNodeMenu(undefined);
		setContextEdgeMenu(undefined);
		window.requestAnimationFrame(() => window.requestAnimationFrame(() => { void focusShot(videoNodeId); }));
	}, [focusShot]);
	const setCanvasZoomLevel = useCallback(async (requestedZoom: number): Promise<void> => {
		cancelInitialViewport();
		const bounds = canvasRef.current?.getBoundingClientRect();
		if (!bounds) {
			return;
		}
		const zoom = Math.min(4, Math.max(0.2, requestedZoom));
		const center = reactFlow.screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 });
		await reactFlow.setCenter(center.x, center.y, { zoom, duration: 0 });
		rememberViewport(reactFlow.getViewport());
	}, [cancelInitialViewport, reactFlow, rememberViewport]);
	const positionMenu = useCallback((clientX: number, clientY: number, width: number, height: number): { readonly left: number; readonly top: number } => {
		const bounds = canvasRef.current?.getBoundingClientRect();
		if (!bounds) {
			return { left: 8, top: 8 };
		}
		const position = clampWorkflowCanvasOverlay(
			{ x: clientX - bounds.left, y: clientY - bounds.top },
			{ width, height },
			{ width: bounds.width, height: bounds.height }
		);
		return { left: position.x, top: position.y };
	}, []);
	const openCanvasAddMenu = useCallback((clientX: number, clientY: number, mode: CanvasContextMenuState['mode'], sourceNodeId?: string, sourceAnchor?: AIProjectWorkflowAnchor): void => {
		const menuHeight = mode === 'context' ? 338 : 270;
		const menu = positionMenu(clientX, clientY, 250, menuHeight);
		setSelectedNodeIds(sourceNodeId ? [sourceNodeId] : []);
		setActiveNodeControlsId(undefined);
		setSelectedEdgeId(undefined);
		setActiveNodeDetail(undefined);
		setAddMenuOpen(false);
		setContextNodeMenu(undefined);
		setContextEdgeMenu(undefined);
		setNotice(undefined);
		setContextAddMenu({
			...menu,
			mode,
			...(sourceNodeId ? { sourceNodeId } : {}),
			...(sourceAnchor ? { sourceAnchor } : {}),
			flowPosition: reactFlow.screenToFlowPosition({ x: clientX, y: clientY })
		});
	}, [positionMenu, reactFlow]);
	const insertOnEdge = useCallback((edgeId: string): void => {
		const edge = projectRef.current.edges.find(candidate => candidate.id === edgeId);
		const source = edge ? nodeById(projectRef.current, edge.source) : undefined;
		const target = edge ? nodeById(projectRef.current, edge.target) : undefined;
		if (!edge || !source || !target) {
			return;
		}
		const sourcePosition = absoluteNodePosition(projectRef.current, source);
		const targetPosition = absoluteNodePosition(projectRef.current, target);
		const screen = reactFlow.flowToScreenPosition({
			x: (sourcePosition.x + targetPosition.x) / 2,
			y: (sourcePosition.y + targetPosition.y) / 2
		});
		openEdgeInsertMenu(edgeId, screen.x, screen.y);
	}, [openEdgeInsertMenu, reactFlow]);
	const finishConnection = useCallback((event: MouseEvent | TouchEvent, connectionState: FinalConnectionState): void => {
		if (!connectionState.fromNode) {
			return;
		}
		if (!connectionState.toNode) {
			const point = pointerClientPoint(event);
			const bounds = canvasRef.current?.getBoundingClientRect();
			if (!point || !bounds || point.x < bounds.left || point.x > bounds.right || point.y < bounds.top || point.y > bounds.bottom) {
				return;
			}
			suppressNextPaneClickRef.current = true;
			window.setTimeout(() => { suppressNextPaneClickRef.current = false; }, 0);
			openCanvasAddMenu(
				point.x,
				point.y,
				'connect',
				connectionState.fromNode.id,
				workflowAnchorFromHandle(connectionState.fromHandle?.id, 'east')
			);
			return;
		}
		if (connectionState.isValid === false) {
			const validation = validateWorkflowConnection(projectRef.current, connectionState.fromNode.id, connectionState.toNode.id);
			setNotice(validation.reason ?? 'These nodes cannot be connected.');
		}
	}, [openCanvasAddMenu]);
	const handleCanvasDoubleClick = useCallback((event: ReactMouseEvent<HTMLElement>): void => {
		if (locked || !(event.target instanceof Element) || !event.target.closest('.react-flow__pane') || event.target.closest('.react-flow__node, .react-flow__edge, .add-menu, .node-context-menu')) {
			return;
		}
		event.preventDefault();
		openCanvasAddMenu(event.clientX, event.clientY, 'quick');
	}, [locked, openCanvasAddMenu]);
	useEffect(() => {
		const listener = (event: KeyboardEvent): void => {
			if (!(event.metaKey || event.ctrlKey)) {
				return;
			}
			if (event.key === '+' || event.key === '=') {
				event.preventDefault();
				void setCanvasZoomLevel(reactFlow.getZoom() + 0.1);
			} else if (event.key === '-') {
				event.preventDefault();
				void setCanvasZoomLevel(reactFlow.getZoom() - 0.1);
			} else if (event.key === '0') {
				event.preventDefault();
				void setCanvasZoomLevel(1);
			}
		};
		window.addEventListener('keydown', listener);
		return () => window.removeEventListener('keydown', listener);
	}, [reactFlow, setCanvasZoomLevel]);

	return (
		<div className="workflow-app">
			{banner && <div className="banner" role="alert"><span>{banner.message}</span>{banner.action === 'reload' && <button className="button secondary" onClick={() => vscode.postMessage({ type: 'reload' })}>Reload disk version</button>}<button className="icon-button" aria-label="Dismiss message" onClick={() => setBanner(undefined)}>×</button></div>}
			<div className="workspace" aria-busy={locked}>
				<main className="canvas" ref={canvasRef} onDoubleClick={handleCanvasDoubleClick}>
					{(dirty || running || status.tone === 'error') && <div className={`canvas-status tone-${status.tone}`} role="status">{status.label}</div>}
					<div className="canvas-create-control">
						<div className="canvas-create-actions">
							<button className="canvas-find-button" aria-label="Find a workflow node" title="Find node (⌘F)" onClick={() => setNodeSearchOpen(true)}><svg aria-hidden="true" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg></button>
							<button className="canvas-create-button" disabled={locked} aria-label="Add to workflow" title="Add node" aria-expanded={addMenuOpen} onClick={() => { setAddMenuOpen(value => !value); setContextAddMenu(undefined); setContextNodeMenu(undefined); setContextEdgeMenu(undefined); }}><span aria-hidden="true">+</span></button>
						</div>
						{addMenuOpen && <AddMenu mode="quick" onAdd={addMedia} onAddShot={addShot} />}
					</div>
					<ReactFlow<WorkflowFlowNode, WorkflowFlowEdge>
						nodes={flowNodes}
						edges={flowEdges}
						nodeTypes={nodeTypes}
						edgeTypes={edgeTypes}
						onNodesChange={onNodesChange}
						onInit={initializeViewport}
						minZoom={0.2}
						maxZoom={4}
						connectionMode={ConnectionMode.Loose}
						connectionLineType={ConnectionLineType.Bezier}
						connectionLineComponent={WorkflowConnectionLine}
						isValidConnection={connection => Boolean(connection.source && connection.target && validateWorkflowConnection(projectRef.current, connection.source, connection.target).valid)}
						connectOnClick={false}
						connectionRadius={48}
						deleteKeyCode={locked ? null : ['Backspace', 'Delete']}
						nodesDraggable={!locked}
						nodesConnectable={!locked}
						panOnScroll
						panOnScrollSpeed={1}
						zoomOnScroll={false}
						zoomOnPinch
						zoomOnDoubleClick={false}
						selectionOnDrag={!locked}
						selectionMode={SelectionMode.Partial}
						panOnDrag={[1, 2]}
						multiSelectionKeyCode="Shift"
						onMoveEnd={(_, viewport) => rememberViewport(viewport)}
						onConnect={connect}
						onNodeClick={(event, node) => {
							if (node.type !== 'media') {
								return;
							}
							if (event.button !== 0) {
								setActiveNodeControlsId(undefined);
								return;
							}
							if (suppressNextNodeClickRef.current) {
								setActiveNodeControlsId(undefined);
								return;
							}
							setEditingTextNodeId(current => current === node.id ? current : undefined);
							setActiveNodeDetail(current => current?.nodeId === node.id ? current : undefined);
							setSelectedNodeIds(current => event.shiftKey ? toggleSelectedId(current, node.id) : [node.id]);
							setActiveNodeControlsId(event.shiftKey ? undefined : node.id);
							setSelectedEdgeId(undefined);
							const selected = nodeById(projectRef.current, node.id);
							const shotVideo = selected?.groupId ? projectRef.current.sequence.find(item => nodeById(projectRef.current, item.videoNodeId)?.groupId === selected.groupId) : undefined;
							if (shotVideo) {
								setFocusedVideoId(shotVideo.videoNodeId);
								persistCanvasState({ focusedVideoId: shotVideo.videoNodeId });
							}
						}}
						onNodeDoubleClick={(event, node) => {
							if (node.type !== 'media' || locked) {
								return;
							}
							event.stopPropagation();
							setSelectedNodeIds([node.id]);
							setActiveNodeControlsId(node.id);
							setSelectedEdgeId(undefined);
							setContextAddMenu(undefined);
							setContextNodeMenu(undefined);
							setContextEdgeMenu(undefined);
							void focusNode(node.id, true);
						}}
						onEdgeClick={(event, edge) => {
							setSelectedNodeIds([]);
							setActiveNodeControlsId(undefined);
							setEditingTextNodeId(undefined);
							setSelectedEdgeId(edge.id);
							setSelectedEdgeAction({ edgeId: edge.id, position: reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY }) });
							setActiveNodeDetail(undefined);
							setContextNodeMenu(undefined);
							setContextEdgeMenu(undefined);
						}}
						onPaneClick={() => { if (suppressNextPaneClickRef.current) { return; } setSelectedNodeIds([]); setActiveNodeControlsId(undefined); setEditingTextNodeId(undefined); setSelectedEdgeId(undefined); setActiveNodeDetail(undefined); setNodeSearchOpen(false); setAddMenuOpen(false); setContextAddMenu(undefined); setContextNodeMenu(undefined); setContextEdgeMenu(undefined); }}
						onPaneContextMenu={event => {
							event.preventDefault();
							openCanvasAddMenu(event.clientX, event.clientY, 'context');
						}}
						onNodeContextMenu={(event, node) => {
							event.preventDefault();
							if (node.type !== 'media') {
								return;
							}
							suppressNextNodeClickRef.current = true;
							window.setTimeout(() => { suppressNextNodeClickRef.current = false; }, 0);
							const menu = positionMenu(event.clientX, event.clientY, 200, 230);
							setSelectedNodeIds([node.id]);
							setActiveNodeControlsId(undefined);
							setEditingTextNodeId(undefined);
							setSelectedEdgeId(undefined);
							setActiveNodeDetail(current => current?.nodeId === node.id ? current : undefined);
							setAddMenuOpen(false);
							setContextAddMenu(undefined);
							setContextEdgeMenu(undefined);
							setContextNodeMenu({ ...menu, nodeId: node.id });
						}}
						onEdgeContextMenu={(event, edge) => {
							event.preventDefault();
							const menu = positionMenu(event.clientX, event.clientY, 190, 72);
							setSelectedNodeIds([]);
							setActiveNodeControlsId(undefined);
							setSelectedEdgeId(edge.id);
							setSelectedEdgeAction({ edgeId: edge.id, position: reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY }) });
							setActiveNodeDetail(undefined);
							setAddMenuOpen(false);
							setContextAddMenu(undefined);
							setContextNodeMenu(undefined);
							setContextEdgeMenu({ ...menu, edgeId: edge.id });
						}}
						onNodeDragStop={(_, node, nodes) => {
							setSnapGuides([]);
							moveNodes(nodes.length ? nodes : [node]);
							window.setTimeout(() => { suppressNextNodeClickRef.current = false; }, 0);
						}}
						onNodesDelete={nodes => removeNodes(nodes.filter(node => node.type === 'media').map(node => node.id))}
						onEdgesDelete={edges => removeEdges(edges.map(edge => edge.id))}
						onPaneScroll={() => { setContextAddMenu(undefined); setContextNodeMenu(undefined); setContextEdgeMenu(undefined); }}
						onMoveStart={() => { cancelInitialViewport(); setContextAddMenu(undefined); setContextNodeMenu(undefined); setContextEdgeMenu(undefined); setActiveNodeDetail(undefined); setSnapGuides([]); }}
						onConnectStart={() => { setContextAddMenu(undefined); setContextNodeMenu(undefined); setContextEdgeMenu(undefined); setNotice(undefined); setSnapGuides([]); }}
						onConnectEnd={finishConnection}
						onNodeDragStart={(event, node) => {
							suppressNextNodeClickRef.current = true;
							setActiveNodeControlsId(undefined);
							setEditingTextNodeId(undefined);
							setContextNodeMenu(undefined);
							setContextAddMenu(undefined);
							setContextEdgeMenu(undefined);
							setActiveNodeDetail(undefined);
							setSnapGuides([]);
							if (node.type === 'media') {
								setSelectedNodeIds(current => current.includes(node.id) ? current : event.shiftKey ? [...current, node.id] : [node.id]);
								setSelectedEdgeId(undefined);
							}
						}}
						onSelectionStart={() => { setActiveNodeControlsId(undefined); setEditingTextNodeId(undefined); setContextNodeMenu(undefined); setContextAddMenu(undefined); setContextEdgeMenu(undefined); }}
						onSelectionEnd={() => {
							const nodeIds = reactFlow.getNodes().filter(node => node.type === 'media' && node.selected).map(node => node.id);
							setSelectedNodeIds(current => sameStringArray(current, nodeIds) ? current : nodeIds);
							setActiveNodeControlsId(undefined);
							if (activeNodeDetail && (nodeIds.length !== 1 || nodeIds[0] !== activeNodeDetail.nodeId)) {
								setActiveNodeDetail(undefined);
							}
							setSelectedEdgeId(undefined);
						}}
						edgesReconnectable={false}
						elementsSelectable
						onlyRenderVisibleElements
						proOptions={{ hideAttribution: true }}
					>
						<Background variant={BackgroundVariant.Dots} gap={24} size={1.15} color="color-mix(in srgb, var(--vscode-foreground) 7%, transparent)" />
						<CanvasSnapGuides guides={snapGuides} zoom={canvasZoom} />
						{project.nodes.length > 12 && <MiniMap position="bottom-left" pannable zoomable nodeColor={node => node.type === 'shotGroup' ? 'var(--vscode-editorWidget-border)' : kindColor((node.data as MediaNodeData).node.kind)} maskColor="color-mix(in srgb, var(--vscode-editor-background) 82%, transparent)" />}
					</ReactFlow>
					{project.nodes.length === 0 && project.groups.length === 0 && <div className="canvas-empty-state" aria-live="polite"><strong>Start with the Agent</strong><span>Describe the video you want, or double-click to add a node.</span></div>}
					<div className="canvas-zoom-controls" aria-label="Canvas zoom">
						<button className="canvas-zoom-button" aria-label="Zoom out" onClick={() => void setCanvasZoomLevel(reactFlow.getZoom() - 0.1)}>−</button>
						<span className="canvas-zoom-value" aria-live="polite">{Math.round(canvasZoom * 100)}%</span>
						<button className="canvas-zoom-button reset" aria-label="Reset zoom to 100%" onClick={() => void setCanvasZoomLevel(1)}>1:1</button>
						<button className="canvas-zoom-button" aria-label="Zoom in" onClick={() => void setCanvasZoomLevel(reactFlow.getZoom() + 0.1)}>+</button>
					</div>
					{contextAddMenu && <AddMenu
						mode={contextAddMenu.mode}
						contextPosition={{ left: contextAddMenu.left, top: contextAddMenu.top }}
						kinds={contextAddMenu.edgeId && contextAddMenu.sourceNodeId && contextAddMenu.targetNodeId
							? workflowIntermediateKindsForConnection(project, contextAddMenu.sourceNodeId, contextAddMenu.targetNodeId)
							: creationKinds(contextAddMenu.sourceNodeId ? nodeById(project, contextAddMenu.sourceNodeId)?.kind : undefined)}
						sourceTitle={contextAddMenu.sourceNodeId ? nodeById(project, contextAddMenu.sourceNodeId)?.title : undefined}
						onAdd={addMedia}
						onAddShot={contextAddMenu.mode === 'context' ? addShot : undefined}
						onFind={contextAddMenu.mode === 'context' ? () => { setContextAddMenu(undefined); setNodeSearchOpen(true); } : undefined}
						onUndo={contextAddMenu.mode === 'context' ? undo : undefined}
						onRedo={contextAddMenu.mode === 'context' ? redo : undefined}
						canUndo={past.length > 0}
						canRedo={future.length > 0}
					/>}
					{contextNodeMenu && contextNode && <NodeContextMenu position={{ left: contextNodeMenu.left, top: contextNodeMenu.top }} node={contextNode} inSequence={contextNode.kind === 'video' && project.sequence.some(item => item.videoNodeId === contextNode.id)} onFocus={contextShotVideoId ? () => { setContextNodeMenu(undefined); void focusShot(contextShotVideoId); } : undefined} onEdit={() => { setContextNodeMenu(undefined); void focusNode(contextNode.id, true); }} onOpenOutput={contextOutputPath ? () => { setContextNodeMenu(undefined); openOutput(contextOutputPath); } : undefined} onDuplicate={() => duplicateNode(contextNode.id)} onImport={contextNode.kind === 'text' ? undefined : () => { setContextNodeMenu(undefined); importFiles(contextNode.id); }} onAddToSequence={contextNode.kind === 'video' && !project.sequence.some(item => item.videoNodeId === contextNode.id) ? () => { setContextNodeMenu(undefined); addToSequence(contextNode.id); } : undefined} onDelete={() => removeNodes([contextNode.id])} />}
					{contextEdgeMenu && contextEdge && <EdgeContextMenu position={{ left: contextEdgeMenu.left, top: contextEdgeMenu.top }} onInsert={() => insertOnEdge(contextEdge.id)} onDelete={() => removeEdges([contextEdge.id])} />}
					{nodeSearchOpen && <NodeSearchOverlay project={project} onClose={() => setNodeSearchOpen(false)} onSelect={nodeId => { void focusNode(nodeId); }} />}
					{notice && <div className="canvas-notice" role="status"><span>{notice}</span><button className="icon-button" aria-label="Dismiss notice" onClick={() => setNotice(undefined)}>×</button></div>}
				</main>
			</div>
			{project.sequence.length > 0 && <SequenceBar project={project} mediaUris={mediaUris} focusedVideoId={focusedVideoId} locked={locked} onSelect={navigateToShot} onPreview={() => setSequencePreviewOpen(true)} onOpenOutput={path => vscode.postMessage({ type: 'openOutput', path })} editProject={editProject} />}
			{sequencePreviewOpen && <SequencePreviewPanel project={project} mediaUris={mediaUris} onClose={() => setSequencePreviewOpen(false)} />}
		</div>
	);
}

function authoredNodePosition(node: WorkflowFlowNode): AIProjectWorkflowPosition {
	return node.type === 'media' ? node.data.node.position : node.data.group.position;
}

function samePosition(left: AIProjectWorkflowPosition, right: AIProjectWorkflowPosition): boolean {
	return left.x === right.x && left.y === right.y;
}

function reconcileWorkflowFlowNodes(current: readonly WorkflowFlowNode[], projected: readonly WorkflowFlowNode[]): WorkflowFlowNode[] {
	const currentById = new Map(current.map(node => [node.id, node]));
	return projected.map(node => {
		const previous = currentById.get(node.id);
		if (!previous || previous.parentId !== node.parentId || !samePosition(authoredNodePosition(previous), authoredNodePosition(node))) {
			return node;
		}
		if (previous.type === 'media' && node.type === 'media') {
			return { ...previous, ...node, position: previous.position, width: previous.width, height: previous.height, measured: previous.measured, dragging: previous.dragging };
		}
		if (previous.type === 'shotGroup' && node.type === 'shotGroup') {
			return { ...previous, ...node, position: previous.position, width: previous.width, height: previous.height, measured: previous.measured, dragging: previous.dragging };
		}
		return node;
	});
}

function numericNodeDimension(node: WorkflowFlowNode, dimension: 'width' | 'height'): number {
	const measured = node.measured?.[dimension];
	if (typeof measured === 'number') {
		return measured;
	}
	const styled = node.style?.[dimension];
	if (typeof styled === 'number') {
		return styled;
	}
	if (typeof styled === 'string') {
		const parsed = Number.parseFloat(styled);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return dimension === 'width' ? 224 : 140;
}

function workflowCanvasNodeFrames(nodes: readonly WorkflowFlowNode[]): WorkflowCanvasNodeFrame[] {
	const nodeById = new Map(nodes.map(node => [node.id, node]));
	return nodes.map(node => {
		let parentId = node.parentId;
		let x = 0;
		let y = 0;
		const visited = new Set<string>();
		while (parentId && !visited.has(parentId)) {
			visited.add(parentId);
			const parent = nodeById.get(parentId);
			if (!parent) {
				break;
			}
			x += parent.position.x;
			y += parent.position.y;
			parentId = parent.parentId;
		}
		return {
			id: node.id,
			parentId: node.parentId,
			position: node.position,
			parentOffset: { x, y },
			width: numericNodeDimension(node, 'width'),
			height: numericNodeDimension(node, 'height')
		};
	});
}

function CanvasSnapGuides({ guides, zoom }: { readonly guides: readonly WorkflowCanvasSnapGuide[]; readonly zoom: number }): JSX.Element {
	if (guides.length === 0) {
		return <></>;
	}
	const thickness = 1 / Math.max(0.2, zoom);
	return <ViewportPortal>
		<svg className="canvas-snap-guides" width="1" height="1" aria-hidden="true">
			{guides.map((guide, index) => guide.orientation === 'vertical'
				? <line key={`v:${index}`} data-testid="workflow-snap-guide" x1={guide.x} x2={guide.x} y1={guide.y1 - 10} y2={guide.y2 + 10} strokeWidth={thickness} />
				: <line key={`h:${index}`} data-testid="workflow-snap-guide" x1={guide.x1 - 10} x2={guide.x2 + 10} y1={guide.y} y2={guide.y} strokeWidth={thickness} />)}
		</svg>
	</ViewportPortal>;
}

function useWorkbenchPlacement(root: RefObject<HTMLDivElement | null>, selector: string, show: boolean, clearance: number): 'top' | 'bottom' {
	const [placement, setPlacement] = useState<'top' | 'bottom'>('bottom');
	useLayoutEffect(() => {
		if (!show) {
			return;
		}
		let frame = 0;
		let observer: ResizeObserver | undefined;
		let mutationObserver: MutationObserver | undefined;
		const updatePlacement = (): void => {
			const element = root.current;
			const canvas = element?.closest('.canvas');
			const workbench = element?.querySelector<HTMLElement>(selector);
			if (!element || !canvas || !workbench) {
				return;
			}
			workbench.style.setProperty('--workflow-workbench-shift-x', '0px');
			const nodeBounds = element.getBoundingClientRect();
			const canvasBounds = canvas.getBoundingClientRect();
			const workbenchBounds = workbench.getBoundingClientRect();
			const viewport = element.closest('.react-flow')?.querySelector<HTMLElement>('.react-flow__viewport');
			const viewportTransform = viewport ? getComputedStyle(viewport).transform : 'none';
			const viewportScale = viewportTransform === 'none' ? 1 : Math.max(0.2, new DOMMatrix(viewportTransform).a);
			const horizontalMargin = 8;
			const horizontalShift = workbenchBounds.left < canvasBounds.left + horizontalMargin
				? canvasBounds.left + horizontalMargin - workbenchBounds.left
				: workbenchBounds.right > canvasBounds.right - horizontalMargin
					? canvasBounds.right - horizontalMargin - workbenchBounds.right
					: 0;
			workbench.style.setProperty('--workflow-workbench-shift-x', `${horizontalShift / viewportScale}px`);
			const required = workbenchBounds.height + clearance;
			const spaceAbove = nodeBounds.top - canvasBounds.top;
			const spaceBelow = canvasBounds.bottom - nodeBounds.bottom;
			setPlacement(spaceBelow >= required || spaceBelow >= spaceAbove ? 'bottom' : 'top');
		};
		const schedulePlacement = (): void => {
			window.cancelAnimationFrame(frame);
			frame = window.requestAnimationFrame(updatePlacement);
		};
		frame = window.requestAnimationFrame(() => {
			updatePlacement();
			const element = root.current;
			const workbench = element?.querySelector<HTMLElement>(selector);
			if (element && workbench) {
				observer = new ResizeObserver(schedulePlacement);
				observer.observe(element);
				observer.observe(workbench);
				mutationObserver = new MutationObserver(schedulePlacement);
				const flowNode = element.closest('.react-flow__node');
				const viewport = element.closest('.react-flow')?.querySelector('.react-flow__viewport');
				if (flowNode) {
					mutationObserver.observe(flowNode, { attributes: true, attributeFilter: ['class', 'style'] });
				}
				if (viewport) {
					mutationObserver.observe(viewport, { attributes: true, attributeFilter: ['style'] });
				}
			}
		});
		window.addEventListener('resize', schedulePlacement);
		return () => {
			window.cancelAnimationFrame(frame);
			window.removeEventListener('resize', schedulePlacement);
			observer?.disconnect();
			mutationObserver?.disconnect();
		};
	}, [clearance, root, selector, show]);
	return placement;
}

function MediaNodeCard({ data, selected }: NodeProps<MediaFlowNode>): JSX.Element {
	const node = data.node;
	if (node.kind === 'text') {
		return <TextNodeCard data={data} node={node} selected={selected} />;
	}
	if (node.kind === 'image') {
		return <ImageNodeCard data={data} node={node} selected={selected} />;
	}
	return <GeneratedMediaNodeCard data={data} node={node} selected={selected} />;
}

function WorkflowConnectionHandles({ kind }: { readonly kind: AIProjectMediaKind }): JSX.Element {
	const targets = workflowTargetKindsForSource(kind).map(mediaKindLabel).join(', ');
	return <>{workflowAnchors.map(anchor => <Handle
		key={anchor}
		id={anchor}
		type="source"
		position={workflowAnchorPositions[anchor]}
		className={`workflow-connect-handle ${anchor}`}
		aria-label={`${mediaKindLabel(kind)} connection, ${anchor} side`}
		title={`${mediaKindLabel(kind)} can feed ${targets}`}
	/>)}</>;
}

function EditableNodeTitle({ data, node, className }: { readonly data: MediaNodeData; readonly node: AIProjectNode; readonly className: string }): JSX.Element {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(node.title);
	useEffect(() => {
		if (!editing) {
			setDraft(node.title);
		}
	}, [editing, node.title]);
	const finish = (save: boolean): void => {
		const title = draft.trim();
		if (save && title && title !== node.title) {
			data.editProject(next => updateNode(next, node.id, value => { value.title = title; }));
		}
		setDraft(title || node.title);
		setEditing(false);
	};
	return editing
		? <input autoFocus className={`${className}-input nodrag nopan`} aria-label={`${mediaKindLabel(node.kind)} node name`} value={draft} disabled={data.locked} onChange={event => setDraft(event.target.value)} onBlur={() => finish(true)} onDoubleClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); finish(true); } else if (event.key === 'Escape') { event.preventDefault(); finish(false); } }} />
		: <span className={className} title="Double-click to rename" onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); if (!data.locked) { setDraft(node.title); setEditing(true); } }}>{node.title}</span>;
}

function GeneratedMediaNodeCard({ data, node, selected }: { readonly data: MediaNodeData; readonly node: AIProjectVideoNode | AIProjectAudioNode; readonly selected: boolean }): JSX.Element {
	const showWorkbench = selected && data.showActions;
	const root = useRef<HTMLDivElement>(null);
	const workbenchPlacement = useWorkbenchPlacement(root, '.node-workbench', showWorkbench, 12);
	const stateLabel = data.isRunning ? 'Generating' : node.status === 'error' ? 'Failed' : node.status === 'stale' ? 'Outdated' : undefined;
	return <div ref={root} className={`generated-node-shell kind-${node.kind}${selected ? ' selected' : ''}${data.isRunning ? ' running' : ''}`} title={selected ? undefined : `Click to select. Double-click to edit the ${node.kind} prompt.`}>
		<div className="generated-node-label-row">
			<EditableNodeTitle data={data} node={node} className="generated-node-title" />
			{stateLabel && <span className={`generated-node-state${node.status === 'error' ? ' error' : ''}`} aria-live="polite">{stateLabel}</span>}
		</div>
		<div className="generated-node-media">
			{data.previewUri ? <MediaPreview uri={data.previewUri} kind={data.previewKind ?? node.kind} title={node.title} /> : <MediaEmptyState node={node} readiness={data.readiness} running={data.isRunning} />}
		</div>
		{showWorkbench && <NodeWorkbench data={data} placement={workbenchPlacement} />}
		<WorkflowConnectionHandles kind={node.kind} />
	</div>;
}

function TextNodeCard({ data, node, selected }: { readonly data: MediaNodeData; readonly node: AIProjectTextNode; readonly selected: boolean }): JSX.Element {
	const showComposer = selected && data.showActions && !data.textEditing;
	const root = useRef<HTMLDivElement>(null);
	const editor = useRef<HTMLDivElement>(null);
	const composerPlacement = useWorkbenchPlacement(root, '.text-node-ai-composer', showComposer, 16);
	useLayoutEffect(() => {
		if (!data.textEditing || !editor.current) {
			return;
		}
		editor.current.focus();
		placeCaretAtEnd(editor.current);
	}, [data.textEditing]);
	const finishEditing = (save: boolean): void => {
		const content = editor.current ? editableTextNodeMarkdown(editor.current) : node.content;
		if (save && content !== node.content) {
			data.editProject(next => updateNode(next, node.id, value => {
				if (value.kind === 'text') {
					value.content = content;
					invalidateDownstreamNodes(next, [value.id], false);
				}
			}));
		}
		data.onFinishTextEditing();
	};
	return <div ref={root} className={`text-node-shell${selected ? ' selected' : ''}${data.textEditing ? ' editing' : ''}`} title={selected ? undefined : 'Click to select. Double-click the content to edit.'}>
		<div className="text-node-label-row">
			<svg className="text-node-label-icon" aria-hidden="true" viewBox="0 0 16 16"><path d="M3 2.5h10v11H3z" /><path d="M5.25 5h5.5M5.25 7.5h5.5M5.25 10h4" /></svg>
			<EditableNodeTitle data={data} node={node} className="text-node-title" />
		</div>
		{data.textEditing && <TextNodeFormatToolbar onCommand={command => applyTextNodeFormat(editor.current, command)} />}
		<div className={`text-node-surface${node.content.trim() ? '' : ' empty'}`}>
			{data.textEditing
				? <div ref={editor} className="text-node-content-scroll text-node-content-editor nodrag nopan nowheel" aria-label={`${node.title} content`} contentEditable={!data.locked} suppressContentEditableWarning spellCheck onBlur={() => finishEditing(true)} onInput={data.onTextDraftChange} onDoubleClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onKeyDown={event => {
					if (event.key === 'Escape') {
						event.preventDefault();
						event.stopPropagation();
						finishEditing(false);
					} else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
						event.preventDefault();
						event.stopPropagation();
						finishEditing(true);
					}
				}}>{renderTextNodeMarkdown(node.content)}</div>
				: <div className="text-node-content-scroll text-node-content-preview">{renderTextNodeMarkdown(node.content)}</div>}
		</div>
		{showComposer && <TextNodeAIComposer data={data} node={node} placement={composerPlacement} />}
		{selected && !data.locked && <NodeResizeControl className="text-node-resize-control nodrag nopan" position="bottom-right" minWidth={AI_TEXT_NODE_MIN_WIDTH} minHeight={AI_TEXT_NODE_MIN_HEIGHT} maxWidth={AI_TEXT_NODE_MAX_WIDTH} maxHeight={AI_TEXT_NODE_MAX_HEIGHT} onResizeEnd={(_event, size) => data.editProject(next => updateNode(next, node.id, value => {
			if (value.kind === 'text') {
				value.width = Math.round(size.width);
				value.height = Math.round(size.height);
			}
		}))}><svg aria-hidden="true" viewBox="0 0 12 12"><path d="m4.5 10 5.5-5.5M7.5 10l2.5-2.5" /></svg></NodeResizeControl>}
		<WorkflowConnectionHandles kind={node.kind} />
	</div>;
}

type TextNodeFormatCommand = 'paragraph' | 'heading-one' | 'heading-two' | 'heading-three' | 'bold' | 'italic' | 'unordered-list' | 'ordered-list';

function TextNodeFormatToolbar({ onCommand }: { readonly onCommand: (command: TextNodeFormatCommand) => void }): JSX.Element {
	const actions: readonly { readonly command: TextNodeFormatCommand; readonly label: string; readonly title: string }[] = [
		{ command: 'paragraph', label: 'T', title: 'Body text' },
		{ command: 'heading-one', label: 'H1', title: 'Heading 1' },
		{ command: 'heading-two', label: 'H2', title: 'Heading 2' },
		{ command: 'heading-three', label: 'H3', title: 'Heading 3' },
		{ command: 'bold', label: 'B', title: 'Bold' },
		{ command: 'italic', label: 'I', title: 'Italic' },
		{ command: 'unordered-list', label: '•', title: 'Bulleted list' },
		{ command: 'ordered-list', label: '1.', title: 'Numbered list' }
	];
	return <div className="text-node-format-toolbar nodrag nopan nowheel" role="toolbar" aria-label="Text formatting" onPointerDown={event => event.stopPropagation()}>
		{actions.map(action => <button key={action.command} type="button" aria-label={action.title} title={action.title} onMouseDown={event => { event.preventDefault(); onCommand(action.command); }}>{action.label}</button>)}
	</div>;
}

function TextNodeAIComposer({ data, node, placement }: { readonly data: MediaNodeData; readonly node: AIProjectTextNode; readonly placement: 'top' | 'bottom' }): JSX.Element {
	const configuredServices = data.textModelServices.filter(service => service.configured);
	const [instruction, setInstruction] = useState('');
	const [serviceId, setServiceId] = useState(configuredServices[0]?.id ?? '');
	useEffect(() => {
		if (!configuredServices.some(service => service.id === serviceId)) {
			setServiceId(configuredServices[0]?.id ?? '');
		}
	}, [configuredServices, serviceId]);
	const submit = (): void => {
		if (!configuredServices.length) {
			return;
		}
		if (instruction.trim() && serviceId) {
			data.onRunText(node.id, instruction.trim(), serviceId);
		}
	};
	return <section className={`text-node-ai-composer placement-${placement} nodrag nopan nowheel`} aria-label={`${node.title} AI input`} onPointerDown={event => event.stopPropagation()}>
		<textarea className="text-node-ai-input nodrag nopan nowheel" aria-label={`Describe how to generate or revise ${node.title}`} value={instruction} disabled={data.locked} rows={3} placeholder={configuredServices.length ? 'Describe what this node should generate or change…' : 'Configure a text model to generate or revise this node.'} onChange={event => setInstruction(event.target.value)} onKeyDown={event => {
			if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				submit();
			}
		}} />
		<div className="text-node-ai-footer">
			{configuredServices.length
				? <label className="text-node-model-control"><span className="sr-only">Text model</span><select aria-label="Text model" value={serviceId} disabled={data.locked} onChange={event => setServiceId(event.target.value)}>{configuredServices.map(service => <option key={service.id} value={service.id}>{service.label}</option>)}</select></label>
				: <button type="button" className="text-node-configure-model" onClick={data.onConfigureTextModel}>Configure text model</button>}
			{data.isRunning
				? <button type="button" className="text-node-ai-submit cancel" aria-label="Cancel text generation" title="Cancel" onClick={data.onCancel}>×</button>
				: <button type="button" className="text-node-ai-submit" aria-label={configuredServices.length ? `Generate ${node.title}` : 'Text model required'} title={configuredServices.length ? 'Generate (⌘Enter)' : 'Configure a text model to enable generation'} disabled={!configuredServices.length || !instruction.trim() || data.locked} onClick={submit}><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M8 13V3M4.5 6.5 8 3l3.5 3.5" /></svg></button>}
		</div>
	</section>;
}

function ImageNodeCard({ data, node, selected }: { readonly data: MediaNodeData; readonly node: AIProjectImageNode; readonly selected: boolean }): JSX.Element {
	const readiness = nodeReadiness(data.project, node.id);
	const showWorkbench = selected && data.showActions;
	const root = useRef<HTMLDivElement>(null);
	const workbenchPlacement = useWorkbenchPlacement(root, '.image-node-workbench', showWorkbench, 12);
	const stateLabel = data.isRunning
		? 'Generating'
		: node.status === 'error'
			? 'Failed'
			: node.status === 'stale'
				? 'Outdated'
				: undefined;
	return <div ref={root} className={`image-node-shell${selected ? ' selected' : ''}${data.isRunning ? ' running' : ''}`} title={selected ? undefined : 'Click to select. Double-click to edit the prompt.'}>
		<div className="image-node-label-row">
			<EditableNodeTitle data={data} node={node} className="image-node-title" />
			{stateLabel && <span className={`image-node-state${node.status === 'error' ? ' error' : ''}`} aria-live="polite">{stateLabel}</span>}
		</div>
		<div className="image-node-media">
			{data.previewUris?.length
				? <ImageNodeResults uris={data.previewUris} title={node.title} />
				: <ImageNodeEmptyState readiness={readiness.label} running={data.isRunning} />}
		</div>
		{showWorkbench && <ImageNodeWorkbench data={data} node={node} placement={workbenchPlacement} />}
		<WorkflowConnectionHandles kind={node.kind} />
	</div>;
}

function ImageNodeResults({ uris, title }: { readonly uris: readonly string[]; readonly title: string }): JSX.Element {
	const visible = uris.slice(0, 4);
	return <div className={`image-node-results result-count-${visible.length}`}>
		{visible.map((uri, index) => <img key={uri} className="image-node-preview" src={uri} alt={index === 0 ? `Selected result for ${title}` : `${title} result ${index + 1}`} draggable={false} />)}
		{uris.length > visible.length && <span className="image-node-result-overflow">+{uris.length - visible.length}</span>}
	</div>;
}

function ImageNodeEmptyState({ readiness, running }: { readonly readiness: string; readonly running: boolean }): JSX.Element {
	return <div className={`image-node-empty${running ? ' generating' : ''}`} aria-label={running ? 'Generating image' : readiness}>
		<div className="image-node-empty-mark" aria-hidden="true"><span /></div>
	</div>;
}

function ImageNodeWorkbench({ data, node, placement }: { readonly data: MediaNodeData; readonly node: AIProjectImageNode; readonly placement: 'top' | 'bottom' }): JSX.Element {
	const compatibleProviders = data.providers.filter(provider => provider.kinds.includes('image'));
	const readiness = nodeReadiness(data.project, node.id);
	const message = data.isRunning
		? 'Generating a new result. The previous result and run history are preserved.'
		: node.error
			? node.error
			: readiness.ready || readiness.label === 'Needs prompt' ? undefined : readiness.reason ?? readiness.label;
	return <section className={`image-node-workbench placement-${placement} nodrag nopan nowheel${data.detailView ? ' detail-open' : ''}`} aria-label={`${node.title} controls`} onPointerDown={event => event.stopPropagation()}>
		{data.detailView === 'runs'
			? <div className="image-node-workbench-detail"><ImageNodeDetailHeading title="Run history" description="Choose which result this workflow uses." onBack={() => data.onShowComposer(node.id)} /><RunHistory node={node} editProject={data.editProject} onOpenOutput={data.onOpenOutput} /></div>
			: data.detailView === 'settings'
				? <div className="image-node-workbench-detail"><ImageNodeSettings data={data} node={node} providers={compatibleProviders} onBack={() => data.onShowComposer(node.id)} /></div>
				: <>
					{message && <div className={`image-node-message${node.status === 'error' ? ' error' : ''}`} role="status">{message}</div>}
					{node.source === 'generate'
						? <textarea className="image-node-prompt nodrag nopan nowheel" aria-label={`${node.title} prompt`} rows={4} value={node.prompt} disabled={data.locked} placeholder="Describe the subject, action, framing, light, and visual style…" onChange={event => data.editProject(next => updateExecutable(next, node.id, value => { value.prompt = event.target.value; invalidateDownstreamNodes(next, [value.id]); }))} />
						: <div className="image-node-local-picker"><span>{node.inputFiles.length ? `${node.inputFiles.length} local image${node.inputFiles.length === 1 ? '' : 's'} selected` : 'Choose an image from this project.'}</span><button disabled={data.locked} onClick={() => data.onImportFiles(node.id)}>Choose files</button></div>}
					<div className="image-node-execution-strip">
						{node.source === 'generate' && <select className="image-node-provider" aria-label="Image model service" value={node.provider} disabled={data.locked} onChange={event => data.editProject(next => updateExecutable(next, node.id, value => { value.provider = event.target.value; invalidateDownstreamNodes(next, [value.id]); }))}>{compatibleProviders.map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select>}
						<button className="image-node-output-settings" disabled={data.locked} title="Open image settings" onClick={() => data.onShowDetail(node.id, 'settings')}>{node.aspectRatio} · {node.count} {node.count === 1 ? 'image' : 'images'}</button>
						{node.runs.length > 0 && <button className="image-node-history" disabled={data.locked} onClick={() => data.onShowDetail(node.id, 'runs')}>History {node.runs.length}</button>}
						{node.source === 'generate' && <button className={`node-run-button${data.isRunning ? ' cancel' : ''}`} disabled={!data.isRunning && !data.canRun} title={!data.isRunning && !data.canRun ? readiness.reason ?? readiness.label : undefined} onClick={() => data.isRunning ? data.onCancel() : data.onRun(node.id)}>{data.isRunning ? 'Cancel' : 'Run'}</button>}
					</div>
				</>}
	</section>;
}

function ImageNodeDetailHeading({ title, description, onBack }: { readonly title: string; readonly description: string; readonly onBack: () => void }): JSX.Element {
	return <div className="image-node-panel-heading"><button onClick={onBack}>Prompt</button><span><strong>{title}</strong><small>{description}</small></span></div>;
}

function ImageNodeSettings({ data, node, providers, onBack }: { readonly data: MediaNodeData; readonly node: AIProjectImageNode; readonly providers: readonly AIMediaProviderOption[]; readonly onBack: () => void }): JSX.Element {
	return <div className="image-node-settings">
		<ImageNodeDetailHeading title="Image settings" description="These values apply to the next run only." onBack={onBack} />
		<div className="image-node-settings-grid">
			<Field label="Source"><select value={node.source} onChange={event => data.editProject(next => updateExecutable(next, node.id, value => { value.source = event.target.value as AIProjectExecutableNode['source']; invalidateDownstreamNodes(next, [value.id]); }))}><option value="generate">Generate with AI</option><option value="local">Use local media</option></select></Field>
			<Field label="Frame"><input value={node.aspectRatio} onChange={event => data.editProject(next => updateExecutable(next, node.id, value => { if (value.kind === 'image') { value.aspectRatio = event.target.value; invalidateDownstreamNodes(next, [value.id]); } }))} /></Field>
			{node.source === 'generate' && <><Field label="Model service"><select value={node.provider} onChange={event => data.editProject(next => updateExecutable(next, node.id, value => { value.provider = event.target.value; invalidateDownstreamNodes(next, [value.id]); }))}>{providers.map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></Field><Field label="Model"><input value={node.model} placeholder="auto" onChange={event => data.editProject(next => updateExecutable(next, node.id, value => { value.model = event.target.value; invalidateDownstreamNodes(next, [value.id]); }))} /></Field><Field label="Results"><input type="number" min="1" max="16" value={node.count} onChange={event => data.editProject(next => updateExecutable(next, node.id, value => { if (value.kind === 'image') { value.count = numberInput(event.target.value, 1); invalidateDownstreamNodes(next, [value.id]); } }))} /></Field></>}
		</div>
		{node.source === 'generate' && <Field label="Avoid"><textarea rows={3} value={node.negativePrompt} placeholder="Optional details to exclude from the result" onChange={event => data.editProject(next => updateExecutable(next, node.id, value => { value.negativePrompt = event.target.value; invalidateDownstreamNodes(next, [value.id]); }))} /></Field>}
		<div className="image-node-inputs-row"><span><strong>{node.source === 'local' ? 'Local images' : 'Reference images'}</strong><small>{node.inputFiles.length ? `${node.inputFiles.length} file${node.inputFiles.length === 1 ? '' : 's'} attached` : 'No files attached'}</small></span><div><button onClick={() => data.onImportFiles(node.id)}>Import</button>{node.inputFiles.length > 0 && <button onClick={() => data.editProject(next => updateExecutable(next, node.id, value => { value.inputFiles = []; invalidateDownstreamNodes(next, [value.id]); }))}>Clear</button>}</div></div>
	</div>;
}

function MediaEmptyState({ node, readiness, running }: { readonly node: AIProjectExecutableNode; readonly readiness: string; readonly running: boolean }): JSX.Element {
	const label = running ? `Generating ${node.kind}` : node.source === 'local' ? `Import ${node.kind}` : readiness;
	return <div className={`media-empty-state placeholder-${node.kind}${running ? ' generating' : ''}`} aria-label={label}><div className="media-empty-visual" aria-hidden="true">{node.kind === 'audio' ? <><i /><i /><i /><i /><i /><i /><i /></> : <span />}</div></div>;
}

function NodeWorkbench({ data, placement }: { readonly data: MediaNodeData; readonly placement: 'top' | 'bottom' }): JSX.Element {
	const node = data.node;
	if (node.kind !== 'video' && node.kind !== 'audio') {
		return <></>;
	}
	const compatibleProviders = data.providers.filter(provider => provider.kinds.includes(node.kind));
	const readiness = nodeReadiness(data.project, node.id);
	const message = data.isRunning
		? `Generating ${node.kind}. The previous result and history are preserved.`
		: node.error
			? node.error
			: readiness.ready || readiness.label === 'Needs prompt' ? undefined : readiness.reason ?? readiness.label;
	const settingsSummary = node.kind === 'video' ? `${node.aspectRatio} · ${node.durationSeconds}s` : `${roleLabel(node.role)} · ${node.durationSeconds}s`;
	return <section className={`node-workbench placement-${placement} nodrag nopan nowheel${data.detailView ? ' detail-open' : ''}`} aria-label={`${node.title} controls`} onPointerDown={event => event.stopPropagation()}>
		{data.detailView === 'runs'
			? <div className="node-workbench-detail"><ImageNodeDetailHeading title="Run history" description="Choose which result this workflow uses." onBack={() => data.onShowComposer(node.id)} /><RunHistory node={node} editProject={data.editProject} onOpenOutput={data.onOpenOutput} /></div>
			: data.detailView === 'settings'
				? <div className="node-workbench-detail"><GeneratedNodeSettings data={data} node={node} providers={compatibleProviders} onBack={() => data.onShowComposer(node.id)} /></div>
				: <>
					{message && <div className={`node-composer-status${node.status === 'error' ? ' error' : ''}`} role="status">{message}</div>}
					{node.source === 'generate'
						? <textarea className="node-prompt-input" rows={4} value={node.prompt} disabled={data.locked} placeholder={node.kind === 'video' ? 'Describe movement, camera, timing, and sound.' : 'Describe the voice, music, or sound you want.'} onChange={event => data.editProject(next => updateExecutable(next, node.id, value => { value.prompt = event.target.value; invalidateDownstreamNodes(next, [value.id]); }))} />
						: <div className="node-local-input"><span>{node.inputFiles.length ? `${node.inputFiles.length} local file${node.inputFiles.length === 1 ? '' : 's'} selected` : `Choose ${node.kind} from this project.`}</span><button disabled={data.locked} onClick={() => data.onImportFiles(node.id)}>Choose files</button></div>}
					<div className="node-execution-strip">
						{node.source === 'generate' && <select className="node-provider" aria-label={`${mediaKindLabel(node.kind)} model service`} value={node.provider} disabled={data.locked} onChange={event => data.editProject(next => updateExecutable(next, node.id, value => { value.provider = event.target.value; invalidateDownstreamNodes(next, [value.id]); }))}>{compatibleProviders.map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select>}
						<button className="node-settings-button" disabled={data.locked} title={`Open ${node.kind} settings`} onClick={() => data.onShowDetail(node.id, 'settings')}>{settingsSummary}</button>
						{node.runs.length > 0 && <button className="node-history-button" disabled={data.locked} onClick={() => data.onShowDetail(node.id, 'runs')}>History {node.runs.length}</button>}
						{node.kind === 'video' && !data.project.sequence.some(item => item.videoNodeId === node.id) && <button className="node-sequence-button" disabled={data.locked} onClick={() => data.onAddToSequence(node.id)}>Add to clips</button>}
						{node.source === 'local' && <button className="node-settings-button" disabled={data.locked} onClick={() => data.onShowDetail(node.id, 'settings')}>Settings</button>}
						<button className={`node-run-button${data.isRunning ? ' cancel' : ''}`} disabled={!data.isRunning && !data.canRun} title={!data.isRunning && !data.canRun ? readiness.reason ?? readiness.label : undefined} onClick={() => data.isRunning ? data.onCancel() : data.onRun(node.id)}>{data.isRunning ? 'Cancel' : 'Run'}</button>
					</div>
				</>}
	</section>;
}

function GeneratedNodeSettings({ data, node, providers, onBack }: { readonly data: MediaNodeData; readonly node: AIProjectVideoNode | AIProjectAudioNode; readonly providers: readonly AIMediaProviderOption[]; readonly onBack: () => void }): JSX.Element {
	const provider = providers.find(candidate => candidate.id === node.provider);
	return <div className="generated-node-settings">
		<ImageNodeDetailHeading title={`${mediaKindLabel(node.kind)} settings`} description="These values apply to the next run only." onBack={onBack} />
		<div className="image-node-settings-grid">
			<Field label="Source"><select value={node.source} disabled={data.locked} onChange={event => data.editProject(next => updateExecutable(next, node.id, value => { value.source = event.target.value as AIProjectExecutableNode['source']; invalidateDownstreamNodes(next, [value.id]); }))}><option value="generate">Generate with AI</option><option value="local">Use local media</option></select></Field>
			{node.source === 'generate' && <><Field label="Model service"><select value={node.provider} disabled={data.locked} onChange={event => data.editProject(next => updateExecutable(next, node.id, value => { value.provider = event.target.value; invalidateDownstreamNodes(next, [value.id]); }))}>{providers.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></Field><Field label="Model"><input value={node.model} disabled={data.locked} placeholder="auto" onChange={event => data.editProject(next => updateExecutable(next, node.id, value => { value.model = event.target.value; invalidateDownstreamNodes(next, [value.id]); }))} /></Field></>}
		</div>
		{node.kind === 'video' ? <VideoSettings node={node} provider={provider} editProject={data.editProject} /> : <AudioSettings node={node} editProject={data.editProject} />}
		{node.source === 'generate' && <Field label="Avoid"><textarea rows={3} value={node.negativePrompt} disabled={data.locked} placeholder="Optional details to exclude from the result" onChange={event => data.editProject(next => updateExecutable(next, node.id, value => { value.negativePrompt = event.target.value; invalidateDownstreamNodes(next, [value.id]); }))} /></Field>}
		<div className="image-node-inputs-row"><span><strong>{node.source === 'local' ? 'Local media' : 'References'}</strong><small>{node.inputFiles.length ? `${node.inputFiles.length} file${node.inputFiles.length === 1 ? '' : 's'} attached` : 'No files attached'}</small></span><div><button disabled={data.locked} onClick={() => data.onImportFiles(node.id)}>Import</button>{node.inputFiles.length > 0 && <button disabled={data.locked} onClick={() => data.editProject(next => updateExecutable(next, node.id, value => { value.inputFiles = []; invalidateDownstreamNodes(next, [value.id]); }))}>Clear</button>}</div></div>
	</div>;
}

function WorkflowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, selected, data }: EdgeProps<WorkflowFlowEdge>): JSX.Element {
	const path = workflowCanvasConnectionPath(
		{ x: sourceX, y: sourceY },
		workflowAnchorFromPosition(sourcePosition),
		{ x: targetX, y: targetY },
		workflowAnchorFromPosition(targetPosition)
	);
	const labelX = (sourceX + targetX) / 2;
	const labelY = (sourceY + targetY) / 2;
	const actionX = data?.actionPosition?.x ?? labelX;
	const actionY = data?.actionPosition?.y ?? labelY;
	return <>
		<BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
		<foreignObject className={`workflow-edge-add-object${selected ? ' visible' : ''}`} x={actionX - 11} y={actionY - 11} width={22} height={22}>
			<button className="workflow-edge-add nodrag nopan" aria-label="Insert node on connection" title="Insert node" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); data?.onInsert(id, event.clientX, event.clientY); }}>+</button>
		</foreignObject>
	</>;
}

function WorkflowConnectionLine({ fromX, fromY, toX, toY, fromPosition, toPosition, connectionStatus }: ConnectionLineComponentProps<WorkflowFlowNode>): JSX.Element {
	const path = workflowCanvasConnectionPath(
		{ x: fromX, y: fromY },
		workflowAnchorFromPosition(fromPosition),
		{ x: toX, y: toY },
		workflowAnchorFromPosition(toPosition)
	);
	return <path className={`react-flow__connection-path workflow-connection-line${connectionStatus ? ` ${connectionStatus}` : ''}`} d={path} fill="none" />;
}

function ShotGroupCard({ data }: NodeProps<GroupFlowNode>): JSX.Element {
	return <div className="shot-group-card"><div className="shot-group-drag-handle"><strong>{data.group.title}</strong>{data.group.description && <span>{data.group.description}</span>}</div></div>;
}

function MediaPreview({ uri, kind, title }: { readonly uri: string; readonly kind: AIProjectMediaKind; readonly title: string }): JSX.Element {
	if (kind === 'image') {
		return <img className="node-preview" src={uri} alt={`Selected result for ${title}`} />;
	}
	if (kind === 'video') {
		return <video className="node-preview nodrag nopan" src={uri} controls muted preload="metadata" />;
	}
	if (kind === 'audio') {
		return <audio className="node-audio nodrag nopan" src={uri} controls preload="metadata" />;
	}
	return <div className="media-empty-state"><strong>Preview unavailable</strong></div>;
}

function AddMenu({ mode, onAdd, onAddShot, onFind, onUndo, onRedo, canUndo = false, canRedo = false, kinds = mediaKinds, sourceTitle, contextPosition }: {
	readonly mode: CanvasContextMenuState['mode'];
	readonly onAdd: (kind: AIProjectMediaKind) => void;
	readonly onAddShot?: () => void;
	readonly onFind?: () => void;
	readonly onUndo?: () => void;
	readonly onRedo?: () => void;
	readonly canUndo?: boolean;
	readonly canRedo?: boolean;
	readonly kinds?: readonly AIProjectMediaKind[];
	readonly sourceTitle?: string;
	readonly contextPosition?: { readonly left: number; readonly top: number };
}): JSX.Element {
	const firstItem = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		firstItem.current?.focus();
	}, []);
	const moveFocus = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
		if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
			return;
		}
		const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')];
		if (!items.length) {
			return;
		}
		event.preventDefault();
		const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
		const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowUp'
			? (currentIndex <= 0 ? items.length - 1 : currentIndex - 1)
			: (currentIndex + 1) % items.length;
		items[index]?.focus();
	};
	return <div className={`add-menu${contextPosition ? ' context' : ''} mode-${mode}`} style={contextPosition} role="menu" aria-label={mode === 'connect' ? `Create after ${sourceTitle ?? 'node'}` : mode === 'insert' ? 'Insert node on connection' : 'Add to workflow'} onKeyDown={moveFocus}>
		{mode === 'context' && <><div className="menu-label">Canvas</div>{onFind && <button ref={firstItem} role="menuitem" onClick={onFind}><span className="menu-shortcut">⌘F</span><span><strong>Find node</strong><small>Search titles, text, and prompts</small></span></button>}<div className="menu-inline-actions"><button role="menuitem" disabled={!canUndo} onClick={onUndo}>Undo</button><button role="menuitem" disabled={!canRedo} onClick={onRedo}>Redo</button></div><div className="context-separator" /></>}
		<div className="menu-label">{mode === 'connect' ? 'Create next node' : mode === 'insert' ? 'Insert node' : mode === 'quick' ? 'Add node' : 'Media'}</div>
		{(mode === 'connect' || mode === 'insert') && sourceTitle && <div className="menu-context-source" title={sourceTitle}>{mode === 'insert' ? 'On connection from' : 'From'} <strong>{sourceTitle}</strong></div>}
		{kinds.map((kind, index) => <button ref={mode !== 'context' && index === 0 ? firstItem : undefined} key={kind} role="menuitem" onClick={() => onAdd(kind)}><span className={`menu-kind kind-${kind}`}>{kind === 'text' ? 'T' : kind === 'image' ? 'I' : kind === 'video' ? 'V' : 'A'}</span><span><strong>{mediaKindLabel(kind)}</strong><small>{addDescription(kind)}</small></span></button>)}
		{onAddShot && <><div className="menu-label structure-label">Structure</div><button role="menuitem" onClick={onAddShot}><span className="menu-kind">S</span><span><strong>Shot Group</strong><small>Storyboard to one ordered clip</small></span></button></>}
	</div>;
}

function NodeContextMenu({ position, node, inSequence, onEdit, onOpenOutput, onDuplicate, onImport, onAddToSequence, onFocus, onDelete }: {
	readonly position: { readonly left: number; readonly top: number };
	readonly node: AIProjectNode;
	readonly inSequence: boolean;
	readonly onEdit: () => void;
	readonly onOpenOutput?: () => void;
	readonly onDuplicate: () => void;
	readonly onImport?: () => void;
	readonly onAddToSequence?: () => void;
	readonly onFocus?: () => void;
	readonly onDelete: () => void;
}): JSX.Element {
	return <div className="node-context-menu" style={position} role="menu" aria-label={`${node.title} actions`}>
		<button role="menuitem" onClick={onEdit}>{node.kind === 'image' ? 'Edit prompt' : node.kind === 'text' ? 'Edit text' : 'Edit node'}</button>
		{onOpenOutput && <button role="menuitem" onClick={onOpenOutput}>Open result</button>}
		<button role="menuitem" onClick={onDuplicate}>Duplicate</button>
		{onImport && <button role="menuitem" onClick={onImport}>{node.kind === 'image' ? 'Import image' : 'Import media'}</button>}
		{onAddToSequence && <button role="menuitem" onClick={onAddToSequence}>Add to clips</button>}
		{node.kind === 'video' && inSequence && <button role="menuitem" disabled>Already in clips</button>}
		{onFocus && <button role="menuitem" onClick={onFocus}>Focus shot</button>}
		<div className="context-separator" />
		<button className="danger" role="menuitem" onClick={onDelete}>Delete node</button>
	</div>;
}

function EdgeContextMenu({ position, onInsert, onDelete }: {
	readonly position: { readonly left: number; readonly top: number };
	readonly onInsert: () => void;
	readonly onDelete: () => void;
}): JSX.Element {
	return <div className="node-context-menu" style={position} role="menu" aria-label="Connection actions">
		<button role="menuitem" onClick={onInsert}>Insert node</button>
		<button className="danger" role="menuitem" onClick={onDelete}>Remove connection</button>
	</div>;
}

function NodeSearchOverlay({ project, onClose, onSelect }: { readonly project: AIProject; readonly onClose: () => void; readonly onSelect: (nodeId: string) => void }): JSX.Element {
	const [query, setQuery] = useState('');
	const [kind, setKind] = useState<AIProjectMediaKind | 'all'>('all');
	const input = useRef<HTMLInputElement>(null);
	useEffect(() => {
		input.current?.focus();
	}, []);
	const normalized = query.trim().toLowerCase();
	const matches = project.nodes.filter(node => {
		if (kind !== 'all' && node.kind !== kind) {
			return false;
		}
		if (!normalized) {
			return true;
		}
		const searchable = node.kind === 'text' ? `${node.title}\n${node.content}` : `${node.title}\n${node.prompt}\n${node.inputFiles.join('\n')}`;
		return searchable.toLowerCase().includes(normalized);
	});
	return <div className="node-search-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) { onClose(); } }}>
		<section className="node-search-panel" role="dialog" aria-modal="true" aria-labelledby="node-search-title">
			<header><strong id="node-search-title">Find node</strong><button className="icon-button" aria-label="Close node search" onClick={onClose}>×</button></header>
			<input ref={input} className="node-search-input" value={query} placeholder="Search title, text, or prompt" onChange={event => setQuery(event.target.value)} />
			<div className="node-search-filters" role="group" aria-label="Filter by media type">{(['all', ...mediaKinds] as const).map(value => <button key={value} className={kind === value ? 'active' : undefined} aria-pressed={kind === value} onClick={() => setKind(value)}>{value === 'all' ? 'All' : mediaKindLabel(value)}</button>)}</div>
			<div className="node-search-results" role="listbox" aria-label="Workflow nodes">{matches.length
				? matches.map(node => <button key={node.id} role="option" onClick={() => onSelect(node.id)}><span className={`menu-kind kind-${node.kind}`}>{node.kind === 'text' ? 'T' : node.kind === 'image' ? 'I' : node.kind === 'video' ? 'V' : 'A'}</span><span><strong>{node.title}</strong><small>{nodeSummary(node, node.kind === 'text' ? node.content : node.prompt)}</small></span></button>)
				: <p className="node-search-empty">No matching nodes</p>}</div>
		</section>
	</div>;
}

function VideoSettings({ node, provider, editProject }: { readonly node: AIProjectVideoNode; readonly provider: AIMediaProviderOption | undefined; readonly editProject: (mutation: ProjectMutation) => void }): JSX.Element {
	return <><div className="field-row"><Field label="Frame"><input value={node.aspectRatio} onChange={event => editProject(next => updateExecutable(next, node.id, value => { if (value.kind === 'video') { value.aspectRatio = event.target.value; } }))} /></Field><Field label="Seconds"><input type="number" min="1" max="120" value={node.durationSeconds} onChange={event => editProject(next => updateExecutable(next, node.id, value => { if (value.kind === 'video') { value.durationSeconds = numberInput(event.target.value, 5); } }))} /></Field></div><Field label="Audio"><select value={node.audioMode} onChange={event => editProject(next => updateExecutable(next, node.id, value => { if (value.kind === 'video') { value.audioMode = event.target.value as AIProjectVideoNode['audioMode']; } }))}><option value="auto">Auto</option><option value="generate" disabled={provider?.supportsNativeAudio !== true}>Generate with video</option><option value="none">No audio</option></select></Field>{node.audioMode === 'generate' && provider?.supportsNativeAudio !== true && <div className="inline-warning">The selected model service does not report native-audio support.</div>}</>;
}

function AudioSettings({ node, editProject }: { readonly node: AIProjectAudioNode; readonly editProject: (mutation: ProjectMutation) => void }): JSX.Element {
	return <><div className="field-row"><Field label="Purpose"><select value={node.role} onChange={event => editProject(next => updateExecutable(next, node.id, value => { if (value.kind === 'audio') { value.role = event.target.value as AIProjectAudioNode['role']; } }))}><option value="voice">Voice</option><option value="music">Music</option><option value="effect">Sound effect</option><option value="reference">Reference</option></select></Field><Field label="Seconds"><input type="number" min="1" max="3600" value={node.durationSeconds} onChange={event => editProject(next => updateExecutable(next, node.id, value => { if (value.kind === 'audio') { value.durationSeconds = numberInput(event.target.value, 5); } }))} /></Field></div><Field label="Voice"><input value={node.voice} onChange={event => editProject(next => updateExecutable(next, node.id, value => { if (value.kind === 'audio') { value.voice = event.target.value; } }))} /></Field></>;
}

function RunHistory({ node, editProject, onOpenOutput }: { readonly node: AIProjectExecutableNode; readonly editProject: (mutation: ProjectMutation) => void; readonly onOpenOutput: (path: string) => void }): JSX.Element {
	return <>
		{node.error && <div className="inline-error">{node.error}</div>}
		{node.runs.length ? <div className="run-history">{[...node.runs].reverse().map(run => <div key={run.id} className={`run-record${selectedRun(node)?.id === run.id ? ' selected' : ''}`}><button className="run-select" onClick={() => editProject(next => updateExecutable(next, node.id, value => { value.selectedRunId = run.id; invalidateDownstreamNodes(next, [value.id], false); }))}><strong>{formatRunTime(run.createdAt)}</strong><span>{run.provider} · {run.status}</span></button><div className="run-outputs">{run.outputs.map(output => <button key={output} className="output-link" title={output} onClick={() => onOpenOutput(output)}>{output.split('/').at(-1)}</button>)}</div></div>)}</div> : <p className="muted">No runs yet. Every completed run will remain here.</p>}
	</>;
}

function SequenceBar({ project, mediaUris, focusedVideoId, locked, onSelect, onPreview, onOpenOutput, editProject }: { readonly project: AIProject; readonly mediaUris: Readonly<Record<string, string>>; readonly focusedVideoId: string | undefined; readonly locked: boolean; readonly onSelect: (id: string) => void; readonly onPreview: () => void; readonly onOpenOutput: (path: string) => void; readonly editProject: (mutation: ProjectMutation) => void }): JSX.Element {
	const [expanded, setExpanded] = useState(false);
	const playableCount = playableSequenceClips(project, mediaUris).length;
	return <section className={`sequence-bar${expanded ? ' expanded' : ' collapsed'}`} aria-label="Clip playback sequence">
		<div className="sequence-summary"><button className="sequence-toggle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}><span className="sequence-chevron" aria-hidden="true">›</span><strong>Clips</strong><span>{project.sequence.length}</span><small>{playableCount} ready</small></button>{playableCount === project.sequence.length && <button className="sequence-preview-button" title="Play selected clip results in order" onClick={onPreview}>Preview</button>}</div>
		{expanded && <><div className="sequence-items">{project.sequence.map((item, index) => {
		const node = nodeById(project, item.videoNodeId);
		if (node?.kind !== 'video') { return null; }
		return <div key={item.id} className={`sequence-item${focusedVideoId === node.id ? ' selected' : ''}`}><button className="sequence-main" onClick={() => onSelect(node.id)}><span>{index + 1}</span><strong>{project.groups.find(group => group.id === node.groupId)?.title ?? node.title}</strong><small>{selectedOutputPaths(node).length ? 'Result selected' : 'No result yet'}</small></button><div className="sequence-actions"><button disabled={locked || index === 0} onClick={() => editProject(next => moveSequence(next, index, index - 1))}>Earlier</button><button disabled={locked || index === project.sequence.length - 1} onClick={() => editProject(next => moveSequence(next, index, index + 1))}>Later</button><button disabled={locked} onClick={() => editProject(next => { next.sequence = next.sequence.filter(candidate => candidate.id !== item.id); })}>Remove</button></div></div>;
	})}</div>{project.outputs[0] && <div className="sequence-tail"><button className="text-button" onClick={() => onOpenOutput(project.outputs[0])}>Open notes</button></div>}</>}
	</section>;
}

function SequencePreviewPanel({ project, mediaUris, onClose }: { readonly project: AIProject; readonly mediaUris: Readonly<Record<string, string>>; readonly onClose: () => void }): JSX.Element {
	const clips = playableSequenceClips(project, mediaUris);
	const [index, setIndex] = useState(0);
	const clip = clips[index];
	if (!clip) {
		return <></>;
	}
	return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) { onClose(); } }}><section className="sequence-preview-panel" role="dialog" aria-modal="true" aria-labelledby="sequence-preview-title"><div className="sequence-preview-heading"><div><h2 id="sequence-preview-title">Sequence preview</h2><p>Selected clip results play in order. No files are merged or changed.</p></div><button className="icon-button" aria-label="Close sequence preview" onClick={onClose}>×</button></div><div className="sequence-player"><video key={clip.uri} src={clip.uri} controls autoPlay onEnded={() => { if (index < clips.length - 1) { setIndex(index + 1); } }} /><div className="sequence-player-caption"><span>{index + 1} / {clips.length}</span><strong>{clip.title}</strong></div></div><div className="sequence-preview-actions"><button className="button secondary" disabled={index === 0} onClick={() => setIndex(value => value - 1)}>Previous clip</button><button className="button secondary" disabled={index === clips.length - 1} onClick={() => setIndex(value => value + 1)}>Next clip</button><button className="button primary" onClick={onClose}>Done</button></div></section></div>;
}

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }): JSX.Element {
	return <label className="field"><span>{label}</span>{children}</label>;
}

function updateNode(project: AIProject, id: string, mutation: (node: AIProjectNode) => void): void {
	const node = nodeById(project, id);
	if (node) {
		mutation(node);
	}
}

function updateExecutable(project: AIProject, id: string, mutation: (node: AIProjectExecutableNode) => void): void {
	const node = nodeById(project, id);
	if (node && isExecutableNode(node)) {
		mutation(node);
	}
}

function moveSequence(project: AIProject, from: number, to: number): void {
	const [item] = project.sequence.splice(from, 1);
	if (item) {
		project.sequence.splice(to, 0, item);
	}
}

function nodeSummary(node: AIProjectNode, resolvedSummary: string): string {
	if (node.kind === 'text') {
		return summarize(resolvedSummary, node.role === 'brief' ? 'Describe what you want to make.' : 'Add text.');
	}
	if (node.source === 'local') {
		return node.inputFiles.length ? `${node.inputFiles.length} local file${node.inputFiles.length === 1 ? '' : 's'}` : 'Choose local project media.';
	}
	return summarize(resolvedSummary, node.runs.length ? `${node.runs.length} saved run${node.runs.length === 1 ? '' : 's'}` : 'Connect a prompt or add instructions.');
}

function playableSequenceClips(project: AIProject, mediaUris: Readonly<Record<string, string>>): readonly { readonly title: string; readonly uri: string }[] {
	return project.sequence.flatMap(item => {
		const node = nodeById(project, item.videoNodeId);
		if (node?.kind !== 'video') {
			return [];
		}
		const path = selectedOutputPaths(node).find(output => isPreviewablePath(output, 'video'));
		const uri = path ? mediaUris[path] : undefined;
		return uri ? [{ title: project.groups.find(group => group.id === node.groupId)?.title ?? node.title, uri }] : [];
	});
}

function renderTextNodeMarkdown(value: string): ReactNode[] {
	const lines = value.replace(/\r\n?/g, '\n').split('\n');
	const result: ReactNode[] = [];
	let index = 0;
	while (index < lines.length) {
		const line = lines[index];
		if (!line.trim()) {
			index++;
			continue;
		}
		const heading = /^(#{1,3})\s+(.+)$/.exec(line);
		if (heading) {
			const content = renderInlineTextNodeMarkdown(heading[2], `heading-${index}`);
			result.push(heading[1].length === 1 ? <h1 key={index}>{content}</h1> : heading[1].length === 2 ? <h2 key={index}>{content}</h2> : <h3 key={index}>{content}</h3>);
			index++;
			continue;
		}
		const unordered = /^\s*[-*+]\s+(.+)$/.exec(line);
		if (unordered) {
			const items: ReactNode[] = [];
			while (index < lines.length) {
				const match = /^\s*[-*+]\s+(.+)$/.exec(lines[index]);
				if (!match) {
					break;
				}
				items.push(<li key={index}>{renderInlineTextNodeMarkdown(match[1], `item-${index}`)}</li>);
				index++;
			}
			result.push(<ul key={`list-${index}`}>{items}</ul>);
			continue;
		}
		const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
		if (ordered) {
			const items: ReactNode[] = [];
			while (index < lines.length) {
				const match = /^\s*\d+[.)]\s+(.+)$/.exec(lines[index]);
				if (!match) {
					break;
				}
				items.push(<li key={index}>{renderInlineTextNodeMarkdown(match[1], `ordered-${index}`)}</li>);
				index++;
			}
			result.push(<ol key={`ordered-list-${index}`}>{items}</ol>);
			continue;
		}
		if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
			result.push(<hr key={index} />);
			index++;
			continue;
		}
		const paragraph: string[] = [];
		const paragraphStart = index;
		while (index < lines.length && lines[index].trim() && !/^(#{1,3})\s+/.test(lines[index]) && !/^\s*[-*+]\s+/.test(lines[index]) && !/^\s*\d+[.)]\s+/.test(lines[index])) {
			paragraph.push(lines[index]);
			index++;
		}
		result.push(<p key={paragraphStart}>{renderInlineTextNodeMarkdown(paragraph.join('\n'), `paragraph-${paragraphStart}`)}</p>);
	}
	return result;
}

function renderInlineTextNodeMarkdown(value: string, keyPrefix: string): ReactNode[] {
	const token = /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`)/g;
	const result: ReactNode[] = [];
	let offset = 0;
	let index = 0;
	for (const match of value.matchAll(token)) {
		const start = match.index ?? 0;
		if (start > offset) {
			result.push(value.slice(offset, start));
		}
		const current = match[0];
		const content = current.startsWith('**') || current.startsWith('__') ? current.slice(2, -2) : current.slice(1, -1);
		const key = `${keyPrefix}-${index++}`;
		result.push(current.startsWith('**') || current.startsWith('__') ? <strong key={key}>{content}</strong> : current.startsWith('`') ? <code key={key}>{content}</code> : <em key={key}>{content}</em>);
		offset = start + current.length;
	}
	if (offset < value.length) {
		result.push(value.slice(offset));
	}
	return result;
}

function editableTextNodeMarkdown(root: HTMLElement): string {
	return [...root.childNodes].map(markdownBlockFromEditableNode).filter(Boolean).join('\n\n').replace(/\u00a0/g, ' ').trim();
}

function markdownBlockFromEditableNode(node: ChildNode): string {
	if (node.nodeType === globalThis.Node.TEXT_NODE) {
		return node.textContent ?? '';
	}
	if (!(node instanceof HTMLElement)) {
		return '';
	}
	const tag = node.tagName.toLowerCase();
	if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
		return `${'#'.repeat(Number(tag.slice(1)))} ${markdownInlineFromEditableNode(node)}`;
	}
	if (tag === 'ul' || tag === 'ol') {
		return [...node.children].filter(child => child.tagName.toLowerCase() === 'li').map((child, index) => `${tag === 'ul' ? '-' : `${index + 1}.`} ${markdownInlineFromEditableNode(child)}`).join('\n');
	}
	if (tag === 'hr') {
		return '---';
	}
	return markdownInlineFromEditableNode(node);
}

function markdownInlineFromEditableNode(node: ChildNode): string {
	if (node.nodeType === globalThis.Node.TEXT_NODE) {
		return node.textContent ?? '';
	}
	if (!(node instanceof HTMLElement)) {
		return '';
	}
	const content = [...node.childNodes].map(markdownInlineFromEditableNode).join('');
	const tag = node.tagName.toLowerCase();
	return tag === 'strong' || tag === 'b' ? `**${content}**` : tag === 'em' || tag === 'i' ? `*${content}*` : tag === 'code' ? `\`${content}\`` : tag === 'br' ? '\n' : content;
}

function applyTextNodeFormat(editor: HTMLElement | null, command: TextNodeFormatCommand): void {
	if (!editor) {
		return;
	}
	editor.focus();
	if (command === 'bold' || command === 'italic') {
		document.execCommand(command);
	} else if (command === 'unordered-list' || command === 'ordered-list') {
		document.execCommand(command === 'unordered-list' ? 'insertUnorderedList' : 'insertOrderedList');
	} else {
		const block = command === 'paragraph' ? 'p' : command === 'heading-one' ? 'h1' : command === 'heading-two' ? 'h2' : 'h3';
		document.execCommand('formatBlock', false, block);
	}
}

function placeCaretAtEnd(element: HTMLElement): void {
	const selection = window.getSelection();
	if (!selection) {
		return;
	}
	const range = document.createRange();
	range.selectNodeContents(element);
	range.collapse(false);
	selection.removeAllRanges();
	selection.addRange(range);
}

function roleLabel(role: string): string {
	return role === 'imagePrompt' ? 'Image prompt' : role === 'videoPrompt' ? 'Video prompt' : role.charAt(0).toUpperCase() + role.slice(1);
}

function addDescription(kind: AIProjectMediaKind): string {
	return kind === 'text' ? 'Brief, script, prompt, or note' : kind === 'image' ? 'Generate or use visual media' : kind === 'video' ? 'Generate or use one clip' : 'Voice, music, effect, or reference';
}

function kindColor(kind: AIProjectMediaKind): string {
	return kind === 'text' ? 'var(--vscode-symbolIcon-stringForeground)' : kind === 'image' ? 'var(--vscode-symbolIcon-colorForeground)' : kind === 'video' ? 'var(--vscode-focusBorder)' : 'var(--vscode-symbolIcon-eventForeground)';
}

function isPreviewablePath(path: string, kind: AIProjectMediaKind): boolean {
	const extension = path.toLowerCase().split('.').at(-1);
	return kind === 'image' ? ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(extension ?? '') : kind === 'video' ? ['mp4', 'webm', 'mov', 'm4v'].includes(extension ?? '') : kind === 'audio' ? ['mp3', 'wav', 'm4a', 'ogg', 'aac'].includes(extension ?? '') : false;
}

function formatRunTime(value: string): string {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function summarize(value: string, fallback: string): string {
	const compact = value.trim().replace(/\s+/g, ' ');
	return compact ? (compact.length > 116 ? `${compact.slice(0, 113)}...` : compact) : fallback;
}

function numberInput(value: string, fallback: number): number {
	const parsed = value.trim() ? Number(value) : Number.NaN;
	return Number.isFinite(parsed) ? parsed : fallback;
}

function validViewport(value: unknown): Viewport | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const candidate = value as Partial<Viewport>;
	return Number.isFinite(candidate.x) && Number.isFinite(candidate.y) && Number.isFinite(candidate.zoom) && candidate.zoom! >= 0.2 && candidate.zoom! <= 4
		? { x: candidate.x!, y: candidate.y!, zoom: candidate.zoom! }
		: undefined;
}

function persistCanvasState(patch: Partial<PersistedCanvasState>): void {
	vscode.setState({ ...(vscode.getState() ?? {}), ...patch });
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function toggleSelectedId(current: readonly string[], id: string): readonly string[] {
	return current.includes(id) ? current.filter(candidate => candidate !== id) : [...current, id];
}

function creationKinds(source?: AIProjectMediaKind): readonly AIProjectMediaKind[] {
	return source ? workflowTargetKindsForSource(source) : mediaKinds;
}

function workflowAnchorFromHandle(value: string | null | undefined, fallback: AIProjectWorkflowAnchor): AIProjectWorkflowAnchor {
	return value === 'north' || value === 'east' || value === 'south' || value === 'west' ? value : fallback;
}

function workflowAnchorFromPosition(position: Position): AIProjectWorkflowAnchor {
	return position === Position.Top ? 'north' : position === Position.Right ? 'east' : position === Position.Bottom ? 'south' : 'west';
}

function absoluteNodePosition(project: AIProject, node: AIProjectNode): AIProjectWorkflowPosition {
	const group = node.groupId ? project.groups.find(candidate => candidate.id === node.groupId) : undefined;
	return group ? { x: group.position.x + node.position.x, y: group.position.y + node.position.y } : node.position;
}

function pointerClientPoint(event: MouseEvent | TouchEvent): AIProjectWorkflowPosition | undefined {
	if ('clientX' in event) {
		return { x: event.clientX, y: event.clientY };
	}
	const touch = event.changedTouches.item(0);
	return touch ? { x: touch.clientX, y: touch.clientY } : undefined;
}

createRoot(rootElement).render(<StrictMode><App /></StrictMode>);
