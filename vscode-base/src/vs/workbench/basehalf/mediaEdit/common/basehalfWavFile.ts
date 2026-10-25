/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IBaseHalfMediaPart } from './basehalfEditRecord.js';

/**
 * A WAV file as a sound edit reads and writes it (editing media, "A
 * sound"): its format chunk, its samples, and its other chunks. An edited WAV
 * has the same format and chunks, its samples cut exactly at the parts kept,
 * fading over 5 ms where a cut starts or ends the sound and on both sides of
 * a joint. Chunks that point at places in the samples, as cue points, no
 * longer point where they did, and are left out.
 */

export interface IBaseHalfWavFile {
	/** PCM in whole numbers, or in floating point. */
	readonly encoding: 'int' | 'float';
	readonly bitsPerSample: number;
	readonly channels: number;
	readonly sampleRate: number;
	/** Bytes of a frame: a sample of each channel. */
	readonly blockAlign: number;
	/** The sample frames the file holds. */
	readonly frames: number;
	/** Where the samples are in the file, and how many bytes. */
	readonly dataOffset: number;
	readonly dataSize: number;
	/** The chunks in their order, each with its bytes from its id on. */
	readonly chunks: readonly { readonly id: string; readonly bytes: Uint8Array }[];
}

/** Chunks that name places in the samples. */
const PLACED_CHUNKS = new Set(['cue ', 'smpl', 'PEAK', 'plst']);
/** How long a fade is where a cut meets sound. */
export const BASEHALF_SOUND_FADE_SECONDS = 0.005;

function fourcc(bytes: Uint8Array, offset: number): string {
	return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

/** Reads a WAV of samples that are not compressed; nothing for any other file. */
export function readBaseHalfWavFile(bytes: Uint8Array): IBaseHalfWavFile | undefined {
	if (bytes.length < 12 || fourcc(bytes, 0) !== 'RIFF' || fourcc(bytes, 8) !== 'WAVE') {
		return undefined;
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const chunks: { id: string; bytes: Uint8Array }[] = [];
	let format: { encoding: 'int' | 'float'; bitsPerSample: number; channels: number; sampleRate: number; blockAlign: number } | undefined;
	let dataOffset = -1;
	let dataSize = 0;
	for (let offset = 12; offset + 8 <= bytes.length;) {
		const id = fourcc(bytes, offset);
		let size = view.getUint32(offset + 4, true);
		if (id === 'data' && offset + 8 + size > bytes.length) {
			// A data chunk cut short, as by a recorder that stopped, holds what is there.
			size = bytes.length - offset - 8;
		}
		if (offset + 8 + size > bytes.length) {
			break;
		}
		const end = offset + 8 + size + (size % 2);
		chunks.push({ id, bytes: bytes.subarray(offset, Math.min(end, bytes.length)) });
		if (id === 'fmt ' && size >= 16) {
			let tag = view.getUint16(offset + 8, true);
			const channels = view.getUint16(offset + 10, true);
			const sampleRate = view.getUint32(offset + 12, true);
			const blockAlign = view.getUint16(offset + 20, true);
			const bitsPerSample = view.getUint16(offset + 22, true);
			if (tag === 0xfffe && size >= 40) {
				// The extensible format names its own format in the first bytes of its subformat.
				tag = view.getUint16(offset + 32, true);
			}
			const encoding = tag === 1 ? 'int' : tag === 3 ? 'float' : undefined;
			const valid = encoding === 'int' ? [8, 16, 24, 32].includes(bitsPerSample) : encoding === 'float' && [32, 64].includes(bitsPerSample);
			if (!encoding || !valid || !channels || !sampleRate || blockAlign !== channels * bitsPerSample / 8) {
				return undefined;
			}
			format = { encoding, bitsPerSample, channels, sampleRate, blockAlign };
		} else if (id === 'data') {
			dataOffset = offset + 8;
			dataSize = size;
		}
		offset = end;
	}
	if (!format || dataOffset < 0) {
		return undefined;
	}
	return { ...format, frames: Math.floor(dataSize / format.blockAlign), dataOffset, dataSize, chunks };
}

/** Reads one sample as a number from −1 to 1. */
function readSample(view: DataView, offset: number, file: IBaseHalfWavFile): number {
	if (file.encoding === 'float') {
		return file.bitsPerSample === 32 ? view.getFloat32(offset, true) : view.getFloat64(offset, true);
	}
	switch (file.bitsPerSample) {
		case 8: return (view.getUint8(offset) - 128) / 128;
		case 16: return view.getInt16(offset, true) / 32768;
		case 24: return ((view.getUint8(offset) | view.getUint8(offset + 1) << 8 | view.getInt8(offset + 2) << 16)) / 8388608;
		default: return view.getInt32(offset, true) / 2147483648;
	}
}

function writeSample(view: DataView, offset: number, file: IBaseHalfWavFile, value: number): void {
	if (file.encoding === 'float') {
		if (file.bitsPerSample === 32) {
			view.setFloat32(offset, value, true);
		} else {
			view.setFloat64(offset, value, true);
		}
		return;
	}
	const scale = 2 ** (file.bitsPerSample - 1);
	const integer = Math.max(-scale, Math.min(scale - 1, Math.round(value * scale)));
	switch (file.bitsPerSample) {
		case 8: view.setUint8(offset, integer + 128); break;
		case 16: view.setInt16(offset, integer, true); break;
		case 24:
			view.setUint8(offset, integer & 0xff);
			view.setUint8(offset + 1, (integer >> 8) & 0xff);
			view.setInt8(offset + 2, integer >> 16);
			break;
		default: view.setInt32(offset, integer, true);
	}
}

/** The sample frame of the original at a time, on the sound's samples. */
export function baseHalfSampleFrame(time: number, sampleRate: number, frames: number): number {
	return Math.max(0, Math.min(frames, Math.round(time * sampleRate)));
}

/**
 * The WAV of the parts kept of a WAV: its samples cut at the parts, joined,
 * and faded where a part does not start or end with the sound; every chunk
 * besides the samples as it was, the count of a `fact` chunk made new, and
 * the chunks that name places in the samples left out.
 */
export function writeBaseHalfWavParts(bytes: Uint8Array, file: IBaseHalfWavFile, parts: readonly IBaseHalfMediaPart[]): Uint8Array {
	const ranges = parts
		.map(part => ({ from: baseHalfSampleFrame(part.start, file.sampleRate, file.frames), to: baseHalfSampleFrame(part.end, file.sampleRate, file.frames) }))
		.filter(range => range.to > range.from);
	const frames = ranges.reduce((sum, range) => sum + range.to - range.from, 0);
	const data = new Uint8Array(frames * file.blockAlign);
	const out = new DataView(data.buffer);
	const fade = Math.max(1, Math.round(BASEHALF_SOUND_FADE_SECONDS * file.sampleRate));
	const bytesPerSample = file.bitsPerSample / 8;
	let at = 0;
	for (const range of ranges) {
		data.set(bytes.subarray(file.dataOffset + range.from * file.blockAlign, file.dataOffset + range.to * file.blockAlign), at * file.blockAlign);
		const length = range.to - range.from;
		const fadeIn = range.from > 0;
		const fadeOut = range.to < file.frames;
		const count = Math.min(fade, Math.floor(length / 2));
		for (let index = 0; index < count; index++) {
			const gain = (index + 1) / (count + 1);
			for (const [frame, apply] of [[at + index, fadeIn], [at + length - 1 - index, fadeOut]] as const) {
				if (!apply) {
					continue;
				}
				for (let channel = 0; channel < file.channels; channel++) {
					const offset = frame * file.blockAlign + channel * bytesPerSample;
					writeSample(out, offset, file, readSample(out, offset, file) * gain);
				}
			}
		}
		at += length;
	}
	const pieces: Uint8Array[] = [];
	for (const chunk of file.chunks) {
		if (chunk.id === 'data') {
			pieces.push(chunkBytes('data', data));
		} else if (chunk.id === 'fact' && chunk.bytes.length >= 12) {
			const fact = chunk.bytes.slice(8, 8 + Math.max(4, new DataView(chunk.bytes.buffer, chunk.bytes.byteOffset).getUint32(4, true)));
			new DataView(fact.buffer).setUint32(0, frames, true);
			pieces.push(chunkBytes('fact', fact));
		} else if (!PLACED_CHUNKS.has(chunk.id) && !(chunk.id === 'LIST' && fourcc(chunk.bytes, 8) === 'adtl')) {
			pieces.push(chunk.bytes.length % 2 ? concat([chunk.bytes, new Uint8Array(1)]) : chunk.bytes);
		}
	}
	const body = concat(pieces);
	const header = new Uint8Array(12);
	header.set([0x52, 0x49, 0x46, 0x46]);
	new DataView(header.buffer).setUint32(4, body.length + 4, true);
	header.set([0x57, 0x41, 0x56, 0x45], 8);
	return concat([header, body]);
}

function chunkBytes(id: string, body: Uint8Array): Uint8Array {
	const chunk = new Uint8Array(8 + body.length + (body.length % 2));
	for (let index = 0; index < 4; index++) {
		chunk[index] = id.charCodeAt(index);
	}
	new DataView(chunk.buffer).setUint32(4, body.length, true);
	chunk.set(body, 8);
	return chunk;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}
