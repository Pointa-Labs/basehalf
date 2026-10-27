/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, getWindow } from '../../../../base/browser/dom.js';
import { Disposable, IDisposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { baseHalfNoteZoomFactor, isBaseHalfNoteZoomWheel } from '../../cardDetail/common/basehalfNoteZoom.js';
import {
	BASEHALF_EDGE_FOLLOW_MARGIN,
	BASEHALF_TIME_ZOOM_REST_MS,
	baseHalfEdgeSeconds,
	baseHalfFitStretch,
	baseHalfIsWholeStretch,
	baseHalfMoveStretch,
	baseHalfSpreadStretch,
	baseHalfStretchShowing,
	baseHalfStretchWheelSeconds,
	IBaseHalfTimeStretch
} from '../common/basehalfMediaZoom.js';

/** How long the bar that shows where the stretch lies stays after the stretch last changed, in milliseconds. */
const BAR_MILLISECONDS = 1000;

/*
 * A drag held against a strip's edge carries what the strip shows along
 * (editing media, D98), as a phone's trim follows a handle held there, by the
 * rule the crop view of an image keeps too: from the inner side of the margin
 * at the edge ({@link BASEHALF_EDGE_FOLLOW_MARGIN}), the depth of the pointer
 * in it and past the edge, a pixel for a pixel, moves the stretch along at
 * {@link baseHalfEdgeSeconds}.
 */
const MARGIN = BASEHALF_EDGE_FOLLOW_MARGIN;
/** A stretch this close to the start or the end of the length shows it, in seconds. */
const STRETCH_EPSILON = 0.0005;

/** The frames and timers of a window, for a strip that moves in it. */
export function baseHalfStripClock(window: Window): IBaseHalfTimeZoomClock {
	return {
		frame: callback => {
			const handle = window.requestAnimationFrame(() => callback());
			return toDisposable(() => window.cancelAnimationFrame(handle));
		},
		timeout: (callback, milliseconds) => {
			const handle = window.setTimeout(callback, milliseconds);
			return toDisposable(() => window.clearTimeout(handle));
		},
		now: () => window.performance.now()
	};
}

/**
 * How deep a pointer is in the margin at a strip's edge, from the margin's
 * inner side, the edge itself being {@link MARGIN} and a pixel past it one
 * more: negative at the start, positive at the end, and 0 farther inside.
 */
export function baseHalfStripEdgeDepth(clientX: number, left: number, right: number): number {
	const toStart = clientX - left;
	const toEnd = right - clientX;
	const depth = MARGIN - Math.min(toStart, toEnd);
	if (depth <= 0) {
		return 0;
	}
	return toStart <= toEnd ? -depth : depth;
}

/**
 * Carries what a strip shows along while a drag holds its pointer in the
 * margin at one of the strip's edges, or past the edge (editing media, D98):
 * in every frame by its depth there, until the pointer comes back out of the
 * margin, the start or the end of the length is in view, or the drag ends.
 * Meanwhile what the drag holds stays at the margin's inner side
 * ({@link place}), so that it never slides under the strip's edge, and goes
 * on to the edge once the start or the end is in view. `move` moves what is
 * shown by that many seconds, with the pointer where it is, and puts what the
 * drag holds at the time under {@link place} of it; `atEnd` says whether the
 * start (-1) or the end (1) is in view.
 */
export class BaseHalfStripEdgeFollow extends Disposable {

	private readonly frame = this._register(new MutableDisposable());
	/** Where the drag holds the pointer, and when what is shown last moved for it. */
	private edge: { clientX: number; at: number } | undefined;

	constructor(
		private readonly strip: HTMLElement,
		private readonly clock: IBaseHalfTimeZoomClock,
		private readonly span: () => number,
		private readonly atEnd: (direction: -1 | 1) => boolean,
		private readonly move: (seconds: number, clientX: number) => void
	) {
		super();
	}

	/** Where the pointer of a drag stands, or nothing when the drag ends or carries nothing along. */
	at(clientX: number | undefined): void {
		if (clientX === undefined || this.directionAt(clientX) === 0) {
			this.edge = undefined;
			this.frame.clear();
			return;
		}
		if (this.edge) {
			this.edge.clientX = clientX;
			return;
		}
		this.edge = { clientX, at: this.clock.now() };
		this.frame.value = this.clock.frame(() => this.step());
	}

	/**
	 * Where what a drag holds stands for a pointer at `clientX`: at the
	 * margin's inner side while what is shown can still follow the pointer
	 * there, and under the pointer otherwise.
	 */
	place(clientX: number): number {
		const direction = this.directionAt(clientX);
		if (direction === 0) {
			return clientX;
		}
		const bounds = this.strip.getBoundingClientRect();
		return direction > 0 ? bounds.right - MARGIN : bounds.left + MARGIN;
	}

	/** Which edge a pointer at `clientX` carries what is shown towards, or 0 when it carries nothing. */
	private directionAt(clientX: number): -1 | 0 | 1 {
		const bounds = this.strip.getBoundingClientRect();
		const depth = baseHalfStripEdgeDepth(clientX, bounds.left, bounds.right);
		const direction = depth < 0 ? -1 : depth > 0 ? 1 : 0;
		return direction === 0 || this.atEnd(direction) ? 0 : direction;
	}

	private step(): void {
		const edge = this.edge;
		this.frame.clear();
		if (!edge) {
			return;
		}
		const bounds = this.strip.getBoundingClientRect();
		const depth = baseHalfStripEdgeDepth(edge.clientX, bounds.left, bounds.right);
		const now = this.clock.now();
		const elapsed = Math.max(0, now - edge.at);
		edge.at = now;
		if (this.directionAt(edge.clientX) === 0) {
			this.edge = undefined;
			return;
		}
		this.move(baseHalfEdgeSeconds(depth, this.span(), elapsed), edge.clientX);
		this.frame.value = this.clock.frame(() => this.step());
	}
}

/** The frames and timers of a time zoom, which a test runs when it says. */
export interface IBaseHalfTimeZoomClock {
	frame(callback: () => void): IDisposable;
	timeout(callback: () => void, milliseconds: number): IDisposable;
	now(): number;
}

export interface IBaseHalfTimeZoomOptions {
	/** The strip that shows the time: the wheel over it, and its width. */
	readonly strip: HTMLElement;
	/** Whether the strip's time spreads out now: only while it is edited (D96). By default always. */
	readonly active?: () => boolean;
	/** The length the strip shows at rest, in seconds. */
	readonly length: () => number;
	/** The shortest stretch a pinch spreads the strip out to, in seconds. */
	readonly shortest: () => number;
	/** The stretch changed: in each event of a gesture, and once more when the gesture has ended (`rested`). */
	readonly onDidChange: (rested: boolean) => void;
	/** A drag past an edge moved the stretch along: what the drag holds goes to the time under the pointer. */
	readonly onDidMoveUnderDrag: (clientX: number) => void;
	readonly clock?: IBaseHalfTimeZoomClock;
}

/**
 * Spreads out the time of the frame viewer of a video or of the waveform of a
 * sound (editing media, "Zooming the picture and the time"): a pinch, or the
 * wheel with the zoom key, over the strip spreads the stretch it shows around
 * the pointer, the wheel moves a spread-out stretch along, a drag past an edge
 * carries it with the pointer, and while the video or the sound plays it
 * follows the playhead. While the stretch changes, a thin bar over the bottom
 * of the strip shows where it lies in the whole length.
 */
export class BaseHalfTimeZoom extends Disposable {

	private current: IBaseHalfTimeStretch;
	private readonly bar: HTMLElement;
	private readonly rest = this._register(new MutableDisposable());
	private readonly barRest = this._register(new MutableDisposable());
	private readonly clock: IBaseHalfTimeZoomClock;
	/** A drag held at an edge of a spread-out stretch carries it along. */
	private readonly edgeFollow: BaseHalfStripEdgeFollow;

	constructor(private readonly options: IBaseHalfTimeZoomOptions) {
		super();
		this.clock = options.clock ?? baseHalfStripClock(getWindow(options.strip));
		this.edgeFollow = this._register(new BaseHalfStripEdgeFollow(options.strip, this.clock, () => this.current.to - this.current.from,
			direction => direction < 0 ? this.current.from <= STRETCH_EPSILON : this.current.to >= this.options.length() - STRETCH_EPSILON,
			(seconds, clientX) => {
				const next = baseHalfMoveStretch(this.current, this.options.length(), seconds);
				if (next.from !== this.current.from) {
					this.current = next;
					this.changed();
					this.options.onDidMoveUnderDrag(this.edgeFollow.place(clientX));
				}
			}));
		this.current = { from: 0, to: options.length() };
		this.bar = append(options.strip, $('.basehalf-time-zoom-bar'));
		this.bar.setAttribute('aria-hidden', 'true');
		this._register(toDisposable(() => this.bar.remove()));
		this._register(addDisposableListener(options.strip, 'wheel', event => this.onWheel(event), { passive: false }));
	}

	/** Shows where the stretch lies in the whole length, until a second after it last changed; nothing at the whole length. */
	private showBar(): void {
		const length = this.options.length();
		if (!this.spread || !(length > 0)) {
			this.barRest.clear();
			this.bar.classList.remove('visible');
			return;
		}
		this.bar.style.left = `${(this.current.from / length * 100).toFixed(3)}%`;
		this.bar.style.width = `${((this.current.to - this.current.from) / length * 100).toFixed(3)}%`;
		this.bar.classList.add('visible');
		this.barRest.value = this.clock.timeout(() => {
			this.barRest.clear();
			this.bar.classList.remove('visible');
		}, BAR_MILLISECONDS);
	}

	/** The stretch the strip shows, when nothing holds a handle. */
	get stretch(): IBaseHalfTimeStretch {
		return this.current;
	}

	/** The strip shows less than its whole length. */
	get spread(): boolean {
		return !baseHalfIsWholeStretch(this.current, this.options.length());
	}

	/** Keeps the stretch inside a length that changed, as a cut or its undo changes it. */
	fit(): void {
		this.current = baseHalfFitStretch(this.current, this.options.length());
	}

	/** Shows the whole length again, as Done does; nothing is moving then. */
	reset(): void {
		this.rest.clear();
		this.edgeFollow.at(undefined);
		this.current = { from: 0, to: this.options.length() };
		this.barRest.clear();
		this.bar.classList.remove('visible');
	}

	/** While the video or the sound plays, the stretch that shows the playhead. */
	follow(time: number): void {
		if (!this.spread) {
			return;
		}
		const next = baseHalfStretchShowing(this.current, this.options.length(), time);
		if (next.from !== this.current.from || next.to !== this.current.to) {
			this.current = next;
			this.rest.clear();
			this.showBar();
			this.options.onDidChange(true);
		}
	}

	/**
	 * Where the pointer of a drag stands, or nothing when the drag ends: within
	 * {@link BASEHALF_EDGE_FOLLOW_MARGIN} of an edge of a spread-out stretch, or
	 * past it, the stretch moves along, faster the deeper the pointer is (D98).
	 */
	dragAt(clientX: number | undefined): void {
		this.edgeFollow.at(this.spread ? clientX : undefined);
	}

	/** Where what a drag holds stands for its pointer at `clientX`: at the margin's inner side while the stretch follows it (D98). */
	place(clientX: number): number {
		return this.edgeFollow.place(clientX);
	}

	private onWheel(event: WheelEvent): void {
		const length = this.options.length();
		const width = this.options.strip.clientWidth;
		if (!(length > 0) || !(width > 0) || this.options.active?.() === false) {
			return;
		}
		if (isBaseHalfNoteZoomWheel(event, isMacintosh)) {
			// A pinch, or the wheel with the zoom key: the time under the pointer stays under it.
			event.preventDefault();
			event.stopPropagation();
			const bounds = this.options.strip.getBoundingClientRect();
			const at = bounds.width > 0 ? (event.clientX - bounds.left) / bounds.width : 0.5;
			const next = baseHalfSpreadStretch(this.current, length, at, baseHalfNoteZoomFactor(event), this.options.shortest());
			if (next.from !== this.current.from || next.to !== this.current.to) {
				this.current = next;
				this.changed();
			}
			return;
		}
		if (!this.spread) {
			return;
		}
		// The wheel moves a spread-out stretch along: there is nothing else to scroll.
		event.preventDefault();
		event.stopPropagation();
		const next = baseHalfMoveStretch(this.current, length, baseHalfStretchWheelSeconds(event, this.current.to - this.current.from, width));
		if (next.from !== this.current.from) {
			this.current = next;
			this.changed();
		}
	}

	/** A change in a gesture: the strip follows at once, and once more when the gesture rests. */
	private changed(): void {
		this.showBar();
		this.options.onDidChange(false);
		this.rest.value = this.clock.timeout(() => {
			this.rest.clear();
			this.options.onDidChange(true);
		}, BASEHALF_TIME_ZOOM_REST_MS);
	}
}
