/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type {
	VideoProviderInputSnapshot,
	VideoProviderModelSelection,
	VideoProviderScalar,
	VideoProviderSubmission
} from './videoProviderAdapters';

export const VIDEO_MODEL_SNAPSHOT_PARAMETER_ID = 'videoModelSnapshot';
// Hailuo documents a strict "less than 20 MB" limit; the shared executor uses
// that safest upper bound before any provider submission.
export const MAX_PROVIDER_IMAGE_BYTES = 20_000_000 - 1;

const VIDEO_INPUT_KINDS = [
	'text-prompt',
	'first-frame',
	'last-frame',
	'reference-image',
	'reference-video',
	'source-video',
	'audio'
] as const;

type VideoInputKind = typeof VIDEO_INPUT_KINDS[number];
type VideoGenerationMode =
	| 'text-to-video'
	| 'first-frame-to-video'
	| 'first-last-frame-to-video'
	| 'reference-to-video'
	| 'video-edit'
	| 'video-extension';

export interface VideoModelSelectionSnapshot {
	readonly schemaVersion: 1;
	readonly catalogId: string;
	readonly providerId: string;
	readonly deploymentId: string;
	readonly region: string;
	readonly modelId: string;
	readonly revision: string;
	readonly mode: VideoGenerationMode;
	readonly inputs: Readonly<Partial<Record<VideoInputKind, number>>>;
}

export interface VideoGenerationInput<Resource> {
	readonly slotId: string;
	readonly order: number;
	readonly source: {
		readonly kind: string;
		readonly resource?: Resource;
		readonly result?: { readonly resource: Resource };
	};
}

export interface VideoGenerationPreparationRequest<Resource> {
	readonly prompt: string;
	readonly parameters: Readonly<Record<string, unknown>>;
	readonly inputs: readonly VideoGenerationInput<Resource>[];
}

export interface VideoGenerationServiceIdentity {
	readonly providerId: string;
	readonly deploymentId: string;
	readonly region: string;
}

/** Converts the host-frozen selection and direct-input snapshots into adapter data. */
export async function prepareVideoProviderSubmission<Resource>(
	request: VideoGenerationPreparationRequest<Resource>,
	readImage: (resource: Resource) => Promise<Uint8Array>,
	expectedCatalogId: string
): Promise<{ readonly snapshot: VideoModelSelectionSnapshot; readonly submission: VideoProviderSubmission }> {
	const snapshot = parseVideoModelSelectionSnapshot(request.parameters[VIDEO_MODEL_SNAPSHOT_PARAMETER_ID], expectedCatalogId);
	const settings: Record<string, VideoProviderScalar> = {};
	for (const [key, value] of Object.entries(request.parameters)) {
		if (key === VIDEO_MODEL_SNAPSHOT_PARAMETER_ID) {
			continue;
		}
		if (typeof value !== 'string' && typeof value !== 'boolean'
			&& !(typeof value === 'number' && Number.isFinite(value))) {
			throw new Error(`Video setting '${key}' is not a provider-neutral scalar.`);
		}
		settings[key] = value;
	}
	if (settings.generationMode !== snapshot.mode) {
		throw new Error('The normalized generation mode does not match the frozen model selection.');
	}

	let firstFrame: string | undefined;
	let lastFrame: string | undefined;
	const references: { kind: 'image' | 'video'; resource: string }[] = [];
	const actualCounts: Record<VideoInputKind, number> = {
		// The host composer is one prompt input even before readiness validation.
		'text-prompt': 1,
		'first-frame': 0,
		'last-frame': 0,
		'reference-image': 0,
		'reference-video': 0,
		'source-video': 0,
		audio: 0
	};
	if (request.inputs.length > 16) {
		throw new Error('Video generation received more than 16 direct inputs.');
	}
	const ordered = [...request.inputs].sort((left, right) => left.order - right.order);
	const seenOrders = new Set<number>();
	for (const input of ordered) {
		if (!Number.isSafeInteger(input.order) || input.order < 0 || input.order > 63 || seenOrders.has(input.order)) {
			throw new Error('Video generation requires a unique input order from 0 to 63.');
		}
		seenOrders.add(input.order);
	}
	for (const input of ordered) {
		const resource = input.source.result?.resource ?? input.source.resource;
		if (resource === undefined) {
			throw new Error(`Video input '${input.slotId}' has no frozen local resource.`);
		}
		if (input.slotId === 'first-frame') {
			assertInputKind(input, 'image');
			if (firstFrame !== undefined) {
				throw new Error('Video generation received more than one first frame.');
			}
			firstFrame = providerImageBytesToDataUrl(await readImage(resource), snapshot);
			actualCounts['first-frame']++;
		} else if (input.slotId === 'last-frame') {
			assertInputKind(input, 'image');
			if (lastFrame !== undefined) {
				throw new Error('Video generation received more than one last frame.');
			}
			lastFrame = providerImageBytesToDataUrl(await readImage(resource), snapshot);
			actualCounts['last-frame']++;
		} else if (input.slotId === 'reference') {
			if (input.source.kind === 'image') {
				references.push({ kind: 'image', resource: providerImageBytesToDataUrl(await readImage(resource), snapshot) });
				actualCounts['reference-image']++;
			} else if (input.source.kind === 'video') {
				actualCounts['reference-video']++;
				throw new Error('Local reference-video upload is not available in this executor.');
			} else {
				throw new Error(`Reference input does not accept '${input.source.kind}'.`);
			}
		} else if (input.slotId === 'source-video') {
			actualCounts['source-video']++;
			throw new Error('Local source-video upload is not available in this executor.');
		} else if (input.slotId === 'audio') {
			actualCounts.audio++;
			throw new Error('Local audio upload is not available in this executor.');
		} else {
			throw new Error(`Video generation received unsupported input slot '${input.slotId}'.`);
		}
	}
	assertSnapshotInputCounts(snapshot.inputs, actualCounts);

	const selection: VideoProviderModelSelection = Object.freeze({
		provider: snapshot.providerId,
		deployment: snapshot.deploymentId,
		region: snapshot.region,
		modelId: snapshot.modelId,
		revision: snapshot.revision
	});
	const inputs: VideoProviderInputSnapshot = Object.freeze({
		prompt: request.prompt,
		...(firstFrame === undefined ? {} : { firstFrame }),
		...(lastFrame === undefined ? {} : { lastFrame }),
		...(references.length === 0 ? {} : { references: Object.freeze(references) })
	});
	return Object.freeze({
		snapshot,
		submission: Object.freeze({ selection, settings: Object.freeze(settings), inputs })
	});
}

export function assertVideoServiceMatchesSnapshot(
	service: VideoGenerationServiceIdentity,
	snapshot: VideoModelSelectionSnapshot
): void {
	if (service.providerId !== snapshot.providerId
		|| service.deploymentId !== snapshot.deploymentId
		|| service.region !== snapshot.region) {
		throw new Error('The current model connection does not match the frozen video model selection.');
	}
}

export function parseVideoModelSelectionSnapshot(value: unknown, expectedCatalogId: string): VideoModelSelectionSnapshot {
	const root = record(value, 'video model selection snapshot');
	assertOnlyKeys(root, ['schemaVersion', 'catalogId', 'providerId', 'deploymentId', 'region', 'modelId', 'revision', 'mode', 'inputs'], 'video model selection snapshot');
	if (root.schemaVersion !== 1 || !isGenerationMode(root.mode)) {
		throw new Error('The video model selection snapshot does not use the supported version 1 schema.');
	}
	const catalogId = contributionIdentifier(root.catalogId, 'catalogId');
	const expected = contributionIdentifier(expectedCatalogId, 'expected catalogId');
	if (catalogId !== expected) {
		throw new Error(`The video model selection snapshot does not belong to catalog '${expected}'.`);
	}
	const inputs = record(root.inputs, 'video model selection inputs');
	assertOnlyKeys(inputs, VIDEO_INPUT_KINDS, 'video model selection inputs');
	const parsedInputs: Partial<Record<VideoInputKind, number>> = {};
	for (const [kind, count] of Object.entries(inputs)) {
		if (!Number.isSafeInteger(count) || (count as number) < 0 || (count as number) > 32) {
			throw new Error(`Video model input '${kind}' has an invalid frozen count.`);
		}
		parsedInputs[kind as VideoInputKind] = count as number;
	}
	return Object.freeze({
		schemaVersion: 1,
		catalogId,
		providerId: identifier(root.providerId, 'providerId'),
		deploymentId: identifier(root.deploymentId, 'deploymentId'),
		region: identifier(root.region, 'region'),
		modelId: identifier(root.modelId, 'modelId'),
		revision: identifier(root.revision, 'revision'),
		mode: root.mode,
		inputs: Object.freeze(parsedInputs)
	});
}

export function imageBytesToDataUrl(bytes: Uint8Array): string {
	if (bytes.byteLength === 0 || bytes.byteLength > MAX_PROVIDER_IMAGE_BYTES) {
		throw new Error(`Provider image input must contain 1-${MAX_PROVIDER_IMAGE_BYTES} bytes.`);
	}
	const image = parseImageMetadata(bytes);
	return `data:${image.mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
}

function providerImageBytesToDataUrl(bytes: Uint8Array, snapshot: VideoModelSelectionSnapshot): string {
	if (bytes.byteLength === 0 || bytes.byteLength > MAX_PROVIDER_IMAGE_BYTES) {
		throw new Error(`Provider image input must contain 1-${MAX_PROVIDER_IMAGE_BYTES} bytes.`);
	}
	const image = parseImageMetadata(bytes);
	if (snapshot.providerId === 'minimax') {
		const shortEdge = Math.min(image.width, image.height);
		const ratio = image.width / image.height;
		if (shortEdge <= 300 || ratio < 2 / 5 || ratio > 5 / 2) {
			throw new Error('MiniMax Hailuo images require a short edge above 300px and an aspect ratio from 2:5 to 5:2.');
		}
	}
	if (snapshot.providerId === 'alibaba-cloud') {
		if (image.width < 240 || image.width > 8_000 || image.height < 240 || image.height > 8_000) {
			throw new Error('Wan 2.6 images require width and height from 240px to 8000px.');
		}
		if (image.hasAlpha === true) {
			throw new Error('Wan 2.6 does not accept image inputs with an alpha channel.');
		}
	}
	return `data:${image.mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
}

function parseImageMetadata(bytes: Uint8Array): {
	readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
	readonly width: number;
	readonly height: number;
	readonly hasAlpha?: boolean;
} {
	if (bytes.byteLength >= 26
		&& bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
		&& bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
		&& ascii(bytes, 12, 16) === 'IHDR') {
		return imageMetadata('image/png', unsignedBigEndian32(bytes, 16), unsignedBigEndian32(bytes, 20), bytes[25] === 4 || bytes[25] === 6);
	} else if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return parseJpegMetadata(bytes);
	} else if (bytes.byteLength >= 12
		&& bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
		&& bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
		return parseWebPMetadata(bytes);
	}
	throw new Error('Provider image input must have a valid PNG, JPEG, or WebP header.');
}

function parseJpegMetadata(bytes: Uint8Array): ReturnType<typeof imageMetadata> {
	let offset = 2;
	while (offset + 1 < bytes.byteLength) {
		while (offset < bytes.byteLength && bytes[offset] !== 0xff) {
			offset++;
		}
		while (offset < bytes.byteLength && bytes[offset] === 0xff) {
			offset++;
		}
		if (offset >= bytes.byteLength) {
			break;
		}
		const marker = bytes[offset++];
		if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
			continue;
		}
		if (offset + 1 >= bytes.byteLength) {
			break;
		}
		const length = (bytes[offset] << 8) | bytes[offset + 1];
		if (length < 2 || offset + length > bytes.byteLength) {
			break;
		}
		if (isJpegStartOfFrame(marker) && length >= 7) {
			const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
			const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
			return imageMetadata('image/jpeg', width, height, false);
		}
		offset += length;
	}
	throw new Error('Provider JPEG input has no valid dimensions.');
}

function parseWebPMetadata(bytes: Uint8Array): ReturnType<typeof imageMetadata> {
	const chunk = ascii(bytes, 12, 16);
	if (chunk === 'VP8X' && bytes.byteLength >= 30) {
		const width = 1 + unsignedLittleEndian24(bytes, 24);
		const height = 1 + unsignedLittleEndian24(bytes, 27);
		return imageMetadata('image/webp', width, height, (bytes[20] & 0x10) !== 0);
	}
	if (chunk === 'VP8 ' && bytes.byteLength >= 30
		&& bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
		const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
		const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
		return imageMetadata('image/webp', width, height, false);
	}
	if (chunk === 'VP8L' && bytes.byteLength >= 25 && bytes[20] === 0x2f) {
		const width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
		const height = 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10);
		return imageMetadata('image/webp', width, height);
	}
	throw new Error('Provider WebP input has no valid dimensions.');
}

function imageMetadata<T extends 'image/png' | 'image/jpeg' | 'image/webp'>(
	mimeType: T,
	width: number,
	height: number,
	hasAlpha?: boolean
): { readonly mimeType: T; readonly width: number; readonly height: number; readonly hasAlpha?: boolean } {
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
		throw new Error('Provider image input has invalid dimensions.');
	}
	return Object.freeze({ mimeType, width, height, ...(hasAlpha === undefined ? {} : { hasAlpha }) });
}

function isJpegStartOfFrame(marker: number): boolean {
	return (marker >= 0xc0 && marker <= 0xc3)
		|| (marker >= 0xc5 && marker <= 0xc7)
		|| (marker >= 0xc9 && marker <= 0xcb)
		|| (marker >= 0xcd && marker <= 0xcf);
}

function unsignedBigEndian32(bytes: Uint8Array, offset: number): number {
	return (bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function unsignedLittleEndian24(bytes: Uint8Array, offset: number): number {
	return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
	return String.fromCharCode(...bytes.subarray(start, end));
}

function assertSnapshotInputCounts(
	frozen: Readonly<Partial<Record<VideoInputKind, number>>>,
	actual: Readonly<Record<VideoInputKind, number>>
): void {
	for (const kind of VIDEO_INPUT_KINDS) {
		if ((frozen[kind] ?? 0) !== actual[kind]) {
			throw new Error(`Frozen video input count for '${kind}' no longer matches the Attempt snapshot.`);
		}
	}
}

function assertInputKind(input: VideoGenerationInput<unknown>, expected: string): void {
	if (input.source.kind !== expected) {
		throw new Error(`Video input '${input.slotId}' requires '${expected}', not '${input.source.kind}'.`);
	}
}

function isGenerationMode(value: unknown): value is VideoGenerationMode {
	return value === 'text-to-video'
		|| value === 'first-frame-to-video'
		|| value === 'first-last-frame-to-video'
		|| value === 'reference-to-video'
		|| value === 'video-edit'
		|| value === 'video-extension';
}

function identifier(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value)) {
		throw new Error(`Video model selection '${label}' is invalid.`);
	}
	return value;
}

function contributionIdentifier(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2,}$/.test(value)) {
		throw new Error(`Video model selection '${label}' is invalid.`);
	}
	return value;
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error(`The ${label} must be an object.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function assertOnlyKeys(value: Readonly<Record<string, unknown>>, allowed: readonly string[], label: string): void {
	const set = new Set(allowed);
	const unknown = Object.keys(value).find(key => !set.has(key));
	if (unknown) {
		throw new Error(`The ${label} contains unsupported field '${unknown}'.`);
	}
}
