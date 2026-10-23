/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../../base/browser/dom.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';

/** How long the sound of a video takes to come up when it starts or is turned on (generation cards, "The player"). */
export const BASEHALF_VIDEO_SOUND_FADE_IN_SECONDS = 0.04;
/** How long it takes to go down before the video pauses or the sound is turned off. */
export const BASEHALF_VIDEO_SOUND_FADE_OUT_SECONDS = 0.06;
/** The last moments of a video, over which its sound goes down. */
export const BASEHALF_VIDEO_SOUND_END_SECONDS = 0.1;
/** The sound is gone this long before the end that the position of the video predicts. */
const END_MARGIN_SECONDS = 0.02;
/** How long the sound takes to go down when the position jumps. */
const SEEK_FADE_SECONDS = 0.008;
/** The window's sound output stops this long after the last video with sound stopped. */
const IDLE_MILLISECONDS = 5000;
/** The video pauses this long after its sound began to go down: the sound has gone by then. */
const PAUSE_AFTER_MILLISECONDS = BASEHALF_VIDEO_SOUND_FADE_OUT_SECONDS * 1000 + 25;

/** The volume of a video's sound in the graph: an `AudioParam`, or a test's. */
export interface IBaseHalfVideoSoundLevel {
	readonly value: number;
	cancelScheduledValues(time: number): unknown;
	setValueAtTime(value: number, time: number): unknown;
	linearRampToValueAtTime(value: number, time: number): unknown;
}

/**
 * Keeps `level` where it is at `time`, and drops what was to come. Chromium's
 * `cancelAndHoldAtTime` holds a wrong value when the end of the video is
 * already scheduled after it (measured 2026-10-23: 0.1 for 1), which jumps the
 * sound down at once: the value read is held instead.
 */
function holdBaseHalfVideoSoundLevel(level: IBaseHalfVideoSoundLevel, time: number, value = level.value): void {
	level.cancelScheduledValues(time);
	level.setValueAtTime(value, time);
}

/** What the sound of a video needs of the window's audio graph: an `AudioContext`, or a test's. */
export interface IBaseHalfVideoSoundContext {
	readonly currentTime: number;
	readonly state: string;
	resume(): Promise<void>;
	suspend(): Promise<void>;
	/**
	 * Plays the sound of `media` through a volume of its own, from now on: the
	 * graph then pulls the video, which plays only while the graph runs.
	 * Undefined for a video whose sound the graph would not hear.
	 */
	route(media: HTMLMediaElement): (IDisposable & { readonly level: IBaseHalfVideoSoundLevel }) | undefined;
}

/** The window's audio graph, which the videos with sound play through. It runs while one of them plays. */
export class BaseHalfVideoSoundGraph {
	private readonly playing = new Set<HTMLMediaElement>();
	private idle: ReturnType<typeof setTimeout> | undefined;

	constructor(readonly context: IBaseHalfVideoSoundContext) { }

	/** A routed video starts: the graph that pulls it runs. */
	didPlay(media: HTMLMediaElement): void {
		this.playing.add(media);
		this.clearIdle();
		if (this.context.state !== 'running') {
			void this.context.resume().catch(() => {
				// A graph that cannot run leaves its videos silent and still.
			});
		}
	}

	/** A routed video stopped or went: once none plays, the graph stops after a while. */
	didStop(media: HTMLMediaElement): void {
		if (!this.playing.delete(media) || this.playing.size > 0) {
			return;
		}
		this.clearIdle();
		this.idle = setTimeout(() => {
			this.idle = undefined;
			if (this.playing.size === 0 && this.context.state === 'running') {
				void this.context.suspend().catch(() => undefined);
			}
		}, IDLE_MILLISECONDS);
	}

	private clearIdle(): void {
		if (this.idle !== undefined) {
			clearTimeout(this.idle);
			this.idle = undefined;
		}
	}
}

const windowGraphs = new WeakMap<Window, BaseHalfVideoSoundGraph | null>();

/** The audio graph of the window that shows `media`, made when a video first needs its sound. */
function windowSoundGraph(media: HTMLMediaElement): BaseHalfVideoSoundGraph | undefined {
	const targetWindow = media.ownerDocument.defaultView;
	if (!targetWindow) {
		return undefined;
	}
	let graph = windowGraphs.get(targetWindow);
	if (graph === undefined) {
		const context = windowSoundContext(targetWindow);
		graph = context ? new BaseHalfVideoSoundGraph(context) : null;
		windowGraphs.set(targetWindow, graph);
	}
	return graph ?? undefined;
}

function windowSoundContext(targetWindow: Window): IBaseHalfVideoSoundContext | undefined {
	const AudioContextConstructor = (targetWindow as Window & typeof globalThis).AudioContext;
	if (!AudioContextConstructor) {
		return undefined;
	}
	const context = new AudioContextConstructor();
	return {
		get currentTime() { return context.currentTime; },
		get state() { return context.state; },
		resume: () => context.resume(),
		suspend: () => context.suspend(),
		route: media => {
			// The graph hears the sound of a video of the window's own origin only;
			// another's would play as silence.
			const source = media.currentSrc || media.src;
			if (!source || new URL(source).origin !== targetWindow.location.origin) {
				return undefined;
			}
			const input = context.createMediaElementSource(media);
			const volume = context.createGain();
			input.connect(volume).connect(context.destination);
			return {
				level: volume.gain,
				dispose: () => {
					input.disconnect();
					volume.disconnect();
				}
			};
		}
	};
}

/**
 * The sound of a video that never starts or stops at once (generation cards,
 * "The player"): a sound cut in the middle of its wave is a click in the
 * speakers. Once the sound is on, it plays through the window's audio graph:
 * it comes up when the video starts or the sound is turned on, goes down
 * before the video pauses or the sound is turned off, goes down over the last
 * moments of the video, and dips for each jump of the position. A video whose
 * sound was never on plays and pauses at once, outside the graph.
 */
export class BaseHalfCanvasVideoSound extends Disposable {
	private route: (IDisposable & { readonly level: IBaseHalfVideoSoundLevel }) | undefined;
	private going: { pause: boolean; mute: boolean; readonly timer: ReturnType<typeof setTimeout> } | undefined;

	constructor(
		private readonly video: HTMLVideoElement,
		private readonly graphOf: () => BaseHalfVideoSoundGraph | undefined = () => windowSoundGraph(video)
	) {
		super();
		this._register(addDisposableListener(video, 'playing', () => {
			if (this.route) {
				this.graphOf()?.didPlay(video);
				// It starts, or goes on after waiting for its data: from silence either way.
				this.comeUp(0);
			}
		}));
		for (const type of ['pause', 'ended', 'emptied'] as const) {
			this._register(addDisposableListener(video, type, () => this.graphOf()?.didStop(video)));
		}
		this._register(addDisposableListener(video, 'seeking', () => {
			if (this.audible() && !video.paused && !this.going) {
				const context = this.context()!;
				holdBaseHalfVideoSoundLevel(this.route!.level, context.currentTime);
				this.route!.level.linearRampToValueAtTime(0, context.currentTime + SEEK_FADE_SECONDS);
			}
		}));
		// After the jump the sound comes up from the silence it dipped to; a new speed only moves the end.
		this._register(addDisposableListener(video, 'seeked', () => {
			if (!video.paused && !this.going) {
				this.comeUp(0);
			}
		}));
		this._register(addDisposableListener(video, 'ratechange', () => {
			if (!video.paused && !this.going) {
				this.comeUp();
			}
		}));
		this._register(toDisposable(() => {
			if (this.going) {
				clearTimeout(this.going.timer);
				this.going = undefined;
			}
			this.graphOf()?.didStop(video);
			this.route?.dispose();
			this.route = undefined;
		}));
	}

	/** The video goes quiet to pause: the player shows it paused already. */
	get pausing(): boolean {
		return this.going?.pause === true;
	}

	/**
	 * Plays the video, with its sound coming up from silence unless `muted`. A
	 * video going quiet to pause goes on instead, and comes up again; one going
	 * quiet to lose its sound loses it.
	 */
	play(muted: boolean): Promise<void> {
		const going = this.going;
		if (going) {
			going.pause = false;
			if (!going.mute) {
				clearTimeout(going.timer);
				this.going = undefined;
				this.comeUp();
			}
		}
		if (!this.video.paused) {
			return Promise.resolve();
		}
		this.video.muted = muted;
		const level = muted ? this.route?.level : this.routed();
		if (level) {
			// It comes up from silence when it plays ('playing'). The graph pulls
			// the video: it runs for the video to play at all.
			holdBaseHalfVideoSoundLevel(level, this.context()!.currentTime, 0);
			this.graphOf()?.didPlay(this.video);
		}
		return this.video.play();
	}

	/** Pauses the video once its sound has gone down; without sound, at once. */
	pause(): void {
		if (this.video.paused) {
			return;
		}
		if (!this.audible()) {
			this.video.pause();
			return;
		}
		this.goQuiet('pause');
	}

	/** Turns the sound off once it has gone down, or on, coming up. */
	setMuted(muted: boolean): void {
		if (muted) {
			if (this.audible() && !this.video.paused) {
				this.goQuiet('mute');
			} else {
				this.video.muted = true;
			}
			return;
		}
		const going = this.going;
		if (going?.mute) {
			// The sound had not gone yet: it stays, and comes up unless the video pauses.
			going.mute = false;
			if (!going.pause) {
				clearTimeout(going.timer);
				this.going = undefined;
				this.comeUp();
			}
			return;
		}
		if (!this.video.muted) {
			return;
		}
		const level = this.routed();
		this.video.muted = false;
		if (level && !this.video.paused) {
			this.comeUp(0);
		} else if (level) {
			// It comes up when it plays.
			holdBaseHalfVideoSoundLevel(level, this.context()!.currentTime, 0);
		}
	}

	private context(): IBaseHalfVideoSoundContext | undefined {
		return this.graphOf()?.context;
	}

	private audible(): boolean {
		return !!this.route && !this.video.muted && this.video.volume > 0;
	}

	/** The video's sound through the graph, routed the first time it is needed. */
	private routed(): IBaseHalfVideoSoundLevel | undefined {
		if (!this.route) {
			try {
				this.route = this.graphOf()?.context.route(this.video);
			} catch {
				// A video routed elsewhere already plays on without the fades.
			}
			if (this.route && !this.video.paused) {
				// From now on the graph pulls a video that plays: it runs at once.
				this.graphOf()?.didPlay(this.video);
			}
		}
		return this.route?.level;
	}

	/** The sound goes down, and then the video pauses or loses its sound. */
	private goQuiet(what: 'pause' | 'mute'): void {
		if (!this.going) {
			const context = this.context()!;
			holdBaseHalfVideoSoundLevel(this.route!.level, context.currentTime);
			this.route!.level.linearRampToValueAtTime(0, context.currentTime + BASEHALF_VIDEO_SOUND_FADE_OUT_SECONDS);
			this.going = {
				pause: false,
				mute: false,
				timer: setTimeout(() => this.wentQuiet(), PAUSE_AFTER_MILLISECONDS)
			};
		}
		this.going[what] = true;
	}

	private wentQuiet(): void {
		const going = this.going;
		this.going = undefined;
		if (going?.mute) {
			this.video.muted = true;
		}
		if (going?.pause) {
			this.video.pause();
		}
	}

	/**
	 * The sound comes up, from `from` or from where it is, and goes down
	 * again over the last moments of the video.
	 */
	private comeUp(from?: number): void {
		const context = this.context();
		const level = this.route?.level;
		if (!context || !level || this.video.muted) {
			return;
		}
		const now = context.currentTime;
		holdBaseHalfVideoSoundLevel(level, now, from);
		const remaining = (this.video.duration - this.video.currentTime) / (this.video.playbackRate || 1);
		const end = Number.isFinite(remaining) && !this.video.loop ? now + remaining - END_MARGIN_SECONDS : undefined;
		const up = now + BASEHALF_VIDEO_SOUND_FADE_IN_SECONDS;
		if (end !== undefined && end - BASEHALF_VIDEO_SOUND_END_SECONDS <= up) {
			// Too close to the end to come up: it stays down to the end.
			level.linearRampToValueAtTime(0, Math.max(end, now + SEEK_FADE_SECONDS));
			return;
		}
		level.linearRampToValueAtTime(1, up);
		if (end !== undefined) {
			level.setValueAtTime(1, end - BASEHALF_VIDEO_SOUND_END_SECONDS);
			level.linearRampToValueAtTime(0, end);
		}
	}
}
