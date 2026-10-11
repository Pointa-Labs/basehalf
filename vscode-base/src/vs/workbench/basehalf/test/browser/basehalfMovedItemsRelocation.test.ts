/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { timeout } from '../../../../base/common/async.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Event } from '../../../../base/common/event.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { joinPath, relativePath as getRelativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { FileService } from '../../../../platform/files/common/fileService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { InMemoryFileSystemProvider } from '../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { testWorkspace } from '../../../../platform/workspace/test/common/testWorkspace.js';
import { IFileQuery, ISearchComplete } from '../../../services/search/common/search.js';
import { workbenchInstantiationService } from '../../../test/browser/workbenchTestServices.js';
import { TestContextService } from '../../../test/common/workbenchTestServices.js';
import { BaseHalfMirrorCascadeContribution } from '../../browser/basehalfMirrorCascade.contribution.js';
import { IBaseHalfNodeExecutionService } from '../../browser/basehalfNodeExecutionService.js';
import { IBaseHalfPluginStructuralDeleteCleanupService } from '../../browser/basehalfPluginStructuralDeleteCleanup.js';
import { BaseHalfAdhdMirrorService, IBaseHalfAdhdMirrorService } from '../../common/basehalfAdhdMirror.js';
import { BaseHalfBadgeMirrorService, IBaseHalfBadgeMirrorService } from '../../common/basehalfBadgeMirror.js';
import { BaseHalfCanvasMirrorService, IBaseHalfCanvasMirrorService } from '../../common/basehalfCanvasMirror.js';
import { IBaseHalfCanvasNavigationService } from '../../common/basehalfCanvasNavigation.js';
import { IBaseHalfCanvasViewportStateService } from '../../common/basehalfCanvasViewportState.js';
import { BaseHalfEditorFlushService, IBaseHalfEditorFlushService } from '../../common/basehalfEditorFlush.js';
import { BaseHalfMovedItemsService, IBaseHalfMovedItemsService, IBaseHalfMovedItemsTiming } from '../../common/basehalfMovedItemsService.js';
import { BaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceMutationCoordinator } from '../../common/basehalfWorkspaceMutation.js';

const folder = URI.file('/work');
const timing: IBaseHalfMovedItemsTiming = { quietMs: 30, maxWaitMs: 300, windowMs: 400, saveMs: 10 };
const PDF = '%PDF\u0000';

const badge = (path: string, description: string, extra = '') => `path: "${path}"\nkind: file\ndescription: "${description}"\n${extra}`;
const row = (path: string, x: number) => [`  - path: "${path}"`, '    kind: file', `    x: ${x}`, '    y: 20', '    width: 260', '    height: 140'];
/** A layout file as BaseHalf writes it. */
const canvas = (path: string, cards: string[][]) => [`path: "${path}"`, ...(cards.length ? ['cards:', ...cards.flat()] : ['cards: []']), 'edges: []', ''].join('\n');

/** File search that returns every file of the in-memory file system. */
class AllFilesSearch {
	constructor(private readonly fileService: IFileService) { }

	async fileSearch(query: IFileQuery): Promise<ISearchComplete> {
		const results: { resource: URI }[] = [];
		const stack = query.folderQueries.map(folderQuery => folderQuery.folder);
		while (stack.length) {
			let stat;
			try {
				stat = await this.fileService.resolve(stack.pop()!);
			} catch {
				continue;
			}
			for (const child of stat.children ?? []) {
				if (child.isDirectory) {
					stack.push(child.resource);
				} else {
					results.push({ resource: child.resource });
				}
			}
		}
		return { results, limitHit: false, messages: [] };
	}
}

suite('BaseHalfMovedItems (relocation)', () => {
	const disposables = new DisposableStore();
	teardown(() => disposables.clear());
	ensureNoDisposablesAreLeakedInTestSuite();

	async function createFiles(files: Record<string, string>): Promise<FileService> {
		const fileService = disposables.add(new FileService(new NullLogService()));
		disposables.add(fileService.registerProvider(Schemas.file, disposables.add(new InMemoryFileSystemProvider())));
		await fileService.createFolder(folder);
		for (const [path, content] of Object.entries(files)) {
			await fileService.writeFile(joinPath(folder, ...path.split('/')), VSBuffer.fromString(content));
		}
		return fileService;
	}

	/** BaseHalf opens on the files: the snapshot service and the cascade that relocates. */
	async function open(fileService: FileService) {
		const session = disposables.add(new DisposableStore());
		const instantiationService = workbenchInstantiationService({ fileService: () => fileService }, session);
		const contextService = new TestContextService(testWorkspace(folder));
		instantiationService.stub(IWorkspaceContextService, contextService);
		instantiationService.stub(IBaseHalfEditorFlushService, new BaseHalfEditorFlushService());
		instantiationService.stub(IBaseHalfWorkspaceMutationCoordinator, new BaseHalfWorkspaceMutationCoordinator());
		instantiationService.stub(IBaseHalfCanvasNavigationService, { state: { canvasFolder: undefined, cardDetail: undefined }, activeCanvasEditor: undefined } as Partial<IBaseHalfCanvasNavigationService> as IBaseHalfCanvasNavigationService);
		instantiationService.stub(IBaseHalfAdhdMirrorService, session.add(instantiationService.createInstance(BaseHalfAdhdMirrorService)));
		instantiationService.stub(IBaseHalfBadgeMirrorService, session.add(new BaseHalfBadgeMirrorService(fileService)));
		const canvasMirror = session.add(instantiationService.createInstance(BaseHalfCanvasMirrorService));
		instantiationService.stub(IBaseHalfCanvasMirrorService, canvasMirror);
		instantiationService.stub(IBaseHalfCanvasViewportStateService, { forgetSubtree: () => { }, moveSubtree: () => { } } as Partial<IBaseHalfCanvasViewportStateService> as IBaseHalfCanvasViewportStateService);
		instantiationService.stub(IBaseHalfNodeExecutionService, { onDidChange: Event.None, getActiveRun: () => undefined, acquireStructuralOperation: async () => ({ dispose: () => { } }) } as Partial<IBaseHalfNodeExecutionService> as IBaseHalfNodeExecutionService);
		instantiationService.stub(IBaseHalfPluginStructuralDeleteCleanupService, { stageDelete: async () => [] } as Partial<IBaseHalfPluginStructuralDeleteCleanupService> as IBaseHalfPluginStructuralDeleteCleanupService);
		const movedItems = session.add(new BaseHalfMovedItemsService(
			timing,
			fileService,
			new AllFilesSearch(fileService),
			contextService,
			{ workspaceStorageHome: URI.file('/storage') },
			canvasMirror,
			{ getState: () => 'ready', getStores: () => [], onDidChange: Event.None },
			new NullLogService()
		));
		instantiationService.stub(IBaseHalfMovedItemsService, movedItems);
		session.add(instantiationService.createInstance(BaseHalfMirrorCascadeContribution));
		await movedItems.whenCompared(folder);
		await settle();
		return { movedItems, close: () => session.dispose() };
	}

	const resource = (path: string) => joinPath(folder, ...path.split('/'));
	/** Long enough for the file events, the quiet period, the comparison, and the relocation. */
	const settle = () => timeout(timing.quietMs * 6);

	/** The files under `.bh/`, with their text. */
	async function hidden(fileService: IFileService): Promise<Record<string, string>> {
		const out: Record<string, string> = {};
		const root = joinPath(folder, '.bh');
		const stack = [root];
		while (stack.length) {
			let stat;
			try {
				stat = await fileService.resolve(stack.pop()!);
			} catch {
				continue;
			}
			for (const child of stat.children ?? []) {
				if (child.isDirectory) {
					stack.push(child.resource);
				} else {
					out[getRelativePath(root, child.resource)!] = (await fileService.readFile(child.resource)).value.toString();
				}
			}
		}
		return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a < b ? -1 : 1));
	}

	test('a described and placed file that is renamed outside keeps its description, its appearance, its kept list, and its place, while BaseHalf runs and at open', async () => {
		const files = {
			'papers/x.pdf': `${PDF}body`,
			'notes/plan.md': '# Plan\n',
			'.bh/mirror/papers/x.pdf/badge.yaml': badge('papers/x.pdf', 'The paper we build on.'),
			'.bh/mirror/papers/x.pdf/appearance.yaml': 'color: "blue"\n',
			'.bh/mirror/papers/x.pdf/upstream.yaml': 'upstream:\n  - notes/plan.md\n',
			'.bh/mirror/papers/canvas.yaml': canvas('papers', [row('papers/x.pdf', 10)])
		};
		const expected = (name: string) => ({
			[`mirror/papers/${name}/appearance.yaml`]: 'color: "blue"\n',
			[`mirror/papers/${name}/badge.yaml`]: badge(`papers/${name}`, 'The paper we build on.'),
			[`mirror/papers/${name}/upstream.yaml`]: 'upstream:\n  - notes/plan.md\n',
			'mirror/papers/canvas.yaml': canvas('papers', [row(`papers/${name}`, 10)])
		});

		const running = await createFiles(files);
		const session = await open(running);
		await running.move(resource('papers/x.pdf'), resource('papers/renamed.pdf'));
		await settle();
		const whileRunning = await hidden(running);
		const pending = session.movedItems.getPendingMoves(folder);
		session.close();

		// Renamed again while no window is open.
		await running.move(resource('papers/renamed.pdf'), resource('papers/final.pdf'));
		await open(running);

		assert.deepStrictEqual({ whileRunning, pending, atOpen: await hidden(running) }, {
			// Nothing is left under the old name, not even an empty folder.
			whileRunning: expected('renamed.pdf'),
			pending: [],
			// Followed before the sweep at open: the badge has no orphan mark.
			atOpen: expected('final.pdf')
		});
	});

	test('nothing at the new path is replaced, an orphan badge there gives way with a recovery copy, and a folder takes everything below it along', async () => {
		const fileService = await createFiles({
			'a.md': 'The first note, with enough text to be told apart.\n',
			'd.md': 'The fourth note, also long enough to be told apart.\n',
			'old/inner.pdf': `${PDF}inner`,
			'old/sub/deep.md': 'A note deep inside the folder that is renamed.\n',
			'.bh/mirror/a.md/badge.yaml': badge('a.md', 'About a.'),
			'.bh/mirror/d.md/badge.yaml': badge('d.md', 'About d.'),
			// A file that was deleted long ago still has its description.
			'.bh/mirror/gone.md/badge.yaml': badge('gone.md', 'About a file that is gone.'),
			'.bh/mirror/old/badge.yaml': 'path: "old"\nkind: folder\ndescription: "The folder."\n',
			'.bh/mirror/old/canvas.yaml': canvas('old', [row('old/inner.pdf', 5)]),
			'.bh/mirror/old/sub/deep.md/badge.yaml': badge('old/sub/deep.md', 'Deep.'),
			'.bh/mirror/canvas.yaml': canvas('', [row('a.md', 1), row('old', 2)])
		});
		const session = await open(fileService);
		const orphanMarked = (await hidden(fileService))['mirror/gone.md/badge.yaml'].includes('orphan: true');

		// The user describes the new card before BaseHalf has compared: that description stays.
		await fileService.move(resource('a.md'), resource('c.md'));
		await fileService.writeFile(joinPath(folder, '.bh', 'mirror', 'c.md', 'badge.yaml'), VSBuffer.fromString(badge('c.md', 'Written for c.')));
		await fileService.move(resource('d.md'), resource('gone.md'));
		await fileService.move(resource('old'), resource('new'));
		await settle();
		const after = await hidden(fileService);
		const recovered = Object.keys(after).filter(path => path.startsWith('cache/recovered/'));

		assert.deepStrictEqual({
			orphanMarked,
			pending: session.movedItems.getPendingMoves(folder),
			settled: session.movedItems.isSettled(folder),
			taken: [after['mirror/c.md/badge.yaml'], after['mirror/a.md/badge.yaml']],
			rootCanvas: after['mirror/canvas.yaml'],
			orphanGaveWay: [after['mirror/gone.md/badge.yaml'], after['mirror/d.md/badge.yaml'], recovered.length, recovered.map(path => after[path])],
			folder: Object.fromEntries(Object.entries(after).filter(([path]) => path.startsWith('mirror/new/') || path.startsWith('mirror/old/')))
		}, {
			orphanMarked: true,
			pending: [],
			settled: true,
			// c keeps what the user wrote, and a's description is still where it was.
			taken: [badge('c.md', 'Written for c.'), badge('a.md', 'About a.')],
			// The row of `a.md` had a free place at `c.md`; the folder's row follows its folder.
			rootCanvas: canvas('', [row('c.md', 1), row('new', 2)]),
			orphanGaveWay: [badge('gone.md', 'About d.'), undefined, 1, [badge('gone.md', 'About a file that is gone.', 'orphan: true\n')]],
			folder: {
				'mirror/new/badge.yaml': 'path: "new"\nkind: folder\ndescription: "The folder."\n',
				'mirror/new/canvas.yaml': canvas('new', [row('new/inner.pdf', 5)]),
				'mirror/new/sub/deep.md/badge.yaml': badge('new/sub/deep.md', 'Deep.'),
				// The empty layout that retirement leaves; it is not card information.
				'mirror/old/canvas.yaml': canvas('old', [])
			}
		});
	});
});
