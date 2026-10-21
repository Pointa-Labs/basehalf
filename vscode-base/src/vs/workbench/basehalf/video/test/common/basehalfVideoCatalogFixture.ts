/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import {
	IBaseHalfVideoCatalog,
	IBaseHalfVideoCatalogMode,
	IBaseHalfVideoCatalogModel,
	IBaseHalfVideoCatalogProvider,
	parseBaseHalfVideoCatalog
} from '../../common/basehalfVideoCatalog.js';

/**
 * A model catalog of invented providers and models, as AI Video would answer
 * it, for the window's tests. The window knows no real provider or model, so
 * its tests do not either.
 *
 * - Acme Video (`acme`): regions `east` and `west`, one API key.
 *   - Acme Motion 2: frames (start and end) and references (4 images, 1 video,
 *     1 audio); resolution, a ratio for references only, duration 4 to 12 s
 *     with Auto, sound, and an advanced seed and negative prompt; both regions.
 *   - Acme Still: frames with a start frame only; two durations; `east` only.
 *   - Acme Clip: extend and edit (a clip, and 2 reference images in edit),
 *     with an advanced start in seconds for edit.
 *   - Acme Legacy: deprecated.
 * - Borealis Media (`borealis`): one region, two credentials; Borealis One
 *   draws from text alone, with a style of seven choices, a decimal strength,
 *   and a caption.
 */

const FRAMES: IBaseHalfVideoCatalogMode = {
	id: 'frames',
	label: 'Frames',
	inputs: { startFrame: 'optional', endFrame: 'optional', images: { min: 0, max: 0 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, source: 'none' },
	limits: { imageMinSide: 300, imageMaxSide: 6000, imageMaxBytes: 31457280 }
};

const REFERENCES: IBaseHalfVideoCatalogMode = {
	id: 'reference',
	label: 'References',
	inputs: { startFrame: 'none', endFrame: 'none', images: { min: 0, max: 4 }, videos: { min: 0, max: 1 }, audios: { min: 0, max: 1 }, source: 'none' },
	limits: { videoSeconds: [2, 15] }
};

export const ACME_MOTION: IBaseHalfVideoCatalogModel = {
	id: 'acme-motion-2',
	label: 'Acme Motion 2',
	description: 'Frames or references, with sound.',
	providerModels: { east: 'acme-motion-2-e-260101', west: 'acme-motion-2-w-260101' },
	prompt: { required: 'withoutMedia', maxLength: 2000 },
	modes: [FRAMES, REFERENCES],
	parameters: [
		{ name: 'resolution', label: 'Resolution', kind: 'choice', options: [{ value: '480p', label: '480p' }, { value: '720p', label: '720p' }, { value: '1080p', label: '1080p' }], default: '720p' },
		{
			name: 'ratio', label: 'Ratio', kind: 'choice', display: 'ratio', modes: ['reference'], default: '16:9',
			options: [{ value: '16:9', label: '16:9' }, { value: '4:3', label: '4:3' }, { value: '1:1', label: '1:1' }, { value: '3:4', label: '3:4' }, { value: '9:16', label: '9:16' }, { value: '21:9', label: '21:9' }]
		},
		{ name: 'duration', label: 'Duration', kind: 'integer', unit: 'seconds', min: 4, max: 12, step: 1, default: 5, auto: { value: -1, label: 'Auto' } },
		{ name: 'sound', label: 'Sound', kind: 'boolean', default: true },
		{ name: 'seed', label: 'Seed', kind: 'integer', min: 0, max: 2147483647, step: 1, optional: true, advanced: true },
		{ name: 'negative_prompt', label: 'Negative Prompt', kind: 'text', maxLength: 500, optional: true, advanced: true }
	]
};

export const ACME_STILL: IBaseHalfVideoCatalogModel = {
	id: 'acme-still',
	label: 'Acme Still',
	providerModels: { east: 'acme-still-260101' },
	prompt: { required: 'never', maxLength: 1000 },
	modes: [{ ...FRAMES, inputs: { ...FRAMES.inputs, endFrame: 'none' } }],
	parameters: [
		{ name: 'resolution', label: 'Resolution', kind: 'choice', options: [{ value: '720p', label: '720P' }, { value: '1080p', label: '1080P' }], default: '1080p' },
		{ name: 'duration', label: 'Duration', kind: 'integer', unit: 'seconds', min: 5, max: 10, step: 5, default: 5 }
	]
};

export const ACME_CLIP: IBaseHalfVideoCatalogModel = {
	id: 'acme-clip',
	label: 'Acme Clip',
	providerModels: { east: 'acme-clip-1', west: 'acme-clip-1' },
	prompt: { required: 'always', maxLength: 1000 },
	modes: [
		{ id: 'extend', label: 'Extend', inputs: { startFrame: 'none', endFrame: 'none', images: { min: 0, max: 0 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, source: 'required' }, limits: {} },
		{ id: 'edit', label: 'Edit', inputs: { startFrame: 'none', endFrame: 'none', images: { min: 0, max: 2 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, source: 'required' }, limits: {} }
	],
	parameters: [
		{ name: 'resolution', label: 'Resolution', kind: 'choice', options: [{ value: '720p', label: '720p' }], default: '720p' },
		{ name: 'start', label: 'Start', kind: 'number', unit: 'seconds', min: 0, max: 20, step: 0.1, optional: true, modes: ['edit'], advanced: true }
	]
};

export const ACME_LEGACY: IBaseHalfVideoCatalogModel = {
	id: 'acme-legacy',
	label: 'Acme Legacy',
	providerModels: { east: 'acme-legacy-1' },
	prompt: { required: 'always', maxLength: 1000 },
	modes: [FRAMES],
	parameters: [],
	deprecated: true
};

export const ACME: IBaseHalfVideoCatalogProvider = {
	id: 'acme',
	label: 'Acme Video',
	regions: [
		{ id: 'east', label: 'East · Acme Cloud', baseUrl: 'https://east.acme.example/api/v1', console: 'https://console.acme.example/east' },
		{ id: 'west', label: 'West · Acme Global', baseUrl: 'https://west.acme.example/api/v1', console: 'https://console.acme.example/west' }
	],
	credentials: [{ id: 'apiKey', label: 'API Key', placeholder: 'acme-…' }],
	models: [ACME_MOTION, ACME_STILL, ACME_CLIP, ACME_LEGACY]
};

export const BOREALIS_ONE: IBaseHalfVideoCatalogModel = {
	id: 'borealis-one',
	label: 'Borealis One',
	providerModels: { main: 'b1' },
	prompt: { required: 'always', maxLength: 4000 },
	modes: [{ ...FRAMES, inputs: { ...FRAMES.inputs, startFrame: 'none', endFrame: 'none' } }],
	parameters: [
		{
			name: 'style', label: 'Style', kind: 'choice', optional: true,
			options: ['film', 'anime', 'clay', 'ink', 'pixel', 'neon', 'paper'].map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }))
		},
		{ name: 'strength', label: 'Strength', kind: 'number', min: 0, max: 1, step: 0.1, default: 0.5 },
		{ name: 'caption', label: 'Caption', kind: 'text', maxLength: 80 }
	]
};

export const BOREALIS: IBaseHalfVideoCatalogProvider = {
	id: 'borealis',
	label: 'Borealis Media',
	regions: [{ id: 'main', label: 'Borealis', baseUrl: 'https://api.borealis.example' }],
	credentials: [{ id: 'accessKey', label: 'Access Key' }, { id: 'secretKey', label: 'Secret Key' }],
	models: [BOREALIS_ONE]
};

/** The fixture as the window keeps it once it has read AI Video's answer. */
export const TEST_VIDEO_CATALOG: IBaseHalfVideoCatalog = parseBaseHalfVideoCatalog({ schema: 1, providers: [ACME, BOREALIS] }).catalog;

/** The catalog read from AI Video's answer, whose models are the ones above. */
export function testVideoModel(providerId: string, modelId: string): IBaseHalfVideoCatalogModel {
	const model = TEST_VIDEO_CATALOG.providers.find(provider => provider.id === providerId)?.models.find(candidate => candidate.id === modelId);
	if (!model) {
		throw new Error(`The test catalog has no ${providerId}/${modelId}.`);
	}
	return model;
}
