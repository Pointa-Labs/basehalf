/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../base/browser/window.js';
import { timeout } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { URI } from '../../../../base/common/uri.js';
import { runWithFakedTimers } from '../../../../base/test/common/timeTravelScheduler.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { NullHoverService } from '../../../../platform/hover/test/browser/nullHoverService.js';
import { TestInstantiationService } from '../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILogService, NullLogService } from '../../../../platform/log/common/log.js';
import { INotification, INotificationHandle, INotificationService } from '../../../../platform/notification/common/notification.js';
import { TestNotificationService } from '../../../../platform/notification/test/common/testNotificationService.js';
import { IWorkspaceContextService, toWorkspaceFolder } from '../../../../platform/workspace/common/workspace.js';
import { BaseHalfVideoNodePanel, IBaseHalfVideoNodePanelHost, IBaseHalfVideoNodePanelOptions } from '../../browser/basehalfVideoNodePanel.js';
import { IBaseHalfCanvasMirrorService } from '../../common/basehalfCanvasMirror.js';
import { BASEHALF_CANVAS_VIDEO_PANEL_LAYOUT_EVENT, IBaseHalfCanvasSceneVideoPanelLayout } from '../../common/basehalfCanvasScene.js';
import { IBaseHalfReferenceEditResult, IBaseHalfReferenceEditService } from '../../common/basehalfReferenceEdit.js';
import {
	IBaseHalfVideoChannel,
	IBaseHalfVideoChannelService,
	IBaseHalfVideoGenerationProgress,
	IBaseHalfVideoGenerationService,
	IBaseHalfVideoModelChoice,
	IBaseHalfVideoNodeSnapshot,
	IBaseHalfVideoNodeStore,
	IBaseHalfVideoResolvedInput
} from '../../common/basehalfVideoGeneration.js';
import { IBaseHalfVideoGenerationSettings, IBaseHalfVideoNodeFields } from '../../common/basehalfVideoNode.js';
import { baseHalfVideoInputKindOfPath } from '../../common/basehalfVideoProviders.js';

const WORKSPACE = URI.file('/workspace');
const NODE_PATH = 'shots/Shot 1.bhnode';
const NODE = URI.joinPath(WORKSPACE, 'shots', 'Shot 1.bhnode');
const SEEDANCE = 'doubao-seedance-2-5-260628';
const READY: IBaseHalfVideoGenerationSettings = { channel: 'ark-1', model: SEEDANCE, mode: 'frames', ratio: '16:9', resolution: '720p', duration: 5, audio: true };
const ARK: IBaseHalfVideoChannel = { id: 'ark-1', provider: 'ark', name: 'Volcengine Ark', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', models: [SEEDANCE], hasKey: true };
const MINIMAX: IBaseHalfVideoChannel = { id: 'mm-1', provider: 'minimax', name: 'MiniMax', baseUrl: 'https://api.minimaxi.com/v1', models: ['MiniMax-Hailuo-02'], hasKey: true };

class FakeVideoNodeStore extends Disposable implements IBaseHalfVideoNodeStore {
	declare readonly _serviceBrand: undefined;
	private readonly didWrite = this._register(new Emitter<URI>());
	readonly onDidWrite = this.didWrite.event;
	readonly prompts: string[] = [];
	readonly generations: (IBaseHalfVideoGenerationSettings | undefined)[] = [];
	readonly reorders: (readonly string[])[] = [];
	failure: Error | undefined;

	constructor(public fields: IBaseHalfVideoNodeFields, public upstream: readonly string[]) {
		super();
	}

	snapshot(): IBaseHalfVideoNodeSnapshot {
		return { resource: NODE, path: NODE_PATH, id: 'node-1', title: 'Shot 1', upstream: this.upstream, fields: this.fields };
	}

	async read(): Promise<IBaseHalfVideoNodeSnapshot> {
		return this.snapshot();
	}

	async update(_resource: URI, mutate: (fields: IBaseHalfVideoNodeFields) => IBaseHalfVideoNodeFields): Promise<IBaseHalfVideoNodeSnapshot> {
		if (this.failure) {
			throw this.failure;
		}
		const next = mutate(this.fields);
		if (next.prompt !== this.fields.prompt) {
			this.prompts.push(next.prompt ?? '');
		}
		if (next.generation !== this.fields.generation) {
			this.generations.push(next.generation);
		}
		this.fields = next;
		this.didWrite.fire(NODE);
		return this.snapshot();
	}

	async reorderUpstream(_resource: URI, upstream: readonly string[]): Promise<IBaseHalfVideoNodeSnapshot> {
		this.reorders.push(upstream);
		this.upstream = upstream;
		this.didWrite.fire(NODE);
		return this.snapshot();
	}

	async resolveInputs(snapshot: IBaseHalfVideoNodeSnapshot): Promise<readonly IBaseHalfVideoResolvedInput[]> {
		return snapshot.upstream.map(path => ({ path, kind: baseHalfVideoInputKindOfPath(path), available: true }));
	}

	createSibling(): Promise<URI> {
		throw new Error('Not used by the panel.');
	}

	videoTarget(): URI {
		throw new Error('Not used by the panel.');
	}

	/** Another window or an agent changed the node. */
	writeFromElsewhere(fields: IBaseHalfVideoNodeFields): void {
		this.fields = fields;
		this.didWrite.fire(NODE);
	}
}

class FakeChannelService extends Disposable implements IBaseHalfVideoChannelService {
	declare readonly _serviceBrand: undefined;
	private readonly changed = this._register(new Emitter<void>());
	readonly onDidChange = this.changed.event;
	settingsOpened = 0;

	constructor(public channels: readonly IBaseHalfVideoChannel[]) {
		super();
	}

	getChannels(): readonly IBaseHalfVideoChannel[] {
		return this.channels;
	}

	getChannel(id: string): IBaseHalfVideoChannel | undefined {
		return this.channels.find(channel => channel.id === id);
	}

	resolve(choice: { readonly channel?: string; readonly model?: string }): IBaseHalfVideoModelChoice | undefined {
		const model = choice.model;
		if (!model) {
			return undefined;
		}
		const channel = this.channels.find(candidate => candidate.id === choice.channel && candidate.models.includes(model))
			?? this.channels.find(candidate => candidate.models.includes(model));
		return channel ? { channel, model } : undefined;
	}

	addChannel(): Promise<IBaseHalfVideoChannel> {
		throw new Error('Not used by the panel.');
	}

	async updateChannel(): Promise<void> { }
	async setKey(): Promise<void> { }
	async getKey(): Promise<string | undefined> {
		return undefined;
	}
	async removeChannel(): Promise<void> { }
	getLastUsed(): IBaseHalfVideoGenerationSettings | undefined {
		return undefined;
	}
	setLastUsed(): void { }

	async openSettings(): Promise<void> {
		this.settingsOpened++;
	}

	change(channels: readonly IBaseHalfVideoChannel[]): void {
		this.channels = channels;
		this.changed.fire();
	}
}

class FakeGenerationService extends Disposable implements IBaseHalfVideoGenerationService {
	declare readonly _serviceBrand: undefined;
	private readonly progress = this._register(new Emitter<URI>());
	readonly onDidChangeProgress = this.progress.event;
	/** The prompt in the node's file at each Generate. */
	readonly generated: string[] = [];
	stops = 0;
	generating = false;

	constructor(private readonly store: FakeVideoNodeStore) {
		super();
	}

	async generate(resource: URI): Promise<URI> {
		this.generated.push(this.store.fields.prompt ?? '');
		return resource;
	}

	async stop(): Promise<void> {
		this.stops++;
	}

	resume(): void { }

	isGenerating(): boolean {
		return this.generating;
	}

	getProgress(): IBaseHalfVideoGenerationProgress | undefined {
		return undefined;
	}

	report(): void {
		this.progress.fire(NODE);
	}
}

class RecordingNotificationService extends TestNotificationService {
	readonly shown: string[] = [];

	override notify(notification: INotification): INotificationHandle {
		this.shown.push(String(notification.message));
		return super.notify(notification);
	}
}

suite('BaseHalfVideoNodePanel', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let instantiationService: TestInstantiationService;
	let store: FakeVideoNodeStore;
	let channels: FakeChannelService;
	let generation: FakeGenerationService;
	let notifications: RecordingNotificationService;
	let hovers: Map<HTMLElement, () => string>;
	let connections: { readonly added: string[]; readonly removed: string[]; undoSteps: number };
	let host: IBaseHalfVideoNodePanelHost & { cardFocused: number; picked: string | undefined };
	let mounted: HTMLElement[];

	setup(() => {
		instantiationService = disposables.add(new TestInstantiationService());
		store = disposables.add(new FakeVideoNodeStore({ prompt: '', generation: READY }, ['frames/a.png', 'notes/scene.md', 'frames/b.png']));
		channels = disposables.add(new FakeChannelService([ARK, MINIMAX]));
		generation = disposables.add(new FakeGenerationService(store));
		notifications = new RecordingNotificationService();
		hovers = new Map();
		connections = { added: [], removed: [], undoSteps: 0 };
		mounted = [];
		host = {
			cardFocused: 0,
			picked: 'refs/c.png',
			pickCard: async () => host.picked,
			importFile: async () => undefined,
			focusCard: () => { host.cardFocused++; }
		};
		const result: IBaseHalfReferenceEditResult = { stores: [], changed: true };
		instantiationService.set(IBaseHalfVideoNodeStore, store);
		instantiationService.set(IBaseHalfVideoChannelService, channels);
		instantiationService.set(IBaseHalfVideoGenerationService, generation);
		instantiationService.set(INotificationService, notifications);
		instantiationService.set(ILogService, new NullLogService());
		instantiationService.stub(IBaseHalfReferenceEditService, {
			add: async (_node, entry) => {
				connections.added.push(entry);
				return result;
			},
			remove: async (_node, entry) => {
				connections.removed.push(entry);
				return result;
			},
			pushUndoElement: () => {
				connections.undoSteps++;
				return undefined;
			}
		});
		instantiationService.stub(IBaseHalfCanvasMirrorService, { canvasResource: () => URI.joinPath(WORKSPACE, '.bh', 'mirror', 'shots', 'canvas.yaml') });
		instantiationService.stub(IWorkspaceContextService, { getWorkspaceFolder: () => toWorkspaceFolder(WORKSPACE) });
		instantiationService.stub(IFileService, { onDidFilesChange: Event.None });
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

	async function createPanel(options?: IBaseHalfVideoNodePanelOptions): Promise<BaseHalfVideoNodePanel> {
		const panel = disposables.add(instantiationService.createInstance(BaseHalfVideoNodePanel, NODE, host, options));
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

	function find<T extends HTMLElement>(panel: BaseHalfVideoNodePanel, selector: string): T {
		const element = panel.element.querySelector<T>(selector);
		assert.ok(element, `The panel has no ${selector}.`);
		return element;
	}

	function findAll(panel: BaseHalfVideoNodePanel, selector: string): HTMLElement[] {
		return [...panel.element.querySelectorAll<HTMLElement>(selector)];
	}

	function type(prompt: HTMLTextAreaElement, value: string): void {
		prompt.value = value;
		prompt.setSelectionRange(value.length, value.length);
		prompt.dispatchEvent(new InputEvent('input', { bubbles: true }));
	}

	function press(target: HTMLElement, key: string, init?: KeyboardEventInit): void {
		target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
	}

	test('saves the prompt half a second after typing stops and at once on flush, without a dialog, also with no model', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		store.fields = { prompt: '' };
		const panel = await createPanel();
		const prompt = find<HTMLTextAreaElement>(panel, 'textarea');
		type(prompt, 'Rain');
		await timeout(400);
		type(prompt, 'Rain on');
		await timeout(499);
		const whileTyping = [...store.prompts];
		await timeout(1);
		const afterHalfASecond = [...store.prompts];
		type(prompt, 'Rain on the window');
		await panel.flush();
		assert.deepStrictEqual({ whileTyping, afterHalfASecond, flushed: store.prompts, notifications: notifications.shown }, {
			whileTyping: [],
			afterHalfASecond: ['Rain on'],
			flushed: ['Rain on', 'Rain on the window'],
			notifications: []
		});
	}));

	test('writes nothing while an input method composes, and the composed text after it ends', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const panel = await createPanel();
		const prompt = find<HTMLTextAreaElement>(panel, 'textarea');
		type(prompt, 'Rain ');
		prompt.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		prompt.value = 'Rain 雨';
		prompt.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
		await timeout(2000);
		const whileComposing = [...store.prompts];
		// Deselecting saves what was typed before the composition, never the composition.
		await panel.flush();
		const flushedWhileComposing = [...store.prompts];
		prompt.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '雨' }));
		await timeout(600);
		assert.deepStrictEqual({ whileComposing, flushedWhileComposing, afterComposition: store.prompts }, {
			whileComposing: [],
			flushedWhileComposing: ['Rain '],
			afterComposition: ['Rain ', 'Rain 雨']
		});
	}));

	test('a prompt that cannot be saved stays in the panel and says so, with no dialog', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const panel = await createPanel();
		const prompt = find<HTMLTextAreaElement>(panel, 'textarea');
		store.failure = new Error('The disk is full.');
		type(prompt, 'Rain');
		await panel.flush();
		const state = find(panel, '.bh-video-panel-prompt-state');
		const failed = { hidden: state.hidden, label: state.getAttribute('aria-label'), value: prompt.value, notifications: [...notifications.shown] };
		store.failure = undefined;
		type(prompt, 'Rain!');
		await panel.flush();
		assert.deepStrictEqual({ failed, saved: store.prompts, hiddenAfterSave: state.hidden }, {
			failed: {
				hidden: false,
				label: 'The prompt is not saved yet: The disk is full. It stays here and is saved with your next change.',
				value: 'Rain',
				notifications: []
			},
			saved: ['Rain!'],
			hiddenAfterSave: true
		});
	}));

	test('typing @ lists the named inputs, and choosing one types its name', async () => {
		const panel = await createPanel();
		const prompt = find<HTMLTextAreaElement>(panel, 'textarea');
		prompt.focus();
		type(prompt, 'The cat in @');
		const listed = findAll(panel, '.bh-video-panel-mention').map(option => option.textContent);
		press(prompt, 'ArrowDown');
		press(prompt, 'Enter');
		await settle();
		type(prompt, `${prompt.value} meets @vid`);
		const noMatch = findAll(panel, '.bh-video-panel-menu-empty').map(element => element.textContent);
		assert.deepStrictEqual({ listed, value: prompt.value, noMatch }, {
			listed: ['Image 1a.png', 'Image 2b.png'],
			value: 'The cat in Image 2 meets @vid',
			noMatch: ['No input has that name.']
		});
	});

	test('marks the names in the prompt and underlines a name with no input', async () => {
		const panel = await createPanel();
		const prompt = find<HTMLTextAreaElement>(panel, 'textarea');
		type(prompt, 'Image 1 turns into Image 3.');
		assert.deepStrictEqual(findAll(panel, '.bh-video-panel-name').map(mark => `${mark.textContent}${mark.classList.contains('unknown') ? '?' : ''}`), ['Image 1', 'Image 3?']);
	});

	test('the swap arrow exchanges the two frames in the upstream list and nothing else', async () => {
		const panel = await createPanel();
		find(panel, '.bh-video-panel-swap').click();
		await settle();
		assert.deepStrictEqual(store.reorders, [['frames/b.png', 'notes/scene.md', 'frames/a.png']]);
	});

	test('Generate is disabled with the first blocker as its tooltip and accessible name, and the model button is outlined', async () => {
		store.fields = { prompt: 'Rain' };
		const panel = await createPanel();
		const generate = find(panel, '.bh-video-panel-generate');
		const model = find(panel, '.bh-video-panel-model');
		generate.click();
		await settle();
		const noModel = {
			disabled: generate.getAttribute('aria-disabled'),
			label: generate.getAttribute('aria-label'),
			tooltip: hovers.get(generate)?.(),
			outlined: model.classList.contains('outlined'),
			modelTooltip: hovers.get(model)?.(),
			generated: generation.generated.length
		};
		channels.change([{ ...ARK, hasKey: false }]);
		store.writeFromElsewhere({ prompt: 'Rain', generation: READY });
		await settle();
		assert.deepStrictEqual({
			noModel,
			noKey: { label: generate.getAttribute('aria-label'), outlined: model.classList.contains('outlined') }
		}, {
			noModel: {
				disabled: 'true',
				label: 'Choose a model to generate.',
				tooltip: 'Choose a model to generate.',
				outlined: true,
				modelTooltip: 'Choose a model to generate.',
				generated: 0
			},
			noKey: { label: 'Volcengine Ark has no API key. Add one in Video Providers.', outlined: true }
		});
	});

	test(`${isMacintosh ? 'Cmd' : 'Ctrl'}+Enter saves the prompt and generates, and the stop square stops`, async () => {
		const panel = await createPanel();
		const prompt = find<HTMLTextAreaElement>(panel, 'textarea');
		type(prompt, 'Rain on the window');
		press(prompt, 'Enter', isMacintosh ? { metaKey: true } : { ctrlKey: true });
		await settle();
		const generated = [...generation.generated];
		generation.generating = true;
		generation.report();
		const generate = find(panel, '.bh-video-panel-generate');
		const stop = { stop: generate.classList.contains('stop'), label: generate.getAttribute('aria-label') };
		generate.click();
		await settle();
		assert.deepStrictEqual({ generated, stop, stops: generation.stops }, {
			generated: ['Rain on the window'],
			stop: { stop: true, label: 'Stop Generating' },
			stops: 1
		});
	});

	test('choosing another model saves settings that the model accepts', async () => {
		store.fields = { prompt: 'Rain', generation: { ...READY, mode: 'reference', ratio: '21:9', duration: 12 } };
		const panel = await createPanel();
		find(panel, '.bh-video-panel-model').click();
		const items = findAll(panel, '.bh-video-panel-menu-item').map(item => `${item.textContent}${item.getAttribute('aria-checked') === 'true' ? '*' : ''}`);
		findAll(panel, '.bh-video-panel-menu-item').find(item => item.textContent === 'MiniMax Hailuo-02')?.click();
		await settle();
		assert.deepStrictEqual({ items, written: store.generations, summary: find(panel, '.bh-video-panel-settings').textContent }, {
			items: ['Seedance 2.5*', 'MiniMax Hailuo-02', 'Manage Video Providers…'],
			written: [{ mode: 'frames', ratio: 'adaptive', resolution: '768P', duration: 10, audio: false, channel: 'mm-1', model: 'MiniMax-Hailuo-02' }],
			summary: 'Frames · 768P · 10s'
		});
	});

	test('a setting changes at once and is saved, and the popover shows only what the model accepts', async () => {
		const panel = await createPanel();
		find(panel, '.bh-video-panel-settings').click();
		const groups = findAll(panel, '[role="radiogroup"]').map(group => group.getAttribute('aria-label'));
		findAll(panel, '.bh-video-panel-choice').find(choice => choice.textContent === '1080p')?.click();
		const shownAtOnce = find(panel, '.bh-video-panel-settings').textContent;
		await settle();
		assert.deepStrictEqual({ groups, shownAtOnce, written: store.generations.map(settings => settings?.resolution) }, {
			groups: ['Mode', 'Ratio', 'Resolution'],
			shownAtOnce: 'Frames · Adaptive · 1080p · 5s · Sound',
			written: ['1080p']
		});
	});

	test('the prompt stays the same element, with its text and selection, through every update, and typing keeps the inputs drawn', async () => {
		const panel = await createPanel();
		const prompt = find<HTMLTextAreaElement>(panel, 'textarea');
		const thumbnail = find(panel, '.bh-video-panel-thumb');
		prompt.focus();
		type(prompt, 'A slow push in.');
		const thumbnailKept = find(panel, '.bh-video-panel-thumb') === thumbnail;
		prompt.setSelectionRange(2, 6);
		store.writeFromElsewhere({ ...store.fields, generation: { ...READY, resolution: '1080p' } });
		channels.change([ARK, MINIMAX]);
		generation.report();
		panel.element.dispatchEvent(new CustomEvent<IBaseHalfCanvasSceneVideoPanelLayout>(BASEHALF_CANVAS_VIDEO_PANEL_LAYOUT_EVENT, {
			detail: { placement: 'above', visible: true, following: false, left: 100, top: 40, width: 512, height: 180, canvasWidth: 1200, canvasHeight: 800 }
		}));
		await settle();
		assert.deepStrictEqual({
			thumbnailKept,
			same: find(panel, 'textarea') === prompt,
			value: prompt.value,
			selection: [prompt.selectionStart, prompt.selectionEnd],
			focused: mainWindow.document.activeElement === prompt
		}, { thumbnailKept: true, same: true, value: 'A slow push in.', selection: [2, 6], focused: true });
	});

	test('an agent\'s new prompt shows when the panel holds no unsaved text', async () => {
		const panel = await createPanel();
		store.writeFromElsewhere({ ...store.fields, prompt: 'Written by an agent.' });
		await settle();
		assert.strictEqual(find<HTMLTextAreaElement>(panel, 'textarea').value, 'Written by an agent.');
	});

	test('the cross removes a connection and Pick on Canvas connects the clicked card, each as one undo step', async () => {
		const panel = await createPanel();
		const remove = findAll(panel, '.bh-video-panel-remove').find(button => button.getAttribute('aria-label') === 'Remove Image 1');
		remove?.click();
		await settle();
		find(panel, '.bh-video-panel-add').click();
		findAll(panel, '.bh-video-panel-menu-item').find(item => item.textContent === 'Pick on Canvas')?.click();
		await settle();
		assert.deepStrictEqual(connections, { added: ['refs/c.png'], removed: ['frames/a.png'], undoSteps: 2 });
	});

	test('Escape closes the open menu first, and then returns the focus to the card', async () => {
		const panel = await createPanel();
		const model = find(panel, '.bh-video-panel-model');
		model.click();
		const opened = findAll(panel, '.bh-video-panel-menu').length;
		press(mainWindow.document.activeElement as HTMLElement, 'Escape');
		const afterFirst = { menus: findAll(panel, '.bh-video-panel-menu').length, focusOnModel: mainWindow.document.activeElement === model, card: host.cardFocused };
		press(model, 'Escape');
		assert.deepStrictEqual({ opened, afterFirst, card: host.cardFocused }, {
			opened: 1,
			afterFirst: { menus: 0, focusOnModel: true, card: 0 },
			card: 1
		});
	});

	test('a panel of a node just created focuses its prompt once the scene shows it', async () => {
		const panel = await createPanel({ focusPromptWhenShown: true });
		const prompt = find<HTMLTextAreaElement>(panel, 'textarea');
		const beforeShown = mainWindow.document.activeElement === prompt;
		panel.element.dispatchEvent(new CustomEvent<IBaseHalfCanvasSceneVideoPanelLayout>(BASEHALF_CANVAS_VIDEO_PANEL_LAYOUT_EVENT, {
			detail: { placement: 'below', visible: true, following: false, left: 100, top: 400, width: 512, height: 180, canvasWidth: 1200, canvasHeight: 900 }
		}));
		assert.deepStrictEqual({ beforeShown, shown: mainWindow.document.activeElement === prompt }, { beforeShown: false, shown: true });
	});

	test('menus follow the arrow keys, Home, and End, and the settings take the focus into their first control', async () => {
		const panel = await createPanel();
		find(panel, '.bh-video-panel-model').click();
		const focused = () => (mainWindow.document.activeElement as HTMLElement | null)?.textContent;
		const opened = focused();
		press(mainWindow.document.activeElement as HTMLElement, 'ArrowDown');
		const down = focused();
		press(mainWindow.document.activeElement as HTMLElement, 'End');
		const end = focused();
		press(mainWindow.document.activeElement as HTMLElement, 'Home');
		const home = focused();
		press(mainWindow.document.activeElement as HTMLElement, 'Escape');
		find(panel, '.bh-video-panel-settings').click();
		const settings = mainWindow.document.activeElement as HTMLElement | null;
		assert.deepStrictEqual({ opened, down, end, home, settings: [settings?.getAttribute('role'), settings?.textContent] }, {
			opened: 'Seedance 2.5',
			down: 'MiniMax Hailuo-02',
			end: 'Manage Video Providers…',
			home: 'Seedance 2.5',
			settings: ['radio', 'Frames']
		});
	});

	test('says when the node cannot be read, and shows why Generate did not start', async () => {
		const unreadable = disposables.add(new FakeVideoNodeStore({}, []));
		unreadable.read = async () => { throw new Error('document.version 4 is not supported.'); };
		instantiationService.set(IBaseHalfVideoNodeStore, unreadable);
		const broken = await createPanel();
		const notice = { state: broken.element.dataset.state, text: find(broken, '.bh-video-panel-notice').textContent, prompt: find(broken, '.bh-video-panel-prompt').hidden };
		instantiationService.set(IBaseHalfVideoNodeStore, store);
		generation.generate = async () => { throw new Error('frames/huge.png is larger than 20 MiB.'); };
		const panel = await createPanel();
		find(panel, '.bh-video-panel-generate').click();
		await settle();
		assert.deepStrictEqual({ notice, refused: notifications.shown }, {
			notice: { state: 'unreadable', text: 'This Video node cannot be read: document.version 4 is not supported.', prompt: true },
			refused: ['frames/huge.png is larger than 20 MiB.']
		});
	});

	test('an empty slot offers Import File, which connects the imported copy', async () => {
		store.upstream = [];
		host.importFile = async () => 'shots/start.png';
		const panel = await createPanel();
		const slot = find(panel, '.bh-video-panel-slot.empty');
		slot.click();
		findAll(panel, '.bh-video-panel-menu-item').find(item => item.textContent === 'Import File…')?.click();
		await settle();
		assert.deepStrictEqual({ label: slot.getAttribute('aria-label'), added: connections.added }, { label: 'Add a Start Frame', added: ['shots/start.png'] });
	});

	test('lays out at its width with nothing clipped or overlapping: the footer in one row, the slots, and the settings', async () => {
		const frame = mainWindow.document.createElement('div');
		frame.className = 'monaco-workbench';
		frame.style.cssText = 'position: absolute; left: 0; top: 0; width: 512px; --vscode-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;';
		mainWindow.document.body.appendChild(frame);
		mounted.push(frame);
		const measure = async (generationSettings: IBaseHalfVideoGenerationSettings) => {
			store.fields = { prompt: 'Image 1 rides along the sea at dusk.', generation: generationSettings };
			const panel = disposables.add(instantiationService.createInstance(BaseHalfVideoNodePanel, NODE, host, undefined));
			frame.replaceChildren(panel.element);
			await settle();
			const box = (selector: string) => find(panel, selector).getBoundingClientRect();
			const clipped = (selector: string) => {
				const element = find(panel, selector);
				return element.scrollWidth > element.clientWidth;
			};
			const outer = panel.element.getBoundingClientRect();
			const model = box('.bh-video-panel-model');
			const settings = box('.bh-video-panel-settings');
			const generate = box('.bh-video-panel-generate');
			const footer = box('.bh-video-panel-footer');
			const slots = findAll(panel, '.bh-video-panel-slot').map(slot => slot.getBoundingClientRect());
			const row = box('.bh-video-panel-inputs');
			find(panel, '.bh-video-panel-settings').click();
			const choices = findAll(panel, '.bh-video-panel-choice-label').filter(label => label.scrollWidth > label.clientWidth).map(label => label.textContent);
			const popover = box('.bh-video-panel-menu.settings');
			const result = {
				height: outer.height,
				reported: panel.height,
				modelClipped: clipped('.bh-video-panel-model-label'),
				settingsClipped: clipped('.bh-video-panel-settings-label'),
				footerInOrder: model.right <= settings.left && settings.right <= generate.left && generate.right <= outer.right - 12,
				footerInside: footer.bottom <= outer.bottom - 12,
				slotsInside: slots.every(slot => slot.left >= row.left && slot.right <= row.right),
				clippedChoices: choices,
				popoverWidth: popover.width
			};
			panel.dispose();
			return result;
		};
		const seedance = await measure(READY);
		const long = await measure({ ...READY, channel: 'relay', model: 'doubao-seedance-1-0-pro-fast-251015-preview-for-studio-relay' });
		assert.deepStrictEqual({ seedance, long: { modelClipped: long.modelClipped, footerInOrder: long.footerInOrder, settingsClipped: long.settingsClipped } }, {
			seedance: {
				height: 180,
				reported: 180,
				modelClipped: false,
				settingsClipped: false,
				footerInOrder: true,
				footerInside: true,
				slotsInside: true,
				clippedChoices: [],
				popoverWidth: 300
			},
			// A long model id ends with an ellipsis and shows in full in its tooltip; the rest keeps its place.
			long: { modelClipped: true, footerInOrder: true, settingsClipped: false }
		});
	});

	test('the panel is taller with an input row, and reports its height when it changes', async () => {
		const panel = await createPanel();
		const heights: number[] = [];
		disposables.add(panel.onDidChangeHeight(height => heights.push(height)));
		const withRow = panel.height;
		store.writeFromElsewhere({ prompt: 'Rain', generation: { ...READY, channel: 'wan', model: 'wan2.6-t2v' } });
		channels.change([ARK, MINIMAX, { id: 'wan', provider: 'dashscope', name: 'Model Studio', baseUrl: '', models: ['wan2.6-t2v'], hasKey: true }]);
		store.upstream = [];
		store.writeFromElsewhere(store.fields);
		await settle();
		assert.deepStrictEqual({ withRow, withoutRow: panel.height, heights }, { withRow: 180, withoutRow: 132, heights: [132] });
	});
});
