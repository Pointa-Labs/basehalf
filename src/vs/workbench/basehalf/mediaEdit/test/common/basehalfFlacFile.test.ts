/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { decodeBase64 } from '../../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { decodeBaseHalfFlac, encodeBaseHalfFlac, readBaseHalfFlacInfo } from '../../common/basehalfFlacFile.js';

/**
 * 4700 samples at 8 kHz of two sines, as another encoder wrote them, with
 * subframes of linear prediction: what BaseHalf's decoder reads in the FLAC
 * files people have.
 */
const OTHER_ENCODER = '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';

const expected = (index: number) => Math.round((0.4 * Math.sin(2 * Math.PI * 440 * index / 8000) + 0.1 * Math.sin(2 * Math.PI * 1234 * index / 8000)) * 32767);

suite('BaseHalfFlacFile', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('decodes the FLAC of another encoder exactly, its linear prediction among it (D84)', () => {
		const decoded = decodeBaseHalfFlac(decodeBase64(OTHER_ENCODER).buffer)!;
		const differences = Array.from(decoded.channels[0]).filter((sample, index) => sample !== expected(index)).length;
		assert.deepStrictEqual([decoded.sampleRate, decoded.bitsPerSample, decoded.channels.length, decoded.channels[0].length, differences], [8000, 16, 1, 4700, 0]);
	});

	test('encodes without loss: stereo in each of its pairings, mono, 24 bits, a short last frame, and silence (D84)', () => {
		const length = 4096 * 2 + 777;
		const wave = (scale: number, phase: number) => Int32Array.from({ length }, (_, index) => Math.round(Math.sin(index / 9 + phase) * scale + ((index * 7919) % 401) - 200));
		const cases: { channels: Int32Array[]; bits: number }[] = [
			{ channels: [wave(20000, 0), wave(20000, 0)], bits: 16 },
			{ channels: [wave(20000, 0), wave(9000, 1)], bits: 16 },
			{ channels: [wave(30000, 0)], bits: 16 },
			{ channels: [wave(8_000_000, 0), wave(7_000_000, 2)], bits: 24 },
			{ channels: [new Int32Array(length), Int32Array.from({ length }, () => -32768)], bits: 16 }
		];
		const comment = Uint8Array.from('\x08\x00\x00\x00BaseHalf\x00\x00\x00\x00', character => character.charCodeAt(0));
		for (const { channels, bits } of cases) {
			const flac = encodeBaseHalfFlac(channels, 48000, bits, [{ type: 4, body: comment }]);
			const decoded = decodeBaseHalfFlac(flac)!;
			const info = readBaseHalfFlacInfo(flac)!;
			assert.deepStrictEqual({
				info: [info.sampleRate, info.channels, info.bitsPerSample, info.totalSamples, info.blocks.length],
				same: decoded.channels.every((channel, index) => channel.length === length && channel.every((sample, at) => sample === channels[index][at]))
			}, { info: [48000, channels.length, bits, length, 1], same: true }, JSON.stringify({ channels: channels.length, bits }));
		}
	});
});
