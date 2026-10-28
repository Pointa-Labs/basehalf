/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { baseHalfVideoFramesInShownOrder, IBaseHalfVideoByteSource, IBaseHalfVideoSample, IBaseHalfVideoTrack } from '../common/basehalfVideoFile.js';

/**
 * The pictures of the frame viewer's strip (editing media, "The frame
 * viewer"): the frame shown at each of a list of times, small, and turned as
 * the video is shown. A picture with a key frame near its time is that key
 * frame, read alone, as a phone's filmstrip reads its pictures (D101); any
 * other is decoded from the key frame before it, and frames after one key
 * frame are decoded once for all the pictures they hold, so that a video with
 * one key frame is decoded once.
 */

export interface IBaseHalfVideoTrimPicturesRequest {
	readonly source: IBaseHalfVideoByteSource;
	readonly video: IBaseHalfVideoTrack;
	/** In seconds, in the order of the strip. */
	readonly times: readonly number[];
	/**
	 * How far from its time a picture may be, in seconds: the key frame
	 * nearest its time within this is read alone (D101). With none there, or
	 * by default, the picture is the exact frame.
	 */
	readonly tolerance?: number;
	/** The height of a picture in device pixels; its width follows the picture's shape. */
	readonly height: number;
	readonly onPicture: (index: number, picture: ImageBitmap) => void;
	readonly token: CancellationToken;
}

/** Frames to decode in one run, in decode order, and the pictures the frames shown at each time in microseconds hold. */
export interface IBaseHalfVideoPictureRun {
	/** Decode indexes of the samples. */
	readonly samples: readonly number[];
	readonly targets: ReadonlyMap<number, readonly number[]>;
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
	const runs = planBaseHalfVideoPictures(video, request.times, request.tolerance ?? 0);
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

	let current: IBaseHalfVideoPictureRun | undefined;
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
		for (const run of runs) {
			if (token.isCancellationRequested || failed) {
				break;
			}
			current = run;
			for (const index of run.samples) {
				if (token.isCancellationRequested || failed) {
					break;
				}
				const sample = video.samples[index];
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

/**
 * The runs of frames to decode for the pictures at `times`: first one run of
 * the key frames that pictures within `tolerance` seconds of a key frame show,
 * each read alone (D101); then, for every other picture, the frames from the
 * key frame before its exact frame, one run for each key frame they need.
 */
export function planBaseHalfVideoPictures(video: IBaseHalfVideoTrack, times: readonly number[], tolerance: number): IBaseHalfVideoPictureRun[] {
	const shown = baseHalfVideoFramesInShownOrder(video);
	const decodeIndex = new Map<IBaseHalfVideoSample, number>();
	video.samples.forEach((sample, index) => decodeIndex.set(sample, index));
	const keys = shown.filter(sample => sample.key);
	const keyTargets = new Map<number, number[]>();
	const keySamples = new Set<number>();
	const groups = new Map<number, { readonly key: number; last: number; readonly targets: Map<number, number[]> }>();
	const timestampOf = (sample: IBaseHalfVideoSample) => Math.round(sample.time * 1_000_000 / video.timescale);
	const add = (targets: Map<number, number[]>, sample: IBaseHalfVideoSample, picture: number) => {
		const timestamp = timestampOf(sample);
		const pictures = targets.get(timestamp) ?? [];
		pictures.push(picture);
		targets.set(timestamp, pictures);
	};
	times.forEach((time, pictureIndex) => {
		const units = time * video.timescale;
		// The key frame nearest the time, when one lies within the tolerance: it is read alone.
		if (tolerance > 0 && keys.length) {
			const nearest = keys[nearestShown(keys, units)];
			if (Math.abs(nearest.time - units) <= tolerance * video.timescale) {
				keySamples.add(decodeIndex.get(nearest)!);
				add(keyTargets, nearest, pictureIndex);
				return;
			}
		}
		// The frame shown at the time: the last one that starts at or before it.
		const frame = shown[lastShownAtOrBefore(shown, units)];
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
		add(group.targets, frame, pictureIndex);
	});
	const runs: IBaseHalfVideoPictureRun[] = [];
	if (keySamples.size) {
		runs.push({ samples: [...keySamples].sort((a, b) => a - b), targets: keyTargets });
	}
	for (const group of [...groups.values()].sort((a, b) => a.key - b.key)) {
		const samples: number[] = [];
		for (let index = group.key; index <= group.last; index++) {
			samples.push(index);
		}
		runs.push({ samples, targets: group.targets });
	}
	return runs;
}

/** The index of the last frame, in shown order, that starts at or before `units`. */
function lastShownAtOrBefore(frames: readonly IBaseHalfVideoSample[], units: number): number {
	let low = 0;
	let high = frames.length - 1;
	while (low < high) {
		const middle = (low + high + 1) >> 1;
		if (frames[middle].time <= units) {
			low = middle;
		} else {
			high = middle - 1;
		}
	}
	return low;
}

/** The index of the frame, in shown order, that starts nearest `units`. */
function nearestShown(frames: readonly IBaseHalfVideoSample[], units: number): number {
	const before = lastShownAtOrBefore(frames, units);
	const after = Math.min(before + 1, frames.length - 1);
	return Math.abs(frames[after].time - units) < Math.abs(frames[before].time - units) ? after : before;
}
