/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../../base/browser/window.js';
import { timeout } from '../../../../../../base/common/async.js';
import { Emitter } from '../../../../../../base/common/event.js';
import { extUri } from '../../../../../../base/common/resources.js';
import { URI } from '../../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { IFileDialogService } from '../../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { TestInstantiationService } from '../../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILogService, NullLogService } from '../../../../../../platform/log/common/log.js';
import { IUriIdentityService } from '../../../../../../platform/uriIdentity/common/uriIdentity.js';
import { ILifecycleService, WillShutdownEvent } from '../../../../../services/lifecycle/common/lifecycle.js';
import { BaseHalfCanvasCardPreview } from '../../../../canvas/common/basehalfCanvasCardPreview.js';
import { baseHalfTestCanvasItem, createBaseHalfTestCanvasView, IBaseHalfTestCanvasView } from '../../../../canvas/test/browser/basehalfCanvasViewFixture.js';
import { IBaseHalfCanvasNavigationService, IBaseHalfCanvasNavigationState } from '../../../../navigation/common/basehalfCanvasNavigation.js';
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

class TestCanvasVideoPanel extends BaseHalfCanvasVideoPanel {
	readonly panels: TestVideoPanel[] = [];

	protected override createPanel(resource: URI, host: IBaseHalfVideoNodePanelHost, options: IBaseHalfVideoNodePanelOptions): IBaseHalfCanvasVideoPanelWidget {
		const panel = new TestVideoPanel(resource, host, options);
		this.panels.push(panel);
		return panel;
	}
}

const CLIP = 'folder/clip.bhnode';
const NOTE = 'folder/note.md';

function videoNodePreview(): BaseHalfCanvasCardPreview {
	return { kind: 'node', document: { kind: 'video', title: 'Clip' } as never, dirty: false };
}

suite('BaseHalfCanvasVideoPanel', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let navigationState: IBaseHalfCanvasNavigationState;
	let existing: Set<string>;
	let copies: string[];
	let picked: URI | undefined;
	let shutdown: Emitter<WillShutdownEvent>;

	function createPanel(): { canvas: IBaseHalfTestCanvasView; feature: TestCanvasVideoPanel } {
		navigationState = { canvasFolder: undefined, cardDetail: undefined };
		existing = new Set();
		copies = [];
		picked = undefined;
		shutdown = store.add(new Emitter<WillShutdownEvent>());
		const canvas = createBaseHalfTestCanvasView(store);
		canvas.setItem(baseHalfTestCanvasItem(CLIP), videoNodePreview());
		canvas.setItem(baseHalfTestCanvasItem(NOTE), { kind: 'markdown', text: '# Note' });
		const instantiationService = store.add(new TestInstantiationService());
		instantiationService.stub(IBaseHalfCanvasNavigationService, { get state() { return navigationState; } });
		instantiationService.stub(IFileDialogService, { showOpenDialog: async () => picked ? [picked] : undefined });
		instantiationService.stub(IFileService, {
			exists: async (resource: URI) => existing.has(resource.path),
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

	test('shows the panel for one selected Video card, and saves its prompt and takes it away for another selection', async () => {
		const { canvas, feature } = createPanel();
		canvas.changeSelection([CLIP]);
		assert.strictEqual(feature.panels.length, 1);
		assert.strictEqual(feature.panels[0].resource.path, '/workspace/folder/clip.bhnode');
		assert.strictEqual(canvas.cardPanels.get(CLIP), feature.panels[0].element);
		assert.deepStrictEqual(canvas.calls, [`showCardPanel folder ${CLIP} 120`]);

		canvas.changeSelection([NOTE]);
		await timeout(0);
		assert.strictEqual(canvas.cardPanels.size, 0);
		assert.strictEqual(feature.panels[0].flushed, 1);
		assert.strictEqual(feature.panels[0].disposed, true);

		canvas.changeSelection([CLIP, NOTE]);
		assert.strictEqual(feature.panels.length, 1, 'two selected cards show no panel');
	});

	test('waits while a selected node still loads, and shows its panel once it is known to be a Video node', () => {
		const { canvas, feature } = createPanel();
		canvas.setItem(baseHalfTestCanvasItem(CLIP), { kind: 'nodeLoading', text: 'Loading' });
		canvas.changeSelection([CLIP]);
		assert.strictEqual(feature.panels.length, 0);
		canvas.setItem(baseHalfTestCanvasItem(CLIP), videoNodePreview());
		canvas.showScene(canvas.scene);
		assert.strictEqual(feature.panels.length, 1);
		assert.strictEqual(canvas.cardPanels.get(CLIP), feature.panels[0].element);
	});

	test('stays on its card while the canvas is drawn again, and goes when Card Detail opens or the card is no Video node', async () => {
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
		canvas.setItem(baseHalfTestCanvasItem(CLIP), { kind: 'markdown', text: 'Not a node any more' });
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

	test('gives the focus to the prompt of a node the user just created, once', async () => {
		const { canvas, feature } = createPanel();
		canvas.createdNodeFocusPath = CLIP;
		canvas.changeSelection([CLIP]);
		assert.strictEqual(feature.panels[0].options.focusPromptWhenShown, true);
		canvas.changeSelection([]);
		await timeout(0);
		canvas.changeSelection([CLIP]);
		assert.strictEqual(feature.panels[1].options.focusPromptWhenShown, false);
	});

	test('picks a card through the canvas, and taking the panel away ends the pick', async () => {
		const { canvas, feature } = createPanel();
		canvas.changeSelection([CLIP]);
		const host = feature.panels[0].host;
		const pick = host.pickCard();
		assert.ok(canvas.calls.includes(`pickCard except ${CLIP}`));
		canvas.finishCardPick('folder/image.png');
		assert.strictEqual(await pick, 'folder/image.png');

		host.focusCard();
		assert.strictEqual(canvas.calls.at(-1), `focusCard ${CLIP}`);

		const ended = host.pickCard();
		canvas.changeSelection([]);
		assert.strictEqual(await ended, undefined);
	});

	test('selects a node that Generate made beside the node, once its card is drawn', () => {
		const { canvas, feature } = createPanel();
		canvas.changeSelection([CLIP]);
		feature.panels[0].host.didGenerateInNode!(URI.file('/workspace/folder/next.bhnode'));
		assert.strictEqual(canvas.calls.at(-1), 'requestRender');
		canvas.setItem(baseHalfTestCanvasItem('folder/next.bhnode'), videoNodePreview());
		canvas.showScene(canvas.scene);
		assert.ok(canvas.calls.includes('select folder/next.bhnode'));
		assert.strictEqual(feature.panels.at(-1)?.resource.path, '/workspace/folder/next.bhnode');
	});

	test('imports a file beside the node under a name that is free, and takes a file of its folder as it is', async () => {
		const { canvas, feature } = createPanel();
		canvas.changeSelection([CLIP]);
		const host = feature.panels[0].host;
		picked = URI.file('/elsewhere/frame.png');
		existing.add('/workspace/folder/frame.png');
		assert.strictEqual(await host.importFile(), 'folder/frame 2.png');
		assert.deepStrictEqual(copies, ['/elsewhere/frame.png -> /workspace/folder/frame 2.png']);

		picked = URI.file('/workspace/folder/already.png');
		assert.strictEqual(await host.importFile(), 'folder/already.png');
		assert.strictEqual(copies.length, 1);

		picked = undefined;
		assert.strictEqual(await host.importFile(), undefined);
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
