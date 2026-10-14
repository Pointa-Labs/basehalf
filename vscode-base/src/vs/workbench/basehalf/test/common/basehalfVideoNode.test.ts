/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	baseHalfVideoNodePhase,
	baseHalfVideoSiblingFields,
	beginBaseHalfVideoTask,
	completeBaseHalfVideoTask,
	failBaseHalfVideoTask,
	IBaseHalfVideoGenerationRecord,
	IBaseHalfVideoNodeFields,
	normalizeBaseHalfVideoGenerationSettings,
	normalizeBaseHalfVideoTask,
	recordBaseHalfVideoRemoteId,
	setBaseHalfVideoGenerationSettings,
	setBaseHalfVideoPrompt,
	settleOrphanedBaseHalfVideoSubmission,
	stopBaseHalfVideoTask
} from '../../common/basehalfVideoNode.js';

suite('BaseHalfVideoNode', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const request: IBaseHalfVideoGenerationRecord = {
		provider: 'ark',
		model: 'doubao-seedance-2-5-260628',
		prompt: 'A cyclist at dawn',
		inputs: ['frames/start.png'],
		mode: 'frames',
		ratio: '16:9',
		resolution: '720p',
		duration: 5,
		audio: true
	};
	const empty: IBaseHalfVideoNodeFields & { readonly title: string } = {
		title: 'Shot 1',
		prompt: 'A cyclist at dawn',
		generation: { channel: 'ark-1', model: 'doubao-seedance-2-5-260628', mode: 'frames', ratio: '16:9', resolution: '720p', duration: 5, audio: true }
	};

	test('runs a generation from submitting to a video and keeps the other fields', () => {
		const submitting = beginBaseHalfVideoTask(empty, { id: 't1', startedAt: '2026-10-15T08:00:00.000Z', channel: 'ark-1', request });
		const running = recordBaseHalfVideoRemoteId(submitting, 't1', 'cgt-1');
		const done = completeBaseHalfVideoTask(running, 't1', { kind: 'video', path: 'outputs/n/t1.mp4', size: 2048 }, '2026-10-15T08:03:00.000Z');
		assert.deepStrictEqual(
			[baseHalfVideoNodePhase(empty), baseHalfVideoNodePhase(submitting), baseHalfVideoNodePhase(running), baseHalfVideoNodePhase(done)],
			['empty', 'generating', 'generating', 'video']
		);
		assert.deepStrictEqual(JSON.parse(JSON.stringify(done)), {
			title: 'Shot 1',
			prompt: 'A cyclist at dawn',
			generation: { channel: 'ark-1', model: 'doubao-seedance-2-5-260628', mode: 'frames', ratio: '16:9', resolution: '720p', duration: 5, audio: true },
			result: {
				source: 'generated',
				artifact: { kind: 'video', path: 'outputs/n/t1.mp4', size: 2048 },
				generation: { taskId: 't1', remoteId: 'cgt-1', startedAt: '2026-10-15T08:00:00.000Z', completedAt: '2026-10-15T08:03:00.000Z', request }
			}
		});
	});

	test('ends without a video, and a new generation replaces the ended task', () => {
		const submitting = beginBaseHalfVideoTask(empty, { id: 't1', startedAt: '2026-10-15T08:00:00.000Z', channel: 'ark-1', request });
		const failed = failBaseHalfVideoTask(submitting, 't1', '  The key was refused.  ', '2026-10-15T08:00:02.000Z');
		assert.strictEqual(baseHalfVideoNodePhase(failed), 'failed');
		assert.strictEqual(failed.task?.error, 'The key was refused.');
		const again = beginBaseHalfVideoTask(failed, { id: 't2', startedAt: '2026-10-15T08:01:00.000Z', channel: 'ark-1', request });
		const stopped = stopBaseHalfVideoTask(recordBaseHalfVideoRemoteId(again, 't2', 'cgt-2'), 't2', '2026-10-15T08:01:30.000Z');
		assert.deepStrictEqual([stopped.task?.id, stopped.task?.state, stopped.task?.remoteId, baseHalfVideoNodePhase(stopped)], ['t2', 'stopped', 'cgt-2', 'stopped']);
	});

	test('refuses what would run a node twice or rewrite a video', () => {
		const submitting = beginBaseHalfVideoTask(empty, { id: 't1', startedAt: '2026-10-15T08:00:00.000Z', channel: 'ark-1', request });
		assert.throws(() => beginBaseHalfVideoTask(submitting, { id: 't2', startedAt: '2026-10-15T08:00:01.000Z', channel: 'ark-1', request }), /already generating/);
		assert.throws(() => recordBaseHalfVideoRemoteId(submitting, 'other', 'cgt-1'), /no longer the node's current task/);
		assert.throws(() => completeBaseHalfVideoTask(submitting, 't1', { kind: 'video', path: 'a.mp4', size: 1 }, '2026-10-15T08:01:00.000Z'), /Only a running task/);
		const done = completeBaseHalfVideoTask(recordBaseHalfVideoRemoteId(submitting, 't1', 'cgt-1'), 't1', { kind: 'video', path: 'a.mp4', size: 1 }, '2026-10-15T08:01:00.000Z');
		assert.throws(() => beginBaseHalfVideoTask(done, { id: 't3', startedAt: '2026-10-15T08:02:00.000Z', channel: 'ark-1', request }), /makes a new node/);
	});

	test('edits the prompt and settings in every phase, and a sibling starts from them', () => {
		const done = completeBaseHalfVideoTask(
			recordBaseHalfVideoRemoteId(beginBaseHalfVideoTask(empty, { id: 't1', startedAt: '2026-10-15T08:00:00.000Z', channel: 'ark-1', request }), 't1', 'cgt-1'),
			't1', { kind: 'video', path: 'a.mp4', size: 1 }, '2026-10-15T08:01:00.000Z');
		const edited = setBaseHalfVideoGenerationSettings(setBaseHalfVideoPrompt(done, 'A cyclist at dusk'), { ...done.generation!, duration: 8 });
		assert.deepStrictEqual(JSON.parse(JSON.stringify(baseHalfVideoSiblingFields(edited))), {
			prompt: 'A cyclist at dusk',
			generation: { channel: 'ark-1', model: 'doubao-seedance-2-5-260628', mode: 'frames', ratio: '16:9', resolution: '720p', duration: 8, audio: true }
		});
		assert.strictEqual(edited.result?.source === 'generated' && edited.result.generation.request.prompt, 'A cyclist at dawn');
	});

	test('settles a submission no window follows as failed, and leaves other tasks alone', () => {
		const submitting = beginBaseHalfVideoTask(empty, { id: 't1', startedAt: '2026-10-15T08:00:00.000Z', channel: 'ark-1', request });
		const settled = settleOrphanedBaseHalfVideoSubmission(submitting, 'BaseHalf closed while the request was on its way.', '2026-10-15T09:00:00.000Z');
		assert.deepStrictEqual([settled.task?.state, settled.task?.error], ['failed', 'BaseHalf closed while the request was on its way.']);
		const running = recordBaseHalfVideoRemoteId(submitting, 't1', 'cgt-1');
		assert.strictEqual(settleOrphanedBaseHalfVideoSubmission(running, 'x', '2026-10-15T09:00:00.000Z'), running);
	});

	test('validates fields strictly and names the field that is wrong', () => {
		assert.throws(() => normalizeBaseHalfVideoGenerationSettings({ mode: 'frames', ratio: '16:9', resolution: '720p', duration: 0, audio: true }), /generation\.duration/);
		assert.throws(() => normalizeBaseHalfVideoGenerationSettings({ mode: 'video', ratio: '16:9', resolution: '720p', duration: 5, audio: true }), /generation\.mode/);
		assert.throws(() => normalizeBaseHalfVideoGenerationSettings({ mode: 'frames', ratio: '16:9', resolution: '720p', duration: 5, audio: true, seed: 3 }), /generation\.seed is not a known field/);
		assert.throws(() => normalizeBaseHalfVideoTask({ id: 't1', state: 'running', startedAt: '2026-10-15T08:00:00.000Z', channel: 'c', request }), /remoteId is required/);
		assert.throws(() => normalizeBaseHalfVideoTask({ id: 't1', state: 'failed', startedAt: '2026-10-15T08:00:00.000Z', endedAt: '2026-10-15T08:00:01.000Z', channel: 'c', request }), /error is required/);
		assert.throws(() => normalizeBaseHalfVideoTask({ id: 't1', state: 'submitting', startedAt: 'yesterday', channel: 'c', request }), /startedAt must be an ISO date/);
		assert.deepStrictEqual(
			normalizeBaseHalfVideoGenerationSettings({ mode: 'reference', ratio: 'adaptive', resolution: '768P', duration: -1, audio: false }),
			{ mode: 'reference', ratio: 'adaptive', resolution: '768P', duration: -1, audio: false }
		);
	});
});
