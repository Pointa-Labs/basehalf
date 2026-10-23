/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Emitter } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../../base/common/network.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IBulkEditService } from '../../../../../editor/browser/services/bulkEditService.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { INotification, INotificationHandle, INotificationService } from '../../../../../platform/notification/common/notification.js';
import { TestNotificationService } from '../../../../../platform/notification/test/common/testNotificationService.js';
import { IUriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { testWorkspace } from '../../../../../platform/workspace/test/common/testWorkspace.js';
import { BulkEditService } from '../../../../contrib/bulkEdit/browser/bulkEditService.js';
import { ISearchService } from '../../../../services/search/common/search.js';
import { IWorkingCopyFileService } from '../../../../services/workingCopy/common/workingCopyFileService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { TestContextService } from '../../../../test/common/workbenchTestServices.js';
import { BaseHalfCanvasMirrorService, IBaseHalfCanvasMirrorService } from '../../../canvas/common/basehalfCanvasMirror.js';
import { BaseHalfAdhdMirrorService, IBaseHalfAdhdMirrorService } from '../../../markdown/common/basehalfAdhdMirror.js';
import { IBaseHalfCanvasNavigationService } from '../../../navigation/common/basehalfCanvasNavigation.js';
import { BaseHalfEditorFlushService, IBaseHalfEditorFlushService } from '../../../navigation/common/basehalfEditorFlush.js';
import { BaseHalfReferenceEditService } from '../../../references/browser/basehalfReferenceEditService.js';
import { IBaseHalfReferenceEditService } from '../../../references/common/basehalfReferenceEdit.js';
import { BaseHalfReferenceIndexService, IBaseHalfReferenceIndexService } from '../../../references/common/basehalfReferenceIndex.js';
import { BaseHalfInMemoryFileSearchService } from '../../../references/test/browser/basehalfReferenceTestFixtures.js';
import { BASEHALF_WORKSPACE_SETUP_DISABLE_MARKER } from '../../../workspace/common/basehalfLegacyCleanup.js';
import { BaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceMutationCoordinator } from '../../../workspace/common/basehalfWorkspaceMutation.js';
import { BaseHalfGenerationCardCopyContribution } from '../../browser/basehalfGenerationCardCopy.contribution.js';
import { copyBaseHalfGenerationCardInformation } from '../../browser/basehalfGenerationCardCopy.js';
import { BaseHalfGenerationCardStore } from '../../browser/basehalfGenerationCardStore.js';
import { baseHalfGenerationMadeCopy, IBaseHalfGenerationMade, parseBaseHalfGenerationMade, serializeBaseHalfGenerationMade } from '../../common/basehalfGenerationInfo.js';
import { BaseHalfVideoCatalogState, IBaseHalfVideoCatalog, IBaseHalfVideoCheckResult } from '../../common/basehalfVideoCatalog.js';
import { IBaseHalfGenerationCardStore, IBaseHalfVideoCatalogService } from '../../common/basehalfVideoGeneration.js';
import { TEST_GENERATION_CATALOG } from '../common/basehalfVideoCatalogFixture.js';
import { BaseHalfTestFileSystemProvider } from './basehalfVideoTestFixtures.js';

const root = URI.file('/work');

const made: IBaseHalfGenerationMade = {
	id: '20261022T080000-1a2b3c4d',
	startedAt: '2026-10-22T08:00:00.000Z',
	finishedAt: '2026-10-22T08:01:00.000Z',
	provider: 'acme',
	region: 'east',
	model: 'acme-motion-2',
	providerModel: 'acme-motion-2-e-260101',
	mode: 'frames',
	params: { duration: 5 },
	prompt: 'A pier at dawn.',
	inputs: ['frames/start.png']
};

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
	readonly store: BaseHalfGenerationCardStore;
	readonly notifications: RecordingNotificationService;
	readonly workingCopyFileService: IWorkingCopyFileService;
	/** Copies the files only, as the file service does, without any card information. */
	copyFile(source: string, target: string): Promise<void>;
	/** Gives the copies the card information of what they copy. */
	copyCards(pairs: readonly (readonly [source: string, target: string])[], ids?: string[]): Promise<{ readonly copied: readonly string[]; readonly failed: readonly string[] }>;
	read(path: string): Promise<string | undefined>;
	exists(path: string): Promise<boolean>;
	resource(path: string): URI;
}

async function createHarness(disposables: DisposableStore, files: Record<string, string>, options: { readonly contribution?: boolean } = {}): Promise<IHarness> {
	const fileService = disposables.add(new FileService(new NullLogService()));
	disposables.add(fileService.registerProvider(Schemas.file, disposables.add(new BaseHalfTestFileSystemProvider())));
	await fileService.createFolder(root);
	const resource = (path: string) => path.startsWith('/') ? URI.file(path) : joinPath(root, ...path.split('/'));
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
	if (options.contribution) {
		disposables.add(instantiationService.createInstance(BaseHalfGenerationCardCopyContribution));
	}
	const relative = (target: URI) => target.path.startsWith(`${root.path}/`) ? target.path.slice(root.path.length + 1) : target.path;
	return {
		store,
		notifications,
		workingCopyFileService: instantiationService.get(IWorkingCopyFileService),
		copyFile: async (source, target) => { await fileService.copy(resource(source), resource(target), true); },
		copyCards: async (pairs, ids = []) => {
			let next = 0;
			const result = await copyBaseHalfGenerationCardInformation({
				fileService,
				workspaceContextService: instantiationService.get(IWorkspaceContextService),
				uriIdentityService: instantiationService.get(IUriIdentityService),
				cardStore: store,
				logService: instantiationService.get(ILogService)
			}, pairs.map(([source, target]) => ({ source: resource(source), target: resource(target) })), () => ids[next++] ?? `20261022T090000-0000000${next}`);
			return { copied: result.copied.map(relative), failed: result.failed.map(relative) };
		},
		read: async path => {
			try {
				return (await fileService.readFile(resource(path))).value.toString();
			} catch {
				return undefined;
			}
		},
		exists: path => fileService.exists(resource(path)),
		resource
	};
}

suite('BaseHalfGenerationCardCopy', () => {
	const disposables = new DisposableStore();
	teardown(() => disposables.clear());
	ensureNoDisposablesAreLeakedInTestSuite();

	test('a copy of a card with its file gets a record with a new id that names the original, without its connections, and a file BaseHalf did not make gets none (D67)', async () => {
		const harness = await createHarness(disposables, {
			'shots/shot.mp4': 'video',
			'.bh/mirror/shots/shot.mp4/generation.yaml': 'prompt: "A pier at dawn."\nprovider: "acme"\n',
			'.bh/mirror/shots/shot.mp4/made.yaml': serializeBaseHalfGenerationMade(made),
			'.bh/mirror/shots/shot.mp4/upstream.yaml': 'upstream:\n  - frames/start.png\n',
			// A file uploaded to a draft has its prompt and settings and no record.
			'shots/still.png': 'png',
			'.bh/mirror/shots/still.png/generation.yaml': 'prompt: "A heron."\n'
		});
		await harness.copyFile('shots/shot.mp4', 'other/shot.mp4');
		await harness.copyFile('shots/still.png', 'shots/still-2.png');
		const result = await harness.copyCards([['shots/shot.mp4', 'other/shot.mp4'], ['shots/still.png', 'shots/still-2.png']], ['20261022T090000-feedbeef']);
		const record = await harness.read('.bh/mirror/other/shot.mp4/made.yaml');
		assert.deepStrictEqual({
			result,
			info: await harness.read('.bh/mirror/other/shot.mp4/generation.yaml'),
			record: record ? parseBaseHalfGenerationMade(record) : undefined,
			upstream: await harness.exists('.bh/mirror/other/shot.mp4/upstream.yaml'),
			still: await harness.read('.bh/mirror/shots/still-2.png/generation.yaml'),
			stillRecord: await harness.exists('.bh/mirror/shots/still-2.png/made.yaml')
		}, {
			result: { copied: ['other/shot.mp4'], failed: [] },
			// Only a draft has a generation.yaml: the copy of a generated file is its record alone.
			info: undefined,
			record: baseHalfGenerationMadeCopy(made, '20261022T090000-feedbeef'),
			upstream: false,
			// A file without a record is an ordinary file: its copy is one too.
			still: undefined,
			stillRecord: false
		});
	});

	test('a copy of a folder copies the cards below it: each file\'s card information and each draft, but no generated file that is gone', async () => {
		const harness = await createHarness(disposables, {
			'shots/notes.md': 'notes',
			'shots/deep/shot.mp4': 'video',
			'.bh/mirror/shots/deep/shot.mp4/generation.yaml': 'prompt: "A pier."\n',
			'.bh/mirror/shots/deep/shot.mp4/made.yaml': serializeBaseHalfGenerationMade(made),
			'.bh/mirror/shots/draft.png/generation.yaml': 'prompt: "A heron."\n',
			'.bh/mirror/shots/draft.png/upstream.yaml': 'upstream:\n  - shots/notes.md\n',
			// The record of a generated file that is gone, and a description that is no card information.
			'.bh/mirror/shots/gone.mp4/made.yaml': serializeBaseHalfGenerationMade(made),
			'.bh/mirror/shots/notes.md/badge.yaml': 'path: "shots/notes.md"\ndescription: "Notes"\n'
		});
		await harness.copyFile('shots', 'shots copy');
		const result = await harness.copyCards([['shots', 'shots copy']]);
		assert.deepStrictEqual({
			result,
			draft: await harness.read('.bh/mirror/shots copy/draft.png/generation.yaml'),
			draftUpstream: await harness.exists('.bh/mirror/shots copy/draft.png/upstream.yaml'),
			shot: await harness.read('.bh/mirror/shots copy/deep/shot.mp4/generation.yaml'),
			record: parseBaseHalfGenerationMade((await harness.read('.bh/mirror/shots copy/deep/shot.mp4/made.yaml'))!)?.copyOf,
			gone: await harness.exists('.bh/mirror/shots copy/gone.mp4'),
			badge: await harness.exists('.bh/mirror/shots copy/notes.md/badge.yaml'),
			cards: (await harness.store.listCards(harness.resource('shots copy'))).map(card => ({ name: card.name, hasFile: card.hasFile }))
		}, {
			result: { copied: ['shots copy/deep/shot.mp4', 'shots copy/draft.png'], failed: [] },
			draft: 'prompt: "A heron."\n',
			draftUpstream: false,
			shot: undefined,
			record: made.id,
			gone: false,
			badge: false,
			cards: [{ name: 'draft.png', hasFile: false }]
		});
	});

	test('card information at the copy stays, and a copy from or to outside the open folder gets none', async () => {
		const harness = await createHarness(disposables, {
			'shots/shot.mp4': 'video',
			'.bh/mirror/shots/shot.mp4/generation.yaml': 'prompt: "A pier."\n',
			'.bh/mirror/shots/shot.mp4/made.yaml': serializeBaseHalfGenerationMade(made),
			'shots/kept.mp4': 'another video',
			'.bh/mirror/shots/kept.mp4/generation.yaml': 'prompt: "Its own."\n',
			'/outside/clip.mp4': 'video'
		});
		await harness.copyFile('shots/shot.mp4', 'shots/kept.mp4');
		await harness.copyFile('/outside/clip.mp4', 'shots/clip.mp4');
		const result = await harness.copyCards([['shots/shot.mp4', 'shots/kept.mp4'], ['/outside/clip.mp4', 'shots/clip.mp4'], ['shots/shot.mp4', '/outside/shot.mp4']]);
		assert.deepStrictEqual({
			result,
			kept: await harness.read('.bh/mirror/shots/kept.mp4/generation.yaml'),
			keptRecord: await harness.exists('.bh/mirror/shots/kept.mp4/made.yaml'),
			clip: await harness.exists('.bh/mirror/shots/clip.mp4')
		}, {
			result: { copied: [], failed: [] },
			kept: 'prompt: "Its own."\n',
			keptRecord: false,
			clip: false
		});
	});

	test('a copy in a folder BaseHalf is set to leave alone gets no card information', async () => {
		const harness = await createHarness(disposables, {
			[BASEHALF_WORKSPACE_SETUP_DISABLE_MARKER]: '',
			'shots/shot.mp4': 'video',
			'.bh/mirror/shots/shot.mp4/generation.yaml': 'prompt: "A pier."\n'
		});
		await harness.copyFile('shots/shot.mp4', 'shots/shot copy.mp4');
		assert.deepStrictEqual([await harness.copyCards([['shots/shot.mp4', 'shots/shot copy.mp4']]), await harness.exists('.bh/mirror/shots/shot copy.mp4')], [{ copied: [], failed: [] }, false]);
	});

	test('a copy through the workbench is a generation card before the copy\'s listeners hear of it', async () => {
		const harness = await createHarness(disposables, {
			'shots/shot.mp4': 'video',
			'.bh/mirror/shots/shot.mp4/generation.yaml': 'prompt: "A pier."\n',
			'.bh/mirror/shots/shot.mp4/made.yaml': serializeBaseHalfGenerationMade(made)
		}, { contribution: true });
		const heard: boolean[] = [];
		disposables.add(harness.workingCopyFileService.onDidRunWorkingCopyFileOperation(event => event.waitUntil((async () => {
			heard.push(await harness.store.isGenerationCard(harness.resource('shots/shot copy.mp4')));
		})())));
		await harness.workingCopyFileService.copy([{ file: { source: harness.resource('shots/shot.mp4'), target: harness.resource('shots/shot copy.mp4') } }], CancellationToken.None);
		const copy = await harness.store.read(harness.resource('shots/shot copy.mp4'));
		assert.deepStrictEqual({ heard, prompt: copy.made?.prompt, copyOf: copy.made?.copyOf, newId: copy.made?.id !== made.id, notifications: harness.notifications.shown }, {
			heard: [true],
			prompt: made.prompt,
			copyOf: made.id,
			newId: true,
			notifications: []
		});
	});
});
