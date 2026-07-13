/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-no-unexternalized-strings -- This bundled official-plugin webview does not load the workbench localization runtime. */

import {
	Background,
	BackgroundVariant,
	ConnectionMode,
	ConnectionLineType,
	Handle,
	MarkerType,
	MiniMap,
	Position,
	ReactFlow,
	ReactFlowProvider,
	SelectionMode,
	useReactFlow,
	type Connection,
	type Edge,
	type Node,
	type NodeProps,
	type NodeTypes,
	type ReactFlowInstance,
	type Viewport
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
	createId,
	createMediaNode,
	createShotGroup,
	createWorkflowEdgeId,
	invalidateDownstreamNodes,
	isExecutableNode,
	mediaKindLabel,
	nodeById,
	nodePrompt,
	nodeReadiness,
	runnableNodeIdsInWorkflowOrder,
	selectedOutputPaths,
	selectedRun,
	validateWorkflowConnection,
	type AIProject,
	type AIMediaProviderOption,
	type AIProjectAudioNode,
	type AIProjectExecutableNode,
	type AIProjectImageNode,
	type AIProjectMediaKind,
	type AIProjectNode,
	type AIProjectShotGroup,
	type AIProjectTextNode,
	type AIProjectVideoNode,
	type AIProjectWorkflowPosition
} from '../src/model';
import './styles.css';

interface InitialState {
	readonly project: AIProject;
	readonly revision: string;
	readonly providers: readonly AIMediaProviderOption[];
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
	readonly node: AIProjectNode;
	readonly readiness: string;
	readonly summary: string;
	readonly previewUri?: string;
	readonly previewKind?: AIProjectMediaKind;
}

interface GroupNodeData extends Record<string, unknown> {
	readonly group: AIProjectShotGroup;
}

type MediaFlowNode = Node<MediaNodeData, 'media'>;
type GroupFlowNode = Node<GroupNodeData, 'shotGroup'>;
type WorkflowFlowNode = MediaFlowNode | GroupFlowNode;
type WorkflowFlowEdge = Edge;
type ProjectMutation = (project: AIProject) => void;
type StatusTone = 'normal' | 'running' | 'error';

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
const nodeTypes: NodeTypes = { media: MediaNodeCard, shotGroup: ShotGroupCard };

function App(): JSX.Element {
	return <ReactFlowProvider><WorkflowEditor /></ReactFlowProvider>;
}

function WorkflowEditor(): JSX.Element {
	const [project, setProject] = useState<AIProject>(initialState.project);
	const [revision, setRevision] = useState(initialState.revision);
	const [providers, setProviders] = useState<readonly AIMediaProviderOption[]>(initialState.providers);
	const [mediaUris, setMediaUris] = useState<Readonly<Record<string, string>>>(initialState.mediaUris);
	const [dirty, setDirty] = useState(false);
	const [runningNodeId, setRunningNodeId] = useState<string>();
	const [agentPending, setAgentPending] = useState(false);
	const [status, setStatus] = useState<{ label: string; tone: StatusTone }>({ label: 'Saved locally', tone: 'normal' });
	const [banner, setBanner] = useState<{ message: string; action?: 'reload' }>();
	const [notice, setNotice] = useState<string>();
	const [selectedNodeIds, setSelectedNodeIds] = useState<readonly string[]>([]);
	const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
	const [focusedVideoId, setFocusedVideoId] = useState<string | undefined>(initialFocusedVideoId);
	const [addMenuOpen, setAddMenuOpen] = useState(false);
	const [contextAddMenu, setContextAddMenu] = useState<CanvasContextMenuState>();
	const [contextNodeMenu, setContextNodeMenu] = useState<CanvasNodeContextMenuState>();
	const [contextEdgeMenu, setContextEdgeMenu] = useState<CanvasEdgeContextMenuState>();
	const [runPanelOpen, setRunPanelOpen] = useState(false);
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
	const reactFlow = useReactFlow<WorkflowFlowNode, WorkflowFlowEdge>();
	const running = runningNodeId !== undefined;
	const locked = running || agentPending;
	const selectedNodeId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : undefined;
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
	}, [updateDirty]);

	const save = useCallback((): void => {
		if (!dirtyRef.current || locked) {
			return;
		}
		saveSnapshotRef.current = JSON.stringify(projectRef.current);
		setStatus({ label: 'Saving locally', tone: 'running' });
		vscode.postMessage({ type: 'save', project: projectRef.current, revision: revisionRef.current });
	}, [locked]);

	useEffect(() => {
		if (!dirty || locked) {
			return;
		}
		const handle = window.setTimeout(save, 700);
		return () => window.clearTimeout(handle);
	}, [dirty, locked, project, save]);

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
				case 'agentReady':
					setRevision(String(message.revision ?? ''));
					setAgentPending(false);
					if (JSON.stringify(projectRef.current) === saveSnapshotRef.current) {
						updateDirty(false);
					} else {
						updateDirty(true);
					}
					setNotice(String(message.message ?? 'Workflow brief copied.'));
					break;
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
					setMediaUris((message.mediaUris as Readonly<Record<string, string>> | undefined) ?? {});
					setSelectedNodeIds(current => current.filter(id => incoming.nodes.some(node => node.id === id)));
					setSelectedEdgeId(current => incoming.edges.some(edge => edge.id === current) ? current : undefined);
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
				case 'running':
					setRunningNodeId(String(message.nodeId ?? 'running'));
					setStatus({ label: String(message.label ?? 'Running'), tone: 'running' });
					break;
				case 'cancelled':
					setRunningNodeId(undefined);
					setStatus({ label: 'Run cancelled', tone: 'normal' });
					break;
				case 'error':
					setAgentPending(false);
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
			} else if (!locked && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
				event.preventDefault();
				event.shiftKey ? redo() : undo();
			} else if (event.key === 'Escape') {
				setAddMenuOpen(false);
				setContextAddMenu(undefined);
				setContextNodeMenu(undefined);
				setContextEdgeMenu(undefined);
			}
		};
		window.addEventListener('keydown', listener);
		return () => window.removeEventListener('keydown', listener);
	}, [locked, redo, save, undo]);

	const flowNodes = useMemo<WorkflowFlowNode[]>(() => {
		const groups: GroupFlowNode[] = project.groups.map(group => ({
			id: group.id,
			type: 'shotGroup',
			position: group.position,
			data: { group },
			style: { width: group.width, height: group.height },
			selectable: false,
			zIndex: -1
		}));
		const nodes: MediaFlowNode[] = project.nodes.map(node => {
			const outputs = isExecutableNode(node) ? selectedOutputPaths(node) : [];
			const previewPath = outputs.find(path => isPreviewablePath(path, node.kind));
			return {
				id: node.id,
				type: 'media',
				position: node.position,
				...(node.groupId ? { parentId: node.groupId, extent: 'parent' as const } : {}),
				selected: selectedNodeIds.includes(node.id),
				data: { node, readiness: nodeReadiness(project, node.id).label, summary: node.kind === 'text' ? node.content : nodePrompt(project, node.id), previewUri: previewPath ? mediaUris[previewPath] : undefined, previewKind: previewPath ? node.kind : undefined },
				zIndex: 2
			};
		});
		return [...groups, ...nodes];
	}, [mediaUris, project, selectedNodeIds]);

	const flowEdges = useMemo<WorkflowFlowEdge[]>(() => project.edges.map(edge => ({
		id: edge.id,
		source: edge.source,
		target: edge.target,
		type: 'smoothstep',
		className: `workflow-edge edge-${edge.media}`,
		selected: selectedEdgeId === edge.id,
		animated: edge.target === runningNodeId,
		interactionWidth: 20,
		markerEnd: { type: MarkerType.ArrowClosed },
		ariaLabel: `${nodeById(project, edge.source)?.title ?? edge.source} provides ${edge.media} to ${nodeById(project, edge.target)?.title ?? edge.target}`
	})), [project, runningNodeId, selectedEdgeId]);

	const viewportCenter = useCallback((): AIProjectWorkflowPosition => {
		const bounds = canvasRef.current?.getBoundingClientRect();
		return bounds ? reactFlow.screenToFlowPosition({ x: bounds.left + bounds.width * 0.5, y: bounds.top + bounds.height * 0.45 }) : { x: 480, y: 260 };
	}, [reactFlow]);

	const addMedia = useCallback((kind: AIProjectMediaKind): void => {
		const node = createMediaNode(kind, contextAddMenu?.flowPosition ?? viewportCenter());
		editProject(next => next.nodes.push(node));
		setSelectedEdgeId(undefined);
		setSelectedNodeIds([node.id]);
		setAddMenuOpen(false);
		setContextAddMenu(undefined);
		setContextNodeMenu(undefined);
		setContextEdgeMenu(undefined);
	}, [contextAddMenu, editProject, viewportCenter]);

	const addShot = useCallback((): void => {
		const center = contextAddMenu?.flowPosition ?? viewportCenter();
		const group = createShotGroup(projectRef.current.groups.length + 1, { x: center.x - 520, y: center.y - 150 });
		const storyboard: AIProjectTextNode = { id: createId('text'), kind: 'text', role: 'storyboard', title: 'Storyboard', content: '', position: { x: 28, y: 74 }, groupId: group.id };
		const imagePrompt: AIProjectTextNode = { id: createId('text'), kind: 'text', role: 'imagePrompt', title: 'Image prompt', content: '', position: { x: 258, y: 74 }, groupId: group.id };
		const image: AIProjectImageNode = { ...createMediaNode('image', { x: 488, y: 74 }, group.id), title: 'Storyboard image' };
		const videoPrompt: AIProjectTextNode = { id: createId('text'), kind: 'text', role: 'videoPrompt', title: 'Video prompt', content: '', position: { x: 258, y: 204 }, groupId: group.id };
		const video: AIProjectVideoNode = { ...createMediaNode('video', { x: 808, y: 74 }, group.id), title: 'Generated clip' };
		const nodes: AIProjectNode[] = [storyboard, imagePrompt, image, videoPrompt, video];
		group.nodeIds = nodes.map(node => node.id);
		editProject(next => {
			next.groups.push(group);
			next.nodes.push(...nodes);
			for (const [source, target] of [[storyboard.id, imagePrompt.id], [imagePrompt.id, image.id], [storyboard.id, videoPrompt.id], [videoPrompt.id, video.id], [image.id, video.id]]) {
				const sourceNode = nodeById(next, source)!;
				next.edges.push({ id: createWorkflowEdgeId(source, target), source, target, media: sourceNode.kind });
			}
			next.sequence.push({ id: createId('sequence'), videoNodeId: video.id });
		});
		setSelectedNodeIds([storyboard.id]);
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
		setSelectedEdgeId(undefined);
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
			next.edges.push({ id: createWorkflowEdgeId(connection.source!, connection.target!), source: connection.source!, target: connection.target!, media: validation.media! });
			invalidateDownstreamNodes(next, [connection.target!]);
		});
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

	const runReady = runnableNodeIdsInWorkflowOrder(project);
	const schedulable = new Set(runReady);
	const blockedCount = project.nodes.filter(node => {
		const readiness = nodeReadiness(project, node.id);
		return !readiness.ready && !(isExecutableNode(node) && schedulable.has(node.id));
	}).length;
	const rememberViewport = useCallback((viewport: Viewport): void => {
		setCanvasZoom(viewport.zoom);
		persistCanvasState({ viewport });
	}, []);
	const focusShot = useCallback(async (videoNodeId: string, instance: ReactFlowInstance<WorkflowFlowNode, WorkflowFlowEdge> = reactFlow): Promise<void> => {
		const video = nodeById(projectRef.current, videoNodeId);
		const group = video?.groupId ? instance.getNode(video.groupId) : undefined;
		const target = group ?? instance.getNode(videoNodeId);
		if (target) {
			await instance.fitView({ nodes: [target], padding: group ? 0.1 : 0.7, minZoom: 0.55, maxZoom: 1.05, duration: 0 });
			rememberViewport(instance.getViewport());
		}
	}, [reactFlow, rememberViewport]);
	const selectedNode = selectedNodeId ? nodeById(project, selectedNodeId) : undefined;
	const selectedShotVideoId = selectedNode?.groupId
		? project.sequence.find(item => nodeById(project, item.videoNodeId)?.groupId === selectedNode.groupId)?.videoNodeId
		: undefined;
	const contextNode = contextNodeMenu ? nodeById(project, contextNodeMenu.nodeId) : undefined;
	const contextEdge = contextEdgeMenu ? project.edges.find(edge => edge.id === contextEdgeMenu.edgeId) : undefined;
	const contextNodeCanRun = contextNode !== undefined && isExecutableNode(contextNode) && contextNode.source !== 'local' && nodeReadiness(project, contextNode.id).ready && !locked;
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
		window.requestAnimationFrame(() => {
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
		setSelectedEdgeId(undefined);
		setContextAddMenu(undefined);
		setContextNodeMenu(undefined);
		setContextEdgeMenu(undefined);
		window.requestAnimationFrame(() => window.requestAnimationFrame(() => { void focusShot(videoNodeId); }));
	}, [focusShot]);
	const setCanvasZoomLevel = useCallback(async (requestedZoom: number): Promise<void> => {
		const bounds = canvasRef.current?.getBoundingClientRect();
		if (!bounds) {
			return;
		}
		const zoom = Math.min(4, Math.max(0.2, requestedZoom));
		const center = reactFlow.screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 });
		await reactFlow.setCenter(center.x, center.y, { zoom, duration: 0 });
		rememberViewport(reactFlow.getViewport());
	}, [reactFlow, rememberViewport]);
	const showAll = useCallback(async (): Promise<void> => {
		await reactFlow.fitView({ padding: 0.12, maxZoom: 0.95, duration: 0 });
		rememberViewport(reactFlow.getViewport());
	}, [reactFlow, rememberViewport]);
	const positionMenu = useCallback((clientX: number, clientY: number, width: number, height: number, reserveInspector = false): { readonly left: number; readonly top: number } => {
		const bounds = canvasRef.current?.getBoundingClientRect();
		if (!bounds) {
			return { left: 8, top: 8 };
		}
		const availableWidth = Math.max(width + 16, bounds.width - (reserveInspector ? 352 : 0));
		return {
			left: Math.min(Math.max(clientX - bounds.left, 8), Math.max(8, availableWidth - width - 8)),
			top: Math.min(Math.max(clientY - bounds.top, 8), Math.max(8, bounds.height - height - 8))
		};
	}, []);
	const runNode = useCallback((nodeId: string): void => {
		setContextNodeMenu(undefined);
		setContextEdgeMenu(undefined);
		setRunningNodeId(nodeId);
		setStatus({ label: 'Starting run', tone: 'running' });
		vscode.postMessage({ type: 'runNode', project: projectRef.current, revision: revisionRef.current, nodeId });
	}, []);

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
			<header className="topbar">
				<div className="title-group">
					<input className="project-title" aria-label="Project title" disabled={locked} value={project.title} onChange={event => editProject(next => { next.title = event.target.value; })} />
					<div className={`save-status tone-${status.tone}`}>{status.label}</div>
				</div>
				<div className="topbar-actions">
					{running && <button className="button danger" onClick={() => vscode.postMessage({ type: 'cancel' })}>Cancel run</button>}
					<button className="button agent-action" disabled={locked} onClick={() => {
						saveSnapshotRef.current = JSON.stringify(projectRef.current);
						setAgentPending(true);
						vscode.postMessage({ type: 'prepareAgent', project: projectRef.current, revision: revisionRef.current });
						setStatus({ label: 'Preparing Agent', tone: 'running' });
					}}>Ask Agent</button>
					<button className="button primary" disabled={locked} onClick={() => setRunPanelOpen(true)}>Run</button>
				</div>
			</header>
			<div className="readiness-bar">
				<span><strong>{project.groups.length}</strong> shots</span>
				<span><strong>{runReady.length}</strong> ready to run</span>
				<span className={blockedCount ? 'has-issues' : ''}><strong>{blockedCount}</strong> blocked</span>
				<span><strong>{project.nodes.filter(node => isExecutableNode(node)).reduce((total, node) => total + node.runs.length, 0)}</strong> saved runs</span>
				{project.outputs[0] && <button className="text-button" onClick={() => vscode.postMessage({ type: 'openOutput', path: project.outputs[0] })}>Open sequence notes</button>}
			</div>
			{banner && <div className="banner" role="alert"><span>{banner.message}</span>{banner.action === 'reload' && <button className="button secondary" onClick={() => vscode.postMessage({ type: 'reload' })}>Reload disk version</button>}<button className="icon-button" aria-label="Dismiss message" onClick={() => setBanner(undefined)}>×</button></div>}
			<div className={`workspace${selectedNodeId || selectedEdgeId ? ' has-inspector' : ''}`} aria-busy={locked}>
				<main className="canvas" ref={canvasRef}>
					<div className="canvas-history-controls" aria-label="Canvas history">
						<button className="toolbar-button" disabled={!past.length} onClick={undo}>Undo</button>
						<button className="toolbar-button" disabled={!future.length} onClick={redo}>Redo</button>
						{selectedShotVideoId && <button className="toolbar-button" onClick={() => focusShot(selectedShotVideoId)}>Focus shot</button>}
						{selectedNodeIds.length > 1 && <span className="selection-count">{selectedNodeIds.length} selected</span>}
					</div>
					<div className="canvas-create-control">
						<button className="canvas-create-button" aria-label="Add to workflow" aria-expanded={addMenuOpen} onClick={() => { setAddMenuOpen(value => !value); setContextAddMenu(undefined); setContextNodeMenu(undefined); setContextEdgeMenu(undefined); }}>+</button>
						{addMenuOpen && <AddMenu onAdd={addMedia} onAddShot={addShot} />}
					</div>
					<ReactFlow<WorkflowFlowNode, WorkflowFlowEdge>
						nodes={flowNodes}
						edges={flowEdges}
						nodeTypes={nodeTypes}
						onInit={initializeViewport}
						minZoom={0.2}
						maxZoom={4}
						snapToGrid
						snapGrid={[16, 16]}
						connectionMode={ConnectionMode.Strict}
						connectionLineType={ConnectionLineType.SmoothStep}
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
							if (node.type === 'media') {
								setSelectedNodeIds(current => event.shiftKey ? toggleSelectedId(current, node.id) : [node.id]);
								setSelectedEdgeId(undefined);
								const selected = nodeById(projectRef.current, node.id);
								const shotVideo = selected?.groupId ? projectRef.current.sequence.find(item => nodeById(projectRef.current, item.videoNodeId)?.groupId === selected.groupId) : undefined;
								if (shotVideo) {
									setFocusedVideoId(shotVideo.videoNodeId);
									persistCanvasState({ focusedVideoId: shotVideo.videoNodeId });
								}
							}
						}}
						onEdgeClick={(_, edge) => { setSelectedNodeIds([]); setSelectedEdgeId(edge.id); setContextNodeMenu(undefined); setContextEdgeMenu(undefined); }}
						onPaneClick={() => { setSelectedNodeIds([]); setSelectedEdgeId(undefined); setAddMenuOpen(false); setContextAddMenu(undefined); setContextNodeMenu(undefined); setContextEdgeMenu(undefined); }}
						onPaneContextMenu={event => {
							event.preventDefault();
							const menu = positionMenu(event.clientX, event.clientY, 250, 338);
							setSelectedNodeIds([]);
							setSelectedEdgeId(undefined);
							setAddMenuOpen(false);
							setContextNodeMenu(undefined);
							setContextEdgeMenu(undefined);
							setContextAddMenu({ ...menu, flowPosition: reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY }) });
						}}
						onNodeContextMenu={(event, node) => {
							event.preventDefault();
							if (node.type !== 'media') {
								return;
							}
							const menu = positionMenu(event.clientX, event.clientY, 190, 160, !selectedNodeId && !selectedEdgeId);
							setSelectedNodeIds([node.id]);
							setSelectedEdgeId(undefined);
							setAddMenuOpen(false);
							setContextAddMenu(undefined);
							setContextEdgeMenu(undefined);
							setContextNodeMenu({ ...menu, nodeId: node.id });
						}}
						onEdgeContextMenu={(event, edge) => {
							event.preventDefault();
							const menu = positionMenu(event.clientX, event.clientY, 190, 100, !selectedNodeId && !selectedEdgeId);
							setSelectedNodeIds([]);
							setSelectedEdgeId(edge.id);
							setAddMenuOpen(false);
							setContextAddMenu(undefined);
							setContextNodeMenu(undefined);
							setContextEdgeMenu({ ...menu, edgeId: edge.id });
						}}
						onNodeDragStop={(_, node, nodes) => moveNodes(nodes.length ? nodes : [node])}
						onNodesDelete={nodes => removeNodes(nodes.filter(node => node.type === 'media').map(node => node.id))}
						onEdgesDelete={edges => removeEdges(edges.map(edge => edge.id))}
						onPaneScroll={() => { setContextAddMenu(undefined); setContextNodeMenu(undefined); setContextEdgeMenu(undefined); }}
						onMoveStart={() => { setContextAddMenu(undefined); setContextNodeMenu(undefined); setContextEdgeMenu(undefined); }}
						onConnectStart={() => { setContextAddMenu(undefined); setContextNodeMenu(undefined); setContextEdgeMenu(undefined); }}
						onNodeDragStart={() => { setContextNodeMenu(undefined); setContextAddMenu(undefined); setContextEdgeMenu(undefined); }}
						onSelectionStart={() => { setContextNodeMenu(undefined); setContextAddMenu(undefined); setContextEdgeMenu(undefined); }}
						onSelectionEnd={() => {
							const nodeIds = reactFlow.getNodes().filter(node => node.type === 'media' && node.selected).map(node => node.id);
							setSelectedNodeIds(current => sameStringArray(current, nodeIds) ? current : nodeIds);
							setSelectedEdgeId(undefined);
						}}
						edgesReconnectable={false}
						elementsSelectable
						onlyRenderVisibleElements
						proOptions={{ hideAttribution: true }}
					>
						<Background variant={BackgroundVariant.Lines} gap={40} size={1} color="color-mix(in srgb, var(--vscode-foreground) 2.5%, transparent)" />
						{project.nodes.length > 12 && <MiniMap position="bottom-left" pannable zoomable nodeColor={node => node.type === 'shotGroup' ? 'var(--vscode-editorWidget-border)' : kindColor((node.data as MediaNodeData).node.kind)} maskColor="color-mix(in srgb, var(--vscode-editor-background) 82%, transparent)" />}
					</ReactFlow>
					<div className="canvas-zoom-controls" aria-label="Canvas zoom">
						<button className="canvas-zoom-button" aria-label="Zoom out" onClick={() => void setCanvasZoomLevel(reactFlow.getZoom() - 0.1)}>−</button>
						<span className="canvas-zoom-value" aria-live="polite">{Math.round(canvasZoom * 100)}%</span>
						<button className="canvas-zoom-button reset" aria-label="Reset zoom to 100%" onClick={() => void setCanvasZoomLevel(1)}>1:1</button>
						<button className="canvas-zoom-button" aria-label="Zoom in" onClick={() => void setCanvasZoomLevel(reactFlow.getZoom() + 0.1)}>+</button>
						<button className="canvas-fit-button" onClick={() => void showAll()}>Show all</button>
					</div>
					{contextAddMenu && <AddMenu contextPosition={{ left: contextAddMenu.left, top: contextAddMenu.top }} onAdd={addMedia} onAddShot={addShot} />}
					{contextNodeMenu && contextNode && <NodeContextMenu position={{ left: contextNodeMenu.left, top: contextNodeMenu.top }} node={contextNode} canRun={contextNodeCanRun} onRun={() => runNode(contextNode.id)} onFocus={contextShotVideoId ? () => { setContextNodeMenu(undefined); void focusShot(contextShotVideoId); } : undefined} onOpen={() => setContextNodeMenu(undefined)} onDelete={() => removeNodes([contextNode.id])} />}
					{contextEdgeMenu && contextEdge && <EdgeContextMenu position={{ left: contextEdgeMenu.left, top: contextEdgeMenu.top }} onOpen={() => setContextEdgeMenu(undefined)} onDelete={() => removeEdges([contextEdge.id])} />}
					{notice && <div className="canvas-notice" role="status"><span>{notice}</span><button className="icon-button" aria-label="Dismiss notice" onClick={() => setNotice(undefined)}>×</button></div>}
				</main>
				{(selectedNodeId || selectedEdgeId) && <Inspector project={project} providers={providers} selectedNodeId={selectedNodeId} selectedEdgeId={selectedEdgeId} editProject={editProject} running={locked} onRunNode={runNode} onImportFiles={nodeId => vscode.postMessage({ type: 'importFiles', project: projectRef.current, revision: revisionRef.current, nodeId })} onRemoveNode={id => removeNodes([id])} onRemoveEdge={id => removeEdges([id])} onOpenOutput={path => vscode.postMessage({ type: 'openOutput', path })} />}
			</div>
			<SequenceBar project={project} mediaUris={mediaUris} selectedNodeId={selectedNodeId} focusedVideoId={focusedVideoId} locked={locked} onSelect={navigateToShot} onPreview={() => setSequencePreviewOpen(true)} editProject={editProject} />
			{runPanelOpen && <RunPanel project={project} nodeIds={runReady} providers={providers} onClose={() => setRunPanelOpen(false)} onRun={() => { setRunPanelOpen(false); setRunningNodeId('workflow'); setStatus({ label: 'Starting workflow', tone: 'running' }); vscode.postMessage({ type: 'runReady', project: projectRef.current, revision: revisionRef.current }); }} />}
			{sequencePreviewOpen && <SequencePreviewPanel project={project} mediaUris={mediaUris} onClose={() => setSequencePreviewOpen(false)} />}
		</div>
	);
}

function MediaNodeCard({ data, selected }: NodeProps<MediaFlowNode>): JSX.Element {
	const node = data.node;
	const status = node.kind === 'text' ? data.readiness : node.status;
	return <div className={`media-node kind-${node.kind}${selected ? ' selected' : ''}${status === 'running' ? ' running' : ''}`}>
		<Handle type="target" position={Position.Left} aria-label={`${mediaKindLabel(node.kind)} input`} title="Input" />
		<div className="node-header"><span className="media-kind">{mediaKindLabel(node.kind)}</span><span className={`node-status status-${status.replace(/\s+/g, '-').toLowerCase()}`}>{status}</span></div>
		{node.kind !== 'text' && (data.previewUri ? <MediaPreview uri={data.previewUri} kind={data.previewKind ?? node.kind} title={node.title} /> : <div className={`media-placeholder placeholder-${node.kind}`}>{node.kind === 'image' ? 'IMG' : node.kind === 'video' ? 'VID' : 'AUD'}</div>)}
		<div className="node-title">{node.title}</div>
		<div className="node-summary">{nodeSummary(node, data.summary)}</div>
		<div className="node-footer"><span>{nodeRole(node)}</span><span>{nodeMetric(node)}</span></div>
		<Handle type="source" position={Position.Right} aria-label={`${mediaKindLabel(node.kind)} output`} title={`${mediaKindLabel(node.kind)} output`} />
	</div>;
}

function ShotGroupCard({ data }: NodeProps<GroupFlowNode>): JSX.Element {
	return <div className="shot-group-card"><div><strong>{data.group.title}</strong><span>{data.group.description || 'One clip production pipeline'}</span></div></div>;
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
	return <div className="media-placeholder placeholder-text">T</div>;
}

function AddMenu({ onAdd, onAddShot, contextPosition }: { readonly onAdd: (kind: AIProjectMediaKind) => void; readonly onAddShot: () => void; readonly contextPosition?: { readonly left: number; readonly top: number } }): JSX.Element {
	return <div className={`add-menu${contextPosition ? ' context' : ''}`} style={contextPosition} role="menu">
		<div className="menu-label">Media</div>
		{(['text', 'image', 'video', 'audio'] as const).map(kind => <button key={kind} role="menuitem" onClick={() => onAdd(kind)}><span className={`menu-kind kind-${kind}`}>{kind === 'text' ? 'T' : kind === 'image' ? 'I' : kind === 'video' ? 'V' : 'A'}</span><span><strong>{mediaKindLabel(kind)}</strong><small>{addDescription(kind)}</small></span></button>)}
		<div className="menu-label structure-label">Structure</div>
		<button role="menuitem" onClick={onAddShot}><span className="menu-kind">S</span><span><strong>Shot Group</strong><small>Storyboard to one ordered clip</small></span></button>
	</div>;
}

function NodeContextMenu({ position, node, canRun, onOpen, onRun, onFocus, onDelete }: {
	readonly position: { readonly left: number; readonly top: number };
	readonly node: AIProjectNode;
	readonly canRun: boolean;
	readonly onOpen: () => void;
	readonly onRun: () => void;
	readonly onFocus?: () => void;
	readonly onDelete: () => void;
}): JSX.Element {
	return <div className="node-context-menu" style={position} role="menu" aria-label={`${node.title} actions`}>
		<button role="menuitem" onClick={onOpen}>Edit details</button>
		{onFocus && <button role="menuitem" onClick={onFocus}>Focus shot</button>}
		{canRun && <button role="menuitem" onClick={onRun}>Run node</button>}
		<div className="context-separator" />
		<button className="danger" role="menuitem" onClick={onDelete}>Delete node</button>
	</div>;
}

function EdgeContextMenu({ position, onOpen, onDelete }: {
	readonly position: { readonly left: number; readonly top: number };
	readonly onOpen: () => void;
	readonly onDelete: () => void;
}): JSX.Element {
	return <div className="node-context-menu" style={position} role="menu" aria-label="Connection actions">
		<button role="menuitem" onClick={onOpen}>Inspect connection</button>
		<div className="context-separator" />
		<button className="danger" role="menuitem" onClick={onDelete}>Remove connection</button>
	</div>;
}

function Inspector({ project, providers, selectedNodeId, selectedEdgeId, editProject, running, onRunNode, onImportFiles, onRemoveNode, onRemoveEdge, onOpenOutput }: {
	readonly project: AIProject;
	readonly providers: readonly AIMediaProviderOption[];
	readonly selectedNodeId: string | undefined;
	readonly selectedEdgeId: string | undefined;
	readonly editProject: (mutation: ProjectMutation) => void;
	readonly running: boolean;
	readonly onRunNode: (id: string) => void;
	readonly onImportFiles: (id: string) => void;
	readonly onRemoveNode: (id: string) => void;
	readonly onRemoveEdge: (id: string) => void;
	readonly onOpenOutput: (path: string) => void;
}): JSX.Element {
	const edge = selectedEdgeId ? project.edges.find(candidate => candidate.id === selectedEdgeId) : undefined;
	if (edge) {
		return <aside className="inspector"><InspectorHeader title={`${mediaKindLabel(edge.media)} connection`} subtitle={`${nodeById(project, edge.source)?.title ?? edge.source} to ${nodeById(project, edge.target)?.title ?? edge.target}`} /><div className="inspector-scroll"><p className="inspector-copy">This connection passes the selected {edge.media} result downstream.</p><button className="button danger full" onClick={() => onRemoveEdge(edge.id)}>Remove connection</button></div></aside>;
	}
	const node = selectedNodeId ? nodeById(project, selectedNodeId) : undefined;
	if (!node) {
		return <aside className="inspector" />;
	}
	return <aside className="inspector">
		<InspectorHeader title={node.title} subtitle={`${mediaKindLabel(node.kind)} · ${nodeRole(node)}`} />
		<div className="inspector-scroll">
			<Field label="Name"><input value={node.title} onChange={event => editProject(next => updateNode(next, node.id, value => { value.title = event.target.value; }))} /></Field>
			{node.kind === 'text' ? <TextFields project={project} node={node} editProject={editProject} onImportFiles={onImportFiles} /> : <MediaFields project={project} node={node} providers={providers} editProject={editProject} onImportFiles={onImportFiles} />}
			{isExecutableNode(node) && <RunHistory project={project} node={node} running={running} editProject={editProject} onRunNode={onRunNode} onOpenOutput={onOpenOutput} />}
			<details className="more-actions"><summary>More actions</summary><button className="button danger full" onClick={() => onRemoveNode(node.id)}>Delete node</button></details>
		</div>
	</aside>;
}

function InspectorHeader({ title, subtitle }: { readonly title: string; readonly subtitle: string }): JSX.Element {
	return <div className="inspector-header"><h2>{title}</h2><p>{subtitle}</p></div>;
}

function TextFields({ project, node, editProject, onImportFiles }: { readonly project: AIProject; readonly node: AIProjectTextNode; readonly editProject: (mutation: ProjectMutation) => void; readonly onImportFiles: (id: string) => void }): JSX.Element {
	return <>
		<Field label="Purpose"><select value={node.role} onChange={event => editProject(next => updateNode(next, node.id, value => { if (value.kind === 'text') { value.role = event.target.value as AIProjectTextNode['role']; invalidateDownstreamNodes(next, [value.id]); } }))}>{['brief', 'script', 'storyboard', 'imagePrompt', 'videoPrompt', 'dialogue', 'note'].map(role => <option key={role} value={role}>{roleLabel(role)}</option>)}</select></Field>
		<Field label="Content"><textarea rows={18} value={node.content} placeholder="Write here, import content, or ask the Agent to fill this block." onChange={event => editProject(next => updateNode(next, node.id, value => { if (value.kind === 'text') { value.content = event.target.value; invalidateDownstreamNodes(next, [value.id]); } }))} /></Field>
		<button className="text-button import-files" onClick={() => onImportFiles(node.id)}>Import text files…</button>
		<div className="derived-note"><strong>Downstream context</strong><span>{project.edges.filter(edge => edge.source === node.id).length} connected nodes use this text.</span></div>
	</>;
}

function MediaFields({ project, node, providers, editProject, onImportFiles }: { readonly project: AIProject; readonly node: AIProjectExecutableNode; readonly providers: readonly AIMediaProviderOption[]; readonly editProject: (mutation: ProjectMutation) => void; readonly onImportFiles: (id: string) => void }): JSX.Element {
	const compatibleProviders = providers.filter(provider => provider.kinds.includes(node.kind));
	const provider = compatibleProviders.find(candidate => candidate.id === node.provider);
	return <>
		<div className="readiness-card"><strong>{nodeReadiness(project, node.id).label}</strong><span>{nodeReadiness(project, node.id).reason ?? 'This node has the inputs required for its next run.'}</span></div>
		<Field label="Source"><select value={node.source} onChange={event => editProject(next => updateExecutable(next, node.id, value => { value.source = event.target.value as AIProjectExecutableNode['source']; invalidateDownstreamNodes(next, [value.id]); }))}><option value="generate">Generate with AI</option><option value="local">Use local media</option></select></Field>
		{node.source === 'generate' && <>
			<Field label="Node-specific instructions"><textarea rows={7} value={node.prompt} placeholder="Connected Text blocks are included automatically. Add only instructions specific to this node." onChange={event => editProject(next => updateExecutable(next, node.id, value => { value.prompt = event.target.value; invalidateDownstreamNodes(next, [value.id]); }))} /></Field>
			<div className="prompt-preview"><strong>Effective prompt</strong><pre>{nodePrompt(project, node.id) || 'Connect a Text block or write node-specific instructions.'}</pre></div>
			<Field label="Avoid"><textarea rows={3} value={node.negativePrompt} onChange={event => editProject(next => updateExecutable(next, node.id, value => { value.negativePrompt = event.target.value; invalidateDownstreamNodes(next, [value.id]); }))} /></Field>
			<Field label="Model service"><select value={node.provider} onChange={event => editProject(next => updateExecutable(next, node.id, value => { value.provider = event.target.value; invalidateDownstreamNodes(next, [value.id]); }))}>{compatibleProviders.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></Field>
			<Field label="Model"><input value={node.model} placeholder="auto" onChange={event => editProject(next => updateExecutable(next, node.id, value => { value.model = event.target.value; invalidateDownstreamNodes(next, [value.id]); }))} /></Field>
		</>}
		<Field label={node.source === 'local' ? 'Local project files' : 'Additional local inputs'}><textarea rows={4} value={node.inputFiles.join('\n')} placeholder="One relative project path per line" onChange={event => editProject(next => updateExecutable(next, node.id, value => { value.inputFiles = lines(event.target.value); invalidateDownstreamNodes(next, [value.id]); }))} /></Field>
		<button className="text-button import-files" onClick={() => onImportFiles(node.id)}>Import media files…</button>
		{node.kind === 'image' && <ImageSettings node={node} editProject={editProject} />}
		{node.kind === 'video' && <VideoSettings node={node} provider={provider} editProject={editProject} />}
		{node.kind === 'audio' && <AudioSettings node={node} editProject={editProject} />}
	</>;
}

function ImageSettings({ node, editProject }: { readonly node: AIProjectImageNode; readonly editProject: (mutation: ProjectMutation) => void }): JSX.Element {
	return <InspectorSection title="Image settings"><div className="field-row"><Field label="Frame"><input value={node.aspectRatio} onChange={event => editProject(next => updateExecutable(next, node.id, value => { if (value.kind === 'image') { value.aspectRatio = event.target.value; } }))} /></Field><Field label="Results"><input type="number" min="1" max="16" value={node.count} onChange={event => editProject(next => updateExecutable(next, node.id, value => { if (value.kind === 'image') { value.count = numberInput(event.target.value, 1); } }))} /></Field></div></InspectorSection>;
}

function VideoSettings({ node, provider, editProject }: { readonly node: AIProjectVideoNode; readonly provider: AIMediaProviderOption | undefined; readonly editProject: (mutation: ProjectMutation) => void }): JSX.Element {
	return <InspectorSection title="Video settings"><div className="field-row"><Field label="Frame"><input value={node.aspectRatio} onChange={event => editProject(next => updateExecutable(next, node.id, value => { if (value.kind === 'video') { value.aspectRatio = event.target.value; } }))} /></Field><Field label="Seconds"><input type="number" min="1" max="120" value={node.durationSeconds} onChange={event => editProject(next => updateExecutable(next, node.id, value => { if (value.kind === 'video') { value.durationSeconds = numberInput(event.target.value, 5); } }))} /></Field></div><Field label="Audio"><select value={node.audioMode} onChange={event => editProject(next => updateExecutable(next, node.id, value => { if (value.kind === 'video') { value.audioMode = event.target.value as AIProjectVideoNode['audioMode']; } }))}><option value="auto">Auto</option><option value="generate" disabled={provider?.supportsNativeAudio !== true}>Generate with video</option><option value="none">No audio</option></select></Field>{node.audioMode === 'generate' && provider?.supportsNativeAudio !== true && <div className="inline-warning">The selected model service does not report native-audio support.</div>}</InspectorSection>;
}

function AudioSettings({ node, editProject }: { readonly node: AIProjectAudioNode; readonly editProject: (mutation: ProjectMutation) => void }): JSX.Element {
	return <InspectorSection title="Audio settings"><div className="field-row"><Field label="Purpose"><select value={node.role} onChange={event => editProject(next => updateExecutable(next, node.id, value => { if (value.kind === 'audio') { value.role = event.target.value as AIProjectAudioNode['role']; } }))}><option value="voice">Voice</option><option value="music">Music</option><option value="effect">Sound effect</option><option value="reference">Reference</option></select></Field><Field label="Seconds"><input type="number" min="1" max="3600" value={node.durationSeconds} onChange={event => editProject(next => updateExecutable(next, node.id, value => { if (value.kind === 'audio') { value.durationSeconds = numberInput(event.target.value, 5); } }))} /></Field></div><Field label="Voice"><input value={node.voice} onChange={event => editProject(next => updateExecutable(next, node.id, value => { if (value.kind === 'audio') { value.voice = event.target.value; } }))} /></Field></InspectorSection>;
}

function RunHistory({ project, node, running, editProject, onRunNode, onOpenOutput }: { readonly project: AIProject; readonly node: AIProjectExecutableNode; readonly running: boolean; readonly editProject: (mutation: ProjectMutation) => void; readonly onRunNode: (id: string) => void; readonly onOpenOutput: (path: string) => void }): JSX.Element {
	const readiness = nodeReadiness(project, node.id);
	return <InspectorSection title="Runs">
		<button className="button primary full run-node" disabled={running || node.source === 'local' || !readiness.ready} title={!readiness.ready ? readiness.reason : undefined} onClick={() => onRunNode(node.id)}>Run this {node.kind}</button>
		{node.error && <div className="inline-error">{node.error}</div>}
		{node.runs.length ? <div className="run-history">{[...node.runs].reverse().map(run => <div key={run.id} className={`run-record${selectedRun(node)?.id === run.id ? ' selected' : ''}`}><button className="run-select" onClick={() => editProject(next => updateExecutable(next, node.id, value => { value.selectedRunId = run.id; invalidateDownstreamNodes(next, [value.id], false); }))}><strong>{formatRunTime(run.createdAt)}</strong><span>{run.provider} · {run.status}</span></button><div className="run-outputs">{run.outputs.map(output => <button key={output} className="output-link" title={output} onClick={() => onOpenOutput(output)}>{output.split('/').at(-1)}</button>)}</div></div>)}</div> : <p className="muted">No runs yet. Every completed run will remain here.</p>}
	</InspectorSection>;
}

function SequenceBar({ project, mediaUris, selectedNodeId, focusedVideoId, locked, onSelect, onPreview, editProject }: { readonly project: AIProject; readonly mediaUris: Readonly<Record<string, string>>; readonly selectedNodeId: string | undefined; readonly focusedVideoId: string | undefined; readonly locked: boolean; readonly onSelect: (id: string) => void; readonly onPreview: () => void; readonly editProject: (mutation: ProjectMutation) => void }): JSX.Element {
	const selectedVideo = selectedNodeId ? nodeById(project, selectedNodeId) : undefined;
	const canAddSelected = selectedVideo?.kind === 'video' && !project.sequence.some(item => item.videoNodeId === selectedVideo.id);
	const playableCount = playableSequenceClips(project, mediaUris).length;
	return <section className="sequence-bar" aria-label="Clip playback sequence"><div className="sequence-heading"><strong>Sequence</strong><span>Playback order only</span></div><div className="sequence-items">{project.sequence.length ? project.sequence.map((item, index) => {
		const node = nodeById(project, item.videoNodeId);
		if (node?.kind !== 'video') { return null; }
		return <div key={item.id} className={`sequence-item${focusedVideoId === node.id ? ' selected' : ''}`}><button className="sequence-main" onClick={() => onSelect(node.id)}><span>{index + 1}</span><strong>{project.groups.find(group => group.id === node.groupId)?.title ?? node.title}</strong><small>{selectedOutputPaths(node).length ? 'Result selected' : 'No result yet'}</small></button><div className="sequence-actions"><button disabled={locked || index === 0} onClick={() => editProject(next => moveSequence(next, index, index - 1))}>Earlier</button><button disabled={locked || index === project.sequence.length - 1} onClick={() => editProject(next => moveSequence(next, index, index + 1))}>Later</button><button disabled={locked} onClick={() => editProject(next => { next.sequence = next.sequence.filter(candidate => candidate.id !== item.id); })}>Remove</button></div></div>;
	}) : <span className="sequence-empty">Add Video nodes to define clip order.</span>}</div><div className="sequence-tail">{project.sequence.length > 0 && <button className="button secondary" disabled={playableCount !== project.sequence.length} title={playableCount !== project.sequence.length ? `${project.sequence.length - playableCount} ordered clip result${project.sequence.length - playableCount === 1 ? '' : 's'} still missing` : 'Play selected clip results in order'} onClick={onPreview}>Preview sequence</button>}{canAddSelected && <button className="button secondary sequence-add" disabled={locked} onClick={() => editProject(next => next.sequence.push({ id: createId('sequence'), videoNodeId: selectedVideo.id }))}>Add selected video</button>}</div></section>;
}

function SequencePreviewPanel({ project, mediaUris, onClose }: { readonly project: AIProject; readonly mediaUris: Readonly<Record<string, string>>; readonly onClose: () => void }): JSX.Element {
	const clips = playableSequenceClips(project, mediaUris);
	const [index, setIndex] = useState(0);
	const clip = clips[index];
	if (!clip) {
		return <></>;
	}
	return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) { onClose(); } }}><section className="sequence-preview-panel" role="dialog" aria-modal="true" aria-labelledby="sequence-preview-title"><div className="run-panel-heading"><div><h2 id="sequence-preview-title">Sequence preview</h2><p>Selected clip results play in order. No files are merged or changed.</p></div><button className="icon-button" aria-label="Close sequence preview" onClick={onClose}>×</button></div><div className="sequence-player"><video key={clip.uri} src={clip.uri} controls autoPlay onEnded={() => { if (index < clips.length - 1) { setIndex(index + 1); } }} /><div className="sequence-player-caption"><span>{index + 1} / {clips.length}</span><strong>{clip.title}</strong></div></div><div className="run-panel-actions"><button className="button secondary" disabled={index === 0} onClick={() => setIndex(value => value - 1)}>Previous clip</button><button className="button secondary" disabled={index === clips.length - 1} onClick={() => setIndex(value => value + 1)}>Next clip</button><button className="button primary" onClick={onClose}>Done</button></div></section></div>;
}

function RunPanel({ project, nodeIds, providers, onClose, onRun }: { readonly project: AIProject; readonly nodeIds: readonly string[]; readonly providers: readonly AIMediaProviderOption[]; readonly onClose: () => void; readonly onRun: () => void }): JSX.Element {
	const nodes = nodeIds.map(id => nodeById(project, id)).filter((node): node is AIProjectExecutableNode => !!node && isExecutableNode(node));
	return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) { onClose(); } }}><section className="run-panel" role="dialog" aria-modal="true" aria-labelledby="run-title"><div className="run-panel-heading"><div><h2 id="run-title">Run ready media</h2><p>Each result is saved as a new local history entry.</p></div><button className="icon-button" aria-label="Close run review" onClick={onClose}>×</button></div>{nodes.length ? <div className="run-list">{nodes.map(node => <div key={node.id}><span className={`run-kind kind-${node.kind}`}>{mediaKindLabel(node.kind)}</span><div><strong>{node.title}</strong><small>{providers.find(provider => provider.id === node.provider)?.label ?? node.provider} · {node.model}</small></div></div>)}</div> : <div className="run-empty"><strong>Nothing is ready</strong><p>Fill the highlighted prompts or connect the required inputs first.</p></div>}<div className="run-panel-actions"><button className="button secondary" onClick={onClose}>Back to canvas</button><button className="button primary" disabled={!nodes.length} onClick={onRun}>Run {nodes.length} node{nodes.length === 1 ? '' : 's'}</button></div></section></div>;
}

function InspectorSection({ title, children }: { readonly title: string; readonly children: ReactNode }): JSX.Element {
	return <section className="inspector-section"><h3>{title}</h3>{children}</section>;
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
		return summarize(resolvedSummary, 'Empty text block. Ask the Agent or write directly.');
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

function nodeRole(node: AIProjectNode): string {
	return node.role === 'imagePrompt' ? 'Image prompt' : node.role === 'videoPrompt' ? 'Video prompt' : node.role;
}

function nodeMetric(node: AIProjectNode): string {
	if (node.kind === 'text') { return `${node.content.length} chars`; }
	if (node.kind === 'image') { return `${node.count} result${node.count === 1 ? '' : 's'}`; }
	if (node.kind === 'video') { return `${node.durationSeconds}s`; }
	return `${node.durationSeconds}s`;
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

function lines(value: string): string[] {
	return value.split('\n').map(item => item.trim()).filter(Boolean);
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

createRoot(rootElement).render(<StrictMode><App /></StrictMode>);
