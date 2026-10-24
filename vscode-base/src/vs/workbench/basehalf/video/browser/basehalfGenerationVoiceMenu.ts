/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfGenerationVoiceMenu.css';
import { $, addDisposableListener, append, clearNode } from '../../../../base/browser/dom.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { TimeoutTimer } from '../../../../base/common/async.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { getErrorMessage } from '../../../../base/common/errors.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { IBaseHalfProviderService } from '../../../../platform/basehalfProviders/common/basehalfProviders.js';
import type { VoiceParameter, VoicesResult } from '../../../../platform/basehalfProviders/common/basehalfProviderTypes.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
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
	BaseHalfVoiceMenuRow,
	baseHalfVoiceMenuRows,
	baseHalfVoiceMenuStatus,
	IBaseHalfGenerationVoiceService,
	IBaseHalfVoiceMenuVoice,
	IBaseHalfVoices,
	IBaseHalfVoiceSample,
	IBaseHalfVoiceSampleFailure,
	parseBaseHalfVoicesResult
} from '../common/basehalfGenerationVoices.js';

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

// --- The menu ------------------------------------------------------------------------------------

/** What the voice menu lists from: the card's model, its voice parameter, and the card's voice. */
export interface IBaseHalfVoiceMenuTarget {
	readonly provider: IBaseHalfVideoCatalogProvider;
	readonly model: IBaseHalfVideoCatalogModel;
	readonly parameter: VoiceParameter;
	/** The card's voice. */
	readonly voice: string;
}

export interface IBaseHalfVoiceMenuDelegate {
	/** A voice was chosen: the panel saves it, closes the menu, and gives the keyboard back. */
	choose(voice: string): void;
	/** Escape, or Tab out of the menu. */
	dismiss(): void;
	/** What the menu shows changed its height: the panel places it again. */
	layout(): void;
}

const HOVER_GROUP = 'basehalf-video-panel';

/**
 * The menu of the voice button (generation cards, "The panel", D78), drawn
 * into a menu of the panel: a search field that has the keyboard, the voices
 * of the account under Your Voices and the provider's under Voices, each with
 * its description, a play button for its sample, and a check on the card's
 * voice. Up and Down move the current voice, Enter chooses it, Space plays its
 * sample, and Escape closes the menu. It asks the provider for the voices each
 * time it opens and shows the last list meanwhile; closing it stops a sample.
 */
export class BaseHalfGenerationVoiceMenu extends Disposable {

	private readonly search: HTMLInputElement;
	private readonly status: HTMLElement;
	private readonly statusText: HTMLElement;
	private readonly statusAction: HTMLButtonElement;
	private readonly sampleStatus: HTMLElement;
	private readonly list: HTMLElement;
	private readonly rowsStore = this._register(new DisposableStore());
	private readonly id = `bh-voice-menu-${generateUuid()}`;
	/** The voices drawn, by key. */
	private readonly options = new Map<string, { readonly element: HTMLElement; readonly voice: IBaseHalfVoiceMenuVoice; readonly play?: HTMLButtonElement }>();
	private rows: readonly BaseHalfVoiceMenuRow[] = [];
	/** What the rows were drawn from, so that they are drawn again only when it changes. */
	private drawn: { readonly parameter: VoiceParameter; readonly voice: string; readonly list: VoicesResult | undefined; readonly query: string } | undefined;
	/** The current voice, by key. */
	private activeKey: string | undefined;
	private statusKind: 'setUp' | 'retry' | undefined;
	private query = '';
	private composing = false;

	constructor(
		element: HTMLElement,
		private target: IBaseHalfVoiceMenuTarget,
		private readonly delegate: IBaseHalfVoiceMenuDelegate,
		@IBaseHalfGenerationVoiceService private readonly voices: IBaseHalfGenerationVoiceService,
		@IBaseHalfVideoProviderSettingsService private readonly providerSettings: IBaseHalfVideoProviderSettingsService,
		@IHoverService private readonly hoverService: IHoverService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		element.classList.add('bh-voice-menu');
		element.setAttribute('role', 'dialog');
		element.setAttribute('aria-label', localize('basehalf.generation.voices.menu', "Voices"));
		const field = append(element, $('.bh-voice-menu-search'));
		field.append(renderGlyph(Codicon.search));
		this.search = append(field, $<HTMLInputElement>('input'));
		this.search.type = 'text';
		this.search.spellcheck = false;
		this.search.placeholder = localize('basehalf.generation.voices.search', "Search");
		this.search.setAttribute('role', 'combobox');
		this.search.setAttribute('aria-autocomplete', 'list');
		this.search.setAttribute('aria-expanded', 'true');
		this.search.setAttribute('aria-controls', `${this.id}-list`);
		this.status = append(element, $('.bh-voice-menu-status'));
		this.statusText = append(this.status, $('span.bh-voice-menu-status-text'));
		this.statusText.setAttribute('role', 'status');
		this.statusAction = append(this.status, $<HTMLButtonElement>('button.bh-voice-menu-status-action'));
		this.statusAction.type = 'button';
		this.sampleStatus = append(element, $('.bh-voice-menu-status.sample'));
		this.sampleStatus.setAttribute('role', 'status');
		this.list = append(element, $('.bh-voice-menu-list'));
		this.list.id = `${this.id}-list`;
		this.list.setAttribute('role', 'listbox');
		this.list.setAttribute('aria-label', localize('basehalf.generation.voices.menu', "Voices"));

		this._register(addDisposableListener(this.search, 'input', event => {
			if ((event as InputEvent).isComposing || this.composing) {
				return;
			}
			this.setQuery(this.search.value);
		}));
		this._register(addDisposableListener(this.search, 'compositionstart', () => { this.composing = true; }));
		this._register(addDisposableListener(this.search, 'compositionend', () => {
			this.composing = false;
			this.setQuery(this.search.value);
		}));
		this._register(addDisposableListener(element, 'keydown', event => this.onKeyDown(event)));
		this._register(addDisposableListener(element, 'pointerdown', event => {
			// The search field keeps the keyboard while the pointer chooses and plays.
			if (event.target !== this.search) {
				event.preventDefault();
			}
		}));
		this._register(addDisposableListener(this.statusAction, 'click', () => this.runStatusAction()));
		this._register(this.voices.onDidChangeVoices(() => this.render()));
		this._register(this.voices.onDidChangeSample(() => this.renderSample()));
		this._register(this.providerSettings.onDidChange(() => this.render()));
		this.render();
		this.ask();
	}

	/** Moves the keyboard into the search field, with the current voice in view. */
	focus(): void {
		this.search.focus({ preventScroll: true });
		this.updateActive(true);
	}

	/** Lists for the card as it is now: another voice, or another model, keeping the search. */
	update(target: IBaseHalfVoiceMenuTarget): void {
		const otherModel = target.provider.id !== this.target.provider.id || target.model.id !== this.target.model.id;
		this.target = target;
		this.render();
		if (otherModel) {
			this.ask();
		}
	}

	override dispose(): void {
		// Closing the menu stops its sample.
		this.voices.stopSample();
		super.dispose();
	}

	/** The menu asks the provider for the voices each time it opens, when the provider lists them and is set up. */
	private ask(): void {
		if (this.target.parameter.listed === true && this.providerSettings.getStatus(this.target.provider).setUp) {
			void this.voices.refresh(this.target.provider, this.target.model).catch(error => this.logService.warn(`[BaseHalf voices] ${getErrorMessage(error)}`));
		}
	}

	private setQuery(query: string): void {
		if (query === this.query) {
			return;
		}
		this.query = query;
		this.activeKey = undefined;
		this.render();
	}

	//#region Drawing

	private render(): void {
		const status = this.providerSettings.getStatus(this.target.provider);
		const listed = this.target.parameter.listed === true;
		const voices = this.voices.voices(this.target.provider.id, status.region.id);
		// A provider that is not set up shows the catalog's voices: the account's are not known here.
		const list = listed && status.setUp ? voices.list : undefined;
		const line = baseHalfVoiceMenuStatus({ listed, setUp: status.setUp, providerLabel: this.target.provider.label, voices });
		this.statusKind = line?.action;
		this.status.hidden = !line;
		this.statusText.textContent = line?.text ?? '';
		this.statusAction.hidden = !line?.action;
		this.statusAction.textContent = line?.action === 'setUp'
			? localize('basehalf.generation.voices.setUpAction', "Set Up")
			: line?.action === 'retry' ? localize('basehalf.generation.voices.retry', "Try Again") : '';
		const drawn = this.drawn;
		// A list that arrives, or the card's voice that changes, keeps where the list was scrolled; a search starts at its top.
		const scrollTop = drawn?.query === this.query ? this.list.scrollTop : 0;
		if (!drawn || drawn.parameter !== this.target.parameter || drawn.voice !== this.target.voice || drawn.list !== list || drawn.query !== this.query) {
			this.drawn = { parameter: this.target.parameter, voice: this.target.voice, list, query: this.query };
			this.rows = baseHalfVoiceMenuRows({ parameter: this.target.parameter, voice: this.target.voice, ...(list ? { list } : {}) }, this.query);
			this.renderRows();
		}
		this.renderSample();
		this.delegate.layout();
		this.list.scrollTop = scrollTop;
	}

	private renderRows(): void {
		this.rowsStore.clear();
		this.options.clear();
		clearNode(this.list);
		// A play button keeps a column of its own, so that the names line up, when any voice has one.
		const samples = this.rows.some(row => row.type === 'voice' && row.voice.sample !== undefined);
		let group: HTMLElement | undefined;
		for (const row of this.rows) {
			if (row.type === 'header') {
				group = append(this.list, $('.bh-voice-menu-group'));
				group.setAttribute('role', 'group');
				group.setAttribute('aria-label', row.text);
				const header = append(group, $('.bh-voice-menu-header'));
				header.textContent = row.text;
				header.setAttribute('aria-hidden', 'true');
			} else if (row.type === 'note') {
				group = undefined;
				append(this.list, $('.bh-voice-menu-note')).textContent = row.text;
			} else {
				this.renderVoice(group ?? this.list, row.voice, samples);
			}
		}
		const keys = [...this.options.keys()];
		if (!this.activeKey || !this.options.has(this.activeKey)) {
			// The current voice is the card's, and after a search the first that it found.
			this.activeKey = (this.query ? undefined : [...this.options.values()].find(option => option.voice.checked)?.voice.key) ?? keys[0];
		}
		this.updateActive(false);
	}

	private renderVoice(parent: HTMLElement, voice: IBaseHalfVoiceMenuVoice, samples: boolean): void {
		const option = append(parent, $('.bh-voice-menu-option'));
		option.id = this.optionId(voice.key);
		option.dataset.key = voice.key;
		option.setAttribute('role', 'option');
		option.setAttribute('aria-checked', String(voice.checked));
		// Named by its voice alone, with its description read after it, as a model of the model menu is.
		option.setAttribute('aria-label', voice.label);
		if (voice.description) {
			option.setAttribute('aria-description', voice.description);
		}
		let play: HTMLButtonElement | undefined;
		if (voice.sample) {
			play = append(option, $<HTMLButtonElement>('button.bh-voice-menu-play'));
			play.type = 'button';
			play.tabIndex = -1;
			const button = play;
			this.rowsStore.add(addDisposableListener(button, 'click', event => {
				event.preventDefault();
				event.stopPropagation();
				this.toggleSample(voice);
			}));
			this.rowsStore.add(this.hoverService.setupDelayedHover(button, () => ({ content: this.playing(voice) ? localize('basehalf.generation.voices.stopSample', "Stop Sample") : localize('basehalf.generation.voices.playSample', "Play Sample") }), { groupId: HOVER_GROUP }));
		} else if (samples) {
			append(option, $('span.bh-voice-menu-play-space'));
		}
		const text = append(option, $('.bh-voice-menu-text'));
		append(text, $('span.bh-voice-menu-name')).textContent = voice.label;
		if (voice.description) {
			append(text, $('span.bh-voice-menu-description')).textContent = voice.description;
		}
		if (voice.checked) {
			option.append(renderGlyph(Codicon.check, 'bh-voice-menu-check'));
		}
		this.rowsStore.add(addDisposableListener(option, 'pointermove', () => {
			if (this.activeKey !== voice.key) {
				this.activeKey = voice.key;
				this.updateActive(false);
			}
		}));
		this.rowsStore.add(addDisposableListener(option, 'click', () => this.delegate.choose(voice.id)));
		this.options.set(voice.key, { element: option, voice, ...(play ? { play } : {}) });
	}

	/** The play buttons show whether their sample loads or plays, and the line under the search field why one could not be played. */
	private renderSample(): void {
		for (const { voice, play } of this.options.values()) {
			if (!play) {
				continue;
			}
			const sample = this.playing(voice);
			const icon = sample ? Codicon.primitiveSquare : Codicon.play;
			if (play.dataset.icon !== icon.id) {
				play.dataset.icon = icon.id;
				play.replaceChildren(renderGlyph(icon));
			}
			play.classList.toggle('playing', !!sample);
			play.classList.toggle('loading', sample?.phase === 'loading');
			play.setAttribute('aria-label', sample
				? localize('basehalf.generation.voices.stopSampleOf', "Stop the Sample of {0}", voice.label)
				: localize('basehalf.generation.voices.playSampleOf', "Play the Sample of {0}", voice.label));
		}
		const failure = this.voices.sampleFailure;
		const shown = failure?.provider === this.target.provider.id ? failure : undefined;
		this.sampleStatus.hidden = !shown;
		this.sampleStatus.textContent = shown
			? localize('basehalf.generation.voices.sampleFailed', "The sample of {0} could not be played: {1}", this.nameOf(shown.voice), shown.message)
			: '';
	}

	/** The sample of the voice that loads or plays, when it is this voice's. */
	private playing(voice: IBaseHalfVoiceMenuVoice): IBaseHalfVoiceSample | undefined {
		const sample = this.voices.sample;
		return sample && sample.provider === this.target.provider.id && sample.voice === voice.id && sample.sample === voice.sample ? sample : undefined;
	}

	private nameOf(id: string): string {
		return [...this.options.values()].find(option => option.voice.id === id)?.voice.label ?? id;
	}

	/** Marks the current voice, and tells assistive technology which one it is. */
	private updateActive(scroll: boolean): void {
		for (const [key, { element }] of this.options) {
			const current = key === this.activeKey;
			element.classList.toggle('active', current);
			element.setAttribute('aria-selected', String(current));
			if (current && scroll) {
				this.reveal(element);
			}
		}
		if (this.activeKey && this.options.has(this.activeKey)) {
			this.search.setAttribute('aria-activedescendant', this.optionId(this.activeKey));
		} else {
			this.search.removeAttribute('aria-activedescendant');
		}
	}

	/** Scrolls the list, and nothing around it, so that the voice shows. */
	private reveal(option: HTMLElement): void {
		const top = option.offsetTop;
		const bottom = top + option.offsetHeight;
		if (top < this.list.scrollTop) {
			this.list.scrollTop = top;
		} else if (bottom > this.list.scrollTop + this.list.clientHeight) {
			this.list.scrollTop = bottom - this.list.clientHeight;
		}
	}

	//#endregion

	//#region Keys, choosing, and samples

	private onKeyDown(event: KeyboardEvent): void {
		if (event.isComposing || event.keyCode === 229) {
			return;
		}
		const handled = () => {
			event.preventDefault();
			event.stopPropagation();
		};
		if (event.key === 'Escape') {
			handled();
			this.delegate.dismiss();
			return;
		}
		if (event.key === 'Tab') {
			// The keyboard reaches Set Up and Try Again; past them it leaves the menu, which closes.
			handled();
			const action = this.statusAction.hidden ? undefined : this.statusAction;
			if (action && event.target === this.search && !event.shiftKey) {
				action.focus();
			} else if (action && event.target === action && event.shiftKey) {
				this.search.focus();
			} else {
				this.delegate.dismiss();
			}
			return;
		}
		if (event.target !== this.search) {
			return;
		}
		const keys = [...this.options.keys()];
		const index = this.activeKey ? keys.indexOf(this.activeKey) : -1;
		switch (event.key) {
			case 'ArrowDown':
			case 'ArrowUp': {
				handled();
				if (keys.length) {
					const step = event.key === 'ArrowDown' ? 1 : -1;
					this.activeKey = keys[index < 0 ? (step > 0 ? 0 : keys.length - 1) : (index + step + keys.length) % keys.length];
					this.updateActive(true);
				}
				return;
			}
			case 'Home':
			case 'End':
				if (keys.length && !this.search.value) {
					handled();
					this.activeKey = keys[event.key === 'Home' ? 0 : keys.length - 1];
					this.updateActive(true);
				}
				return;
			case 'Enter': {
				handled();
				const option = this.activeKey ? this.options.get(this.activeKey) : undefined;
				if (option) {
					this.delegate.choose(option.voice.id);
				}
				return;
			}
			case ' ': {
				// Space plays the current voice's sample: the search takes no spaces, and finds names without them.
				handled();
				const option = this.activeKey ? this.options.get(this.activeKey) : undefined;
				if (option?.voice.sample) {
					this.toggleSample(option.voice);
				}
				return;
			}
		}
	}

	private toggleSample(voice: IBaseHalfVoiceMenuVoice): void {
		if (this.playing(voice)) {
			this.voices.stopSample();
		} else if (voice.sample) {
			void this.voices.playSample(this.target.provider, this.target.model, voice.id, voice.sample);
		}
	}

	private runStatusAction(): void {
		if (this.statusKind === 'setUp') {
			// As the panel's other Set Up does: Providers, at the provider.
			void this.providerSettings.openSettings(this.target.provider.id).catch(error => this.logService.error(error));
		} else if (this.statusKind === 'retry') {
			this.ask();
		}
	}

	//#endregion

	private optionId(key: string): string {
		return `${this.id}-${encodeURIComponent(key).replace(/%/g, '_')}`;
	}
}

function renderGlyph(icon: ThemeIcon, className?: string): HTMLElement {
	const element = renderIcon(icon);
	if (className) {
		element.classList.add(className);
	}
	element.setAttribute('aria-hidden', 'true');
	return element;
}
