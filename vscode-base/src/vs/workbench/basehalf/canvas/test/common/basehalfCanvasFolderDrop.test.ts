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

	test('the taking folder takes a drop over its grown card, but not under a card drawn over it', () => {
		// A folder at 700..948 by 0..188, drawn at 108 percent around its
		// middle while it takes the drop: 690.08..957.92 by -7.52..195.52.
		const docs = card('docs', 700, 0, true);
		const grown = { path: 'docs', x: 690.08, y: -7.52, width: 267.84, height: 203.04 };
		// A note drawn after the folder, 4 canvas pixels to its right, so the
		// grown folder reaches under it.
		const note = card('note.md', 952, 0);
		const dragged = card('a.md', 400, 0, false, true);
		const at = (x: number, y: number, taking?: typeof grown) =>
			baseHalfCanvasFolderDropTarget([docs, note, dragged], new Set(['a.md']), { x, y }, taking);
		assert.deepStrictEqual({
			leftEdgeWhileTaking: at(694, 90, grown),
			bottomEdgeWhileTaking: at(820, 193, grown),
			// The note is drawn over the grown folder there.
			underTheNote: at(955, 90, grown),
			beyondTheGrownCard: at(686, 90, grown),
			// A folder that does not take the drop now has its place only.
			leftEdgeNotTaking: at(694, 90),
			// The grown card of another path counts for that path only.
			grownOfAnother: at(694, 90, { ...grown, path: 'other' })
		}, {
			leftEdgeWhileTaking: 'docs',
			bottomEdgeWhileTaking: 'docs',
			underTheNote: undefined,
			beyondTheGrownCard: undefined,
			leftEdgeNotTaking: undefined,
			grownOfAnother: undefined
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
