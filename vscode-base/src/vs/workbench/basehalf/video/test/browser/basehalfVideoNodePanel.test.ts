/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { timeout } from '../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../../base/common/platform.js';
import { URI } from '../../../../../base/common/uri.js';
import { runWithFakedTimers } from '../../../../../base/test/common/timeTravelScheduler.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FileChangesEvent, FileChangeType, IFileService } from '../../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { INotification, INotificationHandle, INotificationService } from '../../../../../platform/notification/common/notification.js';
import { TestNotificationService } from '../../../../../platform/notification/test/common/testNotificationService.js';
import { IWorkspaceContextService, toWorkspaceFolder } from '../../../../../platform/workspace/common/workspace.js';
import { BaseHalfVideoNodePanel, IBaseHalfVideoNodePanelHost, IBaseHalfVideoNodePanelOptions } from '../../browser/basehalfVideoNodePanel.js';
import { IBaseHalfCanvasMirrorService } from '../../../canvas/common/basehalfCanvasMirror.js';
import { BASEHALF_CANVAS_VIDEO_PANEL_LAYOUT_EVENT, IBaseHalfCanvasSceneVideoPanelLayout } from '../../../canvas/common/basehalfCanvasScene.js';
import { IBaseHalfReferenceEditResult, IBaseHalfReferenceEditService } from '../../../references/common/basehalfReferenceEdit.js';
import {
	BaseHalfVideoCatalogState,
	BaseHalfVideoMedia,
	baseHalfVideoInputKindOfPath,
	findBaseHalfVideoRegion,
	IBaseHalfVideoCatalog,
	IBaseHalfVideoCatalogProvider,
	IBaseHalfVideoCheckRequest,
	IBaseHalfVideoCheckResult,
	IBaseHalfVideoGenerationChoice,
	IBaseHalfVideoInputPlanItem,
	IBaseHalfVideoPlannedMedia,
	IBaseHalfVideoProviderAccess
} from '../../common/basehalfVideoCatalog.js';
import {
	BaseHalfVideoGenerationError,
	IBaseHalfDraftOperations,
	IBaseHalfDraftSnapshot,
	IBaseHalfGenerationCardEntry,
	IBaseHalfGenerationCardSnapshot,
	IBaseHalfGenerationCardStore,
	IBaseHalfGenerationDraft,
	IBaseHalfVideoCatalogService,
	IBaseHalfVideoGenerationProgress,
	IBaseHalfVideoGenerationService,
	IBaseHalfVideoProviderSettingsService,
	IBaseHalfVideoProviderStatus,
	IBaseHalfVideoResolvedInput
} from '../../common/basehalfVideoGeneration.js';
import { BaseHalfGenerationKind, IBaseHalfGenerationInfo } from '../../common/basehalfGenerationInfo.js';
import { TEST_GENERATION_CATALOG, TEST_VIDEO_CATALOG } from '../common/basehalfVideoCatalogFixture.js';

const WORKSPACE = URI.file('/workspace');
const NODE_PATH = 'shots/shot.mp4';
const NODE = URI.joinPath(WORKSPACE, 'shots', 'shot.mp4');
const READY: IBaseHalfVideoGenerationChoice = { provider: 'acme', model: 'acme-motion-2', mode: 'frames', params: { resolution: '720p', duration: 5, sound: true } };

/**
 * A card store over one card: what its `generation.yaml` and `upstream.yaml`
 * hold. Every prompt and choice written is kept, so a test can read what the
 * panel saved.
 */
class FakeCardStore extends Disposable implements IBaseHalfGenerationCardStore {
	declare readonly _serviceBrand: undefined;
	private readonly changed = this._register(new Emitter<URI>());
	readonly onDidChange = this.changed.event;
	readonly prompts: string[] = [];
	readonly generations: IBaseHalfVideoGenerationChoice[] = [];
	readonly reorders: (readonly string[])[] = [];
	failure: Error | undefined;
	unreadable: Error | undefined;
	kind: BaseHalfGenerationKind = 'video';
	path = NODE_PATH;
	hasFile = false;
	infoReadable = true;

	constructor(public info: IBaseHalfGenerationInfo, public upstream: readonly string[]) {
		super();
	}

	get resource(): URI {
		return URI.joinPath(WORKSPACE, ...this.path.split('/'));
	}

	snapshot(): IBaseHalfGenerationCardSnapshot {
		return { resource: this.resource, path: this.path, kind: this.kind, hasFile: this.hasFile, info: this.info, infoReadable: this.infoReadable, upstream: this.upstream };
	}

	async isGenerationCard(): Promise<boolean> {
		return true;
	}

	async read(): Promise<IBaseHalfGenerationCardSnapshot> {
		if (this.unreadable) {
			throw this.unreadable;
		}
		return this.snapshot();
	}

	async listDrafts(): Promise<readonly IBaseHalfGenerationDraft[]> {
		return [];
	}

	async listCards(): Promise<readonly IBaseHalfGenerationCardEntry[]> {
		return [];
	}

	async writeCopy(): Promise<boolean> {
		throw new Error('Not used by the panel.');
	}

	async update(_resource: URI, mutate: (info: IBaseHalfGenerationInfo) => IBaseHalfGenerationInfo): Promise<IBaseHalfGenerationCardSnapshot> {
		if (this.failure) {
			throw this.failure;
		}
		const next = mutate(this.info);
		if (next.prompt !== this.info.prompt) {
			this.prompts.push(next.prompt);
		}
		const choice = (info: IBaseHalfGenerationInfo) => JSON.stringify({ provider: info.provider, model: info.model, mode: info.mode, params: info.params });
		if (choice(next) !== choice(this.info)) {
			this.generations.push({ provider: next.provider, model: next.model, ...(next.mode ? { mode: next.mode } : {}), ...(next.params ? { params: next.params } : {}) });
		}
		this.info = next;
		this.infoReadable = true;
		this.changed.fire(this.resource);
		return this.snapshot();
	}

	async reorderUpstream(_resource: URI, upstream: readonly string[]): Promise<IBaseHalfGenerationCardSnapshot> {
		this.reorders.push(upstream);
		this.upstream = upstream;
		this.changed.fire(this.resource);
		return this.snapshot();
	}

	async resolveInputs(snapshot: IBaseHalfGenerationCardSnapshot): Promise<readonly IBaseHalfVideoResolvedInput[]> {
		return snapshot.upstream.map(path => ({ path, kind: baseHalfVideoInputKindOfPath(path), available: true }));
	}

	async nextFreeName(_folder: URI, base: string, extension: string): Promise<string> {
		return `${base}.${extension}`;
	}

	createDraft(): Promise<URI> {
		throw new Error('Not used by the panel.');
	}

	writeMade(): Promise<void> {
		throw new Error('Not used by the panel.');
	}

	/** Another window or an agent changed the card's generation information. */
	writeFromElsewhere(info: IBaseHalfGenerationInfo): void {
		this.info = info;
		this.changed.fire(this.resource);
	}
}

class FakeDraftOperations implements IBaseHalfDraftOperations {
	declare readonly _serviceBrand: undefined;
	readonly moves: string[] = [];

	async move(draft: URI, target: URI): Promise<URI> {
		this.moves.push(`${draft.path} -> ${target.path}`);
		return target;
	}

	delete(): Promise<IBaseHalfDraftSnapshot> {
		throw new Error('Not used by the panel.');
	}

	restore(): Promise<void> {
		throw new Error('Not used by the panel.');
	}
}

class FakeCatalogService extends Disposable implements IBaseHalfVideoCatalogService {
	declare readonly _serviceBrand: undefined;
	private readonly changed = this._register(new Emitter<void>());
	readonly onDidChange = this.changed.event;
	state: BaseHalfVideoCatalogState = { kind: 'ready', catalog: TEST_VIDEO_CATALOG };
	loads = 0;
	readonly checks: IBaseHalfVideoCheckRequest[] = [];
	answer: (request: IBaseHalfVideoCheckRequest) => IBaseHalfVideoCheckResult | undefined = () => ({ problems: [] });

	load(): void {
		this.loads++;
	}

	async whenReady(): Promise<IBaseHalfVideoCatalog> {
		if (this.state.kind === 'ready') {
			return this.state.catalog;
		}
		throw new Error('The catalog is not there.');
	}

	async check(request: IBaseHalfVideoCheckRequest): Promise<IBaseHalfVideoCheckResult | undefined> {
		this.checks.push(request);
		return this.answer(request);
	}

	set(state: BaseHalfVideoCatalogState): void {
		this.state = state;
		this.changed.fire();
	}
}

class FakeProviderSettings extends Disposable implements IBaseHalfVideoProviderSettingsService {
	declare readonly _serviceBrand: undefined;
	private readonly changed = this._register(new Emitter<void>());
	readonly onDidChange = this.changed.event;
	regions: Record<string, string> = {};
	notSetUp = new Set(['borealis']);
	readonly opened: (string | undefined)[] = [];

	getStatus(provider: IBaseHalfVideoCatalogProvider): IBaseHalfVideoProviderStatus {
		const region = findBaseHalfVideoRegion(provider, this.regions[provider.id]);
		const setUp = !this.notSetUp.has(provider.id);
		return { region, setUp, endpoint: region.baseUrl, customEndpoint: false, credentials: new Set(setUp ? provider.credentials.map(credential => credential.id) : []) };
	}

	async setRegion(): Promise<void> { }
	async setEndpoint(): Promise<void> { }
	async setCredential(): Promise<void> { }
	async getAccess(): Promise<IBaseHalfVideoProviderAccess | undefined> {
		return undefined;
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

class FakeGenerationService extends Disposable implements IBaseHalfVideoGenerationService {
	declare readonly _serviceBrand: undefined;
	private readonly progress = this._register(new Emitter<URI>());
	readonly onDidChangeProgress = this.progress.event;
	/** The prompt in the card's generation.yaml at each Generate. */
	readonly generated: string[] = [];
	stops = 0;
	generating = false;

	constructor(private readonly store: FakeCardStore) {
		super();
	}

	async generate(resource: URI): Promise<readonly URI[]> {
		this.generated.push(this.store.info.prompt);
		return [resource];
	}

	async stop(): Promise<void> {
		this.stops++;
	}

	async releaseCard(): Promise<void> { }

	/** The used inputs of each plan the panel had prepared for a check. */
	readonly prepared: string[][] = [];
	/** What the next preparations refuse with, as an input that is not a file on this computer. */
	refusal: string | undefined;

	async prepareInputMedia(plan: readonly IBaseHalfVideoInputPlanItem[]): Promise<IBaseHalfVideoPlannedMedia> {
		this.prepared.push(plan.filter(item => item.use !== 'unused' && item.use !== 'text').map(item => `${item.path}:${item.use}`));
		if (this.refusal) {
			throw new BaseHalfVideoGenerationError(this.refusal);
		}
		const file = (item: IBaseHalfVideoInputPlanItem): BaseHalfVideoMedia => ({ fsPath: `/workspace/${item.path}`, mimeType: `${item.kind}/*` });
		const first = (use: string) => plan.find(item => item.use === use);
		const references = (kind: string) => plan.filter(item => item.use === 'reference' && item.kind === kind).map(file);
		const start = first('start-frame');
		const end = first('end-frame');
		const source = first('source');
		return {
			...(start ? { startFrame: file(start) } : {}),
			...(end ? { endFrame: file(end) } : {}),
			images: references('image'),
			videos: references('video'),
			audios: references('audio'),
			...(source ? { source: file(source) } : {})
		};
	}

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
	let store: FakeCardStore;
	let drafts: FakeDraftOperations;
	let catalog: FakeCatalogService;
	let providers: FakeProviderSettings;
	let generation: FakeGenerationService;
	let notifications: RecordingNotificationService;
	let hovers: Map<HTMLElement, () => string>;
	let connections: { readonly added: string[]; readonly removed: string[]; undoSteps: number };
	let host: IBaseHalfVideoNodePanelHost & { cardFocused: number; picked: string | undefined };
	let mounted: HTMLElement[];

	setup(() => {
		instantiationService = disposables.add(new TestInstantiationService());
		store = disposables.add(new FakeCardStore({ prompt: '', ...READY }, ['frames/a.png', 'notes/scene.md', 'frames/b.png']));
		drafts = new FakeDraftOperations();
		catalog = disposables.add(new FakeCatalogService());
		providers = disposables.add(new FakeProviderSettings());
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
		instantiationService.set(IBaseHalfGenerationCardStore, store);
		instantiationService.set(IBaseHalfDraftOperations, drafts);
		instantiationService.set(IBaseHalfVideoCatalogService, catalog);
		instantiationService.set(IBaseHalfVideoProviderSettingsService, providers);
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
		const panel = disposables.add(instantiationService.createInstance(BaseHalfVideoNodePanel, NODE, host, { checkDelay: 0, ...options }));
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

	/** A menu item's name, without the second line of a model. */
	function menuLabel(item: HTMLElement): string | null | undefined {
		return item.querySelector('.bh-video-panel-menu-label')?.textContent;
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
		store.info = { prompt: '' };
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
		store.info = { prompt: 'Rain' };
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
		providers.notSetUp.add('acme');
		store.writeFromElsewhere({ prompt: 'Rain', ...READY });
		await settle();
		assert.deepStrictEqual({
			noModel,
			notSetUp: { label: generate.getAttribute('aria-label'), outlined: model.classList.contains('outlined') }
		}, {
			noModel: {
				disabled: 'true',
				label: 'Choose a model to generate.',
				tooltip: 'Choose a model to generate.',
				outlined: true,
				modelTooltip: 'Choose a model to generate.',
				generated: 0
			},
			notSetUp: { label: 'Acme Video is not set up. Set it up in Providers.', outlined: true }
		});
	});

	test('the first problem check reports blocks Generate, and the last answer for the model counts until the next one', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		catalog.answer = () => ({ problems: ['The prompt is longer than 2,000 characters.'] });
		const panel = await createPanel({ checkDelay: 250 });
		const generate = find(panel, '.bh-video-panel-generate');
		await timeout(300);
		const first = { label: generate.getAttribute('aria-label'), checks: catalog.checks.length };
		catalog.answer = () => ({ problems: [] });
		type(find<HTMLTextAreaElement>(panel, 'textarea'), 'A shorter prompt');
		await timeout(100);
		const whileAsking = { label: generate.getAttribute('aria-label'), checks: catalog.checks.length };
		await timeout(200);
		assert.deepStrictEqual({
			first,
			whileAsking,
			after: { label: generate.getAttribute('aria-label'), checks: catalog.checks.length, prompt: catalog.checks.at(-1)?.prompt }
		}, {
			first: { label: 'The prompt is longer than 2,000 characters.', checks: 1 },
			// The answer for the earlier prompt still blocks until the new one arrives.
			whileAsking: { label: 'The prompt is longer than 2,000 characters.', checks: 1 },
			after: { label: 'Generate', checks: 2, prompt: 'A shorter prompt' }
		});
	}));

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

	test('the reason Generate cannot run shows above the footer, and Set Up and Providers… open the provider it names', async () => {
		store.info = { prompt: 'Rain', provider: 'borealis', model: 'borealis-one' };
		const panel = await createPanel();
		const reason = find(panel, '.bh-video-panel-reason');
		const action = find<HTMLButtonElement>(panel, '.bh-video-panel-reason-action');
		const read = () => ({
			hidden: reason.hidden,
			text: find(panel, '.bh-video-panel-reason-text').textContent,
			action: action.hidden ? null : action.textContent,
			beforeFooter: reason.nextElementSibling?.classList.contains('bh-video-panel-footer')
		});
		const notSetUp = { ...read(), height: panel.height };
		action.click();
		providers.regions = { acme: 'west' };
		store.writeFromElsewhere({ prompt: 'Rain', provider: 'acme', model: 'acme-still' });
		await settle();
		const region = read();
		action.click();
		providers.regions = {};
		store.writeFromElsewhere({ prompt: 'Rain', ...READY });
		await settle();
		assert.deepStrictEqual({ notSetUp, region, ready: { hidden: reason.hidden, height: panel.height }, opened: providers.opened }, {
			notSetUp: { hidden: false, text: 'Borealis Media is not set up. Set it up in Providers.', action: 'Set Up', beforeFooter: true, height: notSetUp.height },
			region: { hidden: false, text: 'Acme Still is not offered in West · Acme Global. Choose another model, or another region in Providers.', action: 'Providers…', beforeFooter: true },
			ready: { hidden: true, height: 180 },
			opened: ['borealis', 'acme']
		});
		// The line takes its height above the footer: one line beside its action, or two.
		assert.ok(notSetUp.height >= 180 + 8 + 20 && notSetUp.height <= 180 + 8 + 32, `the panel with a reason line is ${notSetUp.height} px tall`);
	});

	test('check is asked with the files a generation would send, again when they change, and an input that is not a file on this computer is named instead', async () => {
		const files = disposables.add(new Emitter<FileChangesEvent>());
		instantiationService.stub(IFileService, { onDidFilesChange: files.event });
		const resolve = store.resolveInputs.bind(store);
		store.resolveInputs = async snapshot => (await resolve(snapshot)).map(input => ({ ...input, file: URI.joinPath(WORKSPACE, input.path) }));
		const panel = await createPanel();
		const asked = catalog.checks.at(-1)?.inputs;
		const checks = catalog.checks.length;
		files.fire(new FileChangesEvent([{ resource: URI.joinPath(WORKSPACE, 'frames', 'b.png'), type: FileChangeType.UPDATED }], false));
		await settle();
		const afterChange = catalog.checks.length;
		generation.refusal = 'b.png is not a file on this computer.';
		type(find<HTMLTextAreaElement>(panel, 'textarea'), 'Rain at night');
		await settle();
		const generate = find(panel, '.bh-video-panel-generate');
		assert.deepStrictEqual({
			asked,
			prepared: generation.prepared.at(0),
			afterChange: afterChange - checks,
			refused: { checks: catalog.checks.length - afterChange, reason: find(panel, '.bh-video-panel-reason-text').textContent, generate: [generate.getAttribute('aria-disabled'), generate.getAttribute('aria-label')] }
		}, {
			asked: { startFrame: { fsPath: '/workspace/frames/a.png', mimeType: 'image/*' }, endFrame: { fsPath: '/workspace/frames/b.png', mimeType: 'image/*' }, images: [], videos: [], audios: [] },
			prepared: ['frames/a.png:start-frame', 'frames/b.png:end-frame'],
			afterChange: 1,
			refused: { checks: 0, reason: 'b.png is not a file on this computer.', generate: ['true', 'b.png is not a file on this computer.'] }
		});
	});

	test('a number field in seconds shows s after it and says so to a screen reader', async () => {
		store.info = { prompt: 'Rain', provider: 'acme', model: 'acme-clip', mode: 'edit', params: { start: 2.5 } };
		const panel = await createPanel();
		find(panel, '.bh-video-panel-settings').click();
		find(panel, '.bh-video-panel-more').click();
		const section = find(panel, '.bh-video-panel-setting[data-parameter="start"]');
		const field = section.querySelector<HTMLInputElement>('.bh-video-panel-field');
		assert.deepStrictEqual({ value: field?.value, label: field?.getAttribute('aria-label'), unit: section.querySelector('.bh-video-panel-number-unit')?.textContent }, {
			value: '2.5', label: 'Start, in seconds', unit: 's'
		});
	});

	test('the model menu lists the catalog\'s models by provider, and choosing one keeps the values it accepts', async () => {
		store.info = { prompt: 'Rain', ...READY, mode: 'reference', params: { resolution: '1080p', ratio: '21:9', duration: 10, sound: false } };
		const panel = await createPanel();
		find(panel, '.bh-video-panel-model').click();
		const items = findAll(panel, '.bh-video-panel-menu-item').map(item => `${menuLabel(item)}${item.getAttribute('aria-checked') === 'true' ? '*' : ''}`);
		const details = findAll(panel, '.bh-video-panel-menu-item').map(item => item.querySelector('.bh-video-panel-menu-detail')?.textContent ?? null);
		const headings = findAll(panel, '.bh-video-panel-menu-heading').map(heading => heading.textContent);
		findAll(panel, '.bh-video-panel-menu-item').find(item => menuLabel(item) === 'Acme Still')?.click();
		await settle();
		assert.deepStrictEqual({ items, details, headings, written: store.generations, summary: find(panel, '.bh-video-panel-settings').textContent }, {
			items: ['Acme Motion 2*', 'Acme Still', 'Acme Clip', 'Borealis One', 'Providers…'],
			details: ['Frames · References · 12s · 1080p · Sound', 'Frames · 10s · 1080P', 'Extend · Edit · 720p', 'Frames', null],
			headings: ['Acme VideoEast · Acme Cloud', 'Borealis MediaNot set up'],
			written: [{ provider: 'acme', model: 'acme-still', mode: 'frames', params: { resolution: '1080p', duration: 10 } }],
			summary: 'Frames · 1080P · 10s'
		});
	});

	test('a model its region does not offer is dimmed with the reason, and Providers… opens on the card\'s provider', async () => {
		providers.regions = { acme: 'west' };
		const panel = await createPanel();
		find(panel, '.bh-video-panel-model').click();
		const still = findAll(panel, '.bh-video-panel-menu-item').find(item => menuLabel(item) === 'Acme Still')!;
		const dimmed = { unavailable: still.classList.contains('unavailable'), name: still.getAttribute('aria-label'), description: still.getAttribute('aria-description'), tooltip: hovers.get(still)?.() };
		findAll(panel, '.bh-video-panel-menu-item').find(item => menuLabel(item) === 'Providers…')?.click();
		await settle();
		assert.deepStrictEqual({ dimmed, opened: providers.opened }, {
			dimmed: { unavailable: true, name: 'Acme Still', description: 'Not offered in West · Acme Global. Frames · 10s · 1080P', tooltip: 'Not offered in West · Acme Global' },
			opened: ['acme']
		});
	});

	test('a setting changes at once and is saved, and the popover is drawn from the model\'s parameters for the mode', async () => {
		const panel = await createPanel();
		find(panel, '.bh-video-panel-settings').click();
		const groups = findAll(panel, '[role="radiogroup"]').map(group => group.getAttribute('aria-label'));
		const keys = findAll(panel, '.bh-video-panel-menu.settings [data-key]').map(control => control.dataset.key);
		findAll(panel, '.bh-video-panel-choice').find(choice => choice.textContent === '1080p')?.click();
		const shownAtOnce = find(panel, '.bh-video-panel-settings').textContent;
		await settle();
		assert.deepStrictEqual({ groups, keys, shownAtOnce, written: store.generations.map(written => written?.params) }, {
			groups: ['Mode', 'Resolution'],
			keys: ['mode:frames', 'mode:reference', 'resolution:480p', 'resolution:720p', 'resolution:1080p', 'duration:slider', 'duration:auto', 'sound', 'more'],
			shownAtOnce: 'Frames · 1080p · 5s · Sound',
			written: [{ resolution: '1080p', duration: 5, sound: true }]
		});
	});

	test('More shows the advanced parameters; an optional number left empty and an optional choice of None send nothing', async () => {
		store.info = { prompt: 'Rain', ...READY, params: { ...READY.params, seed: 42 } };
		const panel = await createPanel();
		find(panel, '.bh-video-panel-settings').click();
		const before = findAll(panel, '.bh-video-panel-menu.settings [data-key]').map(control => control.dataset.key);
		find(panel, '[data-key="more"]').click();
		const seed = find<HTMLInputElement>(panel, '[data-key="seed:field"]');
		const shown = { value: seed.value, placeholder: seed.placeholder, expanded: find(panel, '[data-key="more"]').getAttribute('aria-expanded') };
		seed.value = '';
		seed.dispatchEvent(new mainWindow.Event('change'));
		await settle();
		const cleared = store.generations.at(-1)?.params;
		const negative = find<HTMLInputElement>(panel, '[data-key="negative_prompt:text"]');
		negative.value = 'blur, text';
		negative.dispatchEvent(new InputEvent('input'));
		const unsavedWhileTyping = store.generations.length;
		press(negative, 'Enter');
		await settle();
		assert.deepStrictEqual({ before, shown, cleared, unsavedWhileTyping, typed: store.generations.at(-1)?.params }, {
			before: ['mode:frames', 'mode:reference', 'resolution:480p', 'resolution:720p', 'resolution:1080p', 'duration:slider', 'duration:auto', 'sound', 'more'],
			shown: { value: '42', placeholder: 'Not set', expanded: 'true' },
			cleared: { resolution: '720p', duration: 5, sound: true },
			unsavedWhileTyping: 1,
			typed: { resolution: '720p', duration: 5, sound: true, negative_prompt: 'blur, text' }
		});
		store.info = { prompt: 'Rain', provider: 'borealis', model: 'borealis-one', params: { style: 'ink' } };
		store.writeFromElsewhere(store.info);
		await settle();
		const style = findAll(panel, '.bh-video-panel-setting.list .bh-video-panel-choice').map(choice => `${choice.textContent}${choice.getAttribute('aria-checked') === 'true' ? '*' : ''}`);
		find(panel, '[data-key="style:none"]').click();
		await settle();
		assert.deepStrictEqual({ style, unset: store.generations.at(-1)?.params }, {
			style: ['None', 'Film', 'Anime', 'Clay', 'Ink*', 'Pixel', 'Neon', 'Paper'],
			unset: { strength: 0.5, caption: '' }
		});
	});

	test('while the catalog loads, the model button says so, the settings wait, and Generate says why', async () => {
		catalog.state = { kind: 'loading' };
		const panel = await createPanel();
		const model = find(panel, '.bh-video-panel-model');
		const loading = {
			model: model.textContent,
			settingsHidden: find(panel, '.bh-video-panel-settings').hidden,
			generate: find(panel, '.bh-video-panel-generate').getAttribute('aria-label'),
			loads: catalog.loads,
			catalog: panel.element.dataset.catalog
		};
		model.click();
		const menu = findAll(panel, '.bh-video-panel-menu.model > *').map(element => element.textContent);
		catalog.set({ kind: 'ready', catalog: TEST_VIDEO_CATALOG });
		await settle();
		assert.deepStrictEqual({ loading, menu, ready: [model.textContent, find(panel, '.bh-video-panel-settings').hidden] }, {
			loading: { model: 'Loading Models…', settingsHidden: true, generate: 'The models are still loading.', loads: 1, catalog: 'loading' },
			menu: ['Loading the models…', '', 'Providers…'],
			ready: ['Acme Motion 2', false]
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
		store.writeFromElsewhere({ ...store.info, ...READY, params: { ...READY.params, resolution: '1080p' } });
		providers.change();
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

	test('an agent\'s new prompt shows when the panel holds no unsaved text, and while the prompt has the focus it keeps what the user typed', async () => {
		const panel = await createPanel();
		const prompt = find<HTMLTextAreaElement>(panel, 'textarea');
		store.writeFromElsewhere({ ...store.info, prompt: 'Written by an agent.' });
		await settle();
		const atRest = prompt.value;
		prompt.focus();
		type(prompt, 'Typed by the user.');
		store.writeFromElsewhere({ ...store.info, prompt: 'Written again by the agent.', model: 'acme-still' });
		await settle();
		const whileTyping = prompt.value;
		// The window of a test may not have the focus, which keeps a real blur from firing.
		prompt.dispatchEvent(new FocusEvent('blur'));
		await settle();
		assert.deepStrictEqual({ atRest, whileTyping, saved: [store.info.prompt, store.info.model] }, {
			atRest: 'Written by an agent.',
			whileTyping: 'Typed by the user.',
			saved: ['Typed by the user.', 'acme-still']
		});
	});

	test('a prompt the file changed while the field had the focus and nothing was typed shows once the field is left', async () => {
		const panel = await createPanel();
		const prompt = find<HTMLTextAreaElement>(panel, 'textarea');
		prompt.focus();
		store.writeFromElsewhere({ ...store.info, prompt: 'Written by an agent.' });
		await settle();
		const focused = prompt.value;
		// The window of a test may not have the focus, which keeps a real blur from firing.
		prompt.dispatchEvent(new FocusEvent('blur'));
		await settle();
		assert.deepStrictEqual({ focused, left: prompt.value, written: store.prompts }, { focused: '', left: 'Written by an agent.', written: [] });
	});

	test('an image card lists the image models, and an image model that delivers another format renames the draft at once', async () => {
		catalog.state = { kind: 'ready', catalog: TEST_GENERATION_CATALOG };
		providers.notSetUp = new Set();
		store.kind = 'image';
		store.path = 'shots/image.png';
		store.info = { prompt: 'A heron.', provider: 'corvid', model: 'corvid-paint', mode: 'reference', params: { count: 2 } };
		const renamed: string[] = [];
		host.didRenameCard = resource => renamed.push(resource.path);
		const panel = disposables.add(instantiationService.createInstance(BaseHalfVideoNodePanel, store.resource, host, { checkDelay: 0 }));
		mainWindow.document.body.appendChild(panel.element);
		mounted.push(panel.element);
		await settle();
		find(panel, '.bh-video-panel-model').click();
		const items = findAll(panel, '.bh-video-panel-menu-item').map(item => `${menuLabel(item)}${item.querySelector('.bh-video-panel-menu-detail') ? ` (${item.querySelector('.bh-video-panel-menu-detail')?.textContent})` : ''}`);
		findAll(panel, '.bh-video-panel-menu-item').find(item => menuLabel(item) === 'Corvid Print')?.click();
		await settle();
		assert.deepStrictEqual({
			items,
			placeholder: find<HTMLTextAreaElement>(panel, 'textarea').placeholder,
			written: store.generations.at(-1),
			moves: drafts.moves,
			renamed
		}, {
			items: ['Corvid Paint (4K · Up to 4 images · 4 references)', 'Corvid Print (2K · Up to 2 images · 4 references)', 'Providers…'],
			placeholder: 'Describe the image. Type @ to name an input.',
			written: { provider: 'corvid', model: 'corvid-print', mode: 'reference', params: { resolution: '2k', count: 2 } },
			moves: ['/workspace/shots/image.png -> /workspace/shots/image.jpg'],
			renamed: ['/workspace/shots/image.jpg']
		});
	});

	test('a card whose prompt and settings cannot be read says so and stays usable; a save writes the new ones', async () => {
		store.infoReadable = false;
		store.info = { prompt: '' };
		const panel = await createPanel();
		const notice = find(panel, '.bh-video-panel-notice');
		const shown = { hidden: notice.hidden, text: notice.textContent, prompt: find(panel, '.bh-video-panel-prompt').hidden };
		type(find<HTMLTextAreaElement>(panel, 'textarea'), 'Rain');
		await panel.flush();
		await settle();
		assert.deepStrictEqual({ shown, saved: store.prompts, after: notice.hidden }, {
			shown: { hidden: false, text: 'BaseHalf could not read this card\'s prompt and settings.', prompt: false },
			saved: ['Rain'],
			after: true
		});
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
		// A menu item by its name, without the second line of a model.
		const focused = () => (mainWindow.document.activeElement as HTMLElement | null)?.querySelector('.bh-video-panel-menu-label')?.textContent;
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
			opened: 'Acme Motion 2',
			down: 'Acme Still',
			end: 'Providers…',
			home: 'Acme Motion 2',
			settings: ['radio', 'Frames']
		});
	});

	test('a menu that a click opened has no current item until an arrow key chooses one; from the keyboard it starts at its first item', async () => {
		const panel = await createPanel();
		const add = find(panel, '.bh-video-panel-add');
		const active = () => mainWindow.document.activeElement as HTMLElement;
		// The focused item by its name, or the menu itself.
		const current = () => active().matches('.bh-video-panel-menu') ? 'menu' : active().querySelector('.bh-video-panel-menu-label')?.textContent ?? active().className;
		// A click of the mouse counts one; the click that Enter or Space makes on a button counts none.
		const clickWithMouse = (element: HTMLElement) => element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
		clickWithMouse(add);
		const clicked = current();
		press(active(), 'ArrowDown');
		const down = current();
		press(active(), 'Escape');
		clickWithMouse(add);
		press(active(), 'ArrowUp');
		const up = current();
		press(active(), 'Escape');
		add.click();
		const fromKeyboard = current();
		press(active(), 'Escape');
		// A model that is checked stays where a click opens its menu.
		clickWithMouse(find(panel, '.bh-video-panel-model'));
		const checked = current();
		assert.deepStrictEqual({ clicked, down, up, fromKeyboard, checked }, {
			clicked: 'menu',
			down: 'Pick on Canvas',
			up: 'Import File…',
			fromKeyboard: 'Pick on Canvas',
			checked: 'Acme Motion 2'
		});
	});

	test('says when the card cannot be read, and shows why Generate did not start', async () => {
		const unreadable = disposables.add(new FakeCardStore({ prompt: '' }, []));
		unreadable.unreadable = new Error('shot.mp4 is not an image or video card.');
		instantiationService.set(IBaseHalfGenerationCardStore, unreadable);
		const broken = await createPanel();
		const notice = { state: broken.element.dataset.state, text: find(broken, '.bh-video-panel-notice').textContent, prompt: find(broken, '.bh-video-panel-prompt').hidden };
		instantiationService.set(IBaseHalfGenerationCardStore, store);
		generation.generate = async () => { throw new Error('huge.png is larger than 30 MiB, the most Acme Motion 2 takes.'); };
		const panel = await createPanel();
		find(panel, '.bh-video-panel-generate').click();
		await settle();
		assert.deepStrictEqual({ notice, refused: notifications.shown }, {
			notice: { state: 'unreadable', text: 'This card cannot be read: shot.mp4 is not an image or video card.', prompt: true },
			refused: ['huge.png is larger than 30 MiB, the most Acme Motion 2 takes.']
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
		const measure = async (generationChoice: IBaseHalfVideoGenerationChoice) => {
			store.info = { prompt: 'Image 1 rides along the sea at dusk.', ...generationChoice };
			const panel = disposables.add(instantiationService.createInstance(BaseHalfVideoNodePanel, NODE, host, { checkDelay: 0 }));
			frame.replaceChildren(panel.element);
			await settle();
			const box = (selector: string) => find(panel, selector).getBoundingClientRect();
			const clipped = (selector: string) => {
				const element = find(panel, selector);
				return element.scrollWidth > element.clientWidth;
			};
			const outer = panel.element.getBoundingClientRect();
			// What the footer holds: the model, the settings, and Generate, and no price (video node, acceptance criterion 22).
			const footerHolds = Array.from(find(panel, '.bh-video-panel-footer').children).map(child => child.classList[0]);
			// The controls of the footer that show, from left to right.
			const shownInFooter = ['.bh-video-panel-model', '.bh-video-panel-settings', '.bh-video-panel-generate']
				.filter(selector => !find(panel, selector).hidden)
				.map(selector => box(selector));
			const footer = box('.bh-video-panel-footer');
			const slots = findAll(panel, '.bh-video-panel-slot').map(slot => slot.getBoundingClientRect());
			const row = box('.bh-video-panel-inputs');
			const settingsShown = !find(panel, '.bh-video-panel-settings').hidden;
			let clippedChoices: (string | null)[] = [];
			let popoverWidth = 0;
			if (settingsShown) {
				find(panel, '.bh-video-panel-settings').click();
				clippedChoices = findAll(panel, '.bh-video-panel-choice-label').filter(label => label.scrollWidth > label.clientWidth).map(label => label.textContent);
				popoverWidth = box('.bh-video-panel-menu.settings').width;
			}
			const result = {
				height: outer.height,
				reported: panel.height,
				modelClipped: clipped('.bh-video-panel-model-label'),
				settingsClipped: settingsShown && clipped('.bh-video-panel-settings-label'),
				footerHolds,
				footerInOrder: shownInFooter.every((rect, index) => index === 0 || shownInFooter[index - 1].right <= rect.left) && shownInFooter[shownInFooter.length - 1].right <= outer.right - 12,
				footerInside: footer.bottom <= outer.bottom - 12,
				slotsInside: slots.every(slot => slot.left >= row.left && slot.right <= row.right),
				clippedChoices,
				popoverWidth
			};
			panel.dispose();
			return result;
		};
		const motion = await measure(READY);
		const long = await measure({ provider: 'acme', model: 'acme-motion-with-a-very-long-name-that-a-catalog-no-longer-has-1015-preview' });
		assert.deepStrictEqual({ motion, long: { modelClipped: long.modelClipped, footerInOrder: long.footerInOrder } }, {
			motion: {
				height: 180,
				reported: 180,
				modelClipped: false,
				settingsClipped: false,
				footerHolds: ['bh-video-panel-model', 'bh-video-panel-settings', 'bh-video-panel-footer-space', 'bh-video-panel-generate'],
				footerInOrder: true,
				footerInside: true,
				slotsInside: true,
				clippedChoices: [],
				popoverWidth: 300
			},
			// A long model id ends with an ellipsis and shows in full in its tooltip; the rest keeps its place.
			long: { modelClipped: true, footerInOrder: true }
		});
	});

	test('the panel is taller with an input row, and reports its height when it changes', async () => {
		// Set up, so that no reason line shows.
		providers.notSetUp = new Set();
		const panel = await createPanel();
		const heights: number[] = [];
		disposables.add(panel.onDidChangeHeight(height => heights.push(height)));
		const withRow = panel.height;
		store.upstream = [];
		store.writeFromElsewhere({ prompt: 'Rain', provider: 'borealis', model: 'borealis-one' });
		await settle();
		assert.deepStrictEqual({ withRow, withoutRow: panel.height, heights }, { withRow: 180, withoutRow: 132, heights: [132] });
	});
});
