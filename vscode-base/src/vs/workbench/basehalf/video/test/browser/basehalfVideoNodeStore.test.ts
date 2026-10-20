/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../../base/common/network.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IBulkEditService } from '../../../../../editor/browser/services/bulkEditService.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { FileSystemProviderCapabilities } from '../../../../../platform/files/common/files.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { TestNotificationService } from '../../../../../platform/notification/test/common/testNotificationService.js';
import { IUndoRedoService } from '../../../../../platform/undoRedo/common/undoRedo.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { testWorkspace } from '../../../../../platform/workspace/test/common/testWorkspace.js';
import { BulkEditService } from '../../../../contrib/bulkEdit/browser/bulkEditService.js';
import { ISearchService } from '../../../../services/search/common/search.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { TestContextService } from '../../../../test/common/workbenchTestServices.js';
import { BaseHalfReferenceEditService } from '../../../references/browser/basehalfReferenceEditService.js';
import { BaseHalfVideoNodeStore } from '../../browser/basehalfVideoNodeStore.js';
import { BaseHalfAdhdMirrorService, IBaseHalfAdhdMirrorService } from '../../../markdown/common/basehalfAdhdMirror.js';
import { BASEHALF_CANVAS_UNDO_REDO_SOURCE } from '../../../canvas/common/basehalfCanvasEditing.js';
import { BaseHalfCanvasMirrorService, IBaseHalfCanvasMirrorService } from '../../../canvas/common/basehalfCanvasMirror.js';
import { IBaseHalfCanvasFolderState, IBaseHalfCanvasNavigationService } from '../../../navigation/common/basehalfCanvasNavigation.js';
import { BaseHalfEditorFlushService, IBaseHalfEditorFlushService } from '../../../navigation/common/basehalfEditorFlush.js';
import { createBaseHalfNodeDocument, IBaseHalfNodeDocument, parseBaseHalfNodeDocument, serializeBaseHalfNodeDocument } from '../../common/basehalfNodeDocument.js';
import { IBaseHalfReferenceEditService } from '../../../references/common/basehalfReferenceEdit.js';
import { BaseHalfReferenceIndexService, IBaseHalfReferenceIndexService } from '../../../references/common/basehalfReferenceIndex.js';
import { IBaseHalfVideoNodeFields } from '../../common/basehalfVideoNode.js';
import { BaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceMutationCoordinator } from '../../../workspace/common/basehalfWorkspaceMutation.js';
import { baseHalfNodeTestId } from '../common/basehalfNodeTestFixtures.js';
import { BaseHalfInMemoryFileSearchService } from '../../../references/test/browser/basehalfReferenceTestFixtures.js';

const folder = URI.file('/work');
const SHOT = 'shots/Shot 1.bhnode';

/** Whole-file writes: the in-memory provider's open/write/close path does not truncate. */
class WholeFileProvider extends InMemoryFileSystemProvider {
	override get capabilities(): FileSystemProviderCapabilities {
		return super.capabilities & ~FileSystemProviderCapabilities.FileOpenReadWriteClose;
	}
}

interface IHarness {
	readonly store: BaseHalfVideoNodeStore;
	readonly canvasMirror: IBaseHalfCanvasMirrorService;
	readonly undoRedo: IUndoRedoService;
	/** Every resource the store reported as written. */
	readonly written: string[];
	/** Runs `hook` once, right before the store's next write reaches the edit service. */
	beforeNextWrite(hook: () => Promise<void>): void;
	read(path: string): Promise<string | undefined>;
	readNode(path: string): Promise<IBaseHalfNodeDocument>;
	write(path: string, content: string): Promise<void>;
	resource(path: string): URI;
}

async function createHarness(disposables: DisposableStore, files: Record<string, string>): Promise<IHarness> {
	const fileService = disposables.add(new FileService(new NullLogService()));
	disposables.add(fileService.registerProvider(Schemas.file, disposables.add(new WholeFileProvider())));
	await fileService.createFolder(folder);
	for (const [path, content] of Object.entries(files)) {
		await fileService.writeFile(joinPath(folder, ...path.split('/')), VSBuffer.fromString(content));
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
	instantiationService.stub(INotificationService, new TestNotificationService());
	instantiationService.stub(IBaseHalfCanvasNavigationService, { openCardDetail: async () => ({ handled: false, reason: 'unsupportedResource' }) });
	const index = disposables.add(instantiationService.createInstance(BaseHalfReferenceIndexService));
	instantiationService.stub(IBaseHalfReferenceIndexService, index);
	const edit = disposables.add(instantiationService.createInstance(BaseHalfReferenceEditService));
	let beforeWrite: (() => Promise<void>) | undefined;
	instantiationService.stub(IBaseHalfReferenceEditService, {
		apply: async (edits: Parameters<IBaseHalfReferenceEditService['apply']>[0], options: Parameters<IBaseHalfReferenceEditService['apply']>[1]) => {
			const hook = beforeWrite;
			beforeWrite = undefined;
			await hook?.();
			return edit.apply(edits, options);
		},
		pushUndoElement: (result: Parameters<IBaseHalfReferenceEditService['pushUndoElement']>[0], options: Parameters<IBaseHalfReferenceEditService['pushUndoElement']>[1]) => edit.pushUndoElement(result, options)
	} as Partial<IBaseHalfReferenceEditService> as IBaseHalfReferenceEditService);
	const canvasMirror = disposables.add(instantiationService.createInstance(BaseHalfCanvasMirrorService));
	instantiationService.stub(IBaseHalfCanvasMirrorService, canvasMirror);
	await index.whenReady(folder);
	const store = disposables.add(instantiationService.createInstance(BaseHalfVideoNodeStore));
	const written: string[] = [];
	disposables.add(store.onDidWrite(resource => written.push(resource.path)));
	const read = async (path: string) => {
		try {
			return (await fileService.readFile(joinPath(folder, ...path.split('/')))).value.toString();
		} catch {
			return undefined;
		}
	};
	return {
		store,
		canvasMirror,
		undoRedo: instantiationService.get(IUndoRedoService),
		written,
		beforeNextWrite: hook => { beforeWrite = hook; },
		read,
		readNode: async path => parseBaseHalfNodeDocument((await read(path))!),
		write: async (path, content) => { await fileService.writeFile(joinPath(folder, ...path.split('/')), VSBuffer.fromString(content)); },
		resource: path => joinPath(folder, ...path.split('/'))
	};
}

function videoNode(id: number, options: { readonly title?: string; readonly prompt?: string; readonly upstream?: readonly unknown[]; readonly result?: IBaseHalfNodeDocument['result'] } = {}): string {
	return serializeBaseHalfNodeDocument(createBaseHalfNodeDocument({
		id: baseHalfNodeTestId(id),
		kind: 'video',
		title: options.title ?? 'Shot 1',
		prompt: options.prompt ?? 'The rider in Image 1 cycles along the coast.',
		upstream: (options.upstream ?? ['frames/start.png', 'frames/end.png', 'notes/scene.md']) as IBaseHalfNodeDocument['upstream'],
		generation: { provider: 'acme', model: 'acme-motion-2', mode: 'frames', params: { resolution: '720p', duration: 5, sound: true } },
		...(options.result ? { result: options.result } : {})
	}));
}

function shotsFolder(): IBaseHalfCanvasFolderState {
	return { resource: joinPath(folder, 'shots'), workspaceFolder: folder, relativePath: 'shots', source: 'api' };
}

suite('BaseHalfVideoNodeStore', () => {
	const disposables = new DisposableStore();
	teardown(() => disposables.clear());
	ensureNoDisposablesAreLeakedInTestSuite();

	test('reads a Video node with its valid upstream entries, and refuses anything else', async () => {
		const harness = await createHarness(disposables, {
			[SHOT]: videoNode(1, { upstream: ['frames/start.png', 42, 'frames/end.png/', 'frames/start.png'] }),
			'shots/frame.bhnode': serializeBaseHalfNodeDocument(createBaseHalfNodeDocument({ id: baseHalfNodeTestId(2), kind: 'image', title: 'Frame' })),
			'shots/old.bhnode': JSON.stringify({ version: 4, id: baseHalfNodeTestId(3), kind: 'video', title: 'Old', role: 'Clip', prompt: '', upstream: [], attempts: [] }),
			'notes.md': '# Notes\n'
		});
		const snapshot = await harness.store.read(harness.resource(SHOT));
		assert.deepStrictEqual({ ...snapshot, resource: snapshot.resource.path, fields: { prompt: snapshot.fields.prompt, model: snapshot.fields.generation?.model } }, {
			resource: '/work/shots/Shot 1.bhnode',
			path: SHOT,
			id: baseHalfNodeTestId(1),
			title: 'Shot 1',
			upstream: ['frames/start.png', 'frames/end.png'],
			fields: { prompt: 'The rider in Image 1 cycles along the coast.', model: 'acme-motion-2' }
		});
		await assert.rejects(harness.store.read(harness.resource('shots/frame.bhnode')), /is not a Video node/);
		await assert.rejects(harness.store.read(harness.resource('shots/old.bhnode')), /document\.version 4 is no longer supported/);
		await assert.rejects(harness.store.read(harness.resource('notes.md')), /is not a node/);
		await assert.rejects(harness.store.read(URI.file('/elsewhere/Shot.bhnode')), /is not in an open folder/);
	});

	test('writes the changed video fields once and keeps every other field', async () => {
		const harness = await createHarness(disposables, { [SHOT]: videoNode(1) });
		const before = await harness.readNode(SHOT);
		const snapshot = await harness.store.update(harness.resource(SHOT), fields => ({ ...fields, prompt: 'Image 1 turns into Image 2.' }));
		const after = await harness.readNode(SHOT);
		assert.deepStrictEqual({ ...after, prompt: before.prompt }, before);
		assert.deepStrictEqual([after.prompt, snapshot.fields.prompt, harness.written], ['Image 1 turns into Image 2.', 'Image 1 turns into Image 2.', ['/work/shots/Shot 1.bhnode']]);

		// Nothing changed: nothing is written.
		const text = await harness.read(SHOT);
		await harness.store.update(harness.resource(SHOT), fields => ({ ...fields }));
		assert.deepStrictEqual([await harness.read(SHOT), harness.written.length], [text, 1]);
		assert.strictEqual(harness.undoRedo.canUndo(BASEHALF_CANVAS_UNDO_REDO_SOURCE), false);
	});

	test('applies the change again when the file changed underneath, running the mutation again', async () => {
		const harness = await createHarness(disposables, { [SHOT]: videoNode(1) });
		// Another writer adds an input between the store's read and its write.
		harness.beforeNextWrite(async () => {
			await harness.write(SHOT, videoNode(1, { upstream: ['frames/start.png', 'frames/end.png', 'notes/scene.md', 'notes/extra.md'] }));
		});
		const seen: (string | undefined)[] = [];
		await harness.store.update(harness.resource(SHOT), (fields: IBaseHalfVideoNodeFields) => {
			seen.push(fields.prompt);
			return { ...fields, prompt: `${fields.prompt} Slowly.` };
		});
		const after = await harness.readNode(SHOT);
		assert.deepStrictEqual({ calls: seen.length, prompt: after.prompt, upstream: after.upstream }, {
			calls: 2,
			prompt: 'The rider in Image 1 cycles along the coast. Slowly.',
			upstream: ['frames/start.png', 'frames/end.png', 'notes/scene.md', 'notes/extra.md']
		});
	});

	test('rejects with the mutation\'s error and writes nothing', async () => {
		const harness = await createHarness(disposables, { [SHOT]: videoNode(1) });
		const text = await harness.read(SHOT);
		await assert.rejects(harness.store.update(harness.resource(SHOT), () => { throw new Error('This node is already generating.'); }), /already generating/);
		await assert.rejects(harness.store.update(harness.resource('shots/gone.bhnode'), fields => fields));
		assert.deepStrictEqual([await harness.read(SHOT), harness.written], [text, []]);
	});

	test('a write with an undo label is one canvas undo step', async () => {
		const harness = await createHarness(disposables, { [SHOT]: videoNode(1) });
		const before = await harness.read(SHOT);
		await harness.store.update(harness.resource(SHOT), fields => ({ ...fields, prompt: 'Edited.' }), { undoLabel: 'Edit Prompt' });
		const after = await harness.read(SHOT);
		assert.strictEqual(harness.undoRedo.canUndo(BASEHALF_CANVAS_UNDO_REDO_SOURCE), true);
		await harness.undoRedo.undo(BASEHALF_CANVAS_UNDO_REDO_SOURCE);
		assert.strictEqual(await harness.read(SHOT), before);
		await harness.undoRedo.redo(BASEHALF_CANVAS_UNDO_REDO_SOURCE);
		assert.strictEqual(await harness.read(SHOT), after);
	});

	test('reorders the inputs and nothing else, as one undo step, and refuses another set of entries', async () => {
		const harness = await createHarness(disposables, { [SHOT]: videoNode(1, { upstream: ['frames/start.png', 42, 'frames/end.png', 'notes/scene.md'] }) });
		const before = await harness.read(SHOT);
		const snapshot = await harness.store.reorderUpstream(harness.resource(SHOT), ['frames/end.png', 'frames/start.png', 'notes/scene.md']);
		const after = await harness.readNode(SHOT);
		assert.deepStrictEqual({ upstream: after.upstream, snapshot: snapshot.upstream }, {
			// The item that is not an entry keeps its place.
			upstream: ['frames/end.png', 42, 'frames/start.png', 'notes/scene.md'],
			snapshot: ['frames/end.png', 'frames/start.png', 'notes/scene.md']
		});
		assert.deepStrictEqual({ ...after, upstream: [] }, { ...parseBaseHalfNodeDocument(before!), upstream: [] });

		await harness.undoRedo.undo(BASEHALF_CANVAS_UNDO_REDO_SOURCE);
		assert.strictEqual(await harness.read(SHOT), before);
		assert.strictEqual(harness.undoRedo.canUndo(BASEHALF_CANVAS_UNDO_REDO_SOURCE), false);

		await assert.rejects(harness.store.reorderUpstream(harness.resource(SHOT), ['frames/end.png', 'frames/start.png']), /changed/);
		await assert.rejects(harness.store.reorderUpstream(harness.resource(SHOT), ['frames/end.png', 'frames/start.png', 'notes/other.md']), /changed/);
		assert.strictEqual(await harness.read(SHOT), before);
	});

	test('resolves each input to the file that holds its content, a node to the file it shows', async () => {
		const shown = `outputs/${baseHalfNodeTestId(5)}/task-1.mp4`;
		const harness = await createHarness(disposables, {
			[SHOT]: videoNode(1, { upstream: ['frames/a.png', 'notes/n.md', 'gone.png', 'clips/shot.bhnode', 'clips/frame.bhnode', 'clips/lost.bhnode', 'refs', 'clips/old.bhnode', 'sources/book.pdf'] }),
			'frames/a.png': 'png',
			'notes/n.md': '# N\n',
			'refs/x.png': 'png',
			'sources/book.pdf': '%PDF',
			[shown]: 'mp4',
			'clips/shot.bhnode': videoNode(5, { result: { source: 'imported', artifact: { kind: 'video', path: shown, size: 3 } } }),
			'clips/frame.bhnode': serializeBaseHalfNodeDocument(createBaseHalfNodeDocument({ id: baseHalfNodeTestId(6), kind: 'image', title: 'Frame' })),
			'clips/lost.bhnode': videoNode(7, { result: { source: 'imported', artifact: { kind: 'video', path: 'clips/lost.mp4', size: 3 } } }),
			'clips/old.bhnode': JSON.stringify({ version: 4 })
		});
		const inputs = await harness.store.resolveInputs(await harness.store.read(harness.resource(SHOT)));
		assert.deepStrictEqual(inputs.map(input => ({ ...input, ...(input.file ? { file: input.file.path } : {}) })), [
			{ path: 'frames/a.png', kind: 'image', available: true, file: '/work/frames/a.png' },
			{ path: 'notes/n.md', kind: 'text', available: true, file: '/work/notes/n.md' },
			{ path: 'gone.png', kind: 'image', available: false },
			{ path: 'clips/shot.bhnode', kind: 'video', available: true, file: `/work/${shown}` },
			// A node that shows nothing yet keeps its kind.
			{ path: 'clips/frame.bhnode', kind: 'image', available: false },
			{ path: 'clips/lost.bhnode', kind: 'video', available: false },
			{ path: 'refs', kind: 'other', available: true },
			{ path: 'clips/old.bhnode', kind: 'other', available: false },
			{ path: 'sources/book.pdf', kind: 'other', available: true, file: '/work/sources/book.pdf' }
		]);
	});

	test('creates a sibling with the next free name, its fields and inputs, and puts its card to the right of the original', async () => {
		const harness = await createHarness(disposables, {
			[SHOT]: videoNode(1),
			// Taken by a file and by a card row of an item that is gone.
			'shots/Shot 1-2.bhnode': videoNode(2, { title: 'Shot 1 2' })
		});
		await harness.canvasMirror.updateCardGeometry(shotsFolder(), { path: SHOT, kind: 'file', x: 100, y: 50, width: 720, height: 405 });
		await harness.canvasMirror.updateCardGeometry(shotsFolder(), { path: 'shots/Shot 1-3.bhnode', kind: 'file', x: 100, y: 1000, width: 720, height: 405 });
		const original = await harness.read(SHOT);
		const fields: IBaseHalfVideoNodeFields = {
			prompt: 'The rider in Image 1 cycles along the coast.',
			generation: { provider: 'acme', model: 'acme-motion-2', mode: 'frames', params: { resolution: '720p', duration: 5, sound: true } }
		};
		const sibling = await harness.store.createSibling(harness.resource(SHOT), fields, ['frames/start.png', 'frames/end.png', 'notes/scene.md']);
		const created = await harness.readNode('shots/Shot 1-4.bhnode');
		const layout = await harness.canvasMirror.readCanvas(shotsFolder());
		assert.deepStrictEqual({
			sibling: sibling.path,
			created: { kind: created.kind, title: created.title, prompt: created.prompt, generation: created.generation, upstream: created.upstream, task: created.task, result: created.result },
			newIdentity: created.id !== baseHalfNodeTestId(1),
			card: layout?.cards.find(card => card.path === 'shots/Shot 1-4.bhnode'),
			original: await harness.read(SHOT) === original,
			written: harness.written
		}, {
			sibling: '/work/shots/Shot 1-4.bhnode',
			created: {
				kind: 'video',
				title: 'Shot 1 4',
				prompt: fields.prompt,
				generation: fields.generation,
				upstream: ['frames/start.png', 'frames/end.png', 'notes/scene.md'],
				task: undefined,
				result: undefined
			},
			newIdentity: true,
			card: { path: 'shots/Shot 1-4.bhnode', kind: 'file', x: 860, y: 50, width: 720, height: 405 },
			original: true,
			written: ['/work/shots/Shot 1-4.bhnode']
		});
	});

	test('a sibling of a node without a card row gets no row of its own, and a sibling of a sibling takes the next number', async () => {
		const harness = await createHarness(disposables, { [SHOT]: videoNode(1) });
		const sibling = await harness.store.createSibling(harness.resource(SHOT), { prompt: '' }, []);
		const next = await harness.store.createSibling(sibling, { prompt: '' }, []);
		assert.deepStrictEqual(
			[sibling.path, (await harness.readNode('shots/Shot 1-2.bhnode')).title, next.path, (await harness.readNode('shots/Shot 1-3.bhnode')).title, await harness.canvasMirror.readCanvas(shotsFolder())],
			['/work/shots/Shot 1-2.bhnode', 'Shot 1 2', '/work/shots/Shot 1-3.bhnode', 'Shot 1 3', null]
		);
	});

	test('names the file of a generated video by the node and the task, inside the output tree', async () => {
		const harness = await createHarness(disposables, { [SHOT]: videoNode(1) });
		const snapshot = await harness.store.read(harness.resource(SHOT));
		assert.strictEqual(harness.store.videoTarget(snapshot, '20261015T080000-k3f9').path, `/work/outputs/${baseHalfNodeTestId(1)}/20261015T080000-k3f9.mp4`);
		assert.throws(() => harness.store.videoTarget(snapshot, '../escape'), /can't name a file/);
		assert.throws(() => harness.store.videoTarget(snapshot, 'a:b'), /can't name a file/);
	});
});
