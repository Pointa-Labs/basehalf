/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IBaseHalfPoint, IBaseHalfSize } from './basehalfImageCrop.js';

/**
 * What a zoom in Card Detail computes (editing media, "Zooming the picture
 * and the time"): how far a picture zooms, the media area zoomed around a
 * point as a browser zooms its page and moved by a swipe, and the stretch of
 * time that the frame viewer of a video or the waveform of a sound shows when
 * a pinch spreads it out. The factor of a pinch or of the wheel with the zoom
 * key is a note's (`baseHalfNoteZoomFactor`).
 */

/** A media area zooms up to this many times as it fits, as a browser zooms a page (D96). */
export const BASEHALF_PAGE_ZOOM_MAX = 5;

/** A picture zooms at least up to this many screen pixels for each of its pixels. */
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
 * The largest zoom of a picture that fits at `scale` screen pixels for each of
 * its pixels: 5 times as it fits, as a browser zooms a page, or twice its own
 * pixels when that is more (D96).
 */
export function baseHalfPictureMaxZoom(scale: number): number {
	return scale > 0 && Number.isFinite(scale) ? Math.max(BASEHALF_PAGE_ZOOM_MAX, BASEHALF_PICTURE_ZOOM_MAX_SCALE / scale) : BASEHALF_PAGE_ZOOM_MAX;
}

/**
 * A media area zoomed as a browser zooms its page (D96): `zoom` times as
 * large as at rest, from 1, with its top left at `origin`, in pixels of the
 * area. What was at a point `p` of the area at rest shows at `origin + zoom × p`.
 */
export interface IBaseHalfPageZoom {
	readonly zoom: number;
	readonly origin: IBaseHalfPoint;
}

/** The media area at rest: as it fits. */
export const BASEHALF_PAGE_AT_REST: IBaseHalfPageZoom = Object.freeze({ zoom: 1, origin: Object.freeze({ x: 0, y: 0 }) });

/** The zoomed area covers the area, as a browser's page covers its view: it is never moved off itself. */
export function baseHalfClampPageZoom(page: IBaseHalfPageZoom, area: IBaseHalfSize): IBaseHalfPageZoom {
	const zoom = Number.isFinite(page.zoom) ? Math.max(1, page.zoom) : 1;
	const clamp = (value: number, length: number) => Number.isFinite(value) ? Math.min(0, Math.max(length * (1 - zoom), value)) : 0;
	return { zoom, origin: { x: clamp(page.origin.x, area.width), y: clamp(page.origin.y, area.height) } };
}

/**
 * The area zoomed by `factor` around `at`, a point of the area, from 1 to
 * `max`: what is under the point stays under it, as far as the area's edges
 * allow.
 */
export function baseHalfZoomPageAround(page: IBaseHalfPageZoom, at: IBaseHalfPoint, factor: number, max: number, area: IBaseHalfSize): IBaseHalfPageZoom {
	const zoom = Math.min(Math.max(1, max), Math.max(1, page.zoom * (Number.isFinite(factor) && factor > 0 ? factor : 1)));
	const ratio = zoom / page.zoom;
	return baseHalfClampPageZoom({ zoom, origin: { x: at.x - (at.x - page.origin.x) * ratio, y: at.y - (at.y - page.origin.y) * ratio } }, area);
}

/** The zoomed area moved by a swipe, the wheel, or a drag, as far as its edges go. */
export function baseHalfMovePage(page: IBaseHalfPageZoom, by: IBaseHalfPoint, area: IBaseHalfSize): IBaseHalfPageZoom {
	return baseHalfClampPageZoom({ zoom: page.zoom, origin: { x: page.origin.x + by.x, y: page.origin.y + by.y } }, area);
}

/** Where a point of the area at rest shows in the zoomed area. */
export function baseHalfPagePoint(page: IBaseHalfPageZoom, point: IBaseHalfPoint): IBaseHalfPoint {
	return { x: page.origin.x + page.zoom * point.x, y: page.origin.y + page.zoom * point.y };
}

/** How far a two-finger swipe or the wheel moves what is zoomed: it follows the fingers, as the canvas does. */
export function baseHalfWheelMove(event: IBaseHalfZoomWheel): IBaseHalfPoint {
	return { x: -pixels(event.deltaX ?? 0, event.deltaMode), y: -pixels(event.deltaY, event.deltaMode) };
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
