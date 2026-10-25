/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfVideoTrimBar.css';
import { $, addDisposableListener, append, clearNode, getActiveElement, getWindow } from '../../../../base/browser/dom.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Disposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IBaseHalfCanvasCardVideoPlayer } from '../../canvas/browser/basehalfCanvasCardVideoPlayer.js';
import { IBaseHalfWorkspaceResource } from '../../navigation/common/basehalfCanvasNavigation.js';
import { baseHalfVideoFrameEdges, BaseHalfVideoFileError, IBaseHalfVideoByteSource, IBaseHalfVideoFile } from '../common/basehalfVideoFile.js';
import { BaseHalfVideoTrimHandle, BaseHalfVideoTrimTimeline, formatBaseHalfVideoTrimLength, IBaseHalfVideoTrimRange } from '../common/basehalfVideoTrimSelection.js';
import { readBaseHalfVideoTrimPictures } from './basehalfVideoTrimPictures.js';
import { baseHalfVideoVersion, IBaseHalfVideoTrimService } from './basehalfVideoTrimService.js';

/**
 * The trim bar under the player of a video in Card Detail (trimming a video,
 * "The trim bar"): a strip of the picture's frames with the selection, its
 * two handles, and the playhead, Trim, and a line of status. The bar plays
 * the selection in the player, trims the video to it through the trim
 * service, and keeps it for the video while the window is open.
 */

/** A control of the trim bar that takes the keyboard. */
export type BaseHalfVideoTrimControl = 'start' | 'end' | 'trim';

export interface IBaseHalfVideoTrimBarOptions {
	readonly video: IBaseHalfWorkspaceResource;
	readonly player: IBaseHalfCanvasCardVideoPlayer;
	/** The element that holds the player and the bar: I and O work anywhere in it. */
	readonly stage: HTMLElement;
}

/** The height of the strip, in pixels; its pictures are this high. */
const STRIP_HEIGHT = 48;
/** A press that moves less than this, in pixels, is a press, not a drag. */
const DRAG_THRESHOLD = 3;
/** How long after the bar appears its pictures start to be read: Card Detail fades in first. */
const PICTURES_DELAY_MILLISECONDS = 250;
/** Steps of the keyboard on a handle, in seconds. */
const STEP_SECONDS = 0.1;
const LARGE_STEP_SECONDS = 1;

type DragKind = BaseHalfVideoTrimHandle | 'move' | 'press' | 'scrub';

interface IDrag {
	readonly kind: DragKind;
	readonly pointerId: number;
	readonly startX: number;
	/** The selection when the drag started, which Escape puts back. */
	readonly before: IBaseHalfVideoTrimRange;
	/** The time under the pointer when it was pressed, less the time it holds. */
	readonly grab: number;
	moved: boolean;
}

const CHECK_PATH = 'M10 15.172L19.192 5.979L20.607 7.393L10 18L3.636 11.636L5.05 10.222L10 15.172Z';

export class BaseHalfVideoTrimBar extends Disposable {

	readonly element: HTMLElement;
	private readonly strip: HTMLElement;
	private readonly pictures: HTMLElement;
	private readonly length: HTMLElement;
	private readonly startHandle: HTMLElement;
	private readonly endHandle: HTMLElement;
	private readonly playhead: HTMLElement;
	private readonly trimButton: HTMLButtonElement;
	private readonly status: HTMLElement;

	private timeline: BaseHalfVideoTrimTimeline | undefined;
	private file: IBaseHalfVideoFile | undefined;
	private source: IBaseHalfVideoByteSource | undefined;
	private version = '';
	private range: IBaseHalfVideoTrimRange = { start: 0, end: 0 };
	/** Why the video cannot be trimmed. */
	private unavailable: string | undefined;
	/** Why the last trim left the video as it was, until the selection changes. */
	private failure: string | undefined;
	private drag: IDrag | undefined;
	/** The control that takes the keyboard once the handles show. */
	private pendingFocus: BaseHalfVideoTrimControl | undefined;
	private playheadFrame: number | undefined;
	private picturesCount = 0;
	private disposed = false;
	private readonly picturesLoad = this._register(new MutableDisposable());

	constructor(
		container: HTMLElement,
		private readonly options: IBaseHalfVideoTrimBarOptions,
		@IBaseHalfVideoTrimService private readonly trimService: IBaseHalfVideoTrimService,
		@IFileService private readonly fileService: IFileService,
		@IHoverService private readonly hoverService: IHoverService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.element = append(container, $('.basehalf-video-trim'));
		this.element.setAttribute('role', 'group');
		this.element.setAttribute('aria-label', localize('basehalf.videoTrim.label', "Trim"));
		const row = append(this.element, $('.basehalf-video-trim-row'));
		this.strip = append(row, $('.basehalf-video-trim-strip'));
		this.pictures = append(this.strip, $('.basehalf-video-trim-pictures'));
		// The shades and the selection's frame follow the strip's properties of the selection.
		append(this.strip, $('.basehalf-video-trim-shade.before'));
		append(this.strip, $('.basehalf-video-trim-shade.after'));
		append(this.strip, $('.basehalf-video-trim-selection'));
		this.length = append(this.strip, $('.basehalf-video-trim-length'));
		this.playhead = append(this.strip, $('.basehalf-video-trim-playhead'));
		this.startHandle = append(this.strip, $('.basehalf-video-trim-handle.start'));
		this.endHandle = append(this.strip, $('.basehalf-video-trim-handle.end'));
		for (const [handle, label] of [
			[this.startHandle, localize('basehalf.videoTrim.start', "Trim Start")],
			[this.endHandle, localize('basehalf.videoTrim.end', "Trim End")]
		] as const) {
			handle.setAttribute('role', 'slider');
			handle.setAttribute('aria-label', label);
			handle.setAttribute('aria-valuemin', '0');
			handle.tabIndex = 0;
			append(handle, $('.basehalf-video-trim-grip'));
		}
		this.trimButton = append(row, $<HTMLButtonElement>('button.basehalf-video-trim-confirm'));
		this.trimButton.type = 'button';
		this.trimButton.append(checkIcon());
		this.status = append(this.element, $('.basehalf-video-trim-status'));
		this.status.setAttribute('aria-live', 'polite');
		this._register(this.hoverService.setupDelayedHover(this.trimButton, () => ({ content: this.trimHover() })));
		this._register(this.trimService.showVideo(options.video.resource));
		this._register(toDisposable(() => {
			this.disposed = true;
			this.stopPlayhead();
			this.options.player.setPlayRange(undefined);
		}));

		this.registerListeners();
		this.render();
		void this.load();
	}

	private get video(): URI {
		return this.options.video.resource;
	}

	/** The control of the bar that holds an element: a handle or Trim. */
	controlOf(element: Element): BaseHalfVideoTrimControl | undefined {
		return this.startHandle.contains(element) ? 'start' : this.endHandle.contains(element) ? 'end' : this.trimButton.contains(element) ? 'trim' : undefined;
	}

	/**
	 * Puts the keyboard on a control, as it was on the bar before its video was
	 * shown anew. The handles show once the bar has read its video: until then
	 * this says that it could not, and the bar takes the keyboard when they
	 * show, unless the keyboard went out of the player and the bar meanwhile.
	 */
	focusControl(control: BaseHalfVideoTrimControl): boolean {
		if (control !== 'trim' && !this.timeline && !this.unavailable) {
			this.pendingFocus = control;
			return false;
		}
		// The handles of a video that cannot be trimmed do not show: Trim takes their keyboard.
		const target = control === 'trim' || this.unavailable ? this.trimButton : control === 'start' ? this.startHandle : this.endHandle;
		target.focus({ preventScroll: true });
		return true;
	}

	private takePendingFocus(): void {
		const control = this.pendingFocus;
		this.pendingFocus = undefined;
		const active = getActiveElement();
		if (control && (!active || active === this.element.ownerDocument.body || this.options.stage.contains(active))) {
			this.focusControl(control);
		}
	}

	private async load(): Promise<void> {
		try {
			const stat = await this.fileService.stat(this.video);
			const { file, source } = await this.trimService.readVideo(this.video);
			if (this.disposed) {
				return;
			}
			this.version = baseHalfVideoVersion(stat);
			this.file = file;
			this.source = source;
			const timeline = this.timeline = new BaseHalfVideoTrimTimeline(baseHalfVideoFrameEdges(file.video!));
			// A selection is kept for one version of the file: after a trim or its undo, the whole picture is selected.
			this.range = timeline.normalize(this.trimService.keptSelection(this.video, this.version));
			if (!file.video?.codec) {
				this.unavailable = localize('basehalf.videoTrim.unavailable.decode', "this system cannot decode its picture.");
			}
			this.applyRange();
			this.takePendingFocus();
			const window = getWindow(this.element);
			const timer = window.setTimeout(() => this.loadPictures(), PICTURES_DELAY_MILLISECONDS);
			this._register(toDisposable(() => window.clearTimeout(timer)));
		} catch (error) {
			if (this.disposed) {
				return;
			}
			this.unavailable = error instanceof BaseHalfVideoFileError ? error.message : localize('basehalf.videoTrim.unavailable.read', "its file could not be read.");
			if (!(error instanceof BaseHalfVideoFileError)) {
				this.logService.warn('[BaseHalf] the trim bar could not read its video', error);
			}
			this.render();
			this.takePendingFocus();
		}
	}

	/** Reads the strip's pictures again for its width: as many as fit at its height in the picture's shape. */
	private loadPictures(): void {
		const file = this.file;
		const source = this.source;
		const timeline = this.timeline;
		const video = file?.video;
		if (!file || !source || !timeline || !video || this.disposed) {
			return;
		}
		const width = this.strip.clientWidth;
		if (width <= 0) {
			return;
		}
		const rotated = video.rotation === 90 || video.rotation === 270;
		const aspect = (rotated ? video.displayHeight / video.displayWidth : video.displayWidth / video.displayHeight) || 16 / 9;
		const count = Math.max(1, Math.ceil(width / (STRIP_HEIGHT * aspect)));
		if (count === this.picturesCount) {
			return;
		}
		this.picturesCount = count;
		clearNode(this.pictures);
		const scale = getWindow(this.element).devicePixelRatio || 1;
		const cells: HTMLCanvasElement[] = [];
		for (let index = 0; index < count; index++) {
			const cell = append(this.pictures, $<HTMLCanvasElement>('canvas.basehalf-video-trim-picture'));
			cell.width = Math.max(1, Math.round(width / count * scale));
			cell.height = Math.round(STRIP_HEIGHT * scale);
			cells.push(cell);
		}
		const duration = timeline.duration;
		const times = cells.map((_, index) => (index + 0.5) * duration / count);
		const cancellation = new CancellationTokenSource();
		this.picturesLoad.value = toDisposable(() => cancellation.dispose(true));
		void readBaseHalfVideoTrimPictures({
			source,
			video,
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
		this._register(this.trimService.onDidChangeTrim(resource => {
			if (isEqual(resource, this.video)) {
				this.render();
			}
		}));
		// A press on the bar is the bar's: it reaches neither the player nor the canvas.
		for (const type of ['mousedown', 'click', 'dblclick'] as const) {
			this._register(addDisposableListener(this.element, type, event => event.stopPropagation()));
		}
		this._register(addDisposableListener(this.strip, 'pointerdown', event => this.onPointerDown(event)));
		this._register(addDisposableListener(this.strip, 'pointermove', event => this.onPointerMove(event)));
		for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
			this._register(addDisposableListener(this.strip, type, event => this.onPointerUp(event, type === 'pointerup')));
		}
		this._register(addDisposableListener(getWindow(this.element), 'keydown', event => {
			// Escape ends a drag and puts the selection back; Card Detail stays (opening and closing Card Detail, "The keyboard").
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
		this._register(addDisposableListener(this.trimButton, 'click', () => this.trim()));
		const ResizeObserverConstructor = getWindow(this.element).ResizeObserver;
		if (ResizeObserverConstructor) {
			const observer = new ResizeObserverConstructor(() => {
				this.render();
				if (this.file) {
					this.loadPictures();
				}
			});
			observer.observe(this.strip);
			this._register(toDisposable(() => observer.disconnect()));
		}
	}

	// #region The pointer

	private timeAt(clientX: number): number {
		const bounds = this.strip.getBoundingClientRect();
		const duration = this.timeline?.duration ?? 0;
		const fraction = bounds.width > 0 ? Math.min(Math.max((clientX - bounds.left) / bounds.width, 0), 1) : 0;
		return fraction * duration;
	}

	private onPointerDown(event: PointerEvent): void {
		if (event.button !== 0) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		const timeline = this.timeline;
		if (!timeline || this.unavailable) {
			return;
		}
		const time = this.timeAt(event.clientX);
		const handle = this.handleAt(event);
		let kind: DragKind;
		let grab = 0;
		if (handle) {
			kind = handle;
			grab = time - (handle === 'start' ? this.range.start : this.range.end);
			this.options.player.pause();
		} else if (time > this.range.start && time < this.range.end && !timeline.isWhole(this.range)) {
			kind = 'press';
			grab = time - this.range.start;
		} else {
			kind = 'scrub';
			this.options.player.seek(time);
		}
		this.drag = { kind, pointerId: event.pointerId, startX: event.clientX, before: this.range, grab, moved: false };
		try {
			this.strip.setPointerCapture(event.pointerId);
		} catch {
			// A pointer that is no longer active cannot be captured; the press still counts.
		}
		this.element.classList.toggle('dragging', kind !== 'scrub' && kind !== 'press');
	}

	/** The handle under a press: where the two meet, the one on the press's side. */
	private handleAt(event: PointerEvent): BaseHalfVideoTrimHandle | undefined {
		const start = this.startHandle.getBoundingClientRect();
		const end = this.endHandle.getBoundingClientRect();
		const inStart = event.clientX >= start.left && event.clientX <= start.right;
		const inEnd = event.clientX >= end.left && event.clientX <= end.right;
		if (inStart && inEnd) {
			return event.clientX < (start.right + end.left) / 2 ? 'start' : 'end';
		}
		return inStart ? 'start' : inEnd ? 'end' : undefined;
	}

	private onPointerMove(event: PointerEvent): void {
		const drag = this.drag;
		const timeline = this.timeline;
		if (!drag || drag.pointerId !== event.pointerId || !timeline) {
			return;
		}
		const time = this.timeAt(event.clientX);
		if (!drag.moved && Math.abs(event.clientX - drag.startX) >= DRAG_THRESHOLD) {
			drag.moved = true;
			if (drag.kind === 'press') {
				this.drag = { ...drag, kind: 'move' };
				this.options.player.pause();
				this.element.classList.add('dragging');
			}
		}
		const current = this.drag!;
		switch (current.kind) {
			case 'start':
			case 'end':
				this.setRange(timeline.moveHandle(this.range, current.kind, time - current.grab), current.kind);
				break;
			case 'move':
				this.setRange(timeline.moveSelection(current.before, time - current.grab - current.before.start), 'start');
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
		this.element.classList.remove('dragging');
		if (drag.kind === 'press' && released) {
			// A press inside the selection that did not move moves the playhead there.
			this.options.player.seek(this.timeAt(event.clientX));
		}
		this.commitRange();
	}

	private cancelDrag(): void {
		const drag = this.drag;
		if (!drag) {
			return;
		}
		this.drag = undefined;
		this.element.classList.remove('dragging');
		try {
			this.strip.releasePointerCapture(drag.pointerId);
		} catch {
			// Released already.
		}
		this.setRange(drag.before, undefined);
		this.commitRange();
	}

	// #endregion

	// #region The keyboard

	private onHandleKey(event: KeyboardEvent, handle: BaseHalfVideoTrimHandle): void {
		const timeline = this.timeline;
		if (!timeline || event.isComposing) {
			return;
		}
		const large = isMacintosh ? event.metaKey : event.ctrlKey;
		const step = event.shiftKey ? 'frame' : large ? LARGE_STEP_SECONDS : STEP_SECONDS;
		let next: IBaseHalfVideoTrimRange | undefined;
		switch (event.key) {
			case 'ArrowLeft':
			case 'ArrowDown':
				next = timeline.stepHandle(this.range, handle, step, -1);
				break;
			case 'ArrowRight':
			case 'ArrowUp':
				next = timeline.stepHandle(this.range, handle, step, 1);
				break;
			case 'Home':
				next = timeline.moveHandle(this.range, handle, 0);
				break;
			case 'End':
				next = timeline.moveHandle(this.range, handle, timeline.duration);
				break;
			case ' ':
				event.preventDefault();
				event.stopPropagation();
				this.options.player.togglePlay();
				return;
			case 'Enter':
				event.preventDefault();
				event.stopPropagation();
				this.trim();
				return;
		}
		if (next) {
			// The arrow keys on the bar move no card.
			event.preventDefault();
			event.stopPropagation();
			this.options.player.pause();
			this.setRange(next, handle);
			this.commitRange();
		}
	}

	/** I and O, anywhere in the player or the bar, put the start and the end at the frame the player shows. */
	private onStageKey(event: KeyboardEvent): void {
		const timeline = this.timeline;
		const key = event.key.toLowerCase();
		if (!timeline || this.unavailable || (key !== 'i' && key !== 'o') || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
			return;
		}
		if (getWindow(this.element).document.fullscreenElement) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		const shown = timeline.edgeAtOrBefore((this.options.player.currentTime ?? 0) + 1e-4);
		const next = key === 'i'
			? timeline.setHandle(this.range, 'start', shown)
			: timeline.setHandle(this.range, 'end', timeline.stepFrame(shown, 1));
		this.setRange(next, undefined);
		this.commitRange();
	}

	// #endregion

	/** Shows a new selection; the player shows the frame at the handle that moved. */
	private setRange(range: IBaseHalfVideoTrimRange, moved: BaseHalfVideoTrimHandle | undefined): void {
		this.range = range;
		if (moved && this.timeline) {
			const time = moved === 'start' ? range.start : this.timeline.stepFrame(range.end, -1);
			this.options.player.seek(time + 1e-4);
		}
		this.render();
	}

	/** The selection is kept, and plays. */
	private commitRange(): void {
		const timeline = this.timeline;
		if (!timeline) {
			return;
		}
		this.trimService.keepSelection(this.video, this.version, this.range);
		this.failure = undefined;
		this.applyRange();
	}

	private applyRange(): void {
		const timeline = this.timeline;
		if (!timeline) {
			return;
		}
		this.options.player.setPlayRange(timeline.isWhole(this.range)
			? undefined
			: { start: this.range.start, end: this.range.end, lastFrame: timeline.stepFrame(this.range.end, -1) });
		this.render();
	}

	// #region Trimming

	private trimDisabledReason(): string | undefined {
		if (this.unavailable) {
			return localize('basehalf.videoTrim.cannotTrim', "BaseHalf can't trim this video: {0}", this.unavailable);
		}
		if (!this.timeline || this.timeline.isWhole(this.range)) {
			return localize('basehalf.videoTrim.choosePart', "Choose a part of the video first");
		}
		if (this.trimService.runningTrim(this.video)) {
			return localize('basehalf.videoTrim.beingTrimmed', "The video is being trimmed");
		}
		return undefined;
	}

	private trimHover(): string {
		return this.trimDisabledReason() ?? localize('basehalf.videoTrim.trimKey', "Trim (Enter)");
	}

	private trim(): void {
		if (this.trimDisabledReason()) {
			return;
		}
		this.failure = undefined;
		// The video's file changes when it is trimmed: Card Detail then shows it anew, with a bar of its own.
		this.trimService.trimVideo(this.options.video, this.range).then(() => {
			if (!this.disposed) {
				this.render();
			}
		}, (error: unknown) => {
			if (!this.disposed) {
				this.failure = localize('basehalf.videoTrim.trimFailed', "BaseHalf could not trim the video: {0}", error instanceof Error ? error.message : String(error));
				this.render();
			}
		});
		this.render();
	}

	/** What the status line says once this version of the file was made by a trim. */
	private trimmedStatus(): string | undefined {
		const trimmed = this.timeline && this.timeline.isWhole(this.range) ? this.trimService.lastTrim(this.video, this.version) : undefined;
		if (!trimmed) {
			return undefined;
		}
		const length = formatBaseHalfVideoTrimLength(trimmed.range.end - trimmed.range.start);
		const undo = this.keybindingService.lookupKeybinding('undo')?.getLabel() ?? (isMacintosh ? '⌘Z' : 'Ctrl+Z');
		return trimmed.soundDropped
			? localize('basehalf.videoTrim.trimmedNoSound', "Trimmed to {0} without sound: BaseHalf can't read or write this video's sound here. {1} puts the video back.", length, undo)
			: localize('basehalf.videoTrim.trimmed', "Trimmed to {0}. {1} puts the video back.", length, undo);
	}

	// #endregion

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

	private updatePlayhead(): void {
		const duration = this.timeline?.duration;
		const time = this.options.player.currentTime ?? 0;
		const fraction = duration ? Math.min(Math.max(time / duration, 0), 1) : 0;
		this.playhead.style.left = `${(fraction * 100).toFixed(3)}%`;
	}

	private render(): void {
		const timeline = this.timeline;
		const duration = timeline?.duration ?? 0;
		const start = duration ? this.range.start / duration : 0;
		const end = duration ? this.range.end / duration : 1;
		this.strip.style.setProperty('--basehalf-video-trim-start', `${(start * 100).toFixed(4)}%`);
		this.strip.style.setProperty('--basehalf-video-trim-end', `${(end * 100).toFixed(4)}%`);
		const whole = !timeline || timeline.isWhole(this.range);
		this.element.classList.toggle('whole', whole);
		this.element.classList.toggle('unavailable', !!this.unavailable);
		this.element.classList.toggle('loading', !timeline && !this.unavailable);
		this.length.textContent = timeline ? formatBaseHalfVideoTrimLength(this.range.end - this.range.start) : '';
		// A selection narrower than its length shows the length above the strip.
		const selectionWidth = (end - start) * this.strip.clientWidth;
		this.length.classList.toggle('outside', selectionWidth < this.length.offsetWidth + 8);
		for (const [handle, time] of [[this.startHandle, this.range.start], [this.endHandle, this.range.end]] as const) {
			handle.setAttribute('aria-valuemax', String(Math.round(duration * 100) / 100));
			handle.setAttribute('aria-valuenow', String(Math.round(time * 100) / 100));
			handle.setAttribute('aria-valuetext', localize('basehalf.videoTrim.handleValue', "{0} of {1}", formatBaseHalfVideoTrimLength(time), formatBaseHalfVideoTrimLength(duration)));
			handle.tabIndex = timeline && !this.unavailable ? 0 : -1;
		}
		// Trim stays focusable while it cannot trim: a disabled button would drop the keyboard out of Card Detail.
		const disabled = this.trimDisabledReason();
		this.trimButton.setAttribute('aria-disabled', String(!!disabled));
		this.trimButton.classList.toggle('disabled', !!disabled);
		this.trimButton.setAttribute('aria-label', disabled ?? localize('basehalf.videoTrim.trimLabel', "Trim"));
		this.updatePlayhead();
		this.renderStatus();
	}

	private renderStatus(): void {
		const running = this.trimService.runningTrim(this.video);
		const line = running
			? { text: localize('basehalf.videoTrim.trimming', "Trimming the video… {0}%", Math.round(running.done * 100)), error: false }
			: this.unavailable
				? { text: localize('basehalf.videoTrim.cannotTrim', "BaseHalf can't trim this video: {0}", this.unavailable), error: true }
				: this.failure
					? { text: this.failure, error: true }
					: { text: this.trimmedStatus() ?? '', error: false };
		this.status.textContent = line.text;
		this.status.classList.toggle('error', line.error);
	}

	// #endregion
}

function checkIcon(): SVGElement {
	const svg = $.SVG('svg');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('fill', 'currentColor');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('focusable', 'false');
	svg.classList.add('basehalf-video-trim-icon');
	const shape = $.SVG('path');
	shape.setAttribute('d', CHECK_PATH);
	svg.appendChild(shape);
	return svg;
}
