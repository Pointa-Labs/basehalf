/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IBaseHalfMediaPart } from './basehalfEditRecord.js';

/**
 * An MP3 as a sound edit reads and writes it (editing media, "A sound"): its
 * frames of MPEG audio Layer III, cut at frame edges and never encoded again,
 * and its tags before and after them, kept as they are. A frame's data may
 * start in the frames before it, in their reserve of bits: the data of each
 * frame kept is laid out again from an empty reserve, so that every frame
 * decodes after a cut, and a frame whose data does not fit takes a higher
 * bitrate. Where a cut starts or ends the sound, and on both sides of a
 * joint, the sound fades by the gain of the granules there. A new Info or
 * Xing frame gives the number of frames, the bytes, and a table to seek by.
 */

export type BaseHalfMp3Version = 1 | 2 | 25;

export interface IBaseHalfMp3Frame {
	readonly offset: number;
	readonly size: number;
	readonly header: Uint8Array;
	/** The bytes after the header and its check. */
	readonly sideInfoOffset: number;
}

export interface IBaseHalfMp3File {
	readonly version: BaseHalfMp3Version;
	readonly sampleRate: number;
	readonly channels: 1 | 2;
	/** 1152 for MPEG-1, 576 for MPEG-2 and 2.5. */
	readonly samplesPerFrame: number;
	/** The frames of sound, without the Info or Xing frame. */
	readonly frames: readonly IBaseHalfMp3Frame[];
	/** All frames in their order, the Info or Xing frame among them: the data of a frame may lie in those before it. */
	readonly allFrames: readonly IBaseHalfMp3Frame[];
	/** The tags before the first frame, and after the last one. */
	readonly head: Uint8Array;
	readonly tail: Uint8Array;
}

const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES: Record<BaseHalfMp3Version, readonly number[]> = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 25: [11025, 12000, 8000] };
/** The gain taken from the granules where a cut meets sound, in steps of 1.5 dB: the outermost first. */
const FADE_STEPS = [20, 8];

interface IHeader {
	readonly version: BaseHalfMp3Version;
	readonly bitrateIndex: number;
	readonly sampleRate: number;
	readonly padding: boolean;
	readonly channels: 1 | 2;
	readonly protected: boolean;
	readonly size: number;
}

function readHeader(bytes: Uint8Array, offset: number): IHeader | undefined {
	if (offset + 4 > bytes.length || bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) {
		return undefined;
	}
	const versionBits = (bytes[offset + 1] >> 3) & 3;
	const layer = (bytes[offset + 1] >> 1) & 3;
	const bitrateIndex = bytes[offset + 2] >> 4;
	const rateIndex = (bytes[offset + 2] >> 2) & 3;
	// Layer III only, no free bitrate, and no reserved values.
	if (versionBits === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3 || (bytes[offset + 3] & 3) === 2) {
		return undefined;
	}
	const version: BaseHalfMp3Version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 25;
	const sampleRate = SAMPLE_RATES[version][rateIndex];
	const padding = ((bytes[offset + 2] >> 1) & 1) === 1;
	const channels = (bytes[offset + 3] >> 6) === 3 ? 1 : 2;
	return { version, bitrateIndex, sampleRate, padding, channels, protected: (bytes[offset + 1] & 1) === 0, size: frameSize(version, bitrateIndex, sampleRate, padding) };
}

function frameSize(version: BaseHalfMp3Version, bitrateIndex: number, sampleRate: number, padding: boolean): number {
	const kbps = (version === 1 ? BITRATES_V1 : BITRATES_V2)[bitrateIndex];
	return Math.floor((version === 1 ? 144_000 : 72_000) * kbps / sampleRate) + (padding ? 1 : 0);
}

function sideInfoSize(version: BaseHalfMp3Version, channels: number): number {
	return version === 1 ? (channels === 1 ? 17 : 32) : (channels === 1 ? 9 : 17);
}

/** Reads an MP3 of Layer III frames that keep one format; nothing for any other file. */
export function readBaseHalfMp3File(bytes: Uint8Array): IBaseHalfMp3File | undefined {
	let start = 0;
	// ID3v2 tags come first; each says its size, without its header, as four bytes of seven bits.
	while (start + 10 <= bytes.length && bytes[start] === 0x49 && bytes[start + 1] === 0x44 && bytes[start + 2] === 0x33) {
		const size = (bytes[start + 6] << 21) | (bytes[start + 7] << 14) | (bytes[start + 8] << 7) | bytes[start + 9];
		start += 10 + size + ((bytes[start + 5] & 0x10) ? 10 : 0);
	}
	const frames: IBaseHalfMp3Frame[] = [];
	let first: IHeader | undefined;
	let offset = start;
	let head = start;
	while (offset + 4 <= bytes.length) {
		const header = readHeader(bytes, offset);
		// A frame counts once the one after it is a frame too, or the file ends after it, or tags follow it.
		const next = header && offset + header.size;
		const confirmed = header && next !== undefined && next <= bytes.length
			&& (next === bytes.length || readHeader(bytes, next) || isTag(bytes, next));
		if (!header || !confirmed || (first && (header.version !== first.version || header.sampleRate !== first.sampleRate || header.channels !== first.channels))) {
			if (frames.length) {
				// What follows the frames, as ID3v1 and APE tags, is the tail.
				break;
			}
			offset++;
			head = offset;
			continue;
		}
		first ??= header;
		frames.push({ offset, size: header.size, header: bytes.subarray(offset, offset + 4), sideInfoOffset: offset + 4 + (header.protected ? 2 : 0) });
		offset += header.size;
	}
	if (!first || !frames.length) {
		return undefined;
	}
	const audio = frames.filter((frame, index) => index > 0 || !isInfoFrame(bytes, frame, first!));
	return {
		version: first.version,
		sampleRate: first.sampleRate,
		channels: first.channels,
		samplesPerFrame: first.version === 1 ? 1152 : 576,
		frames: audio,
		allFrames: frames,
		head: bytes.subarray(0, head),
		tail: bytes.subarray(offset)
	};
}

function isTag(bytes: Uint8Array, offset: number): boolean {
	const text = String.fromCharCode(...bytes.subarray(offset, offset + 8));
	return text.startsWith('TAG') || text.startsWith('APETAGEX') || text.startsWith('ID3') || text.startsWith('LYRICS');
}

/** The first frame of many files is an Info, Xing, or VBRI frame of no sound. */
function isInfoFrame(bytes: Uint8Array, frame: IBaseHalfMp3Frame, header: IHeader): boolean {
	const at = frame.sideInfoOffset + sideInfoSize(header.version, header.channels);
	const tag = String.fromCharCode(...bytes.subarray(at, at + 4));
	const vbri = String.fromCharCode(...bytes.subarray(frame.offset + 36, frame.offset + 40));
	return tag === 'Xing' || tag === 'Info' || vbri === 'VBRI';
}

// #region Side information

class BitReader {
	private position = 0;
	constructor(private readonly bytes: Uint8Array) { }
	get offset(): number {
		return this.position;
	}
	read(count: number): number {
		let value = 0;
		for (let index = 0; index < count; index++) {
			const byte = this.bytes[this.position >> 3] ?? 0;
			value = (value << 1) | ((byte >> (7 - (this.position & 7))) & 1);
			this.position++;
		}
		return value;
	}
}

function writeBits(bytes: Uint8Array, position: number, count: number, value: number): void {
	for (let index = 0; index < count; index++) {
		const bit = (value >> (count - 1 - index)) & 1;
		const at = position + index;
		bytes[at >> 3] = (bytes[at >> 3] & ~(1 << (7 - (at & 7)))) | (bit << (7 - (at & 7)));
	}
}

interface ISideInfo {
	readonly mainDataBegin: number;
	/** The bits of the frame's data: its scale factors and its Huffman codes. */
	readonly mainDataBits: number;
	/** Where the global gain of each granule of each channel is, in bits of the side information, granule by granule. */
	readonly gains: readonly { readonly granule: number; readonly position: number; readonly value: number }[];
}

function readSideInfo(side: Uint8Array, version: BaseHalfMp3Version, channels: number): ISideInfo {
	const reader = new BitReader(side);
	const mpeg1 = version === 1;
	const mainDataBegin = reader.read(mpeg1 ? 9 : 8);
	reader.read(mpeg1 ? (channels === 1 ? 5 : 3) : (channels === 1 ? 1 : 2));
	if (mpeg1) {
		reader.read(4 * channels);
	}
	let mainDataBits = 0;
	const gains: { granule: number; position: number; value: number }[] = [];
	for (let granule = 0; granule < (mpeg1 ? 2 : 1); granule++) {
		for (let channel = 0; channel < channels; channel++) {
			mainDataBits += reader.read(12);
			reader.read(9);
			const position = reader.offset;
			gains.push({ granule, position, value: reader.read(8) });
			reader.read(mpeg1 ? 4 : 9);
			// The window switching flag, then 22 bits of either kind of block, then the flags after.
			reader.read(1);
			reader.read(22);
			reader.read(mpeg1 ? 3 : 2);
		}
	}
	return { mainDataBegin, mainDataBits, gains };
}

// #endregion

/** The frames of the parts kept, each with how much gain it gives up at the start or the end of its part. */
function keptFrames(file: IBaseHalfMp3File, parts: readonly IBaseHalfMediaPart[]): { readonly frame: number; readonly fade: readonly number[] }[] {
	const perSecond = file.sampleRate / file.samplesPerFrame;
	const granules = file.version === 1 ? 2 : 1;
	const kept: { frame: number; fade: number[] }[] = [];
	for (const part of parts) {
		const from = Math.max(0, Math.min(file.frames.length, Math.round(part.start * perSecond)));
		const to = Math.max(from, Math.min(file.frames.length, Math.round(part.end * perSecond)));
		const frames = Array.from({ length: to - from }, (_, index) => ({ frame: from + index, fade: new Array<number>(granules).fill(0) }));
		const total = frames.length * granules;
		FADE_STEPS.forEach((steps, index) => {
			if (index >= total) {
				return;
			}
			if (from > 0) {
				frames[Math.floor(index / granules)].fade[index % granules] = Math.max(frames[Math.floor(index / granules)].fade[index % granules], steps);
			}
			if (to < file.frames.length) {
				const last = total - 1 - index;
				frames[Math.floor(last / granules)].fade[last % granules] = Math.max(frames[Math.floor(last / granules)].fade[last % granules], steps);
			}
		});
		kept.push(...frames);
	}
	return kept;
}

/**
 * The data of each frame of sound, its scale factors and Huffman codes,
 * wherever in the reserve of the frames before it lies; nothing for a frame
 * whose data lies outside the frames.
 */
export function baseHalfMp3FrameData(bytes: Uint8Array, file: IBaseHalfMp3File): (Uint8Array | undefined)[] {
	const sideSize = sideInfoSize(file.version, file.channels);
	const slotOffsets = new Map<IBaseHalfMp3Frame, number>();
	let stream = 0;
	for (const frame of file.allFrames) {
		slotOffsets.set(frame, stream);
		stream += frame.offset + frame.size - (frame.sideInfoOffset + sideSize);
	}
	const slots = new Uint8Array(stream);
	for (const frame of file.allFrames) {
		slots.set(bytes.subarray(frame.sideInfoOffset + sideSize, frame.offset + frame.size), slotOffsets.get(frame)!);
	}
	return file.frames.map(frame => {
		const info = readSideInfo(bytes.subarray(frame.sideInfoOffset, frame.sideInfoOffset + sideSize), file.version, file.channels);
		const begin = slotOffsets.get(frame)! - info.mainDataBegin;
		const length = Math.ceil(info.mainDataBits / 8);
		return begin < 0 || begin + length > slots.length ? undefined : slots.slice(begin, begin + length);
	});
}

/** The MP3 of the parts kept of an MP3, on the frame edges nearest to them. */
export function writeBaseHalfMp3Parts(bytes: Uint8Array, file: IBaseHalfMp3File, parts: readonly IBaseHalfMediaPart[]): Uint8Array {
	const { version, channels } = file;
	const sideSize = sideInfoSize(version, channels);
	const reserveLimit = version === 1 ? 511 : 255;
	const bitrates = version === 1 ? BITRATES_V1 : BITRATES_V2;
	// Every frame's slot after its side information, one after the other: where the frames' data lies.
	const slotOffsets = new Map<IBaseHalfMp3Frame, number>();
	let stream = 0;
	for (const frame of file.allFrames) {
		slotOffsets.set(frame, stream);
		stream += frame.offset + frame.size - (frame.sideInfoOffset + sideSize);
	}
	const slots = new Uint8Array(stream);
	for (const frame of file.allFrames) {
		slots.set(bytes.subarray(frame.sideInfoOffset + sideSize, frame.offset + frame.size), slotOffsets.get(frame)!);
	}

	interface IOutFrame { readonly header: Uint8Array; readonly side: Uint8Array; readonly slot: Uint8Array; readonly bitrateIndex: number }
	const out: IOutFrame[] = [];
	const outSlots: Uint8Array[] = [];
	// The output's slots taken as one stream: where the next frame's data is written, and where the next slot starts.
	let written = 0;
	let slotStart = 0;
	const top = bitrates.length - 1;
	const slotLength = (index: number, padding: boolean) => frameSize(version, index, file.sampleRate, padding) - 4 - sideSize;
	const emit = (header: Uint8Array, side: Uint8Array, bitrateIndex: number, padding: boolean): Uint8Array => {
		const slot = new Uint8Array(slotLength(bitrateIndex, padding));
		outSlots.push(slot);
		out.push({ header: withBitrate(header, bitrateIndex, padding), side, slot, bitrateIndex });
		slotStart += slot.length;
		return slot;
	};
	const place = (header: Uint8Array, side: Uint8Array, data: Uint8Array, attempt = 0): void => {
		// The data starts as early as the reserve allows, and no earlier than its limit before the frame's slot.
		written = Math.max(written, slotStart - reserveLimit);
		// The frame keeps its bitrate and padding, unless its data needs a larger slot.
		let bitrateIndex = header[2] >> 4;
		let padding = ((header[2] >> 1) & 1) === 1;
		while (written + data.length > slotStart + slotLength(bitrateIndex, padding) && bitrateIndex < top) {
			bitrateIndex++;
			padding = false;
		}
		if (written + data.length > slotStart + slotLength(bitrateIndex, padding)) {
			if (attempt > 2 || data.length > reserveLimit + slotLength(top, false)) {
				// No layout holds it: a frame no decoder could play either.
				return;
			}
			// Not even the highest bitrate holds the data with what the reserve gives: a frame of silence before it carries the rest.
			const silence = new Uint8Array(sideSize);
			writeBits(silence, 0, version === 1 ? 9 : 8, slotStart - written);
			emit(header, silence, top, false);
			place(header, side, data, attempt + 1);
			return;
		}
		const frameSide = side.slice();
		writeBits(frameSide, 0, version === 1 ? 9 : 8, slotStart - written);
		emit(header, frameSide, bitrateIndex, padding);
		// The data goes into the reserve at the end of the slots before, and on into this one.
		writeStream(outSlots, written, data);
		written += data.length;
	};
	for (const { frame: index, fade } of keptFrames(file, parts)) {
		const frame = file.frames[index];
		const side = bytes.slice(frame.sideInfoOffset, frame.sideInfoOffset + sideSize);
		const info = readSideInfo(side, version, channels);
		const begin = slotOffsets.get(frame)! - info.mainDataBegin;
		const length = Math.ceil(info.mainDataBits / 8);
		// A frame whose data lies before the first frame, or past the stream, is not one a decoder can play: it is left out.
		if (begin < 0 || begin + length > slots.length) {
			continue;
		}
		for (const gain of info.gains) {
			if (fade[gain.granule]) {
				writeBits(side, gain.position, 8, Math.max(0, gain.value - fade[gain.granule]));
			}
		}
		place(frame.header, side, slots.subarray(begin, begin + length));
	}
	if (!out.length) {
		return concatBytes([file.head, file.tail]);
	}
	const frames = out.map(frame => concatBytes([frame.header, frame.side, frame.slot]));
	const info = infoFrame(file, frames, out.every(frame => frame.bitrateIndex === out[0].bitrateIndex));
	return concatBytes([file.head, info, ...frames, file.tail]);
}

/** Writes bytes into the output's slots, from a place in them taken as one stream. */
function writeStream(slots: readonly Uint8Array[], at: number, data: Uint8Array): void {
	let offset = 0;
	let position = at;
	for (const slot of slots) {
		if (offset + slot.length <= position) {
			offset += slot.length;
			continue;
		}
		const inside = position - offset;
		const count = Math.min(slot.length - inside, data.length - (position - at));
		slot.set(data.subarray(position - at, position - at + count), inside);
		position += count;
		offset += slot.length;
		if (position - at >= data.length) {
			return;
		}
	}
}

/** A copy of a frame header with a bitrate and a padding, and no check after it. */
function withBitrate(header: Uint8Array, bitrateIndex: number, padding: boolean): Uint8Array {
	const copy = header.slice(0, 4);
	copy[1] |= 0x01;
	copy[2] = (copy[2] & 0x0d) | (bitrateIndex << 4) | (padding ? 0x02 : 0);
	return copy;
}

/** The Info frame, or the Xing frame of a file whose frames have several bitrates: how many frames, how many bytes, and where each hundredth of them starts. */
function infoFrame(file: IBaseHalfMp3File, frames: readonly Uint8Array[], constant: boolean): Uint8Array {
	const { version, channels, sampleRate } = file;
	const sideSize = sideInfoSize(version, channels);
	const bitrates = version === 1 ? BITRATES_V1 : BITRATES_V2;
	let bitrateIndex = 1;
	while (frameSize(version, bitrateIndex, sampleRate, false) < 4 + sideSize + 120 && bitrateIndex < bitrates.length - 1) {
		bitrateIndex++;
	}
	const size = frameSize(version, bitrateIndex, sampleRate, false);
	const frame = new Uint8Array(size);
	frame.set(withBitrate(file.frames[0].header, bitrateIndex, false));
	const view = new DataView(frame.buffer);
	let at = 4 + sideSize;
	frame.set(Array.from(constant ? 'Info' : 'Xing', character => character.charCodeAt(0)), at);
	view.setUint32(at + 4, 0x7);
	view.setUint32(at + 8, frames.length);
	const total = size + frames.reduce((sum, bytes) => sum + bytes.length, 0);
	view.setUint32(at + 12, total);
	at += 16;
	const starts: number[] = [];
	let offset = size;
	for (const bytes of frames) {
		starts.push(offset);
		offset += bytes.length;
	}
	for (let index = 0; index < 100; index++) {
		const start = starts[Math.min(starts.length - 1, Math.floor(index * starts.length / 100))] ?? 0;
		frame[at + index] = Math.min(255, Math.floor(start * 256 / total));
	}
	return frame;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}
