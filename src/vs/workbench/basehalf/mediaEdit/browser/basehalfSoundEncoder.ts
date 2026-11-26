/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { IBaseHalfMediaPart } from '../common/basehalfEditRecord.js';
import { decodeBaseHalfFlac, encodeBaseHalfFlac, readBaseHalfFlacInfo } from '../common/basehalfFlacFile.js';
import { readBaseHalfIsoBmffFile } from '../common/basehalfIsoBmffReader.js';
import { writeBaseHalfMp4File } from '../common/basehalfIsoBmffWriter.js';
import { readBaseHalfMp3File, writeBaseHalfMp3Parts } from '../common/basehalfMp3File.js';
import { readBaseHalfOggInfo, writeBaseHalfOggOpus } from '../common/basehalfOggFile.js';
import { baseHalfVideoClipSoundBitrate, planBaseHalfSoundPart } from '../common/basehalfVideoClipPlan.js';
import { IBaseHalfVideoByteSource, IBaseHalfVideoFile } from '../common/basehalfVideoFile.js';
import { baseHalfOpusPacketDuration } from '../common/basehalfWebmReader.js';
import { BASEHALF_SOUND_FADE_SECONDS, readBaseHalfWavFile, writeBaseHalfWavParts } from '../common/basehalfWavFile.js';
import { baseHalfFadeSound, decodeBaseHalfSound, encodeBaseHalfSound, IBaseHalfDecodedSound } from './basehalfVideoClipEncoder.js';

/**
 * Makes the edited sound of the parts kept of an original (editing media, "A
 * sound"), in the original's format: a WAV and an MP3 from their bytes, cut
 * exactly and at frame edges; a FLAC decoded exactly and encoded again by
 * BaseHalf without loss; an M4A and an Ogg decoded and encoded again in AAC
 * and in Opus by the window, at the original's bitrate snapped.
 */

export type BaseHalfSoundFormat = 'wav' | 'mp3' | 'flac' | 'm4a' | 'ogg';

/** The longest sound an edit takes: it is decoded whole in memory. */
export const BASEHALF_SOUND_MAX_SECONDS = 30 * 60;

export interface IBaseHalfSoundInfo {
	readonly format: BaseHalfSoundFormat;
	readonly duration: number;
	readonly sampleRate: number;
	readonly channels: number;
	/** What the handles move by: a sample, or the frame of an MP3. */
	readonly step: number;
}

export class BaseHalfSoundEditError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BaseHalfSoundEditError';
	}
}

function sourceOf(bytes: Uint8Array): IBaseHalfVideoByteSource {
	return { size: bytes.length, read: (offset, length) => Promise.resolve(bytes.subarray(offset, offset + length)) };
}

/** Whether the window can encode AAC, which an edited M4A is in; Linux's cannot. */
async function canEncodeAac(sampleRate: number, channels: number): Promise<boolean> {
	for (const config of [{ sampleRate: sampleRate === 44100 ? 44100 : 48000, numberOfChannels: channels === 1 ? 1 : 2 }, { sampleRate: 48000, numberOfChannels: 2 }]) {
		try {
			if ((await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', bitrate: 128_000, ...config })).supported) {
				return true;
			}
		} catch {
			// Not supported.
		}
	}
	return false;
}

/** Reads what an edit needs of a sound file: its format, its length, and its grid; rejects with why it cannot be edited. */
export async function readBaseHalfSoundInfo(bytes: Uint8Array, extension: string): Promise<IBaseHalfSoundInfo> {
	const cannot = (reason: string) => new BaseHalfSoundEditError(reason);
	switch (extension) {
		case 'wav': {
			const wav = readBaseHalfWavFile(bytes);
			if (!wav) {
				throw cannot(localize('basehalf.mediaEdit.sound.wav', "its samples are compressed, or it is no WAV."));
			}
			return { format: 'wav', duration: wav.frames / wav.sampleRate, sampleRate: wav.sampleRate, channels: wav.channels, step: 1 / wav.sampleRate };
		}
		case 'mp3': {
			const mp3 = readBaseHalfMp3File(bytes);
			if (!mp3) {
				throw cannot(localize('basehalf.mediaEdit.sound.mp3', "its frames could not be read as MPEG audio Layer III."));
			}
			const step = mp3.samplesPerFrame / mp3.sampleRate;
			return { format: 'mp3', duration: mp3.frames.length * step, sampleRate: mp3.sampleRate, channels: mp3.channels, step };
		}
		case 'flac': {
			const flac = readBaseHalfFlacInfo(bytes);
			if (!flac) {
				throw cannot(localize('basehalf.mediaEdit.sound.flac', "it could not be read as FLAC."));
			}
			if (flac.bitsPerSample > 24) {
				throw cannot(localize('basehalf.mediaEdit.sound.flacBits', "its samples have more than 24 bits."));
			}
			return { format: 'flac', duration: flac.totalSamples / flac.sampleRate, sampleRate: flac.sampleRate, channels: flac.channels, step: 1 / flac.sampleRate };
		}
		case 'm4a': {
			let file: IBaseHalfVideoFile;
			try {
				file = await readBaseHalfIsoBmffFile(sourceOf(bytes), 'mp4', { soundOnly: true });
			} catch {
				throw cannot(localize('basehalf.mediaEdit.sound.m4a', "it could not be read as an M4A."));
			}
			const audio = file.audio;
			const plan = audio && planBaseHalfSoundPart(audio, 0, Infinity);
			if (!audio || !plan || audio.codec?.startsWith('mp4a') !== true) {
				throw cannot(localize('basehalf.mediaEdit.sound.m4aCodec', "its sound is not in AAC."));
			}
			if (!await canEncodeAac(audio.sampleRate, audio.channels)) {
				throw cannot(localize('basehalf.mediaEdit.sound.noAac', "this system has no encoder of AAC."));
			}
			return { format: 'm4a', duration: plan.to - plan.from, sampleRate: audio.sampleRate, channels: audio.channels, step: 1 / audio.sampleRate };
		}
		case 'ogg': {
			const ogg = readBaseHalfOggInfo(bytes);
			if (!ogg) {
				throw cannot(localize('basehalf.mediaEdit.sound.ogg', "it could not be read as Ogg Opus or Ogg Vorbis."));
			}
			if (ogg.channels > 2) {
				throw cannot(localize('basehalf.mediaEdit.sound.oggChannels', "it has more than two channels."));
			}
			// The length is the last granule position, less the samples skipped at the start.
			const duration = oggDuration(bytes, ogg.codec === 'opus' ? 48_000 : ogg.sampleRate);
			return { format: 'ogg', duration, sampleRate: ogg.sampleRate, channels: ogg.channels, step: 1 / ogg.sampleRate };
		}
	}
	throw cannot(localize('basehalf.mediaEdit.sound.format', "it is not a WAV, MP3, FLAC, M4A, or Ogg."));
}

/** The length of an Ogg from its last page, in seconds; the pre-skip of Opus is taken off. */
function oggDuration(bytes: Uint8Array, rate: number): number {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let preSkip = 0;
	if (bytes.length > 47 && String.fromCharCode(...bytes.subarray(28, 36)) === 'OpusHead') {
		preSkip = view.getUint16(38, true);
	}
	for (let offset = bytes.length - 27; offset >= 0; offset--) {
		if (bytes[offset] === 0x4f && bytes[offset + 1] === 0x67 && bytes[offset + 2] === 0x67 && bytes[offset + 3] === 0x53) {
			const granule = view.getUint32(offset + 6, true) + view.getUint32(offset + 10, true) * 2 ** 32;
			return Math.max(0, granule - preSkip) / rate;
		}
	}
	return 0;
}

/** Decodes a whole sound file with the window's decoder, at a sample rate: the file's own, so that nothing is resampled. */
export async function decodeBaseHalfSoundFile(bytes: Uint8Array, sampleRate: number, channels: number): Promise<IBaseHalfDecodedSound> {
	try {
		const context = new OfflineAudioContext({ numberOfChannels: Math.max(1, channels), length: 1, sampleRate });
		const buffer = await context.decodeAudioData(bytes.slice().buffer);
		return { rate: buffer.sampleRate, channels: buffer.numberOfChannels, data: Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index).slice()) };
	} catch {
		throw new BaseHalfSoundEditError(localize('basehalf.mediaEdit.sound.decode', "this system cannot decode the sound."));
	}
}

/**
 * The parts of decoded sound joined, each fading in where it starts after the
 * sound's start and out where it ends before the sound's end, over 5 ms.
 */
export function baseHalfJoinSoundParts(pcm: IBaseHalfDecodedSound, parts: readonly IBaseHalfMediaPart[]): IBaseHalfDecodedSound {
	const frames = pcm.data[0]?.length ?? 0;
	const ranges = parts
		.map(part => ({ from: Math.max(0, Math.min(frames, Math.round(part.start * pcm.rate))), to: Math.max(0, Math.min(frames, Math.round(part.end * pcm.rate))) }))
		.filter(range => range.to > range.from);
	const total = ranges.reduce((sum, range) => sum + range.to - range.from, 0);
	const joined: IBaseHalfDecodedSound = { rate: pcm.rate, channels: pcm.channels, data: pcm.data.map(() => new Float32Array(total)) };
	let at = 0;
	for (const range of ranges) {
		joined.data.forEach((channel, index) => channel.set(pcm.data[index].subarray(range.from, range.to), at));
		baseHalfFadeSound(joined, at, at + range.to - range.from, range.from > 0, range.to < frames);
		at += range.to - range.from;
	}
	return joined;
}

/** The parts of channels of whole-number samples joined, each fading over 5 ms where it meets a cut, in whole numbers. */
function joinWholeParts(channels: readonly Int32Array[], rate: number, parts: readonly IBaseHalfMediaPart[]): Int32Array[] {
	const frames = channels[0].length;
	const ranges = parts
		.map(part => ({ from: Math.max(0, Math.min(frames, Math.round(part.start * rate))), to: Math.max(0, Math.min(frames, Math.round(part.end * rate))) }))
		.filter(range => range.to > range.from);
	const total = ranges.reduce((sum, range) => sum + range.to - range.from, 0);
	const fade = Math.round(BASEHALF_SOUND_FADE_SECONDS * rate);
	return channels.map(channel => {
		const out = new Int32Array(total);
		let at = 0;
		for (const range of ranges) {
			const length = range.to - range.from;
			out.set(channel.subarray(range.from, range.to), at);
			const count = Math.min(fade, Math.floor(length / 2));
			for (let index = 0; index < count; index++) {
				const gain = (index + 1) / (count + 1);
				if (range.from > 0) {
					out[at + index] = Math.round(out[at + index] * gain);
				}
				if (range.to < frames) {
					out[at + length - 1 - index] = Math.round(out[at + length - 1 - index] * gain);
				}
			}
			at += length;
		}
		return out;
	});
}

/** Encodes the parts kept of an original sound file in its format. */
export async function encodeBaseHalfSoundParts(bytes: Uint8Array, info: IBaseHalfSoundInfo, parts: readonly IBaseHalfMediaPart[]): Promise<Uint8Array> {
	switch (info.format) {
		case 'wav': return writeBaseHalfWavParts(bytes, readBaseHalfWavFile(bytes)!, parts);
		case 'mp3': return writeBaseHalfMp3Parts(bytes, readBaseHalfMp3File(bytes)!, parts);
		case 'flac': {
			const flac = readBaseHalfFlacInfo(bytes)!;
			// Decoded by BaseHalf, so that every sample kept is the file's own whole number.
			const samples = decodeBaseHalfFlac(bytes);
			if (!samples || !samples.channels[0]?.length) {
				throw new BaseHalfSoundEditError(localize('basehalf.mediaEdit.sound.decodeFlac', "its frames could not be decoded."));
			}
			return encodeBaseHalfFlac(joinWholeParts(samples.channels, samples.sampleRate, parts), flac.sampleRate, flac.bitsPerSample, flac.blocks);
		}
		case 'm4a': {
			const source = sourceOf(bytes);
			const file = await readBaseHalfIsoBmffFile(source, 'mp4', { soundOnly: true });
			const audio = file.audio!;
			const plan = planBaseHalfSoundPart(audio, 0, Infinity)!;
			const joined = baseHalfJoinSoundParts(await decodeBaseHalfSound(source, audio, plan), parts);
			const encoded = await encodeBaseHalfSound(joined, 'aac', plan.bitrate);
			if (encoded.kind !== 'aac') {
				throw new BaseHalfSoundEditError(localize('basehalf.mediaEdit.sound.encodeAac', "the window could not encode AAC."));
			}
			return writeBaseHalfMp4File({ format: 'mp4', tracks: [encoded.track], metadata: file.format === 'webm' ? [] : file.metadata });
		}
		case 'ogg': {
			const ogg = readBaseHalfOggInfo(bytes)!;
			const joined = baseHalfJoinSoundParts(await decodeBaseHalfSoundFile(bytes, ogg.codec === 'opus' ? 48_000 : ogg.sampleRate, ogg.channels), parts);
			const bitrate = baseHalfVideoClipSoundBitrate(info.duration > 0 ? bytes.length * 8 / info.duration : 128_000);
			const encoded = await encodeBaseHalfSound(joined, 'opus', bitrate);
			if (encoded.kind !== 'opus') {
				throw new BaseHalfSoundEditError(localize('basehalf.mediaEdit.sound.encodeOpus', "the window could not encode Opus."));
			}
			const { track } = encoded;
			return writeBaseHalfOggOpus({
				packets: track.packets,
				durations: track.packets.map(packet => Math.round((baseHalfOpusPacketDuration(packet) ?? 20_000) * 48_000 / 1_000_000)),
				channels: track.channels,
				preSkip: track.delay,
				length: track.length,
				inputSampleRate: ogg.sampleRate,
				outputGain: ogg.outputGain,
				comments: ogg.comments
			});
		}
	}
}
