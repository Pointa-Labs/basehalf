/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { dirname, extUri, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';

/**
 * The Sequence document of a video workflow and what it checks (Video
 * Sequence). Its ids keep the prefix they had when the AI Video extension
 * held them (D75): agents, the skill, saved Card Detail states, and the
 * `kind` of files written before name them.
 */
export const BASEHALF_SEQUENCE_NAMESPACE = 'pointa.basehalf-ai-video';
export const BASEHALF_SEQUENCE_CREATE_WORKFLOW_COMMAND_ID = `${BASEHALF_SEQUENCE_NAMESPACE}.createWorkflow`;
export const BASEHALF_SEQUENCE_INSPECT_COMMAND_ID = `${BASEHALF_SEQUENCE_NAMESPACE}.inspectSequence`;
export const BASEHALF_SEQUENCE_ADD_COMMAND_ID = `${BASEHALF_SEQUENCE_NAMESPACE}.addSequenceItemFromVideoResult`;
export const BASEHALF_SEQUENCE_MOVE_COMMAND_ID = `${BASEHALF_SEQUENCE_NAMESPACE}.moveSequenceItem`;
export const BASEHALF_SEQUENCE_REMOVE_COMMAND_ID = `${BASEHALF_SEQUENCE_NAMESPACE}.removeSequenceItem`;
export const BASEHALF_SEQUENCE_REPAIR_COMMAND_ID = `${BASEHALF_SEQUENCE_NAMESPACE}.repairSequenceItemPath`;
export const BASEHALF_SEQUENCE_PROJECTION_ID = `${BASEHALF_SEQUENCE_NAMESPACE}.sequence`;
export const BASEHALF_SEQUENCE_CAPABILITY_ID = `${BASEHALF_SEQUENCE_NAMESPACE}.sequence-capability`;
export const BASEHALF_STARTER_WORKFLOW_TEMPLATE_ID = `${BASEHALF_SEQUENCE_NAMESPACE}.starter-workflow`;
export const BASEHALF_SEQUENCE_FILE_NAME = 'video-sequence.json';
export const BASEHALF_SEQUENCE_KIND = `${BASEHALF_SEQUENCE_NAMESPACE}.sequence`;
export const BASEHALF_SHOT_KIND = `${BASEHALF_SEQUENCE_NAMESPACE}.shot`;
export const BASEHALF_SEQUENCE_INSPECTION_CONCURRENCY = 8;
export const BASEHALF_SEQUENCE_MAX_ITEMS = 10_000;

/** The extensions of a video file, as BaseHalf's video cards have them (generation cards, "Terms"). */
export const BASEHALF_SEQUENCE_VIDEO_EXTENSIONS: readonly string[] = Object.freeze(['.mp4', '.mov', '.m4v', '.webm']);

/**
 * A shot of the starter workflow (D63): a stable id, a title, and the path
 * of its clip, the shot's video card, relative to the folder of its
 * `shot.json`. The card is a draft until it generates.
 */
export interface IBaseHalfShotDocument {
	readonly version: 1;
	readonly kind: typeof BASEHALF_SHOT_KIND;
	readonly id: string;
	readonly title: string;
	readonly clipNodePath: string;
}

/**
 * One clip of the playback order: a video file, relative to the folder of
 * the Sequence file, and for a video BaseHalf generated, the `id` of its
 * `made.yaml`, which is the clip's identity while the file is moved.
 */
export interface IBaseHalfSequenceItem {
	readonly id: string;
	readonly title: string;
	readonly videoPath: string;
	readonly generationId?: string;
}

export interface IBaseHalfSequenceDocument {
	readonly version: 1;
	readonly kind: typeof BASEHALF_SEQUENCE_KIND;
	readonly items: readonly IBaseHalfSequenceItem[];
}

/** What a generation card is: its kind, whether it has its file, and the `id` of its `made.yaml`. */
export interface IBaseHalfSequenceCardState {
	readonly kind: 'image' | 'video' | 'audio';
	readonly hasFile: boolean;
	readonly generationId?: string;
}

/** What the workspace says of the file an item names. */
export interface IBaseHalfSequenceVideoState {
	/** The path names a regular video file inside the workspace folder. */
	readonly isVideoFile: boolean;
	/** The `id` of that file's `made.yaml`, when BaseHalf generated it and the record can be read. */
	readonly generationId?: string;
	/** The file, for the view that plays it. */
	readonly resource?: URI;
}

/** Where the video of an item with a `generationId` is now. */
export type BaseHalfSequenceRelocation =
	| { readonly kind: 'unique'; readonly videoPath: string }
	| { readonly kind: 'ambiguous'; readonly matchCount: number }
	| { readonly kind: 'scanLimit'; readonly maximum: number };

/** `missing`: no video file is at the path. `changed`: the video there is not the one the item names. */
export type BaseHalfSequenceItemState = 'available' | 'missing' | 'changed';

export interface IBaseHalfSequenceItemInspection {
	readonly item: IBaseHalfSequenceItem;
	readonly state: BaseHalfSequenceItemState;
	readonly message: string;
	/** The video this inspection verified, when the item is available. */
	readonly video?: { readonly resource?: URI };
	/** A unique verified moved path. Applying it always takes an explicit command. */
	readonly repairCandidatePath?: string;
}

export interface IBaseHalfSequenceInspection {
	readonly valid: boolean;
	readonly items: readonly IBaseHalfSequenceItemInspection[];
}

/** Whether a path names a file with a video extension, in any case. */
export function isBaseHalfSequenceVideoPath(path: string): boolean {
	const lower = path.toLowerCase();
	return BASEHALF_SEQUENCE_VIDEO_EXTENSIONS.some(extension => lower.endsWith(extension) && lower.length > extension.length && !lower.endsWith(`/${extension}`));
}

export function parseBaseHalfShotDocument(source: string): IBaseHalfShotDocument {
	const root = parseJsonRecord(source, 'shot');
	assertOnlyKeys(root, ['version', 'kind', 'id', 'title', 'clipNodePath'], 'shot');
	if (root.version !== 1 || root.kind !== BASEHALF_SHOT_KIND) {
		throw new Error('The video shot does not use the supported version 1 format.');
	}
	return Object.freeze({
		version: 1,
		kind: BASEHALF_SHOT_KIND,
		id: requiredText(root.id, 'shot.id', 128),
		title: requiredText(root.title, 'shot.title', 240),
		clipNodePath: portableVideoPath(root.clipNodePath, 'shot.clipNodePath')
	});
}

export function parseBaseHalfSequenceDocument(source: string): IBaseHalfSequenceDocument {
	const root = parseJsonRecord(source, 'sequence');
	assertOnlyKeys(root, ['version', 'kind', 'items'], 'sequence');
	if (root.version !== 1 || root.kind !== BASEHALF_SEQUENCE_KIND || !Array.isArray(root.items) || root.items.length > BASEHALF_SEQUENCE_MAX_ITEMS) {
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
	return Object.freeze({ version: 1, kind: BASEHALF_SEQUENCE_KIND, items: Object.freeze(items) });
}

export function serializeBaseHalfSequenceDocument(document: IBaseHalfSequenceDocument): string {
	return `${JSON.stringify(parseBaseHalfSequenceDocument(JSON.stringify(document)), null, 2)}\n`;
}

/** The file a path of a Sequence names: relative to the folder of the Sequence file. */
export function resolveBaseHalfSequenceVideo(sequence: URI, videoPath: string): URI {
	return joinPath(dirname(sequence), ...portableVideoPath(videoPath, 'sequence.videoPath').split('/'));
}

/** The file a shot's `clipNodePath` names: relative to the folder of its `shot.json`. */
export function resolveBaseHalfShotClip(shot: URI, clipNodePath: string): URI {
	return joinPath(dirname(shot), ...portableVideoPath(clipNodePath, 'shot.clipNodePath').split('/'));
}

/** Appends one clip. A video that the Sequence already names, by its path or its `generationId`, is not added twice. */
export function addBaseHalfSequenceItem(document: IBaseHalfSequenceDocument, item: IBaseHalfSequenceItem): IBaseHalfSequenceDocument {
	const parsed = parseBaseHalfSequenceDocument(JSON.stringify(document));
	const duplicate = parsed.items.find(candidate => candidate.videoPath === item.videoPath
		|| (item.generationId !== undefined && candidate.generationId === item.generationId));
	if (duplicate) {
		throw new Error(`This video is already in the Sequence as '${duplicate.title}'.`);
	}
	return parseBaseHalfSequenceDocument(JSON.stringify({
		...parsed,
		items: [...parsed.items, item]
	}));
}

export function removeBaseHalfSequenceItem(document: IBaseHalfSequenceDocument, itemId: string): IBaseHalfSequenceDocument {
	const parsed = parseBaseHalfSequenceDocument(JSON.stringify(document));
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
export function resolveBaseHalfSequenceVideoCard(videoPath: string, isVideoFile: boolean, card: IBaseHalfSequenceCardState | undefined): { readonly generationId?: string } {
	if (card && card.kind !== 'video') {
		throw new Error(card.kind === 'audio' ? `'${videoPath}' is an audio card, not a video.` : `'${videoPath}' is an image card, not a video.`);
	}
	if (card && !card.hasFile) {
		throw new Error(`'${videoPath}' has no video yet. Generate it first.`);
	}
	if (!isVideoFile) {
		throw new Error(`'${videoPath}' is not a video file in this workspace.`);
	}
	return Object.freeze(card?.generationId === undefined ? {} : { generationId: generationId(card.generationId, 'generationId') });
}

/** Whether a resource is below a folder, and not the folder itself. */
export function isBaseHalfResourceInside(folder: URI, candidate: URI): boolean {
	return extUri.isEqualOrParent(candidate, folder) && !extUri.isEqual(candidate, folder);
}

/** A file of the local disk, with nothing that a URI adds to its path. */
export function isBaseHalfPlainLocalFile(resource: URI): boolean {
	return resource.scheme === 'file' && resource.query === '' && resource.fragment === '';
}

/** The portable path of a video below the folder of the Sequence file. */
export function baseHalfSequenceVideoPathOf(workflowRoot: URI, video: URI): string {
	const descendant = isBaseHalfResourceInside(workflowRoot, video) ? extUri.relativePath(workflowRoot, video) : undefined;
	if (!descendant) {
		throw new Error('The video must be inside the folder of the Sequence file.');
	}
	return portableVideoPath(descendant, 'videoPath');
}

export function moveBaseHalfSequenceItem(document: IBaseHalfSequenceDocument, itemId: string, direction: 'up' | 'down'): IBaseHalfSequenceDocument {
	const parsed = parseBaseHalfSequenceDocument(JSON.stringify(document));
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
export function updateBaseHalfSequenceItemPath(document: IBaseHalfSequenceDocument, itemId: string, videoPath: string): IBaseHalfSequenceDocument {
	const parsed = parseBaseHalfSequenceDocument(JSON.stringify(document));
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
export async function inspectBaseHalfSequence(
	document: IBaseHalfSequenceDocument,
	inspectVideo: (videoPath: string) => Promise<IBaseHalfSequenceVideoState>,
	locateMovedVideo?: (item: IBaseHalfSequenceItem) => Promise<BaseHalfSequenceRelocation | undefined>,
	throwIfCancelled?: () => void
): Promise<IBaseHalfSequenceInspection> {
	const parsed = parseBaseHalfSequenceDocument(JSON.stringify(document));
	throwIfCancelled?.();
	const items = await inspectItems(parsed.items, inspectVideo, locateMovedVideo, throwIfCancelled);
	throwIfCancelled?.();
	return Object.freeze({
		valid: items.every(item => item.state === 'available'),
		items: Object.freeze(items)
	});
}

async function inspectItems(
	items: readonly IBaseHalfSequenceItem[],
	inspectVideo: (videoPath: string) => Promise<IBaseHalfSequenceVideoState>,
	locateMovedVideo: ((item: IBaseHalfSequenceItem) => Promise<BaseHalfSequenceRelocation | undefined>) | undefined,
	throwIfCancelled: (() => void) | undefined
): Promise<readonly IBaseHalfSequenceItemInspection[]> {
	const inspected = new Array<IBaseHalfSequenceItemInspection>(items.length);
	let nextIndex = 0;
	const workers = Array.from({ length: Math.min(BASEHALF_SEQUENCE_INSPECTION_CONCURRENCY, items.length) }, async () => {
		while (true) {
			throwIfCancelled?.();
			const index = nextIndex++;
			if (index >= items.length) {
				return;
			}
			inspected[index] = await inspectItem(items[index], inspectVideo, locateMovedVideo);
			throwIfCancelled?.();
		}
	});
	await Promise.all(workers);
	return inspected;
}

async function inspectItem(
	item: IBaseHalfSequenceItem,
	inspectVideo: (videoPath: string) => Promise<IBaseHalfSequenceVideoState>,
	locateMovedVideo: ((item: IBaseHalfSequenceItem) => Promise<BaseHalfSequenceRelocation | undefined>) | undefined
): Promise<IBaseHalfSequenceItemInspection> {
	let video: IBaseHalfSequenceVideoState;
	try {
		video = await inspectVideo(item.videoPath);
	} catch (error) {
		return itemInspection(item, 'missing', errorMessage(error));
	}
	if (video.isVideoFile && (item.generationId === undefined || video.generationId === item.generationId)) {
		return itemInspection(item, 'available', 'The video is available.', undefined, Object.freeze(video.resource === undefined ? {} : { resource: video.resource }));
	}
	const state: BaseHalfSequenceItemState = video.isVideoFile ? 'changed' : 'missing';
	const found = state === 'missing'
		? `'${item.videoPath}' is missing.`
		: `The video at '${item.videoPath}' is not the one this clip names.`;
	if (item.generationId === undefined || !locateMovedVideo) {
		return itemInspection(item, state, found);
	}
	let relocation: BaseHalfSequenceRelocation | undefined;
	try {
		relocation = await locateMovedVideo(item);
	} catch (error) {
		return itemInspection(item, state, `${found} ${errorMessage(error)}`);
	}
	if (!relocation) {
		return itemInspection(item, state, `${found} No video of its generation was found below the folder of the Sequence.`);
	}
	if (relocation.kind === 'scanLimit') {
		return itemInspection(item, state, `${found} It was not looked for, because more than ${relocation.maximum} videos are below the folder of the Sequence.`);
	}
	if (relocation.kind === 'ambiguous') {
		return itemInspection(item, state, `${found} ${relocation.matchCount} videos below the folder of the Sequence come from its generation. Keep one, then repair this clip.`);
	}
	let candidatePath: string;
	try {
		candidatePath = portableVideoPath(relocation.videoPath, 'repairCandidatePath');
	} catch (error) {
		return itemInspection(item, state, errorMessage(error));
	}
	if (candidatePath === item.videoPath) {
		return itemInspection(item, state, found);
	}
	return itemInspection(item, state, `The video moved to '${candidatePath}'. Repair this clip's path to play it.`, candidatePath);
}

function itemInspection(
	item: IBaseHalfSequenceItem,
	state: BaseHalfSequenceItemState,
	message: string,
	repairCandidatePath?: string,
	video?: { readonly resource?: URI }
): IBaseHalfSequenceItemInspection {
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
	const refuse = () => new Error(`${path} must be a safe relative path of a video file (${BASEHALF_SEQUENCE_VIDEO_EXTENSIONS.join(', ')}).`);
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
		!isBaseHalfSequenceVideoPath(value)
	) {
		throw refuse();
	}
	return value;
}
