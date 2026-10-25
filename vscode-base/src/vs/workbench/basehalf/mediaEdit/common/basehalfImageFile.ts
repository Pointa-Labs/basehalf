/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * What a crop reads of an image file and keeps of it (editing media, "An
 * image"): its format and size, the orientation its camera gave it, whether a
 * WebP is without loss, and the file's information that an edited image
 * keeps: the text chunks of a PNG, its EXIF and XMP; the EXIF, XMP, and IPTC
 * segments and comments of a JPEG; the EXIF and XMP chunks of a WebP. An
 * edited image's pixels are upright, so its EXIF says so, has no thumbnail of
 * the original, and gives the new size; EXIF that cannot be read is left out
 * rather than kept with an orientation that would turn the image again.
 * A color profile and a content credential are not kept.
 */

export type BaseHalfImageFormat = 'png' | 'jpeg' | 'webp';

export interface IBaseHalfImageInfo {
	readonly format: BaseHalfImageFormat;
	/** The size as the file stores it, before its orientation. */
	readonly width: number;
	readonly height: number;
	/** The EXIF orientation, 1 to 8; 1 when the file has none. */
	readonly orientation: number;
	/** A WebP stored without loss. */
	readonly lossless: boolean;
	/** The pieces of the file's information an edited image keeps, as the file stores them. */
	readonly metadata: readonly Uint8Array[];
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** The chunks of a PNG an edited PNG keeps. */
const PNG_KEPT = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'pHYs']);
const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
const XMP_HEADER = 'http://ns.adobe.com/xap/1.0/\0';

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	let text = '';
	for (let index = 0; index < length && offset + index < bytes.length; index++) {
		text += String.fromCharCode(bytes[offset + index]);
	}
	return text;
}

function startsWith(bytes: Uint8Array, offset: number, prefix: readonly number[]): boolean {
	return prefix.every((value, index) => bytes[offset + index] === value);
}

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** The size of an image with its orientation applied: orientations 5 to 8 turn it a quarter. */
export function baseHalfOrientedSize(info: Pick<IBaseHalfImageInfo, 'width' | 'height' | 'orientation'>): { readonly width: number; readonly height: number } {
	return info.orientation >= 5 && info.orientation <= 8 ? { width: info.height, height: info.width } : { width: info.width, height: info.height };
}

/**
 * Reads what a crop needs of a PNG, a JPEG, or a WebP; nothing for a file of
 * another format or one that cannot be read. A file cut short, as its first
 * bytes alone, gives what it holds before the cut.
 */
export function readBaseHalfImageInfo(bytes: Uint8Array): IBaseHalfImageInfo | undefined {
	try {
		if (startsWith(bytes, 0, PNG_SIGNATURE)) {
			return readPng(bytes);
		}
		if (bytes[0] === 0xff && bytes[1] === 0xd8) {
			return readJpeg(bytes);
		}
		if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
			return readWebp(bytes);
		}
	} catch {
		// A file whose structure runs past its end cannot be read.
	}
	return undefined;
}

function readPng(bytes: Uint8Array): IBaseHalfImageInfo | undefined {
	const data = view(bytes);
	let width = 0;
	let height = 0;
	let orientation = 1;
	const metadata: Uint8Array[] = [];
	for (let offset = 8; offset + 12 <= bytes.length;) {
		const length = data.getUint32(offset);
		const type = ascii(bytes, offset + 4, 4);
		const end = offset + 12 + length;
		if (end > bytes.length) {
			break;
		}
		if (type === 'IHDR') {
			width = data.getUint32(offset + 8);
			height = data.getUint32(offset + 12);
		} else if (PNG_KEPT.has(type)) {
			metadata.push(bytes.slice(offset, end));
			if (type === 'eXIf') {
				orientation = readExifOrientation(bytes.subarray(offset + 8, offset + 8 + length)) ?? orientation;
			}
		} else if (type === 'IEND') {
			break;
		}
		offset = end;
	}
	return width && height ? { format: 'png', width, height, orientation, lossless: true, metadata } : undefined;
}

function readJpeg(bytes: Uint8Array): IBaseHalfImageInfo | undefined {
	const data = view(bytes);
	let width = 0;
	let height = 0;
	let orientation = 1;
	const metadata: Uint8Array[] = [];
	for (let offset = 2; offset + 4 <= bytes.length;) {
		if (bytes[offset] !== 0xff) {
			return undefined;
		}
		const marker = bytes[offset + 1];
		if (marker === 0xff) {
			// Fill bytes before a marker.
			offset++;
			continue;
		}
		if (marker === 0xd9 || marker === 0xda) {
			// The end of the image, or the start of its scan: the size came before.
			break;
		}
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			offset += 2;
			continue;
		}
		const length = data.getUint16(offset + 2);
		const end = offset + 2 + length;
		if (length < 2) {
			return undefined;
		}
		if (end > bytes.length) {
			break;
		}
		const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
		if (isFrame && !width) {
			height = data.getUint16(offset + 5);
			width = data.getUint16(offset + 7);
		} else if (marker === 0xe1) {
			const body = bytes.subarray(offset + 4, end);
			if (startsWith(body, 0, EXIF_HEADER)) {
				orientation = readExifOrientation(body.subarray(6)) ?? orientation;
				metadata.push(bytes.slice(offset, end));
			} else if (ascii(body, 0, 29).startsWith('http://ns.adobe.com/xap/1.0/') || ascii(body, 0, 35).startsWith('http://ns.adobe.com/xmp/extension/')) {
				metadata.push(bytes.slice(offset, end));
			}
		} else if (marker === 0xed || marker === 0xfe) {
			// IPTC in its Photoshop segment, and comments.
			metadata.push(bytes.slice(offset, end));
		}
		offset = end;
	}
	return width && height ? { format: 'jpeg', width, height, orientation, lossless: false, metadata } : undefined;
}

interface IWebpChunk {
	readonly type: string;
	readonly data: Uint8Array;
}

function webpChunks(bytes: Uint8Array): IWebpChunk[] | undefined {
	const data = view(bytes);
	const chunks: IWebpChunk[] = [];
	const end = Math.min(bytes.length, 8 + data.getUint32(4, true));
	for (let offset = 12; offset + 8 <= end;) {
		const type = ascii(bytes, offset, 4);
		const size = data.getUint32(offset + 4, true);
		// A chunk cut short is read as far as it goes.
		chunks.push({ type, data: bytes.subarray(offset + 8, Math.min(bytes.length, offset + 8 + size)) });
		if (offset + 8 + size > bytes.length) {
			break;
		}
		offset += 8 + size + (size % 2);
	}
	return chunks;
}

function readWebp(bytes: Uint8Array): IBaseHalfImageInfo | undefined {
	const chunks = webpChunks(bytes);
	if (!chunks) {
		return undefined;
	}
	let width = 0;
	let height = 0;
	let lossless = false;
	let orientation = 1;
	const metadata: Uint8Array[] = [];
	for (const chunk of chunks) {
		const data = view(chunk.data);
		switch (chunk.type) {
			case 'VP8X':
				width = 1 + (chunk.data[4] | chunk.data[5] << 8 | chunk.data[6] << 16);
				height = 1 + (chunk.data[7] | chunk.data[8] << 8 | chunk.data[9] << 16);
				break;
			case 'VP8L': {
				lossless = true;
				if (!width) {
					const bits = data.getUint32(1, true);
					width = (bits & 0x3fff) + 1;
					height = ((bits >> 14) & 0x3fff) + 1;
				}
				break;
			}
			case 'VP8 ':
				if (!width) {
					// The frame header: three bytes of the frame tag, the start code, then the sizes.
					width = data.getUint16(6, true) & 0x3fff;
					height = data.getUint16(8, true) & 0x3fff;
				}
				break;
			case 'EXIF': {
				const tiff = startsWith(chunk.data, 0, EXIF_HEADER) ? chunk.data.subarray(6) : chunk.data;
				orientation = readExifOrientation(tiff) ?? orientation;
				metadata.push(webpChunk('EXIF', chunk.data));
				break;
			}
			case 'XMP ':
				metadata.push(webpChunk('XMP ', chunk.data));
				break;
		}
	}
	return width && height ? { format: 'webp', width, height, orientation, lossless, metadata } : undefined;
}

// #region EXIF

interface ITiff {
	readonly data: DataView;
	readonly little: boolean;
}

function tiffOf(bytes: Uint8Array): ITiff | undefined {
	if (bytes.length < 8) {
		return undefined;
	}
	const little = bytes[0] === 0x49 && bytes[1] === 0x49;
	if (!little && !(bytes[0] === 0x4d && bytes[1] === 0x4d)) {
		return undefined;
	}
	const data = view(bytes);
	return data.getUint16(2, little) === 42 ? { data, little } : undefined;
}

/** The entries of an IFD: each one's tag, type, count, and the offset of its value field. */
function ifdEntries(tiff: ITiff, offset: number): { readonly entries: { readonly tag: number; readonly type: number; readonly count: number; readonly field: number }[]; readonly next: number } | undefined {
	const { data, little } = tiff;
	if (offset < 8 || offset + 2 > data.byteLength) {
		return undefined;
	}
	const count = data.getUint16(offset, little);
	if (offset + 2 + count * 12 + 4 > data.byteLength) {
		return undefined;
	}
	const entries = [];
	for (let index = 0; index < count; index++) {
		const entry = offset + 2 + index * 12;
		entries.push({ tag: data.getUint16(entry, little), type: data.getUint16(entry + 2, little), count: data.getUint32(entry + 4, little), field: entry + 8 });
	}
	return { entries, next: offset + 2 + count * 12 };
}

/** The orientation an EXIF block gives, from its TIFF header on; nothing when it gives none or cannot be read. */
export function readExifOrientation(bytes: Uint8Array): number | undefined {
	try {
		const tiff = tiffOf(bytes);
		const ifd = tiff && ifdEntries(tiff, tiff.data.getUint32(4, tiff.little));
		const entry = ifd?.entries.find(candidate => candidate.tag === 0x0112 && candidate.type === 3);
		const value = entry && tiff!.data.getUint16(entry.field, tiff!.little);
		return value && value >= 1 && value <= 8 ? value : undefined;
	} catch {
		return undefined;
	}
}

/**
 * A copy of an EXIF block, from its TIFF header on, for the upright edited
 * image of a size: orientation 1, no thumbnail of the original, and the
 * pixel size given; nothing when the block cannot be read.
 */
export function baseHalfUprightExif(bytes: Uint8Array, width: number, height: number): Uint8Array | undefined {
	try {
		const copy = bytes.slice();
		const tiff = tiffOf(copy);
		const ifd0 = tiff && ifdEntries(tiff, tiff.data.getUint32(4, tiff.little));
		if (!tiff || !ifd0) {
			return undefined;
		}
		const { data, little } = tiff;
		const setValue = (entry: { readonly type: number; readonly field: number }, value: number) => {
			if (entry.type === 3) {
				data.setUint16(entry.field, Math.min(value, 0xffff), little);
			} else if (entry.type === 4) {
				data.setUint32(entry.field, value, little);
			}
		};
		for (const entry of ifd0.entries) {
			if (entry.tag === 0x0112) {
				setValue(entry, 1);
			} else if (entry.tag === 0x8769 && entry.type === 4) {
				const exif = ifdEntries(tiff, data.getUint32(entry.field, little));
				for (const inner of exif?.entries ?? []) {
					if (inner.tag === 0xa002) {
						setValue(inner, width);
					} else if (inner.tag === 0xa003) {
						setValue(inner, height);
					}
				}
			}
		}
		// The thumbnail of the original is in the next directory: it is no longer linked.
		data.setUint32(ifd0.next, 0, little);
		return copy;
	} catch {
		return undefined;
	}
}

// #endregion

// #region Writing

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
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

function pngChunk(type: string, body: Uint8Array): Uint8Array {
	const chunk = new Uint8Array(12 + body.length);
	const data = view(chunk);
	data.setUint32(0, body.length);
	for (let index = 0; index < 4; index++) {
		chunk[4 + index] = type.charCodeAt(index);
	}
	chunk.set(body, 8);
	data.setUint32(8 + body.length, crc32(chunk.subarray(4, 8 + body.length)));
	return chunk;
}

function webpChunk(type: string, body: Uint8Array): Uint8Array {
	const chunk = new Uint8Array(8 + body.length + (body.length % 2));
	for (let index = 0; index < 4; index++) {
		chunk[index] = type.charCodeAt(index);
	}
	view(chunk).setUint32(4, body.length, true);
	chunk.set(body, 8);
	return chunk;
}

function jpegSegment(marker: number, body: Uint8Array): Uint8Array | undefined {
	if (body.length + 2 > 0xffff) {
		return undefined;
	}
	const segment = new Uint8Array(4 + body.length);
	segment[0] = 0xff;
	segment[1] = marker;
	view(segment).setUint16(2, body.length + 2);
	segment.set(body, 4);
	return segment;
}

/** XMP that says the image is upright, as its EXIF does. */
function uprightXmp(text: string): string {
	return text
		.replace(/tiff:Orientation="\d"/g, 'tiff:Orientation="1"')
		.replace(/<tiff:Orientation>\d<\/tiff:Orientation>/g, '<tiff:Orientation>1</tiff:Orientation>');
}

const latin1 = (bytes: Uint8Array) => ascii(bytes, 0, bytes.length);
const fromLatin1 = (text: string) => Uint8Array.from(text, character => character.charCodeAt(0) & 0xff);

/**
 * The image that the window encoded, with the information of the original
 * that an edited image keeps, made upright for its new size.
 */
export function withBaseHalfImageMetadata(encoded: Uint8Array, original: IBaseHalfImageInfo, width: number, height: number): Uint8Array {
	if (!original.metadata.length) {
		return encoded;
	}
	switch (original.format) {
		case 'png': return pngWithMetadata(encoded, original.metadata, width, height);
		case 'jpeg': return jpegWithMetadata(encoded, original.metadata, width, height);
		case 'webp': return webpWithMetadata(encoded, original.metadata, width, height);
	}
}

function pngWithMetadata(encoded: Uint8Array, metadata: readonly Uint8Array[], width: number, height: number): Uint8Array {
	if (!startsWith(encoded, 0, PNG_SIGNATURE)) {
		return encoded;
	}
	const data = view(encoded);
	const present = new Set<string>();
	let afterHeader = 0;
	for (let offset = 8; offset + 12 <= encoded.length;) {
		const length = data.getUint32(offset);
		const type = ascii(encoded, offset + 4, 4);
		present.add(type);
		offset += 12 + length;
		if (type === 'IHDR') {
			afterHeader = offset;
		}
	}
	if (!afterHeader) {
		return encoded;
	}
	const kept: Uint8Array[] = [];
	for (const chunk of metadata) {
		const type = ascii(chunk, 4, 4);
		if (type === 'pHYs' && present.has('pHYs')) {
			continue;
		}
		if (type === 'eXIf') {
			const exif = baseHalfUprightExif(chunk.subarray(8, chunk.length - 4), width, height);
			if (exif) {
				kept.push(pngChunk('eXIf', exif));
			}
			continue;
		}
		if (type === 'iTXt' && latin1(chunk.subarray(8, 8 + 18)) === 'XML:com.adobe.xmp\0' && chunk[8 + 18] === 0) {
			// An XMP packet that is not compressed, in UTF-8: only its ASCII orientation is changed.
			const body = chunk.subarray(8, chunk.length - 4);
			kept.push(pngChunk('iTXt', fromLatin1(uprightXmp(latin1(body)))));
			continue;
		}
		kept.push(chunk);
	}
	return concat([encoded.subarray(0, afterHeader), ...kept, encoded.subarray(afterHeader)]);
}

function jpegWithMetadata(encoded: Uint8Array, metadata: readonly Uint8Array[], width: number, height: number): Uint8Array {
	if (encoded[0] !== 0xff || encoded[1] !== 0xd8) {
		return encoded;
	}
	// After the start of the image and the window's own JFIF segment.
	let insertAt = 2;
	if (encoded[2] === 0xff && encoded[3] === 0xe0) {
		insertAt = 4 + view(encoded).getUint16(4);
	}
	const kept: Uint8Array[] = [];
	for (const segment of metadata) {
		const marker = segment[1];
		const body = segment.subarray(4);
		if (marker === 0xe1 && startsWith(body, 0, EXIF_HEADER)) {
			const exif = baseHalfUprightExif(body.subarray(6), width, height);
			const rewritten = exif && jpegSegment(0xe1, concat([Uint8Array.from(EXIF_HEADER), exif]));
			if (rewritten) {
				kept.push(rewritten);
			}
		} else if (marker === 0xe1 && latin1(body.subarray(0, XMP_HEADER.length)) === XMP_HEADER) {
			const rewritten = jpegSegment(0xe1, fromLatin1(uprightXmp(latin1(body))));
			if (rewritten) {
				kept.push(rewritten);
			}
		} else {
			kept.push(segment);
		}
	}
	return concat([encoded.subarray(0, insertAt), ...kept, encoded.subarray(insertAt)]);
}

function webpWithMetadata(encoded: Uint8Array, metadata: readonly Uint8Array[], width: number, height: number): Uint8Array {
	const chunks = ascii(encoded, 0, 4) === 'RIFF' && ascii(encoded, 8, 4) === 'WEBP' ? webpChunks(encoded) : undefined;
	if (!chunks) {
		return encoded;
	}
	const extra: Uint8Array[] = [];
	let flags = 0;
	for (const chunk of metadata) {
		const type = ascii(chunk, 0, 4);
		const body = chunk.subarray(8, 8 + view(chunk).getUint32(4, true));
		if (type === 'EXIF') {
			const prefixed = startsWith(body, 0, EXIF_HEADER);
			const exif = baseHalfUprightExif(prefixed ? body.subarray(6) : body, width, height);
			if (exif) {
				extra.push(webpChunk('EXIF', prefixed ? concat([Uint8Array.from(EXIF_HEADER), exif]) : exif));
				flags |= 0x08;
			}
		} else if (type === 'XMP ') {
			extra.push(webpChunk('XMP ', fromLatin1(uprightXmp(latin1(body)))));
			flags |= 0x04;
		}
	}
	if (!extra.length) {
		return encoded;
	}
	const image = chunks.filter(chunk => chunk.type === 'ALPH' || chunk.type === 'VP8 ' || chunk.type === 'VP8L');
	const existing = chunks.find(chunk => chunk.type === 'VP8X');
	const alpha = image.some(chunk => chunk.type === 'ALPH')
		|| (!!existing && (existing.data[0] & 0x10) !== 0)
		|| image.some(chunk => chunk.type === 'VP8L' && ((view(chunk.data).getUint32(1, true) >> 28) & 1) === 1);
	const header = new Uint8Array(10);
	header[0] = flags | (alpha ? 0x10 : 0);
	const canvasWidth = width - 1;
	const canvasHeight = height - 1;
	header.set([canvasWidth & 0xff, (canvasWidth >> 8) & 0xff, (canvasWidth >> 16) & 0xff, canvasHeight & 0xff, (canvasHeight >> 8) & 0xff, (canvasHeight >> 16) & 0xff], 4);
	const body = concat([Uint8Array.from([0x57, 0x45, 0x42, 0x50]), webpChunk('VP8X', header), ...image.map(chunk => webpChunk(chunk.type, chunk.data)), ...extra]);
	const riff = new Uint8Array(8 + body.length);
	riff.set([0x52, 0x49, 0x46, 0x46]);
	view(riff).setUint32(4, body.length, true);
	riff.set(body, 8);
	return riff;
}

// #endregion
