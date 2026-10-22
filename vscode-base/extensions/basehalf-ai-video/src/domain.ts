/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export const EXTENSION_ID = 'pointa.basehalf-ai-video';
export const CREATE_WORKFLOW_COMMAND_ID = `${EXTENSION_ID}.createWorkflow`;
export const INSPECT_SEQUENCE_COMMAND_ID = `${EXTENSION_ID}.inspectSequence`;
export const ADD_SEQUENCE_ITEM_COMMAND_ID = `${EXTENSION_ID}.addSequenceItemFromVideoResult`;
export const MOVE_SEQUENCE_ITEM_COMMAND_ID = `${EXTENSION_ID}.moveSequenceItem`;
export const REMOVE_SEQUENCE_ITEM_COMMAND_ID = `${EXTENSION_ID}.removeSequenceItem`;
export const REPAIR_SEQUENCE_ITEM_PATH_COMMAND_ID = `${EXTENSION_ID}.repairSequenceItemPath`;
export const HOST_CREATE_FROM_TEMPLATE_COMMAND_ID = 'basehalf.canvas.createFromTemplate';
export const STARTER_TEMPLATE_ID = `${EXTENSION_ID}.starter-workflow`;
export const SEQUENCE_INSPECTION_CONCURRENCY = 8;
export const MAX_SEQUENCE_ITEMS = 10_000;

export type AIVideoContentKind = 'text' | 'code' | 'file' | 'folder' | 'image' | 'video' | 'audio' | 'pdf' | 'presentation';

/** The extensions of a video file, as BaseHalf's video cards have them (generation cards, "Terms"). */
export const VIDEO_FILE_EXTENSIONS: readonly string[] = Object.freeze(['.mp4', '.mov', '.m4v', '.webm']);

/**
 * A shot of the starter workflow (D63): a stable id, a title, and the path
 * of its clip, the shot's video card, relative to the folder of its
 * `shot.json`. The card is a draft until it generates.
 */
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
}

export interface AIVideoSequenceDocument {
	readonly version: 1;
	readonly kind: 'pointa.basehalf-ai-video.sequence';
	readonly items: readonly AIVideoSequenceItem[];
}

export type AIVideoSequenceArtifactIntegrity = 'available' | 'missing' | 'changed';

export interface AIVideoSequenceNodeArtifact {
	readonly kind: AIVideoContentKind;
	readonly integrity: AIVideoSequenceArtifactIntegrity;
	/** Opaque host resource retained for the caller that requested inspection. */
	readonly resource?: unknown;
}

export interface AIVideoSequenceNodeState {
	readonly id: string;
	readonly kind: AIVideoContentKind;
	readonly lifecycle: 'draft' | 'running' | 'result' | 'failed' | 'cancelled' | 'interrupted';
	readonly result?: {
		readonly artifact: AIVideoSequenceNodeArtifact;
	};
}

export type AIVideoSequenceNodeRelocation =
	| { readonly kind: 'unique'; readonly videoNodePath: string; readonly node: AIVideoSequenceNodeState }
	| { readonly kind: 'ambiguous'; readonly matchCount: number }
	| { readonly kind: 'scanLimit'; readonly maximum: number };

export type AIVideoSequenceItemState = 'result' | 'invalid';

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
	/** The sealed node artifact verified by this inspection pass. */
	readonly artifact?: AIVideoSequencePlayableArtifact;
	/** A unique verified replacement path. Applying it always requires an explicit command. */
	readonly repairCandidatePath?: string;
}

export interface AIVideoSequenceInspection {
	readonly valid: boolean;
	readonly items: readonly AIVideoSequenceItemInspection[];
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
		clipNodePath: portableVideoPath(root.clipNodePath, 'shot.clipNodePath')
	});
}

export function resolveAIVideoShotClipNodePath(shotDocumentPath: string, clipNodePath: string): string {
	const relativePath = portableVideoPath(clipNodePath, 'shot.clipNodePath');
	return resolve(dirname(shotDocumentPath), ...relativePath.split('/'));
}

/** Whether a path names a file with a video extension, in any case. */
export function isAIVideoSequenceVideoPath(path: string): boolean {
	const lower = path.toLowerCase();
	return VIDEO_FILE_EXTENSIONS.some(extension => lower.endsWith(extension) && lower.length > extension.length && !lower.endsWith(`/${extension}`));
}

function portableVideoPath(value: unknown, path: string): string {
	const extension = typeof value === 'string' ? VIDEO_FILE_EXTENSIONS.find(candidate => value.toLowerCase().endsWith(candidate)) : undefined;
	if (!extension || !isAIVideoSequenceVideoPath(value as string)) {
		throw new Error(`${path} must be a safe relative path of a video file (${VIDEO_FILE_EXTENSIONS.join(', ')}).`);
	}
	return portableProjectPath(value, path, extension);
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
		assertOnlyKeys(item, ['id', 'title', 'nodeId', 'videoNodePath'], `sequence.items[${index}]`);
		const id = requiredText(item.id, `sequence.items[${index}].id`, 128);
		if (ids.has(id)) {
			throw new Error(`The video sequence contains duplicate item id '${id}'.`);
		}
		ids.add(id);
		return Object.freeze({
			id,
			title: requiredText(item.title, `sequence.items[${index}].title`, 240),
			nodeId: requiredText(item.nodeId, `sequence.items[${index}].nodeId`, 128),
			videoNodePath: portableProjectPath(item.videoNodePath, `sequence.items[${index}].videoNodePath`, '.bhnode')
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
		throw new Error(`The Video Result is already in the Sequence as '${duplicate.title}'.`);
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

export function resolveAIVideoSequenceVideoResult(node: AIVideoSequenceNodeState): { readonly nodeId: string; readonly artifact: AIVideoSequencePlayableArtifact } {
	if (node.kind !== 'video') {
		throw new Error(`The selected node is a ${node.kind} node, not a Video node.`);
	}
	if (node.lifecycle !== 'result') {
		throw new Error(`The selected Video node has lifecycle '${node.lifecycle}', not 'result'.`);
	}
	const artifact = playableSequenceArtifact(node.result?.artifact);
	if (!artifact) {
		throw new Error('The selected Video Result does not have its one available Video artifact.');
	}
	return Object.freeze({ nodeId: requiredText(node.id, 'node.id', 128), artifact });
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
	inspectNode: (videoNodePath: string) => Promise<AIVideoSequenceNodeState | undefined>,
	locateMovedNode?: (item: AIVideoSequenceItem) => Promise<AIVideoSequenceNodeRelocation | undefined>,
	throwIfCancelled?: () => void
): Promise<AIVideoSequenceInspection> {
	const parsed = parseAIVideoSequenceDocument(JSON.stringify(document));
	throwIfCancelled?.();
	const items = await inspectAIVideoSequenceItems(parsed.items, inspectNode, locateMovedNode, throwIfCancelled);
	throwIfCancelled?.();
	return Object.freeze({
		valid: items.every(item => item.state !== 'invalid'),
		items: Object.freeze(items)
	});
}

async function inspectAIVideoSequenceItems(
	items: readonly AIVideoSequenceItem[],
	inspectNode: (videoNodePath: string) => Promise<AIVideoSequenceNodeState | undefined>,
	locateMovedNode: ((item: AIVideoSequenceItem) => Promise<AIVideoSequenceNodeRelocation | undefined>) | undefined,
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
	inspectNode: (videoNodePath: string) => Promise<AIVideoSequenceNodeState | undefined>,
	locateMovedNode: ((item: AIVideoSequenceItem) => Promise<AIVideoSequenceNodeRelocation | undefined>) | undefined
): Promise<AIVideoSequenceItemInspection> {
	let node: AIVideoSequenceNodeState | undefined;
	try {
		node = await inspectNode(item.videoNodePath);
	} catch (error) {
		return sequenceInspection(item, 'invalid', error instanceof Error ? error.message : String(error));
	}
	if (!node) {
		if (!locateMovedNode) {
			return sequenceInspection(item, 'invalid', `Video node '${item.videoNodePath}' is missing.`);
		}
		let relocation: AIVideoSequenceNodeRelocation | undefined;
		try {
			relocation = await locateMovedNode(item);
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
			`Video Result moved to '${candidatePath}'. Repair this Sequence item path to restore playback.`,
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
	if (node.lifecycle !== 'result') {
		return sequenceInspection(item, 'invalid', `Video node '${videoNodePath}' has lifecycle '${node.lifecycle}', not 'result'.`);
	}
	const artifact = playableSequenceArtifact(node.result?.artifact);
	if (!artifact) {
		return sequenceInspection(item, 'invalid', `Video Result '${videoNodePath}' does not have its one available Video artifact.`);
	}
	return sequenceInspection(item, 'result', 'Sealed Video Result is available.', undefined, artifact);
}

function playableSequenceArtifact(artifact: AIVideoSequenceNodeArtifact | undefined): AIVideoSequencePlayableArtifact | undefined {
	if (!artifact || artifact.kind !== 'video' || artifact.integrity !== 'available') {
		return undefined;
	}
	return Object.freeze({
		kind: 'video',
		integrity: 'available',
		...(artifact.resource === undefined ? {} : { resource: artifact.resource })
	});
}

function sequenceInspection(
	item: AIVideoSequenceItem,
	state: AIVideoSequenceItemState,
	message: string,
	repairCandidatePath?: string,
	artifact?: AIVideoSequencePlayableArtifact
): AIVideoSequenceItemInspection {
	return Object.freeze({
		item,
		state,
		message,
		...(artifact === undefined ? {} : { artifact }),
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
