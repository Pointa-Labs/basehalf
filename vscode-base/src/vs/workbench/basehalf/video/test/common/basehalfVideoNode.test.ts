/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	baseHalfVideoNodePhase,
	baseHalfVideoSiblingFields,
	beginBaseHalfVideoTask,
	completeBaseHalfVideoTask,
	failBaseHalfVideoTask,
	IBaseHalfVideoGenerationRecord,
	IBaseHalfVideoNodeFields,
	normalizeBaseHalfVideoGeneration,
	normalizeBaseHalfVideoGenerationRecord,
	normalizeBaseHalfVideoTask,
	recordBaseHalfVideoRemoteId,
	setBaseHalfVideoGeneration,
	setBaseHalfVideoPrompt,
	settleOrphanedBaseHalfVideoSubmission,
	stopBaseHalfVideoTask
} from '../../common/basehalfVideoNode.js';

suite('BaseHalfVideoNode', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const request: IBaseHalfVideoGenerationRecord = {
		provider: 'acme',
		region: 'east',
		model: 'acme-motion-2',
		providerModel: 'acme-motion-2-e-260101',
		mode: 'frames',
		params: { resolution: '720p', duration: 5, sound: true },
		prompt: 'A cyclist at dawn',
		inputs: ['frames/start.png']
	};
	const empty: IBaseHalfVideoNodeFields & { readonly title: string } = {
		title: 'Shot 1',
		prompt: 'A cyclist at dawn',
		generation: { provider: 'acme', model: 'acme-motion-2', mode: 'frames', params: { resolution: '720p', duration: 5, sound: true } }
	};

	test('runs a generation from submitting to a video and keeps the other fields', () => {
		const submitting = beginBaseHalfVideoTask(empty, { id: 't1', startedAt: '2026-10-15T08:00:00.000Z', request });
		const running = recordBaseHalfVideoRemoteId(submitting, 't1', 'cgt-1');
		const done = completeBaseHalfVideoTask(running, 't1', { kind: 'video', path: 'outputs/n/t1.mp4', size: 2048 }, '2026-10-15T08:03:00.000Z');
		assert.deepStrictEqual(
			[baseHalfVideoNodePhase(empty), baseHalfVideoNodePhase(submitting), baseHalfVideoNodePhase(running), baseHalfVideoNodePhase(done)],
			['empty', 'generating', 'generating', 'video']
		);
		assert.deepStrictEqual(JSON.parse(JSON.stringify(done)), {
			title: 'Shot 1',
			prompt: 'A cyclist at dawn',
			generation: { provider: 'acme', model: 'acme-motion-2', mode: 'frames', params: { resolution: '720p', duration: 5, sound: true } },
			result: {
				source: 'generated',
				artifact: { kind: 'video', path: 'outputs/n/t1.mp4', size: 2048 },
				generation: { taskId: 't1', remoteId: 'cgt-1', startedAt: '2026-10-15T08:00:00.000Z', completedAt: '2026-10-15T08:03:00.000Z', request }
			}
		});
	});

	test('ends without a video, and a new generation replaces the ended task', () => {
		const submitting = beginBaseHalfVideoTask(empty, { id: 't1', startedAt: '2026-10-15T08:00:00.000Z', request });
		const failed = failBaseHalfVideoTask(submitting, 't1', '  The key was refused.  ', '2026-10-15T08:00:02.000Z');
		assert.strictEqual(baseHalfVideoNodePhase(failed), 'failed');
		assert.strictEqual(failed.task?.error, 'The key was refused.');
		const again = beginBaseHalfVideoTask(failed, { id: 't2', startedAt: '2026-10-15T08:01:00.000Z', request });
		const stopped = stopBaseHalfVideoTask(recordBaseHalfVideoRemoteId(again, 't2', 'cgt-2'), 't2', '2026-10-15T08:01:30.000Z');
		assert.deepStrictEqual([stopped.task?.id, stopped.task?.state, stopped.task?.remoteId, baseHalfVideoNodePhase(stopped)], ['t2', 'stopped', 'cgt-2', 'stopped']);
	});

	test('refuses what would run a node twice or rewrite a video', () => {
		const submitting = beginBaseHalfVideoTask(empty, { id: 't1', startedAt: '2026-10-15T08:00:00.000Z', request });
		assert.throws(() => beginBaseHalfVideoTask(submitting, { id: 't2', startedAt: '2026-10-15T08:00:01.000Z', request }), /already generating/);
		assert.throws(() => recordBaseHalfVideoRemoteId(submitting, 'other', 'cgt-1'), /no longer the node's current task/);
		assert.throws(() => completeBaseHalfVideoTask(submitting, 't1', { kind: 'video', path: 'a.mp4', size: 1 }, '2026-10-15T08:01:00.000Z'), /Only a running task/);
		const done = completeBaseHalfVideoTask(recordBaseHalfVideoRemoteId(submitting, 't1', 'cgt-1'), 't1', { kind: 'video', path: 'a.mp4', size: 1 }, '2026-10-15T08:01:00.000Z');
		assert.throws(() => beginBaseHalfVideoTask(done, { id: 't3', startedAt: '2026-10-15T08:02:00.000Z', request }), /makes a new node/);
	});

	test('edits the prompt and the generation in every phase, and a sibling starts from them', () => {
		const done = completeBaseHalfVideoTask(
			recordBaseHalfVideoRemoteId(beginBaseHalfVideoTask(empty, { id: 't1', startedAt: '2026-10-15T08:00:00.000Z', request }), 't1', 'cgt-1'),
			't1', { kind: 'video', path: 'a.mp4', size: 1 }, '2026-10-15T08:01:00.000Z');
		const edited = setBaseHalfVideoGeneration(setBaseHalfVideoPrompt(done, 'A cyclist at dusk'), { ...done.generation!, params: { ...done.generation!.params, duration: 8 } });
		assert.deepStrictEqual(JSON.parse(JSON.stringify(baseHalfVideoSiblingFields(edited))), {
			prompt: 'A cyclist at dusk',
			generation: { provider: 'acme', model: 'acme-motion-2', mode: 'frames', params: { resolution: '720p', duration: 8, sound: true } }
		});
		assert.strictEqual(edited.result?.source === 'generated' && edited.result.generation.request.prompt, 'A cyclist at dawn');
	});

	test('settles a submission no window follows as failed, and leaves other tasks alone', () => {
		const submitting = beginBaseHalfVideoTask(empty, { id: 't1', startedAt: '2026-10-15T08:00:00.000Z', request });
		const settled = settleOrphanedBaseHalfVideoSubmission(submitting, 'BaseHalf closed while the request was on its way.', '2026-10-15T09:00:00.000Z');
		assert.deepStrictEqual([settled.task?.state, settled.task?.error], ['failed', 'BaseHalf closed while the request was on its way.']);
		const running = recordBaseHalfVideoRemoteId(submitting, 't1', 'cgt-1');
		assert.strictEqual(settleOrphanedBaseHalfVideoSubmission(running, 'x', '2026-10-15T09:00:00.000Z'), running);
	});

	test('reads the shapes of the generation and its record strictly, and names the field that is wrong', () => {
		assert.deepStrictEqual({
			none: normalizeBaseHalfVideoGeneration({}),
			agent: normalizeBaseHalfVideoGeneration({ provider: 'acme', model: 'acme-still' }),
			values: normalizeBaseHalfVideoGeneration({ mode: 'extend', params: { seed: 7, style: 'ink', sound: false } })
		}, {
			none: {},
			agent: { provider: 'acme', model: 'acme-still' },
			values: { mode: 'extend', params: { seed: 7, style: 'ink', sound: false } }
		});
		assert.throws(() => normalizeBaseHalfVideoGeneration({ model: 'x', resolution: '720p' }), /generation\.resolution is not a known field/);
		assert.throws(() => normalizeBaseHalfVideoGeneration({ mode: 'video' }), /generation\.mode must be one of frames, reference, extend, edit/);
		assert.throws(() => normalizeBaseHalfVideoGeneration({ params: { duration: Number.POSITIVE_INFINITY } }), /generation\.params\.duration must be a finite number/);
		assert.throws(() => normalizeBaseHalfVideoGeneration({ params: { prompt: 'x'.repeat(16 * 1024 + 1) } }), /generation\.params\.prompt is longer than/);
		assert.throws(() => normalizeBaseHalfVideoGeneration({ params: Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`p${index}`, index])) }), /generation\.params has more than 64 values/);
		assert.throws(() => normalizeBaseHalfVideoGenerationRecord({ ...request, region: undefined }), /request\.region must be a string/);
		assert.throws(() => normalizeBaseHalfVideoGenerationRecord({ ...request, ratio: '16:9' }), /request\.ratio is not a known field/);
		assert.throws(() => normalizeBaseHalfVideoTask({ id: 't1', state: 'running', startedAt: '2026-10-15T08:00:00.000Z', request }), /remoteId is required/);
		assert.throws(() => normalizeBaseHalfVideoTask({ id: 't1', state: 'failed', startedAt: '2026-10-15T08:00:00.000Z', endedAt: '2026-10-15T08:00:01.000Z', request }), /error is required/);
		assert.throws(() => normalizeBaseHalfVideoTask({ id: 't1', state: 'submitting', startedAt: 'yesterday', request }), /startedAt must be an ISO date/);
		assert.throws(() => normalizeBaseHalfVideoTask({ id: 't1', state: 'submitting', startedAt: '2026-10-15T08:00:00.000Z', channel: 'relay-1', request }), /task\.channel is not a known field/);
		// The prompt as sent holds the text of the notes too, beyond the 64 KiB of the node's prompt.
		assert.strictEqual(normalizeBaseHalfVideoGenerationRecord({ ...request, prompt: 'x'.repeat(100 * 1024) }).prompt.length, 100 * 1024);
	});
});
