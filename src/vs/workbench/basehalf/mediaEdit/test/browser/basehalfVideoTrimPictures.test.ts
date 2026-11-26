/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IBaseHalfVideoSample, IBaseHalfVideoTrack } from '../../common/basehalfVideoFile.js';
import { IBaseHalfVideoPictureRun, planBaseHalfVideoPictures } from '../../browser/basehalfVideoTrimPictures.js';

/** A video of `seconds` at 10 frames a second, its frames shown in decode order, with a key frame every `keyEvery` frames. */
function track(seconds: number, keyEvery: number): IBaseHalfVideoTrack {
	const samples: IBaseHalfVideoSample[] = Array.from({ length: seconds * 10 }, (_, index) => ({ offset: index * 10, size: 10, decodeTime: index * 100, time: index * 100, duration: 100, key: index % keyEvery === 0 }));
	return {
		kind: 'video', format: 'avc1', codec: undefined, description: undefined, timescale: 1000, samples,
		width: 640, height: 360, displayWidth: 640, displayHeight: 360, matrix: undefined
	} as unknown as IBaseHalfVideoTrack;
}

/** A run as the decoder sees it: the samples it decodes, and the pictures each shown time gives, in seconds. */
function described(run: IBaseHalfVideoPictureRun) {
	const samples = run.samples.length > 3 ? `${run.samples[0]}..${run.samples[run.samples.length - 1]}` : run.samples.join(',');
	return { samples, targets: [...run.targets].map(([timestamp, pictures]) => `${timestamp / 1_000_000}s:${pictures.join('+')}`) };
}

suite('BaseHalfVideoTrimPictures', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('a picture with a key frame within its tolerance is that key frame, read alone in one run with the others; any other is its exact frame (D101)', () => {
		// A key frame every 5 s; the second picture has none within half a second.
		const runs = planBaseHalfVideoPictures(track(30, 50), [4.6, 12, 20.4], 0.5);
		assert.deepStrictEqual(runs.map(described), [
			{ samples: '50,200', targets: ['5s:0', '20s:2'] },
			{ samples: '100..120', targets: ['12s:1'] }
		]);
	});

	test('with no tolerance every picture is its exact frame, decoded from the key frame before it, once for all the pictures it holds', () => {
		const runs = planBaseHalfVideoPictures(track(30, 50), [4.6, 4.9, 12], 0);
		assert.deepStrictEqual(runs.map(described), [
			{ samples: '0..49', targets: ['4.6s:0', '4.9s:1'] },
			{ samples: '100..120', targets: ['12s:2'] }
		]);
	});

	test('a video with one key frame reads it for the pictures near its start, and decodes the rest once', () => {
		// Two pictures of a 5 s generated clip, each half a place, 1.25 s, from a key frame or not.
		const runs = planBaseHalfVideoPictures(track(5, 1000), [1.25, 3.75], 1.25);
		assert.deepStrictEqual(runs.map(described), [
			{ samples: '0', targets: ['0s:0'] },
			{ samples: '0..37', targets: ['3.7s:1'] }
		]);
	});
});
