/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { readBaseHalfIsoBmffFile } from '../../common/basehalfIsoBmffReader.js';
import { writeBaseHalfMp4Copy } from '../../common/basehalfIsoBmffWriter.js';
import { planBaseHalfMp4Copy } from '../../common/basehalfVideoCopy.js';
import { baseHalfTestByteSource, baseHalfTestFrameShade, makeBaseHalfTestVideo } from './basehalfVideoTrimFixtures.js';

suite('BaseHalfVideoCopyPlayer', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('the window\'s player shows a trim\'s copy from the frame at its start, for its length, though the copy holds the frames from the key frame before it (D99)', async function () {
		this.timeout(30_000);
		// Two seconds at 30 frames a second with one key frame, as a generated video has.
		const original = await makeBaseHalfTestVideo({ frames: 60, fps: 30, sound: true });
		if (!original) {
			this.skip();
		}
		const file = await readBaseHalfIsoBmffFile(baseHalfTestByteSource(original), 'mp4');
		const layout = writeBaseHalfMp4Copy(planBaseHalfMp4Copy(file, { start: 0.5, end: 1.5 }));
		const copy = new Uint8Array(layout.size);
		copy.set(layout.head, 0);
		let at = layout.head.length;
		for (const range of layout.ranges) {
			copy.set(original.subarray(range.offset, range.offset + range.length), at);
			at += range.length;
		}
		const url = URL.createObjectURL(new Blob([copy], { type: 'video/mp4' }));
		const video = document.createElement('video');
		try {
			video.muted = true;
			video.src = url;
			await new Promise<void>((resolve, reject) => {
				video.addEventListener('loadeddata', () => resolve(), { once: true });
				video.addEventListener('error', () => reject(new Error(`the player could not read the copy: ${video.error?.message}`)), { once: true });
			});
			const canvas = new OffscreenCanvas(8, 8);
			const context = canvas.getContext('2d', { willReadFrequently: true })!;
			/** How far the gray of the frame the player shows at a time is from the gray of a frame of the original. */
			const offFrom = async (time: number, frame: number) => {
				await new Promise<void>(resolve => {
					video.addEventListener('seeked', () => resolve(), { once: true });
					video.currentTime = time;
				});
				context.drawImage(video, 0, 0, 8, 8);
				return Math.abs(context.getImageData(4, 4, 1, 1).data[0] - baseHalfTestFrameShade(frame));
			};
			const off = [await offFrom(0, 15), await offFrom(0.5, 30), await offFrom(0.98, 44)];
			assert.deepStrictEqual({
				// The frames of the original from its key frame at 0 are in the copy: 45 of them, 15 hidden.
				held: layout.ranges.length > 0 && copy.length < original.length,
				duration: Math.round(video.duration * 100) / 100,
				// Frames next to each other differ by 7 in gray: within 3 is the frame itself.
				frames: off.map(difference => difference <= 3)
			}, {
				held: true,
				duration: 1,
				frames: [true, true, true]
			});
		} finally {
			video.removeAttribute('src');
			video.load();
			URL.revokeObjectURL(url);
		}
	});
});
