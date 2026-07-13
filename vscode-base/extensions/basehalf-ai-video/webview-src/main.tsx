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
	AI_VIDEO_SCRIPT_NODE_ID,
	createId,
	createWorkflowEdgeId,
	invalidateDownstreamShots,
	synchronizeShotSceneIds,
	validateWorkflowConnection,
	workflowNodeKind,
	type AIProject,
	type AIProjectShotStatus,
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
	readonly status?: AIProjectShotStatus;
	readonly outputCount: number;
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
	const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(AI_VIDEO_SCRIPT_NODE_ID);
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

	useEffect(() => {
		const listener = (event: MessageEvent): void => {
			const message = event.data as Record<string, unknown>;
			switch (message.type) {
				case 'saved':
					setRevision(String(message.revision ?? ''));
					updateDirty(false);
					setRunningShotId(undefined);
					break;
				case 'project':
					setProject(message.project as AIProject);
					setRevision(String(message.revision ?? ''));
					setVideoProviders((message.videoProviders as readonly ProviderOption[] | undefined) ?? initialState.videoProviders);
					setVoiceProviders((message.voiceProviders as readonly ProviderOption[] | undefined) ?? initialState.voiceProviders);
					updateDirty(false);
					setRunningShotId(undefined);
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
		selected: selectedEdgeId === edge.id,
		markerEnd: { type: MarkerType.ArrowClosed },
		ariaLabel: `${nodeLabel(project, edge.source)} provides context to ${nodeLabel(project, edge.target)}`
	})), [project, selectedEdgeId]);

	const addNode = useCallback((kind: Exclude<AIProjectWorkflowNodeKind, 'script'>): void => {
		const bounds = canvasRef.current?.getBoundingClientRect();
		const position = bounds
			? reactFlow.screenToFlowPosition({ x: bounds.left + bounds.width * 0.52, y: bounds.top + bounds.height * 0.42 })
			: { x: 420, y: 220 };
		const nodeId = createId(kind);
		editProject(next => {
			switch (kind) {
				case 'character':
					next.characters.push({ id: nodeId, name: `Character ${next.characters.length + 1}`, description: '' });
					break;
				case 'scene':
					next.scenes.push({ id: nodeId, name: `Scene ${next.scenes.length + 1}`, description: '' });
					break;
				case 'shot':
					next.shots.push({
						id: nodeId,
						title: `Shot ${next.shots.length + 1}`,
						sceneId: '',
						prompt: '',
						dialogue: '',
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
		const removable = new Set(ids.filter(id => id !== AI_VIDEO_SCRIPT_NODE_ID));
		if (!removable.size) {
			setNotice('The Script node is required and cannot be removed.');
			return;
		}
		editProject(next => {
			const affectedTargets = next.workflow.edges
				.filter(edge => removable.has(edge.source) && !removable.has(edge.target))
				.map(edge => edge.target);
			next.characters = next.characters.filter(item => !removable.has(item.id));
			next.scenes = next.scenes.filter(item => !removable.has(item.id));
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
		const removed = new Set(ids);
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
		if (!validation.valid) {
			setNotice(validation.reason ?? 'This connection is not valid.');
			return;
		}
		editProject(next => {
			next.workflow.edges.push({
				id: createWorkflowEdgeId(connection.source!, connection.target!),
				source: connection.source!,
				target: connection.target!
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
					<button className="button secondary" disabled={running} onClick={runPending}>Run pending</button>
					<button className="button primary" disabled={!dirty || running} onClick={save}>Save</button>
				</div>
			</header>
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
						fitViewOptions={{ padding: 0.24, maxZoom: 1 }}
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

function WorkflowNodeCard({ data, selected }: NodeProps<WorkflowFlowNode>): JSX.Element {
	return (
		<div className={`workflow-node kind-${data.kind}${selected ? ' selected' : ''}${data.running ? ' running' : ''}`}>
			{data.kind !== 'script' && <Handle type="target" position={Position.Left} aria-label="Input" />}
			<div className="node-header">
				<span className="node-kind-key" aria-hidden="true">{nodeKindKey(data.kind)}</span>
				<span className="node-kind-label">{nodeKindLabel(data.kind)}</span>
				{data.status && <span className={`node-status status-${data.status}`}>{data.status}</span>}
			</div>
			<div className="node-title">{data.title}</div>
			<div className="node-summary">{data.summary}</div>
			<div className="node-footer">
				<span>{data.metadata}</span>
				{data.kind === 'shot' && (
					<button className="node-run nodrag nopan" disabled={data.workflowRunning} onClick={event => { event.stopPropagation(); data.onRun(data.nodeId); }}>
						{data.running ? 'Running' : 'Run'}
					</button>
				)}
			</div>
			<Handle type="source" position={Position.Right} aria-label="Output" />
		</div>
	);
}

function NodePalette({ onAdd }: { readonly onAdd: (kind: Exclude<AIProjectWorkflowNodeKind, 'script'>) => void }): JSX.Element {
	return (
		<aside className="palette" aria-label="Workflow node library">
			<div className="panel-heading">
				<h2>Nodes</h2>
				<p>Add context or executable work.</p>
			</div>
			<div className="palette-list">
				<PaletteButton kind="character" label="Character" description="Identity and continuity" onAdd={onAdd} />
				<PaletteButton kind="scene" label="Scene" description="Place, time, and mood" onAdd={onAdd} />
				<PaletteButton kind="shot" label="Shot" description="Prompt and generation" onAdd={onAdd} />
			</div>
			<div className="palette-help">
				<strong>Connect context</strong>
				<p>Drag from a node's right port to another node's left port. Dependencies run from left to right.</p>
			</div>
		</aside>
	);
}

function PaletteButton({ kind, label, description, onAdd }: {
	readonly kind: Exclude<AIProjectWorkflowNodeKind, 'script'>;
	readonly label: string;
	readonly description: string;
	readonly onAdd: (kind: Exclude<AIProjectWorkflowNodeKind, 'script'>) => void;
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
				<div className="panel-heading"><h2>Dependency</h2><p>Context flows into the target node.</p></div>
				<div className="dependency-card">
					<div><span>From</span><strong>{nodeLabel(project, edge.source)}</strong></div>
					<div><span>To</span><strong>{nodeLabel(project, edge.target)}</strong></div>
				</div>
				<button className="button danger full" onClick={() => onRemoveEdge(edge.id)}>Remove dependency</button>
			</aside>
		);
	}
	const kind = selectedNodeId ? workflowNodeKind(project, selectedNodeId) : undefined;
	if (!selectedNodeId || !kind) {
		return (
			<aside className="inspector empty-inspector">
				<div className="empty-mark" aria-hidden="true">+</div>
				<h2>Select a node</h2>
				<p>Edit its content, inspect dependencies, or run a shot.</p>
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
					{incoming.length ? incoming.map(item => <ConnectionRow key={item.id} label={nodeLabel(project, item.source)} onRemove={() => onRemoveEdge(item.id)} />) : <p className="muted">No incoming context.</p>}
					<h3>Outputs</h3>
					{outgoing.length ? outgoing.map(item => <ConnectionRow key={item.id} label={nodeLabel(project, item.target)} onRemove={() => onRemoveEdge(item.id)} />) : <p className="muted">No downstream nodes.</p>}
				</div>
				{kind !== 'script' && <button className="button danger full" onClick={() => onRemoveNode(selectedNodeId)}>Delete node</button>}
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
	if (kind === 'script') {
		return <Field label="Script"><textarea rows={14} value={project.script} placeholder="Write or paste the episode script." onChange={event => editProject(next => {
			next.script = event.target.value;
			invalidateDownstreamShots(next, [nodeId]);
		})} /></Field>;
	}
	if (kind === 'character') {
		const character = project.characters.find(item => item.id === nodeId)!;
		return <>
			<Field label="Name"><input value={character.name} onChange={event => editProject(next => {
				next.characters.find(item => item.id === nodeId)!.name = event.target.value;
				invalidateDownstreamShots(next, [nodeId]);
			})} /></Field>
			<Field label="Description"><textarea rows={8} value={character.description} placeholder="Appearance, identity, and continuity notes." onChange={event => editProject(next => {
				next.characters.find(item => item.id === nodeId)!.description = event.target.value;
				invalidateDownstreamShots(next, [nodeId]);
			})} /></Field>
		</>;
	}
	if (kind === 'scene') {
		const scene = project.scenes.find(item => item.id === nodeId)!;
		return <>
			<Field label="Name"><input value={scene.name} onChange={event => editProject(next => {
				next.scenes.find(item => item.id === nodeId)!.name = event.target.value;
				invalidateDownstreamShots(next, [nodeId]);
			})} /></Field>
			<Field label="Description"><textarea rows={8} value={scene.description} placeholder="Place, time, mood, and visual continuity." onChange={event => editProject(next => {
				next.scenes.find(item => item.id === nodeId)!.description = event.target.value;
				invalidateDownstreamShots(next, [nodeId]);
			})} /></Field>
		</>;
	}
	const shot = project.shots.find(item => item.id === nodeId)!;
	return <>
		<Field label="Title"><input value={shot.title} onChange={event => editProject(next => {
			next.shots.find(item => item.id === nodeId)!.title = event.target.value;
			invalidateDownstreamShots(next, [nodeId]);
		})} /></Field>
		<Field label="Visual prompt"><textarea rows={7} value={shot.prompt} placeholder="Camera, action, composition, lighting, and continuity." onChange={event => editProject(next => {
			next.shots.find(candidate => candidate.id === nodeId)!.prompt = event.target.value;
			invalidateDownstreamShots(next, [nodeId]);
		})} /></Field>
		<Field label="Dialogue or narration"><textarea rows={5} value={shot.dialogue} placeholder="Dialogue, narration, or voice direction." onChange={event => editProject(next => {
			next.shots.find(candidate => candidate.id === nodeId)!.dialogue = event.target.value;
			invalidateDownstreamShots(next, [nodeId]);
		})} /></Field>
		<Field label="Generation provider"><select value={shot.videoProvider} onChange={event => editProject(next => {
			next.shots.find(candidate => candidate.id === nodeId)!.videoProvider = event.target.value;
			invalidateDownstreamShots(next, [nodeId]);
		})}>{videoProviders.map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></Field>
		<Field label="Voice provider"><select value={shot.voiceProvider} onChange={event => editProject(next => {
			next.shots.find(item => item.id === nodeId)!.voiceProvider = event.target.value;
			invalidateDownstreamShots(next, [nodeId]);
		})}>{voiceProviders.map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></Field>
		<div className="shot-run-row"><span className={`node-status status-${shot.status}`}>{shot.status}</span><button className="button primary" disabled={running} onClick={() => onRunShot(nodeId)}>Run shot</button></div>
		{shot.error && <div className="inline-error">{shot.error}</div>}
		{shot.outputs.length > 0 && <div className="output-list"><h3>Local outputs</h3>{shot.outputs.map(output => <button key={output} className="output-link" title={output} onClick={() => onOpenOutput(output)}>{output}</button>)}</div>}
	</>;
}

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }): JSX.Element {
	return <label className="field"><span>{label}</span>{children}</label>;
}

function ConnectionRow({ label, onRemove }: { readonly label: string; readonly onRemove: () => void }): JSX.Element {
	return <div className="connection-row"><span>{label}</span><button className="icon-button" aria-label={`Remove connection to ${label}`} onClick={onRemove}>×</button></div>;
}

function workflowNodeData(project: AIProject, nodeId: string, runningShotId: string | undefined, onRun: (nodeId: string) => void): WorkflowNodeData {
	const kind = workflowNodeKind(project, nodeId)!;
	if (kind === 'script') {
		return { nodeId, kind, title: 'Project script', summary: summarize(project.script, 'Add the story and structure.'), metadata: `${project.script.length} characters`, outputCount: 0, running: false, workflowRunning: runningShotId !== undefined, onRun };
	}
	if (kind === 'character') {
		const item = project.characters.find(candidate => candidate.id === nodeId)!;
		return { nodeId, kind, title: item.name, summary: summarize(item.description, 'Describe identity and continuity.'), metadata: 'Context', outputCount: 0, running: false, workflowRunning: runningShotId !== undefined, onRun };
	}
	if (kind === 'scene') {
		const item = project.scenes.find(candidate => candidate.id === nodeId)!;
		return { nodeId, kind, title: item.name, summary: summarize(item.description, 'Describe place, time, and mood.'), metadata: 'Context', outputCount: 0, running: false, workflowRunning: runningShotId !== undefined, onRun };
	}
	const item = project.shots.find(candidate => candidate.id === nodeId)!;
	return {
		nodeId,
		kind,
		title: item.title,
		summary: summarize(item.prompt, 'Add a visual prompt.'),
		metadata: item.outputs.length ? `${item.outputs.length} local output${item.outputs.length === 1 ? '' : 's'}` : item.videoProvider,
		status: item.status,
		outputCount: item.outputs.length,
		running: runningShotId === nodeId,
		workflowRunning: runningShotId !== undefined,
		onRun
	};
}

function nodeLabel(project: AIProject, nodeId: string): string {
	const kind = workflowNodeKind(project, nodeId);
	if (kind === 'script') {
		return 'Project script';
	}
	if (kind === 'character') {
		return project.characters.find(item => item.id === nodeId)?.name ?? nodeId;
	}
	if (kind === 'scene') {
		return project.scenes.find(item => item.id === nodeId)?.name ?? nodeId;
	}
	if (kind === 'shot') {
		return project.shots.find(item => item.id === nodeId)?.title ?? nodeId;
	}
	return nodeId;
}

function nodeKindKey(kind: AIProjectWorkflowNodeKind): string {
	return kind === 'script' ? 'S' : kind === 'character' ? 'C' : kind === 'scene' ? 'SC' : 'SH';
}

function nodeKindLabel(kind: AIProjectWorkflowNodeKind): string {
	return kind === 'script' ? 'Script' : kind === 'character' ? 'Character' : kind === 'scene' ? 'Scene' : 'Shot';
}

function summarize(value: string, fallback: string): string {
	const compact = value.trim().replace(/\s+/g, ' ');
	return compact ? (compact.length > 120 ? `${compact.slice(0, 117)}...` : compact) : fallback;
}

createRoot(rootElement).render(<StrictMode><App /></StrictMode>);
