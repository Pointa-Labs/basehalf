/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Emitter } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../../base/common/network.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IBulkEditService } from '../../../../../editor/browser/services/bulkEditService.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { INotification, INotificationHandle, INotificationService } from '../../../../../platform/notification/common/notification.js';
import { TestNotificationService } from '../../../../../platform/notification/test/common/testNotificationService.js';
import { IUndoRedoService, UndoRedoSource } from '../../../../../platform/undoRedo/common/undoRedo.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { testWorkspace } from '../../../../../platform/workspace/test/common/testWorkspace.js';
import { BulkEditService } from '../../../../contrib/bulkEdit/browser/bulkEditService.js';
import { ISearchService } from '../../../../services/search/common/search.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { TestContextService } from '../../../../test/common/workbenchTestServices.js';
import { BaseHalfCanvasMirrorService, IBaseHalfCanvasMirrorService } from '../../../canvas/common/basehalfCanvasMirror.js';
import { BaseHalfAdhdMirrorService, IBaseHalfAdhdMirrorService } from '../../../markdown/common/basehalfAdhdMirror.js';
import { IBaseHalfCanvasNavigationService, IBaseHalfWorkspaceResource } from '../../../navigation/common/basehalfCanvasNavigation.js';
import { BaseHalfEditorFlushService, IBaseHalfEditorFlushService } from '../../../navigation/common/basehalfEditorFlush.js';
import { BaseHalfReferenceEditService } from '../../../references/browser/basehalfReferenceEditService.js';
import { IBaseHalfReferenceEditOptions, IBaseHalfReferenceEditService } from '../../../references/common/basehalfReferenceEdit.js';
import { BaseHalfReferenceIndexService, IBaseHalfReferenceIndexService } from '../../../references/common/basehalfReferenceIndex.js';
import { BaseHalfInMemoryFileSearchService } from '../../../references/test/browser/basehalfReferenceTestFixtures.js';
import { BaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceMutationCoordinator } from '../../../workspace/common/basehalfWorkspaceMutation.js';
import { BaseHalfGenerationCardStore } from '../../browser/basehalfGenerationCardStore.js';
import { BaseHalfGenerationNameFollower } from '../../browser/basehalfGenerationNameFollower.contribution.js';
import { BaseHalfVideoCatalogState, IBaseHalfVideoCatalog, IBaseHalfVideoCheckResult } from '../../common/basehalfVideoCatalog.js';
import { IBaseHalfGenerationCardStore, IBaseHalfVideoCatalogService } from '../../common/basehalfVideoGeneration.js';
import { TEST_GENERATION_CATALOG } from '../common/basehalfVideoCatalogFixture.js';
import { BaseHalfTestFileSystemProvider } from './basehalfVideoTestFixtures.js';

const folder = URI.file('/work');
const options: IBaseHalfReferenceEditOptions = { label: 'Disconnect' };

class RecordingNotificationService extends TestNotificationService {
	readonly shown: string[] = [];

	override notify(notification: INotification): INotificationHandle {
		this.shown.push(String(notification.message));
		return super.notify(notification);
	}
}

class FakeCatalogService implements IBaseHalfVideoCatalogService {
	declare readonly _serviceBrand: undefined;
	private readonly changed = new Emitter<void>();
	readonly onDidChange = this.changed.event;
	state: BaseHalfVideoCatalogState = { kind: 'ready', catalog: TEST_GENERATION_CATALOG };
	load(): void { }
	async whenReady(): Promise<IBaseHalfVideoCatalog> {
		return TEST_GENERATION_CATALOG;
	}
	async check(): Promise<IBaseHalfVideoCheckResult | undefined> {
		return undefined;
	}
	dispose(): void {
		this.changed.dispose();
	}
}

interface IHarness {
	readonly edit: IBaseHalfReferenceEditService;
	readonly store: BaseHalfGenerationCardStore;
	readonly notifications: RecordingNotificationService;
	readonly undoRedo: IUndoRedoService;
	node(path: string): IBaseHalfWorkspaceResource;
	prompt(path: string): Promise<string>;
	read(path: string): Promise<string | undefined>;
}

async function createHarness(disposables: DisposableStore, files: Record<string, string>): Promise<IHarness> {
	const fileService = disposables.add(new FileService(new NullLogService()));
	disposables.add(fileService.registerProvider(Schemas.file, disposables.add(new BaseHalfTestFileSystemProvider())));
	await fileService.createFolder(folder);
	const resource = (path: string) => joinPath(folder, ...path.split('/'));
	for (const [path, content] of Object.entries(files)) {
		await fileService.writeFile(resource(path), VSBuffer.fromString(content));
	}
	await timeout(20);
	const configuration = new TestConfigurationService({ files: { autoSave: 'afterDelay', exclude: {} } });
	const instantiationService = workbenchInstantiationService({ fileService: () => fileService, configurationService: () => configuration }, disposables);
	instantiationService.stub(IWorkspaceContextService, new TestContextService(testWorkspace(folder)));
	instantiationService.stub(ISearchService, new BaseHalfInMemoryFileSearchService(fileService));
	instantiationService.stub(IBulkEditService, instantiationService.createInstance(BulkEditService));
	instantiationService.stub(IBaseHalfEditorFlushService, new BaseHalfEditorFlushService());
	instantiationService.stub(IBaseHalfWorkspaceMutationCoordinator, new BaseHalfWorkspaceMutationCoordinator());
	instantiationService.stub(IBaseHalfAdhdMirrorService, disposables.add(instantiationService.createInstance(BaseHalfAdhdMirrorService)));
	const notifications = new RecordingNotificationService();
	instantiationService.stub(INotificationService, notifications);
	instantiationService.stub(IBaseHalfCanvasNavigationService, { openCardDetail: async () => ({ handled: false, reason: 'unsupportedResource' }) });
	const index = disposables.add(instantiationService.createInstance(BaseHalfReferenceIndexService));
	instantiationService.stub(IBaseHalfReferenceIndexService, index);
	const edit = disposables.add(instantiationService.createInstance(BaseHalfReferenceEditService));
	instantiationService.stub(IBaseHalfReferenceEditService, edit);
	instantiationService.stub(IBaseHalfCanvasMirrorService, disposables.add(instantiationService.createInstance(BaseHalfCanvasMirrorService)));
	instantiationService.stub(IBaseHalfVideoCatalogService, disposables.add(new FakeCatalogService()));
	await index.whenReady(folder);
	const store = disposables.add(instantiationService.createInstance(BaseHalfGenerationCardStore));
	instantiationService.stub(IBaseHalfGenerationCardStore, store);
	disposables.add(instantiationService.createInstance(BaseHalfGenerationNameFollower));
	return {
		edit,
		store,
		notifications,
		undoRedo: instantiationService.get(IUndoRedoService),
		node: path => ({ resource: resource(path), workspaceFolder: folder, relativePath: path }),
		prompt: async path => (await store.read(resource(path))).info.prompt,
		read: async path => {
			try {
				return (await fileService.readFile(resource(path))).value.toString();
			} catch {
				return undefined;
			}
		}
	};
}

/** A draft video in `shots/` whose inputs are `entries` and whose prompt is `prompt`. */
function draft(prompt: string, entries: readonly string[]): Record<string, string> {
	return {
		'shots/a.png': 'a',
		'shots/b.png': 'b',
		'shots/c.png': 'c',
		'shots/clip.mp4': 'clip',
		'.bh/mirror/shots/next.mp4/generation.yaml': `prompt: ${JSON.stringify(prompt)}\n`,
		'.bh/mirror/shots/next.mp4/upstream.yaml': `upstream:\n${entries.map(entry => `  - ${entry}\n`).join('')}`
	};
}

suite('BaseHalfGenerationNameFollower (D68)', () => {
	const disposables = new DisposableStore();
	teardown(() => disposables.clear());
	ensureNoDisposablesAreLeakedInTestSuite();

	test('removing an input takes its name out of the prompt and renumbers the others, and undo and redo bring both back', async () => {
		const harness = await createHarness(disposables, draft('图片1里的人骑车，背景是图片3', ['shots/a.png', 'shots/b.png', 'shots/c.png']));
		const source = new UndoRedoSource();
		const canvas = joinPath(folder, '.bh', 'mirror', 'shots', 'canvas.yaml');
		const removed = await harness.edit.remove(harness.node('shots/next.mp4'), 'shots/a.png', options);
		harness.edit.pushUndoElement(removed, { label: 'Disconnect', resources: [canvas], source });
		const afterRemove = await harness.prompt('shots/next.mp4');
		await harness.undoRedo.undo(source);
		const afterUndo = [await harness.prompt('shots/next.mp4'), await harness.read('.bh/mirror/shots/next.mp4/upstream.yaml')];
		await harness.undoRedo.redo(source);
		const afterRedo = await harness.prompt('shots/next.mp4');
		assert.deepStrictEqual({ afterRemove, afterUndo, afterRedo, shown: harness.notifications.shown }, {
			afterRemove: '里的人骑车，背景是图片2',
			afterUndo: ['图片1里的人骑车，背景是图片3', 'upstream:\n  - shots/a.png\n  - shots/b.png\n  - shots/c.png\n'],
			afterRedo: '里的人骑车，背景是图片2',
			shown: []
		});
	});

	test('reordering the inputs gives the names their inputs\' new numbers, other kinds keep theirs', async () => {
		const harness = await createHarness(disposables, draft('从图片1到图片2，配上视频1', ['shots/a.png', 'shots/clip.mp4', 'shots/b.png']));
		await harness.store.reorderUpstream(harness.node('shots/next.mp4').resource, ['shots/b.png', 'shots/clip.mp4', 'shots/a.png']);
		assert.strictEqual(await harness.prompt('shots/next.mp4'), '从图片2到图片1，配上视频1');
	});

	test('a source-end reconnect keeps the number, and connecting an input last changes no name', async () => {
		const harness = await createHarness(disposables, draft('图片1 then 图片2', ['shots/a.png', 'shots/b.png']));
		await harness.edit.replace(harness.node('shots/next.mp4'), 'shots/a.png', 'shots/c.png', options);
		await harness.edit.add(harness.node('shots/next.mp4'), 'shots/a.png', options);
		assert.strictEqual(await harness.prompt('shots/next.mp4'), '图片1 then 图片2');
	});

	test('undo after the prompt changed keeps the change and gives its names the numbers of the list it writes back', async () => {
		const harness = await createHarness(disposables, draft('图片1, 图片3', ['shots/a.png', 'shots/b.png', 'shots/c.png']));
		const source = new UndoRedoSource();
		const canvas = joinPath(folder, '.bh', 'mirror', 'shots', 'canvas.yaml');
		harness.edit.pushUndoElement(await harness.edit.remove(harness.node('shots/next.mp4'), 'shots/a.png', options), { label: 'Disconnect', resources: [canvas], source });
		await harness.store.update(harness.node('shots/next.mp4').resource, info => ({ ...info, prompt: `${info.prompt} at night` }));
		await harness.undoRedo.undo(source);
		assert.strictEqual(await harness.prompt('shots/next.mp4'), ', 图片3 at night');
	});

	test('undo and redo that run twice, as the Undo of a rename\'s report and then canvas undo, change the prompt once', async () => {
		const harness = await createHarness(disposables, draft('图片1里的人骑车，背景是图片3', ['shots/a.png', 'shots/b.png', 'shots/c.png']));
		const removed = await harness.edit.remove(harness.node('shots/next.mp4'), 'shots/a.png', options);
		const [dependent] = removed.dependents ?? [];
		await dependent.undo();
		await dependent.undo();
		const undone = await harness.prompt('shots/next.mp4');
		await dependent.redo();
		await dependent.redo();
		assert.deepStrictEqual([undone, await harness.prompt('shots/next.mp4')], ['图片1里的人骑车，背景是图片3', '里的人骑车，背景是图片2']);
	});

	test('a connection into an ordinary file follows nothing and says nothing', async () => {
		const harness = await createHarness(disposables, {
			'shots/a.png': 'a',
			'shots/b.png': 'b',
			'shots/frame.png': 'frame',
			'.bh/mirror/shots/frame.png/upstream.yaml': 'upstream:\n  - shots/a.png\n  - shots/b.png\n'
		});
		const result = await harness.edit.remove(harness.node('shots/frame.png'), 'shots/a.png', options);
		assert.deepStrictEqual({ changed: result.changed, dependents: result.dependents, shown: harness.notifications.shown }, { changed: true, dependents: undefined, shown: [] });
	});
});
