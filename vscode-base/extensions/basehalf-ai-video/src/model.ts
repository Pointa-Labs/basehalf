/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

export type AIProjectMediaKind = 'text' | 'image' | 'video' | 'audio';
export type AIProjectNodeStatus = 'draft' | 'ready' | 'running' | 'prepared' | 'complete' | 'error' | 'stale';
export type AIProjectTextRole = 'brief' | 'script' | 'storyboard' | 'imagePrompt' | 'videoPrompt' | 'dialogue' | 'note';
export type AIProjectImageRole = 'generate' | 'reference' | 'frame';
export type AIProjectVideoRole = 'generate' | 'reference';
export type AIProjectAudioRole = 'voice' | 'music' | 'effect' | 'reference';
export type AIProjectMediaSource = 'generate' | 'local';
export type AIProjectVideoAudioMode = 'auto' | 'generate' | 'none';
export type AIProjectRunStatus = 'prepared' | 'complete';

export interface AIProjectWorkflowPosition {
	x: number;
	y: number;
}

export interface AIProjectRun {
	id: string;
	createdAt: string;
	provider: string;
	model: string;
	status: AIProjectRunStatus;
	prompt: string;
	inputPaths: string[];
	outputs: string[];
}

interface AIProjectNodeBase {
	id: string;
	kind: AIProjectMediaKind;
	title: string;
	position: AIProjectWorkflowPosition;
	groupId?: string;
}

export interface AIProjectTextNode extends AIProjectNodeBase {
	kind: 'text';
	role: AIProjectTextRole;
	content: string;
	width?: number;
	height?: number;
}

interface AIProjectExecutableNodeBase extends AIProjectNodeBase {
	source: AIProjectMediaSource;
	prompt: string;
	negativePrompt: string;
	inputFiles: string[];
	provider: string;
	model: string;
	status: AIProjectNodeStatus;
	runs: AIProjectRun[];
	selectedRunId?: string;
	error?: string;
}

export interface AIProjectImageNode extends AIProjectExecutableNodeBase {
	kind: 'image';
	role: AIProjectImageRole;
	aspectRatio: string;
	count: number;
}

export interface AIProjectVideoNode extends AIProjectExecutableNodeBase {
	kind: 'video';
	role: AIProjectVideoRole;
	durationSeconds: number;
	aspectRatio: string;
	audioMode: AIProjectVideoAudioMode;
}

export interface AIProjectAudioNode extends AIProjectExecutableNodeBase {
	kind: 'audio';
	role: AIProjectAudioRole;
	durationSeconds: number;
	voice: string;
}

export type AIProjectNode = AIProjectTextNode | AIProjectImageNode | AIProjectVideoNode | AIProjectAudioNode;
export type AIProjectExecutableNode = AIProjectImageNode | AIProjectVideoNode | AIProjectAudioNode;

export interface AIProjectWorkflowEdge {
	id: string;
	source: string;
	target: string;
	media: AIProjectMediaKind;
}

export interface AIProjectShotGroup {
	id: string;
	title: string;
	description: string;
	position: AIProjectWorkflowPosition;
	width: number;
	height: number;
	nodeIds: string[];
}

export interface AIProjectSequenceItem {
	id: string;
	videoNodeId: string;
}

export interface AIProject {
	version: 4;
	title: string;
	nodes: AIProjectNode[];
	edges: AIProjectWorkflowEdge[];
	groups: AIProjectShotGroup[];
	sequence: AIProjectSequenceItem[];
	outputs: string[];
}

export interface AIProjectWorkflowConnectionValidation {
	readonly valid: boolean;
	readonly media?: AIProjectMediaKind;
	readonly reason?: string;
}

export interface AIProjectNodeReadiness {
	readonly ready: boolean;
	readonly label: string;
	readonly reason?: string;
}

export interface AIMediaProviderOption {
	readonly id: string;
	readonly label: string;
	readonly kinds: readonly Exclude<AIProjectMediaKind, 'text'>[];
	readonly supportsNativeAudio: boolean;
}

export interface AITextModelServiceOption {
	readonly id: string;
	readonly label: string;
	readonly configured: boolean;
}

export const AI_TEXT_NODE_DEFAULT_WIDTH = 340;
export const AI_TEXT_NODE_DEFAULT_HEIGHT = 396;
export const AI_TEXT_NODE_MIN_WIDTH = 260;
export const AI_TEXT_NODE_MIN_HEIGHT = 180;
export const AI_TEXT_NODE_MAX_WIDTH = 720;
export const AI_TEXT_NODE_MAX_HEIGHT = 900;

export function createAIProject(title = 'Untitled AI Video'): AIProject {
	return {
		version: 4,
		title,
		nodes: [],
		edges: [],
		groups: [],
		sequence: [],
		outputs: []
	};
}

export function createMediaNode(kind: 'text', position: AIProjectWorkflowPosition, groupId?: string): AIProjectTextNode;
export function createMediaNode(kind: 'image', position: AIProjectWorkflowPosition, groupId?: string): AIProjectImageNode;
export function createMediaNode(kind: 'video', position: AIProjectWorkflowPosition, groupId?: string): AIProjectVideoNode;
export function createMediaNode(kind: 'audio', position: AIProjectWorkflowPosition, groupId?: string): AIProjectAudioNode;
export function createMediaNode(kind: AIProjectMediaKind, position: AIProjectWorkflowPosition, groupId?: string): AIProjectNode;
export function createMediaNode(kind: AIProjectMediaKind, position: AIProjectWorkflowPosition, groupId?: string): AIProjectNode {
	const id = createId(kind);
	const base = { id, kind, title: mediaKindLabel(kind), position, ...(groupId ? { groupId } : {}) };
	switch (kind) {
		case 'text':
			return { ...base, kind, role: 'note', content: '', width: AI_TEXT_NODE_DEFAULT_WIDTH, height: AI_TEXT_NODE_DEFAULT_HEIGHT };
		case 'image':
			return { ...base, kind, role: 'generate', source: 'generate', prompt: '', negativePrompt: '', inputFiles: [], provider: 'local-preview', model: 'auto', status: 'draft', runs: [], aspectRatio: '9:16', count: 1 };
		case 'video':
			return { ...base, kind, role: 'generate', source: 'generate', prompt: '', negativePrompt: '', inputFiles: [], provider: 'local-preview', model: 'auto', status: 'draft', runs: [], durationSeconds: 5, aspectRatio: '9:16', audioMode: 'auto' };
		case 'audio':
			return { ...base, kind, role: 'voice', source: 'generate', prompt: '', negativePrompt: '', inputFiles: [], provider: 'local-preview', model: 'auto', status: 'draft', runs: [], durationSeconds: 5, voice: 'auto' };
	}
}

export function createShotGroup(index: number, position: AIProjectWorkflowPosition): AIProjectShotGroup {
	return {
		id: createId('shot'),
		title: `Shot ${index}`,
		description: '',
		position,
		width: 1780,
		height: 620,
		nodeIds: []
	};
}

export function parseAIProject(value: string): AIProject {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch (error) {
		throw new Error(`Invalid AI Video project JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!isRecord(parsed) || parsed.version !== 4) {
		throw new Error('Unsupported AI Video project. Expected version 4.');
	}
	return parseVersionFour(parsed);
}

export function serializeAIProject(project: AIProject): Uint8Array {
	const normalized = parseAIProject(JSON.stringify(project));
	return new TextEncoder().encode(`${JSON.stringify(normalized, null, 2)}\n`);
}

export function createId(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createWorkflowEdgeId(source: string, target: string): string {
	return `edge-${safeIdPart(source)}-${safeIdPart(target)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function nodeById(project: AIProject, id: string): AIProjectNode | undefined {
	return project.nodes.find(node => node.id === id);
}

export function isExecutableNode(node: AIProjectNode): node is AIProjectExecutableNode {
	return node.kind !== 'text';
}

export function selectedRun(node: AIProjectExecutableNode): AIProjectRun | undefined {
	return node.runs.find(run => run.id === node.selectedRunId) ?? node.runs.at(-1);
}

export function selectedOutputPaths(node: AIProjectExecutableNode): readonly string[] {
	if (node.source === 'local') {
		return node.inputFiles;
	}
	return selectedRun(node)?.outputs ?? [];
}

export function nodePrompt(project: AIProject, nodeId: string): string {
	const node = nodeById(project, nodeId);
	if (!node || !isExecutableNode(node)) {
		return '';
	}
	const textInputs = upstreamWorkflowNodeIds(project, nodeId)
		.map(id => nodeById(project, id))
		.filter((candidate): candidate is AIProjectTextNode => candidate?.kind === 'text')
		.map(candidate => candidate.content.trim())
		.filter(Boolean);
	return [...textInputs, node.prompt.trim()].filter(Boolean).join('\n\n');
}

export function nodeReadiness(project: AIProject, nodeId: string): AIProjectNodeReadiness {
	const node = nodeById(project, nodeId);
	if (!node) {
		return { ready: false, label: 'Missing', reason: 'The node no longer exists.' };
	}
	if (node.kind === 'text') {
		return node.content.trim()
			? { ready: true, label: 'Content ready' }
			: { ready: false, label: 'Needs content', reason: 'Add text directly or ask an Agent to fill this node.' };
	}
	if (node.source === 'local') {
		return node.inputFiles.length
			? { ready: true, label: 'Local media ready' }
			: { ready: false, label: 'Needs a local file', reason: 'Choose at least one project file.' };
	}
	if (!node.provider) {
		return { ready: false, label: 'Needs model service', reason: 'Choose a configured model service.' };
	}
	if (!nodePrompt(project, node.id).trim()) {
		return { ready: false, label: 'Needs prompt', reason: 'Connect a Text node or add node-specific instructions.' };
	}
	for (const sourceId of directUpstreamNodeIds(project, node.id)) {
		const source = nodeById(project, sourceId);
		if (source && isExecutableNode(source) && selectedOutputPaths(source).length === 0) {
			return { ready: false, label: `Waiting for ${source.kind}`, reason: `Run or choose a result for '${source.title}' first.` };
		}
	}
	return { ready: true, label: node.status === 'stale' ? 'Ready to refresh' : 'Ready' };
}

export function validateWorkflowConnection(project: AIProject, source: string, target: string): AIProjectWorkflowConnectionValidation {
	const sourceNode = nodeById(project, source);
	const targetNode = nodeById(project, target);
	if (!sourceNode || !targetNode) {
		return { valid: false, reason: 'Both connection endpoints must exist.' };
	}
	if (source === target) {
		return { valid: false, reason: 'A node cannot connect to itself.' };
	}
	if (!canFeed(sourceNode.kind, targetNode.kind)) {
		return { valid: false, reason: `${mediaKindLabel(sourceNode.kind)} output is not accepted by ${mediaKindLabel(targetNode.kind)}.` };
	}
	if (project.edges.some(edge => edge.source === source && edge.target === target)) {
		return { valid: false, reason: 'This connection already exists.' };
	}
	if (wouldCreateWorkflowCycle(project.edges, source, target)) {
		return { valid: false, reason: 'Workflow data cannot flow in a cycle.' };
	}
	return { valid: true, media: sourceNode.kind };
}

export function connectWorkflowNodes(project: AIProject, source: string, target: string): AIProjectWorkflowConnectionValidation {
	const validation = validateWorkflowConnection(project, source, target);
	if (!validation.valid || !validation.media) {
		return validation;
	}
	project.edges.push({ id: createWorkflowEdgeId(source, target), source, target, media: validation.media });
	invalidateDownstreamNodes(project, [target]);
	return validation;
}

export function workflowTargetKindsForSource(source: AIProjectMediaKind): readonly AIProjectMediaKind[] {
	if (source === 'text') {
		return ['text', 'image', 'video', 'audio'];
	}
	if (source === 'image') {
		return ['text', 'image', 'video'];
	}
	if (source === 'video') {
		return ['text', 'video'];
	}
	return ['text', 'video', 'audio'];
}

export function workflowIntermediateKindsForConnection(project: AIProject, source: string, target: string): readonly AIProjectMediaKind[] {
	const sourceNode = nodeById(project, source);
	const targetNode = nodeById(project, target);
	if (!sourceNode || !targetNode) {
		return [];
	}
	return (['text', 'image', 'video', 'audio'] as const).filter(kind => canFeed(sourceNode.kind, kind) && canFeed(kind, targetNode.kind));
}

export function insertWorkflowNodeOnEdge(project: AIProject, edgeId: string, node: AIProjectNode): AIProjectWorkflowConnectionValidation {
	const edge = project.edges.find(candidate => candidate.id === edgeId);
	if (!edge) {
		return { valid: false, reason: 'The connection no longer exists.' };
	}
	if (nodeById(project, node.id)) {
		return { valid: false, reason: 'The new node id is already in use.' };
	}
	const remainingEdges = project.edges.filter(candidate => candidate.id !== edgeId);
	const candidate: AIProject = { ...project, nodes: [...project.nodes, node], edges: remainingEdges };
	const incoming = validateWorkflowConnection(candidate, edge.source, node.id);
	if (!incoming.valid || !incoming.media) {
		return incoming;
	}
	const outgoing = validateWorkflowConnection(candidate, node.id, edge.target);
	if (!outgoing.valid || !outgoing.media) {
		return outgoing;
	}

	project.nodes.push(node);
	project.edges = remainingEdges;
	project.edges.push(
		{ id: createWorkflowEdgeId(edge.source, node.id), source: edge.source, target: node.id, media: incoming.media },
		{ id: createWorkflowEdgeId(node.id, edge.target), source: node.id, target: edge.target, media: outgoing.media }
	);
	if (node.groupId) {
		project.groups.find(group => group.id === node.groupId)?.nodeIds.push(node.id);
	}
	invalidateDownstreamNodes(project, [node.id, edge.target]);
	return { valid: true, media: incoming.media };
}

export function topologicalWorkflowNodeIds(project: AIProject): readonly string[] {
	const ids = project.nodes.map(node => node.id);
	const indegree = new Map(ids.map(id => [id, 0]));
	const outgoing = new Map(ids.map(id => [id, [] as string[]]));
	for (const edge of project.edges) {
		indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
		outgoing.get(edge.source)?.push(edge.target);
	}
	const queue = ids.filter(id => indegree.get(id) === 0);
	const ordered: string[] = [];
	while (queue.length) {
		const id = queue.shift()!;
		ordered.push(id);
		for (const target of outgoing.get(id) ?? []) {
			const next = (indegree.get(target) ?? 0) - 1;
			indegree.set(target, next);
			if (next === 0) {
				queue.push(target);
			}
		}
	}
	if (ordered.length !== ids.length) {
		throw new Error('AI Video workflow contains a cycle.');
	}
	return ordered;
}

export function upstreamWorkflowNodeIds(project: AIProject, targetId: string): readonly string[] {
	const incoming = new Map<string, string[]>();
	for (const edge of project.edges) {
		const sources = incoming.get(edge.target) ?? [];
		sources.push(edge.source);
		incoming.set(edge.target, sources);
	}
	const upstream = new Set<string>();
	const visit = (id: string): void => {
		for (const source of incoming.get(id) ?? []) {
			if (!upstream.has(source)) {
				upstream.add(source);
				visit(source);
			}
		}
	};
	visit(targetId);
	return topologicalWorkflowNodeIds(project).filter(id => upstream.has(id));
}

export function invalidateDownstreamNodes(project: AIProject, sourceIds: readonly string[], includeSources = true): void {
	const outgoing = new Map<string, string[]>();
	for (const edge of project.edges) {
		const targets = outgoing.get(edge.source) ?? [];
		targets.push(edge.target);
		outgoing.set(edge.source, targets);
	}
	const affected = new Set<string>();
	const queue = includeSources ? [...sourceIds] : sourceIds.flatMap(id => outgoing.get(id) ?? []);
	while (queue.length) {
		const id = queue.shift()!;
		if (affected.has(id)) {
			continue;
		}
		affected.add(id);
		queue.push(...(outgoing.get(id) ?? []));
	}
	for (const node of project.nodes) {
		if (affected.has(node.id) && isExecutableNode(node)) {
			node.status = node.runs.length || node.inputFiles.length ? 'stale' : 'draft';
			delete node.error;
		}
	}
}

function directUpstreamNodeIds(project: AIProject, targetId: string): readonly string[] {
	return project.edges.filter(edge => edge.target === targetId).map(edge => edge.source);
}

export function orderedSequenceVideoNodes(project: AIProject): readonly AIProjectVideoNode[] {
	return project.sequence.flatMap(item => {
		const node = nodeById(project, item.videoNodeId);
		return node?.kind === 'video' ? [node] : [];
	});
}

export function mediaKindLabel(kind: AIProjectMediaKind): string {
	return kind === 'text' ? 'Text' : kind === 'image' ? 'Image' : kind === 'video' ? 'Video' : 'Audio';
}

function parseVersionFour(value: Record<string, unknown>): AIProject {
	const nodes = arrayValue(value.nodes).map(parseNode);
	const nodeIds = uniqueIds(nodes, 'node');
	const groups = arrayValue(value.groups).map(parseGroup);
	const groupIds = uniqueIds(groups, 'group');
	for (const groupId of groupIds) {
		if (nodeIds.has(groupId)) {
			throw new Error(`AI Video node and Shot Group share id '${groupId}'.`);
		}
	}
	for (const node of nodes) {
		if (node.groupId && !groupIds.has(node.groupId)) {
			throw new Error(`Node '${node.id}' belongs to missing Shot Group '${node.groupId}'.`);
		}
	}
	for (const group of groups) {
		const expected = nodes.filter(node => node.groupId === group.id).map(node => node.id).sort();
		const actual = [...group.nodeIds].sort();
		if (JSON.stringify(expected) !== JSON.stringify(actual)) {
			throw new Error(`Shot Group '${group.id}' nodeIds do not match its contained nodes.`);
		}
	}
	const project: AIProject = {
		version: 4,
		title: stringValue(value.title, 'Untitled AI Video'),
		nodes,
		edges: [],
		groups,
		sequence: [],
		outputs: stringArray(value.outputs)
	};
	const edgeIds = new Set<string>();
	for (const entry of arrayValue(value.edges)) {
		if (!isRecord(entry)) {
			throw new Error('Invalid AI Video workflow edge.');
		}
		const id = requiredString(entry.id, 'workflow edge id');
		if (edgeIds.has(id)) {
			throw new Error(`Duplicate AI Video workflow edge '${id}'.`);
		}
		const source = requiredString(entry.source, `edge '${id}' source`);
		const target = requiredString(entry.target, `edge '${id}' target`);
		const validation = validateWorkflowConnection(project, source, target);
		if (!validation.valid || !validation.media) {
			throw new Error(`Workflow edge '${id}' is incompatible: ${validation.reason}`);
		}
		const media = mediaKind(entry.media);
		if (media !== validation.media) {
			throw new Error(`Workflow edge '${id}' declares ${media} but its source outputs ${validation.media}.`);
		}
		edgeIds.add(id);
		project.edges.push({ id, source, target, media });
	}
	topologicalWorkflowNodeIds(project);
	const sequenceIds = new Set<string>();
	const sequenceVideos = new Set<string>();
	for (const entry of arrayValue(value.sequence)) {
		if (!isRecord(entry)) {
			throw new Error('Invalid AI Video sequence item.');
		}
		const id = requiredString(entry.id, 'sequence item id');
		const videoNodeId = requiredString(entry.videoNodeId, `sequence item '${id}' videoNodeId`);
		if (sequenceIds.has(id) || sequenceVideos.has(videoNodeId)) {
			throw new Error(`Duplicate AI Video sequence item '${id}'.`);
		}
		if (nodeById(project, videoNodeId)?.kind !== 'video') {
			throw new Error(`Sequence item '${id}' must reference a Video node.`);
		}
		sequenceIds.add(id);
		sequenceVideos.add(videoNodeId);
		project.sequence.push({ id, videoNodeId });
	}
	return project;
}

function parseNode(value: unknown): AIProjectNode {
	if (!isRecord(value)) {
		throw new Error('Invalid AI Video node.');
	}
	const kind = mediaKind(value.kind);
	const id = requiredString(value.id, 'node id');
	const base = {
		id,
		kind,
		title: stringValue(value.title, mediaKindLabel(kind)),
		position: parsePosition(value.position, `node '${id}'`),
		...(typeof value.groupId === 'string' && value.groupId ? { groupId: value.groupId } : {})
	};
	if (kind === 'text') {
		return {
			...base,
			kind,
			role: textRole(value.role),
			content: stringValue(value.content),
			width: boundedNumber(value.width, AI_TEXT_NODE_DEFAULT_WIDTH, AI_TEXT_NODE_MIN_WIDTH, AI_TEXT_NODE_MAX_WIDTH),
			height: boundedNumber(value.height, AI_TEXT_NODE_DEFAULT_HEIGHT, AI_TEXT_NODE_MIN_HEIGHT, AI_TEXT_NODE_MAX_HEIGHT)
		};
	}
	const executable = {
		source: mediaSource(value.source),
		prompt: stringValue(value.prompt),
		negativePrompt: stringValue(value.negativePrompt),
		inputFiles: stringArray(value.inputFiles),
		provider: stringValue(value.provider, 'local-preview'),
		model: stringValue(value.model, 'auto'),
		status: recoveredNodeStatus(value.status, arrayValue(value.runs).length > 0 || stringArray(value.inputFiles).length > 0),
		runs: arrayValue(value.runs).map(parseRun),
		...(typeof value.selectedRunId === 'string' && value.selectedRunId ? { selectedRunId: value.selectedRunId } : {}),
		...(typeof value.error === 'string' && value.error ? { error: value.error } : {})
	};
	uniqueIds(executable.runs, `run in node '${id}'`);
	if (executable.selectedRunId && !executable.runs.some(run => run.id === executable.selectedRunId)) {
		throw new Error(`Node '${id}' selects a missing run '${executable.selectedRunId}'.`);
	}
	if (kind === 'image') {
		return { ...base, ...executable, kind, role: imageRole(value.role), aspectRatio: stringValue(value.aspectRatio, '9:16'), count: boundedNumber(value.count, 1, 1, 16) };
	}
	if (kind === 'video') {
		return { ...base, ...executable, kind, role: videoRole(value.role), durationSeconds: boundedNumber(value.durationSeconds, 5, 1, 120), aspectRatio: stringValue(value.aspectRatio, '9:16'), audioMode: videoAudioMode(value.audioMode) };
	}
	return { ...base, ...executable, kind, role: audioRole(value.role), durationSeconds: boundedNumber(value.durationSeconds, 5, 1, 3600), voice: stringValue(value.voice, 'auto') };
}

function parseRun(value: unknown): AIProjectRun {
	if (!isRecord(value)) {
		throw new Error('Invalid AI Video node run.');
	}
	return {
		id: requiredString(value.id, 'run id'),
		createdAt: requiredString(value.createdAt, 'run createdAt'),
		provider: requiredString(value.provider, 'run provider'),
		model: stringValue(value.model, 'auto'),
		status: value.status === 'complete' ? 'complete' : 'prepared',
		prompt: stringValue(value.prompt),
		inputPaths: stringArray(value.inputPaths),
		outputs: stringArray(value.outputs)
	};
}

function parseGroup(value: unknown): AIProjectShotGroup {
	if (!isRecord(value)) {
		throw new Error('Invalid AI Video Shot Group.');
	}
	const id = requiredString(value.id, 'Shot Group id');
	return {
		id,
		title: stringValue(value.title, 'Shot'),
		description: stringValue(value.description),
		position: parsePosition(value.position, `Shot Group '${id}'`),
		width: boundedNumber(value.width, 1780, 480, 2400),
		height: boundedNumber(value.height, 620, 220, 1600),
		nodeIds: stringArray(value.nodeIds)
	};
}

function canFeed(source: AIProjectMediaKind, target: AIProjectMediaKind): boolean {
	return workflowTargetKindsForSource(source).includes(target);
}

function wouldCreateWorkflowCycle(edges: readonly AIProjectWorkflowEdge[], source: string, target: string): boolean {
	const outgoing = new Map<string, string[]>();
	for (const edge of edges) {
		const targets = outgoing.get(edge.source) ?? [];
		targets.push(edge.target);
		outgoing.set(edge.source, targets);
	}
	const queue = [target];
	const visited = new Set<string>();
	while (queue.length) {
		const id = queue.shift()!;
		if (id === source) {
			return true;
		}
		if (!visited.has(id)) {
			visited.add(id);
			queue.push(...(outgoing.get(id) ?? []));
		}
	}
	return false;
}

function parsePosition(value: unknown, label: string): AIProjectWorkflowPosition {
	if (!isRecord(value) || !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
		throw new Error(`${label} has an invalid position.`);
	}
	return { x: Number(value.x), y: Number(value.y) };
}

function uniqueIds<T extends { readonly id: string }>(items: readonly T[], label: string): Set<string> {
	const ids = new Set<string>();
	for (const item of items) {
		if (ids.has(item.id)) {
			throw new Error(`Duplicate AI Video ${label} '${item.id}'.`);
		}
		ids.add(item.id);
	}
	return ids;
}

function mediaKind(value: unknown): AIProjectMediaKind {
	if (value === 'text' || value === 'image' || value === 'video' || value === 'audio') {
		return value;
	}
	throw new Error(`Invalid AI Video media kind '${String(value)}'.`);
}

function textRole(value: unknown): AIProjectTextRole {
	return value === 'brief' || value === 'script' || value === 'storyboard' || value === 'imagePrompt' || value === 'videoPrompt' || value === 'dialogue' || value === 'note' ? value : 'note';
}

function imageRole(value: unknown): AIProjectImageRole {
	return value === 'reference' || value === 'frame' ? value : 'generate';
}

function videoRole(value: unknown): AIProjectVideoRole {
	return value === 'reference' ? value : 'generate';
}

function audioRole(value: unknown): AIProjectAudioRole {
	return value === 'music' || value === 'effect' || value === 'reference' ? value : 'voice';
}

function mediaSource(value: unknown): AIProjectMediaSource {
	return value === 'local' ? value : 'generate';
}

function videoAudioMode(value: unknown): AIProjectVideoAudioMode {
	return value === 'generate' || value === 'none' ? value : 'auto';
}

function nodeStatus(value: unknown): AIProjectNodeStatus {
	return value === 'ready' || value === 'running' || value === 'prepared' || value === 'complete' || value === 'error' || value === 'stale' ? value : 'draft';
}

function recoveredNodeStatus(value: unknown, hasPreviousResult: boolean): AIProjectNodeStatus {
	const status = nodeStatus(value);
	return status === 'running' ? (hasPreviousResult ? 'stale' : 'draft') : status;
}

function safeIdPart(value: string): string {
	return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
	const number = numberValue(value, fallback);
	return Math.min(max, Math.max(min, number));
}

function numberValue(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringValue(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function requiredString(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value) {
		throw new Error(`Invalid AI Video ${label}.`);
	}
	return value;
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function arrayValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
