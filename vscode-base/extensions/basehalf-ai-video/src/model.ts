/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

export type AIProjectShotStatus = 'draft' | 'prepared' | 'running' | 'complete' | 'error';
export type AIProjectWorkflowNodeKind = 'brief' | 'script' | 'character' | 'scene' | 'style' | 'shot';
export type AIProjectWorkflowEdgeKind = 'context' | 'sequence';

export const AI_VIDEO_BRIEF_NODE_ID = 'brief';
export const AI_VIDEO_SCRIPT_NODE_ID = 'script';

export interface AIProjectBrief {
	objective: string;
	audience: string;
	format: string;
	aspectRatio: string;
	targetDurationSeconds: number;
	language: string;
}

export interface AIProjectCharacter {
	id: string;
	name: string;
	description: string;
	referenceFiles: string[];
}

export interface AIProjectScene {
	id: string;
	name: string;
	description: string;
	continuity: string;
}

export interface AIProjectStyle {
	id: string;
	name: string;
	description: string;
	prompt: string;
	negativePrompt: string;
	referenceFiles: string[];
}

export interface AIProjectShot {
	id: string;
	title: string;
	/**
	 * Compatibility field for connectors that need direct scene lookup. The
	 * context edge from a scene to this shot is authoritative.
	 */
	sceneId: string;
	storyboard: string;
	camera: string;
	motion: string;
	prompt: string;
	negativePrompt: string;
	dialogue: string;
	audio: string;
	durationSeconds: number;
	startFrame: string;
	endFrame: string;
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
	kind: AIProjectWorkflowEdgeKind;
}

export interface AIProjectWorkflow {
	nodes: AIProjectWorkflowNode[];
	edges: AIProjectWorkflowEdge[];
}

export interface AIProject {
	version: 3;
	title: string;
	brief: AIProjectBrief;
	script: string;
	characters: AIProjectCharacter[];
	scenes: AIProjectScene[];
	styles: AIProjectStyle[];
	shots: AIProjectShot[];
	workflow: AIProjectWorkflow;
	outputs: string[];
}

export interface AIProjectWorkflowConnectionValidation {
	readonly valid: boolean;
	readonly kind?: AIProjectWorkflowEdgeKind;
	readonly reason?: string;
}

export function createAIProject(title = 'Untitled AI Video'): AIProject {
	const sceneId = createId('scene');
	const styleId = createId('style');
	const shotId = createId('shot');
	const project: AIProject = {
		version: 3,
		title,
		brief: createBrief(),
		script: '',
		characters: [],
		scenes: [{ id: sceneId, name: 'Scene 1', description: '', continuity: '' }],
		styles: [{
			id: styleId,
			name: 'Visual direction',
			description: '',
			prompt: '',
			negativePrompt: '',
			referenceFiles: []
		}],
		shots: [{
			id: shotId,
			title: 'Shot 1',
			sceneId,
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
			videoProvider: 'prompt-package',
			voiceProvider: 'none',
			status: 'draft',
			outputs: []
		}],
		workflow: { nodes: [], edges: [] },
		outputs: []
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
	if (!isRecord(parsed) || (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3)) {
		throw new Error('Unsupported AI Video project. Expected version 1, 2, or 3.');
	}
	const legacy = parsed.version !== 3;
	const project: AIProject = {
		version: 3,
		title: stringValue(parsed.title, 'Untitled AI Video'),
		brief: parseBrief(parsed.brief),
		script: stringValue(parsed.script),
		characters: arrayValue(parsed.characters).map((entry, index) => ({
			id: recordString(entry, 'id', createId('character')),
			name: recordString(entry, 'name', `Character ${index + 1}`),
			description: recordString(entry, 'description'),
			referenceFiles: stringArray(isRecord(entry) ? entry.referenceFiles : undefined)
		})),
		scenes: arrayValue(parsed.scenes).map((entry, index) => ({
			id: recordString(entry, 'id', createId('scene')),
			name: recordString(entry, 'name', `Scene ${index + 1}`),
			description: recordString(entry, 'description'),
			continuity: recordString(entry, 'continuity')
		})),
		styles: arrayValue(parsed.styles).map((entry, index) => ({
			id: recordString(entry, 'id', createId('style')),
			name: recordString(entry, 'name', `Visual direction ${index + 1}`),
			description: recordString(entry, 'description'),
			prompt: recordString(entry, 'prompt'),
			negativePrompt: recordString(entry, 'negativePrompt'),
			referenceFiles: stringArray(isRecord(entry) ? entry.referenceFiles : undefined)
		})),
		shots: arrayValue(parsed.shots).map((entry, index) => ({
			id: recordString(entry, 'id', createId('shot')),
			title: recordString(entry, 'title', `Shot ${index + 1}`),
			sceneId: recordString(entry, 'sceneId'),
			storyboard: recordString(entry, 'storyboard', legacy ? recordString(entry, 'prompt') : ''),
			camera: recordString(entry, 'camera'),
			motion: recordString(entry, 'motion'),
			prompt: recordString(entry, 'prompt'),
			negativePrompt: recordString(entry, 'negativePrompt'),
			dialogue: recordString(entry, 'dialogue'),
			audio: recordString(entry, 'audio'),
			durationSeconds: boundedNumber(isRecord(entry) ? entry.durationSeconds : undefined, 5, 1, 120),
			startFrame: recordString(entry, 'startFrame'),
			endFrame: recordString(entry, 'endFrame'),
			videoProvider: recordString(entry, 'videoProvider') || 'prompt-package',
			voiceProvider: recordString(entry, 'voiceProvider') || 'none',
			status: shotStatus(recordString(entry, 'status', 'draft')),
			outputs: stringArray(isRecord(entry) ? entry.outputs : undefined),
			error: optionalRecordString(entry, 'error')
		})),
		workflow: { nodes: [], edges: [] },
		outputs: stringArray(parsed.outputs)
	};
	assertUniqueDomainIds(project);
	project.workflow = parsed.version === 1
		? createDefaultWorkflow(project)
		: parseWorkflow(parsed.workflow, project, legacy);
	if (legacy) {
		ensureLegacyBriefConnection(project);
	} else if (!project.workflow.edges.some(edge => edge.source === AI_VIDEO_BRIEF_NODE_ID && edge.target === AI_VIDEO_SCRIPT_NODE_ID)) {
		throw new Error('AI Video workflow must connect the creative brief to the script.');
	}
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
	if (id === AI_VIDEO_BRIEF_NODE_ID) {
		return 'brief';
	}
	if (id === AI_VIDEO_SCRIPT_NODE_ID) {
		return 'script';
	}
	if (project.characters.some(character => character.id === id)) {
		return 'character';
	}
	if (project.scenes.some(scene => scene.id === id)) {
		return 'scene';
	}
	if (project.styles.some(style => style.id === id)) {
		return 'style';
	}
	if (project.shots.some(shot => shot.id === id)) {
		return 'shot';
	}
	return undefined;
}

export function workflowEdgeKind(project: AIProject, source: string, target: string): AIProjectWorkflowEdgeKind {
	return workflowNodeKind(project, source) === 'shot' && workflowNodeKind(project, target) === 'shot' ? 'sequence' : 'context';
}

export function validateWorkflowConnection(project: AIProject, source: string, target: string): AIProjectWorkflowConnectionValidation {
	const sourceKind = workflowNodeKind(project, source);
	const targetKind = workflowNodeKind(project, target);
	if (!sourceKind || !targetKind) {
		return { valid: false, reason: 'Both connection endpoints must exist.' };
	}
	if (source === target) {
		return { valid: false, reason: 'A node cannot depend on itself.' };
	}
	if (targetKind === 'brief') {
		return { valid: false, reason: 'The brief is the workflow source and cannot accept inputs.' };
	}
	if (targetKind === 'script' && sourceKind !== 'brief') {
		return { valid: false, reason: 'Only the brief can provide context to the script.' };
	}
	if ((targetKind === 'character' || targetKind === 'style') && sourceKind !== 'brief' && sourceKind !== 'script') {
		return { valid: false, reason: `${capitalize(targetKind)} nodes accept only brief or script context.` };
	}
	if (sourceKind === 'shot' && targetKind !== 'shot') {
		return { valid: false, reason: 'A shot can continue into another shot, but cannot feed planning nodes.' };
	}
	if (sourceKind === 'scene' && targetKind === 'shot' && project.workflow.edges.some(edge => edge.target === target && workflowNodeKind(project, edge.source) === 'scene')) {
		return { valid: false, reason: 'A shot can have only one current scene.' };
	}
	if (project.workflow.edges.some(edge => edge.source === source && edge.target === target)) {
		return { valid: false, reason: 'This dependency already exists.' };
	}
	if (wouldCreateWorkflowCycle(project.workflow.edges, source, target)) {
		return { valid: false, reason: 'Workflow dependencies cannot form a cycle.' };
	}
	return { valid: true, kind: workflowEdgeKind(project, source, target) };
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
	return upstreamNodeIds(project, targetId, () => true);
}

export function upstreamContextNodeIds(project: AIProject, targetId: string): readonly string[] {
	return upstreamNodeIds(project, targetId, edge => edge.kind === 'context');
}

export function priorShotIds(project: AIProject, targetId: string): readonly string[] {
	const upstream = upstreamNodeIds(project, targetId, edge => edge.kind === 'sequence');
	return upstream.filter(id => workflowNodeKind(project, id) === 'shot');
}

function upstreamNodeIds(project: AIProject, targetId: string, include: (edge: AIProjectWorkflowEdge) => boolean): readonly string[] {
	const incoming = new Map<string, string[]>();
	for (const edge of project.workflow.edges.filter(include)) {
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

export function composeShotPrompt(project: AIProject, shotId: string): string {
	const shot = project.shots.find(candidate => candidate.id === shotId);
	if (!shot) {
		throw new Error(`Shot '${shotId}' does not exist.`);
	}
	const upstream = upstreamContextNodeIds(project, shotId);
	const scene = project.scenes.find(item => item.id === shot.sceneId);
	const styles = project.styles.filter(item => upstream.includes(item.id));
	const characters = project.characters.filter(item => upstream.includes(item.id));
	const visualParts = [
		shot.camera,
		shot.storyboard,
		shot.motion ? `Motion: ${shot.motion}` : '',
		scene?.description ?? '',
		...characters.map(character => `${character.name}: ${character.description}`),
		...styles.map(style => style.prompt || style.description),
		`Continuous shot, ${shot.durationSeconds} seconds, ${project.brief.aspectRatio || 'project aspect ratio'}.`
	].map(part => part.trim()).filter(Boolean);
	return visualParts.join(' ');
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
		shot.sceneId = project.workflow.edges.find(edge => edge.kind === 'context' && edge.target === shot.id && sceneIds.has(edge.source))?.source ?? '';
	}
}

function createBrief(value: Partial<AIProjectBrief> = {}): AIProjectBrief {
	return {
		objective: value.objective ?? '',
		audience: value.audience ?? '',
		format: value.format ?? 'Short narrative',
		aspectRatio: value.aspectRatio ?? '9:16',
		targetDurationSeconds: value.targetDurationSeconds ?? 30,
		language: value.language ?? 'English'
	};
}

function parseBrief(value: unknown): AIProjectBrief {
	return createBrief(isRecord(value) ? {
		objective: stringValue(value.objective),
		audience: stringValue(value.audience),
		format: stringValue(value.format, 'Short narrative'),
		aspectRatio: stringValue(value.aspectRatio, '9:16'),
		targetDurationSeconds: boundedNumber(value.targetDurationSeconds, 30, 1, 3600),
		language: stringValue(value.language, 'English')
	} : undefined);
}

function createDefaultWorkflow(project: Omit<AIProject, 'workflow'> | AIProject): AIProjectWorkflow {
	const nodes: AIProjectWorkflowNode[] = [
		{ id: AI_VIDEO_BRIEF_NODE_ID, kind: 'brief', position: defaultPosition('brief', 0) },
		{ id: AI_VIDEO_SCRIPT_NODE_ID, kind: 'script', position: defaultPosition('script', 0) },
		...project.characters.map((character, index) => ({ id: character.id, kind: 'character' as const, position: defaultPosition('character', index) })),
		...project.styles.map((style, index) => ({ id: style.id, kind: 'style' as const, position: defaultPosition('style', index) })),
		...project.scenes.map((scene, index) => ({ id: scene.id, kind: 'scene' as const, position: defaultPosition('scene', index) })),
		...project.shots.map((shot, index) => ({ id: shot.id, kind: 'shot' as const, position: defaultPosition('shot', index) }))
	];
	const edges: AIProjectWorkflowEdge[] = [createEdge(project, AI_VIDEO_BRIEF_NODE_ID, AI_VIDEO_SCRIPT_NODE_ID)];
	for (const style of project.styles) {
		edges.push(createEdge(project, AI_VIDEO_BRIEF_NODE_ID, style.id));
	}
	for (const scene of project.scenes) {
		edges.push(createEdge(project, AI_VIDEO_SCRIPT_NODE_ID, scene.id));
	}
	for (const shot of project.shots) {
		const source = project.scenes.some(scene => scene.id === shot.sceneId) ? shot.sceneId : AI_VIDEO_SCRIPT_NODE_ID;
		edges.push(createEdge(project, source, shot.id));
		for (const style of project.styles) {
			edges.push(createEdge(project, style.id, shot.id));
		}
	}
	return { nodes, edges };
}

function createEdge(project: Omit<AIProject, 'workflow'> | AIProject, source: string, target: string): AIProjectWorkflowEdge {
	const sourceIsShot = project.shots.some(shot => shot.id === source);
	const targetIsShot = project.shots.some(shot => shot.id === target);
	return {
		id: createWorkflowEdgeId(source, target),
		source,
		target,
		kind: sourceIsShot && targetIsShot ? 'sequence' : 'context'
	};
}

function parseWorkflow(value: unknown, project: AIProject, legacy: boolean): AIProjectWorkflow {
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
		const expectedKind = workflowEdgeKind(project, source, target);
		const kind = legacy ? expectedKind : workflowEdgeType(recordString(entry, 'kind', expectedKind));
		if (kind !== expectedKind) {
			throw new Error(`Workflow edge '${id}' has the wrong semantic kind.`);
		}
		if (source === target || target === AI_VIDEO_BRIEF_NODE_ID) {
			throw new Error(`Workflow edge '${id}' has invalid endpoints.`);
		}
		if (!legacy && !semanticConnectionAllowed(project, source, target)) {
			throw new Error(`Workflow edge '${id}' connects incompatible node kinds.`);
		}
		if (!legacy && workflowNodeKind(project, source) === 'scene' && workflowNodeKind(project, target) === 'shot'
			&& edges.some(edge => edge.target === target && workflowNodeKind(project, edge.source) === 'scene')) {
			throw new Error(`Workflow edge '${id}' gives a shot more than one current scene.`);
		}
		if (edgeIds.has(id) || endpoints.has(`${source}\n${target}`)) {
			throw new Error(`Duplicate AI Video workflow edge '${id}'.`);
		}
		if (wouldCreateWorkflowCycle(edges, source, target)) {
			throw new Error(`Workflow edge '${id}' creates a cycle.`);
		}
		edgeIds.add(id);
		endpoints.add(`${source}\n${target}`);
		edges.push({ id, source, target, kind });
	}
	return { nodes, edges };
}

function semanticConnectionAllowed(project: AIProject, source: string, target: string): boolean {
	const sourceKind = workflowNodeKind(project, source);
	const targetKind = workflowNodeKind(project, target);
	if (!sourceKind || !targetKind || targetKind === 'brief') {
		return false;
	}
	if (targetKind === 'script') {
		return sourceKind === 'brief';
	}
	if (targetKind === 'character' || targetKind === 'style') {
		return sourceKind === 'brief' || sourceKind === 'script';
	}
	return sourceKind !== 'shot' || targetKind === 'shot';
}

function ensureLegacyBriefConnection(project: AIProject): void {
	if (!project.workflow.edges.some(edge => edge.source === AI_VIDEO_BRIEF_NODE_ID && edge.target === AI_VIDEO_SCRIPT_NODE_ID)) {
		project.workflow.edges.unshift(createEdge(project, AI_VIDEO_BRIEF_NODE_ID, AI_VIDEO_SCRIPT_NODE_ID));
	}
}

function expectedWorkflowNodes(project: AIProject): readonly [string, AIProjectWorkflowNodeKind, number][] {
	return [
		[AI_VIDEO_BRIEF_NODE_ID, 'brief', 0],
		[AI_VIDEO_SCRIPT_NODE_ID, 'script', 0],
		...project.characters.map((character, index): [string, AIProjectWorkflowNodeKind, number] => [character.id, 'character', index]),
		...project.styles.map((style, index): [string, AIProjectWorkflowNodeKind, number] => [style.id, 'style', index]),
		...project.scenes.map((scene, index): [string, AIProjectWorkflowNodeKind, number] => [scene.id, 'scene', index]),
		...project.shots.map((shot, index): [string, AIProjectWorkflowNodeKind, number] => [shot.id, 'shot', index])
	];
}

function defaultPosition(kind: AIProjectWorkflowNodeKind, index: number): AIProjectWorkflowPosition {
	switch (kind) {
		case 'brief': return { x: 80, y: 90 };
		case 'script': return { x: 400, y: 90 };
		case 'character': return { x: 400, y: 340 + index * 190 };
		case 'style': return { x: 400, y: 560 + index * 190 };
		case 'scene': return { x: 720, y: 90 + index * 220 };
		case 'shot': return { x: 1040, y: 90 + index * 240 };
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
	const ids = new Set<string>([AI_VIDEO_BRIEF_NODE_ID, AI_VIDEO_SCRIPT_NODE_ID]);
	for (const item of [...project.characters, ...project.scenes, ...project.styles, ...project.shots]) {
		if (!item.id || ids.has(item.id)) {
			throw new Error(`Duplicate or reserved AI Video project id '${item.id}'.`);
		}
		ids.add(item.id);
	}
}

function workflowKind(value: string): AIProjectWorkflowNodeKind {
	if (value === 'brief' || value === 'script' || value === 'character' || value === 'scene' || value === 'style' || value === 'shot') {
		return value;
	}
	throw new Error(`Unsupported AI Video workflow node kind '${value}'.`);
}

function workflowEdgeType(value: string): AIProjectWorkflowEdgeKind {
	if (value === 'context' || value === 'sequence') {
		return value;
	}
	throw new Error(`Unsupported AI Video workflow edge kind '${value}'.`);
}

function safeIdPart(value: string): string {
	return value.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32) || 'node';
}

function capitalize(value: string): string {
	return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function arrayValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
	return arrayValue(value).filter((entry): entry is string => typeof entry === 'string');
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

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function shotStatus(value: string): AIProjectShotStatus {
	return value === 'prepared' || value === 'running' || value === 'complete' || value === 'error' ? value : 'draft';
}
