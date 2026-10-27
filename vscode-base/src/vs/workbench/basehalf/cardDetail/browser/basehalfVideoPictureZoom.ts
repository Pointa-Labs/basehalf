/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, getWindow } from '../../../../base/browser/dom.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { IBaseHalfSize } from '../../mediaEdit/common/basehalfImageCrop.js';
import { BASEHALF_PAGE_AT_REST, baseHalfClampPageZoom, baseHalfContainedSize, baseHalfMovePage, baseHalfPictureMaxZoom, baseHalfWheelMove, baseHalfZoomPageAround, IBaseHalfPageZoom } from '../../mediaEdit/common/basehalfMediaZoom.js';
import { baseHalfNoteZoomFactor, isBaseHalfNoteZoomWheel } from '../common/basehalfNoteZoom.js';

/** A press that moves less than this, in pixels, is a click, which plays and pauses the video. */
const DRAG_THRESHOLD = 3;

interface IPan {
	readonly pointerId: number;
	readonly startX: number;
	readonly startY: number;
	/** The zoom when the press started, which Escape puts back. */
	readonly before: IBaseHalfPageZoom;
	moved: boolean;
}

/**
 * Zooms the picture of the player of a video in Card Detail (editing media,
 * "Zooming the picture and the time", D96): a pinch, or the wheel with the
 * zoom key, anywhere in the media area zooms the place under the pointer as a
 * browser zooms its page, so that the picture grows past the player's box
 * over the area, from as it fits to 5 times that or twice its pixels; a
 * two-finger swipe and the wheel move it while it is zoomed in, as on the
 * canvas, and so does a drag on the picture, whose click neither plays nor
 * pauses the video. The player keeps its place and size, and its controls
 * their size; Card Detail's controls in the area keep theirs over the
 * picture, and a gesture over them is theirs.
 */
export class BaseHalfVideoPictureZoom extends Disposable {

	/** The media area zoomed as a page: how much larger than at rest, and where its top left stands. */
	private page: IBaseHalfPageZoom = BASEHALF_PAGE_AT_REST;
	private drag: IPan | undefined;
	/** A drag of the picture ended: the click that follows it is the drag's. */
	private dragEnded = false;
	private areaSize: IBaseHalfSize;

	constructor(
		private readonly player: HTMLElement,
		private readonly video: HTMLVideoElement,
		/** The media area of Card Detail, where the zoomed picture shows; the player itself while it fills the screen. */
		private readonly area: HTMLElement = player,
		/** Whether a gesture there belongs to a control of Card Detail, which keeps it, as the frame viewer or the line under the editor. */
		private readonly isControl: (target: EventTarget | null) => boolean = () => false,
		resizeObserver: typeof ResizeObserver | undefined = getWindow(player).ResizeObserver
	) {
		super();
		this.areaSize = this.size();
		this._register(addDisposableListener(area, 'wheel', event => this.onWheel(event), { passive: false }));
		if (area !== player && !area.contains(player)) {
			this._register(addDisposableListener(player, 'wheel', event => this.onWheel(event), { passive: false }));
		}
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
				this.page = this.drag.before;
				this.endDrag();
			}
		}, true));
		// The player that fills the screen, and leaves it, keeps the zoom as far as its new size allows.
		this._register(addDisposableListener(player.ownerDocument, 'fullscreenchange', () => this.layout()));
		if (resizeObserver) {
			const observer = new resizeObserver(() => this.layout());
			observer.observe(player);
			observer.observe(area);
			this._register(toDisposable(() => observer.disconnect()));
		}
		this._register(toDisposable(() => {
			this.video.style.transform = '';
			this.video.style.transformOrigin = '';
			this.player.classList.remove('basehalf-picture-zoomed', 'basehalf-picture-panning');
		}));
	}

	/** How much larger than as it fits the picture shows, and where the zoomed area's top left stands, in pixels of the area. */
	get state(): IBaseHalfPageZoom {
		return this.page;
	}

	/** Where the zoomed picture may show: the media area, or the player while it fills the screen. */
	private currentArea(): HTMLElement {
		return this.player.ownerDocument.fullscreenElement === this.player ? this.player : this.area;
	}

	private size(): IBaseHalfSize {
		const area = this.currentArea();
		return { width: area.clientWidth, height: area.clientHeight };
	}

	private maxZoom(): number {
		const width = this.video.videoWidth;
		const fitted = baseHalfContainedSize({ width: this.video.videoWidth, height: this.video.videoHeight }, { width: this.player.clientWidth, height: this.player.clientHeight });
		return width > 0 ? baseHalfPictureMaxZoom(fitted.width / width) : 1;
	}

	private onWheel(event: WheelEvent): void {
		if (this.drag || this.isControl(event.target)) {
			return;
		}
		this.areaSize = this.size();
		if (isBaseHalfNoteZoomWheel(event, isMacintosh)) {
			// A pinch, or the wheel with the zoom key: the place under the pointer grows, as a page does.
			event.preventDefault();
			event.stopPropagation();
			const bounds = this.currentArea().getBoundingClientRect();
			this.page = baseHalfZoomPageAround(this.page, { x: event.clientX - bounds.left, y: event.clientY - bounds.top }, baseHalfNoteZoomFactor(event), this.maxZoom(), this.areaSize);
			this.apply();
			return;
		}
		if (this.page.zoom <= 1) {
			// As it fits, a swipe moves nothing.
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		this.page = baseHalfMovePage(this.page, baseHalfWheelMove(event), this.areaSize);
		this.apply();
	}

	private onPointerDown(event: PointerEvent): void {
		this.dragEnded = false;
		if (event.button !== 0 || this.page.zoom <= 1) {
			return;
		}
		this.drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, before: this.page, moved: false };
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
		this.page = baseHalfMovePage(drag.before, { x: dx, y: dy }, this.areaSize);
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

	/** An area of another size, as Full Screen or a narrower Card Detail makes it: the zoom stays as far as the size allows. */
	private layout(): void {
		const before = this.areaSize;
		this.areaSize = this.size();
		if (this.page.zoom <= 1 || before.width <= 0) {
			this.apply();
			return;
		}
		const ratio = this.areaSize.width / before.width;
		this.page = baseHalfClampPageZoom({ zoom: Math.min(this.page.zoom, this.maxZoom()), origin: { x: this.page.origin.x * ratio, y: this.page.origin.y * ratio } }, this.areaSize);
		this.apply();
	}

	/**
	 * Draws the picture where the zoomed area takes it: what stood at a point
	 * `p` of the area now stands at `origin + zoom × p`, so the picture's box
	 * at rest goes to the same place, as large as the zoom.
	 */
	private apply(): void {
		const zoomed = this.page.zoom > 1;
		if (zoomed) {
			const area = this.currentArea().getBoundingClientRect();
			// The picture's place at rest: the video fills the player, whose transform is none.
			const rest = this.player.getBoundingClientRect();
			const left = area.left + this.page.origin.x + this.page.zoom * (rest.left - area.left) - rest.left;
			const top = area.top + this.page.origin.y + this.page.zoom * (rest.top - area.top) - rest.top;
			this.video.style.transformOrigin = '0 0';
			this.video.style.transform = `translate(${left.toFixed(2)}px, ${top.toFixed(2)}px) scale(${this.page.zoom.toFixed(4)})`;
		} else {
			this.video.style.transform = '';
			this.video.style.transformOrigin = '';
		}
		this.player.classList.toggle('basehalf-picture-zoomed', zoomed);
		this.player.classList.toggle('basehalf-picture-panning', !!this.drag?.moved);
	}
}
