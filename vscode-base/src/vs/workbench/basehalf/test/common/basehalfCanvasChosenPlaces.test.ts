/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { relativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { FileService } from '../../../../platform/files/common/fileService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { InMemoryFileSystemProvider } from '../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { BaseHalfCanvasChosenPlaces, IBaseHalfCanvasChosenPlacesSaveOptions } from '../../common/basehalfCanvasChosenPlaces.js';
import { BaseHalfCanvasMirrorService } from '../../common/basehalfCanvasMirror.js';
import { baseHalfCanvasModelFromStat, baseHalfCanvasPosition, IBaseHalfCanvasCard } from '../../common/basehalfCanvasModel.js';
import { IBaseHalfCanvasFolderState } from '../../common/basehalfCanvasNavigation.js';
import { BASEHALF_MIRROR_IGNORE_CONTENT } from '../../common/basehalfMirrorIgnore.js';
import { BaseHalfWorkspaceMutationCoordinator } from '../../common/basehalfWorkspaceMutation.js';

suite('BaseHalfCanvasChosenPlaces', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const workspaceFolder = URI.from({ scheme: 'basehalf-places-test', path: '/work' });
	const root: IBaseHalfCanvasFolderState = { resource: workspaceFolder, workspaceFolder, relativePath: '', source: 'api' };

	/** What following moved items says. A test changes it to hold a row back. */
	interface IMoved {
		settled: boolean;
		moving: Set<string>;
	}

	interface IWindow {
		readonly places: BaseHalfCanvasChosenPlaces;
		readonly mirror: BaseHalfCanvasMirrorService;
		readonly moved: IMoved;
	}

	async function createFiles(files: Record<string, string>): Promise<IFileService> {
		const store = disposables.add(new DisposableStore());
		const fileService = store.add(new FileService(new NullLogService()));
		store.add(fileService.registerProvider(workspaceFolder.scheme, store.add(new InMemoryFileSystemProvider())));
		await fileService.createFolder(workspaceFolder);
		for (const [path, contents] of Object.entries(files)) {
			await fileService.createFile(URI.joinPath(workspaceFolder, path), VSBuffer.fromString(contents));
		}
		return fileService;
	}

	function openWindow(fileService: IFileService): IWindow {
		const moved: IMoved = { settled: true, moving: new Set() };
		const mirror = disposables.add(new BaseHalfCanvasMirrorService(fileService, new BaseHalfWorkspaceMutationCoordinator()));
		const places = new BaseHalfCanvasChosenPlaces(fileService, mirror, { isSettled: () => moved.settled, isMoving: (_folder, path) => moved.moving.has(path) }, new NullLogService());
		return { places, mirror, moved };
	}

	/**
	 * One drawing of the root canvas, as the canvas does it: read the folder and
	 * the layout, give every card its place, and save what the layout can take.
	 * With `saveLater` the places are chosen and the write is left to the caller.
	 */
	async function draw(fileService: IFileService, window: IWindow, saveLater = false, pathKey?: (path: string) => string): Promise<Record<string, string>> {
		const stat = await fileService.resolve(workspaceFolder, { resolveMetadata: true });
		const read = await window.mirror.inspectCanvas(root);
		const model = baseHalfCanvasModelFromStat(stat, { rootLevel: true, canvas: read.canvas, waiting: window.places.waitingFor(root), pathKey });
		window.places.drawn(root, model.appeared);
		if (!read.damage && !saveLater) {
			await save(fileService, window, { pathKey, respelled: model.respelled });
		}
		return Object.fromEntries(model.items.map(item => [item.path, at(item.card)]));
	}

	async function save(fileService: IFileService, window: IWindow, options?: IBaseHalfCanvasChosenPlacesSaveOptions): Promise<void> {
		const stat = await fileService.resolve(workspaceFolder);
		await window.places.save(root, (stat.children ?? []).map(child => child.name), await window.mirror.readCanvas(root), options);
	}

	/** A row that BaseHalf chose is marked with a star. */
	function at(card: IBaseHalfCanvasCard | undefined): string {
		return card ? `${card.x},${card.y}${card.auto ? '*' : ''}` : 'no place';
	}

	async function rows(window: IWindow): Promise<Record<string, string>> {
		return Object.fromEntries(((await window.mirror.readCanvas(root))?.cards ?? []).map(card => [card.path, at(card)]));
	}

	/** Every file under `.bh/`, by its path below it. */
	async function hidden(fileService: IFileService): Promise<string[]> {
		const out: string[] = [];
		const bh = URI.joinPath(workspaceFolder, '.bh');
		const pending = [bh];
		while (pending.length > 0) {
			let stat;
			try {
				stat = await fileService.resolve(pending.pop()!);
			} catch {
				continue;
			}
			for (const child of stat.children ?? []) {
				if (child.isDirectory) {
					pending.push(child.resource);
				} else {
					out.push(relativePath(bh, child.resource)!);
				}
			}
		}
		return out.sort();
	}

	const slot = (index: number, total: number) => { const place = baseHalfCanvasPosition(index, total); return `${place.x},${place.y}*`; };

	test('the first drawing saves a row for every card, writes nothing else, and a second drawing writes nothing', async () => {
		const fileService = await createFiles({ 'a.md': 'a', 'b.md': 'b', 'docs/guide.md': 'g' });
		const window = openWindow(fileService);

		const drawn = await draw(fileService, window);
		const layout = (await fileService.readFile(window.mirror.canvasResource(root))).value.toString();
		const again = await draw(fileService, window);

		assert.deepStrictEqual({
			drawn,
			// What is drawn is what is stored.
			stored: await rows(window),
			written: await hidden(fileService),
			ignoreFile: (await fileService.readFile(URI.joinPath(workspaceFolder, '.bh', '.gitignore'))).value.toString() === BASEHALF_MIRROR_IGNORE_CONTENT,
			again,
			unchanged: (await fileService.readFile(window.mirror.canvasResource(root))).value.toString() === layout,
			waiting: window.places.waitingFor(root)?.size ?? 0
		}, {
			drawn: { 'docs': slot(0, 3), 'a.md': slot(1, 3), 'b.md': slot(2, 3) },
			stored: { 'docs': slot(0, 3), 'a.md': slot(1, 3), 'b.md': slot(2, 3) },
			written: ['.gitignore', 'mirror/canvas.yaml'],
			ignoreFile: true,
			again: { 'docs': slot(0, 3), 'a.md': slot(1, 3), 'b.md': slot(2, 3) },
			unchanged: true,
			waiting: 0
		});
	});

	test('a file that is added goes to the end, and a row leaves only when BaseHalf chose it and has given the item up', async () => {
		const fileService = await createFiles({ 'b.md': 'b', 'c.md': 'c', 'd.md': 'd' });
		const window = openWindow(fileService);
		const first = await draw(fileService, window);
		// The user moves one card: its row is the user's from now on.
		await window.mirror.updateCardGeometry(root, { path: 'd.md', kind: 'file', x: 3000, y: 0, width: 300, height: 220 });

		// A name that sorts first is not sorted in. No row that was there changes.
		await fileService.createFile(URI.joinPath(workspaceFolder, 'a.md'), VSBuffer.fromString('a'));
		const afterAdd = await draw(fileService, window);

		// Two files are removed outside BaseHalf while it may still find them elsewhere.
		await fileService.del(URI.joinPath(workspaceFolder, 'c.md'));
		await fileService.del(URI.joinPath(workspaceFolder, 'd.md'));
		window.moved.settled = false;
		await draw(fileService, window);
		const whileComparing = Object.keys(await rows(window));
		window.moved.settled = true;
		window.moved.moving.add('c.md');
		await draw(fileService, window);
		const whileMoving = Object.keys(await rows(window));
		// BaseHalf has given them up.
		window.moved.moving.clear();
		await draw(fileService, window);

		assert.deepStrictEqual({
			first,
			afterAdd,
			whileComparing,
			whileMoving,
			// The row BaseHalf chose is gone. The row of the user's stays.
			givenUp: await rows(window)
		}, {
			first: { 'b.md': slot(0, 3), 'c.md': slot(1, 3), 'd.md': slot(2, 3) },
			// Beside the last card, which is the one furthest down and then furthest right: `c.md`.
			afterAdd: { 'a.md': slot(2, 3), 'b.md': slot(0, 3), 'c.md': slot(1, 3), 'd.md': '3000,0' },
			whileComparing: ['b.md', 'c.md', 'd.md', 'a.md'],
			whileMoving: ['b.md', 'c.md', 'd.md', 'a.md'],
			givenUp: { 'b.md': slot(0, 3), 'd.md': '3000,0', 'a.md': slot(2, 3) }
		});
	});

	test('nothing is written by itself in a marked folder, the cards stay, and a change by the user saves them', async () => {
		// The marker is a file of the folder like any other, so it has a card too.
		const marker = '.basehalf-no-workspace-setup';
		const fileService = await createFiles({ [marker]: '', 'a.md': 'a', 'b.md': 'b', 'c.md': 'c' });
		const window = openWindow(fileService);

		const first = await draw(fileService, window);
		const writtenByShowing = await hidden(fileService);
		// The list changes: the cards that were drawn keep their places.
		await fileService.createFile(URI.joinPath(workspaceFolder, '0.md'), VSBuffer.fromString('0'));
		const second = await draw(fileService, window);
		// The user drags one card. The places that wait are saved with it, before it.
		await window.places.saveWithUserChange(root);
		await window.mirror.updateCardGeometry(root, { path: 'a.md', kind: 'file', x: 50, y: 60, width: 300, height: 220 });

		assert.deepStrictEqual({
			first,
			writtenByShowing,
			second,
			afterTheDrag: await rows(window),
			waiting: window.places.waitingFor(root)?.size ?? 0
		}, {
			first: { [marker]: slot(0, 4), 'a.md': slot(1, 4), 'b.md': slot(2, 4), 'c.md': slot(3, 4) },
			writtenByShowing: [],
			// The new file is beside the last card, although its name sorts before the others.
			second: { [marker]: slot(0, 4), '0.md': '1900,690*', 'a.md': slot(1, 4), 'b.md': slot(2, 4), 'c.md': slot(3, 4) },
			afterTheDrag: { [marker]: slot(0, 4), 'a.md': '50,60', 'b.md': slot(2, 4), 'c.md': slot(3, 4), '0.md': '1900,690*' },
			waiting: 0
		});
	});

	test('a layout that cannot be read in full is not written by itself, and a change by the user saves the places', async () => {
		const damaged = 'path: ""\ncards:\n  - path: "a.md"\n    kind: file\n    x: 10\n    y: 20\n    width: 300\n    height: 220\n  - path: "broken.md"\n    kind: file\nedges: []\n';
		const fileService = await createFiles({ 'a.md': 'a', 'b.md': 'b', '.bh/mirror/canvas.yaml': damaged });
		const window = openWindow(fileService);

		const drawn = await draw(fileService, window);
		const untouched = (await fileService.readFile(window.mirror.canvasResource(root))).value.toString() === damaged;
		// Before the user's write the layout still cannot take them.
		await window.places.saveWithUserChange(root);
		const stillWaiting = window.places.waitingFor(root)?.size;
		await window.mirror.updateCardGeometry(root, { path: 'a.md', kind: 'file', x: 50, y: 60, width: 300, height: 220 });
		await window.places.saveWithUserChange(root);

		assert.deepStrictEqual({
			drawn,
			untouched,
			stillWaiting,
			afterTheDrag: await rows(window),
			recoveryCopies: (await hidden(fileService)).filter(path => path.startsWith('cache/recovered/')).length
		}, {
			drawn: { 'a.md': '10,20', 'b.md': '350,20*' },
			untouched: true,
			stillWaiting: 1,
			afterTheDrag: { 'a.md': '50,60', 'b.md': '350,20*' },
			recoveryCopies: 1
		});
	});

	test('a write that fails keeps the cards where they are and is tried again at the next drawing', async () => {
		const fileService = await createFiles({ 'a.md': 'a', 'b.md': 'b' });
		const window = openWindow(fileService);
		// Something is in the way of the ignore file, so no layout can be written.
		const inTheWay = URI.joinPath(workspaceFolder, '.bh', '.gitignore');
		await fileService.createFolder(inTheWay);

		const first = await draw(fileService, window);
		const afterFailure = await rows(window);
		await fileService.del(inTheWay, { recursive: true });
		const second = await draw(fileService, window);

		assert.deepStrictEqual({ first, afterFailure, second, stored: await rows(window) }, {
			first: { 'a.md': slot(0, 2), 'b.md': slot(1, 2) },
			afterFailure: {},
			second: { 'a.md': slot(0, 2), 'b.md': slot(1, 2) },
			stored: { 'a.md': slot(0, 2), 'b.md': slot(1, 2) }
		});
	});

	test('a file renamed in letter case only, on a volume that ignores it, keeps its row under the new spelling', async () => {
		const fileService = await createFiles({ 'Note.md': 'n', 'other.md': 'o' });
		const window = openWindow(fileService);
		const ignoreCase = (path: string) => path.toLowerCase();
		await draw(fileService, window, false, ignoreCase);
		await window.mirror.upsertCanvasEdge(root, { from: 'Note.md', from_anchor: 'east', to: 'other.md', to_anchor: 'west' });
		const before = await rows(window);

		// On such a volume this is one step. The provider of this test tells the two spellings apart, so it takes two.
		await fileService.del(URI.joinPath(workspaceFolder, 'Note.md'));
		await fileService.createFile(URI.joinPath(workspaceFolder, 'note.md'), VSBuffer.fromString('n'));
		const drawn = await draw(fileService, window, false, ignoreCase);

		assert.deepStrictEqual({
			before,
			drawn,
			// One row for it, where it was. It was not taken for a file that is gone, nor for a new one.
			stored: await rows(window),
			edges: (await window.mirror.readCanvas(root))?.edges.map(edge => `${edge.from}>${edge.to}`)
		}, {
			before: { 'Note.md': slot(0, 2), 'other.md': slot(1, 2) },
			drawn: { 'note.md': slot(0, 2), 'other.md': slot(1, 2) },
			stored: { 'note.md': slot(0, 2), 'other.md': slot(1, 2) },
			edges: ['note.md>other.md']
		});
	});

	test('two windows on one folder end with one row for each card, and a row written meanwhile is not covered', async () => {
		const fileService = await createFiles({ 'a.md': 'a', 'b.md': 'b' });
		const one = openWindow(fileService);
		const two = openWindow(fileService);
		await draw(fileService, one);
		await draw(fileService, two);

		// A file is added. Both windows choose a place before either has saved.
		await fileService.createFile(URI.joinPath(workspaceFolder, 'n.md'), VSBuffer.fromString('n'));
		const chosenByOne = await draw(fileService, one, true);
		const chosenByTwo = await draw(fileService, two, true);
		await save(fileService, one);
		await save(fileService, two);
		const both = await rows(one);

		// A second file is added, and before the window saves, a move writes a row
		// for another item at that very place. The window's card goes to the end.
		await fileService.createFile(URI.joinPath(workspaceFolder, 'o.md'), VSBuffer.fromString('o'));
		const chosen = await draw(fileService, one, true);
		await one.mirror.updateCardGeometry(root, { path: 'moved-in.md', kind: 'file', x: 1900, y: 690, width: 300, height: 220 });
		await save(fileService, one);

		assert.deepStrictEqual({
			chosenByOne: chosenByOne['n.md'],
			chosenByTwo: chosenByTwo['n.md'],
			both,
			twoWaits: two.places.waitingFor(root)?.size ?? 0,
			chosen: chosen['o.md'],
			saved: await rows(one),
			redrawn: (await draw(fileService, one))['o.md']
		}, {
			chosenByOne: '1560,690*',
			chosenByTwo: '1560,690*',
			both: { 'a.md': slot(0, 2), 'b.md': slot(1, 2), 'n.md': '1560,690*' },
			twoWaits: 0,
			chosen: '1900,690*',
			saved: { 'a.md': slot(0, 2), 'b.md': slot(1, 2), 'n.md': '1560,690*', 'moved-in.md': '1900,690', 'o.md': '2240,690*' },
			redrawn: '2240,690*'
		});
	});
});
