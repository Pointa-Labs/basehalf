/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { baseHalfOpusPacketDuration } from './basehalfWebmReader.js';

/**
 * Writes the WebM file of a trimmed WebM (trimming a video, "Its format"): a
 * picture in VP9 and a sound in Opus, with the segment's seek head, its
 * information, and its tracks before the clusters of blocks and the cues of
 * the clusters' key frames after them. Times are in milliseconds, WebM's usual
 * scale. A cluster starts at each key frame of the picture, the blocks of both
 * tracks in it one after the other in time; the last frame of the picture says
 * its length, and the sound's codec delay and the padding of its last packet
 * are written, so that both end where the video does.
 */

/** A compressed frame of the picture. */
export interface IBaseHalfWebmFrameInput {
	readonly data: Uint8Array;
	/** When it is shown and for how long, in the track's units. The frames are in the order they are decoded, which for VP9 is the order they are shown. */
	readonly time: number;
	readonly duration: number;
	readonly key: boolean;
}

export interface IBaseHalfWebmVideoTrackInput {
	readonly kind: 'video';
	readonly codec: 'vp9';
	readonly timescale: number;
	readonly frames: readonly IBaseHalfWebmFrameInput[];
	readonly width: number;
	readonly height: number;
}

export interface IBaseHalfWebmAudioTrackInput {
	readonly kind: 'audio';
	readonly codec: 'opus';
	/** Packets of Opus at 48 kHz, one after the other from the start. */
	readonly packets: readonly Uint8Array[];
	readonly channels: number;
	/** The rate of the sound before it was encoded, which the Opus header records. */
	readonly inputSampleRate: number;
	/** Samples at 48 kHz that the encoder put before the sound: the decoder drops them. */
	readonly delay: number;
	/** How long the sound is, in samples at 48 kHz after the delay. */
	readonly length: number;
}

export type BaseHalfWebmTrackInput = IBaseHalfWebmVideoTrackInput | IBaseHalfWebmAudioTrackInput;

const EBML = 0x1A45DFA3;
const EBML_VERSION = 0x4286;
const EBML_READ_VERSION = 0x42F7;
const EBML_MAX_ID_LENGTH = 0x42F2;
const EBML_MAX_SIZE_LENGTH = 0x42F3;
const DOC_TYPE = 0x4282;
const DOC_TYPE_VERSION = 0x4287;
const DOC_TYPE_READ_VERSION = 0x4285;
const SEGMENT = 0x18538067;
const SEEK_HEAD = 0x114D9B74;
const SEEK = 0x4DBB;
const SEEK_ID = 0x53AB;
const SEEK_POSITION = 0x53AC;
const INFO = 0x1549A966;
const TIMESTAMP_SCALE = 0x2AD7B1;
const MUXING_APP = 0x4D80;
const WRITING_APP = 0x5741;
const DURATION = 0x4489;
const TRACKS = 0x1654AE6B;
const TRACK_ENTRY = 0xAE;
const TRACK_NUMBER = 0xD7;
const TRACK_UID = 0x73C5;
const TRACK_TYPE = 0x83;
const FLAG_LACING = 0x9C;
const CODEC_ID = 0x86;
const CODEC_PRIVATE = 0x63A2;
const CODEC_DELAY = 0x56AA;
const SEEK_PRE_ROLL = 0x56BB;
const VIDEO = 0xE0;
const PIXEL_WIDTH = 0xB0;
const PIXEL_HEIGHT = 0xBA;
const AUDIO = 0xE1;
const SAMPLING_FREQUENCY = 0xB5;
const CHANNELS = 0x9F;
const CLUSTER = 0x1F43B675;
const CLUSTER_TIMESTAMP = 0xE7;
const SIMPLE_BLOCK = 0xA3;
const BLOCK_GROUP = 0xA0;
const BLOCK = 0xA1;
const BLOCK_DURATION = 0x9B;
const REFERENCE_BLOCK = 0xFB;
const DISCARD_PADDING = 0x75A2;
const CUES = 0x1C53BB6B;
const CUE_POINT = 0xBB;
const CUE_TIME = 0xB3;
const CUE_TRACK_POSITIONS = 0xB7;
const CUE_TRACK = 0xF7;
const CUE_CLUSTER_POSITION = 0xF1;

/** Nanoseconds in a unit of the file's times: a millisecond. */
const TIMESTAMP_NANOSECONDS = 1_000_000;
const OPUS_RATE = 48_000;
/** How long before a place a decoder of Opus starts so that the sound there is right (the Matroska mapping of Opus). */
const OPUS_SEEK_PRE_ROLL_NANOSECONDS = 80_000_000;
/** A cluster holds at most this long: a block's time is a 16-bit difference from its cluster's. */
const CLUSTER_MILLISECONDS = 5_000;
const VIDEO_TRACK = 1;
const AUDIO_TRACK = 2;
const APP = 'BaseHalf';

/** Bytes of an element, kept as their parts until the file is put together. */
interface IPieces {
	readonly parts: Uint8Array[];
	readonly size: number;
}

interface IBlock {
	readonly track: number;
	/** In milliseconds, as the block says it. */
	readonly time: number;
	readonly data: Uint8Array;
	readonly key: boolean;
	/** For the last frame of the picture: how long it is shown, in milliseconds. */
	readonly duration?: number;
	/** For a frame that is no key frame in a group: the time of the frame before, from its own. */
	readonly reference?: number;
	/** For the last packet of the sound: nanoseconds of padding to drop. */
	readonly discard?: number;
}

/** The bytes of the file. */
export function writeBaseHalfWebmFile(input: { readonly tracks: readonly BaseHalfWebmTrackInput[] }): Uint8Array {
	const video = input.tracks.find((track): track is IBaseHalfWebmVideoTrackInput => track.kind === 'video' && track.frames.length > 0);
	const audio = input.tracks.find((track): track is IBaseHalfWebmAudioTrackInput => track.kind === 'audio' && track.packets.length > 0);
	const blocks: IBlock[] = [];
	let end = 0;
	if (video) {
		const milliseconds = (units: number) => Math.round(units * 1000 / video.timescale);
		video.frames.forEach((frame, index) => {
			const time = milliseconds(frame.time);
			const last = index === video.frames.length - 1;
			const duration = Math.max(1, milliseconds(frame.time + frame.duration) - time);
			blocks.push({
				track: VIDEO_TRACK,
				time,
				data: frame.data,
				key: frame.key,
				...(last ? { duration } : {}),
				...(last && !frame.key && index > 0 ? { reference: milliseconds(video.frames[index - 1].time) - time } : {})
			});
			end = Math.max(end, time + duration);
		});
	}
	if (audio) {
		// A block's time is its first sample's with the codec delay: the delay is taken off where it is read.
		let samples = 0;
		audio.packets.forEach((packet, index) => {
			blocks.push({ track: AUDIO_TRACK, time: Math.round(samples * 1000 / OPUS_RATE), data: packet, key: true });
			samples += Math.round((baseHalfOpusPacketDuration(packet) ?? 20_000) * OPUS_RATE / 1_000_000);
			const padding = samples - audio.delay - audio.length;
			if (index === audio.packets.length - 1 && padding > 0) {
				blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], discard: Math.round(padding * 1_000_000_000 / OPUS_RATE) };
			}
		});
		end = Math.max(end, Math.round(audio.length * 1000 / OPUS_RATE));
	}
	// In the order of their times; at the same time, the picture's frame first, so that a cluster starts with it.
	const ordered = blocks.map((block, index) => ({ block, index })).sort((a, b) => a.block.time - b.block.time || a.block.track - b.block.track || a.index - b.index).map(entry => entry.block);

	const clusters: { readonly time: number; readonly key: boolean; readonly pieces: IPieces }[] = [];
	let group: IBlock[] = [];
	const close = () => {
		if (group.length) {
			const time = group[0].time;
			clusters.push({ time, key: group[0].track === VIDEO_TRACK && group[0].key, pieces: element(CLUSTER, [uintElement(CLUSTER_TIMESTAMP, time), ...group.map(block => blockPieces(block, time))]) });
			group = [];
		}
	};
	for (const block of ordered) {
		const startsAnew = group.length > 0 && (
			(block.track === VIDEO_TRACK && block.key)
			|| block.time - group[0].time >= CLUSTER_MILLISECONDS
		);
		if (startsAnew) {
			close();
		}
		group.push(block);
	}
	close();

	const info = element(INFO, [
		uintElement(TIMESTAMP_SCALE, TIMESTAMP_NANOSECONDS),
		stringElement(MUXING_APP, APP),
		stringElement(WRITING_APP, APP),
		floatElement(DURATION, end)
	]);
	const entries: IPieces[] = [];
	if (video) {
		entries.push(element(TRACK_ENTRY, [
			uintElement(TRACK_NUMBER, VIDEO_TRACK),
			uintElement(TRACK_UID, VIDEO_TRACK),
			uintElement(TRACK_TYPE, 1),
			uintElement(FLAG_LACING, 0),
			stringElement(CODEC_ID, 'V_VP9'),
			element(VIDEO, [uintElement(PIXEL_WIDTH, video.width), uintElement(PIXEL_HEIGHT, video.height)])
		]));
	}
	if (audio) {
		entries.push(element(TRACK_ENTRY, [
			uintElement(TRACK_NUMBER, AUDIO_TRACK),
			uintElement(TRACK_UID, AUDIO_TRACK),
			uintElement(TRACK_TYPE, 2),
			uintElement(FLAG_LACING, 0),
			stringElement(CODEC_ID, 'A_OPUS'),
			element(CODEC_PRIVATE, [opusHead(audio)]),
			uintElement(CODEC_DELAY, Math.round(audio.delay * 1_000_000_000 / OPUS_RATE)),
			uintElement(SEEK_PRE_ROLL, OPUS_SEEK_PRE_ROLL_NANOSECONDS),
			element(AUDIO, [floatElement(SAMPLING_FREQUENCY, OPUS_RATE), uintElement(CHANNELS, audio.channels)])
		]));
	}
	const tracks = element(TRACKS, entries);

	// Places in the segment are written in eight bytes, so that the seek head and the cues have their sizes before the places are known.
	const seekHead = (places: readonly number[]) => element(SEEK_HEAD, [INFO, TRACKS, CUES].map((id, index) => element(SEEK, [element(SEEK_ID, [idBytes(id)]), uintElement(SEEK_POSITION, places[index], 8)])));
	const headSize = seekHead([0, 0, 0]).size;
	const clustersStart = headSize + info.size + tracks.size;
	let place = clustersStart;
	const cuePoints: IPieces[] = [];
	for (const cluster of clusters) {
		if (cluster.key) {
			cuePoints.push(element(CUE_POINT, [
				uintElement(CUE_TIME, cluster.time),
				element(CUE_TRACK_POSITIONS, [uintElement(CUE_TRACK, VIDEO_TRACK), uintElement(CUE_CLUSTER_POSITION, place, 8)])
			]));
		}
		place += cluster.pieces.size;
	}
	const cues = element(CUES, cuePoints);
	const segment = element(SEGMENT, [seekHead([headSize, headSize + info.size, place]), info, tracks, ...clusters.map(cluster => cluster.pieces), cues]);
	const header = element(EBML, [
		uintElement(EBML_VERSION, 1),
		uintElement(EBML_READ_VERSION, 1),
		uintElement(EBML_MAX_ID_LENGTH, 4),
		uintElement(EBML_MAX_SIZE_LENGTH, 8),
		stringElement(DOC_TYPE, 'webm'),
		// Codec delay and discard padding are of version 4.
		uintElement(DOC_TYPE_VERSION, 4),
		uintElement(DOC_TYPE_READ_VERSION, 2)
	]);

	const bytes = new Uint8Array(header.size + segment.size);
	let at = 0;
	for (const part of [...header.parts, ...segment.parts]) {
		bytes.set(part, at);
		at += part.length;
	}
	return bytes;
}

/** A block as a simple block, or as a group when it says more than its time. */
function blockPieces(block: IBlock, clusterTime: number): IPieces {
	const head = new Uint8Array(4);
	head[0] = 0x80 | block.track;
	const relative = block.time - clusterTime;
	head[1] = (relative >> 8) & 0xFF;
	head[2] = relative & 0xFF;
	const grouped = block.duration !== undefined || block.discard !== undefined || block.reference !== undefined;
	if (!grouped) {
		head[3] = block.key ? 0x80 : 0;
		return element(SIMPLE_BLOCK, [head, block.data]);
	}
	// A block of a group says nothing of key frames: a reference to another block says that it is none.
	return element(BLOCK_GROUP, [
		element(BLOCK, [head, block.data]),
		...(block.duration !== undefined ? [uintElement(BLOCK_DURATION, block.duration)] : []),
		...(block.reference !== undefined ? [intElement(REFERENCE_BLOCK, block.reference)] : []),
		...(block.discard !== undefined ? [intElement(DISCARD_PADDING, block.discard)] : [])
	]);
}

/** The identification header of Opus (RFC 7845, section 5.1), as the track's codec private data. */
function opusHead(audio: IBaseHalfWebmAudioTrackInput): Uint8Array {
	const head = new Uint8Array(19);
	head.set([0x4F, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64]);
	const view = new DataView(head.buffer);
	view.setUint8(8, 1);
	view.setUint8(9, audio.channels);
	view.setUint16(10, audio.delay, true);
	view.setUint32(12, audio.inputSampleRate, true);
	view.setInt16(16, 0, true);
	view.setUint8(18, 0);
	return head;
}

function element(id: number, children: readonly (IPieces | Uint8Array)[]): IPieces {
	const parts: Uint8Array[] = [];
	let size = 0;
	for (const child of children) {
		if (child instanceof Uint8Array) {
			parts.push(child);
			size += child.length;
		} else {
			for (const part of child.parts) {
				parts.push(part);
			}
			size += child.size;
		}
	}
	const identifier = idBytes(id);
	const length = sizeBytes(size);
	const header = new Uint8Array(identifier.length + length.length);
	header.set(identifier);
	header.set(length, identifier.length);
	parts.unshift(header);
	return { parts, size: header.length + size };
}

function idBytes(id: number): Uint8Array {
	const length = id > 0xFFFFFF ? 4 : id > 0xFFFF ? 3 : id > 0xFF ? 2 : 1;
	return bigEndian(id, length);
}

/** The size of an element as a variable-size integer, in the fewest bytes; all ones would mean an unknown size. */
function sizeBytes(size: number): Uint8Array {
	let length = 1;
	while (length < 8 && size >= 2 ** (7 * length) - 1) {
		length++;
	}
	const bytes = bigEndian(size, length);
	bytes[0] |= 0x80 >> (length - 1);
	return bytes;
}

function bigEndian(value: number, length: number): Uint8Array {
	const bytes = new Uint8Array(length);
	let rest = value;
	for (let index = length - 1; index >= 0; index--) {
		bytes[index] = rest % 256;
		rest = Math.floor(rest / 256);
	}
	return bytes;
}

function uintElement(id: number, value: number, width?: number): IPieces {
	let length = width ?? 1;
	while (width === undefined && length < 8 && value >= 2 ** (8 * length)) {
		length++;
	}
	return element(id, [bigEndian(value, length)]);
}

/** A signed integer in the fewest bytes, in two's complement. */
function intElement(id: number, value: number): IPieces {
	let length = 1;
	while (length < 8 && (value < -(2 ** (8 * length - 1)) || value >= 2 ** (8 * length - 1))) {
		length++;
	}
	return element(id, [bigEndian(value < 0 ? 2 ** (8 * length) + value : value, length)]);
}

function floatElement(id: number, value: number): IPieces {
	const bytes = new Uint8Array(8);
	new DataView(bytes.buffer).setFloat64(0, value);
	return element(id, [bytes]);
}

function stringElement(id: number, value: string): IPieces {
	const bytes = new Uint8Array(value.length);
	for (let index = 0; index < value.length; index++) {
		bytes[index] = value.charCodeAt(index) & 0x7F;
	}
	return element(id, [bytes]);
}
