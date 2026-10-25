/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfCanvasCardVideoPlayer.css';
import { $, addDisposableListener, append, clearNode, getActiveElement, isHTMLElement } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { FileAccess } from '../../../../base/common/network.js';
import { isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { renderBaseHalfItemGlyph } from '../../shell/browser/basehalfItemGlyph.js';
import { registerBaseHalfCanvasMediaPause, releaseBaseHalfCanvasCardMedia } from './basehalfCanvasCardMedia.js';
import { BaseHalfCanvasVideoSound, BaseHalfVideoSoundGraph } from './basehalfCanvasVideoSound.js';

/** The narrowest picture, in screen pixels, that shows the player's controls (video node, "The player"). */
export const BASEHALF_CANVAS_VIDEO_CONTROLS_MIN_WIDTH = 160;

/** How far Left and Right move the position slider, in seconds. */
const SLIDER_STEP_SECONDS = 1;

/** Two times of a part that plays closer than this are the same, in seconds. */
const RANGE_EPSILON = 0.0005;
/**
 * A jump to a part's start goes this far into its first frame, in seconds: a
 * time a hair before a frame's own time shows the frame before it.
 */
const RANGE_START_INSIDE = 0.0002;
/**
 * How much of the length of a part's last frame passes before the part starts
 * again: a timer can be late, and a jump at its time would show the frame
 * after the part.
 */
const RANGE_JUMP_AFTER = 0.5;

export interface IBaseHalfCanvasCardVideoPlayerOptions {
	/** The video file, or the sound file. */
	readonly source: URI;
	/** The classes of the video element, for the card that shows it. */
	readonly videoClasses: readonly string[];
	/** Opens the card, as a double click on it does: the player's Open. */
	readonly open: () => void;
	/** The video cannot be played: the card shows why instead. */
	readonly onError: () => void;
	/** Draws the tooltips of the controls. */
	readonly hoverService?: IHoverService;
	/**
	 * The player of Card Detail, not of a card (generation cards, "The
	 * player"): its controls always show, a click on the picture plays and
	 * pauses it, the pointer plays nothing, its sound is on, Full Screen stands
	 * where Open is, and it starts at the frame its card shows.
	 */
	readonly detail?: boolean;
	/**
	 * A sound file, not a video (generation cards, "The player"): there is
	 * nothing to see, so the glyph of a sound stands where a video shows its
	 * frame, and there is no sound button. The pointer plays nothing, Play
	 * plays it with its sound, and on a card it pauses when its card is
	 * neither selected nor under the pointer. In Card Detail it has no Full
	 * Screen.
	 */
	readonly sound?: boolean;
	/** Where it starts, in seconds, as for a file that was replaced; by default where its card or its last player stood. */
	readonly start?: number;
	/** The audio graph the sound plays through, for a test; the window's by default. */
	readonly soundGraph?: () => BaseHalfVideoSoundGraph | undefined;
}

/** A part of a video that the player plays over and over (trimming a video, "Playing"), in seconds. */
export interface IBaseHalfCanvasVideoPlayRange {
	readonly start: number;
	readonly end: number;
	/** Where the part's last frame starts: once it has been shown for its length, the part starts again. */
	readonly lastFrame: number;
}

/** A video on a card (video node, "The player"). Dispose it with the card's body. */
export interface IBaseHalfCanvasCardVideoPlayer extends IDisposable {
	readonly element: HTMLElement;
	readonly video: HTMLVideoElement;
	/** The time the picture shows, in seconds: what Capture Frame takes as the current frame. */
	readonly currentTime: number | undefined;
	/** The card is the only selected card: its controls show while it is. */
	setSelected(selected: boolean): void;
	/** Pauses the video, once its sound has gone down. */
	pause(): void;
	/** Plays or pauses the video, as Play does. */
	togglePlay(): void;
	/** Shows the frame at a time, in seconds. */
	seek(time: number): void;
	/** Plays only a part of the video, over and over, or the whole video again. */
	setPlayRange(range: IBaseHalfCanvasVideoPlayRange | undefined): void;
	/** Turns the sound off or on, as its sound button does: for an edit that saves a video without its sound (editing media). */
	setMuted(muted: boolean): void;
	/** Puts the keyboard on the play button, as Card Detail does when it opens. */
	focus(): void;
}

/**
 * Draws a video into `container`, before `before`, the way canvas products for
 * media work play the video of a node: the picture is the card's, so a click
 * selects the card, a drag moves it, and a double click opens it; the pointer
 * on the card plays the video without sound and pauses it when it leaves; and
 * controls drawn here, not the system's, show while the pointer is on the card
 * or the card is selected. A press on the controls never reaches the card.
 * Its sound never starts or stops at once. With `detail`, it is the player of
 * Card Detail; with `sound`, it plays a sound file the same way.
 */
export function createBaseHalfCanvasCardVideoPlayer(container: HTMLElement, before: Node | null, options: IBaseHalfCanvasCardVideoPlayerOptions): IBaseHalfCanvasCardVideoPlayer {
	return new BaseHalfCanvasCardVideoPlayer(container, before, options);
}

/** The time on the player: `4.4s` under a minute, `1:05` from a minute on. */
export function formatBaseHalfCanvasVideoTime(seconds: number): string {
	const value = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
	if (value < 60) {
		return localize('basehalf.canvas.videoPlayer.seconds', "{0}s", (Math.floor(value * 10) / 10).toFixed(1));
	}
	const whole = Math.floor(value);
	return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** The players on cards and in Card Detail. */
const livePlayers = new Set<BaseHalfCanvasCardVideoPlayer>();

/** The player of a card that shows the file of `source`, the one Card Detail starts from. */
function cardPlayerOf(source: URI): BaseHalfCanvasCardVideoPlayer | undefined {
	for (const player of livePlayers) {
		if (!player.detail && isSameVideoFile(player.source, source)) {
			return player;
		}
	}
	return undefined;
}

/** The canvas asks for a video with its version in the query, Card Detail without: the file is the same. */
function isSameVideoFile(first: URI, second: URI): boolean {
	return isEqual(first.with({ query: '' }), second.with({ query: '' }));
}
let layoutFrame: number | undefined;

/**
 * Where each video stood and whether it had sound when its last player went.
 * The canvas draws a card again often, as after Card Detail closes; the
 * player that draws the video next starts there.
 */
const lastPlayed = new ResourceMap<{ readonly time: number; readonly muted: boolean }>();
const MAX_LAST_PLAYED = 100;

/**
 * Shows or hides the controls of the players under the pointer or on a
 * selected card for the size their pictures have on screen in the next
 * frame, once the canvas has drawn its new zoom. The canvas calls it when its
 * zoom changes.
 */
export function layoutBaseHalfCanvasCardVideoPlayers(): void {
	if (layoutFrame !== undefined) {
		return;
	}
	layoutFrame = mainWindow.requestAnimationFrame(() => {
		layoutFrame = undefined;
		for (const player of livePlayers) {
			player.layout();
		}
	});
}

class BaseHalfCanvasCardVideoPlayer extends Disposable implements IBaseHalfCanvasCardVideoPlayer {

	readonly element: HTMLElement;
	readonly video: HTMLVideoElement;
	private readonly top: HTMLElement;
	private readonly bar: HTMLElement;
	private readonly soundButton: HTMLButtonElement;
	private readonly playButton: HTMLButtonElement;
	private readonly played: HTMLElement;
	private readonly slider: HTMLElement;
	private readonly length: HTMLElement;
	private readonly openButton: HTMLButtonElement;
	/** What stands for the picture of a sound. */
	private readonly picture: HTMLElement | undefined;
	private readonly sound: BaseHalfCanvasVideoSound;
	private hovered = false;
	private selected = false;
	private muted = true;
	private scrubbing: number | undefined;
	private range: IBaseHalfCanvasVideoPlayRange | undefined;
	private rangeFrame: number | undefined;
	private rangeJump: ReturnType<typeof setTimeout> | undefined;

	constructor(
		container: HTMLElement,
		before: Node | null,
		private readonly options: IBaseHalfCanvasCardVideoPlayerOptions
	) {
		super();
		this.element = $('.basehalf-canvas-video-player');
		container.insertBefore(this.element, before);
		this.video = append(this.element, $<HTMLVideoElement>('video.basehalf-canvas-video-player-video'));
		this.video.classList.add(...options.videoClasses);
		this.video.preload = 'metadata';
		this.video.playsInline = true;
		this.video.muted = true;
		this.video.tabIndex = -1;
		this.video.setAttribute('aria-hidden', 'true');
		const detail = options.detail === true;
		const isSound = options.sound === true;
		this.element.classList.toggle('detail', detail);
		this.element.classList.toggle('sound', isSound);
		// On a card the picture is the card's: a press on it selects, moves, and opens the card.
		if (!detail) {
			this.video.style.pointerEvents = 'none';
		}
		// The frame where the video last stopped stands for it, at first its first frame.
		// Card Detail starts at the frame its card shows, with the sound on.
		const last = lastPlayed.get(options.source);
		const time = options.start ?? (detail ? cardPlayerOf(options.source)?.currentTime ?? last?.time : last?.time);
		this.muted = detail || isSound ? false : last?.muted ?? true;
		this.video.src = `${FileAccess.uriToBrowserUri(options.source).toString(true)}#t=${time !== undefined && time > 0 ? time : 0.001}`;
		this.sound = this._register(new BaseHalfCanvasVideoSound(this.video, options.soundGraph));
		this._register(registerBaseHalfCanvasMediaPause(this.video, () => this.pause()));

		if (isSound) {
			this.picture = append(this.element, $('.basehalf-canvas-video-player-picture'));
			this.picture.setAttribute('aria-hidden', 'true');
			renderBaseHalfItemGlyph(this.picture, 'audio', 'currentColor', detail ? 40 : 28);
		}
		this.top = append(this.element, $('.basehalf-canvas-video-player-top.nodrag.nopan'));
		// A sound is heard once it plays: it has no sound to turn on.
		this.top.hidden = isSound;
		this.soundButton = append(this.top, $<HTMLButtonElement>('button.basehalf-canvas-video-player-button.sound'));
		this.bar = append(this.element, $('.basehalf-canvas-video-player-bar.nodrag.nopan'));
		this.playButton = append(this.bar, $<HTMLButtonElement>('button.basehalf-canvas-video-player-button.play'));
		this.played = append(this.bar, $('span.basehalf-canvas-video-player-time.played'));
		this.slider = append(this.bar, $('.basehalf-canvas-video-player-slider'));
		append(this.slider, $('.basehalf-canvas-video-player-track'));
		append(this.slider, $('.basehalf-canvas-video-player-fill'));
		append(this.slider, $('.basehalf-canvas-video-player-thumb'));
		this.length = append(this.bar, $('span.basehalf-canvas-video-player-time.length'));
		this.openButton = append(this.bar, $<HTMLButtonElement>('button.basehalf-canvas-video-player-button.open'));
		for (const button of [this.soundButton, this.playButton, this.openButton]) {
			button.type = 'button';
		}
		if (detail && isSound) {
			// A sound has nothing to fill the screen with.
			this.openButton.hidden = true;
		} else if (detail) {
			this.openButton.classList.add('full-screen');
			this.updateFullScreenButton();
		} else {
			this.openButton.append(playerIcon(OPEN_PATH));
			this.openButton.setAttribute('aria-label', localize('basehalf.canvas.videoPlayer.open', "Open"));
		}
		this.slider.setAttribute('role', 'slider');
		this.slider.setAttribute('aria-label', localize('basehalf.canvas.videoPlayer.position', "Position"));
		this.slider.setAttribute('aria-valuemin', '0');

		livePlayers.add(this);
		this._register(toDisposable(() => {
			livePlayers.delete(this);
			this.stopWatchingRange();
			this.rememberWhereItStands();
			releaseBaseHalfCanvasCardMedia(this.video);
			this.element.remove();
		}));
		// A card resized, or put on screen after it was drawn: the controls follow the size of the picture.
		const ResizeObserverConstructor = container.ownerDocument.defaultView?.ResizeObserver;
		if (ResizeObserverConstructor) {
			const observer = new ResizeObserverConstructor(() => this.layout());
			observer.observe(this.element);
			this._register(toDisposable(() => observer.disconnect()));
		}
		this.registerListeners();
		const hoverService = options.hoverService;
		if (hoverService) {
			for (const button of [this.soundButton, this.playButton, this.openButton]) {
				this._register(hoverService.setupDelayedHover(button, () => ({ content: button.getAttribute('aria-label') ?? '' })));
			}
		}
		this.updatePlayButton();
		this.updateSoundButton();
		this.updateTime();
		this.updateControls();
	}

	get currentTime(): number | undefined {
		return Number.isFinite(this.video.currentTime) ? this.video.currentTime : undefined;
	}

	get source(): URI {
		return this.options.source;
	}

	get detail(): boolean {
		return this.options.detail === true;
	}

	pause(): void {
		this.sound.pause();
		this.updatePlayButton();
	}

	seek(time: number): void {
		const duration = this.duration();
		this.video.currentTime = Math.max(0, duration === undefined ? time : Math.min(time, duration));
		this.updateTime();
	}

	setPlayRange(range: IBaseHalfCanvasVideoPlayRange | undefined): void {
		this.range = range;
		this.stopWatchingRange();
		this.sound.setEnd(range?.end);
		if (range && !this.video.paused) {
			const time = this.video.currentTime;
			if (time < range.start - RANGE_EPSILON || time >= range.lastFrame - RANGE_EPSILON) {
				this.video.currentTime = range.start + RANGE_START_INSIDE;
			}
			this.watchRange();
		}
	}

	setMuted(muted: boolean): void {
		if (this.muted !== muted) {
			this.muted = muted;
			this.sound.setMuted(muted);
			this.updateSoundButton();
		}
	}

	focus(): void {
		this.playButton.focus({ preventScroll: true });
	}

	/**
	 * Watches each frame shown while a part plays: once the part's last frame
	 * is on screen, the part starts again when that frame has been shown for
	 * its length, so that no frame after the part is shown.
	 */
	private watchRange(): void {
		const range = this.range;
		if (!range || this.video.paused || this.rangeFrame !== undefined || this.rangeJump !== undefined) {
			return;
		}
		this.rangeFrame = this.video.requestVideoFrameCallback((_now, metadata) => {
			this.rangeFrame = undefined;
			const current = this.range;
			if (!current || this.video.paused) {
				return;
			}
			if (metadata.mediaTime >= current.lastFrame - RANGE_EPSILON) {
				const remaining = Math.max(0, (current.end - metadata.mediaTime) / (this.video.playbackRate || 1));
				this.rangeJump = setTimeout(() => {
					this.rangeJump = undefined;
					if (this.range && !this.video.paused) {
						this.video.currentTime = this.range.start + RANGE_START_INSIDE;
					}
				}, remaining * 1000 * RANGE_JUMP_AFTER);
				return;
			}
			this.watchRange();
		});
	}

	private stopWatchingRange(): void {
		if (this.rangeFrame !== undefined) {
			this.video.cancelVideoFrameCallback(this.rangeFrame);
			this.rangeFrame = undefined;
		}
		if (this.rangeJump !== undefined) {
			clearTimeout(this.rangeJump);
			this.rangeJump = undefined;
		}
	}

	setSelected(selected: boolean): void {
		if (this.selected === selected) {
			return;
		}
		this.selected = selected;
		// A card that is neither selected nor under the pointer has no controls to stop its video with.
		if (!selected && !this.hovered) {
			this.pause();
		}
		this.updateControls();
	}

	/** The controls follow the size of the picture on screen, which the canvas zoom and a resize change. */
	layout(): void {
		if (this.hovered || this.selected || this.detail) {
			this.updateControls();
		}
	}

	private rememberWhereItStands(): void {
		const time = this.video.currentTime;
		// The sound of Card Detail is its own: the card keeps whether it has sound.
		const muted = this.detail ? lastPlayed.get(this.options.source)?.muted ?? true : this.muted;
		lastPlayed.delete(this.options.source);
		if (this.detail && Number.isFinite(time)) {
			// Closing Card Detail leaves its card at the frame where it stopped.
			for (const player of livePlayers) {
				if (!player.detail && player.video.paused && isSameVideoFile(player.source, this.options.source) && Math.abs(player.video.currentTime - time) > 0.01) {
					player.video.currentTime = time;
				}
			}
		}
		if (!(Number.isFinite(time) && time > 0.01) && muted) {
			return;
		}
		lastPlayed.set(this.options.source, { time: Number.isFinite(time) ? time : 0, muted });
		for (const source of lastPlayed.keys()) {
			if (lastPlayed.size <= MAX_LAST_PLAYED) {
				break;
			}
			lastPlayed.delete(source);
		}
	}

	private registerListeners(): void {
		const { element, video } = this;
		const isSound = this.options.sound === true;
		if (this.detail) {
			// In Card Detail the picture is the player's: a click plays or pauses it, a double click fills the screen.
			this._register(addDisposableListener(this.picture ?? video, 'click', () => {
				this.togglePlay();
				this.focus();
			}));
			if (!isSound) {
				this._register(addDisposableListener(video, 'dblclick', () => this.toggleFullScreen()));
				this._register(addDisposableListener(element.ownerDocument, 'fullscreenchange', () => this.updateFullScreenButton()));
				this._register(addDisposableListener(video, 'loadedmetadata', () => {
					if (video.videoWidth > 0 && video.videoHeight > 0) {
						element.style.setProperty('--basehalf-video-aspect', String(video.videoWidth / video.videoHeight));
					}
				}));
			}
		} else {
			// The pointer plays the video, also on a selected card; it plays no sound, which has no picture to show.
			this._register(addDisposableListener(element, 'pointerenter', event => {
				if (event.pointerType === 'touch') {
					return;
				}
				this.hovered = true;
				this.updateControls();
				if (!isSound) {
					this.play();
				}
			}));
			this._register(addDisposableListener(element, 'pointerleave', event => {
				if (event.pointerType === 'touch') {
					return;
				}
				this.hovered = false;
				this.updateControls();
				// A sound goes on while its card is selected, whose controls stay.
				if (!isSound || !this.selected) {
					this.pause();
				}
			}));
			// A double click on the picture opens the card, which shows the video large: this one pauses.
			this._register(addDisposableListener(element, 'dblclick', () => this.pause()));
		}

		for (const type of ['play', 'pause'] as const) {
			this._register(addDisposableListener(video, type, () => this.updatePlayButton()));
		}
		this._register(addDisposableListener(video, 'ended', () => {
			// A part that ends where the video does starts again too.
			if (this.range) {
				video.currentTime = this.range.start + RANGE_START_INSIDE;
				this.play();
				return;
			}
			this.updatePlayButton();
		}));
		// A part that plays is watched from each start and after each jump.
		for (const type of ['playing', 'seeked'] as const) {
			this._register(addDisposableListener(video, type, () => {
				this.stopWatchingRange();
				this.watchRange();
			}));
		}
		this._register(addDisposableListener(video, 'pause', () => this.stopWatchingRange()));
		for (const type of ['timeupdate', 'durationchange', 'loadedmetadata', 'seeked'] as const) {
			this._register(addDisposableListener(video, type, () => this.updateTime()));
		}
		this._register(addDisposableListener(video, 'error', () => this.options.onError()));

		// A press on the controls is theirs: it selects, moves, and opens no card.
		// So are the arrow keys on a control that has the focus.
		for (const control of [this.top, this.bar]) {
			for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick'] as const) {
				this._register(addDisposableListener(control, type, event => event.stopPropagation()));
			}
			this._register(addDisposableListener(control, 'keydown', event => {
				if (event.key.startsWith('Arrow')) {
					event.stopPropagation();
				}
			}));
		}
		this._register(addDisposableListener(this.playButton, 'click', () => this.togglePlay()));
		this._register(addDisposableListener(this.soundButton, 'click', () => {
			this.muted = !this.muted;
			this.sound.setMuted(this.muted);
			this.updateSoundButton();
		}));
		this._register(addDisposableListener(this.openButton, 'click', () => {
			if (this.detail) {
				this.toggleFullScreen();
				return;
			}
			this.pause();
			this.options.open();
		}));

		this._register(addDisposableListener(this.slider, 'pointerdown', event => {
			if (event.button !== 0) {
				return;
			}
			event.preventDefault();
			this.scrubbing = event.pointerId;
			try {
				this.slider.setPointerCapture(event.pointerId);
			} catch {
				// A pointer that is no longer active cannot be captured; the press still moves the video.
			}
			this.seekTo(event.clientX);
		}));
		this._register(addDisposableListener(this.slider, 'pointermove', event => {
			if (event.pointerId === this.scrubbing) {
				this.seekTo(event.clientX);
			}
		}));
		for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
			this._register(addDisposableListener(this.slider, type, event => {
				if (event.pointerId === this.scrubbing) {
					this.scrubbing = undefined;
				}
			}));
		}
		this._register(addDisposableListener(this.slider, 'keydown', event => {
			const duration = this.duration();
			if (duration === undefined) {
				return;
			}
			let time: number | undefined;
			switch (event.key) {
				case 'ArrowLeft':
				case 'ArrowDown':
					time = video.currentTime - SLIDER_STEP_SECONDS;
					break;
				case 'ArrowRight':
				case 'ArrowUp':
					time = video.currentTime + SLIDER_STEP_SECONDS;
					break;
				case 'Home':
					time = 0;
					break;
				case 'End':
					time = duration;
					break;
			}
			if (time === undefined) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			video.currentTime = Math.min(Math.max(time, 0), duration);
			this.updateTime();
		}));
	}

	private play(): void {
		// A part plays from its start when the video stands outside it or at its end, its last frame.
		const range = this.range;
		if (range && (this.video.currentTime < range.start - RANGE_EPSILON || this.video.currentTime >= range.lastFrame - RANGE_EPSILON)) {
			this.video.currentTime = range.start + RANGE_START_INSIDE;
		}
		this.sound.play(this.muted).catch((error: unknown) => {
			// A video drawn again with its sound on may not start with sound by
			// itself, before a click: it plays without, and its button says so.
			if (!this.muted && (error as Error | undefined)?.name === 'NotAllowedError') {
				this.muted = true;
				this.updateSoundButton();
				this.sound.play(true).catch(() => undefined);
			}
			// Otherwise it was paused again before it began, or there is nothing to play: the picture stays.
		});
		this.updatePlayButton();
	}

	togglePlay(): void {
		if (this.video.paused || this.video.ended || this.sound.pausing) {
			this.play();
		} else {
			this.pause();
		}
	}

	private toggleFullScreen(): void {
		const targetDocument = this.element.ownerDocument;
		if (targetDocument.fullscreenElement === this.element) {
			void targetDocument.exitFullscreen().catch(() => undefined);
		} else {
			void this.element.requestFullscreen().catch(() => undefined);
		}
	}

	private updateFullScreenButton(): void {
		const full = this.element.ownerDocument.fullscreenElement === this.element;
		clearNode(this.openButton);
		this.openButton.append(playerIcon(full ? EXIT_FULL_SCREEN_PATH : OPEN_PATH));
		this.openButton.setAttribute('aria-label', full
			? localize('basehalf.canvas.videoPlayer.exitFullScreen', "Exit Full Screen")
			: localize('basehalf.canvas.videoPlayer.fullScreen', "Full Screen"));
	}

	private duration(): number | undefined {
		const duration = this.video.duration;
		return Number.isFinite(duration) && duration > 0 ? duration : undefined;
	}

	private seekTo(clientX: number): void {
		const duration = this.duration();
		if (duration === undefined) {
			return;
		}
		const bounds = this.slider.getBoundingClientRect();
		const fraction = bounds.width > 0 ? Math.min(Math.max((clientX - bounds.left) / bounds.width, 0), 1) : 0;
		this.video.currentTime = fraction * duration;
		this.updateTime();
	}

	private updateTime(): void {
		const duration = this.duration();
		const current = Number.isFinite(this.video.currentTime) ? this.video.currentTime : 0;
		const time = duration === undefined ? current : Math.min(current, duration);
		this.played.textContent = formatBaseHalfCanvasVideoTime(time);
		this.length.textContent = duration === undefined ? '' : formatBaseHalfCanvasVideoTime(duration);
		this.slider.style.setProperty('--basehalf-video-played', `${duration === undefined ? 0 : (time / duration * 100).toFixed(3)}%`);
		this.slider.setAttribute('aria-valuemax', String(duration === undefined ? 0 : Math.round(duration * 10) / 10));
		this.slider.setAttribute('aria-valuenow', String(Math.round(time * 10) / 10));
		this.slider.setAttribute('aria-valuetext', duration === undefined
			? this.played.textContent
			: localize('basehalf.canvas.videoPlayer.positionText', "{0} of {1}", this.played.textContent, this.length.textContent));
	}

	private updatePlayButton(): void {
		// A video whose sound goes down to pause shows Play at once.
		const playing = !this.video.paused && !this.video.ended && !this.sound.pausing;
		clearNode(this.playButton);
		this.playButton.append(playerIcon(playing ? PAUSE_PATH : PLAY_PATH));
		this.playButton.dataset.state = playing ? 'playing' : 'paused';
		this.playButton.setAttribute('aria-label', playing
			? localize('basehalf.canvas.videoPlayer.pause', "Pause")
			: localize('basehalf.canvas.videoPlayer.play', "Play"));
	}

	private updateSoundButton(): void {
		clearNode(this.soundButton);
		this.soundButton.append(playerIcon(this.muted ? MUTED_PATH : SOUND_PATH));
		this.soundButton.dataset.state = this.muted ? 'muted' : 'sound';
		this.soundButton.setAttribute('aria-label', this.muted
			? localize('basehalf.canvas.videoPlayer.unmute', "Unmute")
			: localize('basehalf.canvas.videoPlayer.mute', "Mute"));
	}

	/** The controls show while the pointer is on the card or the card is selected, and always in Card Detail, on a picture wide enough on screen. */
	private updateControls(): void {
		const shown = (this.hovered || this.selected || this.detail)
			&& this.element.getBoundingClientRect().width >= BASEHALF_CANVAS_VIDEO_CONTROLS_MIN_WIDTH;
		this.element.dataset.controls = shown ? 'shown' : 'hidden';
		for (const control of [this.top, this.bar]) {
			control.setAttribute('aria-hidden', String(!shown));
		}
		for (const focusable of [this.soundButton, this.playButton, this.slider, this.openButton]) {
			focusable.tabIndex = shown && !focusable.hidden && !focusable.parentElement?.hidden ? 0 : -1;
		}
		// A control that hides takes the keyboard focus to its card, not to nowhere.
		const active = getActiveElement();
		if (!shown && isHTMLElement(active) && (this.top.contains(active) || this.bar.contains(active))) {
			const card = this.element.closest<HTMLElement>('.basehalf-canvas-card');
			if (card) {
				card.focus({ preventScroll: true });
			} else {
				active.blur();
			}
		}
	}
}

// The icons of the canvas toolbar's vocabulary (Remix Icon), filled at 24 by 24.
const PLAY_PATH = 'M19.376 12.4161L8.77735 19.4818C8.54759 19.635 8.23715 19.5729 8.08397 19.3432C8.02922 19.261 8 19.1645 8 19.0658V4.93433C8 4.65818 8.22386 4.43433 8.5 4.43433C8.59871 4.43433 8.69522 4.46355 8.77735 4.5183L19.376 11.584C19.6057 11.7372 19.6678 12.0477 19.5146 12.2774C19.478 12.3323 19.4309 12.3795 19.376 12.4161Z';
const PAUSE_PATH = 'M6 5H8V19H6V5ZM16 5H18V19H16V5Z';
const MUTED_PATH = 'M5.88889 16.0001H2C1.44772 16.0001 1 15.5524 1 15.0001V9.00007C1 8.44778 1.44772 8.00007 2 8.00007H5.88889L11.1834 3.66821C11.3971 3.49335 11.7121 3.52485 11.887 3.73857C11.9601 3.8279 12 3.93977 12 4.05519V19.9449C12 20.2211 11.7761 20.4449 11.5 20.4449C11.3846 20.4449 11.2727 20.405 11.1834 20.3319L5.88889 16.0001ZM20.4142 12.0001L23.9497 15.5356L22.5355 16.9498L19 13.4143L15.4645 16.9498L14.0503 15.5356L17.5858 12.0001L14.0503 8.46454L15.4645 7.05032L19 10.5859L22.5355 7.05032L23.9497 8.46454L20.4142 12.0001Z';
const SOUND_PATH = 'M2 16.0001H5.88889L11.1834 20.3319C11.2727 20.405 11.3846 20.4449 11.5 20.4449C11.7761 20.4449 12 20.2211 12 19.9449V4.05519C12 3.93977 11.9601 3.8279 11.887 3.73857C11.7121 3.52485 11.3971 3.49335 11.1834 3.66821L5.88889 8.00007H2C1.44772 8.00007 1 8.44778 1 9.00007V15.0001C1 15.5524 1.44772 16.0001 2 16.0001ZM23 12C23 15.292 21.5539 18.2463 19.2622 20.2622L17.8445 18.8444C19.7758 17.1937 21 14.7398 21 12C21 9.26016 19.7758 6.80629 17.8445 5.15557L19.2622 3.73779C21.5539 5.75368 23 8.70795 23 12ZM18 12C18 10.0883 17.106 8.38548 15.7133 7.28673L14.2842 8.71584C15.3213 9.43855 16 10.64 16 12C16 13.36 15.3213 14.5614 14.2842 15.2841L15.7133 16.7132C17.106 15.6145 18 13.9116 18 12Z';
const OPEN_PATH = 'M8 3V5H4V9H2V3H8ZM2 21V15H4V19H8V21H2ZM22 21H16V19H20V15H22V21ZM22 9H20V5H16V3H22V9Z';
const EXIT_FULL_SCREEN_PATH = 'M18 7H22V9H16V3H18V7ZM8 9H2V7H6V3H8V9ZM18 17V21H16V15H22V17H18ZM8 15V21H6V17H2V15H8Z';

function playerIcon(path: string): SVGElement {
	const svg = $.SVG('svg');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('fill', 'currentColor');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('focusable', 'false');
	svg.classList.add('basehalf-canvas-video-player-icon');
	const shape = $.SVG('path');
	shape.setAttribute('d', path);
	svg.appendChild(shape);
	return svg;
}
