/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assertVideoServiceMatchesSnapshot,
	imageBytesToDataUrl,
	parseVideoModelSelectionSnapshot,
	prepareVideoProviderSubmission
} from '../src/videoGeneration.ts';
import { OFFICIAL_VIDEO_MODEL_CATALOG_ID } from '../src/videoModelCatalog.ts';

const png = pngHeader(512, 512);

test('prepares frozen scalar settings and verified frame data without forwarding snapshot metadata', async () => {
	const parameters = {
		videoModelSnapshot: snapshot('first-frame-to-video', { 'text-prompt': 1, 'first-frame': 1 }),
		generationMode: 'first-frame-to-video',
		resolution: '720P',
		durationSeconds: 6
	};
	const prepared = await prepareVideoProviderSubmission({
		prompt: 'Move gently',
		parameters,
		inputs: [{ slotId: 'first-frame', order: 0, source: { kind: 'image', resource: 'frame' } }]
	}, async resource => {
		assert.equal(resource, 'frame');
		return png;
	}, OFFICIAL_VIDEO_MODEL_CATALOG_ID);
	assert.equal(prepared.submission.selection.modelId, 'reviewed-model');
	assert.equal(prepared.submission.inputs.firstFrame, `data:image/png;base64,${Buffer.from(png).toString('base64')}`);
	assert.equal('videoModelSnapshot' in prepared.submission.settings, false);
	assert.deepEqual(prepared.submission.settings, {
		generationMode: 'first-frame-to-video',
		resolution: '720P',
		durationSeconds: 6
	});

	const withSparseHostOrder = await prepareVideoProviderSubmission({
		prompt: 'Move gently',
		parameters,
		inputs: [{ slotId: 'first-frame', order: 7, source: { kind: 'image', resource: 'frame' } }]
	}, async () => png, OFFICIAL_VIDEO_MODEL_CATALOG_ID);
	assert.equal(withSparseHostOrder.submission.inputs.firstFrame, prepared.submission.inputs.firstFrame);
});

test('rejects mismatched frozen input counts, nested settings, and upload-only media paths', async () => {
	await assert.rejects(() => prepareVideoProviderSubmission({
		prompt: 'test',
		parameters: {
			videoModelSnapshot: snapshot('first-frame-to-video', { 'text-prompt': 1 }),
			generationMode: 'first-frame-to-video'
		},
		inputs: [{ slotId: 'first-frame', order: 0, source: { kind: 'image', resource: 'frame' } }]
	}, async () => png, OFFICIAL_VIDEO_MODEL_CATALOG_ID), /count for 'first-frame'/);

	await assert.rejects(() => prepareVideoProviderSubmission({
		prompt: 'test',
		parameters: {
			videoModelSnapshot: snapshot('text-to-video', { 'text-prompt': 1 }),
			generationMode: 'text-to-video',
			unknown: { nested: true }
		},
		inputs: []
	}, async () => png, OFFICIAL_VIDEO_MODEL_CATALOG_ID), /not a provider-neutral scalar/);

	await assert.rejects(() => prepareVideoProviderSubmission({
		prompt: 'test',
		parameters: {
			videoModelSnapshot: snapshot('reference-to-video', { 'text-prompt': 1, 'reference-video': 1 }),
			generationMode: 'reference-to-video'
		},
		inputs: [{ slotId: 'reference', order: 0, source: { kind: 'video', resource: 'clip' } }]
	}, async () => png, OFFICIAL_VIDEO_MODEL_CATALOG_ID), /reference-video upload is not available/);

	await assert.rejects(() => prepareVideoProviderSubmission({
		prompt: 'test',
		parameters: {
			videoModelSnapshot: snapshot('first-last-frame-to-video', { 'text-prompt': 1, 'first-frame': 1, 'last-frame': 1 }),
			generationMode: 'first-last-frame-to-video'
		},
		inputs: [
			{ slotId: 'first-frame', order: 4, source: { kind: 'image', resource: 'first' } },
			{ slotId: 'last-frame', order: 4, source: { kind: 'image', resource: 'last' } }
		]
	}, async () => png, OFFICIAL_VIDEO_MODEL_CATALOG_ID), /unique input order/);
});

test('parses exact selection identity and accepts only verified provider image formats', () => {
	const parsed = parseVideoModelSelectionSnapshot(snapshot('text-to-video', { 'text-prompt': 1 }), OFFICIAL_VIDEO_MODEL_CATALOG_ID);
	assert.doesNotThrow(() => assertVideoServiceMatchesSnapshot({
		providerId: parsed.providerId,
		deploymentId: parsed.deploymentId,
		region: parsed.region
	}, parsed));
	assert.throws(() => assertVideoServiceMatchesSnapshot({
		providerId: parsed.providerId,
		deploymentId: parsed.deploymentId,
		region: 'other'
	}, parsed), /does not match/);
	assert.match(imageBytesToDataUrl(png), /^data:image\/png;base64,/);
	assert.throws(() => imageBytesToDataUrl(new TextEncoder().encode('<svg/>')), /PNG, JPEG, or WebP/);
	assert.throws(() => parseVideoModelSelectionSnapshot({ ...snapshot('text-to-video', {}), endpoint: 'https://secret.example' }, OFFICIAL_VIDEO_MODEL_CATALOG_ID), /unsupported field 'endpoint'/);
	assert.throws(() => parseVideoModelSelectionSnapshot({
		...recordSnapshot(snapshot('text-to-video', {})),
		catalogId: 'thirdparty.video.catalog'
	}, OFFICIAL_VIDEO_MODEL_CATALOG_ID), /does not belong to catalog/);
});

test('checks provider-specific frame dimensions and Wan alpha restrictions before a paid submission', async () => {
	await assert.rejects(() => prepareVideoProviderSubmission({
		prompt: '',
		parameters: {
			videoModelSnapshot: snapshot('first-frame-to-video', { 'text-prompt': 1, 'first-frame': 1 }, 'minimax'),
			generationMode: 'first-frame-to-video'
		},
		inputs: [{ slotId: 'first-frame', order: 0, source: { kind: 'image', resource: 'small' } }]
	}, async () => pngHeader(300, 500), OFFICIAL_VIDEO_MODEL_CATALOG_ID), /short edge above 300px/);

	await assert.rejects(() => prepareVideoProviderSubmission({
		prompt: '',
		parameters: {
			videoModelSnapshot: snapshot('first-frame-to-video', { 'text-prompt': 1, 'first-frame': 1 }, 'alibaba-cloud'),
			generationMode: 'first-frame-to-video'
		},
		inputs: [{ slotId: 'first-frame', order: 0, source: { kind: 'image', resource: 'alpha' } }]
	}, async () => pngHeader(512, 512, 6), OFFICIAL_VIDEO_MODEL_CATALOG_ID), /alpha channel/);
});

function snapshot(mode: string, inputs: Readonly<Record<string, number>>, providerId = 'provider'): unknown {
	return {
		schemaVersion: 1,
		catalogId: OFFICIAL_VIDEO_MODEL_CATALOG_ID,
		providerId,
		deploymentId: 'deployment',
		region: 'global',
		modelId: 'reviewed-model',
		revision: '2026-08-16',
		mode,
		inputs
	};
}

function recordSnapshot(value: unknown): Record<string, unknown> {
	assert.equal(typeof value, 'object');
	assert.notEqual(value, null);
	assert.equal(Array.isArray(value), false);
	return value as Record<string, unknown>;
}

function pngHeader(width: number, height: number, colorType = 2): Uint8Array {
	const bytes = new Uint8Array(26);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
	bytes.set([0x49, 0x48, 0x44, 0x52], 12);
	bytes.set([(width >>> 24) & 0xff, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff], 16);
	bytes.set([(height >>> 24) & 0xff, (height >>> 16) & 0xff, (height >>> 8) & 0xff, height & 0xff], 20);
	bytes[24] = 8;
	bytes[25] = colorType;
	return bytes;
}
