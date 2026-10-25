/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { baseHalfVideoFramesInShownOrder, IBaseHalfVideoFile, IBaseHalfVideoSample, IBaseHalfVideoTrack } from './basehalfVideoFile.js';
import { IBaseHalfVideoTrimRange } from './basehalfVideoTrimSelection.js';

/**
 * What the clip that a trim makes of a video holds (trimming a video, "What
 * the trimmed video holds"): the frames that are decoded, from the key frame
 * they need, and the frames that are kept, those shown between the start and
 * the end; the packets of sound that are decoded and the exact range of sound
 * that is kept; and the codec, container, and bitrates the clip is encoded
 * with.
 */

export type BaseHalfVideoClipCodec = 'avc' | 'hevc' | 'vp9';
export type BaseHalfVideoClipContainer = 'mp4' | 'mov' | 'webm';

/** The family of a picture's codec, which decides how much bitrate H.264 needs to keep it. */
export type BaseHalfVideoCodecFamily = 'avc' | 'hevc' | 'vp9' | 'av1' | 'other';

export interface IBaseHalfVideoClipPicturePlan {
	/** The samples to decode, in the order they are decoded, from a key frame. */
	readonly decode: readonly IBaseHalfVideoSample[];
	/** The frames to keep, in the order they are shown. */
	readonly kept: readonly IBaseHalfVideoSample[];
	/** The clip's codec: VP9 in WebM, HEVC for an HEVC video, H.264 otherwise. */
	readonly codec: BaseHalfVideoClipCodec;
	readonly sourceFamily: BaseHalfVideoCodecFamily;
	/** The video's average bitrate, in bits per second. */
	readonly sourceBitrate: number;
	/** Width times height times frame rate of the picture. */
	readonly pixelsPerSecond: number;
	/** The clip's bitrate in its codec, in bits per second. */
	readonly bitrate: number;
	/** Frames per second, to tell the encoder. */
	readonly frameRate: number;
}

export interface IBaseHalfVideoClipSoundPlan {
	/** The packets to decode, in order. */
	readonly decode: readonly IBaseHalfVideoSample[];
	/** The sound that is kept, in seconds of the video. */
	readonly from: number;
	readonly to: number;
	/** Whether the clip cuts into the sound at its start, or at its end: there it fades. */
	readonly fadeIn: boolean;
	readonly fadeOut: boolean;
	/** In bits per second. */
	readonly bitrate: number;
}

export interface IBaseHalfVideoClipPlan {
	readonly start: number;
	readonly end: number;
	readonly container: BaseHalfVideoClipContainer;
	readonly picture: IBaseHalfVideoClipPicturePlan;
	/** Nothing when the video has no sound in the clip's range. */
	readonly sound: IBaseHalfVideoClipSoundPlan | undefined;
	/** The size the clip will have, about, in bytes. */
	readonly estimatedBytes: number;
}

const MIN_VIDEO_BITRATE = 1_000_000;
const MAX_VIDEO_BITRATE = 100_000_000;
/** The bitrates of AAC that the system's encoder on Windows takes, and that a clip's sound has, in Opus too. */
const AUDIO_BITRATES = [96_000, 128_000, 160_000, 192_000];
/** Packets of sound decoded before the clip's start, so that the first one kept is whole. */
const SOUND_PREROLL_PACKETS = 2;
const SOUND_PREROLL_SECONDS = 0.08;

/** The track's average bitrate over its samples, in bits per second. */
export function baseHalfVideoTrackBitrate(track: Pick<IBaseHalfVideoTrack, 'samples' | 'timescale'>): number {
	if (!track.samples.length) {
		return 0;
	}
	let bytes = 0;
	let first = Infinity;
	let last = -Infinity;
	for (const sample of track.samples) {
		bytes += sample.size;
		first = Math.min(first, sample.time);
		last = Math.max(last, sample.time + sample.duration);
	}
	const seconds = (last - first) / track.timescale;
	return seconds > 0 ? bytes * 8 / seconds : 0;
}

export function baseHalfVideoCodecFamily(format: string): BaseHalfVideoCodecFamily {
	switch (format) {
		case 'avc1':
		case 'avc3':
		case 'V_MPEG4/ISO/AVC':
			return 'avc';
		case 'hvc1':
		case 'hev1':
		case 'V_MPEGH/ISO/HEVC':
			return 'hevc';
		case 'vp09':
		case 'V_VP9':
			return 'vp9';
		case 'av01':
		case 'V_AV1':
			return 'av1';
		default:
			return 'other';
	}
}

/** The fewest bits for each pixel of each frame, by the clip's codec: the window's encoders need more than the encoders of most generated videos. */
const MIN_BITS_PER_PIXEL: Readonly<Record<BaseHalfVideoClipCodec, number>> = { avc: 0.07, hevc: 0.05, vp9: 0.07 };

/**
 * The bitrate of a clip's picture (trimming a video, "Its format"): at least
 * the video's own, more when the clip's codec keeps less in a bit than the
 * video's did, at least the bits per pixel its codec needs for
 * `pixelsPerSecond` (width times height times frame rate), between 1 and
 * 100 Mbit/s.
 */
export function baseHalfVideoClipBitrate(sourceBitrate: number, sourceFamily: BaseHalfVideoCodecFamily, codec: BaseHalfVideoClipCodec, pixelsPerSecond: number): number {
	let factor = 1.25;
	if (codec === 'avc' && (sourceFamily === 'hevc' || sourceFamily === 'vp9')) {
		factor = 1.6;
	} else if ((codec === 'avc' || codec === 'vp9') && sourceFamily === 'av1') {
		factor = 2;
	}
	const floor = MIN_BITS_PER_PIXEL[codec] * pixelsPerSecond;
	return Math.round(Math.min(MAX_VIDEO_BITRATE, Math.max(MIN_VIDEO_BITRATE, sourceBitrate * factor, floor)));
}

/** The bitrate of a clip's sound: the video's, snapped to one that every system's AAC encoder takes. */
export function baseHalfVideoClipSoundBitrate(sourceBitrate: number): number {
	let best = AUDIO_BITRATES[0];
	for (const candidate of AUDIO_BITRATES) {
		if (Math.abs(candidate - sourceBitrate) < Math.abs(best - sourceBitrate)) {
			best = candidate;
		}
	}
	return best;
}

/** The container of a clip of a video with this extension: the video's own, since the trimmed video keeps its name. */
export function baseHalfVideoClipContainer(extension: string): BaseHalfVideoClipContainer {
	switch (extension.toLowerCase()) {
		case 'mov': return 'mov';
		case 'webm': return 'webm';
		default: return 'mp4';
	}
}

/**
 * The plan of a clip of `range` of a video file with the extension
 * `extension`. The range's times are frame edges; a time between two edges
 * keeps the frame shown at it. A muted clip has no sound.
 */
export function planBaseHalfVideoClip(file: IBaseHalfVideoFile, extension: string, range: IBaseHalfVideoTrimRange, options?: { readonly mute?: boolean }): IBaseHalfVideoClipPlan {
	const video = file.video;
	if (!video) {
		throw new Error('A video without a picture has no clip.');
	}
	const { start, end } = range;
	const shown = baseHalfVideoFramesInShownOrder(video);
	const startUnits = start * video.timescale;
	const endUnits = end * video.timescale;
	const tolerance = 1e-6 * video.timescale;
	const kept: IBaseHalfVideoSample[] = [];
	for (let index = 0; index < shown.length; index++) {
		const frame = shown[index];
		const next = index + 1 < shown.length ? shown[index + 1].time : frame.time + frame.duration;
		// A frame is kept when it is shown for some time between the start and the end.
		if (next > startUnits + tolerance && frame.time < endUnits - tolerance) {
			kept.push(frame);
		}
	}
	if (!kept.length) {
		throw new Error('The selection holds no frame.');
	}

	const decodeIndex = new Map<IBaseHalfVideoSample, number>();
	video.samples.forEach((sample, index) => decodeIndex.set(sample, index));
	let first = Infinity;
	let last = -1;
	for (const frame of kept) {
		const index = decodeIndex.get(frame)!;
		first = Math.min(first, index);
		last = Math.max(last, index);
	}
	let key = first;
	while (key > 0 && !video.samples[key].key) {
		key--;
	}
	// A frame shown before its key frame needs the frames of the key frame before (an open group of pictures).
	const shownFirst = kept[0].time;
	while (key > 0 && video.samples[key].time > shownFirst) {
		key--;
		while (key > 0 && !video.samples[key].key) {
			key--;
		}
	}
	const decode = video.samples.slice(key, last + 1);

	const container = baseHalfVideoClipContainer(extension);
	const sourceFamily = baseHalfVideoCodecFamily(video.format);
	const codec: BaseHalfVideoClipCodec = container === 'webm' ? 'vp9' : sourceFamily === 'hevc' ? 'hevc' : 'avc';
	const sourceBitrate = baseHalfVideoTrackBitrate(video);
	const frameRate = end > start ? kept.length / (end - start) : 30;
	const pixelsPerSecond = video.width * video.height * frameRate;
	const bitrate = baseHalfVideoClipBitrate(sourceBitrate, sourceFamily, codec, pixelsPerSecond);

	const sound = options?.mute ? undefined : planSound(file.audio, start, end);
	// The estimate takes the bitrate of H.264, which is the higher one when HEVC cannot be encoded.
	const largest = Math.max(bitrate, codec === 'hevc' ? baseHalfVideoClipBitrate(sourceBitrate, sourceFamily, 'avc', pixelsPerSecond) : 0);
	const estimatedBytes = Math.round((largest + (sound?.bitrate ?? 0)) / 8 * (end - start)) + kept.length * 64;
	return {
		start,
		end,
		container,
		picture: { decode, kept, codec, sourceFamily, sourceBitrate, pixelsPerSecond, bitrate, frameRate },
		sound,
		estimatedBytes
	};
}

function planSound(audio: IBaseHalfVideoTrack | undefined, start: number, end: number): IBaseHalfVideoClipSoundPlan | undefined {
	if (!audio || !audio.samples.length) {
		return undefined;
	}
	const seconds = (units: number) => units / audio.timescale;
	const lastSample = audio.samples[audio.samples.length - 1];
	const soundStart = Math.max(0, seconds(audio.samples[0].time));
	const soundEnd = Math.min(
		seconds(lastSample.time + lastSample.duration),
		audio.end !== undefined ? seconds(audio.end) : Infinity
	);
	const from = Math.max(start, soundStart);
	const to = Math.min(end, soundEnd);
	if (to <= from) {
		return undefined;
	}
	const packet = seconds(audio.samples[0].duration) || 0.02;
	const preroll = Math.max(SOUND_PREROLL_PACKETS * packet, audio.codec === 'opus' ? SOUND_PREROLL_SECONDS : 0);
	const decode = audio.samples.filter(sample => seconds(sample.time + sample.duration) > from - preroll && seconds(sample.time) < to);
	const bitrate = baseHalfVideoClipSoundBitrate(baseHalfVideoTrackBitrate(audio));
	return {
		decode,
		from,
		to,
		// A cut at the sound's own start or end does not fade.
		fadeIn: from > soundStart + 1e-6,
		fadeOut: to < soundEnd - 1e-6,
		bitrate
	};
}
