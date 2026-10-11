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
import { IFileService } from '../../../../platform/files/common/files.js';
import { FileService } from '../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { testWorkspace } from '../../../../platform/workspace/test/common/testWorkspace.js';
import { IFileQuery, ISearchComplete } from '../../../services/search/common/search.js';
import { TestContextService } from '../../../test/common/workbenchTestServices.js';
import { BaseHalfMovedItemsService, IBaseHalfMovedItemsTiming } from '../../common/basehalfMovedItemsService.js';

const folder = URI.file('/work');
const storage = URI.file('/storage');
const timing: IBaseHalfMovedItemsTiming = { quietMs: 30, maxWaitMs: 300, windowMs: 400, saveMs: 10 };
const PDF = '%PDF\u0000';

function note(count: number, changed: readonly number[] = []): string {
	return Array.from({ length: count }, (_, index) => changed.includes(index)
		? `Rewritten sentence number ${index} says something else entirely now.`
		: `Sentence number ${index} of the note stays exactly as it was.`).join('\n');
}

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

suite('BaseHalfMovedItemsService', () => {
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

	/** Gives a file a card: a description under `.bh/mirror/<path>/`. */
	async function describe(fileService: IFileService, path: string, kind: 'file' | 'folder' = 'file'): Promise<void> {
		await fileService.writeFile(joinPath(folder, '.bh', 'mirror', ...path.split('/'), 'badge.yaml'), VSBuffer.fromString(`path: "${path}"\nkind: ${kind}\ndescription: "About ${path}"\n`));
	}

	function start(fileService: FileService) {
		const service = disposables.add(new BaseHalfMovedItemsService(
			timing,
			fileService,
			new AllFilesSearch(fileService),
			new TestContextService(testWorkspace(folder)),
			{ workspaceStorageHome: storage },
			{ readCanvas: async () => null },
			{ getState: () => 'ready', getStores: () => [], onDidChange: Event.None },
			new NullLogService()
		));
		const recognized: string[] = [];
		const comparing: boolean[] = [];
		disposables.add(service.onDidRecognize(event => recognized.push(...event.moves.map(move => `${move.from} -> ${move.to} [${move.kind}, ${move.rule}]`))));
		disposables.add(service.onDidChangeComparing(() => comparing.push(service.isComparing(folder))));
		return { service, recognized, comparing };
	}

	const resource = (path: string) => joinPath(folder, ...path.split('/'));
	/** Long enough for the events of the in-memory file system, the quiet period, and the comparison. */
	const settle = () => timeout(timing.quietMs * 4);

	async function filesBelow(fileService: IFileService, root: URI): Promise<string[]> {
		const out: string[] = [];
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
					out.push(getRelativePath(root, child.resource)!);
				}
			}
		}
		return out.sort();
	}

	test('a first look takes a snapshot outside the workspace folder and recognizes nothing', async () => {
		const fileService = await createFiles({ 'papers/x.pdf': `${PDF}body`, 'notes/plan.md': note(4) });
		await describe(fileService, 'papers/x.pdf');
		const before = await filesBelow(fileService, folder);
		const { service, recognized, comparing } = start(fileService);
		const duringOpen = service.isComparing(folder);
		await service.whenCompared(folder);
		await timeout(timing.saveMs * 4);

		const stored = await filesBelow(fileService, storage);
		const snapshot = JSON.parse((await fileService.readFile(joinPath(storage, stored[0]))).value.toString());
		assert.deepStrictEqual({
			recognized,
			comparing: [duringOpen, service.isComparing(folder), comparing],
			workspaceUnchanged: (await filesBelow(fileService, folder)).join() === before.join(),
			storedFiles: stored.length,
			paths: [...snapshot.paths].sort(),
			followed: snapshot.followed,
			fingerprinted: Object.keys(snapshot.fingerprints)
		}, {
			recognized: [],
			comparing: [true, false, [false]],
			workspaceUnchanged: true,
			storedFiles: 1,
			// What is under `.bh/` is not an item.
			paths: ['notes/plan.md', 'papers/x.pdf'],
			followed: { 'papers/x.pdf': 'file' },
			fingerprinted: ['papers/x.pdf']
		});
	});

	test('a file that was renamed, or renamed and edited, while BaseHalf was closed is recognized at open, and its relocation stays pending until it is reported done', async () => {
		const fileService = await createFiles({ 'papers/x.pdf': `${PDF}body`, 'notes/research.md': note(9), 'notes/other.md': note(3, [0, 1, 2]) });
		await describe(fileService, 'papers/x.pdf');
		await describe(fileService, 'notes/research.md');
		const first = start(fileService);
		await first.service.whenCompared(folder);
		await timeout(timing.saveMs * 4);
		first.service.dispose();

		await fileService.move(resource('papers/x.pdf'), resource('papers/renamed.pdf'));
		await fileService.del(resource('notes/research.md'));
		await fileService.writeFile(resource('notes/survey.md'), VSBuffer.fromString(note(9, [1, 4, 7])));

		const second = start(fileService);
		await second.service.whenCompared(folder);
		const pending = second.service.getPendingMoves(folder).map(move => move.to);
		await timeout(timing.saveMs * 4);
		second.service.dispose();

		// Closed again before relocation finished: the moves are handed out again.
		const third = start(fileService);
		await third.service.whenCompared(folder);
		const again = [...third.recognized];
		for (const move of third.service.getPendingMoves(folder)) {
			third.service.acceptRelocated(folder, move, 'done');
		}

		assert.deepStrictEqual({ recognized: second.recognized, pending, again, afterDone: third.service.getPendingMoves(folder) }, {
			recognized: ['notes/research.md -> notes/survey.md [file, similarContent]', 'papers/x.pdf -> papers/renamed.pdf [file, sameContent]'],
			pending: ['notes/survey.md', 'papers/renamed.pdf'],
			again: ['notes/research.md -> notes/survey.md [file, similarContent]', 'papers/x.pdf -> papers/renamed.pdf [file, sameContent]'],
			afterDone: []
		});
	});

	test('while BaseHalf runs, a rename is recognized after the quiet period, also when the file is edited right after it', async () => {
		const fileService = await createFiles({ 'papers/x.pdf': `${PDF}body`, 'notes/research.md': note(9) });
		await describe(fileService, 'papers/x.pdf');
		await describe(fileService, 'notes/research.md');
		const { service, recognized, comparing } = start(fileService);
		await service.whenCompared(folder);

		await fileService.move(resource('papers/x.pdf'), resource('archive/x-2026.pdf'));
		await fileService.move(resource('notes/research.md'), resource('notes/survey.md'));
		await fileService.writeFile(resource('notes/survey.md'), VSBuffer.fromString(note(9, [2, 5])));
		await settle();

		// Moved back: recognized like any other move.
		await fileService.move(resource('archive/x-2026.pdf'), resource('papers/x.pdf'));
		await settle();

		assert.deepStrictEqual({ recognized, comparing }, {
			recognized: [
				'notes/research.md -> notes/survey.md [file, similarContent]',
				'papers/x.pdf -> archive/x-2026.pdf [file, sameContent]',
				'archive/x-2026.pdf -> papers/x.pdf [file, sameContent]'
			],
			// After the look at open: on from the removal until the comparison has finished, twice.
			comparing: [false, true, false, true, false]
		});
	});

	test('a file that is renamed to a backup name and written again has not moved, and a file that is copied before the original is deleted has', async () => {
		const fileService = await createFiles({ 'report.pdf': `${PDF}first`, 'plan.md': note(6) });
		await describe(fileService, 'report.pdf');
		await describe(fileService, 'plan.md');
		const { service, recognized } = start(fileService);
		await service.whenCompared(folder);

		await fileService.move(resource('report.pdf'), resource('report-old.pdf'));
		await timeout(timing.quietMs / 3);
		await fileService.writeFile(resource('report.pdf'), VSBuffer.fromString(`${PDF}second, longer`));
		await settle();
		const backup = [...recognized];

		await fileService.copy(resource('plan.md'), resource('plan-final.md'));
		await settle();
		await fileService.del(resource('plan.md'));
		await settle();

		assert.deepStrictEqual({ backup, copyThenDelete: recognized }, {
			backup: [],
			copyThenDelete: ['plan.md -> plan-final.md [file, sameContent]']
		});
	});

	test('a note that is deleted is not paired with a note that appears after its window', async () => {
		const fileService = await createFiles({ 'a.md': note(6) });
		await describe(fileService, 'a.md');
		const { service, recognized } = start(fileService);
		await service.whenCompared(folder);

		await fileService.del(resource('a.md'));
		await timeout(timing.windowMs + timing.quietMs * 4);
		await fileService.writeFile(resource('b.md'), VSBuffer.fromString(note(6)));
		await settle();
		// Written again inside the window, it is.
		await describe(fileService, 'b.md');
		await service.compare(folder);
		await fileService.del(resource('b.md'));
		await settle();
		await fileService.writeFile(resource('c.md'), VSBuffer.fromString(note(6)));
		await settle();

		assert.deepStrictEqual(recognized, ['b.md -> c.md [file, sameContent]']);
	});

	test('a renamed folder is one move, whether its files have cards or not, and files moved out one by one take the folder with them', async () => {
		const fileService = await createFiles({ 'old/a.pdf': `${PDF}a`, 'old/sub/one.md': note(6), 'old/sub/two.md': note(6, [0]), 'keep/k.md': note(2) });
		await describe(fileService, 'old', 'folder');
		const { service, recognized } = start(fileService);
		await service.whenCompared(folder);

		// One event for the folder: its files have none of their own.
		await fileService.move(resource('old'), resource('new'));
		await settle();
		const renamed = [...recognized];

		await fileService.move(resource('new/a.pdf'), resource('next/a.pdf'));
		await settle();
		await fileService.move(resource('new/sub/one.md'), resource('next/sub/one.md'));
		await fileService.move(resource('new/sub/two.md'), resource('next/sub/two.md'));
		await settle();
		await fileService.del(resource('new'), { recursive: true });
		await settle();

		assert.deepStrictEqual({ renamed, oneByOne: recognized.slice(renamed.length) }, {
			renamed: ['old -> new [folder, folderFiles]'],
			oneByOne: ['new -> next [folder, folderFiles]']
		});
	});

	test('a move or a delete through the workbench is not a comparison, and a marked folder is never looked at', async () => {
		const fileService = await createFiles({ 'a.md': note(5), 'b.md': note(5, [0]) });
		await describe(fileService, 'a.md');
		await describe(fileService, 'b.md');
		const { service, recognized } = start(fileService);
		await service.whenCompared(folder);

		await fileService.move(resource('a.md'), resource('moved.md'));
		service.acceptWorkbenchMove(folder, 'a.md', 'moved.md');
		await fileService.del(resource('b.md'));
		service.acceptWorkbenchDelete(folder, 'b.md');
		await fileService.writeFile(resource('later.md'), VSBuffer.fromString(note(5, [0])));
		await settle();
		service.dispose();

		const markedFiles = await createFiles({ 'a.md': note(5), '.basehalf-no-workspace-setup': '' });
		await describe(markedFiles, 'a.md');
		const marked = start(markedFiles);
		await marked.service.whenCompared(folder);
		await markedFiles.move(resource('a.md'), resource('b.md'));
		await settle();
		await timeout(timing.saveMs * 4);

		assert.deepStrictEqual({ recognized, marked: marked.recognized, markedStored: await filesBelow(markedFiles, storage) }, {
			recognized: [],
			marked: [],
			markedStored: []
		});
	});
});
