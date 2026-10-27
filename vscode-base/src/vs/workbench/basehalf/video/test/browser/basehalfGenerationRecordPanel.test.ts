/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { timeout } from '../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { INotification, INotificationHandle, INotificationService } from '../../../../../platform/notification/common/notification.js';
import { TestNotificationService } from '../../../../../platform/notification/test/common/testNotificationService.js';
import { IWorkspaceContextService, toWorkspaceFolder } from '../../../../../platform/workspace/common/workspace.js';
import type { VoicesResult } from '../../../../../platform/basehalfProviders/common/basehalfProviderTypes.js';
import { BaseHalfGenerationRecordPanel, IBaseHalfGenerationRecordPanelHost } from '../../browser/basehalfGenerationRecordPanel.js';
import { BaseHalfGenerationKind, IBaseHalfGenerationMade } from '../../common/basehalfGenerationInfo.js';
import { IBaseHalfGenerationVoiceService, IBaseHalfVoices } from '../../common/basehalfGenerationVoices.js';
import { BaseHalfModelKind, BaseHalfVideoCatalogState, baseHalfVideoInputKindOfPath, IBaseHalfVideoCatalogModel, IBaseHalfVideoCatalogProvider, parseBaseHalfVideoCatalog } from '../../common/basehalfVideoCatalog.js';
import {
	IBaseHalfGenerationCardActions,
	IBaseHalfGenerationCardSnapshot,
	IBaseHalfGenerationCardStore,
	IBaseHalfVideoCatalogService,
	IBaseHalfVideoResolvedInput
} from '../../common/basehalfVideoGeneration.js';
import { DUNLIN, DUNLIN_VOICE, TEST_AUDIO_CATALOG, TEST_GENERATION_CATALOG } from '../common/basehalfVideoCatalogFixture.js';

const WORKSPACE = URI.file('/workspace');
const CARD = URI.joinPath(WORKSPACE, 'shots', 'shot.mp4');
const SOUND = URI.joinPath(WORKSPACE, 'shots', 'audio.mp3');
/** The kind of an audio card (D78). */
const AUDIO = 'audio' as BaseHalfModelKind as BaseHalfGenerationKind;
const MADE: IBaseHalfGenerationMade = {
	id: '20261023T080000-made0001',
	startedAt: '2026-10-23T08:00:00.000Z',
	finishedAt: '2026-10-23T08:02:00.000Z',
	provider: 'acme',
	region: 'east',
	model: 'acme-motion-2',
	providerModel: 'acme-motion-2-e-260101',
	mode: 'frames',
	params: { resolution: '720p', duration: 5, sound: true, seed: 7 },
	prompt: 'Image 1 rides along the sea.',
	inputs: ['frames/a.png', 'frames/b.png']
};

class RecordingNotificationService extends TestNotificationService {
	readonly shown: string[] = [];

	override notify(notification: INotification): INotificationHandle {
		this.shown.push(String(notification.message));
		return super.notify(notification);
	}
}

suite('BaseHalfGenerationRecordPanel', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let instantiationService: TestInstantiationService;
	let snapshot: IBaseHalfGenerationCardSnapshot;
	let gone: Set<string>;
	let changed: Emitter<URI>;
	let catalogState: BaseHalfVideoCatalogState;
	let newVersions: string[];
	let newVersionRefusal: Error | undefined;
	let notifications: RecordingNotificationService;
	let hovers: Map<HTMLElement, () => string>;
	let host: IBaseHalfGenerationRecordPanelHost & { cardFocused: number; drafts: string[] };
	let mounted: HTMLElement[];
	/** The provider's last lists of voices, by provider and region (D78). */
	let lists: Map<string, VoicesResult>;
	let listed: Emitter<void>;
	/** What the panel had the window ask for once, to name a voice only a list names, each once. */
	let askedOnce: Set<string>;

	setup(() => {
		instantiationService = disposables.add(new TestInstantiationService());
		snapshot = { resource: CARD, path: 'shots/shot.mp4', kind: 'video', hasFile: true, info: { prompt: 'Changed since.' }, infoReadable: true, made: MADE, upstream: MADE.inputs };
		gone = new Set();
		changed = disposables.add(new Emitter<URI>());
		catalogState = { kind: 'ready', catalog: TEST_GENERATION_CATALOG };
		newVersions = [];
		newVersionRefusal = undefined;
		notifications = new RecordingNotificationService();
		hovers = new Map();
		mounted = [];
		host = {
			cardFocused: 0,
			drafts: [],
			focusCard: () => { host.cardFocused++; },
			didMakeNewVersion: draft => { host.drafts.push(draft.path); }
		};
		instantiationService.stub(IBaseHalfGenerationCardStore, {
			onDidChange: changed.event,
			read: async () => snapshot,
			resolveInputs: async (card: IBaseHalfGenerationCardSnapshot): Promise<readonly IBaseHalfVideoResolvedInput[]> => card.upstream.map(path => gone.has(path)
				? { path, kind: baseHalfVideoInputKindOfPath(path), available: false }
				: { path, kind: baseHalfVideoInputKindOfPath(path), available: true, file: URI.joinPath(WORKSPACE, ...path.split('/')) })
		});
		instantiationService.stub(IBaseHalfGenerationCardActions, {
			newVersion: async (card: URI) => {
				newVersions.push(card.path);
				if (newVersionRefusal) {
					throw newVersionRefusal;
				}
				return URI.joinPath(WORKSPACE, 'shots', 'shot-2.mp4');
			}
		});
		instantiationService.stub(IBaseHalfVideoCatalogService, { onDidChange: Event.None, get state() { return catalogState; }, load: () => { } });
		lists = new Map();
		listed = disposables.add(new Emitter<void>());
		askedOnce = new Set();
		instantiationService.stub(IBaseHalfGenerationVoiceService, {
			onDidChangeVoices: listed.event,
			voices: (provider: string, region: string): IBaseHalfVoices => {
				const list = lists.get(`${provider}/${region}`);
				return { loading: false, ...(list ? { list } : {}) };
			},
			askOnce: async (provider: IBaseHalfVideoCatalogProvider, model: IBaseHalfVideoCatalogModel, region: string) => {
				askedOnce.add(`${provider.id}/${region}/${model.id}`);
			}
		});
		instantiationService.stub(IFileService, { onDidFilesChange: Event.None });
		instantiationService.stub(IWorkspaceContextService, { getWorkspaceFolder: () => toWorkspaceFolder(WORKSPACE) });
		instantiationService.set(INotificationService, notifications);
		instantiationService.set(ILogService, new NullLogService());
		instantiationService.set(IHoverService, {
			...NullHoverService,
			setupDelayedHover: (target, options) => {
				hovers.set(target, () => {
					const resolved = typeof options === 'function' ? options() : options;
					return typeof resolved.content === 'string' ? resolved.content : '';
				});
				return toDisposable(() => hovers.delete(target));
			}
		});
	});

	teardown(() => {
		for (const element of mounted) {
			element.remove();
		}
	});

	async function createPanel(resource = CARD): Promise<BaseHalfGenerationRecordPanel> {
		const panel = disposables.add(instantiationService.createInstance(BaseHalfGenerationRecordPanel, resource, host));
		mainWindow.document.body.appendChild(panel.element);
		mounted.push(panel.element);
		await settle();
		return panel;
	}

	async function settle(): Promise<void> {
		for (let i = 0; i < 3; i++) {
			await timeout(1);
		}
	}

	function texts(panel: BaseHalfGenerationRecordPanel, selector: string): string[] {
		return [...panel.element.querySelectorAll<HTMLElement>(selector)].filter(element => !element.closest('[hidden]')).map(element => element.textContent ?? '');
	}

	test('shows what made the file, from its record and not from a generation.yaml beside it, and nothing in it changes the card (criteria 42 and 58)', async () => {
		gone.add('frames/b.png');
		snapshot = { ...snapshot, made: { ...MADE, prompt: '@[frames/a.png] rides along the sea to @[frames/b.png].' } };
		const panel = await createPanel();
		const tiles = [...panel.element.querySelectorAll<HTMLElement>('.bh-input-tile')];
		assert.deepStrictEqual({
			state: panel.element.dataset.state,
			// The tiles of a draft's input row, read only: no buttons, cross, @, or swap (D68, D71).
			inputs: tiles.map(tile => tile.getAttribute('aria-label')),
			numbers: tiles.map(tile => tile.querySelector('.bh-input-tile-number')?.textContent),
			gone: tiles.map(tile => tile.classList.contains('dimmed')),
			controls: panel.element.querySelectorAll('.bh-input-row-action, .bh-input-tile-remove, .bh-input-tile-name, .bh-input-row-swap').length,
			prompt: texts(panel, '.bh-prompt-editor'),
			// Its mentions are chips of the inputs it was made from, the one that is gone too (D74).
			chips: [...panel.element.querySelectorAll<HTMLElement>('.bh-prompt-chip')].map(chip => `${chip.querySelector('.bh-prompt-chip-name')?.textContent}${chip.classList.contains('unknown') ? ' (unknown)' : ''}`),
			model: texts(panel, '.bh-record-panel-model'),
			settings: texts(panel, '.bh-record-panel-settings'),
			buttons: [...panel.element.querySelectorAll('button')].map(button => button.textContent),
			fields: panel.element.querySelectorAll('textarea, input, [contenteditable="true"]').length,
			newVersionTitle: hovers.get(panel.element.querySelector<HTMLElement>('.bh-record-panel-new-version')!)?.(),
			settingsTitle: hovers.get(panel.element.querySelector<HTMLElement>('.bh-record-panel-settings')!)?.(),
			height: panel.height
		}, {
			state: 'ready',
			// Named by their files in their looks and to a screen reader; no tile has a number (D71).
			inputs: ['a.png, Start', 'b.png, End, Not there any more.'],
			numbers: [undefined, undefined],
			gone: [false, true],
			controls: 0,
			prompt: ['a.png rides along the sea to b.png.'],
			chips: ['a.png', 'b.png'],
			model: ['Acme Motion 2'],
			settings: ['Frames · 720p · 5s · Sound'],
			buttons: ['New Version'],
			fields: 0,
			newVersionTitle: 'Make a new draft beside this card from what made it.',
			settingsTitle: 'Made with: Frames · 720p · 5s · Sound · Seed 7',
			// The input row, three lines of prompt, and the footer.
			height: 12 + 56 + 68 + 8 + 32 + 12
		});
	});

	test('says which image of how many it is, that a card had no prompt, and that a record cannot be read, which has no New Version', async () => {
		snapshot = { ...snapshot, kind: 'image', made: { ...MADE, provider: 'corvid', region: 'north', model: 'corvid-paint', providerModel: 'paint-n-1', mode: 'reference', params: { resolution: '1k', count: 2 }, prompt: '', inputs: [], output: 2, outputs: 2 } };
		const panel = await createPanel();
		const prompt = panel.element.querySelector<HTMLElement>('.bh-prompt-editor');
		assert.deepStrictEqual({ line: texts(panel, '.bh-record-panel-line'), prompt: prompt?.textContent, placeholder: prompt?.dataset.placeholder, row: panel.element.querySelector<HTMLElement>('.bh-input-row')?.hidden }, {
			line: ['Image 2 of 2'],
			prompt: '',
			placeholder: 'No prompt',
			row: true
		});

		snapshot = { ...snapshot, made: undefined, madeUnreadable: true };
		changed.fire(CARD);
		await settle();
		assert.deepStrictEqual({ state: panel.element.dataset.state, record: panel.element.dataset.record, notice: texts(panel, '.bh-video-panel-notice'), buttons: texts(panel, 'button') }, {
			state: 'ready',
			record: 'unreadable',
			notice: ['BaseHalf could not read what made this file.'],
			buttons: []
		});
		await panel.newVersion();
		assert.deepStrictEqual(newVersions, []);
	});

	test('New Version makes the draft and hands it to the workbench; a refusal says why; Escape gives the focus back to the card', async () => {
		const panel = await createPanel();
		panel.element.querySelector<HTMLButtonElement>('.bh-record-panel-new-version')!.click();
		await settle();
		assert.deepStrictEqual([newVersions, host.drafts], [['/workspace/shots/shot.mp4'], ['/workspace/shots/shot-2.mp4']]);

		newVersionRefusal = new Error('BaseHalf could not read what made shot.mp4, so it cannot make a new version of it.');
		await panel.newVersion();
		assert.deepStrictEqual([host.drafts.length, notifications.shown], [1, ['BaseHalf could not read what made shot.mp4, so it cannot make a new version of it.']]);

		panel.element.querySelector<HTMLElement>('.bh-prompt-editor')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		assert.strictEqual(host.cardFocused, 1);
	});

	test('follows its record and its inputs: a model the catalog learns is named, and an input that comes back is no longer gone', async () => {
		catalogState = { kind: 'loading' };
		gone.add('frames/a.png');
		const panel = await createPanel();
		assert.deepStrictEqual([texts(panel, '.bh-record-panel-model'), panel.element.querySelectorAll('.bh-input-tile.dimmed').length], [['acme-motion-2'], 1]);
		catalogState = { kind: 'ready', catalog: TEST_GENERATION_CATALOG };
		gone.clear();
		changed.fire(CARD);
		await settle();
		assert.deepStrictEqual([texts(panel, '.bh-record-panel-model'), panel.element.querySelectorAll('.bh-input-tile.dimmed').length], [['Acme Motion 2'], 0]);
	});

	test('names the voice a speech model spoke in between the model and the settings, as the provider\'s last list names it once it comes, and says which song of how many it is (D78)', async () => {
		catalogState = { kind: 'ready', catalog: TEST_AUDIO_CATALOG };
		const spoken: IBaseHalfGenerationMade = { ...MADE, provider: 'dunlin', region: 'main', model: 'dunlin-voice', providerModel: 'voice-1', mode: 'reference', params: { voice: 'narrator-7', speed: 1 }, prompt: 'Welcome to the coast.', inputs: [] };
		snapshot = { resource: SOUND, path: 'shots/audio.mp3', kind: AUDIO, hasFile: true, info: { prompt: '' }, infoReadable: true, made: spoken, upstream: [] };
		const panel = await createPanel(SOUND);
		const footer = () => [...panel.element.querySelector<HTMLElement>('.bh-video-panel-footer')!.children].filter(child => !(child as HTMLElement).hidden).map(child => child.textContent);
		const byId = { footer: footer(), voice: panel.element.querySelector('.bh-record-panel-voice')?.getAttribute('aria-label'), label: panel.element.getAttribute('aria-label') };
		lists.set('dunlin/main', { voices: [{ id: 'narrator-7', label: 'My Narrator', own: true }] });
		listed.fire();
		const byList = footer();
		snapshot = { ...snapshot, made: { ...spoken, model: 'dunlin-song', providerModel: 'song-1', mode: 'lyrics', params: { count: 2 }, output: 1, outputs: 2 } };
		changed.fire(SOUND);
		await settle();
		assert.deepStrictEqual({ byId, byList, song: { line: texts(panel, '.bh-record-panel-line'), voice: texts(panel, '.bh-record-panel-voice') } }, {
			// The voice is named once, beside the model, and the summary of the settings leaves it out.
			byId: { footer: ['Dunlin Voice', 'narrator-7', 'From Text · Speed 1', '', 'New Version'], voice: 'Voice: narrator-7', label: 'What made the sound audio.mp3' },
			byList: ['Dunlin Voice', 'My Narrator', 'From Text · Speed 1', '', 'New Version'],
			song: { line: ['Song 1 of 2'], voice: [] }
		});
	});

	test('has the window ask once for the voices of the region it was made in, to name a voice that only the provider lists, and asks nothing for a voice of the catalog (D78)', async () => {
		catalogState = { kind: 'ready', catalog: TEST_AUDIO_CATALOG };
		const spoken: IBaseHalfGenerationMade = { ...MADE, provider: 'dunlin', region: 'main', model: 'dunlin-voice', providerModel: 'voice-1', mode: 'reference', params: { voice: 'narrator-7', speed: 1 }, prompt: 'Welcome to the coast.', inputs: [] };
		snapshot = { resource: SOUND, path: 'shots/audio.mp3', kind: AUDIO, hasFile: true, info: { prompt: '' }, infoReadable: true, made: spoken, upstream: [] };
		await createPanel(SOUND);
		const ofAccount = [...askedOnce];
		askedOnce.clear();
		snapshot = { ...snapshot, made: { ...spoken, params: { voice: 'vx-pike', speed: 1 } } };
		changed.fire(SOUND);
		await settle();
		const ofCatalog = [...askedOnce];
		// Until the catalog has the model, the value is not known to be a voice.
		catalogState = { kind: 'loading' };
		snapshot = { ...snapshot, made: spoken };
		changed.fire(SOUND);
		await settle();
		assert.deepStrictEqual({ ofAccount, ofCatalog, withoutCatalog: [...askedOnce] }, {
			ofAccount: ['dunlin/main/dunlin-voice'],
			ofCatalog: [],
			withoutCatalog: []
		});
	});

	test('keeps the voice\'s name whole up to its width, as the model\'s, where the summary of the settings gives way first (D78)', async () => {
		// A speech model whose voice is tuned, as some providers' are: its summary takes more room than the footer has.
		const tuned: IBaseHalfVideoCatalogModel = {
			...DUNLIN_VOICE,
			parameters: [
				...DUNLIN_VOICE.parameters,
				{ name: 'stability', label: 'Stability', kind: 'number', min: 0, max: 1, step: 0.05, default: 0.5 },
				{ name: 'similarity_boost', label: 'Similarity', kind: 'number', min: 0, max: 1, step: 0.05, default: 0.75 }
			]
		};
		catalogState = { kind: 'ready', catalog: parseBaseHalfVideoCatalog({ schema: 1, providers: [{ ...DUNLIN, models: [tuned] }] }).catalog };
		lists.set('dunlin/main', { voices: [{ id: 'sea-captain', label: 'Sea Captain', own: true }] });
		const spoken: IBaseHalfGenerationMade = { ...MADE, provider: 'dunlin', region: 'main', model: 'dunlin-voice', providerModel: 'voice-1', mode: 'reference', params: { voice: 'sea-captain', speed: 1, stability: 0.5, similarity_boost: 0.75 }, prompt: 'Ahoy.', inputs: [] };
		snapshot = { resource: SOUND, path: 'shots/audio.mp3', kind: AUDIO, hasFile: true, info: { prompt: '' }, infoReadable: true, made: spoken, upstream: [] };
		const frame = mainWindow.document.createElement('div');
		frame.className = 'monaco-workbench';
		frame.style.cssText = 'position: absolute; left: 0; top: 0; width: 512px; --vscode-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;';
		mainWindow.document.body.appendChild(frame);
		mounted.push(frame);
		const panel = await createPanel(SOUND);
		frame.append(panel.element);
		const part = (selector: string) => panel.element.querySelector<HTMLElement>(selector)!;
		const clipped = (selector: string) => part(selector).scrollWidth > part(selector).clientWidth;
		const footer = () => ({
			voice: part('.bh-record-panel-voice-text').textContent,
			voiceClipped: clipped('.bh-record-panel-voice-text'),
			modelClipped: clipped('.bh-record-panel-model'),
			settingsClipped: clipped('.bh-record-panel-settings'),
			newVersionInside: part('.bh-record-panel-new-version').getBoundingClientRect().right <= part('.bh-video-panel-footer').getBoundingClientRect().right
		});
		const whole = footer();
		lists.set('dunlin/main', { voices: [{ id: 'sea-captain', label: 'Captain of the Northern Sea Shanty Choir', own: true }] });
		listed.fire();
		assert.deepStrictEqual({ settings: part('.bh-record-panel-settings').textContent, whole, long: { ...footer(), width: part('.bh-record-panel-voice').getBoundingClientRect().width } }, {
			settings: 'Speed 1 · Stability 0.5 · Similarity 0.75',
			whole: { voice: 'Sea Captain', voiceClipped: false, modelClipped: false, settingsClipped: true, newVersionInside: true },
			// A longer name ends in an ellipsis at the voice's width, 148 px and its padding.
			long: { voice: 'Captain of the Northern Sea Shanty Choir', voiceClipped: true, modelClipped: false, settingsClipped: true, newVersionInside: true, width: 156 }
		});
	});
});
