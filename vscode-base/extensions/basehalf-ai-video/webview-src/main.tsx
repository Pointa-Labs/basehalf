/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-no-unexternalized-strings -- This bundled official-plugin webview does not load the workbench localization runtime. */

import {
	Background,
	BackgroundVariant,
	ConnectionLineType,
	Controls,
	Handle,
	MarkerType,
	MiniMap,
	Position,
	ReactFlow,
	ReactFlowProvider,
	useReactFlow,
	type Connection,
	type Edge,
	type Node,
	type NodeProps,
	type NodeTypes
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
	AI_VIDEO_BRIEF_NODE_ID,
	AI_VIDEO_SCRIPT_NODE_ID,
	composeShotPrompt,
	createId,
	createWorkflowEdgeId,
	invalidateDownstreamShots,
	synchronizeShotSceneIds,
	validateWorkflowConnection,
	workflowNodeKind,
	type AIProject,
	type AIProjectShotStatus,
	type AIProjectWorkflowEdgeKind,
	type AIProjectWorkflowNodeKind,
	type AIProjectWorkflowPosition
} from '../src/model';
import './styles.css';

interface ProviderOption {
	readonly id: string;
	readonly label: string;
}

interface InitialState {
	readonly project: AIProject;
	readonly revision: string;
	readonly videoProviders: readonly ProviderOption[];
	readonly voiceProviders: readonly ProviderOption[];
}

interface WorkflowNodeData extends Record<string, unknown> {
	readonly nodeId: string;
	readonly kind: AIProjectWorkflowNodeKind;
	readonly title: string;
	readonly summary: string;
	readonly metadata: string;
	readonly readiness?: string;
	readonly status?: AIProjectShotStatus;
	readonly running: boolean;
	readonly workflowRunning: boolean;
	readonly onRun: (nodeId: string) => void;
}

type WorkflowFlowNode = Node<WorkflowNodeData, 'workflow'>;
type WorkflowFlowEdge = Edge;
type ProjectMutation = (project: AIProject) => void;
type StatusTone = 'normal' | 'running' | 'error';

const vscode = acquireVsCodeApi();
const rootElement = document.getElementById('root');
if (!rootElement) {
	throw new Error('AI Video workflow root is missing.');
}
const initialState = JSON.parse(rootElement.dataset.initialState ?? '') as InitialState;

const nodeTypes: NodeTypes = { workflow: WorkflowNodeCard };

function App(): JSX.Element {
	return <ReactFlowProvider><WorkflowEditor /></ReactFlowProvider>;
}

function WorkflowEditor(): JSX.Element {
	const [project, setProject] = useState<AIProject>(initialState.project);
	const [revision, setRevision] = useState(initialState.revision);
	const [videoProviders, setVideoProviders] = useState<readonly ProviderOption[]>(initialState.videoProviders);
	const [voiceProviders, setVoiceProviders] = useState<readonly ProviderOption[]>(initialState.voiceProviders);
	const [dirty, setDirty] = useState(false);
	const [runningShotId, setRunningShotId] = useState<string | undefined>();
	const [status, setStatus] = useState<{ label: string; tone: StatusTone }>({ label: 'Saved', tone: 'normal' });
	const [banner, setBanner] = useState<{ message: string; action?: 'reload' } | undefined>();
	const [notice, setNotice] = useState<string | undefined>();
	const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(AI_VIDEO_BRIEF_NODE_ID);
	const [selectedEdgeId, setSelectedEdgeId] = useState<string | undefined>();
	const canvasRef = useRef<HTMLDivElement>(null);
	const projectRef = useRef(project);
	const revisionRef = useRef(revision);
	const dirtyRef = useRef(dirty);
	const reactFlow = useReactFlow<WorkflowFlowNode, WorkflowFlowEdge>();
	const running = runningShotId !== undefined;
	projectRef.current = project;
	revisionRef.current = revision;
	dirtyRef.current = dirty;

	const updateDirty = useCallback((value: boolean): void => {
		dirtyRef.current = value;
		setDirty(value);
		setStatus(value ? { label: 'Unsaved', tone: 'normal' } : { label: 'Saved', tone: 'normal' });
		vscode.postMessage({ type: 'dirty', dirty: value });
	}, []);

	const editProject = useCallback((mutation: ProjectMutation): void => {
		setProject(current => {
			const next = structuredClone(current);
			mutation(next);
			return next;
		});
		if (!dirtyRef.current) {
			updateDirty(true);
		}
	}, [updateDirty]);

	const save = useCallback((): void => {
		vscode.postMessage({ type: 'save', project: projectRef.current, revision: revisionRef.current });
	}, []);

	const runShot = useCallback((shotId: string): void => {
		vscode.postMessage({ type: 'runShot', project: projectRef.current, revision: revisionRef.current, shotId });
	}, []);

	const runPending = useCallback((): void => {
		vscode.postMessage({ type: 'runPending', project: projectRef.current, revision: revisionRef.current });
	}, []);

	const prepareAgent = useCallback((): void => {
		vscode.postMessage({ type: 'prepareAgent', project: projectRef.current, revision: revisionRef.current });
		setStatus({ label: 'Preparing Agent', tone: 'running' });
	}, []);

	useEffect(() => {
		const listener = (event: MessageEvent): void => {
			const message = event.data as Record<string, unknown>;
			switch (message.type) {
				case 'saved':
					setRevision(String(message.revision ?? ''));
					updateDirty(false);
					setRunningShotId(undefined);
					break;
				case 'agentReady':
					setRevision(String(message.revision ?? ''));
					updateDirty(false);
					setNotice(String(message.message ?? 'Agent build brief copied.'));
					break;
				case 'project':
					setProject(message.project as AIProject);
					setRevision(String(message.revision ?? ''));
					setVideoProviders((message.videoProviders as readonly ProviderOption[] | undefined) ?? initialState.videoProviders);
					setVoiceProviders((message.voiceProviders as readonly ProviderOption[] | undefined) ?? initialState.voiceProviders);
					updateDirty(false);
					if (message.running !== true) {
						setRunningShotId(undefined);
					}
					setBanner(undefined);
					break;
				case 'providers':
					setVideoProviders((message.videoProviders as readonly ProviderOption[] | undefined) ?? []);
					setVoiceProviders((message.voiceProviders as readonly ProviderOption[] | undefined) ?? []);
					break;
				case 'running':
					setRunningShotId(String(message.shotId ?? 'running'));
					setProject(current => {
						const next = structuredClone(current);
						const shot = next.shots.find(candidate => candidate.id === message.shotId);
						if (shot) {
							shot.status = 'running';
							delete shot.error;
						}
						return next;
					});
					setStatus({ label: String(message.label ?? 'Running'), tone: 'running' });
					break;
				case 'cancelled':
					setRunningShotId(undefined);
					setStatus({ label: 'Cancelled', tone: 'normal' });
					break;
				case 'error':
					if (message.running !== true) {
						setRunningShotId(undefined);
					}
					setStatus(message.running === true ? { label: 'Running', tone: 'running' } : { label: 'Error', tone: 'error' });
					setBanner({ message: String(message.message ?? 'The workflow could not be completed.') });
					break;
				case 'externalChange':
					setBanner({ message: 'This project changed on disk while local edits are unsaved.', action: 'reload' });
					break;
			}
		};
		window.addEventListener('message', listener);
		return () => window.removeEventListener('message', listener);
	}, [updateDirty]);

	useEffect(() => {
		const listener = (event: KeyboardEvent): void => {
			if (!running && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
				event.preventDefault();
				save();
			}
		};
		window.addEventListener('keydown', listener);
		return () => window.removeEventListener('keydown', listener);
	}, [running, save]);

	const flowNodes = useMemo<WorkflowFlowNode[]>(() => project.workflow.nodes.map(node => ({
		id: node.id,
		type: 'workflow',
		position: node.position,
		selected: selectedNodeId === node.id,
		data: workflowNodeData(project, node.id, runningShotId, runShot)
	})), [project, runShot, runningShotId, selectedNodeId]);

	const flowEdges = useMemo<WorkflowFlowEdge[]>(() => project.workflow.edges.map(edge => ({
		id: edge.id,
		source: edge.source,
		target: edge.target,
		type: 'smoothstep',
		className: `workflow-edge edge-${edge.kind}`,
		selected: selectedEdgeId === edge.id,
		animated: edge.target === runningShotId,
		markerEnd: { type: MarkerType.ArrowClosed },
		ariaLabel: edge.kind === 'sequence'
			? `${nodeLabel(project, edge.source)} continues into ${nodeLabel(project, edge.target)}`
			: `${nodeLabel(project, edge.source)} provides context to ${nodeLabel(project, edge.target)}`
	})), [project, runningShotId, selectedEdgeId]);

	const addNode = useCallback((kind: Exclude<AIProjectWorkflowNodeKind, 'brief' | 'script'>): void => {
		const bounds = canvasRef.current?.getBoundingClientRect();
		const position = bounds
			? reactFlow.screenToFlowPosition({ x: bounds.left + bounds.width * 0.52, y: bounds.top + bounds.height * 0.42 })
			: { x: 520, y: 260 };
		const nodeId = createId(kind);
		editProject(next => {
			switch (kind) {
				case 'character':
					next.characters.push({ id: nodeId, name: `Character ${next.characters.length + 1}`, description: '', referenceFiles: [] });
					break;
				case 'scene':
					next.scenes.push({ id: nodeId, name: `Scene ${next.scenes.length + 1}`, description: '', continuity: '' });
					break;
				case 'style':
					next.styles.push({ id: nodeId, name: `Visual direction ${next.styles.length + 1}`, description: '', prompt: '', negativePrompt: '', referenceFiles: [] });
					break;
				case 'shot':
					next.shots.push({
						id: nodeId,
						title: `Shot ${next.shots.length + 1}`,
						sceneId: '',
						storyboard: '',
						camera: '',
						motion: '',
						prompt: '',
						negativePrompt: '',
						dialogue: '',
						audio: '',
						durationSeconds: 5,
						startFrame: '',
						endFrame: '',
						videoProvider: videoProviders[0]?.id ?? 'prompt-package',
						voiceProvider: 'none',
						status: 'draft',
						outputs: []
					});
					break;
			}
			next.workflow.nodes.push({ id: nodeId, kind, position });
		});
		setSelectedEdgeId(undefined);
		setSelectedNodeId(nodeId);
	}, [editProject, reactFlow, videoProviders]);

	const removeNodes = useCallback((ids: readonly string[]): void => {
		const removable = new Set(ids.filter(id => id !== AI_VIDEO_BRIEF_NODE_ID && id !== AI_VIDEO_SCRIPT_NODE_ID));
		if (!removable.size) {
			setNotice('Brief and Script are required workflow nodes.');
			return;
		}
		editProject(next => {
			const affectedTargets = next.workflow.edges
				.filter(edge => removable.has(edge.source) && !removable.has(edge.target))
				.map(edge => edge.target);
			next.characters = next.characters.filter(item => !removable.has(item.id));
			next.scenes = next.scenes.filter(item => !removable.has(item.id));
			next.styles = next.styles.filter(item => !removable.has(item.id));
			next.shots = next.shots.filter(item => !removable.has(item.id));
			next.workflow.nodes = next.workflow.nodes.filter(node => !removable.has(node.id));
			next.workflow.edges = next.workflow.edges.filter(edge => !removable.has(edge.source) && !removable.has(edge.target));
			synchronizeShotSceneIds(next);
			invalidateDownstreamShots(next, affectedTargets);
		});
		setSelectedNodeId(undefined);
		setSelectedEdgeId(undefined);
	}, [editProject]);

	const removeEdges = useCallback((ids: readonly string[]): void => {
		const protectedIds = new Set(projectRef.current.workflow.edges
			.filter(edge => edge.source === AI_VIDEO_BRIEF_NODE_ID && edge.target === AI_VIDEO_SCRIPT_NODE_ID)
			.map(edge => edge.id));
		const removed = new Set(ids.filter(id => !protectedIds.has(id)));
		if (!removed.size) {
			setNotice('The Creative brief to Script connection is required.');
			return;
		}
		editProject(next => {
			const affectedTargets = next.workflow.edges.filter(edge => removed.has(edge.id)).map(edge => edge.target);
			next.workflow.edges = next.workflow.edges.filter(edge => !removed.has(edge.id));
			synchronizeShotSceneIds(next);
			invalidateDownstreamShots(next, affectedTargets);
		});
		setSelectedEdgeId(undefined);
	}, [editProject]);

	const connect = useCallback((connection: Connection): void => {
		if (!connection.source || !connection.target) {
			return;
		}
		const validation = validateWorkflowConnection(projectRef.current, connection.source, connection.target);
		if (!validation.valid || !validation.kind) {
			setNotice(validation.reason ?? 'This connection is not valid.');
			return;
		}
		editProject(next => {
			next.workflow.edges.push({
				id: createWorkflowEdgeId(connection.source!, connection.target!),
				source: connection.source!,
				target: connection.target!,
				kind: validation.kind!
			});
			synchronizeShotSceneIds(next);
			invalidateDownstreamShots(next, [connection.target!]);
		});
	}, [editProject]);

	const moveNode = useCallback((nodeId: string, position: AIProjectWorkflowPosition): void => {
		editProject(next => {
			const node = next.workflow.nodes.find(candidate => candidate.id === nodeId);
			if (node) {
				node.position = position;
			}
		});
	}, [editProject]);

	return (
		<div className="workflow-app">
			<header className="topbar">
				<div className="title-group">
					<span className="product-label">AI Video</span>
					<input
						className="project-title"
						aria-label="Project title"
						value={project.title}
						onChange={event => editProject(next => {
							next.title = event.target.value;
							invalidateDownstreamShots(next, next.shots.map(shot => shot.id));
						})}
					/>
				</div>
				<div className={`save-status tone-${status.tone}`}>{status.label}</div>
				<div className="topbar-actions">
					{running && <button className="button danger" onClick={() => vscode.postMessage({ type: 'cancel' })}>Cancel</button>}
					<button className="button secondary agent-action" disabled={running} onClick={prepareAgent}>Build with Agent</button>
					<button className="button secondary" disabled={running} onClick={runPending}>Run pending</button>
					<button className="button primary" disabled={!dirty || running} onClick={save}>Save</button>
				</div>
			</header>
			<ProductionStrip project={project} onOpenOutput={path => vscode.postMessage({ type: 'openOutput', path })} />
			{banner && (
				<div className="banner" role="alert">
					<span>{banner.message}</span>
					{banner.action === 'reload' && <button className="button secondary" onClick={() => vscode.postMessage({ type: 'reload' })}>Reload from disk</button>}
					<button className="icon-button" aria-label="Dismiss message" onClick={() => setBanner(undefined)}>×</button>
				</div>
			)}
			<div className="workspace" aria-busy={running} inert={running ? true : undefined}>
				<NodePalette onAdd={addNode} />
				<main className="canvas" ref={canvasRef}>
					<ReactFlow<WorkflowFlowNode, WorkflowFlowEdge>
						nodes={flowNodes}
						edges={flowEdges}
						nodeTypes={nodeTypes}
						fitView
						fitViewOptions={{ padding: 0.2, maxZoom: 0.95 }}
						minZoom={0.25}
						maxZoom={1.8}
						snapToGrid
						snapGrid={[16, 16]}
						connectionLineType={ConnectionLineType.SmoothStep}
						deleteKeyCode={running ? null : ['Backspace', 'Delete']}
						nodesDraggable={!running}
						nodesConnectable={!running}
						onConnect={connect}
						onNodeClick={(_, node) => { setSelectedNodeId(node.id); setSelectedEdgeId(undefined); }}
						onEdgeClick={(_, edge) => { setSelectedEdgeId(edge.id); setSelectedNodeId(undefined); }}
						onPaneClick={() => { setSelectedNodeId(undefined); setSelectedEdgeId(undefined); }}
						onNodeDragStop={(_, node) => moveNode(node.id, node.position)}
						onNodesDelete={nodes => removeNodes(nodes.map(node => node.id))}
						onEdgesDelete={edges => removeEdges(edges.map(edge => edge.id))}
						proOptions={{ hideAttribution: true }}
					>
						<Background variant={BackgroundVariant.Dots} gap={22} size={1} />
						<Controls showInteractive={false} position="bottom-left" />
						<MiniMap
							position="bottom-right"
							pannable
							zoomable
							nodeColor={() => 'var(--vscode-focusBorder)'}
							maskColor="color-mix(in srgb, var(--vscode-editor-background) 78%, transparent)"
						/>
					</ReactFlow>
					<div className="edge-legend" aria-label="Connection legend">
						<span><i className="context-line" />Context</span>
						<span><i className="sequence-line" />Shot order</span>
					</div>
					{notice && <div className="canvas-notice" role="status"><span>{notice}</span><button className="icon-button" aria-label="Dismiss notice" onClick={() => setNotice(undefined)}>×</button></div>}
				</main>
				<Inspector
					project={project}
					videoProviders={videoProviders}
					voiceProviders={voiceProviders}
					selectedNodeId={selectedNodeId}
					selectedEdgeId={selectedEdgeId}
					editProject={editProject}
					onRunShot={runShot}
					running={running}
					onRemoveNode={id => removeNodes([id])}
					onRemoveEdge={id => removeEdges([id])}
					onOpenOutput={path => vscode.postMessage({ type: 'openOutput', path })}
				/>
			</div>
		</div>
	);
}

function ProductionStrip({ project, onOpenOutput }: { readonly project: AIProject; readonly onOpenOutput: (path: string) => void }): JSX.Element {
	const storyboardReady = project.shots.filter(shot => shot.storyboard.trim()).length;
	const promptReady = project.shots.filter(shot => shot.prompt.trim()).length;
	const outputs = project.shots.reduce((total, shot) => total + shot.outputs.length, 0);
	return (
		<div className="production-strip" aria-label="Production status">
			<span><strong>{project.shots.length}</strong> shots</span>
			<span><strong>{storyboardReady}</strong> storyboarded</span>
			<span><strong>{promptReady}</strong> prompt ready</span>
			<span><strong>{outputs}</strong> local outputs</span>
			{project.outputs[0] && <button className="preview-link" onClick={() => onOpenOutput(project.outputs[0])}>Open text preview</button>}
		</div>
	);
}

function WorkflowNodeCard({ data, selected }: NodeProps<WorkflowFlowNode>): JSX.Element {
	return (
		<div className={`workflow-node kind-${data.kind}${selected ? ' selected' : ''}${data.running ? ' running' : ''}`}>
			{data.kind !== 'brief' && <Handle type="target" position={Position.Left} aria-label="Context input" title="Context input" />}
			<div className="node-header">
				<span className="node-kind-key" aria-hidden="true">{nodeKindKey(data.kind)}</span>
				<span className="node-kind-label">{nodeKindLabel(data.kind)}</span>
				{data.status && <span className={`node-status status-${data.status}`}>{data.status}</span>}
			</div>
			<div className="node-title">{data.title}</div>
			<div className="node-summary">{data.summary}</div>
			{data.readiness && <div className="node-readiness">{data.readiness}</div>}
			<div className="node-footer">
				<span>{data.metadata}</span>
				{data.kind === 'shot' && (
					<button className="node-run nodrag nopan" disabled={data.workflowRunning} onClick={event => { event.stopPropagation(); data.onRun(data.nodeId); }}>
						{data.running ? 'Running' : 'Run'}
					</button>
				)}
			</div>
			<Handle type="source" position={Position.Right} aria-label={data.kind === 'shot' ? 'Context or shot sequence output' : 'Context output'} title="Output" />
		</div>
	);
}

function NodePalette({ onAdd }: { readonly onAdd: (kind: Exclude<AIProjectWorkflowNodeKind, 'brief' | 'script'>) => void }): JSX.Element {
	return (
		<aside className="palette" aria-label="Workflow node library">
			<div className="panel-heading">
				<h2>Workflow</h2>
				<p>Plan once. Reuse context across shots.</p>
			</div>
			<PaletteGroup label="Story">
				<PaletteButton kind="character" label="Character" description="Identity and references" onAdd={onAdd} />
				<PaletteButton kind="scene" label="Scene" description="Place and continuity" onAdd={onAdd} />
				<PaletteButton kind="shot" label="Shot" description="Storyboard and execution" onAdd={onAdd} />
			</PaletteGroup>
			<PaletteGroup label="Direction">
				<PaletteButton kind="style" label="Visual direction" description="Reusable look and constraints" onAdd={onAdd} />
			</PaletteGroup>
			<div className="palette-help">
				<strong>How nodes collaborate</strong>
				<p>Context edges carry reusable creative input. Shot-to-shot edges preserve order and continuity.</p>
			</div>
		</aside>
	);
}

function PaletteGroup({ label, children }: { readonly label: string; readonly children: ReactNode }): JSX.Element {
	return <section className="palette-group"><h3>{label}</h3><div className="palette-list">{children}</div></section>;
}

function PaletteButton({ kind, label, description, onAdd }: {
	readonly kind: Exclude<AIProjectWorkflowNodeKind, 'brief' | 'script'>;
	readonly label: string;
	readonly description: string;
	readonly onAdd: (kind: Exclude<AIProjectWorkflowNodeKind, 'brief' | 'script'>) => void;
}): JSX.Element {
	return (
		<button className="palette-item" onClick={() => onAdd(kind)}>
			<span className="palette-key" aria-hidden="true">{nodeKindKey(kind)}</span>
			<span><strong>{label}</strong><small>{description}</small></span>
		</button>
	);
}

function Inspector({ project, videoProviders, voiceProviders, selectedNodeId, selectedEdgeId, editProject, onRunShot, running, onRemoveNode, onRemoveEdge, onOpenOutput }: {
	readonly project: AIProject;
	readonly videoProviders: readonly ProviderOption[];
	readonly voiceProviders: readonly ProviderOption[];
	readonly selectedNodeId: string | undefined;
	readonly selectedEdgeId: string | undefined;
	readonly editProject: (mutation: ProjectMutation) => void;
	readonly onRunShot: (id: string) => void;
	readonly running: boolean;
	readonly onRemoveNode: (id: string) => void;
	readonly onRemoveEdge: (id: string) => void;
	readonly onOpenOutput: (path: string) => void;
}): JSX.Element {
	const edge = selectedEdgeId ? project.workflow.edges.find(candidate => candidate.id === selectedEdgeId) : undefined;
	if (edge) {
		return (
			<aside className="inspector">
				<div className="panel-heading"><h2>{edge.kind === 'sequence' ? 'Shot order' : 'Context flow'}</h2><p>{edge.kind === 'sequence' ? 'The target shot follows and may reuse the prior result.' : 'Reusable project context flows into the target.'}</p></div>
				<div className="dependency-card">
					<div><span>From</span><strong>{nodeLabel(project, edge.source)}</strong></div>
					<div><span>To</span><strong>{nodeLabel(project, edge.target)}</strong></div>
					<div><span>Meaning</span><strong>{edge.kind === 'sequence' ? 'Continuity' : 'Context'}</strong></div>
				</div>
				<button className="button danger full" onClick={() => onRemoveEdge(edge.id)}>Remove connection</button>
			</aside>
		);
	}
	const kind = selectedNodeId ? workflowNodeKind(project, selectedNodeId) : undefined;
	if (!selectedNodeId || !kind) {
		return (
			<aside className="inspector empty-inspector">
				<div className="empty-mark" aria-hidden="true">+</div>
				<h2>Select a node</h2>
				<p>Edit its creative content, inspect its inputs, or run one shot.</p>
			</aside>
		);
	}

	const incoming = project.workflow.edges.filter(candidate => candidate.target === selectedNodeId);
	const outgoing = project.workflow.edges.filter(candidate => candidate.source === selectedNodeId);
	return (
		<aside className="inspector">
			<div className="panel-heading node-inspector-heading">
				<span className="node-kind-key" aria-hidden="true">{nodeKindKey(kind)}</span>
				<div><h2>{nodeKindLabel(kind)}</h2><p>{selectedNodeId}</p></div>
			</div>
			<div className="inspector-scroll">
				<NodeFields project={project} videoProviders={videoProviders} voiceProviders={voiceProviders} nodeId={selectedNodeId} kind={kind} editProject={editProject} onRunShot={onRunShot} running={running} onOpenOutput={onOpenOutput} />
				<div className="connections">
					<h3>Inputs</h3>
					{incoming.length ? incoming.map(item => <ConnectionRow key={item.id} label={nodeLabel(project, item.source)} kind={item.kind} onRemove={() => onRemoveEdge(item.id)} />) : <p className="muted">No incoming context.</p>}
					<h3>Outputs</h3>
					{outgoing.length ? outgoing.map(item => <ConnectionRow key={item.id} label={nodeLabel(project, item.target)} kind={item.kind} onRemove={() => onRemoveEdge(item.id)} />) : <p className="muted">No downstream nodes.</p>}
				</div>
				{kind !== 'brief' && kind !== 'script' && <button className="button danger full" onClick={() => onRemoveNode(selectedNodeId)}>Delete node</button>}
			</div>
		</aside>
	);
}

function NodeFields({ project, videoProviders, voiceProviders, nodeId, kind, editProject, onRunShot, running, onOpenOutput }: {
	readonly project: AIProject;
	readonly videoProviders: readonly ProviderOption[];
	readonly voiceProviders: readonly ProviderOption[];
	readonly nodeId: string;
	readonly kind: AIProjectWorkflowNodeKind;
	readonly editProject: (mutation: ProjectMutation) => void;
	readonly onRunShot: (id: string) => void;
	readonly running: boolean;
	readonly onOpenOutput: (path: string) => void;
}): JSX.Element {
	if (kind === 'brief') {
		return <>
			<InspectorSection title="Intent">
				<Field label="Objective"><textarea rows={6} value={project.brief.objective} placeholder="What should this video make the audience feel or understand?" onChange={event => editProject(next => {
					next.brief.objective = event.target.value;
					invalidateDownstreamShots(next, [nodeId]);
				})} /></Field>
				<Field label="Audience"><input value={project.brief.audience} placeholder="Who is this for?" onChange={event => editProject(next => {
					next.brief.audience = event.target.value;
					invalidateDownstreamShots(next, [nodeId]);
				})} /></Field>
			</InspectorSection>
			<InspectorSection title="Delivery">
				<Field label="Format"><input value={project.brief.format} onChange={event => editProject(next => {
					next.brief.format = event.target.value;
					invalidateDownstreamShots(next, [nodeId]);
				})} /></Field>
				<div className="field-row">
					<Field label="Frame"><select value={project.brief.aspectRatio} onChange={event => editProject(next => {
						next.brief.aspectRatio = event.target.value;
						invalidateDownstreamShots(next, [nodeId]);
					})}><option value="9:16">9:16</option><option value="16:9">16:9</option><option value="1:1">1:1</option><option value="4:3">4:3</option><option value="21:9">21:9</option></select></Field>
					<Field label="Seconds"><input type="number" min="1" max="3600" value={project.brief.targetDurationSeconds} onChange={event => editProject(next => {
						next.brief.targetDurationSeconds = numberInput(event.target.value, 30);
						invalidateDownstreamShots(next, [nodeId]);
					})} /></Field>
				</div>
				<Field label="Language"><input value={project.brief.language} onChange={event => editProject(next => {
					next.brief.language = event.target.value;
					invalidateDownstreamShots(next, [nodeId]);
				})} /></Field>
			</InspectorSection>
		</>;
	}
	if (kind === 'script') {
		return <InspectorSection title="Story"><Field label="Script"><textarea rows={18} value={project.script} placeholder="Write the beats, action, dialogue, and narration." onChange={event => editProject(next => {
			next.script = event.target.value;
			invalidateDownstreamShots(next, [nodeId]);
		})} /></Field></InspectorSection>;
	}
	if (kind === 'character') {
		const character = project.characters.find(item => item.id === nodeId)!;
		return <>
			<InspectorSection title="Identity">
				<Field label="Name"><input value={character.name} onChange={event => editProject(next => {
					next.characters.find(item => item.id === nodeId)!.name = event.target.value;
					invalidateDownstreamShots(next, [nodeId]);
				})} /></Field>
				<Field label="Continuity description"><textarea rows={8} value={character.description} placeholder="Stable appearance, wardrobe, manner, and identity cues." onChange={event => editProject(next => {
					next.characters.find(item => item.id === nodeId)!.description = event.target.value;
					invalidateDownstreamShots(next, [nodeId]);
				})} /></Field>
			</InspectorSection>
			<InspectorSection title="References"><PathListField value={character.referenceFiles} onChange={value => editProject(next => {
				next.characters.find(item => item.id === nodeId)!.referenceFiles = value;
				invalidateDownstreamShots(next, [nodeId]);
			})} /></InspectorSection>
		</>;
	}
	if (kind === 'scene') {
		const scene = project.scenes.find(item => item.id === nodeId)!;
		return <>
			<InspectorSection title="Setting">
				<Field label="Name"><input value={scene.name} onChange={event => editProject(next => {
					next.scenes.find(item => item.id === nodeId)!.name = event.target.value;
					invalidateDownstreamShots(next, [nodeId]);
				})} /></Field>
				<Field label="What the audience sees"><textarea rows={8} value={scene.description} placeholder="Place, time, atmosphere, lighting, and spatial layout." onChange={event => editProject(next => {
					next.scenes.find(item => item.id === nodeId)!.description = event.target.value;
					invalidateDownstreamShots(next, [nodeId]);
				})} /></Field>
			</InspectorSection>
			<InspectorSection title="Continuity"><Field label="Keep stable across shots"><textarea rows={5} value={scene.continuity} placeholder="Objects, weather, screen direction, and state that must not drift." onChange={event => editProject(next => {
				next.scenes.find(item => item.id === nodeId)!.continuity = event.target.value;
				invalidateDownstreamShots(next, [nodeId]);
			})} /></Field></InspectorSection>
		</>;
	}
	if (kind === 'style') {
		const style = project.styles.find(item => item.id === nodeId)!;
		return <>
			<InspectorSection title="Visual system">
				<Field label="Name"><input value={style.name} onChange={event => editProject(next => {
					next.styles.find(item => item.id === nodeId)!.name = event.target.value;
					invalidateDownstreamShots(next, [nodeId]);
				})} /></Field>
				<Field label="Creative direction"><textarea rows={6} value={style.description} placeholder="The visual principles behind the look." onChange={event => editProject(next => {
					next.styles.find(item => item.id === nodeId)!.description = event.target.value;
					invalidateDownstreamShots(next, [nodeId]);
				})} /></Field>
				<Field label="Reusable prompt"><textarea rows={6} value={style.prompt} placeholder="Lighting, texture, palette, lens character, and finish." onChange={event => editProject(next => {
					next.styles.find(item => item.id === nodeId)!.prompt = event.target.value;
					invalidateDownstreamShots(next, [nodeId]);
				})} /></Field>
				<Field label="Avoid"><textarea rows={3} value={style.negativePrompt} placeholder="Provider-neutral exclusions or failure modes." onChange={event => editProject(next => {
					next.styles.find(item => item.id === nodeId)!.negativePrompt = event.target.value;
					invalidateDownstreamShots(next, [nodeId]);
				})} /></Field>
			</InspectorSection>
			<InspectorSection title="References"><PathListField value={style.referenceFiles} onChange={value => editProject(next => {
				next.styles.find(item => item.id === nodeId)!.referenceFiles = value;
				invalidateDownstreamShots(next, [nodeId]);
			})} /></InspectorSection>
		</>;
	}
	const shot = project.shots.find(item => item.id === nodeId)!;
	return <>
		<InspectorSection title="Storyboard">
			<Field label="Shot title"><input value={shot.title} onChange={event => editProject(next => updateShot(next, nodeId, value => { value.title = event.target.value; }))} /></Field>
			<Field label="What happens on screen"><textarea rows={7} value={shot.storyboard} placeholder="One clear visual beat. Describe the start, action, and end state." onChange={event => editProject(next => updateShot(next, nodeId, value => { value.storyboard = event.target.value; }))} /></Field>
			<div className="field-row">
				<Field label="Camera"><input value={shot.camera} placeholder="Medium tracking shot" onChange={event => editProject(next => updateShot(next, nodeId, value => { value.camera = event.target.value; }))} /></Field>
				<Field label="Seconds"><input type="number" min="1" max="120" value={shot.durationSeconds} onChange={event => editProject(next => updateShot(next, nodeId, value => { value.durationSeconds = numberInput(event.target.value, 5); }))} /></Field>
			</div>
			<Field label="Motion and timing"><textarea rows={4} value={shot.motion} placeholder="Subject action, environmental motion, camera movement, direction, and pace." onChange={event => editProject(next => updateShot(next, nodeId, value => { value.motion = event.target.value; }))} /></Field>
		</InspectorSection>
		<InspectorSection title="Execution prompt" action={<button className="text-button" onClick={() => editProject(next => updateShot(next, nodeId, value => { value.prompt = composeShotPrompt(next, nodeId); }))}>Compose from context</button>}>
			<Field label="Prompt"><textarea rows={9} value={shot.prompt} placeholder="Direct visual and motion instructions for the selected provider." onChange={event => editProject(next => updateShot(next, nodeId, value => { value.prompt = event.target.value; }))} /></Field>
			<Field label="Avoid"><textarea rows={3} value={shot.negativePrompt} placeholder="Unwanted content or motion. Connectors may translate this for provider support." onChange={event => editProject(next => updateShot(next, nodeId, value => { value.negativePrompt = event.target.value; }))} /></Field>
			<Field label="First frame file"><input value={shot.startFrame} placeholder="Optional local project path" onChange={event => editProject(next => updateShot(next, nodeId, value => { value.startFrame = event.target.value; }))} /></Field>
			<Field label="Last frame file"><input value={shot.endFrame} placeholder="Optional local project path" onChange={event => editProject(next => updateShot(next, nodeId, value => { value.endFrame = event.target.value; }))} /></Field>
			<Field label="Generation provider"><select value={shot.videoProvider} onChange={event => editProject(next => updateShot(next, nodeId, value => { value.videoProvider = event.target.value; }))}>{videoProviders.map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></Field>
		</InspectorSection>
		<InspectorSection title="Dialogue and sound">
			<Field label="Dialogue or narration"><textarea rows={5} value={shot.dialogue} placeholder="Exact spoken content and delivery direction." onChange={event => editProject(next => updateShot(next, nodeId, value => { value.dialogue = event.target.value; }))} /></Field>
			<Field label="Sound direction"><textarea rows={4} value={shot.audio} placeholder="Ambient sound, effects, rhythm, and silence." onChange={event => editProject(next => updateShot(next, nodeId, value => { value.audio = event.target.value; }))} /></Field>
			<Field label="Voice provider"><select value={shot.voiceProvider} onChange={event => editProject(next => updateShot(next, nodeId, value => { value.voiceProvider = event.target.value; }))}>{voiceProviders.map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></Field>
		</InspectorSection>
		<div className="shot-run-row"><span className={`node-status status-${shot.status}`}>{shot.status}</span><button className="button primary" disabled={running} onClick={() => onRunShot(nodeId)}>Run shot</button></div>
		{shot.error && <div className="inline-error">{shot.error}</div>}
		{shot.outputs.length > 0 && <div className="output-list"><h3>Local outputs</h3>{shot.outputs.map(output => <button key={output} className="output-link" title={output} onClick={() => onOpenOutput(output)}>{output}</button>)}</div>}
	</>;
}

function InspectorSection({ title, action, children }: { readonly title: string; readonly action?: ReactNode; readonly children: ReactNode }): JSX.Element {
	return <section className="inspector-section"><div className="section-heading"><h3>{title}</h3>{action}</div>{children}</section>;
}

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }): JSX.Element {
	return <label className="field"><span>{label}</span>{children}</label>;
}

function PathListField({ value, onChange }: { readonly value: readonly string[]; readonly onChange: (value: string[]) => void }): JSX.Element {
	return <Field label="Local project paths"><textarea rows={5} value={value.join('\n')} placeholder="One relative file path per line" onChange={event => onChange(event.target.value.split('\n').map(item => item.trim()).filter(Boolean))} /></Field>;
}

function ConnectionRow({ label, kind, onRemove }: { readonly label: string; readonly kind: AIProjectWorkflowEdgeKind; readonly onRemove: () => void }): JSX.Element {
	return <div className="connection-row"><span className={`connection-kind edge-${kind}`} title={kind}>{kind === 'sequence' ? 'S' : 'C'}</span><span>{label}</span><button className="icon-button" aria-label={`Remove connection to ${label}`} onClick={onRemove}>×</button></div>;
}

function updateShot(project: AIProject, nodeId: string, mutation: (shot: AIProject['shots'][number]) => void): void {
	const shot = project.shots.find(item => item.id === nodeId);
	if (shot) {
		mutation(shot);
		invalidateDownstreamShots(project, [nodeId]);
	}
}

function workflowNodeData(project: AIProject, nodeId: string, runningShotId: string | undefined, onRun: (nodeId: string) => void): WorkflowNodeData {
	const kind = workflowNodeKind(project, nodeId)!;
	if (kind === 'brief') {
		return { nodeId, kind, title: project.title, summary: summarize(project.brief.objective, 'Define the objective and delivery constraints.'), metadata: `${project.brief.aspectRatio} · ${project.brief.targetDurationSeconds}s`, readiness: project.brief.objective ? 'Creative intent set' : 'Needs objective', running: false, workflowRunning: runningShotId !== undefined, onRun };
	}
	if (kind === 'script') {
		return { nodeId, kind, title: 'Project script', summary: summarize(project.script, 'Write the beats, action, and dialogue.'), metadata: `${project.script.length} characters`, readiness: project.script.trim() ? 'Story source ready' : 'Needs script', running: false, workflowRunning: runningShotId !== undefined, onRun };
	}
	if (kind === 'character') {
		const item = project.characters.find(candidate => candidate.id === nodeId)!;
		return { nodeId, kind, title: item.name, summary: summarize(item.description, 'Describe stable identity and appearance.'), metadata: item.referenceFiles.length ? `${item.referenceFiles.length} references` : 'Context', readiness: item.description.trim() ? 'Continuity ready' : 'Needs identity', running: false, workflowRunning: runningShotId !== undefined, onRun };
	}
	if (kind === 'scene') {
		const item = project.scenes.find(candidate => candidate.id === nodeId)!;
		return { nodeId, kind, title: item.name, summary: summarize(item.description, 'Describe place, time, and atmosphere.'), metadata: item.continuity ? 'Continuity set' : 'Context', readiness: item.description.trim() ? 'Setting ready' : 'Needs setting', running: false, workflowRunning: runningShotId !== undefined, onRun };
	}
	if (kind === 'style') {
		const item = project.styles.find(candidate => candidate.id === nodeId)!;
		return { nodeId, kind, title: item.name, summary: summarize(item.prompt || item.description, 'Define a reusable visual system.'), metadata: item.referenceFiles.length ? `${item.referenceFiles.length} references` : 'Context', readiness: item.prompt.trim() ? 'Prompt reusable' : 'Needs direction', running: false, workflowRunning: runningShotId !== undefined, onRun };
	}
	const item = project.shots.find(candidate => candidate.id === nodeId)!;
	const readiness = item.storyboard.trim() && item.prompt.trim() ? 'Ready to run' : item.storyboard.trim() ? 'Needs execution prompt' : 'Needs storyboard';
	return {
		nodeId,
		kind,
		title: item.title,
		summary: summarize(item.storyboard, 'Describe one visual beat.'),
		metadata: item.outputs.length ? `${item.outputs.length} local output${item.outputs.length === 1 ? '' : 's'}` : `${item.durationSeconds}s · ${item.videoProvider}`,
		readiness,
		status: item.status,
		running: runningShotId === nodeId,
		workflowRunning: runningShotId !== undefined,
		onRun
	};
}

function nodeLabel(project: AIProject, nodeId: string): string {
	const kind = workflowNodeKind(project, nodeId);
	if (kind === 'brief') {
		return 'Creative brief';
	}
	if (kind === 'script') {
		return 'Project script';
	}
	if (kind === 'character') {
		return project.characters.find(item => item.id === nodeId)?.name ?? nodeId;
	}
	if (kind === 'scene') {
		return project.scenes.find(item => item.id === nodeId)?.name ?? nodeId;
	}
	if (kind === 'style') {
		return project.styles.find(item => item.id === nodeId)?.name ?? nodeId;
	}
	if (kind === 'shot') {
		return project.shots.find(item => item.id === nodeId)?.title ?? nodeId;
	}
	return nodeId;
}

function nodeKindKey(kind: AIProjectWorkflowNodeKind): string {
	return kind === 'brief' ? 'B' : kind === 'script' ? 'S' : kind === 'character' ? 'C' : kind === 'scene' ? 'SC' : kind === 'style' ? 'V' : 'SH';
}

function nodeKindLabel(kind: AIProjectWorkflowNodeKind): string {
	return kind === 'brief' ? 'Brief' : kind === 'script' ? 'Script' : kind === 'character' ? 'Character' : kind === 'scene' ? 'Scene' : kind === 'style' ? 'Visual direction' : 'Shot';
}

function summarize(value: string, fallback: string): string {
	const compact = value.trim().replace(/\s+/g, ' ');
	return compact ? (compact.length > 120 ? `${compact.slice(0, 117)}...` : compact) : fallback;
}

function numberInput(value: string, fallback: number): number {
	const parsed = value.trim() ? Number(value) : Number.NaN;
	return Number.isFinite(parsed) ? parsed : fallback;
}

createRoot(rootElement).render(<StrictMode><App /></StrictMode>);
