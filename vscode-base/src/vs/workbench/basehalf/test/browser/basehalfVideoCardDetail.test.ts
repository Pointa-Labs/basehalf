/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { safeIntl } from '../../../../base/common/date.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { baseHalfVideoProvenance } from '../../browser/cardDetail/basehalfMediaCardDetail.js';
import { IBaseHalfNodeResult } from '../../common/basehalfVideoNode.js';

suite('BaseHalfVideoCardDetail', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('says what made a generated video: model, provider, mode, settings, prompt, inputs in order, and when', () => {
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
					provider: 'ark',
					model: 'doubao-seedance-2-5-260628',
					prompt: 'Image 1 rides along the sea.',
					inputs: ['frames/start.png', 'shots/Hero.bhnode', 'notes/scene.md', 'frames/end.png'],
					mode: 'frames',
					ratio: 'adaptive',
					resolution: '720p',
					duration: 5,
					audio: true
				}
			}
		};
		const format = safeIntl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'medium' }).value;
		const provenance = baseHalfVideoProvenance(result, path => path.endsWith('.bhnode') ? 'image' : path.endsWith('.md') ? 'text' : 'image', 'en');
		assert.deepStrictEqual(provenance, {
			heading: 'Generated',
			rows: [
				{ label: 'Model', value: 'Seedance 2.5 (doubao-seedance-2-5-260628)' },
				{ label: 'Provider', value: 'Volcengine Ark' },
				{ label: 'Mode', value: 'Frames' },
				{ label: 'Settings', value: 'Adaptive · 720p · 5s · Sound' },
				{ label: 'Prompt', value: 'Image 1 rides along the sea.' },
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
