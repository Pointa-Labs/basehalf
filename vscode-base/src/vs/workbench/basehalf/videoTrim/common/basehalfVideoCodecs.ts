/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { BaseHalfByteReader } from './basehalfVideoBytes.js';

/**
 * The names the window's decoders and encoders give codecs (the codec
 * strings of WebCodecs), read from what a file says of its codec: the
 * configuration records of H.264, HEVC, VP9, and AV1, and the decoder
 * configuration of an MPEG-4 sound.
 */

function hex2(value: number): string {
	return value.toString(16).padStart(2, '0');
}

function dec2(value: number): string {
	return String(value).padStart(2, '0');
}

/** `avc1.640028` from an `avcC` record: profile, compatibility, and level. */
export function baseHalfAvcCodec(fourcc: string, avcC: Uint8Array): string | undefined {
	if (avcC.length < 4 || avcC[0] !== 1) {
		return undefined;
	}
	return `${fourcc}.${hex2(avcC[1])}${hex2(avcC[2])}${hex2(avcC[3])}`.toLowerCase();
}

/** `hvc1.1.6.L93.B0` from an `hvcC` record (ISO/IEC 14496-15, annex E). */
export function baseHalfHevcCodec(fourcc: string, hvcC: Uint8Array): string | undefined {
	if (hvcC.length < 13) {
		return undefined;
	}
	const reader = new BaseHalfByteReader(hvcC);
	reader.skip(1);
	const first = reader.u8();
	const space = first >> 6;
	const tier = (first >> 5) & 1;
	const profile = first & 0x1F;
	const compatibility = reader.u32();
	const constraints = reader.slice(6);
	const level = reader.u8();
	// The compatibility flags are written with their bits in reverse order.
	let reversed = 0;
	for (let bit = 0; bit < 32; bit++) {
		if (compatibility & (1 << bit)) {
			reversed |= 1 << (31 - bit);
		}
	}
	const parts = [
		fourcc,
		`${space ? String.fromCharCode(64 + space) : ''}${profile}`,
		(reversed >>> 0).toString(16).toUpperCase(),
		`${tier ? 'H' : 'L'}${level}`
	];
	// Trailing bytes of the constraint flags that are zero are left out.
	let last = constraints.length;
	while (last > 0 && constraints[last - 1] === 0) {
		last--;
	}
	for (let index = 0; index < last; index++) {
		parts.push(constraints[index].toString(16).toUpperCase());
	}
	return parts.join('.');
}

/** `vp09.00.10.08` from a `vpcC` full box's body: profile, level, and bit depth. */
export function baseHalfVp9Codec(vpcC: Uint8Array | undefined, profile = 0): string {
	if (vpcC && vpcC.length >= 7) {
		const reader = new BaseHalfByteReader(vpcC);
		reader.skip(4);
		const vpProfile = reader.u8();
		const level = reader.u8();
		const bitDepth = reader.u8() >> 4;
		return `vp09.${dec2(vpProfile)}.${dec2(level || 10)}.${dec2(bitDepth || 8)}`;
	}
	return `vp09.${dec2(profile)}.10.${profile >= 2 ? '10' : '08'}`;
}

/** `av01.0.08M.08` from an `av1C` record: profile, level, tier, and bit depth. */
export function baseHalfAv1Codec(av1C: Uint8Array): string | undefined {
	if (av1C.length < 4 || (av1C[0] & 0x80) === 0) {
		return undefined;
	}
	const profile = av1C[1] >> 5;
	const level = av1C[1] & 0x1F;
	const tier = av1C[2] >> 7;
	const highBitDepth = (av1C[2] >> 6) & 1;
	const twelveBit = (av1C[2] >> 5) & 1;
	const bitDepth = twelveBit ? 12 : highBitDepth ? 10 : 8;
	return `av01.${profile}.${dec2(level)}${tier ? 'H' : 'M'}.${dec2(bitDepth)}`;
}

/** What an MPEG-4 AudioSpecificConfig says: its object type, its sample rate, and its channels. */
export interface IBaseHalfAudioSpecificConfig {
	readonly objectType: number;
	readonly sampleRate: number | undefined;
	readonly channels: number;
}

const AAC_SAMPLE_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

export function baseHalfReadAudioSpecificConfig(config: Uint8Array): IBaseHalfAudioSpecificConfig | undefined {
	if (config.length < 2) {
		return undefined;
	}
	let bitPosition = 0;
	const bits = (count: number): number => {
		let value = 0;
		for (let index = 0; index < count; index++) {
			const byte = config[bitPosition >> 3] ?? 0;
			value = (value << 1) | ((byte >> (7 - (bitPosition & 7))) & 1);
			bitPosition++;
		}
		return value;
	};
	let objectType = bits(5);
	if (objectType === 31) {
		objectType = 32 + bits(6);
	}
	const frequencyIndex = bits(4);
	const sampleRate = frequencyIndex === 15 ? bits(24) : AAC_SAMPLE_RATES[frequencyIndex];
	const channels = bits(4);
	return { objectType, sampleRate, channels };
}

/** `mp4a.40.2` for the object type and the AudioSpecificConfig of an `esds`, or `mp3`. */
export function baseHalfMpeg4AudioCodec(objectTypeIndication: number, config: Uint8Array | undefined): string | undefined {
	switch (objectTypeIndication) {
		case 0x40: {
			const objectType = config ? baseHalfReadAudioSpecificConfig(config)?.objectType : undefined;
			return objectType !== undefined ? `mp4a.40.${objectType}` : 'mp4a.40.2';
		}
		case 0x66:
		case 0x67:
		case 0x68:
			return `mp4a.${objectTypeIndication.toString(16)}`;
		case 0x69:
		case 0x6B:
			return 'mp3';
		default:
			return undefined;
	}
}

/**
 * The OpusHead that the window's Opus decoder takes, from an MP4's `dOps`
 * box (big-endian) or as a WebM has it already (RFC 7845).
 */
export function baseHalfOpusHeadFromDops(dOps: Uint8Array): Uint8Array | undefined {
	if (dOps.length < 11) {
		return undefined;
	}
	const reader = new BaseHalfByteReader(dOps);
	reader.skip(1);
	const channels = reader.u8();
	const preSkip = reader.u16();
	const inputRate = reader.u32();
	const gain = reader.i16();
	const family = reader.u8();
	const table = family !== 0 ? reader.slice(Math.min(reader.remaining, 2 + channels)) : new Uint8Array(0);
	const head = new Uint8Array(19 + table.length);
	const view = new DataView(head.buffer);
	head.set([0x4F, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0);
	head[8] = 1;
	head[9] = channels;
	view.setUint16(10, preSkip, true);
	view.setUint32(12, inputRate, true);
	view.setInt16(16, gain, true);
	head[18] = family;
	head.set(table, 19);
	return head;
}

/**
 * The levels of H.264 High (ITU-T H.264, table A-1), from the lowest a picture
 * of this size, frame rate, and bitrate fits in: the level as the codec string
 * has it. An encoder refuses a level that is too low for its picture.
 */
export function baseHalfAvcLevels(width: number, height: number, frameRate: number, bitrate: number): readonly number[] {
	const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
	const rate = macroblocks * Math.max(1, frameRate);
	// Level, maximum frame size and macroblock rate, and maximum bitrate of the Main profile in kbit/s; High allows 1.25 times it.
	const levels: readonly [number, number, number, number][] = [
		[0x1E, 1620, 40500, 10000],
		[0x1F, 3600, 108000, 14000],
		[0x20, 5120, 216000, 20000],
		[0x28, 8192, 245760, 20000],
		[0x29, 8192, 245760, 50000],
		[0x2A, 8704, 522240, 50000],
		[0x32, 22080, 589824, 135000],
		[0x33, 36864, 983040, 240000],
		[0x34, 36864, 2073600, 240000],
		[0x3C, 139264, 4177920, 240000],
		[0x3D, 139264, 8355840, 480000],
		[0x3E, 139264, 16711680, 800000]
	];
	const fitting = levels.filter(([, maxFrame, maxRate, maxBitrate]) => macroblocks <= maxFrame && rate <= maxRate && bitrate <= maxBitrate * 1250);
	return fitting.length ? fitting.map(([level]) => level) : [0x3E];
}

/**
 * The levels of VP9 (the VP9 bitstream specification, annex A), from the
 * lowest a picture of this size, frame rate, and bitrate fits in: ten times the
 * level, as the codec string has it.
 */
export function baseHalfVp9Levels(width: number, height: number, frameRate: number, bitrate: number): readonly number[] {
	const samples = width * height;
	const rate = samples * Math.max(1, frameRate);
	// Level, maximum luma picture size and sample rate, and maximum bitrate in kbit/s.
	const levels: readonly [number, number, number, number][] = [
		[10, 36864, 829440, 200],
		[11, 73728, 2764800, 800],
		[20, 122880, 4608000, 1800],
		[21, 245760, 9216000, 3600],
		[30, 552960, 20736000, 7200],
		[31, 983040, 36864000, 12000],
		[40, 2228224, 83558400, 18000],
		[41, 2228224, 160432128, 30000],
		[50, 8912896, 311951360, 60000],
		[51, 8912896, 588251136, 120000],
		[52, 8912896, 1176502272, 180000],
		[60, 35651584, 1176502272, 180000],
		[61, 35651584, 2353004544, 240000],
		[62, 35651584, 4706009088, 480000]
	];
	const fitting = levels.filter(([, maxSize, maxRate, maxBitrate]) => samples <= maxSize && rate <= maxRate && bitrate <= maxBitrate * 1000);
	return fitting.length ? fitting.map(([level]) => level) : [62];
}

/**
 * The levels of HEVC Main, Main tier (ITU-T H.265, table A.8), from the lowest
 * a picture of this size, frame rate, and bitrate fits in: thirty times the
 * level, as the codec string has it.
 */
export function baseHalfHevcLevels(width: number, height: number, frameRate: number, bitrate: number): readonly number[] {
	const samples = width * height;
	const rate = samples * Math.max(1, frameRate);
	// Level, maximum luma picture size and sample rate, and maximum bitrate of the Main tier in kbit/s.
	const levels: readonly [number, number, number, number][] = [
		[30, 36864, 552960, 128],
		[60, 122880, 3686400, 1500],
		[63, 245760, 7372800, 3000],
		[90, 552960, 16588800, 6000],
		[93, 983040, 33177600, 10000],
		[120, 2228224, 66846720, 12000],
		[123, 2228224, 133693440, 20000],
		[150, 8912896, 267386880, 25000],
		[153, 8912896, 534773760, 40000],
		[156, 8912896, 1069547520, 60000],
		[180, 35651584, 1069547520, 60000],
		[183, 35651584, 2139095040, 120000],
		[186, 35651584, 4278190080, 240000]
	];
	const fitting = levels.filter(([, maxPicture, maxRate, maxBitrate]) => samples <= maxPicture && rate <= maxRate && bitrate <= maxBitrate * 1000);
	return fitting.length ? fitting.map(([level]) => level) : [186];
}
