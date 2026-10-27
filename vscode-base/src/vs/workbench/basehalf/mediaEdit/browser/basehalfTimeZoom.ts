/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, getWindow } from '../../../../base/browser/dom.js';
import { Disposable, IDisposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { baseHalfNoteZoomFactor, isBaseHalfNoteZoomWheel } from '../../cardDetail/common/basehalfNoteZoom.js';
import {
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
	private readonly edgeFrame = this._register(new MutableDisposable());
	private readonly clock: IBaseHalfTimeZoomClock;
	/** Where a drag that is past an edge holds the pointer, and when the stretch last moved for it. */
	private edge: { clientX: number; at: number } | undefined;

	constructor(private readonly options: IBaseHalfTimeZoomOptions) {
		super();
		const window = getWindow(options.strip);
		this.clock = options.clock ?? {
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
		this.edge = undefined;
		this.edgeFrame.clear();
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
	 * Where the pointer of a drag stands, or nothing when the drag ends: past an
	 * edge of a spread-out stretch, the stretch moves along, faster the farther
	 * the pointer is past it.
	 */
	dragAt(clientX: number | undefined): void {
		const bounds = this.options.strip.getBoundingClientRect();
		const past = clientX === undefined || !this.spread ? 0 : clientX < bounds.left ? clientX - bounds.left : clientX > bounds.right ? clientX - bounds.right : 0;
		if (past === 0 || clientX === undefined) {
			this.edge = undefined;
			this.edgeFrame.clear();
			return;
		}
		if (this.edge) {
			this.edge.clientX = clientX;
			return;
		}
		this.edge = { clientX, at: this.clock.now() };
		this.edgeFrame.value = this.clock.frame(() => this.moveAtEdge());
	}

	private moveAtEdge(): void {
		const edge = this.edge;
		this.edgeFrame.clear();
		if (!edge) {
			return;
		}
		const bounds = this.options.strip.getBoundingClientRect();
		const past = edge.clientX < bounds.left ? edge.clientX - bounds.left : edge.clientX > bounds.right ? edge.clientX - bounds.right : 0;
		const now = this.clock.now();
		const elapsed = now - edge.at;
		edge.at = now;
		if (past === 0) {
			this.edge = undefined;
			return;
		}
		const span = this.current.to - this.current.from;
		const next = baseHalfMoveStretch(this.current, this.options.length(), baseHalfEdgeSeconds(past, span, elapsed));
		if (next.from !== this.current.from) {
			this.current = next;
			this.changed();
			this.options.onDidMoveUnderDrag(edge.clientX);
		}
		this.edgeFrame.value = this.clock.frame(() => this.moveAtEdge());
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
