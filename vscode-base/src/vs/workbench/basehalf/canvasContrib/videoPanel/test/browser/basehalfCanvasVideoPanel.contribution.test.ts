/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../../base/browser/window.js';
import { timeout } from '../../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { extUri } from '../../../../../../base/common/resources.js';
import { URI } from '../../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { IFileDialogService } from '../../../../../../platform/dialogs/common/dialogs.js';
import { FileOperationError, FileOperationResult, IFileService } from '../../../../../../platform/files/common/files.js';
import { TestInstantiationService } from '../../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILogService, NullLogService } from '../../../../../../platform/log/common/log.js';
import { IUriIdentityService } from '../../../../../../platform/uriIdentity/common/uriIdentity.js';
import { ILifecycleService, WillShutdownEvent } from '../../../../../services/lifecycle/common/lifecycle.js';
import { IBaseHalfCanvasGenerationCard, IBaseHalfCanvasItem } from '../../../../canvas/common/basehalfCanvasModel.js';
import { baseHalfTestCanvasItem, createBaseHalfTestCanvasView, IBaseHalfTestCanvasView } from '../../../../canvas/test/browser/basehalfCanvasViewFixture.js';
import { IBaseHalfCanvasNavigationService, IBaseHalfCanvasNavigationState } from '../../../../navigation/common/basehalfCanvasNavigation.js';
import { IBaseHalfGenerationRecordPanelHost } from '../../../../video/browser/basehalfGenerationRecordPanel.js';
import { IBaseHalfVideoNodePanelHost, IBaseHalfVideoNodePanelOptions } from '../../../../video/browser/basehalfVideoNodePanel.js';
import { BaseHalfCanvasVideoPanel, IBaseHalfCanvasVideoPanelWidget } from '../../browser/basehalfCanvasVideoPanel.contribution.js';

/** A panel that records what the canvas asks of it. */
class TestVideoPanel implements IBaseHalfCanvasVideoPanelWidget {
	readonly element = mainWindow.document.createElement('div');
	height = 120;
	flushed = 0;
	disposed = false;
	private readonly onDidChangeHeightEmitter = new Emitter<number>();
	readonly onDidChangeHeight = this.onDidChangeHeightEmitter.event;

	constructor(readonly resource: URI, readonly host: IBaseHalfVideoNodePanelHost, readonly options: IBaseHalfVideoNodePanelOptions) { }

	async flush(): Promise<void> {
		this.flushed++;
	}

	grow(height: number): void {
		this.height = height;
		this.onDidChangeHeightEmitter.fire(height);
	}

	dispose(): void {
		this.disposed = true;
		this.onDidChangeHeightEmitter.dispose();
	}
}

/** The panel of a card with its file, which shows what made it. */
class TestRecordPanel extends TestVideoPanel {
	constructor(resource: URI, readonly recordHost: IBaseHalfGenerationRecordPanelHost) {
		super(resource, undefined!, {});
	}
}

class TestCanvasVideoPanel extends BaseHalfCanvasVideoPanel {
	readonly panels: TestVideoPanel[] = [];

	protected override createPanel(resource: URI, host: IBaseHalfVideoNodePanelHost, options: IBaseHalfVideoNodePanelOptions): IBaseHalfCanvasVideoPanelWidget {
		const panel = new TestVideoPanel(resource, host, options);
		this.panels.push(panel);
		return panel;
	}

	protected override createRecordPanel(resource: URI, host: IBaseHalfGenerationRecordPanelHost): IBaseHalfCanvasVideoPanelWidget {
		const panel = new TestRecordPanel(resource, host);
		this.panels.push(panel);
		return panel;
	}
}

const CLIP = 'folder/clip.mp4';
const STILL = 'folder/still.png';
const NOTE = 'folder/note.md';

/** An item of the test folder that is a generation card, a draft unless it has its file. */
function generationItem(path: string, generation: IBaseHalfCanvasGenerationCard): IBaseHalfCanvasItem {
	return { ...baseHalfTestCanvasItem(path), generation };
}

suite('BaseHalfCanvasVideoPanel', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let navigationState: IBaseHalfCanvasNavigationState;
	let existing: Set<string>;
	let drafts: Set<string>;
	let copies: string[];
	let picked: URI | undefined;
	let filters: { readonly name: string; readonly extensions: readonly string[] }[] | undefined;
	let shutdown: Emitter<WillShutdownEvent>;

	function createPanel(): { canvas: IBaseHalfTestCanvasView; feature: TestCanvasVideoPanel } {
		navigationState = { canvasFolder: undefined, cardDetail: undefined };
		existing = new Set();
		drafts = new Set();
		copies = [];
		picked = undefined;
		shutdown = store.add(new Emitter<WillShutdownEvent>());
		const canvas = createBaseHalfTestCanvasView(store);
		canvas.setItem(generationItem(CLIP, { kind: 'video', draft: true }), { kind: 'draft' });
		canvas.setItem(generationItem(STILL, { kind: 'image', draft: false }));
		canvas.setItem(baseHalfTestCanvasItem(NOTE), { kind: 'markdown', text: '# Note' });
		const instantiationService = store.add(new TestInstantiationService());
		instantiationService.stub(IBaseHalfCanvasNavigationService, { get state() { return navigationState; } });
		instantiationService.stub(IFileDialogService, {
			showOpenDialog: async (options: { readonly filters?: { readonly name: string; readonly extensions: readonly string[] }[] }) => {
				filters = options.filters;
				return picked ? [picked] : undefined;
			}
		});
		instantiationService.stub(IFileService, {
			exists: async (resource: URI) => existing.has(resource.path),
			stat: async (resource: URI) => {
				// A draft's card information is a generation.yaml under .bh/mirror/, in folders that are there.
				const file = drafts.has(resource.path) || existing.has(resource.path);
				const folder = resource.path === '/workspace/folder' || [...drafts].some(draft => draft.startsWith(`${resource.path}/`));
				if (file || folder) {
					return { isFile: file, isDirectory: folder, isSymbolicLink: false } as never;
				}
				throw new FileOperationError('not found', FileOperationResult.FILE_NOT_FOUND);
			},
			copy: async (source: URI, target: URI) => {
				copies.push(`${source.path} -> ${target.path}`);
				return undefined as never;
			}
		});
		instantiationService.stub(IUriIdentityService, { extUri });
		instantiationService.stub(ILogService, new NullLogService());
		instantiationService.stub(ILifecycleService, { onWillShutdown: shutdown.event });
		const feature = store.add(instantiationService.createInstance(TestCanvasVideoPanel, { canvas }));
		return { canvas, feature };
	}

	test('shows the panel for one selected generation card, a draft or an image with its file, and saves its prompt and takes it away for another selection', async () => {
		const { canvas, feature } = createPanel();
		canvas.changeSelection([CLIP]);
		assert.strictEqual(feature.panels.length, 1);
		assert.strictEqual(feature.panels[0].resource.path, '/workspace/folder/clip.mp4');
		assert.strictEqual(canvas.cardPanels.get(CLIP), feature.panels[0].element);
		assert.deepStrictEqual(canvas.calls, [`showCardPanel folder ${CLIP} 120`]);

		canvas.changeSelection([NOTE]);
		await timeout(0);
		assert.strictEqual(canvas.cardPanels.size, 0);
		assert.strictEqual(feature.panels[0].flushed, 1);
		assert.strictEqual(feature.panels[0].disposed, true);

		canvas.changeSelection([CLIP, NOTE]);
		assert.strictEqual(feature.panels.length, 1, 'two selected cards show no panel');

		canvas.changeSelection([STILL]);
		assert.strictEqual(feature.panels.at(-1)?.resource.path, '/workspace/folder/still.png');
		assert.ok(feature.panels.at(-1) instanceof TestRecordPanel, 'a card with its file gets the panel that shows what made it (D67)');
		assert.ok(!(feature.panels[0] instanceof TestRecordPanel), 'a draft gets the panel that makes its file');
	});

	test('a draft whose file lands gets the panel of a card with its file in place of its own, on the same card (D67)', async () => {
		const { canvas, feature } = createPanel();
		canvas.changeSelection([CLIP]);
		const draftPanel = feature.panels[0];
		canvas.setItem(generationItem(CLIP, { kind: 'video', draft: false }));
		canvas.showScene(canvas.scene);
		await timeout(0);
		assert.strictEqual(feature.panels.length, 2);
		assert.ok(feature.panels[1] instanceof TestRecordPanel);
		assert.strictEqual(draftPanel.flushed, 1, 'the draft\'s prompt is saved before its panel goes');
		assert.strictEqual(draftPanel.disposed, true);
		assert.strictEqual(canvas.cardPanels.get(CLIP), feature.panels[1].element);

		canvas.showScene(canvas.scene);
		assert.strictEqual(feature.panels.length, 2, 'drawn again, the card keeps its panel');
	});

	test('New Version selects the draft it made as a card the user just created, in sight, and its prompt takes the focus, once (D67)', async () => {
		const { canvas, feature } = createPanel();
		canvas.changeSelection([STILL]);
		const record = feature.panels[0] as TestRecordPanel;
		// A draft in another folder is not this canvas's to select.
		record.recordHost.didMakeNewVersion(URI.file('/workspace/elsewhere/still-2.png'));
		record.recordHost.didMakeNewVersion(URI.file('/workspace/folder/still-2.png'));
		assert.deepStrictEqual(canvas.calls.filter(call => call.startsWith('selectCreatedCard')), ['selectCreatedCard folder/still-2.png']);
		canvas.setItem(generationItem('folder/still-2.png', { kind: 'image', draft: true }), { kind: 'draft' });
		// The drawing that shows the new card selects it.
		canvas.showScene(canvas.scene, { selection: ['folder/still-2.png'] });
		const draftPanel = feature.panels.at(-1)!;
		assert.strictEqual(draftPanel.resource.path, '/workspace/folder/still-2.png');
		assert.strictEqual(draftPanel.options.focusPromptWhenShown, true);

		canvas.changeSelection([]);
		await timeout(0);
		canvas.changeSelection(['folder/still-2.png']);
		assert.strictEqual(feature.panels.at(-1)!.options.focusPromptWhenShown, false);

		record.recordHost.focusCard();
		assert.strictEqual(canvas.calls.at(-1), `focusCard ${STILL}`);
	});

	test('a selected file that becomes a generation card, as when an agent writes its generation information, gets its panel once it is drawn so', () => {
		const { canvas, feature } = createPanel();
		canvas.setItem(baseHalfTestCanvasItem('folder/photo.png'), { kind: 'media', text: 'Image file', mediaKind: 'image', resource: URI.file('/workspace/folder/photo.png') });
		canvas.changeSelection(['folder/photo.png']);
		assert.strictEqual(feature.panels.length, 0);
		canvas.setItem(generationItem('folder/photo.png', { kind: 'image', draft: false }));
		canvas.showScene(canvas.scene);
		assert.strictEqual(feature.panels.length, 1);
		assert.strictEqual(canvas.cardPanels.get('folder/photo.png'), feature.panels[0].element);
	});

	test('stays on its card while the canvas is drawn again, and goes when Card Detail opens or the card is no generation card', async () => {
		const { canvas, feature } = createPanel();
		canvas.changeSelection([CLIP]);
		canvas.calls.length = 0;
		canvas.showScene(canvas.scene);
		assert.deepStrictEqual(canvas.calls, [`showCardPanel folder ${CLIP} 120`]);
		canvas.showScene(canvas.scene, { drawn: false });
		assert.strictEqual(canvas.calls.length, 1, 'a folder that could not be read leaves the panel as it is');

		navigationState = { canvasFolder: undefined, cardDetail: {} as never };
		canvas.showScene(canvas.scene);
		await timeout(0);
		assert.strictEqual(canvas.cardPanels.size, 0);

		navigationState = { canvasFolder: undefined, cardDetail: undefined };
		canvas.changeSelection([CLIP]);
		assert.strictEqual(feature.panels.length, 2);
		canvas.setItem(baseHalfTestCanvasItem(CLIP), { kind: 'media', text: 'Video file', mediaKind: 'video', resource: URI.file('/workspace/folder/clip.mp4') });
		canvas.showScene(canvas.scene);
		await timeout(0);
		assert.strictEqual(canvas.cardPanels.size, 0);
	});

	test('follows the height of its panel', () => {
		const { canvas, feature } = createPanel();
		canvas.changeSelection([CLIP]);
		canvas.calls.length = 0;
		feature.panels[0].grow(240);
		assert.deepStrictEqual(canvas.calls, [`showCardPanel folder ${CLIP} 240`]);
	});

	test('gives the focus to the prompt of a draft the user just created, once', async () => {
		const { canvas, feature } = createPanel();
		canvas.createdNodeFocusPath = CLIP;
		canvas.changeSelection([CLIP]);
		assert.strictEqual(feature.panels[0].options.focusPromptWhenShown, true);
		canvas.changeSelection([]);
		await timeout(0);
		canvas.changeSelection([CLIP]);
		assert.strictEqual(feature.panels[1].options.focusPromptWhenShown, false);
	});

	test('picks cards through the canvas, and taking the panel away ends picking', async () => {
		const { canvas, feature } = createPanel();
		canvas.changeSelection([CLIP]);
		const host = feature.panels[0].host;
		const pick = { title: 'Pick cards', cardOf: () => ({ action: 'connect' as const }), pick: () => { }, ended: () => { }, onDidChange: Event.None };
		const picking = host.startPick(pick);
		const started = { calls: canvas.calls.includes('startCardPick Pick cards'), pick: canvas.cardPick === pick };
		picking.dispose();
		const disposed = canvas.cardPick;

		host.focusCard();
		assert.strictEqual(canvas.calls.at(-1), `focusCard ${CLIP}`);
		// A change of connections in the panel draws the canvas's lines at once.
		host.didChangeConnections!();
		assert.strictEqual(canvas.calls.at(-1), 'requestRender');

		const again = host.startPick(pick);
		canvas.changeSelection([]);
		await timeout(0);
		const closed = canvas.cardPick;
		again.dispose();
		assert.deepStrictEqual({ started, disposed, closed }, { started: { calls: true, pick: true }, disposed: undefined, closed: undefined });
	});

	test('selects a draft that Generate made beside the card, and a draft its model renamed, once its card is drawn', () => {
		const { canvas, feature } = createPanel();
		canvas.changeSelection([CLIP]);
		feature.panels[0].host.didGenerateInNode!(URI.file('/workspace/folder/clip-2.mp4'));
		assert.strictEqual(canvas.calls.at(-1), 'requestRender');
		canvas.setItem(generationItem('folder/clip-2.mp4', { kind: 'video', draft: true }), { kind: 'draft' });
		canvas.showScene(canvas.scene);
		assert.ok(canvas.calls.includes('select folder/clip-2.mp4'));
		assert.strictEqual(feature.panels.at(-1)?.resource.path, '/workspace/folder/clip-2.mp4');

		feature.panels.at(-1)!.host.didRenameCard!(URI.file('/workspace/folder/image.jpg'));
		canvas.setItem(generationItem('folder/image.jpg', { kind: 'image', draft: true }), { kind: 'draft' });
		canvas.showScene(canvas.scene);
		assert.ok(canvas.calls.includes('select folder/image.jpg'));
		assert.strictEqual(feature.panels.at(-1)?.resource.path, '/workspace/folder/image.jpg');
	});

	test('imports a file beside the card under a name that no file and no draft has, and takes a file of its folder as it is', async () => {
		const { canvas, feature } = createPanel();
		canvas.changeSelection([CLIP]);
		const host = feature.panels[0].host;
		picked = URI.file('/elsewhere/frame.png');
		existing.add('/workspace/folder/frame.png');
		// A draft has the next name.
		drafts.add('/workspace/.bh/mirror/folder/frame 2.png/generation.yaml');
		const accept = async () => true;
		const every = ['image', 'video', 'audio', 'text'] as const;
		assert.strictEqual(await host.importFile(accept, every), 'folder/frame 3.png');
		assert.deepStrictEqual(copies, ['/elsewhere/frame.png -> /workspace/folder/frame 3.png']);

		picked = URI.file('/workspace/folder/already.png');
		assert.strictEqual(await host.importFile(accept, every), 'folder/already.png');
		assert.strictEqual(copies.length, 1);

		picked = undefined;
		assert.strictEqual(await host.importFile(accept, every), undefined);

		// A file the model cannot use is refused before anything is copied (D67).
		picked = URI.file('/elsewhere/notes.pdf');
		assert.strictEqual(await host.importFile(async path => path !== 'folder/notes.pdf', every), undefined);
		assert.strictEqual(copies.length, 1);
	});

	test('offers the files of the kinds the card takes: images and notes on an image card, every kind on a video card (D90)', async () => {
		const { canvas, feature } = createPanel();
		canvas.changeSelection([CLIP]);
		const host = feature.panels[0].host;
		await host.importFile(async () => true, ['image', 'text']);
		const image = filters;
		await host.importFile(async () => true, ['image', 'video', 'audio', 'text']);
		assert.deepStrictEqual({ image, video: filters?.map(filter => filter.name) }, {
			image: [{ name: 'Images and Text', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif', 'bmp', 'md', 'markdown', 'txt'] }],
			video: ['Images, Videos, Audio, and Text']
		});
	});

	test('saves the prompt when the window closes, and when it is disposed', () => {
		const { canvas, feature } = createPanel();
		canvas.changeSelection([CLIP]);
		const joins: Promise<unknown>[] = [];
		shutdown.fire({ join: (promise: Promise<unknown>) => joins.push(promise) } as never);
		assert.strictEqual(joins.length, 1);
		assert.strictEqual(feature.panels[0].flushed, 1);
		feature.dispose();
		assert.strictEqual(feature.panels[0].disposed, true);
	});
});
