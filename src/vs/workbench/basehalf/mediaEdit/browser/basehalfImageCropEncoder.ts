/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { IBaseHalfMediaChoices } from '../common/basehalfEditRecord.js';
import { baseHalfPictureTransform, baseHalfTurnedSize, baseHalfWholeCrop } from '../common/basehalfImageCrop.js';
import { BaseHalfImageFormat, IBaseHalfImageInfo, withBaseHalfImageMetadata } from '../common/basehalfImageFile.js';

/**
 * Makes the edited image of a crop (editing media, "An image") with the
 * window's own decoder and encoders: the original, upright as its camera
 * gave it, turned, flipped, and straightened, the part kept at the
 * original's scale, in the original's format with its information. Without
 * an angle, and with the part on whole pixels, the pixels kept are copied as
 * they are; with one, they are resampled smoothly.
 */

/** The longest side and the most pixels an edited image may have: it is drawn whole in memory. */
export const BASEHALF_IMAGE_MAX_SIDE = 16_384;
export const BASEHALF_IMAGE_MAX_PIXELS = 256 * 1024 * 1024;
/** The quality of a JPEG, and of a WebP that was not without loss. */
const LOSSY_QUALITY = 0.95;

export type BaseHalfImageCropErrorReason = 'decode' | 'tooLarge' | 'encode';

export class BaseHalfImageCropError extends Error {
	constructor(readonly reason: BaseHalfImageCropErrorReason) {
		super(baseHalfImageCropErrorMessage(reason));
		this.name = 'BaseHalfImageCropError';
	}
}

function baseHalfImageCropErrorMessage(reason: BaseHalfImageCropErrorReason): string {
	switch (reason) {
		case 'decode': return localize('basehalf.mediaEdit.image.decode', "this system cannot decode the image.");
		case 'tooLarge': return localize('basehalf.mediaEdit.image.tooLarge', "the edited image would be larger than 16,384 pixels on a side or 256 million pixels.");
		case 'encode': return localize('basehalf.mediaEdit.image.encode', "the window could not encode the image.");
	}
}

export function baseHalfImageMimeType(format: BaseHalfImageFormat): string {
	switch (format) {
		case 'png': return 'image/png';
		case 'jpeg': return 'image/jpeg';
		case 'webp': return 'image/webp';
	}
}

export interface IBaseHalfImageCropEncoding {
	readonly bytes: Uint8Array;
	readonly width: number;
	readonly height: number;
}

/** Encodes the edit of an original image file. */
export async function encodeBaseHalfImageCrop(bytes: Uint8Array, info: IBaseHalfImageInfo, choices: IBaseHalfMediaChoices): Promise<IBaseHalfImageCropEncoding> {
	let bitmap: ImageBitmap;
	try {
		// Upright as the window shows it, with its colors in the window's.
		bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: baseHalfImageMimeType(info.format) }), { imageOrientation: 'from-image' });
	} catch {
		throw new BaseHalfImageCropError('decode');
	}
	try {
		const original = { width: bitmap.width, height: bitmap.height };
		const turn = choices.turn ?? 0;
		const picture = baseHalfTurnedSize(original, turn);
		const crop = choices.crop ?? baseHalfWholeCrop(picture);
		const width = Math.round(crop.width);
		const height = Math.round(crop.height);
		if (width > BASEHALF_IMAGE_MAX_SIDE || height > BASEHALF_IMAGE_MAX_SIDE || width * height > BASEHALF_IMAGE_MAX_PIXELS) {
			throw new BaseHalfImageCropError('tooLarge');
		}
		const canvas = new OffscreenCanvas(width, height);
		const context = canvas.getContext('2d', { alpha: info.format !== 'jpeg' });
		if (!context) {
			throw new BaseHalfImageCropError('encode');
		}
		const straighten = choices.straighten ?? 0;
		const exact = !straighten && Number.isInteger(crop.x - width / 2) && Number.isInteger(crop.y - height / 2);
		context.imageSmoothingEnabled = !exact;
		context.imageSmoothingQuality = 'high';
		// The part's center at the canvas's, the picture turned clockwise under it, and the original turned and flipped into the picture.
		context.translate(width / 2, height / 2);
		context.rotate(straighten * Math.PI / 180);
		context.translate(-crop.x, -crop.y);
		const [a, b, c, d, e, f] = baseHalfPictureTransform(original, turn, !!choices.flip);
		context.transform(a, b, c, d, e, f);
		context.drawImage(bitmap, 0, 0);
		let blob: Blob;
		try {
			blob = await canvas.convertToBlob({
				type: baseHalfImageMimeType(info.format),
				// A WebP at quality 1 is encoded without loss.
				...(info.format === 'png' ? {} : { quality: info.format === 'webp' && info.lossless ? 1 : LOSSY_QUALITY })
			});
		} catch {
			throw new BaseHalfImageCropError('encode');
		}
		const encoded = new Uint8Array(await blob.arrayBuffer());
		return { bytes: withBaseHalfImageMetadata(encoded, info, width, height), width, height };
	} finally {
		bitmap.close();
	}
}
