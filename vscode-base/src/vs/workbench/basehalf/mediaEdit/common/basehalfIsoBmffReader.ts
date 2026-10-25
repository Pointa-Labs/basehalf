/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { BaseHalfByteReader } from './basehalfVideoBytes.js';
import { baseHalfAv1Codec, baseHalfAvcCodec, baseHalfHevcCodec, baseHalfMpeg4AudioCodec, baseHalfOpusHeadFromDops, baseHalfReadAudioSpecificConfig, baseHalfVp9Codec } from './basehalfVideoCodecs.js';
import { BaseHalfVideoFileError, IBaseHalfVideoByteSource, IBaseHalfVideoFile, IBaseHalfVideoSample, IBaseHalfVideoTrack } from './basehalfVideoFile.js';

/**
 * Reads an MP4, M4V, or MOV file (ISO/IEC 14496-12 and the QuickTime file
 * format) for a clip: the first picture and the first sound of its movie,
 * with every sample's place in the file and the time it is shown at after the
 * track's edit list, from its sample tables and from the fragments that follow
 * the movie; and the movie's `udta` and `meta` boxes, which a clip copies.
 * Only the boxes are read, never the samples.
 */

/** More than this in the movie's index, or in its fragments' indexes, is not read. */
const MAX_INDEX_BYTES = 64 * 1024 * 1024;
const MAX_TOP_LEVEL_BOXES = 200_000;

interface IBox {
	readonly type: string;
	/** Where the box starts, and where its body starts and it ends, in the bytes it is read from. */
	readonly start: number;
	readonly body: number;
	readonly end: number;
}

interface ITrackDefaults {
	readonly duration: number;
	readonly size: number;
	readonly flags: number;
}

interface IEdit {
	/** In the movie's units. */
	readonly segmentDuration: number;
	/** In the track's units; -1 for an empty edit. */
	readonly mediaTime: number;
	readonly rate: number;
}

interface IRawSample {
	offset: number;
	size: number;
	decodeTime: number;
	compositionOffset: number;
	duration: number;
	key: boolean;
}

interface ITrackParts {
	readonly id: number;
	readonly enabled: boolean;
	readonly handler: string;
	readonly timescale: number;
	readonly width: number;
	readonly height: number;
	readonly matrix: readonly number[];
	readonly edits: readonly IEdit[];
	readonly entry: IBox | undefined;
	readonly samples: IRawSample[];
}

function* boxesIn(bytes: Uint8Array, start: number, end: number): Generator<IBox> {
	let offset = start;
	while (offset + 8 <= end) {
		const reader = new BaseHalfByteReader(bytes, offset, end);
		let size = reader.u32();
		const type = reader.fourcc();
		let header = 8;
		if (size === 1) {
			if (offset + 16 > end) {
				return;
			}
			size = reader.u64();
			header = 16;
		} else if (size === 0) {
			size = end - offset;
		}
		if (size < header || offset + size > end) {
			return;
		}
		yield { type, start: offset, body: offset + header, end: offset + size };
		offset += size;
	}
}

function childOf(bytes: Uint8Array, parent: IBox, ...path: string[]): IBox | undefined {
	let current: IBox | undefined = parent;
	for (const type of path) {
		let found: IBox | undefined;
		for (const box of boxesIn(bytes, current.body, current.end)) {
			if (box.type === type) {
				found = box;
				break;
			}
		}
		if (!found) {
			return undefined;
		}
		current = found;
	}
	return current;
}

function childrenOf(bytes: Uint8Array, parent: IBox, type: string): IBox[] {
	return [...boxesIn(bytes, parent.body, parent.end)].filter(box => box.type === type);
}

function bodyOf(bytes: Uint8Array, box: IBox): Uint8Array {
	return bytes.subarray(box.body, box.end);
}

/** The boxes at the top of the file, by their headers alone. */
async function topLevelBoxes(source: IBaseHalfVideoByteSource): Promise<IBox[]> {
	const boxes: IBox[] = [];
	let offset = 0;
	while (offset + 8 <= source.size) {
		if (boxes.length >= MAX_TOP_LEVEL_BOXES) {
			throw new BaseHalfVideoFileError('tooLarge');
		}
		const header = await source.read(offset, Math.min(16, source.size - offset));
		const reader = new BaseHalfByteReader(header);
		let size = reader.u32();
		const type = reader.fourcc();
		let headerSize = 8;
		if (size === 1) {
			if (header.length < 16) {
				break;
			}
			size = reader.u64();
			headerSize = 16;
		} else if (size === 0) {
			size = source.size - offset;
		}
		if (size < headerSize || !/^[\x20-\x7E]{4}$/.test(type)) {
			if (!boxes.length) {
				throw new BaseHalfVideoFileError('format');
			}
			// What follows a damaged box is not read.
			break;
		}
		boxes.push({ type, start: offset, body: offset + headerSize, end: Math.min(offset + size, source.size) });
		offset += size;
	}
	return boxes;
}

/** Reads the picture and the first sound of an MP4, M4V, or MOV file. */
export async function readBaseHalfIsoBmffFile(source: IBaseHalfVideoByteSource, format: 'mp4' | 'mov', options?: { readonly soundOnly?: boolean }): Promise<IBaseHalfVideoFile> {
	const top = await topLevelBoxes(source);
	const moovBox = top.find(box => box.type === 'moov');
	if (!moovBox) {
		throw new BaseHalfVideoFileError('format');
	}
	if (moovBox.end - moovBox.start > MAX_INDEX_BYTES) {
		throw new BaseHalfVideoFileError('tooLarge');
	}
	const moovBytes = await source.read(moovBox.start, moovBox.end - moovBox.start);
	const moov: IBox = { type: 'moov', start: 0, body: moovBox.body - moovBox.start, end: moovBytes.length };
	const mvhd = childOf(moovBytes, moov, 'mvhd');
	if (!mvhd) {
		throw new BaseHalfVideoFileError('format');
	}
	const movieTimescale = readMvhdTimescale(moovBytes, mvhd);

	const defaults = new Map<number, ITrackDefaults>();
	const mvex = childOf(moovBytes, moov, 'mvex');
	if (mvex) {
		for (const trex of childrenOf(moovBytes, mvex, 'trex')) {
			const reader = new BaseHalfByteReader(moovBytes, trex.body, trex.end);
			reader.skip(4);
			const id = reader.u32();
			reader.skip(4);
			defaults.set(id, { duration: reader.u32(), size: reader.u32(), flags: reader.u32() });
		}
	}

	const tracks = childrenOf(moovBytes, moov, 'trak').map(trak => readTrack(moovBytes, trak));
	const fragments = top.filter(box => box.type === 'moof');
	if (fragments.length) {
		let budget = MAX_INDEX_BYTES;
		for (const fragment of fragments) {
			budget -= fragment.end - fragment.start;
			if (budget < 0) {
				throw new BaseHalfVideoFileError('tooLarge');
			}
			const bytes = await source.read(fragment.start, fragment.end - fragment.start);
			readFragment(bytes, fragment.start, tracks, defaults);
		}
	}

	const pick = (handler: string) => {
		const candidates = tracks.filter(track => track.handler === handler && track.samples.length > 0);
		return candidates.find(track => track.enabled) ?? candidates[0];
	};
	const video = pick('vide');
	const audio = pick('soun');
	// A sound file, as an M4A, has a sound and no picture; a video needs a picture.
	if (!video && !(options?.soundOnly && audio)) {
		throw new BaseHalfVideoFileError('noPicture');
	}
	const metadata = [...boxesIn(moovBytes, moov.body, moov.end)]
		.filter(box => box.type === 'udta' || box.type === 'meta')
		.map(box => moovBytes.slice(box.start, box.end));
	return {
		format,
		video: video ? toTrack(moovBytes, video, movieTimescale, 'video') : undefined,
		audio: audio ? toTrack(moovBytes, audio, movieTimescale, 'audio') : undefined,
		metadata
	};
}

function readMvhdTimescale(bytes: Uint8Array, mvhd: IBox): number {
	const reader = new BaseHalfByteReader(bytes, mvhd.body, mvhd.end);
	const version = reader.u8();
	reader.skip(3);
	reader.skip(version === 1 ? 16 : 8);
	return reader.u32() || 1000;
}

function readTrack(bytes: Uint8Array, trak: IBox): ITrackParts {
	const tkhd = childOf(bytes, trak, 'tkhd');
	let id = 0;
	let enabled = true;
	let width = 0;
	let height = 0;
	let matrix: number[] = [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000];
	if (tkhd) {
		const reader = new BaseHalfByteReader(bytes, tkhd.body, tkhd.end);
		const version = reader.u8();
		const flags = reader.u24();
		enabled = (flags & 1) !== 0;
		reader.skip(version === 1 ? 16 : 8);
		id = reader.u32();
		reader.skip(4);
		reader.skip(version === 1 ? 8 : 4);
		reader.skip(8 + 2 + 2 + 2 + 2);
		matrix = [];
		for (let index = 0; index < 9; index++) {
			matrix.push(reader.i32());
		}
		width = reader.u32() / 0x10000;
		height = reader.u32() / 0x10000;
	}
	const mdhd = childOf(bytes, trak, 'mdia', 'mdhd');
	let timescale = 1;
	if (mdhd) {
		const reader = new BaseHalfByteReader(bytes, mdhd.body, mdhd.end);
		const version = reader.u8();
		reader.skip(3);
		reader.skip(version === 1 ? 16 : 8);
		timescale = reader.u32() || 1;
	}
	const hdlr = childOf(bytes, trak, 'mdia', 'hdlr');
	let handler = '';
	if (hdlr) {
		const reader = new BaseHalfByteReader(bytes, hdlr.body, hdlr.end);
		reader.skip(8);
		handler = reader.fourcc();
	}
	const edits: IEdit[] = [];
	const elst = childOf(bytes, trak, 'edts', 'elst');
	if (elst) {
		const reader = new BaseHalfByteReader(bytes, elst.body, elst.end);
		const version = reader.u8();
		reader.skip(3);
		const count = reader.u32();
		for (let index = 0; index < count && reader.remaining >= (version === 1 ? 20 : 12); index++) {
			const segmentDuration = version === 1 ? reader.u64() : reader.u32();
			const mediaTime = version === 1 ? reader.i64() : reader.i32();
			const rate = reader.i16() + reader.u16() / 0x10000;
			edits.push({ segmentDuration, mediaTime, rate });
		}
	}
	const stbl = childOf(bytes, trak, 'mdia', 'minf', 'stbl');
	const stsd = stbl && childOf(bytes, stbl, 'stsd');
	const entry = stsd ? [...boxesIn(bytes, stsd.body + 8, stsd.end)][0] : undefined;
	return {
		id,
		enabled,
		handler,
		timescale,
		width,
		height,
		matrix,
		edits,
		entry,
		samples: stbl ? readSampleTables(bytes, stbl) : []
	};
}

/** The samples a track's sample tables describe, in the order they are decoded. */
function readSampleTables(bytes: Uint8Array, stbl: IBox): IRawSample[] {
	const sizes: number[] = [];
	const stsz = childOf(bytes, stbl, 'stsz');
	const stz2 = childOf(bytes, stbl, 'stz2');
	if (stsz) {
		const reader = new BaseHalfByteReader(bytes, stsz.body, stsz.end);
		reader.skip(4);
		const fixed = reader.u32();
		const count = reader.u32();
		for (let index = 0; index < count; index++) {
			sizes.push(fixed || reader.u32());
		}
	} else if (stz2) {
		const reader = new BaseHalfByteReader(bytes, stz2.body, stz2.end);
		reader.skip(4 + 3);
		const fieldSize = reader.u8();
		const count = reader.u32();
		for (let index = 0; index < count; index++) {
			if (fieldSize === 4) {
				const byte = bytes[reader.position + (index >> 1)];
				sizes.push(index & 1 ? byte & 0x0F : byte >> 4);
			} else {
				sizes.push(fieldSize === 8 ? reader.u8() : reader.u16());
			}
		}
	}
	if (!sizes.length) {
		return [];
	}

	const samples: IRawSample[] = sizes.map(size => ({ offset: 0, size, decodeTime: 0, compositionOffset: 0, duration: 0, key: true }));
	const stts = childOf(bytes, stbl, 'stts');
	if (!stts) {
		throw new BaseHalfVideoFileError('format');
	}
	{
		const reader = new BaseHalfByteReader(bytes, stts.body, stts.end);
		reader.skip(4);
		const count = reader.u32();
		let index = 0;
		let time = 0;
		for (let entry = 0; entry < count; entry++) {
			const run = reader.u32();
			const delta = reader.u32();
			for (let repeat = 0; repeat < run && index < samples.length; repeat++, index++) {
				samples[index].decodeTime = time;
				samples[index].duration = delta;
				time += delta;
			}
		}
		if (index !== samples.length) {
			throw new BaseHalfVideoFileError('format');
		}
	}
	const ctts = childOf(bytes, stbl, 'ctts');
	if (ctts) {
		const reader = new BaseHalfByteReader(bytes, ctts.body, ctts.end);
		reader.skip(4);
		const count = reader.u32();
		let index = 0;
		for (let entry = 0; entry < count; entry++) {
			const run = reader.u32();
			// Some writers put negative offsets in a version 0 table: both read as signed.
			const offset = reader.i32();
			for (let repeat = 0; repeat < run && index < samples.length; repeat++, index++) {
				samples[index].compositionOffset = offset;
			}
		}
	}
	const stss = childOf(bytes, stbl, 'stss');
	if (stss) {
		for (const sample of samples) {
			sample.key = false;
		}
		const reader = new BaseHalfByteReader(bytes, stss.body, stss.end);
		reader.skip(4);
		const count = reader.u32();
		for (let entry = 0; entry < count; entry++) {
			const number = reader.u32();
			if (number >= 1 && number <= samples.length) {
				samples[number - 1].key = true;
			}
		}
	}
	const chunkOffsets: number[] = [];
	const stco = childOf(bytes, stbl, 'stco');
	const co64 = childOf(bytes, stbl, 'co64');
	const offsets = stco ?? co64;
	if (!offsets) {
		throw new BaseHalfVideoFileError('format');
	}
	{
		const reader = new BaseHalfByteReader(bytes, offsets.body, offsets.end);
		reader.skip(4);
		const count = reader.u32();
		for (let index = 0; index < count; index++) {
			chunkOffsets.push(stco ? reader.u32() : reader.u64());
		}
	}
	const stsc = childOf(bytes, stbl, 'stsc');
	if (!stsc) {
		throw new BaseHalfVideoFileError('format');
	}
	{
		const reader = new BaseHalfByteReader(bytes, stsc.body, stsc.end);
		reader.skip(4);
		const count = reader.u32();
		const entries: { firstChunk: number; samplesPerChunk: number; description: number }[] = [];
		for (let index = 0; index < count; index++) {
			entries.push({ firstChunk: reader.u32(), samplesPerChunk: reader.u32(), description: reader.u32() });
		}
		if (entries.some(entry => entry.description !== 1)) {
			// Samples of a second description need a decoder of their own.
			throw new BaseHalfVideoFileError('format');
		}
		let sample = 0;
		for (let entry = 0; entry < entries.length; entry++) {
			const lastChunk = entry + 1 < entries.length ? entries[entry + 1].firstChunk - 1 : chunkOffsets.length;
			for (let chunk = entries[entry].firstChunk; chunk <= lastChunk; chunk++) {
				let offset = chunkOffsets[chunk - 1];
				for (let repeat = 0; repeat < entries[entry].samplesPerChunk && sample < samples.length; repeat++, sample++) {
					samples[sample].offset = offset;
					offset += samples[sample].size;
				}
			}
		}
		if (sample !== samples.length) {
			throw new BaseHalfVideoFileError('format');
		}
	}
	return samples;
}

/** Adds the samples of a movie fragment (`moof`) to its tracks. */
function readFragment(bytes: Uint8Array, fileOffset: number, tracks: readonly ITrackParts[], defaults: ReadonlyMap<number, ITrackDefaults>): void {
	const moof: IBox = { type: 'moof', start: 0, body: 8, end: bytes.length };
	for (const traf of childrenOf(bytes, moof, 'traf')) {
		const tfhd = childOf(bytes, traf, 'tfhd');
		if (!tfhd) {
			continue;
		}
		const header = new BaseHalfByteReader(bytes, tfhd.body, tfhd.end);
		header.skip(1);
		const flags = header.u24();
		const trackId = header.u32();
		const track = tracks.find(candidate => candidate.id === trackId);
		if (!track) {
			continue;
		}
		const trackDefaults = defaults.get(trackId) ?? { duration: 0, size: 0, flags: 0 };
		let base = fileOffset;
		if (flags & 0x01) {
			base = header.u64();
		}
		if (flags & 0x02) {
			header.skip(4);
		}
		const defaultDuration = flags & 0x08 ? header.u32() : trackDefaults.duration;
		const defaultSize = flags & 0x10 ? header.u32() : trackDefaults.size;
		const defaultFlags = flags & 0x20 ? header.u32() : trackDefaults.flags;
		let decodeTime = track.samples.length
			? track.samples[track.samples.length - 1].decodeTime + track.samples[track.samples.length - 1].duration
			: 0;
		const tfdt = childOf(bytes, traf, 'tfdt');
		if (tfdt) {
			const reader = new BaseHalfByteReader(bytes, tfdt.body, tfdt.end);
			const version = reader.u8();
			reader.skip(3);
			decodeTime = version === 1 ? reader.u64() : reader.u32();
		}
		let dataOffset = base;
		for (const trun of childrenOf(bytes, traf, 'trun')) {
			const reader = new BaseHalfByteReader(bytes, trun.body, trun.end);
			const version = reader.u8();
			const runFlags = reader.u24();
			const count = reader.u32();
			if (runFlags & 0x01) {
				dataOffset = base + reader.i32();
			}
			const firstFlags = runFlags & 0x04 ? reader.u32() : undefined;
			for (let index = 0; index < count; index++) {
				const duration = runFlags & 0x100 ? reader.u32() : defaultDuration;
				const size = runFlags & 0x200 ? reader.u32() : defaultSize;
				const sampleFlags = runFlags & 0x400 ? reader.u32() : index === 0 && firstFlags !== undefined ? firstFlags : defaultFlags;
				const compositionOffset = runFlags & 0x800 ? (version === 0 ? reader.u32() : reader.i32()) : 0;
				track.samples.push({
					offset: dataOffset,
					size,
					decodeTime,
					compositionOffset,
					duration,
					// sample_is_non_sync_sample
					key: (sampleFlags & 0x10000) === 0
				});
				dataOffset += size;
				decodeTime += duration;
			}
		}
	}
}

/** A track as a clip reads it: its samples at the times they are shown, after the edit list, and its codec. */
function toTrack(bytes: Uint8Array, parts: ITrackParts, movieTimescale: number, kind: 'video' | 'audio'): IBaseHalfVideoTrack {
	// Empty edits at the start delay the track; the first edit with media says where it starts and how long it is shown.
	let delay = 0;
	let mediaStart = 0;
	let shown: number | undefined;
	let index = 0;
	for (; index < parts.edits.length && parts.edits[index].mediaTime === -1; index++) {
		delay += parts.edits[index].segmentDuration;
	}
	const media = parts.edits.slice(index);
	if (media.length) {
		if (media.length > 1 || media[0].rate !== 1) {
			throw new BaseHalfVideoFileError('unsupportedEditList');
		}
		mediaStart = media[0].mediaTime;
		// A segment of 0 is written by some programs for "to the end".
		shown = media[0].segmentDuration > 0 ? media[0].segmentDuration * parts.timescale / movieTimescale : undefined;
	}
	const delayInTrack = Math.round(delay * parts.timescale / movieTimescale);
	const samples: IBaseHalfVideoSample[] = parts.samples.map(sample => Object.freeze({
		offset: sample.offset,
		size: sample.size,
		decodeTime: sample.decodeTime,
		time: sample.decodeTime + sample.compositionOffset - mediaStart + delayInTrack,
		duration: sample.duration,
		key: kind === 'audio' || sample.key
	}));
	const entry = parts.entry;
	const description = entry ? sampleEntryDescription(bytes, entry, kind) : { format: '', codec: undefined, description: undefined, width: 0, height: 0, sampleRate: 0, channels: 0 };
	const rotation = matrixRotation(parts.matrix);
	const rotated = rotation === 90 || rotation === 270;
	const displayWidth = parts.width || description.width;
	const displayHeight = parts.height || description.height;
	return Object.freeze({
		kind,
		format: description.format,
		codec: description.codec,
		description: description.description,
		timescale: parts.timescale,
		samples: Object.freeze(samples),
		width: description.width,
		height: description.height,
		displayWidth: rotated ? displayHeight : displayWidth,
		displayHeight: rotated ? displayWidth : displayHeight,
		matrix: isIdentity(parts.matrix) ? undefined : Object.freeze([...parts.matrix]),
		rotation,
		sampleRate: description.sampleRate,
		channels: description.channels,
		end: shown !== undefined ? Math.round(delayInTrack + shown) : undefined
	});
}

function isIdentity(matrix: readonly number[]): boolean {
	const identity = [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000];
	return matrix.every((value, index) => value === identity[index]);
}

/** How far a track's matrix turns its picture clockwise, to the nearest quarter. */
function matrixRotation(matrix: readonly number[]): 0 | 90 | 180 | 270 {
	const degrees = Math.round(Math.atan2(matrix[1], matrix[0]) * 180 / Math.PI / 90) * 90;
	switch ((degrees + 360) % 360) {
		case 90: return 90;
		case 180: return 180;
		case 270: return 270;
		default: return 0;
	}
}

interface ISampleEntryDescription {
	readonly format: string;
	readonly codec: string | undefined;
	readonly description: Uint8Array | undefined;
	readonly width: number;
	readonly height: number;
	readonly sampleRate: number;
	readonly channels: number;
}

function sampleEntryDescription(bytes: Uint8Array, entry: IBox, kind: 'video' | 'audio'): ISampleEntryDescription {
	const format = entry.type;
	if (kind === 'video') {
		const reader = new BaseHalfByteReader(bytes, entry.body, entry.end);
		reader.skip(24);
		const width = reader.u16();
		const height = reader.u16();
		const children: IBox = { type: format, start: entry.start, body: entry.body + 78, end: entry.end };
		const config = (type: string) => {
			const box = childOf(bytes, children, type);
			return box ? bodyOf(bytes, box) : undefined;
		};
		let codec: string | undefined;
		let description: Uint8Array | undefined;
		switch (format) {
			case 'avc1':
			case 'avc3': {
				description = config('avcC');
				codec = description ? baseHalfAvcCodec(format, description) : undefined;
				break;
			}
			case 'hvc1':
			case 'hev1': {
				description = config('hvcC');
				codec = description ? baseHalfHevcCodec(format, description) : undefined;
				break;
			}
			case 'vp09':
				codec = baseHalfVp9Codec(config('vpcC'));
				break;
			case 'vp08':
				codec = 'vp8';
				break;
			case 'av01': {
				description = config('av1C');
				codec = description ? baseHalfAv1Codec(description) : undefined;
				break;
			}
		}
		return { format, codec, description: description?.slice(), width, height, sampleRate: 0, channels: 0 };
	}
	const reader = new BaseHalfByteReader(bytes, entry.body, entry.end);
	reader.skip(8);
	const version = reader.u16();
	reader.skip(6);
	let channels = reader.u16();
	reader.skip(6);
	let sampleRate = reader.u32() / 0x10000;
	let childStart = entry.body + 28;
	if (version === 1) {
		childStart = entry.body + 44;
	} else if (version === 2) {
		const v2 = new BaseHalfByteReader(bytes, entry.body + 32, entry.end);
		sampleRate = v2.f64();
		channels = v2.u32();
		childStart = entry.body + 64;
	}
	const children: IBox = { type: format, start: entry.start, body: childStart, end: entry.end };
	let codec: string | undefined;
	let description: Uint8Array | undefined;
	switch (format) {
		case 'mp4a': {
			const esds = childOf(bytes, children, 'esds') ?? (() => {
				const wave = childOf(bytes, children, 'wave');
				return wave ? childOf(bytes, wave, 'esds') : undefined;
			})();
			const decoder = esds ? readEsds(bodyOf(bytes, esds)) : undefined;
			if (decoder) {
				codec = baseHalfMpeg4AudioCodec(decoder.objectTypeIndication, decoder.config);
				description = decoder.config?.slice();
				const config = decoder.config ? baseHalfReadAudioSpecificConfig(decoder.config) : undefined;
				if (config?.sampleRate && !sampleRate) {
					sampleRate = config.sampleRate;
				}
				if (config?.channels && !channels) {
					channels = config.channels;
				}
			}
			break;
		}
		case 'Opus': {
			const dOps = childOf(bytes, children, 'dOps');
			description = dOps ? baseHalfOpusHeadFromDops(bodyOf(bytes, dOps)) : undefined;
			codec = description ? 'opus' : undefined;
			sampleRate = 48000;
			break;
		}
		case '.mp3':
			codec = 'mp3';
			break;
		case 'fLaC': {
			const dfLa = childOf(bytes, children, 'dfLa');
			if (dfLa) {
				const blocks = bytes.subarray(dfLa.body + 4, dfLa.end);
				description = new Uint8Array(4 + blocks.length);
				description.set([0x66, 0x4C, 0x61, 0x43], 0);
				description.set(blocks, 4);
				codec = 'flac';
			}
			break;
		}
	}
	return { format, codec, description, width: 0, height: 0, sampleRate: Math.round(sampleRate), channels };
}

/** The decoder configuration of an `esds` box: the object type and the decoder's own configuration. */
function readEsds(body: Uint8Array): { readonly objectTypeIndication: number; readonly config: Uint8Array | undefined } | undefined {
	try {
		const reader = new BaseHalfByteReader(body);
		reader.skip(4);
		const length = () => {
			let value = 0;
			for (let index = 0; index < 4; index++) {
				const byte = reader.u8();
				value = (value << 7) | (byte & 0x7F);
				if (!(byte & 0x80)) {
					break;
				}
			}
			return value;
		};
		if (reader.u8() !== 0x03) {
			return undefined;
		}
		length();
		reader.skip(2);
		const flags = reader.u8();
		if (flags & 0x80) {
			reader.skip(2);
		}
		if (flags & 0x40) {
			reader.skip(reader.u8());
		}
		if (flags & 0x20) {
			reader.skip(2);
		}
		if (reader.u8() !== 0x04) {
			return undefined;
		}
		length();
		const objectTypeIndication = reader.u8();
		reader.skip(1 + 3 + 4 + 4);
		let config: Uint8Array | undefined;
		if (reader.remaining > 2 && reader.u8() === 0x05) {
			const size = length();
			config = reader.slice(Math.min(size, reader.remaining));
		}
		return { objectTypeIndication, config };
	} catch {
		return undefined;
	}
}
