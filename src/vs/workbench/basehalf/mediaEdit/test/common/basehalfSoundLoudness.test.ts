/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfSoundBarHeight, baseHalfSoundEnergy, baseHalfSoundReference } from '../../common/basehalfSoundLoudness.js';

suite('BaseHalfSoundLoudness', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('the waveform sets each bar against the loudest 50 ms of the sound, on a curve, and draws a stretch 48 dB below it as silence (D84)', () => {
		const rate = 8000;
		// A second of a quiet tone, 0.1 s of a loud one, and a second of near silence, in two channels.
		const quiet = 0.1;
		const loud = 0.8;
		const left = new Float32Array(rate * 2.1);
		const right = new Float32Array(rate * 2.1);
		for (let index = 0; index < left.length; index++) {
			const level = index < rate ? quiet : index < rate * 1.1 ? loud : 0.0001;
			left[index] = level * Math.sin(2 * Math.PI * 440 * index / rate);
			right[index] = -left[index];
		}
		const energy = baseHalfSoundEnergy([left, right], 256);
		const reference = baseHalfSoundReference(energy, rate, 256);
		const round = (value: number) => Math.round(value * 1000) / 1000;
		assert.deepStrictEqual({
			blocks: energy.length,
			// The root mean square of a sine is its level over the square root of two, here over whole blocks of it.
			reference: Math.round(reference * 100) / 100,
			loudest: round(baseHalfSoundBarHeight(loud / Math.SQRT2, reference)),
			quiet: round(baseHalfSoundBarHeight(quiet / Math.SQRT2, reference)),
			halfAsLoud: round(baseHalfSoundBarHeight(reference / 2, reference)),
			silence: baseHalfSoundBarHeight(0.0001 / Math.SQRT2, reference),
			nothing: [baseHalfSoundBarHeight(0, reference), baseHalfSoundBarHeight(0.1, 0)]
		}, {
			blocks: Math.ceil(rate * 2.1 / 256),
			reference: Math.round(loud / Math.SQRT2 * 100) / 100,
			loudest: 1,
			// An eighth of the loudness is 18 dB below it: still a fifth of the height.
			quiet: round(Math.pow(quiet / loud, 0.6)),
			halfAsLoud: round(Math.pow(0.5, 0.6)),
			silence: 0,
			nothing: [0, 0]
		});
	});
});
