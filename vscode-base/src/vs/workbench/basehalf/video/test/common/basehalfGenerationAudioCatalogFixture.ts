/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type { CatalogVoiceOption, VoiceParameter } from '../../../../../platform/basehalfProviders/common/basehalfProviderTypes.js';
import { IBaseHalfVideoCatalog, IBaseHalfVideoCatalogMode, IBaseHalfVideoCatalogModel, IBaseHalfVideoCatalogProvider } from '../../common/basehalfVideoCatalog.js';

/**
 * Audio models of invented providers (D78), as the provider service would
 * answer them, for the tests of the panel, the voice menu, and the panel of a
 * card with its file. The window knows no real provider or model, so its
 * tests do not either. The catalog is the window's own objects: what it
 * holds once it has read the service's answer.
 *
 * - Dulcet Voice (`dulcet`): one region `main`, one API key.
 *   - Dulcet Speech 2 speaks up to 10,000 characters in a voice the
 *     provider lists (Kore, the default, and Puck in the catalog), at a speed.
 *   - Dulcet Effects makes sound effects of up to 22 seconds.
 * - Ember Sound (`ember`): regions `north` and `south`.
 *   - Ember Song 9 makes up to three songs, from a description or from
 *     lyrics, after one reference song.
 *   - Ember Voice speaks up to 5,000 characters as WAV, in the catalog's two
 *     voices only.
 */

const NO_INPUTS = Object.freeze({
	startFrame: 'none' as const,
	endFrame: 'none' as const,
	images: Object.freeze({ min: 0, max: 0 }),
	videos: Object.freeze({ min: 0, max: 0 }),
	audios: Object.freeze({ min: 0, max: 0 }),
	source: 'none' as const
});

const SPEECH: IBaseHalfVideoCatalogMode = { id: 'reference', label: 'Speech', inputs: NO_INPUTS, limits: {} };

export const KORE: CatalogVoiceOption = { value: 'kore', label: 'Kore', description: 'Firm' };
export const PUCK: CatalogVoiceOption = { value: 'puck', label: 'Puck', description: 'Upbeat' };

export const DULCET_VOICE: VoiceParameter = { name: 'voice', label: 'Voice', kind: 'voice', options: [KORE, PUCK], default: 'kore', listed: true };

export const DULCET_SPEECH: IBaseHalfVideoCatalogModel = {
	id: 'dulcet-speech-2',
	kind: 'audio',
	makes: 'speech',
	label: 'Dulcet Speech 2',
	providerModels: { main: 'speech-2-260101' },
	prompt: { required: 'always', maxLength: 10000 },
	modes: [SPEECH],
	parameters: [
		DULCET_VOICE,
		{ name: 'speed', label: 'Speed', kind: 'number', min: 0.5, max: 2, step: 0.05, default: 1 }
	],
	outputFormat: 'mp3',
	answersAtOnce: true
};

export const DULCET_EFFECTS: IBaseHalfVideoCatalogModel = {
	id: 'dulcet-effects',
	kind: 'audio',
	makes: 'sound',
	label: 'Dulcet Effects',
	providerModels: { main: 'effects-1' },
	prompt: { required: 'always', maxLength: 450 },
	modes: [{ id: 'reference', label: 'From a Description', inputs: NO_INPUTS, limits: {} }],
	parameters: [
		{ name: 'duration', label: 'Duration', kind: 'number', unit: 'seconds', min: 0.5, max: 22, step: 0.1, default: 5, auto: { value: -1, label: 'Auto' } }
	],
	outputFormat: 'mp3',
	answersAtOnce: true
};

export const DULCET: IBaseHalfVideoCatalogProvider = {
	id: 'dulcet',
	label: 'Dulcet Voice',
	regions: [{ id: 'main', label: 'Dulcet', baseUrl: 'https://api.dulcet.example' }],
	credentials: [{ id: 'apiKey', label: 'API Key' }],
	models: [DULCET_SPEECH, DULCET_EFFECTS]
};

const REFERENCE_SONG = Object.freeze({ ...NO_INPUTS, audios: Object.freeze({ min: 0, max: 1 }) });

export const EMBER_SONG: IBaseHalfVideoCatalogModel = {
	id: 'ember-song-9',
	kind: 'audio',
	makes: 'music',
	label: 'Ember Song 9',
	providerModels: { north: 'song-9-n', south: 'song-9-s' },
	prompt: { required: 'always', maxLength: 3000 },
	modes: [
		{ id: 'reference', label: 'From a Description', inputs: REFERENCE_SONG, limits: { audioSeconds: [5, 60] } },
		{ id: 'lyrics', label: 'From Lyrics', inputs: REFERENCE_SONG, limits: { audioSeconds: [5, 60] } }
	],
	parameters: [
		{ name: 'instrumental', label: 'Instrumental', kind: 'boolean', default: false, modes: ['reference'] },
		{ name: 'style', label: 'Style', kind: 'text', maxLength: 500, optional: true, modes: ['lyrics'] },
		{ name: 'count', label: 'Songs', kind: 'integer', min: 1, max: 3, step: 1, default: 2 }
	],
	outputFormat: 'mp3'
};

export const ARIA: CatalogVoiceOption = { value: 'aria', label: 'Aria', description: 'Bright' };
export const BRAM: CatalogVoiceOption = { value: 'bram', label: 'Bram' };

export const EMBER_VOICE: IBaseHalfVideoCatalogModel = {
	id: 'ember-voice',
	kind: 'audio',
	makes: 'speech',
	label: 'Ember Voice',
	providerModels: { north: 'voice-n', south: 'voice-s' },
	prompt: { required: 'always', maxLength: 5000 },
	modes: [SPEECH],
	parameters: [{ name: 'voice', label: 'Voice', kind: 'voice', options: [ARIA, BRAM], default: 'aria' }],
	outputFormat: 'wav',
	answersAtOnce: true
};

export const EMBER: IBaseHalfVideoCatalogProvider = {
	id: 'ember',
	label: 'Ember Sound',
	regions: [
		{ id: 'north', label: 'North', baseUrl: 'https://north.ember.example' },
		{ id: 'south', label: 'South', baseUrl: 'https://south.ember.example' }
	],
	credentials: [{ id: 'apiKey', label: 'API Key' }],
	models: [EMBER_SONG, EMBER_VOICE]
};

/** The audio models as the window keeps the catalog. */
export const TEST_AUDIO_CATALOG: IBaseHalfVideoCatalog = { schema: 1, providers: [DULCET, EMBER] };
