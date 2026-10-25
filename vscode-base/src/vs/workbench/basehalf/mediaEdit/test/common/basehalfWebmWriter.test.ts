/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { readBaseHalfWebmFile } from '../../common/basehalfWebmReader.js';
import { writeBaseHalfWebmFile } from '../../common/basehalfWebmWriter.js';

/** A packet of Opus whose first byte says that it holds one frame of 20 ms (CELT, full band). */
function opusPacket(index: number): Uint8Array {
	return new Uint8Array([0xF8, index & 0xFF, 7]);
}

suite('BaseHalfWebmWriter', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('writes a WebM that is read back with its frames, their times and keys, the last frame\'s length, the codec delay, and the padding at the end of the sound', async () => {
		// 3 s at 30 frames per second, in milliseconds, with a key frame every 2 s.
		const frames = Array.from({ length: 90 }, (_, index) => {
			const time = Math.round(index * 1000 / 30);
			const next = index === 89 ? 3000 : Math.round((index + 1) * 1000 / 30);
			return { data: new Uint8Array([index, 1, 2, 3]), time, duration: next - time, key: index % 60 === 0 };
		});
		// 3 s of sound after a delay of 312 samples: 151 packets of 20 ms, of which 648 samples are padding.
		const packets = Array.from({ length: 151 }, (_, index) => opusPacket(index));
		const bytes = writeBaseHalfWebmFile({
			tracks: [
				{ kind: 'video', codec: 'vp9', timescale: 1000, frames, width: 320, height: 180 },
				{ kind: 'audio', codec: 'opus', packets, channels: 2, inputSampleRate: 44100, delay: 312, length: 144_000 }
			]
		});
		const file = await readBaseHalfWebmFile({ size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) });
		const video = file.video!;
		const audio = file.audio!;
		const head = audio.description!;
		assert.deepStrictEqual({
			video: [video.format, video.width, video.height, video.samples.length],
			keys: video.samples.flatMap((sample, index) => sample.key ? [index] : []),
			times: [video.samples[1].time, video.samples[45].time, video.samples[89].time],
			lastLength: video.samples[89].duration,
			data: video.samples.every((sample, index) => bytes[sample.offset] === index && sample.size === 4),
			audio: [audio.format, audio.channels, audio.sampleRate, audio.samples.length],
			// The codec delay is taken off the sound's times, and the padding off its end.
			soundTimes: [audio.samples[0].time, audio.samples[1].time],
			soundEnd: audio.end,
			opusHead: [String.fromCharCode(...head.subarray(0, 8)), head[9], head[10] | head[11] << 8, new DataView(head.buffer, head.byteOffset).getUint32(12, true)]
		}, {
			video: ['V_VP9', 320, 180, 90],
			keys: [0, 60],
			times: [33_000, 1_500_000, 2_967_000],
			lastLength: 33_000,
			data: true,
			audio: ['A_OPUS', 2, 48_000, 151],
			soundTimes: [-6_500, 13_500],
			soundEnd: 3_000_000,
			opusHead: ['OpusHead', 2, 312, 44_100]
		});
	});

	test('a picture without sound has one track, and a long picture is cut into clusters a 16-bit time can reach', async () => {
		// 40 s at 10 frames per second with one key frame: clusters of at most 5 s.
		const frames = Array.from({ length: 400 }, (_, index) => ({ data: new Uint8Array([index & 0xFF]), time: index * 100, duration: 100, key: index === 0 }));
		const bytes = writeBaseHalfWebmFile({ tracks: [{ kind: 'video', codec: 'vp9', timescale: 1000, frames, width: 64, height: 64 }] });
		const file = await readBaseHalfWebmFile({ size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) });
		let clusters = 0;
		for (let index = 0; index + 4 <= bytes.length; index++) {
			if (bytes[index] === 0x1F && bytes[index + 1] === 0x43 && bytes[index + 2] === 0xB6 && bytes[index + 3] === 0x75) {
				clusters++;
			}
		}
		assert.deepStrictEqual({
			audio: file.audio,
			frames: file.video!.samples.length,
			last: [file.video!.samples[399].time, file.video!.samples[399].duration],
			clusters
		}, {
			audio: undefined,
			frames: 400,
			last: [39_900_000, 100_000],
			clusters: 8
		});
	});
});
