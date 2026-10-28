/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IBaseHalfMp4CopyInput, IBaseHalfMp4CopyTrackInput } from './basehalfIsoBmffWriter.js';
import { baseHalfSoundPreroll, baseHalfSoundShown, baseHalfVideoPartFrames } from './basehalfVideoClipPlan.js';
import { IBaseHalfVideoFile, IBaseHalfVideoTrack } from './basehalfVideoFile.js';
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
