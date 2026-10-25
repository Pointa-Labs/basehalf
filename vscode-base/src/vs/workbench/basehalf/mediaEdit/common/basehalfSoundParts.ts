/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IBaseHalfMediaPart } from './basehalfEditRecord.js';

/**
 * The parts of a sound that an edit keeps (editing media, "Editing a
 * sound"): parts of the original in order, played one after the other. Times
 * of the edited sound run through the parts joined; Trim keeps a stretch of
 * them and Delete takes one away.
 */

/** The shortest a sound may be after a Delete, in seconds. */
export const BASEHALF_SOUND_MIN_LENGTH = 0.1;
/** Two times closer than this are the same. */
const EPSILON = 1e-9;

/** How long the edited sound is. */
export function baseHalfPartsLength(parts: readonly IBaseHalfMediaPart[]): number {
	return parts.reduce((sum, part) => sum + part.end - part.start, 0);
}

/** Where each part starts in the edited sound, and where the last one ends: the joints between parts are the inner ones. */
export function baseHalfPartEdges(parts: readonly IBaseHalfMediaPart[]): number[] {
	const edges = [0];
	for (const part of parts) {
		edges.push(edges[edges.length - 1] + part.end - part.start);
	}
	return edges;
}

/** The time of the original at a time of the edited sound; at a joint, the start of the later part. */
export function baseHalfOriginalTime(parts: readonly IBaseHalfMediaPart[], time: number): number {
	let at = 0;
	for (const part of parts) {
		const length = part.end - part.start;
		if (time < at + length - EPSILON) {
			return part.start + Math.max(0, time - at);
		}
		at += length;
	}
	return parts.length ? parts[parts.length - 1].end : 0;
}

/** The parts of the original that a stretch of the edited sound holds, in order. */
export function baseHalfPartsBetween(parts: readonly IBaseHalfMediaPart[], from: number, to: number): IBaseHalfMediaPart[] {
	const kept: IBaseHalfMediaPart[] = [];
	let at = 0;
	for (const part of parts) {
		const length = part.end - part.start;
		const start = Math.max(from, at);
		const end = Math.min(to, at + length);
		if (end - start > EPSILON) {
			kept.push({ start: part.start + (start - at), end: part.start + (end - at) });
		}
		at += length;
	}
	return merge(kept);
}

/** Trim: only the stretch between the handles is kept. */
export function baseHalfTrimParts(parts: readonly IBaseHalfMediaPart[], from: number, to: number): IBaseHalfMediaPart[] {
	return baseHalfPartsBetween(parts, from, to);
}

/** Delete: the stretch between the handles is taken away, and what is on either side of it is joined. */
export function baseHalfDeleteParts(parts: readonly IBaseHalfMediaPart[], from: number, to: number): IBaseHalfMediaPart[] {
	return merge([...baseHalfPartsBetween(parts, 0, from), ...baseHalfPartsBetween(parts, to, baseHalfPartsLength(parts))]);
}

/** Parts that touch in the original are one part. */
function merge(parts: readonly IBaseHalfMediaPart[]): IBaseHalfMediaPart[] {
	const merged: IBaseHalfMediaPart[] = [];
	for (const part of parts) {
		const last = merged[merged.length - 1];
		if (last && Math.abs(last.end - part.start) < 1e-6) {
			merged[merged.length - 1] = { start: last.start, end: part.end };
		} else {
			merged.push(part);
		}
	}
	return merged;
}

/** Whether parts are the whole of a sound of a length: no edit. */
export function baseHalfPartsAreWhole(parts: readonly IBaseHalfMediaPart[], duration: number): boolean {
	return parts.length === 1 && parts[0].start <= 1e-6 && parts[0].end >= duration - 1e-6;
}

/** A stretch between the waveform's handles, in seconds of the edited sound. */
export interface IBaseHalfSoundRange {
	readonly start: number;
	readonly end: number;
}

/**
 * The times of an edited sound that its handles stop at, an even grid of a
 * step, a sample or the frame of an MP3, from 0 to its length; a stretch
 * between the handles is at least 0.1 s, or the whole sound when it is
 * shorter. A handle moved closer than that to the other pushes it along, as
 * the handles of a video's frame viewer do.
 */
export class BaseHalfSoundTimeline {

	constructor(readonly duration: number, readonly step: number) { }

	get minLength(): number {
		return Math.min(BASEHALF_SOUND_MIN_LENGTH, this.duration);
	}

	whole(): IBaseHalfSoundRange {
		return { start: 0, end: this.duration };
	}

	isWhole(range: IBaseHalfSoundRange): boolean {
		return range.start <= 1e-6 && range.end >= this.duration - 1e-6;
	}

	/** The grid time nearest to a time, within the sound. */
	snap(time: number): number {
		const clamped = Math.min(Math.max(time, 0), this.duration);
		const snapped = Math.round(clamped / this.step) * this.step;
		return Math.min(snapped, this.duration);
	}

	/** The grid time a step after or before a time. */
	stepFrame(time: number, direction: 1 | -1): number {
		return this.snap(this.snap(time) + direction * this.step);
	}

	moveHandle(range: IBaseHalfSoundRange, handle: 'start' | 'end', time: number): IBaseHalfSoundRange {
		const min = this.minLength;
		const target = this.snap(time);
		if (handle === 'start') {
			let start = target;
			let end = range.end;
			if (end - start < min - 1e-9) {
				end = Math.min(this.duration, this.snap(start + min + this.step / 2));
				if (end - start < min - 1e-9) {
					end = this.duration;
					start = Math.max(0, this.snap(this.duration - min - this.step / 2));
				}
			}
			return { start, end };
		}
		let end = target;
		let start = range.start;
		if (end - start < min - 1e-9) {
			start = Math.max(0, this.snap(end - min - this.step / 2));
			if (end - start < min - 1e-9) {
				start = 0;
				end = Math.min(this.duration, this.snap(min + this.step / 2));
			}
		}
		return { start, end };
	}

	/** Moves the stretch by a time with its length, as far as the sound's ends. */
	moveSelection(range: IBaseHalfSoundRange, delta: number): IBaseHalfSoundRange {
		const length = range.end - range.start;
		if (length >= this.duration - 1e-9) {
			return range;
		}
		const start = this.snap(Math.min(Math.max(range.start + delta, 0), this.duration - length));
		return { start, end: Math.min(this.duration, start + length) };
	}

	/** A handle moved by the keyboard, at least one step of the grid. */
	stepHandle(range: IBaseHalfSoundRange, handle: 'start' | 'end', step: number | 'frame', direction: 1 | -1): IBaseHalfSoundRange {
		const from = handle === 'start' ? range.start : range.end;
		const target = step === 'frame' ? this.stepFrame(from, direction) : this.snap(from + direction * Math.max(step, this.step));
		return this.moveHandle(range, handle, target);
	}

	/** A stretch on this grid, the whole sound when it no longer fits. */
	normalize(range: IBaseHalfSoundRange | undefined): IBaseHalfSoundRange {
		if (!range) {
			return this.whole();
		}
		const start = this.snap(range.start);
		const end = this.snap(range.end);
		return end - start >= this.minLength - 1e-9 ? { start, end } : this.whole();
	}
}
