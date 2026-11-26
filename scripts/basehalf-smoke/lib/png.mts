/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The pixels of the window's screenshots.

import zlib from 'zlib';

/** The pixels of a PNG of 8 bits a channel, gray, RGB, or RGBA, as the window's screenshots are. */
export function decodePng(png) {
	let offset = 8;
	let width = 0;
	let height = 0;
	let channels = 0;
	const data = [];
	while (offset < png.length) {
		const length = png.readUInt32BE(offset);
		const type = png.toString('latin1', offset + 4, offset + 8);
		const body = png.subarray(offset + 8, offset + 8 + length);
		if (type === 'IHDR') {
			width = body.readUInt32BE(0);
			height = body.readUInt32BE(4);
			channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[body[9]];
			if (body[8] !== 8 || !channels) {
				throw new Error(`A screenshot of ${body[8]} bits in color type ${body[9]} cannot be read here.`);
			}
		} else if (type === 'IDAT') {
			data.push(body);
		}
		offset += 12 + length;
	}
	const raw = zlib.inflateSync(Buffer.concat(data));
	const stride = width * channels;
	const pixels = Buffer.alloc(stride * height);
	for (let row = 0; row < height; row++) {
		const filter = raw[row * (stride + 1)];
		const line = raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1));
		for (let index = 0; index < stride; index++) {
			const left = index >= channels ? pixels[row * stride + index - channels] : 0;
			const up = row > 0 ? pixels[(row - 1) * stride + index] : 0;
			const upLeft = row > 0 && index >= channels ? pixels[(row - 1) * stride + index - channels] : 0;
			const paeth = () => {
				const estimate = left + up - upLeft;
				const [a, b, c] = [Math.abs(estimate - left), Math.abs(estimate - up), Math.abs(estimate - upLeft)];
				return a <= b && a <= c ? left : b <= c ? up : upLeft;
			};
			const predicted = filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : filter === 4 ? paeth() : 0;
			pixels[row * stride + index] = (line[index] + predicted) & 0xff;
		}
	}
	return { width, height, channels, pixels };
}

/**
 * The pixel of a screenshot nearest to `color`, an `[red, green, blue]`, and
 * its distance: the largest difference of a channel. The core of a letter is
 * drawn in its color, its edges blend into what lies behind.
 */
export function nearestPixel(png, color) {
	const { width, height, channels, pixels } = decodePng(png);
	let nearest = { distance: Infinity, rgb: [0, 0, 0] };
	for (let index = 0; index < width * height; index++) {
		const at = index * channels;
		const rgb = channels >= 3 ? [pixels[at], pixels[at + 1], pixels[at + 2]] : [pixels[at], pixels[at], pixels[at]];
		const distance = Math.max(...rgb.map((value, channel) => Math.abs(value - color[channel])));
		if (distance < nearest.distance) {
			nearest = { distance, rgb };
		}
	}
	return nearest;
}

/**
 * How the page of `element` draws the color `rgb` on the screen: a
 * screenshot holds colors as the screen shows them, in the screen's color
 * space, so a color is compared with a block of it that the same page draws.
 */
export async function screenColor(element, rgb) {
	const block = await element.evaluateHandle((node, value) => {
		const swatch = node.ownerDocument.createElement('div');
		swatch.style.cssText = `position:fixed;left:0;top:0;width:12px;height:12px;z-index:2147483647;pointer-events:none;background:rgb(${value.join(',')})`;
		node.ownerDocument.body.append(swatch);
		return swatch;
	}, rgb);
	try {
		const { width, height, channels, pixels } = decodePng(await block.screenshot());
		const at = (Math.floor(height / 2) * width + Math.floor(width / 2)) * channels;
		return [pixels[at], pixels[at + 1], pixels[at + 2]];
	} finally {
		await block.evaluate(swatch => swatch.remove());
	}
}

/**
 * The color `element` is drawn in, and whether its screenshot holds the
 * color `rgb` as the screen shows it, within 2 a channel: the core of a
 * letter is drawn in its color.
 */
export async function drawnColor(element, rgb) {
	await element.waitFor({ state: 'visible', timeout: 15_000 });
	const color = await element.evaluate(node => getComputedStyle(node).color);
	const shown = await screenColor(element, rgb);
	const { distance, rgb: nearest } = nearestPixel(await element.screenshot(), shown);
	return { color, pixels: distance <= 2 ? `rgb(${rgb.join(', ')})` : `none nearer than rgb(${nearest.join(', ')}) to rgb(${shown.join(', ')})` };
}
