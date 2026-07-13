/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

export type AIProjectShotStatus = 'draft' | 'prepared' | 'running' | 'complete' | 'error';
export type AIProjectWorkflowNodeKind = 'script' | 'character' | 'scene' | 'shot';

export const AI_VIDEO_SCRIPT_NODE_ID = 'script';

export interface AIProjectCharacter {
	id: string;
	name: string;
	description: string;
}

export interface AIProjectScene {
	id: string;
	name: string;
	description: string;
}

export interface AIProjectShot {
	id: string;
	title: string;
	/**
	 * Compatibility field for early connectors. The workflow edge from a scene
	 * to this shot is authoritative and this value is derived from that edge.
	 */
	sceneId: string;
	prompt: string;
	dialogue: string;
	videoProvider: string;
	voiceProvider: string;
	status: AIProjectShotStatus;
	outputs: string[];
	error?: string;
}

export interface AIProjectWorkflowPosition {
	x: number;
	y: number;
}

export interface AIProjectWorkflowNode {
	id: string;
	kind: AIProjectWorkflowNodeKind;
	position: AIProjectWorkflowPosition;
}

export interface AIProjectWorkflowEdge {
	id: string;
	source: string;
	target: string;
}

export interface AIProjectWorkflow {
	nodes: AIProjectWorkflowNode[];
	edges: AIProjectWorkflowEdge[];
}

export interface AIProject {
	version: 2;
	title: string;
	script: string;
	characters: AIProjectCharacter[];
	scenes: AIProjectScene[];
	shots: AIProjectShot[];
	workflow: AIProjectWorkflow;
}

export interface AIProjectWorkflowConnectionValidation {
	readonly valid: boolean;
	readonly reason?: string;
}

export function createAIProject(title = 'Untitled AI Video'): AIProject {
	const sceneId = createId('scene');
	const shotId = createId('shot');
	const project: AIProject = {
		version: 2,
		title,
		script: '',
		characters: [],
		scenes: [{ id: sceneId, name: 'Scene 1', description: '' }],
		shots: [{
			id: shotId,
			title: 'Shot 1',
			sceneId,
			prompt: '',
			dialogue: '',
			videoProvider: 'prompt-package',
			voiceProvider: 'none',
			status: 'draft',
			outputs: []
		}],
		workflow: { nodes: [], edges: [] }
	};
	project.workflow = createDefaultWorkflow(project);
	return project;
}

export function parseAIProject(value: string): AIProject {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch (error) {
		throw new Error(`Invalid AI Video project JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!isRecord(parsed) || (parsed.version !== 1 && parsed.version !== 2)) {
		throw new Error('Unsupported AI Video project. Expected version 1 or 2.');
	}
	const project: AIProject = {
		version: 2,
		title: stringValue(parsed.title, 'Untitled AI Video'),
		script: stringValue(parsed.script),
		characters: arrayValue(parsed.characters).map((entry, index) => ({
			id: recordString(entry, 'id', createId('character')),
			name: recordString(entry, 'name', `Character ${index + 1}`),
			description: recordString(entry, 'description')
		})),
		scenes: arrayValue(parsed.scenes).map((entry, index) => ({
			id: recordString(entry, 'id', createId('scene')),
			name: recordString(entry, 'name', `Scene ${index + 1}`),
			description: recordString(entry, 'description')
		})),
		shots: arrayValue(parsed.shots).map((entry, index) => ({
			id: recordString(entry, 'id', createId('shot')),
			title: recordString(entry, 'title', `Shot ${index + 1}`),
			sceneId: recordString(entry, 'sceneId'),
			prompt: recordString(entry, 'prompt'),
			dialogue: recordString(entry, 'dialogue'),
			videoProvider: recordString(entry, 'videoProvider') || 'prompt-package',
			voiceProvider: recordString(entry, 'voiceProvider') || 'none',
			status: shotStatus(recordString(entry, 'status', 'draft')),
			outputs: arrayValue(isRecord(entry) ? entry.outputs : undefined).filter((output): output is string => typeof output === 'string'),
			error: optionalRecordString(entry, 'error')
		})),
		workflow: { nodes: [], edges: [] }
	};
	assertUniqueDomainIds(project);
	project.workflow = parsed.version === 1
		? createDefaultWorkflow(project)
		: parseWorkflow(parsed.workflow, project);
	synchronizeShotSceneIds(project);
	return project;
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

export function workflowNodeKind(project: AIProject, id: string): AIProjectWorkflowNodeKind | undefined {
	if (id === AI_VIDEO_SCRIPT_NODE_ID) {
		return 'script';
	}
	if (project.characters.some(character => character.id === id)) {
		return 'character';
	}
	if (project.scenes.some(scene => scene.id === id)) {
		return 'scene';
	}
	if (project.shots.some(shot => shot.id === id)) {
		return 'shot';
	}
	return undefined;
}

export function validateWorkflowConnection(project: AIProject, source: string, target: string): AIProjectWorkflowConnectionValidation {
	if (!workflowNodeKind(project, source) || !workflowNodeKind(project, target)) {
		return { valid: false, reason: 'Both connection endpoints must exist.' };
	}
	if (source === target) {
		return { valid: false, reason: 'A node cannot depend on itself.' };
	}
	if (target === AI_VIDEO_SCRIPT_NODE_ID) {
		return { valid: false, reason: 'The script is a source node and cannot accept inputs.' };
	}
	if (project.workflow.edges.some(edge => edge.source === source && edge.target === target)) {
		return { valid: false, reason: 'This dependency already exists.' };
	}
	if (wouldCreateWorkflowCycle(project.workflow.edges, source, target)) {
		return { valid: false, reason: 'Workflow dependencies cannot form a cycle.' };
	}
	return { valid: true };
}

export function topologicalWorkflowNodeIds(project: AIProject): readonly string[] {
	const ids = project.workflow.nodes.map(node => node.id);
	const indegree = new Map(ids.map(id => [id, 0]));
	const outgoing = new Map(ids.map(id => [id, [] as string[]]));
	for (const edge of project.workflow.edges) {
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
	for (const edge of project.workflow.edges) {
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

export function pendingShotIdsInWorkflowOrder(project: AIProject): readonly string[] {
	const pending = new Set(project.shots
		.filter(shot => shot.status === 'draft' || shot.status === 'error' || shot.status === 'running')
		.map(shot => shot.id));
	return topologicalWorkflowNodeIds(project).filter(id => pending.has(id));
}

/**
 * Marks executable nodes affected by an edited node or dependency as pending.
 * Existing output paths remain available as prior local results, but they are
 * no longer treated as current by Run pending.
 */
export function invalidateDownstreamShots(project: AIProject, sourceIds: readonly string[]): void {
	const outgoing = new Map<string, string[]>();
	for (const edge of project.workflow.edges) {
		const targets = outgoing.get(edge.source) ?? [];
		targets.push(edge.target);
		outgoing.set(edge.source, targets);
	}
	const affected = new Set<string>();
	const queue = [...sourceIds];
	while (queue.length) {
		const id = queue.shift()!;
		if (affected.has(id)) {
			continue;
		}
		affected.add(id);
		queue.push(...(outgoing.get(id) ?? []));
	}
	for (const shot of project.shots) {
		if (affected.has(shot.id)) {
			shot.status = 'draft';
			delete shot.error;
		}
	}
}

export function synchronizeShotSceneIds(project: AIProject): void {
	const sceneIds = new Set(project.scenes.map(scene => scene.id));
	for (const shot of project.shots) {
		shot.sceneId = project.workflow.edges.find(edge => edge.target === shot.id && sceneIds.has(edge.source))?.source ?? '';
	}
}

function createDefaultWorkflow(project: Omit<AIProject, 'workflow'> | AIProject): AIProjectWorkflow {
	const nodes: AIProjectWorkflowNode[] = [
		{ id: AI_VIDEO_SCRIPT_NODE_ID, kind: 'script', position: { x: 80, y: 90 } },
		...project.characters.map((character, index) => ({ id: character.id, kind: 'character' as const, position: defaultPosition('character', index) })),
		...project.scenes.map((scene, index) => ({ id: scene.id, kind: 'scene' as const, position: defaultPosition('scene', index) })),
		...project.shots.map((shot, index) => ({ id: shot.id, kind: 'shot' as const, position: defaultPosition('shot', index) }))
	];
	const edges: AIProjectWorkflowEdge[] = [];
	for (const scene of project.scenes) {
		edges.push({ id: createWorkflowEdgeId(AI_VIDEO_SCRIPT_NODE_ID, scene.id), source: AI_VIDEO_SCRIPT_NODE_ID, target: scene.id });
	}
	for (const shot of project.shots) {
		const source = project.scenes.some(scene => scene.id === shot.sceneId) ? shot.sceneId : AI_VIDEO_SCRIPT_NODE_ID;
		edges.push({ id: createWorkflowEdgeId(source, shot.id), source, target: shot.id });
	}
	return { nodes, edges };
}

function parseWorkflow(value: unknown, project: AIProject): AIProjectWorkflow {
	if (!isRecord(value)) {
		throw new Error('Invalid AI Video workflow. Expected an object.');
	}
	const nodes: AIProjectWorkflowNode[] = [];
	const nodeIds = new Set<string>();
	for (const entry of arrayValue(value.nodes)) {
		if (!isRecord(entry)) {
			throw new Error('Invalid AI Video workflow node.');
		}
		const id = requiredRecordString(entry, 'id', 'workflow node');
		if (nodeIds.has(id)) {
			throw new Error(`Duplicate AI Video workflow node '${id}'.`);
		}
		const kind = workflowKind(requiredRecordString(entry, 'kind', `workflow node '${id}'`));
		const expectedKind = workflowNodeKind(project, id);
		if (!expectedKind || expectedKind !== kind) {
			throw new Error(`Workflow node '${id}' does not match a ${kind} project item.`);
		}
		const position = isRecord(entry.position) ? entry.position : undefined;
		if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
			throw new Error(`Workflow node '${id}' has an invalid position.`);
		}
		nodeIds.add(id);
		nodes.push({ id, kind, position: { x: Number(position.x), y: Number(position.y) } });
	}
	for (const [id, kind, index] of expectedWorkflowNodes(project)) {
		if (!nodeIds.has(id)) {
			nodeIds.add(id);
			nodes.push({ id, kind, position: defaultPosition(kind, index) });
		}
	}

	const edges: AIProjectWorkflowEdge[] = [];
	const edgeIds = new Set<string>();
	const endpoints = new Set<string>();
	for (const entry of arrayValue(value.edges)) {
		if (!isRecord(entry)) {
			throw new Error('Invalid AI Video workflow edge.');
		}
		const source = requiredRecordString(entry, 'source', 'workflow edge');
		const target = requiredRecordString(entry, 'target', 'workflow edge');
		const id = recordString(entry, 'id', createWorkflowEdgeId(source, target));
		if (!nodeIds.has(source) || !nodeIds.has(target)) {
			throw new Error(`Workflow edge '${id}' references a missing node.`);
		}
		if (source === target || target === AI_VIDEO_SCRIPT_NODE_ID) {
			throw new Error(`Workflow edge '${id}' has invalid endpoints.`);
		}
		if (edgeIds.has(id) || endpoints.has(`${source}\n${target}`)) {
			throw new Error(`Duplicate AI Video workflow edge '${id}'.`);
		}
		if (wouldCreateWorkflowCycle(edges, source, target)) {
			throw new Error(`Workflow edge '${id}' creates a cycle.`);
		}
		edgeIds.add(id);
		endpoints.add(`${source}\n${target}`);
		edges.push({ id, source, target });
	}
	return { nodes, edges };
}

function expectedWorkflowNodes(project: AIProject): readonly [string, AIProjectWorkflowNodeKind, number][] {
	return [
		[AI_VIDEO_SCRIPT_NODE_ID, 'script', 0],
		...project.characters.map((character, index): [string, AIProjectWorkflowNodeKind, number] => [character.id, 'character', index]),
		...project.scenes.map((scene, index): [string, AIProjectWorkflowNodeKind, number] => [scene.id, 'scene', index]),
		...project.shots.map((shot, index): [string, AIProjectWorkflowNodeKind, number] => [shot.id, 'shot', index])
	];
}

function defaultPosition(kind: AIProjectWorkflowNodeKind, index: number): AIProjectWorkflowPosition {
	switch (kind) {
		case 'script': return { x: 80, y: 90 };
		case 'character': return { x: 80, y: 330 + index * 170 };
		case 'scene': return { x: 420, y: 90 + index * 200 };
		case 'shot': return { x: 780, y: 90 + index * 220 };
	}
}

function wouldCreateWorkflowCycle(edges: readonly Pick<AIProjectWorkflowEdge, 'source' | 'target'>[], source: string, target: string): boolean {
	const outgoing = new Map<string, string[]>();
	for (const edge of [...edges, { source, target }]) {
		const targets = outgoing.get(edge.source) ?? [];
		targets.push(edge.target);
		outgoing.set(edge.source, targets);
	}
	const seen = new Set<string>();
	const visit = (id: string): boolean => {
		if (id === source) {
			return true;
		}
		if (seen.has(id)) {
			return false;
		}
		seen.add(id);
		return (outgoing.get(id) ?? []).some(visit);
	};
	return visit(target);
}

function assertUniqueDomainIds(project: AIProject): void {
	const ids = new Set<string>([AI_VIDEO_SCRIPT_NODE_ID]);
	for (const item of [...project.characters, ...project.scenes, ...project.shots]) {
		if (!item.id || ids.has(item.id)) {
			throw new Error(`Duplicate or reserved AI Video project id '${item.id}'.`);
		}
		ids.add(item.id);
	}
}

function workflowKind(value: string): AIProjectWorkflowNodeKind {
	if (value === 'script' || value === 'character' || value === 'scene' || value === 'shot') {
		return value;
	}
	throw new Error(`Unsupported AI Video workflow node kind '${value}'.`);
}

function safeIdPart(value: string): string {
	return value.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32) || 'node';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function arrayValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function recordString(value: unknown, key: string, fallback = ''): string {
	return isRecord(value) ? stringValue(value[key], fallback) : fallback;
}

function requiredRecordString(value: Record<string, unknown>, key: string, label: string): string {
	const result = recordString(value, key);
	if (!result) {
		throw new Error(`Invalid ${label}. Missing '${key}'.`);
	}
	return result;
}

function optionalRecordString(value: unknown, key: string): string | undefined {
	const result = recordString(value, key);
	return result || undefined;
}

function shotStatus(value: string): AIProjectShotStatus {
	return value === 'prepared' || value === 'running' || value === 'complete' || value === 'error' ? value : 'draft';
}
