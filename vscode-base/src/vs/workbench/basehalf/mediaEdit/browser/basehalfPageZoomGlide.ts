/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { baseHalfPageZoomToward, IBaseHalfPageZoom } from '../common/basehalfMediaZoom.js';
import { IBaseHalfTimeZoomClock } from './basehalfTimeZoom.js';

/** A pinch has ended once no event of it came for this long, in milliseconds: the zoom then settles. */
export const BASEHALF_PAGE_ZOOM_SETTLE_MS = 150;
/** A zoom glides to where it settles, or back to as it fits, this long, in milliseconds (D97, D101). */
export const BASEHALF_PAGE_ZOOM_GLIDE_MS = 200;

/**
 * The glides of a picture's zoom in Card Detail (editing media, "Zooming the
 * picture and the time"): a pinch follows the fingers, past the picture's
 * edges if they go there, and once it rests the zoom glides to where the
 * edges allow, as a phone's photos settle (D101); Edit glides a zoomed
 * picture back to as it fits (D97). A glide ends on time even in a window
 * that draws no frames.
 */
export class BaseHalfPageZoomGlide extends Disposable {

	private readonly frame = this._register(new MutableDisposable());
	private readonly end = this._register(new MutableDisposable());
	private readonly settle = this._register(new MutableDisposable());

	constructor(
		private readonly clock: IBaseHalfTimeZoomClock,
		private readonly page: () => IBaseHalfPageZoom,
		private readonly show: (page: IBaseHalfPageZoom) => void
	) {
		super();
	}

	/** A pinch moved the zoom: once it rests, the zoom glides to where `settled` says. */
	pinched(settled: () => IBaseHalfPageZoom): void {
		this.stop();
		this.settle.value = this.clock.timeout(() => {
			this.settle.clear();
			this.glide(settled());
		}, BASEHALF_PAGE_ZOOM_SETTLE_MS);
	}

	/** Glides the zoom to `target`, fast at first and slow at the end; a zoom that is there already stays. */
	glide(target: IBaseHalfPageZoom): void {
		this.stop();
		const from = this.page();
		if (from.zoom === target.zoom && from.origin.x === target.origin.x && from.origin.y === target.origin.y) {
			return;
		}
		const start = this.clock.now();
		const step = () => {
			const progress = Math.min(1, (this.clock.now() - start) / BASEHALF_PAGE_ZOOM_GLIDE_MS);
			if (progress >= 1) {
				this.stop();
				this.show(target);
				return;
			}
			this.show(baseHalfPageZoomToward(from, target, 1 - Math.pow(1 - progress, 3)));
			this.frame.value = this.clock.frame(step);
		};
		this.frame.value = this.clock.frame(step);
		this.end.value = this.clock.timeout(() => {
			this.stop();
			this.show(target);
		}, BASEHALF_PAGE_ZOOM_GLIDE_MS + 50);
	}

	/** Ends a glide where it is, and forgets a pinch that waits to settle. */
	stop(): void {
		this.frame.clear();
		this.end.clear();
		this.settle.clear();
	}
}
