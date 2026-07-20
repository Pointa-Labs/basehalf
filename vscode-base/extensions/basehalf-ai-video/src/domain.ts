/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export const EXTENSION_ID = 'pointa.basehalf-ai-video';
export const CREATE_WORKFLOW_COMMAND_ID = `${EXTENSION_ID}.createWorkflow`;
export const INSPECT_SEQUENCE_COMMAND_ID = `${EXTENSION_ID}.inspectSequence`;
export const ADD_SEQUENCE_ITEM_COMMAND_ID = `${EXTENSION_ID}.addSequenceItemFromCurrent`;
export const MOVE_SEQUENCE_ITEM_COMMAND_ID = `${EXTENSION_ID}.moveSequenceItem`;
export const UPDATE_SEQUENCE_ITEM_COMMAND_ID = `${EXTENSION_ID}.updateSequenceItemToCurrent`;
export const REMOVE_SEQUENCE_ITEM_COMMAND_ID = `${EXTENSION_ID}.removeSequenceItem`;
export const REPAIR_SEQUENCE_ITEM_PATH_COMMAND_ID = `${EXTENSION_ID}.repairSequenceItemPath`;
export const HOST_CREATE_FROM_TEMPLATE_COMMAND_ID = 'basehalf.canvas.createFromTemplate';
export const STARTER_TEMPLATE_ID = `${EXTENSION_ID}.starter-workflow`;
export const SEQUENCE_INSPECTION_CONCURRENCY = 8;
export const MAX_SEQUENCE_ITEMS = 10_000;

export const STORYBOARD_FRAME_RECIPE_ID = `${EXTENSION_ID}.storyboard-frame`;
export const CLIP_BRIEF_RECIPE_ID = `${EXTENSION_ID}.clip-brief`;
export const AUDIO_BRIEF_RECIPE_ID = `${EXTENSION_ID}.audio-brief`;

export const AI_VIDEO_RECIPE_IDS = [
	STORYBOARD_FRAME_RECIPE_ID,
	CLIP_BRIEF_RECIPE_ID,
	AUDIO_BRIEF_RECIPE_ID
] as const;

export type AIVideoRecipeId = typeof AI_VIDEO_RECIPE_IDS[number];
export type AIVideoContentKind = 'text' | 'code' | 'file' | 'folder' | 'image' | 'video' | 'audio' | 'pdf' | 'presentation';
export type AIVideoInputRole = 'prompt' | 'reference' | 'first-frame' | 'last-frame' | 'source-video' | 'audio' | 'style';
export type AIVideoNodeRole = 'storyboard-frame' | 'clip-plan' | 'audio-plan' | 'clip' | 'audio';
export type AIVideoAspectRatio = '9:16' | '16:9' | '1:1';

export const AI_VIDEO_NODE_ROLES: readonly AIVideoNodeRole[] = ['storyboard-frame', 'clip-plan', 'audio-plan', 'clip', 'audio'];

export interface AIVideoRecipeInput {
	readonly edgeId: string;
	readonly slotId: string;
	readonly order: number;
	readonly source: {
		readonly kind: AIVideoContentKind;
		readonly path: string;
		/** Bounded text read from the host-frozen direct-input snapshot, when available. */
		readonly text?: string;
	};
}

export interface StoryboardFrameParameters {
	readonly instructions: string;
	readonly aspectRatio: AIVideoAspectRatio;
	readonly shotLabel: string;
}

export interface ClipBriefParameters {
	readonly instructions: string;
	readonly durationSeconds: number;
	readonly aspectRatio: AIVideoAspectRatio;
	readonly audioMode: 'auto' | 'generate' | 'none';
}

export interface AudioBriefParameters {
	readonly instructions: string;
	readonly purpose: 'voice' | 'music' | 'effect';
	readonly durationSeconds: number;
	readonly voice: string;
}

export interface AIVideoShotDocument {
	readonly version: 1;
	readonly kind: 'pointa.basehalf-ai-video.shot';
	readonly id: string;
	readonly title: string;
	readonly clipNodePath: string;
}

export interface AIVideoSequenceItem {
	readonly id: string;
	readonly title: string;
	readonly nodeId: string;
	readonly videoNodePath: string;
	/** Exact successful run or imported revision selected for playback. */
	readonly versionId: string;
}

export interface AIVideoSequenceDocument {
	readonly version: 1;
	readonly kind: 'pointa.basehalf-ai-video.sequence';
	readonly items: readonly AIVideoSequenceItem[];
}

export type AIVideoSequenceNodeVersionStatus = 'imported' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export type AIVideoSequenceArtifactIntegrity = 'available' | 'missing' | 'changed';

export interface AIVideoSequenceNodeVersion {
	readonly id: string;
	readonly status: AIVideoSequenceNodeVersionStatus;
	readonly primaryArtifact?: {
		readonly kind: AIVideoContentKind;
		readonly integrity: AIVideoSequenceArtifactIntegrity;
		/** Opaque host resource retained for the caller that requested inspection. */
		readonly resource?: unknown;
	};
}

export interface AIVideoSequenceNodeState {
	readonly id: string;
	readonly kind: AIVideoContentKind;
	readonly currentVersionId?: string;
	readonly versions: readonly AIVideoSequenceNodeVersion[];
}

export interface AIVideoSequenceNodeInspectRequest {
	readonly versionIds: readonly string[];
	readonly includeCurrent: boolean;
}

export type AIVideoSequenceNodeRelocation =
	| { readonly kind: 'unique'; readonly videoNodePath: string; readonly node: AIVideoSequenceNodeState }
	| { readonly kind: 'ambiguous'; readonly matchCount: number }
	| { readonly kind: 'scanLimit'; readonly maximum: number };

export type AIVideoSequenceItemState = 'current' | 'pinned' | 'updateAvailable' | 'invalid';

export interface AIVideoSequencePlayableArtifact {
	readonly kind: 'video';
	readonly integrity: 'available';
	/** Opaque to the pure domain model; the extension projection validates it as a host URI. */
	readonly resource?: unknown;
}

export interface AIVideoSequenceItemInspection {
	readonly item: AIVideoSequenceItem;
	readonly state: AIVideoSequenceItemState;
	readonly message: string;
	/** The exact pinned artifact verified by this inspection pass. */
	readonly pinnedArtifact?: AIVideoSequencePlayableArtifact;
	/** Present only when Current is itself a verified Video result. */
	readonly availableCurrentVersionId?: string;
	/** A unique verified replacement path. Applying it always requires an explicit command. */
	readonly repairCandidatePath?: string;
}

export interface AIVideoSequenceInspection {
	readonly valid: boolean;
	readonly updatesAvailable: number;
	readonly items: readonly AIVideoSequenceItemInspection[];
}

type RecipeValue = null | boolean | number | string | readonly RecipeValue[] | { readonly [key: string]: RecipeValue };

interface InputSlotDefinition {
	readonly accepts: readonly AIVideoContentKind[];
	readonly minItems: number;
	readonly maxItems: number;
}

const INPUT_SLOTS: Readonly<Record<AIVideoRecipeId, Readonly<Partial<Record<AIVideoInputRole, InputSlotDefinition>>>>> = {
	[STORYBOARD_FRAME_RECIPE_ID]: {
		prompt: { accepts: ['text', 'code', 'file'], minItems: 0, maxItems: 8 },
		reference: { accepts: ['image'], minItems: 0, maxItems: 8 },
		style: { accepts: ['image'], minItems: 0, maxItems: 4 }
	},
	[CLIP_BRIEF_RECIPE_ID]: {
		prompt: { accepts: ['text', 'code', 'file'], minItems: 0, maxItems: 8 },
		reference: { accepts: ['image', 'video'], minItems: 0, maxItems: 8 },
		'first-frame': { accepts: ['image'], minItems: 0, maxItems: 1 },
		'last-frame': { accepts: ['image'], minItems: 0, maxItems: 1 },
		'source-video': { accepts: ['video'], minItems: 0, maxItems: 1 },
		audio: { accepts: ['audio', 'text', 'file'], minItems: 0, maxItems: 4 },
		style: { accepts: ['image', 'video'], minItems: 0, maxItems: 4 }
	},
	[AUDIO_BRIEF_RECIPE_ID]: {
		prompt: { accepts: ['text', 'code', 'file'], minItems: 0, maxItems: 8 },
		reference: { accepts: ['audio', 'video'], minItems: 0, maxItems: 4 }
	}
};

const ASPECT_RATIOS: readonly AIVideoAspectRatio[] = ['9:16', '16:9', '1:1'];
const AUDIO_MODES = ['auto', 'generate', 'none'] as const;
const AUDIO_PURPOSES = ['voice', 'music', 'effect'] as const;
const RECIPE_ID_SET = new Set<string>(AI_VIDEO_RECIPE_IDS);

export function isAIVideoRecipeId(value: string): value is AIVideoRecipeId {
	return RECIPE_ID_SET.has(value);
}

export function parseStoryboardFrameParameters(parameters: Readonly<Record<string, RecipeValue>>): StoryboardFrameParameters {
	assertOnlyKeys(parameters, ['instructions', 'aspect-ratio', 'shot-label'], STORYBOARD_FRAME_RECIPE_ID);
	return Object.freeze({
		instructions: requiredParameterText(parameters, 'instructions', 16_000),
		aspectRatio: optionalEnum(parameters, 'aspect-ratio', '9:16', ASPECT_RATIOS),
		shotLabel: optionalText(parameters, 'shot-label', 'Shot', 120)
	});
}

export function parseClipBriefParameters(parameters: Readonly<Record<string, RecipeValue>>): ClipBriefParameters {
	assertOnlyKeys(parameters, ['instructions', 'duration-seconds', 'aspect-ratio', 'audio-mode'], CLIP_BRIEF_RECIPE_ID);
	return Object.freeze({
		instructions: requiredParameterText(parameters, 'instructions', 16_000),
		durationSeconds: optionalInteger(parameters, 'duration-seconds', 5, 1, 120),
		aspectRatio: optionalEnum(parameters, 'aspect-ratio', '9:16', ASPECT_RATIOS),
		audioMode: optionalEnum(parameters, 'audio-mode', 'auto', AUDIO_MODES)
	});
}

export function parseAudioBriefParameters(parameters: Readonly<Record<string, RecipeValue>>): AudioBriefParameters {
	assertOnlyKeys(parameters, ['instructions', 'purpose', 'duration-seconds', 'voice'], AUDIO_BRIEF_RECIPE_ID);
	return Object.freeze({
		instructions: requiredParameterText(parameters, 'instructions', 16_000),
		purpose: optionalEnum(parameters, 'purpose', 'voice', AUDIO_PURPOSES),
		durationSeconds: optionalInteger(parameters, 'duration-seconds', 5, 1, 3_600),
		voice: optionalText(parameters, 'voice', 'auto', 120)
	});
}

export function validateRecipeInputs(recipeId: AIVideoRecipeId, inputs: readonly AIVideoRecipeInput[]): readonly AIVideoRecipeInput[] {
	const slots = INPUT_SLOTS[recipeId];
	if (inputs.length > 64) {
		throw new Error(`Recipe '${recipeId}' received too many direct inputs.`);
	}
	const edges = new Set<string>();
	const orders = new Set<number>();
	const bindings = new Set<string>();
	const counts = new Map<string, number>();
	const ordered = [...inputs].sort((left, right) => left.order - right.order);

	for (const [index, input] of ordered.entries()) {
		const slotId = input.slotId as AIVideoInputRole;
		const slot = slots[slotId];
		if (!slot) {
			throw new Error(`Recipe '${recipeId}' does not accept input slot '${input.slotId}'.`);
		}
		if (!slot.accepts.includes(input.source.kind)) {
			throw new Error(`Recipe '${recipeId}' input '${input.slotId}' does not accept '${input.source.kind}'.`);
		}
		if (!input.edgeId.trim()) {
			throw new Error(`Recipe '${recipeId}' received an input without edge provenance.`);
		}
		if (edges.has(input.edgeId)) {
			throw new Error(`Recipe '${recipeId}' received the same direct connection more than once.`);
		}
		if (!Number.isInteger(input.order) || input.order !== index || orders.has(input.order)) {
			throw new Error(`Recipe '${recipeId}' requires continuous, unique input order starting at zero.`);
		}
		if (!input.source.path.trim()) {
			throw new Error(`Recipe '${recipeId}' received an input without a project path.`);
		}
		const binding = input.source.path.toLowerCase();
		if (bindings.has(binding)) {
			throw new Error(`Recipe '${recipeId}' received the same source more than once.`);
		}
		bindings.add(binding);
		edges.add(input.edgeId);
		orders.add(input.order);
		counts.set(slotId, (counts.get(slotId) ?? 0) + 1);
	}

	for (const [slotId, definition] of Object.entries(slots)) {
		const count = counts.get(slotId) ?? 0;
		if (count < definition.minItems || count > definition.maxItems) {
			throw new Error(`Recipe '${recipeId}' input '${slotId}' expects ${definition.minItems}-${definition.maxItems} items; received ${count}.`);
		}
	}
	return Object.freeze(ordered);
}

function requiredParameterText(parameters: Readonly<Record<string, RecipeValue>>, key: string, maximum: number): string {
	const value = parameters[key];
	if (typeof value !== 'string' || value.includes('\u0000') || value.length > maximum || !value.trim()) {
		throw new Error(`Parameter '${key}' must be non-empty text no longer than ${maximum} characters.`);
	}
	return value;
}

export function parseAIVideoShotDocument(source: string): AIVideoShotDocument {
	const root = parseJsonRecord(source, 'shot');
	assertOnlyKeys(root, ['version', 'kind', 'id', 'title', 'clipNodePath'], 'shot');
	if (root.version !== 1 || root.kind !== 'pointa.basehalf-ai-video.shot') {
		throw new Error('The video shot does not use the supported version 1 format.');
	}
	return Object.freeze({
		version: 1,
		kind: 'pointa.basehalf-ai-video.shot',
		id: requiredText(root.id, 'shot.id', 128),
		title: requiredText(root.title, 'shot.title', 240),
		clipNodePath: portableProjectPath(root.clipNodePath, 'shot.clipNodePath', '.bhnode')
	});
}

export function resolveAIVideoShotClipNodePath(shotDocumentPath: string, clipNodePath: string): string {
	const relativePath = portableProjectPath(clipNodePath, 'shot.clipNodePath', '.bhnode');
	return resolve(dirname(shotDocumentPath), ...relativePath.split('/'));
}

export function parseAIVideoSequenceDocument(source: string): AIVideoSequenceDocument {
	const root = parseJsonRecord(source, 'sequence');
	assertOnlyKeys(root, ['version', 'kind', 'items'], 'sequence');
	if (root.version !== 1 || root.kind !== 'pointa.basehalf-ai-video.sequence' || !Array.isArray(root.items) || root.items.length > MAX_SEQUENCE_ITEMS) {
		throw new Error('The video sequence does not use the supported version 1 format.');
	}

	const ids = new Set<string>();
	const items = root.items.map((value, index) => {
		const item = record(value, `sequence.items[${index}]`);
		assertOnlyKeys(item, ['id', 'title', 'nodeId', 'videoNodePath', 'versionId'], `sequence.items[${index}]`);
		const id = requiredText(item.id, `sequence.items[${index}].id`, 128);
		if (ids.has(id)) {
			throw new Error(`The video sequence contains duplicate item id '${id}'.`);
		}
		ids.add(id);
		return Object.freeze({
			id,
			title: requiredText(item.title, `sequence.items[${index}].title`, 240),
			nodeId: requiredText(item.nodeId, `sequence.items[${index}].nodeId`, 128),
			videoNodePath: portableProjectPath(item.videoNodePath, `sequence.items[${index}].videoNodePath`, '.bhnode'),
			versionId: requiredText(item.versionId, `sequence.items[${index}].versionId`, 128)
		});
	});
	return Object.freeze({ version: 1, kind: 'pointa.basehalf-ai-video.sequence', items: Object.freeze(items) });
}

export function serializeAIVideoSequenceDocument(document: AIVideoSequenceDocument): string {
	return `${JSON.stringify(parseAIVideoSequenceDocument(JSON.stringify(document)), null, 2)}\n`;
}

export function resolveAIVideoSequenceVideoNodePath(sequenceDocumentPath: string, videoNodePath: string): string {
	const relativePath = portableProjectPath(videoNodePath, 'sequence.videoNodePath', '.bhnode');
	return resolve(dirname(sequenceDocumentPath), ...relativePath.split('/'));
}

export function addAIVideoSequenceItem(
	document: AIVideoSequenceDocument,
	item: AIVideoSequenceItem
): AIVideoSequenceDocument {
	const parsed = parseAIVideoSequenceDocument(JSON.stringify(document));
	const duplicate = parsed.items.find(candidate => candidate.nodeId === item.nodeId || candidate.videoNodePath === item.videoNodePath);
	if (duplicate) {
		throw new Error(`The Video node is already in the Sequence as '${duplicate.title}'. Update that item instead of adding it again.`);
	}
	return parseAIVideoSequenceDocument(JSON.stringify({
		...parsed,
		items: [...parsed.items, item]
	}));
}

export function removeAIVideoSequenceItem(
	document: AIVideoSequenceDocument,
	itemId: string
): AIVideoSequenceDocument {
	const parsed = parseAIVideoSequenceDocument(JSON.stringify(document));
	const normalizedItemId = requiredText(itemId, 'itemId', 128);
	const items = parsed.items.filter(item => item.id !== normalizedItemId);
	if (items.length === parsed.items.length) {
		throw new Error(`Sequence item '${normalizedItemId}' does not exist.`);
	}
	return Object.freeze({ ...parsed, items: Object.freeze(items) });
}

export function removeAIVideoSequenceItemsForNodeIdentity(
	document: AIVideoSequenceDocument,
	nodeId: string,
	videoNodePath: string
): AIVideoSequenceDocument {
	const parsed = parseAIVideoSequenceDocument(JSON.stringify(document));
	const normalizedNodeId = requiredText(nodeId, 'nodeId', 128);
	const normalizedVideoNodePath = portableProjectPath(videoNodePath, 'videoNodePath', '.bhnode');
	return Object.freeze({
		...parsed,
		items: Object.freeze(parsed.items.filter(item => item.nodeId !== normalizedNodeId || item.videoNodePath !== normalizedVideoNodePath))
	});
}

export function resolveAIVideoSequenceCurrentPin(node: AIVideoSequenceNodeState): { readonly nodeId: string; readonly versionId: string } {
	if (node.kind !== 'video') {
		throw new Error(`The selected node is a ${node.kind} node, not a Video node.`);
	}
	if (!node.currentVersionId) {
		throw new Error('The selected Video node does not have a Current result.');
	}
	const current = node.versions.find(version => version.id === node.currentVersionId);
	const problem = sequenceVersionProblem(current);
	if (problem) {
		throw new Error(`The selected Video node Current ${problem}`);
	}
	return Object.freeze({ nodeId: requiredText(node.id, 'node.id', 128), versionId: node.currentVersionId });
}

export function isFilePathInside(basePath: string, candidatePath: string): boolean {
	const descendant = relative(resolve(basePath), resolve(candidatePath));
	return descendant !== ''
		&& descendant !== '..'
		&& !descendant.startsWith(`..${sep}`)
		&& !isAbsolute(descendant);
}

export function isPlainLocalFileResource(scheme: string, query: string, fragment: string): boolean {
	return scheme === 'file' && query === '' && fragment === '';
}

export function isOrdinaryFilePathInside(basePath: string, candidatePath: string, isFile: boolean, isSymbolicLink: boolean): boolean {
	return isFile && !isSymbolicLink && isFilePathInside(basePath, candidatePath);
}

export function portableDescendantVideoNodePath(workflowRootPath: string, videoNodePath: string): string {
	if (!isFilePathInside(workflowRootPath, videoNodePath)) {
		throw new Error('The Video node must be inside the workflow root.');
	}
	const descendant = relative(resolve(workflowRootPath), resolve(videoNodePath)).split(sep).join('/');
	return portableProjectPath(descendant, 'videoNodePath', '.bhnode');
}

export function moveAIVideoSequenceItem(
	document: AIVideoSequenceDocument,
	itemId: string,
	direction: 'up' | 'down'
): AIVideoSequenceDocument {
	const parsed = parseAIVideoSequenceDocument(JSON.stringify(document));
	const index = parsed.items.findIndex(item => item.id === itemId);
	if (index < 0) {
		throw new Error(`Sequence item '${itemId}' does not exist.`);
	}
	const target = index + (direction === 'up' ? -1 : 1);
	if (target < 0 || target >= parsed.items.length) {
		return parsed;
	}
	const items = [...parsed.items];
	[items[index], items[target]] = [items[target], items[index]];
	return Object.freeze({ ...parsed, items: Object.freeze(items) });
}

export function updateAIVideoSequenceItemVersion(
	document: AIVideoSequenceDocument,
	itemId: string,
	versionId: string
): AIVideoSequenceDocument {
	const parsed = parseAIVideoSequenceDocument(JSON.stringify(document));
	const normalizedVersionId = requiredText(versionId, 'versionId', 128);
	let found = false;
	const items = parsed.items.map(item => {
		if (item.id !== itemId) {
			return item;
		}
		found = true;
		return Object.freeze({ ...item, versionId: normalizedVersionId });
	});
	if (!found) {
		throw new Error(`Sequence item '${itemId}' does not exist.`);
	}
	return Object.freeze({ ...parsed, items: Object.freeze(items) });
}

export function updateAIVideoSequenceItemPath(
	document: AIVideoSequenceDocument,
	itemId: string,
	videoNodePath: string
): AIVideoSequenceDocument {
	const parsed = parseAIVideoSequenceDocument(JSON.stringify(document));
	const normalizedItemId = requiredText(itemId, 'itemId', 128);
	const normalizedPath = portableProjectPath(videoNodePath, 'videoNodePath', '.bhnode');
	let found = false;
	const items = parsed.items.map(item => {
		if (item.id !== normalizedItemId) {
			return item;
		}
		found = true;
		return Object.freeze({ ...item, videoNodePath: normalizedPath });
	});
	if (!found) {
		throw new Error(`Sequence item '${normalizedItemId}' does not exist.`);
	}
	return Object.freeze({ ...parsed, items: Object.freeze(items) });
}

export async function inspectAIVideoSequence(
	document: AIVideoSequenceDocument,
	inspectNode: (videoNodePath: string, request: AIVideoSequenceNodeInspectRequest) => Promise<AIVideoSequenceNodeState | undefined>,
	locateMovedNode?: (item: AIVideoSequenceItem, request: AIVideoSequenceNodeInspectRequest) => Promise<AIVideoSequenceNodeRelocation | undefined>,
	throwIfCancelled?: () => void
): Promise<AIVideoSequenceInspection> {
	const parsed = parseAIVideoSequenceDocument(JSON.stringify(document));
	throwIfCancelled?.();
	const items = await inspectAIVideoSequenceItems(parsed.items, inspectNode, locateMovedNode, throwIfCancelled);
	throwIfCancelled?.();
	return Object.freeze({
		valid: items.every(item => item.state !== 'invalid'),
		updatesAvailable: items.filter(item => item.state === 'updateAvailable').length,
		items: Object.freeze(items)
	});
}

async function inspectAIVideoSequenceItems(
	items: readonly AIVideoSequenceItem[],
	inspectNode: (videoNodePath: string, request: AIVideoSequenceNodeInspectRequest) => Promise<AIVideoSequenceNodeState | undefined>,
	locateMovedNode: ((item: AIVideoSequenceItem, request: AIVideoSequenceNodeInspectRequest) => Promise<AIVideoSequenceNodeRelocation | undefined>) | undefined,
	throwIfCancelled: (() => void) | undefined
): Promise<readonly AIVideoSequenceItemInspection[]> {
	const inspected = new Array<AIVideoSequenceItemInspection>(items.length);
	let nextIndex = 0;
	const workers = Array.from({ length: Math.min(SEQUENCE_INSPECTION_CONCURRENCY, items.length) }, async () => {
		while (true) {
			throwIfCancelled?.();
			const index = nextIndex++;
			if (index >= items.length) {
				return;
			}
			inspected[index] = await inspectAIVideoSequenceItem(items[index], inspectNode, locateMovedNode);
			throwIfCancelled?.();
		}
	});
	await Promise.all(workers);
	return inspected;
}

async function inspectAIVideoSequenceItem(
	item: AIVideoSequenceItem,
	inspectNode: (videoNodePath: string, request: AIVideoSequenceNodeInspectRequest) => Promise<AIVideoSequenceNodeState | undefined>,
	locateMovedNode: ((item: AIVideoSequenceItem, request: AIVideoSequenceNodeInspectRequest) => Promise<AIVideoSequenceNodeRelocation | undefined>) | undefined
): Promise<AIVideoSequenceItemInspection> {
	const request = Object.freeze({ versionIds: Object.freeze([item.versionId]), includeCurrent: true });
	let node: AIVideoSequenceNodeState | undefined;
	try {
		node = await inspectNode(item.videoNodePath, request);
	} catch (error) {
		return sequenceInspection(item, 'invalid', error instanceof Error ? error.message : String(error));
	}
	if (!node) {
		if (!locateMovedNode) {
			return sequenceInspection(item, 'invalid', `Video node '${item.videoNodePath}' is missing.`);
		}
		let relocation: AIVideoSequenceNodeRelocation | undefined;
		try {
			relocation = await locateMovedNode(item, request);
		} catch (error) {
			return sequenceInspection(item, 'invalid', error instanceof Error ? error.message : String(error));
		}
		if (!relocation) {
			return sequenceInspection(item, 'invalid', `Video node '${item.videoNodePath}' is missing, and no node with its stable identity was found.`);
		}
		if (relocation.kind === 'scanLimit') {
			return sequenceInspection(item, 'invalid', `Video node '${item.videoNodePath}' is missing. Path repair was not suggested because the bounded scan exceeded ${relocation.maximum} result nodes.`);
		}
		if (relocation.kind === 'ambiguous') {
			return sequenceInspection(item, 'invalid', `Video node '${item.videoNodePath}' is missing, and ${relocation.matchCount} nodes use the same stable identity. Resolve the duplicate identities before repairing this path.`);
		}
		let candidatePath: string;
		try {
			candidatePath = portableProjectPath(relocation.videoNodePath, 'repairCandidatePath', '.bhnode');
		} catch (error) {
			return sequenceInspection(item, 'invalid', error instanceof Error ? error.message : String(error));
		}
		const candidate = inspectResolvedSequenceNode(item, relocation.node, candidatePath);
		if (candidate.state === 'invalid') {
			return candidate;
		}
		return sequenceInspection(
			item,
			'invalid',
			`Video node moved to '${candidatePath}'. Repair this Sequence item path to keep its exact verified version.`,
			undefined,
			candidatePath
		);
	}
	return inspectResolvedSequenceNode(item, node, item.videoNodePath);
}

function inspectResolvedSequenceNode(
	item: AIVideoSequenceItem,
	node: AIVideoSequenceNodeState,
	videoNodePath: string
): AIVideoSequenceItemInspection {
	if (node.kind !== 'video') {
		return sequenceInspection(item, 'invalid', `'${videoNodePath}' is a ${node.kind} node, not a Video node.`);
	}
	if (node.id !== item.nodeId) {
		return sequenceInspection(item, 'invalid', `Video node identity changed at '${videoNodePath}'.`);
	}
	const pinned = node.versions.find(version => version.id === item.versionId);
	const pinnedProblem = sequenceVersionProblem(pinned);
	if (pinnedProblem) {
		return sequenceInspection(item, 'invalid', `Pinned version '${item.versionId}' ${pinnedProblem}`);
	}
	const pinnedArtifact = playableSequenceArtifact(pinned);
	if (!pinnedArtifact) {
		return sequenceInspection(item, 'invalid', `Pinned version '${item.versionId}' does not have an available primary Video artifact.`);
	}
	if (node.currentVersionId === item.versionId) {
		return sequenceInspection(item, 'current', 'Pinned to the node Current.', item.versionId, undefined, pinnedArtifact);
	}
	const current = node.currentVersionId
		? node.versions.find(version => version.id === node.currentVersionId)
		: undefined;
	if (node.currentVersionId && !sequenceVersionProblem(current)) {
		return sequenceInspection(item, 'updateAvailable', 'A different selected Current is available.', node.currentVersionId, undefined, pinnedArtifact);
	}
	return sequenceInspection(item, 'pinned', 'Pinned version is available. The node has no different verified Current.', undefined, undefined, pinnedArtifact);
}

function playableSequenceArtifact(version: AIVideoSequenceNodeVersion | undefined): AIVideoSequencePlayableArtifact | undefined {
	const artifact = version?.primaryArtifact;
	if (!artifact || artifact.kind !== 'video' || artifact.integrity !== 'available') {
		return undefined;
	}
	return Object.freeze({
		kind: 'video',
		integrity: 'available',
		...(artifact.resource === undefined ? {} : { resource: artifact.resource })
	});
}

function sequenceVersionProblem(version: AIVideoSequenceNodeVersion | undefined): string | undefined {
	if (!version) {
		return 'does not exist on this node.';
	}
	if (version.status !== 'succeeded' && version.status !== 'imported') {
		return `has status '${version.status}' and cannot be played.`;
	}
	if (!version.primaryArtifact || version.primaryArtifact.kind !== 'video') {
		return 'does not have a primary Video artifact.';
	}
	if (version.primaryArtifact.integrity === 'missing') {
		return 'is missing its local artifact.';
	}
	if (version.primaryArtifact.integrity === 'changed') {
		return 'has an artifact that changed outside BaseHalf.';
	}
	return undefined;
}

function sequenceInspection(
	item: AIVideoSequenceItem,
	state: AIVideoSequenceItemState,
	message: string,
	availableCurrentVersionId?: string,
	repairCandidatePath?: string,
	pinnedArtifact?: AIVideoSequencePlayableArtifact
): AIVideoSequenceItemInspection {
	return Object.freeze({
		item,
		state,
		message,
		...(pinnedArtifact === undefined ? {} : { pinnedArtifact }),
		...(availableCurrentVersionId === undefined ? {} : { availableCurrentVersionId }),
		...(repairCandidatePath === undefined ? {} : { repairCandidatePath })
	});
}

function parseJsonRecord(source: string, label: string): Record<string, unknown> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(source.charCodeAt(0) === 0xFEFF ? source.slice(1) : source);
	} catch {
		throw new Error(`The video ${label} is not valid JSON.`);
	}
	return record(parsed, label);
}

function optionalText(parameters: Readonly<Record<string, RecipeValue>>, key: string, fallback: string, maximum: number, allowEmpty = false): string {
	const value = parameters[key];
	if (value === undefined) {
		return fallback;
	}
	if (typeof value !== 'string' || value.includes('\u0000') || value.length > maximum) {
		throw new Error(`Parameter '${key}' must be text no longer than ${maximum} characters.`);
	}
	const result = allowEmpty ? value : value.trim();
	if (!allowEmpty && !result) {
		throw new Error(`Parameter '${key}' cannot be empty.`);
	}
	return result;
}

function optionalInteger(parameters: Readonly<Record<string, RecipeValue>>, key: string, fallback: number, minimum: number, maximum: number): number {
	const value = parameters[key];
	if (value === undefined) {
		return fallback;
	}
	if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		throw new Error(`Parameter '${key}' must be an integer from ${minimum} to ${maximum}.`);
	}
	return value as number;
}

function optionalEnum<const T extends string>(parameters: Readonly<Record<string, RecipeValue>>, key: string, fallback: T, values: readonly T[]): T {
	const value = parameters[key];
	if (value === undefined) {
		return fallback;
	}
	if (typeof value !== 'string' || !values.includes(value as T)) {
		throw new Error(`Parameter '${key}' must be one of: ${values.join(', ')}.`);
	}
	return value as T;
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${path} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function assertOnlyKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[], path: string): void {
	const allowed = new Set(keys);
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) {
			throw new Error(`${path} contains unsupported field '${key}'.`);
		}
	}
}

function requiredText(value: unknown, path: string, maximum: number): string {
	if (typeof value !== 'string' || value.includes('\u0000') || value.length > maximum || !value.trim()) {
		throw new Error(`${path} must be non-empty text no longer than ${maximum} characters.`);
	}
	return value.trim();
}

function portableProjectPath(value: unknown, path: string, extension: string): string {
	if (
		typeof value !== 'string' ||
		!value ||
		value.length > 1_024 ||
		value !== value.trim() ||
		value !== value.normalize('NFC') ||
		value.startsWith('/') ||
		value.includes('\\') ||
		/[<>:"|?*\u0000-\u001F\u007F-\u009F]/.test(value) ||
		/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
	) {
		throw new Error(`${path} must be a safe relative path ending in '${extension}'.`);
	}
	const segments = value.split('/');
	if (
		segments.some(segment =>
			!segment ||
			segment === '.' ||
			segment === '..' ||
			segment.length > 255 ||
			segment.toLowerCase() === '.bh' ||
			/[. ]$/.test(segment) ||
			/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment)
		) ||
		!value.toLowerCase().endsWith(extension)
	) {
		throw new Error(`${path} must be a safe relative path ending in '${extension}'.`);
	}
	return value;
}
