/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, getWindow } from '../../../../base/browser/dom.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IBaseHalfPoint, IBaseHalfSize } from '../../mediaEdit/common/basehalfImageCrop.js';
import { baseHalfClampPicturePan, baseHalfContainedSize, baseHalfPictureMaxZoom, baseHalfZoomFactor, baseHalfZoomPanAround } from '../../mediaEdit/common/basehalfMediaZoom.js';

/** A press that moves less than this, in pixels, is a click, which plays and pauses the video. */
const DRAG_THRESHOLD = 3;

interface IPan {
	readonly pointerId: number;
	readonly startX: number;
	readonly startY: number;
	/** Where the picture stood when the press started, which Escape puts back. */
	readonly before: IBaseHalfPoint;
	moved: boolean;
}

/**
 * Zooms the picture of the player of a video in Card Detail (editing media,
 * "Zooming the picture and the time"): a pinch, or the wheel, over it zooms
 * the picture around the pointer, from as it fits to twice its pixels, as the
 * crop view of an image zooms; while it is zoomed in, a drag moves the
 * picture, as far as its edges go, and the click that ends the drag neither
 * plays nor pauses the video. The player keeps its place and size, and its
 * controls their size.
 */
export class BaseHalfVideoPictureZoom extends Disposable {

	/** How much larger than as it fits the picture shows, from 1. */
	private zoom = 1;
	/** Where the middle of the picture stands off the middle of the player. */
	private pan: IBaseHalfPoint = { x: 0, y: 0 };
	private drag: IPan | undefined;
	/** A drag of the picture ended: the click that follows it is the drag's. */
	private dragEnded = false;
	private box: IBaseHalfSize;

	constructor(
		private readonly player: HTMLElement,
		private readonly video: HTMLVideoElement,
		resizeObserver: typeof ResizeObserver | undefined = getWindow(player).ResizeObserver
	) {
		super();
		this.box = this.size();
		this._register(addDisposableListener(player, 'wheel', event => this.onWheel(event), { passive: false }));
		this._register(addDisposableListener(video, 'pointerdown', event => this.onPointerDown(event)));
		this._register(addDisposableListener(video, 'pointermove', event => this.onPointerMove(event)));
		for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
			this._register(addDisposableListener(video, type, event => this.onPointerUp(event)));
		}
		// The click that ends a drag of the picture reaches no control of the player.
		this._register(addDisposableListener(player, 'click', event => {
			if (this.dragEnded) {
				this.dragEnded = false;
				event.preventDefault();
				event.stopPropagation();
			}
		}, true));
		this._register(addDisposableListener(getWindow(player), 'keydown', event => {
			// Escape during a drag puts the picture back where it was; Card Detail stays (editing media, "The keyboard").
			if (event.key === 'Escape' && this.drag) {
				event.preventDefault();
				event.stopPropagation();
				this.pan = this.drag.before;
				this.endDrag();
			}
		}, true));
		if (resizeObserver) {
			const observer = new resizeObserver(() => this.layout());
			observer.observe(player);
			this._register(toDisposable(() => observer.disconnect()));
		}
		this._register(toDisposable(() => {
			this.video.style.transform = '';
			this.player.classList.remove('basehalf-picture-zoomed', 'basehalf-picture-panning');
		}));
	}

	/** How much larger than as it fits the picture shows, and where its middle stands off the player's. */
	get state(): { readonly zoom: number; readonly pan: IBaseHalfPoint } {
		return { zoom: this.zoom, pan: this.pan };
	}

	private size(): IBaseHalfSize {
		return { width: this.player.clientWidth, height: this.player.clientHeight };
	}

	/** The picture as it fits in the player, as the player draws it. */
	private fitted(box = this.box): IBaseHalfSize {
		return baseHalfContainedSize({ width: this.video.videoWidth, height: this.video.videoHeight }, box);
	}

	private maxZoom(): number {
		const width = this.video.videoWidth;
		return width > 0 ? baseHalfPictureMaxZoom(this.fitted().width / width) : 1;
	}

	private clamp(pan: IBaseHalfPoint, zoom = this.zoom): IBaseHalfPoint {
		const fitted = this.fitted();
		return baseHalfClampPicturePan(pan, { width: fitted.width * zoom, height: fitted.height * zoom }, this.box);
	}

	private onWheel(event: WheelEvent): void {
		if (this.drag) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		this.box = this.size();
		const next = Math.min(this.maxZoom(), Math.max(1, this.zoom * baseHalfZoomFactor(event)));
		if (next === this.zoom) {
			return;
		}
		const bounds = this.player.getBoundingClientRect();
		const at = { x: event.clientX - bounds.left - bounds.width / 2, y: event.clientY - bounds.top - bounds.height / 2 };
		const moved = baseHalfZoomPanAround(this.pan, at, next / this.zoom);
		this.zoom = next;
		this.pan = next > 1 ? this.clamp(moved) : { x: 0, y: 0 };
		this.apply();
	}

	private onPointerDown(event: PointerEvent): void {
		this.dragEnded = false;
		if (event.button !== 0 || this.zoom <= 1) {
			return;
		}
		this.drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, before: this.pan, moved: false };
		try {
			this.video.setPointerCapture(event.pointerId);
		} catch {
			// A pointer that is no longer active cannot be captured; the press still counts.
		}
	}

	private onPointerMove(event: PointerEvent): void {
		const drag = this.drag;
		if (!drag || drag.pointerId !== event.pointerId) {
			return;
		}
		const dx = event.clientX - drag.startX;
		const dy = event.clientY - drag.startY;
		if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) {
			return;
		}
		drag.moved = true;
		this.pan = this.clamp({ x: drag.before.x + dx, y: drag.before.y + dy });
		this.apply();
	}

	private onPointerUp(event: PointerEvent): void {
		const drag = this.drag;
		if (!drag || drag.pointerId !== event.pointerId) {
			return;
		}
		this.dragEnded = drag.moved && event.type === 'pointerup';
		this.endDrag();
	}

	private endDrag(): void {
		const drag = this.drag;
		if (!drag) {
			return;
		}
		this.drag = undefined;
		try {
			this.video.releasePointerCapture(drag.pointerId);
		} catch {
			// Released already.
		}
		this.apply();
	}

	/** A player of another size, as Full Screen or a narrower Card Detail makes it: the zoom stays as far as the size allows. */
	private layout(): void {
		const before = this.box;
		this.box = this.size();
		if (this.zoom <= 1 || before.width <= 0) {
			return;
		}
		const ratio = this.box.width / before.width;
		this.zoom = Math.min(this.zoom, this.maxZoom());
		this.pan = this.zoom > 1 ? this.clamp({ x: this.pan.x * ratio, y: this.pan.y * ratio }) : { x: 0, y: 0 };
		this.apply();
	}

	private apply(): void {
		const zoomed = this.zoom > 1;
		this.video.style.transform = zoomed ? `translate(${this.pan.x.toFixed(2)}px, ${this.pan.y.toFixed(2)}px) scale(${this.zoom.toFixed(4)})` : '';
		this.player.classList.toggle('basehalf-picture-zoomed', zoomed);
		this.player.classList.toggle('basehalf-picture-panning', !!this.drag?.moved);
	}
}
