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
import { IFileService } from '../../../../../platform/files/common/files.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { INotification, INotificationHandle, INotificationService } from '../../../../../platform/notification/common/notification.js';
import { TestNotificationService } from '../../../../../platform/notification/test/common/testNotificationService.js';
import { IUndoRedoService } from '../../../../../platform/undoRedo/common/undoRedo.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { testWorkspace } from '../../../../../platform/workspace/test/common/testWorkspace.js';
import { BulkEditService } from '../../../../contrib/bulkEdit/browser/bulkEditService.js';
import { ISearchService } from '../../../../services/search/common/search.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { TestContextService } from '../../../../test/common/workbenchTestServices.js';
import { BASEHALF_CANVAS_UNDO_REDO_SOURCE } from '../../../canvas/common/basehalfCanvasEditing.js';
import { BaseHalfCanvasMirrorService, IBaseHalfCanvasMirrorService } from '../../../canvas/common/basehalfCanvasMirror.js';
import { BaseHalfAdhdMirrorService, IBaseHalfAdhdMirrorService } from '../../../markdown/common/basehalfAdhdMirror.js';
import { IBaseHalfCanvasNavigationService } from '../../../navigation/common/basehalfCanvasNavigation.js';
import { BaseHalfEditorFlushService, IBaseHalfEditorFlushService } from '../../../navigation/common/basehalfEditorFlush.js';
import { BaseHalfReferenceEditService } from '../../../references/browser/basehalfReferenceEditService.js';
import { IBaseHalfReferenceEditService } from '../../../references/common/basehalfReferenceEdit.js';
import { BaseHalfReferenceIndexService, IBaseHalfReferenceIndexService } from '../../../references/common/basehalfReferenceIndex.js';
import { BaseHalfInMemoryFileSearchService } from '../../../references/test/browser/basehalfReferenceTestFixtures.js';
import { BaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceMutationCoordinator } from '../../../workspace/common/basehalfWorkspaceMutation.js';
import { BaseHalfGenerationCardActions } from '../../browser/basehalfGenerationCardActions.js';
import { BaseHalfGenerationCardStore } from '../../browser/basehalfGenerationCardStore.js';
import { BaseHalfGenerationKind, serializeBaseHalfGenerationMade } from '../../common/basehalfGenerationInfo.js';
import { BaseHalfVideoCatalogState, findBaseHalfVideoRegion, IBaseHalfVideoCatalog, IBaseHalfVideoCatalogProvider, IBaseHalfVideoCheckResult, IBaseHalfVideoGenerationChoice } from '../../common/basehalfVideoCatalog.js';
import {
	IBaseHalfDraftOperations,
	IBaseHalfGenerationCardStore,
	IBaseHalfVideoCatalogService,
	IBaseHalfVideoGenerationService,
	IBaseHalfVideoProviderSettingsService,
	IBaseHalfVideoProviderStatus
} from '../../common/basehalfVideoGeneration.js';
import { TEST_GENERATION_CATALOG } from '../common/basehalfVideoCatalogFixture.js';
import { BaseHalfTestFileSystemProvider, FakeDraftOperations } from './basehalfVideoTestFixtures.js';

const root = URI.file('/work');

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

/** The generation service as the actions ask it: which cards generate, and which were released. */
class FakeGenerationService {
	readonly generating = new Set<string>();
	readonly released: string[] = [];

	asService(): IBaseHalfVideoGenerationService {
		const service: Partial<IBaseHalfVideoGenerationService> = {
			isGenerating: (resource: URI) => this.generating.has(resource.path),
			releaseCard: async (resource: URI) => { this.released.push(resource.path); }
		};
		return service as IBaseHalfVideoGenerationService;
	}
}

interface IHarness {
	readonly actions: BaseHalfGenerationCardActions;
	readonly store: IBaseHalfGenerationCardStore;
	readonly generation: FakeGenerationService;
	readonly notifications: RecordingNotificationService;
	readonly undoRedo: IUndoRedoService;
	readonly lastUsed: Map<BaseHalfGenerationKind, IBaseHalfVideoGenerationChoice>;
	read(path: string): Promise<string | undefined>;
	write(path: string, content: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	resource(path: string): URI;
}

async function createHarness(disposables: DisposableStore, files: Record<string, string>): Promise<IHarness> {
	const fileService = disposables.add(new FileService(new NullLogService()));
	disposables.add(fileService.registerProvider(Schemas.file, disposables.add(new BaseHalfTestFileSystemProvider())));
	await fileService.createFolder(root);
	const resource = (path: string) => joinPath(root, ...path.split('/'));
	for (const [path, content] of Object.entries(files)) {
		await fileService.writeFile(resource(path), VSBuffer.fromString(content));
	}
	await timeout(20);
	const configuration = new TestConfigurationService({ files: { autoSave: 'afterDelay', exclude: {} } });
	const instantiationService = workbenchInstantiationService({ fileService: () => fileService, configurationService: () => configuration }, disposables);
	instantiationService.stub(IWorkspaceContextService, new TestContextService(testWorkspace(root)));
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
	instantiationService.stub(IBaseHalfReferenceEditService, disposables.add(instantiationService.createInstance(BaseHalfReferenceEditService)));
	instantiationService.stub(IBaseHalfCanvasMirrorService, disposables.add(instantiationService.createInstance(BaseHalfCanvasMirrorService)));
	instantiationService.stub(IBaseHalfVideoCatalogService, disposables.add(new FakeCatalogService()));
	await index.whenReady(root);
	const store = disposables.add(instantiationService.createInstance(BaseHalfGenerationCardStore));
	instantiationService.stub(IBaseHalfGenerationCardStore, store);
	instantiationService.stub(IBaseHalfDraftOperations, new FakeDraftOperations(instantiationService.get(IFileService), root));
	const generation = new FakeGenerationService();
	instantiationService.stub(IBaseHalfVideoGenerationService, generation.asService());
	const lastUsed = new Map<BaseHalfGenerationKind, IBaseHalfVideoGenerationChoice>();
	const settings: Partial<IBaseHalfVideoProviderSettingsService> = {
		getLastUsed: (kind?: BaseHalfGenerationKind) => lastUsed.get(kind ?? 'video'),
		getStatus: (provider: IBaseHalfVideoCatalogProvider) => ({ region: findBaseHalfVideoRegion(provider, undefined), setUp: true, endpoint: '', customEndpoint: false, credentials: new Set<string>() }) as IBaseHalfVideoProviderStatus
	};
	instantiationService.stub(IBaseHalfVideoProviderSettingsService, settings);
	const actions = instantiationService.createInstance(BaseHalfGenerationCardActions);
	return {
		actions,
		store,
		generation,
		notifications,
		undoRedo: instantiationService.get(IUndoRedoService),
		lastUsed,
		read: async path => {
			try {
				return (await fileService.readFile(resource(path))).value.toString();
			} catch {
				return undefined;
			}
		},
		write: async (path, content) => { await fileService.writeFile(resource(path), VSBuffer.fromString(content)); },
		exists: path => fileService.exists(resource(path)),
		resource
	};
}

suite('BaseHalfGenerationCardActions', () => {
	const disposables = new DisposableStore();
	teardown(() => disposables.clear());
	ensureNoDisposablesAreLeakedInTestSuite();

	test('a new draft is named after its kind with the extension of its model and the next free number, and starts with the last values of its kind made legal', async () => {
		const harness = await createHarness(disposables, {
			'brief.md': '# Brief',
			'shots/video.mp4': 'a file of that name',
			'.bh/mirror/shots/image.jpg/generation.yaml': 'prompt: ""\n'
		});
		// The last image model delivers JPEG; its count of 9 is more than it makes.
		harness.lastUsed.set('image', { provider: 'corvid', model: 'corvid-print', mode: 'reference', params: { count: 9, resolution: '2k' } });
		const shots = harness.resource('shots');
		const image = await harness.actions.createDraft(shots, 'image', ['brief.md']);
		const video = await harness.actions.createDraft(shots, 'video');
		harness.lastUsed.delete('image');
		const plain = await harness.actions.createDraft(shots, 'image');
		assert.deepStrictEqual({
			paths: [image.path, video.path, plain.path],
			image: await harness.read('.bh/mirror/shots/image-2.jpg/generation.yaml'),
			upstream: await harness.read('.bh/mirror/shots/image-2.jpg/upstream.yaml'),
			video: await harness.read('.bh/mirror/shots/video-2.mp4/generation.yaml'),
			plain: await harness.read('.bh/mirror/shots/image.png/generation.yaml')
		}, {
			paths: ['/work/shots/image-2.jpg', '/work/shots/video-2.mp4', '/work/shots/image.png'],
			image: 'prompt: ""\nprovider: "corvid"\nmodel: "corvid-print"\nmode: "reference"\nparams:\n  count: 1\n  resolution: "2k"\n',
			upstream: 'upstream:\n  - brief.md\n',
			video: 'prompt: ""\n',
			plain: 'prompt: ""\n'
		});
	});

	test('undo of a new draft deletes it with its card information and redo writes it back; while it generates, undo waits and keeps the step', async () => {
		const harness = await createHarness(disposables, { 'shots/.keep': '' });
		const draft = await harness.actions.createDraft(harness.resource('shots'), 'video');
		harness.generation.generating.add(draft.path);
		await harness.undoRedo.undo(BASEHALF_CANVAS_UNDO_REDO_SOURCE);
		const whileGenerating = await harness.exists('.bh/mirror/shots/video.mp4/generation.yaml');
		harness.generation.generating.clear();
		await harness.undoRedo.undo(BASEHALF_CANVAS_UNDO_REDO_SOURCE);
		const undone = await harness.exists('.bh/mirror/shots/video.mp4/generation.yaml');
		await harness.undoRedo.redo(BASEHALF_CANVAS_UNDO_REDO_SOURCE);
		assert.deepStrictEqual({
			whileGenerating,
			undone,
			redone: await harness.read('.bh/mirror/shots/video.mp4/generation.yaml'),
			notifications: harness.notifications.shown
		}, {
			whileGenerating: true,
			undone: false,
			redone: 'prompt: ""\n',
			notifications: ['video.mp4 is generating. Stop it first.']
		});
	});

	test('a step whose draft changed since, or has its file now, is done with: undo leaves the draft, says why, and the next undo goes to the step before', async () => {
		const harness = await createHarness(disposables, { 'shots/.keep': '' });
		const shots = harness.resource('shots');
		const image = await harness.actions.createDraft(shots, 'image');
		const video = await harness.actions.createDraft(shots, 'video');
		const clip = await harness.actions.createDraft(shots, 'video');
		// A file at the last draft's path is its file; the user typed a prompt into the one before.
		await harness.write('shots/video-2.mp4', 'video');
		await harness.write('.bh/mirror/shots/video.mp4/generation.yaml', 'prompt: "Typed since."\n');
		await harness.undoRedo.undo(BASEHALF_CANVAS_UNDO_REDO_SOURCE);
		await harness.undoRedo.undo(BASEHALF_CANVAS_UNDO_REDO_SOURCE);
		await harness.undoRedo.undo(BASEHALF_CANVAS_UNDO_REDO_SOURCE);
		assert.deepStrictEqual({
			paths: [image.path, video.path, clip.path],
			clip: await harness.read('.bh/mirror/shots/video-2.mp4/generation.yaml'),
			video: await harness.read('.bh/mirror/shots/video.mp4/generation.yaml'),
			image: await harness.exists('.bh/mirror/shots/image.png/generation.yaml'),
			notifications: harness.notifications.shown
		}, {
			paths: ['/work/shots/image.png', '/work/shots/video.mp4', '/work/shots/video-2.mp4'],
			clip: 'prompt: ""\n',
			video: 'prompt: "Typed since."\n',
			image: false,
			notifications: ['video-2.mp4 has its file now, so it is left as it is.', 'video.mp4 changed since this step, so it is left as it is.']
		});
	});

	test('renames a draft as one step of undo, and deletes drafts after releasing their generation, as one step that undo writes back', async () => {
		const harness = await createHarness(disposables, {
			'shots/.keep': '',
			'.bh/mirror/shots/shot.mp4/generation.yaml': 'prompt: "A pier."\n',
			'.bh/mirror/shots/shot.mp4/upstream.yaml': 'upstream:\n  - brief.md\n',
			'.bh/mirror/shots/hero.png/generation.yaml': 'prompt: "A heron."\n'
		});
		const renamed = await harness.actions.moveDraft(harness.resource('shots/shot.mp4'), harness.resource('shots/pier.mp4'));
		const afterRename = await harness.exists('.bh/mirror/shots/pier.mp4/upstream.yaml');
		await harness.undoRedo.undo(BASEHALF_CANVAS_UNDO_REDO_SOURCE);
		const afterUndo = await harness.exists('.bh/mirror/shots/shot.mp4/upstream.yaml');
		await harness.actions.deleteDrafts([harness.resource('shots/shot.mp4'), harness.resource('shots/hero.png')]);
		const deleted = [await harness.exists('.bh/mirror/shots/shot.mp4/generation.yaml'), await harness.exists('.bh/mirror/shots/hero.png/generation.yaml')];
		await harness.undoRedo.undo(BASEHALF_CANVAS_UNDO_REDO_SOURCE);
		assert.deepStrictEqual({
			renamed: renamed.path,
			afterRename,
			afterUndo,
			released: harness.generation.released,
			deleted,
			back: [await harness.read('.bh/mirror/shots/shot.mp4/generation.yaml'), await harness.read('.bh/mirror/shots/shot.mp4/upstream.yaml'), await harness.read('.bh/mirror/shots/hero.png/generation.yaml')]
		}, {
			renamed: '/work/shots/pier.mp4',
			afterRename: true,
			afterUndo: true,
			released: ['/work/shots/shot.mp4', '/work/shots/hero.png'],
			deleted: [false, false],
			back: ['prompt: "A pier."\n', 'upstream:\n  - brief.md\n', 'prompt: "A heron."\n']
		});
	});

	test('a copy of a draft has its prompt and settings and no upstream list, under its own name where that is free and the next free number otherwise, and undo deletes it', async () => {
		const harness = await createHarness(disposables, {
			'shots/.keep': '',
			'other/.keep': '',
			'.bh/mirror/shots/shot-2.mp4/generation.yaml': 'prompt: "A pier."\nprovider: "acme"\n',
			'.bh/mirror/shots/shot-2.mp4/upstream.yaml': 'upstream:\n  - brief.md\n'
		});
		const duplicate = await harness.actions.copyDraft(harness.resource('shots/shot-2.mp4'), harness.resource('shots'), 'Duplicate shot-2.mp4');
		const pasted = await harness.actions.copyDraft(harness.resource('shots/shot-2.mp4'), harness.resource('other'), 'Paste shot-2.mp4');
		const copies = {
			paths: [duplicate.path, pasted.path],
			info: await harness.read('.bh/mirror/shots/shot-3.mp4/generation.yaml'),
			upstream: await harness.exists('.bh/mirror/other/shot-2.mp4/upstream.yaml')
		};
		await harness.undoRedo.undo(BASEHALF_CANVAS_UNDO_REDO_SOURCE);
		assert.deepStrictEqual({ copies, undone: await harness.exists('.bh/mirror/other/shot-2.mp4/generation.yaml') }, {
			copies: { paths: ['/work/shots/shot-3.mp4', '/work/other/shot-2.mp4'], info: 'prompt: "A pier."\nprovider: "acme"\n', upstream: false },
			undone: false
		});
	});

	test('New Version makes a draft beside a generated file from what made it, without the seed, with its inputs, as one step of undo, and generates nothing (D67)', async () => {
		const made = {
			id: '20261023T080000-k3f9',
			startedAt: '2026-10-23T08:00:00.000Z',
			finishedAt: '2026-10-23T08:01:00.000Z',
			provider: 'acme',
			region: 'east',
			model: 'acme-motion-2',
			providerModel: 'acme-motion-2-e-260101',
			mode: 'reference' as const,
			params: { resolution: '1080p', duration: 8, sound: true, seed: 7 },
			prompt: 'A pier at dawn.',
			inputs: ['frames/a.png']
		};
		const harness = await createHarness(disposables, {
			'frames/a.png': 'png',
			'shots/shot.mp4': 'video',
			'shots/shot-2.mp4': 'another video',
			'.bh/mirror/shots/shot.mp4/made.yaml': serializeBaseHalfGenerationMade(made),
			'.bh/mirror/shots/shot.mp4/upstream.yaml': 'upstream:\n  - frames/a.png\n',
			'.bh/mirror/shots/draft.mp4/generation.yaml': 'prompt: ""\n',
			'shots/plain.mp4': 'video'
		});
		const version = await harness.actions.newVersion(harness.resource('shots/shot.mp4'));
		const made3 = {
			path: version.path,
			info: await harness.read('.bh/mirror/shots/shot-3.mp4/generation.yaml'),
			upstream: await harness.read('.bh/mirror/shots/shot-3.mp4/upstream.yaml'),
			original: [await harness.exists('.bh/mirror/shots/shot.mp4/generation.yaml'), await harness.read('.bh/mirror/shots/shot.mp4/made.yaml') === serializeBaseHalfGenerationMade(made)],
			generated: harness.generation.generating.size
		};
		await harness.undoRedo.undo(BASEHALF_CANVAS_UNDO_REDO_SOURCE);
		assert.deepStrictEqual({
			made: made3,
			undone: await harness.exists('.bh/mirror/shots/shot-3.mp4/generation.yaml'),
			refused: await Promise.all([
				harness.actions.newVersion(harness.resource('shots/draft.mp4')).then(() => 'made', (error: Error) => error.message),
				harness.actions.newVersion(harness.resource('shots/plain.mp4')).then(() => 'made', (error: Error) => error.message)
			])
		}, {
			made: {
				// shot-2.mp4 is taken by another file: the next free number.
				path: '/work/shots/shot-3.mp4',
				info: 'prompt: "A pier at dawn."\nprovider: "acme"\nmodel: "acme-motion-2"\nmode: "reference"\nparams:\n  duration: 8\n  resolution: "1080p"\n  sound: true\n',
				upstream: 'upstream:\n  - frames/a.png\n',
				original: [false, true],
				generated: 0
			},
			undone: false,
			refused: [
				'draft.mp4 has no file yet: it is a draft, and its own panel makes it.',
				'plain.mp4 is not an image or video card.'
			]
		});
	});

	test('a draft refuses a connection its model cannot use; a generated file and a draft that generates refuse every change of their inputs (D67)', async () => {
		const made = {
			id: 'm1', startedAt: '2026-10-23T08:00:00.000Z', finishedAt: '2026-10-23T08:01:00.000Z', provider: 'acme', region: 'east',
			model: 'acme-still', providerModel: 'acme-still-260101', mode: 'frames' as const, params: {}, prompt: '', inputs: []
		};
		const harness = await createHarness(disposables, {
			'shots/notes.md': 'notes',
			'shots/a.png': 'png',
			'shots/shot.mp4': 'video',
			'.bh/mirror/shots/shot.mp4/made.yaml': serializeBaseHalfGenerationMade(made),
			'.bh/mirror/shots/still.mp4/generation.yaml': 'prompt: ""\nprovider: "acme"\nmodel: "acme-still"\n',
			'.bh/mirror/shots/still.mp4/upstream.yaml': 'upstream:\n  - shots/a.png\n',
			'.bh/mirror/shots/blank.mp4/generation.yaml': 'prompt: ""\n'
		});
		const refusal = (path: string, change: { add?: string; remove?: string }) => harness.actions.inputRefusal(harness.resource(path), change);
		const beforeGenerating = {
			secondImage: await refusal('shots/still.mp4', { add: 'shots/b.png' }),
			video: await refusal('shots/still.mp4', { add: 'shots/clip.mp4' }),
			replaced: await refusal('shots/still.mp4', { add: 'shots/b.png', remove: 'shots/a.png' }),
			disconnected: await refusal('shots/still.mp4', { remove: 'shots/a.png' }),
			noModelPdf: await refusal('shots/blank.mp4', { add: 'docs/brief.pdf' }),
			noModelVideo: await refusal('shots/blank.mp4', { add: 'shots/clip.mp4' }),
			generated: await refusal('shots/shot.mp4', { add: 'shots/a.png' }),
			generatedDisconnect: await refusal('shots/shot.mp4', { remove: 'shots/a.png' }),
			note: await refusal('shots/notes.md', { add: 'shots/a.png' })
		};
		harness.generation.generating.add('/work/shots/blank.mp4');
		assert.deepStrictEqual({ ...beforeGenerating, generating: await refusal('shots/blank.mp4', { add: 'shots/a.png' }) }, {
			secondImage: 'Acme Still takes one image at most.',
			video: 'Acme Still takes no videos.',
			replaced: undefined,
			disconnected: undefined,
			noModelPdf: 'An image or video card cannot use brief.pdf.',
			noModelVideo: undefined,
			generated: 'shot.mp4 was made from these inputs. To change them, make a new version.',
			generatedDisconnect: 'shot.mp4 was made from these inputs. To change them, make a new version.',
			note: undefined,
			generating: 'blank.mp4 is generating. Its inputs can be changed once it is done.'
		});
	});
});
