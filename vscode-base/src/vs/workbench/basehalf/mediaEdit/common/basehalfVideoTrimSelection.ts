/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';

/**
 * The selection of the trim bar (trimming a video, "The pointer" and "The
 * keyboard"): the part of a video between two frame edges, at least 1.0 s
 * long or the whole video when it is shorter. A handle moved closer than that
 * to the other one pushes the other one along until it reaches the start or
 * the end of the video.
 */

/** The shortest selection, in seconds. */
export const BASEHALF_VIDEO_TRIM_MIN_LENGTH = 1;

export interface IBaseHalfVideoTrimRange {
	/** Seconds from the start of the video, on frame edges. */
	readonly start: number;
	readonly end: number;
}

export type BaseHalfVideoTrimHandle = 'start' | 'end';

/** Two times closer than this are the same frame edge. */
const EPSILON = 1e-6;

/**
 * A length or a time as the trim bar shows it, as the player above it shows
 * times: in tenths of a second under a minute (`3.5s` for 3.57 s), in minutes
 * and seconds from a minute on (`1:05`), never more than it is.
 */
export function formatBaseHalfVideoTrimLength(seconds: number): string {
	const value = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
	// A frame edge a hair under a tenth, as times in units of a video give it, is that tenth.
	const tenths = Math.floor((value + EPSILON) * 10);
	if (tenths < 600) {
		return localize('basehalf.videoTrim.lengthSeconds', "{0}s", (tenths / 10).toFixed(1));
	}
	const whole = Math.floor(value + EPSILON);
	return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * The time of a handle as the bubble over it shows it while it is pressed
 * (editing media, "The frame viewer", D102): minutes, seconds, and
 * hundredths (`00:26.40`), with hours before them from an hour on
 * (`1:02:03.40`), never more than it is.
 */
export function formatBaseHalfVideoHandleTime(seconds: number): string {
	const value = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
	const hundredths = Math.floor((value + EPSILON) * 100);
	const whole = Math.floor(hundredths / 100);
	const minutes = Math.floor(whole / 60);
	const time = `${String(minutes % 60).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}.${String(hundredths % 100).padStart(2, '0')}`;
	return minutes >= 60 ? `${Math.floor(minutes / 60)}:${time}` : time;
}

/** The frame edges of a video and the selections they allow. */
export class BaseHalfVideoTrimTimeline {

	/** At least two edges, sorted: the first is 0 and the last is the end of the video. */
	readonly edges: readonly number[];

	constructor(edges: readonly number[]) {
		const sorted = [...edges].filter(edge => Number.isFinite(edge) && edge >= 0).sort((a, b) => a - b);
		const unique: number[] = [];
		for (const edge of sorted) {
			if (!unique.length || edge - unique[unique.length - 1] > EPSILON) {
				unique.push(edge);
			}
		}
		if (!unique.length || unique[0] > EPSILON) {
			unique.unshift(0);
		}
		if (unique.length < 2) {
			unique.push(unique[0] + 1 / 30);
		}
		this.edges = Object.freeze(unique);
	}

	get duration(): number {
		return this.edges[this.edges.length - 1];
	}

	/** The shortest selection: 1.0 s, or the whole video when it is shorter. */
	get minLength(): number {
		return Math.min(BASEHALF_VIDEO_TRIM_MIN_LENGTH, this.duration);
	}

	whole(): IBaseHalfVideoTrimRange {
		return { start: 0, end: this.duration };
	}

	isWhole(range: IBaseHalfVideoTrimRange): boolean {
		return range.start <= EPSILON && range.end >= this.duration - EPSILON;
	}

	/** The frame edge nearest to a time, within the video. */
	snap(time: number): number {
		const index = this.indexAtOrBefore(time);
		const before = this.edges[index];
		const after = this.edges[Math.min(index + 1, this.edges.length - 1)];
		return time - before <= after - time ? before : after;
	}

	/** The first frame edge at or after a time, or the end of the video. */
	edgeAtOrAfter(time: number): number {
		const index = this.indexAtOrBefore(time);
		const edge = this.edges[index];
		return edge >= time - EPSILON ? edge : this.edges[Math.min(index + 1, this.edges.length - 1)];
	}

	/** The last frame edge at or before a time, or the start of the video. */
	edgeAtOrBefore(time: number): number {
		return this.edges[this.indexAtOrBefore(time)];
	}

	/** The edge one frame after or before an edge. */
	stepFrame(edge: number, direction: 1 | -1): number {
		const index = this.indexAtOrBefore(edge + EPSILON);
		return this.edges[Math.min(Math.max(index + direction, 0), this.edges.length - 1)];
	}

	private indexAtOrBefore(time: number): number {
		let low = 0;
		let high = this.edges.length - 1;
		if (time <= this.edges[0]) {
			return 0;
		}
		while (low < high) {
			const middle = (low + high + 1) >> 1;
			if (this.edges[middle] <= time + EPSILON) {
				low = middle;
			} else {
				high = middle - 1;
			}
		}
		return low;
	}

	/**
	 * Moves one handle to the frame edge nearest a time. The other handle
	 * stays, unless the selection would be shorter than its minimum: then it
	 * is pushed along, as far as the end of the video, where both stop.
	 */
	moveHandle(range: IBaseHalfVideoTrimRange, handle: BaseHalfVideoTrimHandle, time: number): IBaseHalfVideoTrimRange {
		const duration = this.duration;
		const min = this.minLength;
		const target = this.snap(Math.min(Math.max(time, 0), duration));
		if (handle === 'start') {
			let start = target;
			let end = range.end;
			if (end - start < min - EPSILON) {
				end = this.edgeAtOrAfter(start + min);
				if (end - start < min - EPSILON) {
					end = duration;
					start = this.edgeAtOrBefore(duration - min);
				}
			}
			return { start, end };
		}
		let end = target;
		let start = range.start;
		if (end - start < min - EPSILON) {
			start = this.edgeAtOrBefore(end - min);
			if (end - start < min - EPSILON) {
				start = 0;
				end = this.edgeAtOrAfter(min);
			}
		}
		return { start, end };
	}

	/**
	 * Moves the whole selection by a time, keeping its length, as far as the
	 * start or the end of the video. A selection that is the whole video does
	 * not move.
	 */
	moveSelection(range: IBaseHalfVideoTrimRange, delta: number): IBaseHalfVideoTrimRange {
		const length = range.end - range.start;
		const duration = this.duration;
		if (length >= duration - EPSILON) {
			return range;
		}
		let start = this.snap(Math.min(Math.max(range.start + delta, 0), duration - length));
		let end = this.snap(start + length);
		if (end - start < this.minLength - EPSILON) {
			end = this.edgeAtOrAfter(start + this.minLength);
		}
		if (end > duration) {
			end = duration;
			start = this.edgeAtOrBefore(duration - length);
		}
		return { start, end };
	}

	/**
	 * Moves a handle by the keyboard: by a time, or by one frame. The handle
	 * goes at least to the next frame edge in that direction, so that a step
	 * shorter than a frame still moves it.
	 */
	stepHandle(range: IBaseHalfVideoTrimRange, handle: BaseHalfVideoTrimHandle, step: number | 'frame', direction: 1 | -1): IBaseHalfVideoTrimRange {
		const from = handle === 'start' ? range.start : range.end;
		let target: number;
		if (step === 'frame') {
			target = this.stepFrame(from, direction);
		} else {
			const snapped = this.snap(from + direction * step);
			target = snapped === from ? this.stepFrame(from, direction) : snapped;
		}
		return this.moveHandle(range, handle, target);
	}

	/** Puts a handle at a time, such as the playhead's, for I and O. */
	setHandle(range: IBaseHalfVideoTrimRange, handle: BaseHalfVideoTrimHandle, time: number): IBaseHalfVideoTrimRange {
		return this.moveHandle(range, handle, time);
	}

	/** The range with its times snapped to this timeline's frame edges, the whole video when it no longer fits. */
	normalize(range: IBaseHalfVideoTrimRange | undefined): IBaseHalfVideoTrimRange {
		if (!range) {
			return this.whole();
		}
		const start = this.snap(range.start);
		const end = this.snap(range.end);
		return end - start >= this.minLength - EPSILON ? { start, end } : this.whole();
	}
}
