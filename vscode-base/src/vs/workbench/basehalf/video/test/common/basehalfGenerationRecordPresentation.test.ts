/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IBaseHalfGenerationMade } from '../../common/basehalfGenerationInfo.js';
import { createBaseHalfGenerationRecordPresentation } from '../../common/basehalfGenerationRecordPresentation.js';
import { BaseHalfVideoCatalogState, IBaseHalfVideoInputSource } from '../../common/basehalfVideoCatalog.js';
import { TEST_GENERATION_CATALOG } from './basehalfVideoCatalogFixture.js';

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
		prompt: 'Image 1 rides along the sea.',
		inputs: ['frames/a.png', 'frames/b.png', 'notes/scene.md']
	};
	/** The second frame was deleted since. */
	const INPUTS: IBaseHalfVideoInputSource[] = [
		{ path: 'frames/a.png', kind: 'image', available: true },
		{ path: 'frames/b.png', kind: 'image', available: false },
		{ path: 'notes/scene.md', kind: 'text', available: true }
	];

	test('shows the inputs by the names the mode that made it gave them, the prompt, and the model and settings it was made with, by the catalog\'s names', () => {
		const presentation = createBaseHalfGenerationRecordPresentation({ kind: 'video', made: MADE, inputs: INPUTS, catalog: ready, displayLanguage: 'en' });
		assert.deepStrictEqual(presentation, {
			readable: true,
			inputs: [
				{ index: 0, path: 'frames/a.png', kind: 'image', frame: 'start', label: 'Image 1', gone: false },
				{ index: 1, path: 'frames/b.png', kind: 'image', frame: 'end', label: 'Image 2', gone: true },
				{ index: 2, path: 'notes/scene.md', kind: 'text', gone: false }
			],
			prompt: 'Image 1 rides along the sea.',
			model: 'Acme Motion 2',
			modelTitle: 'Made with Acme Motion 2 on Acme Video, East · Acme Cloud',
			// The seed is an advanced value: in the whole list, not in the summary.
			settings: 'Frames · 720p · 5s · Sound',
			settingsTitle: 'Made with: Frames · 720p · 5s · Sound · Seed 7'
		});
		const chinese = createBaseHalfGenerationRecordPresentation({ kind: 'video', made: MADE, inputs: INPUTS, catalog: ready, displayLanguage: 'zh-cn' });
		assert.deepStrictEqual(chinese.inputs.map(input => input.label), ['图片1', '图片2', undefined]);
	});

	test('shows the values as they were sent, never made legal again, and the recorded ids while the catalog does not have the model', () => {
		const unknownValue = createBaseHalfGenerationRecordPresentation({
			kind: 'video',
			made: { ...MADE, mode: 'reference', params: { resolution: '1080p', duration: 20, style: 'film' }, inputs: ['frames/a.png'] },
			inputs: [INPUTS[0]],
			catalog: ready,
			displayLanguage: 'en'
		});
		assert.deepStrictEqual([unknownValue.settings, unknownValue.inputs.map(input => `${input.frame ?? '-'} ${input.label}`)], ['References · 1080p · 20s · style film', ['- Image 1']]);

		const loading = createBaseHalfGenerationRecordPresentation({ kind: 'video', made: MADE, inputs: INPUTS, catalog: { kind: 'loading' }, displayLanguage: 'en' });
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
		const several = createBaseHalfGenerationRecordPresentation({ kind: 'image', made: image, inputs: [], catalog: ready, displayLanguage: 'en' });
		assert.deepStrictEqual([several.line, several.prompt, several.inputs.length, several.model], ['Image 2 of 4', '', 0, 'Corvid Paint']);
		const copy = createBaseHalfGenerationRecordPresentation({ kind: 'image', made: { ...image, copyOf: '20261023T080000-made0001-2' }, inputs: [], catalog: ready, displayLanguage: 'en' });
		assert.strictEqual(copy.line, 'A copy. This is what made the original.');
		const one = createBaseHalfGenerationRecordPresentation({ kind: 'image', made: { ...image, output: 1, outputs: 1 }, inputs: [], catalog: ready, displayLanguage: 'en' });
		assert.strictEqual(one.line, undefined);
		const unreadable = createBaseHalfGenerationRecordPresentation({ kind: 'image', inputs: [], catalog: ready });
		assert.deepStrictEqual([unreadable.readable, unreadable.inputs.length, unreadable.model], [false, 0, '']);
	});
});
