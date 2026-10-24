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
import type { ProviderResponse, VoicePreviewRequest, VoicePreviewResult, VoicesRequest, VoicesResult } from '../../../../../platform/basehalfProviders/common/basehalfProviderTypes.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { playBaseHalfCanvasMediaOneAtATime, registerBaseHalfCanvasMediaPause } from '../../../canvas/browser/basehalfCanvasCardMedia.js';
import { IBaseHalfVideoSoundLevel } from '../../../canvas/browser/basehalfCanvasVideoSound.js';
import {
	BaseHalfGenerationVoiceMenu,
	BaseHalfGenerationVoiceService,
	IBaseHalfVoiceMenuTarget,
	IBaseHalfVoiceSampleContext,
	IBaseHalfVoiceSamplePlayback,
	IBaseHalfVoiceSampleSound
} from '../../browser/basehalfGenerationVoiceMenu.js';
import { baseHalfVoiceLabel, IBaseHalfGenerationVoiceService, parseBaseHalfVoicesResult } from '../../common/basehalfGenerationVoices.js';
import { findBaseHalfVideoRegion, IBaseHalfVideoCatalogProvider, IBaseHalfVideoGenerationChoice, IBaseHalfVideoProviderAccess } from '../../common/basehalfVideoCatalog.js';
import { IBaseHalfVideoProviderSettingsService, IBaseHalfVideoProviderStatus } from '../../common/basehalfVideoGeneration.js';
import { DULCET, DULCET_SPEECH, DULCET_VOICE, EMBER, EMBER_VOICE } from '../common/basehalfGenerationAudioCatalogFixture.js';

/** The voices Dulcet Voice lists: one the user cloned, then its own, one of them also in the catalog. */
const LIST: VoicesResult = {
	voices: [
		{ id: 'narrator-7', label: 'My Narrator', description: 'Cloned', own: true, sample: 'https://cdn.dulcet.example/narrator-7.mp3' },
		{ id: 'kore', label: 'Kore (listed)', description: 'Firm, female', own: false, sample: 'https://cdn.dulcet.example/kore.mp3' },
		{ id: 'rachel', label: 'Rachel', description: 'Warm and calm', own: false, sample: 'https://cdn.dulcet.example/rachel.mp3' },
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
	/** Why the stored credentials cannot be read, when they cannot. */
	unreadable: string | undefined;
	readonly opened: (string | undefined)[] = [];

	getStatus(provider: IBaseHalfVideoCatalogProvider): IBaseHalfVideoProviderStatus {
		const region = findBaseHalfVideoRegion(provider, undefined);
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
		const region = findBaseHalfVideoRegion(provider, undefined);
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

	/** Opens the menu of Dulcet Speech 2, whose card speaks in Kore unless the target says otherwise. */
	function open(target?: Partial<IBaseHalfVoiceMenuTarget>): { readonly menu: BaseHalfGenerationVoiceMenu; readonly element: HTMLElement } {
		const element = mainWindow.document.createElement('div');
		element.className = 'bh-video-panel-menu voice';
		mainWindow.document.body.append(element);
		mounted.push(element);
		const menu = disposables.add(instantiation.createInstance(BaseHalfGenerationVoiceMenu, element, { provider: DULCET, model: DULCET_SPEECH, parameter: DULCET_VOICE, voice: 'kore', ...target }, {
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
		await service.refresh(DULCET, DULCET_SPEECH);
		assert.deepStrictEqual({ loading, listed: rows(element), status: status(element), asked: providers.listed }, {
			// The catalog's voices, which every account has, while the provider is asked.
			loading: { rows: ['# Voices', 'Kore — Firm ✓ <', 'Puck — Upbeat'], status: 'Loading voices…' },
			listed: [
				'# Your Voices',
				'My Narrator — Cloned [play]',
				'# Voices',
				// The catalog's name and description, with the sample the provider lists for it.
				'Kore — Firm [play] ✓ <',
				'Puck — Upbeat',
				'Rachel — Warm and calm [play]',
				'Adam'
			],
			status: undefined,
			// Asked with this computer's access, as a generation asks.
			asked: [{ provider: 'dulcet', region: 'main', endpoint: 'https://api.dulcet.example', credentials: { apiKey: 'key-1' }, model: 'dulcet-speech-2' }]
		});
	});

	test('typing in the search field keeps the voices whose name or description holds it, and says when none does', async () => {
		const { element } = open();
		await service.refresh(DULCET, DULCET_SPEECH);
		const field = search(element);
		type(field, 'UP');
		const byDescription = rows(element);
		type(field, 'warm and');
		const withSpace = rows(element);
		type(field, 'narr');
		const yours = rows(element);
		type(field, 'zebra');
		const none = rows(element);
		assert.deepStrictEqual({ byDescription, withSpace, yours, none }, {
			// The first voice found is the current one.
			byDescription: ['# Voices', 'Puck — Upbeat <'],
			withSpace: ['# Voices', 'Rachel — Warm and calm [play] <'],
			yours: ['# Your Voices', 'My Narrator — Cloned [play] <'],
			none: ['(No voice here has that name or description.)']
		});
	});

	test('a click or Enter chooses a voice for the panel to save; Up and Down move through the voices from the search field, and Escape closes the menu', async () => {
		const { menu, element } = open();
		await service.refresh(DULCET, DULCET_SPEECH);
		menu.focus();
		const field = search(element);
		const focused = mainWindow.document.activeElement === field;
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
		await service.refresh(DULCET, DULCET_SPEECH);
		play(element, 'Kore').click();
		const loadingRow = rows(element)[3];
		await settle();
		const first = context.playbacks[0];
		const playing = { row: rows(element)[3], label: play(element, 'Kore').getAttribute('aria-label'), level: [...first.level.calls], sample: service.sample?.phase };
		context.currentTime = 10.5;
		play(element, 'Kore').click();
		const stopped = { level: first.level.calls.slice(5), stops: first.stops.map(at), row: rows(element)[3], sample: service.sample };
		first.end();
		// Space plays the current voice, and a second sample stops the first.
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
			loadingRow: 'Kore — Firm [stop] ✓ <',
			playing: {
				row: 'Kore — Firm [stop] ✓ <',
				label: 'Stop the Sample of Kore',
				// From silence at 10 s up to full over 40 ms, and down over the last 100 ms of its two seconds.
				level: ['cancel 10', 'set 0 10', 'ramp 1 10.04', 'set 1 11.9', 'ramp 0 12'],
				sample: 'playing'
			},
			stopped: { level: ['cancel 10.5', 'set 1 10.5', 'ramp 0 10.56'], stops: ['10.56'], row: 'Kore — Firm [play] ✓ <', sample: undefined },
			replaced: { spaceTyped: false, field: '', stops: ['11.06'], playing: 'narrator-7' },
			closed: { stops: ['11.31'], sample: undefined },
			fetched: [
				'dulcet-speech-2 https://cdn.dulcet.example/kore.mp3 key-1',
				'dulcet-speech-2 https://cdn.dulcet.example/rachel.mp3 key-1',
				'dulcet-speech-2 https://cdn.dulcet.example/narrator-7.mp3 key-1'
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
		await service.refresh(DULCET, DULCET_SPEECH);
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
		await service.refresh(DULCET, DULCET_SPEECH);
		providers.preview = () => ({ ok: false, error: { code: 'notAudio', message: 'The sample is not a sound.' } });
		play(element, 'Kore').click();
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
			refused: 'The sample of Kore could not be played: The sample is not a sound.',
			undecodable: 'The sample of Rachel could not be played: BaseHalf cannot play the sound of this sample.',
			after: undefined,
			playing: 'rachel'
		});
	});

	test('with the provider not set up, the menu lists the catalog\'s voices and says how to get the others, asks nothing, and Set Up opens Providers at the provider', async () => {
		settings.notSetUp.add('dulcet');
		const { element } = open();
		await settle();
		const shown = { rows: rows(element), status: status(element), asked: providers.listed.length };
		element.querySelector<HTMLButtonElement>('.bh-voice-menu-status-action')!.click();
		assert.deepStrictEqual({ shown, opened: settings.opened }, {
			shown: {
				rows: ['# Voices', 'Kore — Firm ✓ <', 'Puck — Upbeat'],
				status: 'Set up Dulcet Voice to choose from all of its voices and your own. [Set Up]',
				asked: 0
			},
			opened: ['dulcet']
		});
	});

	test('a list that cannot be loaded shows the catalog\'s voices with the reason and Try Again, which asks again; the menu opened next shows the last list while it asks', async () => {
		providers.voices = () => ({ ok: false, error: { code: 'auth', message: 'The API key is not valid.' } });
		const { menu, element } = open();
		await service.refresh(DULCET, DULCET_SPEECH);
		const failed = { rows: rows(element), status: status(element) };
		providers.voices = () => ({ ok: true, value: LIST });
		element.querySelector<HTMLButtonElement>('.bh-voice-menu-status-action')!.click();
		await service.refresh(DULCET, DULCET_SPEECH);
		const retried = { rows: rows(element).length, status: status(element), asked: providers.listed.length };
		menu.dispose();
		const answer = new DeferredPromise<unknown>();
		providers.voices = () => answer.p;
		const reopened = open();
		const meanwhile = { rows: rows(reopened.element).slice(0, 4), status: status(reopened.element) };
		answer.complete({ ok: false, error: { code: 'network', message: 'The network is down.' } });
		await service.refresh(DULCET, DULCET_SPEECH);
		assert.deepStrictEqual({ failed, retried, meanwhile, failedAgain: { rows: rows(reopened.element).length, status: status(reopened.element), asked: providers.listed.length } }, {
			failed: { rows: ['# Voices', 'Kore — Firm ✓ <', 'Puck — Upbeat'], status: 'The voices could not be loaded: The API key is not valid. [Try Again]' },
			retried: { rows: 7, status: undefined, asked: 2 },
			meanwhile: { rows: ['# Your Voices', 'My Narrator — Cloned [play]', '# Voices', 'Kore — Firm [play] ✓ <'], status: undefined },
			// The last list stays, with the reason the new one could not be loaded.
			failedAgain: { rows: 7, status: 'The voices could not be loaded: The network is down. [Try Again]', asked: 3 }
		});
	});

	test('a provider that had more voices than BaseHalf keeps says so at the end of the list', async () => {
		const voices = Array.from({ length: 2000 }, (_value, index) => ({ id: `voice-${index}`, label: `Voice ${index}`, own: false }));
		providers.voices = () => ({ ok: true, value: { voices: [...voices, { id: 'voice-2000', label: 'Voice 2000', own: false }] } });
		const { element } = open();
		await service.refresh(DULCET, DULCET_SPEECH);
		const shown = rows(element);
		assert.deepStrictEqual({ count: shown.length, first: shown.slice(0, 4), last: shown.slice(-2) }, {
			// The catalog's two voices, then the 2,000 the window keeps.
			count: 2004,
			first: ['# Voices', 'Kore — Firm ✓ <', 'Puck — Upbeat', 'Voice 0'],
			last: ['Voice 1999', '(Showing the first 2,000 voices.)']
		});
	});

	test('a voice of the card that no list names heads Voices by its id, and once the list came, says that it is not among the account\'s voices', async () => {
		const answer = new DeferredPromise<unknown>();
		providers.voices = () => answer.p;
		const { element } = open({ voice: 'cloned-elsewhere' });
		const beforeList = rows(element).slice(0, 2);
		answer.complete({ ok: true, value: LIST });
		await service.refresh(DULCET, DULCET_SPEECH);
		assert.deepStrictEqual({ beforeList, listed: rows(element).slice(2, 4), name: baseHalfVoiceLabel(DULCET_VOICE, 'cloned-elsewhere', LIST) }, {
			beforeList: ['# Voices', 'cloned-elsewhere ✓ <'],
			listed: ['# Voices', 'cloned-elsewhere — Not among the voices of this account. ✓ <'],
			name: 'cloned-elsewhere'
		});
	});

	test('a model whose provider lists no voices offers the catalog\'s voices alone and asks nothing', async () => {
		const voice = EMBER_VOICE.parameters.find(parameter => parameter.kind === 'voice');
		assert.ok(voice?.kind === 'voice');
		const { element } = open({ provider: EMBER, model: EMBER_VOICE, parameter: voice, voice: 'bram' });
		await settle();
		assert.deepStrictEqual({ rows: rows(element), status: status(element), asked: providers.listed.length }, {
			rows: ['# Voices', 'Aria — Bright', 'Bram ✓ <'],
			status: undefined,
			asked: 0
		});
	});

	test('Tab reaches Set Up from the search field and leaves the menu after it; Space never types into the search', async () => {
		settings.notSetUp.add('dulcet');
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
		const first = service.refresh(DULCET, DULCET_SPEECH);
		const second = service.refresh(DULCET, DULCET_SPEECH);
		const whileAsked = service.voices('dulcet', 'main');
		answer.complete({ ok: true, value: LIST });
		await Promise.all([first, second]);
		const kept = service.voices('dulcet', 'main');
		settings.unreadable = 'BaseHalf cannot read the credentials of Dulcet Voice. Set them again in Providers.';
		await service.refresh(DULCET, DULCET_SPEECH);
		assert.deepStrictEqual({
			asked: providers.listed.length,
			whileAsked,
			kept: { voices: kept.list?.voices.length, loading: kept.loading },
			otherRegion: service.voices('dulcet', 'elsewhere'),
			unreadable: { voices: service.voices('dulcet', 'main').list?.voices.length, error: service.voices('dulcet', 'main').error }
		}, {
			asked: 1,
			whileAsked: { loading: true },
			kept: { voices: 4, loading: false },
			otherRegion: { loading: false },
			unreadable: { voices: 4, error: 'BaseHalf cannot read the credentials of Dulcet Voice. Set them again in Providers.' }
		});
	});

	test('the window\'s sound output for samples stops five seconds after the last one ended', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		await service.playSample(DULCET, DULCET_SPEECH, 'rachel', 'https://cdn.dulcet.example/rachel.mp3');
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

	test('reads what the provider service listed: an id of at most 256 characters without control characters, each once, at most 2,000, names as plain text, and samples only at web addresses', () => {
		const capped = parseBaseHalfVoicesResult({ voices: Array.from({ length: 2001 }, (_value, index) => ({ id: `v${index}`, label: `V ${index}`, own: false })) });
		assert.deepStrictEqual({
			read: parseBaseHalfVoicesResult({
				voices: [
					{ id: 'a', label: ' A  <b>voice</b>\n', description: 'Deep,\u0007 slow', own: true, sample: 'javascript:alert(1)' },
					{ id: 'a', label: 'Again' },
					{ id: '' },
					{ id: 'b\u0000' },
					{ id: 'x'.repeat(257) },
					'not a voice',
					{ id: 'c', label: '', description: 7, own: 'yes', sample: 'https://cdn.example/c.mp3' }
				]
			}),
			capped: { length: capped?.voices.length, truncated: capped?.truncated },
			notAList: parseBaseHalfVoicesResult({ voices: 'none' })
		}, {
			read: {
				voices: [
					{ id: 'a', label: 'A voice', description: 'Deep, slow', own: true },
					{ id: 'c', label: 'c', own: false, sample: 'https://cdn.example/c.mp3' }
				]
			},
			capped: { length: 2000, truncated: true },
			notAList: undefined
		});
	});
});
