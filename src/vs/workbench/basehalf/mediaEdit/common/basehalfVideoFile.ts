/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';

/**
 * What BaseHalf reads of a video file to trim it (trimming a video, "Saving a
 * clip"): its picture and its first sound, each a list of compressed samples
 * with the times the player shows them at, and the information at the level
 * of the file that a clip copies. MP4, MOV, and M4V files are read by
 * `readBaseHalfIsoBmffFile`, WebM files by `readBaseHalfWebmFile`.
 */

/** The bytes of a video file: its size, and a part of it. */
export interface IBaseHalfVideoByteSource {
	readonly size: number;
	read(offset: number, length: number): Promise<Uint8Array>;
}

/** One compressed frame of a picture, or one packet of a sound. */
export interface IBaseHalfVideoSample {
	/** Where the sample's bytes are in the file. */
	readonly offset: number;
	readonly size: number;
	/** When it is decoded, in the track's units. */
	readonly decodeTime: number;
	/**
	 * When it is shown, in the track's units, after the file's edit list or
	 * codec delay: a sample before the video's start has a negative time.
	 */
	readonly time: number;
	readonly duration: number;
	/** A key frame, which decodes without the frames before it. Every packet of a sound is one. */
	readonly key: boolean;
}

export type BaseHalfVideoTrackKind = 'video' | 'audio';

export interface IBaseHalfVideoTrack {
	readonly kind: BaseHalfVideoTrackKind;
	/** The sample entry of an MP4 (`avc1`, `hvc1`, `mp4a`) or the codec id of a WebM (`V_VP9`). */
	readonly format: string;
	/** The codec as the window's decoders name it (`avc1.640028`), or nothing when BaseHalf cannot name it. */
	readonly codec: string | undefined;
	/** What the decoder needs besides the samples: `avcC`, `hvcC`, the AudioSpecificConfig of AAC, OpusHead. */
	readonly description: Uint8Array | undefined;
	/** Units per second of the samples' times. */
	readonly timescale: number;
	/** In the order they are decoded. */
	readonly samples: readonly IBaseHalfVideoSample[];
	/** The picture's size as it is coded, for a picture. */
	readonly width: number;
	readonly height: number;
	/** The picture's size as it is shown, after its track's matrix; the coded size when the file says nothing else. */
	readonly displayWidth: number;
	readonly displayHeight: number;
	/** The nine values of the track's matrix as the file has them, which a clip keeps; nothing for an identity matrix. */
	readonly matrix: readonly number[] | undefined;
	/** How far the matrix turns the picture clockwise, in degrees. */
	readonly rotation: 0 | 90 | 180 | 270;
	/** For a sound. */
	readonly sampleRate: number;
	readonly channels: number;
	/**
	 * Where the track stops being shown, in the track's units, when the file's
	 * edit list ends it before its last sample does; nothing otherwise.
	 */
	readonly end: number | undefined;
	/** The sample entry of an MP4's or a MOV's track, whole and as the file has it, which a copy of a trim keeps; nothing for a WebM. */
	readonly sampleEntry?: Uint8Array;
	/** The language of an MP4's or a MOV's track, packed as its `mdhd` box has it; nothing for a WebM. */
	readonly language?: number;
}

export type BaseHalfVideoFileFormat = 'mp4' | 'mov' | 'webm';

export interface IBaseHalfVideoFile {
	readonly format: BaseHalfVideoFileFormat;
	readonly video: IBaseHalfVideoTrack | undefined;
	readonly audio: IBaseHalfVideoTrack | undefined;
	/**
	 * The information at the level of the file, which a clip copies unchanged:
	 * the whole `udta` and `meta` boxes of an MP4's or a MOV's movie, as they
	 * are in the file. A WebM has none that BaseHalf copies.
	 */
	readonly metadata: readonly Uint8Array[];
	/** The `ftyp` box of an MP4 or a MOV, whole, which a copy of a trim keeps; nothing for a WebM, or for a MOV that has none. */
	readonly fileType?: Uint8Array;
	/** When an MP4's or a MOV's movie was made and last changed, in seconds since 1904 as its `mvhd` box has them, which a copy of a trim keeps. */
	readonly movieTimes?: { readonly created: number; readonly modified: number };
}

export type BaseHalfVideoFileErrorReason = 'format' | 'noPicture' | 'unsupportedEditList' | 'tooLarge' | 'read';

/** Why a video cannot be read to trim it, in words the status line of the trim bar shows. */
export class BaseHalfVideoFileError extends Error {
	constructor(readonly reason: BaseHalfVideoFileErrorReason, message?: string) {
		super(message ?? baseHalfVideoFileErrorMessage(reason));
		this.name = 'BaseHalfVideoFileError';
	}
}

export function baseHalfVideoFileErrorMessage(reason: BaseHalfVideoFileErrorReason): string {
	switch (reason) {
		case 'format': return localize('basehalf.videoTrim.file.format', "its file cannot be read as MP4, MOV, or WebM.");
		case 'noPicture': return localize('basehalf.videoTrim.file.noPicture', "it has no picture.");
		case 'unsupportedEditList': return localize('basehalf.videoTrim.file.editList', "it is put together from several parts, which BaseHalf does not read.");
		case 'tooLarge': return localize('basehalf.videoTrim.file.tooLarge', "its index is too large to read.");
		case 'read': return localize('basehalf.videoTrim.file.read', "its file could not be read.");
	}
}

/** A time of a track in seconds. */
export function baseHalfVideoSeconds(track: Pick<IBaseHalfVideoTrack, 'timescale'>, units: number): number {
	return units / track.timescale;
}

/**
 * The samples of a picture in the order they are shown, which is the order
 * of their times. The decode order is the track's own.
 */
export function baseHalfVideoFramesInShownOrder(track: Pick<IBaseHalfVideoTrack, 'samples'>): readonly IBaseHalfVideoSample[] {
	return [...track.samples].sort((a, b) => a.time - b.time);
}

/**
 * The frame edges of a picture, in seconds (trimming a video, "Terms"): the
 * time each frame starts to be shown, from 0 on, and the end of the last
 * frame. A frame shown before 0 is not one of the video's frames; one that
 * starts before 0 and goes on after it starts the video at 0.
 */
export function baseHalfVideoFrameEdges(track: Pick<IBaseHalfVideoTrack, 'samples' | 'timescale' | 'end'>): readonly number[] {
	const frames = baseHalfVideoFramesInShownOrder(track);
	const shownEnd = track.end !== undefined ? track.end / track.timescale : Infinity;
	const edges: number[] = [];
	let end = 0;
	for (let index = 0; index < frames.length; index++) {
		const frame = frames[index];
		const start = frame.time / track.timescale;
		const next = Math.min(shownEnd, index + 1 < frames.length ? frames[index + 1].time / track.timescale : (frame.time + frame.duration) / track.timescale);
		if (next <= 0 || start >= shownEnd) {
			continue;
		}
		const edge = Math.max(0, start);
		if (!edges.length || edge > edges[edges.length - 1]) {
			edges.push(edge);
		}
		end = Math.max(end, next);
	}
	if (edges.length && end > edges[edges.length - 1]) {
		edges.push(end);
	}
	return edges;
}
