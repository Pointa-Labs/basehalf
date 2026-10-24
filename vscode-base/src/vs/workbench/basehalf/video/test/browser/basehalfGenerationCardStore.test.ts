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
import { BaseHalfGenerationCardStore } from '../../browser/basehalfGenerationCardStore.js';
import { IBaseHalfGenerationMade, serializeBaseHalfGenerationMade, setBaseHalfGenerationChoice, setBaseHalfGenerationPrompt } from '../../common/basehalfGenerationInfo.js';
import { BaseHalfVideoCatalogState, IBaseHalfVideoCatalog, IBaseHalfVideoCheckResult } from '../../common/basehalfVideoCatalog.js';
import { IBaseHalfVideoCatalogService } from '../../common/basehalfVideoGeneration.js';
import { TEST_GENERATION_CATALOG } from '../common/basehalfVideoCatalogFixture.js';
import { BaseHalfTestFileSystemProvider } from './basehalfVideoTestFixtures.js';

const folder = URI.file('/work');

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
	readonly catalog: FakeCatalogService;
	readonly notifications: RecordingNotificationService;
	readonly undoRedo: IUndoRedoService;
	/** The cards the store reported as changed. */
	readonly changed: string[];
	/** The mirror files written, in order, by the paths below `.bh/`. */
	readonly commits: string[];
	/** Runs `hook` once, right before the store's next write of a file. */
	beforeNextCommit(hook: () => Promise<void>): void;
	read(path: string): Promise<string | undefined>;
	write(path: string, content: string): Promise<void>;
	remove(path: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	resource(path: string): URI;
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
	const commits: string[] = [];
	let hook: (() => Promise<void>) | undefined;
	const write = fileService.writeFileWithExpectedContents.bind(fileService);
	fileService.writeFileWithExpectedContents = async (target, contents, expected, options) => {
		const next = hook;
		hook = undefined;
		await next?.();
		commits.push(target.path.slice(`${folder.path}/.bh/`.length));
		return write(target, contents, expected, options);
	};
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
	instantiationService.stub(IBaseHalfReferenceEditService, disposables.add(instantiationService.createInstance(BaseHalfReferenceEditService)));
	instantiationService.stub(IBaseHalfCanvasMirrorService, disposables.add(instantiationService.createInstance(BaseHalfCanvasMirrorService)));
	const catalog = disposables.add(new FakeCatalogService());
	instantiationService.stub(IBaseHalfVideoCatalogService, catalog);
	await index.whenReady(folder);
	const store = disposables.add(instantiationService.createInstance(BaseHalfGenerationCardStore));
	const changed: string[] = [];
	disposables.add(store.onDidChange(card => changed.push(card.path.slice(folder.path.length + 1))));
	return {
		store,
		catalog,
		notifications,
		undoRedo: instantiationService.get(IUndoRedoService),
		changed,
		commits,
		beforeNextCommit: next => { hook = next; },
		read: async path => {
			try {
				return (await fileService.readFile(resource(path))).value.toString();
			} catch {
				return undefined;
			}
		},
		write: async (path, content) => { await fileService.writeFile(resource(path), VSBuffer.fromString(content)); },
		remove: path => fileService.del(resource(path), { recursive: true, useTrash: false }),
		exists: path => fileService.exists(resource(path)),
		resource
	};
}

const made: IBaseHalfGenerationMade = {
	id: '20261022T080000-1a2b3c4d',
	startedAt: '2026-10-22T08:00:00.000Z',
	finishedAt: '2026-10-22T08:01:00.000Z',
	remoteId: 'cgt-1',
	provider: 'acme',
	region: 'east',
	model: 'acme-motion-2',
	providerModel: 'acme-motion-2-e-260101',
	mode: 'frames',
	params: { duration: 5 },
	prompt: 'A pier at dawn.',
	inputs: ['frames/start.png']
};

suite('BaseHalfGenerationCardStore', () => {
	const disposables = new DisposableStore();
	teardown(() => disposables.clear());
	ensureNoDisposablesAreLeakedInTestSuite();

	test('reads a draft and a card with its file and its record, and refuses an item that is no generation card', async () => {
		const harness = await createHarness(disposables, {
			'.bh/mirror/shots/hero.png/generation.yaml': 'prompt: "A heron."\nprovider: "corvid"\nmodel: "corvid-paint"\n',
			'.bh/mirror/shots/hero.png/upstream.yaml': 'upstream:\n  - refs/a.png\n  - refs/a.png\n  - refs/b.png\n',
			'shots/shot.mp4': 'video',
			'.bh/mirror/shots/shot.mp4/generation.yaml': 'prompt: "A pier at dawn."\n',
			'.bh/mirror/shots/shot.mp4/made.yaml': serializeBaseHalfGenerationMade(made),
			'shots/plain.png': 'png',
			'.bh/mirror/shots/plain.png/badge.yaml': 'path: "shots/plain.png"\ndescription: "A plain image."\n',
			'notes.md': '# Notes\n'
		});
		const hero = await harness.store.read(harness.resource('shots/hero.png'));
		const shot = await harness.store.read(harness.resource('shots/shot.mp4'));
		assert.deepStrictEqual({
			hero: { ...hero, resource: hero.resource.path },
			shot: { kind: shot.kind, hasFile: shot.hasFile, made: shot.made, prompt: shot.info.prompt },
			cards: await Promise.all(['shots/hero.png', 'shots/shot.mp4', 'shots/plain.png', 'notes.md', 'shots/missing.png'].map(path => harness.store.isGenerationCard(harness.resource(path))))
		}, {
			hero: {
				resource: '/work/shots/hero.png',
				path: 'shots/hero.png',
				kind: 'image',
				hasFile: false,
				info: { prompt: 'A heron.', provider: 'corvid', model: 'corvid-paint' },
				infoReadable: true,
				upstream: ['refs/a.png', 'refs/b.png']
			},
			shot: { kind: 'video', hasFile: true, made, prompt: 'A pier at dawn.' },
			cards: [true, true, false, false, false]
		});
		await assert.rejects(harness.store.read(harness.resource('shots/plain.png')), /is not an image, video, or audio card/);
		await assert.rejects(harness.store.read(harness.resource('notes.md')), /is not an image, video, or audio card/);
	});

	test('a file that is not YAML at all reads as no prompt; saving keeps a copy first and says so without naming it, and leaves made.yaml as it is', async () => {
		const conflict = 'prompt: "ours"\n<<<<<<< HEAD\nmodel: "acme-still"\n=======\nmodel: "acme-clip"\n>>>>>>> theirs\n';
		const harness = await createHarness(disposables, {
			'shots/shot.mp4': 'video',
			'.bh/mirror/shots/shot.mp4/generation.yaml': conflict,
			'.bh/mirror/shots/shot.mp4/made.yaml': 'id: [not a record\n',
			'.bh/mirror/shots/calm.png/generation.yaml': conflict
		});
		const before = await harness.store.read(harness.resource('shots/shot.mp4'));
		const saved = await harness.store.update(harness.resource('shots/shot.mp4'), info => setBaseHalfGenerationPrompt(info, 'A new prompt.'));
		// Nothing changes: no copy, no write.
		await harness.store.update(harness.resource('shots/calm.png'), info => setBaseHalfGenerationPrompt(info, ''));
		assert.deepStrictEqual({
			before: [before.infoReadable, before.info, before.madeUnreadable],
			saved: [saved.infoReadable, saved.info],
			file: await harness.read('.bh/mirror/shots/shot.mp4/generation.yaml'),
			made: await harness.read('.bh/mirror/shots/shot.mp4/made.yaml'),
			calm: await harness.read('.bh/mirror/shots/calm.png/generation.yaml'),
			notifications: harness.notifications.shown,
			noPathShown: harness.notifications.shown.some(message => message.includes('.bh'))
		}, {
			before: [false, { prompt: '' }, true],
			saved: [true, { prompt: 'A new prompt.' }],
			file: 'prompt: "A new prompt."\n',
			made: 'id: [not a record\n',
			calm: conflict,
			notifications: ['BaseHalf could not read the saved prompt and settings of shot.mp4, so it saved the new ones. A copy of the old ones is kept.'],
			noPathShown: false
		});
		const recovered = (await harness.exists('.bh/cache/recovered/mirror/shots/shot.mp4')) ? harness.commits.find(path => /^cache\/recovered\/mirror\/shots\/shot\.mp4\/generation\.[0-9a-f]{12}\.yaml$/.test(path)) : undefined;
		assert.ok(recovered, `no recovery copy among ${harness.commits.join(', ')}`);
		assert.strictEqual(await harness.read(`.bh/${recovered}`), conflict);
	});

	test('writes only the fields it changes, and plans again from the new bytes when an agent wrote meanwhile, so both changes stay', async () => {
		const harness = await createHarness(disposables, {
			'.bh/mirror/shots/hero.png/generation.yaml': '# by the agent\nprompt: "A heron."\nprovider: "corvid"\nmodel: "corvid-paint"\nparams:\n  count: 2\n'
		});
		harness.beforeNextCommit(() => harness.write('.bh/mirror/shots/hero.png/generation.yaml', '# by the agent\nprompt: "A heron."\nprovider: "corvid"\nmodel: "corvid-print"\nparams:\n  count: 2\n'));
		const seen: (string | undefined)[] = [];
		const saved = await harness.store.update(harness.resource('shots/hero.png'), info => {
			seen.push(info.model);
			return setBaseHalfGenerationPrompt(info, 'A heron at dawn.');
		});
		const settings = await harness.store.update(harness.resource('shots/hero.png'), info => setBaseHalfGenerationChoice(info, { provider: 'corvid', model: 'corvid-print', mode: 'reference', params: { count: 1 } }));
		assert.deepStrictEqual({
			seen,
			saved: saved.info,
			settings: settings.info,
			file: await harness.read('.bh/mirror/shots/hero.png/generation.yaml'),
			changed: harness.changed.filter(path => path === 'shots/hero.png').length > 0
		}, {
			seen: ['corvid-paint', 'corvid-print'],
			saved: { prompt: 'A heron at dawn.', provider: 'corvid', model: 'corvid-print', params: { count: 2 } },
			settings: { prompt: 'A heron at dawn.', provider: 'corvid', model: 'corvid-print', mode: 'reference', params: { count: 1 } },
			file: '# by the agent\nprompt: "A heron at dawn."\nprovider: "corvid"\nmodel: "corvid-print"\nparams:\n  count: 1\nmode: "reference"\n',
			changed: true
		});
	});

	test('reads a value of params by the type its model declares while the catalog knows the model', async () => {
		const harness = await createHarness(disposables, {
			'.bh/mirror/shots/hero.png/generation.yaml': 'prompt: ""\nprovider: "corvid"\nmodel: "corvid-paint"\nparams:\n  count: "3"\n  label: 09\n'
		});
		const known = (await harness.store.read(harness.resource('shots/hero.png'))).info.params;
		harness.catalog.state = { kind: 'loading' };
		const unknown = (await harness.store.read(harness.resource('shots/hero.png'))).info.params;
		assert.deepStrictEqual({ known, unknown }, { known: { count: 3, label: 9 }, unknown: { count: '3', label: 9 } });
	});

	test('makes a draft only where nothing is: its upstream list first, then its generation.yaml; a taken name is refused', async () => {
		const harness = await createHarness(disposables, {
			'refs/a.png': 'png',
			'shots/taken.png': 'png',
			'.bh/mirror/shots/missing.png/made.yaml': 'id: "x"\n',
			'.bh/mirror/shots/left.png/upstream.yaml': 'upstream:\n  - refs/a.png\n'
		});
		const shots = harness.resource('shots');
		const draft = await harness.store.createDraft(shots, 'image.png', { prompt: 'A heron.', provider: 'corvid', model: 'corvid-paint' }, ['refs/a.png', 'refs/a.png']);
		const commits = [...harness.commits];
		await assert.rejects(harness.store.createDraft(shots, 'image.png', { prompt: '' }), /image\.png is already taken/);
		await assert.rejects(harness.store.createDraft(shots, 'taken.png', { prompt: '' }), /taken\.png is already taken/);
		await assert.rejects(harness.store.createDraft(shots, 'missing.png', { prompt: '' }), /missing\.png is already taken/);
		// The connections an item that is gone left are card information too.
		await assert.rejects(harness.store.createDraft(shots, 'left.png', { prompt: '' }, ['refs/a.png']), /left\.png is already taken/);
		await assert.rejects(harness.store.createDraft(shots, 'notes.md', { prompt: '' }), /cannot be the name of an image or video card/);
		const snapshot = await harness.store.read(draft);
		assert.deepStrictEqual({
			draft: draft.path,
			commits,
			upstream: await harness.read('.bh/mirror/shots/image.png/upstream.yaml'),
			info: await harness.read('.bh/mirror/shots/image.png/generation.yaml'),
			snapshot: [snapshot.hasFile, snapshot.upstream],
			changed: harness.changed.includes('shots/image.png')
		}, {
			draft: '/work/shots/image.png',
			commits: ['mirror/shots/image.png/upstream.yaml', 'mirror/shots/image.png/generation.yaml'],
			upstream: 'upstream:\n  - refs/a.png\n',
			info: 'prompt: "A heron."\nprovider: "corvid"\nmodel: "corvid-paint"\n',
			snapshot: [false, ['refs/a.png']],
			changed: true
		});
	});

	test('writes made.yaml once, as it reads back', async () => {
		const harness = await createHarness(disposables, { 'shots/shot.mp4': 'video', '.bh/mirror/shots/shot.mp4/generation.yaml': 'prompt: "p"\n' });
		await harness.store.writeMade(harness.resource('shots/shot.mp4'), made);
		await assert.rejects(harness.store.writeMade(harness.resource('shots/shot.mp4'), { ...made, id: 'other' }), /already has the record/);
		assert.deepStrictEqual((await harness.store.read(harness.resource('shots/shot.mp4'))).made, made);
	});

	test('a file, a folder, a draft, and any card information take a name, a badge or connections left by an item that is gone included', async () => {
		const harness = await createHarness(disposables, {
			'shots/video.mp4': 'video',
			'shots/video-2.mp4/inner.txt': 'a folder of that name',
			'.bh/mirror/shots/video-3.mp4/generation.yaml': 'prompt: ""\n',
			'.bh/mirror/shots/video-4.mp4/made.yaml': 'id: "x"\n',
			'.bh/mirror/shots/video-5.mp4/badge.yaml': 'path: "shots/video-5.mp4"\n',
			'.bh/mirror/shots/VIDEO-6.mp4/upstream.yaml': 'upstream:\n  - brief.md\n'
		});
		const shots = harness.resource('shots');
		assert.deepStrictEqual([
			await harness.store.nextFreeName(shots, 'video', 'mp4'),
			await harness.store.nextFreeName(shots, 'video', 'mp4', 8),
			await harness.store.nextFreeName(shots, 'image', 'png'),
			await harness.store.nextFreeName(harness.resource('elsewhere'), 'video', 'mp4')
		], ['video-7.mp4', 'video-8.mp4', 'image.png', 'video.mp4']);
	});

	test('lists the drafts of a folder: generation information without made.yaml whose name names no item; none of a folder that is not there', async () => {
		const harness = await createHarness(disposables, {
			'shots/note.md': 'x',
			'.bh/mirror/shots/a.png/generation.yaml': 'prompt: ""\n',
			'.bh/mirror/shots/b.mp4/generation.yaml': 'prompt: ""\n',
			'shots/c.png': 'png',
			'.bh/mirror/shots/c.png/generation.yaml': 'prompt: ""\n',
			'.bh/mirror/shots/d.png/generation.yaml': 'prompt: ""\n',
			'.bh/mirror/shots/d.png/made.yaml': 'id: "x"\n',
			'.bh/mirror/shots/note.md/generation.yaml': 'prompt: ""\n',
			'.bh/mirror/gone/e.png/generation.yaml': 'prompt: ""\n'
		});
		const drafts = await harness.store.listDrafts(harness.resource('shots'));
		assert.deepStrictEqual({
			shots: drafts.map(draft => `${draft.name}:${draft.kind}:${draft.resource.path}`),
			gone: await harness.store.listDrafts(harness.resource('gone'))
		}, {
			shots: ['a.png:image:/work/shots/a.png', 'b.mp4:video:/work/shots/b.mp4'],
			gone: []
		});
	});

	test('lists the generation cards of a folder: its drafts, and its files that have their record, but no generated file that is gone and no file BaseHalf did not make (D67)', async () => {
		const harness = await createHarness(disposables, {
			'shots/note.md': 'x',
			'shots/plain.png': 'png',
			'.bh/mirror/shots/plain.png/badge.yaml': 'path: "shots/plain.png"\n',
			'.bh/mirror/shots/a.png/generation.yaml': 'prompt: ""\n',
			'shots/b.mp4': 'video',
			'.bh/mirror/shots/b.mp4/made.yaml': serializeBaseHalfGenerationMade(made),
			'shots/c.png': 'png',
			'.bh/mirror/shots/c.png/generation.yaml': 'prompt: ""\n',
			'.bh/mirror/shots/gone.mp4/generation.yaml': 'prompt: ""\n',
			'.bh/mirror/shots/gone.mp4/made.yaml': serializeBaseHalfGenerationMade(made),
			'shots/folder.mp4/inner.txt': 'a folder of that name',
			'.bh/mirror/shots/folder.mp4/generation.yaml': 'prompt: ""\n',
			'.bh/mirror/shots/note.md/generation.yaml': 'prompt: ""\n'
		});
		const cards = await harness.store.listCards(harness.resource('shots'));
		assert.deepStrictEqual({
			cards: cards.map(card => `${card.name}:${card.kind}:${card.hasFile ? 'file' : 'draft'}:${card.resource.path}`),
			drafts: (await harness.store.listDrafts(harness.resource('shots'))).map(draft => draft.name),
			missing: await harness.store.listCards(harness.resource('missing'))
		}, {
			// c.png has a generation.yaml and no record: a file that appeared at a draft's path is an ordinary file.
			cards: ['a.png:image:draft:/work/shots/a.png', 'b.mp4:video:file:/work/shots/b.mp4'],
			drafts: ['a.png'],
			missing: []
		});
	});

	test('writes the card information of a copy: a draft\'s generation.yaml, a generated file\'s record with a new id that names the one it copies, and nothing where card information is', async () => {
		const harness = await createHarness(disposables, {
			'shots/shot.mp4': 'video',
			'.bh/mirror/shots/shot.mp4/generation.yaml': '# kept\nprompt: "A pier at dawn."\n',
			'.bh/mirror/shots/shot.mp4/made.yaml': serializeBaseHalfGenerationMade(made),
			'.bh/mirror/shots/shot.mp4/upstream.yaml': 'upstream:\n  - frames/start.png\n',
			'shots/shot copy.mp4': 'video',
			'shots/taken.mp4': 'video',
			'.bh/mirror/shots/taken.mp4/badge.yaml': 'path: "shots/taken.mp4"\n',
			'.bh/mirror/shots/draft.png/generation.yaml': 'prompt: "A heron."\n',
			'shots/away.png': 'png',
			'shots/elsewhere/.keep': ''
		});
		const copied = await harness.store.writeCopy(harness.resource('shots/shot.mp4'), harness.resource('shots/shot copy.mp4'), '20261022T090000-feedbeef');
		const copy = await harness.store.read(harness.resource('shots/shot copy.mp4'));
		const draft = await harness.store.writeCopy(harness.resource('shots/draft.png'), harness.resource('shots/elsewhere/draft.png'), 'unused');
		assert.deepStrictEqual({
			copied,
			info: await harness.read('.bh/mirror/shots/shot copy.mp4/generation.yaml'),
			made: { id: copy.made?.id, copyOf: copy.made?.copyOf, prompt: copy.made?.prompt },
			upstream: copy.upstream,
			draft,
			draftInfo: (await harness.store.read(harness.resource('shots/elsewhere/draft.png'))).info,
			refused: [
				// Card information is there already.
				await harness.store.writeCopy(harness.resource('shots/shot.mp4'), harness.resource('shots/taken.mp4'), 'x'),
				// Another kind.
				await harness.store.writeCopy(harness.resource('shots/shot.mp4'), harness.resource('shots/away.png'), 'x'),
				// A copy of a draft only where no item is.
				await harness.store.writeCopy(harness.resource('shots/draft.png'), harness.resource('shots/away.png'), 'x'),
				// A copy of a card with its file only onto the copied file.
				await harness.store.writeCopy(harness.resource('shots/shot.mp4'), harness.resource('shots/nothing.mp4'), 'x')
			],
			takenBadge: await harness.read('.bh/mirror/shots/taken.mp4/generation.yaml')
		}, {
			copied: true,
			// Only a draft has a generation.yaml (D67): the one an earlier build left beside the file is not copied.
			info: undefined,
			made: { id: '20261022T090000-feedbeef', copyOf: made.id, prompt: made.prompt },
			upstream: [],
			draft: true,
			draftInfo: { prompt: 'A heron.' },
			refused: [false, false, false, false],
			takenBadge: undefined
		});
	});

	test('resolves its inputs: a file, a folder, a draft of its kind without a file, and entries that name nothing, a draft whose folder is not there included', async () => {
		const harness = await createHarness(disposables, {
			'refs/a.png': 'png',
			'refs/folder/x.md': 'x',
			'shots/notes.md': 'x',
			'.bh/mirror/shots/draft.mp4/generation.yaml': 'prompt: ""\n',
			'.bh/mirror/away/draft.mp4/generation.yaml': 'prompt: ""\n',
			'.bh/mirror/shots/hero.png/generation.yaml': 'prompt: ""\n',
			'.bh/mirror/shots/hero.png/upstream.yaml': 'upstream:\n  - refs/a.png\n  - refs/folder\n  - shots/draft.mp4\n  - refs/gone.png\n  - away/draft.mp4\n'
		});
		const snapshot = await harness.store.read(harness.resource('shots/hero.png'));
		const inputs = await harness.store.resolveInputs(snapshot);
		assert.deepStrictEqual(inputs.map(input => ({ ...input, ...(input.file ? { file: input.file.path } : {}) })), [
			{ path: 'refs/a.png', kind: 'image', available: true, file: '/work/refs/a.png' },
			{ path: 'refs/folder', kind: 'other', available: true },
			{ path: 'shots/draft.mp4', kind: 'video', available: false, draft: true },
			{ path: 'refs/gone.png', kind: 'image', available: false },
			{ path: 'away/draft.mp4', kind: 'video', available: false }
		]);
	});

	test('hears generation.yaml and made.yaml that another program wrote, and the card information of a draft that was removed', async () => {
		const harness = await createHarness(disposables, { 'shots/note.md': 'x', 'shots/shot.mp4': 'video' });
		await harness.write('.bh/mirror/shots/agent.png/generation.yaml', 'prompt: "From an agent."\n');
		await harness.write('.bh/mirror/shots/agent.png/badge.yaml', 'path: "shots/agent.png"\n');
		await harness.write('.bh/mirror/shots/note.md/generation.yaml', 'prompt: ""\n');
		await harness.write('.bh/mirror/shots/shot.mp4/made.yaml', serializeBaseHalfGenerationMade(made));
		await timeout(30);
		const written = [...harness.changed];
		harness.changed.length = 0;
		await harness.remove('.bh/mirror/shots/agent.png');
		await timeout(30);
		assert.deepStrictEqual({ written, removed: harness.changed }, { written: ['shots/agent.png', 'shots/shot.mp4'], removed: ['shots/agent.png'] });
	});

	test('reorders the inputs as one step of the canvas undo stack', async () => {
		const harness = await createHarness(disposables, {
			'frames/a.png': 'png',
			'frames/b.png': 'png',
			'.bh/mirror/shots/clip.mp4/generation.yaml': 'prompt: ""\n',
			'.bh/mirror/shots/clip.mp4/upstream.yaml': 'upstream:\n  - frames/a.png\n  - frames/b.png\n'
		});
		const reordered = await harness.store.reorderUpstream(harness.resource('shots/clip.mp4'), ['frames/b.png', 'frames/a.png']);
		const afterReorder = await harness.read('.bh/mirror/shots/clip.mp4/upstream.yaml');
		await harness.undoRedo.undo(BASEHALF_CANVAS_UNDO_REDO_SOURCE);
		await assert.rejects(harness.store.reorderUpstream(harness.resource('shots/clip.mp4'), ['frames/b.png']), /The inputs of clip\.mp4 changed/);
		assert.deepStrictEqual({ reordered: reordered.upstream, afterReorder, afterUndo: await harness.read('.bh/mirror/shots/clip.mp4/upstream.yaml') }, {
			reordered: ['frames/b.png', 'frames/a.png'],
			afterReorder: 'upstream:\n  - frames/b.png\n  - frames/a.png\n',
			afterUndo: 'upstream:\n  - frames/a.png\n  - frames/b.png\n'
		});
	});
});
