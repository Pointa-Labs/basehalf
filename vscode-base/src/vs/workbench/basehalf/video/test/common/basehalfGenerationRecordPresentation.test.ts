/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BaseHalfGenerationKind, IBaseHalfGenerationMade } from '../../common/basehalfGenerationInfo.js';
import { createBaseHalfGenerationRecordPresentation } from '../../common/basehalfGenerationRecordPresentation.js';
import { BaseHalfModelKind, BaseHalfVideoCatalogState, IBaseHalfVideoInputSource } from '../../common/basehalfVideoCatalog.js';
import { TEST_AUDIO_CATALOG, TEST_GENERATION_CATALOG } from './basehalfVideoCatalogFixture.js';

/** The kind of an audio card (D78). */
const AUDIO = 'audio' as BaseHalfModelKind as BaseHalfGenerationKind;

suite('BaseHalfGenerationRecordPresentation', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const ready: BaseHalfVideoCatalogState = { kind: 'ready', catalog: TEST_GENERATION_CATALOG };
	const MADE: IBaseHalfGenerationMade = {
		id: '20261023T080000-made0001',
		startedAt: '2026-10-23T08:00:00.000Z',
		finishedAt: '2026-10-23T08:02:00.000Z',
		provider: 'acme',
		region: 'east',
		model: 'acme-motion-2',
		providerModel: 'acme-motion-2-e-260101',
		mode: 'frames',
		params: { resolution: '720p', duration: 5, sound: true, seed: 7 },
		prompt: '@[frames/a.png] rides along the sea.',
		inputs: ['frames/a.png', 'frames/b.png', 'notes/scene.md']
	};
	/** The second frame was deleted since. */
	const INPUTS: IBaseHalfVideoInputSource[] = [
		{ path: 'frames/a.png', kind: 'image', available: true },
		{ path: 'frames/b.png', kind: 'image', available: false },
		{ path: 'notes/scene.md', kind: 'text', available: true }
	];

	test('shows the inputs with the frames the mode that made it gave them, the prompt with its mentions, and the model and settings it was made with, by the catalog\'s names', () => {
		const presentation = createBaseHalfGenerationRecordPresentation({ kind: 'video', made: MADE, inputs: INPUTS, catalog: ready });
		assert.deepStrictEqual(presentation, {
			readable: true,
			inputs: [
				{ index: 0, path: 'frames/a.png', kind: 'image', frame: 'start', gone: false },
				{ index: 1, path: 'frames/b.png', kind: 'image', frame: 'end', gone: true },
				{ index: 2, path: 'notes/scene.md', kind: 'text', gone: false }
			],
			prompt: '@[frames/a.png] rides along the sea.',
			model: 'Acme Motion 2',
			modelTitle: 'Made with Acme Motion 2 on Acme Video, East · Acme Cloud',
			// The seed is an advanced value: in the whole list, not in the summary.
			settings: 'Frames · 720p · 5s · Sound',
			settingsTitle: 'Made with: Frames · 720p · 5s · Sound · Seed 7'
		});
	});

	test('shows the values as they were sent, never made legal again, and the recorded ids while the catalog does not have the model', () => {
		const unknownValue = createBaseHalfGenerationRecordPresentation({
			kind: 'video',
			made: { ...MADE, mode: 'reference', params: { resolution: '1080p', duration: 20, style: 'film' }, inputs: ['frames/a.png'] },
			inputs: [INPUTS[0]],
			catalog: ready
		});
		assert.deepStrictEqual([unknownValue.settings, unknownValue.inputs.map(input => `${input.frame ?? '-'} ${input.path}`)], ['References · 1080p · 20s · style film', ['- frames/a.png']]);

		const loading = createBaseHalfGenerationRecordPresentation({ kind: 'video', made: MADE, inputs: INPUTS, catalog: { kind: 'loading' } });
		assert.deepStrictEqual({
			model: loading.model,
			modelTitle: loading.modelTitle,
			settings: loading.settings,
			frames: loading.inputs.map(input => input.frame)
		}, {
			model: 'acme-motion-2',
			modelTitle: 'Made with acme-motion-2 on acme, east',
			settings: 'frames · resolution 720p · duration 5 · sound true · seed 7',
			frames: ['start', 'end', undefined]
		});
	});

	test('says which image of how many it is, that it is a copy, that it had no prompt, and that the record cannot be read', () => {
		const image: IBaseHalfGenerationMade = { ...MADE, provider: 'corvid', region: 'north', model: 'corvid-paint', providerModel: 'paint-n-1', mode: 'reference', params: { resolution: '1k', count: 4 }, prompt: '', inputs: [], output: 2, outputs: 4 };
		const several = createBaseHalfGenerationRecordPresentation({ kind: 'image', made: image, inputs: [], catalog: ready });
		assert.deepStrictEqual([several.line, several.prompt, several.inputs.length, several.model], ['Image 2 of 4', '', 0, 'Corvid Paint']);
		const copy = createBaseHalfGenerationRecordPresentation({ kind: 'image', made: { ...image, copyOf: '20261023T080000-made0001-2' }, inputs: [], catalog: ready });
		assert.strictEqual(copy.line, 'A copy. This is what made the original.');
		const one = createBaseHalfGenerationRecordPresentation({ kind: 'image', made: { ...image, output: 1, outputs: 1 }, inputs: [], catalog: ready });
		assert.strictEqual(one.line, undefined);
		const unreadable = createBaseHalfGenerationRecordPresentation({ kind: 'image', inputs: [], catalog: ready });
		assert.deepStrictEqual([unreadable.readable, unreadable.inputs.length, unreadable.model], [false, 0, '']);
	});

	test('says how an edited file differs from what was generated, after that it is a copy (D84)', () => {
		const trimmed = createBaseHalfGenerationRecordPresentation({ kind: 'video', made: MADE, inputs: INPUTS, catalog: ready, edit: { keep: [{ start: 1, end: 4.5 }] } });
		const copy = createBaseHalfGenerationRecordPresentation({ kind: 'video', made: { ...MADE, copyOf: '20261023T080000-made0000' }, inputs: INPUTS, catalog: ready, edit: { keep: [{ start: 1.25, end: 3.04 }] } });
		const cropped = createBaseHalfGenerationRecordPresentation({ kind: 'image', made: MADE, inputs: INPUTS, catalog: ready, edit: { turn: 1, crop: { x: 800, y: 450, width: 1600, height: 900 } } });
		assert.deepStrictEqual([trimmed.line, trimmed.settings, copy.line, cropped.line], [
			'Edited: Trimmed to 1.0s–4.5s.',
			// The settings are what was sent: the generated video was 5 s.
			'Frames · 720p · 5s · Sound',
			'A copy. This is what made the original. Edited: Trimmed to 1.2s–3.0s.',
			'Edited: Turned · Cropped to 1600 × 900.'
		]);
	});

	test('names the voice a speech model spoke in by the catalog, the provider\'s last list, or its recorded id, apart from the settings, and says which song of how many it is (D78)', () => {
		const audio: BaseHalfVideoCatalogState = { kind: 'ready', catalog: TEST_AUDIO_CATALOG };
		const spoken: IBaseHalfGenerationMade = { ...MADE, provider: 'dunlin', region: 'main', model: 'dunlin-voice', providerModel: 'voice-1', mode: 'reference', params: { voice: 'vx-pike', speed: 1 }, prompt: 'Welcome to the coast.', inputs: [] };
		const voices = (provider: string, region: string) => provider === 'dunlin' && region === 'main'
			? { voices: [{ id: 'rachel', label: 'Rachel', own: false }, { id: 'vx-pike', label: 'Pike of the account', own: false }] }
			: undefined;
		const present = (made: IBaseHalfGenerationMade, catalog: BaseHalfVideoCatalogState = audio) => createBaseHalfGenerationRecordPresentation({ kind: AUDIO, made, inputs: [], catalog, voices });
		const byCatalog = present(spoken);
		const song = present({ ...spoken, model: 'dunlin-song', mode: 'lyrics', params: { count: 3 }, output: 2, outputs: 3 });
		assert.deepStrictEqual({
			byCatalog: [byCatalog.model, byCatalog.voice, byCatalog.settings, byCatalog.settingsTitle],
			byList: present({ ...spoken, params: { voice: 'rachel' } }).voice,
			byId: present({ ...spoken, params: { voice: 'gone-since' } }).voice,
			// Without the catalog it is not known to be a voice: it is among the values it was made with.
			withoutCatalog: [present(spoken, { kind: 'loading' }).voice, present(spoken, { kind: 'loading' }).settings],
			song: [song.line, song.voice],
			one: present({ ...spoken, output: 1, outputs: 1 }).line
		}, {
			// The voice is named apart, once: neither the summary nor the whole list of values has it.
			byCatalog: ['Dunlin Voice', 'Pike', 'From Text · Speed 1', 'Made with: From Text · Speed 1'],
			byList: 'Rachel',
			byId: 'gone-since',
			withoutCatalog: [undefined, 'reference · voice vx-pike · speed 1'],
			song: ['Song 2 of 3', undefined],
			one: undefined
		});
	});
});
