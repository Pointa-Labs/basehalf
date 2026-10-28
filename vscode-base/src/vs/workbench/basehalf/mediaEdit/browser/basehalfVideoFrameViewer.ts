/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfVideoFrameViewer.css';
import { $, addDisposableListener, append, clearNode, getWindow, isHTMLElement } from '../../../../base/browser/dom.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { localize } from '../../../../nls.js';
import { BASEHALF_PLAYHEAD_STEP_SECONDS, IBaseHalfCanvasCardVideoPlayer } from '../../canvas/browser/basehalfCanvasCardVideoPlayer.js';
import { IBaseHalfMediaChoices } from '../common/basehalfEditRecord.js';
import { BASEHALF_TIME_ZOOM_REST_MS, BASEHALF_TIME_ZOOM_SHORTEST_SECONDS } from '../common/basehalfMediaZoom.js';
import { baseHalfVideoFrameEdges } from '../common/basehalfVideoFile.js';
import { BaseHalfVideoTrimHandle, BaseHalfVideoTrimTimeline, formatBaseHalfVideoTrimLength, IBaseHalfVideoTrimRange } from '../common/basehalfVideoTrimSelection.js';
import { BaseHalfMediaChange, BaseHalfPlayheadMove, IBaseHalfMediaEditor } from './basehalfMediaEditor.js';
import { IBaseHalfEditVideo } from './basehalfMediaEditService.js';
import { BaseHalfStripEdgeFollow, baseHalfStripClock, BaseHalfTimeZoom } from './basehalfTimeZoom.js';
import { readBaseHalfVideoTrimPictures } from './basehalfVideoTrimPictures.js';

/**
 * The frame viewer under the player of a video in Card Detail (editing media,
 * "Editing a video"): the video's timeline, a strip of the original's frames
 * with the part kept in a yellow frame, its two handles, the playhead, and
 * the part's length. It plays the part in the player, spreads out around a
 * handle that is held still and where a pinch spreads it ("Zooming the
 * picture and the time"), and makes a change of each handle or part let go.
 * While viewing ("Viewing and editing"), it is the timeline of the file as it
 * is: the frames of the part kept, with the playhead, which a press moves,
 * and no frame, handle, or length; the part plays once.
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
/** A set of pictures fades in over what the strip showed this long, in milliseconds (D101). */
const PICTURES_FADE_MILLISECONDS = 120;
/** A set of pictures that takes longer than this to read shows what is read then, in milliseconds (D101). */
const PICTURES_WAIT_MILLISECONDS = 1000;
/** Edit and Done glide the strip's stretch this long, in milliseconds (D101). */
const STRIP_GLIDE_MILLISECONDS = 250;
/** How long a handle is held still before the viewer spreads out around it. */
const HOLD_MILLISECONDS = 400;
/** What the viewer shows around a held handle: a tenth of the video, or this, whichever is longer. */
const SPREAD_MIN_SECONDS = 2;
/** A held handle's spread this close to the start or the end of the length shows it, in seconds. */
const SPREAD_EPSILON = 0.0005;
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

/** The times the strip shows: the whole video, the stretch a pinch spread out, or a stretch around a held handle. */
interface IStripView {
	readonly from: number;
	readonly to: number;
}

export class BaseHalfVideoFrameViewer extends Disposable implements IBaseHalfMediaEditor {

	readonly element: HTMLElement;
	private readonly strip: HTMLElement;
	/** The pictures of the whole video, read once. */
	private readonly pictures: HTMLElement;
	/** The pictures of the stretch a pinch spread out, over the whole video's. */
	private readonly zoomPictures: HTMLElement;
	private readonly spreadPictures: HTMLElement;
	private readonly length: HTMLElement;
	private readonly startHandle: HTMLElement;
	private readonly endHandle: HTMLElement;
	private readonly playhead: HTMLElement;

	private readonly onDidChangeEmitter = this._register(new Emitter<BaseHalfMediaChange>());
	readonly onDidChange = this.onDidChangeEmitter.event;

	private readonly timeline: BaseHalfVideoTrimTimeline;
	private readonly zoom: BaseHalfTimeZoom;
	private range: IBaseHalfVideoTrimRange;
	private view: IStripView;
	/** The stretch whose pictures the pictures of the zoom show. */
	private zoomDrawn: IStripView | undefined;
	/** A drag held at an edge of a held handle's spread carries the spread along (D98). */
	private readonly spreadFollow: BaseHalfStripEdgeFollow;
	private readonly spreadRest = this._register(new MutableDisposable());
	private drag: IDrag | undefined;
	private holdTimer: ReturnType<typeof setTimeout> | undefined;
	private playheadFrame: number | undefined;
	private picturesCount = 0;
	/** The viewer edits the video; otherwise it views the file as it is. */
	private editing = false;
	private disposed = false;
	private readonly picturesLoad = this._register(new MutableDisposable());
	private readonly zoomLoad = this._register(new MutableDisposable());
	private readonly spreadLoad = this._register(new MutableDisposable());
	/** The stretch of each set of pictures, read together and shown together (D101): a set is placed by its own times. */
	private readonly setStretches = new WeakMap<HTMLElement, IStripView>();
	/** The frame of a glide of the strip's stretch, as Edit and Done make, while one runs (D101). */
	private glideFrame: number | undefined;
	/** A glide ends on time even in a window that draws no frames. */
	private glideTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		container: HTMLElement,
		private readonly options: IBaseHalfVideoFrameViewerOptions
	) {
		super();
		const video = options.video.file.video!;
		this.timeline = new BaseHalfVideoTrimTimeline(baseHalfVideoFrameEdges(video));
		this.range = this.timeline.normalize(options.choices.keep?.[0]);
		// It starts by viewing the file: the part kept.
		this.view = { from: this.range.start, to: this.range.end };

		this.element = append(container, $('.basehalf-video-frames.viewing'));
		this.element.setAttribute('role', 'group');
		this.element.setAttribute('aria-label', localize('basehalf.mediaEdit.video.label', "Frames"));
		const row = append(this.element, $('.basehalf-video-frames-row'));
		this.strip = append(row, $('.basehalf-video-frames-strip'));
		// The pictures are cut at the strip's edges, where its handles stand outside it.
		const clip = append(this.strip, $('.basehalf-video-frames-clip'));
		this.pictures = append(clip, $('.basehalf-video-frames-pictures'));
		this.zoomPictures = append(clip, $('.basehalf-video-frames-pictures.zoom'));
		this.spreadPictures = append(clip, $('.basehalf-video-frames-pictures.spread'));
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
			append(handle, chevron(handle === this.startHandle ? 'left' : 'right'));
		}
		this.showHandles();
		this._register(toDisposable(() => {
			this.disposed = true;
			this.clearHold();
			this.stopPlayhead();
			this.stopGlide();
			this.options.player.setPlayRange(undefined);
		}));
		// The time under the pointer of a pinch stays under it, down to as many frames as the strip has pictures.
		this.zoom = this._register(new BaseHalfTimeZoom({
			strip: this.strip,
			// While viewing, the strip shows the file's length, and a pinch over it does nothing.
			active: () => this.editing,
			length: () => this.timeline.duration,
			shortest: () => Math.max(BASEHALF_TIME_ZOOM_SHORTEST_SECONDS, this.pictureCount(this.strip.clientWidth) * this.timeline.duration / Math.max(1, this.timeline.edges.length - 1)),
			onDidChange: rested => this.onDidZoom(rested),
			onDidMoveUnderDrag: clientX => this.dragTo(clientX)
		}));
		this.spreadFollow = this._register(new BaseHalfStripEdgeFollow(this.strip, baseHalfStripClock(getWindow(this.element)), () => this.view.to - this.view.from,
			direction => direction < 0 ? this.view.from <= SPREAD_EPSILON : this.view.to >= this.timeline.duration - SPREAD_EPSILON,
			(seconds, clientX) => this.moveSpread(seconds, clientX)));

		this.registerListeners();
		this.applyChoice();
		this.showStretch();
		const window = getWindow(this.element);
		const timer = window.setTimeout(() => this.loadPictures(), PICTURES_DELAY_MILLISECONDS);
		this._register(toDisposable(() => window.clearTimeout(timer)));
	}

	get choices(): IBaseHalfMediaChoices {
		return this.timeline.isWhole(this.range) ? {} : { keep: [{ start: this.range.start, end: this.range.end }] };
	}

	focus(): void {
		// The keyboard is the player's, while viewing and while editing; Tab takes it on to the handles (D100).
		this.options.player.focus();
	}

	togglePlay(): void {
		this.options.player.togglePlay();
	}

	setChoices(choices: IBaseHalfMediaChoices): void {
		const range = this.timeline.normalize(choices.keep?.[0]);
		if (range.start === this.range.start && range.end === this.range.end) {
			return;
		}
		this.endDrag();
		this.finishGlide();
		this.range = range;
		// The player shows where the part starts.
		this.options.player.seek(this.range.start + 1e-4);
		this.applyChoice();
		if (!this.editing) {
			// Viewing shows the file, which the choices made anew.
			this.showStretch();
		}
	}

	setEditing(editing: boolean): void {
		if (editing === this.editing) {
			return;
		}
		this.endDrag();
		this.finishGlide();
		this.editing = editing;
		this.element.classList.toggle('viewing', !editing);
		if (!editing) {
			// Done shows the file's length again; the next Edit starts from the whole video.
			this.zoom.reset();
		}
		this.showHandles();
		this.applyChoice();
		this.glideTo(this.restingView());
	}

	/**
	 * Glides the strip's stretch to `target` over 250 ms, as Edit and Done
	 * make it go from the part kept to the whole original and back (D101): each
	 * set of pictures moves and scales with the times it shows, and the
	 * pictures of the target are read once it is there.
	 */
	private glideTo(target: IStripView): void {
		this.stopGlide();
		const from = this.view;
		if (from.from === target.from && from.to === target.to) {
			this.showStretch();
			return;
		}
		const window = getWindow(this.element);
		const start = window.performance.now();
		const step = () => {
			const progress = Math.min(1, (window.performance.now() - start) / STRIP_GLIDE_MILLISECONDS);
			if (progress >= 1) {
				this.finishGlide();
				return;
			}
			// Fast at first and slow at the end, as a glide settles.
			const eased = 1 - Math.pow(1 - progress, 3);
			this.view = { from: from.from + (target.from - from.from) * eased, to: from.to + (target.to - from.to) * eased };
			this.element.classList.toggle('zoomed', !this.showsWhole());
			this.placePictures();
			this.render();
			this.glideFrame = window.requestAnimationFrame(step);
		};
		this.glideFrame = window.requestAnimationFrame(step);
		this.glideTimer = setTimeout(() => this.finishGlide(), STRIP_GLIDE_MILLISECONDS + 50);
		this.element.classList.add('gliding');
	}

	private stopGlide(): void {
		if (this.glideFrame !== undefined) {
			getWindow(this.element).cancelAnimationFrame(this.glideFrame);
			this.glideFrame = undefined;
		}
		if (this.glideTimer !== undefined) {
			clearTimeout(this.glideTimer);
			this.glideTimer = undefined;
		}
		this.element.classList.remove('gliding');
	}

	/** A glide that ends, or that a press, a gesture, or a change meets, ends where it was going. */
	private finishGlide(): void {
		if (this.glideFrame !== undefined || this.glideTimer !== undefined) {
			this.stopGlide();
			this.showStretch();
		}
	}

	movePlayhead(move: BaseHalfPlayheadMove): void {
		if (this.drag) {
			return;
		}
		const player = this.options.player;
		// Viewing shows the file, from the part's start to its last frame; editing the whole original.
		const first = this.editing ? 0 : this.range.start;
		const last = this.timeline.stepFrame(this.editing ? this.timeline.duration : this.range.end, -1);
		const shown = this.timeline.edgeAtOrBefore((player.currentTime ?? first) + 1e-4);
		let edge: number;
		if (move.kind === 'jump') {
			edge = move.to === 'start' ? first : last;
		} else if (move.by === 'frame') {
			// A frame is seen still: the video stops on it.
			player.pause();
			edge = this.timeline.stepFrame(shown, move.direction);
		} else {
			edge = this.timeline.edgeAtOrBefore(shown + move.direction * BASEHALF_PLAYHEAD_STEP_SECONDS + 1e-4);
		}
		edge = Math.min(Math.max(edge, first), last);
		// The frame that starts at an edge is shown a hair past it, as the frame at a handle is.
		player.seek(edge + 1e-4);
		if (this.editing) {
			this.zoom.follow(edge);
		}
		this.updatePlayhead();
	}

	/** The handles take the keyboard while editing, and are not there while viewing. */
	private showHandles(): void {
		for (const handle of [this.startHandle, this.endHandle]) {
			handle.tabIndex = this.editing ? 0 : -1;
			if (this.editing) {
				handle.removeAttribute('aria-hidden');
			} else {
				handle.setAttribute('aria-hidden', 'true');
			}
		}
	}

	/** What the strip shows when no handle is held: the part kept while viewing, the file as it is; while editing, the stretch a pinch spread out, or the whole video. */
	private restingView(): IStripView {
		return this.editing ? this.zoom.stretch : { from: this.range.start, to: this.range.end };
	}

	/** Whether the strip shows the whole video. */
	private showsWhole(view: IStripView = this.view): boolean {
		return view.from <= 1e-9 && view.to >= this.timeline.duration - 1e-9;
	}

	/** Shows what the strip shows at rest, with the pictures of its stretch over the whole video's. */
	private showStretch(): void {
		this.view = this.restingView();
		this.element.classList.toggle('zoomed', !this.showsWhole());
		if (this.zoomDrawn?.from !== this.view.from || this.zoomDrawn?.to !== this.view.to) {
			this.readZoomPictures();
		}
		this.placePictures();
		this.render();
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

	/**
	 * Reads a set of pictures of a stretch into a container (D101). The set
	 * waits unseen over what the container shows until all of it is read, or
	 * a second has passed, and then fades in over it; the sets it covers go
	 * once it has. A set that a newer one replaces before it shows goes unseen.
	 */
	private readPictures(container: HTMLElement, load: MutableDisposable<{ dispose(): void }>, view: IStripView, count: number, width: number): void {
		const window = getWindow(this.element);
		const scale = window.devicePixelRatio || 1;
		const set = append(container, $('.basehalf-video-frames-set.pending'));
		this.setStretches.set(set, view);
		const cells: HTMLCanvasElement[] = [];
		for (let index = 0; index < count; index++) {
			const cell = append(set, $<HTMLCanvasElement>('canvas.basehalf-video-frames-picture'));
			cell.width = Math.max(1, Math.round(width / count * scale));
			cell.height = Math.round(STRIP_HEIGHT * scale);
			cells.push(cell);
		}
		this.placePictures();
		// Each picture is the frame at the middle of its place, or a key frame within half a place of it.
		const span = (view.to - view.from) / count;
		const times = cells.map((_, index) => view.from + (index + 0.5) * span);
		const cancellation = new CancellationTokenSource();
		let shown = false;
		const show = () => {
			if (shown || cancellation.token.isCancellationRequested || this.disposed) {
				return;
			}
			shown = true;
			set.classList.remove('pending');
			window.setTimeout(() => {
				for (const other of Array.from(container.children)) {
					if (other !== set && !other.classList.contains('pending') && set.isConnected) {
						other.remove();
					}
				}
			}, PICTURES_FADE_MILLISECONDS);
		};
		const wait = window.setTimeout(show, PICTURES_WAIT_MILLISECONDS);
		load.value = toDisposable(() => {
			cancellation.dispose(true);
			window.clearTimeout(wait);
			if (!shown) {
				set.remove();
			}
		});
		void readBaseHalfVideoTrimPictures({
			source: this.options.video.source,
			video: this.options.video.file.video!,
			times,
			tolerance: span / 2,
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
		}).then(() => {
			window.clearTimeout(wait);
			show();
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
				if (!this.showsWhole() && !this.element.classList.contains('spread')) {
					// As many pictures as fit at the new width; a held handle's spread reads them when it is let go.
					this.readZoomPictures();
					this.placePictures();
				}
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
		this.finishGlide();
		const time = this.timeAt(event.clientX);
		const handle = this.editing ? this.handleAt(event) : undefined;
		let kind: DragKind;
		let grab = 0;
		if (!this.editing) {
			// While viewing, a press anywhere moves the playhead, and a drag from there moves it along.
			kind = 'scrub';
			this.options.player.seek(time);
		} else if (handle) {
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
		// Held at an edge of the stretch a pinch spread out, or of a held handle's spread, the drag carries it along (D98).
		const carries = this.editing && current.kind !== 'press';
		const spread = this.element.classList.contains('spread');
		this.zoom.dragAt(carries && !spread ? event.clientX : undefined);
		this.spreadFollow.at(carries && spread ? event.clientX : undefined);
		// While what is shown follows, what the drag holds stays at the margin's inner side, never under the strip's edge.
		this.dragTo(!carries ? event.clientX : spread ? this.spreadFollow.place(event.clientX) : this.zoom.place(event.clientX));
	}

	/** A drag held at an edge of a held handle's spread: the spread moves by `seconds`, within the video, and what the drag holds follows the pointer. */
	private moveSpread(seconds: number, clientX: number): void {
		const span = this.view.to - this.view.from;
		const from = Math.min(Math.max(this.view.from + seconds, 0), Math.max(0, this.timeline.duration - span));
		if (from === this.view.from) {
			return;
		}
		this.view = { from, to: from + span };
		this.dragTo(this.spreadFollow.place(clientX));
		this.placePictures();
		this.render();
		// The pictures drawn slide with it; once it rests, the frames of the new stretch are read.
		this.spreadRest.value = toDisposable((() => {
			const timer = setTimeout(() => this.readSpreadPictures(), BASEHALF_TIME_ZOOM_REST_MS);
			return () => clearTimeout(timer);
		})());
	}

	private readSpreadPictures(): void {
		const width = this.strip.clientWidth;
		if (!this.element.classList.contains('spread') || width <= 0) {
			return;
		}
		this.readPictures(this.spreadPictures, this.spreadLoad, this.view, this.pictureCount(width), width);
		this.placePictures();
	}

	/** What the drag holds goes to the time under the pointer. */
	private dragTo(clientX: number): void {
		const current = this.drag;
		if (!current) {
			return;
		}
		const time = this.timeAt(clientX);
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
		this.zoom.dragAt(undefined);
		this.spreadFollow.at(undefined);
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
		this.zoom.dragAt(undefined);
		this.spreadFollow.at(undefined);
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
		if (this.element.classList.contains('spread')) {
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
	 * the screen, and its frames read anew; not when the stretch shown is as
	 * short already, a pinch having spread it.
	 */
	private spread(): void {
		const drag = this.drag;
		if (!drag || (drag.kind !== 'start' && drag.kind !== 'end') || this.disposed) {
			return;
		}
		const duration = this.timeline.duration;
		const span = Math.max(duration * SPREAD_FRACTION, SPREAD_MIN_SECONDS);
		if (span >= this.view.to - this.view.from) {
			// A video this short, or a stretch this short, shows its frames one by one already.
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
		// The stretch a pinch chose shows again, or the whole video.
		this.view = this.restingView();
		this.element.classList.remove('spread');
		this.spreadFollow.at(undefined);
		this.spreadRest.clear();
		this.spreadLoad.clear();
		clearNode(this.spreadPictures);
		if (this.zoomDrawn?.from !== this.view.from || this.zoomDrawn?.to !== this.view.to) {
			this.readZoomPictures();
		}
		this.placePictures();
		this.render();
	}

	/**
	 * A pinch, the wheel, or a drag past an edge changed the stretch shown:
	 * the pictures drawn stretch with it, and once the gesture rests the frames
	 * of the new stretch are read. A held handle's spread stays until it is
	 * let go.
	 */
	private onDidZoom(rested: boolean): void {
		if (!this.editing) {
			return;
		}
		this.finishGlide();
		this.element.classList.toggle('zoomed', this.zoom.spread);
		if (this.element.classList.contains('spread')) {
			return;
		}
		this.view = this.zoom.stretch;
		if (rested) {
			this.readZoomPictures();
		}
		this.placePictures();
		this.render();
	}

	/**
	 * Reads the pictures of the stretch shown, over the whole video's stretched
	 * under them until they come. The whole video's own pictures show while
	 * the strip shows it; the stretch's set is kept unseen, so that Done shows
	 * the part kept again at once (D101).
	 */
	private readZoomPictures(): void {
		if (this.showsWhole()) {
			this.zoomLoad.clear();
			return;
		}
		const width = this.strip.clientWidth;
		if (width <= 0) {
			return;
		}
		this.zoomDrawn = this.view;
		this.readPictures(this.zoomPictures, this.zoomLoad, this.view, this.pictureCount(width), width);
	}

	/** Draws each set of pictures, of the whole video, of the zoom, and of a held handle's spread, at the times the strip shows. */
	private placePictures(): void {
		const span = this.view.to - this.view.from;
		for (const container of [this.pictures, this.zoomPictures, this.spreadPictures]) {
			for (const set of Array.from(container.children)) {
				const drawn = isHTMLElement(set) ? this.setStretches.get(set) : undefined;
				if (!drawn || !isHTMLElement(set)) {
					continue;
				}
				if (span <= 0 || (drawn.from === this.view.from && drawn.to === this.view.to)) {
					set.style.transform = '';
					continue;
				}
				const offset = (drawn.from - this.view.from) / span * 100;
				set.style.transform = `translateX(${offset.toFixed(4)}%) scaleX(${((drawn.to - drawn.from) / span).toFixed(5)})`;
			}
		}
	}

	// #endregion

	// #region The keyboard

	private onHandleKey(event: KeyboardEvent, handle: BaseHalfVideoTrimHandle): void {
		if (event.isComposing || !this.editing) {
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
		if (!this.editing || (key !== 'i' && key !== 'o') || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
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

	/** The part plays in the player: over and over while editing, once while viewing, as the file plays. */
	private applyChoice(): void {
		this.options.player.setPlayRange(this.timeline.isWhole(this.range)
			? undefined
			: { start: this.range.start, end: this.range.end, lastFrame: this.timeline.stepFrame(this.range.end, -1), ...(this.editing ? {} : { once: true }) });
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
		const time = this.options.player.currentTime ?? 0;
		if (this.editing && !this.drag && !this.options.player.video.paused && !this.element.classList.contains('spread')) {
			// While the video plays, the stretch a pinch spread out follows the playhead.
			this.zoom.follow(time);
		}
		const fraction = this.fractionOf(time);
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
		// The times the strip shows, in seconds, as its pictures and its handles stand.
		this.strip.dataset.from = this.view.from.toFixed(3);
		this.strip.dataset.to = this.view.to.toFixed(3);
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
