/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { safeIntl } from '../../../../base/common/date.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { baseHalfVideoProvenance } from '../../browser/cardDetail/basehalfMediaCardDetail.js';
import { IBaseHalfNodeResult } from '../../common/basehalfVideoNode.js';
import { TEST_VIDEO_CATALOG } from '../common/basehalfVideoCatalogFixture.js';

suite('BaseHalfVideoCardDetail', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('says what made a generated video: model, provider, mode, settings, prompt, inputs in order, and when, named by the catalog', () => {
		const startedAt = '2026-10-15T08:00:00.000Z';
		const completedAt = '2026-10-15T08:02:31.000Z';
		const result: IBaseHalfNodeResult = {
			source: 'generated',
			artifact: { kind: 'video', path: 'outputs/node-1/task-1.mp4', size: 1000 },
			generation: {
				taskId: 'task-1',
				remoteId: 'cgt-1',
				startedAt,
				completedAt,
				request: {
					provider: 'acme',
					region: 'west',
					model: 'acme-motion-2',
					providerModel: 'acme-motion-2-w-260101',
					mode: 'reference',
					params: { resolution: '720p', ratio: '21:9', duration: -1, sound: true, seed: 42, retired: 'x' },
					prompt: 'Image 1 rides along the sea.\n\nThe sea at dusk.',
					inputs: ['frames/start.png', 'shots/Hero.bhnode', 'notes/scene.md', 'frames/end.png']
				}
			}
		};
		const format = safeIntl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'medium' }).value;
		const kindOf = (path: string) => path.endsWith('.bhnode') ? 'image' as const : path.endsWith('.md') ? 'text' as const : 'image' as const;
		const named = baseHalfVideoProvenance(result, kindOf, 'en', TEST_VIDEO_CATALOG);
		const raw = baseHalfVideoProvenance(result, kindOf, 'en');
		assert.deepStrictEqual(named, {
			heading: 'Generated',
			rows: [
				{ label: 'Model', value: 'Acme Motion 2 (acme-motion-2-w-260101)' },
				{ label: 'Provider', value: 'Acme Video · West · Acme Global' },
				{ label: 'Mode', value: 'References' },
				{ label: 'Settings', value: 'Resolution 720p · Ratio 21:9 · Duration Auto · Sound On · Seed 42 · retired: x' },
				{ label: 'Prompt', value: 'Image 1 rides along the sea.\n\nThe sea at dusk.' },
				{ label: 'Started', value: format.format(new Date(startedAt)) },
				{ label: 'Finished', value: `${format.format(new Date(completedAt))}, after 2:31` }
			],
			inputs: [
				{ name: 'Image 1', path: 'frames/start.png' },
				{ name: 'Image 2', path: 'shots/Hero.bhnode' },
				{ name: 'Text', path: 'notes/scene.md' },
				{ name: 'Image 3', path: 'frames/end.png' }
			]
		});
		// Without the catalog, the recorded ids.
		assert.deepStrictEqual(raw.rows.slice(0, 4), [
			{ label: 'Model', value: 'acme-motion-2 (acme-motion-2-w-260101)' },
			{ label: 'Provider', value: 'acme · west' },
			{ label: 'Mode', value: 'reference' },
			{ label: 'Settings', value: 'resolution: 720p · ratio: 21:9 · duration: -1 · sound: true · seed: 42 · retired: x' }
		]);
	});

	test('says that an imported video was imported', () => {
		assert.deepStrictEqual(baseHalfVideoProvenance({ source: 'imported', artifact: { kind: 'video', path: 'clips/take.mp4', size: 10 } }), {
			heading: 'Imported',
			rows: [
				{ label: 'Source', value: 'This video was imported into the node.' },
				{ label: 'File', value: 'clips/take.mp4' }
			],
			inputs: []
		});
	});
});
