/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfCanvasFolderDropTarget, baseHalfCanvasKeptName, IBaseHalfCanvasDropCard } from '../../common/basehalfCanvasFolderDrop.js';

suite('BaseHalfCanvasFolderDrop', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const card = (path: string, x: number, y: number, folder = false, selected = false): IBaseHalfCanvasDropCard => ({ path, x, y, width: 248, height: 188, folder, selected });

	test('the folder card on top under the pointer takes a drop, leaving the dragged cards out', () => {
		const docs = card('docs', 700, 0, true);
		// A note that lies over the folder card at the right half.
		const note = card('note.md', 820, 0);
		const dragged = card('a.md', 700, 0, false, true);
		const at = (x: number, y: number, cards: readonly IBaseHalfCanvasDropCard[], draggedPaths: readonly string[] = ['a.md']) =>
			baseHalfCanvasFolderDropTarget(cards, new Set(draggedPaths), { x, y });
		assert.deepStrictEqual({
			// The dragged card is under the pointer, over the folder, and does not count.
			onFolderUnderDragged: at(720, 40, [docs, dragged]),
			onNoteOverFolder: at(900, 40, [docs, note, dragged]),
			beside: at(600, 40, [docs, dragged]),
			onEdge: at(700 + 248, 188, [docs, dragged]),
			// A folder card that is dragged takes nothing.
			itself: at(720, 40, [docs], ['docs']),
			// A selected card is drawn over a later one.
			selectedFolderOverNote: at(900, 40, [card('docs', 700, 0, true, true), note])
		}, {
			onFolderUnderDragged: 'docs',
			onNoteOverFolder: undefined,
			beside: undefined,
			onEdge: 'docs',
			itself: undefined,
			selectedFolderOverNote: 'docs'
		});
	});

	test('a moved item keeps both names, with a number after its name, before its extension', () => {
		assert.deepStrictEqual({
			note: [0, 1].map(attempt => baseHalfCanvasKeptName('plan.md', false, attempt)),
			numbered: baseHalfCanvasKeptName('plan 2.md', false, 0),
			folder: baseHalfCanvasKeptName('notes', true, 0),
			folderWithDot: baseHalfCanvasKeptName('v1.2', true, 0),
			dotFile: baseHalfCanvasKeptName('.env', false, 0),
			twoDots: baseHalfCanvasKeptName('archive.tar.gz', false, 0),
			numberWithoutSpace: baseHalfCanvasKeptName('shot-2.mp4', false, 0)
		}, {
			note: ['plan 2.md', 'plan 3.md'],
			numbered: 'plan 3.md',
			folder: 'notes 2',
			folderWithDot: 'v1.2 2',
			dotFile: '.env 2',
			twoDots: 'archive.tar 2.gz',
			numberWithoutSpace: 'shot-2 2.mp4'
		});
	});
});
