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
	baseHalfVideoCardPresentation,
	baseHalfVideoCardToolbarActions,
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
import { IBaseHalfVideoGenerationRecord, IBaseHalfVideoNodeFields, IBaseHalfVideoTask } from '../../common/basehalfVideoNode.js';

suite('BaseHalfVideoCardPresentation', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const startedAt = '2026-10-15T08:00:00.000Z';
	const now = Date.parse(startedAt) + 65_000;
	const request: IBaseHalfVideoGenerationRecord = {
		provider: 'acme',
		region: 'east',
		model: 'acme-motion-2',
		providerModel: 'acme-motion-2-e-260101',
		mode: 'frames',
		params: { resolution: '720p', duration: 5, sound: true },
		prompt: 'Rain on the window.',
		inputs: ['frames/start.png']
	};
	const task = (patch: Partial<IBaseHalfVideoTask>): IBaseHalfVideoTask => ({ id: '20261015T080000-k3f9', state: 'submitting', startedAt, request, ...patch });
	const video: IBaseHalfVideoNodeFields = {
		result: {
			source: 'generated',
			artifact: { kind: 'video', path: 'outputs/7766/20261015T080000-k3f9.mp4', size: 1000 },
			generation: { taskId: '20261015T080000-k3f9', remoteId: 'cgt-1', startedAt, completedAt: '2026-10-15T08:01:30.000Z', request }
		}
	};

	test('shows each phase of the node as the card table says', () => {
		const present = (fields: IBaseHalfVideoNodeFields, extra?: { readonly fraction?: number; readonly phase?: 'waiting' | 'generating' | 'saving'; readonly videoExists?: boolean; readonly videoPlayable?: boolean }) => {
			const presentation = baseHalfVideoCardPresentation({
				title: 'Shot 1',
				fields,
				...(extra?.phase ? { progress: { phase: extra.phase, startedAt: Date.parse(startedAt), ...(extra.fraction !== undefined ? { fraction: extra.fraction } : {}) } } : {}),
				...(extra?.videoExists !== undefined ? { videoExists: extra.videoExists } : {}),
				...(extra?.videoPlayable !== undefined ? { videoPlayable: extra.videoPlayable } : {}),
				now
			});
			return Object.fromEntries(Object.entries(presentation).filter(([key]) => key !== 'startedAt'));
		};
		const longError = `The provider refused the request: ${'content policy '.repeat(40)}`.trim();
		assert.deepStrictEqual({
			empty: present({ prompt: 'Rain' }),
			submitting: present({ task: task({}) }),
			runningWithoutProgress: present({ task: task({ state: 'running', remoteId: 'cgt-1' }) }),
			generatingExact: present({ task: task({ state: 'running', remoteId: 'cgt-1' }) }, { phase: 'generating', fraction: 0.42 }),
			downloading: present({ task: task({ state: 'running', remoteId: 'cgt-1' }) }, { phase: 'saving' }),
			failed: present({ task: task({ state: 'failed', endedAt: startedAt, error: longError }) }),
			stopped: present({ task: task({ state: 'stopped', endedAt: startedAt }) }),
			video: present(video),
			missing: present(video, { videoExists: false }),
			unplayable: present(video, { videoPlayable: false })
		}, {
			empty: { state: 'empty', ariaLabel: 'Shot 1, Video' },
			submitting: { state: 'generating', phaseText: 'Waiting', elapsedText: '1:05', ariaLabel: 'Shot 1, Video, Waiting' },
			runningWithoutProgress: { state: 'generating', phaseText: 'Generating', elapsedText: '1:05', ariaLabel: 'Shot 1, Video, Generating' },
			generatingExact: { state: 'generating', phaseText: 'Generating', elapsedText: '1:05', fraction: 0.42, ariaLabel: 'Shot 1, Video, Generating, 42 percent' },
			downloading: { state: 'generating', phaseText: 'Saving', elapsedText: '1:05', ariaLabel: 'Shot 1, Video, Saving' },
			failed: { state: 'failed', message: longError, tooltip: longError, ariaLabel: `Shot 1, Video, failed: ${longError}` },
			stopped: { state: 'stopped', message: 'Stopped', ariaLabel: 'Shot 1, Video, stopped' },
			video: { state: 'video', videoPath: 'outputs/7766/20261015T080000-k3f9.mp4', ariaLabel: 'Shot 1, Video' },
			missing: {
				state: 'missing',
				message: 'The video file is missing',
				tooltip: 'outputs/7766/20261015T080000-k3f9.mp4',
				videoPath: 'outputs/7766/20261015T080000-k3f9.mp4',
				ariaLabel: 'Shot 1, Video, the video file is missing: outputs/7766/20261015T080000-k3f9.mp4'
			},
			unplayable: {
				state: 'unplayable',
				message: 'This video cannot be played here',
				tooltip: 'outputs/7766/20261015T080000-k3f9.mp4',
				videoPath: 'outputs/7766/20261015T080000-k3f9.mp4',
				ariaLabel: 'Shot 1, Video, the video cannot be played: outputs/7766/20261015T080000-k3f9.mp4'
			}
		});
	});

	test('counts the time since the start in minutes and seconds, and hours past an hour', () => {
		assert.deepStrictEqual([0, 999, 42_000, 65_000, 725_000, 3_729_000, -5, Number.NaN].map(formatBaseHalfVideoElapsed), [
			'0:00', '0:00', '0:42', '1:05', '12:05', '1:02:09', '0:00', '0:00'
		]);
	});

	test('offers Upload Video for an empty node that does not generate, and the video actions for a video that is there', () => {
		assert.deepStrictEqual({
			empty: baseHalfVideoCardToolbarActions({ prompt: 'Rain' }, { generating: false }),
			emptyGenerating: baseHalfVideoCardToolbarActions({ prompt: 'Rain' }, { generating: true }),
			submitting: baseHalfVideoCardToolbarActions({ task: task({}) }, { generating: false }),
			failed: baseHalfVideoCardToolbarActions({ task: task({ state: 'failed', endedAt: startedAt, error: 'No.' }) }, { generating: false }),
			video: baseHalfVideoCardToolbarActions(video, { generating: false, videoExists: true }),
			missing: baseHalfVideoCardToolbarActions(video, { generating: false, videoExists: false })
		}, {
			empty: ['importResult'],
			emptyGenerating: [],
			submitting: [],
			failed: [],
			video: ['captureFrame', 'revealVideo', 'openFullPreview'],
			missing: []
		});
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
				unshowable: { phase: 'file', state: 'unshowable', message: 'This image cannot be shown here', tooltip: 'shots/heron-2.png', ariaLabel: 'heron-2.png, Image, This image cannot be shown here: shots/heron-2.png' }
			});
		});

		test('a long error shows in two lines at most, and whole in its tooltip; a landed card whose generation ended shows its file', () => {
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
