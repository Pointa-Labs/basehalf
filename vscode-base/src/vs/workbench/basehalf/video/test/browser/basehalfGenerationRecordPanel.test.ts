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
import { BaseHalfGenerationRecordPanel, IBaseHalfGenerationRecordPanelHost } from '../../browser/basehalfGenerationRecordPanel.js';
import { IBaseHalfGenerationMade } from '../../common/basehalfGenerationInfo.js';
import { BaseHalfVideoCatalogState, baseHalfVideoInputKindOfPath } from '../../common/basehalfVideoCatalog.js';
import {
	IBaseHalfGenerationCardActions,
	IBaseHalfGenerationCardSnapshot,
	IBaseHalfGenerationCardStore,
	IBaseHalfVideoCatalogService,
	IBaseHalfVideoResolvedInput
} from '../../common/basehalfVideoGeneration.js';
import { TEST_GENERATION_CATALOG } from '../common/basehalfVideoCatalogFixture.js';

const WORKSPACE = URI.file('/workspace');
const CARD = URI.joinPath(WORKSPACE, 'shots', 'shot.mp4');
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

	async function createPanel(): Promise<BaseHalfGenerationRecordPanel> {
		const panel = disposables.add(instantiationService.createInstance(BaseHalfGenerationRecordPanel, CARD, host));
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
		snapshot = { ...snapshot, made: { ...MADE, prompt: 'Image 1 rides along the sea to Image 2.' } };
		const panel = await createPanel();
		const tiles = [...panel.element.querySelectorAll<HTMLElement>('.bh-input-tile')];
		assert.deepStrictEqual({
			state: panel.element.dataset.state,
			// The tiles of a draft's input row, read only: no plus, cross, @, or swap (D68).
			inputs: tiles.map(tile => tile.getAttribute('aria-label')),
			numbers: tiles.map(tile => tile.querySelector('.bh-input-tile-number')?.textContent),
			gone: tiles.map(tile => tile.classList.contains('dimmed')),
			controls: panel.element.querySelectorAll('.bh-input-row-add, .bh-input-tile-remove, .bh-input-tile-name, .bh-input-row-swap').length,
			prompt: texts(panel, '.bh-prompt-editor'),
			// Its names are chips of the inputs it was made from, the one that is gone too.
			chips: [...panel.element.querySelectorAll<HTMLElement>('.bh-prompt-chip')].map(chip => chip.dataset.name),
			model: texts(panel, '.bh-record-panel-model'),
			settings: texts(panel, '.bh-record-panel-settings'),
			buttons: [...panel.element.querySelectorAll('button')].map(button => button.textContent),
			fields: panel.element.querySelectorAll('textarea, input, [contenteditable="true"]').length,
			newVersionTitle: hovers.get(panel.element.querySelector<HTMLElement>('.bh-record-panel-new-version')!)?.(),
			settingsTitle: hovers.get(panel.element.querySelector<HTMLElement>('.bh-record-panel-settings')!)?.(),
			height: panel.height
		}, {
			state: 'ready',
			inputs: ['Image 1, Start, a.png', 'Image 2, End, b.png, Not there any more.'],
			numbers: ['1', '2'],
			gone: [false, true],
			controls: 0,
			prompt: ['Image 1 rides along the sea to Image 2.'],
			chips: ['Image 1', 'Image 2'],
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
});
