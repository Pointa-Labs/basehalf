/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { runWithFakedTimers } from '../../../../../base/test/common/timeTravelScheduler.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IBaseHalfProviderService } from '../../../../../platform/basehalfProviders/common/basehalfProviders.js';
import type { ProviderResponse, VoiceParameter, VoicePreviewRequest, VoicePreviewResult, VoicesRequest, VoicesResult } from '../../../../../platform/basehalfProviders/common/basehalfProviderTypes.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { playBaseHalfCanvasMediaOneAtATime, registerBaseHalfCanvasMediaPause } from '../../../canvas/browser/basehalfCanvasCardMedia.js';
import { IBaseHalfVideoSoundLevel } from '../../../canvas/browser/basehalfCanvasVideoSound.js';
import { BaseHalfGenerationVoiceMenu, IBaseHalfVoiceMenuTarget } from '../../browser/basehalfGenerationVoiceMenu.js';
import { BaseHalfGenerationVoiceService, IBaseHalfVoiceSampleContext, IBaseHalfVoiceSamplePlayback, IBaseHalfVoiceSampleSound } from '../../browser/basehalfGenerationVoiceService.js';
import { baseHalfVoiceLabel, baseHalfVoiceMenuStatus, baseHalfVoiceParameter, IBaseHalfGenerationVoiceService, parseBaseHalfVoicesResult } from '../../common/basehalfGenerationVoices.js';
import { findBaseHalfVideoRegion, IBaseHalfVideoCatalogModel, IBaseHalfVideoCatalogProvider, IBaseHalfVideoGenerationChoice, IBaseHalfVideoProviderAccess } from '../../common/basehalfVideoCatalog.js';
import { IBaseHalfVideoProviderSettingsService, IBaseHalfVideoProviderStatus } from '../../common/basehalfVideoGeneration.js';
import { TEST_AUDIO_CATALOG } from '../common/basehalfVideoCatalogFixture.js';

/** Dunlin Sound and its speech model as the window keeps them, whose voice the provider lists: Ember, the default, Pike, and Sable. */
const DUNLIN = TEST_AUDIO_CATALOG.providers.find(provider => provider.id === 'dunlin')!;
const SPEECH = DUNLIN.models.find(model => model.id === 'dunlin-voice')!;
const VOICE = baseHalfVoiceParameter(SPEECH)!;
/** The same model as one whose provider lists no voices: the catalog's are all of them. */
const CLOSED_VOICE: VoiceParameter = { ...VOICE, listed: undefined };
const CLOSED_SPEECH: IBaseHalfVideoCatalogModel = { ...SPEECH, parameters: SPEECH.parameters.map(parameter => parameter === VOICE ? CLOSED_VOICE : parameter) };
/** Dunlin Sound with a second region, whose voices are its own. */
const TWO_REGIONS: IBaseHalfVideoCatalogProvider = { ...DUNLIN, regions: [...DUNLIN.regions, { id: 'south', label: 'South', baseUrl: 'https://south.dunlin.example/v1' }] };

/** The voices Dunlin Sound lists: one the user cloned, then its own, one of them also in the catalog. */
const LIST: VoicesResult = {
	voices: [
		{ id: 'narrator-7', label: 'My Narrator', description: 'Cloned', own: true, sample: 'https://cdn.dunlin.example/narrator-7.mp3' },
		{ id: 'vx-ember', label: 'Ember (listed)', description: 'Warm, low, listed', own: false, sample: 'https://cdn.dunlin.example/vx-ember.mp3' },
		{ id: 'rachel', label: 'Rachel', description: 'Warm and calm', own: false, sample: 'https://cdn.dunlin.example/rachel.mp3' },
		{ id: 'adam', label: 'Adam', own: false }
	]
};

/** The first bytes of an MP3: an ID3 tag. */
const SAMPLE = VSBuffer.wrap(Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]));

const notUsed = (): never => {
	throw new Error('The voices use no other call of the provider service.');
};

/** The provider service of the shared process, as far as voices use it: `voices` and `voicePreview`, scripted. */
class FakeVoiceProviders {
	readonly listed: VoicesRequest[] = [];
	readonly previewed: VoicePreviewRequest[] = [];
	voices: (request: VoicesRequest) => unknown = () => ({ ok: true, value: LIST });
	preview: (request: VoicePreviewRequest) => unknown = () => ({ ok: true, value: { bytes: SAMPLE, format: 'mp3' } });

	readonly service: IBaseHalfProviderService = {
		_serviceBrand: undefined,
		catalog: notUsed,
		check: notUsed,
		submit: notUsed,
		poll: notUsed,
		download: notUsed,
		cancel: notUsed,
		place: notUsed,
		voices: async request => {
			this.listed.push(request);
			return await this.voices(request) as ProviderResponse<VoicesResult>;
		},
		voicePreview: async request => {
			this.previewed.push(request);
			return await this.preview(request) as ProviderResponse<VoicePreviewResult>;
		}
	};
}

class FakeProviderSettings extends Disposable implements IBaseHalfVideoProviderSettingsService {
	declare readonly _serviceBrand: undefined;
	private readonly changed = this._register(new Emitter<void>());
	readonly onDidChange = this.changed.event;
	readonly notSetUp = new Set<string>();
	/** The region in use of a provider, when it is not its first. */
	readonly regions = new Map<string, string>();
	/** Why the stored credentials cannot be read, when they cannot. */
	unreadable: string | undefined;
	readonly opened: (string | undefined)[] = [];

	getStatus(provider: IBaseHalfVideoCatalogProvider): IBaseHalfVideoProviderStatus {
		const region = findBaseHalfVideoRegion(provider, this.regions.get(provider.id));
		const setUp = !this.notSetUp.has(provider.id);
		return { region, setUp, endpoint: region.baseUrl, customEndpoint: false, credentials: new Set(setUp ? provider.credentials.map(credential => credential.id) : []) };
	}

	async setRegion(): Promise<void> { }
	async setEndpoint(): Promise<void> { }
	async setCredential(): Promise<void> { }

	async getAccess(provider: IBaseHalfVideoCatalogProvider): Promise<IBaseHalfVideoProviderAccess | undefined> {
		if (this.unreadable) {
			throw new Error(this.unreadable);
		}
		const region = findBaseHalfVideoRegion(provider, this.regions.get(provider.id));
		return this.notSetUp.has(provider.id) ? undefined : { provider: provider.id, region: region.id, endpoint: region.baseUrl, credentials: { apiKey: 'key-1' } };
	}

	getLastUsed(): IBaseHalfVideoGenerationChoice | undefined {
		return undefined;
	}

	setLastUsed(): void { }

	async openSettings(providerId?: string): Promise<void> {
		this.opened.push(providerId);
	}

	change(): void {
		this.changed.fire();
	}
}

/** The volume of a sample, as the graph would schedule it: every call, with its time. */
class RecordingLevel implements IBaseHalfVideoSoundLevel {
	value = 1;
	readonly calls: string[] = [];

	cancelScheduledValues(time: number): void {
		this.calls.push(`cancel ${at(time)}`);
	}

	setValueAtTime(value: number, time: number): void {
		this.calls.push(`set ${value} ${at(time)}`);
	}

	linearRampToValueAtTime(value: number, time: number): void {
		this.calls.push(`ramp ${value} ${at(time)}`);
	}
}

function at(time: number): string {
	return String(Math.round(time * 1000) / 1000);
}

interface IFakePlayback {
	readonly level: RecordingLevel;
	readonly stops: number[];
	disposed: boolean;
	/** The sound played to its end, or stopped. */
	end(): void;
}

/** The window's audio graph of a test: a clock that a test moves, and what it decoded and played. */
class FakeSampleContext implements IBaseHalfVoiceSampleContext {
	currentTime = 10;
	state = 'suspended';
	duration = 2;
	decodeFails = false;
	readonly log: string[] = [];
	readonly playbacks: IFakePlayback[] = [];

	async resume(): Promise<void> {
		this.state = 'running';
	}

	async suspend(): Promise<void> {
		this.state = 'suspended';
		this.log.push('suspend');
	}

	async close(): Promise<void> {
		this.state = 'closed';
	}

	async decode(bytes: ArrayBuffer): Promise<IBaseHalfVoiceSampleSound> {
		this.log.push(`decode ${bytes.byteLength} bytes`);
		if (this.decodeFails) {
			throw new Error('Unable to decode audio data');
		}
		return { duration: this.duration };
	}

	play(_sound: IBaseHalfVoiceSampleSound, ended: () => void): IBaseHalfVoiceSamplePlayback {
		const playback: IFakePlayback = { level: new RecordingLevel(), stops: [], disposed: false, end: ended };
		this.playbacks.push(playback);
		return {
			level: playback.level,
			stop: when => { playback.stops.push(when); },
			dispose: () => { playback.disposed = true; }
		};
	}
}

suite('BaseHalfGenerationVoiceMenu', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let providers: FakeVoiceProviders;
	let settings: FakeProviderSettings;
	let context: FakeSampleContext;
	let service: BaseHalfGenerationVoiceService;
	let instantiation: TestInstantiationService;
	let chosen: string[];
	let dismissed: number;
	let mounted: HTMLElement[];

	setup(() => {
		providers = new FakeVoiceProviders();
		settings = disposables.add(new FakeProviderSettings());
		context = new FakeSampleContext();
		service = disposables.add(new BaseHalfGenerationVoiceService(() => context, providers.service, settings, new NullLogService()));
		instantiation = disposables.add(new TestInstantiationService());
		instantiation.set(IBaseHalfGenerationVoiceService, service);
		instantiation.set(IBaseHalfVideoProviderSettingsService, settings);
		instantiation.set(IHoverService, NullHoverService);
		instantiation.set(ILogService, new NullLogService());
		chosen = [];
		dismissed = 0;
		mounted = [];
	});

	teardown(() => {
		for (const element of mounted) {
			element.remove();
		}
	});

	/** Opens the menu of Dunlin Voice, whose card speaks in Ember unless the target says otherwise. */
	function open(target?: Partial<IBaseHalfVoiceMenuTarget>): { readonly menu: BaseHalfGenerationVoiceMenu; readonly element: HTMLElement } {
		const element = mainWindow.document.createElement('div');
		element.className = 'bh-video-panel-menu voice';
		mainWindow.document.body.append(element);
		mounted.push(element);
		const menu = disposables.add(instantiation.createInstance(BaseHalfGenerationVoiceMenu, element, { provider: DUNLIN, model: SPEECH, parameter: VOICE, voice: 'vx-ember', ...target }, {
			choose: voice => { chosen.push(voice); },
			dismiss: () => { dismissed++; },
			layout: () => { }
		}));
		return { menu, element };
	}

	async function settle(): Promise<void> {
		for (let i = 0; i < 4; i++) {
			await timeout(1);
		}
	}

	/** What the list shows, from the top: `# ` for a section, `(…)` for a note, and each voice with its description, `[play]` or `[stop]`, a check, and `<` on the current one. */
	function rows(element: HTMLElement): string[] {
		const out: string[] = [];
		for (const node of element.querySelectorAll<HTMLElement>('.bh-voice-menu-list .bh-voice-menu-header, .bh-voice-menu-list .bh-voice-menu-option, .bh-voice-menu-list .bh-voice-menu-note')) {
			if (node.classList.contains('bh-voice-menu-header')) {
				out.push(`# ${node.textContent}`);
			} else if (node.classList.contains('bh-voice-menu-note')) {
				out.push(`(${node.textContent})`);
			} else {
				const description = node.querySelector('.bh-voice-menu-description')?.textContent;
				const play = node.querySelector<HTMLElement>('.bh-voice-menu-play');
				out.push([
					node.querySelector('.bh-voice-menu-name')?.textContent,
					...(description ? [`— ${description}`] : []),
					...(play ? [play.classList.contains('playing') ? '[stop]' : '[play]'] : []),
					...(node.getAttribute('aria-checked') === 'true' ? ['✓'] : []),
					...(node.classList.contains('active') ? ['<'] : [])
				].join(' '));
			}
		}
		return out;
	}

	/** The line under the search field and its action, as shown. */
	function status(element: HTMLElement): string | undefined {
		const line = element.querySelector<HTMLElement>('.bh-voice-menu-status:not(.sample)')!;
		if (line.hidden) {
			return undefined;
		}
		const action = line.querySelector<HTMLButtonElement>('.bh-voice-menu-status-action')!;
		return `${line.querySelector('.bh-voice-menu-status-text')?.textContent}${action.hidden ? '' : ` [${action.textContent}]`}`;
	}

	function search(element: HTMLElement): HTMLInputElement {
		return element.querySelector<HTMLInputElement>('.bh-voice-menu-search input')!;
	}

	function option(element: HTMLElement, name: string): HTMLElement {
		const found = [...element.querySelectorAll<HTMLElement>('.bh-voice-menu-option')].find(candidate => candidate.querySelector('.bh-voice-menu-name')?.textContent === name);
		assert.ok(found, `The menu lists no ${name}.`);
		return found;
	}

	function play(element: HTMLElement, name: string): HTMLButtonElement {
		const button = option(element, name).querySelector<HTMLButtonElement>('.bh-voice-menu-play');
		assert.ok(button, `${name} has no play button.`);
		return button;
	}

	function press(target: HTMLElement, key: string, init?: KeyboardEventInit): KeyboardEvent {
		const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
		target.dispatchEvent(event);
		return event;
	}

	function type(field: HTMLInputElement, value: string): void {
		field.value = value;
		field.dispatchEvent(new InputEvent('input', { bubbles: true }));
	}

	test('lists Your Voices and Voices, the catalog\'s first, each voice once, with its description, its sample, and a check on the card\'s voice; while the first list loads it says so', async () => {
		const answer = new DeferredPromise<unknown>();
		providers.voices = () => answer.p;
		const { element } = open();
		const loading = { rows: rows(element), status: status(element) };
		// A menu opened again while the request runs asks nothing more.
		open().menu.dispose();
		answer.complete({ ok: true, value: LIST });
		await service.refresh(DUNLIN, SPEECH);
		assert.deepStrictEqual({ loading, listed: rows(element), status: status(element), asked: providers.listed }, {
			// The catalog's voices, which every account has, while the provider is asked.
			loading: { rows: ['# Voices', 'Ember — Warm, low ✓ <', 'Pike — Bright, quick', 'Sable'], status: 'Loading voices…' },
			listed: [
				'# Your Voices',
				'My Narrator — Cloned [play]',
				'# Voices',
				// The catalog's name and description, with the sample the provider lists for it.
				'Ember — Warm, low [play] ✓ <',
				'Pike — Bright, quick',
				'Sable',
				'Rachel — Warm and calm [play]',
				'Adam'
			],
			status: undefined,
			// Asked with this computer's access, as a generation asks.
			asked: [{ provider: 'dunlin', region: 'main', endpoint: 'https://api.dunlin.example/v1', credentials: { apiKey: 'key-1' }, model: 'dunlin-voice' }]
		});
	});

	test('typing in the search field keeps the voices whose name or description holds it, and says when none does', async () => {
		const { element } = open();
		await service.refresh(DUNLIN, SPEECH);
		const field = search(element);
		type(field, 'QUICK');
		const byDescription = rows(element);
		type(field, 'warm and');
		const withSpace = rows(element);
		type(field, 'narr');
		const yours = rows(element);
		type(field, 'zebra');
		const none = rows(element);
		assert.deepStrictEqual({ byDescription, withSpace, yours, none }, {
			// The first voice found is the current one.
			byDescription: ['# Voices', 'Pike — Bright, quick <'],
			withSpace: ['# Voices', 'Rachel — Warm and calm [play] <'],
			yours: ['# Your Voices', 'My Narrator — Cloned [play] <'],
			none: ['(No voice here has that name or description.)']
		});
	});

	test('a click or Enter chooses a voice for the panel to save; Up and Down move through the voices from the search field, and Escape closes the menu', async () => {
		const { menu, element } = open();
		await service.refresh(DUNLIN, SPEECH);
		menu.focus();
		const field = search(element);
		const focused = mainWindow.document.activeElement === field;
		press(field, 'ArrowDown');
		press(field, 'ArrowDown');
		press(field, 'ArrowDown');
		const current = rows(element).find(row => row.endsWith('<'));
		const activeDescendant = field.getAttribute('aria-activedescendant') === option(element, 'Rachel').id;
		press(field, 'Enter');
		option(element, 'Adam').click();
		press(field, 'ArrowUp');
		press(field, 'Escape');
		assert.deepStrictEqual({ focused, current, activeDescendant, chosen, dismissed }, {
			focused: true,
			current: 'Rachel — Warm and calm [play] <',
			activeDescendant: true,
			chosen: ['rachel', 'adam'],
			dismissed: 1
		});
	});

	test('a sample plays through the window\'s own audio graph, coming up over 40 ms and going down over 60 ms; its button and Space stop it, another sample stops it, and closing the menu stops it', async () => {
		const { menu, element } = open();
		await service.refresh(DUNLIN, SPEECH);
		play(element, 'Ember').click();
		const loadingRow = rows(element)[3];
		await settle();
		const first = context.playbacks[0];
		const playing = { row: rows(element)[3], label: play(element, 'Ember').getAttribute('aria-label'), level: [...first.level.calls], sample: service.sample?.phase };
		context.currentTime = 10.5;
		play(element, 'Ember').click();
		const stopped = { level: first.level.calls.slice(5), stops: first.stops.map(at), row: rows(element)[3], sample: service.sample };
		first.end();
		// Space plays the current voice, and a second sample stops the first.
		press(search(element), 'ArrowDown');
		press(search(element), 'ArrowDown');
		press(search(element), 'ArrowDown');
		const space = press(search(element), ' ');
		await settle();
		context.currentTime = 11;
		play(element, 'My Narrator').click();
		await settle();
		const second = context.playbacks[1];
		const replaced = { spaceTyped: !space.defaultPrevented, field: search(element).value, stops: second.stops.map(at), playing: service.sample?.voice };
		context.currentTime = 11.25;
		menu.dispose();
		assert.deepStrictEqual({
			loadingRow,
			playing,
			stopped,
			replaced,
			closed: { stops: context.playbacks[2].stops.map(at), sample: service.sample },
			fetched: providers.previewed.map(request => `${request.model} ${request.sample} ${request.credentials.apiKey}`),
			decoded: context.log
		}, {
			loadingRow: 'Ember — Warm, low [stop] ✓ <',
			playing: {
				row: 'Ember — Warm, low [stop] ✓ <',
				label: 'Stop the Sample of Ember',
				// From silence at 10 s up to full over 40 ms, and down over the last 100 ms of its two seconds.
				level: ['cancel 10', 'set 0 10', 'ramp 1 10.04', 'set 1 11.9', 'ramp 0 12'],
				sample: 'playing'
			},
			stopped: { level: ['cancel 10.5', 'set 1 10.5', 'ramp 0 10.56'], stops: ['10.56'], row: 'Ember — Warm, low [play] ✓ <', sample: undefined },
			replaced: { spaceTyped: false, field: '', stops: ['11.06'], playing: 'narrator-7' },
			closed: { stops: ['11.31'], sample: undefined },
			fetched: [
				'dunlin-voice https://cdn.dunlin.example/vx-ember.mp3 key-1',
				'dunlin-voice https://cdn.dunlin.example/rachel.mp3 key-1',
				'dunlin-voice https://cdn.dunlin.example/narrator-7.mp3 key-1'
			],
			decoded: ['decode 10 bytes', 'decode 10 bytes', 'decode 10 bytes']
		});
	});

	test('a sample pauses what plays on the canvas, and a video or a sound that starts there stops the sample', async () => {
		const root = mainWindow.document.createElement('div');
		mainWindow.document.body.append(root);
		mounted.push(root);
		disposables.add(playBaseHalfCanvasMediaOneAtATime(root));
		const video = mainWindow.document.createElement('video');
		root.append(video);
		const paused: string[] = [];
		disposables.add(registerBaseHalfCanvasMediaPause(video, () => paused.push('the card\'s video, its sound down first')));
		video.dispatchEvent(new Event('play'));
		const { element } = open();
		await service.refresh(DUNLIN, SPEECH);
		play(element, 'Rachel').click();
		await settle();
		const whileSample = [...paused];
		context.currentTime = 10.25;
		const sound = mainWindow.document.createElement('audio');
		root.append(sound);
		sound.dispatchEvent(new Event('play'));
		assert.deepStrictEqual({ whileSample, sample: service.sample, stops: context.playbacks[0].stops.map(at), row: rows(element).find(row => row.startsWith('Rachel')) }, {
			whileSample: ['the card\'s video, its sound down first'],
			sample: undefined,
			stops: ['10.31'],
			row: 'Rachel — Warm and calm [play]'
		});
	});

	test('a sample that cannot be fetched or played says why under the search field, until another is played', async () => {
		const { element } = open();
		await service.refresh(DUNLIN, SPEECH);
		providers.preview = () => ({ ok: false, error: { code: 'notAudio', message: 'The sample is not a sound.' } });
		play(element, 'Ember').click();
		await settle();
		const line = () => {
			const sample = element.querySelector<HTMLElement>('.bh-voice-menu-status.sample')!;
			return sample.hidden ? undefined : sample.textContent;
		};
		const refused = line();
		providers.preview = () => ({ ok: true, value: { bytes: SAMPLE, format: 'mp3' } });
		context.decodeFails = true;
		play(element, 'Rachel').click();
		await settle();
		const undecodable = line();
		context.decodeFails = false;
		play(element, 'Rachel').click();
		await settle();
		assert.deepStrictEqual({ refused, undecodable, after: line(), playing: service.sample?.voice }, {
			refused: 'The sample of Ember could not be played: The sample is not a sound.',
			undecodable: 'The sample of Rachel could not be played: BaseHalf cannot play the sound of this sample.',
			after: undefined,
			playing: 'rachel'
		});
	});

	test('with the provider not set up, the menu lists the catalog\'s voices and says how to get the others, asks nothing, and Set Up opens Providers at the provider', async () => {
		settings.notSetUp.add('dunlin');
		const { element } = open();
		await settle();
		const shown = { rows: rows(element), status: status(element), asked: providers.listed.length };
		element.querySelector<HTMLButtonElement>('.bh-voice-menu-status-action')!.click();
		assert.deepStrictEqual({ shown, opened: settings.opened }, {
			shown: {
				rows: ['# Voices', 'Ember — Warm, low ✓ <', 'Pike — Bright, quick', 'Sable'],
				status: 'Set up Dunlin Sound to choose from all of its voices and your own. [Set Up]',
				asked: 0
			},
			opened: ['dunlin']
		});
	});

	test('a list that cannot be loaded shows the catalog\'s voices with the reason and Try Again, which asks again; the menu opened next shows the last list while it asks', async () => {
		providers.voices = () => ({ ok: false, error: { code: 'auth', message: 'The API key is not valid.' } });
		const { menu, element } = open();
		await service.refresh(DUNLIN, SPEECH);
		const failed = { rows: rows(element), status: status(element) };
		providers.voices = () => ({ ok: true, value: LIST });
		element.querySelector<HTMLButtonElement>('.bh-voice-menu-status-action')!.click();
		await service.refresh(DUNLIN, SPEECH);
		const retried = { rows: rows(element).length, status: status(element), asked: providers.listed.length };
		menu.dispose();
		const answer = new DeferredPromise<unknown>();
		providers.voices = () => answer.p;
		const reopened = open();
		const meanwhile = { rows: rows(reopened.element).slice(0, 4), status: status(reopened.element) };
		answer.complete({ ok: false, error: { code: 'network', message: 'The network is down.' } });
		await service.refresh(DUNLIN, SPEECH);
		assert.deepStrictEqual({ failed, retried, meanwhile, failedAgain: { rows: rows(reopened.element).length, status: status(reopened.element), asked: providers.listed.length } }, {
			failed: { rows: ['# Voices', 'Ember — Warm, low ✓ <', 'Pike — Bright, quick', 'Sable'], status: 'The voices could not be loaded: The API key is not valid. [Try Again]' },
			retried: { rows: 8, status: undefined, asked: 2 },
			meanwhile: { rows: ['# Your Voices', 'My Narrator — Cloned [play]', '# Voices', 'Ember — Warm, low [play] ✓ <'], status: undefined },
			// The last list stays, with the reason the new one could not be loaded.
			failedAgain: { rows: 8, status: 'The voices could not be loaded: The network is down. [Try Again]', asked: 3 }
		});
	});

	test('credentials that a provider of two regions refused at its region\'s address name that region and the other one; another refusal names none (D94)', async () => {
		providers.voices = () => ({ ok: false, error: { code: 'auth', message: 'The API key is not valid.' } });
		const first = open({ provider: TWO_REGIONS });
		await service.refresh(TWO_REGIONS, SPEECH);
		const refused = status(first.element);
		first.menu.dispose();
		settings.regions.set(TWO_REGIONS.id, 'south');
		const second = open({ provider: TWO_REGIONS });
		await service.refresh(TWO_REGIONS, SPEECH);
		const south = status(second.element);
		second.menu.dispose();
		providers.voices = () => ({ ok: false, error: { code: 'rateLimited', message: 'Too many requests.' } });
		const third = open({ provider: TWO_REGIONS });
		await service.refresh(TWO_REGIONS, SPEECH);
		assert.deepStrictEqual({ refused, south, busy: status(third.element) }, {
			refused: 'The voices could not be loaded: Credentials refused in Dunlin. If they are from South, choose that region in Providers: The API key is not valid. [Try Again]',
			south: 'The voices could not be loaded: Credentials refused in South. If they are from Dunlin, choose that region in Providers: The API key is not valid. [Try Again]',
			busy: 'The voices could not be loaded: Too many requests. [Try Again]'
		});
	});

	test('a provider that had more voices than BaseHalf keeps says so at the end of the list', async () => {
		const voices = Array.from({ length: 2000 }, (_value, index) => ({ id: `voice-${index}`, label: `Voice ${index}`, own: false }));
		providers.voices = () => ({ ok: true, value: { voices: [...voices, { id: 'voice-2000', label: 'Voice 2000', own: false }] } });
		const { element } = open();
		await service.refresh(DUNLIN, SPEECH);
		const shown = rows(element);
		assert.deepStrictEqual({ count: shown.length, first: shown.slice(0, 5), last: shown.slice(-2) }, {
			// The catalog's three voices, then the 2,000 the window keeps.
			count: 2005,
			first: ['# Voices', 'Ember — Warm, low ✓ <', 'Pike — Bright, quick', 'Sable', 'Voice 0'],
			last: ['Voice 1999', '(Showing the first 2,000 voices.)']
		});
	});

	test('a voice of the card that no list names heads Voices by its id, and once the list came, says that it is not among the account\'s voices', async () => {
		const answer = new DeferredPromise<unknown>();
		providers.voices = () => answer.p;
		const { element } = open({ voice: 'cloned-elsewhere' });
		const beforeList = rows(element).slice(0, 2);
		answer.complete({ ok: true, value: LIST });
		await service.refresh(DUNLIN, SPEECH);
		assert.deepStrictEqual({ beforeList, listed: rows(element).slice(2, 4), name: baseHalfVoiceLabel(VOICE, 'cloned-elsewhere', LIST) }, {
			beforeList: ['# Voices', 'cloned-elsewhere ✓ <'],
			listed: ['# Voices', 'cloned-elsewhere — Not among the voices of this account. ✓ <'],
			name: 'cloned-elsewhere'
		});
	});

	test('a list cut at 2,000 says nothing of a voice it does not name, which may be beyond the first 2,000', async () => {
		providers.voices = () => ({ ok: true, value: { ...LIST, truncated: true } });
		const { element } = open({ voice: 'cloned-elsewhere' });
		await service.refresh(DUNLIN, SPEECH);
		const shown = rows(element);
		assert.deepStrictEqual({ voice: shown.slice(2, 4), last: shown[shown.length - 1] }, {
			voice: ['# Voices', 'cloned-elsewhere ✓ <'],
			last: '(Showing the first 4 voices.)'
		});
	});

	test('an open menu asks again when its provider becomes set up or moves to another region, and says that the voices load until they come', async () => {
		settings.notSetUp.add('dunlin');
		const { element } = open({ provider: TWO_REGIONS });
		await settle();
		const notSetUp = { status: status(element), asked: providers.listed.length };
		const answer = new DeferredPromise<unknown>();
		providers.voices = () => answer.p;
		// The user sets the provider up in Providers while the menu is open.
		settings.notSetUp.delete('dunlin');
		settings.change();
		const atOnce = status(element);
		await settle();
		const setUp = { atOnce, status: status(element), asked: providers.listed.map(request => request.region) };
		answer.complete({ ok: true, value: LIST });
		await settle();
		const listed = { status: status(element), rows: rows(element).slice(0, 2) };
		// Another region of the provider has lists of its own.
		providers.voices = () => ({ ok: true, value: { voices: [{ id: 'south-1', label: 'Southern', own: false }] } });
		settings.regions.set('dunlin', 'south');
		settings.change();
		const moving = status(element);
		await settle();
		// A change of anything else asks nothing more.
		settings.change();
		await settle();
		assert.deepStrictEqual({
			notSetUp,
			setUp,
			listed,
			moving,
			south: { rows: rows(element).slice(4), asked: providers.listed.map(request => request.region) },
			// A set-up provider without a list yet says that it loads, before and while the menu asks.
			neverAsked: baseHalfVoiceMenuStatus({ listed: true, setUp: true, providerLabel: DUNLIN.label, voices: { loading: false } })
		}, {
			notSetUp: { status: 'Set up Dunlin Sound to choose from all of its voices and your own. [Set Up]', asked: 0 },
			setUp: { atOnce: 'Loading voices…', status: 'Loading voices…', asked: ['main'] },
			listed: { status: undefined, rows: ['# Your Voices', 'My Narrator — Cloned [play]'] },
			moving: 'Loading voices…',
			south: { rows: ['Southern'], asked: ['main', 'south'] },
			neverAsked: { text: 'Loading voices…' }
		});
	});

	test('a model whose provider lists no voices offers the catalog\'s voices alone and asks nothing', async () => {
		const { element } = open({ model: CLOSED_SPEECH, parameter: CLOSED_VOICE, voice: 'vx-sable' });
		await settle();
		assert.deepStrictEqual({ rows: rows(element), status: status(element), asked: providers.listed.length }, {
			rows: ['# Voices', 'Ember — Warm, low', 'Pike — Bright, quick', 'Sable ✓ <'],
			status: undefined,
			asked: 0
		});
	});

	test('Tab reaches Set Up from the search field and leaves the menu after it; Space never types into the search', async () => {
		settings.notSetUp.add('dunlin');
		const { menu, element } = open();
		menu.focus();
		const field = search(element);
		const space = press(field, ' ');
		press(field, 'Tab');
		const onAction = mainWindow.document.activeElement === element.querySelector('.bh-voice-menu-status-action');
		press(mainWindow.document.activeElement as HTMLElement, 'Tab', { shiftKey: true });
		const back = mainWindow.document.activeElement === field;
		press(field, 'Tab');
		press(mainWindow.document.activeElement as HTMLElement, 'Tab');
		assert.deepStrictEqual({ spaceTyped: !space.defaultPrevented, onAction, back, dismissed }, { spaceTyped: false, onAction: true, back: true, dismissed: 1 });
	});

	test('the window keeps the last list per provider and region, asks once at a time, and says why when the credentials cannot be read', async () => {
		const answer = new DeferredPromise<unknown>();
		providers.voices = () => answer.p;
		const first = service.refresh(DUNLIN, SPEECH);
		const second = service.refresh(DUNLIN, SPEECH);
		const whileAsked = service.voices('dunlin', 'main');
		answer.complete({ ok: true, value: LIST });
		await Promise.all([first, second]);
		const kept = service.voices('dunlin', 'main');
		settings.unreadable = 'BaseHalf cannot read the credentials of Dunlin Sound. Set them again in Providers.';
		await service.refresh(DUNLIN, SPEECH);
		assert.deepStrictEqual({
			asked: providers.listed.length,
			whileAsked,
			kept: { voices: kept.list?.voices.length, loading: kept.loading },
			otherRegion: service.voices('dunlin', 'elsewhere'),
			unreadable: { voices: service.voices('dunlin', 'main').list?.voices.length, error: service.voices('dunlin', 'main').error }
		}, {
			asked: 1,
			whileAsked: { loading: true },
			kept: { voices: 4, loading: false },
			otherRegion: { loading: false },
			unreadable: { voices: 4, error: 'BaseHalf cannot read the credentials of Dunlin Sound. Set them again in Providers.' }
		});
	});

	test('asks once to name a voice that only the list names: one request while it is on its way, none after an answer or a failure, none for another region than the one in use, and none until the provider is set up (D78)', async () => {
		// A provider that is not set up is not asked, and nothing kept stops the window from asking once it is.
		settings.notSetUp.add('dunlin');
		await service.askOnce(DUNLIN, SPEECH, 'main');
		const notSetUp = { asked: providers.listed.length, voices: service.voices('dunlin', 'main') };
		settings.notSetUp.delete('dunlin');
		// The list of the region in use names none of another region's voices.
		await service.askOnce(TWO_REGIONS, SPEECH, 'south');
		const otherRegion = providers.listed.length;
		const answer = new DeferredPromise<unknown>();
		providers.voices = () => answer.p;
		const first = service.askOnce(DUNLIN, SPEECH, 'main');
		const second = service.askOnce(DUNLIN, SPEECH, 'main');
		const whileAsked = service.voices('dunlin', 'main');
		answer.complete({ ok: true, value: LIST });
		await Promise.all([first, second]);
		const answered = { asked: providers.listed.map(request => request.region), voices: service.voices('dunlin', 'main').list?.voices.length };
		// Drawing again asks nothing more after an answer, nor after a failure.
		await service.askOnce(DUNLIN, SPEECH, 'main');
		settings.regions.set('dunlin', 'south');
		providers.voices = () => ({ ok: false, error: { code: 'network', message: 'The network is down.' } });
		await service.askOnce(TWO_REGIONS, SPEECH, 'south');
		await service.askOnce(TWO_REGIONS, SPEECH, 'south');
		assert.deepStrictEqual({
			notSetUp,
			otherRegion,
			whileAsked,
			answered,
			afterwards: providers.listed.map(request => request.region),
			failed: service.voices('dunlin', 'south')
		}, {
			notSetUp: { asked: 0, voices: { loading: false } },
			otherRegion: 0,
			whileAsked: { loading: true },
			answered: { asked: ['main'], voices: 4 },
			afterwards: ['main', 'south'],
			failed: { loading: false, error: 'The network is down.' }
		});
	});

	test('the window\'s sound output for samples stops five seconds after the last one ended', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		await service.playSample(DUNLIN, SPEECH, 'rachel', 'https://cdn.dunlin.example/rachel.mp3');
		const playing = context.state;
		context.playbacks[0].end();
		await timeout(4999);
		const before = context.log.includes('suspend');
		await timeout(1);
		assert.deepStrictEqual({ playing, before, after: context.log.includes('suspend'), disposed: context.playbacks[0].disposed, sample: service.sample }, {
			playing: 'running',
			before: false,
			after: true,
			disposed: true,
			sample: undefined
		});
	}));

	test('reads what the provider service listed: an id of a voice by the service\'s own rule, each once, at most 2,000, names as plain text, and samples only at web addresses', () => {
		const capped = parseBaseHalfVoicesResult({ voices: Array.from({ length: 2001 }, (_value, index) => ({ id: `v${index}`, label: `V ${index}`, own: false })) });
		// 256 characters of two UTF-16 units each: the rule counts characters, as the provider service does (`isVoiceId`).
		const clefs = '\u{1D11E}'.repeat(256);
		assert.deepStrictEqual({
			read: parseBaseHalfVoicesResult({
				voices: [
					{ id: 'a', label: ' A  <b>voice</b>\n', description: 'Deep,\u0007 slow', own: true, sample: 'javascript:alert(1)' },
					{ id: 'a', label: 'Again' },
					{ id: '' },
					{ id: '   ' },
					{ id: 'b\u0000' },
					{ id: 'b\u0085' },
					{ id: 'x'.repeat(257) },
					'not a voice',
					{ id: 'c', label: '', description: 7, own: 'yes', sample: 'https://cdn.example/c.mp3' }
				]
			}),
			characters: parseBaseHalfVoicesResult({ voices: [{ id: clefs, label: 'Clef', own: false }, { id: `${clefs}\u{1D11E}`, label: 'Too long', own: false }] })?.voices.map(voice => voice.label),
			capped: { length: capped?.voices.length, truncated: capped?.truncated },
			notAList: parseBaseHalfVoicesResult({ voices: 'none' })
		}, {
			read: {
				voices: [
					{ id: 'a', label: 'A voice', description: 'Deep, slow', own: true },
					{ id: 'c', label: 'c', own: false, sample: 'https://cdn.example/c.mp3' }
				]
			},
			characters: ['Clef'],
			capped: { length: 2000, truncated: true },
			notAList: undefined
		});
	});

	test('keeps the samples and the names the provider service keeps: an address of up to 8,192 characters, and names cut by characters, never between the halves of one', () => {
		const head = 'https://cdn.example/sample.mp3?X-Signature=';
		const signed = (length: number) => `${head}${'s'.repeat(length - head.length)}`;
		// A character of two UTF-16 units: the service counts 200 of them as a name of 200 characters.
		const wide = '\u{20000}';
		const read = parseBaseHalfVoicesResult({
			voices: [
				{ id: 'long', label: 'Long', own: false, sample: signed(5000) },
				{ id: 'longest', label: 'Longest', own: false, sample: signed(8192) },
				{ id: 'too-long', label: 'Too long', own: false, sample: signed(8193) },
				{ id: 'wide', label: wide.repeat(200), description: wide.repeat(300), own: false },
				{ id: 'wider', label: wide.repeat(201), description: wide.repeat(301), own: false }
			]
		})!;
		assert.deepStrictEqual({
			samples: read.voices.slice(0, 3).map(voice => voice.sample?.length),
			// The service's names come whole; a longer one is cut to 199 characters and an ellipsis.
			names: read.voices.slice(3).map(voice => [voice.label === wide.repeat(200), [...voice.label].length, voice.label.endsWith(`${wide}…`), [...voice.description ?? ''].length])
		}, {
			samples: [5000, 8192, undefined],
			names: [[true, 200, false, 300], [false, 200, true, 300]]
		});
	});
});
