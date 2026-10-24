/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { TimeoutTimer } from '../../../../base/common/async.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { getErrorMessage } from '../../../../base/common/errors.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IBaseHalfProviderService } from '../../../../platform/basehalfProviders/common/basehalfProviders.js';
import type { VoicesResult } from '../../../../platform/basehalfProviders/common/basehalfProviderTypes.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { playBaseHalfCanvasSoundInTurn } from '../../canvas/browser/basehalfCanvasCardMedia.js';
import {
	BASEHALF_VIDEO_SOUND_END_SECONDS,
	BASEHALF_VIDEO_SOUND_FADE_IN_SECONDS,
	BASEHALF_VIDEO_SOUND_FADE_OUT_SECONDS,
	IBaseHalfVideoSoundLevel
} from '../../canvas/browser/basehalfCanvasVideoSound.js';
import { baseHalfVideoGenerateBlockerText, IBaseHalfVideoCatalogModel, IBaseHalfVideoCatalogProvider } from '../common/basehalfVideoCatalog.js';
import { IBaseHalfVideoProviderSettingsService } from '../common/basehalfVideoGeneration.js';
import {
	IBaseHalfGenerationVoiceService,
	IBaseHalfVoices,
	IBaseHalfVoiceSample,
	IBaseHalfVoiceSampleFailure,
	parseBaseHalfVoicesResult
} from '../common/basehalfGenerationVoices.js';

/**
 * The window's voice service (D78; generation cards, "The panel"; providers,
 * "Voices"): it lists the voices of a provider and of the user's account
 * through the provider service, keeps the last list per provider and region
 * for the window, which the voice menu, both panels, and Card Detail name
 * voices from, and plays the samples through an audio graph of its own. It
 * registers here, in a module that the Providers contribution loads with the
 * other generation services, so that it is there whichever panel the window
 * draws first.
 */

// --- The window's audio graph for samples --------------------------------------------------------

/** What the sample of a voice needs of the window's audio graph: an `AudioContext`, or a test's. */
export interface IBaseHalfVoiceSampleContext {
	readonly currentTime: number;
	readonly state: string;
	resume(): Promise<void>;
	suspend(): Promise<void>;
	close(): Promise<void>;
	/** Decodes the bytes of a sound; rejects for bytes that are no sound it can play. */
	decode(bytes: ArrayBuffer): Promise<IBaseHalfVoiceSampleSound>;
	/** Plays a decoded sound from now on through a volume of its own; `ended` is called once, when it has stopped. */
	play(sound: IBaseHalfVoiceSampleSound, ended: () => void): IBaseHalfVoiceSamplePlayback;
}

/** A decoded sample. */
export interface IBaseHalfVoiceSampleSound {
	/** Its length in seconds. */
	readonly duration: number;
}

/** A sample that plays. */
export interface IBaseHalfVoiceSamplePlayback extends IDisposable {
	readonly level: IBaseHalfVideoSoundLevel;
	/** Stops it at `when`, on the graph's clock. */
	stop(when: number): void;
}

/**
 * The window's own audio graph for samples. The window's content security
 * policy plays media only from its own origin, so a sample never goes into
 * an audio element: its bytes are decoded and played here.
 */
function windowVoiceSampleContext(): IBaseHalfVoiceSampleContext | undefined {
	const AudioContextConstructor = (mainWindow as Window & typeof globalThis).AudioContext;
	if (!AudioContextConstructor) {
		return undefined;
	}
	const context = new AudioContextConstructor();
	const buffers = new WeakMap<IBaseHalfVoiceSampleSound, AudioBuffer>();
	return {
		get currentTime() { return context.currentTime; },
		get state() { return context.state; },
		resume: () => context.resume(),
		suspend: () => context.suspend(),
		close: () => context.close(),
		decode: async bytes => {
			const buffer = await context.decodeAudioData(bytes);
			const sound: IBaseHalfVoiceSampleSound = Object.freeze({ duration: buffer.duration });
			buffers.set(sound, buffer);
			return sound;
		},
		play: (sound, ended) => {
			const source = context.createBufferSource();
			source.buffer = buffers.get(sound) ?? null;
			const volume = context.createGain();
			source.connect(volume).connect(context.destination);
			let done = false;
			source.onended = () => {
				if (!done) {
					done = true;
					ended();
				}
			};
			source.start();
			return {
				level: volume.gain,
				stop: when => {
					try {
						source.stop(when);
					} catch {
						// It has stopped already.
					}
				},
				dispose: () => {
					source.onended = null;
					source.disconnect();
					volume.disconnect();
				}
			};
		}
	};
}

// --- The service ---------------------------------------------------------------------------------

/** The window's sound output for samples stops this long after the last one stopped. */
const SAMPLE_IDLE_MILLISECONDS = 5000;
/** The most bytes of a sample the window plays (providers, "Requests"). */
const SAMPLE_MAX_BYTES = 5 * 1024 * 1024;

interface IVoicesEntry {
	list?: VoicesResult;
	loading: boolean;
	error?: string;
	request?: Promise<void>;
}

interface ICurrentSample {
	state: IBaseHalfVoiceSample;
	playback?: IBaseHalfVoiceSamplePlayback;
	/** Its turn among the sounds of the canvas. */
	turn?: IDisposable;
}

/**
 * The voices of the speech models in this window (D78): the last list of
 * each provider and region, asked for through the provider service with
 * this computer's access as a generation is, and the sample that plays.
 */
export class BaseHalfGenerationVoiceService extends Disposable implements IBaseHalfGenerationVoiceService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeVoices = this._register(new Emitter<void>());
	readonly onDidChangeVoices = this._onDidChangeVoices.event;
	private readonly _onDidChangeSample = this._register(new Emitter<void>());
	readonly onDidChangeSample = this._onDidChangeSample.event;

	private readonly lists = new Map<string, IVoicesEntry>();
	private current: ICurrentSample | undefined;
	private failure: IBaseHalfVoiceSampleFailure | undefined;
	/** The audio graph of samples, made when the first one plays; `null` when the window has none. */
	private context: IBaseHalfVoiceSampleContext | null | undefined;
	/** Samples whose sound goes down before they stop. */
	private readonly stopping = new Set<IBaseHalfVoiceSamplePlayback>();
	private readonly idle = this._register(new TimeoutTimer());

	constructor(
		private readonly createContext: () => IBaseHalfVoiceSampleContext | undefined,
		@IBaseHalfProviderService private readonly providerService: IBaseHalfProviderService,
		@IBaseHalfVideoProviderSettingsService private readonly providerSettings: IBaseHalfVideoProviderSettingsService,
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	override dispose(): void {
		this.stopSample();
		for (const playback of this.stopping) {
			playback.dispose();
		}
		this.stopping.clear();
		void this.context?.close().catch(() => undefined);
		super.dispose();
	}

	voices(provider: string, region: string): IBaseHalfVoices {
		const entry = this.lists.get(voicesKey(provider, region));
		return entry
			? Object.freeze({ ...(entry.list ? { list: entry.list } : {}), loading: entry.loading, ...(entry.error !== undefined ? { error: entry.error } : {}) })
			: NO_VOICES;
	}

	refresh(provider: IBaseHalfVideoCatalogProvider, model: IBaseHalfVideoCatalogModel): Promise<void> {
		const key = voicesKey(provider.id, this.providerSettings.getStatus(provider).region.id);
		let entry = this.lists.get(key);
		if (!entry) {
			entry = { loading: false };
			this.lists.set(key, entry);
		}
		if (entry.request) {
			return entry.request;
		}
		const asked = entry;
		asked.loading = true;
		this._onDidChangeVoices.fire();
		const request = this.ask(provider, model).then(list => {
			asked.list = list;
			asked.error = undefined;
		}, error => {
			// The last list stays, with the reason the new one could not be loaded.
			asked.error = plainMessage(error);
		}).finally(() => {
			asked.loading = false;
			asked.request = undefined;
			if (!this._store.isDisposed) {
				this._onDidChangeVoices.fire();
			}
		});
		asked.request = request;
		return request;
	}

	askOnce(provider: IBaseHalfVideoCatalogProvider, model: IBaseHalfVideoCatalogModel, region: string): Promise<void> {
		// Asked there before: a list, a request on its way, or a failure.
		const asked = this.lists.get(voicesKey(provider.id, region));
		if (asked) {
			return asked.request ?? Promise.resolve();
		}
		// The list of the region in use names none of another region's voices, and a provider not set up lists none of the account's.
		const status = this.providerSettings.getStatus(provider);
		return region === status.region.id && status.setUp ? this.refresh(provider, model) : Promise.resolve();
	}

	get sample(): IBaseHalfVoiceSample | undefined {
		return this.current?.state;
	}

	get sampleFailure(): IBaseHalfVoiceSampleFailure | undefined {
		return this.failure;
	}

	async playSample(provider: IBaseHalfVideoCatalogProvider, model: IBaseHalfVideoCatalogModel, voice: string, sample: string): Promise<void> {
		this.stopSample();
		const current: ICurrentSample = { state: Object.freeze({ provider: provider.id, voice, sample, phase: 'loading' }) };
		this.current = current;
		this.failure = undefined;
		this.idle.cancel();
		const context = this.audio();
		// While the click or the key that asked for it is handled: the window may start its sound output then.
		void context?.resume().catch(() => undefined);
		this._onDidChangeSample.fire();
		try {
			if (!context) {
				throw new Error(localize('basehalf.generation.voices.noSound', "This window cannot play sounds."));
			}
			const bytes = await this.fetchSample(provider, model, sample);
			if (this.current !== current) {
				return;
			}
			let sound: IBaseHalfVoiceSampleSound;
			try {
				sound = await context.decode(bytes);
			} catch {
				throw new Error(localize('basehalf.generation.voices.notASound', "BaseHalf cannot play the sound of this sample."));
			}
			if (this.current !== current) {
				return;
			}
			if (context.state !== 'running') {
				await context.resume();
				if (this.current !== current) {
					return;
				}
			}
			this.start(current, context, sound);
		} catch (error) {
			if (this.current === current) {
				this.current = undefined;
				this.failure = Object.freeze({ provider: provider.id, voice, message: plainMessage(error) });
				this.scheduleIdle();
				this._onDidChangeSample.fire();
			}
		}
	}

	stopSample(): void {
		const current = this.current;
		if (!current) {
			return;
		}
		this.current = undefined;
		current.turn?.dispose();
		const playback = current.playback;
		const context = this.context;
		if (playback && context) {
			// The sound goes down before it stops, as a card's does: a sound cut in the middle of its wave is a click.
			const now = context.currentTime;
			const level = playback.level;
			const value = level.value;
			level.cancelScheduledValues(now);
			level.setValueAtTime(value, now);
			level.linearRampToValueAtTime(0, now + BASEHALF_VIDEO_SOUND_FADE_OUT_SECONDS);
			playback.stop(now + BASEHALF_VIDEO_SOUND_FADE_OUT_SECONDS);
			this.stopping.add(playback);
		}
		this.scheduleIdle();
		this._onDidChangeSample.fire();
	}

	/** Lists the voices with the access of this computer, as a generation asks. Rejects with the reason in plain words. */
	private async ask(provider: IBaseHalfVideoCatalogProvider, model: IBaseHalfVideoCatalogModel): Promise<VoicesResult> {
		const access = await this.access(provider);
		let answer: unknown;
		try {
			answer = await this.providerService.voices({ ...access, model: model.id });
		} catch (error) {
			// The call did not reach the provider service, or the service stopped while it ran it (D75).
			this.logService.warn(`[BaseHalf voices] The voices of ${provider.id} were not answered: ${getErrorMessage(error)}`);
			throw new Error(plainMessage(error) || notAnswered());
		}
		if (!isRecord(answer) || answer.ok !== true) {
			throw new Error(errorOf(answer));
		}
		const list = parseBaseHalfVoicesResult(answer.value);
		if (!list) {
			throw new Error(unreadable());
		}
		return list;
	}

	/** The bytes of a sample, as a buffer of their own: decoding takes them over. */
	private async fetchSample(provider: IBaseHalfVideoCatalogProvider, model: IBaseHalfVideoCatalogModel, sample: string): Promise<ArrayBuffer> {
		const access = await this.access(provider);
		let answer: unknown;
		try {
			answer = await this.providerService.voicePreview({ ...access, model: model.id, sample });
		} catch (error) {
			this.logService.warn(`[BaseHalf voices] A sample of ${provider.id} was not answered: ${getErrorMessage(error)}`);
			throw new Error(plainMessage(error) || notAnswered());
		}
		if (!isRecord(answer) || answer.ok !== true) {
			throw new Error(errorOf(answer));
		}
		const value = answer.value;
		const bytes = isRecord(value) ? value.bytes instanceof VSBuffer ? value.bytes.buffer : value.bytes instanceof Uint8Array ? value.bytes : undefined : undefined;
		if (!bytes || bytes.byteLength === 0 || bytes.byteLength > SAMPLE_MAX_BYTES) {
			throw new Error(unreadable());
		}
		return bytes.slice().buffer;
	}

	/** Where a request goes and with what, read from the encrypted store; an error in plain words when the provider is not set up. */
	private async access(provider: IBaseHalfVideoCatalogProvider) {
		const access = await this.providerSettings.getAccess(provider);
		if (!access) {
			throw new Error(baseHalfVideoGenerateBlockerText({ kind: 'notSetUp', provider }));
		}
		return access;
	}

	/** The sample sounds: it comes up, and goes down over its last moments, as a card's sound does. */
	private start(current: ICurrentSample, context: IBaseHalfVoiceSampleContext, sound: IBaseHalfVoiceSampleSound): void {
		// One sound at a time: what plays on the canvas pauses, and a video or a sound that starts there stops the sample.
		current.turn = playBaseHalfCanvasSoundInTurn(() => {
			if (this.current === current) {
				this.stopSample();
			}
		});
		const playback = context.play(sound, () => this.ended(current, playback));
		current.playback = playback;
		current.state = Object.freeze({ ...current.state, phase: 'playing' as const });
		const level = playback.level;
		const now = context.currentTime;
		const up = now + BASEHALF_VIDEO_SOUND_FADE_IN_SECONDS;
		const end = now + sound.duration;
		level.cancelScheduledValues(now);
		level.setValueAtTime(0, now);
		if (end - BASEHALF_VIDEO_SOUND_END_SECONDS > up) {
			level.linearRampToValueAtTime(1, up);
			level.setValueAtTime(1, end - BASEHALF_VIDEO_SOUND_END_SECONDS);
		}
		level.linearRampToValueAtTime(0, end);
		this._onDidChangeSample.fire();
	}

	private ended(current: ICurrentSample, playback: IBaseHalfVoiceSamplePlayback): void {
		playback.dispose();
		this.stopping.delete(playback);
		if (this.current === current) {
			this.current = undefined;
			current.turn?.dispose();
			this._onDidChangeSample.fire();
		}
		this.scheduleIdle();
	}

	private audio(): IBaseHalfVoiceSampleContext | undefined {
		if (this.context === undefined) {
			try {
				this.context = this.createContext() ?? null;
			} catch (error) {
				this.logService.warn(`[BaseHalf voices] The window has no sound output for samples: ${getErrorMessage(error)}`);
				this.context = null;
			}
		}
		return this.context ?? undefined;
	}

	/** Once no sample plays for a while, the window's sound output for samples stops. */
	private scheduleIdle(): void {
		if (this._store.isDisposed) {
			return;
		}
		this.idle.cancelAndSet(() => {
			const context = this.context;
			if (!this.current && this.stopping.size === 0 && context && context.state === 'running') {
				void context.suspend().catch(() => undefined);
			}
		}, SAMPLE_IDLE_MILLISECONDS);
	}
}

const NO_VOICES: IBaseHalfVoices = Object.freeze({ loading: false });

function voicesKey(provider: string, region: string): string {
	return `${provider}/${region}`;
}

function notAnswered(): string {
	return localize('basehalf.generation.voices.notAnswered', "The provider service did not answer.");
}

function unreadable(): string {
	return localize('basehalf.generation.voices.unreadable', "The provider service answered in a form BaseHalf cannot read.");
}

/** The message of a refused call of the provider service. */
function errorOf(answer: unknown): string {
	return isRecord(answer) && answer.ok === false && isRecord(answer.error) && typeof answer.error.message === 'string' && answer.error.message.trim()
		? plainMessage(answer.error.message)
		: unreadable();
}

/** An error as plain text of at most 1,000 characters, on one line. */
function plainMessage(error: unknown): string {
	const text = (typeof error === 'string' ? error : getErrorMessage(error)).replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim();
	return text.length > 1000 ? `${text.slice(0, 999)}…` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

registerSingleton(IBaseHalfGenerationVoiceService, new SyncDescriptor(BaseHalfGenerationVoiceService, [windowVoiceSampleContext], true));
