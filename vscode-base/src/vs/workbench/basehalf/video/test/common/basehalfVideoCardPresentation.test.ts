/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfVideoCardPresentation, baseHalfVideoCardToolbarActions, formatBaseHalfVideoElapsed } from '../../common/basehalfVideoCardPresentation.js';
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
		const present = (fields: IBaseHalfVideoNodeFields, extra?: { readonly fraction?: number; readonly phase?: 'queued' | 'generating' | 'downloading'; readonly videoExists?: boolean; readonly videoPlayable?: boolean }) => {
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
			downloading: present({ task: task({ state: 'running', remoteId: 'cgt-1' }) }, { phase: 'downloading' }),
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
			downloading: { state: 'generating', phaseText: 'Downloading', elapsedText: '1:05', ariaLabel: 'Shot 1, Video, Downloading' },
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
});
