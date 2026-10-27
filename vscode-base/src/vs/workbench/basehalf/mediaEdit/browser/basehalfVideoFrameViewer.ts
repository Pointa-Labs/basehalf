/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfVideoFrameViewer.css';
import { $, addDisposableListener, append, clearNode, getWindow } from '../../../../base/browser/dom.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { localize } from '../../../../nls.js';
import { IBaseHalfCanvasCardVideoPlayer } from '../../canvas/browser/basehalfCanvasCardVideoPlayer.js';
import { IBaseHalfMediaChoices } from '../common/basehalfEditRecord.js';
import { baseHalfVideoFrameEdges } from '../common/basehalfVideoFile.js';
import { BaseHalfVideoTrimHandle, BaseHalfVideoTrimTimeline, formatBaseHalfVideoTrimLength, IBaseHalfVideoTrimRange } from '../common/basehalfVideoTrimSelection.js';
import { BaseHalfMediaChange, IBaseHalfMediaEditor } from './basehalfMediaEditor.js';
import { IBaseHalfEditVideo } from './basehalfMediaEditService.js';
import { readBaseHalfVideoTrimPictures } from './basehalfVideoTrimPictures.js';

/**
 * The frame viewer under the player of a video in Card Detail (editing media,
 * "Editing a video"): the video's timeline, a strip of the original's frames
 * with the part kept in a yellow frame, its two handles, the playhead, and
 * the part's length. It plays the part in the player, spreads out around a
 * handle that is held still, and makes a change of each handle or part let
 * go.
 */

export interface IBaseHalfVideoFrameViewerOptions {
	/** The original of an edited video, or the video, read from the copy that the editor reads. */
	readonly video: IBaseHalfEditVideo;
	readonly player: IBaseHalfCanvasCardVideoPlayer;
	/** The element that holds the player and the viewer: I and O work anywhere in it. */
	readonly stage: HTMLElement;
	/** The choices that the viewer starts with: those of the edit before. */
	readonly choices: IBaseHalfMediaChoices;
}

/** The height of the strip, in pixels; its pictures are this high. */
const STRIP_HEIGHT = 48;
/** A press that moves less than this, in pixels, is a press, not a drag. */
const DRAG_THRESHOLD = 3;
/** How long after the viewer appears its pictures start to be read: Card Detail draws the player first. */
const PICTURES_DELAY_MILLISECONDS = 120;
/** How long a handle is held still before the viewer spreads out around it. */
const HOLD_MILLISECONDS = 400;
/** What the viewer shows around a held handle: a tenth of the video, or this, whichever is longer. */
const SPREAD_MIN_SECONDS = 2;
const SPREAD_FRACTION = 0.1;
/** Steps of the keyboard on a handle, in seconds. */
const STEP_SECONDS = 0.1;
const LARGE_STEP_SECONDS = 1;

type DragKind = BaseHalfVideoTrimHandle | 'move' | 'press' | 'scrub';

interface IDrag {
	readonly kind: DragKind;
	readonly pointerId: number;
	readonly startX: number;
	/** The part when the drag started, which Escape puts back. */
	readonly before: IBaseHalfVideoTrimRange;
	/** The time under the pointer when it was pressed, less the time it holds. */
	grab: number;
	moved: boolean;
	lastX: number;
}

/** The times the strip shows: the whole video, or a stretch of it around a held handle. */
interface IStripView {
	readonly from: number;
	readonly to: number;
}

export class BaseHalfVideoFrameViewer extends Disposable implements IBaseHalfMediaEditor {

	readonly element: HTMLElement;
	private readonly strip: HTMLElement;
	private readonly pictures: HTMLElement;
	private readonly spreadPictures: HTMLElement;
	private readonly length: HTMLElement;
	private readonly startHandle: HTMLElement;
	private readonly endHandle: HTMLElement;
	private readonly playhead: HTMLElement;

	private readonly onDidChangeEmitter = this._register(new Emitter<BaseHalfMediaChange>());
	readonly onDidChange = this.onDidChangeEmitter.event;

	private readonly timeline: BaseHalfVideoTrimTimeline;
	private range: IBaseHalfVideoTrimRange;
	private view: IStripView;
	private drag: IDrag | undefined;
	private holdTimer: ReturnType<typeof setTimeout> | undefined;
	private playheadFrame: number | undefined;
	private picturesCount = 0;
	private disposed = false;
	private readonly picturesLoad = this._register(new MutableDisposable());
	private readonly spreadLoad = this._register(new MutableDisposable());

	constructor(
		container: HTMLElement,
		private readonly options: IBaseHalfVideoFrameViewerOptions
	) {
		super();
		const video = options.video.file.video!;
		this.timeline = new BaseHalfVideoTrimTimeline(baseHalfVideoFrameEdges(video));
		this.range = this.timeline.normalize(options.choices.keep?.[0]);
		this.view = { from: 0, to: this.timeline.duration };

		this.element = append(container, $('.basehalf-video-frames'));
		this.element.setAttribute('role', 'group');
		this.element.setAttribute('aria-label', localize('basehalf.mediaEdit.video.label', "Frames"));
		const row = append(this.element, $('.basehalf-video-frames-row'));
		this.strip = append(row, $('.basehalf-video-frames-strip'));
		this.pictures = append(this.strip, $('.basehalf-video-frames-pictures'));
		this.spreadPictures = append(this.strip, $('.basehalf-video-frames-pictures.spread'));
		// The shades and the part's frame follow the strip's properties of the part.
		append(this.strip, $('.basehalf-video-frames-shade.before'));
		append(this.strip, $('.basehalf-video-frames-shade.after'));
		append(this.strip, $('.basehalf-video-frames-part'));
		this.length = append(this.strip, $('.basehalf-video-frames-length'));
		this.playhead = append(this.strip, $('.basehalf-video-frames-playhead'));
		this.startHandle = append(this.strip, $('.basehalf-video-frames-handle.start'));
		this.endHandle = append(this.strip, $('.basehalf-video-frames-handle.end'));
		for (const [handle, label] of [
			[this.startHandle, localize('basehalf.mediaEdit.video.start', "Start")],
			[this.endHandle, localize('basehalf.mediaEdit.video.end', "End")]
		] as const) {
			handle.setAttribute('role', 'slider');
			handle.setAttribute('aria-label', label);
			handle.setAttribute('aria-valuemin', '0');
			handle.tabIndex = 0;
			append(handle, chevron(handle === this.startHandle ? 'left' : 'right'));
		}
		this._register(toDisposable(() => {
			this.disposed = true;
			this.clearHold();
			this.stopPlayhead();
			this.options.player.setPlayRange(undefined);
		}));

		this.registerListeners();
		this.applyChoice();
		const window = getWindow(this.element);
		const timer = window.setTimeout(() => this.loadPictures(), PICTURES_DELAY_MILLISECONDS);
		this._register(toDisposable(() => window.clearTimeout(timer)));
	}

	get choices(): IBaseHalfMediaChoices {
		return this.timeline.isWhole(this.range) ? {} : { keep: [{ start: this.range.start, end: this.range.end }] };
	}

	focus(): void {
		this.startHandle.focus({ preventScroll: true });
	}

	setChoices(choices: IBaseHalfMediaChoices): void {
		const range = this.timeline.normalize(choices.keep?.[0]);
		if (range.start === this.range.start && range.end === this.range.end) {
			return;
		}
		this.endDrag();
		this.range = range;
		// The player shows where the part starts.
		this.options.player.seek(this.range.start + 1e-4);
		this.applyChoice();
	}

	/** A part that differs from the one before is a change. */
	private changed(before: IBaseHalfVideoTrimRange): void {
		if (before.start !== this.range.start || before.end !== this.range.end) {
			this.onDidChangeEmitter.fire('trim');
		}
	}

	/** Reads the pictures of a container for the strip's width and a stretch of the video: as many as fit at its height in the picture's shape. */
	private loadPictures(): void {
		const width = this.strip.clientWidth;
		const count = this.pictureCount(width);
		if (this.disposed || width <= 0 || count === this.picturesCount) {
			return;
		}
		this.picturesCount = count;
		this.readPictures(this.pictures, this.picturesLoad, { from: 0, to: this.timeline.duration }, count, width);
	}

	private pictureCount(width: number): number {
		const video = this.options.video.file.video!;
		const rotated = video.rotation === 90 || video.rotation === 270;
		const aspect = (rotated ? video.displayHeight / video.displayWidth : video.displayWidth / video.displayHeight) || 16 / 9;
		return Math.max(1, Math.ceil(width / (STRIP_HEIGHT * aspect)));
	}

	private readPictures(container: HTMLElement, load: MutableDisposable<{ dispose(): void }>, view: IStripView, count: number, width: number): void {
		clearNode(container);
		const scale = getWindow(this.element).devicePixelRatio || 1;
		const cells: HTMLCanvasElement[] = [];
		for (let index = 0; index < count; index++) {
			const cell = append(container, $<HTMLCanvasElement>('canvas.basehalf-video-frames-picture'));
			cell.width = Math.max(1, Math.round(width / count * scale));
			cell.height = Math.round(STRIP_HEIGHT * scale);
			cells.push(cell);
		}
		// Each picture is the frame at the middle of its place.
		const times = cells.map((_, index) => view.from + (index + 0.5) * (view.to - view.from) / count);
		const cancellation = new CancellationTokenSource();
		load.value = toDisposable(() => cancellation.dispose(true));
		void readBaseHalfVideoTrimPictures({
			source: this.options.video.source,
			video: this.options.video.file.video!,
			times,
			height: STRIP_HEIGHT * scale,
			token: cancellation.token,
			onPicture: (index, picture) => {
				const cell = cells[index];
				const context = cell?.getContext('2d');
				if (context) {
					// The picture covers its cell, cut at the sides as needed.
					const ratio = Math.max(cell.width / picture.width, cell.height / picture.height);
					const drawWidth = picture.width * ratio;
					const drawHeight = picture.height * ratio;
					context.drawImage(picture, (cell.width - drawWidth) / 2, (cell.height - drawHeight) / 2, drawWidth, drawHeight);
				}
				picture.close();
			}
		});
	}

	private registerListeners(): void {
		const video = this.options.player.video;
		for (const type of ['timeupdate', 'seeked', 'loadedmetadata', 'durationchange'] as const) {
			this._register(addDisposableListener(video, type, () => this.updatePlayhead()));
		}
		this._register(addDisposableListener(video, 'play', () => this.followPlayhead()));
		this._register(addDisposableListener(video, 'pause', () => {
			this.stopPlayhead();
			this.updatePlayhead();
		}));
		// A press on the viewer is the viewer's: it reaches neither the player nor the canvas.
		for (const type of ['mousedown', 'click', 'dblclick'] as const) {
			this._register(addDisposableListener(this.element, type, event => event.stopPropagation()));
		}
		this._register(addDisposableListener(this.strip, 'pointerdown', event => this.onPointerDown(event)));
		this._register(addDisposableListener(this.strip, 'pointermove', event => this.onPointerMove(event)));
		for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
			this._register(addDisposableListener(this.strip, type, event => this.onPointerUp(event, type === 'pointerup')));
		}
		this._register(addDisposableListener(getWindow(this.element), 'keydown', event => {
			// Escape during a drag ends it and puts back what it changed; Card Detail stays (editing media, "The keyboard").
			if (event.key === 'Escape' && this.drag) {
				event.preventDefault();
				event.stopPropagation();
				this.cancelDrag();
			}
		}, true));
		for (const [handle, which] of [[this.startHandle, 'start'], [this.endHandle, 'end']] as const) {
			this._register(addDisposableListener(handle, 'keydown', event => this.onHandleKey(event, which)));
		}
		this._register(addDisposableListener(this.options.stage, 'keydown', event => this.onStageKey(event)));
		const ResizeObserverConstructor = getWindow(this.element).ResizeObserver;
		if (ResizeObserverConstructor) {
			const observer = new ResizeObserverConstructor(() => {
				this.render();
				this.loadPictures();
			});
			observer.observe(this.strip);
			this._register(toDisposable(() => observer.disconnect()));
		}
	}

	// #region The pointer

	private timeAt(clientX: number): number {
		const bounds = this.strip.getBoundingClientRect();
		const fraction = bounds.width > 0 ? Math.min(Math.max((clientX - bounds.left) / bounds.width, 0), 1) : 0;
		return this.view.from + fraction * (this.view.to - this.view.from);
	}

	private onPointerDown(event: PointerEvent): void {
		if (event.button !== 0) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		const time = this.timeAt(event.clientX);
		const handle = this.handleAt(event);
		let kind: DragKind;
		let grab = 0;
		if (handle) {
			kind = handle;
			grab = time - (handle === 'start' ? this.range.start : this.range.end);
			this.options.player.pause();
			this.scheduleHold();
		} else if (time > this.range.start && time < this.range.end && !this.timeline.isWhole(this.range)) {
			kind = 'press';
			grab = time - this.range.start;
		} else {
			kind = 'scrub';
			this.options.player.seek(time);
		}
		this.drag = { kind, pointerId: event.pointerId, startX: event.clientX, before: this.range, grab, moved: false, lastX: event.clientX };
		try {
			this.strip.setPointerCapture(event.pointerId);
		} catch {
			// A pointer that is no longer active cannot be captured; the press still counts.
		}
		this.element.classList.toggle('dragging', kind !== 'scrub' && kind !== 'press');
	}

	/** The handle under a press: where the two meet, the one on the press's side of the meeting point. */
	private handleAt(event: PointerEvent): BaseHalfVideoTrimHandle | undefined {
		const start = this.startHandle.getBoundingClientRect();
		const end = this.endHandle.getBoundingClientRect();
		const inStart = !this.startHandle.classList.contains('outside') && event.clientX >= start.left && event.clientX <= start.right;
		const inEnd = !this.endHandle.classList.contains('outside') && event.clientX >= end.left && event.clientX <= end.right;
		if (inStart && inEnd) {
			return event.clientX < (start.right + end.left) / 2 ? 'start' : 'end';
		}
		return inStart ? 'start' : inEnd ? 'end' : undefined;
	}

	private onPointerMove(event: PointerEvent): void {
		const drag = this.drag;
		if (!drag || drag.pointerId !== event.pointerId) {
			return;
		}
		if (!drag.moved && Math.abs(event.clientX - drag.startX) >= DRAG_THRESHOLD) {
			drag.moved = true;
			if (drag.kind === 'press') {
				this.drag = { ...drag, kind: 'move' };
				this.options.player.pause();
				this.element.classList.add('dragging');
			}
		}
		const current = this.drag!;
		if (event.clientX !== current.lastX) {
			current.lastX = event.clientX;
			// A handle that moves is not held still: the time to spread the viewer starts again.
			if (current.kind === 'start' || current.kind === 'end') {
				this.scheduleHold();
			}
		}
		const time = this.timeAt(event.clientX);
		switch (current.kind) {
			case 'start':
			case 'end':
				this.setRange(this.timeline.moveHandle(this.range, current.kind, time - current.grab), current.kind);
				break;
			case 'move':
				this.setRange(this.timeline.moveSelection(current.before, time - current.grab - current.before.start), 'start');
				break;
			case 'scrub':
				this.options.player.seek(time);
				break;
		}
	}

	private onPointerUp(event: PointerEvent, released: boolean): void {
		const drag = this.drag;
		if (!drag || drag.pointerId !== event.pointerId) {
			return;
		}
		this.drag = undefined;
		this.clearHold();
		this.element.classList.remove('dragging');
		if (drag.kind === 'press' && released) {
			// A press inside the part that did not move moves the playhead there.
			this.options.player.seek(this.timeAt(event.clientX));
		}
		this.unspread();
		this.applyChoice();
		this.changed(drag.before);
	}

	/** Escape during a drag: what it changed goes back. */
	private cancelDrag(): void {
		const drag = this.endDrag();
		if (drag) {
			this.range = drag.before;
			this.applyChoice();
		}
	}

	/** Ends a drag where it is, as when an undo sets other choices. */
	private endDrag(): IDrag | undefined {
		const drag = this.drag;
		if (!drag) {
			return undefined;
		}
		this.drag = undefined;
		this.clearHold();
		this.element.classList.remove('dragging');
		try {
			this.strip.releasePointerCapture(drag.pointerId);
		} catch {
			// Released already.
		}
		this.unspread();
		return drag;
	}

	private scheduleHold(): void {
		this.clearHold();
		if (this.view.from > 0 || this.view.to < this.timeline.duration) {
			return;
		}
		this.holdTimer = setTimeout(() => {
			this.holdTimer = undefined;
			this.spread();
		}, HOLD_MILLISECONDS);
	}

	private clearHold(): void {
		if (this.holdTimer !== undefined) {
			clearTimeout(this.holdTimer);
			this.holdTimer = undefined;
		}
	}

	/**
	 * Spreads the viewer out around the held handle: it shows a tenth of the
	 * video, or 2 s, whichever is longer, with the handle where it stands on
	 * the screen, and its frames read anew.
	 */
	private spread(): void {
		const drag = this.drag;
		if (!drag || (drag.kind !== 'start' && drag.kind !== 'end') || this.disposed) {
			return;
		}
		const duration = this.timeline.duration;
		const span = Math.max(duration * SPREAD_FRACTION, SPREAD_MIN_SECONDS);
		if (span >= duration) {
			// A video this short shows its frames one by one already.
			return;
		}
		const time = drag.kind === 'start' ? this.range.start : this.range.end;
		const bounds = this.strip.getBoundingClientRect();
		const fraction = bounds.width > 0 ? Math.min(Math.max((drag.lastX - bounds.left) / bounds.width, 0), 1) : 0.5;
		const from = Math.min(Math.max(time - fraction * span, 0), duration - span);
		this.view = { from, to: from + span };
		drag.grab = this.timeAt(drag.lastX) - time;
		this.element.classList.add('spread');
		const width = this.strip.clientWidth;
		this.readPictures(this.spreadPictures, this.spreadLoad, this.view, this.pictureCount(width), width);
		this.render();
	}

	private unspread(): void {
		if (!this.element.classList.contains('spread')) {
			return;
		}
		this.view = { from: 0, to: this.timeline.duration };
		this.element.classList.remove('spread');
		this.spreadLoad.clear();
		clearNode(this.spreadPictures);
		this.render();
	}

	// #endregion

	// #region The keyboard

	private onHandleKey(event: KeyboardEvent, handle: BaseHalfVideoTrimHandle): void {
		if (event.isComposing) {
			return;
		}
		const large = isMacintosh ? event.metaKey : event.ctrlKey;
		const step = event.shiftKey ? 'frame' : large ? LARGE_STEP_SECONDS : STEP_SECONDS;
		let next: IBaseHalfVideoTrimRange | undefined;
		switch (event.key) {
			case 'ArrowLeft':
			case 'ArrowDown':
				next = this.timeline.stepHandle(this.range, handle, step, -1);
				break;
			case 'ArrowRight':
			case 'ArrowUp':
				next = this.timeline.stepHandle(this.range, handle, step, 1);
				break;
			case 'Home':
				next = this.timeline.moveHandle(this.range, handle, 0);
				break;
			case 'End':
				next = this.timeline.moveHandle(this.range, handle, this.timeline.duration);
				break;
			case ' ':
				event.preventDefault();
				event.stopPropagation();
				this.options.player.togglePlay();
				return;
		}
		if (next) {
			// The arrow keys on the viewer move no card; a key that repeats is one step of undo.
			event.preventDefault();
			event.stopPropagation();
			const before = this.range;
			this.options.player.pause();
			this.setRange(next, handle);
			this.applyChoice();
			this.changed(before);
		}
	}

	/** I and O, anywhere in the player or the viewer, put the start and the end at the frame the player shows. */
	private onStageKey(event: KeyboardEvent): void {
		const key = event.key.toLowerCase();
		if ((key !== 'i' && key !== 'o') || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
			return;
		}
		if (getWindow(this.element).document.fullscreenElement) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		const before = this.range;
		const shown = this.timeline.edgeAtOrBefore((this.options.player.currentTime ?? 0) + 1e-4);
		this.range = key === 'i'
			? this.timeline.setHandle(this.range, 'start', shown)
			: this.timeline.setHandle(this.range, 'end', this.timeline.stepFrame(shown, 1));
		this.applyChoice();
		this.changed(before);
	}

	// #endregion

	/** Shows a new part; the player shows the frame at the handle that moved. */
	private setRange(range: IBaseHalfVideoTrimRange, moved: BaseHalfVideoTrimHandle | undefined): void {
		this.range = range;
		if (moved) {
			const time = moved === 'start' ? range.start : this.timeline.stepFrame(range.end, -1);
			this.options.player.seek(time + 1e-4);
		}
		this.render();
	}

	/** The part plays in the player. */
	private applyChoice(): void {
		this.options.player.setPlayRange(this.timeline.isWhole(this.range)
			? undefined
			: { start: this.range.start, end: this.range.end, lastFrame: this.timeline.stepFrame(this.range.end, -1) });
		this.render();
	}

	// #region Drawing

	private followPlayhead(): void {
		this.stopPlayhead();
		const window = getWindow(this.element);
		const step = () => {
			this.updatePlayhead();
			this.playheadFrame = window.requestAnimationFrame(step);
		};
		this.playheadFrame = window.requestAnimationFrame(step);
	}

	private stopPlayhead(): void {
		if (this.playheadFrame !== undefined) {
			getWindow(this.element).cancelAnimationFrame(this.playheadFrame);
			this.playheadFrame = undefined;
		}
	}

	/** Where a time stands on the strip, from 0 to 1, outside that range when the strip does not show it. */
	private fractionOf(time: number): number {
		const span = this.view.to - this.view.from;
		return span > 0 ? (time - this.view.from) / span : 0;
	}

	private updatePlayhead(): void {
		const fraction = this.fractionOf(this.options.player.currentTime ?? 0);
		this.playhead.classList.toggle('outside', fraction < 0 || fraction > 1);
		this.playhead.style.left = `${(Math.min(Math.max(fraction, 0), 1) * 100).toFixed(3)}%`;
	}

	private render(): void {
		const duration = this.timeline.duration;
		const start = this.fractionOf(this.range.start);
		const end = this.fractionOf(this.range.end);
		const clamp = (value: number) => Math.min(Math.max(value, 0), 1);
		this.strip.style.setProperty('--basehalf-video-frames-start', `${(clamp(start) * 100).toFixed(4)}%`);
		this.strip.style.setProperty('--basehalf-video-frames-end', `${(clamp(end) * 100).toFixed(4)}%`);
		this.startHandle.classList.toggle('outside', start < 0);
		this.endHandle.classList.toggle('outside', end > 1);
		this.element.classList.toggle('whole', this.timeline.isWhole(this.range));
		this.length.textContent = formatBaseHalfVideoTrimLength(this.range.end - this.range.start);
		// A part narrower than its length shows the length above the strip.
		const partWidth = (clamp(end) - clamp(start)) * this.strip.clientWidth;
		this.length.classList.toggle('outside', partWidth < this.length.offsetWidth + 8);
		for (const [handle, time] of [[this.startHandle, this.range.start], [this.endHandle, this.range.end]] as const) {
			handle.setAttribute('aria-valuemax', String(Math.round(duration * 100) / 100));
			handle.setAttribute('aria-valuenow', String(Math.round(time * 100) / 100));
			handle.setAttribute('aria-valuetext', localize('basehalf.mediaEdit.video.handleValue', "{0} of {1}", formatBaseHalfVideoTrimLength(time), formatBaseHalfVideoTrimLength(duration)));
		}
		this.updatePlayhead();
	}

	// #endregion
}

/** The chevron of a handle, which points away from the part. */
function chevron(direction: 'left' | 'right'): SVGElement {
	const svg = $.SVG('svg');
	svg.setAttribute('viewBox', '0 0 8 14');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('focusable', 'false');
	svg.classList.add('basehalf-video-frames-chevron');
	const path = $.SVG('path');
	path.setAttribute('d', direction === 'left' ? 'M6 2 L2 7 L6 12' : 'M2 2 L6 7 L2 12');
	path.setAttribute('fill', 'none');
	path.setAttribute('stroke', 'currentColor');
	path.setAttribute('stroke-width', '2');
	path.setAttribute('stroke-linecap', 'round');
	path.setAttribute('stroke-linejoin', 'round');
	svg.appendChild(path);
	return svg;
}
