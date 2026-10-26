/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfVideoFrameViewer.css';
import './media/basehalfSoundWaveform.css';
import { $, addDisposableListener, append, getWindow } from '../../../../base/browser/dom.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IBaseHalfMediaChoices, IBaseHalfMediaPart } from '../common/basehalfEditRecord.js';
import { BASEHALF_SOUND_ENERGY_BLOCK, baseHalfSoundBarHeight, baseHalfSoundEnergy, baseHalfSoundReference } from '../common/basehalfSoundLoudness.js';
import {
	BASEHALF_SOUND_MIN_LENGTH,
	BaseHalfSoundTimeline,
	baseHalfDeleteParts,
	baseHalfPartEdges,
	baseHalfPartsAreWhole,
	baseHalfPartsLength,
	baseHalfTrimParts,
	IBaseHalfSoundRange
} from '../common/basehalfSoundParts.js';
import { formatBaseHalfVideoTrimLength } from '../common/basehalfVideoTrimSelection.js';
import { IBaseHalfMediaEditor, IBaseHalfMediaEditStatus } from './basehalfMediaEditor.js';
import { IBaseHalfSoundInfo } from './basehalfSoundEncoder.js';

/**
 * The waveform of a sound in Card Detail's edit mode (editing media,
 * "Editing a sound"): the sound as the choices make it, its kept parts
 * joined, with the yellow frame, the handles, the playhead, and the length of
 * the frame viewer of a video; Play, which plays it as it will be saved, the
 * stretch between the handles over and over while it is shorter than the
 * whole; and Trim and Delete, which keep that stretch or take it away. It
 * undoes its own changes.
 */

export interface IBaseHalfSoundWaveformOptions {
	/** The original of an edited sound, or the sound. */
	readonly source: URI;
	readonly info: IBaseHalfSoundInfo;
	readonly choices: IBaseHalfMediaChoices;
}

/** The bars of the waveform, in pixels of the view: their width, the room between them, and above and below them. */
const BAR_WIDTH = 3;
const BAR_GAP = 2;
const BAR_MARGIN = 10;
const DRAG_THRESHOLD = 3;
const HOLD_MILLISECONDS = 400;
const SPREAD_MIN_SECONDS = 2;
const SPREAD_FRACTION = 0.1;
const STEP_SECONDS = 0.1;
const LARGE_STEP_SECONDS = 1;
/** How long sound comes up after a joint and goes down before the end of what plays. */
const PLAY_FADE_SECONDS = 0.005;

type Handle = 'start' | 'end';
type DragKind = Handle | 'move' | 'press' | 'scrub';

interface IChoice {
	readonly parts: readonly IBaseHalfMediaPart[];
	readonly range: IBaseHalfSoundRange;
}

interface IDrag {
	readonly kind: DragKind;
	readonly pointerId: number;
	readonly startX: number;
	readonly before: IChoice;
	grab: number;
	moved: boolean;
	lastX: number;
}

interface IPlaying {
	readonly startedAt: number;
	readonly from: number;
	readonly until: number;
	readonly nodes: AudioBufferSourceNode[];
	readonly gain: GainNode;
}

export class BaseHalfSoundWaveform extends Disposable implements IBaseHalfMediaEditor {

	readonly element: HTMLElement;
	private readonly playButton: HTMLButtonElement;
	private readonly time: HTMLElement;
	private readonly trimButton: HTMLButtonElement;
	private readonly deleteButton: HTMLButtonElement;
	private readonly strip: HTMLElement;
	private readonly canvas: HTMLCanvasElement;
	private readonly length: HTMLElement;
	private readonly startHandle: HTMLElement;
	private readonly endHandle: HTMLElement;
	private readonly playhead: HTMLElement;
	private readonly status: HTMLElement;

	private readonly onDidChangeEmitter = this._register(new Emitter<void>());
	readonly onDidChange = this.onDidChangeEmitter.event;
	private readonly onDidRequestSaveEmitter = this._register(new Emitter<void>());
	readonly onDidRequestSave = this.onDidRequestSaveEmitter.event;

	private parts: readonly IBaseHalfMediaPart[];
	private range: IBaseHalfSoundRange;
	private view: { from: number; to: number };
	private readonly undoStack: IChoice[] = [];
	private readonly redoStack: IChoice[] = [];
	private drag: IDrag | undefined;
	private busy = false;
	private holdTimer: ReturnType<typeof setTimeout> | undefined;
	private frame: number | undefined;
	/** Where the playhead stands while nothing plays, in seconds of the edited sound. */
	private position = 0;
	private context: AudioContext | undefined;
	private buffer: AudioBuffer | undefined;
	/** The mean of the squares of each block of the original's samples, over its channels. */
	private energy: Float32Array | undefined;
	/** The loudness of the loudest stretch of the original, which the bars are set against. */
	private reference = 0;
	private playing: IPlaying | undefined;
	private failure: string | undefined;
	private disposed = false;

	constructor(
		container: HTMLElement,
		private readonly options: IBaseHalfSoundWaveformOptions,
		@IFileService private readonly fileService: IFileService
	) {
		super();
		const duration = options.info.duration;
		this.parts = options.choices.keep?.length ? options.choices.keep : [{ start: 0, end: duration }];
		this.range = this.timeline().whole();
		this.view = { from: 0, to: this.timeline().duration };

		// The look of the frame viewer of a video: its frame, handles, playhead, and length.
		this.element = append(container, $('.basehalf-video-frames.basehalf-sound-waveform'));
		this.element.setAttribute('role', 'group');
		this.element.setAttribute('aria-label', localize('basehalf.mediaEdit.sound.label', "Waveform"));
		const top = append(this.element, $('.basehalf-sound-waveform-top'));
		this.playButton = append(top, $<HTMLButtonElement>('button.basehalf-sound-waveform-play'));
		this.playButton.type = 'button';
		this.time = append(top, $('span.basehalf-sound-waveform-time'));
		append(top, $('span.basehalf-sound-waveform-gap'));
		this.trimButton = append(top, $<HTMLButtonElement>('button.basehalf-sound-waveform-action.trim'));
		this.trimButton.type = 'button';
		this.trimButton.textContent = localize('basehalf.mediaEdit.sound.trim', "Trim");
		this.deleteButton = append(top, $<HTMLButtonElement>('button.basehalf-sound-waveform-action.delete'));
		this.deleteButton.type = 'button';
		this.deleteButton.textContent = localize('basehalf.mediaEdit.sound.delete', "Delete");
		const row = append(this.element, $('.basehalf-video-frames-row'));
		this.strip = append(row, $('.basehalf-video-frames-strip.basehalf-sound-waveform-strip'));
		this.canvas = append(this.strip, $<HTMLCanvasElement>('canvas.basehalf-sound-waveform-canvas'));
		append(this.strip, $('.basehalf-video-frames-shade.before'));
		append(this.strip, $('.basehalf-video-frames-shade.after'));
		append(this.strip, $('.basehalf-video-frames-part'));
		this.length = append(this.strip, $('.basehalf-video-frames-length'));
		this.playhead = append(this.strip, $('.basehalf-video-frames-playhead'));
		this.startHandle = append(this.strip, $('.basehalf-video-frames-handle.start'));
		this.endHandle = append(this.strip, $('.basehalf-video-frames-handle.end'));
		for (const [handle, label] of [
			[this.startHandle, localize('basehalf.mediaEdit.sound.start', "Start")],
			[this.endHandle, localize('basehalf.mediaEdit.sound.end', "End")]
		] as const) {
			handle.setAttribute('role', 'slider');
			handle.setAttribute('aria-label', label);
			handle.setAttribute('aria-valuemin', '0');
			handle.tabIndex = 0;
			append(handle, chevron(handle === this.startHandle ? 'left' : 'right'));
		}
		this.status = append(this.element, $('.basehalf-video-frames-status'));
		this.status.setAttribute('aria-live', 'polite');
		this._register(toDisposable(() => {
			this.disposed = true;
			this.clearHold();
			this.stop();
			void this.context?.close().catch(() => undefined);
		}));
		this.registerListeners();
		this.render();
		void this.load();
	}

	get choices(): IBaseHalfMediaChoices {
		return baseHalfPartsAreWhole(this.parts, this.options.info.duration) ? {} : { keep: this.parts };
	}

	focus(): void {
		this.playButton.focus({ preventScroll: true });
	}

	undo(): boolean {
		return this.step(this.undoStack, this.redoStack);
	}

	redo(): boolean {
		return this.step(this.redoStack, this.undoStack);
	}

	private step(from: IChoice[], to: IChoice[]): boolean {
		if (this.busy || this.drag || !from.length) {
			return false;
		}
		to.push(this.current());
		this.restore(from.pop()!);
		this.onDidChangeEmitter.fire();
		return true;
	}

	setBusy(busy: boolean): void {
		this.busy = busy;
		if (busy) {
			this.cancelDrag();
			this.stop();
		}
		this.render();
	}

	setStatus(status: IBaseHalfMediaEditStatus | undefined): void {
		this.status.textContent = status?.text ?? this.failure ?? '';
		this.status.classList.toggle('error', !!status?.error || (!status && !!this.failure));
	}

	private timeline(parts = this.parts): BaseHalfSoundTimeline {
		return new BaseHalfSoundTimeline(baseHalfPartsLength(parts), this.options.info.step);
	}

	private current(): IChoice {
		return { parts: this.parts, range: this.range };
	}

	private restore(choice: IChoice): void {
		this.stop();
		this.parts = choice.parts;
		this.range = choice.range;
		this.position = Math.min(this.position, this.timeline().duration);
		this.view = { from: 0, to: this.timeline().duration };
		this.render();
		this.drawWaveform();
	}

	private remember(before: IChoice): void {
		if (JSON.stringify(before) === JSON.stringify(this.current())) {
			return;
		}
		this.undoStack.push(before);
		this.redoStack.length = 0;
		this.onDidChangeEmitter.fire();
	}

	// #region The sound

	private async load(): Promise<void> {
		try {
			const bytes = (await this.fileService.readFile(this.options.source)).value.buffer;
			if (this.disposed) {
				return;
			}
			const context = this.context = new AudioContext();
			const buffer = await context.decodeAudioData(bytes.slice().buffer);
			if (this.disposed) {
				return;
			}
			this.buffer = buffer;
			this.energy = baseHalfSoundEnergy(Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel)));
			this.reference = baseHalfSoundReference(this.energy, buffer.sampleRate);
			this.drawWaveform();
			// Play can play now.
			this.render();
		} catch {
			if (!this.disposed) {
				this.failure = localize('basehalf.mediaEdit.sound.decodePreview', "This system cannot decode the sound to play it here.");
				this.setStatus(undefined);
			}
		}
	}

	/** The sum of the squares of the original's samples between two of its times, as a mean over its channels, and how many samples that is. */
	private squares(from: number, to: number): { readonly sum: number; readonly samples: number } {
		const buffer = this.buffer;
		if (!buffer) {
			return { sum: 0, samples: 0 };
		}
		const first = Math.max(0, Math.floor(from * buffer.sampleRate));
		const last = Math.min(buffer.length, Math.max(first + 1, Math.ceil(to * buffer.sampleRate)));
		if (last - first >= BASEHALF_SOUND_ENERGY_BLOCK * 2 && this.energy) {
			let sum = 0;
			let samples = 0;
			for (let block = Math.floor(first / BASEHALF_SOUND_ENERGY_BLOCK); block < Math.ceil(last / BASEHALF_SOUND_ENERGY_BLOCK) && block < this.energy.length; block++) {
				const size = Math.min(BASEHALF_SOUND_ENERGY_BLOCK, buffer.length - block * BASEHALF_SOUND_ENERGY_BLOCK);
				sum += this.energy[block] * size;
				samples += size;
			}
			return { sum, samples };
		}
		let sum = 0;
		for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
			const data = buffer.getChannelData(channel);
			for (let index = first; index < last && index < data.length; index++) {
				sum += data[index] * data[index];
			}
		}
		return { sum: sum / buffer.numberOfChannels, samples: Math.max(0, last - first) };
	}

	/**
	 * Draws the sound as the choices make it, between the times the strip
	 * shows, as rounded bars as high as the loudness of their stretches, its
	 * joints marked (editing media, "The waveform").
	 */
	private drawWaveform(): void {
		const window = getWindow(this.element);
		const scale = window.devicePixelRatio || 1;
		const width = Math.max(1, Math.round(this.strip.clientWidth * scale));
		const height = Math.max(1, Math.round(this.strip.clientHeight * scale));
		if (this.canvas.width !== width || this.canvas.height !== height) {
			this.canvas.width = width;
			this.canvas.height = height;
		}
		const context = this.canvas.getContext('2d');
		if (!context) {
			return;
		}
		context.clearRect(0, 0, width, height);
		const style = window.getComputedStyle(this.element);
		context.fillStyle = style.getPropertyValue('--basehalf-sound-waveform-color').trim() || style.color;
		const { from, to } = this.view;
		const span = Math.max(1e-9, to - from);
		const bar = Math.max(1, Math.round(BAR_WIDTH * scale));
		const gap = Math.max(1, Math.round(BAR_GAP * scale));
		const step = bar + gap;
		const count = Math.max(1, Math.floor((width + gap) / step));
		const offset = Math.floor((width - (count * step - gap)) / 2);
		const room = Math.max(bar, height - 2 * Math.round(BAR_MARGIN * scale));
		context.beginPath();
		for (let index = 0; index < count; index++) {
			const x = offset + index * step;
			// Each bar holds the stretch from the middle of the gap before it to the middle of the gap after it.
			const start = from + Math.max(0, x - gap / 2) / width * span;
			const end = from + Math.min(width, x + bar + gap / 2) / width * span;
			// A bar may cross a joint: the parts under it give their samples together.
			let sum = 0;
			let samples = 0;
			for (const part of this.partsBetween(start, end)) {
				const squares = this.squares(part.start, part.end);
				sum += squares.sum;
				samples += squares.samples;
			}
			const level = baseHalfSoundBarHeight(samples ? Math.sqrt(sum / samples) : 0, this.reference);
			// Silence is a dot.
			const barHeight = Math.max(bar, Math.round(level * room));
			context.roundRect(x, Math.round((height - barHeight) / 2), bar, barHeight, bar / 2);
		}
		context.fill();
		// The joints of the parts kept.
		context.fillStyle = style.getPropertyValue('--basehalf-sound-waveform-joint').trim() || style.color;
		for (const edge of baseHalfPartEdges(this.parts).slice(1, -1)) {
			const x = Math.round((edge - from) / span * width);
			if (x >= 0 && x < width) {
				context.fillRect(x, 0, Math.max(1, Math.round(scale)), height);
			}
		}
	}

	/** The parts of the original that a stretch of the edited sound holds. */
	private partsBetween(from: number, to: number): IBaseHalfMediaPart[] {
		const out: IBaseHalfMediaPart[] = [];
		let at = 0;
		for (const part of this.parts) {
			const length = part.end - part.start;
			const start = Math.max(from, at);
			const end = Math.min(to, at + length);
			if (end > start) {
				out.push({ start: part.start + start - at, end: part.start + end - at });
			}
			at += length;
		}
		return out;
	}

	// #endregion

	// #region Playing

	private play(from: number): void {
		const context = this.context;
		const buffer = this.buffer;
		if (!context || !buffer) {
			return;
		}
		this.stop();
		void context.resume();
		const timeline = this.timeline();
		const loop = !timeline.isWhole(this.range);
		// Outside the stretch, or at its end, playing starts at its start.
		let start = from;
		if (loop && (start < this.range.start - 1e-6 || start >= this.range.end - 0.01)) {
			start = this.range.start;
		} else if (!loop && start >= timeline.duration - 0.01) {
			start = 0;
		}
		const until = loop ? this.range.end : timeline.duration;
		const gain = context.createGain();
		gain.connect(context.destination);
		const startedAt = context.currentTime + 0.03;
		const nodes: AudioBufferSourceNode[] = [];
		let at = 0;
		for (const part of this.parts) {
			const length = part.end - part.start;
			const segmentStart = Math.max(start, at);
			const segmentEnd = Math.min(until, at + length);
			if (segmentEnd - segmentStart > 1e-6) {
				const node = context.createBufferSource();
				node.buffer = buffer;
				const fade = context.createGain();
				node.connect(fade);
				fade.connect(gain);
				const when = startedAt + segmentStart - start;
				const duration = segmentEnd - segmentStart;
				// Each part comes up over 5 ms, and goes down over 5 ms before it ends: a joint never clicks.
				fade.gain.setValueAtTime(0, when);
				fade.gain.linearRampToValueAtTime(1, when + Math.min(PLAY_FADE_SECONDS, duration / 2));
				fade.gain.setValueAtTime(1, when + Math.max(0, duration - PLAY_FADE_SECONDS));
				fade.gain.linearRampToValueAtTime(0, when + duration);
				node.start(when, part.start + segmentStart - at, duration);
				nodes.push(node);
			}
			at += length;
		}
		const last = nodes[nodes.length - 1];
		if (!last) {
			return;
		}
		const playing: IPlaying = { startedAt, from: start, until, nodes, gain };
		this.playing = playing;
		last.onended = () => {
			if (this.playing !== playing) {
				return;
			}
			if (loop && !this.disposed) {
				this.play(this.range.start);
			} else {
				this.position = until;
				this.stop();
			}
		};
		this.followPlayhead();
		this.render();
	}

	/** Stops playing where it is: the playhead stays there. */
	private stop(): void {
		const playing = this.playing;
		if (!playing) {
			return;
		}
		this.position = this.playedTime();
		this.playing = undefined;
		const context = this.context;
		if (context) {
			// The sound goes down over a few milliseconds instead of stopping at once.
			playing.gain.gain.setTargetAtTime(0, context.currentTime, 0.004);
			for (const node of playing.nodes) {
				try {
					node.stop(context.currentTime + 0.03);
				} catch {
					// Ended already.
				}
			}
		}
		if (this.frame !== undefined) {
			getWindow(this.element).cancelAnimationFrame(this.frame);
			this.frame = undefined;
		}
		this.render();
	}

	/** The time of the edited sound that plays now, or where the playhead stands. */
	private playedTime(): number {
		const playing = this.playing;
		if (!playing || !this.context) {
			return this.position;
		}
		return Math.min(playing.until, Math.max(playing.from, playing.from + this.context.currentTime - playing.startedAt));
	}

	private followPlayhead(): void {
		const window = getWindow(this.element);
		const tick = () => {
			if (!this.playing || this.disposed) {
				this.frame = undefined;
				return;
			}
			this.updatePlayhead();
			this.frame = window.requestAnimationFrame(tick);
		};
		this.frame = window.requestAnimationFrame(tick);
	}

	private seek(time: number): void {
		const wasPlaying = !!this.playing;
		this.stop();
		this.position = Math.min(Math.max(time, 0), this.timeline().duration);
		if (wasPlaying) {
			this.play(this.position);
		}
		this.render();
	}

	private togglePlay(): void {
		if (this.playing) {
			this.stop();
		} else {
			this.play(this.position);
		}
	}

	// #endregion

	// #region The pointer and the keyboard

	private registerListeners(): void {
		for (const type of ['mousedown', 'click', 'dblclick'] as const) {
			this._register(addDisposableListener(this.element, type, event => event.stopPropagation()));
		}
		this._register(addDisposableListener(this.strip, 'pointerdown', event => this.onPointerDown(event)));
		this._register(addDisposableListener(this.strip, 'pointermove', event => this.onPointerMove(event)));
		for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
			this._register(addDisposableListener(this.strip, type, event => this.onPointerUp(event, type === 'pointerup')));
		}
		this._register(addDisposableListener(getWindow(this.element), 'keydown', event => {
			if (event.key === 'Escape' && this.drag) {
				event.preventDefault();
				event.stopPropagation();
				this.cancelDrag();
			}
		}, true));
		for (const [handle, which] of [[this.startHandle, 'start'], [this.endHandle, 'end']] as const) {
			this._register(addDisposableListener(handle, 'keydown', event => this.onHandleKey(event, which)));
		}
		this._register(addDisposableListener(this.playButton, 'click', () => {
			if (!this.busy) {
				this.togglePlay();
			}
		}));
		this._register(addDisposableListener(this.trimButton, 'click', () => this.trim()));
		this._register(addDisposableListener(this.deleteButton, 'click', () => this.remove()));
		this._register(addDisposableListener(this.element, 'keydown', event => {
			if (event.key === 'Enter' && !event.isComposing && (event.target === this.playButton || event.target === this.startHandle || event.target === this.endHandle)) {
				// Enter on a control of the editor saves; on Trim and Delete it presses them.
				event.preventDefault();
				event.stopPropagation();
				this.onDidRequestSaveEmitter.fire();
			}
		}));
		const ResizeObserverConstructor = getWindow(this.element).ResizeObserver;
		if (ResizeObserverConstructor) {
			const observer = new ResizeObserverConstructor(() => {
				this.render();
				this.drawWaveform();
			});
			observer.observe(this.strip);
			this._register(toDisposable(() => observer.disconnect()));
		}
	}

	private trimDisabled(): boolean {
		return this.busy || this.timeline().isWhole(this.range);
	}

	private deleteDisabled(): boolean {
		return this.busy || this.timeline().duration - (this.range.end - this.range.start) < BASEHALF_SOUND_MIN_LENGTH - 1e-9;
	}

	/** Trim: only the stretch between the handles is kept, and the handles hold all of it. */
	private trim(): void {
		if (this.trimDisabled()) {
			return;
		}
		const before = this.current();
		this.stop();
		this.parts = baseHalfTrimParts(this.parts, this.range.start, this.range.end);
		this.afterCut(before, 0);
	}

	/** Delete: the stretch between the handles goes, and what is on either side of it is joined. */
	private remove(): void {
		if (this.deleteDisabled()) {
			return;
		}
		const before = this.current();
		this.stop();
		const joint = this.range.start;
		this.parts = baseHalfDeleteParts(this.parts, this.range.start, this.range.end);
		this.afterCut(before, joint);
	}

	private afterCut(before: IChoice, position: number): void {
		this.range = this.timeline().whole();
		this.view = { from: 0, to: this.range.end };
		this.position = Math.min(position, this.range.end);
		this.render();
		this.drawWaveform();
		this.remember(before);
	}

	private timeAt(clientX: number): number {
		const bounds = this.strip.getBoundingClientRect();
		const fraction = bounds.width > 0 ? Math.min(Math.max((clientX - bounds.left) / bounds.width, 0), 1) : 0;
		return this.view.from + fraction * (this.view.to - this.view.from);
	}

	private handleAt(event: PointerEvent): Handle | undefined {
		const start = this.startHandle.getBoundingClientRect();
		const end = this.endHandle.getBoundingClientRect();
		const inStart = !this.startHandle.classList.contains('outside') && event.clientX >= start.left && event.clientX <= start.right;
		const inEnd = !this.endHandle.classList.contains('outside') && event.clientX >= end.left && event.clientX <= end.right;
		if (inStart && inEnd) {
			return event.clientX < (start.right + end.left) / 2 ? 'start' : 'end';
		}
		return inStart ? 'start' : inEnd ? 'end' : undefined;
	}

	private onPointerDown(event: PointerEvent): void {
		if (event.button !== 0) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		if (this.busy) {
			return;
		}
		const time = this.timeAt(event.clientX);
		const handle = this.handleAt(event);
		let kind: DragKind;
		let grab = 0;
		if (handle) {
			kind = handle;
			grab = time - (handle === 'start' ? this.range.start : this.range.end);
			this.stop();
			this.scheduleHold();
		} else if (time > this.range.start && time < this.range.end && !this.timeline().isWhole(this.range)) {
			kind = 'press';
			grab = time - this.range.start;
		} else {
			kind = 'scrub';
			this.seek(time);
		}
		this.drag = { kind, pointerId: event.pointerId, startX: event.clientX, before: this.current(), grab, moved: false, lastX: event.clientX };
		try {
			this.strip.setPointerCapture(event.pointerId);
		} catch {
			// A pointer that is no longer active cannot be captured; the press still counts.
		}
		this.element.classList.toggle('dragging', kind !== 'scrub' && kind !== 'press');
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
				this.stop();
				this.element.classList.add('dragging');
			}
		}
		const current = this.drag!;
		if (event.clientX !== current.lastX) {
			current.lastX = event.clientX;
			if (current.kind === 'start' || current.kind === 'end') {
				this.scheduleHold();
			}
		}
		const time = this.timeAt(event.clientX);
		const timeline = this.timeline();
		switch (current.kind) {
			case 'start':
			case 'end':
				this.range = timeline.moveHandle(this.range, current.kind, time - current.grab);
				// The playhead shows the handle's time.
				this.position = current.kind === 'start' ? this.range.start : this.range.end;
				break;
			case 'move':
				this.range = timeline.moveSelection(current.before.range, time - current.grab - current.before.range.start);
				this.position = this.range.start;
				break;
			case 'scrub':
				this.seek(time);
				break;
		}
		this.render();
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
			this.seek(this.timeAt(event.clientX));
		}
		this.unspread();
		this.render();
		this.remember(drag.before);
	}

	private cancelDrag(): void {
		const drag = this.drag;
		if (!drag) {
			return;
		}
		this.drag = undefined;
		this.clearHold();
		this.element.classList.remove('dragging');
		try {
			this.strip.releasePointerCapture(drag.pointerId);
		} catch {
			// Released already.
		}
		this.range = drag.before.range;
		this.unspread();
		this.render();
	}

	private scheduleHold(): void {
		this.clearHold();
		const duration = this.timeline().duration;
		if (this.view.from > 0 || this.view.to < duration) {
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

	/** Spreads the waveform out around the held handle, with the handle where it stands on the screen. */
	private spread(): void {
		const drag = this.drag;
		if (!drag || (drag.kind !== 'start' && drag.kind !== 'end') || this.disposed) {
			return;
		}
		const duration = this.timeline().duration;
		const span = Math.max(duration * SPREAD_FRACTION, SPREAD_MIN_SECONDS);
		if (span >= duration) {
			return;
		}
		const time = drag.kind === 'start' ? this.range.start : this.range.end;
		const bounds = this.strip.getBoundingClientRect();
		const fraction = bounds.width > 0 ? Math.min(Math.max((drag.lastX - bounds.left) / bounds.width, 0), 1) : 0.5;
		const from = Math.min(Math.max(time - fraction * span, 0), duration - span);
		this.view = { from, to: from + span };
		drag.grab = this.timeAt(drag.lastX) - time;
		this.element.classList.add('spread');
		this.drawWaveform();
		this.render();
	}

	private unspread(): void {
		if (!this.element.classList.contains('spread')) {
			return;
		}
		this.view = { from: 0, to: this.timeline().duration };
		this.element.classList.remove('spread');
		this.drawWaveform();
	}

	private onHandleKey(event: KeyboardEvent, handle: Handle): void {
		if (event.isComposing) {
			return;
		}
		const timeline = this.timeline();
		const large = isMacintosh ? event.metaKey : event.ctrlKey;
		const step = event.shiftKey ? 'frame' : large ? LARGE_STEP_SECONDS : STEP_SECONDS;
		let next: IBaseHalfSoundRange | undefined;
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
				this.togglePlay();
				return;
			case 'Delete':
			case 'Backspace':
				// Delete on a handle takes the stretch between the handles away, as Delete does.
				event.preventDefault();
				event.stopPropagation();
				this.remove();
				return;
		}
		if (next) {
			event.preventDefault();
			event.stopPropagation();
			if (this.busy) {
				return;
			}
			const before = this.current();
			this.stop();
			this.range = next;
			this.position = handle === 'start' ? next.start : next.end;
			this.render();
			this.remember(before);
		}
	}

	// #endregion

	// #region Drawing

	private fractionOf(time: number): number {
		const span = this.view.to - this.view.from;
		return span > 0 ? (time - this.view.from) / span : 0;
	}

	private updatePlayhead(): void {
		const time = this.playedTime();
		const fraction = this.fractionOf(time);
		this.playhead.classList.toggle('outside', fraction < 0 || fraction > 1);
		this.playhead.style.left = `${(Math.min(Math.max(fraction, 0), 1) * 100).toFixed(3)}%`;
		this.time.textContent = localize('basehalf.mediaEdit.sound.time', "{0} / {1}", formatBaseHalfVideoTrimLength(time), formatBaseHalfVideoTrimLength(this.timeline().duration));
	}

	private render(): void {
		const timeline = this.timeline();
		const duration = timeline.duration;
		const start = this.fractionOf(this.range.start);
		const end = this.fractionOf(this.range.end);
		const clamp = (value: number) => Math.min(Math.max(value, 0), 1);
		this.strip.style.setProperty('--basehalf-video-frames-start', `${(clamp(start) * 100).toFixed(4)}%`);
		this.strip.style.setProperty('--basehalf-video-frames-end', `${(clamp(end) * 100).toFixed(4)}%`);
		this.startHandle.classList.toggle('outside', start < 0);
		this.endHandle.classList.toggle('outside', end > 1);
		this.element.classList.toggle('whole', timeline.isWhole(this.range));
		this.element.classList.toggle('busy', this.busy);
		this.length.textContent = formatBaseHalfVideoTrimLength(this.range.end - this.range.start);
		const partWidth = (clamp(end) - clamp(start)) * this.strip.clientWidth;
		this.length.classList.toggle('outside', partWidth < this.length.offsetWidth + 8);
		for (const [handle, time] of [[this.startHandle, this.range.start], [this.endHandle, this.range.end]] as const) {
			handle.setAttribute('aria-valuemax', String(Math.round(duration * 100) / 100));
			handle.setAttribute('aria-valuenow', String(Math.round(time * 100) / 100));
			handle.setAttribute('aria-valuetext', localize('basehalf.mediaEdit.sound.handleValue', "{0} of {1}", formatBaseHalfVideoTrimLength(time), formatBaseHalfVideoTrimLength(duration)));
			handle.setAttribute('aria-disabled', String(this.busy));
		}
		const playing = !!this.playing;
		this.playButton.classList.toggle('playing', playing);
		this.playButton.setAttribute('aria-label', playing ? localize('basehalf.mediaEdit.sound.pause', "Pause") : localize('basehalf.mediaEdit.sound.play', "Play"));
		this.playButton.setAttribute('aria-disabled', String(this.busy || !this.buffer));
		for (const [button, disabled] of [[this.trimButton, this.trimDisabled()], [this.deleteButton, this.deleteDisabled()]] as const) {
			button.classList.toggle('disabled', disabled);
			button.setAttribute('aria-disabled', String(disabled));
		}
		this.updatePlayhead();
	}

	// #endregion
}

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
