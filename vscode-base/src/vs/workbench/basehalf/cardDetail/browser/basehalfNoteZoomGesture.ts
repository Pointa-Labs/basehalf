/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// This module is also compiled into the rich editor's webview, whose type
// check follows every import. It imports only its sibling in common/.

import {
	BASEHALF_NOTE_ZOOM_GLIDE_MS,
	BASEHALF_NOTE_ZOOM_REST_MS,
	baseHalfNoteZoomFactor,
	clampBaseHalfNoteZoom,
	settleBaseHalfNoteZoom,
	type IBaseHalfNoteZoomWheel,
} from '../common/basehalfNoteZoom.js';

/** The CSS variable that holds the level a page is laid out at, on the view. */
export const BASEHALF_NOTE_ZOOM_VARIABLE = '--basehalf-note-zoom';

/**
 * Lays a page out at a level: its column is laid out `1 / level` as wide as
 * the view allows, at most its own width, and drawn `level` times larger from
 * its top middle. That looks as a page laid out at the level would, its text
 * drawn at the larger size, and positions in it stay those of the window,
 * which the editor's caret and menus need. The browser's `zoom` property does
 * not keep them: it reports the rectangles inside a zoomed element at the
 * page's own size (measured on 2026-10-27).
 */
function layOut(view: HTMLElement, page: HTMLElement, level: number): void {
	view.style.setProperty(BASEHALF_NOTE_ZOOM_VARIABLE, String(level));
	page.style.transformOrigin = 'top center';
	page.style.transform = level === 1 ? '' : `scale(${level})`;
}

/** A note's page in Card Detail, as the zoom sees it (zoom and outline of a note). */
export interface IBaseHalfNoteZoomPage {
	/** The element that scrolls. */
	readonly view: HTMLElement;
	/** The page that the level lays out and draws. */
	readonly page: HTMLElement;
	/**
	 * The text column, in which the line under the pointer is looked for, and
	 * whose width says whether a layout breaks its lines anew. The page when
	 * there is none.
	 */
	readonly text?: () => HTMLElement | null | undefined;
	/** Whether motion is reduced: the page then takes its place at once (rule 6). */
	readonly reducedMotion?: () => boolean;
	/** Called after each change of how the page is drawn: each frame of a pinch and of its glide, and a layout. */
	readonly onDidDraw?: () => void;
}

export interface IBaseHalfNoteZoomEvent extends IBaseHalfNoteZoomWheel {
	/** Where the pointer is, in the coordinates of the view's window. */
	readonly clientX: number;
	readonly clientY: number;
}

/** The clock of a gesture: tests replace it. */
export interface IBaseHalfNoteZoomClock {
	readonly frame: (callback: () => void) => { dispose(): void };
	readonly timeout: (callback: () => void, ms: number) => { dispose(): void };
	readonly now: () => number;
}

/**
 * How the page is drawn while the fingers move and while it glides: as a
 * picture of the page as it is laid out, moved by `x` and `y` from where its
 * box is and drawn `scale` times as large from the box's top left corner.
 */
interface IPicture {
	x: number;
	y: number;
	scale: number;
}

/** A line of the page at a height of the view, so that it can be kept there. */
interface ILine {
	/** The height it was taken at, in the coordinates of the view's window. */
	readonly y: number;
	/** Its top when it was taken. */
	readonly top: number;
	/** Its top now. */
	readonly measure: () => number | undefined;
}

function windowClock(target: Window): IBaseHalfNoteZoomClock {
	return {
		frame: callback => {
			const handle = target.requestAnimationFrame(callback);
			return { dispose: () => target.cancelAnimationFrame(handle) };
		},
		timeout: (callback, ms) => {
			const handle = target.setTimeout(callback, ms);
			return { dispose: () => target.clearTimeout(handle) };
		},
		now: () => target.performance.now(),
	};
}

/**
 * Zooms a note's page with the wheel events of a pinch or of the wheel with
 * the zoom key held. While the events come, the page is drawn as a picture of
 * itself, larger or smaller around the pointer, and nothing of it is laid out.
 * Once they rest, the page is laid out once at the level, with the line under
 * the pointer at its height and the column in the middle of the view, and it
 * glides there from the picture when its lines stay as they were (zoom and
 * outline of a note, rules 2 to 6).
 */
export class BaseHalfNoteZoomGesture {
	/** The level the page is laid out at. */
	private laidOut: number;
	/** The level the events of the gesture so far ask for. */
	private wanted: number;
	private pointer: { readonly x: number; readonly y: number } | undefined;
	/** How the page is drawn while the fingers move or it glides; none while it is drawn as it is laid out. */
	private picture: IPicture | undefined;
	/** The element after the page that keeps the view's scroll range while the page is a picture. */
	private room: HTMLElement | undefined;
	private pendingFrame: { dispose(): void } | undefined;
	private glideFrame: { dispose(): void } | undefined;
	private restTimer: { dispose(): void } | undefined;
	private readonly clock: IBaseHalfNoteZoomClock;
	private disposed = false;

	constructor(
		private readonly target: IBaseHalfNoteZoomPage,
		level: number,
		private readonly onDidSettle: (level: number) => void,
		clock?: IBaseHalfNoteZoomClock
	) {
		this.clock = clock ?? windowClock(target.view.ownerDocument.defaultView as Window);
		this.laidOut = this.wanted = clampBaseHalfNoteZoom(level);
		layOut(target.view, target.page, this.laidOut);
	}

	/** The level the page is laid out at. */
	get level(): number {
		return this.laidOut;
	}

	/** Whether a gesture is going on: it began and has not rested yet. */
	get active(): boolean {
		return this.restTimer !== undefined;
	}

	/** Takes one wheel event of a zoom. */
	zoomBy(event: IBaseHalfNoteZoomEvent): void {
		if (this.disposed) {
			return;
		}
		if (this.glideFrame) {
			// A pinch while the page glides goes on from where the page is drawn.
			this.glideFrame.dispose();
			this.glideFrame = undefined;
			this.wanted = this.drawnScale();
		}
		this.wanted = clampBaseHalfNoteZoom(this.wanted * baseHalfNoteZoomFactor(event));
		this.pointer = { x: event.clientX, y: event.clientY };
		this.pendingFrame ??= this.clock.frame(() => this.onFrame());
		this.restTimer?.dispose();
		this.restTimer = this.clock.timeout(() => this.rest(), BASEHALF_NOTE_ZOOM_REST_MS);
	}

	/**
	 * Lays the page out at a level that came from elsewhere, another projection
	 * or window, keeping the line at the top of the view where it is. A gesture
	 * going on keeps its own level.
	 */
	setLevel(level: number): void {
		const next = clampBaseHalfNoteZoom(level);
		if (this.disposed || this.active || Math.abs(next - this.laidOut) < 1e-4) {
			return;
		}
		this.endGlide();
		const line = this.lineAt(undefined, this.target.view.getBoundingClientRect().top);
		const before = this.laidOut;
		layOut(this.target.view, this.target.page, next);
		this.laidOut = this.wanted = next;
		this.keepLine(line, next / before);
		this.target.onDidDraw?.();
	}

	dispose(): void {
		this.disposed = true;
		this.pendingFrame?.dispose();
		this.pendingFrame = undefined;
		this.restTimer?.dispose();
		this.restTimer = undefined;
		this.glideFrame?.dispose();
		this.glideFrame = undefined;
		this.room?.remove();
		this.room = undefined;
	}

	/** A frame of a gesture: the picture grows or shrinks around the pointer, which stays over the same point of it (rule 4). */
	private onFrame(): void {
		this.pendingFrame = undefined;
		const pointer = this.pointer;
		if (this.disposed || !pointer) {
			return;
		}
		const picture = this.picture ?? this.drawAsPicture();
		const box = this.target.page.getBoundingClientRect();
		const grow = this.wanted / picture.scale;
		picture.x += (pointer.x - box.left) * (1 - grow);
		picture.y += (pointer.y - box.top) * (1 - grow);
		picture.scale = this.wanted;
		this.draw(picture);
	}

	/** The page as it is laid out, drawn as a picture of itself, which a gesture then changes. */
	private drawAsPicture(): IPicture {
		const page = this.target.page;
		// Laid out, the page is drawn from its top middle; a picture is drawn from its top left corner.
		const picture: IPicture = { x: (1 - this.laidOut) * page.offsetWidth / 2, y: 0, scale: this.laidOut };
		this.holdScrollRange();
		page.style.willChange = 'transform';
		page.style.transformOrigin = '0 0';
		this.picture = picture;
		this.paint(picture);
		return picture;
	}

	/**
	 * Keeps the view's scroll range as it is now while the page is a picture,
	 * and the view from scrolling sideways. A picture smaller than the page as
	 * it is drawn at rest shortens the range, and the browser then moves the
	 * view to its new end (measured on 2026-10-31); a picture wider than the
	 * view widens it.
	 */
	private holdScrollRange(): void {
		const view = this.target.view;
		let room = this.room;
		if (!room) {
			room = this.room = view.ownerDocument.createElement('div');
			room.setAttribute('aria-hidden', 'true');
			room.style.pointerEvents = 'none';
			this.target.page.after(room);
			view.style.overflowX = 'hidden';
		}
		room.style.height = '0px';
		const end = view.scrollHeight;
		const top = room.getBoundingClientRect().top - view.getBoundingClientRect().top - view.clientTop + view.scrollTop;
		room.style.height = `${Math.max(0, end - top)}px`;
	}

	/** The page is drawn as it is laid out again: the picture goes, and the room it kept, and the view scrolls as before. */
	private release(): void {
		this.picture = undefined;
		this.room?.remove();
		this.room = undefined;
		this.target.view.style.overflowX = '';
		this.target.page.style.willChange = '';
	}

	/**
	 * The fingers have rested: the page is laid out once at the level the
	 * gesture ends at, with the line under the pointer at its height as far as
	 * the note can scroll and the column in the middle of the view. When its
	 * lines stay as they were, it glides there from the picture (rules 5 and 6).
	 */
	private rest(): void {
		this.restTimer = undefined;
		this.pendingFrame?.dispose();
		this.pendingFrame = undefined;
		if (this.disposed) {
			return;
		}
		const level = settleBaseHalfNoteZoom(this.wanted);
		const view = this.target.view;
		const page = this.target.page;
		const text = this.target.text?.() ?? page;
		const picture = this.picture;
		const drawn = this.drawnScale();
		const line = this.lineAt(this.pointer?.x, this.pointer?.y ?? view.getBoundingClientRect().top);
		const from = page.getBoundingClientRect();
		const lineWidth = text.offsetWidth;
		this.picture = undefined;
		this.pointer = undefined;
		layOut(view, page, level);
		this.laidOut = this.wanted = level;
		if (this.room) {
			// The page takes its place in the view's own scroll range.
			this.room.style.height = '0px';
		}
		this.keepLine(line, level / drawn);
		this.onDidSettle(level);
		if (picture && Math.abs(text.offsetWidth - lineWidth) < 0.5 && !this.target.reducedMotion?.()) {
			this.glideFrom(from, drawn);
		} else {
			this.release();
			this.target.onDidDraw?.();
		}
	}

	/** Glides the page from where its picture was drawn to where it is laid out (rule 6). */
	private glideFrom(from: DOMRect, fromScale: number): void {
		const view = this.target.view;
		const page = this.target.page;
		const to = page.getBoundingClientRect();
		const toScale = this.laidOut;
		if (Math.abs(from.left - to.left) < 0.5 && Math.abs(from.top - to.top) < 0.5 && Math.abs(fromScale - toScale) < 1e-4) {
			this.release();
			this.target.onDidDraw?.();
			return;
		}
		// The top left corner of the page's box, which a picture is drawn from.
		const boxLeft = to.left - (1 - toScale) * page.offsetWidth / 2;
		const boxTop = to.top;
		this.holdScrollRange();
		page.style.transformOrigin = '0 0';
		const picture: IPicture = { x: from.left - boxLeft, y: from.top - boxTop, scale: fromScale };
		this.picture = picture;
		const start = this.clock.now();
		const step = () => {
			const progress = Math.min(1, (this.clock.now() - start) / BASEHALF_NOTE_ZOOM_GLIDE_MS);
			if (progress >= 1) {
				this.glideFrame = undefined;
				layOut(view, page, toScale);
				this.release();
				this.target.onDidDraw?.();
				return;
			}
			const eased = 1 - Math.pow(1 - progress, 3);
			picture.x = from.left + (to.left - from.left) * eased - boxLeft;
			picture.y = from.top + (to.top - from.top) * eased - boxTop;
			picture.scale = fromScale + (toScale - fromScale) * eased;
			this.draw(picture);
			this.glideFrame = this.clock.frame(step);
		};
		this.draw(picture);
		this.glideFrame = this.clock.frame(step);
	}

	/** Ends a glide where it goes: the page is drawn as it is laid out. */
	private endGlide(): void {
		if (!this.glideFrame) {
			return;
		}
		this.glideFrame.dispose();
		this.glideFrame = undefined;
		layOut(this.target.view, this.target.page, this.laidOut);
		this.release();
		this.target.onDidDraw?.();
	}

	private paint(picture: IPicture): void {
		this.target.page.style.transform = `translate(${picture.x}px, ${picture.y}px) scale(${picture.scale})`;
	}

	private draw(picture: IPicture): void {
		this.paint(picture);
		this.target.onDidDraw?.();
	}

	/** Puts a line back at the height it was taken at, its distance from there grown with the page, as far as the view scrolls. */
	private keepLine(line: ILine, grow: number): void {
		const top = line.measure();
		if (top !== undefined && this.target.view.clientHeight > 0) {
			this.target.view.scrollTop += top - (line.y - (line.y - line.top) * grow);
		}
	}

	/**
	 * The line at a height of the view: the place in the text there, at the
	 * pointer's x inside the text column, or the element there, or else the
	 * point of the page itself.
	 */
	private lineAt(clientX: number | undefined, clientY: number): ILine {
		const view = this.target.view;
		const page = this.target.page;
		const viewBox = view.getBoundingClientRect();
		const text = (this.target.text?.() ?? page).getBoundingClientRect();
		const y = Math.min(Math.max(clientY, viewBox.top + 1), Math.max(viewBox.top + 1, viewBox.bottom - 1));
		const x = Math.min(Math.max(clientX ?? (text.left + text.right) / 2, text.left + 2), Math.max(text.left + 2, text.right - 2));
		const ownerDocument = view.ownerDocument;
		const range = ownerDocument.caretRangeFromPoint?.(x, y);
		if (range && page.contains(range.startContainer)) {
			const measure = () => {
				const box = range.getBoundingClientRect();
				if (box.top !== 0 || box.bottom !== 0 || box.height !== 0) {
					return box.top;
				}
				const parent = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
				return parent?.getBoundingClientRect().top;
			};
			const top = measure();
			if (top !== undefined) {
				return { y, top, measure };
			}
		}
		const element = ownerDocument.elementFromPoint(x, y);
		if (element && element !== page && page.contains(element)) {
			return { y, top: element.getBoundingClientRect().top, measure: () => element.isConnected ? element.getBoundingClientRect().top : undefined };
		}
		// The point of the page itself, which moves with the page's top and the scale it is drawn at.
		const pageTop = page.getBoundingClientRect().top;
		const scale = this.drawnScale();
		return { y, top: y, measure: () => page.getBoundingClientRect().top + (y - pageTop) * (this.drawnScale() / scale) };
	}

	/** How much larger than at 100% the page is drawn: the picture's scale, or the level it is laid out at. */
	private drawnScale(): number {
		return this.picture?.scale ?? this.laidOut;
	}
}
