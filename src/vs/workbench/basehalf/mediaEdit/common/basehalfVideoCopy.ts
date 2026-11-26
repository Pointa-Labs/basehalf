/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IBaseHalfMp4CopyInput, IBaseHalfMp4CopyTrackInput } from './basehalfIsoBmffWriter.js';
import { baseHalfSoundPreroll, baseHalfSoundShown, baseHalfVideoPartFrames } from './basehalfVideoClipPlan.js';
import { IBaseHalfVideoFile, IBaseHalfVideoSample, IBaseHalfVideoTrack } from './basehalfVideoFile.js';
import { IBaseHalfVideoTrimRange } from './basehalfVideoTrimSelection.js';

/**
 * What a trim of an MP4, M4V, MOV, or M4A keeps when its samples are copied
 * as they are (editing media, "What the edited file holds", D99): the frames
 * of its picture that the part's frames need, from the key frame before its
 * start, and the packets of its first sound from those that its first packet
 * shown needs to one after the one at its end; each track with the time of
 * the original that it shows first and for how long, which the copy's edit
 * lists say.
 */

/** `und`, packed in three letters of five bits. */
const UNDETERMINED_LANGUAGE = 0x55C4;

/** Whether a copy can hold this file's tracks: an MP4 or a MOV whose tracks keep their sample entries. */
export function baseHalfCanCopyVideo(file: IBaseHalfVideoFile): boolean {
	return file.format !== 'webm' && (!file.video || !!file.video.sampleEntry) && (!!file.video || !!file.audio?.sampleEntry);
}

/** The copy of `range` of a file, in seconds of the original; its times are frame edges of the picture, or any times of a sound alone. */
export function planBaseHalfMp4Copy(file: IBaseHalfVideoFile, range: IBaseHalfVideoTrimRange): IBaseHalfMp4CopyInput {
	if (file.format === 'webm' || !baseHalfCanCopyVideo(file)) {
		throw new Error('Only an MP4 or a MOV with its sample entries is copied.');
	}
	const { start, end } = range;
	const tracks: IBaseHalfMp4CopyTrackInput[] = [];
	const video = file.video;
	if (video) {
		const { decode } = baseHalfVideoPartFrames(video, start, end);
		const turned = video.rotation === 90 || video.rotation === 270;
		tracks.push({
			kind: 'video',
			timescale: video.timescale,
			samples: decode,
			sampleEntry: video.sampleEntry!,
			language: video.language ?? UNDETERMINED_LANGUAGE,
			// The track's header has the size before its matrix turns it.
			width: turned ? video.displayHeight : video.displayWidth,
			height: turned ? video.displayWidth : video.displayHeight,
			matrix: video.matrix,
			delay: 0,
			from: start,
			length: end - start
		});
	}
	const sound = file.audio && copySound(file.audio, start, end);
	if (sound) {
		tracks.push(sound);
	}
	return {
		format: file.format,
		fileType: file.fileType,
		metadata: file.metadata,
		movieTimes: file.movieTimes,
		tracks
	};
}

/** The packets of a sound that a part from `start` to `end` keeps; nothing when the part holds none of it. */
function copySound(audio: IBaseHalfVideoTrack, start: number, end: number): IBaseHalfMp4CopyTrackInput | undefined {
	if (!audio.samples.length || !audio.sampleEntry) {
		return undefined;
	}
	const shown = baseHalfSoundShown(audio);
	const from = Math.max(start, shown.start);
	const to = Math.min(end, shown.end);
	if (to <= from) {
		return undefined;
	}
	const samples = audio.samples;
	const firstUnits = (from - baseHalfSoundPreroll(audio)) * audio.timescale;
	const lastUnits = to * audio.timescale;
	let first = 0;
	while (first < samples.length - 1 && samples[first].time + samples[first].duration <= firstUnits) {
		first++;
	}
	let last = samples.length - 1;
	while (last > first && samples[last].time >= lastUnits) {
		last--;
	}
	// One packet after the one at the end, which the decoder may need to give the end's sound whole.
	last = Math.min(samples.length - 1, last + 1);
	return {
		kind: 'audio',
		timescale: audio.timescale,
		samples: samples.slice(first, last + 1),
		sampleEntry: audio.sampleEntry,
		language: audio.language ?? UNDETERMINED_LANGUAGE,
		width: 0,
		height: 0,
		matrix: undefined,
		delay: from - start,
		from,
		length: to - from
	};
}

/**
 * What a trim of a WebM keeps (editing media, "What the edited file holds",
 * D99): a WebM has no edit list that players read, so its picture is copied
 * from the first key frame at or after the part's start, and the frames before
 * that key frame are encoded again in the video's codec; its Opus sound is
 * copied from 80 ms before the start to the packet at the end, and the file's
 * codec delay and discard padding cut it to the part.
 */
export interface IBaseHalfWebmCopyPlan {
	readonly start: number;
	readonly end: number;
	/** The picture's codec, which the frames encoded again are in too. */
	readonly codec: 'vp8' | 'vp9';
	/**
	 * The frames from the one at the start to the first key frame after it,
	 * encoded again, the samples that decode them, and the time the first copied
	 * frame is shown at, in seconds; nothing when the frame at the start is a
	 * key frame.
	 */
	readonly head: { readonly kept: readonly IBaseHalfVideoSample[]; readonly decode: readonly IBaseHalfVideoSample[]; readonly end: number } | undefined;
	/** The frames copied as they are, from the first key frame at or after the start to the last one shown before the end. */
	readonly copied: readonly IBaseHalfVideoSample[];
	/**
	 * The packets of an Opus sound copied as they are, with how much of their
	 * sound comes before the start and how long it is kept, in samples at
	 * 48 kHz, and when it starts, in seconds of the original; nothing when the
	 * sound is encoded again or the part holds none.
	 */
	readonly sound: { readonly packets: readonly IBaseHalfVideoSample[]; readonly delay: number; readonly length: number; readonly from: number } | undefined;
}

/** Opus always decodes at 48 kHz (RFC 7845, section 4). */
const OPUS_RATE = 48_000;

/** Whether a trim of a WebM can copy its frames: VP8, or VP9 of 8 bits in 4:2:0, whose frames the window encodes. */
export function baseHalfCanCopyWebm(file: IBaseHalfVideoFile): boolean {
	const codec = file.video?.codec;
	return file.format === 'webm' && (codec === 'vp8' || !!codec?.startsWith('vp09.00.'));
}

/** The copy of `range` of a WebM, in seconds; its times are frame edges. */
export function planBaseHalfWebmCopy(file: IBaseHalfVideoFile, range: IBaseHalfVideoTrimRange): IBaseHalfWebmCopyPlan {
	const video = file.video;
	if (!video || !baseHalfCanCopyWebm(file)) {
		throw new Error('Only a WebM in VP8 or in VP9 of 8 bits is copied.');
	}
	const { start, end } = range;
	const { kept, decode } = baseHalfVideoPartFrames(video, start, end);
	// VP8 and VP9 show their frames in the order they are decoded.
	const key = kept.findIndex(frame => frame.key);
	const encoded = key < 0 ? kept.length : key;
	const head = encoded > 0 ? {
		kept: kept.slice(0, encoded),
		decode: decode.slice(0, decode.indexOf(kept[encoded - 1]) + 1),
		end: key < 0 ? end : kept[key].time / video.timescale
	} : undefined;
	return {
		start,
		end,
		codec: video.codec === 'vp8' ? 'vp8' : 'vp9',
		head,
		copied: kept.slice(encoded),
		sound: file.audio && copyOpus(file.audio, start, end)
	};
}

/** The Opus packets that a part keeps, in mono or stereo, which the WebM writer heads as it does its own; nothing for any other sound. */
function copyOpus(audio: IBaseHalfVideoTrack, start: number, end: number): IBaseHalfWebmCopyPlan['sound'] {
	if (audio.codec !== 'opus' || audio.channels > 2 || !audio.samples.length) {
		return undefined;
	}
	const shown = baseHalfSoundShown(audio);
	const from = Math.max(start, shown.start);
	const to = Math.min(end, shown.end);
	if (to <= from) {
		return undefined;
	}
	const samples = audio.samples;
	const firstUnits = (from - baseHalfSoundPreroll(audio)) * audio.timescale;
	let first = 0;
	while (first < samples.length - 1 && samples[first].time + samples[first].duration <= firstUnits) {
		first++;
	}
	// The packet at the end is the last: a WebM drops the padding of its last packet only, and Opus needs none after it.
	let last = samples.length - 1;
	while (last > first && samples[last].time >= to * audio.timescale) {
		last--;
	}
	return {
		packets: samples.slice(first, last + 1),
		delay: Math.max(0, Math.round((from - samples[first].time / audio.timescale) * OPUS_RATE)),
		length: Math.round((to - from) * OPUS_RATE),
		from
	};
}
