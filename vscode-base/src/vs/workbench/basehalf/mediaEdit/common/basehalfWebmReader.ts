/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { baseHalfAv1Codec, baseHalfAvcCodec, baseHalfHevcCodec, baseHalfVp9Codec } from './basehalfVideoCodecs.js';
import { BaseHalfVideoFileError, IBaseHalfVideoByteSource, IBaseHalfVideoFile, IBaseHalfVideoSample, IBaseHalfVideoTrack } from './basehalfVideoFile.js';

/**
 * Reads a WebM file (Matroska with WebM's codecs) for a clip: the first
 * picture and the first sound, each block's place in the file and the time it
 * is shown at, from the clusters of the whole file. WebM has no index of every
 * block, so the file is read through, but only the headers of the blocks.
 * Clusters of unknown size, which a recording in progress writes, end where
 * the next cluster starts.
 */

const EBML = 0x1A45DFA3;
const SEGMENT = 0x18538067;
const INFO = 0x1549A966;
const TIMESTAMP_SCALE = 0x2AD7B1;
const TRACKS = 0x1654AE6B;
const TRACK_ENTRY = 0xAE;
const TRACK_NUMBER = 0xD7;
const TRACK_TYPE = 0x83;
const FLAG_ENABLED = 0xB9;
const CODEC_ID = 0x86;
const CODEC_PRIVATE = 0x63A2;
const DEFAULT_DURATION = 0x23E383;
const CODEC_DELAY = 0x56AA;
const VIDEO = 0xE0;
const PIXEL_WIDTH = 0xB0;
const PIXEL_HEIGHT = 0xBA;
const DISPLAY_WIDTH = 0x54B0;
const DISPLAY_HEIGHT = 0x54BA;
const AUDIO = 0xE1;
const SAMPLING_FREQUENCY = 0xB5;
const CHANNELS = 0x9F;
const CLUSTER = 0x1F43B675;
const CLUSTER_TIMESTAMP = 0xE7;
const SIMPLE_BLOCK = 0xA3;
const BLOCK_GROUP = 0xA0;
const BLOCK = 0xA1;
const REFERENCE_BLOCK = 0xFB;
const BLOCK_DURATION = 0x9B;
const DISCARD_PADDING = 0x75A2;

/** The elements that only stand at the level of the segment: one of them ends a cluster of unknown size. */
const SEGMENT_LEVEL = new Set([0x114D9B74, INFO, TRACKS, CLUSTER, 0x1C53BB6B, 0x1043A770, 0x1254C367, 0x1941A469]);
const UNKNOWN_SIZE = -1;
const WINDOW = 1024 * 1024;
const MAX_BLOCKS = 2_000_000;

/** Reads a file through a window of bytes that moves forward. */
class BaseHalfWindowReader {
	private window: Uint8Array = new Uint8Array(0);
	private windowStart = 0;

	constructor(private readonly source: IBaseHalfVideoByteSource) { }

	get size(): number {
		return this.source.size;
	}

	async bytes(offset: number, length: number): Promise<Uint8Array> {
		const end = Math.min(offset + length, this.source.size);
		if (offset < this.windowStart || end > this.windowStart + this.window.length) {
			this.windowStart = offset;
			this.window = await this.source.read(offset, Math.min(Math.max(WINDOW, end - offset), this.source.size - offset));
		}
		return this.window.subarray(offset - this.windowStart, end - this.windowStart);
	}
}

interface IElementHeader {
	readonly id: number;
	/** Where its data starts and how long it is; `UNKNOWN_SIZE` for an element that does not say. */
	readonly dataStart: number;
	readonly size: number;
}

async function readElementHeader(reader: BaseHalfWindowReader, offset: number): Promise<IElementHeader | undefined> {
	const bytes = await reader.bytes(offset, 12);
	if (bytes.length < 2) {
		return undefined;
	}
	const idLength = vintLength(bytes[0]);
	if (idLength > 4 || idLength > bytes.length) {
		return undefined;
	}
	let id = 0;
	for (let index = 0; index < idLength; index++) {
		id = id * 256 + bytes[index];
	}
	const sizeLength = vintLength(bytes[idLength]);
	if (sizeLength > 8 || idLength + sizeLength > bytes.length) {
		return undefined;
	}
	let size = bytes[idLength] & (0xFF >> sizeLength);
	let allOnes = size === (0xFF >> sizeLength);
	for (let index = 1; index < sizeLength; index++) {
		const byte = bytes[idLength + index];
		size = size * 256 + byte;
		allOnes &&= byte === 0xFF;
	}
	return { id, dataStart: offset + idLength + sizeLength, size: allOnes ? UNKNOWN_SIZE : size };
}

/** The length of a variable-size integer from its first byte. */
function vintLength(first: number): number {
	for (let length = 1; length <= 8; length++) {
		if (first & (0x80 >> (length - 1))) {
			return length;
		}
	}
	return 9;
}

/** The children of an element that is read whole: their ids and data. */
function* elementsIn(bytes: Uint8Array): Generator<{ readonly id: number; readonly data: Uint8Array }> {
	let offset = 0;
	while (offset < bytes.length) {
		const idLength = vintLength(bytes[offset]);
		if (idLength > 4 || offset + idLength >= bytes.length) {
			return;
		}
		let id = 0;
		for (let index = 0; index < idLength; index++) {
			id = id * 256 + bytes[offset + index];
		}
		const sizeAt = offset + idLength;
		const sizeLength = vintLength(bytes[sizeAt]);
		if (sizeLength > 8 || sizeAt + sizeLength > bytes.length) {
			return;
		}
		let size = bytes[sizeAt] & (0xFF >> sizeLength);
		for (let index = 1; index < sizeLength; index++) {
			size = size * 256 + bytes[sizeAt + index];
		}
		const dataStart = sizeAt + sizeLength;
		const dataEnd = Math.min(bytes.length, dataStart + size);
		yield { id, data: bytes.subarray(dataStart, dataEnd) };
		offset = dataEnd;
	}
}

function unsigned(data: Uint8Array): number {
	let value = 0;
	for (const byte of data) {
		value = value * 256 + byte;
	}
	return value;
}

/** A signed integer in two's complement. */
function signed(data: Uint8Array): number {
	const value = unsigned(data);
	return data.length && data[0] & 0x80 ? value - 2 ** (8 * data.length) : value;
}

function float(data: Uint8Array): number {
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	return data.length === 4 ? view.getFloat32(0) : data.length === 8 ? view.getFloat64(0) : 0;
}

function text(data: Uint8Array): string {
	let value = '';
	for (const byte of data) {
		if (byte === 0) {
			break;
		}
		value += String.fromCharCode(byte);
	}
	return value;
}

interface ITrackEntry {
	readonly number: number;
	readonly type: number;
	readonly enabled: boolean;
	readonly codecId: string;
	readonly codecPrivate: Uint8Array | undefined;
	/** In nanoseconds. */
	readonly defaultDuration: number | undefined;
	readonly codecDelay: number;
	readonly width: number;
	readonly height: number;
	readonly displayWidth: number;
	readonly displayHeight: number;
	readonly sampleRate: number;
	readonly channels: number;
}

function readTrackEntry(data: Uint8Array): ITrackEntry {
	let number = 0;
	let type = 0;
	let enabled = true;
	let codecId = '';
	let codecPrivate: Uint8Array | undefined;
	let defaultDuration: number | undefined;
	let codecDelay = 0;
	let width = 0;
	let height = 0;
	let displayWidth = 0;
	let displayHeight = 0;
	let sampleRate = 8000;
	let channels = 1;
	for (const element of elementsIn(data)) {
		switch (element.id) {
			case TRACK_NUMBER: number = unsigned(element.data); break;
			case TRACK_TYPE: type = unsigned(element.data); break;
			case FLAG_ENABLED: enabled = unsigned(element.data) !== 0; break;
			case CODEC_ID: codecId = text(element.data); break;
			case CODEC_PRIVATE: codecPrivate = element.data.slice(); break;
			case DEFAULT_DURATION: defaultDuration = unsigned(element.data); break;
			case CODEC_DELAY: codecDelay = unsigned(element.data); break;
			case VIDEO:
				for (const video of elementsIn(element.data)) {
					switch (video.id) {
						case PIXEL_WIDTH: width = unsigned(video.data); break;
						case PIXEL_HEIGHT: height = unsigned(video.data); break;
						case DISPLAY_WIDTH: displayWidth = unsigned(video.data); break;
						case DISPLAY_HEIGHT: displayHeight = unsigned(video.data); break;
					}
				}
				break;
			case AUDIO:
				for (const audio of elementsIn(element.data)) {
					switch (audio.id) {
						case SAMPLING_FREQUENCY: sampleRate = float(audio.data); break;
						case CHANNELS: channels = unsigned(audio.data); break;
					}
				}
				break;
		}
	}
	return { number, type, enabled, codecId, codecPrivate, defaultDuration, codecDelay, width, height, displayWidth: displayWidth || width, displayHeight: displayHeight || height, sampleRate, channels };
}

interface IBlock {
	readonly offset: number;
	readonly size: number;
	/** In microseconds. */
	readonly time: number;
	readonly key: boolean;
	/** How long it lasts and how much of its end is padding, in microseconds, when its group says so. */
	readonly duration?: number;
	readonly discard?: number;
}

/** What a block group says of its block besides the block itself, in the units of the file's times and in nanoseconds. */
interface IBlockGroupInfo {
	readonly key: boolean;
	readonly duration: number | undefined;
	readonly discard: number | undefined;
}

/** Reads the picture and the first sound of a WebM file. */
export async function readBaseHalfWebmFile(source: IBaseHalfVideoByteSource): Promise<IBaseHalfVideoFile> {
	const reader = new BaseHalfWindowReader(source);
	const ebml = await readElementHeader(reader, 0);
	if (!ebml || ebml.id !== EBML || ebml.size === UNKNOWN_SIZE) {
		throw new BaseHalfVideoFileError('format');
	}
	const segment = await readElementHeader(reader, ebml.dataStart + ebml.size);
	if (!segment || segment.id !== SEGMENT) {
		throw new BaseHalfVideoFileError('format');
	}
	const segmentEnd = segment.size === UNKNOWN_SIZE ? source.size : Math.min(source.size, segment.dataStart + segment.size);

	let timestampScale = 1_000_000;
	const entries: ITrackEntry[] = [];
	const blocks = new Map<number, IBlock[]>();
	let blockCount = 0;
	const addBlock = (track: number, block: IBlock) => {
		if (++blockCount > MAX_BLOCKS) {
			throw new BaseHalfVideoFileError('tooLarge');
		}
		let list = blocks.get(track);
		if (!list) {
			list = [];
			blocks.set(track, list);
		}
		list.push(block);
	};

	let offset = segment.dataStart;
	while (offset < segmentEnd) {
		const element = await readElementHeader(reader, offset);
		if (!element) {
			break;
		}
		if (element.id === CLUSTER) {
			offset = await readCluster(reader, element, segmentEnd, timestampScale, entries, addBlock);
			continue;
		}
		if (element.size === UNKNOWN_SIZE) {
			break;
		}
		const end = element.dataStart + element.size;
		if (element.id === INFO || element.id === TRACKS) {
			const data = await source.read(element.dataStart, Math.min(element.size, source.size - element.dataStart));
			if (element.id === INFO) {
				for (const child of elementsIn(data)) {
					if (child.id === TIMESTAMP_SCALE) {
						timestampScale = unsigned(child.data) || 1_000_000;
					}
				}
			} else {
				for (const child of elementsIn(data)) {
					if (child.id === TRACK_ENTRY) {
						entries.push(readTrackEntry(child.data));
					}
				}
			}
		}
		offset = end;
	}

	const pick = (type: number) => {
		const candidates = entries.filter(entry => entry.type === type && (blocks.get(entry.number)?.length ?? 0) > 0);
		return candidates.find(entry => entry.enabled) ?? candidates[0];
	};
	const videoEntry = pick(1);
	if (!videoEntry) {
		throw new BaseHalfVideoFileError('noPicture');
	}
	const audioEntry = pick(2);
	const video = await toTrack(source, videoEntry, blocks.get(videoEntry.number)!, 'video');
	const audio = audioEntry ? await toTrack(source, audioEntry, blocks.get(audioEntry.number)!, 'audio') : undefined;
	return { format: 'webm', video, audio, metadata: [] };
}

/** Reads the blocks of a cluster and says where the element after it starts. */
async function readCluster(
	reader: BaseHalfWindowReader,
	cluster: IElementHeader,
	segmentEnd: number,
	timestampScale: number,
	entries: readonly ITrackEntry[],
	addBlock: (track: number, block: IBlock) => void
): Promise<number> {
	const end = cluster.size === UNKNOWN_SIZE ? segmentEnd : Math.min(segmentEnd, cluster.dataStart + cluster.size);
	let clusterTime = 0;
	let offset = cluster.dataStart;
	while (offset < end) {
		const element = await readElementHeader(reader, offset);
		if (!element) {
			return end;
		}
		if (cluster.size === UNKNOWN_SIZE && SEGMENT_LEVEL.has(element.id)) {
			return offset;
		}
		if (element.size === UNKNOWN_SIZE) {
			return end;
		}
		const elementEnd = element.dataStart + element.size;
		switch (element.id) {
			case CLUSTER_TIMESTAMP:
				clusterTime = unsigned(await reader.bytes(element.dataStart, element.size));
				break;
			case SIMPLE_BLOCK:
				await readBlock(reader, element.dataStart, element.size, undefined, clusterTime, timestampScale, entries, addBlock);
				break;
			case BLOCK_GROUP: {
				let blockAt: { start: number; size: number } | undefined;
				let referenced = false;
				let duration: number | undefined;
				let discard: number | undefined;
				let position = 0;
				// The group's children are read by their headers: the block's data can be long.
				while (position < element.size) {
					const child = await readElementHeader(reader, element.dataStart + position);
					if (!child || child.size === UNKNOWN_SIZE) {
						break;
					}
					if (child.id === BLOCK) {
						blockAt = { start: child.dataStart, size: child.size };
					} else if (child.id === REFERENCE_BLOCK) {
						referenced = true;
					} else if (child.id === BLOCK_DURATION) {
						duration = unsigned(await reader.bytes(child.dataStart, child.size));
					} else if (child.id === DISCARD_PADDING) {
						discard = signed(await reader.bytes(child.dataStart, child.size));
					}
					position = child.dataStart + child.size - element.dataStart;
				}
				if (blockAt) {
					await readBlock(reader, blockAt.start, blockAt.size, { key: !referenced, duration, discard }, clusterTime, timestampScale, entries, addBlock);
				}
				break;
			}
		}
		offset = elementEnd;
	}
	return end;
}

/** Reads a simple block, or the block of a group with what its group says. */
async function readBlock(
	reader: BaseHalfWindowReader,
	start: number,
	size: number,
	group: IBlockGroupInfo | undefined,
	clusterTime: number,
	timestampScale: number,
	entries: readonly ITrackEntry[],
	addBlock: (track: number, block: IBlock) => void
): Promise<void> {
	const header = await reader.bytes(start, Math.min(size, 4096));
	const numberLength = vintLength(header[0]);
	if (numberLength > 8 || numberLength + 3 > header.length) {
		return;
	}
	let track = header[0] & (0xFF >> numberLength);
	for (let index = 1; index < numberLength; index++) {
		track = track * 256 + header[index];
	}
	const relative = (header[numberLength] << 8 | header[numberLength + 1]) << 16 >> 16;
	const flags = header[numberLength + 2];
	const key = group ? group.key : (flags & 0x80) !== 0;
	const time = (clusterTime + relative) * timestampScale / 1000;
	let position = numberLength + 3;
	const lacing = (flags >> 1) & 3;
	if (lacing === 0) {
		addBlock(track, {
			offset: start + position,
			size: size - position,
			time,
			key,
			...(group?.duration !== undefined ? { duration: group.duration * timestampScale / 1000 } : {}),
			...(group?.discard !== undefined ? { discard: group.discard / 1000 } : {})
		});
		return;
	}
	const count = header[position++] + 1;
	const sizes: number[] = [];
	if (lacing === 1) {
		for (let index = 0; index < count - 1; index++) {
			let frame = 0;
			let byte: number;
			do {
				byte = header[position++];
				frame += byte;
			} while (byte === 255);
			sizes.push(frame);
		}
	} else if (lacing === 3) {
		const first = readVint(header, position);
		position += first.length;
		sizes.push(first.value);
		for (let index = 1; index < count - 1; index++) {
			const delta = readVint(header, position);
			position += delta.length;
			// A signed difference: the value minus half its range.
			sizes.push(sizes[index - 1] + delta.value - (2 ** (7 * delta.length - 1) - 1));
		}
	}
	const payload = size - position;
	if (lacing === 2) {
		for (let index = 0; index < count - 1; index++) {
			sizes.push(Math.floor(payload / count));
		}
	}
	sizes.push(payload - sizes.reduce((total, frame) => total + frame, 0));
	const entry = entries.find(candidate => candidate.number === track);
	const frameDuration = entry?.defaultDuration !== undefined ? entry.defaultDuration / 1000 : undefined;
	// Without a default duration the frames of a block share its time; those of Opus get theirs from their lengths later.
	let frameOffset = start + position;
	for (let index = 0; index < sizes.length; index++) {
		addBlock(track, { offset: frameOffset, size: sizes[index], time: time + index * (frameDuration ?? 0), key: index === 0 ? key : true });
		frameOffset += sizes[index];
	}
}

function readVint(bytes: Uint8Array, position: number): { readonly value: number; readonly length: number } {
	const length = vintLength(bytes[position]);
	let value = bytes[position] & (0xFF >> length);
	for (let index = 1; index < length; index++) {
		value = value * 256 + bytes[position + index];
	}
	return { value, length };
}

/** The duration of an Opus packet in microseconds, from its first byte (RFC 6716, section 3.1). */
export function baseHalfOpusPacketDuration(packet: Uint8Array): number | undefined {
	if (!packet.length) {
		return undefined;
	}
	const config = packet[0] >> 3;
	const frame = config < 12 ? [10000, 20000, 40000, 60000][config & 3]
		: config < 16 ? [10000, 20000][config & 1]
			: [2500, 5000, 10000, 20000][config & 3];
	const code = packet[0] & 3;
	const frames = code === 0 ? 1 : code === 3 ? (packet[1] ?? 0) & 0x3F : 2;
	return frame * frames;
}

async function toTrack(source: IBaseHalfVideoByteSource, entry: ITrackEntry, blocks: readonly IBlock[], kind: 'video' | 'audio'): Promise<IBaseHalfVideoTrack> {
	const delay = kind === 'audio' ? entry.codecDelay / 1000 : 0;
	// Opus packets laced in one block start one after the other: their times come from their lengths.
	const times = blocks.map(block => block.time);
	if (entry.codecId === 'A_OPUS') {
		for (let index = 1; index < blocks.length; index++) {
			if (blocks[index].time === blocks[index - 1].time) {
				const previous = await source.read(blocks[index - 1].offset, Math.min(2, blocks[index - 1].size));
				times[index] = times[index - 1] + (baseHalfOpusPacketDuration(previous) ?? 20000);
			}
		}
	}
	const samples: IBaseHalfVideoSample[] = blocks.map((block, index) => {
		const next = index + 1 < blocks.length ? times[index + 1] : undefined;
		const fallback = entry.defaultDuration !== undefined ? entry.defaultDuration / 1000 : index > 0 ? times[index] - times[index - 1] : 33333;
		const duration = block.duration ?? (next !== undefined && next > times[index] ? next - times[index] : fallback);
		const time = Math.round(times[index] - delay);
		return Object.freeze({ offset: block.offset, size: block.size, decodeTime: time, time, duration: Math.round(duration), key: kind === 'audio' || block.key });
	});
	// The padding at the end of the last packet is not heard: the track ends before it.
	const last = blocks.at(-1);
	const lastSample = samples.at(-1);
	const end = last?.discard !== undefined && last.discard > 0 && lastSample ? lastSample.time + Math.max(0, lastSample.duration - Math.round(last.discard)) : undefined;
	let codec: string | undefined;
	let description: Uint8Array | undefined;
	switch (entry.codecId) {
		case 'V_VP8': codec = 'vp8'; break;
		case 'V_VP9': {
			const firstKey = blocks.find(block => block.key);
			const first = firstKey ? await source.read(firstKey.offset, 1) : undefined;
			// The profile is in the first byte of a frame: two bits after the frame marker.
			const profile = first && first.length ? ((first[0] >> 5) & 1) | (((first[0] >> 4) & 1) << 1) : 0;
			codec = baseHalfVp9Codec(undefined, profile);
			break;
		}
		case 'V_AV1':
			description = entry.codecPrivate;
			codec = description ? baseHalfAv1Codec(description) : 'av01.0.08M.08';
			break;
		case 'V_MPEG4/ISO/AVC':
			description = entry.codecPrivate;
			codec = description ? baseHalfAvcCodec('avc1', description) : undefined;
			break;
		case 'V_MPEGH/ISO/HEVC':
			description = entry.codecPrivate;
			codec = description ? baseHalfHevcCodec('hvc1', description) : undefined;
			break;
		case 'A_OPUS':
			codec = 'opus';
			description = entry.codecPrivate;
			break;
		case 'A_VORBIS':
			codec = 'vorbis';
			description = entry.codecPrivate;
			break;
		case 'A_FLAC':
			codec = 'flac';
			description = entry.codecPrivate;
			break;
	}
	return Object.freeze({
		kind,
		format: entry.codecId,
		codec,
		description,
		timescale: 1_000_000,
		samples: Object.freeze(samples),
		width: entry.width,
		height: entry.height,
		displayWidth: entry.displayWidth,
		displayHeight: entry.displayHeight,
		matrix: undefined,
		rotation: 0,
		sampleRate: Math.round(entry.sampleRate),
		channels: entry.channels,
		end
	});
}
