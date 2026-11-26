/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { encodeBaseHalfImageCrop } from '../../browser/basehalfImageCropEncoder.js';
import { readBaseHalfImageInfo, readExifOrientation } from '../../common/basehalfImageFile.js';

/** The pixel of the test pattern at a place: every pixel of a row and of a column differs. */
function pattern(x: number, y: number): [number, number, number] {
	return [x & 255, y & 255, (x * 7 + y * 3) & 255];
}

async function makeImage(width: number, height: number, type: 'image/png' | 'image/jpeg' | 'image/webp', quality?: number): Promise<Uint8Array> {
	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext('2d')!;
	const data = context.createImageData(width, height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const [r, g, b] = pattern(x, y);
			data.data.set([r, g, b, 255], (y * width + x) * 4);
		}
	}
	context.putImageData(data, 0, 0);
	return new Uint8Array(await (await canvas.convertToBlob({ type, ...(quality !== undefined ? { quality } : {}) })).arrayBuffer());
}

async function pixels(bytes: Uint8Array, type: string): Promise<{ readonly width: number; readonly height: number; readonly data: Uint8ClampedArray }> {
	const bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
	const context = canvas.getContext('2d')!;
	context.drawImage(bitmap, 0, 0);
	bitmap.close();
	return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
}

/** A PNG chunk with its length, type, and CRC. */
function pngChunk(type: string, text: string): Uint8Array {
	const body = Uint8Array.from(text, character => character.charCodeAt(0));
	const chunk = new Uint8Array(12 + body.length);
	const view = new DataView(chunk.buffer);
	view.setUint32(0, body.length);
	chunk.set(Array.from(type, character => character.charCodeAt(0)), 4);
	chunk.set(body, 8);
	let crc = 0xffffffff;
	for (const byte of chunk.subarray(4, 8 + body.length)) {
		crc ^= byte;
		for (let k = 0; k < 8; k++) {
			crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
		}
	}
	view.setUint32(8 + body.length, (crc ^ 0xffffffff) >>> 0);
	return chunk;
}

function insertAfterHeader(png: Uint8Array, chunk: Uint8Array): Uint8Array {
	const headerEnd = 8 + 12 + new DataView(png.buffer, png.byteOffset).getUint32(8);
	const out = new Uint8Array(png.length + chunk.length);
	out.set(png.subarray(0, headerEnd));
	out.set(chunk, headerEnd);
	out.set(png.subarray(headerEnd), headerEnd + chunk.length);
	return out;
}

/** A big-endian EXIF block with an orientation, a pixel size in its Exif directory, and a thumbnail directory after it. */
function exifBlock(orientation: number): Uint8Array {
	const bytes = new Uint8Array(96);
	const view = new DataView(bytes.buffer);
	bytes.set([0x4d, 0x4d]);
	view.setUint16(2, 42);
	view.setUint32(4, 8);
	// IFD0: orientation and the pointer to the Exif directory; then the next directory, the thumbnail's.
	view.setUint16(8, 2);
	view.setUint16(10, 0x0112); view.setUint16(12, 3); view.setUint32(14, 1); view.setUint16(18, orientation);
	view.setUint16(22, 0x8769); view.setUint16(24, 4); view.setUint32(26, 1); view.setUint32(30, 38);
	view.setUint32(34, 70);
	// The Exif directory: its pixel size.
	view.setUint16(38, 2);
	view.setUint16(40, 0xa002); view.setUint16(42, 4); view.setUint32(44, 1); view.setUint32(48, 999);
	view.setUint16(52, 0xa003); view.setUint16(54, 4); view.setUint32(56, 1); view.setUint32(60, 888);
	view.setUint32(64, 0);
	// IFD1, the thumbnail's.
	view.setUint16(70, 0);
	view.setUint32(72, 0);
	return bytes;
}

function withExif(jpeg: Uint8Array, exif: Uint8Array): Uint8Array {
	const body = new Uint8Array(6 + exif.length);
	body.set([0x45, 0x78, 0x69, 0x66, 0, 0]);
	body.set(exif, 6);
	const segment = new Uint8Array(4 + body.length);
	segment.set([0xff, 0xe1]);
	new DataView(segment.buffer).setUint16(2, body.length + 2);
	segment.set(body, 4);
	const out = new Uint8Array(jpeg.length + segment.length);
	out.set(jpeg.subarray(0, 2));
	out.set(segment, 2);
	out.set(jpeg.subarray(2), 2 + segment.length);
	return out;
}

suite('BaseHalfImageCropEncoder', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('a PNG cropped to 16:9 keeps the rows of the original at its scale, pixel for pixel, with its text (D84)', async () => {
		const source = insertAfterHeader(await makeImage(256, 256, 'image/png'), pngChunk('tEXt', 'AIGC\0{"Label":"1"}'));
		const info = readBaseHalfImageInfo(source)!;
		const encoding = await encodeBaseHalfImageCrop(source, info, { crop: { x: 128, y: 128, width: 256, height: 144 } });
		const out = await pixels(encoding.bytes, 'image/png');
		let differences = 0;
		for (let y = 0; y < out.height; y++) {
			for (let x = 0; x < out.width; x++) {
				const [r, g, b] = pattern(x, y + 56);
				const at = (y * out.width + x) * 4;
				differences += out.data[at] !== r || out.data[at + 1] !== g || out.data[at + 2] !== b ? 1 : 0;
			}
		}
		assert.deepStrictEqual({ size: [out.width, out.height], differences, kept: readBaseHalfImageInfo(encoding.bytes)?.metadata.length }, { size: [256, 144], differences: 0, kept: 1 });
	});

	test('a quarter turn and a flip give the original\'s pixels turned and mirrored; an angle of 10° leaves no empty corner (D84)', async () => {
		const source = await makeImage(64, 48, 'image/png');
		const info = readBaseHalfImageInfo(source)!;
		// Turned a quarter to the left, the picture is 48 wide and 64 high; mirrored, its column x shows the turned column 47 − x.
		const turned = await pixels((await encodeBaseHalfImageCrop(source, info, { turn: 1, flip: true })).bytes, 'image/png');
		let differences = 0;
		for (let y = 0; y < turned.height; y++) {
			for (let x = 0; x < turned.width; x++) {
				// Turned left: the picture's point (tx, ty) is the original's (W − 1 − ty, tx); mirrored, tx = 47 − x.
				const [r, g, b] = pattern(64 - 1 - y, 47 - x);
				const at = (y * turned.width + x) * 4;
				differences += turned.data[at] !== r || turned.data[at + 1] !== g || turned.data[at + 2] !== b ? 1 : 0;
			}
		}
		const straightened = await pixels((await encodeBaseHalfImageCrop(source, info, { straighten: 10, crop: { x: 32, y: 24, width: 40, height: 30 } })).bytes, 'image/png');
		const corners = [[0, 0], [39, 0], [0, 29], [39, 29]].map(([x, y]) => straightened.data[(y * straightened.width + x) * 4 + 3]);
		assert.deepStrictEqual({ size: [turned.width, turned.height], differences, corners }, { size: [48, 64], differences: 0, corners: [255, 255, 255, 255] });
	});

	test('a JPEG that its camera turned is saved upright: its EXIF says orientation 1, gives the new size, and links no thumbnail (D84)', async () => {
		const source = withExif(await makeImage(40, 30, 'image/jpeg', 0.95), exifBlock(6));
		const info = readBaseHalfImageInfo(source)!;
		// The whole picture as it shows, 30 wide and 40 high.
		const encoding = await encodeBaseHalfImageCrop(source, info, { crop: { x: 15, y: 20, width: 30, height: 40 } });
		const read = readBaseHalfImageInfo(encoding.bytes)!;
		const exif = read.metadata.map(segment => segment.subarray(10)).find(block => readExifOrientation(block) !== undefined)!;
		const view = new DataView(exif.buffer, exif.byteOffset, exif.byteLength);
		assert.deepStrictEqual({
			oriented: [info.orientation, info.width, info.height],
			out: [encoding.width, encoding.height, read.orientation],
			pixelSize: [view.getUint32(48), view.getUint32(60)],
			nextDirectory: view.getUint32(34)
		}, {
			oriented: [6, 40, 30],
			out: [30, 40, 1],
			pixelSize: [30, 40],
			nextDirectory: 0
		});
	});

	test('a WebP without loss stays without loss, and one with loss is encoded at 0.95 (D84)', async () => {
		const lossless = await makeImage(32, 32, 'image/webp', 1);
		const lossy = await makeImage(32, 32, 'image/webp', 0.8);
		const out = [lossless, lossy].map(async bytes => readBaseHalfImageInfo((await encodeBaseHalfImageCrop(bytes, readBaseHalfImageInfo(bytes)!, { turn: 2 })).bytes)?.lossless);
		assert.deepStrictEqual([readBaseHalfImageInfo(lossless)?.lossless, readBaseHalfImageInfo(lossy)?.lossless, ...(await Promise.all(out))], [true, false, true, false]);
	});
});
