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
import { IBaseHalfMovedItem } from '../../common/basehalfMovedItems.js';
import { IBaseHalfReferenceIndexService } from '../../common/basehalfReferenceIndex.js';
import { baseHalfComposeOwedEntryMoves, BaseHalfMovedItemsService, IBaseHalfMovedItemsTiming } from '../../common/basehalfMovedItemsService.js';

const folder = URI.file('/work');
const storage = URI.file('/storage');
const timing: IBaseHalfMovedItemsTiming = { quietMs: 30, maxWaitMs: 300, windowMs: 400, saveMs: 10 };
const PDF = '%PDF\u0000';

function note(count: number, changed: readonly number[] = []): string {
	// Every line has words of its own, so the share of lines that changed is the share of the content.
	return Array.from({ length: count }, (_, index) => changed.includes(index)
		? `rewritten${index} differently${index} worded${index} entirely${index}`
		: `sentence${index} unchanged${index} original${index} wording${index}`).join('\n');
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

	/**
	 * With `relocates`, the card information of a recognized item is moved to
	 * its new path and reported as relocated, as the cascade does when nothing
	 * holds it back.
	 */
	function start(fileService: FileService, relocates = false, named: () => readonly string[] = () => []) {
		const service = disposables.add(new BaseHalfMovedItemsService(
			timing,
			fileService,
			new AllFilesSearch(fileService),
			new TestContextService(testWorkspace(folder)),
			{ workspaceStorageHome: storage },
			{ readCanvas: async () => null },
			// The entries the reference index knows: the items that `named` lists.
			{ getState: () => 'ready', getStores: () => [{ read: { items: named().map(path => ({ path })) } }] as unknown as ReturnType<IBaseHalfReferenceIndexService['getStores']>, onDidChange: Event.None },
			new NullLogService()
		));
		const recognized: string[] = [];
		const comparing: boolean[] = [];
		disposables.add(service.onDidRecognize(event => {
			recognized.push(...event.moves.map(move => `${move.from} -> ${move.to} [${move.kind}, ${move.rule}]`));
			if (relocates) {
				void relocate(event.moves);
			}
		}));
		const mirror = (path: string) => joinPath(folder, '.bh', 'mirror', ...path.split('/'));
		const relocate = async (moves: readonly IBaseHalfMovedItem[]) => {
			for (const move of moves) {
				// File by file: card information of an item below may already be at the new path.
				for (const file of await filesBelow(fileService, mirror(move.from))) {
					await fileService.move(joinPath(mirror(move.from), ...file.split('/')), joinPath(mirror(move.to), ...file.split('/')), true);
				}
				if (await fileService.exists(mirror(move.from))) {
					await fileService.del(mirror(move.from), { recursive: true });
				}
				service.acceptRelocated(folder, move, 'done');
			}
		};
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
		const { service, recognized, comparing } = start(fileService, true);
		await service.whenCompared(folder);

		await fileService.move(resource('papers/x.pdf'), resource('archive/x-2026.pdf'));
		await fileService.move(resource('notes/research.md'), resource('notes/survey.md'));
		await fileService.writeFile(resource('notes/survey.md'), VSBuffer.fromString(note(9, [2, 5])));
		await settle();

		// Moved back: recognized like any other move.
		await fileService.move(resource('archive/x-2026.pdf'), resource('papers/x.pdf'));
		await settle();

		assert.deepStrictEqual({ recognized, comparing }, {
			// One comparison for both: the PDF by the same content, the note, edited by then, by what is left of it.
			recognized: [
				'notes/research.md -> notes/survey.md [file, similarContent]',
				'papers/x.pdf -> archive/x-2026.pdf [file, sameContent]',
				'archive/x-2026.pdf -> papers/x.pdf [file, sameContent]'
			],
			// After the look at open: on from the removal until the comparison has finished, twice.
			comparing: [false, true, false, true, false]
		});
	});

	test('an item that gets its card while BaseHalf runs is followed from then on', async () => {
		const fileService = await createFiles({ 'paper.pdf': `${PDF}body` });
		const { service, recognized } = start(fileService);
		await service.whenCompared(folder);

		// Not followed yet: a rename is nothing BaseHalf has to act on.
		await fileService.move(resource('paper.pdf'), resource('paper-1.pdf'));
		await settle();
		const before = [...recognized];

		await describe(fileService, 'paper-1.pdf');
		await settle();
		await fileService.move(resource('paper-1.pdf'), resource('paper-2.pdf'));
		await settle();

		assert.deepStrictEqual({ before, after: recognized }, { before: [], after: ['paper-1.pdf -> paper-2.pdf [file, sameContent]'] });
	});

	test('a note that is renamed and then rewritten completely while BaseHalf runs is paired at the rename', async () => {
		const fileService = await createFiles({ 'notes/research.md': note(9) });
		await describe(fileService, 'notes/research.md');
		const { service, recognized } = start(fileService);
		await service.whenCompared(folder);

		await fileService.move(resource('notes/research.md'), resource('notes/survey.md'));
		// The events of the rename arrive, and the rewrite lands before the folder has been quiet.
		await timeout(timing.quietMs / 2);
		await fileService.writeFile(resource('notes/survey.md'), VSBuffer.fromString(note(9, [0, 1, 2, 3, 4, 5, 6, 7, 8])));
		await settle();

		assert.deepStrictEqual(recognized, ['notes/research.md -> notes/survey.md [file, sameContent]']);
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

	test('a similar file that an earlier comparison saw next to the file is not its new place, and an edited copy in the same step is', async () => {
		// Two files that differ in one value, as two frames from one generator do.
		const frame = (fill: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="${fill}"/><text x="40" y="80">smoke frame</text></svg>\n`;
		const fileService = await createFiles({ 'keep.md': note(3) });
		const { service, recognized } = start(fileService);
		await service.whenCompared(folder);

		await fileService.writeFile(resource('shots/start.svg'), VSBuffer.fromString(frame('blue')));
		await fileService.writeFile(resource('shots/end.svg'), VSBuffer.fromString(frame('rose')));
		await describe(fileService, 'shots/start.svg');
		await describe(fileService, 'shots/end.svg');
		await settle();
		// One of the two is deleted, well inside the window in which a copy would still count.
		await fileService.del(resource('shots/start.svg'));
		await settle();
		const deletedLater = [...recognized];

		// A note is saved under a new name with changes, and the old one is removed, in one step.
		await fileService.writeFile(resource('plan.md'), VSBuffer.fromString(note(8)));
		await describe(fileService, 'plan.md');
		await settle();
		await timeout(timing.windowMs);
		await fileService.writeFile(resource('plan-2027.md'), VSBuffer.fromString(note(8, [3])));
		await fileService.del(resource('plan.md'));
		await settle();

		assert.deepStrictEqual({ deletedLater, sameStep: recognized }, {
			deletedLater: [],
			sameStep: ['plan.md -> plan-2027.md [file, similarContent]']
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
		// Two of its files have cards of their own, one has none.
		await describe(fileService, 'old/a.pdf');
		await describe(fileService, 'old/sub/one.md');
		const { service, recognized } = start(fileService, true);
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
			// One pair for the folder, not one for every file with a card in it.
			renamed: ['old -> new [folder, folderFiles]'],
			// A file with a card of its own follows when it leaves; the folder follows when it is gone.
			oneByOne: ['new/a.pdf -> next/a.pdf [file, sameContent]', 'new/sub/one.md -> next/sub/one.md [file, sameContent]', 'new -> next [folder, folderFiles]']
		});
	});

	test('what a file held when it appeared is paired as any same content is: among copies the name decides, and a rename through a temporary name is followed', async () => {
		const fileService = await createFiles({ 'x/doc.md': note(5, [1]), 'y/other.md': note(5, [2]), 'n.md': note(7) });
		for (const path of ['x/doc.md', 'y/other.md', 'n.md']) {
			await describe(fileService, path);
		}
		const { service, recognized } = start(fileService, true);
		await service.whenCompared(folder);

		// Two copies appear and the original is deleted, in one step: the file name decides.
		await fileService.copy(resource('x/doc.md'), resource('p/renamed.md'));
		await fileService.copy(resource('x/doc.md'), resource('q/doc.md'));
		await fileService.del(resource('x/doc.md'));
		await settle();
		const named = recognized.splice(0);

		// Without a name to decide nothing is paired, and not as mostly the same content either.
		await fileService.copy(resource('y/other.md'), resource('p/one.md'));
		await fileService.copy(resource('y/other.md'), resource('q/two.md'));
		await fileService.del(resource('y/other.md'));
		await settle();
		const unnamed = recognized.splice(0);

		// Renamed through a temporary name and then rewritten, before the folder was quiet.
		await fileService.move(resource('n.md'), resource('n.tmp.md'));
		await timeout(timing.quietMs / 2);
		await fileService.move(resource('n.tmp.md'), resource('m.md'));
		await timeout(timing.quietMs / 2);
		await fileService.writeFile(resource('m.md'), VSBuffer.fromString(note(7, [0, 1, 2, 3, 4, 5, 6])));
		await settle();

		assert.deepStrictEqual({ named, unnamed, viaTemporary: recognized }, {
			named: ['x/doc.md -> q/doc.md [file, sameContent]'],
			unnamed: [],
			viaTemporary: ['n.md -> m.md [file, sameContent]']
		});
	});

	test('an item that moves again before its card information has followed it is still one pair', async () => {
		const fileService = await createFiles({ 'a.md': note(6), 'b.md': note(4, [0]), 'old/x.md': note(6, [1]), 'old/y.md': note(6, [2]), 'old/z.md': note(6, [3]) });
		for (const path of ['a.md', 'b.md', 'old/x.md']) {
			await describe(fileService, path);
		}
		await describe(fileService, 'old', 'folder');
		const { service } = start(fileService);
		await service.whenCompared(folder);
		const pending = () => service.getPendingMoves(folder).map(move => `${move.from} -> ${move.to}`);

		// Relocation finds the new path gone after the events of the next rename have arrived.
		await fileService.move(resource('a.md'), resource('tmp.md'));
		await settle();
		const first = service.getPendingMoves(folder)[0];
		await fileService.move(resource('tmp.md'), resource('c.md'));
		await timeout(timing.quietMs / 2);
		service.acceptRelocated(folder, first, 'gone');
		const waiting = pending();
		await settle();
		const foundAgain = pending();
		service.acceptRelocated(folder, service.getPendingMoves(folder)[0], 'done');

		// A file below a folder whose relocation is pending moves out of it.
		await fileService.move(resource('old'), resource('new'));
		await settle();
		await fileService.move(resource('new/x.md'), resource('elsewhere/x.md'));
		await settle();
		const belowPendingFolder = pending();
		for (const move of service.getPendingMoves(folder)) {
			service.acceptRelocated(folder, move, 'done');
		}

		// The item of a pending pair is renamed through the workbench.
		await fileService.move(resource('b.md'), resource('b2.md'));
		await settle();
		const beforeWorkbench = service.getPendingMoves(folder)[0];
		await fileService.move(resource('b2.md'), resource('b3.md'));
		service.acceptWorkbenchMove(folder, 'b2.md', 'b3.md');
		const throughWorkbench = pending();
		// The relocation to the first new path was on its way, and reports now.
		service.acceptRelocated(folder, beforeWorkbench, 'done');
		await settle();

		assert.deepStrictEqual({ waiting, foundAgain, belowPendingFolder, throughWorkbench, relocatedMeanwhile: pending() }, {
			waiting: ['a.md -> tmp.md'],
			foundAgain: ['a.md -> c.md'],
			// Its card information is still below the folder's old path, and goes first.
			belowPendingFolder: ['old/x.md -> elsewhere/x.md', 'old -> new'],
			throughWorkbench: ['b.md -> b3.md'],
			// The card information reached the first new path: the pair starts there.
			relocatedMeanwhile: ['b2.md -> b3.md']
		});
	});

	test('a path that names an item again is that item, an item that moved twice is where it ended, and a listing pairs nothing that left the lists', async () => {
		const fileService = await createFiles({ 'a.md': note(6), 'gone.md': note(5, [0]), 'named.md': note(4, [1]) });
		await describe(fileService, 'a.md');
		await describe(fileService, 'gone.md');
		// An entry names it, and it has no card files: the entry stays as it is, as in a store that cannot be written.
		const { service, recognized } = start(fileService, true, () => ['named.md']);
		await service.whenCompared(folder);

		await fileService.move(resource('a.md'), resource('b.md'));
		await settle();
		const once = service.resolveMovedPath(folder, 'a.md');
		await fileService.move(resource('b.md'), resource('c.md'));
		await settle();
		const twice = service.resolveMovedPath(folder, 'a.md');
		// A new file takes the first name.
		await fileService.writeFile(resource('a.md'), VSBuffer.fromString(note(3, [2])));
		await settle();
		const takenAgain = service.resolveMovedPath(folder, 'a.md') ?? null;

		// Followed only because an entry names it: it stays followed while that entry is owed.
		recognized.length = 0;
		await fileService.move(resource('named.md'), resource('named-2.md'));
		await settle();
		await describe(fileService, 'c.md');
		await settle();
		await fileService.move(resource('named-2.md'), resource('named-3.md'));
		await settle();
		const namedByAnEntry = recognized.splice(0);

		// A note is deleted. Long after its window a note with its text appears, and the folder is listed at once.
		await fileService.del(resource('gone.md'));
		await settle();
		await timeout(timing.windowMs);
		await fileService.writeFile(resource('later.md'), VSBuffer.fromString(note(5, [0])));
		await service.compare(folder);
		await settle();

		assert.deepStrictEqual({ once, twice, takenAgain, namedByAnEntry, afterItsWindow: recognized, owed: service.getOwedEntryMoves(folder).filter(move => move.from.startsWith('named')) }, {
			once: 'b.md',
			twice: 'c.md',
			takenAgain: null,
			namedByAnEntry: ['named.md -> named-2.md [file, sameContent]', 'named-2.md -> named-3.md [file, sameContent]'],
			afterItsWindow: [],
			// The entry that names the first path leads to the last one.
			owed: [{ from: 'named.md', to: 'named-3.md' }, { from: 'named-2.md', to: 'named-3.md' }]
		});
	});

	test('what is owed for a relocated item is remembered across a restart, and moves compose', async () => {
		const fileService = await createFiles({ 'a.md': note(6) });
		await describe(fileService, 'a.md');
		const first = start(fileService);
		await first.service.whenCompared(folder);
		await fileService.move(resource('a.md'), resource('b.md'));
		await settle();
		const relocated: string[] = [];
		disposables.add(first.service.onDidRelocate(event => relocated.push(...event.moves.map(move => `${move.from} -> ${move.to}`))));
		for (const move of first.service.getPendingMoves(folder)) {
			first.service.acceptRelocated(folder, move, 'done');
		}
		const owedAtOnce = first.service.getOwedEntryMoves(folder);
		await timeout(timing.saveMs * 4);
		first.service.dispose();

		// The window closed before the entries were written: they are still owed.
		const second = start(fileService);
		await second.service.whenCompared(folder);

		assert.deepStrictEqual({
			relocated,
			owedAtOnce,
			afterRestart: second.service.getOwedEntryMoves(folder),
			// After `a` to `b`, a move of `b` to `c` that owes nothing itself still leads `a` to `c`.
			composed: baseHalfComposeOwedEntryMoves([{ from: 'a.md', to: 'b.md' }], [{ from: 'b.md', to: 'c.md' }], false),
			inFolder: baseHalfComposeOwedEntryMoves([{ from: 'x.md', to: 'docs/x.md' }], [{ from: 'docs', to: 'notes' }], true),
			// A file below a folder whose entries are owed is renamed, and its own entries are written.
			belowOwedFolder: baseHalfComposeOwedEntryMoves([{ from: 'docs', to: 'notes' }], [{ from: 'notes/x.md', to: 'notes/y.md' }], false),
			back: baseHalfComposeOwedEntryMoves([{ from: 'a.md', to: 'b.md' }], [{ from: 'b.md', to: 'a.md' }], false),
			written: baseHalfComposeOwedEntryMoves([{ from: 'a.md', to: 'b.md' }], [{ from: 'a.md', to: 'b.md' }], false)
		}, {
			relocated: ['a.md -> b.md'],
			owedAtOnce: [{ from: 'a.md', to: 'b.md' }],
			afterRestart: [{ from: 'a.md', to: 'b.md' }],
			composed: [{ from: 'a.md', to: 'c.md' }],
			inFolder: [{ from: 'x.md', to: 'notes/x.md' }, { from: 'docs', to: 'notes' }],
			// An entry that still names `docs/x.md` leads to where the file is, before the folder's rule applies.
			belowOwedFolder: [{ from: 'docs/x.md', to: 'notes/y.md' }, { from: 'docs', to: 'notes' }],
			back: [],
			written: []
		});
	});

	test('an item whose relocation is pending and that moves again ends at its final path, and one whose new path is gone is paired again', async () => {
		const fileService = await createFiles({ 'a.md': note(6), 'old/x.md': note(4, [0]), 'old/y.md': note(4, [1]) });
		await describe(fileService, 'a.md');
		await describe(fileService, 'old', 'folder');
		const { service, recognized } = start(fileService);
		await service.whenCompared(folder);

		// Held back, then renamed again: one pair, from the first path to the last.
		await fileService.move(resource('a.md'), resource('t.md'));
		await settle();
		service.acceptRelocated(folder, service.getPendingMoves(folder)[0], 'held');
		const settledWhileHeld = service.isSettled(folder);
		await fileService.move(resource('t.md'), resource('b.md'));
		await settle();
		const composed = service.getPendingMoves(folder).map(move => `${move.from} -> ${move.to}`);
		// And back to where it was: its card information never left, nothing is left to do.
		await fileService.move(resource('b.md'), resource('a.md'));
		await settle();
		const movedBack = service.getPendingMoves(folder).map(move => `${move.from} -> ${move.to}`);

		// A folder renamed through a temporary name: relocation finds the first new path gone.
		await fileService.move(resource('old'), resource('tmp'));
		await settle();
		const viaTemporary = service.getPendingMoves(folder).map(move => `${move.from} -> ${move.to}`);
		await fileService.move(resource('tmp'), resource('new'));
		service.acceptRelocated(folder, { from: 'old', to: 'tmp', kind: 'folder', rule: 'folderFiles' }, 'gone');
		await settle();

		assert.deepStrictEqual({ settledWhileHeld, composed, movedBack, viaTemporary, final: service.getPendingMoves(folder).map(move => `${move.from} -> ${move.to}`), recognized: recognized.length > 0 }, {
			// A pair that waits for the user does not keep the canvas waiting.
			settledWhileHeld: true,
			composed: ['a.md -> b.md'],
			movedBack: [],
			viaTemporary: ['old -> tmp'],
			final: ['old -> new'],
			recognized: true
		});
	});

	test('a listing of the folder does not drop what file events just removed, and only what concerns the shown folder holds its canvas', async () => {
		const fileService = await createFiles({ 'docs/a.md': note(6), 'other/keep.md': note(3, [0]), 'area/sub/x.md': note(5, [1]) });
		await describe(fileService, 'docs/a.md');
		await describe(fileService, 'area', 'folder');
		const { service, recognized } = start(fileService, true);
		await service.whenCompared(folder);

		// The folder that is shown, or a folder above it, is what moved: its canvas waits too.
		await fileService.move(resource('area'), resource('zone'));
		await timeout(15);
		const shownFolderMoved = { itself: service.isSettled(folder, 'area'), below: service.isSettled(folder, 'area/sub'), other: service.isSettled(folder, 'other') };
		await settle();
		recognized.length = 0;

		await fileService.move(resource('docs/a.md'), resource('docs/b.md'));
		await timeout(15);
		const settled = { all: service.isSettled(folder), docs: service.isSettled(folder, 'docs'), other: service.isSettled(folder, 'other') };
		// The folder is listed, as after a watcher error, before the quiet period has passed.
		await service.compare(folder);
		const afterListing = [...recognized];
		await settle();

		assert.deepStrictEqual({ shownFolderMoved, settled, afterListing, moved: service.resolveMovedPath(folder, 'docs/a.md'), unmoved: service.resolveMovedPath(folder, 'other/keep.md') ?? null }, {
			shownFolderMoved: { itself: false, below: false, other: true },
			settled: { all: false, docs: false, other: true },
			afterListing: ['docs/a.md -> docs/b.md [file, sameContent]'],
			moved: 'docs/b.md',
			unmoved: null
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
		// The file events can arrive before the operation reports: the wait they started ends with the report.
		await timeout(15);
		const heldByEvents = service.isComparing(folder);
		service.acceptWorkbenchDelete(folder, 'b.md');
		const afterReport = [service.isComparing(folder), service.isSettled(folder)];
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

		assert.deepStrictEqual({ heldByEvents, afterReport, recognized, marked: marked.recognized, markedStored: await filesBelow(markedFiles, storage) }, {
			heldByEvents: true,
			afterReport: [false, true],
			recognized: [],
			marked: [],
			markedStored: []
		});
	});
});
