/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { open, readFile, stat } from 'fs/promises';
import { basename, isAbsolute } from '../../../base/common/path.js';
import { rejected } from './failure.js';
import type { AudioOutputFormat, ImageFormat, Media, PlannedMedia } from '../common/basehalfProviderTypes.js';

/**
 * The inputs of a generation as bytes: a workspace file or a data URL the
 * window drew (an SVG made a PNG). `check` measures them from their headers
 * ({@link MediaInspector}); `submit` reads them whole ({@link readMedia}) and
 * sends them the provider's way ({@link dataUrlOf}, {@link base64Of}).
 */

/** What the bytes of an input are, read from their header. */
export type MediaFormat = 'png' | 'jpeg' | 'webp' | 'gif' | 'mp4' | 'mov' | 'm4a' | 'wav' | 'mp3';

/** The MIME type a provider is sent for each format. */
export const MEDIA_MIME_TYPES: Readonly<Record<MediaFormat, string>> = Object.freeze({
	png: 'image/png',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
	gif: 'image/gif',
	mp4: 'video/mp4',
	mov: 'video/quicktime',
	m4a: 'audio/mp4',
	wav: 'audio/wav',
	mp3: 'audio/mpeg'
});

export interface MediaFacts {
	/** The file name; absent for an image the window drew. */
	readonly name?: string;
	readonly bytes: number;
	/** Absent when BaseHalf does not recognize the bytes. */
	readonly format?: MediaFormat;
	/** Of an image. */
	readonly width?: number;
	readonly height?: number;
	/** Of a video or audio, when its header gives it. */
	readonly seconds?: number;
}

/** Measures inputs for `check`, reading only the headers it needs. */
export interface MediaInspector {
	/** A file that is missing or not a file throws `rejected`. */
	inspect(media: Media): Promise<MediaFacts>;
}

/** One planned input with its slot, for messages and for building a request in order. */
export interface PlannedItem {
	readonly slot: 'startFrame' | 'endFrame' | 'image' | 'video' | 'audio' | 'source';
	/** The position among the references of its kind; 0 for the frames and the source. */
	readonly index: number;
	readonly media: Media;
	/** Such as "The start frame start.png" or "Reference image 2". */
	readonly label: string;
}

const SLOT_LABELS: Readonly<Record<PlannedItem['slot'], (index: number) => string>> = Object.freeze({
	startFrame: () => 'The start frame',
	endFrame: () => 'The end frame',
	image: (index: number) => `Reference image ${index + 1}`,
	video: (index: number) => `Reference video ${index + 1}`,
	audio: (index: number) => `Reference audio ${index + 1}`,
	source: () => 'The source video'
});

export function isDataUrlMedia(media: Media): media is { readonly dataUrl: string } {
	return typeof (media as { readonly dataUrl?: unknown }).dataUrl === 'string';
}

/** The file name of an input, when it is a file. */
export function mediaName(media: Media): string | undefined {
	return isDataUrlMedia(media) ? undefined : basename(media.fsPath);
}

/** The planned inputs in the order a request lists them: frames, images, videos, audio, then the source. */
export function plannedItems(inputs: PlannedMedia): PlannedItem[] {
	const items: PlannedItem[] = [];
	const add = (slot: PlannedItem['slot'], index: number, media: Media) => {
		const name = mediaName(media);
		items.push({ slot, index, media, label: name ? `${SLOT_LABELS[slot](index)} ${name}` : SLOT_LABELS[slot](index) });
	};
	if (inputs.startFrame) {
		add('startFrame', 0, inputs.startFrame);
	}
	if (inputs.endFrame) {
		add('endFrame', 0, inputs.endFrame);
	}
	inputs.images.forEach((media, index) => add('image', index, media));
	inputs.videos.forEach((media, index) => add('video', index, media));
	inputs.audios.forEach((media, index) => add('audio', index, media));
	if (inputs.source) {
		add('source', 0, inputs.source);
	}
	return items;
}

// --- reading -------------------------------------------------------------------------------------

export interface ReadMedia {
	readonly bytes: Buffer;
	/** Lowercase; from the data URL, or as the window gave it for a file. */
	readonly mimeType: string;
	readonly name?: string;
}

const DATA_URL = /^data:(?<type>[a-z]+\/[a-z0-9.+-]+)(?:;[a-z0-9.+-]+=[^;,]*)*;base64,(?<payload>[A-Za-z0-9+/=\s]*)$/i;

function decodeDataUrl(dataUrl: string, maxBytes: number, label: string): ReadMedia {
	const match = DATA_URL.exec(dataUrl);
	if (!match?.groups) {
		throw rejected(`${label} is not an encoded file BaseHalf can read.`);
	}
	if (Math.floor(match.groups.payload.length * 3 / 4) > maxBytes + 3) {
		throw rejected(`${label} is larger than ${describeBytes(maxBytes)}.`);
	}
	const bytes = Buffer.from(match.groups.payload, 'base64');
	if (bytes.byteLength > maxBytes) {
		throw rejected(`${label} is larger than ${describeBytes(maxBytes)}.`);
	}
	return { bytes, mimeType: match.groups.type.toLowerCase() };
}

/** Reads an input whole, refusing more than `maxBytes`. `label` names it in messages. */
export async function readMedia(media: Media, maxBytes: number, label: string): Promise<ReadMedia> {
	if (isDataUrlMedia(media)) {
		return decodeDataUrl(media.dataUrl, maxBytes, label);
	}
	if (!isAbsolute(media.fsPath)) {
		throw rejected(`${label} is not a file on this computer.`);
	}
	let size: number;
	try {
		const info = await stat(media.fsPath);
		if (!info.isFile()) {
			throw new Error('not a file');
		}
		size = info.size;
	} catch {
		throw rejected(`${label} is missing.`);
	}
	if (size > maxBytes) {
		throw rejected(`${label} is ${describeBytes(size)}, more than the ${describeBytes(maxBytes)} allowed.`);
	}
	return { bytes: await readFile(media.fsPath), mimeType: media.mimeType.toLowerCase(), name: basename(media.fsPath) };
}

/** `data:<type>;base64,<bytes>`; the type of the file unless one is given. */
export function dataUrlOf(read: ReadMedia, mimeType = read.mimeType): string {
	return `data:${mimeType.toLowerCase()};base64,${read.bytes.toString('base64')}`;
}

/** The bytes as plain base64, for providers that take inline data without a data URL. */
export function base64Of(read: ReadMedia): string {
	return read.bytes.toString('base64');
}

/** The length of the base64 of `bytes` bytes, to size a request before reading its inputs. */
export function base64Length(bytes: number): number {
	return Math.ceil(bytes / 3) * 4;
}

/** "30 MiB", "512 KiB", or "900 bytes". */
export function describeBytes(bytes: number): string {
	if (bytes >= 1024 * 1024) {
		const mib = bytes / (1024 * 1024);
		return `${Number.isInteger(mib) ? mib : mib.toFixed(1)} MiB`;
	}
	if (bytes >= 1024) {
		const kib = bytes / 1024;
		return `${Number.isInteger(kib) ? kib : kib.toFixed(1)} KiB`;
	}
	return `${bytes} bytes`;
}

// --- measuring ----------------------------------------------------------------------------------

/** Bytes read where they are needed: a file through one handle, or a decoded data URL. */
export interface ByteSource {
	readonly size: number;
	/** Fewer bytes than asked at the end. */
	read(offset: number, length: number): Promise<Buffer>;
}

export function bufferSource(bytes: Buffer): ByteSource {
	return {
		size: bytes.byteLength,
		read: async (offset, length) => bytes.subarray(Math.max(0, offset), Math.max(0, Math.min(bytes.byteLength, offset + length)))
	};
}

/** The largest MP3 whose frames are counted one by one; a longer one is timed from its first frame. */
const MAX_SCANNED_BYTES = 64 * 1024 * 1024;

export function createMediaInspector(): MediaInspector {
	return {
		async inspect(media) {
			if (isDataUrlMedia(media)) {
				const read = decodeDataUrl(media.dataUrl, 512 * 1024 * 1024, 'The drawn image');
				return { bytes: read.bytes.byteLength, ...await measure(bufferSource(read.bytes)) };
			}
			const name = basename(media.fsPath);
			if (!isAbsolute(media.fsPath)) {
				throw rejected(`${name} is not a file on this computer.`);
			}
			let handle: Awaited<ReturnType<typeof open>>;
			let size: number;
			try {
				const info = await stat(media.fsPath);
				if (!info.isFile()) {
					throw new Error('not a file');
				}
				size = info.size;
				handle = await open(media.fsPath, 'r');
			} catch {
				throw rejected(`${name} is missing.`);
			}
			try {
				const source: ByteSource = {
					size,
					async read(offset, length) {
						const start = Math.max(0, offset);
						const count = Math.max(0, Math.min(size, start + length) - start);
						const buffer = Buffer.alloc(count);
						let done = 0;
						while (done < count) {
							const { bytesRead } = await handle.read(buffer, done, count - done, start + done);
							if (bytesRead === 0) {
								break;
							}
							done += bytesRead;
						}
						return buffer.subarray(0, done);
					}
				};
				return { name, bytes: size, ...await measure(source) };
			} finally {
				await handle.close().catch(() => undefined);
			}
		}
	};
}

/** The format and the size or length of some bytes, from their header. */
export async function measure(source: ByteSource): Promise<Omit<MediaFacts, 'name' | 'bytes'>> {
	const head = await source.read(0, 32);
	const image = await imageSize(source, head);
	if (image) {
		return image;
	}
	if (head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WAVE') {
		return { format: 'wav', ...optionalSeconds(await wavSeconds(source)) };
	}
	if (ISO_TOP_LEVEL_BOXES.has(head.toString('latin1', 4, 8))) {
		const brand = head.toString('latin1', 4, 8) === 'ftyp' ? head.toString('latin1', 8, 12) : '';
		const format: MediaFormat = brand === 'qt  ' ? 'mov'
			: AUDIO_BRANDS.has(brand) || (GENERAL_ISO_BRANDS.has(brand) && await holdsSoundAlone(source)) ? 'm4a'
				: 'mp4';
		return { format, ...optionalSeconds(await isoSeconds(source)) };
	}
	const mp3 = await mp3Seconds(source, head);
	if (mp3 !== undefined) {
		return { format: 'mp3', ...optionalSeconds(mp3) };
	}
	return {};
}

function optionalSeconds(seconds: number | undefined): { readonly seconds?: number } {
	return seconds !== undefined && Number.isFinite(seconds) && seconds >= 0 ? { seconds } : {};
}

// --- images -------------------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The bytes {@link imageFormatOf} needs to tell every format it knows. */
export const IMAGE_SIGNATURE_BYTES = 12;

/**
 * The image format some bytes start like, from their signature: PNG, JPEG, or
 * WebP, the formats a generated image is kept in (providers, "Requests").
 * Undefined for anything else, a GIF included.
 */
export function imageFormatOf(head: Uint8Array): ImageFormat | undefined {
	const bytes = Buffer.from(head.buffer, head.byteOffset, Math.min(head.byteLength, IMAGE_SIGNATURE_BYTES));
	if (bytes.byteLength >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
		return 'png';
	}
	if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return 'jpeg';
	}
	if (bytes.byteLength >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') {
		return 'webp';
	}
	return undefined;
}

/** Start-of-frame markers of JPEG, which carry the image size. */
const JPEG_FRAME_MARKERS: ReadonlySet<number> = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

async function imageSize(source: ByteSource, head: Buffer): Promise<{ format: MediaFormat; width: number; height: number } | undefined> {
	if (head.byteLength >= 24 && head.subarray(0, 8).equals(PNG_SIGNATURE) && head.toString('latin1', 12, 16) === 'IHDR') {
		return { format: 'png', width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
	}
	const gif = head.toString('latin1', 0, 6);
	if (head.byteLength >= 10 && (gif === 'GIF87a' || gif === 'GIF89a')) {
		return { format: 'gif', width: head.readUInt16LE(6), height: head.readUInt16LE(8) };
	}
	if (head.byteLength >= 30 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') {
		const chunk = head.toString('latin1', 12, 16);
		if (chunk === 'VP8 ' && head[23] === 0x9d && head[24] === 0x01 && head[25] === 0x2a) {
			return { format: 'webp', width: head.readUInt16LE(26) & 0x3fff, height: head.readUInt16LE(28) & 0x3fff };
		}
		if (chunk === 'VP8L' && head[20] === 0x2f) {
			const bits = head.readUInt32LE(21);
			return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
		}
		if (chunk === 'VP8X') {
			return { format: 'webp', width: head.readUIntLE(24, 3) + 1, height: head.readUIntLE(27, 3) + 1 };
		}
		return undefined;
	}
	if (head.byteLength >= 4 && head[0] === 0xff && head[1] === 0xd8) {
		return jpegSize(source);
	}
	return undefined;
}

async function jpegSize(source: ByteSource): Promise<{ format: MediaFormat; width: number; height: number } | undefined> {
	let offset = 2;
	for (let segments = 0; segments < 4096 && offset + 4 <= source.size; segments++) {
		const marker = await source.read(offset, 9);
		if (marker.byteLength < 4 || marker[0] !== 0xff) {
			return undefined;
		}
		const type = marker[1];
		if (type === 0xff) {
			// Fill bytes before a marker.
			offset += 1;
			continue;
		}
		if (JPEG_FRAME_MARKERS.has(type)) {
			return marker.byteLength >= 9 ? { format: 'jpeg', width: marker.readUInt16BE(7), height: marker.readUInt16BE(5) } : undefined;
		}
		if (type === 0xda || type === 0xd9) {
			// The image data or its end came before any frame header.
			return undefined;
		}
		if (type === 0x01 || (type >= 0xd0 && type <= 0xd8)) {
			offset += 2;
			continue;
		}
		offset += 2 + marker.readUInt16BE(2);
	}
	return undefined;
}

// --- video and audio ----------------------------------------------------------------------------

/** Boxes an MP4, MOV, or M4A file may start with. */
const ISO_TOP_LEVEL_BOXES: ReadonlySet<string> = new Set(['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'pnot']);

/** The general brands of ISO media files, under which a file may hold a video or sound alone. */
const GENERAL_ISO_BRANDS: ReadonlySet<string> = new Set(['isom', 'iso2', 'mp41', 'mp42']);

interface IsoBox {
	readonly type: string;
	readonly contentStart: number;
	readonly end: number;
}

/** The boxes from `start` to `end`, in order, at most 4,096; the walk ends at a box it cannot read. */
async function* isoBoxes(source: ByteSource, start: number, end: number): AsyncGenerator<IsoBox> {
	let offset = start;
	for (let boxes = 0; boxes < 4096 && offset + 8 <= end; boxes++) {
		const header = await source.read(offset, 16);
		if (header.byteLength < 8) {
			return;
		}
		let size = header.readUInt32BE(0);
		let headerSize = 8;
		if (size === 1) {
			if (header.byteLength < 16) {
				return;
			}
			size = Number(header.readBigUInt64BE(8));
			headerSize = 16;
		} else if (size === 0) {
			size = end - offset;
		}
		if (size < headerSize) {
			return;
		}
		yield { type: header.toString('latin1', 4, 8), contentStart: offset + headerSize, end: Math.min(end, offset + size) };
		offset += size;
	}
}

async function findBox(source: ByteSource, start: number, end: number, type: string): Promise<IsoBox | undefined> {
	for await (const box of isoBoxes(source, start, end)) {
		if (box.type === type) {
			return box;
		}
	}
	return undefined;
}

/**
 * Whether an ISO media file holds sound alone (providers, "Requests"): a
 * track of sound (the handler `soun` of its `mdia`) and none of video
 * (`vide`), as the M4A that `afconvert -f mp4f` or the recorder of a phone
 * writes under a general brand. A track that names no handler is neither.
 */
async function holdsSoundAlone(source: ByteSource): Promise<boolean> {
	const movie = await findBox(source, 0, source.size, 'moov');
	if (!movie) {
		return false;
	}
	let sound = false;
	for await (const track of isoBoxes(source, movie.contentStart, movie.end)) {
		if (track.type !== 'trak') {
			continue;
		}
		const media = await findBox(source, track.contentStart, track.end, 'mdia');
		const handler = media ? await findBox(source, media.contentStart, media.end, 'hdlr') : undefined;
		// A full box: version and flags, pre_defined, then the handler type.
		const type = handler && handler.end - handler.contentStart >= 12 ? (await source.read(handler.contentStart + 8, 4)).toString('latin1') : '';
		if (type === 'vide') {
			return false;
		}
		sound ||= type === 'soun';
	}
	return sound;
}

/** The length an MP4, MOV, or M4A file gives in its movie header (`mvhd`). */
async function isoSeconds(source: ByteSource): Promise<number | undefined> {
	const movie = await findBox(source, 0, source.size, 'moov');
	const header = movie ? await findBox(source, movie.contentStart, movie.end, 'mvhd') : undefined;
	if (!header) {
		return undefined;
	}
	const fields = await source.read(header.contentStart, 32);
	if (fields.byteLength < 20) {
		return undefined;
	}
	// A full box: version and flags, then the times, the time scale, and the duration.
	if (fields[0] === 1) {
		if (fields.byteLength < 32) {
			return undefined;
		}
		const timescale = fields.readUInt32BE(20);
		const duration = fields.readBigUInt64BE(24);
		return timescale && duration !== 0xffffffffffffffffn ? Number(duration) / timescale : undefined;
	}
	const timescale = fields.readUInt32BE(12);
	const duration = fields.readUInt32BE(16);
	return timescale && duration !== 0xffffffff ? duration / timescale : undefined;
}

/** The length of a WAV file: its data chunk divided by the bytes per second of its format chunk. */
async function wavSeconds(source: ByteSource): Promise<number | undefined> {
	let offset = 12;
	let bytesPerSecond: number | undefined;
	for (let chunks = 0; chunks < 4096 && offset + 8 <= source.size; chunks++) {
		const header = await source.read(offset, 8);
		const id = header.toString('latin1', 0, 4);
		const size = header.readUInt32LE(4);
		if (id === 'fmt ') {
			const format = await source.read(offset + 8, 16);
			if (format.byteLength >= 12) {
				bytesPerSecond = format.readUInt32LE(8);
			}
		} else if (id === 'data') {
			const available = source.size - (offset + 8);
			const length = size === 0 || size === 0xffffffff || size > available ? available : size;
			return bytesPerSecond ? length / bytesPerSecond : undefined;
		}
		offset += 8 + size + (size & 1);
	}
	return undefined;
}

interface Mp3Frame {
	readonly length: number;
	readonly samples: number;
	readonly sampleRate: number;
	readonly mpeg1: boolean;
	readonly mono: boolean;
}

/** Kilobits per second by MPEG version and layer, indexed by the bitrate field (1 to 14). */
const MP3_BITRATES: Readonly<Record<string, readonly number[]>> = Object.freeze({
	'1-1': [32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
	'1-2': [32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
	'1-3': [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
	'2-1': [32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
	'2-2': [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
	'2-3': [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
});

/** Samples per second by MPEG version (1, 2, 2.5), indexed by the sample rate field. */
const MP3_SAMPLE_RATES: Readonly<Record<string, readonly number[]>> = Object.freeze({
	'1': [44100, 48000, 32000],
	'2': [22050, 24000, 16000],
	'2.5': [11025, 12000, 8000]
});

/** One MPEG audio frame header, or undefined when the four bytes are not one. */
function mp3Frame(bytes: Buffer, offset: number): Mp3Frame | undefined {
	if (offset + 4 > bytes.byteLength || bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) {
		return undefined;
	}
	const versionBits = (bytes[offset + 1] >> 3) & 0x3;
	const layerBits = (bytes[offset + 1] >> 1) & 0x3;
	const bitrateIndex = (bytes[offset + 2] >> 4) & 0xf;
	const rateIndex = (bytes[offset + 2] >> 2) & 0x3;
	if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) {
		return undefined;
	}
	const version = versionBits === 3 ? '1' : versionBits === 2 ? '2' : '2.5';
	const layer = 4 - layerBits;
	const bitrate = MP3_BITRATES[`${version === '1' ? 1 : 2}-${layer}`][bitrateIndex - 1] * 1000;
	const sampleRate = MP3_SAMPLE_RATES[version][rateIndex];
	const padding = (bytes[offset + 2] >> 1) & 0x1;
	const mpeg1 = version === '1';
	const samples = layer === 1 ? 384 : layer === 2 || mpeg1 ? 1152 : 576;
	const length = layer === 1
		? (Math.floor(12 * bitrate / sampleRate) + padding) * 4
		: Math.floor((layer === 3 && !mpeg1 ? 72 : 144) * bitrate / sampleRate) + padding;
	return { length, samples, sampleRate, mpeg1, mono: ((bytes[offset + 3] >> 6) & 0x3) === 3 };
}

/**
 * The length of an MP3: from its Xing, Info, or VBRI header when it has one,
 * otherwise by counting its frames. Undefined when the bytes are not MPEG audio.
 */
async function mp3Seconds(source: ByteSource, head: Buffer): Promise<number | undefined> {
	let start = 0;
	if (head.toString('latin1', 0, 3) === 'ID3' && head.byteLength >= 10) {
		const size = ((head[6] & 0x7f) << 21) | ((head[7] & 0x7f) << 14) | ((head[8] & 0x7f) << 7) | (head[9] & 0x7f);
		start = 10 + size + ((head[5] & 0x10) ? 10 : 0);
	} else if (!(head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) {
		return undefined;
	}
	const scanned = source.size - start <= MAX_SCANNED_BYTES;
	const bytes = await source.read(start, scanned ? source.size - start : 256 * 1024);
	// The first frame: a header followed by another header where it says the next frame starts.
	let first = -1;
	for (let offset = 0; offset < Math.min(bytes.byteLength, 64 * 1024); offset++) {
		const frame = mp3Frame(bytes, offset);
		if (frame && (offset + frame.length >= bytes.byteLength || mp3Frame(bytes, offset + frame.length))) {
			first = offset;
			break;
		}
	}
	if (first < 0) {
		return undefined;
	}
	const frame = mp3Frame(bytes, first)!;
	const sideInfo = frame.mpeg1 ? (frame.mono ? 17 : 32) : (frame.mono ? 9 : 17);
	const xing = first + 4 + sideInfo;
	const tag = bytes.toString('latin1', xing, xing + 4);
	if ((tag === 'Xing' || tag === 'Info') && xing + 12 <= bytes.byteLength && (bytes.readUInt32BE(xing + 4) & 0x1)) {
		return bytes.readUInt32BE(xing + 8) * frame.samples / frame.sampleRate;
	}
	const vbri = first + 4 + 32;
	if (bytes.toString('latin1', vbri, vbri + 4) === 'VBRI' && vbri + 18 <= bytes.byteLength) {
		return bytes.readUInt32BE(vbri + 14) * frame.samples / frame.sampleRate;
	}
	if (!scanned) {
		// Too long to count: time it as a constant bitrate from its first frame.
		return (source.size - start - first) / frame.length * frame.samples / frame.sampleRate;
	}
	let samples = 0;
	for (let offset = first; offset < bytes.byteLength;) {
		const next = mp3Frame(bytes, offset);
		if (!next || next.length <= 0) {
			break;
		}
		samples += next.samples;
		offset += next.length;
	}
	return samples / frame.sampleRate;
}

// --- sounds -------------------------------------------------------------------------------------

/** The bytes {@link audioFormatOf} reads to tell every format it knows. */
export const AUDIO_SIGNATURE_BYTES = 64;

/** The brands of an ISO media file that say it holds sound alone: Apple's M4A, and its audiobook form. */
const AUDIO_BRANDS: ReadonlySet<string> = new Set(['M4A ', 'M4B ']);

/** How the first packet of an Ogg stream of Opus, Vorbis, or FLAC starts: the codecs a window plays. */
const OGG_AUDIO_CODECS: readonly Buffer[] = Object.freeze(['OpusHead', '\x01vorbis', '\x7FFLAC'].map(codec => Buffer.from(codec, 'latin1')));

/**
 * The format of a sound some bytes start like, from their first
 * {@link AUDIO_SIGNATURE_BYTES} bytes: the formats a generated sound and a
 * voice's sample are kept in (providers, "Requests").
 *
 * - `mp3`: an ID3v2 tag (`ID3`, a version from 2 to 4, and a size of four
 *   bytes below 128 each), or an MPEG audio frame header of Layer III, of
 *   MPEG 1, 2, or 2.5, whose bit rate and sample rate are not reserved;
 * - `wav`: a RIFF file of the `WAVE` form;
 * - `flac`: `fLaC` followed by its first metadata block, STREAMINFO;
 * - `ogg`: the first page of an Ogg stream (version 0, beginning a stream)
 *   whose first packet starts Opus, Vorbis, or FLAC;
 * - `m4a`: an ISO media file whose first box is `ftyp` with an audio brand,
 *   `M4A ` or `M4B `, as its major brand or among the brands it lists within
 *   the bytes read. A file of general brands alone, such as `isom` or `mp42`,
 *   may hold a video and is not taken for a sound.
 *
 * Undefined for anything else, such as AAC without a container, or a video.
 */
export function audioFormatOf(head: Uint8Array): AudioOutputFormat | undefined {
	const bytes = Buffer.from(head.buffer, head.byteOffset, Math.min(head.byteLength, AUDIO_SIGNATURE_BYTES));
	const text = (start: number, end: number) => bytes.toString('latin1', start, end);
	if (bytes.byteLength >= 10 && text(0, 3) === 'ID3' && bytes[3] >= 2 && bytes[3] <= 4 && bytes[4] !== 0xff && bytes.subarray(6, 10).every(byte => byte < 0x80)) {
		return 'mp3';
	}
	if (mp3Frame(bytes, 0) && ((bytes[1] >> 1) & 0x3) === 1) {
		return 'mp3';
	}
	if (bytes.byteLength >= 12 && text(0, 4) === 'RIFF' && text(8, 12) === 'WAVE') {
		return 'wav';
	}
	if (bytes.byteLength >= 8 && text(0, 4) === 'fLaC' && (bytes[4] & 0x7f) === 0) {
		return 'flac';
	}
	if (bytes.byteLength >= 27 && text(0, 4) === 'OggS') {
		// After the page header of 27 bytes and its table of segment lengths comes the first packet.
		const packet = 27 + bytes[26];
		const audio = bytes[4] === 0 && (bytes[5] & 0x02) !== 0
			&& OGG_AUDIO_CODECS.some(codec => bytes.byteLength >= packet + codec.byteLength && bytes.subarray(packet, packet + codec.byteLength).equals(codec));
		return audio ? 'ogg' : undefined;
	}
	if (bytes.byteLength >= 12 && text(4, 8) === 'ftyp') {
		// The major brand, then the minor version, then the compatible brands to the end of the box.
		const end = Math.min(bytes.byteLength, bytes.readUInt32BE(0));
		const brands = [text(8, 12)];
		for (let offset = 16; offset + 4 <= end; offset += 4) {
			brands.push(text(offset, offset + 4));
		}
		return brands.some(brand => AUDIO_BRANDS.has(brand)) ? 'm4a' : undefined;
	}
	return undefined;
}

/** How raw samples are laid out: little-endian integers, interleaved by channel. */
export interface PcmLayout {
	readonly sampleRate: number;
	readonly channels: number;
	readonly bitsPerSample: 8 | 16 | 24 | 32;
}

/**
 * A WAV file of raw PCM samples (providers, "Audio format"): a module whose
 * provider answers only samples, such as 16-bit samples at 24 kHz, writes
 * them as WAV with this and declares `wav` as its model's `outputFormat`.
 */
export function pcmToWav(samples: Uint8Array, layout: PcmLayout): Buffer {
	const { sampleRate, channels, bitsPerSample } = layout;
	if (!Number.isInteger(sampleRate) || sampleRate <= 0 || !Number.isInteger(channels) || channels < 1 || channels > 16 || ![8, 16, 24, 32].includes(bitsPerSample)) {
		throw new Error(`Raw samples need a positive sample rate, 1 to 16 channels, and 8, 16, 24, or 32 bits a sample: ${sampleRate} Hz, ${channels}, ${bitsPerSample}.`);
	}
	const blockAlign = channels * bitsPerSample / 8;
	const padding = samples.byteLength % 2;
	const header = Buffer.alloc(44);
	header.write('RIFF', 0, 'latin1');
	header.writeUInt32LE(36 + samples.byteLength + padding, 4);
	header.write('WAVE', 8, 'latin1');
	header.write('fmt ', 12, 'latin1');
	header.writeUInt32LE(16, 16);
	// PCM, with the channels, the rate, the bytes a second, the bytes a frame, and the bits a sample.
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(channels, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(sampleRate * blockAlign, 28);
	header.writeUInt16LE(blockAlign, 32);
	header.writeUInt16LE(bitsPerSample, 34);
	header.write('data', 36, 'latin1');
	header.writeUInt32LE(samples.byteLength, 40);
	return Buffer.concat([header, samples, Buffer.alloc(padding)]);
}
