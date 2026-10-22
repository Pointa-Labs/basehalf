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

/**
 * One clip of the playback order: a video file, relative to the folder of
 * the Sequence file, and for a video BaseHalf generated, the `id` of its
 * `made.yaml`, which is the clip's identity while the file is moved.
 */
export interface AIVideoSequenceItem {
	readonly id: string;
	readonly title: string;
	readonly videoPath: string;
	readonly generationId?: string;
}

export interface AIVideoSequenceDocument {
	readonly version: 1;
	readonly kind: 'pointa.basehalf-ai-video.sequence';
	readonly items: readonly AIVideoSequenceItem[];
}

/** What a generation card is, as the host's `inspectGenerationCard` answers it. */
export interface AIVideoGenerationCardState {
	readonly kind: 'image' | 'video';
	readonly hasFile: boolean;
	readonly generationId?: string;
}

/** What the workspace says of the file an item names. */
export interface AIVideoSequenceVideoState {
	/** The path names a regular video file inside the workspace folder. */
	readonly isVideoFile: boolean;
	/** The `id` of that file's `made.yaml`, when BaseHalf generated it and the record can be read. */
	readonly generationId?: string;
	/** Opaque host resource of the file, for the caller that plays it. */
	readonly resource?: unknown;
}

/** Where the video of an item with a `generationId` is now. */
export type AIVideoSequenceRelocation =
	| { readonly kind: 'unique'; readonly videoPath: string }
	| { readonly kind: 'ambiguous'; readonly matchCount: number }
	| { readonly kind: 'scanLimit'; readonly maximum: number };

/** `missing`: no video file is at the path. `changed`: the video there is not the one the item names. */
export type AIVideoSequenceItemState = 'available' | 'missing' | 'changed';

/** The video an inspection verified, for playback. */
export interface AIVideoSequencePlayableVideo {
	/** Opaque to the pure domain model; the extension projection validates it as a host URI. */
	readonly resource?: unknown;
}

export interface AIVideoSequenceItemInspection {
	readonly item: AIVideoSequenceItem;
	readonly state: AIVideoSequenceItemState;
	readonly message: string;
	/** The video verified by this inspection pass, when the item is available. */
	readonly video?: AIVideoSequencePlayableVideo;
	/** A unique verified moved path. Applying it always requires an explicit command. */
	readonly repairCandidatePath?: string;
}

export interface AIVideoSequenceInspection {
	readonly valid: boolean;
	readonly items: readonly AIVideoSequenceItemInspection[];
}

/** Whether a path names a file with a video extension, in any case. */
export function isAIVideoSequenceVideoPath(path: string): boolean {
	const lower = path.toLowerCase();
	return VIDEO_FILE_EXTENSIONS.some(extension => lower.endsWith(extension) && lower.length > extension.length && !lower.endsWith(`/${extension}`));
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

export function parseAIVideoSequenceDocument(source: string): AIVideoSequenceDocument {
	const root = parseJsonRecord(source, 'sequence');
	assertOnlyKeys(root, ['version', 'kind', 'items'], 'sequence');
	if (root.version !== 1 || root.kind !== 'pointa.basehalf-ai-video.sequence' || !Array.isArray(root.items) || root.items.length > MAX_SEQUENCE_ITEMS) {
		throw new Error('The video sequence does not use the supported version 1 format.');
	}

	const ids = new Set<string>();
	const items = root.items.map((value, index) => {
		const item = record(value, `sequence.items[${index}]`);
		assertOnlyKeys(item, ['id', 'title', 'videoPath', 'generationId'], `sequence.items[${index}]`);
		const id = requiredText(item.id, `sequence.items[${index}].id`, 128);
		if (ids.has(id)) {
			throw new Error(`The video sequence contains duplicate item id '${id}'.`);
		}
		ids.add(id);
		return Object.freeze({
			id,
			title: requiredText(item.title, `sequence.items[${index}].title`, 240),
			videoPath: portableVideoPath(item.videoPath, `sequence.items[${index}].videoPath`),
			...(item.generationId === undefined ? {} : { generationId: generationId(item.generationId, `sequence.items[${index}].generationId`) })
		});
	});
	return Object.freeze({ version: 1, kind: 'pointa.basehalf-ai-video.sequence', items: Object.freeze(items) });
}

export function serializeAIVideoSequenceDocument(document: AIVideoSequenceDocument): string {
	return `${JSON.stringify(parseAIVideoSequenceDocument(JSON.stringify(document)), null, 2)}\n`;
}

export function resolveAIVideoSequenceVideoPath(sequenceDocumentPath: string, videoPath: string): string {
	const relativePath = portableVideoPath(videoPath, 'sequence.videoPath');
	return resolve(dirname(sequenceDocumentPath), ...relativePath.split('/'));
}

/** Appends one clip. A video that the Sequence already names, by its path or its `generationId`, is not added twice. */
export function addAIVideoSequenceItem(
	document: AIVideoSequenceDocument,
	item: AIVideoSequenceItem
): AIVideoSequenceDocument {
	const parsed = parseAIVideoSequenceDocument(JSON.stringify(document));
	const duplicate = parsed.items.find(candidate => candidate.videoPath === item.videoPath
		|| (item.generationId !== undefined && candidate.generationId === item.generationId));
	if (duplicate) {
		throw new Error(`This video is already in the Sequence as '${duplicate.title}'.`);
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

/**
 * What a clip of the video at a path records (Add Video Result to Sequence):
 * the path must be a video file, a video card with its file, and its
 * `generationId` is the `id` of its `made.yaml` when it has one.
 */
export function resolveAIVideoSequenceVideo(videoPath: string, isVideoFile: boolean, card: AIVideoGenerationCardState | undefined): { readonly generationId?: string } {
	if (card && card.kind !== 'video') {
		throw new Error(`'${videoPath}' is an image card, not a video.`);
	}
	if (card && !card.hasFile) {
		throw new Error(`'${videoPath}' has no video yet. Generate it first.`);
	}
	if (!isVideoFile) {
		throw new Error(`'${videoPath}' is not a video file in this workspace.`);
	}
	return Object.freeze(card?.generationId === undefined ? {} : { generationId: generationId(card.generationId, 'generationId') });
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

/** The portable path of a video below the folder of the Sequence file. */
export function portableDescendantVideoPath(workflowRootPath: string, videoPath: string): string {
	if (!isFilePathInside(workflowRootPath, videoPath)) {
		throw new Error('The video must be inside the folder of the Sequence file.');
	}
	const descendant = relative(resolve(workflowRootPath), resolve(videoPath)).split(sep).join('/');
	return portableVideoPath(descendant, 'videoPath');
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

/** Repair Moved: the item's path, and nothing else of it, changes. */
export function updateAIVideoSequenceItemPath(
	document: AIVideoSequenceDocument,
	itemId: string,
	videoPath: string
): AIVideoSequenceDocument {
	const parsed = parseAIVideoSequenceDocument(JSON.stringify(document));
	const normalizedItemId = requiredText(itemId, 'itemId', 128);
	const normalizedPath = portableVideoPath(videoPath, 'videoPath');
	let found = false;
	const items = parsed.items.map(item => {
		if (item.id !== normalizedItemId) {
			return item;
		}
		found = true;
		return Object.freeze({ ...item, videoPath: normalizedPath });
	});
	if (!found) {
		throw new Error(`Sequence item '${normalizedItemId}' does not exist.`);
	}
	return Object.freeze({ ...parsed, items: Object.freeze(items) });
}

/**
 * Checks every clip without changing the Sequence. A clip is available when
 * its path is a video file and, when it has a `generationId`, that file's
 * `made.yaml` has it; otherwise it is missing or changed, and for a clip with
 * a `generationId` the moved video is looked for.
 */
export async function inspectAIVideoSequence(
	document: AIVideoSequenceDocument,
	inspectVideo: (videoPath: string) => Promise<AIVideoSequenceVideoState>,
	locateMovedVideo?: (item: AIVideoSequenceItem) => Promise<AIVideoSequenceRelocation | undefined>,
	throwIfCancelled?: () => void
): Promise<AIVideoSequenceInspection> {
	const parsed = parseAIVideoSequenceDocument(JSON.stringify(document));
	throwIfCancelled?.();
	const items = await inspectAIVideoSequenceItems(parsed.items, inspectVideo, locateMovedVideo, throwIfCancelled);
	throwIfCancelled?.();
	return Object.freeze({
		valid: items.every(item => item.state === 'available'),
		items: Object.freeze(items)
	});
}

async function inspectAIVideoSequenceItems(
	items: readonly AIVideoSequenceItem[],
	inspectVideo: (videoPath: string) => Promise<AIVideoSequenceVideoState>,
	locateMovedVideo: ((item: AIVideoSequenceItem) => Promise<AIVideoSequenceRelocation | undefined>) | undefined,
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
			inspected[index] = await inspectAIVideoSequenceItem(items[index], inspectVideo, locateMovedVideo);
			throwIfCancelled?.();
		}
	});
	await Promise.all(workers);
	return inspected;
}

async function inspectAIVideoSequenceItem(
	item: AIVideoSequenceItem,
	inspectVideo: (videoPath: string) => Promise<AIVideoSequenceVideoState>,
	locateMovedVideo: ((item: AIVideoSequenceItem) => Promise<AIVideoSequenceRelocation | undefined>) | undefined
): Promise<AIVideoSequenceItemInspection> {
	let video: AIVideoSequenceVideoState;
	try {
		video = await inspectVideo(item.videoPath);
	} catch (error) {
		return sequenceInspection(item, 'missing', errorMessage(error));
	}
	if (video.isVideoFile && (item.generationId === undefined || video.generationId === item.generationId)) {
		return sequenceInspection(item, 'available', 'The video is available.', undefined, Object.freeze(video.resource === undefined ? {} : { resource: video.resource }));
	}
	const state: AIVideoSequenceItemState = video.isVideoFile ? 'changed' : 'missing';
	const found = state === 'missing'
		? `'${item.videoPath}' is missing.`
		: `The video at '${item.videoPath}' is not the one this clip names.`;
	if (item.generationId === undefined || !locateMovedVideo) {
		return sequenceInspection(item, state, found);
	}
	let relocation: AIVideoSequenceRelocation | undefined;
	try {
		relocation = await locateMovedVideo(item);
	} catch (error) {
		return sequenceInspection(item, state, `${found} ${errorMessage(error)}`);
	}
	if (!relocation) {
		return sequenceInspection(item, state, `${found} No video of its generation was found below the folder of the Sequence.`);
	}
	if (relocation.kind === 'scanLimit') {
		return sequenceInspection(item, state, `${found} It was not looked for, because more than ${relocation.maximum} videos are below the folder of the Sequence.`);
	}
	if (relocation.kind === 'ambiguous') {
		return sequenceInspection(item, state, `${found} ${relocation.matchCount} videos below the folder of the Sequence come from its generation. Keep one, then repair this clip.`);
	}
	let candidatePath: string;
	try {
		candidatePath = portableVideoPath(relocation.videoPath, 'repairCandidatePath');
	} catch (error) {
		return sequenceInspection(item, state, errorMessage(error));
	}
	if (candidatePath === item.videoPath) {
		return sequenceInspection(item, state, found);
	}
	return sequenceInspection(item, state, `The video moved to '${candidatePath}'. Repair this clip's path to play it.`, candidatePath);
}

function sequenceInspection(
	item: AIVideoSequenceItem,
	state: AIVideoSequenceItemState,
	message: string,
	repairCandidatePath?: string,
	video?: AIVideoSequencePlayableVideo
): AIVideoSequenceItemInspection {
	return Object.freeze({
		item,
		state,
		message,
		...(video === undefined ? {} : { video }),
		...(repairCandidatePath === undefined ? {} : { repairCandidatePath })
	});
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
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

/** The `id` of a `made.yaml`: the task id of its generation, with `-<n>` for one image of several. */
function generationId(value: unknown, path: string): string {
	if (typeof value !== 'string' || value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
		throw new Error(`${path} must be the id of a generated video's record.`);
	}
	return value;
}

function portableVideoPath(value: unknown, path: string): string {
	const refuse = () => new Error(`${path} must be a safe relative path of a video file (${VIDEO_FILE_EXTENSIONS.join(', ')}).`);
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
		throw refuse();
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
		!isAIVideoSequenceVideoPath(value)
	) {
		throw refuse();
	}
	return value;
}
