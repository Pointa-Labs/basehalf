/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfOrientedSize, baseHalfUprightExif, readBaseHalfImageInfo, readExifOrientation, withBaseHalfImageMetadata } from '../../common/basehalfImageFile.js';

const bytes = (...parts: (string | number[] | Uint8Array)[]) => {
	const arrays = parts.map(part => typeof part === 'string' ? Uint8Array.from(part, character => character.charCodeAt(0)) : Uint8Array.from(part));
	const out = new Uint8Array(arrays.reduce((sum, part) => sum + part.length, 0));
	let offset = 0;
	for (const part of arrays) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
};
const u32 = (value: number) => [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
const u16 = (value: number) => [value >>> 8, value & 255];
const le32 = (value: number) => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, value >>> 24];

/** A PNG chunk; the CRC does not matter to the reader. */
const pngChunk = (type: string, body: Uint8Array) => bytes(u32(body.length), type, body, [0, 0, 0, 0]);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A little-endian EXIF block with only an orientation. */
function exif(orientation: number): Uint8Array {
	return bytes('II', [42, 0], le32(8), [1, 0], [0x12, 0x01, 3, 0], le32(1), [orientation, 0, 0, 0], le32(26), [0, 0, 0, 0, 0, 0]);
}

suite('BaseHalfImageFile', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('reads the size, the orientation, and the information an edit keeps of a PNG, a JPEG, and a WebP (D84)', () => {
		const png = bytes(PNG_SIGNATURE, pngChunk('IHDR', bytes(u32(300), u32(200), [8, 2, 0, 0, 0])), pngChunk('eXIf', exif(6)), pngChunk('tEXt', bytes('Comment\0hi')), pngChunk('iCCP', bytes('p\0\0x')), pngChunk('IDAT', bytes([1, 2, 3])), pngChunk('IEND', bytes()));
		const jpeg = bytes([0xff, 0xd8], [0xff, 0xe0], u16(4), [0, 0], [0xff, 0xe1], u16(2 + 6 + exif(8).length), 'Exif\0\0', exif(8), [0xff, 0xe2], u16(4), [9, 9], [0xff, 0xc0], u16(11), [8], u16(120), u16(160), [1, 1, 0x11, 0], [0xff, 0xda], u16(2));
		const webp = bytes('RIFF', le32(4 + 8 + 10 + 8 + 5 + 1), 'WEBP', 'VP8X', le32(10), [0x08, 0, 0, 0], [99, 0, 0, 49, 0, 0], 'VP8L', le32(5), [0x2f, 0, 0, 0, 0], [0]);
		const infos = [png, jpeg, webp].map(file => readBaseHalfImageInfo(file));
		assert.deepStrictEqual(infos.map(info => info && { format: info.format, size: [info.width, info.height], oriented: baseHalfOrientedSize(info), orientation: info.orientation, lossless: info.lossless, kept: info.metadata.length }), [
			// The color profile is not kept: the pixels are in the window's colors.
			{ format: 'png', size: [300, 200], oriented: { width: 200, height: 300 }, orientation: 6, lossless: true, kept: 2 },
			{ format: 'jpeg', size: [160, 120], oriented: { width: 120, height: 160 }, orientation: 8, lossless: false, kept: 1 },
			{ format: 'webp', size: [100, 50], oriented: { width: 100, height: 50 }, orientation: 1, lossless: true, kept: 0 }
		]);
		// The first bytes of a file give its size; a file cut before its size gives nothing.
		assert.deepStrictEqual([readBaseHalfImageInfo(bytes('GIF89a')), readBaseHalfImageInfo(png.subarray(0, 20)), readBaseHalfImageInfo(png.subarray(0, 40))?.width], [undefined, undefined, 300]);
	});

	test('upright EXIF has orientation 1 and no next directory; EXIF that cannot be read is left out (D84)', () => {
		const block = exif(3);
		const upright = baseHalfUprightExif(block, 10, 20)!;
		assert.deepStrictEqual([readExifOrientation(block), readExifOrientation(upright), new DataView(upright.buffer).getUint32(22, true), baseHalfUprightExif(bytes('XX', [0, 0]), 1, 1), readExifOrientation(block)], [3, 1, 0, undefined, 3]);
	});

	test('puts the information of the original into the encoded image: chunks after the header of a PNG, segments after the JFIF of a JPEG, and a WebP made extended (D84)', () => {
		const original = readBaseHalfImageInfo(bytes(PNG_SIGNATURE, pngChunk('IHDR', bytes(u32(4), u32(4), [8, 2, 0, 0, 0])), pngChunk('tEXt', bytes('Title\0still')), pngChunk('eXIf', exif(6)), pngChunk('IEND', bytes())))!;
		const encoded = bytes(PNG_SIGNATURE, pngChunk('IHDR', bytes(u32(2), u32(2), [8, 2, 0, 0, 0])), pngChunk('IDAT', bytes([7])), pngChunk('IEND', bytes()));
		const withText = readBaseHalfImageInfo(withBaseHalfImageMetadata(encoded, original, 2, 2))!;

		const webpOriginal = readBaseHalfImageInfo(bytes('RIFF', le32(4 + 8 + 10 + 8 + 5 + 1 + 8 + exif(6).length), 'WEBP', 'VP8X', le32(10), [0x08, 0, 0, 0], [3, 0, 0, 3, 0, 0], 'VP8L', le32(5), [0x2f, 0, 0, 0, 0], [0], 'EXIF', le32(exif(6).length), exif(6)))!;
		const webpEncoded = bytes('RIFF', le32(4 + 8 + 5 + 1), 'WEBP', 'VP8L', le32(5), [0x2f, 1, 0, 0, 0], [0]);
		const extended = withBaseHalfImageMetadata(webpEncoded, webpOriginal, 2, 1);
		const extendedInfo = readBaseHalfImageInfo(extended)!;
		assert.deepStrictEqual({
			png: [withText.width, withText.metadata.length, withText.orientation],
			webp: [String.fromCharCode(...extended.subarray(12, 16)), extended[20] & 0x08, extendedInfo.width, extendedInfo.height, extendedInfo.orientation, extendedInfo.lossless]
		}, {
			png: [2, 2, 1],
			webp: ['VP8X', 0x08, 2, 1, 1, true]
		});
	});
});
