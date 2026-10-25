/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BaseHalfSoundTimeline, baseHalfDeleteParts, baseHalfOriginalTime, baseHalfPartEdges, baseHalfPartsAreWhole, baseHalfPartsLength, baseHalfTrimParts } from '../../common/basehalfSoundParts.js';
import { readBaseHalfWavFile, writeBaseHalfWavParts } from '../../common/basehalfWavFile.js';

/** A WAV of 16-bit stereo samples, the left channel counting up and the right down, with a list of its information and a cue point. */
function wav(frames: number, rate: number): Uint8Array {
	const chunk = (id: string, body: Uint8Array) => {
		const out = new Uint8Array(8 + body.length + (body.length % 2));
		out.set(Array.from(id, character => character.charCodeAt(0)));
		new DataView(out.buffer).setUint32(4, body.length, true);
		out.set(body, 8);
		return out;
	};
	const format = new Uint8Array(16);
	const formatView = new DataView(format.buffer);
	formatView.setUint16(0, 1, true);
	formatView.setUint16(2, 2, true);
	formatView.setUint32(4, rate, true);
	formatView.setUint32(8, rate * 4, true);
	formatView.setUint16(12, 4, true);
	formatView.setUint16(14, 16, true);
	const samples = new Uint8Array(frames * 4);
	const view = new DataView(samples.buffer);
	for (let index = 0; index < frames; index++) {
		view.setInt16(index * 4, 1000 + index, true);
		view.setInt16(index * 4 + 2, -1000 - index, true);
	}
	const parts = [chunk('fmt ', format), chunk('LIST', Uint8Array.from('INFOINAM\x05\x00\x00\x00Take\x00\x00', character => character.charCodeAt(0))), chunk('cue ', new Uint8Array(4)), chunk('data', samples)];
	const body = parts.reduce((sum, part) => sum + part.length, 0);
	const out = new Uint8Array(12 + body);
	out.set(Array.from('RIFF', character => character.charCodeAt(0)));
	new DataView(out.buffer).setUint32(4, body + 4, true);
	out.set(Array.from('WAVE', character => character.charCodeAt(0)), 8);
	let offset = 12;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

suite('BaseHalfSoundParts', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('Trim keeps a stretch of the edited sound and Delete takes one away, joining what is around it, across parts (D84)', () => {
		const whole = [{ start: 0, end: 10 }];
		const deleted = baseHalfDeleteParts(whole, 2, 3);
		const trimmed = baseHalfTrimParts(deleted, 1, 4);
		const again = baseHalfDeleteParts(trimmed, 0.5, 1.5);
		assert.deepStrictEqual({
			deleted,
			trimmed,
			again,
			lengths: [deleted, trimmed, again].map(baseHalfPartsLength),
			edges: baseHalfPartEdges(trimmed),
			original: [0, 0.99, 1, 2.5].map(time => baseHalfOriginalTime(trimmed, time)),
			whole: [baseHalfPartsAreWhole(whole, 10), baseHalfPartsAreWhole(baseHalfDeleteParts(deleted, 9, 9), 10), baseHalfPartsAreWhole(baseHalfTrimParts(whole, 0, 10), 10)]
		}, {
			deleted: [{ start: 0, end: 2 }, { start: 3, end: 10 }],
			trimmed: [{ start: 1, end: 2 }, { start: 3, end: 5 }],
			again: [{ start: 1, end: 1.5 }, { start: 3.5, end: 5 }],
			lengths: [9, 3, 2],
			edges: [0, 1, 3],
			// At a joint, the time is the later part's start.
			original: [1, 1.99, 3, 4.5],
			whole: [true, false, true]
		});
	});

	test('the handles stop on the grid of the sound, keep 0.1 s between them, and push each other along (D84)', () => {
		const timeline = new BaseHalfSoundTimeline(2, 1 / 1000);
		const pushed = timeline.moveHandle({ start: 0, end: 2 }, 'start', 1.95);
		const keyed = timeline.stepHandle({ start: 0.5, end: 1 }, 'end', 'frame', 1);
		const mp3 = new BaseHalfSoundTimeline(1152 * 10 / 44100, 1152 / 44100);
		assert.deepStrictEqual({
			pushed: [Math.round(pushed.start * 1000) / 1000, pushed.end],
			keyed: [keyed.start, Math.round(keyed.end * 1000) / 1000],
			snapped: Math.round(mp3.snap(0.03) * 44100),
			short: new BaseHalfSoundTimeline(0.05, 1 / 100).normalize({ start: 0, end: 0.02 })
		}, {
			pushed: [1.9, 2],
			keyed: [0.5, 1.001],
			// The nearest frame edge of an MP3: 1152 samples.
			snapped: 1152,
			short: { start: 0, end: 0.05 }
		});
	});

	test('a WAV keeps the samples of its parts exactly, fades over 5 ms where a cut meets sound, keeps its other chunks, and leaves its cue points out (D84)', () => {
		const rate = 8000;
		const source = wav(8000, rate);
		const file = readBaseHalfWavFile(source)!;
		const out = writeBaseHalfWavParts(source, file, [{ start: 0, end: 0.25 }, { start: 0.5, end: 0.75 }]);
		const edited = readBaseHalfWavFile(out)!;
		const view = new DataView(out.buffer, out.byteOffset + edited.dataOffset);
		const left = (frame: number) => view.getInt16(frame * 4, true);
		// 5 ms at 8 kHz is 40 samples: the first part keeps its start, and fades out at its end; the second fades in and out.
		assert.deepStrictEqual({
			format: [edited.channels, edited.sampleRate, edited.bitsPerSample, edited.frames],
			chunks: edited.chunks.map(chunk => chunk.id),
			start: [left(0), left(1)],
			middle: [left(1000), left(2000 + 1000)],
			fadeOut: [left(1999), Math.round((1000 + 1999) / 41)],
			fadeIn: [left(2000), Math.round((1000 + 4000) / 41)]
		}, {
			format: [2, 8000, 16, 4000],
			chunks: ['fmt ', 'LIST', 'data'],
			start: [1000, 1001],
			middle: [2000, 1000 + 4000 + 1000],
			fadeOut: [Math.round((1000 + 1999) / 41), Math.round((1000 + 1999) / 41)],
			fadeIn: [Math.round((1000 + 4000) / 41), Math.round((1000 + 4000) / 41)]
		});
	});
});
