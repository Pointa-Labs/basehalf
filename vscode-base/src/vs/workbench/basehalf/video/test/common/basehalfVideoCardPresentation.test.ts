/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	baseHalfGenerationCardPresentation,
	baseHalfGenerationCardToolbarActions,
	baseHalfGenerationPhase,
	formatBaseHalfVideoElapsed,
	IBaseHalfGenerationCardInput
} from '../../common/basehalfVideoCardPresentation.js';
import {
	createBaseHalfGenerationTask,
	failBaseHalfGenerationCard,
	failBaseHalfGenerationTask,
	IBaseHalfGenerationRequest,
	IBaseHalfGenerationTask,
	landBaseHalfGenerationTask,
	recordBaseHalfGenerationLanded,
	runBaseHalfGenerationTask,
	stopBaseHalfGenerationTask,
	submitBaseHalfGenerationTask
} from '../../common/basehalfGenerationInfo.js';

suite('BaseHalfVideoCardPresentation', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const startedAt = '2026-10-15T08:00:00.000Z';
	const now = Date.parse(startedAt) + 65_000;

	test('counts the time since the start in minutes and seconds, and hours past an hour', () => {
		assert.deepStrictEqual([0, 999, 42_000, 65_000, 725_000, 3_729_000, -5, Number.NaN].map(formatBaseHalfVideoElapsed), [
			'0:00', '0:00', '0:42', '1:05', '12:05', '1:02:09', '0:00', '0:00'
		]);
	});

	suite('generation cards', () => {
		const request: IBaseHalfGenerationRequest = {
			provider: 'corvid', region: 'north', model: 'corvid-paint', providerModel: 'paint-n-1', mode: 'reference', params: { count: 2 }, prompt: 'A heron.', inputs: []
		};
		const created = createBaseHalfGenerationTask({ id: '20261022T080000-1a2b3c4d', kind: 'image', cards: ['shots/heron.png', 'shots/heron-2.png'], follower: 'w1', now: startedAt });
		const submitting = submitBaseHalfGenerationTask(created, request, 'A heron.', false);
		const running = runBaseHalfGenerationTask(submitting, 'task-9');
		const landing = landBaseHalfGenerationTask(running);
		const firstLanded = recordBaseHalfGenerationLanded(landing, 0);
		const card = (task: IBaseHalfGenerationTask | undefined, extra: Partial<IBaseHalfGenerationCardInput> = {}) => {
			const presentation = baseHalfGenerationCardPresentation({ name: 'heron-2.png', kind: 'image', path: 'shots/heron-2.png', hasFile: false, ...(task ? { task } : {}), now, ...extra });
			return Object.fromEntries(Object.entries(presentation).filter(([key]) => key !== 'startedAt'));
		};

		test('the phase comes from whether the card has its file and the record of this computer that names it', () => {
			const refused = failBaseHalfGenerationCard(landing, 1, 'The provider refused this one: unsafe content.');
			assert.deepStrictEqual({
				draft: card(undefined),
				preparing: card(created),
				waiting: card(submitting),
				generating: card(running),
				progress: card(running, { progress: { phase: 'waiting', startedAt: Date.parse(startedAt), fraction: 0.25 } }),
				saving: card(landing),
				otherCardLanded: card(firstLanded),
				refused: card(failBaseHalfGenerationTask(refused, 'The provider did not make every file.', startedAt)),
				stopped: card(stopBaseHalfGenerationTask(running, startedAt)),
				file: card(running, { hasFile: true }),
				unshowable: card(undefined, { hasFile: true, fileShowable: false })
			}, {
				draft: { phase: 'draft', state: 'draft', ariaLabel: 'heron-2.png, Image, draft' },
				preparing: { phase: 'generating', state: 'generating', phaseText: 'Preparing', elapsedText: '1:05', ariaLabel: 'heron-2.png, Image, Preparing' },
				waiting: { phase: 'generating', state: 'generating', phaseText: 'Waiting', elapsedText: '1:05', ariaLabel: 'heron-2.png, Image, Waiting' },
				generating: { phase: 'generating', state: 'generating', phaseText: 'Generating', elapsedText: '1:05', ariaLabel: 'heron-2.png, Image, Generating' },
				progress: { phase: 'generating', state: 'generating', phaseText: 'Waiting', elapsedText: '1:05', fraction: 0.25, ariaLabel: 'heron-2.png, Image, Waiting, 25 percent' },
				saving: { phase: 'generating', state: 'generating', phaseText: 'Saving', elapsedText: '1:05', ariaLabel: 'heron-2.png, Image, Saving' },
				otherCardLanded: { phase: 'generating', state: 'generating', phaseText: 'Saving', elapsedText: '1:05', ariaLabel: 'heron-2.png, Image, Saving' },
				refused: { phase: 'failed', state: 'failed', message: 'The provider refused this one: unsafe content.', tooltip: 'The provider refused this one: unsafe content.', ariaLabel: 'heron-2.png, Image, failed: The provider refused this one: unsafe content.' },
				stopped: { phase: 'stopped', state: 'stopped', message: 'Stopped', ariaLabel: 'heron-2.png, Image, stopped' },
				file: { phase: 'file', state: 'file', ariaLabel: 'heron-2.png, Image' },
				unshowable: { phase: 'file', state: 'unshowable', message: 'This image cannot be shown here', ariaLabel: 'heron-2.png, Image, This image cannot be shown here: shots/heron-2.png' }
			});
		});

		test('a long error shows in two lines at most, and whole in the hover of its text; a landed card whose generation ended shows its file', () => {
			const long = `The provider refused the request: ${'content policy '.repeat(40)}`.trim();
			const failed = card(failBaseHalfGenerationTask(running, long, startedAt));
			assert.deepStrictEqual({
				message: [String(failed.message).length, String(failed.message).endsWith('…'), failed.tooltip === long],
				landedThenEnded: baseHalfGenerationPhase({ path: 'shots/heron.png', hasFile: false, task: failBaseHalfGenerationTask(firstLanded, 'No.', startedAt) })
			}, { message: [300, true, true], landedThenEnded: 'file' });
		});

		test('the toolbar offers Upload above a draft that does not generate, Capture Frame for a video with its file, and Reveal and Open for any file', () => {
			assert.deepStrictEqual({
				imageDraft: baseHalfGenerationCardToolbarActions('image', 'draft'),
				generating: baseHalfGenerationCardToolbarActions('image', 'generating'),
				failed: baseHalfGenerationCardToolbarActions('video', 'failed'),
				image: baseHalfGenerationCardToolbarActions('image', 'file'),
				video: baseHalfGenerationCardToolbarActions('video', 'file')
			}, {
				imageDraft: ['importResult'],
				generating: [],
				failed: ['importResult'],
				image: ['revealVideo', 'openFullPreview'],
				video: ['captureFrame', 'revealVideo', 'openFullPreview']
			});
		});
	});
});
