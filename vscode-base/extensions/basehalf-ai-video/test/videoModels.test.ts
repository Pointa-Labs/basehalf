/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
	BUNDLED_VIDEO_MODEL_CATALOG_PATH,
	loadBundledVideoModelCatalog,
	parseBundledVideoModelCatalog
} from '../src/videoModelCatalog.ts';
import {
	serializeVideoProviderRequest,
	type VideoProviderModelSelection,
	type VideoProviderSubmission
} from '../src/videoProviderAdapters.ts';

const extensionRootUrl = new URL('../', import.meta.url);
const catalogSource = readFileSync(new URL('../models/video-models.json', import.meta.url), 'utf8');
const catalog = parseBundledVideoModelCatalog(catalogSource);

const seedance20: VideoProviderModelSelection = {
	provider: 'byteplus',
	deployment: 'modelark',
	region: 'global',
	modelId: 'dreamina-seedance-2-0-mini-260615',
	revision: '2026-06-15'
};

const seedance15: VideoProviderModelSelection = {
	provider: 'byteplus',
	deployment: 'modelark',
	region: 'global',
	modelId: 'seedance-1-5-pro-251215',
	revision: '2025-12-15'
};

const hailuo02: VideoProviderModelSelection = {
	provider: 'minimax',
	deployment: 'international',
	region: 'global',
	modelId: 'MiniMax-Hailuo-02',
	revision: '2026-08-16'
};

test('loads one frozen reviewed catalog resource with explicit provenance and deployment keys', async () => {
	assert.equal(BUNDLED_VIDEO_MODEL_CATALOG_PATH, 'models/video-models.json');
	const loaded = await loadBundledVideoModelCatalog(fileURLToPath(extensionRootUrl));
	assert.deepEqual(loaded, catalog);
	assert.equal(Object.isFrozen(loaded), true);
	const root = record(loaded);
	const models = array(root.models).map(record);
	assert.equal(models.length, 8);
	assert.equal(models.every(model => {
		const source = record(model.source);
		return typeof source.url === 'string' && source.url.startsWith('https://') && source.verifiedAt === '2026-08-16';
	}), true);
	assert.deepEqual(
		models.filter(model => record(model.key).provider === 'alibaba-cloud').map(model => record(model.key).region),
		['ap-southeast-1', 'ap-southeast-1', 'ap-southeast-1', 'us-east-1', 'us-east-1']
	);
	assert.deepEqual(
		models.filter(model => record(model.key).provider === 'alibaba-cloud').map(model => record(model.key).deployment),
		['international', 'international', 'international', 'us', 'us']
	);
	assert.equal(models.filter(model => record(model.key).provider === 'alibaba-cloud').every(model =>
		array(model.modes).every(mode => !array(record(mode).inputs).some(input => record(input).kind === 'audio'))), true);
	assert.equal(models.filter(model => record(model.key).provider === 'byteplus').every(model =>
		array(model.modes).every(mode => !array(record(mode).parameters).some(parameter => record(parameter).id === 'draft'))), true);
});

test('rejects empty, malformed, and unsupported catalog envelopes before registration', () => {
	assert.throws(() => parseBundledVideoModelCatalog(''), /empty/);
	assert.throws(() => parseBundledVideoModelCatalog('{'), /not valid JSON/);
	assert.throws(() => parseBundledVideoModelCatalog('{"schemaVersion":2,"models":[]}'), /version 1/);
});

test('serializes Seedance content roles and never submits settings outside the reviewed capability', () => {
	const firstLast = serializeVideoProviderRequest(catalog, submission(seedance20, {
		generationMode: 'first-last-frame-to-video',
		aspectRatio: 'adaptive',
		resolution: '720p',
		durationSeconds: 8,
		generateAudio: true
	}, {
		prompt: 'A deliberate camera move',
		firstFrame: 'https://assets.example/first.png',
		lastFrame: 'https://assets.example/last.png'
	}));
	assert.equal(firstLast.endpointPath, '/api/v3/contents/generations/tasks');
	assert.deepEqual(firstLast.body, {
		model: 'dreamina-seedance-2-0-mini-260615',
		content: [
			{ type: 'text', text: 'A deliberate camera move' },
			{ type: 'image_url', image_url: { url: 'https://assets.example/first.png' }, role: 'first_frame' },
			{ type: 'image_url', image_url: { url: 'https://assets.example/last.png' }, role: 'last_frame' }
		],
		ratio: 'adaptive',
		resolution: '720p',
		duration: 8,
		generate_audio: true
	});
	assert.equal('generationMode' in firstLast.body, false);
	assert.throws(() => serializeVideoProviderRequest(catalog, submission(seedance20, {
		generationMode: 'text-to-video',
		aspectRatio: '16:9',
		resolution: '1080p',
		durationSeconds: 5,
		generateAudio: true
	}, { prompt: 'Unsupported resolution' })), /unsupported value '1080p'/);
	assert.throws(() => serializeVideoProviderRequest(catalog, submission(seedance20, {
		generationMode: 'text-to-video',
		aspectRatio: '16:9',
		resolution: '720p',
		durationSeconds: 5,
		generateAudio: true,
		seed: 123
	}, { prompt: 'Unsupported field' })), /unsupported setting 'seed'/);
});

test('does not expose Seedance Draft as a one-step parameter and disables modes without reviewed upload transport', () => {
	assert.throws(() => serializeVideoProviderRequest(catalog, submission(seedance15, {
		generationMode: 'text-to-video',
		aspectRatio: '16:9',
		resolution: '720p',
		durationSeconds: 5,
		generateAudio: true,
		draft: true,
		cameraFixed: false
	}, { prompt: 'Draft is a separate provider task flow' })), /unsupported setting 'draft'/);
	const finalRequest = serializeVideoProviderRequest(catalog, submission(seedance15, {
		generationMode: 'text-to-video',
		aspectRatio: '16:9',
		resolution: '720p',
		durationSeconds: 5,
		generateAudio: true,
		cameraFixed: false
	}, { prompt: 'Final generation only' }));
	assert.equal('draft' in finalRequest.body, false);
	assert.equal('draft_task' in finalRequest.body, false);
	assert.throws(() => serializeVideoProviderRequest(catalog, submission(seedance20, {
		generationMode: 'reference-to-video',
		aspectRatio: 'adaptive',
		resolution: '720p',
		durationSeconds: 5,
		generateAudio: true
	}, {
		prompt: '',
		references: [{ kind: 'image', resource: 'https://assets.example/reference.png' }],
		audio: [
			'https://assets.example/one.mp3',
			'https://assets.example/two.mp3',
			'https://assets.example/three.mp3',
			'https://assets.example/four.mp3'
		]
	})), /Local reference-media upload is not available/);
});

test('uses the Hailuo mode matrix and rejects the illegal 1080P 10-second combination', () => {
	const request = serializeVideoProviderRequest(catalog, submission(hailuo02, {
		generationMode: 'first-frame-to-video',
		resolution: '512P',
		durationSeconds: 10,
		promptOptimizer: true
	}, {
		prompt: '',
		firstFrame: 'data:image/png;base64,AAAA'
	}));
	assert.deepEqual(request.body, {
		model: 'MiniMax-Hailuo-02',
		duration: 10,
		resolution: '512P',
		prompt_optimizer: true,
		first_frame_image: 'data:image/png;base64,AAAA'
	});
	assert.throws(() => serializeVideoProviderRequest(catalog, submission(hailuo02, {
		generationMode: 'text-to-video',
		resolution: '1080P',
		durationSeconds: 10,
		promptOptimizer: true
	}, { prompt: 'A moving subject' })), /1080P output only at 6 seconds/);
	assert.throws(() => serializeVideoProviderRequest(catalog, submission(hailuo02, {
		generationMode: 'text-to-video',
		resolution: '512P',
		durationSeconds: 6,
		promptOptimizer: true
	}, { prompt: 'Text to video cannot use 512P' })), /unsupported value '512P'/);
});

test('serializes Wan size tuples and keeps regional duration domains distinct', () => {
	const international = wanSelection('ap-southeast-1', 'wan2.6-t2v');
	const request = serializeVideoProviderRequest(catalog, submission(international, {
		generationMode: 'text-to-video',
		aspectRatio: '3:4',
		resolution: '1080P',
		durationSeconds: 2,
		audioMode: 'generate',
		promptExtend: true,
		shotType: 'single',
		watermark: false
	}, { prompt: 'A product rotates slowly' }));
	assert.equal(request.headers['X-DashScope-Async'], 'enable');
	assert.deepEqual(request.body, {
		model: 'wan2.6-t2v',
		input: { prompt: 'A product rotates slowly' },
		parameters: {
			duration: 2,
			size: '1248*1632',
			prompt_extend: true,
			shot_type: 'single',
			watermark: false
		}
	});
	const withoutPromptExtension = serializeVideoProviderRequest(catalog, submission(international, {
		generationMode: 'text-to-video',
		aspectRatio: '16:9',
		resolution: '720P',
		durationSeconds: 5,
		audioMode: 'generate',
		promptExtend: false,
		watermark: false
	}, { prompt: 'One continuous product shot' }));
	assert.equal('shot_type' in record(record(withoutPromptExtension.body).parameters), false);
	assert.throws(() => serializeVideoProviderRequest(catalog, submission(international, {
		generationMode: 'text-to-video',
		aspectRatio: '16:9',
		resolution: '720P',
		durationSeconds: 5,
		audioMode: 'generate',
		promptExtend: false,
		shotType: 'multi',
		watermark: false
	}, { prompt: 'A non-canonical disabled setting' })), /must omit disabled parameter 'shotType'/);
	const usRequest = serializeVideoProviderRequest(catalog, submission(wanSelection('us-east-1', 'wan2.6-t2v-us'), {
		generationMode: 'text-to-video',
		aspectRatio: '16:9',
		resolution: '1080P',
		durationSeconds: 10,
		audioMode: 'generate',
		promptExtend: true,
		shotType: 'single',
		watermark: false
	}, { prompt: 'A ten-second US-only generation' }));
	assert.equal(record(record(usRequest.body).parameters).duration, 10);
	assert.throws(() => serializeVideoProviderRequest(catalog, submission(wanSelection('us-east-1', 'wan2.6-t2v-us'), {
		generationMode: 'text-to-video',
		aspectRatio: '16:9',
		resolution: '1080P',
		durationSeconds: 15,
		audioMode: 'generate',
		promptExtend: true,
		shotType: 'single',
		watermark: false
	}, { prompt: 'The US text-to-video API does not admit fifteen seconds' })), /durationSeconds.*unsupported value '15'/);
	assert.throws(() => serializeVideoProviderRequest(catalog, submission({
		...international,
		region: 'cn-beijing'
	}, {
		generationMode: 'text-to-video',
		aspectRatio: '16:9',
		resolution: '1080P',
		durationSeconds: 5,
		audioMode: 'generate',
		promptExtend: true,
		shotType: 'single',
		watermark: false
	}, { prompt: 'No implicit regional fallback' })), /No reviewed capability/);
});

test('keeps Wan upload-only custom audio and reference modes unavailable until transport exists', () => {
	const i2v = wanSelection('ap-southeast-1', 'wan2.6-i2v');
	const automaticAudio = serializeVideoProviderRequest(catalog, submission(i2v, {
		generationMode: 'first-frame-to-video',
		resolution: '720P',
		durationSeconds: 7,
		audioMode: 'generate',
		promptExtend: true,
		shotType: 'multi',
		watermark: false
	}, {
		prompt: 'A deliberate multi-shot transition',
		firstFrame: 'data:image/png;base64,AAAA'
	}));
	assert.deepEqual(record(record(automaticAudio.body).parameters), {
		duration: 7,
		resolution: '720P',
		prompt_extend: true,
		shot_type: 'multi',
		watermark: false
	});
	assert.throws(() => serializeVideoProviderRequest(catalog, submission(i2v, {
		generationMode: 'first-frame-to-video',
		resolution: '1080P',
		durationSeconds: 5,
		audioMode: 'custom',
		promptExtend: true,
		shotType: 'single',
		watermark: false
	}, {
		prompt: '',
		firstFrame: 'https://assets.example/first.png'
	})), /Local audio upload is not available/);

	const r2v = wanSelection('ap-southeast-1', 'wan2.6-r2v');
	assert.throws(() => serializeVideoProviderRequest(catalog, submission(r2v, {
		generationMode: 'reference-to-video',
		aspectRatio: '16:9',
		resolution: '720P',
		durationSeconds: 5,
		shotType: 'multi',
		watermark: false
	}, { prompt: 'No references', references: [] })), /Local reference-media upload is not available/);
});

function submission(
	selection: VideoProviderModelSelection,
	settings: VideoProviderSubmission['settings'],
	inputs: VideoProviderSubmission['inputs']
): VideoProviderSubmission {
	return { selection, settings, inputs };
}

function wanSelection(region: 'ap-southeast-1' | 'us-east-1', modelId: string): VideoProviderModelSelection {
	return {
		provider: 'alibaba-cloud',
		deployment: region === 'us-east-1' ? 'us' : 'international',
		region,
		modelId,
		revision: '2.6'
	};
}

function record(value: unknown): Record<string, unknown> {
	assert.equal(typeof value, 'object');
	assert.notEqual(value, null);
	assert.equal(Array.isArray(value), false);
	return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
	assert.equal(Array.isArray(value), true);
	return value as unknown[];
}
