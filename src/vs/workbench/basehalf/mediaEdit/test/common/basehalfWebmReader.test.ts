/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BaseHalfVideoFileError } from '../../common/basehalfVideoFile.js';
import { baseHalfOpusPacketDuration, readBaseHalfWebmFile } from '../../common/basehalfWebmReader.js';

/** An EBML element: its id's bytes, its size, and its data. */
function element(id: number[], ...parts: Uint8Array[]): Uint8Array {
	const data = concat(...parts);
	const size = data.length < 0x7F ? Uint8Array.of(0x80 | data.length) : Uint8Array.of(0x40 | (data.length >> 8), data.length & 0xFF);
	return concat(Uint8Array.from(id), size, data);
}

/** An element of unknown size, as a recording in progress writes a segment and its clusters. */
function unknownSize(id: number[], ...parts: Uint8Array[]): Uint8Array {
	return concat(Uint8Array.from(id), Uint8Array.of(0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF), ...parts);
}

function uint(value: number): Uint8Array {
	return value < 256 ? Uint8Array.of(value) : Uint8Array.of(value >> 24 & 0xFF, value >> 16 & 0xFF, value >> 8 & 0xFF, value & 0xFF);
}

function float(value: number): Uint8Array {
	const bytes = new Uint8Array(4);
	new DataView(bytes.buffer).setFloat32(0, value);
	return bytes;
}

function text(value: string): Uint8Array {
	return Uint8Array.from(value, character => character.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array {
	const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
	let at = 0;
	for (const part of parts) {
		result.set(part, at);
		at += part.length;
	}
	return result;
}

/** A block's header: its track, its time against its cluster's, and its flags. */
function block(track: number, time: number, flags: number, ...frames: Uint8Array[]): Uint8Array {
	return concat(Uint8Array.of(0x80 | track, time >> 8 & 0xFF, time & 0xFF, flags), ...frames);
}

const SIMPLE_BLOCK = [0xA3];
const KEY = 0x80;
/** Two frames laced the way of Xiph: their count less one, then the size of the first. */
const XIPH_LACING = 0x02;
const OPUS_HEAD = Uint8Array.of(0x4F, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1, 2, 0x38, 0x01, 0x80, 0xBB, 0, 0, 0, 0, 0);
/** A frame of CELT of 20 ms (configuration 31, one frame). */
const OPUS_FRAME = Uint8Array.of(0xFC, 1, 2, 3);
/** The first byte of a frame of VP9 profile 0. */
const VP9_FRAME = Uint8Array.of(0x82, 0x49, 0x83, 0x42);

function recording(): Uint8Array {
	return concat(
		element([0x1A, 0x45, 0xDF, 0xA3], element([0x42, 0x82], text('webm'))),
		unknownSize([0x18, 0x53, 0x80, 0x67],
			element([0x15, 0x49, 0xA9, 0x66], element([0x2A, 0xD7, 0xB1], uint(1_000_000))),
			element([0x16, 0x54, 0xAE, 0x6B],
				element([0xAE], element([0xD7], uint(1)), element([0x83], uint(1)), element([0x86], text('V_VP9')),
					element([0xE0], element([0xB0], uint(320)), element([0xBA], uint(240)))),
				element([0xAE], element([0xD7], uint(2)), element([0x83], uint(2)), element([0x86], text('A_OPUS')),
					element([0x63, 0xA2], OPUS_HEAD), element([0x56, 0xAA], uint(6_500_000)),
					element([0xE1], element([0xB5], float(48000)), element([0x9F], uint(2))))),
			unknownSize([0x1F, 0x43, 0xB6, 0x75],
				element([0xE7], uint(0)),
				element(SIMPLE_BLOCK, block(1, 0, KEY, VP9_FRAME)),
				element(SIMPLE_BLOCK, block(2, 0, KEY | XIPH_LACING, Uint8Array.of(1, OPUS_FRAME.length), OPUS_FRAME, OPUS_FRAME)),
				element(SIMPLE_BLOCK, block(1, 33, 0, VP9_FRAME))),
			unknownSize([0x1F, 0x43, 0xB6, 0x75],
				element([0xE7], uint(1000)),
				// A frame in a group with a reference is not a key frame.
				element([0xA0], element([0xA1], block(1, 0, 0, VP9_FRAME)), element([0xFB], uint(33))),
				element(SIMPLE_BLOCK, block(2, 0, KEY, OPUS_FRAME))))
	);
}

suite('BaseHalfWebmReader', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('reads the blocks of clusters of unknown size, laced frames, groups, and the codec delay of the sound', async () => {
		const bytes = recording();
		const file = await readBaseHalfWebmFile({ size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) });
		const video = file.video!;
		const audio = file.audio!;
		assert.deepStrictEqual({
			video: [video.format, video.codec, video.timescale, video.width, video.height],
			videoTimes: video.samples.map(sample => [sample.time, sample.key, sample.size]),
			videoData: Array.from(bytes.subarray(video.samples[0].offset, video.samples[0].offset + video.samples[0].size)),
			audio: [audio.format, audio.codec, audio.sampleRate, audio.channels, Array.from(audio.description ?? [])],
			// The codec delay of 6.5 ms comes before the sound: the two laced frames follow each other by their length.
			audioTimes: audio.samples.map(sample => [sample.time, sample.size]),
			metadata: file.metadata
		}, {
			video: ['V_VP9', 'vp09.00.10.08', 1_000_000, 320, 240],
			videoTimes: [[0, true, 4], [33000, false, 4], [1_000_000, false, 4]],
			videoData: Array.from(VP9_FRAME),
			audio: ['A_OPUS', 'opus', 48000, 2, Array.from(OPUS_HEAD)],
			audioTimes: [[-6500, 4], [13500, 4], [993500, 4]],
			metadata: []
		});
	});

	test('refuses a file that is no WebM, and says how long a packet of Opus is', async () => {
		const notWebm = Uint8Array.of(0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70);
		let reason: string | undefined;
		try {
			await readBaseHalfWebmFile({ size: notWebm.length, read: async (offset, length) => notWebm.subarray(offset, offset + length) });
		} catch (error) {
			reason = error instanceof BaseHalfVideoFileError ? error.reason : 'other';
		}
		assert.deepStrictEqual([
			reason,
			// CELT of 20 ms, one frame; SILK of 60 ms, two frames; CELT of 20 ms, three frames by the count after it.
			baseHalfOpusPacketDuration(Uint8Array.of(0xFC)),
			baseHalfOpusPacketDuration(Uint8Array.of(0x1A)),
			baseHalfOpusPacketDuration(Uint8Array.of(0xFF, 0x03))
		], ['format', 20000, 60000 * 2, 20000 * 3]);
	});
});
