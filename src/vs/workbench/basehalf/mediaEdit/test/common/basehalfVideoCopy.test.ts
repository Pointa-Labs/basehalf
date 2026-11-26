/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { readBaseHalfIsoBmffFile } from '../../common/basehalfIsoBmffReader.js';
import { IBaseHalfMp4CopyLayout, IBaseHalfMp4SampleInput, writeBaseHalfMp4Copy, writeBaseHalfMp4File } from '../../common/basehalfIsoBmffWriter.js';
import { BaseHalfByteWriter } from '../../common/basehalfVideoBytes.js';
import { planBaseHalfMp4Copy } from '../../common/basehalfVideoCopy.js';
import { IBaseHalfVideoByteSource, IBaseHalfVideoFile, IBaseHalfVideoSample, IBaseHalfVideoTrack } from '../../common/basehalfVideoFile.js';

/** An `avcC` of H.264 High at level 3.1. */
const AVCC = Uint8Array.of(1, 0x64, 0x00, 0x1F, 0xFF, 0xE1, 0, 4, 0x67, 0x64, 0x00, 0x1F, 1, 0, 2, 0x68, 0xEE);
/** The AudioSpecificConfig of AAC-LC at 44.1 kHz in stereo. */
const AAC_CONFIG = Uint8Array.of(0x12, 0x10);

function sourceOf(bytes: Uint8Array): IBaseHalfVideoByteSource {
	return { size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) };
}

/** A sample's bytes that say which sample it is: no two samples of a test have the same. */
function data(kind: number, index: number): Uint8Array {
	return Uint8Array.of(kind, index >> 8, index & 0xFF, 7, 7, 7);
}

/** Frames decoded in order, `shown` giving the frame each is shown as, two frames after it is decoded. */
function frames(shown: readonly number[], duration: number, key: (frame: number) => boolean): IBaseHalfMp4SampleInput[] {
	return shown.map((frame, index) => ({ data: data(1, frame), decodeTime: index * duration, time: (frame + 2) * duration, duration, key: key(frame) }));
}

function packets(count: number): IBaseHalfMp4SampleInput[] {
	return Array.from({ length: count }, (_, index) => ({ data: data(2, index), decodeTime: index * 1024, time: index * 1024, duration: 1024, key: true }));
}

/** The bytes of a copy as the shared process puts them together: its head, then its ranges of the original. */
function assemble(original: Uint8Array, layout: IBaseHalfMp4CopyLayout): Uint8Array {
	const bytes = new Uint8Array(layout.size);
	bytes.set(layout.head, 0);
	let at = layout.head.length;
	for (const range of layout.ranges) {
		bytes.set(original.subarray(range.offset, range.offset + range.length), at);
		at += range.length;
	}
	return bytes;
}

function dataOf(bytes: Uint8Array, sample: IBaseHalfVideoSample): number[] {
	return Array.from(bytes.subarray(sample.offset, sample.offset + sample.size));
}

/** The samples a track shows, after its edit list, in the order they are shown. */
function shownSamples(track: IBaseHalfVideoTrack): IBaseHalfVideoSample[] {
	return track.samples.filter(sample => sample.time + sample.duration > 0 && (track.end === undefined || sample.time < track.end)).sort((a, b) => a.time - b.time);
}

suite('BaseHalfVideoCopy', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('copies the frames from the key frame before the start and the packets around the part, byte for byte, and its edit lists show the part (D99)', async () => {
		// 4 s at 30 frames a second in units of 15360, a key frame each second; AAC at 44.1 kHz behind its encoder's delay.
		const udta = new BaseHalfByteWriter().box('udta', box => box.box('meta', meta => meta.u32(0).fourcc('AIGC'))).result();
		const original = writeBaseHalfMp4File({
			format: 'mp4',
			tracks: [
				{ kind: 'video', codec: 'avc', description: AVCC, timescale: 15360, samples: frames(Array.from({ length: 120 }, (_, frame) => frame), 512, frame => frame % 30 === 0), width: 854, height: 480, displayWidth: 854, displayHeight: 480, matrix: undefined },
				{ kind: 'audio', codec: 'aac', description: AAC_CONFIG, timescale: 44100, samples: packets(175), channels: 2, bitrate: 128000, delay: 2112, length: 4 * 44100 }
			],
			metadata: [udta]
		});
		const file = await readBaseHalfIsoBmffFile(sourceOf(original), 'mp4');
		const layout = writeBaseHalfMp4Copy(planBaseHalfMp4Copy(file, { start: 1.5, end: 2.5 }));
		const bytes = assemble(original, layout);
		const copy = await readBaseHalfIsoBmffFile(sourceOf(bytes), 'mp4');
		const video = copy.video!;
		const audio = copy.audio!;
		const shownFrames = shownSamples(video);
		const shownPackets = shownSamples(audio);
		const originalData = new Set([...file.video!.samples, ...file.audio!.samples].map(sample => dataOf(original, sample).join()));
		assert.deepStrictEqual({
			size: bytes.length,
			// Each sample of the copy is one of the original's, as it was.
			everySampleTheOriginals: [...video.samples, ...audio.samples].every(sample => originalData.has(dataOf(bytes, sample).join())),
			// From the key frame at 1 s: half a second of frames before the start is held, hidden.
			frames: [video.samples.length, video.samples.filter(sample => sample.time < 0).length, shownFrames.length],
			firstShown: [shownFrames[0].time, dataOf(bytes, shownFrames[0])],
			lastShown: dataOf(bytes, shownFrames.at(-1)!),
			pictureEnd: video.end,
			// The packet that holds 1.5 s, and the two before it that its decoder needs, then to one after the one at 2.5 s.
			packets: [audio.samples.length, shownPackets.length],
			soundFrom: [Math.round(shownPackets[0].time), dataOf(bytes, shownPackets[0])],
			soundEnd: audio.end,
			metadata: copy.metadata.map(box => Array.from(box)),
			fileType: Array.from(copy.fileType!) + '' === Array.from(file.fileType!) + '',
			codecs: [video.codec, audio.codec],
			// The original's interleaving stays, and neighbouring samples are copied as one range: the packets of sound
			// before 1.49 s and the frames from 2.5 s on, which the copy does not hold, part three ranges.
			ranges: layout.ranges.length
		}, {
			size: layout.size,
			everySampleTheOriginals: true,
			frames: [45, 15, 30],
			firstShown: [0, Array.from(data(1, 45))],
			lastShown: Array.from(data(1, 74)),
			pictureEnd: 30 * 512,
			packets: [47, 44],
			// Packet 66 holds 1.5 s of the original's sound: 66 × 1024 − 2112 = 65472, 678 units before 66150.
			soundFrom: [-678, Array.from(data(2, 66))],
			soundEnd: 44100,
			metadata: [Array.from(udta)],
			fileType: true,
			codecs: ['avc1.64001f', 'mp4a.40.2'],
			ranges: 3
		});
	});

	test('keeps the frames decoded after the end that frames shown before it need, hidden, as frames shown out of order do (D99)', async () => {
		// One key frame, as a generated video has; each P frame decoded before the two B frames shown before it.
		const order = [0, 3, 1, 2, 6, 4, 5, 9, 7, 8, 12, 10, 11, 14, 13];
		const original = writeBaseHalfMp4File({
			format: 'mp4',
			tracks: [{ kind: 'video', codec: 'avc', description: AVCC, timescale: 15360, samples: frames(order, 512, frame => frame === 0), width: 640, height: 360, displayWidth: 640, displayHeight: 360, matrix: undefined }],
			metadata: []
		});
		const file = await readBaseHalfIsoBmffFile(sourceOf(original), 'mp4');
		const bytes = assemble(original, writeBaseHalfMp4Copy(planBaseHalfMp4Copy(file, { start: 4 / 30, end: 8 / 30 })));
		const video = (await readBaseHalfIsoBmffFile(sourceOf(bytes), 'mp4')).video!;
		assert.deepStrictEqual({
			decoded: video.samples.map(sample => dataOf(bytes, sample)[2]),
			shown: shownSamples(video).map(sample => [sample.time, dataOf(bytes, sample)[2]]),
			end: video.end
		}, {
			// Frame 9 is decoded before frame 7, which needs it.
			decoded: [0, 3, 1, 2, 6, 4, 5, 9, 7],
			shown: [[0, 4], [512, 5], [1024, 6], [1536, 7]],
			end: 4 * 512
		});
	});

	test('a sound that starts after the part does keeps its delay, and a sound alone is copied as a part of itself (D99)', async () => {
		const original = writeBaseHalfMp4File({
			format: 'mp4',
			tracks: [
				{ kind: 'video', codec: 'avc', description: AVCC, timescale: 15360, samples: frames(Array.from({ length: 60 }, (_, frame) => frame), 512, frame => frame % 30 === 0), width: 640, height: 360, displayWidth: 640, displayHeight: 360, matrix: undefined },
				{ kind: 'audio', codec: 'aac', description: AAC_CONFIG, timescale: 44100, samples: packets(90), channels: 2, bitrate: 128000, delay: 0, length: 2 * 44100 }
			],
			metadata: []
		});
		const file = await readBaseHalfIsoBmffFile(sourceOf(original), 'mp4');
		// The sound starts half a second into the video.
		const later: IBaseHalfVideoFile = { ...file, audio: { ...file.audio!, samples: file.audio!.samples.map(sample => ({ ...sample, time: sample.time + 22050 })), end: file.audio!.end! + 22050 } };
		const delayedBytes = assemble(original, writeBaseHalfMp4Copy(planBaseHalfMp4Copy(later, { start: 0.2, end: 1.2 })));
		const delayed = (await readBaseHalfIsoBmffFile(sourceOf(delayedBytes), 'mp4')).audio!;

		const sound = writeBaseHalfMp4File({
			format: 'mp4',
			tracks: [{ kind: 'audio', codec: 'aac', description: AAC_CONFIG, timescale: 44100, samples: packets(90), channels: 2, bitrate: 128000, delay: 2112, length: 2 * 44100 }],
			metadata: []
		});
		const soundFile = await readBaseHalfIsoBmffFile(sourceOf(sound), 'mp4', { soundOnly: true });
		const soundBytes = assemble(sound, writeBaseHalfMp4Copy(planBaseHalfMp4Copy(soundFile, { start: 0.5, end: 1.25 })));
		const alone = await readBaseHalfIsoBmffFile(sourceOf(soundBytes), 'mp4', { soundOnly: true });
		assert.deepStrictEqual({
			// The packet at the original's 0.5 s, the sound's start, is shown 0.3 s into the part.
			delayed: [shownSamples(delayed)[0].time, dataOf(delayedBytes, shownSamples(delayed)[0])[2], delayed.end],
			alone: [alone.video, Math.round(shownSamples(alone.audio!)[0].time), alone.audio!.end]
		}, {
			delayed: [0.3 * 44100, 0, 1.0 * 44100],
			// 0.5 s is in packet 23 of the sound behind 2112 units of delay: 23 × 1024 − 2112 = 21440, 610 units before 22050.
			alone: [undefined, -610, Math.round(0.75 * 44100)]
		});
	});

	test('a copy past 4 GiB takes 64-bit chunk offsets and a 64-bit size of its data, and copies only the ranges its samples hold (D99)', async () => {
		const original = writeBaseHalfMp4File({
			format: 'mp4',
			tracks: [{ kind: 'video', codec: 'avc', description: AVCC, timescale: 1000, samples: frames([0, 1, 2], 1000, () => true), width: 640, height: 360, displayWidth: 640, displayHeight: 360, matrix: undefined }],
			metadata: []
		});
		const file = await readBaseHalfIsoBmffFile(sourceOf(original), 'mp4');
		// Three frames of 2 GB each with gaps between them, as an index can say without the bytes being here.
		const huge: IBaseHalfVideoFile = { ...file, video: { ...file.video!, samples: file.video!.samples.map((sample, index) => ({ ...sample, offset: index * 2_500_000_000, size: 2_000_000_000 })) } };
		const layout = writeBaseHalfMp4Copy(planBaseHalfMp4Copy(huge, { start: 0, end: 3 }));
		const view = new DataView(layout.head.buffer);
		const header = layout.head.length - 16;
		const copy = await readBaseHalfIsoBmffFile({ size: layout.size, read: async (offset, length) => offset < layout.head.length ? layout.head.subarray(offset, offset + length) : new Uint8Array(length) }, 'mp4');
		assert.deepStrictEqual({
			ranges: layout.ranges,
			size: layout.size - layout.head.length,
			mdat: [view.getUint32(header), String.fromCharCode(...layout.head.subarray(header + 4, header + 8)), view.getUint32(header + 8) * 0x1_0000_0000 + view.getUint32(header + 12)],
			offsets: copy.video!.samples.map(sample => sample.offset - layout.head.length)
		}, {
			ranges: [{ offset: 0, length: 2_000_000_000 }, { offset: 2_500_000_000, length: 2_000_000_000 }, { offset: 5_000_000_000, length: 2_000_000_000 }],
			size: 6_000_000_000,
			mdat: [1, 'mdat', 16 + 6_000_000_000],
			offsets: [0, 2_000_000_000, 4_000_000_000]
		});
	});
});
