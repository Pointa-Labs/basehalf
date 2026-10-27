/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { FileOperationError, FileOperationResult, IFileService } from '../../../../platform/files/common/files.js';
import { baseHalfCanvasMediaUrl } from '../../canvas/browser/basehalfCanvasCardMedia.js';
import type { BaseHalfCanvasSceneVideoFrame } from '../../canvas/common/basehalfCanvasScene.js';

/**
 * Capture Frame of a video generation card (generation cards, "The
 * toolbar"): the first, the current, or the last frame of the card's video,
 * written as a PNG into the card's folder and named after the card and the
 * frame (`shot first frame.png`), with a number when the name is taken. The
 * workbench puts its card to the right of the video card, connected from it;
 * it is an ordinary image that can be connected to another card.
 */

export interface IBaseHalfVideoFrameCaptureRequest {
	/** The video file, with the query that names its version, so that the frame is of the video as it is now. */
	readonly video: URI;
	/** The folder the frame is written into: the card's. */
	readonly folder: URI;
	/** The card's name without its extension, which names the frame's file. */
	readonly title: string;
	readonly frame: BaseHalfCanvasSceneVideoFrame;
	/** The current frame: the time the card's player shows, in seconds. */
	readonly currentTime?: number;
	/** Whether a name no file or folder has is taken all the same: by a draft (generation cards, "Creating a generation card"). */
	readonly isNameTaken?: (resource: URI) => Promise<boolean>;
}

export interface IBaseHalfVideoFrameImage {
	readonly png: VSBuffer;
	/** The time of the frame in the video, in seconds. */
	readonly time: number;
}

/** Decodes one frame of a video as a PNG. The workbench uses the browser's video player; tests pass their own. */
export interface IBaseHalfVideoFrameReader {
	read(video: URI, timeOf: (duration: number) => number): Promise<IBaseHalfVideoFrameImage>;
}

/** How long a frame may take to load before the capture gives up. */
const FRAME_READ_TIMEOUT_MS = 20_000;
const MAX_TITLE_LENGTH = 100;

/** Captures the frame and resolves with the PNG file it wrote. */
export async function captureBaseHalfVideoFrame(
	fileService: IFileService,
	request: IBaseHalfVideoFrameCaptureRequest,
	reader: IBaseHalfVideoFrameReader
): Promise<URI> {
	const image = await reader.read(request.video, duration => baseHalfVideoFrameTime(request.frame, duration, request.currentTime));
	for (let ordinal = 1; ordinal < 1000; ordinal++) {
		const target = joinPath(request.folder, baseHalfVideoFrameFileName(request.title, request.frame, image.time, ordinal));
		if (await fileService.exists(target) || await request.isNameTaken?.(target)) {
			continue;
		}
		try {
			await fileService.createFile(target, image.png, { overwrite: false });
			return target;
		} catch (error) {
			if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_MODIFIED_SINCE) {
				// Another file took the name in the meantime: the next number.
				continue;
			}
			throw error;
		}
	}
	throw new Error(localize('basehalf.video.frame.noName', "No free name is left for a frame of {0}.", request.title));
}

/**
 * The time in the video that a frame is taken at: the start, the time the
 * player shows (inside the video), or just before the end, where the last
 * frame is shown.
 */
export function baseHalfVideoFrameTime(frame: BaseHalfCanvasSceneVideoFrame, duration: number, currentTime?: number): number {
	const length = Number.isFinite(duration) && duration > 0 ? duration : 0;
	const last = Math.max(0, length - Math.min(0.001, length / 2));
	switch (frame) {
		case 'first':
			return 0;
		case 'last':
			return last;
		case 'current': {
			const time = currentTime !== undefined && Number.isFinite(currentTime) ? currentTime : 0;
			return Math.min(last, Math.max(0, time));
		}
	}
}

/**
 * `Shot 1 first frame.png`, `Shot 1 last frame.png`, or `Shot 1 frame at
 * 3.2s.png`; from the second file of the same name on, a number is added:
 * `Shot 1 first frame 2.png`.
 */
export function baseHalfVideoFrameFileName(title: string, frame: BaseHalfCanvasSceneVideoFrame, time: number, ordinal = 1): string {
	const name = baseHalfVideoFrameFileTitle(title);
	let base: string;
	switch (frame) {
		case 'first':
			base = localize('basehalf.video.frame.first', "{0} first frame", name);
			break;
		case 'last':
			base = localize('basehalf.video.frame.last', "{0} last frame", name);
			break;
		case 'current':
			base = localize('basehalf.video.frame.at', "{0} frame at {1}s", name, formatFrameSeconds(time));
			break;
	}
	return ordinal > 1 ? `${base} ${ordinal}.png` : `${base}.png`;
}

/** The card's name as it can stand in a file name on every system. */
function baseHalfVideoFrameFileTitle(title: string): string {
	const cleaned = title.replace(/[\\/:*?"<>|\u0000-\u001F]+/g, '-').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
	const clipped = cleaned.length > MAX_TITLE_LENGTH ? cleaned.slice(0, MAX_TITLE_LENGTH).trim() : cleaned;
	return clipped || localize('basehalf.video.frame.untitled', "Video");
}

/** Seconds with at most one decimal: `0`, `3.2`, `61.5`. */
function formatFrameSeconds(seconds: number): string {
	const tenths = Math.round(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 10);
	return tenths % 10 === 0 ? String(tenths / 10) : (tenths / 10).toFixed(1);
}

/** Reads frames with a video element of `targetWindow` and draws them to PNG with a canvas. */
export function createBaseHalfVideoFrameReader(targetWindow: Window): IBaseHalfVideoFrameReader {
	return {
		async read(video: URI, timeOf: (duration: number) => number): Promise<IBaseHalfVideoFrameImage> {
			const targetDocument = targetWindow.document;
			const element = targetDocument.createElement('video');
			element.muted = true;
			element.playsInline = true;
			element.preload = 'auto';
			try {
				const loaded = waitFor(element, 'loadedmetadata', targetWindow);
				element.src = baseHalfCanvasMediaUrl(video);
				await loaded;
				if (!Number.isFinite(element.duration)) {
					// Some recorded videos do not say how long they are: a seek past
					// the end makes the player find out.
					const found = waitFor(element, 'seeked', targetWindow);
					element.currentTime = Number.MAX_SAFE_INTEGER;
					await found;
				}
				// A seek, also to the start, has the player decode the frame at that time.
				const seeked = waitFor(element, 'seeked', targetWindow);
				element.currentTime = timeOf(element.duration);
				await seeked;
				if (element.readyState < element.HAVE_CURRENT_DATA) {
					await waitFor(element, 'loadeddata', targetWindow);
				}
				if (!element.videoWidth || !element.videoHeight) {
					throw new Error(localize('basehalf.video.frame.noPicture', "The video has no picture to capture."));
				}
				const canvas = targetDocument.createElement('canvas');
				canvas.width = element.videoWidth;
				canvas.height = element.videoHeight;
				const context = canvas.getContext('2d');
				if (!context) {
					throw new Error(localize('basehalf.video.frame.noCanvas', "The frame could not be drawn."));
				}
				context.drawImage(element, 0, 0, canvas.width, canvas.height);
				const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
				if (!blob) {
					throw new Error(localize('basehalf.video.frame.noPng', "The frame could not be written as a PNG."));
				}
				return { png: VSBuffer.wrap(new Uint8Array(await blob.arrayBuffer())), time: element.currentTime };
			} finally {
				element.removeAttribute('src');
				element.load();
			}
		}
	};
}

/** Resolves on `event` of the video, and rejects when it fails to load or takes too long. */
function waitFor(element: HTMLVideoElement, event: 'loadedmetadata' | 'loadeddata' | 'seeked', targetWindow: Window): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const done = () => {
			cleanup();
			resolve();
		};
		const failed = () => {
			cleanup();
			reject(new Error(localize('basehalf.video.frame.unreadable', "The video could not be read to capture a frame.")));
		};
		const timer = targetWindow.setTimeout(() => {
			cleanup();
			reject(new Error(localize('basehalf.video.frame.timeout', "The video took too long to show the frame.")));
		}, FRAME_READ_TIMEOUT_MS);
		const cleanup = () => {
			targetWindow.clearTimeout(timer);
			element.removeEventListener(event, done);
			element.removeEventListener('error', failed);
		};
		element.addEventListener(event, done, { once: true });
		element.addEventListener('error', failed, { once: true });
	});
}
