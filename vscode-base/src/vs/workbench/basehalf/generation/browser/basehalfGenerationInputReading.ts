/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer, encodeBase64 } from '../../../../base/common/buffer.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { extname } from '../../../../base/common/resources.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { stripBaseHalfMarkdownFrontMatter } from '../common/basehalfGenerationInputs.js';

// Reading the inputs a generation sends: a text file up to a limit, and a picture drawn again in a format a
// provider takes.

/** The head of a text input that is read: enough for front matter and 16 KiB of text. */
const TEXT_INPUT_READ_BYTES = 256 * 1024;

/** The longest side of an image drawn to PNG. */
const RASTER_MAX_SIDE = 4096;

/** A vector image without a useful size is drawn at least this large. */
const RASTER_VECTOR_SIDE = 1024;

/** Draws an image that providers do not take (SVG, GIF, AVIF, BMP) to a PNG data URL. */
export type BaseHalfVideoImageRasterizer = (bytes: VSBuffer, mimeType: string) => Promise<string>;

/** The text a text input adds to the prompt: its head, without a note's front matter. */
export async function readBaseHalfVideoTextInput(fileService: IFileService, file: URI): Promise<string> {
	const text = (await fileService.readFile(file, { length: TEXT_INPUT_READ_BYTES })).value.toString();
	const extension = extname(file).toLowerCase();
	return extension === '.md' || extension === '.markdown' ? stripBaseHalfMarkdownFrontMatter(text) : text;
}

/**
 * Draws an image to a PNG data URL in the window, on white: providers take
 * PNG, JPEG, and WebP only, and some refuse transparency. A vector image is
 * drawn at least {@link RASTER_VECTOR_SIDE} pixels on its long side.
 */
export async function rasterizeBaseHalfVideoImage(bytes: VSBuffer, mimeType: string): Promise<string> {
	const targetWindow = mainWindow;
	const blob = new Blob([bytes.buffer.slice()], { type: mimeType });
	const url = URL.createObjectURL(blob);
	try {
		const image = new targetWindow.Image();
		image.src = url;
		await image.decode();
		let width = image.naturalWidth;
		let height = image.naturalHeight;
		if (!width || !height) {
			width = RASTER_VECTOR_SIDE;
			height = RASTER_VECTOR_SIDE;
		}
		const vector = mimeType === 'image/svg+xml';
		const longSide = Math.max(width, height);
		const scale = Math.min(RASTER_MAX_SIDE / longSide, vector ? Math.max(1, RASTER_VECTOR_SIDE / longSide) : 1);
		const canvas = targetWindow.document.createElement('canvas');
		canvas.width = Math.max(1, Math.round(width * scale));
		canvas.height = Math.max(1, Math.round(height * scale));
		const context = canvas.getContext('2d');
		if (!context) {
			throw new Error('No 2D canvas context.');
		}
		context.fillStyle = '#ffffff';
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.drawImage(image, 0, 0, canvas.width, canvas.height);
		const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('The image could not be encoded as PNG.')), 'image/png'));
		return `data:image/png;base64,${encodeBase64(VSBuffer.wrap(new Uint8Array(await png.arrayBuffer())))}`;
	} finally {
		URL.revokeObjectURL(url);
	}
}
