/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/** Samples of each block whose energy the waveform keeps. */
export const BASEHALF_SOUND_ENERGY_BLOCK = 256;

/** The stretch against whose loudness the bars of the waveform are set (editing media, "The waveform"). */
const REFERENCE_SECONDS = 0.05;
/** How far below the loudest a stretch is silence. */
const SILENCE_DECIBELS = 48;
/** The curve of a bar's height over its loudness: a quiet word stays visible beside a loud one. */
const CURVE = 0.6;

/** The mean of the squares of each block of samples, over the channels. */
export function baseHalfSoundEnergy(channels: readonly Float32Array[], block = BASEHALF_SOUND_ENERGY_BLOCK): Float32Array {
	const length = channels.reduce((longest, channel) => Math.max(longest, channel.length), 0);
	const energy = new Float32Array(Math.ceil(length / block));
	for (const channel of channels) {
		for (let index = 0; index < channel.length; index++) {
			energy[(index / block) | 0] += channel[index] * channel[index];
		}
	}
	for (let index = 0; index < energy.length; index++) {
		const samples = Math.min(block, length - index * block);
		energy[index] /= samples * channels.length;
	}
	return energy;
}

/** The loudness, as a root mean square, of the loudest stretch of 50 ms of the blocks. */
export function baseHalfSoundReference(energy: Float32Array, sampleRate: number, block = BASEHALF_SOUND_ENERGY_BLOCK): number {
	const window = Math.max(1, Math.round(REFERENCE_SECONDS * sampleRate / block));
	let sum = 0;
	let loudest = 0;
	for (let index = 0; index < energy.length; index++) {
		sum += energy[index];
		if (index >= window) {
			sum -= energy[index - window];
		}
		loudest = Math.max(loudest, sum / Math.min(window, index + 1));
	}
	return Math.sqrt(loudest);
}

/** The height of a bar, from 0 for silence to 1 for the loudest, of a stretch with this loudness. */
export function baseHalfSoundBarHeight(loudness: number, reference: number): number {
	if (!(reference > 0) || !(loudness > 0) || 20 * Math.log10(loudness / reference) < -SILENCE_DECIBELS) {
		return 0;
	}
	return Math.min(1, Math.pow(loudness / reference, CURVE));
}
