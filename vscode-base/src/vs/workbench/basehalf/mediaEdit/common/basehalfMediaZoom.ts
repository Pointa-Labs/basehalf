/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IBaseHalfPoint, IBaseHalfSize } from './basehalfImageCrop.js';

/**
 * What a zoom in Card Detail computes (editing media, "Zooming the picture
 * and the time"): the factor of a pinch or of the wheel, how far a picture
 * zooms and where it then stands, and the stretch of time that the frame
 * viewer of a video or the waveform of a sound shows when a pinch spreads it
 * out.
 */

/** A picture zooms up to this many screen pixels for each of its pixels. */
export const BASEHALF_PICTURE_ZOOM_MAX_SCALE = 2;

/** The shortest stretch of time that a pinch spreads the frame viewer or the waveform out to, in seconds. */
export const BASEHALF_TIME_ZOOM_SHORTEST_SECONDS = 0.5;

/** How long after the last event of a gesture it has ended, in milliseconds: the frame viewer then reads the frames of its new stretch. */
export const BASEHALF_TIME_ZOOM_REST_MS = 150;

/** A pointer this far past an edge of a spread-out stretch moves it along by its own length each second, in pixels. */
const EDGE_PIXELS_PER_STRETCH_SECOND = 100;
/** The fastest an edge moves a stretch along, in stretches each second. */
const EDGE_MAX_STRETCHES_PER_SECOND = 4;

export interface IBaseHalfZoomWheel {
	readonly deltaX?: number;
	readonly deltaY: number;
	/** 0 pixels, 1 lines, 2 pages, as `WheelEvent.deltaMode`. */
	readonly deltaMode: number;
	/** The browser sends a pinch of the trackpad as the wheel with Ctrl held. */
	readonly ctrlKey: boolean;
}

/** A stretch of time, in seconds. */
export interface IBaseHalfTimeStretch {
	readonly from: number;
	readonly to: number;
}

function pixels(delta: number, deltaMode: number): number {
	const value = deltaMode === 1 ? delta * 16 : deltaMode === 2 ? delta * 100 : delta;
	return Number.isFinite(value) ? value : 0;
}

/**
 * How much one wheel event zooms: a pinch by e^(−Δy / 100), the measure the
 * browser gives a pinch, so that what it zooms follows the fingers; the wheel
 * by e^(−Δy / 500).
 */
export function baseHalfZoomFactor(event: IBaseHalfZoomWheel): number {
	return Math.exp(-pixels(event.deltaY, event.deltaMode) / (event.ctrlKey ? 100 : 500));
}

/**
 * The largest zoom of a picture that fits at `scale` screen pixels for each of
 * its pixels: twice its pixels, or as it fits when that is larger already.
 */
export function baseHalfPictureMaxZoom(scale: number): number {
	return scale > 0 && Number.isFinite(scale) ? Math.max(1, BASEHALF_PICTURE_ZOOM_MAX_SCALE / scale) : 1;
}

/**
 * Where the middle of a picture stands, off the middle of the view, once its
 * zoom changes by `ratio` around `at`, a point off the middle of the view: the
 * point of the picture under `at` stays under it.
 */
export function baseHalfZoomPanAround(pan: IBaseHalfPoint, at: IBaseHalfPoint, ratio: number): IBaseHalfPoint {
	return { x: at.x - (at.x - pan.x) * ratio, y: at.y - (at.y - pan.y) * ratio };
}

/**
 * Where the middle of a zoomed picture of `picture`'s size on screen may stand
 * off the middle of the view: the picture covers the view where it is larger
 * than the view, and stays in its middle where it is not.
 */
export function baseHalfClampPicturePan(pan: IBaseHalfPoint, picture: IBaseHalfSize, view: IBaseHalfSize): IBaseHalfPoint {
	const roomX = Math.max(0, (picture.width - view.width) / 2);
	const roomY = Math.max(0, (picture.height - view.height) / 2);
	return { x: Math.min(roomX, Math.max(-roomX, pan.x)), y: Math.min(roomY, Math.max(-roomY, pan.y)) };
}

/** The size of a picture of `size` drawn as large as fits in `view`, its shape kept, as `object-fit: contain` draws it. */
export function baseHalfContainedSize(size: IBaseHalfSize, view: IBaseHalfSize): IBaseHalfSize {
	if (size.width <= 0 || size.height <= 0) {
		return { width: view.width, height: view.height };
	}
	const scale = Math.min(view.width / size.width, view.height / size.height);
	return { width: size.width * scale, height: size.height * scale };
}

function inside(from: number, span: number, length: number): IBaseHalfTimeStretch {
	const start = Math.min(Math.max(from, 0), Math.max(0, length - span));
	return { from: start, to: start + span };
}

/** Whether a stretch shows all of a length. */
export function baseHalfIsWholeStretch(stretch: IBaseHalfTimeStretch, length: number): boolean {
	return stretch.from <= 1e-9 && stretch.to >= length - 1e-9;
}

/**
 * A stretch of a length spread out by `factor` around `at`, its place in the
 * stretch from 0 to 1: the time there stays there. It is never shorter than
 * `shortest`, nor longer than the length, and always inside it.
 */
export function baseHalfSpreadStretch(stretch: IBaseHalfTimeStretch, length: number, at: number, factor: number, shortest: number): IBaseHalfTimeStretch {
	const span = stretch.to - stretch.from;
	if (!(length > 0) || !(span > 0) || !(factor > 0)) {
		return { from: 0, to: Math.max(0, length) };
	}
	const place = Math.min(Math.max(at, 0), 1);
	const next = Math.min(length, Math.max(Math.min(shortest, length), span / factor));
	if (next >= length - 1e-9) {
		return { from: 0, to: length };
	}
	const time = stretch.from + place * span;
	return inside(time - place * next, next, length);
}

/** A stretch moved along by `seconds`, as far as the start and the end of the length go. */
export function baseHalfMoveStretch(stretch: IBaseHalfTimeStretch, length: number, seconds: number): IBaseHalfTimeStretch {
	return inside(stretch.from + (Number.isFinite(seconds) ? seconds : 0), stretch.to - stretch.from, length);
}

/**
 * The stretch that shows a time while it plays: the one shown when it holds
 * the time, otherwise the stretch of the same length that begins at it, as far
 * as the end allows.
 */
export function baseHalfStretchShowing(stretch: IBaseHalfTimeStretch, length: number, time: number): IBaseHalfTimeStretch {
	if (time >= stretch.from && time <= stretch.to) {
		return stretch;
	}
	return inside(time, stretch.to - stretch.from, length);
}

/** A stretch of a length that changed, as a cut or its undo changes it: as long as before, as far as the new length allows. */
export function baseHalfFitStretch(stretch: IBaseHalfTimeStretch, length: number): IBaseHalfTimeStretch {
	const span = Math.min(stretch.to - stretch.from, length);
	return span >= length - 1e-9 ? { from: 0, to: Math.max(0, length) } : inside(stretch.from, span, length);
}

/**
 * The seconds one wheel event moves a stretch of `span` seconds that is
 * `width` pixels wide: by its sideways delta, or by its delta up and down when
 * that is the larger, as there is nothing else to scroll.
 */
export function baseHalfStretchWheelSeconds(event: IBaseHalfZoomWheel, span: number, width: number): number {
	if (!(width > 0)) {
		return 0;
	}
	const sideways = pixels(event.deltaX ?? 0, event.deltaMode);
	const upDown = pixels(event.deltaY, event.deltaMode);
	return (Math.abs(sideways) >= Math.abs(upDown) ? sideways : upDown) / width * span;
}

/**
 * The seconds a drag past an edge moves a stretch of `span` seconds along in
 * `milliseconds`: faster the farther the pointer is past the edge, negative
 * past the start.
 */
export function baseHalfEdgeSeconds(pastEdge: number, span: number, milliseconds: number): number {
	const stretchesPerSecond = Math.min(EDGE_MAX_STRETCHES_PER_SECOND, Math.abs(pastEdge) / EDGE_PIXELS_PER_STRETCH_SECOND);
	return Math.sign(pastEdge) * stretchesPerSecond * span * Math.max(0, milliseconds) / 1000;
}
