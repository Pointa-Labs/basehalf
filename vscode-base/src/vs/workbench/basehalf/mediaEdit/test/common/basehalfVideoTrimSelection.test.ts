/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BaseHalfVideoTrimTimeline, formatBaseHalfVideoHandleTime, formatBaseHalfVideoTrimLength, IBaseHalfVideoTrimRange } from '../../common/basehalfVideoTrimSelection.js';

/** The frame edges of a picture of `frames` frames at `fps` frames per second. */
function edgesOf(frames: number, fps: number): number[] {
	return Array.from({ length: frames + 1 }, (_, index) => index / fps);
}

function rounded(range: IBaseHalfVideoTrimRange): [number, number] {
	return [Math.round(range.start * 1000) / 1000, Math.round(range.end * 1000) / 1000];
}

suite('BaseHalfVideoTrimSelection', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const timeline = new BaseHalfVideoTrimTimeline(edgesOf(150, 30));
	const whole = timeline.whole();

	test('snaps to the nearest frame edge, and finds the edges around a time', () => {
		assert.deepStrictEqual([
			timeline.duration,
			timeline.snap(1.01),
			timeline.snap(1.02),
			timeline.edgeAtOrBefore(1.05),
			timeline.edgeAtOrAfter(1.05),
			timeline.edgeAtOrAfter(1),
			timeline.stepFrame(1, 1),
			timeline.stepFrame(0, -1),
			timeline.stepFrame(5, 1)
		].map(value => Math.round(value * 1000) / 1000), [5, 1, 1.033, 1.033, 1.067, 1, 1.033, 0, 5]);
	});

	test('moves a handle to a frame edge, and a handle closer than 1.0 s to the other pushes it until both stop at an end', () => {
		const selected = timeline.moveHandle(timeline.moveHandle(whole, 'start', 1.01), 'end', 4.49);
		assert.deepStrictEqual([
			rounded(selected),
			rounded(timeline.moveHandle(selected, 'start', 4)),
			rounded(timeline.moveHandle(selected, 'start', 4.8)),
			rounded(timeline.moveHandle(selected, 'end', 1.5)),
			rounded(timeline.moveHandle(selected, 'end', 0.2)),
			rounded(timeline.moveHandle(selected, 'start', -3)),
			rounded(timeline.moveHandle(selected, 'end', 99))
		], [[1, 4.5], [4, 5], [4, 5], [0.5, 1.5], [0, 1], [0, 4.5], [1, 5]]);
	});

	test('steps a handle by the keyboard by a time or by one frame, at least one frame each step', () => {
		const selected = { start: 1, end: 4 };
		const sparse = new BaseHalfVideoTrimTimeline([0, 0.5, 1, 1.5, 2, 2.5, 3]);
		assert.deepStrictEqual([
			rounded(timeline.stepHandle(selected, 'start', 0.1, 1)),
			rounded(timeline.stepHandle(selected, 'start', 'frame', 1)),
			rounded(timeline.stepHandle(selected, 'end', 1, -1)),
			rounded(timeline.stepHandle(selected, 'end', 'frame', 1)),
			// Frames half a second apart: a step of 0.1 s still moves one frame.
			rounded(sparse.stepHandle({ start: 0, end: 3 }, 'start', 0.1, 1))
		], [[1.1, 4], [1.033, 4], [1, 3], [1, 4.033], [0.5, 3]]);
	});

	test('a picture shorter than 1.0 s is the whole selection, and a range that no longer fits is the whole picture again', () => {
		const short = new BaseHalfVideoTrimTimeline(edgesOf(20, 30));
		assert.deepStrictEqual([
			Math.round(short.minLength * 1000) / 1000,
			rounded(short.moveHandle(short.whole(), 'start', 0.3)),
			rounded(timeline.normalize({ start: 1, end: 1.5 })),
			rounded(timeline.normalize({ start: 1.02, end: 3.99 })),
			rounded(timeline.normalize(undefined)),
			timeline.isWhole({ start: 0, end: 5 }),
			timeline.isWhole({ start: 0, end: 4.9 })
		], [0.667, [0, 0.667], [0, 5], [1.033, 4], [0, 5], true, false]);
	});

	test('shows a length in tenths under a minute and in minutes and seconds from a minute on, as the player shows times: never more than it is', () => {
		assert.deepStrictEqual([
			formatBaseHalfVideoTrimLength(30 / 30),
			formatBaseHalfVideoTrimLength(0.3 + 0.7 - 1e-12),
			formatBaseHalfVideoTrimLength(59 / 60),
			formatBaseHalfVideoTrimLength(3.5667),
			formatBaseHalfVideoTrimLength(59.96),
			formatBaseHalfVideoTrimLength(60),
			formatBaseHalfVideoTrimLength(65.4),
			formatBaseHalfVideoTrimLength(-1)
		], ['1.0s', '1.0s', '0.9s', '3.5s', '59.9s', '1:00', '1:05', '0.0s']);
	});

	test('shows a handle\'s time in minutes, seconds, and hundredths, with hours from an hour on: never more than it is (D102)', () => {
		assert.deepStrictEqual([
			formatBaseHalfVideoHandleTime(0),
			formatBaseHalfVideoHandleTime(26.4),
			formatBaseHalfVideoHandleTime(0.3 + 0.7 - 1e-12),
			formatBaseHalfVideoHandleTime(59.999),
			formatBaseHalfVideoHandleTime(65.4),
			formatBaseHalfVideoHandleTime(3723.4),
			formatBaseHalfVideoHandleTime(-1)
		], ['00:00.00', '00:26.40', '00:01.00', '00:59.99', '01:05.40', '1:02:03.40', '00:00.00']);
	});
});
