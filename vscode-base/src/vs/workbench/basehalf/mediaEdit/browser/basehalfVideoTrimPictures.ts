/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { baseHalfVideoFramesInShownOrder, IBaseHalfVideoByteSource, IBaseHalfVideoSample, IBaseHalfVideoTrack } from '../common/basehalfVideoFile.js';

/**
 * The pictures of the trim bar's strip (trimming a video, "What it shows"):
 * the frame shown at each of a list of times, small, and turned as the video
 * is shown. Each frame is decoded from the key frame before it, and frames
 * after one key frame are decoded once for all the pictures they hold, so
 * that a video with one key frame is decoded once.
 */

export interface IBaseHalfVideoTrimPicturesRequest {
	readonly source: IBaseHalfVideoByteSource;
	readonly video: IBaseHalfVideoTrack;
	/** In seconds, in the order of the strip. */
	readonly times: readonly number[];
	/** The height of a picture in device pixels; its width follows the picture's shape. */
	readonly height: number;
	readonly onPicture: (index: number, picture: ImageBitmap) => void;
	readonly token: CancellationToken;
}

interface IPictureGroup {
	/** The decode index of the key frame the group decodes from. */
	readonly key: number;
	/** The last decode index it needs. */
	last: number;
	/** Each target's frame time in microseconds, with the indexes of the pictures that show it. */
	readonly targets: Map<number, number[]>;
}

/** Reads the pictures, and resolves when every picture was given or the token is cancelled. */
export async function readBaseHalfVideoTrimPictures(request: IBaseHalfVideoTrimPicturesRequest): Promise<void> {
	const { video, source, token } = request;
	if (!video.codec || !request.times.length) {
		return;
	}
	const config: VideoDecoderConfig = {
		codec: video.codec,
		...(video.description ? { description: video.description } : {}),
		...(video.width && video.height ? { codedWidth: video.width, codedHeight: video.height } : {}),
		optimizeForLatency: true
	};
	try {
		if (!(await VideoDecoder.isConfigSupported(config)).supported) {
			return;
		}
	} catch {
		return;
	}
	const groups = groupTargets(video, request.times);
	const rotated = video.rotation === 90 || video.rotation === 270;
	const shownWidth = rotated ? video.displayHeight : video.displayWidth;
	const shownHeight = rotated ? video.displayWidth : video.displayHeight;
	const height = Math.max(1, Math.round(request.height));
	const width = Math.max(1, Math.round(height * (shownWidth || 16) / (shownHeight || 9)));
	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext('2d');
	if (!context) {
		return;
	}

	let current: IPictureGroup | undefined;
	let failed = false;
	const decoder = new VideoDecoder({
		output: frame => {
			try {
				const indexes = current?.targets.get(frame.timestamp);
				if (!indexes || token.isCancellationRequested) {
					return;
				}
				context.save();
				context.clearRect(0, 0, width, height);
				context.translate(width / 2, height / 2);
				context.rotate(video.rotation * Math.PI / 180);
				const drawWidth = rotated ? height : width;
				const drawHeight = rotated ? width : height;
				context.drawImage(frame, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
				context.restore();
				const picture = canvas.transferToImageBitmap();
				for (let index = 0; index < indexes.length; index++) {
					// Each picture of the same frame gets its own copy of the bitmap.
					request.onPicture(indexes[index], index === indexes.length - 1 ? picture : cloneBitmap(picture, width, height));
				}
			} catch {
				failed = true;
			} finally {
				frame.close();
			}
		},
		error: () => { failed = true; }
	});
	decoder.configure(config);
	try {
		for (const group of groups) {
			if (token.isCancellationRequested || failed) {
				break;
			}
			current = group;
			const samples = video.samples.slice(group.key, group.last + 1);
			for (const sample of samples) {
				if (token.isCancellationRequested || failed) {
					break;
				}
				const data = await source.read(sample.offset, sample.size);
				decoder.decode(new EncodedVideoChunk({
					type: sample.key ? 'key' : 'delta',
					timestamp: Math.round(sample.time * 1_000_000 / video.timescale),
					data
				}));
			}
			await decoder.flush();
		}
	} catch {
		// What could be read is shown; the rest of the strip stays empty.
	} finally {
		if (decoder.state !== 'closed') {
			decoder.close();
		}
	}
}

function cloneBitmap(picture: ImageBitmap, width: number, height: number): ImageBitmap {
	const copy = new OffscreenCanvas(width, height);
	copy.getContext('2d')?.drawImage(picture, 0, 0);
	return copy.transferToImageBitmap();
}

/** The frames to decode for the pictures, by the key frame each needs. */
function groupTargets(video: IBaseHalfVideoTrack, times: readonly number[]): IPictureGroup[] {
	const shown = baseHalfVideoFramesInShownOrder(video);
	const decodeIndex = new Map<IBaseHalfVideoSample, number>();
	video.samples.forEach((sample, index) => decodeIndex.set(sample, index));
	const groups = new Map<number, IPictureGroup>();
	times.forEach((time, pictureIndex) => {
		const units = time * video.timescale;
		// The frame shown at the time: the last one that starts at or before it.
		let low = 0;
		let high = shown.length - 1;
		while (low < high) {
			const middle = (low + high + 1) >> 1;
			if (shown[middle].time <= units) {
				low = middle;
			} else {
				high = middle - 1;
			}
		}
		const frame = shown[low];
		const index = decodeIndex.get(frame)!;
		let key = index;
		while (key > 0 && !video.samples[key].key) {
			key--;
		}
		while (key > 0 && video.samples[key].time > frame.time) {
			key--;
			while (key > 0 && !video.samples[key].key) {
				key--;
			}
		}
		let group = groups.get(key);
		if (!group) {
			group = { key, last: index, targets: new Map() };
			groups.set(key, group);
		}
		group.last = Math.max(group.last, index);
		const timestamp = Math.round(frame.time * 1_000_000 / video.timescale);
		const pictures = group.targets.get(timestamp) ?? [];
		pictures.push(pictureIndex);
		group.targets.set(timestamp, pictures);
	});
	return [...groups.values()].sort((a, b) => a.key - b.key);
}
