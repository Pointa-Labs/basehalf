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
import { IBaseHalfMediaChoices, IBaseHalfMediaPart, normalizeBaseHalfMediaChoices } from '../common/basehalfEditRecord.js';
import { BASEHALF_SOUND_ENERGY_BLOCK, baseHalfSoundBarHeight, baseHalfSoundEnergy, baseHalfSoundReference } from '../common/basehalfSoundLoudness.js';
import {
	BASEHALF_SOUND_MIN_LENGTH,
	BaseHalfSoundTimeline,
	baseHalfDeleteParts,
	baseHalfPartEdges,
	baseHalfPartsLength,
	baseHalfSoundKept,
	baseHalfSoundShown,
	IBaseHalfSoundRange
} from '../common/basehalfSoundParts.js';
import { BASEHALF_TIME_ZOOM_SHORTEST_SECONDS } from '../common/basehalfMediaZoom.js';
import { formatBaseHalfVideoTrimLength } from '../common/basehalfVideoTrimSelection.js';
import { BaseHalfMediaChange, IBaseHalfMediaEditor } from './basehalfMediaEditor.js';
import { IBaseHalfSoundInfo } from './basehalfSoundEncoder.js';
import { BaseHalfTimeZoom } from './basehalfTimeZoom.js';

/**
 * The waveform of a sound in Card Detail (editing media, "Editing a sound"):
 * the sound as the choices make it, its kept parts joined, with the yellow
 * frame, the handles, the playhead, and the length of the frame viewer of a
 * video, whose handles trim it when they are let go; a stretch selected by a
 * drag inside the part, with Delete on it, which cuts it out; and Play under
 * it, which plays the sound as it is edited, the part between the handles
 * over and over while it is shorter than the whole. A pinch spreads its time
 * out ("Zooming the picture and the time"). While viewing ("Viewing and
 * editing"), it shows the sound as the file holds it, from the first handle
 * to the second, with the playhead, which a press moves, and Play plays it
 * through once.
 */

export interface IBaseHalfSoundWaveformOptions {
	/** The copy of the original of an edited sound, or of the sound, that the editor reads. */
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
type DragKind = Handle | 'press' | 'select' | 'scrub';

interface IDrag {
	readonly kind: DragKind;
	readonly pointerId: number;
	readonly startX: number;
	/** The stretch between the handles when the drag started, which Escape puts back. */
	readonly before: IBaseHalfSoundRange;
	/** The selected stretch when the drag started. */
	readonly selected: IBaseHalfSoundRange | undefined;
	/** For a handle, the time under the pointer less the handle's; for a selection, the time where it was pressed. */
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
	private readonly strip: HTMLElement;
	private readonly canvas: HTMLCanvasElement;
	private readonly selection: HTMLElement;
	private readonly deleteButton: HTMLButtonElement;
	private readonly length: HTMLElement;
	private readonly startHandle: HTMLElement;
	private readonly endHandle: HTMLElement;
	private readonly playhead: HTMLElement;
	private readonly failureLine: HTMLElement;

	private readonly onDidChangeEmitter = this._register(new Emitter<BaseHalfMediaChange>());
	readonly onDidChange = this.onDidChangeEmitter.event;

	/** The parts the waveform shows, joined: those the file holds, and the trims at either end outside the handles. */
	private parts: readonly IBaseHalfMediaPart[];
	/** The stretch between the handles, in seconds of the parts joined: what the file holds. */
	private range: IBaseHalfSoundRange;
	/** The stretch selected for Delete. */
	private selected: IBaseHalfSoundRange | undefined;
	/** The times the strip shows: the whole sound, the stretch a pinch spread out, or a stretch around a held handle. */
	private view: { from: number; to: number };
	private readonly zoom: BaseHalfTimeZoom;
	private drag: IDrag | undefined;
	private holdTimer: ReturnType<typeof setTimeout> | undefined;
	private frame: number | undefined;
	/** Where the playhead stands while nothing plays, in seconds of the parts joined. */
	private position = 0;
	private context: AudioContext | undefined;
	private buffer: AudioBuffer | undefined;
	/** The mean of the squares of each block of the original's samples, over its channels. */
	private energy: Float32Array | undefined;
	/** The loudness of the loudest stretch of the original, which the bars are set against. */
	private reference = 0;
	private playing: IPlaying | undefined;
	/** The waveform edits the sound; otherwise it views the file as it is. */
	private editing = false;
	private disposed = false;

	constructor(
		container: HTMLElement,
		private readonly options: IBaseHalfSoundWaveformOptions,
		@IFileService private readonly fileService: IFileService
	) {
		super();
		const shown = baseHalfSoundShown(options.choices.keep, options.info.duration);
		this.parts = shown.parts;
		this.range = this.timeline().normalize(shown.range);
		// It starts by viewing the file: the stretch between the handles.
		this.view = { from: this.range.start, to: this.range.end };
		this.position = this.range.start;

		// The look of the frame viewer of a video: its frame, handles, playhead, and length.
		this.element = append(container, $('.basehalf-video-frames.basehalf-sound-waveform.viewing'));
		this.element.setAttribute('role', 'group');
		this.element.setAttribute('aria-label', localize('basehalf.mediaEdit.sound.label', "Waveform"));
		const row = append(this.element, $('.basehalf-video-frames-row'));
		this.strip = append(row, $('.basehalf-video-frames-strip.basehalf-sound-waveform-strip'));
		this.canvas = append(this.strip, $<HTMLCanvasElement>('canvas.basehalf-sound-waveform-canvas'));
		append(this.strip, $('.basehalf-video-frames-shade.before'));
		append(this.strip, $('.basehalf-video-frames-shade.after'));
		this.selection = append(this.strip, $('.basehalf-sound-waveform-selection'));
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
			append(handle, chevron(handle === this.startHandle ? 'left' : 'right'));
		}
		this.showHandles();
		// Delete stands on the selected stretch, while there is one.
		this.deleteButton = append(this.strip, $<HTMLButtonElement>('button.basehalf-sound-waveform-delete'));
		this.deleteButton.type = 'button';
		this.deleteButton.textContent = localize('basehalf.mediaEdit.sound.delete', "Delete");
		const bottom = append(this.element, $('.basehalf-sound-waveform-bottom'));
		this.playButton = append(bottom, $<HTMLButtonElement>('button.basehalf-sound-waveform-play'));
		this.playButton.type = 'button';
		this.time = append(bottom, $('span.basehalf-sound-waveform-time'));
		this.failureLine = append(bottom, $('span.basehalf-sound-waveform-failure'));
		this._register(toDisposable(() => {
			this.disposed = true;
			this.clearHold();
			this.stop();
			void this.context?.close().catch(() => undefined);
		}));
		this.zoom = this._register(new BaseHalfTimeZoom({
			strip: this.strip,
			// While viewing, the waveform shows the file's length, and a pinch over it does nothing.
			active: () => this.editing,
			length: () => this.timeline().duration,
			shortest: () => BASEHALF_TIME_ZOOM_SHORTEST_SECONDS,
			onDidChange: () => this.onDidZoom(),
			onDidMoveUnderDrag: clientX => this.dragTo(clientX)
		}));
		this.registerListeners();
		this.render();
		void this.load();
	}

	get choices(): IBaseHalfMediaChoices {
		const keep = baseHalfSoundKept(this.parts, this.range, this.options.info.duration);
		return keep ? { keep } : {};
	}

	focus(): void {
		this.playButton.focus({ preventScroll: true });
	}

	setChoices(choices: IBaseHalfMediaChoices): void {
		if (JSON.stringify(normalizeBaseHalfMediaChoices(choices)) === JSON.stringify(normalizeBaseHalfMediaChoices(this.choices))) {
			return;
		}
		const shown = baseHalfSoundShown(choices.keep, this.options.info.duration);
		this.endDrag();
		this.stop();
		this.parts = shown.parts;
		this.range = this.timeline().normalize(shown.range);
		this.selected = undefined;
		this.position = Math.min(this.position, this.timeline().duration);
		// An undo or a redo keeps the stretch a pinch spread out, as far as the length then allows.
		this.zoom.fit();
		this.view = this.restingView();
		this.render();
		this.drawWaveform();
	}

	setEditing(editing: boolean): void {
		if (editing === this.editing) {
			return;
		}
		this.endDrag();
		this.selected = undefined;
		this.editing = editing;
		this.element.classList.toggle('viewing', !editing);
		if (!editing) {
			// Done shows the file's length again; the next Edit starts from the whole sound.
			this.zoom.reset();
		}
		this.showHandles();
		this.view = this.restingView();
		this.render();
		this.drawWaveform();
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

	/** What the strip shows when no handle is held: the stretch between the handles while viewing, the file as it is; while editing, the stretch a pinch spread out, or the whole. */
	private restingView(): { from: number; to: number } {
		return this.editing ? this.zoom.stretch : { from: this.range.start, to: this.range.end };
	}

	private timeline(parts = this.parts): BaseHalfSoundTimeline {
		return new BaseHalfSoundTimeline(baseHalfPartsLength(parts), this.options.info.step);
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
				this.failureLine.textContent = localize('basehalf.mediaEdit.sound.decodePreview', "This system cannot decode the sound to play it here.");
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

	/** The parts of the original that a stretch of the parts joined holds. */
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

	/** Plays the stretch between the handles, from a time in it; over and over while it is shorter than the whole. */
	private play(from: number): void {
		const context = this.context;
		const buffer = this.buffer;
		if (!context || !buffer) {
			return;
		}
		this.stop();
		void context.resume();
		const timeline = this.timeline();
		// While viewing, the file plays through once.
		const loop = this.editing && !timeline.isWhole(this.range);
		// Outside the stretch, or at its end, playing starts at its start.
		let start = from;
		if (start < this.range.start - 1e-6 || start >= this.range.end - 0.01) {
			start = this.range.start;
		}
		const until = this.range.end;
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

	/** The time of the parts joined that plays now, or where the playhead stands. */
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

	// #region Changes

	/** A stretch between the handles that differs from the one before is a trim. */
	private trimmed(before: IBaseHalfSoundRange): void {
		if (before.start !== this.range.start || before.end !== this.range.end) {
			this.onDidChangeEmitter.fire('trim');
		}
	}

	/** Whether what is left after the selected stretch is cut out is long enough to be a sound. */
	private canCut(): boolean {
		return !!this.selected && (this.range.end - this.range.start) - (this.selected.end - this.selected.start) >= BASEHALF_SOUND_MIN_LENGTH - 1e-9;
	}

	/** Delete: the selected stretch goes, what is on either side of it is joined, and the handles keep what they held of the rest. */
	private cut(): void {
		const selected = this.selected;
		if (!selected || !this.canCut()) {
			return;
		}
		// Delete goes with the stretch: the keyboard that was on it goes to Play.
		if (this.deleteButton.ownerDocument.activeElement === this.deleteButton) {
			this.playButton.focus({ preventScroll: true });
		}
		this.stop();
		const length = selected.end - selected.start;
		this.parts = baseHalfDeleteParts(this.parts, selected.start, selected.end);
		this.range = this.timeline().normalize({ start: this.range.start, end: this.range.end - length });
		this.selected = undefined;
		// A cut keeps the stretch a pinch spread out, as far as the length then allows.
		this.zoom.fit();
		this.view = this.zoom.stretch;
		this.position = Math.min(selected.start, this.range.end);
		this.render();
		this.drawWaveform();
		this.onDidChangeEmitter.fire('cut');
	}

	private dropSelection(): void {
		if (this.selected) {
			this.selected = undefined;
			this.render();
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
			// Escape ends a drag and puts back what it changed, or drops the selection; Card Detail stays (editing media, "The keyboard").
			if (event.key !== 'Escape' || event.isComposing || (!this.drag && !this.selected)) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			if (this.drag) {
				this.cancelDrag();
			} else {
				this.dropSelection();
			}
		}, true));
		for (const [handle, which] of [[this.startHandle, 'start'], [this.endHandle, 'end']] as const) {
			this._register(addDisposableListener(handle, 'keydown', event => this.onHandleKey(event, which)));
		}
		this._register(addDisposableListener(this.element, 'keydown', event => {
			if ((event.key === 'Delete' || event.key === 'Backspace') && !event.isComposing && this.selected) {
				// Delete or Backspace cuts the selected stretch out, as Delete does.
				event.preventDefault();
				event.stopPropagation();
				this.cut();
			}
		}));
		this._register(addDisposableListener(this.playButton, 'click', () => this.togglePlay()));
		this._register(addDisposableListener(this.deleteButton, 'pointerdown', event => event.stopPropagation()));
		this._register(addDisposableListener(this.deleteButton, 'click', () => this.cut()));
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
		const time = this.timeAt(event.clientX);
		const handle = this.editing ? this.handleAt(event) : undefined;
		let kind: DragKind;
		let grab = 0;
		if (!this.editing) {
			// While viewing, a press anywhere moves the playhead, and a drag from there moves it along.
			kind = 'scrub';
			this.seek(time);
		} else if (handle) {
			kind = handle;
			grab = time - (handle === 'start' ? this.range.start : this.range.end);
			this.stop();
			this.scheduleHold();
		} else if (time > this.range.start && time < this.range.end) {
			// Inside the part a press moves the playhead and a drag selects a stretch.
			kind = 'press';
			grab = this.timeline().snap(time);
		} else {
			kind = 'scrub';
			this.dropSelection();
			this.seek(time);
		}
		this.drag = { kind, pointerId: event.pointerId, startX: event.clientX, before: this.range, selected: this.selected, grab, moved: false, lastX: event.clientX };
		try {
			this.strip.setPointerCapture(event.pointerId);
		} catch {
			// A pointer that is no longer active cannot be captured; the press still counts.
		}
		this.element.classList.toggle('dragging', kind === 'start' || kind === 'end');
	}

	private onPointerMove(event: PointerEvent): void {
		const drag = this.drag;
		if (!drag || drag.pointerId !== event.pointerId) {
			return;
		}
		if (!drag.moved && Math.abs(event.clientX - drag.startX) >= DRAG_THRESHOLD) {
			drag.moved = true;
			if (drag.kind === 'press') {
				this.drag = { ...drag, kind: 'select' };
				this.stop();
			}
		}
		const current = this.drag!;
		if (event.clientX !== current.lastX) {
			current.lastX = event.clientX;
			if (current.kind === 'start' || current.kind === 'end') {
				this.scheduleHold();
			}
		}
		// Past an edge of the stretch a pinch spread out, the drag carries the stretch along.
		this.zoom.dragAt(!this.editing || current.kind === 'press' || this.element.classList.contains('spread') ? undefined : event.clientX);
		this.dragTo(event.clientX);
	}

	/** What the drag holds goes to the time under the pointer. */
	private dragTo(clientX: number): void {
		const current = this.drag;
		if (!current) {
			return;
		}
		const time = this.timeAt(clientX);
		const timeline = this.timeline();
		switch (current.kind) {
			case 'start':
			case 'end':
				this.range = timeline.moveHandle(this.range, current.kind, time - current.grab);
				// The playhead shows the handle's time.
				this.position = current.kind === 'start' ? this.range.start : this.range.end;
				break;
			case 'select': {
				// The stretch runs from where it was pressed to the pointer, inside the part.
				const at = Math.min(Math.max(timeline.snap(time), this.range.start), this.range.end);
				this.selected = { start: Math.min(current.grab, at), end: Math.max(current.grab, at) };
				this.position = this.selected.start;
				break;
			}
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
		this.zoom.dragAt(undefined);
		this.element.classList.remove('dragging');
		if (drag.kind === 'press' && released) {
			// A press that did not move drops the selection and moves the playhead there.
			this.selected = undefined;
			this.seek(this.timeAt(event.clientX));
		}
		if (drag.kind === 'select' && this.selected && this.selected.end - this.selected.start < BASEHALF_SOUND_MIN_LENGTH - 1e-9) {
			// A stretch is at least 0.1 s.
			this.selected = undefined;
		}
		this.unspread();
		this.render();
		if (drag.kind === 'start' || drag.kind === 'end') {
			this.trimmed(drag.before);
		}
	}

	/** Escape during a drag: what it changed goes back. */
	private cancelDrag(): void {
		const drag = this.endDrag();
		if (drag) {
			this.range = drag.before;
			this.selected = drag.selected;
			this.render();
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

	/** Spreads the waveform out around the held handle, with the handle where it stands on the screen; not when a pinch spread it as far already. */
	private spread(): void {
		const drag = this.drag;
		if (!drag || (drag.kind !== 'start' && drag.kind !== 'end') || this.disposed) {
			return;
		}
		const duration = this.timeline().duration;
		const span = Math.max(duration * SPREAD_FRACTION, SPREAD_MIN_SECONDS);
		if (span >= this.view.to - this.view.from) {
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
		// The stretch a pinch chose shows again, or the whole sound.
		this.view = this.restingView();
		this.element.classList.remove('spread');
		this.drawWaveform();
	}

	/** A pinch, the wheel, or a drag past an edge changed the stretch shown: the waveform is drawn anew. A held handle's spread stays until it is let go. */
	private onDidZoom(): void {
		if (!this.editing || this.element.classList.contains('spread')) {
			return;
		}
		this.view = this.zoom.stretch;
		this.render();
		this.drawWaveform();
	}

	private onHandleKey(event: KeyboardEvent, handle: Handle): void {
		if (event.isComposing || !this.editing) {
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
		}
		if (next) {
			// The arrow keys move no card; a key that repeats is one step of undo.
			event.preventDefault();
			event.stopPropagation();
			const before = this.range;
			this.stop();
			this.range = next;
			this.selected = undefined;
			this.position = handle === 'start' ? next.start : next.end;
			this.render();
			this.trimmed(before);
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
		if (this.editing && this.playing && !this.drag && !this.element.classList.contains('spread')) {
			// While the sound plays, the stretch a pinch spread out follows the playhead.
			this.zoom.follow(time);
		}
		const fraction = this.fractionOf(time);
		this.playhead.classList.toggle('outside', fraction < 0 || fraction > 1);
		this.playhead.style.left = `${(Math.min(Math.max(fraction, 0), 1) * 100).toFixed(3)}%`;
		// While viewing, the time counts from the first handle, to the file's length.
		const shown = this.editing
			? { time, length: this.timeline().duration }
			: { time: Math.min(Math.max(time - this.range.start, 0), this.range.end - this.range.start), length: this.range.end - this.range.start };
		this.time.textContent = localize('basehalf.mediaEdit.sound.time', "{0} / {1}", formatBaseHalfVideoTrimLength(shown.time), formatBaseHalfVideoTrimLength(shown.length));
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
		// The times the strip shows, in seconds of the parts joined, as its bars and its handles stand.
		this.strip.dataset.from = this.view.from.toFixed(3);
		this.strip.dataset.to = this.view.to.toFixed(3);
		this.element.classList.toggle('whole', timeline.isWhole(this.range));
		this.length.textContent = formatBaseHalfVideoTrimLength(this.range.end - this.range.start);
		const partWidth = (clamp(end) - clamp(start)) * this.strip.clientWidth;
		this.length.classList.toggle('outside', partWidth < this.length.offsetWidth + 8);
		for (const [handle, time] of [[this.startHandle, this.range.start], [this.endHandle, this.range.end]] as const) {
			handle.setAttribute('aria-valuemax', String(Math.round(duration * 100) / 100));
			handle.setAttribute('aria-valuenow', String(Math.round(time * 100) / 100));
			handle.setAttribute('aria-valuetext', localize('basehalf.mediaEdit.sound.handleValue', "{0} of {1}", formatBaseHalfVideoTrimLength(time), formatBaseHalfVideoTrimLength(duration)));
		}
		const selected = this.selected;
		this.element.classList.toggle('selecting', !!selected);
		this.selection.hidden = !selected;
		this.deleteButton.hidden = !selected || !this.canCut() || !!this.drag;
		if (selected) {
			const from = clamp(this.fractionOf(selected.start));
			const to = clamp(this.fractionOf(selected.end));
			this.selection.style.left = `${(from * 100).toFixed(4)}%`;
			this.selection.style.width = `${((to - from) * 100).toFixed(4)}%`;
			this.deleteButton.style.left = `${((from + to) / 2 * 100).toFixed(4)}%`;
			this.deleteButton.setAttribute('aria-label', localize('basehalf.mediaEdit.sound.deleteLabel', "Delete {0}", formatBaseHalfVideoTrimLength(selected.end - selected.start)));
		}
		const playing = !!this.playing;
		this.playButton.classList.toggle('playing', playing);
		this.playButton.setAttribute('aria-label', playing ? localize('basehalf.mediaEdit.sound.pause', "Pause") : localize('basehalf.mediaEdit.sound.play', "Play"));
		this.playButton.setAttribute('aria-disabled', String(!this.buffer));
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
