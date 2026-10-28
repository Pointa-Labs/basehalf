/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { encodeBaseHalfVideoClip, encodeBaseHalfWebmCopy } from '../../browser/basehalfVideoClipEncoder.js';
import { readBaseHalfIsoBmffFile } from '../../common/basehalfIsoBmffReader.js';
import { BaseHalfByteWriter } from '../../common/basehalfVideoBytes.js';
import { planBaseHalfVideoClip } from '../../common/basehalfVideoClipPlan.js';
import { planBaseHalfWebmCopy } from '../../common/basehalfVideoCopy.js';
import { IBaseHalfVideoSample } from '../../common/basehalfVideoFile.js';
import { readBaseHalfWebmFile } from '../../common/basehalfWebmReader.js';
import { baseHalfTestByteSource, baseHalfTestClickTime, baseHalfTestFrameShade, baseHalfTestShades, makeBaseHalfTestClickVideo, makeBaseHalfTestVideo, makeBaseHalfTestWebm } from './basehalfVideoTrimFixtures.js';

/** The frame of the test video whose gray is nearest to a gray. */
function frameOfShade(shade: number, frames: number): number {
	let best = 0;
	for (let index = 1; index < frames; index++) {
		if (Math.abs(baseHalfTestFrameShade(index) - shade) < Math.abs(baseHalfTestFrameShade(best) - shade)) {
			best = index;
		}
	}
	return best;
}

suite('BaseHalfVideoClipEncoder', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('a clip holds the frames shown from its start to its end, sound as long as its picture, and the file\'s information', async function () {
		this.timeout(30_000);
		const udta = new BaseHalfByteWriter().box('udta', box => box.box('meta', meta => meta.u32(0).fourcc('AIGC'))).result();
		const bytes = await makeBaseHalfTestVideo({ frames: 60, fps: 30, sound: true, metadata: [udta] });
		if (!bytes) {
			// This window has no H.264 or AAC encoder.
			this.skip();
		}
		const source = baseHalfTestByteSource(bytes);
		const file = await readBaseHalfIsoBmffFile(source, 'mp4');
		const plan = planBaseHalfVideoClip(file, 'mp4', { start: 0.5, end: 1.5 });
		const encoding = await encodeBaseHalfVideoClip({ source, file, plan });
		const clip = await readBaseHalfIsoBmffFile(baseHalfTestByteSource(encoding.bytes), 'mp4');
		const video = clip.video!;
		const audio = clip.audio!;
		const shades = await baseHalfTestShades(video.codec!, video.description, video.samples.map(sample => ({
			data: encoding.bytes.subarray(sample.offset, sample.offset + sample.size),
			time: Math.round(sample.time * 1_000_000 / video.timescale),
			key: sample.key
		})));
		assert.deepStrictEqual({
			frames: video.samples.length,
			firstIsKey: video.samples[0].key,
			// Frame 15 of the video is shown at 0.5 s: it is the clip's first, and frame 44 its last.
			shownFrames: [frameOfShade(shades[0], 60), frameOfShade(shades[shades.length - 1], 60)],
			pictureLength: (video.samples[video.samples.length - 1].time + video.samples[video.samples.length - 1].duration) / video.timescale,
			soundLength: Math.round(audio.end! / audio.timescale * 1000) / 1000,
			// The edit list hides the encoder's delay: the sound's first sample is shown before 0.
			soundStartsBeforeZero: audio.samples[0].time < 0,
			metadata: clip.metadata.map(box => Array.from(box)),
			soundDropped: encoding.soundDropped,
			codec: encoding.codec
		}, {
			frames: 30,
			firstIsKey: true,
			shownFrames: [15, 44],
			pictureLength: 1,
			soundLength: 1,
			soundStartsBeforeZero: true,
			metadata: [Array.from(udta)],
			soundDropped: false,
			codec: 'avc'
		});
	});

	test('a WebM is trimmed to a WebM in VP9 and Opus, with the frames shown from its start to its end and sound as long as its picture', async function () {
		this.timeout(60_000);
		const bytes = await makeBaseHalfTestWebm({ frames: 60, fps: 30 });
		if (!bytes) {
			// This window has no VP9 or Opus encoder.
			this.skip();
		}
		const source = baseHalfTestByteSource(bytes);
		const file = await readBaseHalfWebmFile(source);
		const plan = planBaseHalfVideoClip(file, 'webm', { start: 0.5, end: 1.5 });
		const encoding = await encodeBaseHalfVideoClip({ source, file, plan });
		const clip = await readBaseHalfWebmFile(baseHalfTestByteSource(encoding.bytes));
		const video = clip.video!;
		const audio = clip.audio!;
		const shades = await baseHalfTestShades(video.codec!, video.description, video.samples.map(sample => ({
			data: encoding.bytes.subarray(sample.offset, sample.offset + sample.size),
			time: sample.time,
			key: sample.key
		})));
		const lastFrame = video.samples[video.samples.length - 1];
		const lastPacket = audio.samples[audio.samples.length - 1];
		assert.deepStrictEqual({
			formats: [video.format, audio.format],
			frames: video.samples.length,
			firstIsKey: video.samples[0].key,
			// Frame 15 of the recording is shown at 0.5 s: it is the first of the trimmed video, and frame 44 its last.
			shownFrames: [frameOfShade(shades[0], 60), frameOfShade(shades[shades.length - 1], 60)],
			pictureLength: (lastFrame.time + lastFrame.duration) / 1_000_000,
			// The codec delay and the padding of the last packet are taken off: the sound starts at 0 and ends with the picture.
			soundStart: audio.samples[0].time <= 0,
			soundLength: Math.round((audio.end ?? lastPacket.time + lastPacket.duration) / 1000) / 1000,
			soundDropped: encoding.soundDropped,
			codec: encoding.codec
		}, {
			formats: ['V_VP9', 'A_OPUS'],
			frames: 30,
			firstIsKey: true,
			shownFrames: [15, 44],
			pictureLength: 1,
			soundStart: true,
			soundLength: 1,
			soundDropped: false,
			codec: 'vp9'
		});
	});

	test('a WebM is trimmed by copying its frames from the first key frame after the start and its Opus packets, and encoding only the frames before that key frame, in its own codec (D99)', async function () {
		this.timeout(60_000);
		const results: Record<string, unknown> = {};
		for (const codec of ['vp9', 'vp8'] as const) {
			// Two seconds with a key frame each second, as a recording has them.
			const bytes = await makeBaseHalfTestWebm({ frames: 60, fps: 30, keyEvery: 30, codec });
			if (!bytes) {
				this.skip();
			}
			const source = baseHalfTestByteSource(bytes);
			const file = await readBaseHalfWebmFile(source);
			const encoding = await encodeBaseHalfWebmCopy({ source, file, plan: planBaseHalfWebmCopy(file, { start: 0.5, end: 1.5 }) });
			const clip = await readBaseHalfWebmFile(baseHalfTestByteSource(encoding.bytes));
			const video = clip.video!;
			const audio = clip.audio!;
			const dataOf = (from: Uint8Array, sample: IBaseHalfVideoSample) => VSBuffer.wrap(from.subarray(sample.offset, sample.offset + sample.size));
			const isOriginal = (sample: IBaseHalfVideoSample, samples: readonly IBaseHalfVideoSample[]) => samples.some(original => dataOf(bytes, original).equals(dataOf(encoding.bytes, sample)));
			const shades = await baseHalfTestShades(video.codec!, video.description, video.samples.map(sample => ({ data: dataOf(encoding.bytes, sample).buffer, time: sample.time, key: sample.key })));
			const lastFrame = video.samples[video.samples.length - 1];
			// The packet that held 0.5 s of the original is shown 0.5 s earlier in the clip, as its first.
			const firstShown = audio.samples.find(sample => sample.time + sample.duration > 0)!;
			const held = file.audio!.samples.find(sample => sample.time <= 500_000 && sample.time + sample.duration > 500_000)!;
			results[codec] = {
				format: video.format,
				frames: video.samples.length,
				// From the original's key frame 30 on, each frame is the original's, byte for byte.
				copied: video.samples.slice(15).every((sample, index) => dataOf(encoding.bytes, sample).equals(dataOf(bytes, file.video!.samples[30 + index]))),
				keys: video.samples.flatMap((sample, index) => sample.key ? [index] : []),
				shownFrames: [frameOfShade(shades[0], 60), frameOfShade(shades[15], 60), frameOfShade(shades[shades.length - 1], 60)],
				pictureLength: (lastFrame.time + lastFrame.duration) / 1_000_000,
				packets: audio.samples.every(sample => isOriginal(sample, file.audio!.samples)),
				soundStart: [dataOf(encoding.bytes, firstShown).equals(dataOf(bytes, held)), Math.abs(firstShown.time - (held.time - 500_000)) <= 1000],
				soundLength: Math.round((audio.end ?? 0) / 1000) / 1000,
				soundDropped: encoding.soundDropped
			};
		}
		const expected = (format: string) => ({
			format,
			frames: 30,
			copied: true,
			keys: [0, 15],
			shownFrames: [15, 30, 44],
			pictureLength: 1,
			packets: true,
			soundStart: [true, true],
			soundLength: 1,
			soundDropped: false
		});
		assert.deepStrictEqual(results, { vp9: expected('V_VP9'), vp8: expected('V_VP8') });
	});

	test('a trimmed video\'s sound plays with its picture: a click at a white frame stays at it, in an MP4 and in a WebM', async function () {
		this.timeout(60_000);
		const found: Record<string, { click: number; whiteFrame: number }> = {};
		for (const container of ['mp4', 'webm'] as const) {
			const bytes = await makeBaseHalfTestClickVideo(container);
			if (!bytes) {
				this.skip();
			}
			const source = baseHalfTestByteSource(bytes);
			const file = container === 'webm' ? await readBaseHalfWebmFile(source) : await readBaseHalfIsoBmffFile(source, 'mp4');
			const encoding = await encodeBaseHalfVideoClip({ source, file, plan: planBaseHalfVideoClip(file, container, { start: 1, end: 2.5 }) });
			const trimmed = baseHalfTestByteSource(encoding.bytes);
			const video = (container === 'webm' ? await readBaseHalfWebmFile(trimmed) : await readBaseHalfIsoBmffFile(trimmed, 'mp4')).video!;
			const shades = await baseHalfTestShades(video.codec!, video.description, video.samples.map(sample => ({
				data: encoding.bytes.subarray(sample.offset, sample.offset + sample.size),
				time: Math.round(sample.time * 1_000_000 / video.timescale),
				key: sample.key
			})));
			found[container] = { click: await baseHalfTestClickTime(encoding.bytes), whiteFrame: shades.findIndex(shade => shade > 200) };
		}
		// The white frame was frame 45 of the video, at 1.5 s: frame 15 of the trimmed video, at 0.5 s, with the click.
		assert.deepStrictEqual(found, { mp4: { click: 0.5, whiteFrame: 15 }, webm: { click: 0.5, whiteFrame: 15 } });
	});

	test('a video without sound gives a clip without sound', async function () {
		this.timeout(30_000);
		const bytes = await makeBaseHalfTestVideo({ frames: 45, fps: 30, sound: false });
		if (!bytes) {
			this.skip();
		}
		const source = baseHalfTestByteSource(bytes);
		const file = await readBaseHalfIsoBmffFile(source, 'mp4');
		const encoding = await encodeBaseHalfVideoClip({ source, file, plan: planBaseHalfVideoClip(file, 'mp4', { start: 0, end: 1 }) });
		const clip = await readBaseHalfIsoBmffFile(baseHalfTestByteSource(encoding.bytes), 'mp4');
		assert.deepStrictEqual([clip.video!.samples.length, clip.audio, encoding.soundDropped], [30, undefined, false]);
	});
});
